// Local LLM gateway. Node 20+, no dependencies.
// Sits in front of the real Ollama on this Mac and makes it usable from browsers and other apps on the tailnet:
//  - removes the website Origin before forwarding, so Ollama stops answering 403 to pages it does not know
//  - answers browser permission checks (CORS + Private Network Access) only for the allowed websites
//  - streams responses straight through (chat streaming works)
//  - optionally keeps one model loaded in memory (WARM_MODEL), so the first request after a quiet spell is not slow
// It adds no password: exposure is controlled by what `tailscale serve` publishes (tailnet only, never public).
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host', 'origin', 'referer', 'content-length']);

export function loadConfig(env) {
  const port = Number(env.PORT || 11436);
  if (!Number.isInteger(port) || port <= 0) throw new Error('PORT must be a positive number');
  const upstream = new URL(env.UPSTREAM || 'http://127.0.0.1:11435');
  const allowed = (env.ALLOWED_ORIGINS || 'https://brickbuilder.arcwel.ai').split(',').map(s => s.trim()).filter(Boolean);
  if (allowed.includes('*')) throw new Error('ALLOWED_ORIGINS must not contain *');
  const warmEvery = Number(env.WARM_EVERY_MS || 240_000);
  if (!Number.isFinite(warmEvery) || warmEvery < 1000) throw new Error('WARM_EVERY_MS must be at least 1000');
  return { port, host: env.HOST || '127.0.0.1', upstream, allowed, localhostOk: env.ALLOW_LOCALHOST !== '0',
    warmModel: (env.WARM_MODEL || '').trim(), warmEvery, warmKeep: env.WARM_KEEP_ALIVE || '30m' };
}

export function originAllowed(cfg, origin) {
  if (!origin) return true;                                   // not a browser (curl, scripts, other servers)
  if (cfg.allowed.includes(origin)) return true;
  return cfg.localhostOk && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

export function createGateway(cfg, { log = () => {} } = {}) {
  return http.createServer((req, res) => {
    const t0 = Date.now(), origin = req.headers.origin;
    const cors = {};
    if (origin && originAllowed(cfg, origin)) {
      cors['access-control-allow-origin'] = origin; cors.vary = 'Origin';
      cors['access-control-expose-headers'] = '*';
    }
    const done = (code) => log(`${new Date().toISOString()} ${req.method} ${(req.url || '').split('?')[0]} status=${code} ms=${Date.now() - t0}${origin ? ' origin=' + origin : ''}`);
    const reply = (code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...cors, ...extra }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); done(code); };

    if (origin && !originAllowed(cfg, origin)) return reply(403, { error: 'This website is not allowed to use this gateway.' });
    if (req.url === '/gateway/health') {
      return probe(cfg).then(ok => reply(ok ? 200 : 503, { ok, upstream: cfg.upstream.origin }), () => reply(503, { ok: false }));
    }
    if (req.method === 'OPTIONS') {
      return reply(204, '', {
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': req.headers['access-control-request-headers'] || 'content-type, authorization',
        'access-control-allow-private-network': 'true', 'access-control-max-age': '600',
      });
    }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k)) headers[k] = v;
    const up = http.request({ host: cfg.upstream.hostname, port: cfg.upstream.port, path: req.url, method: req.method, headers }, ur => {
      const out = {};
      for (const [k, v] of Object.entries(ur.headers)) if (!HOP.has(k) && !k.startsWith('access-control-')) out[k] = v;
      res.writeHead(ur.statusCode || 502, { ...out, ...cors });
      ur.pipe(res); ur.on('end', () => done(ur.statusCode));
    });
    up.on('error', () => { if (!res.headersSent) reply(502, { error: 'The model server on this Mac is not answering. Is Ollama running?' }); else res.destroy(); });
    res.on('close', () => up.destroy());
    req.pipe(up);
  });
}

/** Loads the model now and re-asks every few minutes so Ollama never unloads it. Quiet on failure (Ollama may be restarting). */
export function startWarmer(cfg, { log = () => {} } = {}) {
  if (!cfg.warmModel) return () => {};
  let lastOk = null, stopped = false;
  const ping = () => new Promise(resolve => {
    const body = JSON.stringify({ model: cfg.warmModel, prompt: '', stream: false, keep_alive: cfg.warmKeep });
    const r = http.request({ host: cfg.upstream.hostname, port: cfg.upstream.port, path: '/api/generate', method: 'POST', timeout: 120_000, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, ur => {
      ur.resume(); ur.on('end', () => { const ok = ur.statusCode === 200; if (ok !== lastOk) log(`${new Date().toISOString()} warm ${cfg.warmModel}: ${ok ? 'loaded and kept in memory' : 'failed (status ' + ur.statusCode + ')'}`); lastOk = ok; resolve(); });
    });
    r.on('error', () => { if (lastOk !== false) log(`${new Date().toISOString()} warm ${cfg.warmModel}: Ollama not answering`); lastOk = false; resolve(); });
    r.on('timeout', () => r.destroy());
    r.end(body);
  });
  const timer = setInterval(() => { if (!stopped) void ping(); }, cfg.warmEvery); timer.unref();
  void ping();
  return () => { stopped = true; clearInterval(timer); };
}

function probe(cfg) {
  return new Promise((resolve, reject) => {
    const r = http.get({ host: cfg.upstream.hostname, port: cfg.upstream.port, path: '/api/tags', timeout: 3000 }, ur => { ur.resume(); resolve(ur.statusCode === 200); });
    r.on('error', reject); r.on('timeout', () => { r.destroy(); reject(new Error('timeout')); });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let cfg; try { cfg = loadConfig(process.env); } catch (e) { console.error(e.message); process.exit(1); }
  createGateway(cfg, { log: l => console.log(l) }).listen(cfg.port, cfg.host, () => {
    console.log(`local-llm-gateway ${cfg.host}:${cfg.port} -> ${cfg.upstream.origin}; websites: ${cfg.allowed.join(', ')}${cfg.localhostOk ? ' + localhost' : ''}${cfg.warmModel ? '; keeping ' + cfg.warmModel + ' loaded' : ''}`);
    startWarmer(cfg, { log: l => console.log(l) });
  });
}
