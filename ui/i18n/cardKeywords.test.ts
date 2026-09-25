import { describe, expect, it } from "vitest";
import { translateKeyword } from "@/i18n/cardKeywords";

describe("translateKeyword", () => {
  it("maps evergreen abilities to official Chinese names", () => {
    expect(translateKeyword("Flying", "zh-Hans")).toBe("飞行");
    expect(translateKeyword("First Strike", "zh-Hans")).toBe("先攻");
    expect(translateKeyword("Double Strike", "zh-Hans")).toBe("连击");
    expect(translateKeyword("Trample", "zh-Hans")).toBe("践踏");
    expect(translateKeyword("Vigilance", "zh-Hans")).toBe("警戒");
    expect(translateKeyword("Lifelink", "zh-Hans")).toBe("系命");
    expect(translateKeyword("Deathtouch", "zh-Hans")).toBe("死触");
  });

  it("maps traditional Chinese names", () => {
    expect(translateKeyword("Flying", "zh-Hant")).toBe("飛行");
    expect(translateKeyword("Lifelink", "zh-Hant")).toBe("繫命");
    expect(translateKeyword("First Strike", "zh-Hant")).toBe("先攻");
  });

  it("keeps cost and parameter suffixes", () => {
    expect(translateKeyword("Ward:{2}", "zh-Hans")).toBe("守护:{2}");
    expect(translateKeyword("Dredge(2)", "zh-Hans")).toBe("发掘(2)");
    expect(translateKeyword("Bands with other legendary", "zh-Hans")).toBe(
      "与其他联手 legendary",
    );
  });

  it("does not match a shorter keyword inside a longer one", () => {
    expect(translateKeyword("Flashback", "zh-Hans")).toBe("返照");
    expect(translateKeyword("Trample over planeswalkers", "zh-Hans")).toBe("践踏鹏洛客");
  });

  it("leaves English and unknown keywords untouched", () => {
    expect(translateKeyword("Flying", "en")).toBe("Flying");
    expect(translateKeyword("Frobnicate", "zh-Hans")).toBe("Frobnicate");
    expect(translateKeyword("", "zh-Hans")).toBe("");
  });
});
