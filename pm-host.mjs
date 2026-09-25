/**
 * End-to-end check for host mode: one player hosts a room from the browser,
 * shares an invitation code, and another joins by pasting it.
 *
 * Runs against the real local API server (which spawns the real Phase engine)
 * and independent browser contexts. Requires:
 *   - `npm run dev` on 127.0.0.1:1420 (proxies /api to the local host)
 *   - the local host on 127.0.0.1:3001
 *   - `npm run host:build` has provisioned the pinned engine and full card data
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const API = process.env.PHASE_MANA_API || 'http://127.0.0.1:3001';
const UI = process.env.PHASE_MANA_UI || 'http://127.0.0.1:1420';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });

/** Re-encode an invitation with a different password, to prove the engine checks it. */
const tamper = (code, password) => {
  const payload = JSON.parse(Buffer.from(code.slice('PMH1-'.length), 'base64url').toString('utf8'));
  return 'PMH1-' + Buffer.from(JSON.stringify({ ...payload, password })).toString('base64url');
};

async function fill(page, label) {
  // A changing query forces a real document load. Navigating to the hash alone
  // does not: an active game keeps rendering its board, so the lobby would
  // never come back and every control below would be missing.
  await page.goto(`${UI}/?reset=${Date.now()}#/play/online`);
  await page.getByLabel('Your name').fill(label);
  await page.getByLabel('Deck list').fill(process.env.PHASE_TEST_DECK || '24 Plains\n36 Savannah Lions');
}

async function open(label) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  contexts.push(context);
  const page = await context.newPage();
  page.on('pageerror', error => console.error('page error', error));
  // Registered before navigation: these flags are read during the first render.
  await page.addInitScript(() => {
    localStorage.setItem('manabrew.promptPreferences', JSON.stringify({ state: { show: true, fullControl: true }, version: 0 }));
    localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({ version: '1.5.0', acceptedAt: new Date().toISOString() }));
    localStorage.setItem('manabrew.onboarding', JSON.stringify({ version: '1.0', acceptedAt: new Date().toISOString() }));
  });
  await fill(page, label);
  return page;
}

/** Read the engine's own report of what is running. */
const hostStatus = async () => (await (await fetch(`${API}/api/host/status`)).json()).host;

async function stopEngine() {
  await fetch(`${API}/api/host/stop`, { method: 'POST', headers: { 'X-Phase-Host': '1' } });
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await hostStatus()) === null) return;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.fail('the engine did not stop');
}

/** Click Host and return the invitation it produced. */
async function hostRoom(page) {
  await page.getByRole('button', { name: 'Host and create invitation' }).click();
  const field = page.getByLabel('Room invitation');
  await field.waitFor({ timeout: 120000 });
  const code = await field.inputValue();
  assert.match(code, /^PMH1-[A-Za-z0-9_-]+$/, 'invitation carries a versioned payload');
  return code;
}

async function expectSeated(page, players, label) {
  await page.waitForFunction(() => window.__pm?.getState().isGameActive && window.__pm.getState().gameView, undefined, { timeout: 60000 });
  const view = await page.evaluate(() => {
    const state = window.__pm.getState();
    return { me: state.myPlayerSlot, players: state.gameView.players.length, zones: state.gameView.zones };
  });
  assert.equal(view.players, players, `${label} sees a ${players}-player game`);
  // Only the viewer's own hand reaches this client.
  for (const zone of view.zones.filter(zone => zone.zone === 'hand')) {
    assert.equal(zone.cards.length, zone.ownerId === view.me ? zone.count : 0, `${label} sees only its own hand`);
  }
  return view.me;
}

const contexts = [];

