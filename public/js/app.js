import { StreamPlayer, canStream } from './player.js';
import { Crowd } from './crowd.js';

const $ = (id) => document.getElementById(id);

const EVENT_META = {
  dot: { runs: 0, legal: true, chip: '•' },
  single: { runs: 1, legal: true, chip: '1' },
  two: { runs: 2, legal: true, chip: '2' },
  four: { runs: 4, legal: true, chip: '4', cls: 'c4', hype: true },
  six: { runs: 6, legal: true, chip: '6', cls: 'c6', hype: true },
  bowled: { runs: 0, legal: true, chip: 'W', cls: 'cW', wicket: true },
  caught: { runs: 0, legal: true, chip: 'W', cls: 'cW', wicket: true },
  lbw: { runs: 0, legal: true, chip: 'W', cls: 'cW', wicket: true },
  wide: { runs: 1, legal: false, chip: 'Wd', cls: 'cX' },
  noball: { runs: 1, legal: false, chip: 'Nb', cls: 'cX' },
  dropped: { runs: 0, legal: true, chip: '•', cls: 'cD' },
};

// A dramatic last over: 16 needed off 6.
const SCRIPT = {
  setup: { runs: 169, wkts: 6, legalBalls: 114, target: 185, batter: 'Hardik', bowler: 'Starc' },
  balls: [
    { event: 'dot', text: 'Starc nails a yorker on middle stump, Hardik just digs it out, no run' },
    { event: 'six', text: 'Low full toss and Hardik launches it high over long-on' },
    { event: 'wide', text: 'Starc goes for the wide yorker and misses the tramline' },
    { event: 'four', text: 'Off-pace slower ball, Hardik waits and slaps it past cover' },
    { event: 'caught', text: 'Hardik goes for the big one again, skied to long-off, taken right on the rope' },
    { event: 'two', batter: 'Jadeja', text: 'New batter Jadeja squeezes it to deep square leg and they sprint back for two' },
    { event: 'four', text: 'Three needed off the last ball, Jadeja scoops it over fine leg for FOUR to win the match' },
  ],
};

const state = {
  config: null,
  lang: 'hi-IN',
  speakerByLang: {},
  runs: 0,
  wkts: 0,
  legalBalls: 0,
  thisOver: [],
  history: [],
  latencies: [],
  job: null,
  scripted: false,
};

// The server falls back to a template line after 4s; this only guards a stuck connection.
const COMMENTARY_TIMEOUT_MS = 10000;
// Last-resort guard so a scripted over can never stall on one ball.
const BALL_MAX_MS = 90000;

const audioEl = $('voice');
const player = new StreamPlayer(audioEl);
const crowd = new Crowd();

// ---------- setup ----------

async function loadConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`config ${res.status}`);
  return res.json();
}

function langInfo(code) {
  return state.config.languages.find((l) => l.code === code);
}

function fillLanguages() {
  const sel = $('lang');
  sel.innerHTML = '';
  for (const l of state.config.languages) sel.add(new Option(l.label, l.code));
  sel.value = state.lang;
  fillSpeakers();
}

function fillSpeakers() {
  const sel = $('speaker');
  const info = langInfo(state.lang);
  sel.innerHTML = '';
  for (const s of info.speakers) sel.add(new Option(s.label, s.id));
  sel.value = currentSpeaker();
  $('langBadge').textContent = info.short;
}

function currentSpeaker() {
  const list = langInfo(state.lang).speakers;
  const saved = state.speakerByLang[state.lang];
  return list.some((s) => s.id === saved) ? saved : list[0].id;
}

function showBanner(msg) {
  const b = $('banner');
  b.textContent = msg;
  b.hidden = !msg;
}

// ---------- scoreboard ----------

const oversText = (balls) => `${Math.floor(balls / 6)}.${balls % 6}`;

