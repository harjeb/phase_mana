import { resolveCardFaces } from "@/lib/cardFaces";
import { withLocalCardArt } from "@/lib/localCardArt";
import { useCard } from "@/stores/useScryfallStore";
import { asDeckCard } from "@/lib/decks";
import { useGameStore } from "@/stores/useGameStore";
import type { CardDto } from "@/protocol/game";
import type { ScryfallImageSize } from "@/components/game/game.utils";

export function useResolvedGameCard(card: CardDto) {
  const deck = useGameStore((state) => state.gameDecks[card.ownerId]);
  const deckCard = asDeckCard(deck, card);
  const entry = useCard({
    name: deckCard.identity.name || card.identity.name,
    setCode: deckCard.identity.setCode || undefined,
    cardNumber: deckCard.identity.cardNumber || undefined,
  });
  const cardFaces = resolveCardFaces(entry?.info);
  // Persisted decks can predate the local library. Normalize their stored
  // printing URLs as well, rather than letting them bypass local-first faces.
  const frontUris = withLocalCardArt(deckCard.uris, deckCard.identity.name);
  const backUris = withLocalCardArt(deckCard.backFace?.uris, deckCard.backFace?.name ?? "");
  const imageUrl = (faceIndex: number, size: ScryfallImageSize) =>
    faceIndex === 0
      ? (frontUris?.[size] ?? cardFaces.faces[0]?.imageUris?.[size])
      : (backUris?.[size] ?? cardFaces.faces[faceIndex]?.imageUris?.[size] ?? frontUris?.[size]);

  return { deckCard, cardFaces, imageUrl, info: entry?.info ?? null };
}
