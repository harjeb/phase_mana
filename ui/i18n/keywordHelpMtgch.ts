import type { SourcedKeywordHelp, KeywordHelpLocale } from "./keywordHelpSources";

// Exact reminder quotation returned by MTGCH /api/v1/card/eoe/1/.
// atomic_translated_text is credited by MTGCH to MTGZH. Do not rewrite it.
// This quotation is generic: no cost substitution is needed for other warp cards.
export const MTGCH_KEYWORD_HELP: Record<string, Partial<Record<KeywordHelpLocale, SourcedKeywordHelp>>> = {
  harmonize: {
    en: {
      text: "You may cast this card from your graveyard for its harmonize cost. You may tap a creature you control to reduce that cost by an amount of generic mana equal to its power. Then exile this spell.",
      source: {
        set: "TDM", collectorNumber: "150", card: "Nature's Rhythm", printedName: "Nature's Rhythm",
        language: "English", url: "https://mtgch.com/api/v1/card/tdm/150/", field: "oracle_text",
      },
    },
    "zh-Hans": {
      text: "你可以从你坟墓场中施放此牌，并支付其谐颂费用。你可以横置一个由你操控的生物，来依其力量减少该费用所需的一般法术力。然后放逐此咒语。",
      source: {
        set: "TDM", collectorNumber: "150", card: "Nature's Rhythm", printedName: "大自然的韵律",
        language: "Chinese Simplified (MTGCH)", url: "https://mtgch.com/api/v1/card/tdm/150/", field: "atomic_translated_text",
      },
    },
  },
  warp: {
    en: {
      text: "You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.",
      source: {
        set: "EOE", collectorNumber: "1", card: "Anticausal Vestige", printedName: "Anticausal Vestige",
        language: "English", url: "https://mtgch.com/api/v1/card/eoe/1/", field: "oracle_text",
      },
    },
    "zh-Hans": {
      text: "你可以支付跃迁费用来从手上施放此牌。在下一个结束步骤开始时放逐此生物，过了该回合后，便可再从放逐区施放之。",
      source: {
        set: "EOE", collectorNumber: "1", card: "Anticausal Vestige", printedName: "Anticausal Vestige",
        language: "Chinese Simplified (MTGCH / MTGZH)", url: "https://mtgch.com/api/v1/card/eoe/1/", field: "atomic_translated_text",
      },
    },
  },
};
