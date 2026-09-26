export interface NormalizedKeyword {
  ability: string;
  label: string;
  cost?: string;
  amount?: string;
  raw: string;
}

type Shape = 'unit' | 'amount' | 'mana' | 'payload';
// Keyword variants in engine/src/types/keywords.rs. Internal EtbCounter and
// Unknown deliberately have no presentation identity here.
const groups: Record<Shape, string> = {
  unit: `Flying FirstStrike DoubleStrike Trample TrampleOverPlaneswalkers Deathtouch
    Lifelink Vigilance Haste Reach Defender Menace Indestructible Hexproof Shroud Flash
    Fear Intimidate Skulk Shadow Horsemanship Wither Infect Prowess Undying Persist Cascade
    Exalted Flanking Evolve Extort Exploit Explore Ascend Storied StartYourEngines Soulbond
    Convoke Waterbend Delve Devoid Changeling Phasing Battlecry Decayed Unleash Riot
    LivingWeapon JobSelect TotemArmor Banding Epic Fuse Gravestorm Haunt Improvise Ingest
    Melee Mentor Myriad Provoke Rebound Retrace SplitSecond Storm Totem Spree Tiered Ravenous
    Daybound Nightbound Enlist ReadAhead Compleated Conspire Demonstrate Dethrone DoubleTeam
    LivingMetal Bargain Sunburst Training Assist Aftermath JumpStart Cipher Undaunted
    Paradigm Station ForMirrodin Increment Investigate Learn Imprint Threshold Landfall Constellation
    Heroic Magecraft Rally Raid Battalion Kinship Domain Metalcraft Morbid Delirium Coven Converge
    Adamant Formidable Enrage Bloodrush Cohort Parley PackTactics WillOfTheCouncil FatefulHour
    Hellbent Undergrowth Channel SpellMastery Eminence Ferocious Chroma Radiance Revolt Descend`,
  amount: `Afflict StartingIntensity Dredge Modular Renown Fabricate Annihilator Bushido Frenzy
    Tribute Afterlife Fading Vanishing Rampage Absorb Casualty Hideaway Ripple Discover Poisonous
    Amplify Graft Toxic Saddle Teamwork Soulshift Backup Mobilize Firebending Bloodthirst Surveil Bolster`,
  mana: `Unearth Reconfigure Bestow Embalm Eternalize Kicker Cycling Flashback Ward Equip Ninjutsu
    CommanderNinjutsu Prowl Morph Megamorph Mayhem Madness Miracle Dash Escape Harmonize Evoke
    Foretell Mutate Disturb Disguise Blitz Overload Spectacle Surge Encore Buyback Echo Entwine
    Outlast Scavenge Fortify Plot Offspring LevelUp Warp Sneak WebSlinging Squad Transmute
    Transfigure Escalate Recover Cleave Replicate MoreThanMeetsTheEye Freerunning Specialize
    CumulativeUpkeep Multikicker Augment`,
  payload: `HexproofFrom Enchant Protection Landwalk Crew Partner Companion Emerge Reinforce
    Prototype Craft Impending Affinity BandsWithOther Suspend Gift Devour Typecycling Splice
    Champion Awaken Offering`,
};
const specialNames: Record<string, string> = {
  Battlecry: 'battle cry', JumpStart: 'jump-start', WebSlinging: 'web-slinging',
  ForMirrodin: 'for mirrodin!', StartYourEngines: 'start your engines!',
  HexproofFrom: 'hexproof',
};
const entries = Object.entries(groups).flatMap(([shape, names]) => names.trim().split(/\s+/).map(variant => {
  const ability = specialNames[variant] ?? variant.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return { variant, ability, shape: shape as Shape };
}));
const aliasKey = (name: string) => name.toLowerCase().replace(/[\s!\-]/g, '');
const aliases = new Map(entries.flatMap(entry => [
  [aliasKey(entry.variant), entry] as const, [aliasKey(entry.ability), entry] as const,
]));
// HexproofFrom shares its rules identity, but must not replace the bare variant.
aliases.set('hexproof', entries.find(entry => entry.variant === 'Hexproof')!);

