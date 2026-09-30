import { chromium } from 'playwright-core';
import fs from 'fs';
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0];
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 600 }, deviceScaleFactor: 1 })).newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.text().startsWith('DROP')) console.log(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const shot = async n => { await page.screenshot({ path: `shots/${n}.png` }); console.log('shot', n); };
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
await page.goto('http://127.0.0.1:5173/');
await page.waitForFunction(() => !document.querySelector('#stage.busy') && window.__bf?.model, null, { timeout: 30000 });
await page.click('.tabs button[data-tab=build]');
await page.click('.bag.can');
await page.waitForFunction(() => window.__bf.viewer.pile.count() >= 18, null, { timeout: 120000 });
await page.waitForFunction(() => /is empty/.test(document.querySelector('#b-msg')?.textContent || ''), null, { timeout: 120000 });
await page.waitForTimeout(5000);
ok(await page.evaluate(() => window.__bf.viewer.pile.count()) === 18, 'pile has all 18 bricks of bag 1');
const snap = () => page.evaluate(() => window.__bf.viewer.pile.snapshot());
const scr = (s) => page.evaluate(([x,y,z]) => window.__bf.toScreen(x,y,z), [s.x,s.y,s.z]);
// mouse hover stir
const a = await snap();
const c = a.reduce((m, s) => ({ x: m.x + s.x / a.length, y: m.y + s.y / a.length, z: m.z + s.z / a.length }), { x: 0, y: 0, z: 0 });
const p0 = await scr({ ...c, y: 0.6 });
for (let k = 0; k < 3; k++) for (let i = -8; i <= 8; i++) { await page.mouse.move(p0[0] + i * 12, p0[1] + (k - 1) * 20 + Math.sin(i) * 10); await page.waitForTimeout(40); }
await page.waitForTimeout(1500);
const b = await snap();
const moved = b.filter((s, i) => Math.hypot(s.x - a[i].x, s.z - a[i].z) > 0.3).length;
ok(moved >= 2, `mouse hover moved ${moved}/18 bricks`);
// touch swipe via CDP
const cdp = await page.context().newCDPSession(page);
const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const b0 = await snap();
await touch('touchStart', p0[0] - 100, p0[1] + 30);
for (let i = 0; i <= 20; i++) { await touch('touchMove', p0[0] - 100 + i * 10, p0[1] + 30 - i); await page.waitForTimeout(40); }
await touch('touchEnd');
await page.waitForTimeout(1200);
const b1 = await snap();
ok(b1.filter((s, i) => Math.hypot(s.x - b0[i].x, s.z - b0[i].z) > 0.3).length >= 2, 'finger swipe moved bricks');
// placement by drag: needed part
const need = await page.evaluate(() => { const st = window.__bf.steps[0]; return st.parts.map(p => ({ part: p.part, color: p.color, id: p.id })); });
console.log('step0 needs', need);
await shot('14-ready');
const pile = await snap();
console.log(pile.map(s=>[s.part,+s.x.toFixed(1),+s.y.toFixed(1),+s.z.toFixed(1)].join(' ')).join('\n'));
const target = pile.find(s => s.part === need[0].part && s.color === need[0].color);
ok(!!target, 'needed brick is in pile');
const sp = await scr(target);
const ghost = await page.evaluate((id) => { const g = window.__bf.viewer.ghostRoot.children.find(c => c.userData.id === id); if (!g) return null; const w = g.getWorldPosition(g.position.clone()); return window.__bf.toScreen(w.x, w.y, w.z); }, need[0].id);
console.log('ghost', ghost, 'brick', sp);
const before = await page.evaluate(() => document.querySelector('#tab-build .big')?.textContent);
const gpos = () => page.evaluate((id) => { const v = window.__bf.viewer; const g = v.ghostRoot.children.find(c => c.userData.id === id); return window.__bf.toScreen(g.position.x, g.position.y, g.position.z); }, need[0].id);
const bpos = () => page.evaluate((uid) => { const s = window.__bf.viewer.pile.snapshot().find(q => q.uid === uid); return window.__bf.toScreen(s.x, s.y, s.z); }, target.uid);
await page.waitForTimeout(1500);
const sp2 = await bpos(); await page.mouse.move(sp2[0], sp2[1]); await page.mouse.down();
for (let i = 1; i <= 14; i++) { const g2 = await gpos(); await page.mouse.move(sp2[0] + (g2[0] - sp2[0]) * i / 14, sp2[1] + (g2[1] - sp2[1]) * i / 14); await page.waitForTimeout(80); }
{ const g2 = await gpos(); await page.mouse.move(g2[0], g2[1]); await page.waitForTimeout(300); }
await shot('15-dragging');
await page.mouse.up(); await page.waitForTimeout(1500);
await shot('16-after-drop');
console.log('pile after', await page.evaluate(() => window.__bf.viewer.pile.count()), 'msg', await page.evaluate(() => document.querySelector('#b-msg')?.textContent));
console.log('errors', errors);
await browser.close();
