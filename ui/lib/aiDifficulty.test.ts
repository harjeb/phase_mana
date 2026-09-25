import { describe, expect, it } from "vitest";
import { AI_DIFFICULTIES, DEFAULT_AI_DIFFICULTY } from "./aiDifficulty";

describe("AI difficulty labels", () => {
  it("matches the labels the Phase host parses", () => {
    // Mirrors `AiDifficulty::from_label` in
    // phase/crates/phase-ai/src/config.rs. The host silently falls back to
    // Medium on an unknown label, so a typo here would not error — it would
    // just quietly downgrade the game.
    expect(AI_DIFFICULTIES.map((level) => level.value)).toEqual([
      "VeryEasy",
      "Easy",
      "Medium",
      "Hard",
      "VeryHard",
      "CEDH",
    ]);
  });

  it("defaults to the host default", () => {
    expect(DEFAULT_AI_DIFFICULTY).toBe("Medium");
    expect(AI_DIFFICULTIES.some((level) => level.value === DEFAULT_AI_DIFFICULTY)).toBe(true);
  });
});
