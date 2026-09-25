import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:1420';
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew-preferences', JSON.stringify({ state: { uiLanguage: 'zh-Hans' }, version: 1 }));
  });
  await page.goto(`${base}/#/play`);
  await page.getByText('选择你的昵称', { exact: true }).waitFor({ timeout: 30000 });
  for (const text of ['与好友一起玩', '定制你的套牌', '在大厅连接服务器，然后加入房间或创建自己的房间，与其他玩家实时对战。']) {
    assert.ok(await page.getByText(text, { exact: true }).isVisible(), text);
  }
  assert.equal(await page.locator('#onboarding-nickname').getAttribute('placeholder'), '例如：风暴乌鸦');
  assert.ok(await page.getByRole('button', { name: '开始游戏', exact: true }).isDisabled());
  console.log('PASS Chinese onboarding guide and nickname form');
  // Exercise the real locale activation without remounting the onboarding page.
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => new URL(url).pathname === '/ui/i18n/i18n.ts');
    if (!url) throw new Error('App localization module was not loaded');
    const { activateLocale } = await import(url);
    await activateLocale('en');
  });
  await page.getByText('Choose your nickname', { exact: true }).waitFor();
  assert.ok(await page.getByText('Play with friends', { exact: true }).isVisible());
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(url => new URL(url).pathname === '/ui/i18n/i18n.ts');
    const { activateLocale } = await import(url);
    await activateLocale('zh-Hans');
  });
  await page.getByText('选择你的昵称', { exact: true }).waitFor();
  assert.ok(await page.getByText('与好友一起玩', { exact: true }).isVisible());
  console.log('PASS onboarding updates immediately on locale changes');

  await page.evaluate(() => localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() })));
  await page.goto(`${base}/#/settings`);
  await page.reload();
  await page.getByText('横向拖动卡牌来自定义顺序，或始终按颜色或法术力值自动排列手牌。', { exact: true }).waitFor({ timeout: 30000 });
  const text = await page.locator('body').innerText();
  assert.ok(!text.includes('Drag cards sideways'), 'hand sorting description is translated');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('PASS Chinese settings hand sorting');
} finally {
  await browser.close();
}
