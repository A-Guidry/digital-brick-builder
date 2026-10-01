import { chromium } from 'playwright-core';
import fs from 'fs';
const exePath = process.env.CHROME_PATH || (() => { const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0]; return `/opt/pw-browsers/${exe}/chrome-linux/chrome`; })();
const browser = await chromium.launch({ executablePath: exePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const SZ = { phone: { width: 390, height: 844 }, small: { width: 360, height: 640 }, land: { width: 844, height: 390 } };
const which = process.argv[2] || 'phone';
const ctx = await browser.newContext({ viewport: SZ[which], isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
const p = await ctx.newPage(); p.setDefaultTimeout(150000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
const ok = (n, c, x = '') => console.log(c ? 'PASS' : 'FAIL', n, x);
await p.goto('http://127.0.0.1:5173/', { timeout: 120000 }); await p.waitForFunction(() => window.__bf?.model && !document.querySelector('#stage.busy'));
await p.tap('#mnav [data-m=build]');
await p.tap('.bag.can'); await p.waitForFunction(() => window.__bf.viewer.pile.count() > 3);
const cdp = await ctx.newCDPSession(p);
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const settle = async () => { await p.waitForTimeout(600); await p.waitForFunction(() => { const a = window.__bf.viewer.pile.snapshot(); return a.filter(q => q.asleep).length >= a.length * 0.75; }, null, { timeout: 60000 }).catch(() => {}); await p.waitForTimeout(400); };
await p.waitForFunction(() => /step 1/i.test(document.querySelector('#tab-build')?.textContent || '')); await settle();
await p.screenshot({ path: `shots/mb-${which}-open.png` });
const need = await p.evaluate(() => window.__bf.steps[0].parts.map(q => ({ part: q.part, color: q.color, id: q.id })));
const ghostPos = id => p.evaluate(id => { const g = window.__bf.viewer.ghostRoot.children.find(c => c.userData.id === id); return window.__bf.toScreen(g.position.x, g.position.y, g.position.z); }, id);
const brickPos = uid => p.evaluate(uid => { const q = window.__bf.viewer.pile.snapshot().find(x => x.uid === uid); return window.__bf.toScreen(q.x, q.y, q.z); }, uid);
const box = await p.locator('#stage').boundingBox();
const g0 = await ghostPos(need[0].id);
ok('ghost target is inside the visible 3D view', g0[0] > box.x && g0[0] < box.x + box.width && g0[1] > box.y && g0[1] < box.y + box.height, `${g0.map(Math.round)} in ${JSON.stringify(Object.values(box).map(Math.round))}`);
const tray = await p.evaluate(() => window.__bf.viewer.pile.snapshot().slice(0, 6).map(q => window.__bf.toScreen(q.x, q.y, q.z)));
ok('bricks in the tray are inside the visible 3D view', tray.every(t => t[0] > box.x && t[0] < box.x + box.width && t[1] > box.y && t[1] < box.y + box.height), JSON.stringify(tray.map(t => t.map(Math.round))));
// 1) tap a matching brick, tap the ghost
const snap = () => p.evaluate(() => window.__bf.viewer.pile.snapshot());
const before = (await snap()).length;
let placed = false;
for (const cand of (await snap()).filter(q => q.part === need[0].part && q.color === need[0].color).slice(0, 6)) {
  const bp = await brickPos(cand.uid); await p.touchscreen.tap(bp[0], bp[1]); await p.waitForTimeout(400);
  const sel = await p.evaluate(() => { const s = window.__bf.viewer.pile.selected; return s ? [s.part, s.color] : null; });
  if (sel && sel[0] === need[0].part && sel[1] === need[0].color) { const gp = await ghostPos(need[0].id); await p.touchscreen.tap(gp[0], gp[1]); await p.waitForFunction(() => /Snapped on/.test(document.querySelector('#b-msg')?.textContent || ''), null, { timeout: 15000 }).then(() => placed = true).catch(() => {}); break; }
  if (sel) { await p.touchscreen.tap(bp[0], bp[1]); await p.waitForTimeout(300); }
}
ok('touch: tap a brick, tap its spot -> it snaps on', placed && (await snap()).length === before - 1);
// 2) press-and-hold a brick and drag it to its ghost
await settle();
const need2 = await p.evaluate(() => window.__bf.steps[0].parts.map(q => ({ part: q.part, color: q.color, id: q.id })));
const todo = await p.evaluate(() => { const s = window.__bf; return s.steps[0].parts.map(q => q.id); });
let dragged = false;
for (const t of need2.slice(0, 3)) {
  const all = await snap(); const c = all.find(q => q.part === t.part && q.color === t.color); if (!c) continue;
  const gp0 = await p.evaluate(id => !!window.__bf.viewer.ghostRoot.children.find(x => x.userData.id === id), t.id); if (!gp0) continue;
  const n0 = all.length; let bp = await brickPos(c.uid);
  await touch('touchStart', bp[0], bp[1]); await p.waitForTimeout(450);
  for (let i = 1; i <= 14; i++) { const g2 = await ghostPos(t.id); await touch('touchMove', bp[0] + (g2[0] - bp[0]) * i / 14, bp[1] + (g2[1] - bp[1]) * i / 14); await p.waitForTimeout(70); }
  const g3 = await ghostPos(t.id); await touch('touchMove', g3[0], g3[1]); await p.waitForTimeout(250); await touch('touchEnd');
  await p.waitForTimeout(1500);
  if ((await snap()).length === n0 - 1) { dragged = true; break; }
}
ok('touch: press-and-hold, drag onto the spot -> it snaps on', dragged);
// 3) swiping over the tray must not scroll the page or the panel
const sy0 = await p.evaluate(() => [window.scrollY, document.querySelector('#right').scrollTop]);
const c0 = tray[0]; await touch('touchStart', c0[0], c0[1] + 30);
for (let i = 0; i < 20; i++) { await touch('touchMove', c0[0] + (i % 10) * 6, c0[1] + 30 - i * 3); await p.waitForTimeout(40); }
await touch('touchEnd'); await p.waitForTimeout(400);
const sy1 = await p.evaluate(() => [window.scrollY, document.querySelector('#right').scrollTop]);
ok('touch: swiping over the tray does not scroll the page', sy0.join() === sy1.join(), `${sy0} -> ${sy1}`);
await p.screenshot({ path: `shots/mb-${which}-placed.png` });
// 4) panel controls reachable (scroll the panel, buttons at least 36px tall)
const btns = await p.evaluate(() => [...document.querySelectorAll('#tab-build button')].filter(b => b.getBoundingClientRect().width > 0).map(b => Math.round(b.getBoundingClientRect().height)));
ok('build buttons are finger-sized (>= 36px)', btns.length > 0 && btns.every(h => h >= 36), btns.join(','));
ok('no page errors', errs.length === 0, errs.join('|'));
await browser.close();
