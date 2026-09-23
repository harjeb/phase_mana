# 特殊玩法接入开发方案

> 状态：本方案的本地模式已实现并验证（Winston、Cube / 本地导入、多系列 Chaos、Commander Draft、Oathbreaker、Tiny Leaders、Duel / Pauper Commander、Momir、Archenemy、Planechase、Two-Headed Giant、Old School 93/94 与 95，以及 Conspiracy / Mystery Booster 的 `additional_pick` 特殊选牌）；自定义赛制编辑、旧版战斗伤害入栈与在线多人仍是独立开发项。基线为当前本地工作区，包含尚未提交的 Phase / phase-mana 改动；不是某个已发布版本的能力承诺。

## 0. 已实现（本轮）

以下模式已接入 `/api/limited` 与本机 `/api/start`，并由测试与浏览器冒烟覆盖。UI 统一收在**娱乐模式**（Play → 娱乐模式 / `#/play/offline/casual`）：

| 模式 | 入口 | 验证 |
| --- | --- | --- |
| Winston Draft（2 人共享牌堆，三叠拿下/放弃） | `limited_start_winston` / `limited_winston_take` / `limited_winston_pass` / `limited_get_winston_state` | `server/tests/limited.rs::winston_shared_stack_runs_to_completion_against_bots`，浏览器 `pm-limited.mjs` |
| Cube / 本地牌池导入（`customPool` / `poolType: Custom`） | `limited_start_booster_draft` / `limited_start_sealed` | `custom_cube_pool_drafts_and_seals`，`pm-limited.mjs` |
| 多系列 Chaos（客户端合并多系列牌池） | 同 Draft/Sealed，牌池含多个 `limited:` 系列 | `merged_set_pools_run_a_chaos_draft`，`pm-limited.mjs` |
| Commander Draft（CR 903.13，4 席、每次两张、60 张下限） | `limited_start_commander_draft` / `limited_commander_draft_info` / `limited_start_commander_game`，对局走 `format: "commander_draft"` | `commander_draft_takes_two_per_step_and_pod_plays_a_commander_game`、`table_tests::commander_draft_four_player_table_uses_minimum_sixty_decks`，`pm-limited.mjs` 完成 CMR 整轮并对局 |
| Oathbreaker（统帅 + 招牌咒语，60 张，20 血） | `format: "oathbreaker"`，两个槽位都放进 `humanCommanders` | `table_tests::oathbreaker_table_splits_planeswalker_and_signature_spell`，端点探测 200 |
| Tiny Leaders（50 张，20 血）、Duel Commander（100 张，30 血）、Pauper Commander（100 张，40 血，需稀有度数据） | `format: "tiny_leaders" / "duel_commander" / "pauper_commander"` | `table_tests::casual_constructed_formats_resolve_to_their_engine_configs`、`casual_tables_start_tiny_leaders_duel_commander_and_momir`，端点探测 200 |
| Momir（引擎固定 60 张雪地基本地 + 徽记） | `format: "momir"` | `table_tests::momir_table_supplies_snow_basics_without_a_submitted_deck`，端点探测 `chooseAction` |
| Archenemy（魔王 40 血 vs 英雄 20 血，共享阴谋牌堆） | `format: "archenemy"` | `casual_constructed_formats_resolve_to_their_engine_configs`，端点探测 200（`players=2 life=[40,20]`），`/tmp/drive.py` 推进到第 3 回合 |
| Planechase（共享时空牌堆 + 平面骰） | `format: "planechase"`，平面骰以合成异能 `Roll the planar die` 暴露 | 端点探测 200，`/tmp/plane3.py` 实际掷骰成功 |
| Two-Headed Giant（两队共享 30 血总量，4 席） | `format: "two_headed_giant"`，`extraOpponents` 补两席 | 端点探测 200（`players=4 life=[15,15,15,15]`），`/tmp/drive.py` 推进到第 3 回合 |
| Old School 93/94、Old School 95（自定义复古规则） | `format: "old_school_93_94" / "old_school_95"` | 端点探测 200（20 血） |
| Conspiracy / Mystery Booster 特殊选牌（Cogwork Librarian CR 905.2：可多抓一张并把该牌放回牌包） | 同 Draft，`limited_list_conspiracy_hooks` 与 `humanConspiracies` 发布效果；`limited_pick_card` 在效果生效时按两步选牌走 `PickWithDraftEffect` | `server/tests/limited.rs::conspiracy_draft_effect_picks_two_and_returns_the_librarian`、`conspiracy_and_mystery_booster_pools_load_and_collate`；抽取器跨系列解析牌包 UUID（`draft-core` `all_pools_resolves_cross_set_sheets_into_prints`）。**边界：**特殊选牌覆盖 `additional_pick`；阴谋牌槽位与揭示已接入，隐藏议程完整赛前命名和规则效果仍在开发 |
| MB1 / CNS / MB2 牌包（含 `additional_pick` 特殊牌的系列） | `limited_list_sets` / `limited_get_set_pool` / `limited_start_booster_draft` | 上述测试断言三个系列现在都能列名并开出 15 张牌包（MB1 的本地 `cards` 为空，由跨系列 UUID 解析补齐 prints） |

