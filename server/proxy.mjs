// Digital Brick Builder: shared AI proxy. Node 20+, no dependencies.
// Holds the AI credentials, checks a passcode, rate-limits, and forwards ONE kind of request to ONE upstream
// chosen by the server (UPSTREAM=qwen|gemini|anthropic, or auto = local qwen first, Gemini as the automatic backup).
// The browser never picks the model or the upstream.
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const UPSTREAMS = ['auto', 'qwen', 'gemini', 'anthropic'];
const LIMIT_KEYS = ['qwen', 'gemini', 'anthropic'];
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const HOUR = 3_600_000, DAY = 86_400_000;
const MIN_CODE = 16;                 // shortest passcode accepted at startup
const MAX_TEXT_CHARS = 150_000;      // system + all message text (pictures excluded): bounds cost per request
const FAIL_LIMIT = 10, FAIL_SPAN = 600_000; // wrong-passcode attempts allowed per connection per 10 minutes

/** "qwen:60,gemini:10" -> { qwen: 60, gemini: 10 } */
function parseMap(s, what) {
  const out = {};
  for (const part of String(s || '').split(',').map(x => x.trim()).filter(Boolean)) {
    const [k, v] = part.split(':');
    const n = Number(v);
    if (!LIMIT_KEYS.includes(k) || !Number.isFinite(n) || n < 0) throw new Error(`${what}: bad entry "${part}" (use name:number, names ${LIMIT_KEYS.join('/')})`);
    out[k] = n;
  }
  return out;
}
const int = (v, d) => (v === undefined || v === '' ? d : Number.isFinite(Number(v)) ? Number(v) : NaN);

