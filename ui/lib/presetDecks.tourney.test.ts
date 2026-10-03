import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandPresetDeckDefinition,
  type PresetDeckDefinition,
  type PresetDeck,
} from "./presetDecks";

// Verifies the MTGCH/Forge tournament decks converted by
// `tools/dck-to-preset-decks.mjs` load through the real preset pipeline.
const dir = path.resolve(__dirname, "../../public/preset_decks");

const index = JSON.parse(readFileSync(path.join(dir, "index.json"), "utf8")) as string[];
const tourneyIds = index.filter((id) => id.startsWith("tourney_") || id.startsWith("goldfish_"));

const COMMANDER_FORMATS = new Set(["commander", "brawl", "oathbreaker"]);
const URIS = ["small", "normal", "large", "png", "art_crop", "border_crop"] as const;

function loadDeck(id: string): PresetDeck {
  const definition = JSON.parse(
    readFileSync(path.join(dir, `${id}.json`), "utf8"),
  ) as Omit<PresetDeckDefinition, "id">;
  return expandPresetDeckDefinition({ id, ...definition });
}

const CASES: Array<{ id: string; main: number; side: number; commander?: string }> = [
  { id: "tourney_standard_boros_dragons_152549", main: 60, side: 15 },
  { id: "tourney_modern_devoted_combo_152561", main: 60, side: 15 },
  { id: "tourney_legacy_doomsday_152607", main: 60, side: 15 },
  { id: "tourney_pioneer_red_deck_wins_152358", main: 60, side: 15 },
  {
    id: "tourney_commander_tivit_seller_of_secrets_152249",
    main: 99,
    side: 0,
    commander: "Tivit, Seller of Secrets",
  },
];

describe("converted tournament presets", () => {
  it("lists one representative for each sample deck name", () => {
    const names = index.map((id) => loadDeck(id).name);
    // Historical variants still load by ID, but only one same-name deck is
    // offered in the picker, even when variants came from different formats.
    for (const testCase of CASES) expect(names).toContain(loadDeck(testCase.id).name);
  });

  it("has unique IDs and display names across the entire preset catalog", () => {
    expect(new Set(index).size).toBe(index.length);
    const names = index.map((id) => loadDeck(id).name.trim().toLowerCase());
    expect(names.every(Boolean)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const testCase of CASES) {
    it(`${testCase.id} expands like the loader expects`, () => {
      const deck = loadDeck(testCase.id);
      expect(deck.cards.length).toBe(testCase.main);
      expect(deck.sideboard.length).toBe(testCase.side);
      if (testCase.commander) {
        expect(deck.commanders?.map((card) => card.identity.name)).toEqual([testCase.commander]);
      } else {
        expect(deck.commanders).toBeUndefined();
      }
    });
  }

  it("sweeps every converted deck through the real loader", () => {
    expect(tourneyIds.length).toBeGreaterThan(0);
    const problems: string[] = [];
    for (const id of tourneyIds) {
      let deck: PresetDeck;
      try {
        deck = loadDeck(id);
      } catch (error) {
        problems.push(`${id}: loader threw ${(error as Error).message}`);
        continue;
      }
      const all = [...deck.cards, ...deck.sideboard, ...(deck.commanders ?? [])];
      if (!all.length) problems.push(`${id}: no cards`);
      if (COMMANDER_FORMATS.has(deck.format ?? "") && !deck.commanders?.length) {
        problems.push(`${id}: ${deck.format} deck without a commander`);
      }
      if (!COMMANDER_FORMATS.has(deck.format ?? "") && deck.commanders?.length) {
        problems.push(`${id}: unexpected commander on a ${deck.format} deck`);
      }
      for (const card of all) {
        for (const key of URIS) {
          if (!/^https:\/\//.test(card.uris?.[key] ?? "")) {
            problems.push(`${id}: ${card.identity.name} missing uris.${key}`);
          }
        }
        if (!card.identity.name) problems.push(`${id}: unnamed card`);
        if (!card.identity.setCode) problems.push(`${id}: ${card.identity.name} without set code`);
        if (!card.identity.cardNumber) {
          problems.push(`${id}: ${card.identity.name} without collector number`);
        }
        for (const color of card.colorIdentity) {
          if (!"WUBRG".includes(color)) {
            problems.push(`${id}: ${card.identity.name} bad color identity ${color}`);
          }
        }
        for (const type of card.types) {
          if (/^(Basic|Legendary|Snow|World|Ongoing|Host|Elite)$/.test(type)) {
            problems.push(`${id}: ${card.identity.name} left '${type}' in types`);
          }
        }
        for (const subtype of card.subtypes) {
          if (subtype === "//" || subtype === "—") {
            problems.push(`${id}: ${card.identity.name} bad subtype '${subtype}'`);
          }
        }
      }
    }
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it("offers at least 30 distinct presets for each major format", () => {
    const counts = new Map<string, number>();
    for (const id of index) {
      const format = loadDeck(id).format ?? "";
      counts.set(format, (counts.get(format) ?? 0) + 1);
    }
    for (const format of ["standard", "pioneer", "modern", "legacy", "vintage", "pauper", "commander"]) {
      expect(counts.get(format) ?? 0, format).toBeGreaterThanOrEqual(30);
    }
  });

  it("preserves real MTGGoldfish sources and includes budget decks", () => {
    const definitions = index.filter((id) => id.startsWith("goldfish_")).map((id) =>
      JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8")),
    );
    expect(definitions.length).toBeGreaterThan(0);
    expect(definitions.some((deck) => deck.budget && /Budget Decks/.test(deck.desc))).toBe(true);
    for (const deck of definitions) {
      expect(deck.source).toMatch(/^https:\/\/www\.mtggoldfish\.com\/(deck\/\d+|archetype\/[^/]+)$/);
      expect(deck.cards.reduce((sum: number, card: { count: number }) => sum + card.count, 0)).toBeGreaterThanOrEqual(60);
    }
  });

  it("keeps basic lands typed as lands", () => {
    const deck = loadDeck("tourney_standard_boros_dragons_152549");
    const basics = deck.cards.filter((card) =>
      /^(Plains|Island|Swamp|Mountain|Forest)$/.test(card.identity.name),
    );
    expect(basics.length).toBeGreaterThan(0);
    expect(basics.every((card) => card.types.includes("Land"))).toBe(true);
  });

  it("carries a back face for double-faced cards", () => {
    const deck = loadDeck("tourney_modern_devoted_combo_152561");
    const dfc = deck.cards.find((card) => card.layout === "transform");
    expect(dfc?.backFace?.name).toBe("Krallenhorde Howler");
  });
});
