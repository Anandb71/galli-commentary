'use strict';

// End-to-end smoke test: boots the dev server and hits every API for every language.
//   node test/smoke.js                 one speaker per language
//   node test/smoke.js --all-speakers  every verified speaker

const assert = require('assert');
const { createServer } = require('../dev-server');
const { LANGUAGES } = require('../lib/languages');
const { tidy } = require('../api/commentary');
const { fallbackLine } = require('../lib/templates');

const ALL = process.argv.includes('--all-speakers');

async function post(base, path, body) {
  const t0 = Date.now();
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, t0 };
}

async function speak(base, text, lang, speaker) {
  const { res, t0 } = await post(base, '/api/speak', { text, lang, speaker });
  const headersMs = Date.now() - t0;
  if (res.status !== 200) return { status: res.status, body: await res.text() };
  const reader = res.body.getReader();
  let bytes = 0;
  let firstByteMs = null;
  let chunks = 0;
  let head;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (firstByteMs == null) {
      firstByteMs = Date.now() - t0;
      head = Buffer.from(value.slice(0, 3));
    }
    bytes += value.byteLength;
    chunks++;
  }
  return { status: 200, type: res.headers.get('content-type'), headersMs, firstByteMs, totalMs: Date.now() - t0, bytes, chunks, head };
}

function isMp3(head) {
  return (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) || head.toString('latin1') === 'ID3';
}

(async () => {
  // Offline unit checks.
  assert.strictEqual(tidy('"One! Two. Three?"'), 'One! Two.');
  assert.strictEqual(tidy('<think>hmm</think> **छक्का!** कमाल।'), 'छक्का! कमाल।');
  for (const lang of Object.keys(LANGUAGES)) {
    assert.ok(fallbackLine(lang, 'six', 'Kohli', 'Starc').length > 5);
  }

  const server = createServer().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  try {
    const cfg = await (await fetch(base + '/api/config')).json();
    assert.strictEqual(cfg.languages.length, 5);
    console.log(`config ok (key configured: ${cfg.keyConfigured})`);

    const index = await fetch(base + '/');
    assert.strictEqual(index.status, 200);
    assert.strictEqual((await fetch(base + '/../package.json')).status, 404);
    assert.strictEqual((await fetch(base + '/api/nope')).status, 404);
    assert.strictEqual((await fetch(base + '/api/speak')).status, 405);
    const bad = await post(base, '/api/commentary', { event: 'free', text: '' });
    assert.strictEqual(bad.res.status, 400);

    for (const [lang, info] of Object.entries(LANGUAGES)) {
      const { res, t0 } = await post(base, '/api/commentary', {
        event: 'six', lang, batter: 'Kohli', bowler: 'Starc',
        score: { runs: 175, wkts: 6, overs: '19.2', target: 185, ballsLeft: 4 },
        history: ['Starc nails the yorker, dot ball.'],
      });
      const data = await res.json();
      const ms = Date.now() - t0;
      console.log(`\n[${lang}] commentary ${res.status} ${ms}ms (${data.source}${data.reason ? ': ' + data.reason : ''})\n  ${data.text}`);
      if (res.status !== 200 || !data.text) failed++;

      const speakers = ALL ? info.speakers.map((s) => s.id) : [info.speakers[0].id];
      for (const speaker of speakers) {
        const r = await speak(base, data.text, lang, speaker);
        if (r.status !== 200) {
          failed++;
          console.log(`  speak ${speaker}: FAIL ${r.status} ${r.body}`);
          continue;
        }
        const ok = r.type === 'audio/mpeg' && r.bytes > 1000 && isMp3(r.head);
        if (!ok) failed++;
        console.log(
          `  speak ${speaker}: ${ok ? 'ok' : 'FAIL'} ${r.status} ${r.type} ttfb=${r.firstByteMs}ms ` +
          `total=${r.totalMs}ms bytes=${r.bytes} chunks=${r.chunks}`,
        );
      }
    }
  } finally {
    server.close();
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
