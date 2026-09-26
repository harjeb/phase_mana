// Real two-browser server-hosted draft: one click hosts an invitation, the
// guest joins it, and both draft from the native engine. All processes and
// data belong to this test; nothing here touches a running game or server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright';
const root = resolve(import.meta.dirname, '..');
const suffix = process.platform === 'win32' ? '.exe' : '';
const work = await mkdtemp(join(tmpdir(), 'phase-draft-browser-'));
const child = spawn(resolve(root, `server/target/debug/phase-mana-server${suffix}`), [], {
  cwd: root, stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, PHASE_MANA_PORT: '0', PHASE_MANA_CLIENT_PORT: undefined, PHASE_MANA_WEB_ROOT: undefined, PHASE_MANA_STATE_DIR: work,
    PHASE_CARD_DB: resolve(root, '../phase/data/mtgjson/test_fixture.json'),
    PHASE_DEV_FIXTURE: '0', PHASE_HOST_LAN: '0', PHASE_HOST_PORT: undefined, PHASE_HOST_PUBLIC_URL: '',
    PHASE_SERVER_BIN: resolve(root, `.phase-host/target/debug/phase-server${suffix}`),
    PHASE_HOST_DATA_DIR: resolve(root, '.phase-host/data'), },
});
let diagnostics = '';
child.stderr.on('data', chunk => { diagnostics += chunk; console.error(String(chunk).trimEnd()); });
let api;
let browser;
try {
  api = await new Promise((resolveReady, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Backend startup timeout: ${diagnostics}`)), 60000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Backend exited ${code}: ${diagnostics}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      for (const line of output.split('\n')) {
        try { const value = JSON.parse(line); if (value.event === 'ready') { clearTimeout(timer); resolveReady(`http://127.0.0.1:${value.port}`); return; } } catch {}
      }
    });
  });
  console.log('API ready', api);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pages = [];
  for (const name of ['Draft owner', 'Draft guest']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage(); pages.push(page);
    page.setDefaultTimeout(60000);
    await page.addInitScript(() => {
      localStorage.setItem('manabrew.termsAcceptance', JSON.stringify({version:'1.5.0',acceptedAt:new Date().toISOString()}));
      localStorage.setItem('manabrew.onboarding', JSON.stringify({version:'1.0',acceptedAt:new Date().toISOString()}));
      localStorage.setItem('manabrew-preferences', JSON.stringify({state:{uiLanguage:'zh-Hans'},version:1}));
    });
    await page.route('**/api/host/*', async route => {
      const request = route.request();
      const response = await fetch(api + new URL(request.url()).pathname, { method: request.method(), headers: { 'X-Phase-Host':'1' } });
      await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
    });
    await page.goto((process.env.SMOKE_BASE_URL || 'http://127.0.0.1:1420') + '/#/play/online');
    await page.getByLabel('你的名字', { exact: true }).fill(name);
    await page.getByRole('button', { name: '轮抽', exact: true }).click();
  }
  const [host, guest] = pages;
  console.log('Hosting a draft room from the Draft tab');
  await host.getByLabel('桌位规模', { exact: true }).selectOption('2');
  await host.getByRole('button', { name: '主持并创建邀请', exact: true }).click();
  const alert = host.getByRole('alert').first();
  await Promise.race([
    host.getByLabel('房间邀请', { exact: true }).waitFor({ timeout: 180000 }),
    alert.waitFor({ timeout: 180000 }).then(async () => { throw new Error(`Host failed: ${await alert.innerText()}`); }),
  ]);
  const invitation = await host.getByLabel('房间邀请', { exact: true }).inputValue();
  assert.match(invitation, /^PMH1-/, 'hosting a draft must produce a shareable invitation');
  console.log('Invitation ready');
  await guest.getByLabel('粘贴邀请', { exact: true }).fill(invitation);
  await guest.getByRole('button', { name: '使用邀请加入', exact: true }).click();
  for (const page of pages) await page.getByText('Premier · Lobby', { exact: false }).first().waitFor({ timeout: 180000 });
  await host.getByRole('button', { name: '开始轮抽', exact: true }).waitFor({ timeout: 60000 });
  await host.screenshot({ path: 'tools/draft-room-smoke.png' });
  console.log('Both seats are in the draft lobby; starting the draft');
  await host.getByRole('button', { name: '开始轮抽', exact: true }).click();
  for (const page of pages) {
    await page.locator('button[aria-pressed]').first().waitFor({ timeout: 120000 });
    await page.locator('button[aria-pressed]').first().click();
    await page.getByRole('button', { name: '确认选择', exact: false }).click();
    await page.getByText('你的牌池 (1)', { exact: false }).waitFor({ timeout: 60000 });
  }
  console.log('PASS: one-click draft room, invitation join, and a real first pick on both seats.');
} catch (error) {
  for (const [index, context] of (browser?.contexts() ?? []).entries()) {
    const page = context.pages()[0];
    if (page) {
      console.error(`Browser ${index}:`, (await page.locator('body').innerText().catch(() => '')).slice(-6000));
      await page.screenshot({ path: `tools/draft-room-debug-${index}.png` }).catch(() => {});
    }
  }
  console.error(diagnostics.slice(-8000));
  throw error;
} finally {
  if (api) await fetch(api + '/api/host/stop', { method: 'POST', headers: { 'X-Phase-Host': '1' } }).catch(() => {});
  await browser?.close();
  child.kill();
  await new Promise(resolveExit => { if (child.exitCode !== null || child.signalCode !== null) resolveExit(); else { child.once('exit', resolveExit); setTimeout(resolveExit, 3000).unref(); } });
  await rm(work, { recursive: true, force: true });
}
