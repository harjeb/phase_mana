import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OfflinePlayGame, OfflinePlaySeat } from "./offlinePlayRecord";
import {
  appendMatch,
  cardRecords,
  clearMatches,
  dailySeries,
  deckRecords,
  filterMatches,
  formatRecords,
  loadMatches,
  matchResult,
  opponentRecords,
  summarize,
} from "./matchHistory";

function seat(overrides: Partial<OfflinePlaySeat> & Pick<OfflinePlaySeat, "username">): OfflinePlaySeat {
  return {
    isBot: false,
    sideboardCount: 0,
    cards: [],
    ...overrides,
  };
}

function match(overrides: Partial<OfflinePlayGame>): OfflinePlayGame {
  return {
    reportId: "r1",
    startedAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:10:00.000Z",
    durationS: 600,
    engine: "Manabrew",
    startingLife: 20,
    endReason: "game_over",
    gameOver: true,
    conceded: [],
    clientVersion: "test",
    platform: "web",
    players: [],
    ...overrides,
  };
}

const human = (username: string, deckName: string, cards: [string, number][]) =>
  seat({
    username,
    deckName,
    cards: cards.map(([name, count]) => ({ name, setCode: "TST", count })),
  });
const bot = (username: string, deckName: string, cards: [string, number][]) =>
  seat({
    username,
    isBot: true,
    deckName,
    cards: cards.map(([name, count]) => ({ name, setCode: "TST", count })),
  });

describe("match result", () => {
  it("reads the human seat, not the bots", () => {
    const won = match({
      winner: "me",
      players: [human("me", "My Deck", []), bot("AI", "Bot Deck", [])],
    });
    const lost = match({
      winner: "AI",
      players: [human("me", "My Deck", []), bot("AI", "Bot Deck", [])],
    });
    expect(matchResult(won)).toBe("win");
    expect(matchResult(lost)).toBe("loss");
  });

  it("treats a decided game with no winner as a draw and an open game as unfinished", () => {
    expect(matchResult(match({ winner: undefined }))).toBe("draw");
    expect(matchResult(match({ gameOver: false }))).toBe("unfinished");
  });

  it("uses the local marker on online records, where no seat is a bot", () => {
    const online = match({
      winner: "Rival",
      players: [
        seat({ username: "me", isBot: false, isLocal: true, deckName: "Mine" }),
        seat({ username: "Rival", isBot: false, isLocal: false, deckName: "Theirs" }),
      ],
    });
    expect(matchResult(online)).toBe("loss");
    expect(cardRecords([online])).toEqual([]);
  });
});

describe("aggregates", () => {
  const win = match({
    reportId: "w",
    winner: "me",
    format: "commander",
    players: [human("me", "Dragons", [["Sol Ring", 1], ["Island", 10]]), bot("AI", "Goblins", [])],
  });
  const loss = match({
    reportId: "l",
    winner: "AI",
    players: [human("me", "Dragons", [["Sol Ring", 1], ["Mountain", 4]]), bot("AI", "Goblins", [])],
  });
  const abandoned = match({
    reportId: "a",
    gameOver: false,
    winner: undefined,
    players: [human("me", "Dragons", [["Mox Jet", 1]]), bot("AI", "Goblins", [])],
  });

  it("summarizes only what is comparable", () => {
    const summary = summarize([win, loss, abandoned]);
    expect(summary).toMatchObject({ games: 3, wins: 1, losses: 1, unfinished: 1 });
    expect(summary.winRate).toBe(0.5);
  });

  it("counts a deck's decided games", () => {
    expect(deckRecords([win, loss, abandoned])).toEqual([
      { key: "Dragons", games: 2, wins: 1, losses: 1, winRate: 0.5 },
    ]);
  });

  it("counts a card only in decided games, and only from the human deck", () => {
    const rows = cardRecords([win, loss, abandoned]);
    const byName = Object.fromEntries(rows.map((row) => [row.key, row]));
    expect(byName["Sol Ring"]).toMatchObject({ games: 2, wins: 1, losses: 1, winRate: 0.5 });
    expect(byName["Island"]).toMatchObject({ games: 1, wins: 1, winRate: 1 });
    // The abandoned game must not appear, and the bot's deck is never counted.
    expect(byName["Mox Jet"]).toBeUndefined();
    expect(byName["Goblins"]).toBeUndefined();
  });

  it("groups decided games by format", () => {
    expect(formatRecords([win, loss, abandoned])).toEqual([
      { key: "commander", games: 1, wins: 1, losses: 0, winRate: 1 },
      { key: "Unknown", games: 1, wins: 0, losses: 1, winRate: 0 },
    ]);
  });

  it("groups decided games by opponent deck", () => {
    expect(opponentRecords([win, loss, abandoned])).toEqual([
      { key: "Goblins", games: 2, wins: 1, losses: 1, winRate: 0.5 },
    ]);
  });
});

