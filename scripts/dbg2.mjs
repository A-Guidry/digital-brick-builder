import { chromium } from 'playwright-core';
import fs from 'fs';
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0];
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
page.on('pageerror', e => console.log('pageerror', e.message));
await page.goto('http://127.0.0.1:5173/');
await page.waitForFunction(() => !document.querySelector('#stage.busy') && window.__bf?.model);
await page.click('.tabs button[data-tab=build]');
await page.click('#b-skip'); await page.waitForTimeout(500);
const chips = await page.locator('#tab-build .piece').evaluateAll(e => e.map(x => x.dataset.k));
console.log('chips', chips);
await page.click(`#tab-build .piece[data-k="${chips[0]}"]`); await page.waitForTimeout(800);
const info = await page.evaluate(() => {
  const v = window.__bf.viewer, r = v.renderer.domElement.getBoundingClientRect();
  return { rect: [r.left, r.top, r.width, r.height], ghosts: v.ghostRoot.children.map(m => { const q = m.position.clone().project(v.camera); const p = window.__bf.model.parts.find(z => z.id === m.userData.id); return { id: m.userData.id, key: p.part + '|' + p.color, x: r.left + (q.x + 1) / 2 * r.width, y: r.top + (1 - q.y) / 2 * r.height, ndc: [q.x, q.y, q.z] }; }), hasPick: !!v.onPick };
});
console.log(JSON.stringify(info));
await browser.close();
