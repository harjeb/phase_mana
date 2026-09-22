// Manual check: leaving a finished game and starting a second one must not
// resurrect the first (the transport's generation guard).
import { chromium } from 'playwright';
const say = (...a) => console.log(...a);
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => say('PAGEERROR', e.message));
const api = [];
page.on('response', (r) => { if (r.url().includes('/api/')) api.push(`${r.status()} ${r.request().method()} ${r.url().split('/api/')[1]}`); });
const st = () => page.evaluate(() => { const s = window.__pm.getState(); return { type: s.currentPrompt?.input?.type ?? null, turn: s.gameView?.turn, over: s.gameView?.gameOver, conceded: s.selfConceded, active: s.isGameActive }; });

// ManaBrew's shell is the only entry: Play -> Offline -> one deck per seat ->
// Fight -> the table dialog's Fight. Both presets must share a format or Fight
// stays disabled. The terms gate and the onboarding nickname step call
// ManaBrew's online service, so they are pre-accepted.
async function startGame() {
  await page.goto('http://127.0.0.1:1420/#/play/offline');
  await page.getByRole('button', { name: 'Pauper Mono Red Madness' }).click();
  await page.locator('button[aria-label^="Pauper Elves"]').click();
  await page.getByRole('button', { name: 'Fight!', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Fight', exact: true }).click();
  await page.waitForTimeout(5000);
}

await page.addInitScript(() => {
  localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
  localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
});
await startGame();
await page.evaluate(() => window.__pm.getState().respond({ type: 'mulliganDecision', keep: true }));
await page.waitForTimeout(2500);
say('after keep:', JSON.stringify(await st()));
say('buttons:', (await page.getByRole('button').allInnerTexts()).filter(Boolean).join(' | ').slice(0, 300));
await page.evaluate(() => window.__pm.getState().concede());
await page.waitForTimeout(2500);
say('after concede:', JSON.stringify(await st()));
await page.screenshot({ path: '/tmp/pm-return-conceded.png' });
say('url after concede:', page.url());
say('visible text:', (await page.locator('body').innerText()).replace(/\n+/g, ' / ').slice(0, 400));
await startGame();
const second = await st();
say('second game:', JSON.stringify(second), '| fresh:', second.turn === 1 && second.over === false && second.conceded === false);
await page.screenshot({ path: '/tmp/pm-return-second.png' });
say('api:', api.slice(-10).join(' | '));
await browser.close();
