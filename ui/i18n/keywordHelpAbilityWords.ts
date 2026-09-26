// Simplified Chinese source quotations, not newly authored rules summaries.
// Ability words have no independent rules meaning. These are condition/cost excerpts;
// the printed card supplies its effect. Card names, colors, and zones in a quotation
// belong to the cited example (not a universal requirement). Ellipses mark omissions.
// Descend quotes the keyword action; descend 4/8 are separate threshold abilities.
// Double team is a digital keyword, included here because it is absent from paper CR.
// Generated and substring-verified by tools/build-ability-word-help.py.
export const ABILITY_WORD_HELP: Record<string, {
  name: string;
  text: string;
  source: { url: string; field: string; card?: string };
}> = {
  "augment": {
    "name": "附体",
    "text": "「{3}{W}，从你手上展示此牌：将它与目标宿主组合。只能于法术时机附体。」",
    "source": {
      "url": "https://mtgch.com/api/v1/card/ust/10/",
      "field": "atomic_translated_text",
      "card": "Humming-"
    }
  },
  "landfall": {
    "name": "地落",
    "text": "「每当一个地在你的操控下进战场时」",
    "source": {
      "url": "https://scryfall.com/card/248bd095-6990-4dbc-94c1-affbb403b784",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Avenger of Zendikar"
    }
  },
  "constellation": {
    "name": "星彩",
    "text": "「每当达克索斯的苦痛或另一个结界在你的操控下进战场时」",
    "source": {
      "url": "https://scryfall.com/card/4433ce39-1b4a-44c2-8bab-04d52c6ae3d2",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Daxos's Torment"
    }
  },
  "heroic": {
    "name": "勇行",
    "text": "「每当你施放以飞马骑士为目标的咒语时」",
    "source": {
      "url": "https://scryfall.com/card/a1c418b1-defc-4d65-a1e6-bdcfa5585377",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Wingsteed Rider"
    }
  },
  "magecraft": {
    "name": "魔艺",
    "text": "「每当你施放或复制瞬间或法术咒语时」",
    "source": {
      "url": "https://scryfall.com/card/f6dd9604-9ccd-48f0-a683-82142f428e11",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Veyran, Voice of Duality"
    }
  },
  "rally": {
    "name": "奋扬",
    "text": "「每当哥马法达勇士或另一个伙伴在你的操控下进战场时」",
    "source": {
      "url": "https://scryfall.com/card/343bf5d8-1062-4f81-832d-d5313ee87261",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Hero of Goma Fada"
    }
  },
  "raid": {
    "name": "突击",
    "text": "「如果你本回合中攻击过」",
    "source": {
      "url": "https://scryfall.com/card/ebf7c48b-e601-40a8-87b8-bf56b2acfdc3",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Heartless Pillage"
    }
  },
  "battalion": {
    "name": "协战",
    "text": "「每当前线医士与至少两个其他生物攻击时」",
    "source": {
      "url": "https://scryfall.com/card/9190abbc-c2e8-48a0-98db-33b96de7ffce",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Frontline Medic"
    }
  },
  "kinship": {
    "name": "血族",
    "text": "「在你的维持开始时，你可以检视你的牌库顶牌。 如果它与风飘洁英有共通之生物类别，你可以展示该牌。」",
    "source": {
      "url": "https://scryfall.com/card/388281fe-74b2-4c66-80b7-9fba295abfcf",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Kithkin Zephyrnaut"
    }
  },
  "domain": {
    "name": "领土",
    "text": "「由你操控的地之中基本地类别的数量」",
    "source": {
      "url": "https://scryfall.com/card/588b7e8f-585b-4067-914e-036af15285ef",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Prismatic Geoscope"
    }
  },
  "metalcraft": {
    "name": "金技",
    "text": "「只要你操控三个或更多神器」",
    "source": {
      "url": "https://scryfall.com/card/bfe02a57-6987-4716-911d-22bfe7e29d02",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Puresteel Paladin"
    }
  },
  "morbid": {
    "name": "丧心",
    "text": "「如果本回合中有生物死去」",
    "source": {
      "url": "https://scryfall.com/card/af106c8f-cd17-4ee6-8dbe-20b24d4b9fdd",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Brimstone Volley"
    }
  },
  "delirium": {
    "name": "躁狂",
    "text": "「只要你坟墓场中牌的牌张类别有四种或更多」",
    "source": {
      "url": "https://scryfall.com/card/cae1c8a8-645d-444c-a2fe-d774ae6e80f8",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Grim Flayer"
    }
  },
  "coven": {
    "name": "鸠集",
    "text": "「若你操控三个或更多力量各不相同的生物」",
    "source": {
      "url": "https://scryfall.com/card/44442377-3f70-4b3f-a610-c729a255c374",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Redemption Choir"
    }
  },
  "converge": {
    "name": "聚辉",
    "text": "「施放此咒语时用来支付费用的法术力颜色数量」",
    "source": {
      "url": "https://scryfall.com/card/e5eb89dc-17e5-4b05-a7df-a90ab053247f",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Bring to Light"
    }
  },
  "formidable": {
    "name": "强横",
    "text": "「若由你操控之生物的力量总和等于或大于8」",
    "source": {
      "url": "https://scryfall.com/card/6932cbc6-3e3a-41a0-b0a2-6bb338d145ee",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Surrak, the Hunt Caller"
    }
  },
  "enrage": {
    "name": "激怒",
    "text": "「每当城市匕牙龙受到伤害时」",
    "source": {
      "url": "https://scryfall.com/card/5175f7dc-35d2-402c-9285-01df1bde8efb",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Urban Daggertooth"
    }
  },
  "bloodrush": {
    "name": "血激",
    "text": "「弃掉烙肤鬼怪」…「目标进行攻击的生物」",
    "source": {
      "url": "https://scryfall.com/card/a6ac206c-1c52-4fea-b159-31d6939e73b1",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Skinbrand Goblin"
    }
  },
  "cohort": {
    "name": "齐力",
    "text": "「{T}，横置一个由你操控且未横置的伙伴」",
    "source": {
      "url": "https://scryfall.com/card/871cc5cb-d1be-41e5-9bb9-0c027b719085",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Munda's Vanguard"
    }
  },
  "parley": {
    "name": "论争",
    "text": "「每位牌手各展示其牌库顶牌。每以此法展示出一张非地牌」…「然后每位牌手各抓一张牌。」",
    "source": {
      "url": "https://scryfall.com/card/4616e06b-f1d4-43de-95cf-f04ef5e2b9a7",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Rousing of Souls"
    }
  },
  "pack tactics": {
    "name": "集群战术",
    "text": "「每当大哥布林队长攻击时，若你本次战斗中用以攻击之生物力量总和等于或大于6」",
    "source": {
      "url": "https://scryfall.com/card/fc4fc85d-1769-42ea-b828-6c42c78d8b0f",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Hobgoblin Captain"
    }
  },
  "will of the council": {
    "name": "议定",
    "text": "「由你开始，每位牌手各投票选择」…「票数最多或与他者同为最多」",
    "source": {
      "url": "https://scryfall.com/card/25fc0c95-c1eb-4108-9f2f-0f2d60c74b61",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Council's Judgment"
    }
  },
  "fateful hour": {
    "name": "命悬一刻",
    "text": "「如果你的生命为5或更少」",
    "source": {
      "url": "https://scryfall.com/card/c7ff4494-43e0-4774-b3dc-38c3ada91cf2",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Break of Day"
    }
  },
  "hellbent": {
    "name": "背水战",
    "text": "「只要你没有手牌」",
    "source": {
      "url": "https://scryfall.com/card/36b8927d-7ef1-4c07-af4d-36d7c2f0f440",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Demon's Jester"
    }
  },
  "undergrowth": {
    "name": "朽力",
    "text": "「你坟墓场中的生物牌数量」",
    "source": {
      "url": "https://scryfall.com/card/69a75e3b-1233-467d-abc1-95dfbbd79e4f",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Moodmark Painter"
    }
  },
  "channel": {
    "name": "魂力",
    "text": "「弃掉阳刃武士」",
    "source": {
      "url": "https://scryfall.com/card/fa8933a3-6cff-4838-b383-cdf41ac8bb72",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Sunblade Samurai"
    }
  },
  "spell mastery": {
    "name": "精熟咒语",
    "text": "「如果你坟墓场中有两张或更多的瞬间和／或法术牌」",
    "source": {
      "url": "https://scryfall.com/card/f8fc7388-38dc-4433-a665-48482b0b50f4",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Ravaging Blaze"
    }
  },
  "eminence": {
    "name": "威仪",
    "text": "「只要太初龙在统帅区中或战场上」",
    "source": {
      "url": "https://scryfall.com/card/aa996bbf-c2ba-4274-8bad-bc37bc486973",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "The Ur-Dragon"
    }
  },
  "ferocious": {
    "name": "威猛",
    "text": "「如果你操控力量等于或大于4的生物」",
    "source": {
      "url": "https://scryfall.com/card/bcf129f8-0b94-4e56-a671-f17a59677e63",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Temur Battle Rage"
    }
  },
  "chroma": {
    "name": "渲色",
    "text": "「你坟墓场中所有牌之法术力费用中黑色法术力符号之数量」",
    "source": {
      "url": "https://scryfall.com/card/62390ce8-26c9-42c7-830b-9e476330959e",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Umbra Stalker"
    }
  },
  "radiance": {
    "name": "辉耀",
    "text": "「目标生物和每个与该生物有共通颜色的其它生物」",
    "source": {
      "url": "https://scryfall.com/card/1c9a5818-7c3f-40bf-b8ac-db4d77aebf9c",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Bathe in Light"
    }
  },
  "revolt": {
    "name": "反抗",
    "text": "「如果本回合中有由你操控的永久物离开战场」",
    "source": {
      "url": "https://scryfall.com/card/38815a8d-8d08-4b3f-abaa-c0fd77e40edf",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Fatal Push"
    }
  },
  "adamant": {
    "name": "固色",
    "text": "「若施放它时支付过至少三点相同颜色的法术力」",
    "source": {
      "url": "https://scryfall.com/card/822e8dbc-53f4-4c9c-bf8c-a36751b290a1",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Clockwork Servant"
    }
  },
  "descend": {
    "name": "落坟",
    "text": "「如果有永久物牌从任何区域进入你的坟墓场，便算作你有落坟。」",
    "source": {
      "url": "https://scryfall.com/card/e2850149-f29b-426c-85d7-ae53dee29552",
      "field": "cards[].foreignData[language=Chinese Simplified].text",
      "card": "Ruin-Lurker Bat"
    }
  },
  "double team": {
    "name": "双打",
    "text": "「当此生物攻击时，将它的一张副本幻变进你手上，然后这两者均永久失去双打异能。」",
    "source": {
      "url": "https://mtgch.com/api/v1/card/hbg/28/",
      "field": "atomic_translated_text",
      "card": "Soldiers of the Watch"
    }
  },
  "starting intensity": {
    "name": "起始强度",
    "text": "「起始强度3」…「此法术对任意一个目标造成伤害，其数量等同于其强度。然后由你拥有且名称为静电放射的牌强化1。」",
    "source": {
      "url": "https://mtgch.com/api/v1/card/j21/25/",
      "field": "atomic_translated_text",
      "card": "Static Discharge"
    }
  }
};

// A translated name alone is not a sourced explanation. Do not show it as help.
export const UNSUPPORTED_ABILITY_WORD_HELP = {} as const;
