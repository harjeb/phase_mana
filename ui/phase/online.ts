import { toast } from "sonner";
import type { Prompt, StateUpdate } from "@/protocol";
import { acceptSnapshot, invalidateSnapshotGeneration } from "./transport";
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
interface Status { endpoint: string; code: string; connected: boolean; message: string }
let status: Status = { endpoint: "", code: "", connected: false, message: "" };
const listeners = new Set<() => void>();
export const onlineStatus = () => status;
export const subscribeOnline = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(patch: Partial<Status>) { status = { ...status, ...patch }; listeners.forEach(listener => listener()); }
let socket: WebSocket | null = null;
let active = false;
let revision = -1;
let credentials: Credentials | null = null;
let nextRequestId = 0;
let answer: { requestId: number; acceptedRevision: number | null; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
const key = (endpoint: string) => `phase-online:${endpoint}`;

export function normalizeServer(endpoint: string): string {
  const url = new URL(endpoint);
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Enter a ws:// or wss:// server URL without credentials or query parameters.");
  }
  if (url.pathname === "/") url.pathname = "/ws";
  return url.href;
}
export function savedOnlineSession(endpoint: string): boolean {
  return sessionStorage.getItem(key(normalizeServer(endpoint))) !== null;
}
export const isOnlineSession = () => active;
function send(type: string, data?: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error("Disconnected. Reconnect before responding.");
  socket.send(JSON.stringify(data === undefined ? { type } : { type, data }));
}
function settle(error?: Error) {
  if (!answer) return;
  clearTimeout(answer.timer);
  const pending = answer;
  answer = null;
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
  useGameStore.setState({ currentPrompt: null, isWaitingForResponse: false });
  update({ connected: false });
}

/** Native seat tokens are scoped to the exact server URL and this browser tab. */
export function connectOnline(endpoint: string, request: { type: string; data?: unknown } | "reconnect"): void {
  endpoint = normalizeServer(endpoint);
  let initial = request;
  if (initial === "reconnect") {
    const saved = sessionStorage.getItem(key(endpoint));
    if (!saved) throw new Error("No saved session for this server in this tab.");
    const parsed = JSON.parse(saved) as Credentials;
    if (!parsed.game_code || !parsed.player_token || !parsed.full_key) throw new Error("Invalid saved session.");
    initial = { type: "Reconnect", data: parsed };
  }
  const draftSession = ["CreateDraft", "CreateDraftWithSettings", "JoinDraft", "JoinDraftWithPassword", "ReconnectDraft"].includes(initial.type);
  closeOnline();
  invalidateSnapshotGeneration();
  active = true;
  revision = -1;
  credentials = request === "reconnect" ? initial.data as Credentials : null;
  update({ endpoint, code: credentials?.game_code ?? (initial.data as { game_code?: string } | undefined)?.game_code ?? "", connected: false, message: "Connecting…" });
  const current = new WebSocket(endpoint);
  socket = current;
  let hello = false;
  let draftMatchKey = "";
  const fail = (message: string) => {
    settle(new Error(message));
    update({ message });
    useGameStore.setState({ currentPrompt: null, isWaitingForResponse: false });
    toast.error(message);
  };
  current.onmessage = event => {
    if (socket !== current) return;
    try {
      const frame = JSON.parse(String(event.data));
      const data = frame.data;
      if (frame.type === "ServerHello") {
        if (hello) throw new Error("Duplicate server handshake");
        if (data.mode !== "Full" || data.protocol_version !== 76 || data.manabrew_version !== 2) {
          throw new Error("This server does not support the required Phase multiplayer protocol (76 / ManaBrew 2).");
        }
        hello = true;
        send("ClientHello", { client_version: "0.1.0", build_commit: "phase-mana", protocol_version: 76, wire_formats: [] });
        update({ connected: true, message: "Waiting for players…" });
        if (request === "reconnect" && credentials) {
          send("BootstrapTerminalDelivery", { request: { key: credentials.full_key, playerToken: credentials.player_token, requestId: crypto.randomUUID() } });
        } else send(initial.type, initial.data);
      } else if (!hello) {
        throw new Error("Server sent data before its handshake");
      } else if (handleOnlineDraftFrame(frame, endpoint)) {
        return;
      } else if (frame.type === "DraftMatchStart") {
        if (!draftSession || !data.game_code || data.full_key?.game_code !== data.game_code ||
          !Number.isSafeInteger(data.full_key.generation) || data.full_key.generation < 1 || !data.player_token || !onlineDraftStatus().code) {
          throw new Error("Invalid draft match attachment");
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
          throw new Error("Invalid terminal result");
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
          if (!credentials.game_code) throw new Error("Server omitted the session code");
          sessionStorage.setItem(key(endpoint), JSON.stringify(credentials));
          update({ code: credentials.game_code });
        }
        if (frame.type === "GameStarted") send("ManabrewSnapshot");
      } else if (frame.type === "StateUpdate") {
        // The server pushes the final private snapshot before retiring the room.
        if (data.state?.waiting_for?.type !== "GameOver") send("ManabrewSnapshot");
      } else if (frame.type === "ManabrewSnapshot") {
        const view = data.snapshot as { game_code: string; state_revision: number; your_player: number; update: StateUpdate; prompt: Prompt | null };
        if (view.game_code !== status.code || !Number.isSafeInteger(view.state_revision)) throw new Error("Invalid session snapshot");
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
          update({ message: "Waiting for players…" });
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
    update({ connected: false, message: "Disconnected — reconnect to resume your seat." });
    settle(new Error("Connection closed"));
    useGameStore.setState({ currentPrompt: null, isWaitingForResponse: false });
    toast.error("Connection lost", { action: { label: "Reconnect", onClick: () => draftSession ? reconnectOnlineDraft(endpoint) : connectOnline(endpoint, "reconnect") } });
  };
  current.onerror = () => { if (socket === current) fail("Could not connect to the Phase server"); };
}

configureOnlineDraftTransport({ connect: connectOnline, send });

export function respondOnline(message: unknown): Promise<void> {
  if (answer) return Promise.reject(new Error("A response is already pending"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => settle(new Error("Server response timed out; reconnect to refresh the game.")), 30000);
    const requestId = nextRequestId = (nextRequestId + 1) >>> 0;
    answer = { requestId, acceptedRevision: null, resolve, reject, timer };
    try { send("ManabrewResponse", { message, request_id: requestId }); } catch (error) { settle(error as Error); }
  });
}
