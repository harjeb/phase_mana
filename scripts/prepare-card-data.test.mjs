import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareCardData } from './prepare-card-data.mjs';

test('prepared data is keyed to exact binaries and raw input, checked before reuse', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'phase-prepare-'));
  const root = path.join(base, 'app');
  const resources = path.join(root, 'resources');
  const generator = path.join(root, 'generator');
  const sidecar = path.join(root, 'sidecar');
  const source = path.join(base, 'phase/data/mtgjson/AtomicCards.json');
  let preparations = 0;
  let validations = 0;
  const options = { root, resources, generator, sidecar, run: (_, args) => {
    if (args[0] === '--prepare-card-db') {
      preparations++;
      assert.equal(args[1], source);
      writeFileSync(args[2], JSON.stringify({ source: readFileSync(source, 'utf8') }));
    } else {
      assert.equal(args[0], '--validate-card-db');
      validations++;
      JSON.parse(readFileSync(args[1], 'utf8'));
    }
  } };
  const saved = process.env.PHASE_MANA_BUILD_CARD_DB;
  delete process.env.PHASE_MANA_BUILD_CARD_DB;
  try {
    await mkdir(root, { recursive: true });
    await writeFile(generator, 'engine v1');
    await writeFile(sidecar, 'server v1');
    await assert.rejects(prepareCardData(options), /Missing raw MTGJSON/);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, 'raw v1');
    await prepareCardData(options);
    assert.equal(preparations, 1);
    await prepareCardData(options);
    assert.equal(preparations, 1);
    assert.equal(validations, 2);
    const manifest = JSON.parse(await readFile(path.join(resources, 'data/card-data.manifest.json'), 'utf8'));
    assert.match(manifest.sidecarHash, /^[a-f0-9]{64}$/);
    await writeFile(sidecar, 'server v2');
    await prepareCardData(options);
    assert.equal(preparations, 2, 'changing shipped engine forces regeneration');
    await writeFile(generator, 'engine v2');
    await prepareCardData(options);
    assert.equal(preparations, 3);
    await writeFile(source, 'raw v2');
    await prepareCardData(options);
    assert.equal(preparations, 4);
    const { readdir } = await import('node:fs/promises');
    for (const key of await readdir(path.join(root, '.phase-mana/prepared-cards'))) {
      await writeFile(path.join(root, '.phase-mana/prepared-cards', key, 'card-data.json'), 'corrupt');
    }
    await prepareCardData(options);
    assert.equal(preparations, 5, 'corrupted cached bytes must be regenerated');
    assert.deepEqual(JSON.parse(await readFile(path.join(resources, 'data/card-data.json'), 'utf8')), { source: 'raw v2' });
  } finally {
    if (saved === undefined) delete process.env.PHASE_MANA_BUILD_CARD_DB;
    else process.env.PHASE_MANA_BUILD_CARD_DB = saved;
    await rm(base, { recursive: true, force: true });
  }
});
