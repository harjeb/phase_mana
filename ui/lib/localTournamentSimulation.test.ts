import { describe, expect, it, vi } from "vitest";
import type { DeckCard } from "@/protocol/deck";
import { localTournamentWinChance as chance, simulateLocalTournamentGame as simulate } from "@/lib/localTournamentSimulation";

const card = (types: string[], cmc: number, name = "Test"): DeckCard => ({
  identity: { id: name, name, setCode: "", cardNumber: "" },
  uris: { small: "", normal: "", large: "", png: "", art_crop: "", border_crop: "" },
  color: "", colorIdentity: [], manaCost: "", cmc, types, subtypes: [], supertypes: [], text: "",
});
const player = (lands = 24, cmc = 3) => ({
  deck: { cards: Array.from({ length: 60 }, (_, i) => i < lands ? card(["Land"], 0) : card(["Creature"], cmc)) },
  difficulty: "Medium" as const,
});

describe("local tournament weighted draw", () => {
  it("gives equal decks and difficulty exactly even odds", () => {
    expect(chance(player(), player())).toBe(0.5);
    expect(chance({ deck: { cards: [] }, difficulty: null }, { deck: { cards: [] }, difficulty: null })).toBe(0.5);
  });

  it("favors a balanced deck over a land-starved expensive deck, with symmetric bounded odds", () => {
    const reasonable = player();
    const awkward = player(6, 8);
    expect(chance(reasonable, awkward)).toBeGreaterThan(0.5);
    expect(chance(reasonable, awkward)).toBeLessThanOrEqual(0.75);
    expect(chance(awkward, reasonable)).toBeGreaterThanOrEqual(0.25);
    expect(chance(reasonable, awkward) + chance(awkward, reasonable)).toBeCloseTo(1, 15);
    const strongest = { ...reasonable, difficulty: "CEDH" as const };
    const weakest = { ...awkward, difficulty: "VeryEasy" as const };
    expect(chance(strongest, weakest)).toBe(0.75);
    expect(chance(weakest, strongest)).toBe(0.25);
  });

  it("adds only a small difficulty advantage to otherwise equal decks", () => {
    const p = chance({ ...player(), difficulty: "CEDH" }, { ...player(), difficulty: "VeryEasy" });
    expect(p).toBeCloseTo(0.55);
  });

  it("uses exactly one injected draw and returns the correct seat at the threshold", () => {
    const first = player();
    const second = player(12, 6);
    const threshold = chance(first, second);
    for (const [value, seat] of [[0, 0], [threshold - 0.000001, 0], [threshold, 1], [0.999999, 1]]) {
      const random = vi.fn(() => value);
      expect(simulate(first, second, random)).toBe(seat);
      expect(random).toHaveBeenCalledTimes(1);
    }
  });

  it("accepts engine-unsupported cards using metadata only and preserves input cards", () => {
    const bookworm = card(["Creature"], 2, "Oblivious Bookworm");
    const first = { ...player(), deck: { cards: [...player().deck.cards.slice(0, 24), ...Array.from({ length: 36 }, () => bookworm)] } };
    const second = player(6, 8);
    const before = structuredClone([first, second]);
    Object.freeze(bookworm.types);
    Object.freeze(bookworm);
    Object.freeze(first.deck.cards);
    expect(simulate(first, second, () => 0)).toBe(0);
    expect(chance(first, second)).toBeGreaterThan(0.5);
    expect([first, second]).toEqual(before);
  });

  it("keeps missing metadata neutral and reduces the influence of sparse metadata", () => {
    const unknown = { identity: { name: "Unknown" } } as DeckCard;
    const neutral = { deck: { cards: [unknown] }, difficulty: "Medium" as const };
    expect(chance(neutral, neutral)).toBe(0.5);
    const known = player();
    const sparse = { ...known, deck: { cards: [...known.deck.cards, ...Array.from({ length: 60 }, () => unknown)] } };
    expect(chance(sparse, neutral)).toBeGreaterThan(0.5);
    expect(chance(sparse, neutral)).toBeLessThan(chance(known, neutral));
  });
});
