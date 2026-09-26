import type { Deck, DeckCard } from "@/protocol/deck";
import type { AiDifficultyLabel } from "@/lib/aiDifficulty";

interface SimulationPlayer {
  deck: Pick<Deck, "cards">;
  difficulty: AiDifficultyLabel | null;
}

const difficultyWeight: Record<AiDifficultyLabel, number> = {
  VeryEasy: -0.025, Easy: -0.015, Medium: -0.005,
  Hard: 0.005, VeryHard: 0.015, CEDH: 0.025,
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A deliberately modest composition estimate, not a rules or matchup evaluator.
 * Each array entry is one card copy. Unknown metadata contributes no evidence.
 * Land balance peaks at 40%; an average spell cost of 2–4 is treated equally.
 * Confidence scales with metadata coverage, so sparse imports stay near neutral.
 * No card names, prices, engine support, sideboards, or external data are consulted.
 */
function deckWeight(cards: readonly DeckCard[]): number {
  if (!cards.length) return 0;
  const typed = cards.filter(card => card.types?.length);
  if (!typed.length) return 0;
  const lands = typed.filter(card => card.types.includes("Land")).length;
  const balance = clamp(1 - Math.abs(lands / typed.length - 0.4) / 0.2, -1, 1);
  const spells = typed.filter(card => !card.types.includes("Land") && Number.isFinite(card.cmc) && card.cmc >= 0);
  const average = spells.length ? spells.reduce((sum, card) => sum + card.cmc, 0) / spells.length : 0;
  const curve = spells.length ? clamp(1 - Math.max(2 - average, average - 4, 0) / 2, -1, 1) : 0;
  return 0.1 * balance * typed.length / cards.length + 0.05 * curve * spells.length / cards.length;
}

/** Seat-zero win chance; swapping seats complements it, and equal weights give 50%. */
export function localTournamentWinChance(first: SimulationPlayer, second: SimulationPlayer): number {
  const score = (player: SimulationPlayer) => deckWeight(player.deck.cards) + (player.difficulty ? difficultyWeight[player.difficulty] : 0);
  return clamp(0.5 + (score(first) - score(second)), 0.25, 0.75);
}

/** One weighted draw, with an injected RNG in [0, 1). Never runs an engine. */
export function simulateLocalTournamentGame(first: SimulationPlayer, second: SimulationPlayer, random: () => number): 0 | 1 {
  return random() < localTournamentWinChance(first, second) ? 0 : 1;
}
