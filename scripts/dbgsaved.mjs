import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage(); p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://127.0.0.1:5173/'); await p.waitForFunction(() => window.__bf?.model, null, {timeout:90000});
await p.click('.tabs button[data-tab=saved]');
console.log(await p.locator('#tab-saved').innerText());
console.log(await p.evaluate(() => localStorage.getItem('dbb.profile.v1')?.slice(0,300)));
await b.close();
