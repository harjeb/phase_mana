// Browser integration of the real printed preview, without changing a running game.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => console.error('PAGE', error.message));
  await page.goto(process.env.SMOKE_BASE_URL || 'http://127.0.0.1:1420');
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    const { CardPreview } = await import('/ui/components/game/CardPreview.tsx');
    // Use Vite's exact versioned URLs; a second unversioned import creates a
    // separate context and does not reproduce the application's provider tree.
    const dependency = name => performance.getEntriesByType('resource').map(e => e.name)
      .find(url => url.includes(`/deps/${name}.js?v=`));
    const react = await import(dependency('react'));
    const { createElement } = react.default ?? react;
    const dom = await import(dependency('react-dom_client'));
    const { createRoot } = dom.default ?? dom;
    const { I18nProvider } = await import(dependency('@lingui_react'));
    const { i18n } = await import('/ui/i18n/i18n.ts');
    const { messages } = await import('/ui/i18n/locales/zh-Hans/messages.po');
    i18n.loadAndActivate({ locale: 'zh-Hans', messages });
    const card = {
      id: 'keyword-smoke', identity: { name: 'Concordia Pegasus', setCode: 'm19', cardNumber: '7', isToken: false },
      color: 'W', manaCost: '{1}{W}', cmc: 2, types: ['Creature'], subtypes: ['Pegasus'], supertypes: [],
      power: '1', toughness: '3', classLevels: [], sagaChapters: [], text: 'Flying', choices: [],
      controllerId: 'player-1', ownerId: 'player-1', keywords: ['Flying'], counters: {}, attachmentIds: [], mergedCardIds: [],
      isDoubleFaced: false, isTransformed: false, isFaceDown: false,
    };
    const target = document.createElement('div');
    document.body.append(target);
    const root = createRoot(target);
    window.__renderKeywordPreview = (changes = {}, props = {}) => root.render(createElement(I18nProvider, { i18n }, createElement(CardPreview, {
      card: { ...card, ...changes }, mouseX: 450, mouseY: 300, skipEnterAnimation: true, ...props,
    })));
    window.__renderKeywordPreview();
  });
  const panel = page.locator('[data-keyword-help]');
  await panel.waitFor({ state: 'visible' });
  assert.match(await panel.innerText(), /飞行.*此生物只能被具飞行或延势异能的生物阻挡。/s);
  const bounds = await panel.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1440 && bounds.y >= 0 && bounds.y + bounds.height <= 900);
  await page.screenshot({ path: 'tools/keyword-preview-smoke.png' });
  await page.evaluate(() => window.__renderKeywordPreview({}, { mouseX: 1410, mouseY: 870 }));
  await page.waitForTimeout(300);
  const edge = await panel.boundingBox();
  assert.ok(edge.x >= 0 && edge.x + edge.width <= 1440 && edge.y >= 0 && edge.y + edge.height <= 900);
  await page.evaluate(() => window.__renderKeywordPreview({
    identity: { name: 'Consult the Star Charts', setCode: 'eoe', cardNumber: '51', isToken: false },
    types: ['Instant'], text: 'Kicker {1}{U}', keywords: ['Kicker(Cost { shards: [Blue], generic: 1 })'],
  }));
  await page.waitForFunction(() => document.querySelector('[data-keyword-help]')?.textContent.includes('你施放此咒语时可以额外支付'));
  assert.match(await panel.innerText(), /增幅/);
  assert.doesNotMatch(await panel.innerText(), /Cost|shards|generic/);
  await page.waitForFunction(() => [...document.querySelectorAll('[data-keyword-help] img')]
    .every(img => img.complete && img.naturalWidth > 0), null, { timeout: 20000 });
  assert.equal(await panel.locator('img[alt="{1}"]').count(), 2);
  assert.equal(await panel.locator('img[alt="{U}"]').count(), 2);
  await page.screenshot({ path: 'tools/keyword-preview-kicker-smoke.png' });
  await page.evaluate(() => window.__renderKeywordPreview({ keywords: ['Landfall', 'Radiance'] }));
  await page.waitForFunction(() => document.querySelector('[data-keyword-help]')?.textContent.includes('牌面示例'));
  assert.match(await panel.innerText(), /牌面示例：Avenger of Zendikar/);
  assert.match(await panel.innerText(), /牌面示例：Bathe in Light/);
  await page.screenshot({ path: 'tools/keyword-preview-examples-smoke.png' });
  await page.evaluate(() => window.__renderKeywordPreview({ keywords: [
    'Flying', 'First strike', 'Double strike', 'Trample', 'Deathtouch', 'Lifelink',
    'Vigilance', 'Haste', 'Reach', 'Defender', 'Menace', 'Indestructible', 'Hexproof',
    'Shroud', 'Flash', 'Fear', 'Intimidate', 'Skulk', 'Shadow', 'Infect',
  ] }));
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-keyword-help]');
    return panel && panel.scrollHeight > panel.clientHeight;
  });
  await panel.hover();
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => document.querySelector('[data-keyword-help]').scrollTop > 0);
  assert.equal(await panel.evaluate(el => getComputedStyle(el).overscrollBehaviorY), 'contain');
  await panel.focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => {
    const panel = document.querySelector('[data-keyword-help]');
    return panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 2;
  });
  await page.evaluate(() => window.__renderKeywordPreview({ keywords: [] }));
  await panel.waitFor({ state: 'detached' });
  await page.evaluate(() => window.__renderKeywordPreview({ isFaceDown: true }));
  await panel.waitFor({ state: 'detached' });
  console.log('PASS real CardPreview: Chinese flying and live-format kicker reminders visible, edge placement, long-list wheel/keyboard scrolling, empty keywords, face-down suppression');
} finally {
  await browser.close();
}
