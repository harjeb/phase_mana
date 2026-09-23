import { afterEach, expect, it, vi } from "vitest";
import { prepareConspiracyChoices } from "./conspiracies";

afterEach(() => vi.unstubAllGlobals());
it("keeps interleaved physical copies and seat choices separate", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [1, 0, 1, 1] });
  const prompt = vi.fn().mockReturnValueOnce(" Plains ").mockReturnValueOnce("Island");
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("window", { prompt });
  expect(await prepareConspiracyChoices([
    { conspiracies: ["Agenda", "Power Play", "Agenda"], deck: ["Forest"] },
    { conspiracies: ["Agenda"], deck: ["Mountain"] },
  ])).toEqual([
    { player: 0, index: 0, choices: [{ type: "CardName", value: "Plains" }] },
    { player: 0, index: 2, choices: [{ type: "CardName", value: "Island" }] },
    { player: 1, index: 0, choices: [{ type: "CardName", value: "Mountain" }] },
  ]);
  expect(prompt).toHaveBeenCalledTimes(2);
});
it("cancelling a secret choice prevents startup", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [1] }));
  vi.stubGlobal("window", { prompt: () => null });
  await expect(prepareConspiracyChoices([{ conspiracies: ["Agenda"], deck: ["Plains"] }])).rejects.toThrow("not started");
});
