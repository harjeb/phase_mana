// Interactive Windows WebView2 smoke, opt-in: node tools/tauri-smoke.mjs.
// Uses CDP only in this test process, never enables it in the shipped app.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
const exe = resolve('src-tauri/target/x86_64-pc-windows-msvc/release/phase-mana-desktop.exe');
const dir = join(process.env.APPDATA, 'org.phase-mana.desktop');
const saved = join(dir, 'desktop.json');
let previous; try { previous = await readFile(saved); } catch(e) { if(e.code !== 'ENOENT') throw e; }
await mkdir(dir, { recursive: true }); await rm(saved, { force: true });
const blockers = [];
let app, browser, clientUrl;
try {
  for (const port of [3001, 1420]) {
    const s = net.createServer();
    try { s.listen(port, '127.0.0.1'); await once(s, 'listening'); blockers.push(s); } catch(e) { if(e.code !== 'EADDRINUSE') throw e; }
  }
  app = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=19229' }, stdio: 'ignore' });
  app.on('error', console.error);
  for (let i=0;i<120;i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:19229'); break; } catch { await new Promise(r=>setTimeout(r,500)); }
  }
  assert.ok(browser, 'WebView2 CDP connected');
  const context = browser.contexts()[0];
  let page;
  for(let i=0;i<40;i++) { page=context.pages().find(p=>p.url().includes('tauri.localhost')); if(page) break; await new Promise(r=>setTimeout(r,250)); }
  assert.ok(page, 'Bundled setup page loaded');
  await page.waitForSelector('#choose');
  assert.equal(await page.locator('#error').textContent(), '');
  const start = page.evaluate(path => window.__TAURI__.core.invoke('start_server', { path }), resolve('../phase/data/mtgjson/test_fixture.json')).catch(e => {
    if (!/context was destroyed|navigat/i.test(String(e))) throw e;
  });
  await page.waitForURL(/http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60000 });
  await start;
  clientUrl = new URL(page.url()).origin;
  assert.ok(Number(new URL(clientUrl).port) > 1420);
  assert.equal((await fetch(`${clientUrl}/api/custom-formats`)).status, 200);
  await page.waitForFunction(() => {
    const text = document.querySelector('#root')?.textContent || '';
    return text.trim().length > 100 && !/正在启动|连接中|Connecting|Starting up/.test(text);
  }, null, { timeout: 60000 });
  const text = await page.locator('#root').innerText();
  assert.ok(!text.includes('cross-origin isolated'));
  console.log('Tauri WebView setup -> native gateway succeeded:', clientUrl, text.slice(0,160));
  await browser.close(); browser = undefined;
} finally {
  await browser?.close().catch(()=>{});
  if(app && app.exitCode === null) { const exited=once(app,'exit'); app.kill(); await exited; }
  if(clientUrl) {
    await new Promise(r=>setTimeout(r,1000));
    await assert.rejects(fetch(`${clientUrl}/api/custom-formats`), 'Owned child stopped after shell exit');
  }
  await Promise.all(blockers.map(s=>new Promise(r=>s.close(r))));
  if(previous) await writeFile(saved, previous); else await rm(saved,{force:true});
}
