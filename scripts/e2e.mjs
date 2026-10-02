import { chromium } from 'playwright-core';
import fs from 'fs';
// CHROME_PATH lets this run outside the original Linux sandbox (e.g. macOS: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome").
const exePath = process.env.CHROME_PATH || (() => { const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0]; return `/opt/pw-browsers/${exe}/chrome-linux/chrome`; })();
const browser = await chromium.launch({ executablePath: exePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
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
// The build panel is a drawer that tucks away once a bag is open. Use it the way a person would: open it, press, let it close.
const pane = async (p, sel) => { await p.evaluate(() => { document.getElementById('app').dataset.drawer = 'open'; }); await p.click(sel); await p.evaluate(() => { document.getElementById('app').dataset.drawer = 'closed'; }); };
const act = (p, name) => p.click(`#rail-act button[data-act=${name}]`);
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

// ---------- A. bag-based virtual build: rip, dump, sort, place ----------
{
  const p = await fresh(null, { width: 1300, height: 640 });
  p.setDefaultTimeout(150000);
  await p.click('.tabs button[data-tab=build]');
  const total = await p.evaluate(() => window.__bf.model.parts.length);
  const counts = await p.$$eval('.bag .bs', els => els.map(e => +(/(\d+) pcs/.exec(e.textContent)[1])));
  check('bags: exactly 4 bags', counts.length === 4, counts.join(','));
  check('bags: piece counts add up to the whole model', counts.reduce((a, b) => a + b, 0) === total, `${counts.join('+')} = ${total}`);
  check('bags: only bag 1 can be opened at first', (await p.$$eval('.bag', els => els.map(e => !e.disabled))).join() === 'true,false,false,false');
  await shot(p, '11-bags-sealed');
  const poolCount = () => p.evaluate(() => window.__bf.viewer.pile.count());
  const snap = () => p.evaluate(() => window.__bf.viewer.pile.snapshot());
  const scr = (x, y, z) => p.evaluate(a => window.__bf.toScreen(...a), [x, y, z]);
  const msg = () => p.locator('#b-msg').innerText();
  const emptied = () => p.waitForFunction(() => /is empty/.test(document.querySelector('#b-msg')?.textContent || ''));
  await pane(p, '.bag.can');
  await p.waitForFunction(() => window.__bf.viewer.pile.count() > 3);
  await shot(p, '12-bag-ripping');
  await p.waitForFunction(() => /Rii+p|is empty/.test(document.querySelector('#b-msg')?.textContent || ''));
  check('bags: bags 2-4 stay locked while bag 1 is open', (await p.$$eval('.bag', els => els.map(e => !e.disabled))).join() === 'false,false,false,false');
  await emptied(); await p.waitForTimeout(5000);
  check('bags: opening bag 1 dumps exactly its bricks into the tray', (await poolCount()) === counts[0], `${await poolCount()} / ${counts[0]}`);
  await shot(p, '13-bag-dumped');
  const centre = async () => { const a = await snap(); const c = a.reduce((m, q) => ({ x: m.x + q.x / a.length, z: m.z + q.z / a.length }), { x: 0, z: 0 }); return scr(c.x, 0.6, c.z); };
  // mouse hover stirs
  await p.waitForTimeout(1500);
  let a = await snap(); let c0 = await centre();
  for (let k = 0; k < 3; k++) for (let i = -8; i <= 8; i++) { await p.mouse.move(c0[0] + i * 12, c0[1] + (k - 1) * 20 + Math.sin(i) * 10); await p.waitForTimeout(40); }
  await p.waitForTimeout(1500);
  let b = await snap();
  const mv = (x, y) => y.filter((q, i) => Math.hypot(q.x - x[i].x, q.z - x[i].z) > 0.3).length;
  check('pile: moving the mouse over bricks pushes them around', mv(a, b) >= 3, `${mv(a, b)} bricks moved`);
  // finger swipe stirs (real touch events over CDP)
  await p.waitForTimeout(2500);
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  let swiped = 0;
  for (let attempt = 0; attempt < 3 && swiped < 1; attempt++) {
    a = await snap(); c0 = await centre();
    await touch('touchStart', c0[0] - 110, c0[1] + 25);
    for (let i = 0; i <= 44; i++) { await touch('touchMove', c0[0] - 110 + (i % 23) * 10, c0[1] + 25 - (i % 23) + (i > 22 ? 12 : 0)); await p.waitForTimeout(40); }
    await touch('touchEnd'); await p.waitForTimeout(1500);
    b = await snap(); swiped = mv(a, b);
  }
  check('pile: a finger swipe over bricks pushes them around', swiped >= 1, `${swiped} bricks moved`);
  check('pile: camera did not orbit during the swipe (controls re-enabled after)', await p.evaluate(() => window.__bf.viewer.controls.enabled));
  // hint
  await act(p, 'hint'); await p.waitForTimeout(300);
  check('hint: names the piece and pulses matches in the tray', /Hint: look for/.test(await msg()), await msg());
  // pieces
  const need = await p.evaluate(() => window.__bf.steps[0].parts.map(q => ({ part: q.part, color: q.color, id: q.id })));
  const ghostPos = id => p.evaluate(id => { const g = window.__bf.viewer.ghostRoot.children.find(c => c.userData.id === id); return window.__bf.toScreen(g.position.x, g.position.y, g.position.z); }, id);
  const brickPos = uid => p.evaluate(uid => { const q = window.__bf.viewer.pile.snapshot().find(x => x.uid === uid); return window.__bf.toScreen(q.x, q.y, q.z); }, uid);
  const settle = async () => { await p.waitForTimeout(500); await p.waitForFunction(() => { const a = window.__bf.viewer.pile.snapshot(); return a.filter(q => q.asleep).length >= a.length * 0.75; }, null, { timeout: 40000 }).catch(() => {}); await p.waitForTimeout(300); };
  // wrong piece: pick a brick of a different kind, tap it, tap a ghost
  await settle();
  // tap bricks until the one that got selected really is the wrong kind (bricks overlap on screen, the front one wins)
  let wrongSel = false;
  for (const cand of (await snap()).filter(q => q.part !== need[0].part || q.color !== need[0].color).slice(0, 8)) {
    const bp0 = await brickPos(cand.uid); await p.mouse.click(bp0[0], bp0[1]); await p.waitForTimeout(400);
    const sel = await p.evaluate(() => { const s = window.__bf.viewer.pile.selected; return s ? [s.part, s.color] : null; });
    if (sel && (sel[0] !== need[0].part || sel[1] !== need[0].color)) { wrongSel = true; break; }
    if (sel) { await p.mouse.click(bp0[0], bp0[1]); await p.waitForTimeout(300); }   // deselect and try another
  }
  check('tap: tapping a brick selects it', wrongSel && await p.evaluate(() => !!window.__bf.viewer.pile.selected));
  let gp = await ghostPos(need[0].id); await p.mouse.click(gp[0], gp[1]); await p.waitForTimeout(800);
  if (!/Wrong piece/.test(await msg())) { await p.screenshot({ path: 'shots/fail-wrong.png' }); console.log('DBG', await p.evaluate(() => JSON.stringify({ g: window.__bf.viewer.ghostRoot.children.length, sel: window.__bf.viewer.pile.selected?.part, ptr: window.__bf.viewer.ptr.mode, ctl: window.__bf.viewer.controls.enabled })), 'ghost', gp, 'brick', bp); }
  check('wrong piece is refused with a plain message', /Wrong piece/.test(await msg()), await msg());
  check('wrong piece stays in the pile', (await poolCount()) === counts[0]);
  // right piece by drag
  await settle();
  const rightB = (await snap()).find(q => q.part === need[0].part && q.color === need[0].color);
  let bp = await brickPos(rightB.uid);
  await p.mouse.move(bp[0], bp[1]); await p.mouse.down();
  for (let i = 1; i <= 14; i++) { const g2 = await ghostPos(need[0].id); await p.mouse.move(bp[0] + (g2[0] - bp[0]) * i / 14, bp[1] + (g2[1] - bp[1]) * i / 14); await p.waitForTimeout(80); }
  { const g2 = await ghostPos(need[0].id); await p.mouse.move(g2[0], g2[1]); await p.waitForTimeout(300); }
  await shot(p, '14-dragging-brick');
  await p.mouse.up();
  await p.waitForFunction(() => /Snapped on/.test(document.querySelector('#b-msg')?.textContent || ''));
  check('dragging the right brick onto its ghost snaps it on', (await poolCount()) === counts[0] - 1, `pile ${await poolCount()}`);
  await shot(p, '15-brick-placed');
  await act(p, 'undo'); await p.waitForTimeout(400);
  check('undo drops it back into the tray', (await poolCount()) === counts[0]);
  await act(p, 'shake'); await p.waitForTimeout(600);
  // finish all four bags
  for (let i = 0; i < 4; i++) {
    if (i > 0) {
      await p.waitForSelector('.bag.can', { state: 'attached' });
      check(`bags: bag ${i + 1} unlocks once bag ${i} is built`, (await p.$$eval('.bag', els => els.map(e => !e.disabled)))[i] === true);
      await pane(p, '.bag.can'); await emptied(); await p.waitForTimeout(1500);
      check(`bags: bag ${i + 1} dumps exactly its ${counts[i]} bricks`, (await poolCount()) === counts[i], `${await poolCount()}`);
    }
    await pane(p, '#b-finish');
    await p.waitForFunction(() => document.querySelector('.bag.done, #b-restart'), null, { timeout: 60000 });
    await p.waitForFunction(i => document.querySelectorAll('.bag.done').length >= i + 1, i, { timeout: 60000 });
  }
  await p.waitForSelector('#b-restart', { state: 'attached' });
  check('finished screen after bag 4', (await p.locator('#tab-build').innerText()).includes('Finished'));
  check('every part of the model ends up built', await p.evaluate(() => [...window.__bf.viewer.meshes.values()].every(m => m.visible)));
  await shot(p, '16-build-finished');
  check('bags: no page errors', p.errors.length === 0, p.errors.join('|'));
  await p.context().close();
}

// ---------- B. steps: <=4 pieces per step in the UI, keyboard nav ----------
{
  const p = await fresh(null);
  const counts = await p.evaluate(() => window.__bf.steps.map(s => s.parts.length));
  check('steps: every step has 1-4 pieces', counts.every(c => c >= 1 && c <= 4), `max ${Math.max(...counts)} over ${counts.length} steps`);
  const reach = t => p.waitForFunction(t => Math.abs(+document.querySelector('#s-range').value - t) < 0.001, t, { timeout: 40000 });
  await p.keyboard.press('ArrowRight'); await reach(2); await p.keyboard.press('ArrowRight'); await reach(3);
  check('steps: arrow keys move between steps', (await p.locator('#tab-steps .big').innerText()).startsWith('Step 3'));
  const hiddenLater = await p.evaluate(() => { const b = window.__bf, ids = new Set(b.steps.slice(0, 3).flatMap(s => s.parts.map(x => x.id))); let ok = true; for (const [id, m] of b.viewer.meshes) if (m.visible !== ids.has(id)) ok = false; return ok; });
  check('steps: only pieces up to the current step are shown', hiddenLater);
  const newOutlined = await p.evaluate(() => { const b = window.__bf, cur = new Set(b.steps[2].parts.map(x => x.id)); let ok = true; for (const [id, m] of b.viewer.meshes) if (m.visible && cur.has(id) !== m.children.some(c => c.userData.outline)) ok = false; return ok; });
  check('steps: exactly the new pieces are highlighted', newOutlined);
  // fluid slider: scrub between steps, pieces drop in one by one and lift back out
  const vis = () => p.evaluate(() => { const b = window.__bf; return b.steps.map(s => s.parts.map(x => { const m = b.viewer.meshes.get(x.id); return m.visible ? +(m.position.y - b.viewer.position(x).y).toFixed(2) : null; })); });
  const scrub = v => p.evaluate(v => { const r = document.querySelector('#s-range'); r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  await scrub(4.5);
  let v = await vis();
  check('slider: steps before the scrub point are fully built', v.slice(0, 4).every(s => s.every(y => y === 0)));
  check('slider: mid-step shows the new pieces part-way (dropping in)', v[4].some(y => y !== null && y > 0) || v[4].some(y => y === null), JSON.stringify(v[4]));
  check('slider: later steps stay hidden', v.slice(5).every(s => s.every(y => y === null)));
  await scrub(4.1); const v41 = await vis(); await scrub(4.9); const v49 = await vis();
  const shown = a => a[4].filter(y => y !== null).length, drop = a => a[4].reduce((t, y) => t + (y ?? 0), 0);
  check('slider: dragging forward brings more of the step in, backward takes it out again', shown(v49) >= shown(v41) && drop(v49) < drop(v41) + 0.001, `${drop(v41).toFixed(1)} -> ${drop(v49).toFixed(1)}`);
  await scrub(2.5); v = await vis();
  check('slider: dragging back un-builds later steps', v.slice(3).every(s => s.every(y => y === null)) && v.slice(0, 2).every(s => s.every(y => y === 0)));
  await p.evaluate(() => document.querySelector('#s-range').dispatchEvent(new Event('change', { bubbles: true })));
  await reach(3);
  const settled = +(await p.locator('#s-range').inputValue());
  check('slider: letting go snaps to a whole step', Number.isInteger(Math.round(settled)) && Math.abs(settled - Math.round(settled)) < 0.01, String(settled));
  await p.context().close();
}

// ---------- C. AI path with mocked providers (real request shapes, no real keys) ----------
{ // C1 anthropic text
  const seen = []; const p = await fresh(AN); await mockAnthropic(p, [BOAT], seen);
  await p.fill('#prompt', 'a small blue boat'); await p.click('#go'); await idle(p);
  check('ai/anthropic: request has key header, browser-access header, system prompt and the user text', seen.length === 1 && seen[0].headers['x-api-key'] === 'sk-ant-TEST' && seen[0].headers['anthropic-dangerous-direct-browser-access'] === 'true' && /never place bricks/.test(seen[0].body.system) && /small blue boat/.test(JSON.stringify(seen[0].body.messages)));
  check('ai/anthropic: model appears', (await p.evaluate(() => window.__bf.model?.name)) === 'Boat');
  await shot(p, '14-ai-boat');
  check('ai/anthropic: no page errors', p.errors.length === 0, p.errors.join('|'));
  await p.context().close();
}
{ // C2 repair round trip
  const seen = []; const p = await fresh(AN); await mockAnthropic(p, [BROKEN, BOAT], seen);
  await p.fill('#prompt', 'thing'); await p.click('#go'); await idle(p);
  check('ai/repair: validator problems were sent back to the AI', seen.length === 2 && /failed these checks/.test(JSON.stringify(seen[1].body.messages)) && /disconnected/.test(JSON.stringify(seen[1].body.messages)));
  check('ai/repair: AI fix accepted, model passes', (await p.evaluate(() => window.__bf.model?.name)) === 'Boat' && (await p.locator('#banner').isHidden()));
  await shot(p, '15-ai-repair-log');
  await p.click('.tabs button[data-tab=checks]'); await shot(p, '16-ai-repair-checks');
  await p.context().close();
}
{ // C3 never fixed -> honest failure
  const seen = []; const p = await fresh(AN); await mockAnthropic(p, [BROKEN], seen);
  await p.fill('#prompt', 'thing'); await p.click('#go'); await idle(p);
  check('ai/fail: retries a limited number of times', seen.length >= 2 && seen.length <= 4, `${seen.length} calls`);
  check('ai/fail: banner plainly says checks failed', /did NOT pass/.test(await p.locator('#banner').innerText()));
  await shot(p, '17-ai-failed');
  await p.context().close();
}
{ // C4 picture
  const seen = []; const p = await fresh(AN); await mockAnthropic(p, [BOAT], seen);
  await p.setInputFiles('#file', '/tmp/test-house.png'); await p.waitForFunction(() => !document.querySelector('#drop-img').hidden);
  await shot(p, '18-image-attached');
  await p.click('#go'); await idle(p);
  const content = seen[0].body.messages[0].content;
  check('ai/image: picture is sent as an image block (base64 jpeg)', Array.isArray(content) && content[0].type === 'image' && content[0].source.media_type === 'image/jpeg' && content[0].source.data.length > 500);
  await p.context().close();
}
{ // C5 bad key
  const seen = []; const p = await fresh(AN); await mockAnthropic(p, [401], seen);
  await p.fill('#prompt', 'x'); await p.click('#go'); await idle(p);
  check('ai/badkey: plain error about the key', /rejected the key/.test(await p.locator('#ai-note').innerText()), await p.locator('#ai-note').innerText());
  await p.context().close();
}
{ // C6 no key -> settings dialog
  const p = await fresh(null);
  await p.fill('#prompt', 'a cat'); await p.click('#go'); await p.waitForTimeout(400);
  check('ai/nokey: opens settings and points to ready-made builds', await p.locator('#settings[open]').count() === 1 && /ready-made/.test(await p.locator('#ai-note').innerText()));
  await shot(p, '19-no-key');
  await p.context().close();
}
const PROXY = 'https://brickbuilder-api.arcwel.ai';
async function mockProxy(page, replies, seen) {
  await page.route(`${PROXY}/**`, async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.url().endsWith('/healthz')) return route.fulfill({ status: 200, headers: cors, contentType: 'text/plain', body: 'ok' });
    seen.push({ headers: req.headers(), body: JSON.parse(req.postData()) });
    const r = replies.length > 1 ? replies.shift() : replies[0];
    if (r && r.status) return route.fulfill({ status: r.status, headers: { ...cors, ...(r.retry ? { 'retry-after': r.retry } : {}) }, contentType: 'application/json', body: JSON.stringify({ error: r.error }) });
    route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ text: '```json\n' + JSON.stringify(r) + '\n```' }) });
  });
}
{ // C6b shared server: first-time default, passcode flow, friendly limit message, no passcode in profile file
  const seen = []; const p = await fresh(null);
  check('shared: first-time visitors start on "Shared server"', await p.evaluate(() => JSON.parse(localStorage.getItem('brickforge.settings.v1') || '{"provider":"shared"}').provider) === 'shared' && /passcode/i.test(await p.locator('#ai-note').innerText()), await p.locator('#ai-note').innerText());
  await mockProxy(p, [BOAT], seen);
  await p.click('#btn-settings');
  check('shared: only the passcode is shown (no key/model fields)', await p.locator('#sharedPasscode').isVisible() && !(await p.locator('#anthropicKey').isVisible()) && !(await p.locator('#geminiKey').isVisible()));
  await p.fill('#sharedPasscode', 'CODE-E2E-123');
  await p.click('#test'); await p.waitForFunction(() => /Connected|Could not|passcode|limit/.test(document.querySelector('#test-out').textContent));
  check('shared: test connection reaches the proxy', /Connected/.test(await p.locator('#test-out').innerText()), await p.locator('#test-out').innerText());
  await shot(p, '19b-shared-settings');
  seen.length = 0; await p.click('#save-close');
  await p.fill('#prompt', 'a small red house'); await p.click('#go'); await idle(p);
  check('shared: request goes to /v1/ai with the passcode header, system prompt and user text, and no model or key',
    seen.length === 1 && seen[0].headers['x-dbb-passcode'] === 'CODE-E2E-123' && /never place bricks/.test(seen[0].body.system) && /red house/.test(JSON.stringify(seen[0].body.messages)) && !('model' in seen[0].body) && !('x-api-key' in seen[0].headers));
  check('shared: model appears', (await p.evaluate(() => window.__bf.model?.name)) === 'Boat');
  // profile file must not carry the passcode unless keys are included
  await p.click('#btn-profile'); await p.check('#pf-inc-settings');
  const dl1 = p.waitForEvent('download'); await p.click('#pf-save'); const f1 = await (await dl1).createReadStream(); let t1 = ''; for await (const c of f1) t1 += c;
  check('shared: profile file does not contain the passcode by default', !t1.includes('CODE-E2E-123') && !t1.includes('brickbuilder-api'), t1.slice(0, 80));
  await p.check('#pf-inc-keys');
  const dl2 = p.waitForEvent('download'); await p.click('#pf-save'); const f2 = await (await dl2).createReadStream(); let t2 = ''; for await (const c of f2) t2 += c;
  check('shared: passcode only appears when "include keys" is ticked', t2.includes('CODE-E2E-123'));
  check('shared: no page errors', p.errors.length === 0, p.errors.join('|'));
  await p.context().close();
}
{ // C6c shared server: limit message is shown as written; wrong passcode too
  for (const [reply, rx] of [[{ status: 429, retry: '7200', error: 'You have used your shared AI allowance for today. Please try again in about 2 hours.' }, /about 2 hours/], [{ status: 401, error: 'That passcode is not right. Check it and try again.' }, /passcode is not right/]]) {
    const seen = []; const p = await fresh({ provider: 'shared', sharedUrl: PROXY, sharedPasscode: 'x' }); await mockProxy(p, [reply], seen);
    await p.fill('#prompt', 'thing'); await p.click('#go'); await idle(p);
    check(`shared: ${reply.status} message is shown to the user as written`, rx.test(await p.locator('#ai-note').innerText()), await p.locator('#ai-note').innerText());
    await p.context().close();
  }
}
{ // C6d shared server + picture
  const seen = []; const p = await fresh({ provider: 'shared', sharedUrl: PROXY, sharedPasscode: 'x' }); await mockProxy(p, [BOAT], seen);
  await p.setInputFiles('#file', '/tmp/test-house.png'); await p.waitForFunction(() => !document.querySelector('#drop-img').hidden);
  await p.click('#go'); await idle(p);
  const m0 = seen[0]?.body.messages[0];
  check('shared: picture is sent as {mime, base64} on the message', m0?.image?.mime === 'image/jpeg' && m0.image.base64.length > 500);
  await p.context().close();
}
{ // C10 setup link: opens already set up for the shared server and removes the passcode from the address bar
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } }); const p = await ctx.newPage(); p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.goto(url + '#pc=AAAA%2Bbbb%2Fcc%3D%3Ddddd1234', { timeout: 120000 });
  await p.waitForFunction(() => window.__bf?.model, null, { timeout: 40000 });
  const r = await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('brickforge.settings.v1') || '{}'); return { provider: s.provider, pc: s.sharedPasscode, hash: location.hash, note: document.getElementById('ai-note').textContent, history: history.length }; });
  check('setup link: stores the passcode and picks the shared server', r.provider === 'shared' && r.pc === 'AAAA+bbb/cc==dddd1234', JSON.stringify({ provider: r.provider, len: (r.pc || '').length }));
  check('setup link: the passcode is removed from the address bar', r.hash === '', r.hash);
  check('setup link: says the device is set up', /set up on this device/.test(r.note), r.note);
  check('setup link: no page errors', p.errors.length === 0, p.errors.join('|'));
  await ctx.close();
}
{ // C7 gemini
  const seen = []; const p = await fresh({ provider: 'gemini', geminiKey: 'AIza-TEST', geminiModel: 'gemini-3.5-flash-lite' });
  await p.route('https://generativelanguage.googleapis.com/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push({ url: req.url(), headers: req.headers(), body: JSON.parse(req.postData()) });
    route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(BOAT) }] } }] }) });
  });
  await p.setInputFiles('#file', '/tmp/test-house.png'); await p.fill('#prompt', 'boat'); await p.click('#go'); await idle(p);
  check('ai/gemini: correct endpoint, key header, system instruction and inlineData image', seen.length === 1 && /gemini-3\.5-flash-lite:generateContent/.test(seen[0].url) && seen[0].headers['x-goog-api-key'] === 'AIza-TEST' && !!seen[0].body.systemInstruction && !!seen[0].body.contents[0].parts[0].inlineData);
  check('ai/gemini: model shows', (await p.evaluate(() => window.__bf.model?.name)) === 'Boat');
  await p.context().close();
}
{ // C8 local
  const seen = []; const p = await fresh({ provider: 'local', localUrl: 'http://localhost:11434/v1', localModel: 'llava' });
  await p.route('http://localhost:11434/**', async route => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    seen.push({ url: req.url(), body: JSON.parse(req.postData()) });
    route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify(BOAT) } }] }) });
  });
  await p.fill('#prompt', 'boat'); await p.click('#go'); await idle(p);
  check('ai/local: posts to /chat/completions with system+user messages', seen.length === 1 && /\/v1\/chat\/completions$/.test(seen[0].url) && seen[0].body.messages[0].role === 'system' && seen[0].body.model === 'llava');
  check('ai/local: model shows', (await p.evaluate(() => window.__bf.model?.name)) === 'Boat');
  await p.context().close();
}
{ // C9 local server down -> plain error
  const p = await fresh({ provider: 'local', localUrl: 'http://localhost:9/v1', localModel: 'x' });
  await p.fill('#prompt', 'boat'); await p.click('#go'); await idle(p);
  check('ai/local-down: plain error mentions server/CORS', /local model server/.test(await p.locator('#ai-note').innerText()), await p.locator('#ai-note').innerText());
  await p.context().close();
}
// ---------- F. profile: autosave, resume, save/load file, share link, footer ----------
{
  const p = await fresh({ ...AN, anthropicKey: 'sk-ant-PROFILESECRET' }, { width: 1300, height: 640 });
  p.setDefaultTimeout(150000);
  check('footer: one quiet line until opened', (await p.locator('#foot').innerText()).trim().startsWith('Project disclaimer') && !/LEGO Group/.test(await p.locator('#foot').innerText()));
  await p.click('#foot summary');
  check('footer: independent-project / not-affiliated disclaimer is shown when opened', /not affiliated with, authorized by, or endorsed by the LEGO Group/.test(await p.locator('#foot').innerText()));
  check('profile: starts as Guest', (await p.locator('#btn-profile').innerText()) === 'Guest');
  await p.click('#btn-profile'); await p.fill('#pf-name', 'Ada');
  check('profile: display name shows in the header button', (await p.locator('#btn-profile').innerText()) === 'Ada');
  await p.click('#pf-close');
  // build progress: bag 1 done, bag 2 open with one brick placed
  await p.click('.tabs button[data-tab=build]'); await pane(p, '.bag.can');
  await p.waitForFunction(() => /is empty/.test(document.querySelector('#b-msg')?.textContent || ''));
  await pane(p, '#b-finish'); await p.waitForFunction(() => document.querySelectorAll('.bag.done').length >= 1);
  await pane(p, '.bag.can'); await p.waitForFunction(() => /is empty/.test(document.querySelector('#b-msg')?.textContent || ''));
  const bag2 = await p.evaluate(() => window.__bf.viewer.pile.count());
  await p.waitForFunction(() => { const a = window.__bf.viewer.pile.snapshot(); return a.filter(q => q.asleep).length >= a.length * 0.6; }, null, { timeout: 40000 }).catch(() => {});
  await act(p, 'auto'); await p.waitForFunction(() => /Snapped on/.test(document.querySelector('#b-msg')?.textContent || ''));
  const remaining = bag2 - 1;
  await p.waitForTimeout(600);
  const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('dbb.profile.v1')));
  check('autosave: progress is written to browser storage', stored?.progress?.['p:house']?.bagState?.join() === 'done,open,sealed,sealed' && stored.progress['p:house'].placed.length === 1 && stored.name === 'Ada', JSON.stringify(stored?.progress));
  check('autosave: settings/API keys are NOT copied into the profile store', !JSON.stringify(stored).includes('PROFILESECRET'));
  // reload the page: everything comes back
  await p.reload(); await p.waitForFunction(() => !document.querySelector('#stage.busy') && window.__bf?.model);
  check('resume: name and last build come back after a reload', (await p.locator('#btn-profile').innerText()) === 'Ada' && (await p.evaluate(() => window.__bf.model.name)) === 'Little house');
  await p.click('.tabs button[data-tab=saved]');
  check('resume: Saved tab offers to resume the build in progress', /1 of 4 bags built · bag 2 open/.test(await p.locator('#tab-saved').innerText()));
  await p.click('#tab-saved [data-act=resume]');
  await p.waitForFunction(() => document.querySelector('#tab-build:not([hidden])'));
  await p.waitForFunction(() => window.__bf.viewer.pile.count() > 0);
  check('resume: bag 1 is built, bag 2 is open, and the tray holds only the bricks still to place', (await p.$$eval('.bag', e => e.map(x => x.className.split(' ')[1]))).slice(0, 2).join() === 'done,open' && (await p.evaluate(() => window.__bf.viewer.pile.count())) === remaining, `${await p.evaluate(() => window.__bf.viewer.pile.count())} vs ${remaining}`);
  await shot(p, '17-resumed-build');
  // save a profile file (no keys by default)
  await p.click('#btn-profile');
  const dl1 = p.waitForEvent('download'); await p.click('#pf-save'); const f1 = await dl1;
  const file1 = fs.readFileSync(await f1.path(), 'utf8');
  check('file: profile downloads as a .dbb.json file', /\.dbb\.json$/.test(f1.suggestedFilename()) && JSON.parse(file1).app === 'digital-brick-builder', f1.suggestedFilename());
  check('file: no settings or keys unless asked', !/PROFILESECRET/.test(file1) && !/"settings"/.test(file1));
  await p.check('#pf-inc-settings');
  const dl2 = p.waitForEvent('download'); await p.click('#pf-save'); const file2 = fs.readFileSync(await (await dl2).path(), 'utf8');
  check('file: including AI settings still leaves API keys out', /"settings"/.test(file2) && !/PROFILESECRET/.test(file2));
  await p.check('#pf-inc-keys');
  const dl3 = p.waitForEvent('download'); await p.click('#pf-save'); const file3 = fs.readFileSync(await (await dl3).path(), 'utf8');
  check('file: API keys only when explicitly ticked', /PROFILESECRET/.test(file3));
  fs.writeFileSync('/tmp/dbb-profile.json', file1); fs.writeFileSync('/tmp/dbb-profile-settings.json', file3);
  check('profile: no page errors', p.errors.length === 0, p.errors.join('|'));
  await p.context().close();
}
{ // load that file into a brand-new browser profile
  const p = await fresh(null, { width: 1300, height: 640 });
  p.setDefaultTimeout(150000);
  await p.click('#btn-profile');
  await p.setInputFiles('#pf-file', '/tmp/dbb-profile.json');
  await p.waitForFunction(() => /Loaded:/.test(document.querySelector('#pf-msg')?.textContent || ''));
  check('load: header shows the loaded name', (await p.locator('#btn-profile').innerText()) === 'Ada');
  await p.click('#pf-close'); await p.click('.tabs button[data-tab=saved]');
  check('load: progress from the file is listed on the Saved tab', /1 of 4 bags built/.test(await p.locator('#tab-saved').innerText()));
  await p.click('#tab-saved [data-act=resume]'); await p.waitForFunction(() => window.__bf.viewer.pile.count() > 0);
  check('load: resuming from a loaded file re-opens the right bag', (await p.$$eval('.bag', e => e.map(x => x.className.split(' ')[1]))).slice(0, 2).join() === 'done,open');
  // bad files
  await p.click('#btn-profile');
  fs.writeFileSync('/tmp/dbb-bad.json', '{ not json'); await p.setInputFiles('#pf-file', '/tmp/dbb-bad.json');
  await p.waitForFunction(() => /not valid JSON/.test(document.querySelector('#pf-msg')?.textContent || ''));
  fs.writeFileSync('/tmp/dbb-other.json', JSON.stringify({ app: 'something-else', version: 1 })); await p.setInputFiles('#pf-file', '/tmp/dbb-other.json');
  await p.waitForFunction(() => /not made by Digital Brick Builder/.test(document.querySelector('#pf-msg')?.textContent || ''));
  check('load: bad or foreign files are refused with a plain message', true);
  // settings from a file are only applied when the user presses the button
  await p.setInputFiles('#pf-file', '/tmp/dbb-profile-settings.json');
  await p.waitForFunction(() => /Loaded:/.test(document.querySelector('#pf-msg')?.textContent || ''));
  const before = await p.evaluate(() => JSON.parse(localStorage.getItem('brickforge.settings.v1') || '{}').anthropicKey || '');
  check('load: AI settings in a file are NOT applied automatically', before === '' && await p.locator('#pf-apply-row').isVisible());
  await p.click('#pf-apply');
  check('load: ...but can be applied on request', (await p.evaluate(() => JSON.parse(localStorage.getItem('brickforge.settings.v1')).anthropicKey)) === 'sk-ant-PROFILESECRET');
  // erase
  await p.click('#pf-erase'); check('erase: needs a second click', /Click again/.test(await p.locator('#pf-erase').innerText()));
  await p.click('#pf-erase'); await p.waitForTimeout(400);
  check('erase: profile is cleared from this browser', (await p.locator('#btn-profile').innerText()) === 'Guest' && !(await p.evaluate(() => (JSON.parse(localStorage.getItem('dbb.profile.v1') || 'null')?.name || ''))));
  check('load: no page errors', p.errors.length === 0, p.errors.join('|'));
  await p.context().close();
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
  check('share: a damaged link falls back to a normal start with a message', /damaged|not recognised|could not/.test(await bad.locator('#ai-note').innerText()));
  // delete needs two clicks
  const still = await p.evaluate(() => { const b = document.querySelector('#tab-saved [data-act=del]'); b.click(); const s = /My builds \(1\)/i.test(document.querySelector('#tab-saved').innerText); document.querySelector('#tab-saved [data-act=del]').click(); return s; });
  check('saved: delete needs a confirming second click', still && /My builds \(0\)/i.test(await p.locator('#tab-saved').innerText()));
  check('saved: no page errors', p.errors.length === 0 && q.errors.length === 0, p.errors.concat(q.errors).join('|'));
  await p.context().close(); await q.context().close(); await bad.context().close();
}
{ // E. ready-made gallery + BrickLink panel
  const p = await fresh(null);
  const n = await p.locator('#presets button').count();
  check('ready-made: 18 builds listed', n === 18, String(n));
  check('ready-made: every build shows a picture of the finished model', await p.locator('#presets button img').count() === n);
  const loaded = await p.$$eval('#presets button img', els => els.every(i => i.complete && i.naturalWidth > 20));
  check('ready-made: pictures load', loaded);
  await p.click('.tabs button[data-tab=parts]');
  check('bricklink: upload panel with copy-and-open button', await p.locator('#p-bl').count() === 1 && /Wanted List/.test(await p.locator('.bl-card').innerText()));
  await p.context().close();
}
{ // C8 empty Gemini key: Test connection says what is missing and sends nothing to Google
  const seen = []; const p = await fresh({ provider: 'gemini', geminiKey: '', geminiModel: 'gemini-3.5-flash-lite' });
  await p.route('https://generativelanguage.googleapis.com/**', r => { seen.push(r.request().url()); r.fulfill({ status: 403, headers: cors, contentType: 'application/json', body: '{"error":{"message":"Method doesn\'t allow unregistered callers"}}' }); });
  await p.click('#btn-settings'); await p.click('#test');
  await p.waitForFunction(() => { const t = document.querySelector('#test-out').textContent; return t && t !== 'Testing…'; });
  check('settings: Test with an empty Gemini key says to paste a key', /No Gemini key entered yet.*aistudio/.test(await p.locator('#test-out').innerText()), await p.locator('#test-out').innerText());
  check('settings: ...and sends nothing to Google', seen.length === 0, String(seen.length));
  await p.context().close();
}
{ // C9 local model picker: finds what is installed and replaces a model that is not
  const p = await fresh({ provider: 'local', localUrl: 'http://models.test/v1', localModel: 'llama3.2-vision' });
  await p.route('http://models.test/**', route => route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: cors }) : route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: [{ id: 'qwen3.5:9b' }, { id: 'nomic-embed-text:latest' }] }) }));
  await p.click('#btn-settings');
  await p.waitForFunction(() => /not installed/.test(document.querySelector('#models-out').textContent), null, { timeout: 15000 });
  const r = await p.evaluate(() => ({ box: document.querySelector('#localModel').value, opts: document.querySelectorAll('#localModelList option').length, saved: JSON.parse(localStorage.getItem('brickforge.settings.v1')).localModel, out: document.querySelector('#models-out').textContent }));
  check('local: opening settings finds installed models and swaps a missing model for an installed one', r.box === 'qwen3.5:9b' && r.saved === 'qwen3.5:9b' && r.opts === 2 && /llama3\.2-vision.*not installed/.test(r.out), JSON.stringify(r));
  await p.context().close();
}
{ // B2. build mode: panels step aside, icon rails, touch rules, drawer
  const p = await fresh(null, { width: 1440, height: 860 });
  check('touch: double-tap zoom is off (touch-action: manipulation on the page)', await p.evaluate(() => getComputedStyle(document.documentElement).touchAction === 'manipulation' && getComputedStyle(document.body).touchAction === 'manipulation'));
  const full = await p.evaluate(() => document.getElementById('stage').getBoundingClientRect().width);
  await p.click('.tabs button[data-tab=build]'); await p.waitForTimeout(500);
  const st = await p.evaluate(() => ({ left: getComputedStyle(document.getElementById('left')).display, stage: document.getElementById('stage').getBoundingClientRect().width, rail: [...document.querySelectorAll('#rail button')].map(b => b.getBoundingClientRect().width), drawer: document.getElementById('app').dataset.drawer, right: getComputedStyle(document.getElementById('right')).display }));
  check('build: left panel is gone and the 3D view is much wider', st.left === 'none' && st.stage > full * 1.4, `${full} -> ${st.stage}`);
  check('build: sections are a vertical icon rail (6 icons, finger-sized)', st.rail.length === 6 && st.rail.every(w => w >= 40), st.rail.join());
  check('build: the panel is a drawer, open at first so a bag can be chosen', st.drawer === 'open' && st.right !== 'none');
  await p.click('.bag.can'); await p.waitForFunction(() => /Rii+p|is empty/.test(document.querySelector('#b-msg')?.textContent || ''));
  await p.waitForFunction(() => document.querySelectorAll('.bag.open').length === 1 && !document.querySelector('.bag .bs')?.textContent.includes('Opening'));
  await p.waitForTimeout(500);
  check('build: opening a bag tucks the drawer away', await p.evaluate(() => getComputedStyle(document.getElementById('right')).display === 'none'));
  await p.waitForFunction(() => /is empty/.test(document.querySelector('#b-msg')?.textContent || ''));
  check('build: the pieces to find stay on screen as a slim strip', await p.locator('#need .nc').count() > 0 && await p.locator('#need').isVisible());
  check('build: Hint / Shake / Undo / Place are icon buttons on the stage', await p.locator('#rail-act button').count() === 4 && await p.locator('#rail-act').isVisible());
  check('build: the guidance message shows as a toast', /is empty/.test(await p.locator('#toast').innerText()));
  await p.click('#rail button[data-m=build]'); await p.waitForTimeout(200);
  check('build: the Build icon brings the drawer back', await p.evaluate(() => getComputedStyle(document.getElementById('right')).display !== 'none'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  check('build: Escape closes the drawer', await p.evaluate(() => getComputedStyle(document.getElementById('right')).display === 'none'));
  await p.click('#rail button[data-m=steps]'); await p.waitForTimeout(500);
  check('build: leaving build mode brings the normal panels back', await p.evaluate(() => getComputedStyle(document.getElementById('left')).display !== 'none' && getComputedStyle(document.getElementById('right')).display !== 'none'));
  check('build: no page errors', p.errors.length === 0, p.errors.join('|'));
  await p.context().close();
}
{ // D. settings persist + clear keys
  const p = await fresh(null);
  await p.click('#btn-settings'); await p.click('#prov button[data-p=anthropic]'); await p.fill('#anthropicKey', 'sk-ant-XYZ'); await p.click('#save-close'); await p.waitForTimeout(300);
  check('settings: Save & close actually closes the dialog', await p.locator('#settings[open]').count() === 0);
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('brickforge.settings.v1')).anthropicKey);
  await p.click('#btn-settings'); await p.click('#clear-keys');
  const cleared = await p.evaluate(() => JSON.parse(localStorage.getItem('brickforge.settings.v1')).anthropicKey);
  check('settings: key saved in browser and cleared by button', saved === 'sk-ant-XYZ' && cleared === '', `${saved} / ${cleared}`);
  await p.context().close();
}
{ // E. downloads
  const p = await fresh(null);
  await p.click('.tabs button[data-tab=parts]');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#p-xml')]);
  const path = await dl.path(); const xml = fs.readFileSync(path, 'utf8');
  const model = await p.evaluate(() => window.__bf.model.parts.length);
  const total = [...xml.matchAll(/<MINQTY>(\d+)<\/MINQTY>/g)].reduce((n, m) => n + +m[1], 0);
  check('bricklink: downloaded XML quantities add up to the model part count', total === model && xml.includes('<INVENTORY>'), `${total} vs ${model}, file ${dl.suggestedFilename()}`);
  await p.context().close();
}
{ // F. phone-width layout
  const p = await fresh(null, { width: 390, height: 844 });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check('layout: no sideways scroll at phone width', !overflow);
  await shot(p, '20-phone');
  await p.context().close();
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
