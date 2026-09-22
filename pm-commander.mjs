// GUI smoke: existing preset picker -> Commander 1v1 -> real engine snapshot.
// Run with the release host and Vite running: node pm-commander.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
  });
  await page.goto('http://127.0.0.1:1420/#/play/offline');
  await page.getByRole('button', { name: 'Neheb, the Worthy', exact: true }).click();
  await page.locator('button[aria-label="Ognis"]').click();
  await page.getByRole('button', { name: 'Fight!', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fight', exact: true }).click();
  assert.ok(await page.getByRole('dialog').getByRole('button', { name: /4-player pod/ }).isDisabled());
  const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/start'), { timeout: 120000 });
  await page.getByRole('dialog').getByRole('button', { name: /1v1 You and one/ }).click();
  const response = await responsePromise;
  const data = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(data));
  const request = response.request().postDataJSON();
  assert.equal(request.format, 'commander');
  assert.equal(request.humanDeck.length, 99);
  assert.equal(request.aiDeck.length, 99);
  assert.deepEqual(request.humanCommanders, ['Neheb, the Worthy']);
  assert.deepEqual(request.aiCommanders, ["Ognis, the Dragon's Lash"]);
  await page.waitForFunction(() => window.__pm?.getState().currentPrompt?.input?.type === 'mulligan');
  const state = await page.evaluate(() => {
    const s = window.__pm.getState();
    return { prompt: s.currentPrompt.input.type, players: s.gameView.players.map(p => ({ life: p.life, command: p.commandZone.map(c => c.identity.name) })) };
  });
  assert.deepEqual(state.players.map(p => p.life), [40, 40]);
  assert.deepEqual(state.players.map(p => p.command), [['Neheb, the Worthy'], ["Ognis, the Dragon's Lash"]]);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/pm-commander.png' });
  console.log('Commander GUI passed:', JSON.stringify(state));
} finally { await browser.close(); }
