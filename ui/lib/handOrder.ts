import type { CardDto } from "@/protocol/game";
import { t } from "@lingui/core/macro";
export type HandOrderMode = "manual" | "color" | "mana-value";
export function handOrderOptions(): readonly {
  value: HandOrderMode;
  label: string;
}[] {
  return [
    { value: "manual", label: t`Manual` },
    { value: "color", label: t`Color` },
    { value: "mana-value", label: t`Mana value` },
  ];
}
const COLOR_ORDER = "WUBRG";
function colorRank(color: string): number {
  if (color.length === 1) {
    const rank = COLOR_ORDER.indexOf(color);
    if (rank >= 0) return rank;
  }
  return color.length > 1 ? COLOR_ORDER.length : COLOR_ORDER.length + 1;
}
export function reconcileHandOrder(order: readonly string[], cards: readonly CardDto[]): string[] {
  const present = new Set(cards.map((card) => card.id));
  const next = order.filter((id) => present.has(id));
  const known = new Set(next);
  for (const card of cards) {
    if (!known.has(card.id)) {
      known.add(card.id);
      next.push(card.id);
    }
  }
  return next;
}
export function orderHandCards(
  cards: readonly CardDto[],
  mode: HandOrderMode,
  manualOrder: readonly string[],
): CardDto[] {
  const order = reconcileHandOrder(manualOrder, cards);
  const indexById = new Map(order.map((id, index) => [id, index]));
  const sorted = [...cards];
  const stableIndex = (card: CardDto) => indexById.get(card.id) ?? sorted.length;
  if (mode === "manual") {
    sorted.sort((left, right) => stableIndex(left) - stableIndex(right));
  } else if (mode === "color") {
    sorted.sort(
      (left, right) =>
        colorRank(left.color) - colorRank(right.color) || stableIndex(left) - stableIndex(right),
    );
  } else {
    sorted.sort((left, right) => left.cmc - right.cmc || stableIndex(left) - stableIndex(right));
  }
  return sorted;
}
export function nextHandOrderMode(mode: HandOrderMode): HandOrderMode {
  const options = handOrderOptions();
  const index = options.findIndex((option) => option.value === mode);
  return options[(index + 1) % options.length]!.value;
}
