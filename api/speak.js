'use strict';

const { DEFAULT_LANG, isLang, resolveSpeaker } = require('../lib/languages');
const { readJson, sendJson, apiKey } = require('../lib/http');

const TTS_URL = 'https://api.sarvam.ai/text-to-speech/stream';
const MODEL = 'bulbul:v4-flash';
const MAX_TEXT = 500;
const HEADERS_TIMEOUT_MS = 12000;
const IDLE_TIMEOUT_MS = 8000;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Use POST' });
  }
  if (!apiKey()) return sendJson(res, 503, { error: 'SARVAM_API_KEY not set on the server' });

  let body;
  try {
    body = await readJson(req);
  } catch (err) {
    return sendJson(res, err.status || 400, { error: 'Invalid JSON body' });
  }
  const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (!text) return sendJson(res, 400, { error: 'Missing "text"' });
  const lang = isLang(body.lang) ? body.lang : DEFAULT_LANG;
  const speaker = resolveSpeaker(lang, body.speaker);

  // Stop paying for audio nobody will hear if the listener goes away.
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.on('close', abort);

  const started = Date.now();
  const headersTimer = setTimeout(abort, HEADERS_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        target_language_code: lang,
        speaker,
        model: MODEL,
        enable_preprocessing: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (res.destroyed) return;
    const timedOut = controller.signal.aborted;
    return sendJson(res, timedOut ? 504 : 502, {
      error: timedOut ? 'TTS service took too long' : 'Could not reach the TTS service',
    });
  } finally {
    clearTimeout(headersTimer);
  }

  if (!upstream.ok || !upstream.body) {
    let detail = '';
    try {
      detail = (await upstream.text()).slice(0, 300);
    } catch (_) {
      /* ignore */
    }
    return sendJson(res, 502, { error: `TTS service returned ${upstream.status}`, detail });
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Speaker', speaker);
  res.setHeader('X-Upstream-Headers-Ms', String(Date.now() - started));
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  // Pipe bytes through as they arrive; never buffer the whole clip.
  // A stalled upstream ends the clip with what arrived instead of holding the client open.
  const reader = upstream.body.getReader();
  let idleTimer;
  const idle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(abort, IDLE_TIMEOUT_MS);
  };
  try {
    for (;;) {
      idle();
      const { done, value } = await reader.read();
      if (done) break;
      if (res.destroyed) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise((resolve) => {
          res.once('drain', resolve);
          res.once('close', resolve);
        });
      }
    }
  } catch (_) {
    // Upstream hiccup or client disconnect; end what we have.
  } finally {
    clearTimeout(idleTimer);
    res.off('close', abort);
    reader.cancel().catch(() => {});
    if (!res.writableEnded) res.end();
  }
};