const colors: Record<string, string> = { White: 'W', Blue: 'U', Black: 'B', Red: 'R', Green: 'G' };
const shards = new Map<string, string>(Object.entries({ ...colors, Colorless: 'C', Snow: 'S', X: 'X', TwoOrMoreColorSource: 'Z' }));
for (const [name, symbol] of Object.entries(colors)) {
  shards.set(`Two${name}`, `2/${symbol}`);
  shards.set(`Phyrexian${name}`, `${symbol}/P`);
  shards.set(`Colorless${name}`, `C/${symbol}`);
}
for (const pair of ['WhiteBlue', 'WhiteBlack', 'BlueBlack', 'BlueRed', 'BlackRed', 'BlackGreen', 'RedWhite', 'RedGreen', 'GreenWhite', 'GreenBlue']) {
  const symbol = pair.match(/[A-Z][a-z]+/g)!.map(color => colors[color]).join('/');
  shards.set(pair, symbol);
  shards.set(`Phyrexian${pair}`, `${symbol}/P`);
}
const printedSymbols = new Set(shards.values());

/** Split only at top-level commas, validating brackets and quoted Rust strings. */
function splitBalanced(text: string): string[] | undefined {
  const stack: string[] = [];
  const parts: string[] = [];
  let quote = false;
  let escaped = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if ('([{'.includes(ch)) stack.push(ch);
    else if (')]}'.includes(ch)) {
      if (stack.pop() !== '([{'[')]}'.indexOf(ch)]) return undefined;
    } else if (ch === ',' && !stack.length) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (quote || stack.length) return undefined;
  parts.push(text.slice(start).trim());
  return parts;
}

function manaCost(text: string): string | undefined {
  const printed = text.toUpperCase().replace(/\s+/g, '');
  if (/^(?:\{[^{}]+\})+$/.test(printed)) {
    const tokens = [...printed.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]!);
    if (tokens.every(token => /^\d+$/.test(token) || printedSymbols.has(token))) return printed;
  }
  const wrapper = /^Mana\((.*)\)$/s.exec(text) ?? /^Mana\s*\{\s*cost:\s*(.*)\s*\}$/s.exec(text);
  if (wrapper) return manaCost(wrapper[1]!.trim());
  const match = /^Cost\s*\{\s*shards:\s*\[([\s\S]*)\],\s*generic:\s*(\d+)\s*,?\s*\}$/.exec(text);
  if (!match) return undefined;
  const generic = Number(match[2]);
  if (!Number.isSafeInteger(generic) || generic > 0xffffffff) return undefined;
  const names = match[1]!.trim() ? match[1]!.trim().replace(/,$/, '').split(',').map(s => s.trim()) : [];
  if (names.some(name => !shards.has(name))) return undefined;
  return (generic ? `{${generic}}` : '') + names.map(name => `{${shards.get(name)}}`).join('') || '{0}';
}

function title(ability: string): string {
  if (ability === 'for mirrodin!') return 'For Mirrodin!';
  return ability[0]!.toUpperCase() + ability.slice(1);
}
function humanText(text: string): boolean {
  return !!text && !/[{}\[\]():_$<>]/.test(text) && !/[a-z][A-Z]/.test(text);
}
function quality(text: string): string | undefined {
  const color = /^Color\((White|Blue|Black|Red|Green)\)$/.exec(text);
  if (color) return color[1]!.toLowerCase();
  const quoted = /^(?:CardType|Quality)\("([^"\\]+)"\)$/.exec(text);
  if (quoted && humanText(quoted[1]!)) return quoted[1]!.toLowerCase();
  return ({ Multicolored: 'multicolored', ChosenColor: 'the chosen color', ChosenCardType: 'the chosen card type', ChosenPlayer: 'the chosen player', Everything: 'everything' } as Record<string, string>)[text];
}

/** Presentation only: preserve the wire value in raw, never use this as engine identity.
 * Unsupported balanced payloads retain their rules identity, without a guessed price.
 */
