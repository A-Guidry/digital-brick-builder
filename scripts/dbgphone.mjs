import { chromium } from 'playwright-core';
import fs from 'fs';
const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0];
const b = await chromium.launch({ executablePath: `/opt/pw-browsers/${exe}/chrome-linux/chrome`, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-gl=angle'] });
const p = await (await b.newContext({ viewport: { width: 375, height: 740 } })).newPage();
await p.goto('http://127.0.0.1:5173/', { timeout: 120000 }); await p.waitForFunction(() => window.__bf?.model, null, { timeout: 90000 });
console.log(await p.evaluate(() => { const W = document.documentElement.clientWidth; return { sw: document.documentElement.scrollWidth, W, over: [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > W + 1).slice(0, 8).map(e => e.tagName + '#' + e.id + '.' + e.className + ' ' + Math.round(e.getBoundingClientRect().right)) }; }));
await b.close();
