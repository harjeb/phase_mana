import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const server = process.env.PHASE_ONLINE_URL || 'ws://127.0.0.1:9374/ws';
const snapshot = page => page.evaluate(async () => (await import('/ui/phase/tournaments.ts')).tournaments.getSnapshot());
try {
  const pages = [];
  for (let seat = 0; seat < 3; seat++) {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
      localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
    });
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', error => console.error(error));
    await page.goto('http://127.0.0.1:1420/#/play/tournaments');
    await page.getByLabel('Phase broker URL').fill(server);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Disconnect', exact: true }).waitFor();
  }
  const organizer = pages[0];
  await organizer.getByLabel('Event name').fill('Browser Swiss');
  await organizer.getByLabel('Rounds (blank for automatic)').fill('2');
  await organizer.getByRole('button', { name: 'Create', exact: true }).click();
  await organizer.getByRole('button', { name: 'Pair next round' }).waitFor();
  const code = (await snapshot(organizer)).view.summary.code;
  for (let seat = 0; seat < pages.length; seat++) {
    const page = pages[seat];
    if (seat) {
      await page.getByLabel('Tournament code').fill(code);
      await page.getByRole('button', { name: 'Open', exact: true }).click();
    }
    await page.getByLabel('Player name').fill(`Entrant ${seat + 1}`);
    await page.getByRole('button', { name: 'Join as player', exact: true }).click();
    await page.getByRole('button', { name: 'Drop from tournament' }).waitFor();
  }
  await organizer.getByRole('button', { name: 'Pair next round' }).click();
  await organizer.waitForFunction(async () => (await import('/ui/phase/tournaments.ts')).tournaments.getSnapshot().view?.pairings.length === 2);
  const view = (await snapshot(organizer)).view;
  assert.equal(view.pairings.filter(pairing => pairing.outcome === 'Bye').length, 1);
  const pairing = view.pairings.find(pairing => pairing.outcome === null);
  const playerPages = new Map();
  for (const page of pages) playerPages.set((await snapshot(page)).credentials[code].Player.playerKey, page);
  const reporter = playerPages.get(pairing.players[0].player_key);
  await reporter.getByLabel('Manual match outcome').selectOption('draw');
  await reporter.getByRole('button', { name: 'Submit unverified result' }).click();
  await organizer.waitForFunction(async () => (await import('/ui/phase/tournaments.ts')).tournaments.getSnapshot().view?.pairings.every(pairing => pairing.outcome !== null));
  const standings = (await snapshot(organizer)).view.standings;
  assert.deepEqual(standings.map(row => row.match_points).sort(), [1, 1, 3]);
  await reporter.getByRole('button', { name: 'Drop from tournament' }).click();
  await organizer.waitForFunction(async () => (await import('/ui/phase/tournaments.ts')).tournaments.getSnapshot().view?.players.some(player => player.dropped));
  await organizer.getByRole('button', { name: 'Renew credential', exact: true }).first().click();
  await organizer.waitForFunction(async () => !(await import('/ui/phase/tournaments.ts')).tournaments.getSnapshot().busy);
  await organizer.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await organizer.getByRole('button', { name: 'End tournament', exact: true }).click();
  await organizer.getByRole('button', { name: 'Confirm end tournament', exact: true }).click();
  await organizer.waitForFunction(async () => (await import('/ui/phase/tournaments.ts')).tournaments.getSnapshot().view?.summary.status === 'Completed');
  assert.deepEqual((await snapshot(organizer)).view.standings.map(row => row.match_points).sort(), [1, 1, 3]);
  console.log('Tournament browser passed: create/join, Swiss bye, draw, standings, drop, credential renewal, reconnect, end.');
} finally { await browser.close(); }
