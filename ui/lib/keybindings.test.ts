import { describe, expect, it } from "vitest";
import { messages as zhHansMessages } from "@/i18n/locales/zh-Hans/messages.po";
import { messages as enMessages } from "@/i18n/locales/en/messages.po";
import { i18n } from "@/i18n/i18n";
import { KEYBINDINGS } from "@/lib/keybindings";

describe("keybinding labels", () => {
  const binding = KEYBINDINGS.find((b) => b.id === "nav-prev-page")!;

  it("resolves Chinese labels and categories at render time", () => {
    i18n.loadAndActivate({ locale: "zh-Hans", messages: zhHansMessages });
    expect(i18n._(binding.label)).toBe("上一页");
    expect(i18n._(binding.category)).toBe("导航");
  });

  it("falls back to English for the source locale", () => {
    i18n.loadAndActivate({ locale: "en", messages: enMessages });
    expect(i18n._(binding.label)).toBe("Previous page");
    expect(i18n._(binding.category)).toBe("Navigation");
  });
});
