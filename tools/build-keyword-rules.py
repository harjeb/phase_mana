"""Extract bilingual keyword definitions verbatim from MTGCH's comprehensive rules.

python tools/build-keyword-rules.py
Uses cached downloads in tools/_mtgch-{ch7,glossary}.json when present.
Otherwise downloads the two public articles. Only strips HTML and rule-number
prefixes; no translation, summarization or substitution of rule prose.
Chinese CR attribution: Greater China judge community, hosted by MTGCH.
"""
import hashlib
import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://mtgch.com'


def load(slug, cache):
    path = ROOT / 'tools' / cache
    raw = path.read_bytes() if path.exists() else urllib.request.urlopen(
        BASE + '/api/v1/blog/get/cr/' + slug + '/', timeout=40).read()
    return json.loads(raw)['data']['body_html'], hashlib.sha256(raw).hexdigest()


def plain(markup):
    return html.unescape(re.sub('<[^>]*>', '', markup)).strip()


def paragraphs(body):
    result = {}
    for p in re.findall(r'<p>(.*?)</p>', body, re.S):
        parts = re.split(r'<br\s*/?>', p)
        if len(parts) != 2:
            continue
        zh, en = map(plain, parts)
        match = re.match(r'(70[12]\.\d+[a-z])\s+', zh)
        if match:
            number = match[1]
            result[number] = (zh[len(match[0]):], re.sub(r'^' + re.escape(number) + r'\s+', '', en))
    return result


