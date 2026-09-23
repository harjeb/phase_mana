import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('response', async response => {
    if (response.url().includes('/api/') && response.status() >= 400) console.error(response.status(), await response.text());
  });

  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
  });
  await page.goto('http://127.0.0.1:1420/#/play/offline/constructed');
  await page.getByRole('button', { name: '+ Custom', exact: true }).click();
  await page.getByRole('button', { name: 'New format', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Browser custom');
  await page.getByLabel('Starting life', { exact: true }).fill('30');
  await page.getByLabel('Banned cards (one name per line)', { exact: true }).fill('Thalia, Guardian of Thraben\nBlack Lotus');
  // This must reach the live host, not merely pass local shape validation.
  const validationResponse = page.waitForResponse(response =>
    response.url().endsWith('/api/custom-formats/validate') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Validate & save', exact: true }).click();
  const validated = await validationResponse;
  assert.equal(validated.status(), 200);
  assert.deepEqual(await validated.json(), { valid: true, reasons: [] });
  const submitted = validated.request().postDataJSON();
  assert.equal(submitted.playerCount, 2);
  assert.deepEqual(submitted.rules.structural.deck_size, { type: 'Minimum', data: 60 });
  assert.deepEqual(submitted.rules.structural.default_deck_copy_limit, { type: 'UpTo', data: 4 });
  assert.deepEqual(submitted.rules.structural.sideboard_policy, { type: 'Limited', data: 15 });
  await page.getByText('Browser custom', { exact: true }).waitFor();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('phase-mana:custom-formats')));
  assert.equal(saved.version, 1);
  assert.equal(saved.formats[0].rules.structural.starting_life, 30);
  assert.deepEqual(saved.formats[0].rules.legality.banned, ['Thalia, Guardian of Thraben', 'Black Lotus']);
  await page.reload();
  await page.getByRole('button', { name: '+ Custom', exact: true }).click();
  await page.getByText('Browser custom', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  assert.equal(await page.getByLabel('Starting life', { exact: true }).inputValue(), '30');
  await page.screenshot({ path: '/tmp/pm-custom-format-editor.png', fullPage: true });
  await page.getByLabel('Deck size rule', { exact: true }).selectOption('Exactly');
  await page.getByLabel('Copy limit rule', { exact: true }).selectOption('Unlimited');
  await page.getByLabel('Sideboard policy', { exact: true }).selectOption('Forbidden');
  await page.getByRole('button', { name: 'Validate & save', exact: true }).click();
  await page.getByText('Browser custom', { exact: true }).waitFor();
  const edited = await page.evaluate(() => JSON.parse(localStorage.getItem('phase-mana:custom-formats')).formats[0]);
  assert.deepEqual(edited.rules.structural.deck_size, { type: 'Exactly', data: 60 });
  assert.deepEqual(edited.rules.structural.default_deck_copy_limit, { type: 'Unlimited' });
  assert.deepEqual(edited.rules.structural.sideboard_policy, { type: 'Forbidden' });
  assert.deepEqual(edited.rules.legality.banned, ['Thalia, Guardian of Thraben', 'Black Lotus']);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  // Exercise the saved rules through the real store/platform/host pipeline.
  const started = await page.evaluate(async () => {
    const { useGameStore } = await import('/ui/stores/useGameStore.ts');
    const rules = JSON.parse(localStorage.getItem('phase-mana:custom-formats')).formats[0].rules;
    const deck = { name: 'Custom browser fixture', format: 'standard',
      cards: Array.from({ length: 60 }, () => ({ identity: { name: 'Plains' } })), sideboard: [] };
    return useGameStore.getState().startGame(deck, 'standard', undefined, [deck], undefined, [], rules);
  });
  assert.equal(started, true);
  await page.waitForFunction(() => window.__pm?.getState().currentPrompt?.input?.type === 'mulligan');
  assert.deepEqual(await page.evaluate(() => window.__pm.getState().gameView.players.map(player => player.life)), [30, 30]);
  await page.evaluate(() => window.__pm.getState().respond({ type: 'mulliganDecision', keep: true }));
  await page.waitForFunction(() => window.__pm.getState().currentPrompt?.input?.type === 'chooseAction');
  await page.evaluate(() => window.__pm.getState().concede());
  await page.waitForFunction(() => window.__pm.getState().gameView?.gameOver);
  assert.deepEqual(errors, []);
  console.log('Custom format editor, persistence, native startup, mulligan, priority, and concession passed.');
} finally { await browser.close(); }