进行中：阴谋牌赛前槽位、命令区加载、各 AI 席提交与揭示端点已接入；揭示的过期请求、优先权、区域、所有权、秘密牌名隐私及失败事务性已有 `server/src/conspiracy_tests.rs` 回归。隐藏议程已通过原生输入对话框收集真人秘密牌名，AI 从自己的牌组选择；主机校验 Oracle 牌名并按实体索引保存，重复牌交错排列已有真实开局回归。完整规则效果与重赛链路尚待端到端验收；Double Agenda 已接入双牌名承诺及 Summoner’s Bond 等原生效果，主机 5 项议程测试通过（`/tmp/pm-double-agenda-host-tests3.log`）；局间重赛仍要求重新收集秘密牌名，不能复用上一局承诺。Cogwork Librarian 已支持明确选择使用或保留，实例 ID、重复牌及撤销由 `limited::conspiracy_tests` 验证。自定义赛制编辑/本地保存和原生 `customRules` 开局已接入，真实枚举 JSON 已修复，`pm-custom-formats.mjs` 验证创建、校验、保存、重载、编辑与选择；`server/src/custom_format_tests.rs` 验证初始生命、备牌数量及非法牌组不替换会话。主机 15 项库测试、前端 22 项相关测试及 TypeScript 检查通过；这些检查不代表整局或在线模式验收完成。

### 后续工作区验收更新

- **在线真人对局：** Full 协议 76 / ManaBrew 2 已接入，响应通过请求 ID 与权威版本关联；双人完整对局及退役房间结果恢复通过（`/tmp/pm-online-browser-v2-recovery.log`）。四人已收到最终私有快照及送达确认，但最新四人完整恢复脚本尚需复验。
- **真人轮抽：** `pm-online-draft.mjs` 已跑通两人 Premier 选牌、各自私有牌池、刷新重连、原生组牌提交、比赛接入、调度和认输（`/tmp/pm-draft-browser4.log`）。原生创建/加入后广播最新大厅视图；比赛公告后客户端在同一 socket 发送 `ReconnectDraft` 完成实际座位绑定，重复公告不产生重连循环。在线/轮抽 10 项前端回归通过（`/tmp/pm-draft-ui-tests2.log`）。新版服务端已额外通过非法牌组拒绝、权威胜负/排名、对局结束后刷新重连及启动下一轮（`/tmp/pm-draft-browser6.log`）。Traditional Bo3 三局验收见下；服务器重启恢复仍未完成浏览器验收。
- **Bo3：** `SideboardDialog.tsx` 使用当前私有提示中的注册牌池，已接入换备提交与先后手。原生 `manabrew_bo3` 两项测试验证牌池隐私、错席/过期拒绝、非法分区不改变版本和第二局重启；compat 全部 102 项通过，前端响应映射/在线/轮抽 14 项及 TypeScript 检查通过。`pm-online-draft.mjs --traditional` 已通过三局（双方交替认输）、两轮换备与先后手选择、整场胜负记分、刷新重连及下一轮接入（`/tmp/pm-draft-bo3-browser4.log`）。认输不再清掉已收到的权威换备提示，新增 store 回归 1 项通过；换备时不重复显示 Pixi 提示层。此验收未覆盖隐藏议程的新秘密重选或完整局比分持久化。
- **轮抽记分修复：** 扩展浏览器检查发现 Full 比赛席位与 pod 席位混用；原生结果回报改为通过配对顺序映射，新增 `[6, 2]` 配对回归及非法赢家保护，单项测试通过（`/tmp/pm-draft-result-test.log`）。已重建并在本机 9375 启动新服务端；上述 Premier 浏览器完整检查通过。
- **赛事：** 人工组织器浏览器流程已通过；原生注册表持久化与失败回滚已有独立实现。自动托管仍缺受信赛果关联、代际隔离、牌组锁定与保留座位接入，人工分数不标为可信比赛结果。
- **历史赛制：** 战斗伤害对象已有 35 项集成回归及 19 项现代/替代效应控制测试记录，但离场来源选择与反射仍有身份缺陷，OnStack 门禁保持关闭。Swedish 印刷校验尚待主机可信目录与实体印刷传输；Classic 的历史文本不能替代 Vault/Mask 可执行规则，门禁保持关闭。

所有记录均针对两个仓库的未提交工作区，不是已发布能力。Bo3、阴谋牌完整浏览器/AI/局间链路、历史规则及自动赛事仍未完成。

## 1. 目标与范围

在现有本地真人对 AI、普通轮抽、现开及四人 Commander 的基础上，逐步接入特殊玩法。规则、牌组合法性、随机过程和隐藏信息继续由 Phase 负责；phase-mana 负责本地主机、协议转换、操作界面及资源读取。

本方案分成三条工作线，避免把它们误当成同一个功能：

