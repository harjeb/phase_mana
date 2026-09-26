import { t } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import { normalizeServer } from "./endpoint";
import { abandonOnlineGame, closeOnline, connectOnline, createPrivateRoom, joinPrivateRoom, startOnlineGame, subscribeOnlineEvents } from "./online";
import type { WaitingRoom, WaitingRoomStatus } from "./waitingRoom.types";

const listeners = new Set<() => void>();
let status: WaitingRoomStatus = { endpoint: "", memberId: "", connected: false, connecting: false, room: null, error: "" };
export const waitingRoomStatus = () => status;
export const subscribeWaitingRoom = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(patch: Partial<WaitingRoomStatus>) {
  status = { ...status, ...patch };
  listeners.forEach(listener => listener());
}
let socket: WebSocket | null = null;
let generation = 0;
let creator = false;
let launching = false;
let launchGeneration = 0;
let pending: { resolve: (room: { code: string; password: string }) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null;
const storageKey = "phase-waiting-room";
interface SavedRoom { endpoint: string; memberId: string; token: string }
function settle(error?: Error, room?: { code: string; password: string }) {
  const request = pending;
  if (!request) return;
  pending = null;
  clearTimeout(request.timer);
  if (error) request.reject(error); else request.resolve(room!);
}
function roomError(message: string): string {
  const prefix = "Game launch failed: ";
  if (message.startsWith(prefix)) {
    const reason = i18n._(message.slice(prefix.length));
    return t`Could not start the game: ${reason}`;
  }
  return i18n._(message);
}
function send(type: string, data?: unknown) {
  if (socket?.readyState !== WebSocket.OPEN) throw new Error(t`The room is disconnected. Reconnect before making changes.`);
  socket.send(JSON.stringify({ type, ...(data === undefined ? {} : { data }) }));
}
export function sendWaitingRoomCommand(type: string, data?: unknown): void {
  update({ error: "" });
  try { send(type, data); }
  catch (cause) { update({ error: cause instanceof Error ? cause.message : String(cause) }); }
}
function engineEndpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = "/ws";
  url.search = "";
  url.hash = "";
  return url.href;
}
function clearNativeLaunch() {
  ++launchGeneration;
  if (creator) { try { abandonOnlineGame(); } catch { /* No native game was attached. */ } }
  creator = false;
  launching = false;
  closeOnline();
}
subscribeOnlineEvents((type, data) => {
  if (!launching) return;
  if (type === "GameStarted") {
    if (creator) sendWaitingRoomCommand("RoomPlaying");
    launching = false;
  } else if (type === "ConnectionError") {
    sendWaitingRoomCommand("RoomLaunchFailed", { message: (data as { message: string }).message });
    clearNativeLaunch();
  }
});

async function launchNative(type: string, data: Record<string, any>, currentGeneration: number) {
  const currentLaunch = ++launchGeneration;
  launching = true;
  try {
    if (type === "RoomLaunch") {
      creator = true;
      const result = await createPrivateRoom(engineEndpoint(status.endpoint), {
        deck: data.deck, displayName: data.displayName, players: data.capacity,
        formatConfig: data.formatConfig, startWhenFull: false,
      });
      if (currentGeneration !== generation || currentLaunch !== launchGeneration) return;
      send("RoomCreatedGame", result);
    } else {
      creator = false;
      await joinPrivateRoom(engineEndpoint(status.endpoint), data as { deck: unknown; displayName: string; gameCode: string; password: string });
      if (currentGeneration !== generation || currentLaunch !== launchGeneration) return;
    }
    send("RoomGameAttached");
  } catch (cause) {
    if (currentGeneration !== generation || currentLaunch !== launchGeneration) return;
    const message = cause instanceof Error ? cause.message : String(cause);
    update({ error: message });
    sendWaitingRoomCommand("RoomLaunchFailed", { message });
    clearNativeLaunch();
  }
}

