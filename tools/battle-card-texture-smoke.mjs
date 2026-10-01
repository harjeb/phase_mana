// Exercises the actual battle renderer in Chrome, without rebuilding the app.
// The local image route redirects to Scryfall, modelling an absent image folder.
// Run: node tools/battle-card-texture-smoke.mjs (requires Chrome and internet).
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { port: 1439, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.route('http://127.0.0.1:1439/', async route => route.fulfill({
    contentType: 'text/html',
    body: await server.transformIndexHtml('/', '<!doctype html>'),
  }));
  await page.route('**/card-images/**', route => {
    const url = new URL(route.request().url());
    const fallback = url.searchParams.get('fallback');
    return fallback
      ? route.fulfill({ status: 302, headers: { location: fallback } })
      : route.fulfill({ status: 404, body: 'No local image folder' });
  });
  // Avoid starting the app shell; imports still run through the normal Vite transforms.
  await page.addInitScript(() => { window.__APP_VERSION__ = 'renderer-smoke'; });
  await page.goto('http://127.0.0.1:1439/');
  const result = await page.evaluate(async () => {
    const { useScryfallStore } = await import('/ui/stores/useScryfallStore.ts');
    // Reuse Vite's exact Pixi module URL, including its dependency version query.
    const source = await (await fetch('/ui/stores/useScryfallStore.ts')).text();
    const pixiPath = source.match(/from "([^"]*pixi[^"]*)"/)[1];
    const { Application } = await import(pixiPath);
    const { useGameStore } = await import('/ui/stores/useGameStore.ts');
    const { CardSprite } = await import('/ui/pixi/CardSprite.ts');
    const { GAME_CARD_DEFAULTS } = await import('/ui/lib/gameCard.ts');
    const { asGameDeckCard } = await import('/ui/lib/decks.ts');
    const { getPlatformType } = await import('/ui/platform/index.ts');
    const response = await fetch('https://api.scryfall.com/cards/named?exact=Grizzly%20Bears');
    if (!response.ok) throw new Error(`Scryfall metadata: HTTP ${response.status}`);
    const record = await response.json();
    const deckCard = {
      identity: { id: record.id, name: record.name, setCode: record.set, cardNumber: record.collector_number },
      uris: record.image_uris,
    };
    useGameStore.setState({ gameDecks: { 'player-0': { name: 'test', cards: [deckCard], sideboard: [] } } });
    const card = {
      ...GAME_CARD_DEFAULTS, id: 'test', ownerId: 'engine-owner',
      identity: { name: record.name, setCode: record.set.toUpperCase(), cardNumber: record.collector_number },
      types: ['Creature'], subtypes: ['Bear'], power: 2, toughness: 2,
    };
    if (asGameDeckCard(useGameStore.getState().gameDecks, card) !== deckCard) {
      throw new Error('Engine identity failed to resolve the existing deck card');
    }
    // Regression: Chinese battle art must use the same saved URLs as the deck
    // browser even when optional metadata is unavailable. Keep the real texture
    // loader and renderer; only the metadata dependency is failed deliberately.
    useScryfallStore.setState({
      locale: 'zhs',
      cards: {},
      getCard: async () => { throw new Error('Regression fixture: metadata unavailable'); },
    });
    const store = useScryfallStore.getState();
    const [full, shared] = await Promise.all([store.getCardTexture(deckCard), store.getCardTexture(deckCard)]);
    if (full !== shared || full !== await store.getCardTexture(deckCard)) {
      throw new Error('Concurrent or cached texture requests did not share a texture');
    }
    const art = await store.getCardTexture(deckCard, 'art');
    if (art === full || art.width < 2) throw new Error('Battlefield art crop failed');
    const app = new Application();
    await app.init({ width: 200, height: 280, preference: 'webgl' });
    document.body.appendChild(app.canvas);
    const painted = [];
    for (const kind of ['hand', 'battlefield']) {
      const sprite = new CardSprite(card, kind);
      sprite.position.set(100, 140);
      app.stage.addChild(sprite);
      const deadline = performance.now() + 15000;
      while (!sprite.imageSettled) {
        if (performance.now() > deadline) throw new Error(`${kind} image timed out`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (!sprite.imageLoaded) throw new Error(`${kind} kept its placeholder`);
      app.render();
      const pixels = app.renderer.extract.pixels(app.stage).pixels;
      if (!pixels.some((value, index) => index % 4 !== 3 && value > 0)) {
        throw new Error(`${kind} produced no GPU color pixels`);
      }
      painted.push(kind);
      app.stage.removeChild(sprite);
      sprite.destroy({ children: true });
    }
    // Destroying a card sprite must not destroy the shared texture used by other cards.
    if (full.destroyed || full.source.destroyed) throw new Error('Sprite destroyed shared art');
    app.destroy(true);
    return { platform: getPlatformType(), locale: store.locale, metadata: 'unavailable', full: [full.width, full.height], art: [art.width, art.height], painted };
  });
  assert.equal(result.platform, 'web');
  assert.deepEqual(result.painted, ['hand', 'battlefield']);
  assert.deepEqual(failures, []);
  console.log('PASS: DOM-source redirect -> actual Pixi texture store/cache -> hand and battlefield CardSprite -> WebGL pixels', result);
} finally {
  await browser?.close();
  await server.close();
}
