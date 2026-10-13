'use strict';

const { LANGUAGES, DEFAULT_LANG, isLang } = require('../lib/languages');
const { EVENTS, isEvent } = require('../lib/events');
const { fallbackLine } = require('../lib/templates');
const { readJson, sendJson, apiKey } = require('../lib/http');

const CHAT_URL = 'https://api.sarvam.ai/v1/chat/completions';
const MODEL = 'sarvam-105b-conversations';
const LLM_TIMEOUT_MS = 4000;
const HISTORY_LIMIT = 5;

function clip(value, max) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function systemPrompt(lang) {
  const l = LANGUAGES[lang];
  return [
    `You are a legendary, high-energy live TV cricket commentator calling a match in ${l.label}.`,
    `Language style: ${l.style}`,
    'Rules:',
    '- Reply with ONLY the spoken commentary for this one delivery: 1 or 2 short, punchy sentences, under 30 words total.',
    '- Sound live and emotional: build on the recent balls and the match situation (pressure, required rate, momentum).',
    '- Mention the batter or bowler by name when it fits. Never invent a different result than the one given.',
    '- Only quote numbers (runs needed, balls left, score) exactly as given in the match situation; never work out new ones.',
    '- Do not repeat phrases from the recent commentary.',
    '- No emojis, no hashtags, no quotes, no stage directions, no translations, no explanations.',
  ].join('\n');
}

function situation(score) {
  if (!score || typeof score !== 'object') return '';
  const runs = Number(score.runs) || 0;
  const wkts = Number(score.wkts) || 0;
  const overs = clip(score.overs, 8) || '0.0';
  let s = `Match situation AFTER this delivery: ${runs}/${wkts} after ${overs} overs.`;
  const target = Number(score.target) || 0;
  if (target > 0) {
    const need = target - runs;
    const ballsLeft = Number(score.ballsLeft);
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    if (need <= 0) s += ` Target ${target} reached: the batting side has WON the match.`;
    else if (wkts >= 10 || ballsLeft === 0) s += ` Chasing ${target}: they fell short by ${plural(need, 'run')}, the bowling side has WON.`;
    else s += ` Chasing ${target}: still need ${plural(need, 'run')}` +
      (Number.isFinite(ballsLeft) ? ` off ${plural(ballsLeft, 'ball')}` : '') + '. The match is still live.';
  } else {
    s += ' No target has been set, so do not mention runs needed or a chase.';
  }
  return s;
}

function buildMessages(input) {
  const { lang, event, freeText, batter, bowler, score, history } = input;
  const lines = [];
  lines.push(`Batter on strike: ${batter || 'unnamed'}. Bowler: ${bowler || 'unnamed'}.`);
  const sit = situation(score);
  if (sit) lines.push(sit);
  if (history.length) {
    lines.push('Earlier balls, already called (oldest first):');
    history.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
  }
  const what = [event !== 'free' ? EVENTS[event].desc : '', freeText].filter(Boolean).join(' - ');
  lines.push(`THIS DELIVERY: ${what || 'an exciting moment in the match'}`);
  lines.push(`Now call this delivery live in ${LANGUAGES[lang].label}.`);
  return [
    { role: 'system', content: systemPrompt(lang) },
    { role: 'user', content: lines.join('\n') },
  ];
}

// Keep whatever the model says short enough to be spoken in a few seconds.
function tidy(text) {
  let t = String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/[*_#`"“”«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t.replace(/^(commentary|commentator)\s*:\s*/i, '');
  const sentences = t.match(/[^.!?।|]+[.!?।|]+|[^.!?।|]+$/g) || [];
  t = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  if (t.length > 260) t = t.slice(0, 260).replace(/\s+\S*$/, '') + '…';
  return t;
}

async function callLlm(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const r = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 120, temperature: 0.9, messages }),
      signal: controller.signal,
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const data = await r.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    const text = tidy(content);
    if (!text) throw new Error('LLM returned empty text');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function normalise(body) {
  const lang = isLang(body.lang) ? body.lang : DEFAULT_LANG;
  const event = isEvent(body.event) ? body.event : 'free';
  const history = Array.isArray(body.history)
    ? body.history.slice(-HISTORY_LIMIT).map((h) => clip(h, 240)).filter(Boolean)
    : [];
  return {
    lang,
    event,
    // Free-text events may carry an inferred outcome used only for the template fallback.
    fallbackEvent: isEvent(body.fallbackEvent) ? body.fallbackEvent : event,
    freeText: clip(body.text, 200),
    batter: clip(body.batter, 40),
    bowler: clip(body.bowler, 40),
    score: body.score,
    history,
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Use POST' });
  }
  let input;
  try {
    input = normalise(await readJson(req));
  } catch (err) {
    return sendJson(res, err.status || 400, { error: 'Invalid JSON body' });
  }
  if (input.event === 'free' && !input.freeText) {
    return sendJson(res, 400, { error: 'Describe the ball in "text" or pick an event' });
  }

  const started = Date.now();
  let text;
  let source = 'llm';
  let reason;
  if (apiKey()) {
    try {
      text = await callLlm(buildMessages(input));
    } catch (err) {
      reason = err.name === 'AbortError' ? 'timeout' : err.message;
    }
  } else {
    reason = 'SARVAM_API_KEY not set';
  }
  if (!text) {
    source = 'template';
    text = fallbackLine(input.lang, input.fallbackEvent, input.batter, input.bowler);
  }
  sendJson(res, 200, { text, lang: input.lang, source, reason, llmMs: Date.now() - started });
};

module.exports.buildMessages = buildMessages;
module.exports.tidy = tidy;
