import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

// Prepare native resources from this checkout, without downloading or inventing cards.
if (process.argv.includes('--prepare')) {
  const pools = Object.fromEntries(['M21', 'CNS'].map(code => [code, JSON.parse(fs.readFileSync(`resources/draft-pools/${code}.json`, 'utf8'))]));
  const atomic = JSON.parse(fs.readFileSync('../phase/data/mtgjson/AtomicCards.json', 'utf8'));
  const fixture = JSON.parse(fs.readFileSync('../phase/data/mtgjson/test_fixture.json', 'utf8'));
  for (const name of new Set(Object.values(pools).flatMap(pool => Object.values(pool.prints).map(card => card.name)))) {
    assert(atomic.data[name], `Missing Oracle card: ${name}`);
    fixture.data[name] = atomic.data[name];
  }
  fs.mkdirSync('/tmp/pm-draft-data/mtgjson', { recursive: true });
  fs.writeFileSync('/tmp/pm-draft-data/draft-pools.json', JSON.stringify(pools));
  fs.writeFileSync('/tmp/pm-draft-data/mtgjson/test_fixture.json', JSON.stringify(fixture));
  console.log('Prepared /tmp/pm-draft-data with M21/CNS pools and their real Oracle cards.');
  process.exit(0);
}

const endpoint = process.env.PHASE_ONLINE_URL || 'ws://127.0.0.1:9375/ws';
const traditional = process.argv.includes('--traditional');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const draftState = page => page.evaluate(async () => (await import('/ui/phase/onlineDraft.ts')).onlineDraftStatus());
try {
  const pages = [];
  for (let seat = 0; seat < 2; seat++) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.routeWebSocket(url => url.port === '1420', socket => socket.send('{"type":"connected"}'));
    page.on('pageerror', error => console.error(error));
    await page.addInitScript(() => {
      localStorage.setItem('manabrew.promptPreferences', JSON.stringify({ state: { show: true, fullControl: true }, version: 0 }));
      localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
      localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
    });
    await page.goto('http://127.0.0.1:1420/#/play/online');
    await page.getByLabel('Server URL').fill(endpoint);
    await page.getByLabel('Your name').fill(`Drafter ${seat + 1}`);
    await page.getByRole('button', { name: 'Draft', exact: true }).click();
    pages.push(page);
  }
  await pages[0].getByLabel('Pod size').selectOption('2');
  if (traditional) await pages[0].getByLabel('Draft format').selectOption('Traditional');
  await pages[0].getByRole('button', { name: 'Create draft', exact: true }).click();
  await pages[0].getByText('Draft code:', { exact: false }).last().waitFor();
  const code = (await draftState(pages[0])).code;
  await pages[1].getByLabel('Draft code', { exact: true }).fill(code);
  await pages[1].getByRole('button', { name: 'Join draft', exact: true }).click();
  await pages[1].getByText('Drafter 1', { exact: false }).first().waitFor();
  await pages[0].getByRole('button', { name: 'Start draft', exact: true }).click();
  for (let pick = 0; pick < 60; pick++) {
    for (const page of pages) {
      await page.waitForFunction(async () => {
        const state = (await import('/ui/phase/onlineDraft.ts')).onlineDraftStatus();
        return !state.pending && (state.view?.status === 'Deckbuilding' || state.view?.current_pack?.length > 0);
      });
      const state = await draftState(page);
      assert.equal(state.error, '');
      if (state.view.status === 'Deckbuilding') continue;
      const panel = page.getByRole('region', { name: 'Online draft', exact: true });
      await panel.getByRole('button', { name: state.view.current_pack[0].name, exact: true }).first().click();
      await panel.getByRole('button', { name: /^Confirm pick/ }).click();
    }
    if ((await draftState(pages[0])).view.status === 'Deckbuilding') break;
  }
  const pools = await Promise.all(pages.map(draftState));
  for (const state of pools) { assert.equal(state.view.status, 'Deckbuilding'); assert(state.view.pool.length >= 40); }
  const firstIds = new Set(pools[0].view.pool.map(card => card.instance_id));
  assert(pools[1].view.pool.every(card => !firstIds.has(card.instance_id)));
  await pages[1].reload();
  await pages[1].getByLabel('Server URL').fill(endpoint);
  await pages[1].getByRole('button', { name: 'Draft', exact: true }).click();
  await pages[1].getByRole('button', { name: 'Reconnect draft seat', exact: true }).click();
  await pages[1].getByRole('region', { name: 'Build draft deck' }).waitFor();
  assert.deepEqual((await draftState(pages[1])).view.pool, pools[1].view.pool);
  await pages[0].getByRole('spinbutton', { name: 'Plains', exact: true }).fill('1');
  await pages[0].getByRole('button', { name: 'Submit deck', exact: true }).click();
  await pages[0].waitForFunction(async () => Boolean((await import('/ui/phase/onlineDraft.ts')).onlineDraftStatus().error));
  assert.equal((await draftState(pages[0])).view.seats[0].has_submitted_deck, false);
  for (const page of pages) {
    await page.getByRole('spinbutton', { name: 'Plains', exact: true }).fill('40');
    await page.getByRole('button', { name: 'Submit deck', exact: true }).click();
  }
  for (const page of pages) await page.waitForFunction(() => window.__pm?.getState().isGameActive && window.__pm.getState().gameView);
  for (const page of pages) await page.evaluate(() => window.__pm.subscribe(state => { if (state.gameView?.gameOver) window.__pmFinalView = state.gameView; }));
  for (let game = 0; game < (traditional ? 3 : 1); game++) {
    // Mulligans and between-game prompts are seat-addressed and sequential.
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      for (const page of pages) {
        const type = await page.evaluate(() => window.__pm.getState().currentPrompt?.input.type);
        if (type === 'sideboard') {
          assert(traditional && game > 0);
          const submittedPrompt = await page.evaluate(() => window.__pm.getState().currentPrompt.promptId);
          await page.getByRole('button', { name: 'Ready for next game', exact: true }).click().catch(async error => {
            console.error('Sideboard diagnostic', await page.evaluate(() => ({ url: location.href, active: window.__pm.getState().isGameActive, selfConceded: window.__pm.getState().selfConceded, prompt: window.__pm.getState().currentPrompt, gameOver: window.__pm.getState().gameView?.gameOver, text: document.body.innerText })));
            throw error;
          });
          await page.waitForFunction(id => !window.__pm.getState().isWaitingForResponse && window.__pm.getState().currentPrompt?.promptId !== id, submittedPrompt);
        } else if (type === 'chooseBoolean' && game > 0) {
          await page.evaluate(() => window.__pm.getState().respond({ type: 'decision', value: false }));
        } else if (type === 'mulligan') {
          await page.evaluate(() => window.__pm.getState().respond({ type: 'mulliganDecision', keep: true }));
        }
      }
      const types = await Promise.all(pages.map(page => page.evaluate(() => window.__pm.getState().currentPrompt?.input.type)));
      if (types.includes('chooseAction')) { ready = true; break; }
      await pages[0].waitForTimeout(100);
    }
    assert(ready, `Game ${game + 1} did not reach priority`);
    await pages[game === 1 ? 1 : 0].evaluate(() => window.__pm.getState().concede());
    if (traditional && game < 2) {
      await Promise.any(pages.map(page => page.waitForFunction(() => window.__pm.getState().currentPrompt?.input.type === 'sideboard')));
      for (const page of pages) assert.equal(await page.evaluate(() => Boolean(window.__pmFinalView)), false);
    }
  }
  await Promise.all(pages.map(page => page.waitForFunction(() => window.__pmFinalView?.gameOver, undefined, { timeout: 120000 })));
  for (const page of pages) {
    await page.waitForFunction(async () => (await import('/ui/phase/onlineDraft.ts')).onlineDraftStatus().view?.standings.some(row => row.match_wins === 1));
    const final = await draftState(page);
    assert.equal(final.view.standings.find(row => row.seat_index === 1).match_wins, 1);
    assert.equal(final.view.standings.find(row => row.seat_index === 0).match_losses, 1);
  }
  const firstMatch = (await draftState(pages[0])).matchCode;
  for (const page of pages) {
    await page.goto('http://127.0.0.1:1420/?draft-round-recovery=1#/play/online');
    await page.getByLabel('Server URL').fill(endpoint);
    await page.getByRole('button', { name: 'Draft', exact: true }).click();
    await page.getByRole('button', { name: 'Reconnect draft seat', exact: true }).click();
    await page.waitForFunction(async () => (await import('/ui/phase/onlineDraft.ts')).onlineDraftStatus().view?.status === 'RoundComplete');
  }
  await pages[0].getByRole('button', { name: /Start next round/ }).click();
  for (const page of pages) {
    await page.waitForFunction(() => window.__pm?.getState().isGameActive && window.__pm.getState().gameView);
    assert.notEqual((await draftState(page)).matchCode, firstMatch);
  }
  console.log(`${traditional ? 'Traditional Bo3 (three games, sideboarding and play/draw)' : 'Premier'}: private picks/pools, reconnect, invalid deck rejection, match attachment, concession, authoritative standings and next-round recovery passed.`);
} finally { await browser.close(); }
