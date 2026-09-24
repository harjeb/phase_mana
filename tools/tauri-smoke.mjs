// Interactive Windows WebView2 smoke, opt-in: node tools/tauri-smoke.mjs.
// CDP is enabled only for this test process, never in the shipped app.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const exe = resolve('src-tauri/target/x86_64-pc-windows-msvc/release/phase-mana-desktop.exe');
const dir = join(process.env.APPDATA, 'org.phase-mana.desktop');
const database = join(dir, 'AtomicCards.json');
const backup = join(dir, `.AtomicCards.test-backup-${process.pid}`);
const fixture = resolve('../phase/data/mtgjson/test_fixture.json');
const blockers = [];
let app, browser, clientUrl, backedUp = false, installedFixture = false;
try {
  await mkdir(dir, { recursive: true });
  try {
    await rename(database, backup);
    backedUp = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await copyFile(fixture, database);
  installedFixture = true;
  for (const port of [3001, 1420]) {
    const socket = net.createServer();
    try { socket.listen(port, '127.0.0.1'); await once(socket, 'listening'); blockers.push(socket); }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
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
  console.log('ManaBrew boot -> local gateway succeeded:', clientUrl, text.slice(0, 160));
  await browser.close(); browser = undefined;
} finally {
  await browser?.close().catch(() => {});
  if (app && app.exitCode === null) { const exited = once(app, 'exit'); app.kill(); await exited; }
  if (clientUrl) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await assert.rejects(fetch(`${clientUrl}/api/custom-formats`), 'Owned child stopped after shell exit');
  }
  await Promise.all(blockers.map(socket => new Promise(resolve => socket.close(resolve))));
  if (installedFixture) await rm(database, { force: true });
  if (backedUp) await rename(backup, database);
}
