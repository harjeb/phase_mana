import { t } from "@lingui/core/macro";
import { clearTournamentReturn, noteTournamentEngineSession } from "@/lib/localTournamentReturn";
import { toast } from "sonner";
import type { Prompt, StateUpdate } from "@/protocol";
import { armActiveLocalGame } from "@/lib/activeLocalGame";
import { applyPrompt, applyState } from "@/stores/gameStore.constants";
import { useGameStore } from "@/stores/useGameStore";
import { normalizeGameLogPayload } from "@/types/gameLog";

interface Snapshot {
  state: StateUpdate;
  prompt: Prompt | null;
  humanPlayerId: string;
  aiActions: number;
  /** Authoritative, bounded public history. Optional for older/online hosts. */
  gameLog?: unknown[];
  logSessionId?: string;
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
  clearTournamentReturn();
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
    throw new Error(t`The session was left or replaced before this response arrived.`);
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
  noteTournamentEngineSession(snapshot.logSessionId);
  const { setState, getState } = useGameStore;
  setState({
    isGameActive: true, isMultiplayer: false, isHost: false,
    myPlayerSlot: snapshot.humanPlayerId, currentPrompt: null,
    isWaitingForResponse: false, relinquishedPriority: false,
    isPrefetchingCards: false,
    // Replace rather than append: /state and reconnects replay the same history.
    // A new session (or a legacy host without logs) must not retain old entries.
    gameLog: (snapshot.gameLog ?? []).slice(-200).map(normalizeGameLogPayload),
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
  humanSideboard?: string[];
  aiSideboard?: string[];
  humanCommanders?: string[];
  aiCommanders?: string[];
  humanConspiracies?: string[];
  conspiracyChoices?: import("./conspiracies").ConspiracyChoice[];
  aiConspiracies?: string[];
  /** P5: a full custom ruleset from the format editor; overrides `format`. */
  customRules?: unknown;
  /** Phase engine AI difficulty label (`VeryEasy` … `CEDH`) for every AI seat. */
  difficulty?: string;
  /** Optional OpenAI-compatible endpoint that plays the AI seats. */
  llm?: import("@/lib/llmSeat").LlmSeatRequest;
  /** Special local game mode, e.g. `pack_wars_hand` (whole pack as opening hand). */
  gameMode?: string;
  extraOpponents?: { deck: string[]; commanders: string[]; conspiracy?: string[]; sideboard?: string[] }[];
}): Promise<void> {
  invalidateSnapshotGeneration();
  acceptSnapshot(await requestSnapshot("start", decks));
  // The host now owns a session for this tab; a refresh should find it again.
  armActiveLocalGame();
}

/**
 * CR 905.4a + CR 702.106: turn one of the human's face-down hidden-agenda
 * conspiracies face up using the authorized special action in the current prompt.
 * Addressed by wire card id because compat redacts a face-down card's name.
 */
export async function revealConspiracy(cardId: string): Promise<void> {
  const state = useGameStore.getState();
  const prompt = state.currentPrompt;
  const action = prompt?.input.type === "chooseAction" && prompt.input.actions.find(
    action => action.type === "activateAbility" && action.cardId === cardId,
  );
  if (!action) throw new Error(t`No authorized conspiracy reveal action`);
  if (!await state.respond({ type: "act", actionId: action.id })) throw new Error(t`Conspiracy reveal was rejected`);
}