function connectRoom(endpoint: string, type: string, data: Record<string, unknown>): Promise<{ code: string; password: string }> {
  endpoint = normalizeServer(endpoint);
  if (location.protocol === "https:" && endpoint.startsWith("ws:")) {
    return Promise.reject(new Error(t`This HTTPS page requires a secure WSS invitation. Open the local HTTP app for LAN play, or configure a TLS tunnel.`));
  }
  if (socket) socket.close();
  settle(new Error(t`Room connection replaced.`));
  const currentGeneration = ++generation;
  update({ endpoint, memberId: "", connected: false, connecting: true, room: null, error: "" });
  const current = new WebSocket(endpoint);
  socket = current;
  let hello = false;
  let resumedNative = false;
  const result = new Promise<{ code: string; password: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(t`The server did not confirm the room in time.`);
      settle(error);
      update({ connecting: false, error: error.message });
      current.close();
    }, 30000);
    pending = { resolve, reject, timer };
  });
  current.onmessage = event => {
    if (socket !== current) return;
    try {
      const frame = JSON.parse(String(event.data));
      if (frame.type === "RoomHello") {
        if (hello || frame.data.version !== 1) throw new Error(t`This host does not support waiting rooms. Update the host and try again.`);
        hello = true;
        send(type, data);
      } else if (!hello) {
        throw new Error(t`This host does not support waiting rooms. Update the host and try again.`);
      } else if (frame.type === "RoomAttached") {
        const attached = frame.data;
        if (!attached.memberId || !attached.token || !attached.code) throw new Error(t`Invalid room membership.`);
        sessionStorage.setItem(storageKey, JSON.stringify({ endpoint, memberId: attached.memberId, token: attached.token }));
        update({ memberId: attached.memberId, connected: true, connecting: false });
        settle(undefined, { code: attached.code, password: attached.password ?? String(data.password ?? "") });
      } else if (frame.type === "RoomState") {
        const room = frame.data as WaitingRoom;
        if (status.room?.phase !== "waiting" && room.phase === "waiting" && launching) clearNativeLaunch();
        update({ room });
        if (type === "RoomReconnect" && room.phase === "playing" && !resumedNative) {
          resumedNative = true;
          // Reattach native credentials belonging to this browser tab only.
          connectOnline(engineEndpoint(endpoint), "reconnect");
        }
      } else if (frame.type === "RoomLaunch" || frame.type === "RoomLaunchJoin") {
        void launchNative(frame.type, frame.data, currentGeneration);
      } else if (frame.type === "RoomStartEngine") {
        startOnlineGame();
      } else if (frame.type === "RoomLaunchFailed") {
        update({ error: roomError(frame.data.message) });
        clearNativeLaunch();
      } else if (frame.type === "RoomError") {
        const error = new Error(roomError(frame.data.message));
        update({ error: error.message });
        settle(error);
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      update({ error: error.message, connecting: false });
      settle(error);
    }
  };
  current.onclose = () => {
    if (socket !== current) return;
    update({ connected: false, connecting: false, error: t`Room connection lost. Reconnect to return to your seat.` });
    settle(new Error(status.error));
  };
  current.onerror = () => {
    if (socket !== current) return;
    update({ connecting: false, error: t`Could not connect to the waiting room.` });
    settle(new Error(status.error));
  };
  return result;
}
export function createWaitingRoom(endpoint: string, displayName: string, roomKey: string) {
  return connectRoom(endpoint, "RoomCreate", { displayName, roomKey });
}
export function joinWaitingRoom(endpoint: string, displayName: string, code: string, password: string) {
  return connectRoom(endpoint, "RoomJoin", { displayName, code, password });
}
export function hasSavedWaitingRoom(): boolean {
  return sessionStorage.getItem(storageKey) !== null;
}
export function reconnectWaitingRoom() {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as SavedRoom | null;
  if (!saved?.endpoint || !saved.memberId || !saved.token) return Promise.reject(new Error(t`No saved waiting room in this tab.`));
  return connectRoom(saved.endpoint, "RoomReconnect", { memberId: saved.memberId, token: saved.token });
}
export function leaveWaitingRoom(): void {
  if (status.connected && status.room?.phase === "waiting") sendWaitingRoomCommand("RoomLeave");
  ++generation;
  const previous = socket;
  socket = null;
  previous?.close();
  settle(new Error(t`Left the room.`));
  sessionStorage.removeItem(storageKey);
  if (launching) clearNativeLaunch();
  update({ endpoint: "", memberId: "", connected: false, connecting: false, room: null, error: "" });
}
