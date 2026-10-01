// Native gateway + real Chromium CORS/image decoding, without an image folder.
// Build server first. Requires internet access to Scryfall (metadata and CDN).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { buildSync } from 'esbuild';
import { chromium } from 'playwright';

const state = await mkdtemp(join(tmpdir(), 'phase-no-images-'));
let child;
let browser;
try {
  const web = join(state, 'web');
  await mkdir(web);
  const bundle = buildSync({ entryPoints: ['ui/lib/localCardArt.ts'], bundle: true, write: false, format: 'iife', globalName: 'cardArt' }).outputFiles[0].text;
  await writeFile(join(web, 'card-art.js'), bundle);
  await writeFile(join(web, 'index.html'), '<!doctype html><script src="/card-art.js"></script>');
  const env = { ...process.env, PHASE_CARD_DB: resolve('../phase/data/mtgjson/test_fixture.json'), PHASE_MANA_WEB_ROOT: web, PHASE_MANA_STATE_DIR: state, PHASE_MANA_PORT: '3001', PHASE_MANA_CLIENT_PORT: '1420' };
  delete env.PHASE_MANA_CARD_IMAGES;
  delete env.PHASE_MANA_ENDPOINT_FILE;
  const exe = resolve(process.env.PHASE_MANA_TEST_BINARY || `server/target/debug/phase-mana-server${process.platform === 'win32' ? '.exe' : ''}`);
  child = spawn(exe, [], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout });
  const ready = await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Gateway readiness timeout')), 60000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
    lines.on('line', line => { try { const result = JSON.parse(line); if (result.event === 'ready') { clearTimeout(timer); accept(result); } } catch {} });
  });
  const base = `http://127.0.0.1:${ready.clientPort}`;
  const status = await (await fetch(`${base}/card-images-config`)).json();
  assert.equal(status.exists, false);
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const page = await browser.newPage();
  page.on('requestfailed', request => console.error('Image request failed:', request.url(), request.failure()));
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  const metadata = await fetch(`${base}/hub-api/api/scryfall/cards/named?exact=Grizzly%20Bears`);
  assert.equal(metadata.status, 200);
  const cdn = (await metadata.json()).image_uris.normal;
  await page.goto(base);
  const result = await page.evaluate(async cdn => {
    const uri = cardArt.withLocalCardArt({ normal: cdn }, 'Grizzly Bears').normal;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const decoded = new Promise((accept, reject) => { image.onload = () => accept(image.naturalWidth); image.onerror = () => reject(new Error('DOM image failed')); });
    image.src = uri;
    const width = await decoded;
    const response = await fetch(uri, { mode: 'cors', credentials: 'omit' });
    const bitmap = await createImageBitmap(await response.blob());
    return { width, textureWidth: bitmap.width, finalUrl: response.url };
  }, cdn);
  assert.ok(result.width > 1);
  assert.equal(result.textureWidth, result.width);
  assert.equal(result.finalUrl, cdn);
  // A legacy local-only URL used to stay a guaranteed 404, even with internet.
  assert.equal((await fetch(`${base}/card-images/g/grizzly_bears.full.webp`)).status, 404);
  const repaired = await page.evaluate(() => cardArt.withLocalCardArt({ normal: '/card-images/g/grizzly_bears.full.webp' }, 'Grizzly Bears').normal);
  assert.equal(repaired, '/card-images/g/grizzly_bears.full.webp?name=Grizzly%20Bears');
  {
    const width = await page.evaluate(async uri => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      return new Promise((accept, reject) => { image.onload = () => accept(image.naturalWidth); image.onerror = () => reject(new Error('Live Scryfall image failed')); image.src = uri; });
    }, repaired);
    assert.ok(width > 1);
    console.log('Live Scryfall named fallback decoded:', width);
  }
  console.log('PASS: absent local image folder -> direct CDN; DOM and texture decoding; saved local URL repair');
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  await rm(state, { recursive: true, force: true });
}
