import { spawnSync } from 'node:child_process';
import { cp, mkdir, rm, access, chmod, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function run(command, argv, capture = false) {
  const result = spawnSync(command, argv, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result.stdout;
}
try {
  const targetIndex = args.indexOf('--target');
  const target = targetIndex >= 0 ? args[targetIndex + 1] : run('rustc', ['-vV'], true).match(/^host: (.+)$/m)?.[1].trim();
  if (!target || target.startsWith('--')) throw new Error('Cannot determine Rust target');
  const manifest = path.join(root, 'server', 'Cargo.toml');
  await access(path.join(root, 'dist', 'index.html'));
  const metadata = JSON.parse(run('cargo', ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest], true));
  run('cargo', ['build', '--release', '--manifest-path', manifest, '--target', target]);
  const extension = target.includes('windows') ? '.exe' : '';
  const binaries = path.join(root, 'src-tauri', 'binaries');
  const resources = path.join(root, 'src-tauri', 'resources');
  await mkdir(binaries, { recursive: true });
  await rm(resources, { recursive: true, force: true });
  await mkdir(resources, { recursive: true });
  const staged = path.join(binaries, `phase-mana-server-${target}${extension}`);
  await cp(path.join(metadata.target_directory, target, 'release', `phase-mana-server${extension}`), staged);
  if (!extension) await chmod(staged, 0o755);
  await cp(path.join(root, 'dist'), path.join(resources, 'web-dist'), { recursive: true });
  try {
    await access(path.join(root, 'resources', 'draft-pools'));
    await cp(path.join(root, 'resources', 'draft-pools'), path.join(resources, 'draft-pools'), { recursive: true });
  } catch (e) { if (e.code !== 'ENOENT') throw e; console.warn('No optional draft pools bundled.'); }
  const licenses = path.join(resources, 'licenses');
  await mkdir(licenses, { recursive: true });
  for (const name of ['LICENSE', 'NOTICE', 'THIRD-PARTY-LICENSES.md']) await cp(path.join(root, name), path.join(licenses, name));
  for (const name of await readdir(path.resolve(root, '../phase'))) {
    if (/^(LICENSE|NOTICE)/.test(name)) await cp(path.resolve(root, '../phase', name), path.join(licenses, `phase-${name}`));
  }
  await writeFile(path.join(licenses, 'desktop-dependencies.txt'), 'Tauri: MIT OR Apache-2.0; reqwest: MIT OR Apache-2.0; Tokio: MIT; serde/serde_json: MIT OR Apache-2.0. See src-tauri/Cargo.lock for exact resolved dependencies. MTGJSON data is downloaded separately from https://mtgjson.com/; Magic card content remains property of its respective owners.\n');
  if (!args.includes('--stage-only')) {
    // Run npm-installed Tauri CLI directly with Node; avoids Windows .cmd quoting/shell injection.
    const cli = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
    await access(cli);
    const forwarded = args.filter((arg, i) => !['--dev', '--stage-only', '--target'].includes(arg) && (targetIndex < 0 || i !== targetIndex + 1));
    run(process.execPath, [cli, args.includes('--dev') ? 'dev' : 'build', '--target', target, ...forwarded]);
  }
} catch (error) {
  console.error(`Tauri desktop build failed: ${error.message}\nBuild dist first; see src-tauri/README.md.`);
  process.exitCode = 1;
}
