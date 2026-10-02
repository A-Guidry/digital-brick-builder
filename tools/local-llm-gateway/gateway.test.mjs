import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadConfig, createGateway, originAllowed } from './gateway.mjs';

const SITE = 'https://brickbuilder.arcwel.ai';
/** Fake Ollama: 403s any request that carries an Origin it does not know (like the real one), streams chat, records what it saw. */
async function fakeOllama() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      seen.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.headers.origin) { res.writeHead(403); return res.end('Forbidden'); }
      if (req.url === '/api/tags') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"models":[]}'); }
      if (req.url === '/v1/stream') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: one\n\n'); setTimeout(() => { res.write('data: two\n\n'); res.end(); }, 80); return; }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': 'http://stale.example' });
      res.end(JSON.stringify({ echo: Buffer.concat(chunks).toString() }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { seen, port: srv.address().port, close: () => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }) };
}
async function start(env = {}, up) {
  const o = up || await fakeOllama(); const logs = [];
  const gw = createGateway(loadConfig({ UPSTREAM: `http://127.0.0.1:${o.port}`, ...env }), { log: l => logs.push(l) });
  await new Promise(r => gw.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${gw.address().port}`, o, logs, close: async () => { gw.closeAllConnections?.(); await new Promise(r => gw.close(r)); if (!up) await o.close(); } };
}

test('a website Origin never reaches Ollama, so Ollama answers instead of 403', async () => {
  const g = await start();
  const r = await fetch(g.base + '/v1/chat/completions', { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' }, body: '{"hi":1}' });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { echo: '{"hi":1}' });
  assert.equal(g.o.seen[0].headers.origin, undefined); assert.equal(g.o.seen[0].headers.referer, undefined);
  await g.close();
});
test('allowed website gets CORS, the stale upstream CORS header is replaced', async () => {
  const g = await start();
  const r = await fetch(g.base + '/v1/models', { headers: { origin: SITE } });
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  await g.close();
});
test('preflight: allowed site gets permission incl. Private Network Access; others are refused', async () => {
  const g = await start();
  const ok = await fetch(g.base + '/v1/chat/completions', { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type', 'access-control-request-private-network': 'true' } });
  assert.equal(ok.status, 204); assert.equal(ok.headers.get('access-control-allow-origin'), SITE);
  assert.equal(ok.headers.get('access-control-allow-private-network'), 'true'); assert.match(ok.headers.get('access-control-allow-headers'), /content-type/);
  const bad = await fetch(g.base + '/v1/chat/completions', { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
  assert.equal(bad.status, 403); assert.equal(bad.headers.get('access-control-allow-origin'), null);
  assert.equal(g.o.seen.length, 0);
  await g.close();
});
test('other websites are refused before anything is forwarded; no-Origin apps and localhost pass', async () => {
  const g = await start();
  assert.equal((await fetch(g.base + '/api/tags', { headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal(g.o.seen.length, 0);
  assert.equal((await fetch(g.base + '/api/tags')).status, 200);
  assert.equal((await fetch(g.base + '/api/tags', { headers: { origin: 'http://localhost:5173' } })).status, 200);
  assert.equal((await fetch(g.base + '/api/tags', { headers: { origin: 'http://127.0.0.1:3000' } })).status, 200);
  await g.close();
});
test('wildcard origin is refused at startup; ALLOW_LOCALHOST=0 turns localhost off', () => {
  assert.throws(() => loadConfig({ ALLOWED_ORIGINS: '*' }), /must not contain \*/);
  assert.equal(originAllowed(loadConfig({ ALLOW_LOCALHOST: '0' }), 'http://localhost:5173'), false);
  assert.equal(originAllowed(loadConfig({}), undefined), true);
});
test('responses stream through instead of being buffered', async () => {
  const g = await start();
  const r = await fetch(g.base + '/v1/stream'); const rd = r.body.getReader(); const t0 = Date.now();
  const first = await rd.read(); const tFirst = Date.now() - t0;
  assert.match(new TextDecoder().decode(first.value), /one/); assert.ok(tFirst < 60, `first chunk took ${tFirst}ms`);
  await rd.cancel(); await g.close();
});
test('health reports the upstream state; a dead Ollama gives a clear 502', async () => {
  const g = await start();
  assert.deepEqual(await (await fetch(g.base + '/gateway/health')).json(), { ok: true, upstream: `http://127.0.0.1:${g.o.port}` });
  await g.close();
  const dead = await start({ UPSTREAM: 'http://127.0.0.1:1' }, { port: 1, seen: [] });
  assert.equal((await fetch(dead.base + '/gateway/health')).status, 503);
  const r = await fetch(dead.base + '/v1/models'); assert.equal(r.status, 502); assert.match((await r.json()).error, /Is Ollama running/);
  await dead.close();
});
test('request bodies pass through unchanged (including large image-sized ones)', async () => {
  const g = await start(); const big = JSON.stringify({ img: 'A'.repeat(3_000_000) });
  const r = await fetch(g.base + '/v1/chat/completions', { method: 'POST', body: big, headers: { 'content-type': 'application/json' } });
  assert.equal((await r.json()).echo.length, big.length);
  await g.close();
});
