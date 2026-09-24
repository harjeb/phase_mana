// Integration smoke: run after npm run app:stage. Does not launch native dialogs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
const target = process.env.TARGET || 'x86_64-pc-windows-msvc';
const exe = resolve(process.env.PHASE_MANA_TEST_BINARY || `src-tauri/binaries/phase-mana-server-${target}${process.platform === 'win32' ? '.exe' : ''}`);
const state = await mkdtemp(join(tmpdir(), 'phase-gateway-test-'));
const blockers = [];
let child;
async function occupy(port) {
  const server = net.createServer();
  try { server.listen(port, '127.0.0.1'); await once(server, 'listening'); blockers.push(server); }
  catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
}
try {
  await occupy(3001); await occupy(1420);
  const env = { ...process.env, PHASE_CARD_DB: resolve('../phase/data/mtgjson/test_fixture.json'), PHASE_MANA_WEB_ROOT: resolve('dist'), PHASE_MANA_STATE_DIR: state, PHASE_MANA_PORT: '3001', PHASE_MANA_CLIENT_PORT: '1420' };
  delete env.PHASE_MANA_ENDPOINT_FILE; delete env.PHASE_MANA_CARD_IMAGES;
  child = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  const ready = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Readiness timeout')), 60000);
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Early server exit ${code}`)); });
    lines.on('line', line => { try { const v = JSON.parse(line); if (v.event === 'ready') { clearTimeout(timer); accept(v); } } catch {} });
  });
  assert.ok(ready.port > 3001 && ready.port < 3101);
  assert.ok(ready.clientPort > 1420 && ready.clientPort < 1520);
  const base = `http://127.0.0.1:${ready.clientPort}`;
  assert.match(await (await fetch(base)).text(), /<html/);
  assert.equal((await fetch(`${base}/nonexistent-asset.js`)).status, 404);
  assert.equal((await fetch(`${base}/api/custom-formats`)).status, 200);
  assert.equal((await fetch(`${base}/card-images-config`, { headers: { Origin: 'https://evil.example' } })).status, 403);
  const images = join(state, 'images'); await mkdir(join(images, 'a'), { recursive: true });
  await writeFile(join(images, 'a', 'test.full.webp'), 'image-test');
  const saved = await fetch(`${base}/card-images-config`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ dir: images }) });
  assert.equal(saved.status, 200, await saved.text());
  assert.equal(await (await fetch(`${base}/card-images/a/test.full.webp`)).text(), 'image-test');
  assert.equal((await fetch(`${base}/card-images/%2e%2e%5cdesktop.json`)).status, 404);
  console.log('Native gateway smoke passed:', ready);
} finally {
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  await Promise.all(blockers.map(s => new Promise(resolve => s.close(resolve))));
  await rm(state, { recursive: true, force: true });
}
