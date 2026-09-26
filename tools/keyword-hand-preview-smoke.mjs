// Read-only mirror of the running local game. Does not start a game or send actions.
// Exercises actual Game -> BoardCanvas -> Pixi hand pointer events, not a mounted mock.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:1420';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.error('PAGE', e.message));
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({version:'1.5.0',acceptedAt:new Date().toISOString()}));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({version:'1.0',acceptedAt:new Date().toISOString()}));
    localStorage.setItem('manabrew-preferences', JSON.stringify({state:{uiLanguage:'zh-Hans',handCardStyle:'printed',inGameCardPreviewStyle:'printed'},version:1}));
  });
  await page.goto(base + '/#/play');
  await page.waitForTimeout(3000);
  await page.evaluate(async (kickerFixture) => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(url => /\/ui\/phase\/transport\.ts(?:\?|$)/.test(url)) || '/ui/phase/transport.ts';
    const { requestSnapshot, acceptSnapshot } = await import(url);
    const snapshot = await requestSnapshot('state');
    if (kickerFixture) {
      // Browser-local fixture only: never POST or replace the server's game.
      const card = snapshot.state.gameView.zones.find(z => z.zone === 'hand' && z.ownerId === snapshot.humanPlayerId)?.cards[0];
      if (!card) throw new Error('Need a visible hand card for the local kicker fixture');
      Object.assign(card, {
        identity: { name: 'Consult the Star Charts', setCode: 'eoe', cardNumber: '51', isToken: false },
        types: ['Instant'], subtypes: [], text: 'Kicker {1}{U}', manaCost: '{1}{U}',
        power: null, toughness: null, keywords: ['Kicker(Cost { shards: [Blue], generic: 1 })'],
      });
    }
    acceptSnapshot(snapshot);
    window.location.hash = '/game/keyword-preview-smoke';
  }, process.env.KICKER_FIXTURE === '1');
  await page.waitForTimeout(7000);
  await page.screenshot({ path: 'tools/keyword-hand-before.png' });
  // Sweep the real hand fan, waiting for its hover-lift animation and React bridge.
  let found = false;
  for (const y of [830, 780, 720, 670]) {
    for (let x = 300; x < 1200; x += 45) {
      await page.mouse.move(x, y);
      await page.waitForTimeout(350);
      const panel = page.locator('[data-hand-preview-help] [data-keyword-help]');
      if (await panel.count() && /增幅|系命|跃迁/.test(await panel.innerText())) {
        assert.match(await panel.innerText(), /你施放此咒语时可以额外支付|此生物所造成的伤害会让你获得等量的生命|你可以支付跃迁费用来从手上施放此牌/);
        if (/跃迁/.test(await panel.innerText())) {
          assert.match(await panel.innerText(), /飞行/);
          assert.equal(await panel.locator('dt').count(), 2);
        }
        await page.waitForFunction(() => [...document.querySelectorAll('[data-hand-preview-help] img')].every(img => img.complete && img.naturalWidth > 0));
        await page.screenshot({ path: process.env.KICKER_FIXTURE === '1' ? 'tools/keyword-hand-kicker-smoke.png' : 'tools/keyword-hand-preview-smoke.png' });
        console.log('PASS actual game hand hover: sourced keyword tooltip is visible without clicking Show rules', {x,y});
        found = true;
        break;
      }
    }
    if (found) break;
  }
  assert.ok(found, 'No keyword tooltip found in running game hand; keep a kicker, lifelink or Flying + Warp card in hand for this read-only smoke.');
} finally { await browser.close(); }
