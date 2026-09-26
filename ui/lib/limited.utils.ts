import { useMemo } from "react";

import type { DraftCard } from "@/types/limited";
import type { Deck, DeckCard } from "@/protocol/deck";
import type { ScryfallCard } from "@/types/scryfall";
import { frontFaceName, parseTypeLine } from "@/lib/scryfall.utils";
import { localCardImageUris, withLocalCardArt } from "@/lib/localCardArt";
import { cardKey, peekCard, useCard, useScryfallStore } from "@/stores/useScryfallStore";
import { effectiveRarity, RARITY_ORDER, type UIRarity } from "@/lib/cardRarity";

export type LimitedZone = "pool" | "main" | "sideboard";

export interface PoolEntry {
  index: number;
  card: DraftCard;
}

export function manaPipPattern(letter: string): RegExp {
  return new RegExp(`\\{[^}]*${letter}[^}]*\\}`, "g");
}

export function countManaPips(cost: string, letter: string): number {
  return cost.match(manaPipPattern(letter))?.length ?? 0;
}

export function deckCardToDraftCard(card: DeckCard): DraftCard {
  const { name, setCode, cardNumber, foil } = card.identity;
  return {
    id: "",
    name,
    setCode,
    cardNumber,
    foil,
  };
}

export function deckMainAsDraftCards(deck: Deck): DraftCard[] {
  return deck.cards.map(deckCardToDraftCard);
}

const PLACEHOLDER_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PLACEHOLDER_URIS = {
  small: PLACEHOLDER_URI,
  normal: PLACEHOLDER_URI,
  large: PLACEHOLDER_URI,
  png: PLACEHOLDER_URI,
  art_crop: PLACEHOLDER_URI,
  border_crop: PLACEHOLDER_URI,
};

export function refToDeckCard(
  ref: DraftCard,
  entry: {
    info: ScryfallCard;
    uris: {
      small: string;
      normal: string;
      large: string;
      png: string;
      art_crop: string;
      border_crop: string;
    };
  } | null,
  idx: number,
): DeckCard {
  const info = entry?.info;
  const isDfc = info?.layout === "transform" || info?.layout === "modal_dfc";
  const front = isDfc ? info?.card_faces?.[0] : undefined;
  const back = isDfc ? info?.card_faces?.[1] : undefined;
  const typeLine = parseTypeLine(front?.type_line ?? info?.type_line ?? "");
  return {
    identity: {
      id: `pool-${idx}-${ref.setCode}-${ref.cardNumber}`,
      name: frontFaceName(ref.name),
      setCode: info?.set ?? ref.setCode,
      cardNumber: info?.collector_number ?? ref.cardNumber,
      oracleId: info?.oracle_id,
      foil: ref.foil,
    },
    color: (info?.colors ?? []).join(""),
    manaCost: front?.mana_cost ?? info?.mana_cost ?? "",
    cmc: info?.cmc ?? 0,
    types: typeLine.types,
    subtypes: typeLine.subtypes,
    supertypes: typeLine.supertypes,
    text: front?.oracle_text ?? info?.oracle_text ?? "",
    layout: info?.layout,
    isDoubleFaced: isDfc,
    backFace: back
      ? {
          name: back.name,
          manaCost: back.mana_cost ?? "",
          typeLine: back.type_line ?? "",
          oracleText: back.oracle_text ?? "",
          uris: withLocalCardArt(back.image_uris, back.name) ?? localCardImageUris(back.name)!,
        }
      : undefined,
    colorIdentity: info?.color_identity ?? [],
    uris:
      (front
        ? withLocalCardArt(front.image_uris, front.name) ?? localCardImageUris(front.name)
        : withLocalCardArt(entry?.uris, ref.name)) ??
      localCardImageUris(ref.name) ??
      PLACEHOLDER_URIS,
  };
}

