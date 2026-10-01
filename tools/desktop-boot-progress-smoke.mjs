// Run after `npm run build`: node tools/desktop-boot-progress-smoke.mjs
// Exercises the actual production desktop entry, with only native IPC mocked.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const dist = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL ?? 'chrome' });
try {
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://tauri.localhost') return route.abort();
      const file = resolve(dist, `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`);
      assert.ok(file.startsWith(dist + sep));
      try {
        await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] ?? 'application/octet-stream' });
      } catch {
        await route.fulfill({ status: 404, body: 'Not found' });
      }
    });
    await page.addInitScript(mode => {
      localStorage.setItem('theme', mode);
      const callbacks = new Map();
      let nextId = 0;
      window.__TAURI_INTERNALS__ = {
        transformCallback(callback) { const id = ++nextId; callbacks.set(id, callback); return id; },
        async invoke(command, args) {
          if (command === 'plugin:event|listen') {
            if (args.event === 'desktop-boot-progress') {
              window.testProgress = payload => callbacks.get(args.handler)({ event: args.event, id: 1, payload });
            }
            return 1;
          }
          if (command === 'boot_desktop') {
            if (!window.testProgress) throw new Error('Must subscribe before boot');
            window.bootStarted = true;
            return new Promise(() => {});
          }
          return null;
        },
      };
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    }, theme);
    await page.goto('http://tauri.localhost/');
    await page.waitForFunction(() => window.bootStarted);
    const fill = page.locator('[style*="width:"][class*="from-primary"]');
    for (const percent of [10, 50, 90]) {
      await page.evaluate(value => window.testProgress({ stage: 'downloading', received: value * 1048576, total: 100 * 1048576 }), percent);
      await page.waitForTimeout(300);
      const state = await fill.evaluate(el => {
        const style = getComputedStyle(el);
        return {
          width: el.getBoundingClientRect().width / el.parentElement.clientWidth * 100,
          background: style.backgroundColor,
          gradient: style.backgroundImage,
          primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
        };
      });
      console.log(theme, percent, state);
      assert.ok(Math.abs(state.width - percent) < 1, 'Fill tracks actual downloaded bytes');
      assert.ok(state.gradient !== 'none' || state.background !== 'rgba(0, 0, 0, 0)', 'Progress fill must have a visible color');
      assert.ok(await page.evaluate(() => CSS.supports('color', getComputedStyle(document.documentElement).getPropertyValue('--primary').trim())), 'Theme token must be a valid CSS color');
    }
    await page.evaluate(() => window.testProgress({ stage: 'downloading', received: 20 * 1048576, total: null }));
    await page.waitForTimeout(300);
    assert.ok(await fill.evaluate(el => el.getBoundingClientRect().width > 0), 'Unknown total still shows a visible indicator');
    await mkdir('.phase-mana', { recursive: true });
    await page.screenshot({ path: `.phase-mana/desktop-boot-progress-${theme}.png` });
    await page.close();
  }
  console.log('Desktop boot progress: PASS (dark/light, 10/50/90%, unknown total)');
} finally {
  await browser.close();
}
