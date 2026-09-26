import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import type { GameFormat } from "./formats";

// Translate presentation only. Canonical IDs and deck legality rules stay stable.
const labels = {
  standard: [msg`Standard`, msg`60+ cards, max 4 copies, 20 life, rotating sets`],
  pioneer: [msg`Pioneer`, msg`60+ cards, max 4 copies, 20 life, Return to Ravnica forward`],
  modern: [msg`Modern`, msg`60+ cards, max 4 copies, 20 life, 8th Edition forward`],
  legacy: [msg`Legacy`, msg`60+ cards, max 4 copies, 20 life, all sets, banned list`],
  vintage: [msg`Vintage`, msg`60+ cards, max 4 copies, 20 life, all sets, restricted list`],
  pauper: [msg`Pauper`, msg`60+ cards, max 4 copies, 20 life, commons only`],
  premodern: [msg`Premodern`, msg`60+ cards, max 4 copies, Fourth Edition through Scourge`],
  commander: [msg`Commander`, msg`100 cards, singleton, 40 life, requires commander`],
  oathbreaker: [msg`Oathbreaker`, msg`60 cards, singleton, 20 life, planeswalker + signature spell`],
  tiny_leaders: [msg`Tiny Leaders`, msg`50 cards, singleton, 20 life, legendary commander with mana value 3 or less`],
  duel_commander: [msg`Duel Commander`, msg`100 cards, singleton, 30 life, 1v1 commander`],
  pauper_commander: [msg`Pauper Commander`, msg`100 cards, singleton, 40 life, uncommon creature commander, commons only`],
  archenemy: [msg`Archenemy`, msg`One archenemy at 40 life against the heroes at 20, with a scheme deck`],
  planechase: [msg`Planechase`, msg`60-card decks, 20 life, a shared planar deck and the planar die`],
  two_headed_giant: [msg`Two-Headed Giant`, msg`Two teams of two share a 30-life total and take their turns together`],
  draft: [msg`Draft`, msg`40+ cards, no copy limit, 20 life`],
  sealed: [msg`Sealed`, msg`40+ cards, no copy limit, 20 life`],
};

export function formatDisplayName(format: Pick<GameFormat, "id" | "name">): string {
  const entry = labels[format.id as keyof typeof labels];
  return entry ? i18n._(entry[0]) : format.name;
}

export function formatDisplayDescription(format: Pick<GameFormat, "id" | "description">): string {
  const entry = labels[format.id as keyof typeof labels];
  return entry ? i18n._(entry[1]) : format.description;
}
