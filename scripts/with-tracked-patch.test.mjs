import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withTrackedPatch } from './with-tracked-patch.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'owned-host-patch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'repo');
  mkdirSync(source);
  const git = (...args) => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const put = (name, text) => writeFileSync(join(source, name), text);
  const get = name => readFileSync(join(source, name), 'utf8');
  git('init');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.autocrlf', 'false');
  put('owned.txt', 'before\n');
  put('unrelated.txt', 'original\n');
  git('add', '.');
  git('commit', '-m', 'base');
  const revision = git('rev-parse', 'HEAD');
  put('owned.txt', 'patched\n');
  const patch = join(root, 'host.patch');
  writeFileSync(patch, git('diff', '--binary') + '\n');
  put('owned.txt', 'before\n');
  return { source, revision, patch, git, put, get };
}

test('successful build restores a clean pinned checkout', async t => {
  const f = fixture(t);
  await withTrackedPatch(f, () => assert.equal(f.get('owned.txt'), 'patched\n'));
  assert.equal(f.get('owned.txt'), 'before\n');
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(f.git('rev-parse', 'HEAD'), f.revision);
});

for (const fail of [false, true]) {
  test(`rolls back on ${fail ? 'failure' : 'success'}, preserving unrelated work`, async t => {
    const f = fixture(t);
    const build = async () => {
      assert.equal(f.get('owned.txt'), 'patched\n');
      f.put('unrelated.txt', 'user edit\n');
      f.git('add', 'unrelated.txt');
      f.put('new.txt', 'new user file\n');
      // Cleanup must use its own original bytes, not reread this file.
      writeFileSync(f.patch, 'replaced during build');
      if (fail) throw new Error('build failed');
      return 42;
    };
    if (fail) await assert.rejects(withTrackedPatch(f, build), /build failed/);
    else assert.equal(await withTrackedPatch(f, build), 42);
    assert.equal(f.get('owned.txt'), 'before\n');
    assert.equal(f.get('unrelated.txt'), 'user edit\n');
    assert.equal(f.get('new.txt'), 'new user file\n');
    assert.equal(f.git('diff', '--cached', '--name-only'), 'unrelated.txt');
    assert.equal(f.git('diff'), '');
  });
}

for (const dirty of ['tracked', 'staged', 'untracked', 'already patched']) {
  test(`rejects initially dirty checkout: ${dirty}`, async t => {
    const f = fixture(t);
    if (dirty === 'untracked') f.put('new.txt', 'keep\n');
    else if (dirty === 'already patched') f.put('owned.txt', 'patched\n');
    else f.put('unrelated.txt', 'keep\n');
    if (dirty === 'staged') f.git('add', 'unrelated.txt');
    const status = f.git('status', '--porcelain');
    await assert.rejects(withTrackedPatch(f, () => assert.fail('must not build')), /local changes/);
    assert.equal(f.git('status', '--porcelain'), status);
  });
}

test('rejects wrong revision without applying', async t => {
  const f = fixture(t);
  await assert.rejects(withTrackedPatch({ ...f, revision: '0'.repeat(40) }, () => assert.fail()), /expected/);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('invalid patch fails check without building or reversing', async t => {
  const f = fixture(t);
  writeFileSync(f.patch, readFileSync(f.patch, 'utf8').replace('-before', '-absent'));
  await assert.rejects(withTrackedPatch(f, () => assert.fail()), /apply --check/);
  assert.equal(f.get('owned.txt'), 'before\n');
  assert.equal(f.git('status', '--porcelain'), '');
});

test('missing patch fails without mutation', async t => {
  const f = fixture(t);
  rmSync(f.patch);
  await assert.rejects(withTrackedPatch(f, () => assert.fail()), /ENOENT/);
  assert.equal(f.git('status', '--porcelain'), '');
});

for (const fail of [false, true]) {
  test(`conflicting rollback leaves edits intact (${fail ? 'failed' : 'successful'} build)`, async t => {
    const f = fixture(t);
    await assert.rejects(withTrackedPatch(f, () => {
      f.put('owned.txt', 'concurrent conflicting edit\n');
      f.put('new.txt', 'keep\n');
      if (fail) throw new Error('original build error');
    }), error => {
      assert.match(error.message, /rollback failed.*manual review/);
      if (fail) {
        assert.ok(error instanceof AggregateError);
        assert.match(error.errors[0].message, /original build error/);
      }
      return true;
    });
    assert.equal(f.get('owned.txt'), 'concurrent conflicting edit\n');
    assert.equal(f.get('new.txt'), 'keep\n');
  });
}
