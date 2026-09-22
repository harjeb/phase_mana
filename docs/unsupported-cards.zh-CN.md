# Phase 不支持卡牌审计（中文）

## 本次结果

- 生成时间（UTC）：2026-09-22T13:07:02.621726+00:00。
- 预设：**68** 个 JSON（排除 `index.json`）；去重牌名 **1527**。
- `is_card_playable == false`：**10** 个；其中数据库缺失 **0** 个、已入库但被引擎拒绝 **10** 个。
- 含至少一张上述牌的预设：**10 / 68**（包括备牌、指挥官、signatureSpell，不等于实际提交主牌时一定报错）。
- 完整加载数据库：**36046** 条 CardRules，**36046** 个不同牌面名称，其中 **2834** 个牌面名称未通过同一门禁。
- 预设中通过门禁但 `card_face_gaps` 非空：**2** 个；两个 API 的检查范围不完全相同，不将它们混为一个指标。

## 数据来源、版本与范围

- 数据库：`/home/jeb/code/phase/data/mtgjson/AtomicCards.json`；加载器 `from_mtgjson`。
- MTGJSON meta：`{"date": "2026-09-21", "version": "5.3.0+20260921"}`。
- 数据库 SHA-256：`3bbeaad1a067ef5f85a6b3b66a4b185719b6e087e8e17edf9eea76979e5a7c35`。
- Phase engine 提交：`8843c6825c297bc8107a38c4f8e13ca6e9daa2dd`；工作树状态：干净。
- phase-mana 当前目录无 Git 元数据；入口、host、Cargo.lock、审计工具以及全部预设文件的 SHA-256 见 [来源清单](card-audit-provenance.json)。
- 这是**本地 AtomicCards 快照经过当前 loader 后的完整数据库牌面扫描**，不是所有时代、所有版本 MTG 卡牌的永恒完整清单，也不是 Forge 数据库/其他导出库的审计。
- 预设去重按 JSON 中原始牌名；涵盖 `cards`、`sideboard`、`commander`、`signatureSpell`。不把图像、`allParts` 衍生物引用、封面牌、`opponent` 预设 ID 算作牌表条目；不按份数重复检查。
- 完整数据库按 `CardDatabase::card_names()` 扫描加载后的唯一牌面名（含可索引背面），不是印刷版本数量；未进入 loader 索引的原始记录不属于此计数。

## 判定方法与限制

1. 每个预设唯一牌名均调用 `is_card_playable(&db, name)`，找到牌面后调用 `card_face_gaps(face)`。不是只记录每套牌的首个失败；所有拒绝牌名、全部原始 gap 标签及受影响预设均保留。
2. **数据库缺失**表示 `get_face_by_name` 无结果，可能是名称/别名、数据库过旧或库不完整，不能直接断言该机制不受支持。
3. **已入库但不支持**表示本次门禁拒绝。`Effect:Unimplemented` 等通常涉及 Oracle 文本解析回退或未实现部分；其他标签可能是 keyword、trigger、static 等处理器覆盖缺口。gap 是诊断标签，不足以单独证明具体根因，也不代表整种机制的所有牌都坏了。
4. host 的 `is_card_playable` 主要检查解析结果中的未实现标记；`card_face_gaps` 还检查处理器覆盖，因此两者不保证等价。本报告“拒绝/不支持”总数严格以 host 门禁为准。预设所有检查结果（包括通过者的 gaps）见 JSON。
5. 名称解析可能只选中多面牌的一面；预设门禁不会自动证明其他牌面正确。完整库附录逐牌面扫描，可以补充查看背面，但不把背面结果反向冒充 host 对正面的拒绝。
6. **通过检查不保证卡牌规则、交互、AI、目标选择、复杂组合或实际对局完全正确**，也不验证赛制合法性、牌数及指挥官规则。本审计未运行逐牌对局测试。

## 为什么不使用启动 API 扫描

`server/src/lib.rs` 仅注册 `POST /api/start`、`POST /api/respond`、`GET /api/state`，没有无副作用的卡牌验证/全库导出端点。`Host::start` 要求每边 7–250 个牌名，按顺序遇到首个不支持牌即返回错误；全部通过则进入创建对局流程，可能替换当前会话。这里直接运行独立 example，不访问端口、不重启 host、不改变在线会话。

`server/src/main.rs` 优先使用 `PHASE_CARD_DB`；否则优先本地 `../../phase/data/mtgjson/AtomicCards.json`，不存在才退回小型 `test_fixture.json`。它用前 16 字节是否以 `{"meta"` 开头来区分 MTGJSON 与预解析 export，审计工具刻意使用相同检测。带 BOM/前导空格的其他 JSON 排版不能依此可靠识别。**未核实在线进程实际加载的路径或二进制版本，因此本结果不是对在线 host 状态的声明。**

## 复现

在 phase-mana 仓库根目录运行（需要同级 phase 源码及数据库；无需启动服务）：

```sh
cargo run --manifest-path server/Cargo.toml --example audit_cards -- \
  /home/jeb/code/phase/data/mtgjson/AtomicCards.json \
  public/preset_decks docs/card-audit.json
python3 docs/render_card_audit.py
```

加载并解析全库可能需要数分钟，debug 构建尤其慢；请允许命令完成。example 的路径是显式参数，不继承在线 host 的数据库选择。输出排序稳定；时间戳不是稳定内容。渲染步骤应紧接审计运行，期间不要更新 engine、数据库或预设。

## 结果文件

- [预设全部拒绝牌名及 gaps](unsupported-preset-cards.zh-CN.md)：按牌名列出所有受影响预设/区域，并提供逐预设汇总。
- [完整加载库的拒绝牌面名及 gaps](unsupported-database-faces.zh-CN.md)。
- [机器可读结果](card-audit.json)：预设全量检查（通过与拒绝）、完整库拒绝列表、牌名解析结果、原始 gaps。
- [版本和输入指纹](card-audit-provenance.json)。
