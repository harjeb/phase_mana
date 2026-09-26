import type { Deck } from "@/protocol/deck";
import type { AiDifficultyLabel } from "@/lib/aiDifficulty";
import { legalTournamentDeck, sideboardTournamentAi, swapTournamentCards } from "@/lib/localTournamentSideboard";

export interface Entrant { id: number; deck: Deck; difficulty: AiDifficultyLabel | null }
export interface LocalMatch {
  players: [number, number]; winner: number | null; draws: number; gameWins: [number, number];
  /** Match-local lists, absent for game one. Entrant lists are immutable originals. */
  decks: [Deck, Deck] | null;
  activeGame: string | null;
}
export interface LocalTournament { version: 2; id: string; format: string; matchType: "BO1" | "BO3"; entrants: Entrant[]; rounds: LocalMatch[][] }
// Keep the key so existing v1 events can be migrated.
export const LOCAL_TOURNAMENT_KEY = "phase.localTournament.v1";
export const LOCAL_TOURNAMENT_FORMATS = ["standard", "pioneer", "modern", "legacy", "vintage", "pauper", "premodern", "commander", "oathbreaker", "tiny_leaders", "duel_commander", "pauper_commander"] as const;
export function supportsLocalTournamentFormat(format: string): boolean {
  return (LOCAL_TOURNAMENT_FORMATS as readonly string[]).includes(format);
}
const newMatch = (a: number, b: number): LocalMatch => ({ players: [a, b], winner: null, draws: 0, gameWins: [0, 0], decks: null, activeGame: null });
export const gamesPlayed = (match: LocalMatch): number => match.draws + match.gameWins[0] + match.gameWins[1];
export function localMatchDecks(event: LocalTournament, match: LocalMatch): [Deck, Deck] {
  return match.decks ?? [event.entrants[match.players[0]].deck, event.entrants[match.players[1]].deck];
}
export function createLocalTournament(id: string, human: Deck, pool: Deck[], size: number, difficulties: readonly AiDifficultyLabel[], random = Math.random, matchType: "BO1" | "BO3" = "BO1"): LocalTournament {
  if (![4, 8, 16].includes(size) || !human.cards.length || !human.format || !supportsLocalTournamentFormat(human.format) || !pool.length || !difficulties.length || pool.some(deck => deck.format !== human.format || !deck.cards.length) || !["BO1", "BO3"].includes(matchType)) throw new Error("Invalid tournament pool");
  const pick = <T,>(items: readonly T[]): T => items[Math.min(items.length - 1, Math.max(0, Math.floor(random() * items.length)))];
  const entrants: Entrant[] = [{ id: 0, deck: structuredClone(human), difficulty: null }];
  for (let id = 1; id < size; id++) entrants.push({ id, deck: structuredClone(pick(pool)), difficulty: pick(difficulties) });
  const seeds = entrants.map(e => e.id);
  for (let i = seeds.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [seeds[i], seeds[j]] = [seeds[j], seeds[i]]; }
  return { version: 2, id, format: human.format, matchType, entrants, rounds: [Array.from({ length: size / 2 }, (_, i) => newMatch(seeds[i * 2], seeds[i * 2 + 1]))] };
}
function pendingMatch(event: LocalTournament, round: number, match: number): LocalMatch | null {
  const current = event.rounds[round]?.[match];
  return current && round === event.rounds.length - 1 && current.winner === null ? current : null;
}
export function beginLocalGame(event: LocalTournament, round: number, match: number, token: string): LocalTournament {
  if (!token || !pendingMatch(event, round, match)) return event;
  const next = structuredClone(event);
  next.rounds[round][match].activeGame = token;
  return next;
}
export function cancelLocalGame(event: LocalTournament, round: number, match: number, token: string): LocalTournament {
  if (event.rounds[round]?.[match]?.activeGame !== token) return event;
  const next = structuredClone(event); next.rounds[round][match].activeGame = null; return next;
}
export function swapLocalSideboard(event: LocalTournament, round: number, match: number, main: number, side: number): LocalTournament {
  const current = pendingMatch(event, round, match);
  if (!current || event.matchType !== "BO3" || !gamesPlayed(current) || !current.players.includes(0)) return event;
  const next = structuredClone(event);
  const target = next.rounds[round][match];
  target.decks = structuredClone(localMatchDecks(event, current));
  const slot = target.players.indexOf(0);
  target.decks[slot] = swapTournamentCards(target.decks[slot], main, side);
  if (!legalTournamentDeck(event.entrants[0].deck, target.decks[slot])) return event;
  target.activeGame = null; // A recovered/abandoned launch can no longer submit its result.
  return next;
}
export function recordLocalResult(event: LocalTournament, round: number, match: number, winner: number | null, token: string): LocalTournament {
  const current = pendingMatch(event, round, match);
  if (!current || !token || current.activeGame !== token || (winner !== null && !current.players.includes(winner))) return event;
  const next = structuredClone(event);
  const target = next.rounds[round][match];
  target.activeGame = null;
  if (winner === null) target.draws++;
  else {
    const slot = target.players.indexOf(winner);
    target.gameWins[slot]++;
    if (target.gameWins[slot] === (event.matchType === "BO3" ? 2 : 1)) target.winner = winner;
  }
  // Prepare each AI exactly once per completed game, including draws. Never consult live state.
  if (target.winner === null && event.matchType === "BO3") {
    target.decks = structuredClone(localMatchDecks(next, target));
    target.players.forEach((id, slot) => {
      if (id !== 0) target.decks![slot] = sideboardTournamentAi(target.decks![slot], event.entrants[target.players[1 - slot]].deck);
    });
  }
  const matches = next.rounds[round];
  if (matches.length > 1 && matches.every(m => m.winner !== null)) next.rounds.push(Array.from({ length: matches.length / 2 }, (_, i) => newMatch(matches[i * 2].winner!, matches[i * 2 + 1].winner!)));
  return next;
}
export function parseLocalTournament(raw: string | null): LocalTournament | null {
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || ![1, 2].includes(value.version)) return null;
    if (value.version === 1) {
      value.version = 2; value.matchType = "BO1";
      for (const matches of value.rounds) for (const m of matches) {
        m.gameWins = m.players.map((id: number) => m.winner === id ? 1 : 0);
        m.decks = null; m.activeGame = null;
      }
    }
    const event = value as LocalTournament;
    if (typeof event.id !== "string" || !event.id || typeof event.format !== "string" || !supportsLocalTournamentFormat(event.format) || !["BO1", "BO3"].includes(event.matchType) || ![4, 8, 16].includes(event.entrants.length) || !event.rounds.length || event.rounds.length > Math.log2(event.entrants.length)) return null;
    const validDeck = (deck: Deck) => Array.isArray(deck.cards) && deck.cards.length > 0 && [...deck.cards, ...(deck.sideboard ?? []), ...(deck.commanders ?? [])].every(c => typeof c.identity.name === "string" && c.identity.name.length > 0);
    if (!event.entrants.every((e, i) => e.id === i && e.deck.format === event.format && validDeck(e.deck) && (i === 0 ? e.difficulty === null : ["VeryEasy", "Easy", "Medium", "Hard", "VeryHard", "CEDH"].includes(e.difficulty!)))) return null;
    const threshold = event.matchType === "BO3" ? 2 : 1;
    for (let r = 0; r < event.rounds.length; r++) {
      const matches = event.rounds[r];
      if (matches.length !== event.entrants.length / 2 ** (r + 1)) return null;
      const expected = r === 0 ? event.entrants.map(e => e.id) : event.rounds[r - 1].map(m => m.winner);
      const actual = matches.flatMap(m => m.players);
      if (new Set(actual).size !== actual.length || expected.some(id => id === null || !actual.includes(id))) return null;
      if (r > 0 && matches.some((m, i) => m.players[0] !== expected[i * 2] || m.players[1] !== expected[i * 2 + 1])) return null;
      for (const m of matches) {
        if (m.players.length !== 2 || !Number.isSafeInteger(m.draws) || m.draws < 0 || !Array.isArray(m.gameWins) || m.gameWins.length !== 2 || m.gameWins.some(w => !Number.isSafeInteger(w) || w < 0 || w > threshold)) return null;
        const wins = m.gameWins.map((w, i) => w === threshold ? m.players[i] : null).filter(w => w !== null);
        if (wins.length > 1 || m.winner !== (wins[0] ?? null)) return null;
        if (m.activeGame !== null && (typeof m.activeGame !== "string" || !m.activeGame || m.winner !== null || r !== event.rounds.length - 1)) return null;
        if (m.decks !== null && (event.matchType !== "BO3" || !gamesPlayed(m) || !Array.isArray(m.decks) || m.decks.length !== 2 || !m.decks.every((deck, i) => validDeck(deck) && legalTournamentDeck(event.entrants[m.players[i]].deck, deck)))) return null;
      }
      if (r === event.rounds.length - 1 && matches.length > 1 && matches.every(m => m.winner !== null)) return null;
    }
    return event;
  } catch { return null; }
}
