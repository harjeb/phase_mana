import { describe, expect, it } from 'vitest';
import { keywordManaCost, normalizeKeyword } from './keywordCost';

const cost = (shards: string, generic = 0) => `Cost { shards: [${shards}], generic: ${generic} }`;

describe('normalizeKeyword', () => {
  it.each([
    ['FirstStrike', 'first strike', 'First strike'],
    ['LivingWeapon', 'living weapon', 'Living weapon'],
    ['TrampleOverPlaneswalkers', 'trample over planeswalkers', 'Trample over planeswalkers'],
    ['Battlecry', 'battle cry', 'Battle cry'],
    ['ForMirrodin', 'for mirrodin!', 'For Mirrodin!'],
    ['JumpStart', 'jump-start', 'Jump-start'],
    ['  FIRST   STRIKE  ', 'first strike', 'First strike'],
  ])('canonicalizes %s without losing the wire string', (raw, ability, label) => {
    expect(normalizeKeyword(raw)).toEqual({ ability, label, raw });
  });

  it('formats every current shard family and preserves repeated X', () => {
    const raw = `Harmonize(${cost('X, X, Green, WhiteBlue, TwoWhite, PhyrexianBlack, PhyrexianGreenBlue, ColorlessRed, Snow, TwoOrMoreColorSource', 2)})`;
    expect(normalizeKeyword(raw)).toEqual({
      ability: 'harmonize', label: 'Harmonize {2}{X}{X}{G}{W/U}{2/W}{B/P}{G/U/P}{C/R}{S}{Z}',
      cost: '{2}{X}{X}{G}{W/U}{2/W}{B/P}{G/U/P}{C/R}{S}{Z}', raw,
    });
    expect(keywordManaCost(`Kicker(${cost('Blue', 1)})`)).toEqual({ ability: 'kicker', cost: '{1}{U}' });
    expect(keywordManaCost(`Warp(${cost('')})`)?.cost).toBe('{0}');
    expect(keywordManaCost('Ward: {2}{g/u/p}{c/r}')?.cost).toBe('{2}{G/U/P}{C/R}');
  });

  it.each(['Flashback', 'Cycling', 'Bestow', 'Embalm', 'Eternalize', 'Evoke', 'Buyback', 'Echo', 'Disguise'])('unwraps %s mana costs', variant => {
    expect(keywordManaCost(`${variant}(Mana(${cost('Blue', 3)}))`)?.cost).toBe('{3}{U}');
  });

  it.each([
    ['Mobilize(Fixed { value: 2 })', 'mobilize', '2'],
    ['Firebending(Fixed { value: 3 })', 'firebending', '3'],
    ['Bloodthirst(Fixed(4))', 'bloodthirst', '4'],
    ['Bloodthirst(X)', 'bloodthirst', 'X'],
    ['Annihilator(2)', 'annihilator', '2'],
    ['Crew { power: 3, once_per_turn: None }', 'crew', '3'],
    ['Toxic 2', 'toxic', '2'],
  ])('reads actual numeric shape %s', (raw, ability, amount) => {
    expect(normalizeKeyword(raw)).toMatchObject({ ability, amount });
  });

  it('preserves human variants separately', () => {
    expect(normalizeKeyword('Ward {2}')?.label).toBe('Ward {2}');
    expect(normalizeKeyword('Ward:Pay3life')?.label).toBe('Ward—Pay 3 life');
    expect(normalizeKeyword('Ward(PayLife(3))')?.label).toBe('Ward—Pay 3 life');
    expect(normalizeKeyword('Protection from red')?.label).toBe('Protection from red');
    expect(normalizeKeyword('Protection(Color(Blue))')?.label).toBe('Protection from blue');
    expect(normalizeKeyword('Hexproof from black')?.label).toBe('Hexproof from black');
    expect(normalizeKeyword('HexproofFrom(Color(White))')?.label).toBe('Hexproof from white');
    expect(normalizeKeyword('BandsWithOther("Wolf")')?.label).toBe('Bands with other wolf');
  });

  it.each([
    'Evoke(NonMana(Exile { count: Fixed { value: 1 }, filter: Any }))',
    `Escape(NonMana(Composite { costs: [Mana { cost: ${cost('Black', 2)} }, Discard { count: 1 }] }))`,
    `Ward(Compound([Mana(${cost('', 2)}), PayLife(2)]))`,
    'Foretell(SelfManaCostReduced { reduction: 2 })',
    'Mobilize(SourcePower)',
    `Craft { cost: ${cost('Red', 3)}, materials: Any, count: Exactly(1) }`,
    'Companion(CreatureTypeRestriction(["Cat", "Elemental"]))',
    'Partner(With("A name with (parentheses)"))',
  ])('retains clean generic identity for unsupported payload %s', raw => {
    const normalized = normalizeKeyword(raw);
    expect(normalized).toBeDefined();
    expect(normalized?.label).not.toMatch(/[{}()\[\]:]/);
    expect(normalized?.cost).toBeUndefined();
  });

  it.each([
    '', 'Unknown', 'Unknown("Flying")', 'EtbCounter { counter_type: P1P1, count: 2 }',
    'Flying high', 'Flying:2', 'Flying(2)', 'Menace (special)', 'Wardrobe', '__Flying',
    'Annihilator(2) extra', 'Mobilize(Fixed { value: 2 )}', 'Ward(Mana(Cost { shards: [Blue], generic: 1 })',
    'Ward(PayLife(2)) junk', 'Ward:AB$ Pump', 'Crew:3:extra', 'Toxic two',
  ])('rejects unknown identities and malformed suffixes: %s', raw => {
    expect(normalizeKeyword(raw)).toBeUndefined();
  });

  it.each(['Unknown', 'TwoGeneric', 'Hybrid(White, Blue)', 'Phyrexian(Blue)', 'White,,Blue'])('does not invent a cost for unsupported shards %s', shard => {
    expect(keywordManaCost(`Kicker(${cost(shard)})`)).toBeUndefined();
  });
});