def build():
    chapter, chapter_hash = load('7', '_mtgch-ch7.json')
    glossary, glossary_hash = load('glossary', '_mtgch-glossary.json')
    glossary_entries = {}
    for section in re.split('<h3>', glossary)[1:]:
        head, body = section.split('</h3>', 1)
        names = [plain(s) for s in re.findall(r'<span[^>]*>(.*?)</span>', head)]
        p = re.search(r'<p>(.*?)</p>', body, re.S)
        if len(names) != 2 or not p:
            continue
        parts = re.split(r'<br\s*/?>', p[1])
        if len(parts) == 2:
            glossary_entries[names[0].lower()] = dict(name=names[1], zh=plain(parts[0]), en=plain(parts[1]), source=BASE+'/cr/glossary/#'+urllib.parse.quote(names[0]), rules=[])
    all_rules = paragraphs(chapter)
    entries = {}
    # Defaults select a complete defining paragraph; exceptions need additional
    # rules to actually explain their effect, or a different defining paragraph.
    selections = {
        'read ahead': ['702.155a','702.155b'],
        'menace': ['702.111b'],
        'phasing': ['702.26a','702.26b','702.26c','702.26d','702.26g'],
        'forecast': ['702.57a','702.57b'],
        'bestow': ['702.103a','702.103b','702.103e','702.103f'],
        'hidden agenda': ['702.106a','702.106c'],
        'partner': ['702.124h','702.124b','702.124c','702.124f'],
        'mutate': ['702.140a','702.140b','702.140c','702.140d','702.140e'],
        'daybound and nightbound': ['702.145b','702.145c','702.145d','702.145e','702.145f','702.145g'],
        'space sculptor': ['702.158b','702.158c'],
        'solved': ['702.169b','702.169c','702.169d'],
        'plot': ['702.170a','702.170b','702.170d'],
        'gift': ['702.174a','702.174b','702.174d','702.174e','702.174f','702.174g','702.174h','702.174i','702.174j','702.174k'],
        '∞ (infinity)': ['702.186b'],
        'sneak': ['702.190a','702.190b'],
        'protection': ['702.16b','702.16c','702.16d','702.16e','702.16f'],
        'banding': ['702.22c','702.22h','702.22j','702.22k'],
        'flying': ['702.9b'], 'first strike': ['702.7b'],
        'double strike': ['702.4b'], 'landwalk': ['702.14a','702.14c'],
        'hexproof': ['702.11b','702.11c'],
        'trample': ['702.19b'], 'reach': ['702.17b'],
        'haste': ['702.10b','702.10c'],
        'vigilance': ['702.20b'], 'defender': ['702.3b'],
        'lifelink': ['702.15b'], 'indestructible': ['702.12b'],
        'deathtouch': ['702.2b','702.2c'],
        'morph': ['702.37a','702.37e'],
        'disguise': ['702.168a','702.168d'],
        'toxic': ['702.164b','702.164c'],
        'mayhem': ['702.187b','702.187c'],
        'start your engines!': ['702.179a','702.179d','702.179e'],
        'ascend': ['702.131a','702.131b'],
        'reconfigure': ['702.151a','702.151b'],
        'fear': ['702.36b'], 'intimidate': ['702.13b'],
        'horsemanship': ['702.31b'], 'shadow': ['702.28b'],
        'skulk': ['702.118b'], 'infect': ['702.90b','702.90c'],
    }
    def selected(key, number, ids):
        if not ids or any(i not in all_rules for i in ids):
            raise ValueError(f'{key}: missing selected rules {ids}')
        if any(i[:-1] != number for i in ids):
            raise ValueError(f'{key}: selected rules do not belong to {number}: {ids}')
        zh, en = ('\n'.join(all_rules[i][lang] for i in ids) for lang in (0, 1))
        if not zh.strip() or not en.strip():
            raise ValueError(f'{key}: missing bilingual definition')
        if number.startswith('702.') and not re.search(
                r'\b(means|can|can’t|cannot|may|prevent|enters|causes|assigns|gets|gain|gains|'
                r'put|putting|choose|chooses|damage|attack|attacking|restricts|phase|phases)\b', en, re.I):
            raise ValueError(f'{key}: selection lacks gameplay effect: {ids}')
        return dict(zh=zh, en=en, rules=ids)

    seen_selections = set()
    for section in re.split('<h3>', chapter)[1:]:
        head, body = section.split('</h3>',1)
        match = re.match(r'(70[12]\.\d+)\.\s+(\S+)\s+(.+)',plain(head))
        if not match:
            continue
        number, name, english = match.groups()
        key = english.lower()
        ids = selections.get(key, [number+'a'])
        definition = selected(key, number, ids)
        if key in selections:
            seen_selections.add(key)
        entries[key] = dict(name=name, source=BASE+'/cr/7/#cr'+number.replace('.','-'), **definition)
    if selections.keys() - seen_selections:
        raise ValueError(f'Unmatched selection names: {selections.keys() - seen_selections}')
    # Add glossary-only terms (some aliases/older names are not section titles).
    names = re.findall(r'^  ("[^"]+"|[\w]+): \{ hans:', (ROOT/'ui/i18n/cardKeywords.ts').read_text(encoding='utf8'),re.M)
    for name in names:
        key=name.strip('"')
        if key not in entries and key in glossary_entries:
            entries[key] = glossary_entries[key]
    aliases = {
        'multikicker': ('kicker',['702.33c']),
        'typecycling': ('cycling',['702.29e']),
        'commander ninjutsu': ('ninjutsu',['702.49d']),
        'bands with other': ('banding',['702.22b','702.22c','702.22h','702.22j','702.22k']),
        'hexproof from': ('hexproof',['702.11d']),
        'trample over planeswalkers': ('trample',['702.19c']),
        'totem armor': ('umbra armor',['702.89a']),
        'megamorph': ('morph',['702.37b','702.37e']),
        'nightbound': ('daybound and nightbound',['702.145e','702.145f','702.145g']),
        'daybound': ('daybound and nightbound',['702.145b','702.145c','702.145d']),
    }
    for key,(base,ids) in aliases.items():
        if base not in entries:
            raise ValueError(f'{key}: missing alias base {base}')
        e=entries[base].copy()
        e.update(selected(key, entries[base]['rules'][0][:-1], ids))
        # A variant must never inherit the translated name of its base ability.
        e.pop('name', None)
        if key in glossary_entries:
            e['name']=glossary_entries[key]['name']
        entries[key]=e
    # Each landwalk variant has the same rule parameterized by its land quality.
    for key in ['plainswalk','islandwalk','swampwalk','mountainwalk','forestwalk','legendary landwalk','nonbasic landwalk','snow landwalk','artifact landwalk']:
        e=entries['landwalk'].copy()
        if key in glossary_entries: e['name']=glossary_entries[key]['name']
        else: e.pop('name',None)
        entries[key]=e
    # Names of these variants are printed differently than the base section.
    for key in ['hexproof from','bands with other','trample over planeswalkers','totem armor']:
        entries[key].pop('name',None)
    header='''// Generated by tools/build-keyword-rules.py; verbatim MTGCH CR excerpts.
// English Comprehensive Rules: Wizards of the Coast; excerpts hosted by MTGCH.
// Chinese translation: Greater China judge community (not an official WotC translation).
// Source and attribution: https://mtgch.com/cr/ and https://mtgch.com/cr/credits/
// Chapter SHA256: %s
// Glossary SHA256: %s
export interface KeywordRuleHelp {
  name?: string;
  zh: string;
  en: string;
  source: string;
  rules: string[];
}
export const KEYWORD_RULE_HELP: Record<string, KeywordRuleHelp> = ''' % (chapter_hash,glossary_hash)
    (ROOT/'ui/i18n/keywordHelpRules.ts').write_text(header+json.dumps(dict(sorted(entries.items())),ensure_ascii=False,indent=2)+';\n',encoding='utf8')
    print('Generated',len(entries),'keyword/action definitions from MTGCH CR.')


if __name__=='__main__':
    build()
