import { beforeEach, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ currentPrompt: null as unknown }));
vi.mock("@/stores/useGameStore", () => ({ useGameStore: { getState: () => state } }));
import { getGameApi } from "@/platform";

beforeEach(() => {
  state.currentPrompt = null;
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
});
afterEach(() => vi.unstubAllGlobals());

it("returns no prompt before startup completes without querying a nonexistent session", async () => {
  await expect(getGameApi().getPrompt()).resolves.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("returns the prompt installed by the start/respond snapshot, without another state read", async () => {
  const opening = { id: 1, input: { type: "mulligan" } };
  state.currentPrompt = opening;
  await expect(getGameApi().getPrompt()).resolves.toBe(opening);
  const next = { id: 2, input: { type: "chooseAction", actions: [] } };
  state.currentPrompt = next;
  await expect(getGameApi().getPrompt()).resolves.toBe(next);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not fetch a previous backend session after leaving or starting another game", async () => {
  state.currentPrompt = { id: 1 };
  await getGameApi().getPrompt();
  state.currentPrompt = null;
  await expect(getGameApi().getPrompt()).resolves.toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