1. **限制赛玩法**：Cube、本地 Chaos、多系列卡包、Winston、Commander Draft、Conspiracy / Mystery Booster 特殊选牌。
2. **对局赛制**：Oathbreaker、其他 Commander 衍生赛制、Momir、Planechase、Two-Headed Giant、Archenemy。
3. **扩展规则与赛事**：自定义及复古赛制、旧版战斗伤害使用堆叠、在线多人及赛事组织。

默认先交付本地对 AI 的完整闭环。在线房间和赛事单独立项。沿用此前范围限制：**不恢复 Brawl、Historic Brawl 或 Alchemy**。

## 2. 文档来源与证据口径

当前 `phase-mana/docs` 只有卡牌解析支持审计，不包含完整的特殊赛制设计。本方案主要参考相邻 Phase 仓库的设计文档，并以当前代码核对接入点。

| 来源 | 对本方案的意义 |
| --- | --- |
| [自定义赛制总览](../../phase/docs/proposals/custom-format-engine/README.md)及[实施计划](../../phase/docs/proposals/custom-format-engine/IMPLEMENTATION_PLAN.md) | 区分结构规则、合法性规则和历史规则；说明已设计与分阶段实现的边界 |
| [自定义赛制详细设计](../../phase/docs/proposals/custom-format-engine/PLAN.md) | 复用结构化规则，不为每个复古赛制硬编码一个 UI 分支 |
| [旧版战斗伤害方案](../../phase/docs/proposals/custom-format-engine/COMBAT_DAMAGE_ON_STACK.md) | 战斗伤害对象、来源身份、优先权及结算边界；不能只加一个开关 |
| [赛事组织总览](../../phase/docs/proposals/tournament-organizer/README.md)及[状态文件](../../phase/docs/proposals/tournament-organizer/STATUS.md) | 瑞士轮、淘汰赛、多人桌计分、权限及恢复，与本地 gauntlet 区分 |
| [格式定义](../../phase/crates/engine/src/types/format.rs)、[自定义规则](../../phase/crates/engine/src/types/custom_format.rs) | 实际可用的引擎配置及能力门禁 |
| [牌组加载](../../phase/crates/engine/src/game/deck_loading.rs) | 已有统帅、招牌咒语、时空牌组及阴谋牌组槽位 |
| [Draft 类型](../../phase/crates/draft-core/src/types.rs)、[会话](../../phase/crates/draft-core/src/session.rs)、[共享牌堆](../../phase/crates/draft-core/src/shared_stack.rs) | 已有选传牌、Winston、Commander Draft 及牌源结构 |
| [当前主机](../server/src/lib.rs)、[Limited 服务](../server/src/limited.rs)、[协议适配器](../../phase/crates/manabrew-compat/src/lib.rs) | phase-mana 实际接入范围与待补边界 |

**判定原则：**有枚举、有构造函数、有按钮、或设计文档写着完成，都不等于本项目已经支持。每个模式必须通过“配置 → 牌组校验 → 加载 → 快照/提示 → 用户响应 → AI → 结束结算”的端到端检查后才能开放。

### 上游文档与源码的状态差异

阅读时发现部分提案首页早于当前实现，以下以本地代码为准：

- **EC Old School 93/94、Old School 95** 已进入引擎注册表，phase-mana 也已接入（见第 0 节）；两者共用同一套自定义规则模型，不为每个复古赛制硬编码分支。
- **Swedish Old School** 有构造器但未开放；原生新增基于可信目录的逐实体印刷校验，拒绝无印刷证据的名称牌表，仍需主机目录加载与印刷信息传输，不能仅凭卡名开放。
- Mana burn、旧 Wish 放逐区访问、跨控制者传奇规则已有可用规则轴；它们不是所有 EC 预设共同启用的规则。
- 战斗伤害入栈已有 `StackEntryKind::CombatDamage` 等基础类型，但运行时能力门禁仍关闭。它指**第六版至 M10 前**的规则，不是“第六版以前”。Middle School 依赖这项能力；Classic Magic 还依赖 Time Vault / Illusionary Mask 历史文本覆盖。
- **上游赛事组织器已实现** Swiss、单淘汰、多人 pod、排名、轮次、权限及 Bo1/Bo3 等功能；旧 README 中“仅研究设计”不能作为当前状态。配对后自动建桌、权威托管和自动回报赛果是另外的后续方案，尚不能算已经实现。
- 自定义赛制的模型、保存和部分合法性评估已存在，但上游客户端仍有开局禁用路径，接入时要验证完整链路。

上述依据还包括 `phase/crates/engine/src/types/custom_format.rs`、`game/combat_damage.rs`、`game/deck_validation.rs`、`phase/crates/lobby-broker/src/tournament.rs` 及 `phase/client/src/components/lobby/HostSetup.tsx`。文档中完成的设计与运行时开放能力分别记录。

## 3. 当前基线

