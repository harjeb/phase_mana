// Run with Vite and the host using M21 booster resources (see README).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('console', m => { if (m.text().startsWith('smoke:')) console.log(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
  });
  // Set discovery and opening packs must work without Scryfall/network access.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost'
      ? route.continue() : route.abort();
  });
  await page.goto('http://127.0.0.1:1420/#/limited');
  await page.getByRole('searchbox').fill('M21');
  await page.getByRole('button', { name: /Core Set 2021/ }).click();
  await page.getByRole('button', { name: 'Start Draft', exact: true }).click();
  await page.waitForURL(/#\/draft\//);
  const result = await page.evaluate(async () => {
    const { getPlatform } = await import('/ui/platform/index.ts');
    const invoke = (command, args) => getPlatform().invoke(command, args);
    const pool = await invoke('limited_get_set_pool', { setCode: 'M21' });
    let draft = await invoke('limited_start_booster_draft', { setup: { pool, podSize: 8, rounds: 3, seed: 42 } });
    const initial = JSON.stringify(draft);
    const pick = s => {
      const c = s.currentPack[0];
      return invoke('limited_pick_card', { sessionId: s.sessionId, cardName: c.name, setCode: c.setCode, cardNumber: c.cardNumber });
    };
    const first = await pick(draft);
    const undone = await invoke('limited_undo_pick', { sessionId: draft.sessionId });
    if (JSON.stringify(undone) !== initial) throw new Error('Undo changed the draft');
    draft = await pick(undone);
    if (JSON.stringify(draft) !== JSON.stringify(first)) throw new Error('Undo failed to restore bot RNG');
    console.log('smoke: drafting');
    while (!draft.isComplete) draft = await pick(draft);
    console.log('smoke: opening Sealed');
    const sealed = await invoke('limited_start_sealed', { setup: { pool, poolType: 'Full', numBoosters: 6, seed: 42 } });
    console.log('smoke: special modes');
    const winston = await invoke('limited_start_winston', { setup: { pool, poolPacks: 6, seed: 3 } });
    if (!winston.awaitingHuman || winston.piles.length !== 3) throw new Error('Winston did not start');
    const afterTake = await invoke('limited_winston_take', { sessionId: winston.sessionId });
    if (afterTake.sessionId !== winston.sessionId) throw new Error('Winston take failed');
    const cubePool = Array.from({ length: 120 }, (_, i) => ({ id: `cube-${i}`, name: `Cube Card ${i}`, setCode: 'CUBE', cardNumber: String(i) }));
    const cube = await invoke('limited_start_booster_draft', { setup: { pool: cubePool, podSize: 2, rounds: 3, customPool: true, seed: 4 } });
    if (cube.currentPack.length !== 15) throw new Error('Cube draft did not start');
    const commanderDraft = await invoke('limited_start_commander_draft', { setup: { pool, podSize: 4, seed: 6 } });
    if (commanderDraft.picksPerPass !== 2 || commanderDraft.seatSummaries.length !== 4) throw new Error('Commander draft did not start');
    // A real Commander set has even 20-card packs, so a two-card step always fits.
    const cmr = await invoke('limited_get_set_pool', { setCode: 'CMR' });
    let cd = await invoke('limited_start_commander_draft', { setup: { pool: cmr, podSize: 4, seed: 9 } });
    const commanderDraftId = cd.sessionId;
    let cdStep = 0;
    while (!cd.isComplete) {
      for (let i = 0; i < 2 && !cd.isComplete; i++) {
        const pack = cd.currentPack;
        const c = pack[cdStep++ % pack.length];
        cd = await invoke('limited_pick_card', { sessionId: commanderDraftId, cardName: c.name, setCode: c.setCode, cardNumber: c.cardNumber });
      }
    }
    if (cd.pickedPile.length !== 60) throw new Error('Commander draft did not complete');
    return { draft, sealed, winston, cube, commanderDraft, commanderDraftId };
  });
  console.log('smoke: pools complete');
  assert.equal(result.draft.pickedPile.length, 45);
  assert.equal(result.draft.seatSummaries.length, 8);
  assert.equal(result.sealed.cards.length, 90);
  assert.equal(result.sealed.aiDecks.length, 7);
  assert.equal(result.winston.piles.length, 3);
  assert.equal(result.cube.currentPack.length, 15);
  assert.equal(result.commanderDraft.picksPerPass, 2);
  assert.equal(result.commanderDraft.seatSummaries.length, 4);
  await page.goto(`http://127.0.0.1:1420/#/sealed/${result.sealed.sessionId}`);
  await page.getByRole('button', { name: 'Start Gauntlet', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start Gauntlet', exact: true }).click();
  await page.getByRole('button', { name: 'Play Match', exact: true }).waitFor();
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/start'));
  await page.getByRole('button', { name: 'Play Match', exact: true }).click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, await response.text());
  await page.waitForFunction(() => window.__pm?.getState().currentPrompt?.input?.type === 'mulligan');
  assert.deepEqual(await page.evaluate(() => window.__pm.getState().gameView.players.map(p => p.life)), [20, 20]);
  await page.evaluate(async () => {
    const { startLocalDeckGame } = await import('/ui/phase/transport.ts');
    const deck = Array(99).fill('Plains');
    const commanders = ['Linden, the Steadfast Queen'];
    await startLocalDeckGame({ format: 'commander', humanDeck: deck, aiDeck: deck,
      humanCommanders: commanders, aiCommanders: commanders,
      extraOpponents: [{ deck, commanders }, { deck, commanders }] });
  });
  await page.waitForFunction(() => window.__pm?.getState().gameView.players.length === 4);
  assert.deepEqual(await page.evaluate(() => window.__pm.getState().gameView.players.map(p => p.life)), [40, 40, 40, 40]);
  await page.screenshot({ path: '/tmp/phase-four-player.png' });
  // Commander Draft builder UI: the completed draft shows a commander picker.
  await page.goto(`http://127.0.0.1:1420/#/draft/${result.commanderDraftId}`);
  await page.getByRole('button', { name: /Need \d+ more cards|Play 4-player Commander/ }).waitFor();
  await page.locator('select').first().waitFor();
  const commanderOptions = await page.locator('select').first().locator('option').count();
  assert.ok(commanderOptions > 0, 'commander picker must list drafted commanders');
  assert.deepEqual(errors, []);
  console.log('Browser smoke passed: 8-seat draft/undo, six-pack Sealed, builder → gauntlet → real game, Winston, cube, Commander Draft, four-player Commander snapshot.');
} finally { await browser.close(); }
