import { describe, expect, it } from "vitest";
import { filterPresetDecksForFormat } from "./presetDecks";

describe("preset deck format filtering", () => {
  const decks = [
    { id: "standard", format: "standard" },
    { id: "commander", format: "commander" },
    { id: "legacy", format: "legacy" },
    { id: "older-untagged" },
  ];

  it.each(["tiny_leaders", "duel_commander", "pauper_commander", "oathbreaker", "old_school_93_94", "old_school_95", "premodern"])(
    "does not offer every deck when %s has no presets",
    (format) => expect(filterPresetDecksForFormat(decks, format)).toEqual([]),
  );

  it("keeps Commander variants separate even when a variant has matching decks", () => {
    const tiny = { id: "tiny", format: "tiny_leaders" };
    const duel = { id: "duel", format: "duel_commander" };
    const pool = [...decks, tiny, duel];
    expect(filterPresetDecksForFormat(pool, "tiny_leaders")).toEqual([tiny]);
    expect(filterPresetDecksForFormat(pool, "duel_commander")).toEqual([duel]);
    expect(filterPresetDecksForFormat(pool, "commander")).toEqual([decks[1]]);
    expect(pool).toHaveLength(6);
  });

  it("retains the standard default for older presets and explicit all/custom choices", () => {
    expect(filterPresetDecksForFormat(decks, "standard")).toEqual([decks[0], decks[3]]);
    expect(filterPresetDecksForFormat(decks, null)).toEqual(decks);
    expect(filterPresetDecksForFormat(decks, "custom:test", true)).toEqual(decks);
  });

  it.each(["archenemy", "planechase", "two_headed_giant"])(
    "only offers matching %s presets and leaves an unmatched format empty",
    (format) => {
      expect(filterPresetDecksForFormat(decks, format)).toEqual([]);
      const dedicated = { id: "dedicated", format };
      const otherVariants = ["archenemy", "planechase", "two_headed_giant"]
        .filter((variant) => variant !== format)
        .map((variant) => ({ id: variant, format: variant }));
      expect(filterPresetDecksForFormat([...decks, ...otherVariants, dedicated], format)).toEqual([dedicated]);
    },
  );
});
