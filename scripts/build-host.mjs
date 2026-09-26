#!/usr/bin/env node
// Build the multiplayer engine without changing the sibling phase checkout.
// Run from any directory: node /path/to/phase-mana/scripts/build-host.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const revision = '27f190967c3eff7a54794078c654df05d0c66045';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sibling = resolve(root, '../phase');
const host = join(root, '.phase-host');
const source = join(host, 'source');
const target = join(host, 'target');
const data = join(host, 'data');
const atomic = join(sibling, 'data/mtgjson/AtomicCards.json');
const env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_PROFILE_DEV_DEBUG: '0', RUST_MIN_STACK: process.env.RUST_MIN_STACK || '33554432' };

function run(command, args, cwd = root, capture = false) {
  console.log(`[host:build] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd, env, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.signal ?? `exit ${result.status}`}); see output above`);
  }
  return result.stdout?.trim();
}

let temporary;
try {
  if (!existsSync(atomic)) throw new Error(`Required MTGJSON input missing: ${atomic}`);
  mkdirSync(host, { recursive: true });
  // Never fetch or switch the sibling checkout. A missing revision is reported
  // directly; provision that revision in ../phase before retrying.
  run('git', ['rev-parse', '--verify', `${revision}^{commit}`], sibling, true);
  if (!existsSync(source)) {
    run('git', ['worktree', 'add', '--detach', source, revision], sibling);
  }
  if (!existsSync(join(source, '.git'))) throw new Error(`Not an isolated worktree: ${source}`);
  const head = run('git', ['rev-parse', 'HEAD'], source, true);
  if (head !== revision) throw new Error(`Worktree is at ${head}, expected ${revision}; refusing to reset it`);
  if (run('git', ['status', '--porcelain', '--untracked-files=all'], source, true)) {
    throw new Error(`Worktree has local changes: ${source}; refusing to build modified sources`);
  }
  console.log(`[host:build] Pinned source ready: ${source}`);
  run('cargo', ['build', '--locked', '--profile', 'dev', '-p', 'phase-server', '--bin', 'phase-server', '--features', 'manabrew'], source);
  run('cargo', ['build', '--locked', '--profile', 'dev', '-p', 'phase-engine', '--bin', 'oracle-gen', '--features', 'cli'], source);
  run('cargo', ['build', '--locked', '--profile', 'dev', '-p', 'draft-core', '--bin', 'draft-pool-gen'], source);
  mkdirSync(data, { recursive: true });
  temporary = mkdtempSync(join(data, '.card-data-'));
  const output = join(temporary, 'card-data.json');
  const suffix = process.platform === 'win32' ? '.exe' : '';
  run(join(target, 'debug', `oracle-gen${suffix}`), [join(source, 'data'), '--mtgjson', atomic, '--output', output], source);
  const cards = JSON.parse(readFileSync(output, 'utf8'));
  if (!cards || typeof cards !== 'object' || Array.isArray(cards) || Object.keys(cards).length === 0) {
    throw new Error('oracle-gen produced an empty or invalid card export');
  }
  renameSync(output, join(data, 'card-data.json'));
  // Server-hosted drafts read their own file; without it every create answers
  // "No draft pool data for set: X". Generated from the same MTGJSON sets that
  // the sibling checkout keeps, and promoted only when it produced sets.
  const sets = join(sibling, 'data/mtgjson/sets');
  if (!existsSync(sets)) throw new Error(`Required MTGJSON sets directory missing: ${sets}`);
  const draftPools = join(data, 'draft-pools.json');
  run(join(target, 'debug', `draft-pool-gen${suffix}`), [sets, draftPools], source);
  const pools = JSON.parse(readFileSync(draftPools, 'utf8'));
  if (!pools || typeof pools !== 'object' || Array.isArray(pools) || Object.keys(pools).length === 0) {
    throw new Error('draft-pool-gen produced an empty or invalid draft pool export');
  }
  console.log(`[host:build] Ready (${Object.keys(cards).length} card faces, ${Object.keys(pools).length} draftable sets)\nServer: ${join(target, 'debug', `phase-server${suffix}`)}\nData root: ${data}\nRevision: ${revision}`);
} catch (error) {
  console.error(`[host:build] ${error.message}`);
  process.exitCode = 1;
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
