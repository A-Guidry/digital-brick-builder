import { chromium } from 'playwright-core';
import fs from 'fs';
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0];
const browser = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 640 }, deviceScaleFactor: 1 })).newPage();
await page.goto('http://127.0.0.1:5173/');
await page.waitForFunction(() => !document.querySelector('#stage.busy') && window.__bf?.model, null, { timeout: 30000 });
await page.addStyleTag({ content: '#hud,#banner{display:none!important}' });
const ids = await page.$$eval('#presets button', b => b.map(x => x.dataset.id));
for (const id of ids) {
  await page.click(`#presets button[data-id=${id}]`);
  await page.waitForFunction(() => !document.querySelector('#stage.busy'));
  await page.click('#s-all');
  await page.waitForTimeout(1500);
  await page.locator('#view').screenshot({ path: `shots/thumbs/${id}.png` });
  console.log('thumb', id);
}
await browser.close();
