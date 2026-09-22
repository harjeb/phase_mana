# 预设不支持卡牌明细

范围、判定与复现见 [审计说明](unsupported-cards.zh-CN.md)。预设引用格式为 `文件名（不含 .json）:区域`；同一张牌在同一预设多个区域可出现多次。

| 牌名 | 解析牌面 | gaps / 缺失 | 受影响预设与区域 |
| --- | --- | --- | --- |
| Call the Coppercoats | Call the Coppercoats | Effect:unparsed_quantity | starter_deck_kasla:cards |
| Demonlord Belzenlok | Demonlord Belzenlok | Effect:unrecognized_clause_head | kaalia_regression_commander:cards |
| Glimpse the Impossible | Glimpse the Impossible | Effect:delayed_unplayed_exile_sweep | starter_deck_ruby_storm:cards |
| Lavinia, Azorius Renegade | Lavinia, Azorius Renegade | Effect:static_structure | starter_deck_lurrus:cards |
| Path of Mettle // Metzali, Tower of Triumph | Path of Mettle | Effect:unparsed_verb_arguments | starter_deck_dihada_reanimate:cards |
| Planar Nexus | Planar Nexus | Effect:effect_structure | starter_deck_tron:cards |
| Rottenmouth Viper | Rottenmouth Viper | Effect:unrecognized_clause_head | ashling_limitless_commander:cards |
| Steward of the Harvest | Steward of the Harvest | Effect:static_structure | real_teval_commander:cards |
| Tibalt's Trickery | Tibalt's Trickery | Effect:unparsed_verb_arguments | starter_deck_wrenn_and_crop:cards |
| Time Vault | Time Vault | Effect:replacement_structure | starter_deck_workshop:cards |

## 逐预设汇总（全部预设）

| 预设文件名 | 标签 | 拒绝的不同牌名数 | 拒绝牌名 |
| --- | --- | ---: | --- |
| ashling_limitless_commander | Ashling, the Limitless | 1 | Rottenmouth Viper |
| hearthhull_world_shaper_commander | Hearthhull, the Worldseed | 0 | — |
| ironsmith_commander_elven_empire | Elven Empire — Ironsmith Edition | 0 | — |
| ironsmith_modern_393112 | Scapeshift | 0 | — |
| ironsmith_modern_393116 | Snow Bant Control | 0 | — |
| ironsmith_modern_412677 | Bant Yorion | 0 | — |
| ironsmith_modern_438121 | UR Aggro — Wynford Dayne Chan | 0 | — |
| ironsmith_modern_438396 | UR Aggro — Yamamoto Akihiro | 0 | — |
| ironsmith_modern_439182 | UR Aggro — Suzuki Hayao | 0 | — |
| ironsmith_modern_441337 | UR Aggro — AstralPlane | 0 | — |
| ironsmith_modern_441756 | UR Aggro — benbot9003 | 0 | — |
| ironsmith_modern_442263 | UR Aggro — Claudio Yong Ke | 0 | — |
| ironsmith_modern_442295 | UR Aggro — Nicola Magni | 0 | — |
| ironsmith_modern_443032 | UR Aggro — muuzic | 0 | — |
| ironsmith_modern_443121 | UR Aggro — Matunaga Takahiro | 0 | — |
| ironsmith_modern_443933 | UR Aggro — Oowada Takahito | 0 | — |
| ironsmith_modern_446596 | UR Aggro — Mastunaga Takahiro | 0 | — |
| ironsmith_modern_460614 | UR Aggro — GALL | 0 | — |
| ironsmith_modern_484224 | UR Aggro — Tom Strong | 0 | — |
| ironsmith_modern_504253 | UR Aggro — unluckymonkey | 0 | — |
| ironsmith_modern_522086 | UR Aggro — Alan07 | 0 | — |
| ironsmith_standard_264531 | Red Deck Wins — Woodrow Engle | 0 | — |
| ironsmith_standard_284980 | Mardu Aggro — Matt Severa | 0 | — |
| ironsmith_standard_295360 | Temur Energy Aggro — Michael Brierley | 0 | — |
| ironsmith_standard_665906 | RDW — Alessandro Mazzi | 0 | — |
| ironsmith_standard_723954 | UR Aggro — Clement Choo | 0 | — |
| ironsmith_vintage_106774 | Goblins — Steven Paris | 0 | — |
| kaalia_regression_commander | Kaalia of the Vast | 1 | Demonlord Belzenlok |
| neheb_minotaur_commander | Neheb, the Worthy | 0 | — |
| ramses_commander | Ramses, Assassin Lord | 0 | — |
| real_jund_wildfire | Jund Wildfire | 0 | — |
| real_mono_black_sacrifice | Pauper Mono Black Sacrifice | 0 | — |
| real_mono_red_madness | Pauper Mono Red Madness | 0 | — |
| real_mono_white_weenie | Pauper Mono White Weenie | 0 | — |
| real_mono_white_weenie_2 | Pauper White Weenie (Boros splash) | 0 | — |
| real_pauper_elves | Pauper Elves | 0 | — |
| real_teval_commander | Teval, the Balanced Scale | 1 | Steward of the Harvest |
| starter_deck_animar | Animar | 0 | — |
| starter_deck_bant_rhythm | Bant Rhythm | 0 | — |
| starter_deck_boros_energy | Boros Energy | 0 | — |
| starter_deck_boros_synth | Boros Synth | 0 | — |
| starter_deck_dihada_reanimate | Dihada Reanimate | 1 | Path of Mettle // Metzali, Tower of Triumph |
| starter_deck_dimir_tempo | Dimir Tempo | 0 | — |
| starter_deck_dimir_terror | Dimir Terror | 0 | — |
| starter_deck_esper_pixie | Esper Pixie | 0 | — |
| starter_deck_esper_reanimator | Esper Reanimator | 0 | — |
| starter_deck_ghired | Ghired | 0 | — |
| starter_deck_greasefang | Greasefang | 0 | — |
| starter_deck_izzet_creativity | Izzet Creativity | 0 | — |
| starter_deck_izzet_lessons | Izzet Lessons | 0 | — |
| starter_deck_kasla | Kasla | 1 | Call the Coppercoats |
| starter_deck_lands | Lands | 0 | — |
| starter_deck_living_end | Living End | 0 | — |
| starter_deck_lurrus | Lurrus | 1 | Lavinia, Azorius Renegade |
| starter_deck_mono_red_prison | Mono Red Prison | 0 | — |
| starter_deck_nicol_bolas_god_pharaoh | Nicol Bolas, God-Pharaoh | 0 | — |
| starter_deck_ognis | Ognis | 0 | — |
| starter_deck_reanimator | Reanimator | 0 | — |
| starter_deck_red_deck_wins | Red Deck Wins | 0 | — |
| starter_deck_ruby_storm | Ruby Storm | 1 | Glimpse the Impossible |
| starter_deck_selesnya_company | Selesnya Company | 0 | — |
| starter_deck_thalia_gitrog | Thalia &amp; Gitrog | 0 | — |
| starter_deck_tron | Tron | 1 | Planar Nexus |
| starter_deck_tyvar_glimpse | Tyvar Glimpse | 0 | — |
| starter_deck_urza_chief_artificer | Urza, Chief Artificer | 0 | — |
| starter_deck_workshop | Workshop | 1 | Time Vault |
| starter_deck_wrenn_and_crop | Wrenn and Crop | 1 | Tibalt's Trickery |
| starter_deck_yarok | Yarok | 0 | — |