describe("filters", () => {
  const now = Date.parse("2026-02-15T12:00:00.000Z");
  const recentWin = match({
    reportId: "a",
    startedAt: "2026-02-14T10:00:00.000Z",
    format: "standard",
    winner: "me",
    players: [human("me", "Mono Red", [["Lightning Bolt", 4]]), bot("AI", "Control", [])],
  });
  const oldLoss = match({
    reportId: "b",
    startedAt: "2025-11-01T10:00:00.000Z",
    format: "commander",
    winner: "AI",
    players: [human("me", "Dragons", [["Sol Ring", 1]]), bot("AI", "Goblins", [])],
  });
  const all = [recentWin, oldLoss];

  it("windows, formats, decks, results and search compose", () => {
    expect(filterMatches(all, { days: 30 }, now)).toEqual([recentWin]);
    expect(filterMatches(all, { format: "commander" }, now)).toEqual([oldLoss]);
    expect(filterMatches(all, { deck: "Mono Red" }, now)).toEqual([recentWin]);
    expect(filterMatches(all, { result: "loss" }, now)).toEqual([oldLoss]);
    expect(filterMatches(all, { search: "lightning" }, now)).toEqual([recentWin]);
    expect(filterMatches(all, { search: "goblins" }, now)).toEqual([oldLoss]);
  });
});

describe("trends", () => {
  const now = Date.parse("2026-02-15T12:00:00.000Z");
  const at = (reportId: string, day: string, winner: string) =>
    match({
      reportId,
      startedAt: `${day}T10:00:00.000Z`,
      winner,
      players: [human("me", "Deck", []), bot("AI", "Bot", [])],
    });
  const matches = [
    at("w1", "2026-02-14", "me"),
    at("l1", "2026-02-14", "AI"),
    at("w2", "2026-02-15", "me"),
  ];

  it("zero-fills the window and carries a cumulative win rate", () => {
    const series = dailySeries(matches, 3, now);
    expect(series).toHaveLength(3);
    const [first, second, third] = series;
    expect(first?.games).toBe(0);
    expect(second).toMatchObject({ games: 2, wins: 1, losses: 1, winRate: 0.5 });
    expect(third).toMatchObject({ games: 1, wins: 1, cumulativeWinRate: 2 / 3 });
  });

  it("ignores matches outside the window", () => {
    expect(dailySeries([at("old", "2025-01-01", "me")], 3, now).every((p) => p.games === 0)).toBe(true);
  });
});

describe("local storage", () => {
  function fakeLocalStorage() {
    const store = new Map<string, string>();
    return {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    };
  }

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: fakeLocalStorage() };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("round-trips, dedupes by reportId, and clears", () => {
    const record = match({ reportId: "keep", players: [human("me", "Deck", [])] });
    appendMatch(record);
    appendMatch(record);
    expect(loadMatches()).toHaveLength(1);
    expect(loadMatches()[0]?.reportId).toBe("keep");
    clearMatches();
    expect(loadMatches()).toEqual([]);
  });
});
