import { chromium } from 'playwright-core';
import fs from 'fs';
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0];
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const url = process.env.URL || 'http://127.0.0.1:5173/';
const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(ok ? 'PASS' : 'FAIL', name, extra); };

async function fresh(settings, viewport = { width: 1440, height: 860 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  if (settings) await page.addInitScript(s => localStorage.setItem('brickforge.settings.v1', JSON.stringify(s)), settings);
  await page.goto(url, { timeout: 120000 });
  await page.waitForFunction(() => !document.querySelector('#stage.busy') && window.__bf?.model, null, { timeout: 40000 });
  return page;
}
const idle = p => p.waitForFunction(() => !document.querySelector('#stage.busy') && !document.querySelector('#go').disabled, null, { timeout: 60000 });
const shot = async (p, n) => { await p.waitForTimeout(600); await p.screenshot({ path: `shots/${n}.png` }); };

const BOAT = { name: 'Boat', shapes: [
  { type: 'box', color: 'blue', center: [0, 1.2, 0], size: [6, 2.4, 14] },
  { type: 'box', color: 'white', center: [0, 3.6, -2], size: [4, 2.4, 5] },
  { type: 'wedge', color: 'blue', center: [0, 1.2, 8.5], size: [6, 2.4, 3], slope: '+z' }] };
const BROKEN = { name: 'Broken', shapes: [
  { type: 'box', color: 'red', center: [-6, 1.2, 0], size: [2, 2.4, 2] },
  { type: 'box', color: 'blue', center: [6, 9, 0], size: [2, 2.4, 2] }] };
const AN = { provider: 'anthropic', anthropicKey: 'sk-ant-TEST', anthropicModel: 'claude-sonnet-4-5' };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
async function mockAnthropic(page, replies, seen) {
  await page.route('https://api.anthropic.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(req.postData()); seen.push({ headers: req.headers(), body });
    const r = replies.length > 1 ? replies.shift() : replies[0];
    if (typeof r === 'number') return route.fulfill({ status: r, headers: cors, contentType: 'application/json', body: '{"error":{"message":"invalid x-api-key"}}' });
    route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(r) + '\n```' }] }) });
  });
}

{ // AI build is saved, survives reload, and can be shared by link
  const seen = []; const p = await fresh(AN); await mockAnthropic(p, [BOAT], seen); p.setDefaultTimeout(120000);
  await p.fill('#prompt', 'a small blue boat'); await p.click('#go'); await idle(p);
  await p.click('.tabs button[data-tab=saved]');
  check('saved: an AI-made build appears under My builds', /My builds \(1\)/i.test(await p.locator('#tab-saved').innerText()) && /Boat/.test(await p.locator('#tab-saved').innerText()));
  await p.reload(); await p.waitForFunction(() => !document.querySelector('#stage.busy') && window.__bf?.model);
  check('saved: reloading re-opens the last build, rebuilt and re-checked', (await p.evaluate(() => window.__bf.model.name)) === 'Boat');
  await p.click('.tabs button[data-tab=saved]'); await p.click('#tab-saved [data-act=share]');
  await p.waitForFunction(() => (document.querySelector('#share-box')?.value || '').length > 10);
  const link = await p.locator('#share-box').inputValue();
  check('share: link contains the build and is short enough to paste', /#s=z\./.test(link) && link.length < 3000, `${link.length} chars`);
  const q = await fresh(null); await q.goto(link, { timeout: 120000 });
  await q.waitForFunction(() => window.__bf?.model?.name === 'Boat' && !document.querySelector('#stage.busy'), null, { timeout: 60000 });
  check('share: opening the link in a fresh browser builds the same model', true);
  await q.click('.tabs button[data-tab=saved]');
  check('share: shared build is kept in the recipient\'s My builds', /Shared with you/i.test(await q.locator('#tab-saved').innerText()));
  check('share: the link is removed from the address bar after opening', !(await q.evaluate(() => location.hash)));
  const bad = await fresh(null); await bad.goto(link.split('#')[0] + '#s=z.@@@@', { timeout: 120000 });
  await bad.waitForFunction(() => window.__bf?.model && !document.querySelector('#stage.busy'));
  await bad.waitForFunction(() => /damaged|not recognised|could not/.test(document.querySelector('#ai-note')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
  check('share: a damaged link falls back to a normal start with a message', /damaged|not recognised|could not/.test(await bad.locator('#ai-note').innerText()));
  // delete needs two clicks
  const still = await p.evaluate(() => { const b = document.querySelector('#tab-saved [data-act=del]'); b.click(); const s = /My builds \(1\)/i.test(document.querySelector('#tab-saved').innerText); document.querySelector('#tab-saved [data-act=del]').click(); return s; });
  console.log('DBG', still, JSON.stringify((await p.locator('#tab-saved').innerText()).slice(0,300)));
  console.log('AFTER', JSON.stringify((await p.locator('#tab-saved').innerText()).slice(0,260)));
  check('saved: delete needs a confirming second click', still && /My builds \(0\)/i.test(await p.locator('#tab-saved').innerText()));
  check('saved: no page errors', p.errors.length === 0 && q.errors.length === 0, p.errors.concat(q.errors).join('|'));
  await p.context().close(); await q.context().close(); await bad.context().close();
}

const f=results.filter(r=>!r.ok);console.log(f.length?'FAILED '+f.length:'ALL OK');await browser.close();
