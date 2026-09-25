import { expect, it } from "vitest";
import { decodeInvite, encodeInvite, inviteEndpoint, MAX_INVITE_LENGTH, randomPassword } from "./invite";

const invite = { endpoint: "wss://1a2b-3c4d-5e6f-7a8b.ngrok-free.app/ws", gameCode: "ABC123", password: "CzBVep_E6Q4zWH2ix-wRNg" };

it("round-trips every address shape the design names", () => {
  for (const endpoint of [
    "ws://192.168.1.23:9374/ws",
    "wss://1a2b-3c4d-5e6f-7a8b.ngrok-free.app/ws",
    "wss://phase-room-a1b2c3d4e5f6.us-east-1.elb.amazonaws.com/ws",
    "ws://[2001:db8:85a3::8a2e:370:7334]:9374/ws",
  ]) {
    expect(decodeInvite(encodeInvite({ ...invite, endpoint }))).toEqual({ v: 1, endpoint, gameCode: "ABC123", password: invite.password });
  }
});

it("canonicalizes a bare host so the guest dials the same route the host does", () => {
  const code = encodeInvite({ ...invite, endpoint: "ws://192.168.1.23:9374" });
  expect(decodeInvite(code).endpoint).toBe("ws://192.168.1.23:9374/ws");
});

it("keeps base64url, the URL path, and the password case-sensitive", () => {
  const upper = encodeInvite({ ...invite, password: "AAAABBBB" });
  expect(decodeInvite(upper).password).toBe("AAAABBBB");
  expect(() => decodeInvite(upper.toLowerCase())).toThrow();
});

it("stays a paste-sized string", () => {
  const length = encodeInvite(invite).length;
  expect(length).toBeGreaterThan(100);
  expect(length).toBeLessThan(300);
});

it("describes the reach of the address it shares", () => {
  expect(inviteEndpoint("https://x.ngrok-free.app", "ws://127.0.0.1:9374/ws")).toEqual({ endpoint: "wss://x.ngrok-free.app/ws", scope: "advertised" });
  expect(inviteEndpoint(null, "ws://192.168.1.23:9374/ws")).toEqual({ endpoint: "ws://192.168.1.23:9374/ws", scope: "lan" });
});

it("rejects every malformed input with its own diagnosis", () => {
  const good = encodeInvite(invite);
  const damaged = (patch: Record<string, unknown>) =>
    "PMH1-" + Buffer.from(JSON.stringify({ v: 1, endpoint: invite.endpoint, gameCode: invite.gameCode, password: invite.password, ...patch }))
      .toString("base64url");
  expect(() => decodeInvite("")).toThrow(/Paste an invitation/);
  expect(() => decodeInvite("hello")).toThrow(/not an invitation code/);
  expect(() => decodeInvite("PMH1-" + "A".repeat(MAX_INVITE_LENGTH + 1))).toThrow(/too long/);
  expect(() => decodeInvite(good.slice(0, -1) + "!")).toThrow(/base64url/);
  expect(() => decodeInvite(damaged({ v: 2 }))).toThrow(/newer version/);
  expect(() => decodeInvite(damaged({ endpoint: "https://a.example/ws" }))).toThrow(/ws:\/\/ or wss:\/\//);
  expect(() => decodeInvite(damaged({ endpoint: "wss://a.example/ws?x=1" }))).toThrow(/without credentials/);
  expect(() => decodeInvite(damaged({ endpoint: "wss://user:pass@a.example/ws" }))).toThrow(/without credentials/);
  expect(() => decodeInvite(damaged({ gameCode: "ABC" }))).toThrow(/room code/);
  expect(() => decodeInvite(damaged({ gameCode: "abc123" }))).toThrow(/room code/);
  expect(() => decodeInvite(damaged({ password: "" }))).toThrow(/room password/);
  expect(() => decodeInvite(damaged({ password: "p".repeat(129) }))).toThrow(/too long/);
  expect(() => decodeInvite(damaged({ password: null }))).toThrow(/room password/);
});

it("never carries a seat credential, only the join password", () => {
  const decoded = Object.keys(decodeInvite(encodeInvite(invite)));
  expect(decoded.sort()).toEqual(["endpoint", "gameCode", "password", "v"]);
});

it("generates a 22-character password from 16 random bytes", () => {
  const password = randomPassword();
  expect(password).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(new Set(Array.from({ length: 32 }, randomPassword)).size).toBe(32);
});
