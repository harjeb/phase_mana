// Interactive Windows WebView2 smoke, opt-in: node tools/tauri-smoke.mjs.
// CDP is enabled only for this test process, never in the shipped app.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const exe = resolve('src-tauri/target/x86_64-pc-windows-msvc/release/phase-mana-desktop.exe');
const dir = join(process.env.APPDATA, 'org.phase-mana.desktop');
const database = join(dir, 'AtomicCards.json');
const backup = join(dir, `.AtomicCards.test-backup-${process.pid}`);
const bundledDatabase = resolve('src-tauri/target/x86_64-pc-windows-msvc/release/resources/data/card-data.json');
const blockers = [];
let app, browser, clientUrl, backedUp = false, isolatedDatabase = false;
try {
  await access(bundledDatabase);
  await mkdir(dir, { recursive: true });
  try {
    await rename(database, backup);
    backedUp = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  // No raw fixture: a clean first launch must use the real bundled export.
  isolatedDatabase = true;
  for (const port of [3001, 1420]) {
    const socket = net.createServer();
    try { socket.listen(port, '127.0.0.1'); await once(socket, 'listening'); blockers.push(socket); }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  const started = performance.now();
  app = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19229' }, stdio: 'ignore' });
  app.on('error', console.error);
  for (let i = 0; i < 120; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:19229'); break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  assert.ok(browser, 'WebView2 CDP connected');
  const context = browser.contexts()[0];
  let page;
  for (let i = 0; i < 40; i++) {
    page = context.pages().find(p => p.url().includes('tauri.localhost') || /^http:\/\/127\.0\.0\.1:\d+/.test(p.url()));
    if (page) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(page, 'ManaBrew page loaded');
  if (page.url().includes('tauri.localhost')) {
    await page.getByRole('heading', { name: 'Manabrew' }).waitFor();
    assert.equal(await page.getByText('Choose local JSON').count(), 0);
  }
  await page.waitForURL(/http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
  const bootMs = Math.round(performance.now() - started);
  await assert.rejects(access(database), { code: 'ENOENT' }, 'Bundled startup must not download AtomicCards.json');
  clientUrl = new URL(page.url()).origin;
  assert.ok(Number(new URL(clientUrl).port) > 1420);
  assert.equal((await fetch(`${clientUrl}/api/custom-formats`)).status, 200);
  const remoteIpc = await page.evaluate(async () => {
    if (!window.__TAURI_INTERNALS__) return 'unavailable';
    try { await window.__TAURI_INTERNALS__.invoke('boot_desktop'); return 'allowed'; }
    catch { return 'denied'; }
  });
  assert.notEqual(remoteIpc, 'allowed', 'Loopback gameplay must not gain boot IPC');
  await page.waitForFunction(() => {
    const text = document.querySelector('#root')?.textContent || '';
    return text.trim().length > 100 && !/正在启动|连接中|Connecting|Starting up/.test(text);
  }, null, { timeout: 60000 });
  const text = await page.locator('#root').innerText();
  assert.ok(!text.includes('cross-origin isolated'));
  console.log(`Bundled database boot -> local gateway succeeded in ${bootMs} ms:`, clientUrl, text.slice(0, 160));
  // Optional internet check in the actual WebView, not just desktop Chrome.
  if (process.env.PHASE_MANA_SMOKE_IMAGES === '1') {
    const result = await page.evaluate(async () => {
      const response = await fetch('/hub-api/api/scryfall/cards/named?exact=Grizzly%20Bears');
      if (!response.ok) throw new Error(`Scryfall metadata: ${response.status}`);
      const card = await response.json();
      const image = new Image();
      image.crossOrigin = 'anonymous';
      const decoded = new Promise((accept, reject) => {
        image.onload = () => accept(image.naturalWidth);
        image.onerror = () => reject(new Error('WebView Scryfall image failed'));
      });
      image.src = card.image_uris.normal;
      const width = await decoded;
      const texture = await createImageBitmap(await (await fetch(card.image_uris.normal)).blob());
      return { width, textureWidth: texture.width };
    });
    assert.ok(result.width > 1);
    assert.equal(result.width, result.textureWidth);
    console.log('Native WebView direct Scryfall image decode:', result);
  }
  await browser.close(); browser = undefined;
} finally {
  await browser?.close().catch(() => {});
  if (app && app.exitCode === null) { const exited = once(app, 'exit'); app.kill(); await exited; }
  if (clientUrl) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await assert.rejects(fetch(`${clientUrl}/api/custom-formats`), 'Owned child stopped after shell exit');
  }
  await Promise.all(blockers.map(socket => new Promise(resolve => socket.close(resolve))));
  if (isolatedDatabase) await rm(database, { force: true });
  if (backedUp) await rename(backup, database);
}
