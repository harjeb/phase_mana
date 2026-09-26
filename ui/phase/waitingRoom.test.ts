import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  createPrivateRoom: vi.fn(), joinPrivateRoom: vi.fn(), startOnlineGame: vi.fn(), abandonOnlineGame: vi.fn(), closeOnline: vi.fn(), connectOnline: vi.fn(),
  listener: (_type: string, _data: unknown) => {},
}));
vi.mock("./online", () => ({ ...native, subscribeOnlineEvents: (listener: typeof native.listener) => { native.listener = listener; return () => {}; } }));
import { createWaitingRoom, joinWaitingRoom, leaveWaitingRoom, reconnectWaitingRoom, sendWaitingRoomCommand, waitingRoomStatus } from "./waitingRoom";
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: { type: string; data?: unknown }[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(public url: string) { Socket.instances.push(this); }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(type: string, data: unknown) { this.onmessage?.({ data: JSON.stringify({ type, data }) }); }
}
const room = { code: "ABC123", hostId: "owner", phase: "waiting", format: "standard", capacity: 2, members: [] };
const deck = { main_deck: ["Forest"], sideboard: [], commander: [] };
beforeEach(() => {
  vi.clearAllMocks();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("location", { protocol: "http:" });
  const storage = new Map();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  native.createPrivateRoom.mockResolvedValue({ gameCode: "GAME12", password: "game-password" });
  native.joinPrivateRoom.mockResolvedValue(undefined);
});
afterEach(() => { leaveWaitingRoom(); vi.unstubAllGlobals(); });
async function attach() {
  const promise = createWaitingRoom("ws://localhost:9374/room", "Owner", "local-key");
  const socket = Socket.instances.at(-1)!;
  socket.receive("RoomHello", { version: 1 });
  socket.receive("RoomAttached", { memberId: "owner", token: "private-token", code: "ABC123", password: "invite-password" });
  socket.receive("RoomState", room);
  await promise;
  return socket;
}
it("creates a real waiting room without asking for a deck or creating an engine game", async () => {
  const socket = await attach();
  expect(socket.sent).toEqual([{ type: "RoomCreate", data: { displayName: "Owner", roomKey: "local-key" } }]);
  expect(waitingRoomStatus().room?.phase).toBe("waiting");
  expect(native.createPrivateRoom).not.toHaveBeenCalled();
  sendWaitingRoomCommand("RoomSit", { seat: 1 });
  expect(socket.sent.at(-1)).toEqual({ type: "RoomSit", data: { seat: 1 } });
});
it("joins an invitation before choosing a seat or deck", async () => {
  const promise = joinWaitingRoom("ws://localhost:9374/room", "Guest", "ABC123", "invite-password");
  const socket = Socket.instances[0]!;
  socket.receive("RoomHello", { version: 1 });
  socket.receive("RoomAttached", { memberId: "guest", token: "guest-token", code: "ABC123" });
  await promise;
  expect(socket.sent[0]).toEqual({ type: "RoomJoin", data: { displayName: "Guest", code: "ABC123", password: "invite-password" } });
  expect(native.joinPrivateRoom).not.toHaveBeenCalled();
});
it("defers native Start until the coordinator confirms every attachment", async () => {
  const socket = await attach();
  socket.receive("RoomState", { ...room, phase: "starting" });
  socket.receive("RoomLaunch", { deck, displayName: "Owner", capacity: 2, formatConfig: { game_format: "Standard" } });
  await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe("RoomGameAttached"));
  expect(native.createPrivateRoom).toHaveBeenCalledWith("ws://localhost:9374/ws", expect.objectContaining({ deck, startWhenFull: false, formatConfig: { game_format: "Standard" } }));
  expect(native.startOnlineGame).not.toHaveBeenCalled();
  socket.receive("RoomStartEngine", {});
  expect(native.startOnlineGame).toHaveBeenCalledOnce();
  native.listener("GameStarted", {});
  expect(socket.sent.at(-1)?.type).toBe("RoomPlaying");
});
it("uses only the private launch payload for an invited native seat", async () => {
  const socket = await attach();
  socket.receive("RoomState", { ...room, phase: "starting" });
  socket.receive("RoomLaunchJoin", { deck, displayName: "Guest", gameCode: "GAME12", password: "game-password" });
  await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe("RoomGameAttached"));
  expect(native.joinPrivateRoom).toHaveBeenCalledWith("ws://localhost:9374/ws", { deck, displayName: "Guest", gameCode: "GAME12", password: "game-password" });
  expect(native.createPrivateRoom).not.toHaveBeenCalled();
});
it("abandons a partial native game when the room returns to editing", async () => {
  const socket = await attach();
  socket.receive("RoomState", { ...room, phase: "starting" });
  socket.receive("RoomLaunch", { deck, displayName: "Owner", capacity: 2, formatConfig: {} });
  await vi.waitFor(() => expect(socket.sent.at(-1)?.type).toBe("RoomGameAttached"));
  socket.receive("RoomState", room);
  expect(native.abandonOnlineGame).toHaveBeenCalledOnce();
  expect(native.closeOnline).toHaveBeenCalledOnce();
});
it("reconnects the room with a private membership token without resubmitting decks", async () => {
  const old = await attach();
  old.close();
  const promise = reconnectWaitingRoom();
  const socket = Socket.instances.at(-1)!;
  socket.receive("RoomHello", { version: 1 });
  expect(socket.sent[0]).toEqual({ type: "RoomReconnect", data: { memberId: "owner", token: "private-token" } });
  socket.receive("RoomAttached", { memberId: "owner", token: "private-token", code: "ABC123", password: "invite-password" });
  socket.receive("RoomState", room);
  await promise;
  expect(native.createPrivateRoom).not.toHaveBeenCalled();
});
it("rejects unsupported room servers instead of creating a deckless native game", async () => {
  const promise = createWaitingRoom("ws://localhost:9374/room", "Owner", "local-key");
  const expectation = expect(promise).rejects.toThrow("does not support waiting rooms");
  Socket.instances[0]!.receive("ServerHello", { protocol_version: 76 });
  await expectation;
  expect(native.createPrivateRoom).not.toHaveBeenCalled();
});
