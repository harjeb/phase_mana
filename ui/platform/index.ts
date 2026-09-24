import { t } from "@lingui/core/macro";
import { createContext, useContext } from "react";
import { requireValidCustomFormat, type CustomFormatRules } from "@/lib/customFormats";
import type { Deck } from "@/protocol/deck";
import type { IPlatformApi, PlatformFeature } from "./types";
export type * from "./types";
export type { RoomRelayEnvelope, RoomMessagePayload } from "@/types/server";
export { getClientPlatform } from "./clientPlatform";

// This fork runs the rules engine in a native HTTP sidecar, not SharedArrayBuffer/WASM.
export const usesLocalPhaseServer = true;
const events = new EventTarget();
const unsupported = async (): Promise<never> => {
  throw new Error(t`This feature is not available in the local Phase backend.`);
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
    // the chosen AI decks seats 1–3. Omitting a deck falls back to the host's
    // built-in casual deck.
    startGame: async ({ deck, format, commanderName, opponentDecks, conspiracies, customRules, opponentConspiracies }) => {
      if ((opponentDecks?.length ?? 0) > 3) {
        throw new Error(t`Local Phase supports up to three AI opponents (four players).`);
      }
      if (customRules) await requireValidCustomFormat(customRules as CustomFormatRules, Math.max(2, 1 + (opponentDecks?.length ?? 0)));
      const commandZoneDisabled = !!customRules && (customRules as CustomFormatRules).structural.command_zone_mode === "Disabled";
      const names = (value: Deck) => commandZoneDisabled
        ? [...deckCardNames(value), ...(value.commanders?.map((card) => card.identity.name) ?? [])]
        : deckCardNames(value);
      const { startLocalDeckGame } = await import("@/phase/transport");
      const commanders = commandZoneDisabled ? [] : deck.commanders?.map((card) => card.identity.name) ?? [];
      const humanDeck = names(deck);
      // Legacy deck-editor selections designate a commander still in the main deck.
      if (!commandZoneDisabled && !commanders.length && commanderName) {
        const index = humanDeck.indexOf(commanderName);
        if (index >= 0) humanDeck.splice(index, 1);
        commanders.push(commanderName);
      }
      const { prepareConspiracyChoices } = await import("@/phase/conspiracies");
      const conspiracyChoices = await prepareConspiracyChoices([
        { conspiracies: conspiracies ?? [], deck: humanDeck },
        ...Array.from({ length: Math.max(1, opponentDecks?.length ?? 0) }, (_, index) => ({
          conspiracies: opponentConspiracies?.[index] ?? [],
          deck: opponentDecks?.[index] ? names(opponentDecks[index]) : [],
        })),
      ]);
      const { closeOnline } = await import("@/phase/online");
      closeOnline();
      await startLocalDeckGame({
        conspiracyChoices,
        format: format ?? deck.format ?? "standard",
        humanDeck,
        humanCommanders: commanders,
        humanConspiracies: conspiracies,
        aiConspiracies: opponentConspiracies?.[0],
        customRules,
        humanSideboard: customRules ? deck.sideboard?.map((card) => card.identity.name) : undefined,
        aiSideboard: customRules ? opponentDecks?.[0]?.sideboard?.map((card) => card.identity.name) : undefined,
        aiDeck: opponentDecks?.[0] ? names(opponentDecks[0]) : undefined,
        aiCommanders: commandZoneDisabled ? [] : opponentDecks?.[0]?.commanders?.map((card) => card.identity.name) ?? [],
        extraOpponents: (opponentDecks ?? []).slice(1).map((opponent, index) => ({
          deck: names(opponent),
          conspiracy: opponentConspiracies?.[index + 1],
          sideboard: customRules ? opponent.sideboard?.map((card) => card.identity.name) : undefined,
          commanders: commandZoneDisabled ? [] : opponent.commanders?.map((card) => card.identity.name) ?? [],
        })),
      });
      return `phase host (${deck.name})`;
    },
    startMultiplayerGame: unsupported,
    respond: async ({ promptId, action }) => {
      const { isOnlineSession, respondOnline } = await import("@/phase/online");
      if (isOnlineSession()) return respondOnline({ kind: "response", promptId, action });
      const { acceptSnapshot, requestSnapshot } = await import("@/phase/transport");
      acceptSnapshot(await requestSnapshot("respond", { kind: "response", promptId, action }));
    },
    sendDirective: async ({ directive }) => {
      const { isOnlineSession, respondOnline } = await import("@/phase/online");
      if (isOnlineSession()) return respondOnline({ kind: "directive", directive });
      const { acceptSnapshot, requestSnapshot } = await import("@/phase/transport");
      acceptSnapshot(await requestSnapshot("respond", { kind: "directive", directive }));
    },
    // The store runs this on exit. There is nothing for the host to tear down
    // (it owns the single session), but an answer still in flight must not
    // repopulate the state the store just cleared.
    endGame: async () => {
      const { closeOnline } = await import("@/phase/online");
      closeOnline();
      const { invalidateSnapshotGeneration } = await import("@/phase/transport");
      invalidateSnapshotGeneration();
    },
    restoreSnapshot: unsupported,
    getPrompt: async () => {
      const { isOnlineSession } = await import("@/phase/online");
      if (isOnlineSession()) {
        const { useGameStore } = await import("@/stores/useGameStore");
        return useGameStore.getState().currentPrompt;
      }
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
  invoke: async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    if (!command.startsWith("limited_")) return unsupported();
    const response = await fetch("/api/limited", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, args: args ?? {} }),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<T>;
  },
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
