import { beforeEach, expect, it, vi } from "vitest";
import type { Deck } from "@/protocol/deck";
import { getGameApi } from "@/platform";
import { startLocalDeckGame } from "@/phase/transport";

vi.mock("@/phase/transport", () => ({ startLocalDeckGame: vi.fn() }));
const card = (name: string) => ({ identity: { name } }) as Deck["cards"][number];
const deck: Deck = {
  name: "Commander test", format: "commander", cards: [card("Forest"), card("Forest")],
  commanders: [card("Isamaru, Hound of Konda")], sideboard: [],
};
const params = { deck, startingLife: 40, commanderName: null, opponentDecks: [deck] };
beforeEach(() => vi.clearAllMocks());

it("sends both commander slots separately and preserves one name per copy", async () => {
  await getGameApi().startGame(params);
  expect(startLocalDeckGame).toHaveBeenCalledWith({
    format: "commander", humanDeck: ["Forest", "Forest"], aiDeck: ["Forest", "Forest"],
    humanCommanders: ["Isamaru, Hound of Konda"], aiCommanders: ["Isamaru, Hound of Konda"],
  });
});

it("uses the selected format and commander when the deck has no commander slot", async () => {
  await getGameApi().startGame({ ...params, format: "commander", deck: { ...deck, format: "standard", cards: [...deck.cards, card("Isamaru, Hound of Konda")], commanders: [] }, commanderName: "Isamaru, Hound of Konda" });
  expect(startLocalDeckGame).toHaveBeenCalledWith(expect.objectContaining({
    format: "commander", humanDeck: ["Forest", "Forest"], humanCommanders: ["Isamaru, Hound of Konda"],
  }));
});

it("rejects multiple opponents rather than silently discarding seats", async () => {
  await expect(getGameApi().startGame({ ...params, opponentDecks: [deck, deck, deck] })).rejects.toThrow("1v1");
  expect(startLocalDeckGame).not.toHaveBeenCalled();
});