- 本地 2–4 人桌；四人 Commander 为 1 真人 + 3 AI，独立统帅区与 40 点生命。
- 普通轮抽支持 2–8 席、三包、每步选一张；现开支持六包；组牌后进入双人 Limited 对局或本地 gauntlet。
- 已下载 869 个系列原始文件，提取 181 个卡包池；178 个通过当前本地服务的校验并出现在 UI。数量是当前数据快照，不硬编码到程序。
- CNS / MB2 的特殊轮抽牌（CR 905.2 `additional_pick`）已接入；MB1 的本地 `cards` 为空，已由抽取器的跨系列 UUID 解析补齐 prints，三者现在都可列名与开包。三者文件均已在本地，**重新下载不是解决方案**。
- `limited_list_sets` 从本地文件生成可用列表；选择系列不依赖 Scryfall 预取。卡图加载与规则资源可用性分开。
- `limited.rs` 仍明确拒绝自定义牌池、非默认变体、特殊选牌规则和带 draft effect 的牌；不能简单删掉这些检查来“启用”。
- `GameFormat` 和 `DraftKind` 在 Phase 中覆盖的范围大于当前 HTTP 主机。部分普通构筑标签也只映射普通对局配置，不应据此宣称对应赛事合法性校验完整。
- 现有会话与撤销记录仅在内存中。本地 gauntlet 不是完整的瑞士轮组织器。

## 3.5 三层现状核对（引擎 / 协议 / 本项目）

> 本节由当前工作区代码核对得出；行号会随后续提交变化，判断依据是代码本身，核对命令见附录 A。

“引擎里有配置”不等于“本项目可玩”。要让一个玩法真正可玩，三层都要成立：

- **引擎规则层**（`phase/crates/engine`）：格式配置、拓扑、区域、结算。
- **协议适配层**（`phase/crates/manabrew-compat`）：把引擎状态、提示和动作映射成 ManaBrew 客户端能懂的 DTO。
- **本项目接入层**（`phase-mana/server` 与 `ui`）：HTTP、每席牌组与资源、指令和界面。

| 玩法 | 引擎规则层 | 协议适配层 | 本项目接入层 | 结论 |
| --- | --- | --- | --- | --- |
| 多系列 / 现开 | `draft-core` 有牌源与发包工具 | 无关（轮抽不经对局适配器） | 每包系列配置与校验 | 只改本项目 |
| Cube / Chaos | `draft-core` 有 Cube 牌源与 `SetLayout::Chaos` | 无关 | 资源校验、组牌与 UI | 只改本项目 |
| Winston | `DraftKind::Winston`＋`shared_stack` 状态机 | 动作与视图需核对 | **UI 与 store 指令已存在**（`ui/views/Winston.tsx`、`limited_winston_*`），服务端未实现 | 以本项目为主 |
| Commander Draft | `DraftKind::CommanderDraft`＋`GameFormat::CommanderDraft` | 现有 2–4 人通道可用 | 双选、60 张组牌、统帅指定、四人 | 本项目为主，发现缺口再补引擎 |
| CNS / MB2 | `draft_effect` 仅有 `additional_pick` | 已发布 draftEffects | 已接入 Cogwork Librarian（其余效果仍拒绝） | 已完成 |
| MB1 卡包 | 现成提取器与原始数据 | — | 跨系列 UUID prints 补齐 | 已完成 |
| Duel / Pauper Commander、Tiny Leaders | `for_format` 均有构造器 | 现有通道 | 各自资格、禁牌、默认参数与入口 | 本项目为主 |
| Oathbreaker | 有 `signature_spell` 槽位 | 需核对招牌咒语相关提示 | 缺传输与构筑校验 | 本项目＋协议审计 |
| Momir | `momir()` 提供固定牌组与徽记 | 需核对徽记/随机生成操作 | 缺入口与合法随机来源 | 本项目＋协议审计 |
| Planechase | `planechase()`＋`planar_deck` 可加载 | **已知缺口**：`local.planar-die-unsupported`；`AvailableActionKind` 无法表达“特殊动作”，适配器明确判定 Planechase 无法通过它运行 | 缺时空资源与展示 | **协议层需扩展**，不是只做 UI |
| Two-Headed Giant | `two_headed_giant()`：队伍共 30 点生命、固定 4 席、`team_based=true` | 适配器**没有队伍概念**：状态与提示里 `team` 出现 0 次，无法表达队伍/共享生命 | 缺队伍、共享生命与视角 | **协议层需扩展** |
| Archenemy | `archenemy()`：`archenemy_player=Some(0)`、CR 904.5 魔王 40／勇士 20、`scheme_deck` 可加载、`OneVsMany`＋共享团队回合 | 适配器**无 team/scheme 字段** | 缺魔王身份、阴谋牌组与团队回合入口 | **协议层需扩展** |
| 自定义 / 复古 | 注册表含 Old School 93/94、95；已实现 ManaBurn、Wish、LegendRuleScope；`CombatDamageTiming` 未开放；`evaluate_custom_format` 与 `SelectedFormat::Resolved` 已存在 | 现有 2 人通道 | 需解析配置并走原生 `Resolved` 路径 | 本项目为主；战斗伤害入栈是引擎项目 |
| 在线多人 / 赛事 | `lobby-broker/tournament.rs` 已实现 Swiss／淘汰／pod／排名／Bo3 | 上游协议 | 未接入 | 接入型项目 |