export function loadConfig(env) {
  const errs = [];
  const need = (k) => { if (!env[k]) errs.push(`${k} is required`); return env[k] || ''; };
  const upstream = need('UPSTREAM');
  if (upstream && !UPSTREAMS.includes(upstream)) errs.push(`UPSTREAM must be one of ${UPSTREAMS.join(', ')}`);
  const passcodes = [];
  for (const part of need('PASSCODES').split(',').map(x => x.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    if (i < 1 || i === part.length - 1) { errs.push('PASSCODES entries must look like name:code'); break; }
    if (part.length - i - 1 < MIN_CODE) { errs.push(`each passcode must be at least ${MIN_CODE} characters`); break; }
    passcodes.push({ name: part.slice(0, i), hash: crypto.createHash('sha256').update(part.slice(i + 1)).digest() });
  }
  const origins = need('ALLOWED_ORIGINS').split(',').map(x => x.trim()).filter(Boolean);
  if (origins.includes('*')) errs.push('ALLOWED_ORIGINS must not contain *');
  if (env.ALLOW_LOCALHOST === '1') origins.push('http://localhost:5173');
  let perDay, perHour, globalDay;
  try {
    perDay = { qwen: 60, gemini: 10, anthropic: 10, ...parseMap(env.LIMIT_DAY, 'LIMIT_DAY') };
    globalDay = { qwen: 300, gemini: 30, anthropic: 30, ...parseMap(env.LIMIT_GLOBAL_DAY, 'LIMIT_GLOBAL_DAY') };
    perHour = { qwen: 0, gemini: 0, anthropic: 0, ...parseMap(env.LIMIT_HOUR, 'LIMIT_HOUR') }; // 0 = no hourly limit
  } catch (e) { errs.push(e.message); }
  if (upstream === 'anthropic') need('ANTHROPIC_API_KEY');
  if (upstream === 'gemini' || upstream === 'auto') need('GEMINI_API_KEY');
  if (upstream === 'qwen' || upstream === 'auto') { need('QWEN_BASE_URL'); need('QWEN_MODEL'); }
  if (env.AUTO_PRIMARY && !['local', 'gemini'].includes(env.AUTO_PRIMARY)) errs.push('AUTO_PRIMARY must be local or gemini');
  const cfg = {
    upstream, passcodes, origins, perDay, perHour, globalDay,
    autoPrimary: env.AUTO_PRIMARY || 'local',
    geminiModels: (env.GEMINI_MODELS || env.GEMINI_MODEL || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-3.5-flash').split(',').map(x => x.trim()).filter(Boolean),
    geminiRpm: int(env.GEMINI_RPM_PER_MODEL, 12), geminiTryMs: int(env.GEMINI_TRY_MS, 25_000),
    autoFirstTokenMs: int(env.AUTO_FIRST_TOKEN_MS, 12_000), maxLocalInFlight: int(env.MAX_LOCAL_IN_FLIGHT, 2),
    autoPrimaryMs: int(env.AUTO_PRIMARY_TIMEOUT_MS, 60_000), autoFallbackMs: int(env.AUTO_FALLBACK_TIMEOUT_MS, 50_000), guestGlobalGeminiDay: int(env.GUEST_GLOBAL_GEMINI_DAY, 60),
    openAccess: env.OPEN_ACCESS === '1', guestGlobalDay: int(env.GUEST_GLOBAL_DAY, 150), guestIpDay: int(env.GUEST_IP_DAY, 40),
    host: env.HOST || '127.0.0.1', port: int(env.PORT, 8787),
    maxBodyBytes: int(env.MAX_BODY_BYTES, 1_000_000), maxTokens: int(env.MAX_TOKENS, 4096),
    timeoutMs: int(env.UPSTREAM_TIMEOUT_MS, 90_000), maxInFlight: int(env.MAX_IN_FLIGHT, upstream === 'auto' ? 60 : 3),   // a burst of kids arrives together; each finishes in about a second, so this is only a runaway guard
    anthropicKey: env.ANTHROPIC_API_KEY || '', anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    anthropicBase: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    geminiKey: env.GEMINI_API_KEY || '', geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    geminiBase: (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, ''),
    qwenBase: (env.QWEN_BASE_URL || '').replace(/\/+$/, ''), qwenModel: env.QWEN_MODEL || '', qwenKey: env.QWEN_API_KEY || '',
  };
  for (const k of ['port', 'maxBodyBytes', 'maxTokens', 'timeoutMs', 'maxInFlight', 'guestGlobalDay', 'guestIpDay', 'autoPrimaryMs', 'autoFallbackMs', 'autoFirstTokenMs', 'maxLocalInFlight', 'geminiRpm', 'geminiTryMs', 'guestGlobalGeminiDay']) if (!Number.isFinite(cfg[k]) || cfg[k] <= 0) errs.push(`${k} must be a positive number`);
  if (errs.length) throw new Error('Configuration problem:\n - ' + errs.join('\n - '));
  return cfg;
}

// ---------- sliding-window limiter (in memory: counters reset when the process restarts) ----------
class Window {
  constructor() { this.hits = new Map(); }
  /** Returns ms until a slot frees if the limit is reached, else 0 (and records nothing). */
  check(key, limit, span, now) {
    if (!limit) return 0;
    const arr = (this.hits.get(key) || []).filter(t => now - t < span);
    this.hits.set(key, arr);
    return arr.length >= limit ? span - (now - arr[0]) : 0;
  }
  add(key, now) { const a = this.hits.get(key) || []; a.push(now); this.hits.set(key, a); }
  remove(key, t) { const a = this.hits.get(key); const i = a ? a.indexOf(t) : -1; if (i >= 0) a.splice(i, 1); }
  sweep(span, now) { for (const [k, a] of this.hits) { const f = a.filter(t => now - t < span); f.length ? this.hits.set(k, f) : this.hits.delete(k); } }
}
function waitText(ms) {
  const m = Math.ceil(ms / 60_000);
  if (m < 90) return `about ${Math.max(m, 1)} minute${m === 1 ? '' : 's'}`;
  return `about ${Math.ceil(m / 60)} hours`;
}

// ---------- upstream calls ----------
function toOpenAi(system, msgs, cfg) {
  return {
    // The local model is a thinking model: left alone it spends its whole token budget reasoning before it writes a word.
    model: cfg.qwenModel, stream: false, temperature: 0.4, max_tokens: cfg.maxTokens, reasoning_effort: 'none',
    messages: [{ role: 'system', content: system }, ...msgs.map(m => ({ role: m.role, content: m.image
      ? [{ type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.base64}` } }, { type: 'text', text: m.text }]
      : m.text }))],
  };
}
async function callUpstream(cfg, which, system, msgs, signal, opts = {}) {
  let url, headers = { 'content-type': 'application/json' }, body, pick;
  if (which === 'anthropic') {
    url = `${cfg.anthropicBase}/v1/messages`;
    headers['x-api-key'] = cfg.anthropicKey; headers['anthropic-version'] = '2023-06-01';
    body = { model: cfg.anthropicModel, max_tokens: cfg.maxTokens, system, messages: msgs.map(m => ({ role: m.role, content: m.image
      ? [{ type: 'image', source: { type: 'base64', media_type: m.image.mime, data: m.image.base64 } }, { type: 'text', text: m.text }]
      : m.text })) };
    pick = j => (j.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('');
  } else if (which === 'gemini') {
    url = `${cfg.geminiBase}/v1beta/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`;
    headers['x-goog-api-key'] = cfg.geminiKey;
    body = { systemInstruction: { parts: [{ text: system }] },
      contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [
        ...(m.image ? [{ inlineData: { mimeType: m.image.mime, data: m.image.base64 } }] : []), { text: m.text }] })),
      generationConfig: { maxOutputTokens: cfg.maxTokens, responseMimeType: 'application/json' } };
    pick = j => (j.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('');
  } else {
    url = `${cfg.qwenBase}/chat/completions`;
    if (cfg.qwenKey) headers.authorization = `Bearer ${cfg.qwenKey}`;
    body = toOpenAi(system, msgs, cfg);
    pick = j => j.choices?.[0]?.message?.content ?? '';
  }
  // One quick retry when the AI says it is overloaded or hiccuping (5xx); stays inside the overall timeout.
  let r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (r.status >= 500 && !signal.aborted && opts.retry5xx !== false) {
    await r.arrayBuffer().catch(() => {});
    await new Promise(res => setTimeout(res, 1500));
    r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  }
  if (!r.ok) { const errText = await r.text().catch(() => ''); return { status: r.status, info: which === 'gemini' ? parseGeminiError(errText) : undefined }; } // upstream text is never forwarded or logged
  return { text: pick(await r.json()) };
}

/** What Google's refusal tells us, without keeping any of its text: how long to wait, and whether the DAY allowance is gone. */
function parseGeminiError(text) {
  try {
    const details = Array.isArray(JSON.parse(text)?.error?.details) ? JSON.parse(text).error.details : [];
    let retryMs, daily = false;
    for (const d of details) {
      const m = typeof d?.retryDelay === 'string' && d.retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
      if (m) retryMs = Math.ceil(Number(m[1]) * 1000);
      for (const v of Array.isArray(d?.violations) ? d.violations : []) if (/PerDay/i.test(String(v?.quotaId))) daily = true;
    }
    return { retryMs, daily };
  } catch { return {}; }
}
/** Google's daily counts reset at midnight Pacific time. */
function msUntilPacificMidnight() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]));
  const secs = (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return Math.min(86_400_000, (86_400 - secs) * 1000 + 5000);
}

/** Ask the local AI in streaming mode so we can tell "slow to start" (busy, cold, or the Mac went silent) from "working".
 *  No first token within firstMs, or the whole answer not done within totalMs, throws AbortError and the caller falls back to Gemini.
 *  Thinking tokens count as progress. Malformed lines are ignored. An empty stream is a failure, not an empty answer. */
async function callLocalStreaming(cfg, system, msgs, { firstMs, totalMs }) {
  const ac = new AbortController();
  const firstTimer = setTimeout(() => ac.abort(), firstMs), totalTimer = setTimeout(() => ac.abort(), totalMs);
  try {
    const headers = { 'content-type': 'application/json' }; if (cfg.qwenKey) headers.authorization = `Bearer ${cfg.qwenKey}`;
    const r = await fetch(`${cfg.qwenBase}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ ...toOpenAi(system, msgs, cfg), stream: true }), signal: ac.signal });
    if (!r.ok) { await r.arrayBuffer().catch(() => {}); return { status: r.status }; }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '', alive = false;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim(); if (!data || data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        const d = j?.choices?.[0]?.delta; if (!d || typeof d !== 'object') continue;
        const think = d.reasoning ?? d.reasoning_content;
        if (!alive && ((typeof d.content === 'string' && d.content) || (typeof think === 'string' && think))) { alive = true; clearTimeout(firstTimer); }
        if (typeof d.content === 'string') text += d.content;
      }
    }
    if (!text) return { status: 502 };                   // it said nothing useful: count as a failure so Gemini takes over
    return { text };
  } finally { clearTimeout(firstTimer); clearTimeout(totalTimer); }
}

// ---------- request validation ----------
function validate(b, cfg) {
  if (!b || typeof b !== 'object' || typeof b.system !== 'string' || !Array.isArray(b.messages)) return 'Request must have a system string and a messages list.';
  let chars = b.system.length;
  if (b.messages.length < 1 || b.messages.length > 40) return 'Messages must have between 1 and 40 entries.';
  const msgs = [];
  for (const m of b.messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string') return 'Each message needs a role (user or assistant) and text.';
    let image;
    if (m.image !== undefined) {
      if (!m.image || !IMAGE_MIMES.has(m.image.mime) || typeof m.image.base64 !== 'string' || !/^[A-Za-z0-9+/=\s]*$/.test(m.image.base64)) return 'The picture is not a supported image.';
      image = { mime: m.image.mime, base64: m.image.base64.replace(/\s+/g, '') };
    }
    chars += m.text.length;
    msgs.push({ role: m.role, text: m.text, ...(image ? { image } : {}) });
  }
  if (chars > MAX_TEXT_CHARS) return 'The request text is too long.';
  return { system: b.system, msgs };
}

/** One bucket per IPv4 address, and per /64 for IPv6 (a single user can hold billions of addresses in a /64). */
export function ipBucket(ip) {
  ip = String(ip).replace(/^::ffff:/i, '').replace(/%.*$/, '');
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail ? tail.split(':') : [];
  const groups = ip.includes('::') ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return groups.slice(0, 4).map(g => (g || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

export function createProxy(cfg, { log = (line) => console.log(line) } = {}) {
  const hourly = new Window(), daily = new Window(), global = new Window(), fails = new Window();
  const salt = crypto.randomBytes(8).toString('hex');
  let inFlight = 0, localInFlight = 0;
  // NOTE: list only genuinely different models. Aliases such as gemini-flash-lite-latest share the quota of the model they point to (measured: Google's
  // refusal named gemini-3.5-flash-lite), so they add no capacity. Bigger models go last: they have their own allowance but are slower and more often overloaded.
  // Gemini free tier allows only ~15 requests/minute PER MODEL, so we spread across several equivalent models, stay under that
  // ourselves, and leave a model alone for a while after Google refuses it.
  const gemCool = new Map();        // model -> time it may be used again
  const gemPace = new Window();     // our own per-model requests-per-minute counter
  async function callGeminiPool(system, msgs) {
    let soonest = Infinity, last;
    for (const m of cfg.geminiModels) {
      const now = Date.now(), cool = gemCool.get(m) || 0;
      if (cool > now) { soonest = Math.min(soonest, cool - now); continue; }
      const wait = gemPace.check('m:' + m, cfg.geminiRpm, 60_000, now);
      if (wait > 0) { soonest = Math.min(soonest, wait); continue; }
      gemPace.add('m:' + m, now);
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), cfg.geminiTryMs);
      let out, err;
      try { out = await callUpstream({ ...cfg, geminiModel: m }, 'gemini', system, msgs, ac.signal, { retry5xx: false }); } catch (e) { err = e; } finally { clearTimeout(t); }
      if (!err && !out.status) return { out, model: m };
      const st = err ? 0 : out.status;
      let ms = 20_000;                                                         // timeout, network error, 5xx: try again soon
      if (st === 404) ms = 3_600_000;                                          // retired, or not offered to this key
      else if (st === 429) ms = out.info?.daily ? msUntilPacificMidnight() : Math.min(Math.max(out.info?.retryMs ?? 60_000, 5_000), 600_000);
      else if (st === 400 || st === 401 || st === 403) ms = 600_000;           // a key or permission problem: do not hammer Google
      gemCool.set(m, Date.now() + ms); soonest = Math.min(soonest, ms); last = { status: st };
    }
    return { exhausted: true, retryMs: Number.isFinite(soonest) ? soonest : 60_000, last };
  }
  // Is the local AI reachable? Cached, so a sleeping Mac costs one quick check, not a wait on every request.
  let pState = { up: true, at: 0 };
  const markPrimary = (up) => { pState = { up, at: Date.now() }; };
  async function primaryUp() {
    if (Date.now() - pState.at < (pState.up ? 20_000 : 15_000)) return pState.up;
    let up = false;
    try { const r = await fetch(new URL('/gateway/health', cfg.qwenBase), { signal: AbortSignal.timeout(2500) }); up = r.status < 500; await r.arrayBuffer().catch(() => {}); } catch { up = false; }
    markPrimary(up); return up;
  }
  const sweeper = setInterval(() => { const n = Date.now(); hourly.sweep(HOUR, n); daily.sweep(DAY, n); global.sweep(DAY, n); fails.sweep(FAIL_SPAN, n); }, 600_000);
  sweeper.unref();

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    let who = '-', ipHash = '-', status = 0, held = false, upNote = '', via = '', modelNote = '';
    const origin = req.headers.origin;
    const send = (code, obj, extra = {}) => {
      status = code;
      const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
      const h = { 'content-type': typeof obj === 'string' ? 'text/plain' : 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra };
      if (origin && cfg.origins.includes(origin)) { h['access-control-allow-origin'] = origin; h.vary = 'Origin'; }
      res.writeHead(code, h); res.end(body);
    };
    res.on('close', () => { if (held) { inFlight--; held = false; } });
    res.on('finish', () => log(`${new Date().toISOString()} ${req.method} ${(req.url || '').split('?')[0]} who=${who} ip=${ipHash} status=${status}${via ? ' via=' + via : ''}${modelNote}${upNote} ms=${Date.now() - t0}`));
    try {
      const path = (req.url || '').split('?')[0];
      const remote = req.socket.remoteAddress || '';
      const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
      const xff = loopback ? String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean).pop() : '';
      const ip = ipBucket(xff || remote);
      ipHash = crypto.createHash('sha256').update(salt + ip).digest('hex').slice(0, 10);

      if (path === '/healthz' && req.method === 'GET') return send(200, 'ok');
      if (path !== '/v1/ai') return send(404, { error: 'Not found.' });
      if (origin && !cfg.origins.includes(origin)) return send(403, { error: 'This website is not allowed to use the shared AI.' });
      if (req.method === 'OPTIONS') {
        return send(204, '', { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-dbb-passcode, x-dbb-guest, x-dbb-prefer', 'access-control-max-age': '600' });
      }
      if (req.method !== 'POST') return send(405, { error: 'Use POST.' }, { allow: 'POST, OPTIONS' });

      // who is calling: a passcode holder (family), or - when OPEN_ACCESS=1 - a guest using the real website
      const code = String(req.headers['x-dbb-passcode'] || '');
      const nowAuth = Date.now();
      let guest = false, gid = '';
      if (code === '') {
        if (!(cfg.openAccess && origin)) return send(401, { error: 'This needs a passcode. Ask whoever shared the site with you for the link.' });
        guest = true; who = 'guest';
        const g = String(req.headers['x-dbb-guest'] || '');
        gid = /^[A-Za-z0-9_-]{16,64}$/.test(g) ? g : '';   // one random id per browser, so kids in one house each get their own allowance
      } else {
        // passcode (constant time, checks every entry); wrong guesses are throttled per connection
        if (fails.check('i:' + ipHash, FAIL_LIMIT, FAIL_SPAN, nowAuth) > 0) return send(429, { error: 'Too many wrong passcodes from this connection. Please wait a few minutes and try again.' }, { 'retry-after': '600' });
        const given = crypto.createHash('sha256').update(code).digest();
        let match = null;
        for (const p of cfg.passcodes) if (crypto.timingSafeEqual(p.hash, given) && !match) match = p;
        if (!match) { fails.add('i:' + ipHash, nowAuth); return send(401, { error: 'That passcode is not right. Check it and try again.' }); }
        who = match.name;
      }

      if (Number(req.headers['content-length'] || 0) > cfg.maxBodyBytes) { req.resume(); return send(413, { error: 'That request is too large (limit about 1 MB, pictures included). Try a smaller picture.' }); }

      // limits: checked AND reserved in one synchronous step (no await in between), so concurrent requests cannot overshoot.
      // The reservation is handed back if the request turns out to be invalid or the AI fails (see refund()).
      const now = Date.now(), primary = cfg.upstream === 'auto' ? (cfg.autoPrimary === 'gemini' ? 'gemini' : 'qwen') : cfg.upstream;   // limits follow the AI that normally answers
      // The checks for one AI. pfx keeps the Gemini backup's counters separate from the main AI's.
      const buildChecks = (u, pfx) => guest ? [
        [global, pfx + 'guest-all', pfx ? cfg.guestGlobalGeminiDay : cfg.guestGlobalDay, DAY, 'All of today\'s free builds for everyone are used up'],
        ...(gid ? [[daily, pfx + 'g:' + gid, cfg.perDay[u], DAY, 'You have used all of your free builds for today']] : []),
        [daily, pfx + 'i:' + ipHash, gid ? cfg.guestIpDay : cfg.perDay[u], DAY, 'This internet connection has used up its free builds for today'],
        ...(gid ? [[hourly, pfx + 'g:' + gid, cfg.perHour[u], HOUR, 'You are going a little fast']] : []),
        [hourly, pfx + 'i:' + ipHash, cfg.perHour[u], HOUR, 'This connection is going a little fast'],
      ] : [
        [global, pfx + 'all', cfg.globalDay[u], DAY, 'Everyone together has used today\'s shared AI allowance'],
        [daily, pfx + 'n:' + who, cfg.perDay[u], DAY, 'You have used your shared AI allowance for today'],
        [daily, pfx + 'i:' + ipHash, cfg.perDay[u], DAY, 'This connection has used its shared AI allowance for today'],
        [hourly, pfx + 'n:' + who, cfg.perHour[u], HOUR, 'You are going a little fast'],
        [hourly, pfx + 'i:' + ipHash, cfg.perHour[u], HOUR, 'This connection is going a little fast'],
      ];
      /** Check and reserve in one synchronous step. Returns { ok:true, undo } or { ok:false, msg, wait }. */
      const reserve = (checks, at) => {
        for (const [w, key, limit, span, msg] of checks) { const wait = w.check(key, limit, span, at); if (wait > 0) return { ok: false, msg, wait }; }
        const taken = checks.filter(c => c[2]);
        for (const [w, key] of taken) w.add(key, at);
        return { ok: true, undo: () => { for (const [w, key] of taken) w.remove(key, at); } };
      };
      const first = reserve(buildChecks(primary, ''), now);
      if (!first.ok) return send(429, { error: `${first.msg}. Please try again in ${waitText(first.wait)}.` }, { 'retry-after': String(Math.ceil(first.wait / 1000)) });
      if (inFlight >= cfg.maxInFlight) { first.undo(); return send(429, { error: 'The shared AI is busy right now. Please try again in a minute.' }, { 'retry-after': '30' }); }
      inFlight++; held = true;
      const refund = first.undo;

      // body
      const chunks = []; let size = 0, tooBig = false;
      for await (const c of req) { size += c.length; if (size > cfg.maxBodyBytes) { tooBig = true; break; } chunks.push(c); }
      if (tooBig) { refund(); req.destroy(); return send(413, { error: 'That request is too large (limit about 1 MB, pictures included). Try a smaller picture.' }); }
      let parsed; try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refund(); return send(400, { error: 'The request was not valid JSON.' }); }
      const v = validate(parsed, cfg);
      if (typeof v === 'string') { refund(); return send(400, { error: v }); }

      const callOne = async (which, ms) => {
        const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
        try { return await callUpstream(cfg, which, v.system, v.msgs, ac.signal); } finally { clearTimeout(t); }
      };
      // A person who picked Gemini in the app (and has no key of their own) asks for it by name: skip the Mac entirely.
      const preferGemini = cfg.upstream === 'auto' && String(req.headers['x-dbb-prefer'] || '') === 'gemini';
      let out, err, undoFallback = () => {}, used = primary;
      const runLocal = async () => {                       // the Mac: only a couple at once, must start answering quickly
        if (localInFlight >= cfg.maxLocalInFlight) return;
        localInFlight++;                                   // the slot is taken BEFORE any await
        try {
          if (await primaryUp()) {
            try { out = await callLocalStreaming(cfg, v.system, v.msgs, { firstMs: cfg.autoFirstTokenMs, totalMs: cfg.autoPrimaryMs }); } catch (e) { err = e; }
            if (err || out.status) markPrimary(false);
          }
        } finally { localInFlight--; }
      };
      let poolWait = 0;
      if (cfg.upstream === 'auto' && cfg.autoPrimary === 'gemini') {
        // GEMINI FIRST: a pool of Gemini models, paced under Google's limits. The Mac is the safety net if Gemini is unavailable.
        const r = await callGeminiPool(v.system, v.msgs);
        if (r.out) { out = r.out; used = 'gemini'; modelNote = ' m=' + r.model; }
        else {
          poolWait = r.retryMs; upNote = r.last?.status === 401 || r.last?.status === 403 || r.last?.status === 400 ? ` up=gemini-key-${r.last.status}` : ' up=gemini-pool-exhausted';
          const fb = reserve(buildChecks('qwen', 'L:'), Date.now());
          if (fb.ok) {
            await runLocal();
            if (!err && out && !out.status) { refund(); undoFallback = () => {}; used = 'qwen'; }          // the Mac answered: Gemini allowance is not spent
            else { fb.undo(); out = undefined; err = undefined; }
          }
          if (!out) { refund(); const secs = Math.max(5, Math.ceil(poolWait / 1000)); return send(429, { error: `Lots of people are building right now, and the free AI needs a short rest. Please try again in about ${secs < 90 ? secs + ' seconds' : waitText(poolWait)}.` }, { 'retry-after': String(Math.min(secs, 600)) }); }
        }
      } else if (cfg.upstream === 'auto') {
        // LOCAL FIRST: the Mac, then Gemini (the pool) when it is off, slow, or failing
        if (!preferGemini) await runLocal();
        if (err || !out || out.status) {
          upNote = preferGemini ? ' up=chose-gemini' : err ? ` up=${err.name === 'AbortError' ? 'timeout' : 'neterr'}` : out ? ` up=${out.status}` : ' up=down';
          const fb = reserve(buildChecks('gemini', 'G:'), Date.now());
          if (!fb.ok) { refund(); return send(429, { error: preferGemini ? `${fb.msg}. Please try again in ${waitText(fb.wait)}.` : `The main AI is resting right now and today's backup allowance is used up (${fb.msg.charAt(0).toLowerCase() + fb.msg.slice(1)}). Please try again in ${waitText(fb.wait)}.` }, { 'retry-after': String(Math.ceil(fb.wait / 1000)) }); }
          undoFallback = fb.undo; used = 'gemini'; err = undefined; out = undefined;
          const r = await callGeminiPool(v.system, v.msgs);
          if (r.out) { out = r.out; modelNote = ' m=' + r.model; refund(); }                // Gemini answered, so the main AI's allowance is not spent
          else out = { status: 429 };
        }
      } else { try { out = await callOne(cfg.upstream, cfg.timeoutMs); } catch (e) { err = e; } }
      if (err || out.status) {
        refund(); undoFallback();
        if (err) {
          upNote = ` up=${err.name === 'AbortError' ? 'timeout' : 'neterr:' + String(err?.cause?.code || err?.name || 'unknown').slice(0, 30)}`;
          if (err.name === 'AbortError') return send(504, { error: 'The AI took too long to answer. Please try again.' });
          return send(502, { error: 'The shared server could not reach the AI. Please try again in a moment.' });
        }
        upNote = upNote || ` up=${out.status}`;
        return send(502, { error: out.status === 429 ? 'The AI behind the shared server is busy or out of quota. Please try again later.' : 'The AI behind the shared server had a problem. Please try again in a moment.' });
      }
      via = used; if (used === primary && cfg.upstream === 'auto' && cfg.autoPrimary !== 'gemini') markPrimary(true);
      return send(200, { text: out.text });
    } catch {
      if (!res.headersSent) send(500, { error: 'Something went wrong on the shared server.' });
    }
  });
  server.requestTimeout = 120_000; server.headersTimeout = 20_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let cfg;
  try { cfg = loadConfig(process.env); } catch (e) { console.error(e.message); process.exit(1); }
  createProxy(cfg).listen(cfg.port, cfg.host, () =>
    console.log(`dbb-proxy listening on ${cfg.host}:${cfg.port} upstream=${cfg.upstream} openAccess=${cfg.openAccess} origins=${cfg.origins.join(',')} perDay=${cfg.perDay[cfg.upstream === 'auto' ? 'qwen' : cfg.upstream]} globalDay=${cfg.globalDay[cfg.upstream === 'auto' ? 'qwen' : cfg.upstream]}`));
}
