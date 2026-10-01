import {
  peekCard,
  useScryfallStore,
  type ScryfallEntry,
} from "@/stores/useScryfallStore";
import type { CardDto } from "@/protocol/game";

function printingLookup(card: CardDto) {
  return {
    name: card.identity.name,
    setCode: card.identity.setCode || undefined,
    cardNumber: card.identity.cardNumber || undefined,
  };
}

/** Rules search may use another printing; artwork lookups remain exact. */
export function peekBrowserMetadata(
  bucket: Record<string, ScryfallEntry>,
  card: CardDto,
) {
  return (
    peekCard(bucket, printingLookup(card)) ??
    (card.identity.isToken
      ? null
      : peekCard(bucket, { name: card.identity.name }))
  );
}

export async function loadBrowserMetadata(card: CardDto): Promise<void> {
  const store = useScryfallStore.getState();
  if (peekBrowserMetadata(store.cards, card)) return;
  try {
    await store.getCard(printingLookup(card));
  } catch (error) {
    // Token names are ambiguous (for example, different Soldier tokens).
    if (card.identity.isToken || !card.identity.setCode) throw error;
    await store.getCard({ name: card.identity.name });
  }
}
