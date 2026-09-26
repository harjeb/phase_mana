import { describe, expect, it } from "vitest";
import type { Deck, DeckCard } from "@/protocol/deck";
import { beginLocalGame, cancelLocalGame, createLocalTournament, localMatchDecks, parseLocalTournament, recordLocalResult, swapLocalSideboard, type LocalTournament } from "@/lib/localTournament";
import { legalTournamentDeck, sideboardTournamentAi, swapTournamentCards } from "@/lib/localTournamentSideboard";

const card = (name: string, types = ["Land"], text = ""): DeckCard => ({ identity: { name, id: name, setCode: "test", cardNumber: "1" }, types, text } as DeckCard);
const deck: Deck = { name: "Fixture", format: "standard", cards: [card("Plains"), card("Plains")], sideboard: [card("Island")], commanders: [card("Commander", ["Creature"])] };
const make = () => createLocalTournament("bo3", deck, [deck], 4, ["Easy"], () => 0.99, "BO3");
let serial = 0;
function score(event: LocalTournament, round: number, match: number, slot: number | null) {
  const token = `game-${++serial}`;
  return recordLocalResult(beginLocalGame(event, round, match, token), round, match, slot === null ? null : event.rounds[round][match].players[slot], token);
}
describe("BO3 scoring and safe persistence", () => {
  it.each([[0, 0], [0, 1, 0]])("requires two wins (%j)", (...slots) => {
    let event = make();
    slots.forEach((slot, i) => {
      event = score(event, 0, 0, slot);
      expect(event.rounds[0][0].winner).toBe(i === slots.length - 1 ? event.rounds[0][0].players[0] : null);
      expect(parseLocalTournament(JSON.stringify(event))).toEqual(event);
    });
    expect(event.rounds).toHaveLength(1);
    event = score(score(event, 0, 1, 1), 0, 1, 1);
    expect(event.rounds).toHaveLength(2);
    expect(event.rounds[1][0].players).toEqual(event.rounds[0].map(m => m.winner));
    expect(event.rounds[1][0].gameWins).toEqual([0, 0]);
  });
  it("draws don't award wins, even at match point", () => {
    let event = score(make(), 0, 0, 0);
    event = score(event, 0, 0, null);
    expect(event.rounds[0][0].gameWins).toEqual([1, 0]);
    expect(event.rounds[0][0].draws).toBe(1);
    expect(event.rounds[0][0].winner).toBeNull();
    expect(score(event, 0, 0, 0).rounds[0][0].winner).not.toBeNull();
  });
  it("rejects duplicate, stale, cancelled and unrelated engine results", () => {
    let event = beginLocalGame(make(), 0, 0, "a");
    const winner = event.rounds[0][0].players[0];
    expect(recordLocalResult(event, 0, 0, 99, "a")).toBe(event);
    event = recordLocalResult(event, 0, 0, winner, "a");
    expect(recordLocalResult(event, 0, 0, winner, "a")).toBe(event);
    expect(recordLocalResult(event, 0, 0, null, "a")).toBe(event);
    event = beginLocalGame(event, 0, 0, "b");
    expect(recordLocalResult(event, 0, 0, winner, "a")).toBe(event);
    expect(recordLocalResult(event, 0, 1, winner, "b")).toBe(event);
    event = cancelLocalGame(event, 0, 0, "b");
    expect(recordLocalResult(event, 0, 0, winner, "b")).toBe(event);
    event = score(score(event, 0, 0, 0), 0, 1, 0);
    event = score(event, 0, 1, 0);
    expect(beginLocalGame(event, 0, 0, "old-round")).toBe(event);
  });
  it("migrates legacy v1 pending, draw and completed BO1 matches", () => {
    const original = createLocalTournament("legacy", deck, [deck], 4, ["Easy"], () => 0.99);
    const event = score(score(score(original, 0, 0, null), 0, 0, 0), 0, 1, 1);
    const raw = JSON.parse(JSON.stringify(event));
    raw.version = 1; delete raw.matchType;
    for (const matches of raw.rounds) for (const match of matches) { delete match.gameWins; delete match.decks; delete match.activeGame; }
    expect(parseLocalTournament(JSON.stringify(raw))).toEqual(event);
  });
  it("rejects invalid scores, winner mismatches and changed saved pools", () => {
    for (const scores of [[-1, 0], [3, 0], [1.5, 0], [2, 2], [1], ["1", 0], [2, 0]]) {
      const event = make();
      (event.rounds[0][0] as unknown as { gameWins: unknown }).gameWins = scores;
      expect(parseLocalTournament(JSON.stringify(event))).toBeNull();
    }
    const winner = make(); winner.rounds[0][0].winner = winner.rounds[0][0].players[0];
    expect(parseLocalTournament(JSON.stringify(winner))).toBeNull();
    const changed = score(make(), 0, 0, null);
    changed.rounds[0][0].decks![0].cards[0].identity.name = "Fabricated";
    expect(parseLocalTournament(JSON.stringify(changed))).toBeNull();
    const first = make(); first.rounds[0][0].decks = [deck, deck];
    expect(parseLocalTournament(JSON.stringify(first))).toBeNull();
  });
});
describe("between-game sideboarding", () => {
  it("preserves exact copies, zone counts and commanders", () => {
    const changed = swapTournamentCards(deck, 0, 0);
    expect(legalTournamentDeck(deck, changed)).toBe(true);
    expect(changed.cards.map(c => c.identity.name)).toEqual(["Island", "Plains"]);
    expect(changed.sideboard[0].identity.name).toBe("Plains");
    expect(changed.commanders).toEqual(deck.commanders);
    const bad = structuredClone(changed); bad.cards[0].identity.setCode = "forged";
    expect(legalTournamentDeck(deck, bad)).toBe(false);
    const count = structuredClone(changed); count.cards.push(count.sideboard.pop()!);
    expect(legalTournamentDeck(deck, count)).toBe(false);
    const commander = structuredClone(changed); commander.commanders = [];
    expect(legalTournamentDeck(deck, commander)).toBe(false);
  });
  it("forbids game-one/BO1 swaps, persists next-game lists and resets next round", () => {
    let event = make();
    expect(event.rounds[0][0].players).toContain(0);
    expect(swapLocalSideboard(event, 0, 0, 0, 0)).toBe(event);
    event = score(event, 0, 0, null);
    event = swapLocalSideboard(event, 0, 0, 0, 0);
    event = parseLocalTournament(JSON.stringify(event))!;
    const match = event.rounds[0][0];
    expect(localMatchDecks(event, match)[0].cards[0].identity.name).toBe("Island");
    expect(event.entrants[0].deck).toEqual(deck);
    event = score(score(event, 0, 0, 0), 0, 0, 0);
    event = score(score(event, 0, 1, 0), 0, 1, 0);
    expect(event.rounds[1][0].decks).toBeNull();
    expect(localMatchDecks(event, event.rounds[1][0])[0]).toEqual(deck);
    const bo1 = createLocalTournament("bo1", deck, [deck], 4, ["Easy"], () => 0.99);
    const draw = score(bo1, 0, 0, null);
    expect(swapLocalSideboard(draw, 0, 0, 0, 0)).toBe(draw);
  });
  it("makes a useful deterministic AI swap only between games", () => {
    const ai: Deck = { ...deck, cards: [card("Plains"), card("Shatter", ["Instant"], "Destroy target artifact.")], sideboard: [card("Doom Blade", ["Instant"], "Destroy target creature.")] };
    const opponent: Deck = { ...deck, cards: [card("Bear", ["Creature"])] };
    const changed = sideboardTournamentAi(ai, opponent);
    expect(changed.cards[1].identity.name).toBe("Doom Blade");
    expect(legalTournamentDeck(ai, changed)).toBe(true);
    expect(sideboardTournamentAi(ai, opponent)).toEqual(changed);
    expect(sideboardTournamentAi(changed, opponent)).toEqual(changed);
    let event = createLocalTournament("ai", opponent, [ai], 4, ["Easy"], () => 0.99, "BO3");
    expect(localMatchDecks(event, event.rounds[0][0])[1]).toEqual(ai);
    event = score(event, 0, 0, 0);
    expect(localMatchDecks(event, event.rounds[0][0])[1]).toEqual(changed);
    expect(parseLocalTournament(JSON.stringify(event))).toEqual(event);
  });
});
