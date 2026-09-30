import { chromium } from 'playwright-core';
import fs from 'fs';
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0];
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const p = await (await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:5173/');
await p.waitForFunction(() => !document.querySelector('#stage.busy') && window.__bf?.model);
await p.click('#presets button[data-id=snowman]'); await p.waitForFunction(() => !document.querySelector('#stage.busy'));
await p.evaluate(() => document.querySelector('#left').scrollTo(0, 0));
for (const t of ['light', 'midnight', 'playful']) {
  await p.click(`#themes button[data-theme=${t}]`); await p.evaluate(() => { document.querySelector('#left').scrollTo(0,0); }); await p.click('#presets button[data-id=snowman]'); await p.waitForFunction(() => !document.querySelector('#stage.busy'));
  await p.evaluate(() => document.querySelector('#left').scrollTo(0, 0));
  await p.evaluate(() => { const r = document.querySelector('#s-range'); r.value = '30.5'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.waitForTimeout(1500); await p.screenshot({ path: `shots/theme-${t}-steps.png` });
  await p.click('.tabs button[data-tab=build]'); await p.click('.bag.can'); await p.waitForFunction(() => window.__bf.viewer.pile.count() > 10, null, { timeout: 120000 }); await p.waitForTimeout(3000);
  await p.screenshot({ path: `shots/theme-${t}-build.png` });
  await p.evaluate(() => document.querySelector('#b-restart, .tabs button[data-tab=steps]')); await p.click('.tabs button[data-tab=steps]');
  console.log('shot', t);
}
console.log(errs);
await browser.close();
