import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const server = process.env.PHASE_ONLINE_URL || 'ws://127.0.0.1:9374/ws';
try {
  for (const count of process.env.PHASE_ONLINE_PLAYERS ? [Number(process.env.PHASE_ONLINE_PLAYERS)] : [2, 4]) {
    const contexts = [];
    const pages = [];
    for (let seat = 0; seat < count; seat++) {
      const context = await browser.newContext({ reducedMotion: 'reduce' });
      contexts.push(context);
      const page = await context.newPage();
      // Keep development hot reloads from replacing an authenticated test tab.
      await page.routeWebSocket(url => url.port === '1420', socket => socket.send('{"type":"connected"}'));
      pages.push(page);
      page.on('pageerror', error => console.error('page error', error));
      page.on('websocket', socket => socket.on('framereceived', event => {
        try {
          const frame = JSON.parse(String(event.payload));
          console.log('server frame', seat, frame.type, frame.type === 'ManabrewSnapshot' ? { revision: frame.data.snapshot.state_revision, gameOver: frame.data.snapshot.update.gameView?.gameOver } : Object.keys(frame.data ?? {}));
          if (['Error', 'ActionRejected', 'RequestRejected', 'ActionFailed'].includes(frame.type)) console.error(frame.data?.message ?? frame.data?.reason ?? frame.data?.rejection);
        } catch { /* Binary frames are not negotiated by this client. */ }
      }));
      await page.addInitScript(() => {
        localStorage.setItem('manabrew.promptPreferences', JSON.stringify({ state: { show: true, fullControl: true }, version: 0 }));
        localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
        localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
      });
      await page.goto('http://127.0.0.1:1420/#/play/online');
      await page.getByLabel('Server URL').fill(server);
      await page.getByLabel('Deck list').fill('60 Plains');
    }
    await pages[0].getByLabel('Players', { exact: true }).selectOption(String(count));
    await pages[0].getByRole('button', { name: 'Create room', exact: true }).click();
    const room = pages[0].locator('p').filter({ hasText: 'Room code:' }).locator('strong');
    await room.waitFor();
    const code = await room.innerText();
    for (const page of pages.slice(1)) {
      await page.getByLabel('Room code').fill(code);
      await page.getByRole('button', { name: 'Join room', exact: true }).click();
    }
    for (const page of pages) {
      await page.waitForFunction(() => window.__pm?.getState().isGameActive && window.__pm.getState().gameView);
      const view = await page.evaluate(() => {
        const state = window.__pm.getState();
        return { me: state.myPlayerSlot, players: state.gameView.players, zones: state.gameView.zones };
      });
      assert.equal(view.players.length, count);
      for (const hand of view.zones.filter(zone => zone.zone === 'hand')) {
        assert.equal(hand.cards.length, hand.ownerId === view.me ? hand.count : 0);
      }
    }
    // Refresh keeps only the server-scoped seat token, then recovers the real game.
    await pages[1].reload();
    await pages[1].getByLabel('Server URL').fill(server);
    await pages[1].getByRole('button', { name: 'Reconnect saved seat', exact: true }).click();
    await pages[1].waitForFunction(() => window.__pm?.getState().isGameActive);
    assert.equal(await pages[1].evaluate(() => window.__pm.getState().myPlayerSlot), 'player-1');
    for (const page of pages) await page.evaluate(() => {
      window.__pm.subscribe(state => {
        if (state.gameView?.gameOver) window.__pmFinalView = state.gameView;
      });
    });
    for (let step = 0; step < 100; step++) {
      let hasPriority = false;
      for (const page of pages) {
        const type = await page.evaluate(() => {
          const state = window.__pm.getState();
          return !state.isWaitingForResponse && state.currentPrompt?.input.type;
        });
        if (type === 'mulligan') {
          await page.evaluate(() => window.__pm.getState().respond({ type: 'mulliganDecision', keep: true }));
        }
        if (type === 'chooseAction') hasPriority = true;
      }
      if (hasPriority) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log('priority checkpoint', await Promise.all(pages.map(page => page.evaluate(() => {
      const state = window.__pm.getState();
      return { seat: state.myPlayerSlot, prompt: state.currentPrompt?.input.type, pending: state.isWaitingForResponse, error: state.debugInfo };
    }))));
    await Promise.any(pages.map(page => page.waitForFunction(() => window.__pm.getState().currentPrompt?.input.type === 'chooseAction')));
    for (const page of pages.slice(0, -1)) await page.evaluate(() => window.__pm.getState().concede());
    // Game.tsx returns to the lobby three seconds after the final projection.
    await Promise.all(pages.map(page => page.waitForFunction(() => window.__pmFinalView?.gameOver, undefined, { timeout: 120000 })));
    for (const page of pages) assert.equal(await page.evaluate(() => window.__pmFinalView.winnerId), `player-${count - 1}`);
    // A retired room remains recoverable after the live socket and board are gone.
    await pages[1].goto('http://127.0.0.1:1420/?terminal-recovery=1#/play/online');
    await pages[1].getByLabel('Server URL').fill(server);
    await pages[1].getByRole('button', { name: 'Reconnect saved seat', exact: true }).click();
    await pages[1].getByRole('status').filter({ hasText: `Game over — Player ${count} won.` }).waitFor();
    console.log(`${count} humans: create/join, private hands, reconnect, mulligan, priority, concession, and retired-result recovery passed.`);
    for (const context of contexts) await context.close();
  }
} finally { await browser.close(); }
