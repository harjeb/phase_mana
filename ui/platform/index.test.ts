import { beforeEach, expect, it, vi } from "vitest";
import type { Deck } from "@/protocol/deck";
import { getGameApi, getPlatform } from "@/platform";
import { startLocalDeckGame } from "@/phase/transport";

vi.mock("@/phase/transport", () => ({ startLocalDeckGame: vi.fn() }));
const card = (name: string) => ({ identity: { name } }) as Deck["cards"][number];
const deck: Deck = {
  name: "Commander test", format: "commander", cards: [card("Forest"), card("Forest")],
  commanders: [card("Isamaru, Hound of Konda")], sideboard: [],
};
const params = { deck, startingLife: 40, commanderName: null, opponentDecks: [deck] };
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it("sends both commander slots separately and preserves one name per copy", async () => {
  await getGameApi().startGame(params);
  expect(startLocalDeckGame).toHaveBeenCalledWith({
    conspiracyChoices: [],
    format: "commander", humanDeck: ["Forest", "Forest"], aiDeck: ["Forest", "Forest"],
    humanCommanders: ["Isamaru, Hound of Konda"], aiCommanders: ["Isamaru, Hound of Konda"], extraOpponents: [],
  });
});

it("uses the selected format and commander when the deck has no commander slot", async () => {
  await getGameApi().startGame({ ...params, format: "commander", deck: { ...deck, format: "standard", cards: [...deck.cards, card("Isamaru, Hound of Konda")], commanders: [] }, commanderName: "Isamaru, Hound of Konda" });
  expect(startLocalDeckGame).toHaveBeenCalledWith(expect.objectContaining({
    format: "commander", humanDeck: ["Forest", "Forest"], humanCommanders: ["Isamaru, Hound of Konda"],
  }));
});

it("preserves all three opponents and their commander slots", async () => {
  await getGameApi().startGame({ ...params, opponentDecks: [deck, deck, deck] });
  expect(startLocalDeckGame).toHaveBeenCalledWith(expect.objectContaining({
    extraOpponents: [1, 2].map(() => ({ deck: ["Forest", "Forest"], commanders: ["Isamaru, Hound of Konda"] })),
  }));
});

it.each(["draft", "sealed"] as const)("forwards %s decks", async (format) => {
  await getGameApi().startGame({ ...params, format });
  expect(startLocalDeckGame).toHaveBeenCalledWith(expect.objectContaining({ format }));
});

it("routes Limited commands to the local host and surfaces rejection", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ sessionId: "draft-1" }) })
    .mockResolvedValueOnce({ ok: false, text: async () => "No usable Limited pool" });
  vi.stubGlobal("fetch", fetchMock);
  await expect(getPlatform().invoke("limited_get_draft_state", { sessionId: "draft-1" })).resolves.toEqual({ sessionId: "draft-1" });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ command: "limited_get_draft_state", args: { sessionId: "draft-1" } });
  await expect(getPlatform().invoke("limited_get_set_pool", { setCode: "M21" })).rejects.toThrow("No usable Limited pool");
});

it("keeps every seat's submitted conspiracies separate from its library", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [0, 0, 0] }));
  await getGameApi().startGame({
    ...params, opponentDecks: [deck, deck, deck],
    conspiracies: ["Power Play"],
    opponentConspiracies: [["Backup Plan"], ["Worldknit"], []],
  });
  expect(startLocalDeckGame).toHaveBeenCalledWith(expect.objectContaining({
    humanConspiracies: ["Power Play"], aiConspiracies: ["Backup Plan"],
    extraOpponents: [
      expect.objectContaining({ conspiracy: ["Worldknit"] }),
      expect.objectContaining({ conspiracy: [] }),
    ],
  }));
});

it("rejects tables larger than four players", async () => {
  await expect(getGameApi().startGame({ ...params, opponentDecks: [deck, deck, deck, deck] })).rejects.toThrow("four players");
  expect(startLocalDeckGame).not.toHaveBeenCalled();
});
