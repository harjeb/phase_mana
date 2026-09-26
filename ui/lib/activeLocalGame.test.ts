import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  armActiveLocalGame,
  clearActiveLocalGame,
  isActiveLocalGame,
} from "./activeLocalGame";

// The marker lives in `window.sessionStorage`; jsdom is not a dependency here,
// so stand in just enough of the Web Storage API.
function fakeSessionStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { sessionStorage: fakeSessionStorage() };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("active local game marker", () => {
  it("is absent until a game is armed and gone once cleared", () => {
    expect(isActiveLocalGame()).toBe(false);
    armActiveLocalGame();
    expect(isActiveLocalGame()).toBe(true);
    clearActiveLocalGame();
    expect(isActiveLocalGame()).toBe(false);
  });

  it("stores under the key the boot hook reads", () => {
    armActiveLocalGame();
    // A rename on either side would silently disable refresh restore.
    expect(
      (window.sessionStorage as { getItem: (k: string) => string | null }).getItem(
        "manabrew.activeLocalGame",
      ),
    ).toBe("1");
  });
});
