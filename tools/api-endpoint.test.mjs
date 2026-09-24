import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProxy, resolveApiTarget, validateApiUrl } from './api-endpoint.mjs';
import { preview } from 'vite';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections?.(); });

test('explicit URL restricted to loopback HTTP origin', () => {
  assert.equal(validateApiUrl('http://127.0.0.1:3010'), 'http://127.0.0.1:3010');
  for (const url of ['https://example.com', 'http://localhost:3010', 'http://127.0.0.1:3010/foo', 'http://a:b@127.0.0.1:3010']) assert.throws(() => validateApiUrl(url));
});
test('endpoint discovery ignores invalid/dead PID entries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phase-endpoint-'));
  const file = join(dir, 'server.json');
  try {
    await writeFile(file, JSON.stringify({ port: 3015, pid: process.pid }));
    assert.equal(resolveApiTarget({ PHASE_MANA_ENDPOINT_FILE: file }), 'http://127.0.0.1:3015');
    await writeFile(file, JSON.stringify({ port: 3015, pid: -1 }));
    assert.equal(resolveApiTarget({ PHASE_MANA_ENDPOINT_FILE: file }), 'http://127.0.0.1:3001');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('Vite increments occupied port and proxy follows backend restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'phase-preview-'));
  const occupied = http.createServer();
  const first = http.createServer((_req, res) => res.end('first'));
  const second = http.createServer((_req, res) => res.end('second'));
  const saved = { url: process.env.PHASE_MANA_API_URL, file: process.env.PHASE_MANA_ENDPOINT_FILE };
  let vite;
  try {
    const port = await listen(occupied);
    const a = await listen(first), b = await listen(second);
    await mkdir(join(dir, 'dist'));
    await writeFile(join(dir, 'dist', 'index.html'), 'OK');
    delete process.env.PHASE_MANA_API_URL;
    process.env.PHASE_MANA_ENDPOINT_FILE = join(dir, 'endpoint.json');
    const publish = port => writeFile(process.env.PHASE_MANA_ENDPOINT_FILE, JSON.stringify({ port, pid: process.pid }));
    await publish(a);
    vite = await preview({ root: dir, configFile: false, preview: { host: '127.0.0.1', port, strictPort: false, proxy: createProxy() } });
    const actual = vite.httpServer.address().port;
    // Other test listeners/the OS can occupy intervening ports as well.
    assert.ok(actual > port && actual < port + 100);
    assert.equal(await (await fetch(`http://127.0.0.1:${actual}/api/test`)).text(), 'first');
    await publish(b);
    assert.equal(await (await fetch(`http://127.0.0.1:${actual}/api/test`)).text(), 'second');
  } finally {
    if (vite) await close(vite.httpServer);
    await Promise.all([occupied, first, second].map(close));
    if (saved.url === undefined) delete process.env.PHASE_MANA_API_URL; else process.env.PHASE_MANA_API_URL = saved.url;
    if (saved.file === undefined) delete process.env.PHASE_MANA_ENDPOINT_FILE; else process.env.PHASE_MANA_ENDPOINT_FILE = saved.file;
    await rm(dir, { recursive: true, force: true });
  }
});
