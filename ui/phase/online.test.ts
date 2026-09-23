import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./transport", () => ({ acceptSnapshot: vi.fn(), invalidateSnapshotGeneration: vi.fn() }));
vi.mock("@/stores/useGameStore", () => ({ useGameStore: { setState: vi.fn(), getState: () => ({ gameView: { turn: 1 } }) } }));
import { acceptSnapshot } from "./transport";
import { closeOnline, connectOnline, normalizeServer, onlineStatus, respondOnline } from "./online";
import { onlineDraftStatus } from "./onlineDraft";
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
const hello = { mode: "Full", protocol_version: 76, manabrew_version: 2 };
const credentials = { game_code: "ABC123", player_token: "seat-secret", full_key: { game_code: "ABC123", generation: 7 } };
beforeEach(() => {
  vi.clearAllMocks();
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => { closeOnline(); vi.unstubAllGlobals(); });
it("attaches a draft match on its authenticated socket without treating draft tokens as game tokens", () => {
  connectOnline("ws://localhost:9374", { type: "ReconnectDraft", data: { draft_code: "DRAFT1", player_token: "draft-secret" } });
  const socket = Socket.instances[0];
  socket.receive("ServerHello", hello);
  socket.receive("DraftJoined", { draft_code: "DRAFT1", player_token: "draft-secret", seat_index: 0 });
  expect(onlineDraftStatus().code).toBe("DRAFT1");
  socket.receive("DraftMatchStart", { ...credentials, player_token: "draft-secret", your_player: 0 });
  expect(socket.sent.at(-1)).toEqual({ type: "ReconnectDraft", data: { draft_code: "DRAFT1", player_token: "draft-secret" } });
  const sent = socket.sent.length;
  socket.receive("DraftMatchStart", { ...credentials, player_token: "draft-secret", your_player: 0 });
  expect(socket.sent).toHaveLength(sent); // Reattachment repeats the announcement.
  socket.receive("GameStarted", { full_key: credentials.full_key });
  expect(socket.sent.at(-1)?.type).toBe("ManabrewSnapshot");
  expect(sessionStorage.getItem("phase-online:ws://localhost:9374/ws")).toBeNull();
  socket.receive("ManabrewSnapshot", { snapshot: { game_code: "ABC123", state_revision: 1, your_player: 0, update: {}, prompt: null } });
  expect(acceptSnapshot).toHaveBeenCalledWith(expect.objectContaining({ humanPlayerId: "player-0" }));
  expect(onlineStatus().code).toBe("ABC123");
});
it("requires the negotiated projection before creating a game", () => {
  connectOnline("ws://localhost:9374", { type: "CreateGame", data: { deck: {} } });
  const socket = Socket.instances[0];
  socket.receive("ServerHello", { ...hello, manabrew_version: undefined });
  expect(socket.sent).toEqual([]);
  expect(socket.readyState).toBe(3);
});
it("scopes saved credentials to the server and ignores replaced sockets", () => {
  connectOnline("ws://localhost:9374", { type: "CreateGame", data: { deck: {} } });
  const old = Socket.instances[0];
  old.receive("ServerHello", hello);
  old.receive("GameCreated", credentials);
  expect(() => connectOnline("ws://localhost:9999", "reconnect")).toThrow("No saved session");
  connectOnline("ws://localhost:9374", "reconnect");
  const current = Socket.instances[1];
  current.receive("ServerHello", hello);
  expect(current.sent[1]).toEqual({ type: "BootstrapTerminalDelivery", data: { request: { key: credentials.full_key, playerToken: credentials.player_token, requestId: expect.any(String) } } });
  current.receive("TerminalBootstrapResult", { delivery: null });
  expect(current.sent[2]).toEqual({ type: "Reconnect", data: credentials });
  old.receive("GameCreated", { ...credentials, game_code: "WRONG" });
  expect(onlineStatus().code).toBe("ABC123");
  expect(normalizeServer("ws://localhost:9374")).toBe("ws://localhost:9374/ws");
  expect(() => normalizeServer("ws://secret@localhost:9374")).toThrow();
});
it("recovers a retired room's authoritative result without rejoining it", () => {
  connectOnline("ws://localhost:9374", { type: "CreateGame", data: {} });
  Socket.instances[0].receive("ServerHello", hello);
  Socket.instances[0].receive("GameCreated", credentials);
  connectOnline("ws://localhost:9374", "reconnect");
  const socket = Socket.instances[1];
  socket.receive("ServerHello", hello);
  const delivery = { key: credentials.full_key, terminalRevision: 9, deliveryId: "delivery", credential: "result-secret", display: { winner: 1, reason: "Disconnect expired" } };
  socket.receive("TerminalBootstrapResult", { delivery: { ...delivery, key: { ...delivery.key, generation: 6 } } });
  expect(socket.sent).toHaveLength(2);
  socket.receive("TerminalBootstrapResult", { delivery });
  expect(socket.sent.at(-1)?.type).toBe("AckTerminalDelivery");
  expect(socket.sent.some(frame => frame.type === "Reconnect")).toBe(false);
  expect(onlineStatus().message).toBe("Game over — Player 2 won.");
  expect(JSON.parse(sessionStorage.getItem("phase-online:ws://localhost:9374/ws")!).terminal).toEqual(delivery);
});
it("routes responses through the authoritative socket and ignores older revisions", async () => {
  connectOnline("ws://localhost:9374", { type: "CreateGame", data: {} });
  const socket = Socket.instances[0];
  socket.receive("ServerHello", hello);
  socket.receive("GameCreated", credentials);
  const snapshot = { game_code: "ABC123", state_revision: 3, your_player: 1, update: { gameView: {} }, prompt: null };
  socket.receive("ManabrewSnapshot", { snapshot });
  expect(acceptSnapshot).toHaveBeenCalledWith(expect.objectContaining({ humanPlayerId: "player-1" }));
  const pending = respondOnline({ kind: "response", promptId: 14, action: {} });
  let settled = false;
  void pending.then(() => { settled = true; });
  expect(socket.sent.at(-1)?.type).toBe("ManabrewResponse");
  const requestId = (socket.sent.at(-1)?.data as { request_id: number }).request_id;
  socket.receive("ManabrewSnapshot", { snapshot: { ...snapshot, state_revision: 2 } });
  expect(acceptSnapshot).toHaveBeenCalledTimes(1);
  const sent = socket.sent.length;
  socket.receive("StateUpdate", { state: { waiting_for: { type: "GameOver" } } });
  expect(socket.sent).toHaveLength(sent);
  socket.receive("ManabrewSnapshot", { snapshot: { ...snapshot, state_revision: 4, update: { gameView: { gameOver: true } } } });
  await Promise.resolve();
  expect(settled).toBe(false); // A peer's newer update cannot acknowledge our action.
  socket.receive("ActionNoOp", {});
  await Promise.resolve();
  expect(settled).toBe(false); // Uncorrelated native notices are not acceptance.
  socket.receive("ManabrewResponseAccepted", { request_id: requestId + 1, state_revision: 4 });
  await Promise.resolve();
  expect(settled).toBe(false);
  socket.receive("ManabrewResponseAccepted", { request_id: requestId, state_revision: 4 });
  await pending;
  expect(acceptSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({ state: { gameView: { gameOver: true } } }));
});
it("waits for the accepted action's projection when its acknowledgement arrives first", async () => {
  connectOnline("ws://localhost:9374", { type: "CreateGame", data: {} });
  const socket = Socket.instances[0];
  socket.receive("ServerHello", hello);
  socket.receive("GameCreated", credentials);
  const pending = respondOnline({ kind: "directive", directive: { type: "concede" } });
  const requestId = (socket.sent.at(-1)?.data as { request_id: number }).request_id;
  let settled = false;
  void pending.then(() => { settled = true; });
  socket.receive("ManabrewResponseAccepted", { request_id: requestId, state_revision: 4 });
  const snapshot = { game_code: "ABC123", state_revision: 3, your_player: 1, update: {}, prompt: null };
  socket.receive("ManabrewSnapshot", { snapshot });
  await Promise.resolve();
  expect(settled).toBe(false);
  socket.receive("ManabrewSnapshot", { snapshot: { ...snapshot, state_revision: 4 } });
  await pending;
});
