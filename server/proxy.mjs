// Digital Brick Builder: shared AI proxy. Node 20+, no dependencies.
// Holds the AI credentials, checks a passcode, rate-limits, and forwards ONE kind of request to ONE upstream
// chosen by the server (UPSTREAM=qwen|gemini|anthropic). The browser never picks the model or the upstream.
import http from 'node:http';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const UPSTREAMS = ['qwen', 'gemini', 'anthropic'];
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
    if (!UPSTREAMS.includes(k) || !Number.isFinite(n) || n < 0) throw new Error(`${what}: bad entry "${part}" (use name:number, names ${UPSTREAMS.join('/')})`);
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
  if (upstream === 'gemini') need('GEMINI_API_KEY');
  if (upstream === 'qwen') { need('QWEN_BASE_URL'); need('QWEN_MODEL'); }
  const cfg = {
    upstream, passcodes, origins, perDay, perHour, globalDay,
    host: env.HOST || '127.0.0.1', port: int(env.PORT, 8787),
    maxBodyBytes: int(env.MAX_BODY_BYTES, 1_000_000), maxTokens: int(env.MAX_TOKENS, 4096),
    timeoutMs: int(env.UPSTREAM_TIMEOUT_MS, 90_000), maxInFlight: int(env.MAX_IN_FLIGHT, 3),
    anthropicKey: env.ANTHROPIC_API_KEY || '', anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    anthropicBase: (env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, ''),
    geminiKey: env.GEMINI_API_KEY || '', geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
    geminiBase: (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').replace(/\/+$/, ''),
    qwenBase: (env.QWEN_BASE_URL || '').replace(/\/+$/, ''), qwenModel: env.QWEN_MODEL || '', qwenKey: env.QWEN_API_KEY || '',
  };
  for (const k of ['port', 'maxBodyBytes', 'maxTokens', 'timeoutMs', 'maxInFlight']) if (!Number.isFinite(cfg[k]) || cfg[k] <= 0) errs.push(`${k} must be a positive number`);
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
    model: cfg.qwenModel, stream: false, temperature: 0.4, max_tokens: cfg.maxTokens,
    messages: [{ role: 'system', content: system }, ...msgs.map(m => ({ role: m.role, content: m.image
      ? [{ type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.base64}` } }, { type: 'text', text: m.text }]
      : m.text }))],
  };
}
async function callUpstream(cfg, system, msgs, signal) {
  let url, headers = { 'content-type': 'application/json' }, body, pick;
  if (cfg.upstream === 'anthropic') {
    url = `${cfg.anthropicBase}/v1/messages`;
    headers['x-api-key'] = cfg.anthropicKey; headers['anthropic-version'] = '2023-06-01';
    body = { model: cfg.anthropicModel, max_tokens: cfg.maxTokens, system, messages: msgs.map(m => ({ role: m.role, content: m.image
      ? [{ type: 'image', source: { type: 'base64', media_type: m.image.mime, data: m.image.base64 } }, { type: 'text', text: m.text }]
      : m.text })) };
    pick = j => (j.content ?? []).filter(c => c.type === 'text').map(c => c.text).join('');
  } else if (cfg.upstream === 'gemini') {
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
  if (r.status >= 500 && !signal.aborted) {
    await r.arrayBuffer().catch(() => {});
    await new Promise(res => setTimeout(res, 1500));
    r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  }
  if (!r.ok) { await r.arrayBuffer().catch(() => {}); return { status: r.status }; } // upstream body is never forwarded or logged
  return { text: pick(await r.json()) };
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
  let inFlight = 0;
  const sweeper = setInterval(() => { const n = Date.now(); hourly.sweep(HOUR, n); daily.sweep(DAY, n); global.sweep(DAY, n); fails.sweep(FAIL_SPAN, n); }, 600_000);
  sweeper.unref();

  const server = http.createServer(async (req, res) => {
    const t0 = Date.now();
    let who = '-', ipHash = '-', status = 0, held = false, upNote = '';
    const origin = req.headers.origin;
    const send = (code, obj, extra = {}) => {
      status = code;
      const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
      const h = { 'content-type': typeof obj === 'string' ? 'text/plain' : 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra };
      if (origin && cfg.origins.includes(origin)) { h['access-control-allow-origin'] = origin; h.vary = 'Origin'; }
      res.writeHead(code, h); res.end(body);
    };
    res.on('close', () => { if (held) { inFlight--; held = false; } });
    res.on('finish', () => log(`${new Date().toISOString()} ${req.method} ${(req.url || '').split('?')[0]} who=${who} ip=${ipHash} status=${status}${upNote} ms=${Date.now() - t0}`));
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
        return send(204, '', { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type, x-dbb-passcode', 'access-control-max-age': '600' });
      }
      if (req.method !== 'POST') return send(405, { error: 'Use POST.' }, { allow: 'POST, OPTIONS' });

      // passcode (constant time, checks every entry); wrong guesses are throttled per connection
      const nowAuth = Date.now();
      if (fails.check('i:' + ipHash, FAIL_LIMIT, FAIL_SPAN, nowAuth) > 0) return send(429, { error: 'Too many wrong passcodes from this connection. Please wait a few minutes and try again.' }, { 'retry-after': '600' });
      const given = crypto.createHash('sha256').update(String(req.headers['x-dbb-passcode'] || '')).digest();
      let match = null;
      for (const p of cfg.passcodes) if (crypto.timingSafeEqual(p.hash, given) && !match) match = p;
      if (!match) { fails.add('i:' + ipHash, nowAuth); return send(401, { error: 'That passcode is not right. Check it and try again.' }); }
      who = match.name;

      if (Number(req.headers['content-length'] || 0) > cfg.maxBodyBytes) { req.resume(); return send(413, { error: 'That request is too large (limit about 1 MB, pictures included). Try a smaller picture.' }); }

      // limits: checked AND reserved in one synchronous step (no await in between), so concurrent requests cannot overshoot.
      // The reservation is handed back if the request turns out to be invalid or the AI fails (see refund()).
      const now = Date.now(), u = cfg.upstream;
      const checks = [
        [global, 'all', cfg.globalDay[u], DAY, 'Everyone together has used today\'s shared AI allowance'],
        [daily, 'n:' + who, cfg.perDay[u], DAY, 'You have used your shared AI allowance for today'],
        [daily, 'i:' + ipHash, cfg.perDay[u], DAY, 'This connection has used its shared AI allowance for today'],
        [hourly, 'n:' + who, cfg.perHour[u], HOUR, 'You are going a little fast'],
        [hourly, 'i:' + ipHash, cfg.perHour[u], HOUR, 'This connection is going a little fast'],
      ];
      for (const [w, key, limit, span, msg] of checks) {
        const wait = w.check(key, limit, span, now);
        if (wait > 0) return send(429, { error: `${msg}. Please try again in ${waitText(wait)}.` }, { 'retry-after': String(Math.ceil(wait / 1000)) });
      }
      if (inFlight >= cfg.maxInFlight) return send(429, { error: 'The shared AI is busy right now. Please try again in a minute.' }, { 'retry-after': '30' });
      hourly.add('n:' + who, now); hourly.add('i:' + ipHash, now);
      daily.add('n:' + who, now); daily.add('i:' + ipHash, now); global.add('all', now);
      inFlight++; held = true;
      const refund = () => {
        hourly.remove('n:' + who, now); hourly.remove('i:' + ipHash, now);
        daily.remove('n:' + who, now); daily.remove('i:' + ipHash, now); global.remove('all', now);
      };

      // body
      const chunks = []; let size = 0, tooBig = false;
      for await (const c of req) { size += c.length; if (size > cfg.maxBodyBytes) { tooBig = true; break; } chunks.push(c); }
      if (tooBig) { refund(); req.destroy(); return send(413, { error: 'That request is too large (limit about 1 MB, pictures included). Try a smaller picture.' }); }
      let parsed; try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refund(); return send(400, { error: 'The request was not valid JSON.' }); }
      const v = validate(parsed, cfg);
      if (typeof v === 'string') { refund(); return send(400, { error: v }); }

      const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
      try {
        const out = await callUpstream(cfg, v.system, v.msgs, ac.signal);
        if (out.status) { upNote = ` up=${out.status}`; refund(); return send(502, { error: out.status === 429 ? 'The AI behind the shared server is busy or out of quota. Please try again later.' : 'The AI behind the shared server had a problem. Please try again in a moment.' }); }
        return send(200, { text: out.text });
      } catch (e) {
        refund(); upNote = ` up=${ac.signal.aborted ? 'timeout' : 'neterr:' + String(e?.cause?.code || e?.name || 'unknown').slice(0, 30)}`;
        if (ac.signal.aborted) return send(504, { error: 'The AI took too long to answer. Please try again.' });
        return send(502, { error: 'The shared server could not reach the AI. Please try again in a moment.' });
      } finally { clearTimeout(timer); }
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
    console.log(`dbb-proxy listening on ${cfg.host}:${cfg.port} upstream=${cfg.upstream} origins=${cfg.origins.join(',')} perDay=${cfg.perDay[cfg.upstream]} globalDay=${cfg.globalDay[cfg.upstream]}`));
}
