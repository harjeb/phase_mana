import { describe, expect, it } from "vitest";
import type { DeckCard } from "@/protocol/deck";
import { exportWaitingRoomDeck } from "@/components/lobby/hostedWaitingRoomDeck";

const card = (name: string) => ({ identity: { name } }) as DeckCard;

describe("exportWaitingRoomDeck", () => {
  it("preserves repeated copies and separates main deck, sideboard, and partner commanders", () => {
    const deck = {
      cards: [card("Island"), card("Island"), card("Counterspell")],
      sideboard: [card("Negate"), card("Negate")],
      commanders: [card("Thrasios, Triton Hero"), card("Tymna the Weaver")],
    };
    expect(exportWaitingRoomDeck(deck)).toEqual({
      main_deck: ["Island", "Island", "Counterspell"],
      sideboard: ["Negate", "Negate"],
      commander: ["Thrasios, Triton Hero", "Tymna the Weaver"],
    });
    expect(deck.cards).toHaveLength(3);
    expect(deck.commanders).toHaveLength(2);
  });

  it("exports ordinary decks with an empty command zone", () => {
    expect(exportWaitingRoomDeck({ cards: [card("Mountain")], sideboard: [] })).toEqual({
      main_deck: ["Mountain"], sideboard: [], commander: [],
    });
  });
});
