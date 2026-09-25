import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew-preferences', JSON.stringify({ state: { uiLanguage: 'zh-Hans' }, version: 1 }));
  });
  for (const route of ['/play', '/play/offline/constructed', '/play/offline/casual']) {
    await page.goto(`http://127.0.0.1:1420/#${route}`);
    await page.waitForFunction(() => /[\u3400-\u9fff]/.test(document.body.innerText), undefined, { timeout: 20000 });
    await page.waitForTimeout(2000);
    const text = await page.locator('body').innerText();
    assert.match(text, /[\u3400-\u9fff]/, `Chinese UI at ${route}`);
    for (const forbidden of ['Ready to play?', 'Start a match your way', 'Your Decks', 'No decks yet', 'Local play against the AI']) {
      assert.ok(!text.includes(forbidden), `${route} still displays ${forbidden}`);
    }
    if (route.endsWith('/constructed')) {
      assert.ok(text.includes('你的套牌'), 'Chinese deck section must actually render');
      assert.ok(text.includes('还没有套牌——前往我的套牌构筑一套吧。'), 'Chinese empty state with its link must render');
    }
    console.log(`PASS ${route}`);
  }
  assert.deepEqual(errors, [], 'no browser runtime errors');
} finally {
  await browser.close();
}
