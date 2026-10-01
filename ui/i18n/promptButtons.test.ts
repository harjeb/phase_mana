import { afterEach, describe, expect, it } from "vitest";
import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";
import { messages as hans } from "@/i18n/locales/zh-Hans/messages.po";
import { messages as en } from "@/i18n/locales/en/messages.po";

const previousLocale = i18n.locale;
afterEach(() => i18n.activate(previousLocale));

const buttons = () => [
  msg`PASS`, msg`PASSING`, msg`END TURN`, msg`NEXT TURN`, msg`RESOLVE STACK`,
  msg`FULL CTRL`, msg`AUTOPASS`, msg`Attack All`, msg`Attack`, msg`No Blocks`,
  msg`Keep`, msg`Mulligan`, msg`AUTO`, msg`UNDO`, msg`CONFIRM ORDER`, msg`CONFIRM`,
].map((message) => i18n._(message));

describe("canvas prompt button translations", () => {
  it("translates the priority, combat and mulligan controls into Simplified Chinese", () => {
    i18n.loadAndActivate({ locale: "zh-Hans", messages: hans });
    expect(buttons()).toEqual([
      "让过", "让过中", "结束回合", "下一回合", "结算堆叠",
      "完全控制", "自动让过", "全部攻击", "攻击", "不阻挡",
      "保留手牌", "调度", "自动", "撤销", "确认顺序", "确认",
    ]);
    const attackCount = 3;
    expect(i18n._(msg`Attack (${attackCount})`)).toBe("攻击（3）");
  });

  it("resolves labels using the current interface language", () => {
    i18n.loadAndActivate({ locale: "zh-Hans", messages: hans });
    expect(buttons()[0]).toBe("让过");
    i18n.loadAndActivate({ locale: "en", messages: en });
    expect(buttons().slice(0, 5)).toEqual(["PASS", "PASSING", "END TURN", "NEXT TURN", "RESOLVE STACK"]);
  });
});
