import { expect, it, vi } from "vitest";

vi.mock("@/game", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/game")>();
  return { ...original, getSelectedGameRuntime: () => ({
    capabilities: { concedeBehavior: "send-action" },
    api: { sendDirective: async () => {
      const { useGameStore } = await import("./useGameStore");
      useGameStore.setState({ currentPrompt: nextPrompt, isWaitingForResponse: false });
    } },
  }) };
});
import { useGameStore } from "./useGameStore";
import type { Prompt } from "@/protocol";
const nextPrompt = { promptId: 17, input: { type: "sideboard" } } as Prompt;

it("does not overwrite an authoritative between-game prompt after concession", async () => {
  useGameStore.setState({ myPlayerSlot: "player-0", selfConceded: false, currentPrompt: null });
  await useGameStore.getState().concede();
  expect(useGameStore.getState().currentPrompt).toBe(nextPrompt);
  expect(useGameStore.getState().selfConceded).toBe(false);
});
