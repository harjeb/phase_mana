import { describe, expect, it } from "vitest";
import { getKeywordHelp } from "@/i18n/keywordHelp";
import { KEYWORD_HELP_SOURCES } from "./keywordHelpSources";
import { i18n } from "@/i18n/i18n";
import { MTGCH_KEYWORD_HELP } from "./keywordHelpMtgch";

const COMMON = [
  "Flying", "First strike", "Double strike", "Trample", "Deathtouch", "Lifelink",
  "Vigilance", "Haste", "Reach", "Defender", "Menace", "Indestructible", "Hexproof",
  "Shroud", "Flash",
];

describe("getKeywordHelp", () => {
  it("covers common battlefield keywords with sourced Chinese reminders", () => {
    for (const locale of ["zh-Hans", "zh-Hant"] as const) {
      const help = getKeywordHelp(COMMON, locale);
      expect(help).toHaveLength(COMMON.length);
      for (const entry of help) {
        expect(entry.description).toMatch(/[\u3400-\u9fff]/);
        expect(entry.description).toBe(KEYWORD_HELP_SOURCES[entry.key]?.[locale]?.text);
      }
    }
    expect(getKeywordHelp(["Flying"], "zh-Hans")[0]?.name).toBe("飞行");
    expect(getKeywordHelp(["Flying"], "zh-Hant")[0]?.name).toBe("飛行");
  });

  it("retains provenance and uses quotations verbatim for every available entry", () => {
    for (const [key, locales] of Object.entries(KEYWORD_HELP_SOURCES)) {
      for (const [locale, quote] of Object.entries(locales)) {
        expect(quote.source.url).toMatch(/^https:\/\/(scryfall\.com|gatherer\.wizards\.com)\//);
        expect(quote.source.set).not.toBe("");
        expect(quote.source.collectorNumber).not.toBe("");
        expect(getKeywordHelp([quote.parameter ? `${key} ${quote.parameter}` : key], locale)[0]?.description).toBe(quote.text);
      }
    }
  });

  it("uses sourced English explanations for other locales", () => {
    expect(getKeywordHelp(COMMON, "fr")).toEqual(getKeywordHelp(COMMON, "en"));
    expect(getKeywordHelp(["Flying"], "en")[0]?.description).toBe(KEYWORD_HELP_SOURCES.flying?.en?.text);
  });

  it("shows Consult the Star Charts' real engine kicker cost using the official quote", () => {
    expect(getKeywordHelp(["Kicker(Cost { shards: [Blue], generic: 1 })"], "zh-Hans")).toEqual([
      { key: "kicker {1}{u}", name: "增幅 {1}{U}", description: "你施放此咒语时可以额外支付{1}{U}。" },
    ]);
    expect(getKeywordHelp(["Kicker(Cost { shards: [Red], generic: 3 })"], "zh-Hans")[0]?.description)
      .toBe("你施放此咒语时可以额外支付{3}{R}。");
    expect(getKeywordHelp(["Kicker(Cost { shards: [Blue], generic: 1 })", "Kicker {1}{U}"], "en")).toHaveLength(1);
    expect(getKeywordHelp(["Kicker", "Kicker—Sacrifice a creature", "Kicker(Cost { shards: [Unknown], generic: 1 })"], "zh-Hans")).toEqual([]);
  });

  it("shows both Quantum Riddler abilities from the live DTO, without confusing warp with kicker", () => {
    const help = getKeywordHelp(["Flying", "Warp(Cost { shards: [Blue], generic: 1 })"], "zh-Hans");
    expect(help.map(entry => entry.name)).toEqual(["飞行", "跃迁 {1}{U}"]);
    expect(help[1]?.description).toBe(MTGCH_KEYWORD_HELP.warp?.["zh-Hans"]?.text);
    expect(help[1]?.description).toContain("在下一个结束步骤开始时放逐此生物");
    expect(getKeywordHelp(["Warp {1}{U}", "Warp(Cost { shards: [Blue], generic: 1 })"], "en")).toHaveLength(1);
    expect(getKeywordHelp(["Warp(Cost { shards: [Unknown], generic: 1 })"], "zh-Hans")).toEqual([]);
  });

  it("defaults to the active i18n locale", () => {
    const previous = i18n.locale;
    try {
      i18n.loadAndActivate({ locale: "zh-Hant", messages: {} });
      expect(getKeywordHelp(["Flying"])).toEqual(getKeywordHelp(["Flying"], "zh-Hant"));
    } finally {
      i18n.activate(previous);
    }
  });

  it("deduplicates casing, whitespace and battlecry aliases without mutating input", () => {
    const input = Object.freeze([" FLYING ", "flying", "First   strike", "FIRST STRIKE",
      "Battlecry", "Battle cry"]);
    expect(getKeywordHelp(input, "en").map((entry) => entry.key)).toEqual([
      "flying", "first strike", "battle cry",
    ]);
  });

  it("does not invent a translation or borrow a reminder for a different variant", () => {
    expect(getKeywordHelp([
      "", " ", "Unknown", "etb counter", "CARDNAME", "__Flying", "toString",
      "Trample over planeswalkers", "Flying high", "Flying:2", "First striker",
      "Hexproof from black", "Wardrobe", "Ward:AB$ Pump", "Equip:Creature.YouCtrl",
      "Protection:Card.nonToken", "Protection from robots", "Crew:3:extra",
      "Toxic two", "Annihilator(2) extra", "Flashback", "Menace (special)",
      "Ward:{2}", "Ward:Pay 3 life", "Crew(3)", "Protection from red",
    ], "zh-Hans")).toEqual([]);
    expect(getKeywordHelp([], "en")).toEqual([]);
    for (const [key, locales] of Object.entries(KEYWORD_HELP_SOURCES)) {
      for (const locale of ["zh-Hans", "zh-Hant"] as const) {
        if (!locales[locale]) expect(getKeywordHelp([key], locale)).toEqual([]);
      }
    }
  });
});
