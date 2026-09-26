/**
 * Local match history and the aggregates MTGA-style stats need.
 *
 * Every finished game already produces a rich `OfflinePlayGame` record in
 * `offlinePlayRecord` (players, per-seat decklists, winner, format, duration).
 * Offline games also ship it to the hub; online games keep only this local copy.
 * Reading it back gives history and card/deck win rates with no account.
 */
import { STORAGE_KEYS } from "@/lib/constants";
import type { OfflinePlayGame, OfflinePlaySeat } from "@/lib/offlinePlayRecord";

/** Bounded so a busy device cannot fill localStorage. */
const MAX_MATCHES = 1000;
const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export type MatchResult = "win" | "loss" | "draw" | "unfinished";

function isMatch(value: unknown): value is OfflinePlayGame {
  if (typeof value !== "object" || value === null) return false;
  const match = value as Partial<OfflinePlayGame>;
  return (
    typeof match.reportId === "string" &&
    typeof match.startedAt === "string" &&
    Array.isArray(match.players)
  );
}

export function loadMatches(): OfflinePlayGame[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEYS.MATCH_HISTORY) ?? "[]",
    );
    return Array.isArray(value) ? value.filter(isMatch) : [];
  } catch {
    return [];
  }
}

export function appendMatch(record: OfflinePlayGame): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadMatches();
    if (existing.some((match) => match.reportId === record.reportId)) return;
    const cutoff = Date.parse(record.startedAt) - MAX_AGE_MS;
    const next = [...existing, record]
      .filter((match) => Date.parse(match.startedAt) >= cutoff)
      .slice(-MAX_MATCHES);
    window.localStorage.setItem(STORAGE_KEYS.MATCH_HISTORY, JSON.stringify(next));
  } catch {
    // A full or blocked store must never break the game-end path.
  }
}

export function clearMatches(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEYS.MATCH_HISTORY);
  } catch {
    // ignore
  }
}

/**
 * The seat you played. Prefers the explicit `isLocal` marker written for online
 * games; older offline records only have `isBot`, where the human is the one
 * non-bot seat. Falls back to the first seat so display never breaks.
 */
export function localSeats(match: OfflinePlayGame): OfflinePlaySeat[] {
  const marked = match.players.filter((seat) => seat.isLocal === true);
  if (marked.length > 0) return marked;
  const humans = match.players.filter((seat) => !seat.isBot);
  return humans.length > 0 ? humans : match.players;
}

export function localSeat(match: OfflinePlayGame): OfflinePlaySeat | null {
  return localSeats(match)[0] ?? null;
}

/** Which side of the result the local player was on, if the game was decided. */
export function matchResult(match: OfflinePlayGame): MatchResult {
  if (!match.gameOver) return "unfinished";
  if (!match.winner) return "draw";
  return localSeats(match).some((seat) => seat.username === match.winner) ? "win" : "loss";
}

export interface MatchSummary {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  unfinished: number;
  winRate: number;
  totalSeconds: number;
  lastPlayedMs: number | null;
}

export interface RecordRow {
  key: string;
  games: number;
  wins: number;
  losses: number;
  winRate: number;
}

export type DeckRecord = RecordRow;
export type CardRecord = RecordRow;
export type FormatRecord = RecordRow;

function rate(wins: number, decided: number): number {
  return decided > 0 ? wins / decided : 0;
}

/** Only decided games move game/win counters; an abandoned game proves nothing. */
function forEachLocalSeat(
  matches: OfflinePlayGame[],
  visit: (match: OfflinePlayGame, seat: OfflinePlaySeat, won: boolean) => void,
): void {
  for (const match of matches) {
    const result = matchResult(match);
    if (result !== "win" && result !== "loss") continue;
    const won = result === "win";
    for (const seat of localSeats(match)) visit(match, seat, won);
  }
}

export function summarize(matches: OfflinePlayGame[]): MatchSummary {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let unfinished = 0;
  let totalSeconds = 0;
  let lastPlayedMs: number | null = null;
  for (const match of matches) {
    const result = matchResult(match);
    if (result === "win") wins += 1;
    else if (result === "loss") losses += 1;
    else if (result === "draw") draws += 1;
    else unfinished += 1;
    if (result === "win" || result === "loss") totalSeconds += match.durationS;
    const started = Date.parse(match.startedAt);
    if (!Number.isNaN(started) && (lastPlayedMs === null || started > lastPlayedMs)) {
      lastPlayedMs = started;
    }
  }
  const decided = wins + losses;
  return {
    games: matches.length,
    wins,
    losses,
    draws,
    unfinished,
    winRate: rate(wins, decided),
    totalSeconds,
    lastPlayedMs,
  };
}

function tally(rows: Map<string, RecordRow>, key: string, won: boolean): void {
  const row = rows.get(key) ?? { key, games: 0, wins: 0, losses: 0, winRate: 0 };
  row.games += 1;
  if (won) row.wins += 1;
  else row.losses += 1;
  rows.set(key, row);
}

function finish(rows: Map<string, RecordRow>): RecordRow[] {
  return [...rows.values()]
    .map((row) => ({ ...row, winRate: rate(row.wins, row.games) }))
    .sort((a, b) => b.games - a.games || a.key.localeCompare(b.key));
}

