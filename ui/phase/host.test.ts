import { afterEach, expect, it, vi } from "vitest";
import { encodeInvite } from "./invite";
import { hostedRoom, hostRequest, saveHostedRoom, stopHostedRoom } from "./host";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
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
  expect(request).toHaveBeenLastCalledWith("/api/host/stop", expect.objectContaining({ method: "POST", headers: { "X-Phase-Host": "1" }, signal: expect.any(AbortSignal) }));
});


it("explains an unavailable host service instead of exposing a fetch failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await expect(hostRequest("start")).rejects.toThrow("Could not reach the local hosting service");
});

it("explains HTML responses from a missing API proxy", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } }));
  await expect(hostRequest("start")).rejects.toThrow("local hosting service returned an invalid response");
});

it("aborts a stalled start request so the UI can leave its busy state", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  })));
  const result = expect(hostRequest("start")).rejects.toThrow("hosting request timed out");
  await vi.advanceTimersByTimeAsync(120000);
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
