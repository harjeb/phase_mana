"""Rebuild exact printed reminder quotations from local MTGJSON set files.

Run from repository root: python tools/build-keyword-help-sources.py
Only individually reviewed selections below are published. No Oracle text,
translation, punctuation normalization, or parameter substitution is performed.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SETS = ROOT / 'data/mtgjson/sets'
LANGUAGES = {'en': 'English', 'zh-Hans': 'Chinese Simplified', 'zh-Hant': 'Chinese Traditional'}
# Filled with reviewed (set, collector number) selections, by keyword and locale.
COMMON = {
    'lifelink': ['M19', '10'], 'vigilance': ['M19', '12'],
    'defender': ['M19', '30'], 'flash': ['M19', '100'],
    'menace': ['M19', '123'], 'trample': ['M19', '146'],
    'haste': ['M19', '147'], 'deathtouch': ['M19', '174'],
    'reach': ['M19', '183'], 'hexproof': ['M19', '207'],
    'flying': ['M19', '285'], 'double strike': ['M20', '16'],
    'first strike': ['M20', '221'], 'intimidate': ['M15', '85'],
    'indestructible': ['AKH', '28'], 'prowess': ['M21', '53'],
    'exalted': ['M13', '4'], 'shadow': ['CLB', '748'],
    'skulk': ['SOI', '63'],
    'kicker': ['DOM', '46'],
}
SELECTIONS = {key: {locale: printing for locale in LANGUAGES} for key, printing in COMMON.items()}
SELECTIONS.update({
    'shroud': {'en': ['M10', '188'], 'zh-Hans': ['M10', '188'], 'zh-Hant': ['CMR', '452']},
    'fear': {'en': ['10E', '177'], 'zh-Hans': ['A25', '99'], 'zh-Hant': ['AFC', '110']},
    'infect': {'en': ['2XM', '107'], 'zh-Hans': ['2XM', '107'], 'zh-Hant': ['MBS', '16']},
    'battle cry': {'en': ['40K', '137'], 'zh-Hans': ['40K', '137'], 'zh-Hant': ['MBS', '1']},
    'horsemanship': {'en': ['C13', '49'], 'zh-Hans': ['MOC', '22']},
    'wither': {'en': ['EVE', '38'], 'zh-Hans': ['EVE', '38']},
    'decayed': {'en': ['TDM', '87'], 'zh-Hans': ['MID', '96'], 'zh-Hant': ['MID', '96']},
})
# No reviewed generic quote for ward/protection/equip/crew/toxic/annihilator.
# Fixed costs/counts and specific protection qualities must not become generic help.


def candidates(selected_only=False):
    names = dict((m[0].strip('"'), (m[1], m[2])) for m in re.findall(
        r'^  ("[^"]+"|[\w]+): \{ hans: "([^"]+)", hant: "([^"]+)" \}',
        (ROOT / 'ui/i18n/cardKeywords.ts').read_text(encoding='utf-8'), re.M))
    keys = 'flying|first strike|double strike|trample|deathtouch|lifelink|vigilance|haste|reach|defender|menace|indestructible|hexproof|shroud|flash|fear|intimidate|skulk|shadow|horsemanship|wither|infect|ward|prowess|decayed|protection|equip|crew|toxic|annihilator|battle cry|exalted|kicker'.split('|')
    preferred = 'M19 M20 M15 M21 M14 M13 M12 M11 M10 ORI 10E 9ED 8ED'.split()
    paths = [SETS / (s + '.json') for s in preferred]
    paths += [p for p in sorted(SETS.glob('*.json')) if p.stem not in preferred]
    selected_sets = {printing[0] for locales in SELECTIONS.values() for printing in locales.values()}
    for path in paths:
        if selected_only and path.stem not in selected_sets:
            continue
        if not path.exists():
            continue
        for card in json.loads(path.read_text(encoding='utf-8'))['data']['cards']:
            for locale, language in LANGUAGES.items():
                versions = [card] if locale == 'en' else [f for f in card.get('foreignData', []) if f['language'] == language]
                for version in versions:
                    field = 'originalText' if locale == 'en' else 'text'
                    text = version.get(field, '')
                    for key in keys:
                        label = key if locale == 'en' else names[key][0 if locale == 'zh-Hans' else 1]
                        aliases = {'shadow': ('次元幽影', '次元幽影'), 'decayed': ('败朽', '敗朽'), 'wither': ('乾枯', '乾枯')}
                        labels = [label]
                        if locale != 'en' and key in aliases:
                            labels.append(aliases[key][0 if locale == 'zh-Hans' else 1])
                        # An isolated keyword at line start, immediately followed by
                        # its reminder. Optional equip mana costs are not quoted.
                        suffix = r'(?:\s*\{[^}]+\})*' if key in ('equip', 'kicker') else ''
                        pattern = r'(?:^|\n)' + '(?:' + '|'.join(re.escape(label) for label in labels) + ')' + suffix + r'\s*[（(]([^()（）]+)[）)]'
                        # Diregraf Horde's token reminder is embedded in its
                        # triggered ability, but describes only decayed.
                        if key == 'decayed' and locale != 'en' and path.stem == 'MID' and card['number'] == '96':
                            pattern = r'[（(](具(?:败朽|敗朽)异能[^()（）]+|具敗朽異能[^()（）]+)[）)]'
                        match = re.search(pattern, text, re.I)
                        if not match or version.get('name', card['name']) in match[1]:
                            continue
                        ids = version.get('identifiers', {})
                        sid = ids.get('scryfallId')
                        mid = ids.get('multiverseId') or version.get('multiverseId')
                        if not sid and not mid:
                            continue
                        source = {'set': path.stem, 'collectorNumber': card['number'], 'card': card['name'],
                                  'printedName': version.get('name', card['name']), 'language': language,
                                  'url': f'https://scryfall.com/card/{sid}' if sid else f'https://gatherer.wizards.com/Pages/Card/Details.aspx?multiverseid={mid}',
                                  'field': 'cards[].originalText' if locale == 'en' else 'cards[].foreignData[].text'}
                        entry = {'text': match[1], 'source': source}
                        if key == 'kicker':
                            # Only the mana-cost token is substituted at display time.
                            # Keep the original quotation and its example cost auditable.
                            entry['parameter'] = '{1}{U}'
                        yield key, locale, entry


def build():
    result = {}
    for key, locale, entry in candidates(selected_only=True):
        if SELECTIONS.get(key, {}).get(locale) == [entry['source']['set'], entry['source']['collectorNumber']]:
            result.setdefault(key, {}).setdefault(locale, entry)
    expected = sum(len(v) for v in SELECTIONS.values())
    assert sum(len(v) for v in result.values()) == expected, 'A reviewed quotation is missing'
    header = '''// Generated by tools/build-keyword-help-sources.py. Do not author reminder prose here.
// Exact reminder-parenthesis contents from printed cards in local MTGJSON.
// Missing keywords/locales intentionally have no sourced generic quotation.
export type KeywordHelpLocale = "en" | "zh-Hans" | "zh-Hant";
export interface KeywordHelpSource {
  set: string;
  collectorNumber: string;
  card: string;
  printedName: string;
  language: string;
  url: string;
  field: string;
}
export interface SourcedKeywordHelp {
  parameter?: string;
  text: string;
  source: KeywordHelpSource;
}
export const KEYWORD_HELP_SOURCES: Record<string, Partial<Record<KeywordHelpLocale, SourcedKeywordHelp>>> = '''
    (ROOT / 'ui/i18n/keywordHelpSources.ts').write_text(header + json.dumps(result, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')


if __name__ == '__main__':
    import sys
    if '--candidates' in sys.argv:
        found = {}
        for key, locale, entry in candidates():
            bucket = found.setdefault(key, {}).setdefault(locale, [])
            if len(bucket) < 3 and not any(e['text'] == entry['text'] for e in bucket):
                bucket.append(entry)
        print(json.dumps(found, ensure_ascii=False, indent=2))
    else:
        build()