由此得到的判断：

- **多数玩法的缺口在本项目接入层。**引擎已经提供对应 `FormatConfig`（`for_format` 覆盖 Archenemy、Planechase、Momir、TwoHeadedGiant、Oathbreaker、CommanderDraft、TinyLeaders、PauperCommander 等）以及统帅、招牌咒语、时空牌组、阴谋牌组槽位。
- **仍需引擎项目的：**旧版战斗伤害入栈。团队／时空玩法所需的协议扩展已用合成动作与 `extraOpponents` 绕过，可玩但不是完整协议形态。
- **上游客户端仍关闭“保存的自定义赛制直接开局”**（`client/src/components/lobby/HostSetup.tsx` 中 `customFormatHostUnavailable = activeSavedFormat !== null`），但这是客户端的可用性判断，不是引擎缺少评估器：引擎已有 `evaluate_custom_format`，原生路径可传 `SelectedFormat::Resolved`。本项目走原生集成时需自行构造并校验该配置，不能依赖上游 UI 的行为。
- **本项目当前请求只有统帅槽位。**`server/src/lib.rs` 的每席结构只有 `deck` 与 `commanders`，没有 `planarDeck`、`schemeDeck`、`signatureSpell`，也没有队伍字段；四人以上由 `extraOpponents` 表达。接入时空、团队或招牌咒语玩法必须扩展该结构并同步 `ui/platform`。

## 4. 支持矩阵与优先级

| 玩法 | 可复用基础 | phase-mana 主要缺口 | 建议顺序 |
| --- | --- | --- | --- |
| 多系列普通轮抽 / 现开 | 本地全系列卡包、`PackGenerator::for_sequence` | 每包系列配置、服务器校验、UI 选择 | P1 |
| 本地 Cube | `draft-core` 的 Cube 牌源及校验 | 导入、复制数量、牌池持有、组牌校验不再限定为官方系列 | P1 |
| Chaos Draft | `SetLayout::Chaos`、既有随机分配工具 | 合法候选池、保存每席每包分配结果、UI 显示 | P1 |
| Winston | `DraftKind::Winston`、共享牌堆状态机、既有 AI 决策 | 指令适配、视角过滤、取/过牌堆界面和结束组牌 | P1 |
| Commander Draft | `DraftKind::CommanderDraft`、`GameFormat::CommanderDraft` | 双选、60 张组牌规则、统帅指定、四人开局 | P2 |
| Conspiracy / MB2 | `DraftEffect::AdditionalPick` 完整实现 | 其余 draft effect | 已接入 Cogwork Librarian | 已完成 |
| MB1 卡包兼容 | 已下载原始数据及提取器 | — | 跨系列 UUID prints 补齐，已验证 | 已完成 |
| Duel Commander / Pauper Commander / Tiny Leaders | 相应引擎格式 | 各自牌组资格、牌池/禁牌规则、默认参数、主机接入 | P3 |
| Oathbreaker | 格式配置、`signature_spell` 槽位 | 招牌咒语传输、构筑校验、专属施放提示 | P3 |
| Momir | 引擎格式及启动资源 | 玩法入口、徽记交互、合法随机生物来源及 AI | P3 |
| Planechase | 引擎 `planechase()`、共享 `planar_deck` 加载 | **协议缺特殊动作能力**（当前 `local.planar-die-unsupported`）；时空资源与展示 | P4 |
| Two-Headed Giant | 引擎 `two_headed_giant()`（队伍 30 血、固定 4 席） | **协议无队伍/共享生命字段**；UI 视角及 AI | P4 |
| Archenemy | 引擎 `archenemy()`（魔王 40/勇士 20、`scheme_deck`、共享团队回合） | **协议无队伍/阴谋字段**；魔王身份、阴谋展示及操作 | P4，依赖团队协议扩展 |
| 自定义 / Old School 等复古赛制 | 结构化规则和注册表 | 暴露真实可用注册项、保存配置、规则门禁与牌张政策 | P5 |
| 旧版战斗伤害使用堆叠 | 独立设计与引擎相关类型 | 按实际实现状态核对规则、协议和回归，不默认可启用 | P5 独立项目 |
| 在线多人、Premier / Traditional、赛事 | 上游房间和赛事组织器已有实现；赛事权威托管另有提案 | 本项目接入身份、重连、私有视角；新增托管需独立设计 | P6 |

P1 中相互独立的任务可以并行；P2 的多人对局验收复用现有四人桌。P3 不必等待所有特殊轮抽效果完成。

## 5. 分阶段实施

### P0：确定可接入能力，保留现有回归

**改动位置：**`server/src/lib.rs`、`server/src/limited.rs`、`ui/platform/index.ts` 及相关测试；规则缺口落在 Phase。

