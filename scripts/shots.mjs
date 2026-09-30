import { chromium } from 'playwright-core';
import fs from 'fs';
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0];
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (['error'].includes(m.type())) errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
const url = process.env.URL || 'http://127.0.0.1:5173/';
const shot = async (n) => { await page.waitForTimeout(700); await page.screenshot({ path: `shots/${n}.png` }); console.log('shot', n); };
const ready = () => page.waitForFunction(() => !document.querySelector('#stage.busy') && window.__bf?.model, null, { timeout: 30000 });
await page.goto(url); await ready(); await page.waitForTimeout(1200);
// finished model, both looks
await page.click('#s-all'); await shot('02-house-finished-studio');
await page.click('#looks button[data-look=dramatic]'); await shot('03-house-finished-dramatic');
await page.click('#looks button[data-look=studio]');
// mid steps
await page.fill('#s-range', '12'); await page.dispatchEvent('#s-range', 'input'); await shot('04-house-step12-highlight');
// each preset finished in studio + dramatic
for (const id of ['tree', 'car', 'rocket', 'heart', 'robot', 'dog', 'castle']) {
  await page.click(`#presets button[data-id=${id}]`); await ready(); await page.click('#s-all');
  await shot(`05-${id}-studio`);
}
await page.click('#looks button[data-look=dramatic]'); await shot('06-castle-dramatic');
await page.click('#presets button[data-id=car]'); await ready(); await page.click('#s-all'); await shot('06-car-dramatic');
await page.click('#looks button[data-look=studio]');
// parts tab + checks
await page.click('.tabs button[data-tab=parts]'); await shot('07-parts');
await page.click('.tabs button[data-tab=checks]'); await shot('08-checks');
// settings
await page.click('#btn-settings'); await shot('09-settings'); await page.click('#prov button[data-p=local]'); await shot('09b-settings-local');
await page.keyboard.press('Escape');
// build mode
await page.click('#presets button[data-id=house]'); await ready();
await page.click('.tabs button[data-tab=build]'); await shot('10-build-start');
console.log('errors:', errors);
await browser.close();
