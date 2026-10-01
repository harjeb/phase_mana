import { useEffect, useMemo, useState } from "react";
import { cardKey, useScryfallStore } from "@/stores/useScryfallStore";
import { loadBrowserMetadata, peekBrowserMetadata } from "./browserMetadata";
import { isFacelessCard } from "@/lib/gameCard";
import type { CardBrowserItem } from "./cardBrowser";

export function useBrowserSearchItems(items: CardBrowserItem[]) {
  const bucket = useScryfallStore((s) => s.cards);
  const [loading, setLoading] = useState(false);
  const locale = useScryfallStore((s) => s.locale);
  useEffect(() => {
    let active = true;
    const unique = [
      ...new Map(
        items
          .filter((item) => !isFacelessCard(item.card))
          .map((item) => [
            cardKey({
              name: item.card.identity.name,
              setCode: item.card.identity.setCode || undefined,
              cardNumber: item.card.identity.cardNumber || undefined,
            }),
            item.card,
          ]),
      ).values(),
    ];
    const missing = unique.filter(
      (card) => !peekBrowserMetadata(useScryfallStore.getState().cards, card),
    );
    setLoading(missing.length > 0);
    // Concurrent lookups let the store's collection queue batch this zone.
    void Promise.allSettled(missing.map(loadBrowserMetadata)).then(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [items, locale]);
  const incomplete = items.some(
    ({ card }) => !isFacelessCard(card) && !peekBrowserMetadata(bucket, card),
  );
  const searchable = useMemo(
    () =>
      items.map((item) => {
        if (isFacelessCard(item.card)) return item;
        const info = peekBrowserMetadata(bucket, item.card);
        return {
          ...item,
          searchText: [
            item.searchText,
            info?.oracle_text,
            info?.type_line,
            ...(info?.card_faces ?? []).flatMap((face) => [
              face.name,
              face.oracle_text,
              face.type_line,
            ]),
          ]
            .filter(Boolean)
            .join(" "),
        };
      }),
    [items, bucket],
  );
  return { searchable, loading, incomplete };
}