export async function resolveDeckCards(refs: DraftCard[]): Promise<DeckCard[]> {
  const store = useScryfallStore.getState();
  return Promise.all(
    refs.map(async (ref, idx) => {
      const lookup = { name: ref.name, setCode: ref.setCode, cardNumber: ref.cardNumber };
      const key = cardKey(lookup);
      let entry = store.cards[key]?.card ?? null;
      if (!entry) {
        try {
          entry = await store.getCard(lookup);
        } catch {
          entry = null;
        }
      }
      return refToDeckCard(ref, entry, idx);
    }),
  );
}

export function useDeckCard(ref: DraftCard, idx: number): DeckCard {
  const entry = useCard({
    name: ref.name,
    setCode: ref.setCode,
    cardNumber: ref.cardNumber,
  });
  return useMemo(() => refToDeckCard(ref, entry, idx), [entry, ref, idx]);
}

export function indexPool(pool: DraftCard[]): PoolEntry[] {
  return pool.map((card, index) => ({ index, card }));
}

export function unusedIndices(poolSize: number, main: number[], sideboard: number[]): number[] {
  const used = new Set([...main, ...sideboard]);
  const out: number[] = [];
  for (let i = 0; i < poolSize; i++) if (!used.has(i)) out.push(i);
  return out;
}

export function groupByRarity(
  entries: PoolEntry[],
  rarityOf: (ref: DraftCard) => UIRarity,
): Array<{ rarity: UIRarity; entries: PoolEntry[] }> {
  const map = new Map<UIRarity, PoolEntry[]>();
  for (const e of entries) {
    const rarity = rarityOf(e.card);
    const list = map.get(rarity) ?? [];
    list.push(e);
    map.set(rarity, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => RARITY_ORDER[a[0]] - RARITY_ORDER[b[0]])
    .map(([rarity, list]) => ({
      rarity,
      entries: list.sort((a, b) => a.card.name.localeCompare(b.card.name)),
    }));
}

export function useGroupByRarity(
  entries: PoolEntry[],
): Array<{ rarity: UIRarity; entries: PoolEntry[] }> {
  const cache = useScryfallStore((s) => s.cards);
  return useMemo(
    () =>
      groupByRarity(entries, (ref) =>
        effectiveRarity(
          peekCard(cache, {
            name: ref.name,
            setCode: ref.setCode,
            cardNumber: ref.cardNumber,
          }),
        ),
      ),
    [entries, cache],
  );
}

export function groupByName(entries: PoolEntry[]): Array<{ name: string; entries: PoolEntry[] }> {
  const map = new Map<string, PoolEntry[]>();
  for (const e of entries) {
    const list = map.get(e.card.name) ?? [];
    list.push(e);
    map.set(e.card.name, list);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, list]) => ({ name, entries: list }));
}

export const BASIC_LAND_NAMES = ["Plains", "Island", "Swamp", "Mountain", "Forest"] as const;
export type BasicLandName = (typeof BASIC_LAND_NAMES)[number];

export interface DeckValidationIssue {
  kind: "main_too_small";
  message: string;
}

export function validateLimitedDeck(
  main: DraftCard[],
  targetMainSize: number,
): DeckValidationIssue[] {
  const issues: DeckValidationIssue[] = [];
  if (main.length < targetMainSize) {
    issues.push({
      kind: "main_too_small",
      message: `Main deck has ${main.length} cards, needs ${targetMainSize}.`,
    });
  }
  return issues;
}

const WUBRG = ["W", "U", "B", "R", "G"] as const;
export type ManaLetter = (typeof WUBRG)[number];

export const BASIC_LAND_MANA: Record<BasicLandName, ManaLetter> = Object.fromEntries(
  BASIC_LAND_NAMES.map((name, i) => [name, WUBRG[i]]),
) as Record<BasicLandName, ManaLetter>;

export function makeBasicLand(name: BasicLandName, idx: number): DraftCard {
  return {
    id: "",
    name,
    setCode: "",
    cardNumber: `basic-${name.toLowerCase()}-${idx}`,
  };
}

export function isSynthBasic(card: DraftCard): boolean {
  return card.setCode === "" && card.cardNumber.startsWith("basic-");
}
