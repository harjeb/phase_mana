import { describe, expect, it } from "vitest";

import { DEFAULT_LLM_SEAT, isLlmSeatUsable, llmSeatRequest } from "./llmSeat";

function prefs(overrides: Partial<typeof DEFAULT_LLM_SEAT> = {}) {
  return { ...DEFAULT_LLM_SEAT, enabled: true, baseUrl: "http://localhost:11434/v1", model: "llama3", ...overrides };
}

describe("llmSeatRequest", () => {
  it("sends nothing while LLM mode is off", () => {
    expect(llmSeatRequest(prefs({ enabled: false }))).toBeUndefined();
    expect(isLlmSeatUsable(prefs({ enabled: false }))).toBe(false);
  });

  it("sends nothing when the endpoint or model is missing", () => {
    expect(llmSeatRequest(prefs({ baseUrl: "  " }))).toBeUndefined();
    expect(llmSeatRequest(prefs({ model: "" }))).toBeUndefined();
  });

  it("trims and parses a complete config", () => {
    const request = llmSeatRequest(
      prefs({ baseUrl: " http://localhost:11434/v1 ", apiKey: " secret ", temperature: "0.4" }),
    );
    expect(request).toEqual({
      enabled: true,
      baseUrl: "http://localhost:11434/v1",
      apiKey: "secret",
      model: "llama3",
      temperature: 0.4,
    });
  });

  it("omits an unparsable temperature instead of sending NaN", () => {
    const request = llmSeatRequest(prefs({ temperature: "" }));
    expect(request).toBeDefined();
    expect(request).not.toHaveProperty("temperature");
  });
});
