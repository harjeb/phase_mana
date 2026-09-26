// Apply narrowly reviewed UI translations without rewriting unrelated PO entries.
// Usage: node tools/apply-reviewed-zh-translations.mjs tools/*-zh-translations.json
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parsePoFile } from '@lingui/format-po';

const paths = process.argv.slice(2);
assert.ok(paths.length, 'Provide at least one translation map');
const translations = Object.assign({}, ...paths.map(path => JSON.parse(readFileSync(path, 'utf8'))));
for (const [id, entry] of Object.entries(translations)) {
  assert.equal(typeof entry.hans, 'string', id);
  assert.equal(typeof entry.hant, 'string', id);
  const parameters = text => [...text.matchAll(/\{([\w$]+)\}/g)].map(match => match[1]).sort();
  assert.deepEqual(parameters(entry.hans), parameters(id), `Simplified placeholders: ${id}`);
  assert.deepEqual(parameters(entry.hant), parameters(id), `Traditional placeholders: ${id}`);
}
for (const [locale, script] of [['en', null], ['zh-Hans', 'hans'], ['zh-Hant', 'hant']]) {
  const path = `ui/i18n/locales/${locale}/messages.po`;
  const source = readFileSync(path, 'utf8');
  const found = new Set();
  let changed = 0;
  const blocks = source.split(/\r?\n\r?\n/).map(block => {
    const item = parsePoFile(block).items[0];
    if (!item || !Object.hasOwn(translations, item.msgid)) return block;
    assert.ok(!item.msgid_plural, 'ICU messages only');
    const id = item.msgid;
    const text = script ? translations[id][script] : id;
    found.add(id);
    if (item.msgstr[0] === text) return block;
    changed++;
    return block.replace(/^msgstr "[^\n]*"(?:\r?\n"[^\n]*")*/m, `msgstr ${JSON.stringify(text)}`);
  });
  for (const [id, entry] of Object.entries(translations)) {
    if (found.has(id)) continue;
    const text = script ? entry[script] : id;
    blocks.push(`msgid ${JSON.stringify(id)}\nmsgstr ${JSON.stringify(text)}`);
    changed++;
  }
  writeFileSync(path, blocks.join('\n\n').trimEnd() + '\n');
  console.log(`${locale}: ${changed} entries updated`);
}