function target() {
  const t = parseInt($('target').value, 10);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function ballsLeft() {
  return Math.max(0, 120 - state.legalBalls);
}

function scoreSnapshot() {
  const s = { runs: state.runs, wkts: state.wkts, overs: oversText(state.legalBalls) };
  if (target()) Object.assign(s, { target: target(), ballsLeft: ballsLeft() });
  return s;
}

function renderScore(bump) {
  $('runs').textContent = state.runs;
  $('wkts').textContent = state.wkts;
  $('overs').textContent = oversText(state.legalBalls);
  const eq = $('equation');
  const t = target();
  eq.classList.remove('won');
  if (t) {
    const need = t - state.runs;
    if (need <= 0) {
      eq.textContent = '🏆 Target chased down!';
      eq.classList.add('won');
    } else if (state.wkts >= 10 || ballsLeft() === 0) {
      eq.textContent = `Fell short by ${need}`;
    } else {
      const rrr = (need / ballsLeft()) * 6;
      eq.textContent = `Need ${need} off ${ballsLeft()} · RRR ${rrr.toFixed(2)}`;
    }
  } else {
    const crr = state.legalBalls ? (state.runs / state.legalBalls) * 6 : 0;
    eq.textContent = `CRR ${crr.toFixed(2)}`;
  }
  const ol = $('overBalls');
  ol.innerHTML = '';
  for (const c of state.thisOver) {
    const li = document.createElement('li');
    li.textContent = c.chip;
    if (c.cls) li.className = c.cls;
    ol.append(li);
  }
  if (bump) {
    const s = document.querySelector('.score');
    s.classList.remove('bump');
    void s.offsetWidth;
    s.classList.add('bump');
  }
}

function applyEvent(event) {
  const m = EVENT_META[event];
  if (!m) return;
  const legalThisOver = state.thisOver.filter((c) => c.legal).length;
  if (legalThisOver >= 6) state.thisOver = [];
  state.runs += m.runs;
  if (m.wicket) state.wkts = Math.min(10, state.wkts + 1);
  if (m.legal) state.legalBalls += 1;
  state.thisOver.push({ chip: m.chip, cls: m.cls, legal: m.legal });
  renderScore(m.runs >= 4 || m.wicket);
}

// Rough outcome from a typed description, so free text still moves the scoreboard.
function inferEvent(text) {
  const t = text.toLowerCase();
  const has = (re) => re.test(t);
  if (has(/\b(drop(s|ped)?|put down|spill(s|ed)?)\b/)) return 'dropped';
  if (has(/\bno[\s-]?ball\b|free hit/)) return 'noball';
  if (has(/\bwide\b/)) return 'wide';
  if (has(/\bsix(es)?\b|\bsixer\b|maximum|\b6\b|छक्का|सिक्स/)) return 'six';
  if (has(/\bfour\b|boundary|\b4\b|चौका/)) return 'four';
  if (has(/\bbowled\b|castle[sd]?|\bstumps?\b|bails|timber/)) return 'bowled';
  if (has(/\blbw\b|leg before|plumb/)) return 'lbw';
  if (has(/\bcaught\b|\bcatch\b|\bout\b|\bwicket\b|\bgone\b/)) return 'caught';
  if (has(/\btwo\b|\bcouple\b|\b2 runs\b/)) return 'two';
  if (has(/\bsingle\b|\bone run\b|\b1 run\b|quick one/)) return 'single';
  if (has(/\bdot\b|no run|beaten|defend(s|ed)?|leaves?\b/)) return 'dot';
  return null;
}

// ---------- ticker / feed / latency ----------

function setTicker(text, { thinking = false, mood = '', lang = state.lang } = {}) {
  const el = $('tickerText');
  el.className = 'ticker-text' + (thinking ? ' thinking' : '') + (mood ? ` ${mood}` : '');
  el.lang = lang.slice(0, 2);
  el.textContent = text;
}

function setSource(source) {
  const b = $('sourceBadge');
  b.className = 'badge ghost ' + (source || '');
  b.textContent = source === 'llm' ? 'Sarvam 105B' : source === 'template' ? 'quick template' : source || 'ready';
}

function addFeed(over, event, text, lang) {
  const li = document.createElement('li');
  const ov = document.createElement('span');
  ov.className = 'ov';
  ov.textContent = over;
  const m = EVENT_META[event];
  if (m) {
    const em = document.createElement('em');
    em.textContent = m.chip === '•' ? (event === 'dropped' ? 'DROP' : 'DOT') : m.chip;
    em.className = m.cls ? `e${m.chip[0]}` : '';
    ov.append(em);
  }
  const p = document.createElement('span');
  p.textContent = text;
  p.lang = lang.slice(0, 2);
  li.append(ov, p);
  $('feed').prepend(li);
  while ($('feed').children.length > 40) $('feed').lastChild.remove();
  const recent = [...$('feed').children].slice(0, 6).map((n) => n.lastChild.textContent);
  $('marquee').textContent = '🏏 ' + recent.join('   ✦   ') + '   ✦';
}

function showLatency(entry) {
  const ttfa = $('ttfa');
  ttfa.textContent = entry.ttfa != null ? Math.round(entry.ttfa) : '—';
  ttfa.parentElement.className =
    'ttfa ' + (entry.ttfa == null ? '' : entry.ttfa < 2500 ? 'good' : entry.ttfa < 4000 ? 'ok' : 'slow');
  $('llmMs').textContent = entry.llm != null ? Math.round(entry.llm) : '—';
  $('ttsMs').textContent = entry.tts != null ? Math.round(entry.tts) : '—';
  $('playMs').textContent = entry.play != null ? Math.round(entry.play) : '—';
}

function pushLatency(entry) {
  state.latencies.unshift(entry);
  state.latencies = state.latencies.slice(0, 8);
  const max = Math.max(...state.latencies.map((e) => e.ttfa || 0), 1);
  const ol = $('latHistory');
  ol.innerHTML = '';
  for (const e of state.latencies) {
    const li = document.createElement('li');
    const tag = document.createElement('span');
    tag.textContent = e.short;
    const bar = document.createElement('span');
    bar.className = 'bar';
    for (const part of [e.llm, e.tts, e.play]) {
      const s = document.createElement('span');
      s.style.width = `${(100 * (part || 0)) / max}%`;
      bar.append(s);
    }
    const total = document.createElement('b');
    total.textContent = `${Math.round(e.ttfa)}ms`;
    li.append(tag, bar, total);
    ol.append(li);
  }
  const vals = state.latencies.map((e) => e.ttfa);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  $('latAvg').textContent =
    `avg ${Math.round(avg)} ms · best ${Math.round(Math.min(...vals))} ms over last ${vals.length} · ` +
    (canStream ? 'streaming via MediaSource' : 'buffered playback (no MediaSource mp3)');
}

// ---------- the main loop: one ball ----------

function cancelJob() {
  if (state.job) {
    state.job.abort();
    state.job = null;
  }
  player.stop();
  setOnAir(false);
}

function setOnAir(on) {
  $('onair').classList.toggle('on', on);
  crowd.duck(on);
}

function flash() {
  document.body.classList.remove('flash');
  void document.body.offsetWidth;
  document.body.classList.add('flash');
}

/** Score the ball, get commentary, speak it. Resolves when the audio finishes. */
async function playBall({ event, text = '', batter }) {
  cancelJob();
  const job = new AbortController();
  state.job = job;
  const t0 = performance.now();

  if (batter) $('batter').value = batter;
  const scoredAs = event === 'free' ? inferEvent(text) : event;
  if (scoredAs) applyEvent(scoredAs);
  const overLabel = oversText(state.legalBalls);
  const meta = EVENT_META[scoredAs] || {};
  const won = target() && state.runs >= target() && state.runs - (meta.runs || 0) < target();
  crowd.react(won ? 'win' : scoredAs || 'single');
  if (meta.hype || meta.wicket || won) flash();

  const lang = state.lang;
  const speaker = currentSpeaker();
  const mood = meta.wicket ? 'wkt' : meta.hype || won ? 'hype' : '';
  setTicker('', { thinking: true, lang });
  setSource('');
  $('tickerMeta').textContent = `${overLabel} · ${$('bowler').value || 'Bowler'} to ${$('batter').value || 'Batter'}`;

  const entry = { short: overLabel, llm: null, tts: null, play: null, ttfa: null };
  showLatency(entry);

  let line;
  const request = new AbortController();
  const abortRequest = () => request.abort();
  job.signal.addEventListener('abort', abortRequest, { once: true });
  const requestTimer = setTimeout(abortRequest, COMMENTARY_TIMEOUT_MS);
  try {
    const res = await fetch('/api/commentary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: event === 'free' ? 'free' : event,
        fallbackEvent: scoredAs || 'free',
        text,
        lang,
        batter: $('batter').value,
        bowler: $('bowler').value,
        score: scoreSnapshot(),
        history: state.history,
      }),
      signal: request.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Commentary failed (${res.status})`);
    line = data.text;
    entry.llm = performance.now() - t0;
    showLatency(entry);
    setSource(data.source);
  } catch (err) {
    if (job.signal.aborted) return;
    setTicker(request.signal.aborted ? 'Commentary timed out' : err.message || 'Commentary failed', { lang });
    state.job = null;
    return;
  } finally {
    clearTimeout(requestTimer);
    job.signal.removeEventListener('abort', abortRequest);
  }

  setTicker(line, { mood, lang });
  addFeed(overLabel, scoredAs, line, lang);
  state.history = [...state.history, line].slice(-5);

  if (!state.config || !state.config.keyConfigured) {
    // No key on the server: show the call, give the reader a moment, skip audio.
    await new Promise((r) => setTimeout(r, 2500));
    if (state.job === job) state.job = null;
    return;
  }

  const tTts = performance.now();
  try {
    await player.speak({
      text: line,
      lang,
      speaker,
      signal: job.signal,
      onFirstByte: () => {
        entry.tts = performance.now() - tTts;
        showLatency(entry);
      },
      onPlaying: () => {
        entry.ttfa = performance.now() - t0;
        entry.play = entry.ttfa - entry.llm - entry.tts;
        showLatency(entry);
        pushLatency(entry);
        setOnAir(true);
        if ($('banner').textContent.startsWith('Audio:')) showBanner('');
      },
    });
  } catch (err) {
    if (job.signal.aborted) return;
    showBanner(`Audio: ${err.message}`);
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    if (state.job === job) {
      state.job = null;
      setOnAir(false);
    }
  }
}

// ---------- scripted over ----------

function setScripted(on) {
  state.scripted = on;
  $('scriptBtn').classList.toggle('running', on);
  $('scriptBtn').disabled = on;
  $('stopBtn').hidden = !on;
  document.querySelectorAll('.ev, .go').forEach((b) => (b.disabled = on));
}

async function playBallWithin(ball, ms) {
  let timer;
  const finished = await Promise.race([
    playBall(ball).then(() => true),
    new Promise((resolve) => (timer = setTimeout(() => resolve(false), ms))),
  ]);
  clearTimeout(timer);
  if (!finished) cancelJob();
}

async function runScript() {
  const s = SCRIPT.setup;
  Object.assign(state, { runs: s.runs, wkts: s.wkts, legalBalls: s.legalBalls, thisOver: [], history: [] });
  $('target').value = s.target;
  $('batter').value = s.batter;
  $('bowler').value = s.bowler;
  renderScore(false);
  setScripted(true);
  setTicker(`Last over. ${s.target - s.runs} needed off 6. ${s.bowler} has the ball…`);
  try {
    await new Promise((r) => setTimeout(r, 900));
    for (const ball of SCRIPT.balls) {
      if (!state.scripted) break;
      await playBallWithin(ball, BALL_MAX_MS);
      if (!state.scripted) break;
      await new Promise((r) => setTimeout(r, 650));
    }
  } finally {
    setScripted(false);
  }
}

// ---------- wiring ----------

function firstGesture() {
  crowd.start();
  player.unlock();
}

function bind() {
  document.addEventListener('pointerdown', firstGesture, { once: true, capture: true });
  document.addEventListener('keydown', firstGesture, { once: true, capture: true });

  document.querySelectorAll('.ev').forEach((btn) =>
    btn.addEventListener('click', () => {
      firstGesture();
      btn.classList.remove('fired');
      void btn.offsetWidth;
      btn.classList.add('fired');
      playBall({ event: btn.dataset.ev });
    }),
  );

  $('freeForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('freeText').value.trim();
    if (!text) return $('freeText').focus();
    firstGesture();
    $('freeText').value = '';
    playBall({ event: 'free', text });
  });

  $('lang').addEventListener('change', (e) => {
    state.lang = e.target.value;
    fillSpeakers();
    localStorage.setItem('galli.lang', state.lang);
  });
  $('speaker').addEventListener('change', (e) => {
    state.speakerByLang[state.lang] = e.target.value;
    localStorage.setItem('galli.speakers', JSON.stringify(state.speakerByLang));
  });

  $('crowdToggle').addEventListener('click', (e) => {
    const on = e.currentTarget.getAttribute('aria-pressed') !== 'true';
    e.currentTarget.setAttribute('aria-pressed', String(on));
    crowd.start();
    crowd.setEnabled(on);
  });

  $('scriptBtn').addEventListener('click', () => {
    firstGesture();
    runScript();
  });
  $('stopBtn').addEventListener('click', () => {
    setScripted(false);
    cancelJob();
    setTicker('Stopped. Over to you.');
  });
  $('resetBtn').addEventListener('click', () => {
    setScripted(false);
    cancelJob();
    Object.assign(state, { runs: 0, wkts: 0, legalBalls: 0, thisOver: [], history: [] });
    $('target').value = '';
    renderScore(false);
    setTicker('Fresh innings. Tap a delivery below.');
    setSource('');
  });
  $('target').addEventListener('input', () => renderScore(false));

  // Keyboard shortcuts for live play: 0 1 2 4 6 w x(wide) n(no-ball) d(dropped).
  const keys = { '0': 'dot', '.': 'dot', '1': 'single', '2': 'two', '4': 'four', '6': 'six', w: 'bowled', c: 'caught', l: 'lbw', x: 'wide', n: 'noball', d: 'dropped' };
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const ev = keys[e.key.toLowerCase()];
    if (ev && !state.scripted) document.querySelector(`.ev[data-ev="${ev}"]`).click();
  });
}

async function init() {
  bind();
  renderScore(false);
  try {
    state.config = await loadConfig();
  } catch (err) {
    showBanner('Could not reach the server. Is it running?');
    return;
  }
  const savedLang = localStorage.getItem('galli.lang');
  state.lang = savedLang && langInfo(savedLang) ? savedLang : state.config.defaultLang;
  try {
    state.speakerByLang = JSON.parse(localStorage.getItem('galli.speakers') || '{}') || {};
  } catch (_) {
    state.speakerByLang = {};
  }
  fillLanguages();
  if (!state.config.keyConfigured) {
    showBanner('SARVAM_API_KEY is not set on the server: commentary will use built-in templates and audio is unavailable.');
  }
}

init();