try {
  // A previous run may have left an engine up; every case starts from nothing.
  await stopEngine();
  assert.equal(await hostStatus(), null, 'no engine before hosting');

  // --- one host, one guest, joined by pasting an invitation ------------------
  const host = await open('Host');
  const guest = await open('Guest');
  const code = await hostRoom(host);

  const decoded = JSON.parse(Buffer.from(code.slice('PMH1-'.length), 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(decoded).sort(), ['endpoint', 'gameCode', 'password', 'v'],
    'an invitation carries an address, a room code, and the join password — never a seat token');
  assert.equal(decoded.v, 1);
  assert.match(decoded.gameCode, /^[A-Z0-9]{6}$/);
  assert.match(decoded.endpoint, /^wss?:\/\//);
  assert.ok(decoded.password.length >= 16, 'the room password is generated, not typed');

  // No public URL here, so the invitation must say so rather than imply it
  // works across NAT.
  await host.getByText('LAN address:', { exact: false }).waitFor();
  const engine = await hostStatus();
  assert.ok(engine.lanEndpoints.includes(decoded.endpoint), 'invitation uses a LAN endpoint');
  await host.reload();
  assert.equal(await host.getByLabel('Room invitation').inputValue(), code, 'host invitation survives reload');
  await host.getByRole('button', { name: 'Reconnect saved seat', exact: true }).click();

  await guest.getByLabel('Paste invitation').fill(code);
  await guest.getByRole('button', { name: 'Join with invitation' }).click();
  const hostSeat = await expectSeated(host, 2, 'host');
  const guestSeat = await expectSeated(guest, 2, 'guest');
  assert.notEqual(hostSeat, guestSeat, 'host and guest hold different seats');
  console.log('host + guest: invitation, private hands, distinct seats, engine on this machine');

  await guest.reload();
  await guest.getByRole('button', { name: 'Reconnect saved seat', exact: true }).click();
  assert.equal(await expectSeated(guest, 2, 'reconnected guest'), guestSeat);
  // Exercise the actual platform teardown used by the board's leave action.
  await host.evaluate(() => window.__pm.getState().endGame());
  assert.equal(await hostStatus(), null, 'host leaving the board stops its engine');
  console.log('engine reaped after the first room');

  // --- the lobby's close button stops the engine -----------------------------
  await fill(host, 'Host');
  await hostRoom(host);
  await host.getByRole('button', { name: 'Close room and stop engine' }).click();
  for (let attempt = 0; attempt < 60; attempt++) {
    if ((await hostStatus()) === null) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(await hostStatus(), null, 'the lobby button stops the engine');
  console.log('lobby close button stopped the engine');

  // Admission must complete even while a four-player room waits for two more.
  await fill(host, 'Host');
  await host.getByLabel('Players', { exact: true }).selectOption('4');
  const fourCode = await hostRoom(host);
  await fill(guest, 'Guest');
  await guest.getByLabel('Paste invitation').fill(fourCode);
  await guest.getByRole('button', { name: 'Join with invitation', exact: true }).click();
  await guest.getByRole('button', { name: 'Join with invitation', exact: true }).waitFor();
  await new Promise(resolve => setTimeout(resolve, 31000));
  assert.equal(await guest.getByRole('alert').count(), 0, 'admitted guest has no false timeout');
  await host.getByRole('button', { name: 'Close room and stop engine', exact: true }).click();
  assert.equal(await hostStatus(), null);

  // --- the engine, not the client, decides who knows the password ------------
  // A room with a free seat: on a full room the refusal would be "full" and
  // would prove nothing about the password.
  await fill(host, 'Host');
  await host.getByLabel('Players', { exact: true }).selectOption('2');
  const second = await hostRoom(host);
  const attacker = await open('Attacker');
  await attacker.getByLabel('Paste invitation').fill(tamper(second, 'not-the-password'));
  await attacker.getByRole('button', { name: 'Join with invitation' }).click();
  const refusal = attacker.getByText(/wrong password/i).first();
  await refusal.waitFor({ timeout: 30000 });
  console.log('tampered invitation refused:', await refusal.innerText());
  assert.equal(await attacker.evaluate(() => window.__pm?.getState().isGameActive ?? false), false,
    'a refused seat never reaches a board');

  // The same client with the real code gets in, so the refusal was the password.
  await attacker.getByLabel('Paste invitation').fill(second);
  await attacker.getByRole('button', { name: 'Join with invitation' }).click();
  await expectSeated(host, 2, 'host in the second room');
  await expectSeated(attacker, 2, 'attacker in the second room');
  console.log('the correct password seated the same client');

  await stopEngine();
  console.log('host mode: invitation, join by paste, private hands, password refusal, teardown — all passed.');
} finally {
  await fetch(`${API}/api/host/stop`, { method: 'POST', headers: { 'X-Phase-Host': '1' } }).catch(() => undefined);
  for (const context of contexts) await context.close();
  await browser.close();
}
