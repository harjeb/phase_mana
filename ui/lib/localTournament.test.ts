import { describe, expect, it } from "vitest";
import type { Deck } from "@/protocol/deck";
import { beginLocalGame, createLocalTournament, parseLocalTournament, recordLocalResult as record, localMatchDecks, swapLocalSideboard, type LocalTournament } from "@/lib/localTournament";
import { armTournamentReturn, clearTournamentReturn, consumeTournamentResult, noteTournamentEngineSession } from "@/lib/localTournamentReturn";
const deck = { id: "test", name: "Test", format: "standard", cards: [{ identity: { name: "Plains" } }] } as Deck;
let tokenCounter = 0;
const recordLocalResult = (event: LocalTournament, round: number, match: number, winner: number | null) => {
  const token = `test-${++tokenCounter}`;
  const started = beginLocalGame(event, round, match, token);
  const result = record(started, round, match, winner, token);
  return result === started ? event : result;
};
const make = (size = 4) => createLocalTournament("event", deck, [deck], size, ["Easy", "Hard"], () => 0.5);
describe("local tournament", () => {
  it.each([4, 8, 16])("seeds %i entrants once with fixed copied decks and difficulty", size => {
    const event = make(size);
    expect(event.entrants).toHaveLength(size);
    expect(event.entrants[0].difficulty).toBeNull();
    expect(event.entrants.slice(1).every(e => e.difficulty === "Hard")).toBe(true);
    expect(new Set(event.rounds[0].flatMap(m => m.players)).size).toBe(size);
    expect(event.entrants[0].deck).not.toBe(deck);
    expect(parseLocalTournament(JSON.stringify(event))).toEqual(event);
  });
  it("rejects empty and mixed-format pools", () => {
    expect(() => createLocalTournament("x", deck, [], 4, ["Easy"])).toThrow();
    expect(() => createLocalTournament("x", deck, [{ ...deck, format: "modern" }], 4, ["Easy"])).toThrow();
  });
  it("rejects formats the local duel runner does not support", () => {
    for (const format of ["brawl", "two_headed_giant", "archenemy"] as const) {
      const unsupported = { ...deck, format };
      expect(() => createLocalTournament("x", unsupported, [unsupported], 4, ["Easy"])).toThrow();
      expect(parseLocalTournament(JSON.stringify({ ...make(), format }))).toBeNull();
    }
  });
  it.each([4, 8, 16])("finishes a %i-player bracket with exactly one champion", size => {
    let event = make(size);
    let results = 0;
    while (event.rounds.at(-1)![0].winner === null) {
      const round = event.rounds.length - 1;
      for (let match = 0; match < event.rounds[round].length; match++) {
        event = recordLocalResult(event, round, match, event.rounds[round][match].players[0]);
        results++;
      }
    }
    expect(results).toBe(size - 1);
    expect(event.rounds).toHaveLength(Math.log2(size));
    expect(event.rounds.at(-1)).toHaveLength(1);
    expect(parseLocalTournament(JSON.stringify(event))).toEqual(event);
  });
  it("draws replay, duplicate and unrelated results cannot advance, all winners advance", () => {
    let event = make();
    event = recordLocalResult(event, 0, 0, null);
    expect(event.rounds[0][0].draws).toBe(1);
    expect(event.rounds).toHaveLength(1);
    expect(recordLocalResult(event, 0, 0, 99)).toBe(event);
    event = recordLocalResult(event, 0, 0, event.rounds[0][0].players[0]);
    expect(recordLocalResult(event, 0, 0, null)).toBe(event);
    event = recordLocalResult(event, 0, 1, event.rounds[0][1].players[1]);
    expect(event.rounds[1][0].players).toEqual(event.rounds[0].map(m => m.winner));
    expect(parseLocalTournament(JSON.stringify(event))).toEqual(event);
    expect(recordLocalResult(event, 0, 1, null)).toBe(event);
  });
  it("validates persisted data rather than trusting it", () => {
    expect(parseLocalTournament("garbage")).toBeNull();
    expect(parseLocalTournament('{"version":1}')).toBeNull();
    const event = make(); event.rounds[0][0].winner = 99;
    expect(parseLocalTournament(JSON.stringify(event))).toBeNull();
  });
  it("consumes only the armed engine seats once and cancels abandoned games", async () => {
    const pending = { eventId: "x", round: 0, match: 0, token: "launch", humanSlot: "h", opponentSlot: "a" };
    const finished = armTournamentReturn(pending);
    expect(consumeTournamentResult("unrelated")).toBeNull();
    expect(consumeTournamentResult("a")?.humanWon).toBe(false);
    await finished;
    expect(consumeTournamentResult("h")).toBeNull();
    const abandoned = armTournamentReturn(pending); clearTournamentReturn(); await abandoned;
    expect(consumeTournamentResult("a")).toBeNull();
    void armTournamentReturn(pending);
    expect(consumeTournamentResult(null)?.humanWon).toBeNull();
    noteTournamentEngineSession("session-a");
    const replaced = armTournamentReturn(pending);
    noteTournamentEngineSession("session-b");
    await replaced;
    expect(consumeTournamentResult("h")).toBeNull();
  });
});
