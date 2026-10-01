import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18n";
import { messages as en } from "@/i18n/locales/en/messages.po";
import { messages as hans } from "@/i18n/locales/zh-Hans/messages.po";
import { messages as hant } from "@/i18n/locales/zh-Hant/messages.po";
import { promptChoiceLabel } from "@/i18n/promptChoiceLabel";

function activateLocale(locale: "en" | "zh-Hans" | "zh-Hant"): void {
  i18n.loadAndActivate({ locale, messages: { en, "zh-Hans": hans, "zh-Hant": hant }[locale] });
}

const previousLocale = i18n.locale;
afterEach(() => i18n.activate(previousLocale));

describe("promptChoiceLabel", () => {
  it.each([
    ["zh-Hans", ["确认支付", "不支付", "是", "否", "确认支付", "确认", "拒绝"], "确认支付（费用方案 0）", "确认支付（费用方案 12）"],
    ["zh-Hant", ["確認支付", "不支付", "是", "否", "確認支付", "確認", "拒絕"], "確認支付（費用方案 0）", "確認支付（費用方案 12）"],
    ["en", ["Confirm payment", "Do not pay", "Yes", "No", "Pay", "Confirm", "Decline"], "Confirm payment (cost option 0)", "Confirm payment (cost option 12)"],
  ] as const)("translates exact host choices using the %s UI catalog", (locale, expected, zero, twelve) => {
    activateLocale(locale);
    expect(["Confirm payment", "Do not pay", "Yes", "No", "Pay", "Confirm", "Decline"].map(promptChoiceLabel)).toEqual(expected);
    expect(promptChoiceLabel("Confirm payment (cost option 0)")).toBe(zero);
    expect(promptChoiceLabel("Confirm payment (cost option 12)")).toBe(twelve);
    expect(promptChoiceLabel("source — Confirm payment")).toBe(`source — ${expected[0]}`);
    expect(promptChoiceLabel("source — Confirm payment (cost option 12) — Do not pay — Yes — No"))
      .toBe(`source — ${twelve} — ${expected[1]} — ${expected[2]} — ${expected[3]}`);
  });

  it("preserves numeric counts, unknown labels, and non-exact matches", () => {
    activateLocale("zh-Hans");
    for (const label of [
      "0", "1", "2", "-1", "123456789", "pay", " Pay", "Unknown ability", "", "确认支付",
      "Confirm payment now", "Confirm payment (cost option -1)", "Confirm payment (cost option 1.5)",
      "Confirm payment (cost option 01)", "Confirm payment (cost option N)",
      "Confirm payment (cost option 1)\n", "Confirm payment (cost option 1) extra",
      "source—Confirm payment", "source —  Confirm payment", "FIRST — é", "source — 0 — 1 — 42",
      "Yes please — No thanks",
    ]) {
      expect(promptChoiceLabel(label)).toBe(label);
    }
    expect(promptChoiceLabel("source — 1 — Confirm payment — unknown 2"))
      .toBe("source — 1 — 确认支付 — unknown 2");
  });

  it("preserves cost-option index text without numeric conversion", () => {
    activateLocale("zh-Hans");
    expect(promptChoiceLabel("Confirm payment (cost option 9007199254740993)"))
      .toBe("确认支付（费用方案 9007199254740993）");
  });

  it("names shock-land branches as pay / do not pay", () => {
    activateLocale("zh-Hans");
    expect(promptChoiceLabel("Pay 2 life")).toBe("支付 2 点生命");
    expect(promptChoiceLabel("Do not pay 2 life — It enters tapped"))
      .toBe("不支付 2 点生命 — 横置进场");
    expect(promptChoiceLabel("Steam Vents: choose an option")).toBe("Steam Vents：选择一项");
  });

  it("translates engine fixed-format phrases but keeps card text", () => {
    activateLocale("zh-Hans");
    expect(promptChoiceLabel("Pay {2}{R}")).toBe("支付 {2}{R}");
    expect(promptChoiceLabel("Move to command zone")).toBe("移至指挥区");
    expect(promptChoiceLabel("Sacrifice 2 permanents")).toBe("牺牲 2 个永久物");
    expect(promptChoiceLabel("Exile a card from your graveyard")).toBe("从你的坟墓场放逐一张牌");
    expect(promptChoiceLabel("Pay its mana cost reduced by {2}")).toBe("支付其法术力费用减少 {2}");
    expect(promptChoiceLabel("Player 2")).toBe("玩家 2");
    expect(promptChoiceLabel("Choose mode")).toBe("选择模式");
    expect(promptChoiceLabel("Draw two cards (unavailable)")).toBe("Draw two cards（不可用）");
    expect(promptChoiceLabel("Pay {3} — apply Foo, then Bar")).toBe("支付 {3} — 应用 Foo，然后 Bar");
    // Oracle effect text is card data, not interface copy.
    expect(promptChoiceLabel("You may draw a card.")).toBe("You may draw a card.");
  });

  it("resolves the active locale on every call", () => {
    activateLocale("zh-Hans");
    expect(promptChoiceLabel("Confirm payment")).toBe("确认支付");
    expect(promptChoiceLabel("Pay")).toBe("确认支付");
    activateLocale("en");
    expect(promptChoiceLabel("Confirm payment")).toBe("Confirm payment");
    expect(promptChoiceLabel("Pay")).toBe("Pay");
  });
});
