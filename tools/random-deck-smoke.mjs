import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew-preferences', JSON.stringify({ state: { uiLanguage: 'zh-Hans' }, version: 1 }));
  });
  // A bounded offline catalog proves format filtering without relying on the
  // changing shipped catalog or any external card service.
  await context.route('**/preset_decks/**', route => {
    const id = route.request().url().split('/').pop().replace('.json', '');
    const ids = ['random-standard', 'random-modern', 'random-excluded'];
    const json = id === 'index' ? ids : {
      id, label: id, desc: 'Random deck test', color: 'G',
      format: id === 'random-modern' ? 'modern' : 'standard',
      engines: id === 'random-excluded' ? ['Ironsmith'] : ['Forge'],
      cards: [{ name: 'Forest', count: 60, set: 'm21', cardNumber: '274', types: ['Land'], uris: {} }],
    };
    return route.fulfill({ json });
  });
  const page = await context.newPage();
  await page.goto(`${process.env.SMOKE_BASE_URL || 'http://127.0.0.1:1420'}/#/play/offline`);
  const player = page.getByRole('button', { name: '随机己方套牌', exact: true });
  const opponent = page.getByRole('button', { name: '随机 AI 套牌', exact: true }).first();
  await player.waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: '标准', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('随机己方套牌') && !b.disabled));
  await player.click();
  await opponent.click();
  assert.equal(await page.getByRole('button').filter({ hasText: /random-standard/ }).count() >= 2, true);
  // Both random buttons remain usable after selection, even with no search matches.
  await page.getByRole('textbox', { name: '筛选套牌', exact: true }).fill('no-matching-deck');
  await player.click();
  await opponent.click();
  await page.getByRole('button', { name: '摩登', exact: true }).click();
  await player.click();
  await opponent.click();
  assert.equal(await page.getByRole('button').filter({ hasText: /random-modern/ }).count(), 2);
  await page.getByRole('button', { name: '薪传', exact: true }).click();
  assert.equal(await player.isDisabled(), true);
  assert.equal(await opponent.isDisabled(), true);
  console.log('PASS Chinese random deck controls: both sides, repeat selection, format/engine filtering, search independence, empty pool');
} finally {
  await browser.close();
}
