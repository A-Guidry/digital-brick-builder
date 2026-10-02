import { chromium } from 'playwright-core';
import fs from 'fs';
const exePath = process.env.CHROME_PATH || (() => { const exe = fs.readdirSync('/opt/pw-browsers').filter(d => d.startsWith('chromium-'))[0]; return `/opt/pw-browsers/${exe}/chrome-linux/chrome`; })();
const browser = await chromium.launch({ executablePath: exePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle'] });
const url = process.env.URL || 'http://127.0.0.1:5173/';
const SZ = { phone: { width: 390, height: 844 }, small: { width: 360, height: 640 }, land: { width: 844, height: 390 } };
const which = process.argv[2] || 'phone';
const ctx = await browser.newContext({ viewport: SZ[which], isMobile: true, hasTouch: true, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
const p = await ctx.newPage(); p.setDefaultTimeout(120000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(url, { timeout: 120000 }); await p.waitForFunction(() => window.__bf?.model && !document.querySelector('#stage.busy'));
const audit = async (name) => {
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const W = document.documentElement.clientWidth, H = window.innerHeight;
    const vis = e => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
    const over = [...document.querySelectorAll('body *')].filter(e => vis(e) && !e.closest('canvas') && e.getBoundingClientRect().right > W + 1 && !e.closest('#presets, #right, #left, dialog:not([open])')).slice(0, 4).map(e => e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 20));
    const small = [...document.querySelectorAll('button, input[type=range], a')].filter(e => vis(e) && !e.closest('dialog:not([open])') && !e.closest('[hidden]')).filter(e => { const b = e.getBoundingClientRect(); return b.height < 30 || b.width < 30; }).slice(0, 6).map(e => (e.id || e.textContent.trim().slice(0, 14) || e.tagName) + ` ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);
    const pageScroll = document.documentElement.scrollHeight > H + 1;
    const nav = document.querySelector('#mnav').getBoundingClientRect();
    return { scrollW: document.documentElement.scrollWidth, W, pageScroll, over, small, navBottom: Math.round(nav.bottom), H };
  });
  console.log(name.padEnd(14), JSON.stringify(r));
  await p.screenshot({ path: `shots/m-${which}-${name}.png` });
};
await audit('create');
for (const t of ['steps', 'parts', 'checks', 'saved']) { await p.tap(`#mnav [data-m=${t}]`); await audit(t); }
await p.tap('#mnav [data-m=build]'); await audit('build-sealed');
await p.tap('.bag.can'); await p.waitForFunction(() => window.__bf.viewer.pile.count() > 3, null, { timeout: 120000 }); await p.waitForTimeout(3500); await audit('build-open');
await p.tap('#rail [data-m=create]'); await p.waitForTimeout(400); // the header is hidden while building; leave build mode first
await p.tap('#btn-profile'); await audit('profile'); await p.tap('#pf-close');
await p.tap('#btn-settings'); await audit('settings'); await p.keyboard.press('Escape');
console.log('errors', errs.length, errs.slice(0, 2));
await browser.close();