- 为每个待支持模式列出引擎配置、牌组槽位、需要的提示/响应和结束条件。优先扩展现有请求，不先建立通用插件框架。
- 用户输入只允许经过验证的模式和参数；主机先完成校验，再替换正在进行的会话。
- UI 只显示可用模式；对于本地已有但当前不支持的资源，显示具体原因，避免造成“没下载”的误解。
- 不让 UI 自行计算队伍关系、统帅税或特殊轮抽牌效果。

**验收：**现有普通轮抽、现开、四人 Commander、撤销及隐藏信息测试不退化；无效请求不破坏现有对局。

### P1：普通限制赛变体与 Winston

#### 多系列 / Cube / Chaos

- 多系列以服务器可读取的系列代码序列定义各轮卡包；现开按实际选择的包序列开包。
- Cube 首版支持本地列表导入；先做“牌名 + 数量”即可，不把 CubeCobra 联网导入设为前置依赖。沿用引擎已有数量、牌池大小及重复牌校验。
- 会话保留真实牌池，组牌时校验主牌、备牌及可额外加入的基本地。未使用的牌允许留在牌池区，但不能复制不存在的牌。
- Chaos 从本地可用且适合该流程的系列中抽取；记录每席每轮已分配的系列，不在刷新或撤销时重新随机。特殊张数/特殊选牌要求的系列不能混入普通流程后被截断成固定 15 张。
- 放宽当前 `resolve_setup` 对“官方完整系列牌池”的限制时，应按真实牌源分别校验，而不是允许客户端任意提交最终牌池。

**验收：**固定种子可重放；牌数和重复数量守恒；基本地例外有效；未知牌、缺失系列及非法配置明确报错；普通系列跨表引用完整。

#### Winston

- 复用 `shared_stack` 的动作与玩家视图；接入现有 Winston UI 和指令，不新增平行规则实现。
- AI 必须使用与其座位相同的合法视角。不能把共享暗牌堆或其他玩家私有选择传给 AI 评估器。
- 明确主牌堆耗尽、空牌堆跳过、拒绝全部牌堆、最后一次取牌后的终止行为。
- 撤销一次用户操作时，恢复相关 AI 行动与 RNG，保持与现有普通轮抽相同的语义。

**验收：**用小而固定的牌堆覆盖边界；完整轮抽后进入组牌及真实对局；浏览器网络响应中没有泄露不可见牌。

### P2：Commander Draft 与特殊选牌效果

#### Commander Draft

- 使用引擎专用过程配置，不把普通轮抽的“每步选牌数”改为 2 就结束。
- 首版限定真实适配的 Commander Draft 系列和四席桌；按相应配置处理每包张数、传递、双选及剩余牌数边界。
- 组牌调用 Commander Draft 校验：通常至少 60 张且不强加普通 Commander 的单例限制；统帅身份、搭档/背景及可额外加入的特殊牌以实际规则和系列配置为准。
- 四席分别提交自己的轮抽产物及统帅，启动 `GameFormat::CommanderDraft`，不得走普通 Commander 的 100 张检查。
- AI 的统帅选择、配色和组牌需要专项检查，不能假定普通 Limited 推荐牌组算法足够。

**验收：**完整选牌 → 各席组牌 → 四人对局；校验重复牌、颜色身份、双统帅和不合法统帅；生命、统帅伤害及命令区行为符合专用规则。

#### CNS / MB2

- 从实际卡包中的 `draft_effect` 清单出发，建立“已实现、可投影、可响应、AI 可处理”的逐类表。
- 分别检查公开展示、秘密记录、额外选牌、改变传递/轮抽过程，以及轮抽结果带入对局的效果。
- 对需要并发其他座位决策的效果，不复用“人类选一张后一次性跑完 AI”的假设。
- CNS 中阴谋牌的赛前处理与隐藏议程等需有独立表达，不能混入普通主牌数量后忽略。
- 不能通过过滤掉特殊牌、替换牌或放开校验来宣称支持原始系列。若提供明确标名的定制 Cube，那是另一种产品选项。

**验收：**实际效果能完成交互并正确带入对局；隐藏信息按座位过滤；只有完整满足支持条件的池才进入普通可选列表。

### P3：统帅衍生赛制与 Momir

- 对各衍生赛制直接选择对应 `FormatConfig`，调用同一引擎合法性入口；不要复制 40 血、100 张和单例等普通 Commander 常量。
- Oathbreaker 扩展每席招牌咒语槽位；验证牌类与颜色身份，专项覆盖 Oathbreaker 在场条件、独立税费及离开命令区的规则。
- Pauper Commander、Tiny Leaders 等必须验证其统帅资格、稀有度/法术力值限制及当前引擎可提供的禁牌支持；未具备的合法性能力不能被默认放行。
- Momir 检查启动徽记、支付 X、弃牌及随机生物生成全过程；随机范围不能悄悄缩成 UI 当前缓存的卡牌集合。若卡牌规则未完整支持，必须明确可用池政策。

**验收：**每个模式至少一个有效开局、非法牌组拒绝和关键特殊操作测试；再通过 UI 完成一次代表性流程。

### P4：时空与团队玩法

