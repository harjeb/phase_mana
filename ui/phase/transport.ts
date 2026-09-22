import { toast } from "sonner";
import type { Prompt, StateUpdate } from "@/protocol";
import { applyPrompt, applyState } from "@/stores/gameStore.constants";
import { useGameStore } from "@/stores/useGameStore";

interface Snapshot {
  state: StateUpdate;
  prompt: Prompt | null;
  humanPlayerId: string;
  aiActions: number;
}

/**
 * Monotonic session token.
 *
 * A request is slow (the host replays priority passes and the AI searches), so
 * it can still be in flight when the player leaves the game or starts a new
 * one. The store clears its state on exit and bumps its own launch generation;
 * this token is what lets a completion from the abandoned session be dropped
 * instead of resurrecting it. `invalidateSnapshotGeneration` is called by the
 * platform's `endGame`, which the store runs on exit.
 */
let generation = 0;

export function invalidateSnapshotGeneration(): void {
  generation += 1;
}

export async function requestSnapshot(
  path: string,
  body?: unknown,
  requestGeneration: number = generation,
): Promise<Snapshot> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const message = await response.text();
    toast.error(message);
    throw new Error(message);
  }
  const snapshot = (await response.json()) as Snapshot;
  if (requestGeneration !== generation) {
    throw new Error("The session was left or replaced before this response arrived.");
  }
  return snapshot;
}

// Dev-only handle for the manual end-to-end harness (`npm run e2e`), which
// drives a real game through the store instead of through canvas coordinates.
// Stripped from production bundles.
if (import.meta.env.DEV) {
  (window as unknown as { __pm?: typeof useGameStore }).__pm = useGameStore;
}

export function acceptSnapshot(snapshot: Snapshot): void {
  const { setState, getState } = useGameStore;
  setState({
    isGameActive: true, isMultiplayer: false, isHost: false,
    myPlayerSlot: snapshot.humanPlayerId, currentPrompt: null,
    isWaitingForResponse: false, relinquishedPriority: false,
    isPrefetchingCards: false,
  });
  applyState(snapshot.state.gameView, "phase", setState, getState);
  if (snapshot.prompt) applyPrompt(snapshot.prompt, "phase", setState, getState);
}

/**
 * Start the host's session from explicit card lists (one string per copy). The
 * host resolves names against its own card database and applies the requested
 * format, keeping commander slots separate from the main deck.
 *
 * This deliberately does not clear the store's per-game fields, so a caller that
 * has already recorded the deck objects (`useGameStore` does, for card art and
 * the deck panel) keeps them.
 */
export async function startLocalDeckGame(decks: {
  format?: string;
  humanDeck?: string[];
  aiDeck?: string[];
  humanCommanders?: string[];
  aiCommanders?: string[];
}): Promise<void> {
  invalidateSnapshotGeneration();
  acceptSnapshot(await requestSnapshot("start", decks));
}
