"""Regenerate ability-word quotations, validating each against its source snapshot.

Official Chinese card text originates in data/mtgjson/sets/*.json foreignData;
MTGCH-only mechanics use the source URLs recorded in the manifest. The manifest
preserves full source text so excerpts and omissions can be reviewed offline.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'tools/ability-word-help-sources.json').read_text(encoding='utf8'))
entries = {}
unsupported = {}
for key, item in manifest.items():
    assert item['name'] in item['fullText'], (key, 'name absent from source')
    if 'unsupportedReason' in item:
        unsupported[key] = {
            'name': item['name'],
            'reason': item['unsupportedReason'],
            'source': item['source'],
        }
        continue
    assert item['fragments'], key
    for fragment in item['fragments']:
        assert fragment in item['fullText'], (key, fragment)
    entries[key] = {
        'name': item['name'],
        'text': '…'.join('「' + fragment + '」' for fragment in item['fragments']),
        'source': item['source'],
    }

header = '''// Simplified Chinese source quotations, not newly authored rules summaries.
// Ability words have no independent rules meaning. These are condition/cost excerpts;
// the printed card supplies its effect. Card names, colors, and zones in a quotation
// belong to the cited example (not a universal requirement). Ellipses mark omissions.
// Descend quotes the keyword action; descend 4/8 are separate threshold abilities.
// Double team is a digital keyword, included here because it is absent from paper CR.
// Generated and substring-verified by tools/build-ability-word-help.py.
export const ABILITY_WORD_HELP: Record<string, {
  name: string;
  text: string;
  source: { url: string; field: string; card?: string };
}> = '''
output = header + json.dumps(entries, ensure_ascii=False, indent=2) + ';\n'
output += '\n// A translated name alone is not a sourced explanation. Do not show it as help.\n'
output += 'export const UNSUPPORTED_ABILITY_WORD_HELP = '
output += json.dumps(unsupported, ensure_ascii=False, indent=2) + ' as const;\n'
(ROOT / 'ui/i18n/keywordHelpAbilityWords.ts').write_text(output, encoding='utf8')
print(f'Verified {len(entries)} quotations; {len(unsupported)} unsupported explanations.')
