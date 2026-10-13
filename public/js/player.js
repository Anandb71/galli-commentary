// Plays the /api/speak mp3 stream as it arrives.
// MediaSource('audio/mpeg') where available, otherwise collect the bytes into a Blob.
// Every wait is bounded: a clip that never starts, stalls, or never fires 'ended'
// falls back or finishes on a timer, so callers always get control back.

const MSE_TYPE = 'audio/mpeg';

const FIRST_BYTE_MS = 15000; // request sent -> first audio bytes
const STALL_MS = 6000; // no new bytes, or no playback progress
const START_MS = 6000; // first bytes -> 'playing' before giving up on MediaSource
const DOWNLOAD_MS = 45000; // whole clip download
const END_GRACE_MS = 2500; // past the clip's duration before we stop waiting for 'ended'

export const canStream =
  typeof window !== 'undefined' &&
  'MediaSource' in window &&
  typeof MediaSource.isTypeSupported === 'function' &&
  MediaSource.isTypeSupported(MSE_TYPE);

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

function timeoutError(msg) {
  return Object.assign(new Error(msg), { name: 'TimeoutError' });
}

/**
 * Wait for one of `events` on `target`. Resolves with the event name, or rejects on
 * `failEvents`, abort, or after `ms`. Listeners are always removed.
 */
function waitFor(target, events, { failEvents = [], signal, ms, what = 'event' } = {}) {
  return new Promise((resolve, reject) => {
    let timer;
    const handlers = [];
    const finish = (fn, arg) => {
      clearTimeout(timer);
      for (const [t, e, h] of handlers) t.removeEventListener(e, h);
      fn(arg);
    };
    const on = (t, e, h) => {
      handlers.push([t, e, h]);
      t.addEventListener(e, h);
    };
    if (signal && signal.aborted) return reject(abortError());
    for (const e of events) on(target, e, () => finish(resolve, e));
    for (const e of failEvents) on(target, e, () => finish(reject, new Error(`${what}: ${e}`)));
    if (signal) on(signal, 'abort', () => finish(reject, abortError()));
    if (ms) timer = setTimeout(() => finish(reject, timeoutError(`${what} timed out`)), ms);
  });
}

// reader.read() that gives up after `ms` without data.
function readWithin(reader, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(timeoutError('Speech stream stalled')), ms);
  });
  return Promise.race([reader.read(), timeout]).finally(() => clearTimeout(timer));
}