**Planechase：**引擎已支持共享时空牌组与 `planar_deck` 加载，但适配器当前把掷时空骰判为不支持的动作（`local.planar-die-unsupported`）：`AvailableActionKind` 只有施放、起动异能、撤销法术力三类，掷骰是“特殊动作”，不属于任何一类。因此本阶段**首先是协议扩展**：为特殊动作增加可表达的动作种类，再加时空牌组传输与校验、当前时空/异象展示、混沌触发与换时空结算。展示当前时空不等于规则接入完成。

**Two-Headed Giant：**引擎格式为固定 4 席、队伍共 30 点生命、`team_based=true`；但适配器没有队伍或共享生命的任何字段，快照与提示里都表达不出“哪两席是一队”“队伍生命”“轮到哪队”。本阶段同样先做协议扩展，再接入队伍传递、共享生命/毒、团队行动与攻击/阻挡关系，最后补 UI 视角。普通 FFA 的四个座位不能代替双头巨人。

**Archenemy：**引擎已实现 `OneVsMany`＋共享团队回合、魔王固定为 0 号席、魔王 40 点生命／勇士各 20 点、`scheme_deck` 阴谋牌组可加载；缺口在适配器无法表达魔王身份、阴谋牌和团队回合。本阶段依赖 Two-Headed Giant 引出的团队/共享回合协议能力，随后覆盖翻开阴谋、持续阴谋、离开进行中区域及勇士共享回合的提示与结算。禁止对它套用每个座位独立轮流行动的假设。

**验收：**专用场景覆盖团队行动、目标合法性、共享资源和胜负；AI 不攻击队友；快照与响应保持座位授权；每种支持的专用动作均可从 UI 发出。

### P5：自定义及复古赛制

- 遵循上游结构规则与合法性规则的分层；只开放当前注册表确实允许的定义，不由 UI 拼接一个 `Custom(id)` 即视为有效。原生接入应构造 `SelectedFormat::Resolved(FormatConfig)` 并调用 `validate_name_deck_for_format_full` 之类的完整校验，而不是把裸 `Custom(id)` 当作可直接开局的格式。
- 上游客户端仍禁用保存的自定义赛制开局，但引擎侧评估器已经存在；本项目接入的是原生 `Resolved` 路径，需端到端验证后再开放。
- 保存的配置包含稳定标识和必要规则版本；加载时重新验证，禁止旧配置绕过后来新增的能力门禁。
- 首批接入已注册的 EC Old School 93/94、Old School 95。Swedish Old School 单列重印政策资料确认任务；Middle School 等待战斗伤害入栈能力，Classic Magic 再增加历史牌面文本覆盖。检查版本/重印政策、系列牌池、禁限牌及牌面历史文本，不能只用牌名和现代 Oracle 文本验证复古赛制。
- Mana burn、Wish 对放逐区的访问、旧传奇规则及战斗伤害时机分别验收；它们是不同规则轴，不应捆成一个“旧规则”布尔值。
- 旧版战斗伤害使用堆叠严格按独立方案推进：对象不是咒语或异能；伤害来源/接收者离场、重新进场、先攻/连击、替代效果与反击交互均需覆盖。
- Planechase、Archenemy、Momir 依赖特殊启动资源，不能因为参数表相似就保存成普通 FFA 自定义赛制。

**验收：**每个开放的复古预设既通过规则能力检查，也通过牌张/重印政策检查；配置导入导出后行为一致。上游仍关闭的预设保持关闭。

### P6：在线多人和赛事组织

这阶段是独立项目，不作为本地特殊玩法的交付前提。

- 在线先完成身份、每席授权、断线重连、服务端权威状态、提示版本校验及隐藏信息，再接入真人轮抽。
- Traditional 的 Bo3 必须具备局间换备、先后手、比赛而非单局赛果；Premier 也不能仅靠名字与 Quick 区分。
- 优先接入上游已经实现的赛事核心、协议及 broker，不在 `limited.rs` 内重写瑞士轮。将“组织器接入”与“配对后自动托管比赛”拆成两个交付；后者参考 [HOSTED-MATCHES.md](../../phase/docs/proposals/tournament-organizer/HOSTED-MATCHES.md)，不能宣称现有组织器已经支持。赛事积分政策也不放进游戏格式规则中。
- 组织者权限不等于某条 socket 身份；参考上游 token/凭据轮换与恢复设计。
- 区分单局、match、round、event；多人 Commander 的组桌、平局、退赛及积分不能套用双人两两配对。
- 在线赛果不能由客户端单方面调用现有 gauntlet 的记分指令作为可信裁决。

**验收：**重连不泄露信息，过期凭据失效；赛果与排名可重放；退赛、轮空、平局和多人桌覆盖测试；存储恢复与部署边界有独立说明。

## 6. 文件与仓库责任

