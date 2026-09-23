import { describe, expect, it } from "vitest";
import { applyMtgchLocalization } from "./mtgch";
import type { ScryfallCard } from "@/types/scryfall";

describe("mtgch localization", () => {
  it("applies Chinese name, type, and text to single-faced card", () => {
    const card = {
      id: "test-id",
      name: "Mountain",
      set: "msh",
      collector_number: "294",
      type_line: "Basic Land — Mountain",
      oracle_text: "({T}: Add {R}.)",
    } as unknown as ScryfallCard;

    const localized = applyMtgchLocalization(card, {
      atomic_official_name: "山脉",
      atomic_translated_type: "基本地～山脉",
      atomic_translated_text: "（{T}：加{R}。）",
    });

    expect(localized.printed_name).toBe("山脉");
    expect(localized.printed_type_line).toBe("基本地～山脉");
    expect(localized.printed_text).toBe("（{T}：加{R}。）");
  });

  it("applies face translations to double-faced cards", () => {
    const card = {
      id: "dfc-id",
      name: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",
      set: "neo",
      collector_number: "141",
      card_faces: [
        { name: "Fable of the Mirror-Breaker", type_line: "Enchantment — Saga" },
        { name: "Reflection of Kiki-Jiki", type_line: "Enchantment Creature — Goblin Shaman" },
      ],
    } as unknown as ScryfallCard;

    const localized = applyMtgchLocalization(card, {
      zhs_name: "破镜奇谭 // 奇奇几奇映影",
      zhs_face_name: "破镜奇谭",
      zhs_type_line: "结界～传纪",
      other_faces: [
        {
          zhs_face_name: "奇奇几奇映影",
          zhs_type_line: "结界生物～鬼怪／祭师",
          zhs_text: "背部文本",
        },
      ],
    });

    expect(localized.card_faces?.[0].printed_name).toBe("破镜奇谭");
    expect(localized.card_faces?.[0].printed_type_line).toBe("结界～传纪");
    expect(localized.card_faces?.[1].printed_name).toBe("奇奇几奇映影");
    expect(localized.card_faces?.[1].printed_type_line).toBe("结界生物～鬼怪／祭师");
  });
});
