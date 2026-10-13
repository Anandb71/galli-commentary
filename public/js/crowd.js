// Stadium crowd bed synthesised with WebAudio: filtered noise murmur,
// swells/roars on big moments, claps, and ducking under the commentator.

const REACTIONS = {
  dot: { level: 0.12, sweep: 0, claps: 0 },
  single: { level: 0.18, sweep: 0, claps: 0.2 },
  two: { level: 0.3, sweep: 0.2, claps: 0.4 },
  four: { level: 0.8, sweep: 0.7, claps: 1 },
  six: { level: 1, sweep: 1, claps: 1 },
  bowled: { level: 1, sweep: 0.9, claps: 0.8 },
  caught: { level: 0.95, sweep: 0.9, claps: 0.8 },
  lbw: { level: 0.85, sweep: 0.8, claps: 0.6 },
  wide: { level: 0.15, sweep: 0, claps: 0 },
  noball: { level: 0.35, sweep: 0.3, claps: 0.3 },
  dropped: { level: 0.75, sweep: -0.8, claps: 0 }, // a groan: pitch falls
  win: { level: 1, sweep: 1, claps: 1, long: true },
};

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // Paul Kellet's pink-noise filter: warmer than white noise, closer to a crowd.
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return buf;
}

export class Crowd {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  // Must be called from a user gesture (autoplay policy).
  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.noise = makeNoise(ctx, 4);

    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.55 : 0;
    this.duckGain = ctx.createGain();
    this.duckGain.connect(this.master).connect(ctx.destination);

    // Murmur bed: band-limited pink noise with a slow, uneven swell.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 700;
    band.Q.value = 0.5;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 2400;
    const bed = ctx.createGain();
    bed.gain.value = 0.22;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.07;
    lfo.connect(lfoDepth).connect(bed.gain);
    src.connect(band).connect(low).connect(bed).connect(this.duckGain);
    src.start();
    lfo.start();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.55 : 0, t, 0.25);
  }

  duck(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.duckGain.gain.cancelScheduledValues(t);
    this.duckGain.gain.setTargetAtTime(on ? 0.3 : 1, t, on ? 0.08 : 0.6);
  }

  react(kind) {
    if (!this.ctx || !this.enabled) return;
    const r = REACTIONS[kind] || REACTIONS.single;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const hold = r.long ? 5 : 1.2 + r.level * 1.6;

    // Roar: a louder, brighter noise layer whose band centre sweeps with the excitement.
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.8;
    const f0 = 650;
    const f1 = f0 * (1 + r.sweep * 1.4);
    band.frequency.setValueAtTime(f0, t);
    band.frequency.linearRampToValueAtTime(Math.max(250, f1), t + 0.6);
    band.frequency.linearRampToValueAtTime(f0, t + hold + 1.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 + r.level * 0.9, t + 0.25 + r.level * 0.2);
    g.gain.setTargetAtTime(0.0001, t + hold, 0.9);
    src.connect(band).connect(g).connect(this.duckGain);
    src.start(t, Math.random() * 3);
    src.stop(t + hold + 5);

    if (r.claps > 0) this.claps(t + 0.3, hold + 1.5, r.claps);
  }

  // Applause: lots of short, bright noise bursts at random times.
  claps(start, duration, density) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(hp).connect(g).connect(this.duckGain);
    const count = Math.floor(duration * 45 * density);
    const times = Array.from({ length: count }, () => start + Math.random() * duration).sort((x, y) => x - y);
    let last = 0;
    for (const at of times) {
      if (at < last + 0.035) continue; // keep the automation events from overlapping
      last = at;
      const fade = 1 - (at - start) / duration;
      g.gain.setValueAtTime(0.0, at);
      g.gain.linearRampToValueAtTime(0.25 * fade * (0.5 + Math.random() * 0.5), at + 0.004);
      g.gain.linearRampToValueAtTime(0.0, at + 0.03);
    }
    src.start(start);
    src.stop(start + duration + 0.2);
  }
}
