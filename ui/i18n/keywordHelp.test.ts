import { describe, expect, it } from "vitest";
import { getKeywordHelp } from "@/i18n/keywordHelp";
import { KEYWORD_HELP_SOURCES } from "./keywordHelpSources";
import { i18n } from "@/i18n/i18n";
import { MTGCH_KEYWORD_HELP } from "./keywordHelpMtgch";
import { KEYWORD_RULE_HELP } from "./keywordHelpRules";
import { readFileSync } from "node:fs";

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
    const generic = getKeywordHelp(["Kicker", "Kicker—Sacrifice a creature", "Kicker(Cost { shards: [Unknown], generic: 1 })"], "zh-Hans");
    expect(generic).toHaveLength(2);
    for (const entry of generic) expect(entry.description).toBe(KEYWORD_RULE_HELP.kicker!.zh);
  });

  it("shows both Quantum Riddler abilities from the live DTO, without confusing warp with kicker", () => {
    const help = getKeywordHelp(["Flying", "Warp(Cost { shards: [Blue], generic: 1 })"], "zh-Hans");
    expect(help.map(entry => entry.name)).toEqual(["飞行", "跃迁 {1}{U}"]);
    expect(help[1]?.description).toBe(MTGCH_KEYWORD_HELP.warp?.["zh-Hans"]?.text);
    expect(help[1]?.description).toContain("在下一个结束步骤开始时放逐此生物");
    expect(getKeywordHelp(["Warp {1}{U}", "Warp(Cost { shards: [Blue], generic: 1 })"], "en")).toHaveLength(1);
    expect(getKeywordHelp(["Warp(Cost { shards: [Unknown], generic: 1 })"], "zh-Hans")[0]?.name).toBe("跃迁");
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
      "Flying high", "Flying:2", "First striker",
      "Wardrobe", "Ward:AB$ Pump", "Equip:Creature.YouCtrl",
      "Protection:Card.nonToken", "Crew:3:extra",
      "Toxic two", "Annihilator(2) extra", "Menace (special)",
    ], "zh-Hans")).toEqual([]);
    expect(getKeywordHelp([], "en")).toEqual([]);
  });

  it("explains the previously missing parameterized engine keywords without leaking Debug data", () => {
    const help = getKeywordHelp([
      "Harmonize(Cost { shards: [X, Green, Green, Green, Green], generic: 0 })",
      "Mobilize(Fixed { value: 2 })", "Ward:{2}", "Equip {2}", "Crew(3)",
      "Cycling {2}", "Flashback {2}{U}", "Protection from red", "Toxic(2)",
    ], "zh-Hans");
    expect(help).toHaveLength(9);
    expect(help[0]?.name).toBe("谐颂 {X}{G}{G}{G}{G}");
    expect(help[0]?.description).toBe(MTGCH_KEYWORD_HELP.harmonize?.["zh-Hans"]?.text);
    expect(help[0]?.description).toContain("然后放逐此咒语");
    expect(help[1]?.name).toBe("动员 2");
    expect(help[8]?.description).toContain("中毒指示物");
    for (const entry of help) {
      expect(entry.description).toMatch(/[\u3400-\u9fff]/);
      expect(entry.name).not.toMatch(/Cost|shards|generic|Fixed|value:/);
    }
  });

  it("does not describe conditional hexproof as unconditional hexproof", () => {
    for (const label of ["Hexproof from black", "HexproofFrom(Color(Black))"]) {
      expect(getKeywordHelp([label], "zh-Hans")[0]?.description).toBe(KEYWORD_RULE_HELP["hexproof from"]!.zh);
    }
    expect(getKeywordHelp(["Trample over planeswalkers"], "zh-Hans")[0]?.description).toContain("该鹏洛客的操控者");
  });

  it("covers every public keyword in the existing localized name catalog", () => {
    const table = readFileSync("ui/i18n/cardKeywords.ts", "utf8");
    const keys = [...table.matchAll(/^  ("[^"]+"|[\w]+): \{ hans:/gm)].map(match => match[1]!.replaceAll('"', ''));
    // Totem is an unused engine placeholder; it is distinct from Totem Armor.
    const internal = new Set(["etb counter", "etbcounter", "totem"]);
    const missing = keys.filter(key => !internal.has(key) && !getKeywordHelp([key], "zh-Hans").length);
    expect(missing).toEqual([]);
  });

  it("covers the normalizer's public engine identities", () => {
    const text = readFileSync("ui/i18n/keywordCost.ts", "utf8").split("const specialNames")[0]!;
    const variants = [...text.matchAll(/:\s*`([^`]+)`/g)].flatMap(match => match[1]!.trim().split(/\s+/));
    // MTGCH only provides Specialize's Chinese name; an authoritative Chinese
    // definition could not be verified. Keep this explicit instead of inventing it.
    const unverified = new Set(["Specialize"]);
    const missing = variants.filter(key => key !== "Totem" && !unverified.has(key) && !getKeywordHelp([key], "zh-Hans").length);
    expect(missing).toEqual([]);
    expect(getKeywordHelp(["Specialize {3}"], "zh-Hans")).toEqual([]);
  });
});