export function normalizeKeyword(keyword: string): NormalizedKeyword | undefined {
  const text = keyword.trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  let entry = aliases.get(aliasKey(text));
  let suffix = '';
  if (!entry) {
    // Match the longest known name, with a real boundary (never "Flying high").
    for (let end = text.length; end > 0; end--) {
      if (!/[\s:({—]/.test(text[end] ?? '')) continue;
      const candidate = aliases.get(aliasKey(text.slice(0, end)));
      if (candidate) {
        entry = candidate;
        suffix = text.slice(end).trim();
        if (candidate.variant === 'HexproofFrom' && /\sfrom$/i.test(text.slice(0, end))) suffix = `from ${suffix}`;
        break;
      }
    }
  }
  if (!entry) {
    if (/^(?:plains|island|swamp|mountain|forest|desert|gate)walk$/i.test(text)
      || /^(?:legendary|nonbasic|snow|artifact) landwalk$/i.test(text)) {
      return { ability: 'landwalk', label: title(text.toLowerCase()), raw: keyword };
    }
    return undefined;
  }
  if (entry.variant === 'Hexproof' && /^[:—]?\s*from\s+/i.test(suffix)) {
    entry = entries.find(candidate => candidate.variant === 'HexproofFrom')!;
  }
  const { ability, shape, variant } = entry;
  const result: NormalizedKeyword = { ability, label: title(ability), raw: keyword };
  if (!suffix) return result;
  if (shape === 'unit') return undefined;
  let payload = suffix;
  const debug = suffix.startsWith('(') || /^\{\s*\w+\s*:/.test(suffix);
  if (debug) {
    const close = suffix[0] === '(' ? ')' : '}';
    if (!suffix.endsWith(close) || !splitBalanced(suffix) || !splitBalanced(suffix.slice(1, -1))) return undefined;
    payload = suffix.slice(1, -1).trim();
  } else payload = suffix.replace(/^[:—]\s*/, '');
  if (shape === 'mana') {
    result.cost = manaCost(payload);
    if (result.cost) result.label += ` ${result.cost}`;
    else if (variant === 'Ward' && /^PayLife\(\d+\)$/.test(payload)) result.label += `—Pay ${payload.match(/\d+/)![0]} life`;
    else if (variant === 'Ward' && payload === 'DiscardCard') result.label += '—Discard a card';
    else if (!debug) {
      const life = /^Pay\s*(\d+)\s*life\.?$/i.exec(payload);
      if (life) result.label += `—Pay ${life[1]} life`;
      else if (/^(?:pay|discard|sacrifice|exile|tap|collect evidence)\b/i.test(payload) && humanText(payload)) result.label += `—${payload}`;
      else return undefined;
    }
    if (!result.cost) delete result.cost;
  } else if (shape === 'amount') {
    const amount = /^(\d+|X)$/i.exec(payload) ?? /^Fixed\s*(?:\(\s*(\d+)\s*\)|\{\s*value:\s*(-?\d+)\s*\})$/.exec(payload);
    if (amount) {
      result.amount = (amount[1] ?? amount[2])!.toUpperCase();
      result.label += ` ${result.amount}`;
    } else if (!debug) return undefined;
  } else if (debug) {
    if (variant === 'Protection' || variant === 'HexproofFrom') {
      const from = quality(payload);
      if (from) result.label += ` from ${from}`;
    } else if (variant === 'Crew') {
      const power = /^(\d+)$/.exec(payload) ?? /^power:\s*(\d+),/.exec(payload);
      if (power) { result.amount = power[1]; result.label += ` ${result.amount}`; }
    } else if (['Landwalk', 'BandsWithOther', 'Champion', 'Offering'].includes(variant)) {
      const quoted = /^"([^"\\]+)"$/.exec(payload);
      if (quoted && humanText(quoted[1]!)) {
        const value = quoted[1]!.toLowerCase();
        result.label = variant === 'Landwalk' ? title(`${value}walk`) : variant === 'Offering' ? title(`${value} offering`) : `${result.label} ${variant === 'Champion' ? 'a ' : ''}${value}`;
      }
    }
  } else {
    const patterns: Record<string, RegExp> = {
      Protection: /^from .+/i, HexproofFrom: /^from .+/i, Enchant: /^(?:a |an )?[a-z]/i,
      Affinity: /^for .+/i, BandsWithOther: /^[a-z]/i, Partner: /^with .+/i,
      Champion: /^(?:a|an) .+/i, Craft: /^with .+/i, Splice: /^onto .+/i,
      Gift: /^(?:a|an|tapped) .+/i, Landwalk: /^[a-z]/i,
    };
    if (variant === 'Crew' && /^\d+$/.test(payload)) { result.amount = payload; result.label += ` ${payload}`; }
    else if (patterns[variant]?.test(payload) && humanText(payload)) result.label += ` ${payload}`;
    else return undefined;
  }
  return result;
}

/** Backwards-compatible cost projection, now supporting every mana keyword. */
export function keywordManaCost(keyword: string): { ability: string; cost: string } | undefined {
  const normalized = normalizeKeyword(keyword);
  return normalized?.cost ? { ability: normalized.ability, cost: normalized.cost } : undefined;
}
