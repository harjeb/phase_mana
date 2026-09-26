import { t } from "@lingui/core/macro";
import { toast } from "sonner";
import type { Prompt, StateUpdate } from "@/protocol";
import { acceptSnapshot, invalidateSnapshotGeneration } from "./transport";
import { normalizeServer } from "./endpoint";
import { randomPassword } from "./invite";
import { useGameStore } from "@/stores/useGameStore";
import { configureOnlineDraftTransport, handleOnlineDraftFrame, onlineDraftStatus, reconnectOnlineDraft } from "./onlineDraft";

interface TerminalDelivery {
  key: { game_code: string; generation: number };
  terminalRevision: number;
  deliveryId: string;
  credential: string;
  display: { winner: number | null; reason: string };
}
interface Credentials { game_code: string; player_token: string; full_key: TerminalDelivery["key"]; terminal?: TerminalDelivery }
interface Status { endpoint: string; code: string; connected: boolean; message: string; publicUrl: string | null }
let status: Status = { endpoint: "", code: "", connected: false, message: "", publicUrl: null };
const listeners = new Set<() => void>();
const eventListeners = new Set<(type: string, data: unknown) => void>();
export function subscribeOnlineEvents(listener: (type: string, data: unknown) => void) {
  eventListeners.add(listener);
  return () => { eventListeners.delete(listener); };
}
function emitOnlineEvent(type: string, data: unknown) {
  eventListeners.forEach(listener => listener(type, data));
}
export const onlineStatus = () => status;
export const subscribeOnline = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(patch: Partial<Status>) { status = { ...status, ...patch }; listeners.forEach(listener => listener()); }
let socket: WebSocket | null = null;
let active = false;
let revision = -1;
let credentials: Credentials | null = null;
let nextRequestId = 0;
let answer: { requestId: number; acceptedRevision: number | null; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
/**
 * A host waiting for its own room to exist, or a guest waiting for its seat.
 * Kept separate from `answer` because neither is a game response: they resolve
 * on server announcements (`GameCreated`, `SessionAttached`) and fail
 * with the same `fail()` path, so the UI never has to poll the status store.
 */
let pendingCreate: { resolve: (gameCode: string) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
let pendingJoin: { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
const key = (endpoint: string) => `phase-online:${endpoint}`;

/**
 * Re-exported so callers that only need the URL rule keep one import site.
 * Defined in `endpoint.ts` to stay usable from dependency-free modules.
 */
export { normalizeServer } from "./endpoint";
export function latestOnlineEndpoint(): string {
  try { return sessionStorage.getItem("phase-online-endpoint") ?? ""; } catch { return ""; }
}
export function savedOnlineSession(endpoint: string): boolean {
  return sessionStorage.getItem(key(normalizeServer(endpoint))) !== null;
}
export const isOnlineSession = () => active;
function send(type: string, data?: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error(t`Disconnected. Reconnect before responding.`);
  socket.send(JSON.stringify(data === undefined ? { type } : { type, data }));
}
function settle(error?: Error) {
  if (!answer) return;
  clearTimeout(answer.timer);
  const pending = answer;
  answer = null;
  if (error) pending.reject(error); else pending.resolve();
}
function settleCreate(error?: Error, gameCode = "") {
  if (!pendingCreate) return;
  clearTimeout(pendingCreate.timer);
  const pending = pendingCreate;
  pendingCreate = null;
  if (error) pending.reject(error); else pending.resolve(gameCode);
}
function settleJoin(error?: Error) {
  if (!pendingJoin) return;
  clearTimeout(pendingJoin.timer);
  const pending = pendingJoin;
  pendingJoin = null;
  if (error) pending.reject(error); else pending.resolve();
}
function settleAccepted() {
  if (answer?.acceptedRevision != null && revision >= answer.acceptedRevision) settle();
}
export function closeOnline(): void {
  active = false;
  const previous = socket;
  socket = null;
  previous?.close();
  settle(new Error("Online session closed"));
  settleCreate(new Error("Online session closed"));
  settleJoin(new Error("Online session closed"));
  useGameStore.setState({ currentPrompt: null, isWaitingForResponse: false });
  update({ connected: false });
}

/** Native seat tokens are scoped to the exact server URL and this browser tab. */
export function connectOnline(endpoint: string, request: { type: string; data?: unknown } | "reconnect"): void {
  endpoint = normalizeServer(endpoint);
  if (typeof location !== "undefined" && location.protocol === "https:" && endpoint.startsWith("ws:")) {
    throw new Error(t`This HTTPS page requires a secure WSS invitation. Open the local HTTP app for LAN play, or configure a TLS tunnel.`);
  }
  let initial = request;
  if (initial === "reconnect") {
    const saved = sessionStorage.getItem(key(endpoint));
    if (!saved) throw new Error(t`No saved session for this server in this tab.`);
    const parsed = JSON.parse(saved) as Credentials;
    if (!parsed.game_code || !parsed.player_token || !parsed.full_key) throw new Error(t`Invalid saved session.`);
    initial = { type: "Reconnect", data: parsed };
  }
  const draftSession = ["CreateDraft", "CreateDraftWithSettings", "JoinDraft", "JoinDraftWithPassword", "ReconnectDraft"].includes(initial.type);
  closeOnline();
  invalidateSnapshotGeneration();
  active = true;
  revision = -1;
  credentials = request === "reconnect" ? initial.data as Credentials : null;
  update({ endpoint, publicUrl: null, code: credentials?.game_code ?? (initial.data as { game_code?: string } | undefined)?.game_code ?? "", connected: false, message: t`Connecting…` });
  const current = new WebSocket(endpoint);
  socket = current;
  let hello = false;
  let draftMatchKey = "";
  const fail = (message: string) => {
    settle(new Error(message));
    settleCreate(new Error(message));
    settleJoin(new Error(message));
    update({ message });
    emitOnlineEvent("ConnectionError", { message });
    useGameStore.setState({ currentPrompt: null, isWaitingForResponse: false });
    toast.error(message);
  };
  current.onmessage = event => {
    if (socket !== current) return;
    try {
      const frame = JSON.parse(String(event.data));
      const data = frame.data;
      if (frame.type === "ServerHello") {
        if (hello) throw new Error(t`Duplicate server handshake`);
        if (data.mode !== "Full" || data.protocol_version !== 76 || data.manabrew_version !== 2) {
          throw new Error(t`This server does not support the required Phase multiplayer protocol (76 / ManaBrew 2).`);
        }
        hello = true;
        send("ClientHello", { client_version: "0.1.0", build_commit: "phase-mana", protocol_version: 76, wire_formats: [] });
        update({
          connected: true,
          message: t`Waiting for players…`,
          // The host's shareable base address, when it advertises one. Absent
          // on a bare LAN server, which is why the invite falls back.
          publicUrl: typeof data.public_url === "string" && data.public_url ? data.public_url : null,
        });
        if (request === "reconnect" && credentials) {
          send("BootstrapTerminalDelivery", { request: { key: credentials.full_key, playerToken: credentials.player_token, requestId: crypto.randomUUID() } });
        } else send(initial.type, initial.data);
      } else if (!hello) {
        throw new Error(t`Server sent data before its handshake`);
      } else if (handleOnlineDraftFrame(frame, endpoint)) {
        return;
      } else if (frame.type === "DraftMatchStart") {
        if (!draftSession || !data.game_code || data.full_key?.game_code !== data.game_code ||
          !Number.isSafeInteger(data.full_key.generation) || data.full_key.generation < 1 || !data.player_token || !onlineDraftStatus().code) {
          throw new Error(t`Invalid draft match attachment`);
        }
        const matchKey = JSON.stringify(data.full_key);
        if (draftMatchKey !== matchKey) {
          draftMatchKey = matchKey;
          settle(new Error("Draft advanced to a new match"));
          revision = -1;
          credentials = null; // Draft credentials are never Full seat credentials.
          update({ code: data.game_code, message: "Starting draft match…" });
          // Announcement alone does not attach the socket to the Full game.
          send("ReconnectDraft", { draft_code: onlineDraftStatus().code, player_token: data.player_token });
        }
      } else if (frame.type === "TerminalBootstrapResult" || frame.type === "TerminalResult") {
        const delivery = data.delivery as TerminalDelivery | null;
        if (!delivery) {
          if (frame.type === "TerminalBootstrapResult") send(initial.type, initial.data);
          return;
        }
        if (!credentials || delivery.key?.game_code !== credentials.full_key.game_code || delivery.key.generation !== credentials.full_key.generation) return;
        if (!Number.isSafeInteger(delivery.terminalRevision) || delivery.terminalRevision < revision ||
          typeof delivery.deliveryId !== "string" || !delivery.deliveryId || typeof delivery.credential !== "string" || !delivery.credential ||
          typeof delivery.display?.reason !== "string" || !(delivery.display.winner === null || Number.isInteger(delivery.display.winner))) {
          throw new Error(t`Invalid terminal result`);
        }
        const gameView = revision >= 0 ? useGameStore.getState().gameView : null;
        credentials = { ...credentials, terminal: delivery };
        sessionStorage.setItem(key(endpoint), JSON.stringify(credentials));
        revision = delivery.terminalRevision;
        useGameStore.setState({ currentPrompt: null, isWaitingForResponse: false,
          ...(gameView ? { gameView: { ...gameView, gameOver: true, winnerId: delivery.display.winner === null ? null : `player-${delivery.display.winner}` } } : {}),
        });
        update({ message: delivery.display.winner === null ? "Game over — draw." : `Game over — Player ${delivery.display.winner + 1} won.` });
        settleAccepted();
        if (answer) settle(new Error("Game ended before this response was confirmed."));
        send("AckTerminalDelivery", { delivery_id: delivery.deliveryId, credential: delivery.credential });
      } else if (["GameCreated", "SessionAttached", "GameStarted"].includes(frame.type)) {
        if (data.player_token && data.full_key) {
          credentials = { game_code: data.game_code ?? credentials?.game_code ?? status.code, player_token: data.player_token, full_key: data.full_key };
          if (!credentials.game_code || credentials.full_key.game_code !== credentials.game_code ||
            !Number.isSafeInteger(credentials.full_key.generation) || credentials.full_key.generation < 1) throw new Error(t`Invalid session credentials`);
          sessionStorage.setItem(key(endpoint), JSON.stringify(credentials));
          sessionStorage.setItem("phase-online-endpoint", endpoint);
          update({ code: credentials.game_code });
          if (frame.type === "SessionAttached") settleJoin();
        }
        if (frame.type === "GameCreated" && credentials) settleCreate(undefined, credentials.game_code);
        if (frame.type === "GameStarted") {
          send("ManabrewSnapshot");
          emitOnlineEvent("GameStarted", data);
        }
      } else if (frame.type === "StateUpdate") {
        // The server pushes the final private snapshot before retiring the room.
        if (data.state?.waiting_for?.type !== "GameOver") send("ManabrewSnapshot");
      } else if (frame.type === "ManabrewSnapshot") {
        const view = data.snapshot as { game_code: string; state_revision: number; your_player: number; update: StateUpdate; prompt: Prompt | null };
        if (view.game_code !== status.code || !Number.isSafeInteger(view.state_revision)) throw new Error(t`Invalid session snapshot`);
        if (view.state_revision < revision) return;
        revision = view.state_revision;
        acceptSnapshot({ state: view.update, prompt: view.prompt, humanPlayerId: `player-${view.your_player}`, aiActions: 0 });
        useGameStore.setState({ isMultiplayer: true });
        update({ message: "Connected" });
        settleAccepted();
      } else if (frame.type === "ManabrewResponseAccepted") {
        if (answer && answer.requestId === data.request_id && Number.isSafeInteger(data.state_revision)) {
          answer.acceptedRevision = data.state_revision;
          settleAccepted();
        }
      } else if (frame.type === "ActionNoOp") {
        send("ManabrewSnapshot");
      } else if (["Error", "ActionRejected", "ActionFailed", "RequestRejected", "VersionMismatch"].includes(frame.type)) {
        if (frame.type === "RequestRejected" && data?.reason === "ManaBrew: GameNotStarted" && revision < 0) {
          update({ message: t`Waiting for players…` });
          return;
        }
        const hadAnswer = answer !== null;
        fail(data?.message ?? data?.reason ?? data?.rejection?.message ?? "Server rejected the request");
        if (hadAnswer) send("ManabrewSnapshot");
      }
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      current.close();
    }
  };
  current.onclose = () => {
    if (socket !== current) return;
    update({ connected: false, message: t`Disconnected — reconnect to resume your seat.` });
    emitOnlineEvent("ConnectionError", { message: t`Disconnected — reconnect to resume your seat.` });
    settle(new Error("Connection closed"));
    settleCreate(new Error("Connection closed"));
    settleJoin(new Error("Connection closed"));
    useGameStore.setState({ currentPrompt: null, isWaitingForResponse: false });
    toast.error(t`Connection lost`, { action: { label: "Reconnect", onClick: () => draftSession ? reconnectOnlineDraft(endpoint) : connectOnline(endpoint, "reconnect") } });
  };
  current.onerror = () => { if (socket === current) fail(t`Could not connect to the Phase server`); };
}

configureOnlineDraftTransport({ connect: connectOnline, send });

/**
 * Open a private room and hand back the code and password an invite needs.
 *
 * `public: false` hides the room from the lobby list; the password is what
 * keeps a six-character code from being guessed (36⁶ is enumerable). It is
 * generated with a CSPRNG here rather than accepted from the UI so a weak
 * password cannot be typed in.
 */
export function createPrivateRoom(
  endpoint: string,
  input: { deck: unknown; displayName: string; players: number; password?: string; formatConfig?: unknown; startWhenFull?: boolean },
): Promise<{ gameCode: string; password: string }> {
  const password = input.password ?? randomPassword();
  return new Promise((resolve, reject) => {
    // Connect first: it closes any previous session, which would reject a
    // request this function has not registered yet.
    connectOnline(endpoint, { type: "CreateGameWithSettings", data: {
      deck: input.deck, display_name: input.displayName, public: false, password,
      timer_seconds: null, player_count: input.players,
      ...(input.formatConfig ? { format_config: input.formatConfig } : {}),
      start_when_full: input.startWhenFull ?? true,
    } });
    const timer = setTimeout(() => settleCreate(new Error(t`The server did not confirm the room in time.`)), 30000);
    pendingCreate = { resolve: (gameCode) => resolve({ gameCode, password }), reject, timer };
  });
}

/** Take the invited seat as soon as the server supplies its reconnect credentials. */
export function joinPrivateRoom(
  endpoint: string,
  input: { deck: unknown; displayName: string; gameCode: string; password: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    connectOnline(endpoint, { type: "JoinGameWithPassword", data: {
      game_code: input.gameCode, deck: input.deck, display_name: input.displayName, password: input.password,
    } });
    const timer = setTimeout(() => settleJoin(new Error("The server did not seat this client in time.")), 30000);
    pendingJoin = { resolve, reject, timer };
  });
}

export function startOnlineGame(): void {
  send("SeatMutate", { mutation: { type: "Start" } });
}

export function abandonOnlineGame(): void {
  send("AbandonGame");
}

export function respondOnline(message: unknown): Promise<void> {
  if (answer) return Promise.reject(new Error("A response is already pending"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle(new Error("Server response timed out; reconnect to refresh the game.")), 30000);
    const requestId = nextRequestId = (nextRequestId + 1) >>> 0;
    answer = { requestId, acceptedRevision: null, resolve, reject, timer };
    try { send("ManabrewResponse", { message, request_id: requestId }); } catch (error) { settle(error as Error); }
  });
}
