import { afterEach, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/i18n";
import { gameLogBadge, localizeGameLogMessage } from "./gameLog";
import { GAME_LOG_TEMPLATES } from "./gameLogTemplates";

afterEach(() => i18n.activate("en"));

describe("engine log display localization", () => {
  it.each([
    ["Game started", "游戏开始", "遊戲開始"],
    ["Turn 12 — 小明@1234", "第12回合 — 小明@1234", "第12回合 — 小明@1234"],
    ["Player 1 casts Lightning Bolt", "Player 1施放Lightning Bolt", "Player 1施放Lightning Bolt"],
    ["Lightning Bolt deals 3 damage to 小明", "Lightning Bolt对小明造成3点伤害", "Lightning Bolt對小明造成3點傷害"],
    ["Bear deals 2 combat damage to Gideon Jura", "Bear对Gideon Jura造成2点战斗伤害", "Bear對Gideon Jura造成2點戰鬥傷害"],
    ["Lightning Bolt's effect resolves", "Lightning Bolt的效应结算", "Lightning Bolt的效應結算"],
    ["Island moves from Hand to Battlefield", "Island从手牌移至战场", "Island從手牌移至戰場"],
    ["Island adds {U} mana", "Island加{U}法术力", "Island加{U}魔法力"],
    ["Player 2 scries 3: 1 on top and 2 on bottom", "Player 2占卜3：1张置于牌库顶，2张置于牌库底", "Player 2占卜3：1張置於牌庫頂，2張置於牌庫底"],
    ["Game over — 小明 wins!", "游戏结束 — 小明获胜！", "遊戲結束 — 小明獲勝！"],
    ["2 +1/+1 counters on Bear", "在Bear上放置2个+1/+1指示物", "在Bear上放置2個+1/+1指示物"],
  ])("translates actual flattened message %s", (source, hans, hant) => {
    expect(localizeGameLogMessage(source, "zh-Hans")).toBe(hans);
    expect(localizeGameLogMessage(source, "zh-Hant")).toBe(hant);
    expect(localizeGameLogMessage(source, "en")).toBe(source);
  });

  it("preserves opaque names, punctuation, mana, and replacement metacharacters", () => {
    expect(localizeGameLogMessage("$&@1234 casts Fire // Ice", "zh-Hans"))
      .toBe("$&@1234施放Fire // Ice");
    expect(localizeGameLogMessage("小明 reveals: Forest, Draw, Game started", "zh-Hant"))
      .toBe("小明展示：Forest, Draw, Game started");
    expect(localizeGameLogMessage("Forest enters Battlefield", "zh-Hant"))
      .toBe("Forest進入戰場");
  });

  it.each(["", "Future engine event: draws cards", "Alice draws many cards", "Forest enters FutureZone", "Error\nPlayer 1 casts Bolt", "游戏开始"])("leaves unknown text unchanged: %s", (source) => {
    expect(localizeGameLogMessage(source, "zh-Hans")).toBe(source);
  });

  it("translates each grouped attack/block assignment, without splitting arbitrary payloads", () => {
    expect(localizeGameLogMessage("Bear attacks Alice; Wolf attacks Gideon Jura", "zh-Hans"))
      .toBe("Bear攻击Alice；Wolf攻击Gideon Jura");
    expect(localizeGameLogMessage("Bear blocks Wolf; Soldier blocks Dragon", "zh-Hant"))
      .toBe("Bear阻擋Wolf；Soldier阻擋Dragon");
    expect(localizeGameLogMessage("Alice reveals: Fire; Ice", "zh-Hans"))
      .toBe("Alice展示：Fire; Ice");
  });

  it("leaves non-Chinese locales unchanged", () => {
    expect(localizeGameLogMessage("Game started", "ja")).toBe("Game started");
  });

  it("reads the active locale each time, including existing history", () => {
    const entry = Object.freeze({ message: "Game started" });
    i18n.load({ "zh-Hans": {}, "zh-Hant": {}, en: {} });
    i18n.activate("zh-Hans");
    expect(localizeGameLogMessage(entry.message)).toBe("游戏开始");
    i18n.activate("zh-Hant");
    expect(localizeGameLogMessage(entry.message)).toBe("遊戲開始");
    i18n.activate("en");
    expect(localizeGameLogMessage(entry.message)).toBe("Game started");
    expect(entry.message).toBe("Game started");
  });

  it("covers every declared template in both scripts without leftover slots", () => {
    for (const [template] of GAME_LOG_TEMPLATES) {
      const source = template.replace(/\{(\d+)(?::(number|zone|mana))?\}/g,
        (_, id: string, kind: string) => kind === "number" ? "2" : kind === "zone" ? "Hand" : kind === "mana" ? "{U}" : `Name${id}`);
      for (const locale of ["zh-Hans", "zh-Hant"]) {
        const result = localizeGameLogMessage(source, locale);
        expect(result, source).not.toBe(source);
        expect(result, source).not.toMatch(/\{\d+\}/);
      }
    }
  });

  it("localizes badges while preserving original English classification", () => {
    expect(gameLogBadge("stack", "Bolt's effect resolves", "zh-Hans")).toBe("结算");
    expect(gameLogBadge("info", "Turn 2 — Alice", "zh-Hant")).toBe("回合");
    expect(gameLogBadge("priority", "Alice passes priority", "zh-Hans")).toBe("优先权");
    expect(gameLogBadge("warning", "unknown", "zh-Hant")).toBe("警告");
    expect(gameLogBadge("action", "Alice casts Bolt", "en")).toBe("ACTION");
  });
});