| 位置 | 责任 |
| --- | --- |
| `phase-mana/server/src/lib.rs` | 对局启动配置、每席牌组字段、AI 行动循环、错误返回 |
| `phase-mana/server/src/limited.rs` | 本地资源、限制赛会话、既有核心的调用及 DTO 转换 |
| `phase-mana/ui/platform/index.ts`、`ui/phase/transport.ts` | 指令与对局参数传输；不实现游戏规则 |
| `phase-mana/ui/views/Limited.tsx`、`Draft.tsx`、`Sealed.tsx` 及相关组件 | 配置、特殊提示、组牌及游戏入口 |
| `phase/crates/draft-core` | 牌源、发包、选牌程序、特殊轮抽状态及校验 |
| `phase/crates/draft-wasm` / `phase-ai` | 复用的轮抽/组牌辅助与 AI；核对视角限制 |
| `phase/crates/engine` | 格式规则、合法性、特殊区域、团队及历史规则 |
| `phase/crates/manabrew-compat` | 多人/团队及专用提示的无损协议映射 |
| 资源脚本与本地数据 | 不改变真实卡包概率来规避实现限制；大数据文件保持不入 Git |

依赖 Phase 改动的每个交付都要记录对应提交。仅发布 phase-mana 而未提供匹配的 Phase 版本，不算可复现交付。

## 7. 建议的首批任务与交付门槛

建议先做以下小批次，而不是一次打开所有菜单：

1. **资源可用性说明 + MB1 调查**：把三个未开放系列的实际原因展示出来；保留真实资源，修复有明确测试支持的提取问题。
2. **Winston 本地闭环**：已有专门状态机与 UI，适合验证特殊玩法的协议、AI 视角及组牌衔接。
3. **多系列 / 本地 Cube / Chaos**：逐项扩展牌源，避免与特殊轮抽牌规则同时变更。
4. **Commander Draft 四人闭环**：复用已接通的四人桌，补专用选牌与组牌规则。
5. **Oathbreaker 或 Momir 单独交付**：用于验证特殊对局启动资源及操作接口，再推进时空和团队模式。

每批次完成标准：

- 界面操作可走完整条流程，而不仅是 HTTP 接受新 `format` 字符串。
- 一个针对关键边界的引擎/服务测试，以及必要的浏览器流程验证；复用当前测试框架。
- 新玩法不破坏普通轮抽、现开和 Commander 的现有检查。
- 已知不支持的牌、规则或资源在开始前明确拒绝，不在游戏中静默跳过。
- README 更新支持边界、资源要求及可复现验证命令。

本方案不以“解析器接受全部牌”作为完成标准。卡牌解析通过、规则语义正确、AI 能处理、协议能表达、UI 能操作，是需要分别验证的条件。

## 附录 A：现状核对命令

以下命令在相邻 `phase` 仓库根目录运行，用于复核本文档的判断。行号可能变动，匹配内容为准。

```bash
# 1. 引擎已有的格式与构造函数（Archenemy/Planechase/Momir/TwoHeadedGiant/CommanderDraft 等）
rg -n 'pub fn two_headed_giant|pub fn planechase|pub fn archenemy|pub fn momir|pub fn commander_draft' \
  crates/engine/src/types/format.rs

# 2. 拓扑（个人 / 固定队伍 / 一对多）与共享团队回合
rg -n 'pub enum FormatTopology|FixedTeams|OneVsMany|has_shared_team_turns' \
  crates/engine/src/types/format.rs

# 3. Archenemy 起始生命（魔王 40 / 其余 20）与魔王席
rg -n 'starting_life_for_player|archenemy_player' crates/engine/src/types/format.rs

# 4. 已实现的旧规则轴 vs 仍未开放的战斗伤害入栈
rg -n 'IMPLEMENTED_LEGACY_AXES' -A 5 crates/engine/src/types/custom_format.rs
rg -n 'CombatDamageTiming' crates/engine/src/types/custom_format.rs | head

# 5. 自定义赛制注册表（仅 93/94 与 95；Swedish 有意未注册）
rg -n 'pub fn custom_format_registry' -A 3 crates/engine/src/types/custom_format.rs

# 6. 统帅 / 招牌咒语 / 时空 / 阴谋牌组槽位
rg -n 'planar_deck|scheme_deck|signature_spell' crates/engine/src/game/deck_loading.rs | head

# 7. 适配器的已知缺口清单（含 Planechase 掷骰；团队/阴谋无字段）
rg -n 'local\.planar-die-unsupported' crates/manabrew-compat/src/lib.rs
rg -n '\bteam\b|scheme_deck|planar_deck' crates/manabrew-compat/src/lib.rs | wc -l   # 0 = 无团队/时空/阴谋表达

# 8. 赛事组织器已实现面
rg -n 'pub fn build_swiss_round|pub fn build_single_elimination_round|pub fn standings' \
  crates/lobby-broker/src/tournament.rs
```

在本项目根目录运行：

```bash
# 9. 本项目每席请求结构目前只有 deck / commanders；无时空、阴谋或队伍字段
rg -n 'struct OpponentDeck|planar|scheme|signature|team' server/src/lib.rs | head

# 10. Winston 的 UI 与 store 指令已存在，服务端命令仍未实现
rg -n 'winston' ui/views/Winston.tsx ui/stores/useLimitedStore.ts | head
rg -n 'Local Limited command' server/src/limited.rs
```

