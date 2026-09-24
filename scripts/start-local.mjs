import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const serverOnly = process.argv.includes('--server-only');
const state = resolve(process.env.PHASE_MANA_STATE_DIR || '.phase-mana');
const discovery = process.env.PHASE_MANA_ENDPOINT_FILE || resolve(state, 'server.json');
let child, vite, stopping = false, publishedPid;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  try { await vite?.close(); } catch (error) { console.error('Could not close Vite:', error); }
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(done => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); done(); }, 3000);
      child.once('exit', () => { clearTimeout(timer); done(); });
      child.kill();
    });
  }
  try { if (JSON.parse(await readFile(discovery, 'utf8')).pid === publishedPid) await rm(discovery); } catch {}
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });
async function run(args, capture = false) {
  return new Promise((done, reject) => {
    child = spawn('cargo', args, { cwd: root, stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'] });
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? done(output) : reject(new Error(`cargo exited (${code})`)));
  });
}
try {
  await run(['build', '--release', '--manifest-path', 'server/Cargo.toml']);
  if (!stopping) {
    const metadata = JSON.parse(await run(['metadata', '--no-deps', '--format-version', '1', '--manifest-path', 'server/Cargo.toml'], true));
    if (!stopping) {
      const env = { ...process.env }; delete env.PHASE_MANA_ENDPOINT_FILE;
      child = spawn(resolve(metadata.target_directory, 'release', process.platform === 'win32' ? 'phase-mana-server.exe' : 'phase-mana-server'), [], { cwd: root, env, stdio: ['ignore', 'pipe', 'inherit'] });
      const lines = createInterface({ input: child.stdout });
      const endpoint = await new Promise((done, reject) => {
        child.once('error', reject);
        child.once('exit', code => { reject(new Error(`Backend exited (${code})`)); void stop(code || 0); });
        lines.on('line', line => {
          console.log(line);
          try {
            const value = JSON.parse(line);
            if (value.event === 'ready' && value.pid === child.pid && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535) done(value);
          } catch {}
        });
      });
      if (!stopping) {
        if (serverOnly) {
          await mkdir(dirname(discovery), { recursive: true });
          const tmp = `${discovery}.${randomUUID()}.tmp`;
          publishedPid = endpoint.pid;
          await writeFile(tmp, JSON.stringify({ port: endpoint.port, pid: endpoint.pid }));
          await rename(tmp, discovery);
        } else {
          process.env.PHASE_MANA_API_URL = `http://127.0.0.1:${endpoint.port}`;
          const { createServer } = await import('vite');
          const frontend = await createServer({ root, server: { open: true } });
          vite = frontend;
          // Ctrl+C/backend exit may happen while Vite loads its config.
          if (stopping) {
            await frontend.close();
          } else {
            await frontend.listen();
            if (stopping) await frontend.close();
            else frontend.printUrls();
          }
        }
        if (!stopping) console.log('Press Ctrl+C to stop this instance. / 按 Ctrl+C 关闭本次启动的服务。');
      }
    }
  }
} catch (error) {
  if (!stopping) console.error(error);
  await stop(stopping ? 0 : 1);
}
