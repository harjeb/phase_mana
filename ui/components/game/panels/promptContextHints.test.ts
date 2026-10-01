import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18n";
import { messages as hans } from "@/i18n/locales/zh-Hans/messages.po";
import { ATTACK_DRAG_HINT, getPromptContextLines } from "./promptContextHints";

const previousLocale = i18n.locale;
afterEach(() => i18n.activate(previousLocale));

function useEnglish() {
  i18n.loadAndActivate({ locale: "en-context-test", messages: {} });
}

describe("prompt context hints", () => {
  it("uses the shipped Chinese catalog for hints and mana symbols", () => {
    i18n.loadAndActivate({ locale: "zh-Hans", messages: hans });
    expect(getPromptContextLines("chooseAction", {})).toEqual(["点击“让过”以让过优先权。"]);
    expect(getPromptContextLines("mulliganPutBack", {
      mulliganSelectedCount: 1, mulliganPutBackCount: 2,
    })).toEqual(["置于牌库底：1/2"]);
    expect(getPromptContextLines("payManaCost", { payManaCostInfo: {
      cardName: "Dig Through Time", manaCost: "{6}{U}{U}", delveCount: 6, lifeToPay: 2,
    } })).toEqual([
      "支付 {6}{U}{U} 施放 Dig Through Time", "已通过掘穴支付 {6}", "点击“2 生命”以支付生命",
    ]);
  });
  it("resolves the shared attack descriptor at call time", () => {
    useEnglish();
    const english = getPromptContextLines("chooseAttackers", {});
    expect(english).toEqual([
      "Drag a creature onto a target — or tap the creature, then its target — to attack.",
    ]);
    i18n.loadAndActivate({
      locale: "zh-context-test",
      messages: { [ATTACK_DRAG_HINT.id]: "将生物拖到目标上以攻击。" },
    });
    expect(getPromptContextLines("chooseAttackers", { mustAttackHint: "Required" }))
      .toEqual(["Required", "将生物拖到目标上以攻击。"]);
    useEnglish();
    expect(getPromptContextLines("chooseAttackers", {})).toEqual(english);
  });

  it("interpolates mulligan counts and preserves default counts", () => {
    useEnglish();
    expect(getPromptContextLines("mulligan", {})).toEqual([
      "Keep this hand, or mulligan to draw a new one.",
    ]);
    expect(getPromptContextLines("mulligan", { mulliganCount: 2 })).toEqual([
      "Mulligan 2 — keeping puts 2 back.",
    ]);
    expect(getPromptContextLines("mulliganPutBack", {})).toEqual(["0/0 to library bottom"]);
    expect(getPromptContextLines("mulliganPutBack", {
      mulliganSelectedCount: 1, mulliganPutBackCount: 2,
    })).toEqual(["1/2 to library bottom"]);
  });

  it("keeps engine descriptions and restrictions unchanged", () => {
    useEnglish();
    expect(getPromptContextLines("chooseAction", {})).toEqual(["Tap PASS to pass priority."]);
    expect(getPromptContextLines("chooseBlockers", { blockRestrictionHint: "Restriction" }))
      .toEqual(["Restriction", "Tap an attacker, then your blocker, to assign a block."]);
    expect(getPromptContextLines("payManaCost", { payManaCostInfo: {
      cardName: "Dig Through Time", manaCost: "{6}{U}{U}", delveCount: 6, lifeToPay: 2,
    } })).toEqual([
      "Cast Dig Through Time for {6}{U}{U}", "Delved for {6}", "Tap 2 Life to pay with life",
    ]);
    expect(getPromptContextLines("payManaCost", { payManaCostInfo: {
      cardName: "Card", manaCost: "{1}", description: "Engine description", delveCount: 0, lifeToPay: 0,
    } })).toEqual(["Engine description"]);
    expect(getPromptContextLines("payManaCost", {})).toEqual([]);
    expect(getPromptContextLines(undefined, {})).toEqual([]);
  });
});
