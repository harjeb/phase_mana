import { beforeEach, expect, it, vi } from "vitest";
import type { GameLogEntry } from "@/types/gameLog";

const store = vi.hoisted(() => {
  vi.stubGlobal("window", {});
  let state: { gameLog: GameLogEntry[] } = { gameLog: [] };
  return {
    getState: () => state,
    setState: (patch: Partial<typeof state>) => { state = { ...state, ...patch }; },
  };
});
vi.mock("@/stores/useGameStore", () => ({ useGameStore: store }));
vi.mock("@/stores/gameStore.constants", () => ({ applyState: vi.fn(), applyPrompt: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { acceptSnapshot } from "./transport";

const row = (seq: number) => ({
  seq, turn: 2, phase: "PreCombatMain", message: `Action ${seq}`,
  entryType: "action", timestampMs: 1700000000000 + seq,
});
const snapshot = (gameLog?: unknown[], logSessionId = "session-1") => ({
  state: {} as Parameters<typeof acceptSnapshot>[0]["state"],
  prompt: null, humanPlayerId: "player-0", aiActions: 0, gameLog, logSessionId,
});
beforeEach(() => store.setState({ gameLog: [] }));

it("installs real host history in the same store consumed by the log panel", () => {
  acceptSnapshot(snapshot([row(1)]));
  expect(store.getState().gameLog).toEqual([expect.objectContaining(row(1))]);
});
it("repeated state reads and overlapping snapshots do not duplicate entries", () => {
  acceptSnapshot(snapshot([row(1)]));
  acceptSnapshot(snapshot([row(1)]));
  acceptSnapshot(snapshot([row(1), row(2)]));
  expect(store.getState().gameLog.map(entry => entry.seq)).toEqual([1, 2]);
});
it("retains only the last 200 rows, in engine order", () => {
  acceptSnapshot(snapshot(Array.from({ length: 250 }, (_, i) => row(i + 1))));
  expect(store.getState().gameLog).toHaveLength(200);
  expect(store.getState().gameLog[0].seq).toBe(51);
  expect(store.getState().gameLog.at(-1)?.seq).toBe(250);
});
it("replaces history on a new game instead of mixing sessions", () => {
  acceptSnapshot(snapshot([row(100)]));
  acceptSnapshot(snapshot([row(1)], "session-2"));
  expect(store.getState().gameLog.map(entry => entry.seq)).toEqual([1]);
});
it("clears prior history for empty histories and legacy/online hosts", () => {
  acceptSnapshot(snapshot([row(1)]));
  acceptSnapshot(snapshot([]));
  expect(store.getState().gameLog).toEqual([]);
  acceptSnapshot(snapshot([row(2)]));
  acceptSnapshot(snapshot());
  expect(store.getState().gameLog).toEqual([]);
});
