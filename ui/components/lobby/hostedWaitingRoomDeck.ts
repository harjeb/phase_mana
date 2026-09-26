import type { Deck } from "@/protocol/deck";
import type { RoomDeck } from "@/phase/waitingRoom.types";

/** DeckCard arrays already contain one entry per copy; preserve each zone. */
export function exportWaitingRoomDeck(deck: Pick<Deck, "cards" | "sideboard" | "commanders">): RoomDeck {
  return {
    main_deck: deck.cards.map((card) => card.identity.name),
    sideboard: deck.sideboard.map((card) => card.identity.name),
    commander: (deck.commanders ?? []).map((card) => card.identity.name),
  };
}
