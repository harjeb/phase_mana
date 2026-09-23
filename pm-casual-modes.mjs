import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
  });
  await page.goto('http://127.0.0.1:1420/#/play');
  const tile = page.getByRole('link', { name: /Casual Modes/ });
  await tile.waitFor({ timeout: 15000 });
  await tile.click();
  await page.waitForURL(/#\/play\/offline\/casual/);
  for (const heading of ['Draft variants', 'Constructed formats', 'Special tables']) {
    await page.getByText(heading, { exact: true }).waitFor();
  }
  for (const card of ['Commander Draft', 'Winston Draft', 'Cube / local pool', 'Oathbreaker',
    'Tiny Leaders', 'Duel Commander', 'Pauper Commander', 'Old School 93/94', 'Old School 95',
    'Momir', 'Four-player Commander', 'Archenemy', 'Planechase', 'Two-Headed Giant']) {
    await page.getByText(card, { exact: true }).first().waitFor();
  }
  await page.screenshot({ path: '/tmp/pm-casual-hub.png', fullPage: true });
  await page.getByRole('button', { name: 'Set up Planechase' }).click();
  await page.waitForURL(/#\/play\/offline\/constructed/);
  await page.getByText('Planechase').first().waitFor();
  await page.screenshot({ path: '/tmp/pm-casual-constructed.png' });
  assert.deepEqual(errors, []);
  console.log('Casual hub -> constructed preselect passed.');
} finally { await browser.close(); }