export function deckRecords(matches: OfflinePlayGame[]): DeckRecord[] {
  const rows = new Map<string, RecordRow>();
  forEachLocalSeat(matches, (_match, seat, won) => {
    const key =
      seat.deckName?.trim() || (seat.commander ? `${seat.commander} (commander)` : "Unknown deck");
    tally(rows, key, won);
  });
  return finish(rows);
}

export function cardRecords(matches: OfflinePlayGame[]): CardRecord[] {
  const rows = new Map<string, RecordRow>();
  forEachLocalSeat(matches, (_match, seat, won) => {
    for (const card of seat.cards) tally(rows, card.name, won);
  });
  return finish(rows);
}

export function formatRecords(matches: OfflinePlayGame[]): FormatRecord[] {
  const rows = new Map<string, RecordRow>();
  for (const match of matches) {
    const result = matchResult(match);
    if (result !== "win" && result !== "loss") continue;
    tally(rows, match.format ?? "Unknown", result === "win");
  }
  return finish(rows);
}

/** Win rate against each opponent deck (falls back to the opponent's name). */
export function opponentRecords(matches: OfflinePlayGame[]): RecordRow[] {
  const rows = new Map<string, RecordRow>();
  for (const match of matches) {
    const result = matchResult(match);
    if (result !== "win" && result !== "loss") continue;
    const mine = new Set(localSeats(match).map((seat) => seat.username));
    for (const opponent of match.players) {
      if (mine.has(opponent.username)) continue;
      tally(rows, opponent.deckName?.trim() || opponent.username, result === "win");
    }
  }
  return finish(rows);
}

/** Filter by result / format / local deck / window / free text, in that order. */
export interface MatchFilters {
  result?: MatchResult | "all";
  format?: string;
  deck?: string;
  days?: number;
  search?: string;
}

export function filterMatches(
  matches: OfflinePlayGame[],
  filters: MatchFilters,
  now = Date.now(),
): OfflinePlayGame[] {
  const search = filters.search?.trim().toLowerCase() ?? "";
  const since = filters.days && filters.days > 0 ? now - filters.days * 86_400_000 : null;
  return matches.filter((match) => {
    if (filters.result && filters.result !== "all" && matchResult(match) !== filters.result) {
      return false;
    }
    if (filters.format && (match.format ?? "Unknown") !== filters.format) return false;
    if (filters.deck && (localSeat(match)?.deckName ?? "Unknown deck") !== filters.deck) return false;
    if (since !== null && Date.parse(match.startedAt) < since) return false;
    if (search) {
      const haystack = [
        localSeat(match)?.deckName ?? "",
        ...match.players.map((seat) => seat.username),
        ...match.players.map((seat) => seat.deckName ?? ""),
        ...localSeats(match).flatMap((seat) => seat.cards.map((card) => card.name)),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export interface TrendPoint {
  key: string;
  dayMs: number;
  games: number;
  wins: number;
  losses: number;
  /** 0..1 for that bucket alone. */
  winRate: number;
  /** 0..1 through this bucket, so the line reads as a trend not noise. */
  cumulativeWinRate: number;
}

const DAY_MS = 86_400_000;

function dayStart(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dayKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Daily buckets. With a positive `days` the range is zero-filled so the chart
 * has an even x-axis; with 0 only days that saw a game are returned.
 */
export function dailySeries(matches: OfflinePlayGame[], days = 30, now = Date.now()): TrendPoint[] {
  const buckets = new Map<string, { dayMs: number; games: number; wins: number; losses: number }>();
  const add = (dayMs: number) => {
    const key = dayKey(dayMs);
    const bucket = buckets.get(key) ?? { dayMs, games: 0, wins: 0, losses: 0 };
    buckets.set(key, bucket);
    return bucket;
  };

  if (days > 0) {
    const end = dayStart(now);
    for (let i = days - 1; i >= 0; i -= 1) add(end - i * DAY_MS);
  } else {
    for (const match of matches) {
      const started = Date.parse(match.startedAt);
      if (!Number.isNaN(started)) add(dayStart(started));
    }
  }
  const rangeStart = days > 0 ? dayStart(now) - (days - 1) * DAY_MS : null;

  for (const match of matches) {
    const started = Date.parse(match.startedAt);
    if (Number.isNaN(started)) continue;
    if (rangeStart !== null && started < rangeStart) continue;
    const bucket = add(dayStart(started));
    const result = matchResult(match);
    bucket.games += 1;
    if (result === "win") bucket.wins += 1;
    else if (result === "loss") bucket.losses += 1;
  }

  let cumulativeWins = 0;
  let cumulativeDecided = 0;
  return [...buckets.values()]
    .sort((a, b) => a.dayMs - b.dayMs)
    .map((bucket) => {
      cumulativeWins += bucket.wins;
      cumulativeDecided += bucket.wins + bucket.losses;
      return {
        key: dayKey(bucket.dayMs),
        dayMs: bucket.dayMs,
        games: bucket.games,
        wins: bucket.wins,
        losses: bucket.losses,
        winRate: rate(bucket.wins, bucket.wins + bucket.losses),
        cumulativeWinRate: rate(cumulativeWins, cumulativeDecided),
      };
    });
}
