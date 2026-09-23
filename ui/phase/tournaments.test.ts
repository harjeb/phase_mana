import { afterEach, expect, it, vi } from "vitest";
import { TournamentClient } from "./tournaments";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: { type: string; data: Record<string, unknown> }[] = [];
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  constructor(public url: string) { Socket.instances.push(this); }
  send(text: string) { this.sent.push(JSON.parse(text)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(type: string, data: unknown) { this.onmessage?.({ data: JSON.stringify({ type, data }) }); }
}
afterEach(() => { vi.unstubAllGlobals(); });
it("keeps roles separate, correlates acknowledgements and recovers a lost renewal reply", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  const client = new TournamentClient();
  const hello = { protocol_version: 76, lobby_protocol_version: 9 };
  const view = { summary: { code: "ABC123" }, players: [], pairings: [], standings: [] };
  try {
    client.connect("ws://localhost:9374");
    const socket = Socket.instances.at(-1)!;
    socket.receive("ServerHello", hello);
    const created = client.create({ name: "Event", arity: 2, bracket: "Swiss", total_rounds: 1, match_type: "Bo3" });
    socket.receive("TournamentCreated", { code: "ABC123", organizer_token: "organizer", expires_at_ms: Date.now() + 3600000, view });
    await created;
    const joined = client.join("ABC123", "Player");
    socket.receive("TournamentJoined", { code: "ABC123", player_token: "player", expires_at_ms: Date.now() + 3600000, view });
    await joined;
    const started = client.action("StartTournamentRound", "ABC123");
    const request = socket.sent.at(-1)!.data;
    expect(request.organizer_token).toBe("organizer");
    expect(request.player_token).toBeUndefined();
    socket.receive("TournamentActionAck", { code: "ABC123", request_id: Number(request.request_id) + 1, view });
    expect(client.getSnapshot().busy).toBe(true);
    socket.receive("TournamentActionAck", { code: "ABC123", request_id: request.request_id, view });
    await started;
    const lostRenewal = client.renew("ABC123", "Player");
    const original = socket.sent.at(-1)!.data;
    const lost = expect(lostRenewal).rejects.toThrow("Connection closed");
    client.disconnect();
    await lost;
    client.connect("ws://localhost:9374");
    const replacement = Socket.instances.at(-1)!;
    replacement.receive("ServerHello", hello);
    replacement.receive("TournamentUpdate", { code: "ABC123", view });
    await Promise.resolve();
    const recovered = client.renew("ABC123", "Player");
    expect(replacement.sent.at(-1)!.data).toEqual(original);
    replacement.receive("TournamentCredentialRenewed", { code: "ABC123", role: "Player", token: "rotated", expires_at_ms: Date.now() + 3600000 });
    await recovered;
    expect(client.getSnapshot().credentials.ABC123.Player?.token).toBe("rotated");
    expect(client.getSnapshot().credentials.ABC123.Organizer?.token).toBe("organizer");
    client.connect("ws://localhost:9999");
    expect(client.getSnapshot().credentials).toEqual({});
    socket.receive("TournamentCreated", { code: "WRONG", organizer_token: "leak", view });
    expect(client.getSnapshot().credentials).toEqual({});
  } finally { client.disconnect(); }
});
