/** Chrome smoke: actual app theme selection and native option contrast.
 * SMOKE_BASE_URL defaults to http://127.0.0.1:1420.
 * This checks computed styles; OS popup rendering still needs a visual check.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:1420';
const browser = await chromium.launch({channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless:true});
try {
  for (const theme of ['dark', 'light']) {
    const context = await browser.newContext({viewport:{width:1440,height:900}});
    await context.addInitScript((mode) => {
      localStorage.setItem('theme', mode);
      localStorage.setItem('manabrew.termsAcceptance',JSON.stringify({version:'1.5.0',acceptedAt:new Date().toISOString()}));
      localStorage.setItem('manabrew.onboarding',JSON.stringify({version:'1.0',acceptedAt:new Date().toISOString()}));
      localStorage.setItem('manabrew-preferences',JSON.stringify({state:{uiLanguage:'en'},version:1}));
    }, theme);
    const page = await context.newPage();
    await page.goto(`${base}/#/play/offline`);
    await page.waitForFunction(() => {
      const option = document.querySelector('option[value="VeryHard"]');
      return option && getComputedStyle(option).backgroundColor !== 'rgba(0, 0, 0, 0)';
    }, null, {timeout:60000});
    const report = await page.evaluate(() => {
      const option = document.querySelector('option[value="VeryHard"]');
      const style = getComputedStyle(option);
      const lum = value => {
        const rgb = (value.match(/[\d.]+/g) || []).slice(0,3).map(Number).map(v => {
          const x = v/255; return x <= .04045 ? x/12.92 : ((x+.055)/1.055)**2.4;
        });
        return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2];
      };
      const bg = lum(style.backgroundColor), fg = lum(style.color);
      return {scheme:getComputedStyle(document.documentElement).colorScheme, background:style.backgroundColor,color:style.color,bg,fg,contrast:(Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)};
    });
    console.log(theme, report);
    assert.equal(report.scheme,theme);
    assert.ok(report.contrast>=4.5,`${theme}: contrast below 4.5:1`);
    assert.ok(theme==='dark' ? report.bg<report.fg : report.bg>report.fg,`${theme}: app theme did not apply`);
    await context.close();
  }
  console.log('PASS native difficulty option colors, dark and light');
} finally { await browser.close(); }
