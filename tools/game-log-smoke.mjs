// Isolated real-engine + browser smoke: never replaces the user's running game.
// Run after: cargo build --manifest-path server/Cargo.toml
// Windows debug builds need a larger main-thread stack:
// cargo rustc --manifest-path server/Cargo.toml --bin phase-mana-server -- -C link-arg=/STACK:16777216
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const binary = resolve(process.env.PHASE_LOG_TEST_BINARY || `server/target/debug/phase-mana-server${process.platform === 'win32' ? '.exe' : ''}`);
const env = { ...process.env, PHASE_MANA_PORT: '0', PHASE_CARD_DB: resolve('../phase/data/mtgjson/test_fixture.json') };
delete env.PHASE_MANA_ENDPOINT_FILE;
delete env.PHASE_MANA_CLIENT_PORT;
const backend = spawn(binary, [], { env, stdio: ['ignore', 'pipe', 'inherit'] });
let vite, browser;
try {
  const port = await new Promise((resolvePort, reject) => {
    const timer = setTimeout(() => reject(new Error('Backend ready timed out')), 60000);
    backend.once('error', reject);
    backend.once('exit', code => reject(new Error(`Backend exited: ${code}`)));
    createInterface({ input: backend.stdout }).on('line', line => {
      try {
        const ready = JSON.parse(line);
        if (ready.event === 'ready') { clearTimeout(timer); resolvePort(ready.port); }
      } catch {}
    });
  });
  process.env.PHASE_MANA_API_URL = `http://127.0.0.1:${port}`;
  const { createServer } = await import('vite');
  vite = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew-preferences', JSON.stringify({ state: { uiLanguage: 'zh-Hans' }, version: 0 }));
  });
  await page.goto(origin + '/#/play');
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).find(url => /\/ui\/phase\/transport\.ts(?:\?|$)/.test(url)) || '/ui/phase/transport.ts';
    const transport = await import(moduleUrl);
    window.__logTransport = transport;
    const snapshot = await transport.requestSnapshot('start', { humanDeck: Array(40).fill('Mountain'), aiDeck: Array(40).fill('Forest'), seed: 42 });
    transport.acceptSnapshot(snapshot);
    window.location.hash = '/game/log-smoke';
  });
  await page.waitForFunction(() => window.__pm?.getState().gameLog.length > 0);
  const initial = await page.evaluate(() => window.__pm.getState().gameLog);
  assert(initial.some(row => /game/i.test(row.message)), 'start_game must produce real logs');
  await page.getByRole('button', { name: /Open action log|打开.*日志/ }).click();
  await page.getByText(initial[0].message, { exact: true }).waitFor();
  assert.equal(await page.getByText('暂无日志条目。', { exact: true }).count(), 0);
  for (let i = 0; i < 45; i++) {
    const progress = await page.evaluate(async () => {
      const state = window.__pm.getState();
      const input = state.currentPrompt?.input;
      if (state.gameView.turn >= 3) return 'done';
      let action;
      if (input?.type === 'mulligan') action = { type: 'mulliganDecision', keep: true };
      else if (input?.type === 'chooseAction') {
        const land = input.actions.find(entry => entry.type === 'playLand' || /^Play land$/i.test(entry.label));
        action = land ? { type: 'act', actionId: land.id } : { type: 'pass' };
      } else if (input?.type === 'chooseAttackers') action = { type: 'declareAttackers', assignments: [] };
      else if (input?.type === 'chooseBlockers') action = { type: 'declareBlockers', assignments: [] };
      else throw new Error(`Unhandled smoke prompt: ${JSON.stringify(input)}`);
      if (!await state.respond(action)) throw new Error(`Response rejected: ${JSON.stringify(action)}`);
      return 'continue';
    });
    if (progress === 'done') break;
  }
  const result = await page.evaluate(async () => {
    const { requestSnapshot, acceptSnapshot } = window.__logTransport;
    const snapshot = await requestSnapshot('state');
    acceptSnapshot(snapshot);
    acceptSnapshot(snapshot);
    return { snapshot, rows: window.__pm.getState().gameLog };
  });
  assert(result.snapshot.state.gameView.turn >= 2, 'must advance through AI turn');
  assert(result.rows.some(row => /Mountain/.test(row.message)), 'human land must be logged');
  assert(result.rows.some(row => /Forest/.test(row.message)), 'AI land must be logged');
  assert(result.rows.some(row => row.turn >= 2), 'turn metadata must advance');
  assert.equal(result.rows.length, result.snapshot.gameLog.length, 'repeated snapshots must not duplicate rows');
  assert.equal(new Set(result.rows.map(row => row.seq)).size, result.rows.length);
  console.log(`PASS: real startup, human/AI actions, turns, log panel and snapshot dedup (${result.rows.length} entries)`);
} finally {
  await browser?.close();
  await vite?.close();
  backend.kill();
}
