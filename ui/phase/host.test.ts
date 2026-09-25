import { afterEach, expect, it, vi } from "vitest";
import { encodeInvite } from "./invite";
import { hostedRoom, saveHostedRoom, stopHostedRoom } from "./host";

afterEach(() => vi.unstubAllGlobals());
it("keeps the invitation when stop fails, and clears it only after successful teardown", async () => {
  const values = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  const room = { endpoint: "ws://127.0.0.1:1234/ws", code: encodeInvite({ endpoint: "ws://192.168.1.2:1234/ws", gameCode: "ABC123", password: "secret" }) };
  saveHostedRoom(room);
  expect(hostedRoom()).toEqual(room);
  const request = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Unable to stop" }) });
  vi.stubGlobal("fetch", request);
  await expect(stopHostedRoom()).rejects.toThrow("Unable to stop");
  expect(hostedRoom()).toEqual(room);
  request.mockResolvedValue({ ok: true, json: async () => ({ running: false }) });
  await stopHostedRoom();
  expect(hostedRoom()).toBeNull();
  expect(request).toHaveBeenLastCalledWith("/api/host/stop", { method: "POST", headers: { "X-Phase-Host": "1" } });
});
