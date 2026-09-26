// Apply the reviewed Simplified Chinese translations after `npm run extract`.
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parsePoFile } from '@lingui/format-po';

const translations = Object.assign(
  {},
  JSON.parse(readFileSync('tools/play-i18n-translations.json', 'utf8')),
  JSON.parse(readFileSync('tools/play-home-i18n-translations.json', 'utf8')),
  ...[
    'tools/deck-vs-i18n-translations.json',
    'tools/lobby-i18n-translations.json',
    'tools/play-views-i18n-translations.json',
    'tools/play-descendants-i18n-translations.json',
    'tools/lobby-extra-i18n-translations.json',
    'tools/create-game-i18n-translations.json',
    'tools/lobby-chat-i18n-translations.json',
    'tools/table-setup-i18n-translations.json',
    'tools/onboarding-i18n-translations.json',
    'tools/settings-page-i18n-translations.json',
    'tools/settings-components-i18n-translations.json',
    'tools/local-tournament-i18n-translations.json',
    'tools/limited-variants-i18n-translations.json',
    ...process.argv.slice(2),
  ].map(path => JSON.parse(readFileSync(path, 'utf8'))),
);
const path = 'ui/i18n/locales/zh-Hans/messages.po';
const source = readFileSync(path, 'utf8');
const found = new Set();
let updated = 0;
const result = source.split(/\r?\n\r?\n/).map(block => {
  const item = parsePoFile(block).items[0];
  if (!item || !Object.hasOwn(translations, item.msgid)) return block;
  found.add(item.msgid);
  // Preserve existing reviewed translations; this patch fills omissions only.
  if (item.msgstr[0]?.trim()) return block;
  assert.match(block, /^msgstr ""$/m, item.msgid);
  updated++;
  return block.replace(/^msgstr ""$/m, `msgstr ${JSON.stringify(translations[item.msgid])}`);
}).join('\n\n');
assert.deepEqual(Object.keys(translations).filter(id => !found.has(id)), [], 'extract before applying translations');
writeFileSync(path, result);
console.log(`Filled ${updated} Simplified Chinese translations.`);
