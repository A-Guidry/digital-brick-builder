import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadConfig, createProxy, ipBucket } from './proxy.mjs';

const SITE = 'https://brickbuilder.arcwel.ai';
const SECRET_KEY = 'sk-test-SECRET-KEY-123', CODE = 'friend-code-ABCDEF';

/** Fake upstream that answers in each provider's format and records what it was sent. */
async function startUpstream(mode = 'ok') {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      seen.push({ url: req.url, headers: req.headers, body });
      if (mode === 'error') { res.writeHead(500, { 'content-type': 'text/plain' }); return res.end('upstream says ' + SECRET_KEY); }
      if (mode === 'flaky') { if (seen.length === 1) { res.writeHead(503); return res.end('busy'); } }
      if (mode === 'quota') { res.writeHead(429); return res.end('quota'); }
      if (mode === 'hang') return; // never answer
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.includes('/v1/messages')) res.end(JSON.stringify({ content: [{ type: 'text', text: 'anthropic-reply' }] }));
      else if (req.url.includes(':generateContent')) res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini-reply' }] } }] }));
      else res.end(JSON.stringify({ choices: [{ message: { content: 'qwen-reply' } }] }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { seen, url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}

async function start(env = {}, upstreamMode = 'ok') {
  const up = await startUpstream(upstreamMode);
  const logs = [];
  const cfg = loadConfig({
    UPSTREAM: 'qwen', PASSCODES: `ann:${CODE},bob:other-code-123456`, ALLOWED_ORIGINS: SITE,
    QWEN_BASE_URL: up.url + '/v1', QWEN_MODEL: 'qwen-test', ANTHROPIC_API_KEY: SECRET_KEY, GEMINI_API_KEY: SECRET_KEY,
    ANTHROPIC_BASE_URL: up.url, GEMINI_BASE_URL: up.url, PORT: '8787', ...env,
  });
  const proxy = createProxy(cfg, { log: l => logs.push(l) });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const post = (body, { code = CODE, origin = SITE, headers = {} } = {}) => fetch(base + '/v1/ai', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(code ? { 'x-dbb-passcode': code } : {}), ...(origin ? { origin } : {}), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { base, post, up, logs, cfg, close: async () => { proxy.closeAllConnections?.(); await new Promise(r => proxy.close(r)); await up.close(); } };
}
const REQ = { system: 'sys', messages: [{ role: 'user', text: 'a small red house' }] };

test('good request returns text for each upstream and maps the provider format', async () => {
  for (const [u, reply] of [['qwen', 'qwen-reply'], ['gemini', 'gemini-reply'], ['anthropic', 'anthropic-reply']]) {
    const s = await start({ UPSTREAM: u });
    const r = await s.post(REQ);
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { text: reply });
    assert.equal(r.headers.get('access-control-allow-origin'), SITE);
    await s.close();
  }
});

test('healthz needs no passcode and makes no upstream call', async () => {
  const s = await start();
  const r = await fetch(s.base + '/healthz');
  assert.equal(r.status, 200); assert.equal(await r.text(), 'ok'); assert.equal(s.up.seen.length, 0);
  await s.close();
});

test('missing or wrong passcode gives 401 and never reaches the upstream', async () => {
  const s = await start();
  assert.equal((await s.post(REQ, { code: '' })).status, 401);
  const r = await s.post(REQ, { code: 'nope' });
  assert.equal(r.status, 401); assert.match((await r.json()).error, /passcode/);
  assert.equal(s.up.seen.length, 0);
  await s.close();
});

test('wrong origin is refused and gets no CORS header; preflight honours the allow-list', async () => {
  const s = await start();
  const bad = await s.post(REQ, { origin: 'https://evil.example' });
  assert.equal(bad.status, 403); assert.equal(bad.headers.get('access-control-allow-origin'), null);
  const ok = await fetch(s.base + '/v1/ai', { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST' } });
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
  assert.match(ok.headers.get('access-control-allow-headers'), /x-dbb-passcode/);
  const badPre = await fetch(s.base + '/v1/ai', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(badPre.status, 403);
  await s.close();
});

test('wildcard origin is rejected at startup; localhost only with ALLOW_LOCALHOST=1', async () => {
  assert.throws(() => loadConfig({ UPSTREAM: 'qwen', PASSCODES: 'a:bbbbbbbbbbbbbbbb', ALLOWED_ORIGINS: '*', QWEN_BASE_URL: 'x', QWEN_MODEL: 'm' }), /must not contain \*/);
  const s = await start();
  assert.equal((await s.post(REQ, { origin: 'http://localhost:5173' })).status, 403); await s.close();
  const s2 = await start({ ALLOW_LOCALHOST: '1' });
  assert.equal((await s2.post(REQ, { origin: 'http://localhost:5173' })).status, 200); await s2.close();
});

test('daily per-person limit returns 429 with Retry-After and a friendly message', async () => {
  const s = await start({ LIMIT_DAY: 'qwen:2' });
  assert.equal((await s.post(REQ)).status, 200); assert.equal((await s.post(REQ)).status, 200);
  const r = await s.post(REQ);
  assert.equal(r.status, 429);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  assert.match((await r.json()).error, /try again in about \d+ hours?/);
  assert.equal(s.up.seen.length, 2);
  await s.close();
});

test('default limits depend on the upstream (qwen 60/day, gemini 10/day)', () => {
  const base = { PASSCODES: 'a:bbbbbbbbbbbbbbbb', ALLOWED_ORIGINS: SITE, QWEN_BASE_URL: 'x', QWEN_MODEL: 'm', GEMINI_API_KEY: 'k' };
  assert.equal(loadConfig({ ...base, UPSTREAM: 'qwen' }).perDay.qwen, 60);
  assert.equal(loadConfig({ ...base, UPSTREAM: 'gemini' }).perDay.gemini, 10);
});

test('hourly limit applies when set', async () => {
  const s = await start({ LIMIT_HOUR: 'qwen:1' });
  assert.equal((await s.post(REQ)).status, 200);
  const r = await s.post(REQ);
  assert.equal(r.status, 429); assert.match((await r.json()).error, /minute/);
  await s.close();
});

test('global daily cap applies across different people', async () => {
  const s = await start({ LIMIT_GLOBAL_DAY: 'qwen:2' });
  assert.equal((await s.post(REQ, { code: CODE })).status, 200);
  assert.equal((await s.post(REQ, { code: 'other-code-123456' })).status, 200);
  const r = await s.post(REQ, { code: CODE });
  assert.equal(r.status, 429); assert.match((await r.json()).error, /Everyone together/);
  await s.close();
});

test('per-person buckets are separate by passcode name when IPs differ (trusted X-Forwarded-For from loopback)', async () => {
  const s = await start({ LIMIT_DAY: 'qwen:1' });
  assert.equal((await s.post(REQ, { headers: { 'x-forwarded-for': '203.0.113.1' } })).status, 200);
  assert.equal((await s.post(REQ, { code: 'other-code-123456', headers: { 'x-forwarded-for': '203.0.113.2' } })).status, 200);
  assert.equal((await s.post(REQ, { headers: { 'x-forwarded-for': '203.0.113.3' } })).status, 429); // same name, new IP: still blocked
  assert.equal((await s.post(REQ, { code: 'other-code-123456', headers: { 'x-forwarded-for': '203.0.113.2' } })).status, 429);
  await s.close();
});

test('per-IP limit also applies when the passcode name changes', async () => {
  const s = await start({ LIMIT_DAY: 'qwen:1' });
  assert.equal((await s.post(REQ, { headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 200);
  assert.equal((await s.post(REQ, { code: 'other-code-123456', headers: { 'x-forwarded-for': '203.0.113.9' } })).status, 429);
  await s.close();
});

test('oversize body is rejected with 413 (declared and streamed)', async () => {
  const s = await start({ MAX_BODY_BYTES: '2000' });
  const big = { system: 'x'.repeat(5000), messages: REQ.messages };
  assert.equal((await s.post(big)).status, 413);
  assert.equal(s.up.seen.length, 0);
  await s.close();
});

test('bad shapes are rejected with 400', async () => {
  const s = await start();
  assert.equal((await s.post('not json')).status, 400);
  assert.equal((await s.post({ system: 'a' })).status, 400);
  assert.equal((await s.post({ system: 'a', messages: [{ role: 'system', text: 'x' }] })).status, 400);
  assert.equal((await s.post({ system: 'a', messages: [{ role: 'user', text: 'x', image: { mime: 'text/html', base64: 'AAAA' } }] })).status, 400);
  await s.close();
});

test('upstream failures map to 502 and the upstream body (which holds a key) is never returned', async () => {
  const s = await start({}, 'error');
  const r = await s.post(REQ); const text = await r.text();
  assert.equal(r.status, 502); assert.ok(!text.includes(SECRET_KEY));
  await s.close();
  const q = await start({}, 'quota');
  const r2 = await q.post(REQ); assert.equal(r2.status, 502); assert.match((await r2.json()).error, /busy or out of quota/);
  await q.close();
});

test('upstream timeout maps to 504', async () => {
  const s = await start({ UPSTREAM_TIMEOUT_MS: '150' }, 'hang');
  const r = await s.post(REQ); assert.equal(r.status, 504);
  await s.close();
});

test('concurrency cap returns 429 when too many are in flight', async () => {
  const s = await start({ MAX_IN_FLIGHT: '1', UPSTREAM_TIMEOUT_MS: '600' }, 'hang');
  const first = s.post(REQ);
  await new Promise(r => setTimeout(r, 100));
  const second = await s.post(REQ, { headers: { 'x-forwarded-for': '203.0.113.50' } });
  assert.equal(second.status, 429); assert.match((await second.json()).error, /busy/);
  await first.catch(() => {});
  await s.close();
});

test('max_tokens is clamped server-side whatever the client asks', async () => {
  const s = await start({ MAX_TOKENS: '777' });
  await s.post({ ...REQ, max_tokens: 999999, maxTokens: 999999 });
  assert.equal(s.up.seen[0].body.max_tokens, 777); await s.close();
  const a = await start({ UPSTREAM: 'anthropic', MAX_TOKENS: '777' });
  await a.post({ ...REQ, max_tokens: 999999 }); assert.equal(a.up.seen[0].body.max_tokens, 777); await a.close();
  const g = await start({ UPSTREAM: 'gemini', MAX_TOKENS: '777' });
  await g.post({ ...REQ, max_tokens: 999999 }); assert.equal(g.up.seen[0].body.generationConfig.maxOutputTokens, 777); await g.close();
});

test('images pass through to each provider in that provider\'s format; the client cannot choose the model', async () => {
  const body = { ...REQ, model: 'attacker-model', messages: [{ role: 'user', text: 'what is this', image: { mime: 'image/png', base64: 'iVBORw0KGgo=' } }] };
  const q = await start(); await q.post(body);
  assert.equal(q.up.seen[0].body.model, 'qwen-test');
  assert.equal(q.up.seen[0].body.messages[1].content[0].image_url.url, 'data:image/png;base64,iVBORw0KGgo='); await q.close();
  const a = await start({ UPSTREAM: 'anthropic' }); await a.post(body);
  assert.equal(a.up.seen[0].body.model, 'claude-sonnet-4-5');
  assert.equal(a.up.seen[0].body.messages[0].content[0].source.data, 'iVBORw0KGgo='); assert.equal(a.up.seen[0].headers['x-api-key'], SECRET_KEY); await a.close();
  const g = await start({ UPSTREAM: 'gemini' }); await g.post(body);
  assert.equal(g.up.seen[0].body.contents[0].parts[0].inlineData.data, 'iVBORw0KGgo='); assert.equal(g.up.seen[0].headers['x-goog-api-key'], SECRET_KEY); await g.close();
});

test('logs never contain prompts, passcodes, keys or raw IPs; one line per request', async () => {
  const s = await start();
  await s.post({ system: 'SECRET-SYSTEM', messages: [{ role: 'user', text: 'SECRET-PROMPT' }] }, { headers: { 'x-forwarded-for': '198.51.100.77' } });
  await s.post(REQ, { code: 'WRONG-CODE-XYZ' });
  await new Promise(r => setTimeout(r, 50));
  const all = s.logs.join('\n');
  for (const bad of ['SECRET-SYSTEM', 'SECRET-PROMPT', CODE, 'WRONG-CODE-XYZ', SECRET_KEY, '198.51.100.77']) assert.ok(!all.includes(bad), `log leaked ${bad}`);
  assert.equal(s.logs.length, 2); assert.match(s.logs[0], /who=ann ip=[0-9a-f]{10} status=200 via=qwen ms=\d+/);
  await s.close();
});

test('startup fails loudly for missing config and never echoes secret values', () => {
  assert.throws(() => loadConfig({}), /UPSTREAM is required[\s\S]*PASSCODES is required/);
  assert.throws(() => loadConfig({ UPSTREAM: 'gemini', PASSCODES: 'a:bbbbbbbbbbbbbbbb', ALLOWED_ORIGINS: SITE }), /GEMINI_API_KEY is required/);
  try { loadConfig({ UPSTREAM: 'bogus', PASSCODES: 'a:topsecretcode-long-enough', ALLOWED_ORIGINS: SITE }); } catch (e) { assert.ok(!e.message.includes('topsecretcode')); }
});

test('limits are reserved before the body is read, so slow parallel requests cannot overshoot', async () => {
  const s = await start({ LIMIT_DAY: 'qwen:2', MAX_IN_FLIGHT: '10' });
  const url = new URL(s.base);
  const slow = () => new Promise(resolve => {
    const r = http.request({ host: url.hostname, port: url.port, path: '/v1/ai', method: 'POST', headers: { 'content-type': 'application/json', 'x-dbb-passcode': CODE, origin: SITE, 'content-length': '500' } }, res => { res.resume(); resolve(res.statusCode); });
    r.write('{'); // body never completes
    setTimeout(() => r.destroy(), 800); r.on('error', () => resolve('closed'));
  });
  const results = await Promise.all([slow(), slow(), slow(), slow(), slow()]);
  assert.equal(results.filter(x => x === 429).length, 3, JSON.stringify(results));
  await s.close();
});

test('an invalid request gives its allowance back; so does an upstream failure', async () => {
  const s = await start({ LIMIT_DAY: 'qwen:1' });
  assert.equal((await s.post('not json')).status, 400);
  assert.equal((await s.post({ system: 'a' })).status, 400);
  assert.equal((await s.post(REQ)).status, 200); // still had its one
  await s.close();
  const e = await start({ LIMIT_DAY: 'qwen:1' }, 'error');
  assert.equal((await e.post(REQ)).status, 502);
  assert.equal((await e.post(REQ)).status, 502); // not 429: the failed one was refunded
  await e.close();
});

test('wrong passcodes are throttled per connection (brute-force guard), correct ones still work from other connections', async () => {
  const s = await start();
  const h = { 'x-forwarded-for': '203.0.113.200' };
  for (let i = 0; i < 10; i++) assert.equal((await s.post(REQ, { code: 'guess-' + i + '-xxxxxxxxxxxx', headers: h })).status, 401);
  const blocked = await s.post(REQ, { code: CODE, headers: h });
  assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '600');
  assert.equal((await s.post(REQ, { headers: { 'x-forwarded-for': '203.0.113.201' } })).status, 200);
  await s.close();
});

test('passcodes shorter than 16 characters are refused at startup', () => {
  assert.throws(() => loadConfig({ UPSTREAM: 'qwen', PASSCODES: 'a:short', ALLOWED_ORIGINS: SITE, QWEN_BASE_URL: 'x', QWEN_MODEL: 'm' }), /at least 16 characters/);
});

test('total text length is capped independently of pictures', async () => {
  const s = await start({ MAX_BODY_BYTES: '900000' });
  const r = await s.post({ system: 'x'.repeat(200_000), messages: REQ.messages });
  assert.equal(r.status, 400); assert.match((await r.json()).error, /too long/);
  await s.close();
});

test('IPv6 clients share one bucket per /64; IPv4 and mapped addresses are unchanged', () => {
  assert.equal(ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), ipBucket('2001:db8:1:2::1'));
  assert.notEqual(ipBucket('2001:db8:1:2::1'), ipBucket('2001:db8:1:3::1'));
  assert.equal(ipBucket('::ffff:203.0.113.5'), '203.0.113.5');
  assert.equal(ipBucket('203.0.113.5'), '203.0.113.5');
});

test('a single upstream 5xx is retried once and the user still gets an answer', async () => {
  const s = await start({}, 'flaky');
  const r = await s.post(REQ);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { text: 'qwen-reply' });
  assert.equal(s.up.seen.length, 2);
  await s.close();
});

const GID = 'guest-browser-id-0123456789';
test('guest access is OFF by default: no passcode means 401', async () => {
  const s = await start();
  const r = await s.post(REQ, { code: '' }); assert.equal(r.status, 401);
  await s.close();
});
test('guest access ON: the real website works with no passcode and no key', async () => {
  const s = await start({ OPEN_ACCESS: '1' });
  const r = await s.post(REQ, { code: '', headers: { 'x-dbb-guest': GID } });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { text: 'qwen-reply' });
  assert.match(s.logs.join('\n') + '', /./); await s.close();
});
test('guest access needs a browser from an allowed website; a script with no Origin is refused', async () => {
  const s = await start({ OPEN_ACCESS: '1' });
  assert.equal((await s.post(REQ, { code: '', origin: '' })).status, 401);
  assert.equal((await s.post(REQ, { code: '', origin: 'https://evil.example' })).status, 403);
  assert.equal(s.up.seen.length, 0); await s.close();
});
test('each guest browser gets its own daily allowance, even from the same house (same IP)', async () => {
  const s = await start({ OPEN_ACCESS: '1', LIMIT_DAY: 'qwen:2', GUEST_IP_DAY: '10' });
  const as = (id) => s.post(REQ, { code: '', headers: { 'x-dbb-guest': id, 'x-forwarded-for': '203.0.113.7' } });
  assert.equal((await as('kid-one-browser-id-000001')).status, 200); assert.equal((await as('kid-one-browser-id-000001')).status, 200);
  const third = await as('kid-one-browser-id-000001'); assert.equal(third.status, 429); assert.match((await third.json()).error, /free builds for today/);
  assert.equal((await as('kid-two-browser-id-000002')).status, 200);   // a sibling on the same Wi-Fi is not blocked
  await s.close();
});
test('the house (IP) has its own cap, so rotating browser ids does not give unlimited builds', async () => {
  const s = await start({ OPEN_ACCESS: '1', LIMIT_DAY: 'qwen:5', GUEST_IP_DAY: '3' });
  let ok = 0, blocked = 0;
  for (let i = 0; i < 6; i++) { const r = await s.post(REQ, { code: '', headers: { 'x-dbb-guest': 'rotating-browser-id-' + String(i).padStart(4, '0'), 'x-forwarded-for': '203.0.113.9' } }); r.status === 200 ? ok++ : blocked++; }
  assert.equal(ok, 3); assert.equal(blocked, 3); await s.close();
});
test('all guests together have a daily cap, and it never uses up the family allowance', async () => {
  const s = await start({ OPEN_ACCESS: '1', GUEST_GLOBAL_DAY: '2' });
  const g = (n) => s.post(REQ, { code: '', headers: { 'x-dbb-guest': 'global-test-browser-' + String(n).padStart(4, '0'), 'x-forwarded-for': '198.51.100.' + n } });
  assert.equal((await g(1)).status, 200); assert.equal((await g(2)).status, 200);
  const r = await g(3); assert.equal(r.status, 429); assert.match((await r.json()).error, /free builds for everyone are used up/);
  assert.equal((await s.post(REQ, { headers: { 'x-forwarded-for': '198.51.100.99' } })).status, 200);   // family passcode still works
  await s.close();
});
test('a WRONG passcode is still refused even with guest access on; a guest id alone cannot fake a passcode', async () => {
  const s = await start({ OPEN_ACCESS: '1' });
  assert.equal((await s.post(REQ, { code: 'not-the-passcode-123456', headers: { 'x-dbb-guest': GID } })).status, 401);
  await s.close();
});
test('a missing or malformed guest id falls back to the connection limit only', async () => {
  const s = await start({ OPEN_ACCESS: '1', LIMIT_DAY: 'qwen:2' });
  const h = { 'x-forwarded-for': '203.0.113.50' };
  assert.equal((await s.post(REQ, { code: '', headers: h })).status, 200);
  assert.equal((await s.post(REQ, { code: '', headers: { ...h, 'x-dbb-guest': 'short' } })).status, 200);
  assert.equal((await s.post(REQ, { code: '', headers: h })).status, 429);
  await s.close();
});
test('preflight allows the guest header', async () => {
  const s = await start({ OPEN_ACCESS: '1' });
  const r = await fetch(s.base + '/v1/ai', { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-dbb-guest' } });
  assert.match(r.headers.get('access-control-allow-headers'), /x-dbb-guest/);
  await s.close();
});

// ---------- UPSTREAM=auto: local AI first, Gemini as the automatic backup ----------
/** Two fake AIs: the local one (qwen format) and Gemini. mode: ok | error | hang | dead */
async function startAuto({ qwen = 'ok', gemini = 'ok', env = {} } = {}) {
  const q = await startUpstream(qwen === 'dead' ? 'ok' : qwen), g = await startUpstream(gemini);
  if (qwen === 'dead') await q.close();
  const logs = [];
  const cfg = loadConfig({
    UPSTREAM: 'auto', PASSCODES: `ann:${CODE}`, ALLOWED_ORIGINS: SITE, OPEN_ACCESS: '1',
    QWEN_BASE_URL: q.url + '/v1', QWEN_MODEL: 'qwen-test', GEMINI_API_KEY: SECRET_KEY, GEMINI_BASE_URL: g.url,
    AUTO_PRIMARY_TIMEOUT_MS: '400', AUTO_FALLBACK_TIMEOUT_MS: '2000', ...env,
  });
  const proxy = createProxy(cfg, { log: l => logs.push(l) });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${proxy.address().port}`;
  const post = (headers = {}) => fetch(base + '/v1/ai', { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'x-dbb-passcode': CODE, ...headers }, body: JSON.stringify(REQ) });
  return { post, q, g, logs, close: async () => { proxy.closeAllConnections?.(); await new Promise(r => proxy.close(r)); if (qwen !== 'dead') await q.close(); await g.close(); } };
}
const guestHdr = (n = 1, ip = '203.0.113.1') => ({ 'x-dbb-passcode': '', 'x-dbb-guest': 'auto-test-browser-' + String(n).padStart(4, '0'), 'x-forwarded-for': ip });
const chatCalls = (u) => u.seen.filter(x => x.url.includes('/chat/completions') || x.url.includes(':generateContent')).length;

test('auto: the local AI answers when it is healthy, and Gemini is never called', async () => {
  const s = await startAuto();
  try {
    const r = await s.post(); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { text: 'qwen-reply' });
    assert.equal(chatCalls(s.g), 0); assert.match(s.logs.join('\n'), /via=qwen/);
  } finally { await s.close(); }
});
test('auto: if the local AI is off (Mac asleep), Gemini answers, and later requests skip the dead one quickly', async () => {
  const s = await startAuto({ qwen: 'dead' });
  try {
    const r = await s.post(); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { text: 'gemini-reply' });
    const t1 = Date.now(); const r2 = await s.post(); assert.equal(r2.status, 200);
    assert.ok(Date.now() - t1 < 1500, 'second request should not wait on the dead local AI');
    assert.match(s.logs.join('\n'), /via=gemini/);
  } finally { await s.close(); }
});
test('auto: if the local AI errors, Gemini takes over for that request', async () => {
  const s = await startAuto({ qwen: 'error' });
  try { const r = await s.post(); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { text: 'gemini-reply' }); } finally { await s.close(); }
});
test('auto: if the local AI is too slow, Gemini takes over', async () => {
  const s = await startAuto({ qwen: 'hang' });
  try { const r = await s.post(); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { text: 'gemini-reply' }); } finally { await s.close(); }
});
test('auto: if both fail, the user gets a plain error and no allowance is lost', async () => {
  const s = await startAuto({ qwen: 'error', gemini: 'error', env: { LIMIT_DAY: 'qwen:1,gemini:1' } });
  try {
    const r = await s.post(); assert.equal(r.status, 502); assert.ok(!JSON.stringify(await r.json()).includes(SECRET_KEY));
    assert.equal((await s.post()).status, 502);        // not 429: the failed tries were refunded
  } finally { await s.close(); }
});
test('auto: the Gemini backup has its own smaller daily allowance; a healthy local AI is unaffected by it', async () => {
  const s = await startAuto({ qwen: 'error', env: { LIMIT_DAY: 'qwen:60,gemini:1' } });
  try {
    assert.equal((await s.post()).status, 200);          // falls back to Gemini (1 of 1)
    const r = await s.post(); assert.equal(r.status, 429); assert.match((await r.json()).error, /main AI is resting.*backup allowance/);
  } finally { await s.close(); }
  const ok = await startAuto({ env: { LIMIT_DAY: 'qwen:60,gemini:1' } });
  try { for (let i = 0; i < 4; i++) assert.equal((await ok.post()).status, 200); } finally { await ok.close(); }
});
test('auto: guests (no passcode) get the same local-first behaviour', async () => {
  const s = await startAuto();
  try { const r = await s.post(guestHdr()); assert.equal(r.status, 200); assert.deepEqual(await r.json(), { text: 'qwen-reply' }); } finally { await s.close(); }
  const d = await startAuto({ qwen: 'dead' });
  try { const r2 = await d.post(guestHdr()); assert.equal(r2.status, 200); assert.deepEqual(await r2.json(), { text: 'gemini-reply' }); } finally { await d.close(); }
});
test('auto: guests on the Gemini backup are capped separately and cannot use up the family allowance', async () => {
  const s = await startAuto({ qwen: 'dead', env: { GUEST_GLOBAL_GEMINI_DAY: '2', LIMIT_DAY: 'qwen:60,gemini:50' } });
  try {
    assert.equal((await s.post(guestHdr(1, '198.51.100.1'))).status, 200);
    assert.equal((await s.post(guestHdr(2, '198.51.100.2'))).status, 200);
    const r = await s.post(guestHdr(3, '198.51.100.3')); assert.equal(r.status, 429); assert.match((await r.json()).error, /free builds for everyone are used up/);
    assert.equal((await s.post()).status, 200);          // the family passcode still works
  } finally { await s.close(); }
});
test('auto needs both the local AI and Gemini configured', () => {
  const base = { UPSTREAM: 'auto', PASSCODES: `a:${CODE}`, ALLOWED_ORIGINS: SITE };
  assert.throws(() => loadConfig(base), /QWEN_BASE_URL is required/);
  assert.throws(() => loadConfig(base), /GEMINI_API_KEY is required/);
  assert.doesNotThrow(() => loadConfig({ ...base, QWEN_BASE_URL: 'http://x/v1', QWEN_MODEL: 'm', GEMINI_API_KEY: 'k' }));
});
