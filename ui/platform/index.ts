import { createContext, useContext } from "react";
import type { Deck } from "@/protocol/deck";
import type { IPlatformApi, PlatformFeature } from "./types";
export type * from "./types";
export type { RoomRelayEnvelope, RoomMessagePayload } from "@/types/server";
export { getClientPlatform } from "./clientPlatform";

const events = new EventTarget();
const unsupported = async (): Promise<never> => {
  throw new Error("This feature is not available in the local Phase backend.");
};

/**
 * The host takes one card name per copy and resolves them against its own card
 * database. A ManaBrew deck is already one entry per copy — the preset loader
 * expands counts. Commander slots stay separate from the library.
 */
function deckCardNames(deck: Deck): string[] {
  return deck.cards.map((card) => card.identity.name);
}
const platform: IPlatformApi = {
  type: "web",
  init: async () => {},
  game: {
    // The host owns one session: the deck the player picked becomes seat 0 and
    // the chosen AI deck seat 1. Omitting a deck falls back to the host's
    // built-in casual deck.
    startGame: async ({ deck, format, commanderName, opponentDecks }) => {
      if ((opponentDecks?.length ?? 0) > 1) {
        throw new Error("Local Phase currently supports one AI opponent only (1v1).");
      }
      const { startLocalDeckGame } = await import("@/phase/transport");
      const commanders = deck.commanders?.map((card) => card.identity.name) ?? [];
      const humanDeck = deckCardNames(deck);
      // Legacy deck-editor selections designate a commander still in the main deck.
      if (!commanders.length && commanderName) {
        const index = humanDeck.indexOf(commanderName);
        if (index >= 0) humanDeck.splice(index, 1);
        commanders.push(commanderName);
      }
      await startLocalDeckGame({
        format: format ?? deck.format ?? "standard",
        humanDeck,
        humanCommanders: commanders,
        aiDeck: opponentDecks?.[0] ? deckCardNames(opponentDecks[0]) : undefined,
        aiCommanders: opponentDecks?.[0]?.commanders?.map((card) => card.identity.name) ?? [],
      });
      return `phase host (${deck.name})`;
    },
    startMultiplayerGame: unsupported,
    respond: async ({ promptId, action }) => {
      const { acceptSnapshot, requestSnapshot } = await import("@/phase/transport");
      acceptSnapshot(await requestSnapshot("respond", { kind: "response", promptId, action }));
    },
    sendDirective: async ({ directive }) => {
      const { acceptSnapshot, requestSnapshot } = await import("@/phase/transport");
      acceptSnapshot(await requestSnapshot("respond", { kind: "directive", directive }));
    },
    // The store runs this on exit. There is nothing for the host to tear down
    // (it owns the single session), but an answer still in flight must not
    // repopulate the state the store just cleared.
    endGame: async () => {
      const { invalidateSnapshotGeneration } = await import("@/phase/transport");
      invalidateSnapshotGeneration();
    },
    restoreSnapshot: unsupported,
    getPrompt: async () => {
      const { requestSnapshot } = await import("@/phase/transport");
      return (await requestSnapshot("state")).prompt;
    },
  },
  storage: {
    get: async <T>(key: string) => {
      const value = localStorage.getItem(`phase-mana:${key}`);
      return value === null ? null : JSON.parse(value) as T;
    },
    set: async (key, value) => localStorage.setItem(`phase-mana:${key}`, JSON.stringify(value)),
    remove: async (key) => localStorage.removeItem(`phase-mana:${key}`),
    keys: async () => Object.keys(localStorage).filter((key) => key.startsWith("phase-mana:")).map((key) => key.slice(11)),
  },
  events: {
    on: <T>(event: string, handler: (payload: T) => void) => {
      const listener = (message: Event) => handler((message as CustomEvent<T>).detail);
      events.addEventListener(event, listener);
      return () => events.removeEventListener(event, listener);
    },
    emit: (event, payload) => { events.dispatchEvent(new CustomEvent(event, { detail: payload })); },
  },
  invoke: unsupported,
  isSupported: () => false,
};

export const getPlatform = (): IPlatformApi => platform;
export const getPlatformType = (): IPlatformApi["type"] => "web";
export const PlatformContext = createContext<IPlatformApi | null>(null);
export const usePlatform = () => useContext(PlatformContext) ?? platform;
export const isFeatureSupported = (feature: PlatformFeature) => platform.isSupported(feature);
export const getGameApi = () => platform.game;
export const getStorageApi = () => platform.storage;
export const getEventBus = () => platform.events;
export const getServerApi = () => platform.server;
export function resetPlatform(): void { /* The local host owns the session. */ }
