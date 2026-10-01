// Prepare with the same engine/dependencies as the sidecar, never the separately
// pinned phase-host export. The binary and raw input hashes invalidate the cache.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function prepareCardData({ root, resources, generator, sidecar, run }) {
  const source = path.resolve(process.env.PHASE_MANA_BUILD_CARD_DB ?? path.join(root, '../phase/data/mtgjson/AtomicCards.json'));
  try { await access(source); } catch {
    throw new Error(`Missing raw MTGJSON at ${source}. Set PHASE_MANA_BUILD_CARD_DB to AtomicCards.json before packaging.`);
  }
  const [generatorHash, sidecarHash, sourceHash] = await Promise.all([sha256(generator), sha256(sidecar), sha256(source)]);
  const key = createHash('sha256').update([generatorHash, sidecarHash, sourceHash].join(':')).digest('hex');
  const cache = path.join(root, '.phase-mana', 'prepared-cards', key);
  const output = path.join(cache, 'card-data.json');
  const manifestPath = path.join(cache, 'manifest.json');
  let manifest;
  try {
    const previous = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (previous.version === 1 && previous.generatorHash === generatorHash && previous.sidecarHash === sidecarHash && previous.sourceHash === sourceHash && previous.exportHash === await sha256(output)) {
      manifest = previous;
    }
  } catch { /* Absent/incomplete/stale cache is regenerated, never shipped. */ }
  if (!manifest) {
    await mkdir(cache, { recursive: true });
    const temporary = path.join(cache, `card-data-${process.pid}.json`);
    try {
      run(generator, ['--prepare-card-db', source, temporary]);
      manifest = { version: 1, generatorHash, sidecarHash, sourceHash, exportHash: await sha256(temporary) };
      await rename(temporary, output);
      // Publishing this last marks a complete cache; readers verify all hashes.
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    } finally {
      await rm(temporary, { force: true });
      await rm(temporary.replace(/\.json$/, '.json.partial'), { force: true });
    }
  } else {
    console.log(`Reusing same-build prepared cards: ${output}`);
  }
  // Even a cache hit must still be readable by this build's engine.
  run(generator, ['--validate-card-db', output]);
  const destination = path.join(resources, 'data');
  await mkdir(destination, { recursive: true });
  await cp(output, path.join(destination, 'card-data.json'));
  await writeFile(path.join(destination, 'card-data.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}
