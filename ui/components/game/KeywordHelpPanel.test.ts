import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { KeywordHelpPanel } from "./KeywordHelpPanel";
import { getKeywordHelp } from "@/i18n/keywordHelp";

vi.mock("./DynamicTextRender", () => ({
  DynamicTextRender: ({ text }: { text: string }) => text,
}));

describe("KeywordHelpPanel", () => {
  it("shows explanations immediately, without a button, and bounds scrolling", () => {
    const html = renderToStaticMarkup(createElement(KeywordHelpPanel, {
      entries: getKeywordHelp(["Flying"], "zh-Hans"),
      maxHeight: 420,
    }));
    expect(html).toContain("飞行");
    expect(html).toContain("此生物只能被具飞行或延势异能的生物阻挡。");
    expect(html).toContain("max-height:420px");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("always-scrollbar");
    expect(html).toContain("overscroll-contain");
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain("<button");
  });

  it("does not render an empty panel", () => {
    expect(renderToStaticMarkup(createElement(KeywordHelpPanel, {
      entries: [], maxHeight: 420,
    }))).toBe("");
  });
});