// An AbortController that also aborts when `parent` does.
function childController(parent) {
  const ctl = new AbortController();
  if (parent) {
    if (parent.aborted) ctl.abort();
    else parent.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  return ctl;
}

// 0.1s of silence; played inside the first tap so mobile browsers allow later playback.
function silentWavUrl() {
  const samples = 800;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/**
 * Pumps the response body into `chunks`, notifying `onChunk` as bytes land.
 * `done` resolves when the body ends, stalls for STALL_MS, or runs past DOWNLOAD_MS;
 * whatever arrived is kept. It rejects only on abort.
 */
class Download {
  constructor(reader, firstChunk, signal) {
    this.reader = reader;
    this.chunks = [firstChunk];
    this.finished = false;
    this.listeners = new Set();
    this.done = this.pump(signal);
    this.done.catch(() => {});
  }

  async pump(signal) {
    const deadline = performance.now() + DOWNLOAD_MS;
    try {
      for (;;) {
        if (signal.aborted) throw abortError();
        const left = deadline - performance.now();
        if (left <= 0) break;
        const { done, value } = await readWithin(this.reader, Math.min(STALL_MS, left));
        if (done) break;
        if (value && value.byteLength) {
          this.chunks.push(value);
          for (const fn of this.listeners) fn(value);
        }
      }
    } catch (err) {
      if (signal.aborted) throw abortError();
      // Stalled or broken stream: keep what already arrived.
    } finally {
      this.finished = true;
      this.reader.cancel().catch(() => {});
      for (const fn of this.listeners) fn(null);
    }
  }

  // Calls fn(chunk) for each new chunk and fn(null) once at the end.
  subscribe(fn) {
    this.listeners.add(fn);
    if (this.finished) fn(null);
    return () => this.listeners.delete(fn);
  }
}

export class StreamPlayer {
  constructor(audio) {
    this.audio = audio;
    this.objectUrl = null;
    this.unlocked = false;
  }

  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const url = silentWavUrl();
    this.audio.src = url;
    this.audio.play().catch(() => {}).finally(() => URL.revokeObjectURL(url));
  }

  stop() {
    const a = this.audio;
    a.pause();
    a.removeAttribute('src');
    a.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  /**
   * Fetch speech and play it progressively.
   * Resolves when playback ends (or is given up on). Hooks: onFirstByte(), onPlaying().
   */
  async speak({ text, lang, speaker, signal, onFirstByte, onPlaying }) {
    this.stop();
    const ctl = childController(signal);
    const firstByteTimer = setTimeout(() => ctl.abort(), FIRST_BYTE_MS);
    let first;
    let reader;
    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang, speaker }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        let msg = `Speech failed (${res.status})`;
        try {
          const j = await res.json();
          if (j.error) msg = j.error;
        } catch (_) { /* not JSON */ }
        throw new Error(msg);
      }
      reader = res.body.getReader();
      first = await reader.read();
    } catch (err) {
      if (signal && signal.aborted) throw abortError();
      if (ctl.signal.aborted) throw timeoutError('Speech took too long to start');
      throw err;
    } finally {
      clearTimeout(firstByteTimer);
    }
    if (first.done || !first.value || !first.value.byteLength) throw new Error('Speech stream was empty');
    onFirstByte && onFirstByte();

    let started = false;
    const onPlay = () => {
      if (started) return;
      started = true;
      onPlaying && onPlaying();
    };
    const dl = new Download(reader, first.value, ctl.signal);
    try {
      if (canStream && (await this.playMse(dl, ctl.signal, onPlay))) return;
      await dl.done;
      this.stop();
      await this.playBlob(dl.chunks, ctl.signal, onPlay);
    } finally {
      ctl.abort();
    }
  }

  /**
   * Stream into a MediaSource. Returns true once the clip has been played through,
   * false if playback never started (the caller then falls back to a Blob).
   */
  async playMse(dl, signal, onPlay) {
    const a = this.audio;
    const ms = new MediaSource();
    this.objectUrl = URL.createObjectURL(ms);
    a.src = this.objectUrl;
    let feeding = true;
    const feed = this.feedMse(ms, dl, signal).finally(() => (feeding = false));
    feed.catch(() => {});
    const playing = waitFor(a, ['playing'], { failEvents: ['error'], signal, ms: START_MS, what: 'Streaming playback' });
    playing.catch(() => {});
    try {
      await Promise.race([playing, feed.then(() => playing)]);
    } catch (err) {
      if (signal.aborted) throw abortError();
      return false;
    }
    onPlay();
    await this.waitForEnd(signal, () => feeding);
    return true;
  }

  // Append the downloaded chunks, and those still arriving, to a fresh SourceBuffer.
  async feedMse(ms, dl, signal) {
    await waitFor(ms, ['sourceopen'], { signal, ms: START_MS, what: 'MediaSource' });
    const sb = ms.addSourceBuffer(MSE_TYPE);
    const queue = [...dl.chunks];
    let ended = false;
    let wake = null;
    const unsubscribe = dl.subscribe((chunk) => {
      if (chunk) queue.push(chunk);
      else ended = true;
      if (wake) wake();
    });
    try {
      let kicked = false;
      for (;;) {
        if (signal.aborted) throw abortError();
        if (queue.length) {
          sb.appendBuffer(queue.shift());
          await waitFor(sb, ['updateend'], { failEvents: ['error'], signal, ms: STALL_MS, what: 'Audio append' });
          if (!kicked) {
            kicked = true;
            this.audio.play().catch(() => {});
          }
          continue;
        }
        if (ended) break;
        await new Promise((resolve) => (wake = resolve));
        wake = null;
      }
    } finally {
      unsubscribe();
      if (ms.readyState === 'open' && !sb.updating) {
        try { ms.endOfStream(); } catch (_) { /* detached */ }
      }
    }
  }

  async playBlob(chunks, signal, onPlay) {
    const a = this.audio;
    this.objectUrl = URL.createObjectURL(new Blob(chunks, { type: 'audio/mpeg' }));
    a.src = this.objectUrl;
    const playing = waitFor(a, ['playing'], { failEvents: ['error'], signal, ms: START_MS, what: 'Playback' });
    playing.catch(() => {});
    await a.play();
    await playing;
    onPlay();
    await this.waitForEnd(signal);
  }

  /**
   * Resolve on 'ended', or once playback is clearly over: past the clip's duration plus
   * a grace period, or no progress for STALL_MS with no more audio coming.
   * Rejects on abort or a media error.
   */
  async waitForEnd(signal, isLoading = () => false) {
    const a = this.audio;
    let lastTime = a.currentTime;
    let lastMove = performance.now();
    let endBy = Infinity;
    for (;;) {
      try {
        await waitFor(a, ['ended'], { failEvents: ['error'], signal, ms: 500, what: 'Playback' });
        return;
      } catch (err) {
        if (err.name !== 'TimeoutError') throw err;
      }
      const now = performance.now();
      if (a.currentTime !== lastTime) {
        lastTime = a.currentTime;
        lastMove = now;
      }
      if (isLoading()) continue;
      if (now - lastMove > STALL_MS || now > endBy) return;
      if (Number.isFinite(a.duration) && endBy === Infinity) {
        const rate = a.playbackRate || 1;
        endBy = now + ((a.duration - a.currentTime) / rate) * 1000 + END_GRACE_MS;
      }
    }
  }
}
