import type { Deck, DeckCard } from "@/protocol/deck";

// Compare complete copy records, not just names: printing/custom-card identity is preserved too.
const pool = (cards: DeckCard[]) => cards.map(card => JSON.stringify(card)).sort();
export function legalTournamentDeck(original: Deck, changed: Deck): boolean {
  const { cards: a, sideboard: b = [], ...originalRest } = original;
  const { cards: c, sideboard: d = [], ...changedRest } = changed;
  return Array.isArray(c) && Array.isArray(d) && a.length === c.length && b.length === d.length
    && JSON.stringify(originalRest) === JSON.stringify(changedRest)
    && JSON.stringify(pool([...a, ...b])) === JSON.stringify(pool([...c, ...d]));
}
export function swapTournamentCards(deck: Deck, main: number, side: number): Deck {
  const next = structuredClone(deck);
  if (!next.cards[main] || !next.sideboard?.[side]) return deck;
  [next.cards[main], next.sideboard[side]] = [next.sideboard[side], next.cards[main]];
  return next;
}
/** Modest, deterministic single-swap heuristic. Only original public composition is consulted.
 * Prefer relevant narrow removal over irrelevant narrow removal; never alter the mana base.
 * This is intentionally not an optimal sideboard planner. */
export function sideboardTournamentAi(deck: Deck, opponentOriginal: Deck): Deck {
  const count = (type: string) => opponentOriginal.cards.filter(c => c.types?.includes(type)).length;
  const score = (card: DeckCard) => {
    const text = card.text?.toLowerCase() ?? "";
    if (!/destroy|exile|counter/.test(text)) return 0;
    for (const type of ["Artifact", "Enchantment", "Creature"]) {
      if (text.includes(`target ${type.toLowerCase()}`)) return count(type) ? 1 : -1;
    }
    if (text.includes("noncreature spell")) return opponentOriginal.cards.some(c => !c.types?.includes("Land") && !c.types?.includes("Creature")) ? 1 : -1;
    return 0;
  };
  const eligible = (c: DeckCard) => !c.types?.includes("Land");
  const main = deck.cards.map((card, index) => ({ card, index })).filter(x => eligible(x.card)).sort((a,b) => score(a.card)-score(b.card) || a.index-b.index)[0];
  const side = (deck.sideboard ?? []).map((card, index) => ({ card, index })).filter(x => eligible(x.card)).sort((a,b) => score(b.card)-score(a.card) || a.index-b.index)[0];
  return main && side && score(side.card) > score(main.card) ? swapTournamentCards(deck, main.index, side.index) : deck;
}
