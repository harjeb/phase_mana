// Audit actual application-generated image URLs against a local image library.
// Read-only: no downloads, renames, configuration changes, or game actions.
// Run: node tools/audit-local-card-images.mjs [output.json]
import { createServer } from 'vite';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const config = JSON.parse(await readFile('card-images.config.json', 'utf8'));
const library = process.env.PHASE_MANA_CARD_IMAGES || config.dir;
const output = process.argv[2] || 'tools/local-card-images-audit.json';
const inventory = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (/\.(webp|png|jpe?g)$/i.test(entry.name)) inventory.push(relative(library, path).replaceAll('\\', '/'));
  }
}
await walk(library);
const exact = new Set(inventory.map(path => path.toLowerCase()));
const fold = name => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replaceAll('æ', 'ae').replaceAll('œ', 'oe').replaceAll('ø', 'o').replaceAll('ß', 'ss').replace(/[^a-z0-9]/g, '');
const folded = new Map();
for (const path of inventory) {
  const basename = path.split('/').at(-1).replace(/(?:\.full)?\.(webp|png|jpe?g)$/i, '');
  const stem = path.startsWith('downloaded/') ? (/^[a-z0-9]+--(.+)--\d+$/i.exec(basename)?.[1] || basename) : basename;
  const key = fold(stem);
  if (!folded.has(key)) folded.set(key, []);
  folded.get(key).push(path);
}
const vite = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { localCardImageUris, withLocalCardArt } = await vite.ssrLoadModule('/ui/lib/localCardArt.ts');
  const database = new DatabaseSync('data/scryfall.db', { readOnly: true });
  const cards = new Map();
  for (const { json } of database.prepare('SELECT json FROM cards').all()) {
    const card = JSON.parse(json);
    if (!cards.has(card.name)) cards.set(card.name, { name: card.name, set: card.set, number: card.collector_number, layout: card.layout });
    if (card.card_faces && !card.image_uris) for (const face of card.card_faces) {
      if (!cards.has(face.name)) cards.set(face.name, { name: face.name, set: card.set, number: card.collector_number, layout: card.layout, parent: card.name });
    }
  }
  database.close();
  const matched = [], recoverable = [], missing = [];
  for (const card of cards.values()) {
    const uri = localCardImageUris(card.name)?.normal;
    const url = uri ? new URL(uri, 'http://localhost') : undefined;
    const attempted = url ? [url.pathname, ...url.searchParams.getAll('alt')].map(path => decodeURIComponent(path).replace(/^\/card-images\//, '')) : [];
    const hit = attempted.find(path => exact.has(path.toLowerCase()));
    if (hit) { matched.push({ ...card, path: hit, alternate: hit !== attempted[0] }); continue; }
    const candidates = [...new Set([
      ...(folded.get(fold(card.name)) || []),
      ...attempted.flatMap(path => folded.get(fold(path.split('/').at(-1).replace(/\.full\.webp$/, ''))) || []),
    ])];
    if (candidates.length) recoverable.push({ ...card, attempted, candidates });
    else missing.push({ ...card, attempted });
  }
  const formats = Object.fromEntries(['.webp','.jpg','.jpeg','.png'].map(ext => [ext, inventory.filter(p => extname(p).toLowerCase() === ext).length]));
  const report = { library, summary: { files: inventory.length, formats, cardAndFaceNames: cards.size, matched: matched.length,
    matchedByAlternate: matched.filter(c => c.alternate).length, filenameOrLayoutMisses: recoverable.length, noEquivalentFile: missing.length },
    recoverable, missing, matchedByAlternate: matched.filter(c => c.alternate) };
  const verifyIndex = process.argv.indexOf('--verify-from');
  if (verifyIndex >= 0) {
    const before = JSON.parse(await readFile(process.argv[verifyIndex + 1], 'utf8'));
    const base = process.env.AUDIT_HTTP_BASE || 'http://127.0.0.1:1420';
    report.httpVerified = [];
    for (const previous of before.recoverable) {
      const hit = matched.find(card => card.name === previous.name);
      assert.ok(hit, `Still missing: ${previous.name}`);
      const uri = withLocalCardArt({ normal: 'https://cards.scryfall.io/not-used.jpg' }, previous.name).normal;
      const response = await fetch(new URL(uri, base), { redirect: 'manual' });
      assert.equal(response.status, 200, `Must serve local bytes, not redirect: ${previous.name}`);
      const hash = bytes => createHash('sha256').update(bytes).digest('hex');
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(await readFile(resolve(library, hit.path))), previous.name);
      report.httpVerified.push({ name: previous.name, path: hit.path });
    }
    console.log(`Verified ${report.httpVerified.length} recovered names over HTTP against the actual local file bytes.`);
  }
  await writeFile(output, JSON.stringify(report, null, 2)+'\n');
  console.log(JSON.stringify(report.summary, null, 2));
  console.log('Report:', output);
} finally { await vite.close(); }
