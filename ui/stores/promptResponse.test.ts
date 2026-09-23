import { describe, expect, it } from "vitest";
import { promptResponse } from "./promptResponse";

describe("promptResponse", () => {
  const sideboard = { type: "submitSideboard" as const, main: [{ name: "Forest", count: 60 }], sideboard: [{ name: "Island", count: 1 }] };
  it("wraps counted sideboard submissions without changing the authoritative partition", () => {
    expect(promptResponse("sideboard", sideboard)).toEqual({ type: "sideboard", output: sideboard });
  });
  it("rejects a stale sideboard response after the prompt changes", () => {
    expect(promptResponse("chooseBoolean", sideboard)).toBeNull();
    expect(promptResponse("sideboard", { type: "decision", value: true })).toBeNull();
  });
  it("preserves AutoPass as its own extension family", () => {
    const output = { type: "autoPass" as const, mode: "turnBoundary" as const };
    expect(promptResponse("chooseAction", output)).toEqual({ type: "autoPass", output });
    expect(promptResponse("sideboard", output)).toBeNull();
    expect(promptResponse("chooseBoolean", output)).toBeNull();
  });
  it("retains play/draw boolean output for the existing boolean dialog", () => {
    const output = { type: "decision" as const, value: false };
    expect(promptResponse("chooseBoolean", output)).toEqual({ type: "chooseBoolean", output });
  });
});
