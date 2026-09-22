#!/usr/bin/env python3
"""Render the offline Rust audit; run from the repository root after audit_cards."""
import collections
import hashlib
import json
import pathlib
import subprocess
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
data = json.loads((DOCS / 'card-audit.json').read_text())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT.parent / 'phase'), *args], text=True).strip()

def cell(value):
    return str(value).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('|', '&#124;').replace('\n', '<br>')

def gaps(row):
    return '数据库缺失' if row['missing'] else '<br>'.join(cell(g) for g in row['gaps']) or '（无 gap 标签；仍以 playable 为准）'

cards = data['preset_cards']
bad = [r for r in cards if not r['playable']]
missing = [r for r in bad if r['missing']]
affected = collections.defaultdict(list)
for row in bad:
    for ref in row['presets']:
        affected[ref.rsplit(':', 1)[0]].append(row['name'])
manifest = {str(p.relative_to(ROOT)): sha(p) for p in sorted((ROOT / 'public/preset_decks').glob('*.json'))}
source = pathlib.Path(data['database_path'])
metadata = {
    'generated_utc': datetime.now(timezone.utc).isoformat(),
    'engine_commit': git('rev-parse', 'HEAD'),
    'engine_worktree_status': git('status', '--porcelain'),
    'database_sha256': sha(source),
    'database_meta': json.loads(source.read_text()).get('meta') if data['loader'] == 'from_mtgjson' else None,
    'preset_sha256': manifest,
    'source_sha256': {str(p.relative_to(ROOT)): sha(p) for p in [ROOT / 'server/src/main.rs', ROOT / 'server/src/lib.rs', ROOT / 'server/Cargo.lock', ROOT / 'server/examples/audit_cards.rs', pathlib.Path(__file__)]},
}
(DOCS / 'card-audit-provenance.json').write_text(json.dumps(metadata, indent=2, ensure_ascii=False) + '\n')
summary = f'''# Phase 不支持卡牌审计（中文）

## 本次结果

- 生成时间（UTC）：{metadata['generated_utc']}。
- 预设：**{len(data['presets'])}** 个 JSON（排除 `index.json`）；去重牌名 **{len(cards)}**。
- `is_card_playable == false`：**{len(bad)}** 个；其中数据库缺失 **{len(missing)}** 个、已入库但被引擎拒绝 **{len(bad)-len(missing)}** 个。
- 含至少一张上述牌的预设：**{len(affected)} / {len(data['presets'])}**（包括备牌、指挥官、signatureSpell，不等于实际提交主牌时一定报错）。
- 完整加载数据库：**{data['database_rules']}** 条 CardRules，**{data['database_face_names']}** 个不同牌面名称，其中 **{len(data['database_unsupported'])}** 个牌面名称未通过同一门禁。
- 预设中通过门禁但 `card_face_gaps` 非空：**{sum(r['playable'] and bool(r['gaps']) for r in cards)}** 个；两个 API 的检查范围不完全相同，不将它们混为一个指标。

## 数据来源、版本与范围

- 数据库：`{data['database_path']}`；加载器 `{data['loader']}`。
- MTGJSON meta：`{json.dumps(metadata['database_meta'], ensure_ascii=False)}`。
- 数据库 SHA-256：`{metadata['database_sha256']}`。
- Phase engine 提交：`{metadata['engine_commit']}`；工作树状态：{'干净' if not metadata['engine_worktree_status'] else '有本地修改，见 provenance'}。
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

`server/src/main.rs` 优先使用 `PHASE_CARD_DB`；否则优先本地 `../../phase/data/mtgjson/AtomicCards.json`，不存在才退回小型 `test_fixture.json`。它用前 16 字节是否以 `{{"meta"` 开头来区分 MTGJSON 与预解析 export，审计工具刻意使用相同检测。带 BOM/前导空格的其他 JSON 排版不能依此可靠识别。**未核实在线进程实际加载的路径或二进制版本，因此本结果不是对在线 host 状态的声明。**

## 复现

在 phase-mana 仓库根目录运行（需要同级 phase 源码及数据库；无需启动服务）：

```sh
cargo run --manifest-path server/Cargo.toml --example audit_cards -- \\
  /home/jeb/code/phase/data/mtgjson/AtomicCards.json \\
  public/preset_decks docs/card-audit.json
python3 docs/render_card_audit.py
```

加载并解析全库可能需要数分钟，debug 构建尤其慢；请允许命令完成。example 的路径是显式参数，不继承在线 host 的数据库选择。输出排序稳定；时间戳不是稳定内容。渲染步骤应紧接审计运行，期间不要更新 engine、数据库或预设。

## 结果文件

- [预设全部拒绝牌名及 gaps](unsupported-preset-cards.zh-CN.md)：按牌名列出所有受影响预设/区域，并提供逐预设汇总。
- [完整加载库的拒绝牌面名及 gaps](unsupported-database-faces.zh-CN.md)。
- [机器可读结果](card-audit.json)：预设全量检查（通过与拒绝）、完整库拒绝列表、牌名解析结果、原始 gaps。
- [版本和输入指纹](card-audit-provenance.json)。
'''
(DOCS / 'unsupported-cards.zh-CN.md').write_text(summary)
lines = ['# 预设不支持卡牌明细', '', '范围、判定与复现见 [审计说明](unsupported-cards.zh-CN.md)。预设引用格式为 `文件名（不含 .json）:区域`；同一张牌在同一预设多个区域可出现多次。', '', '| 牌名 | 解析牌面 | gaps / 缺失 | 受影响预设与区域 |', '| --- | --- | --- | --- |']
for r in bad:
    lines.append(f"| {cell(r['name'])} | {cell(r['resolved_face'] or '—')} | {gaps(r)} | {'<br>'.join(cell(s) for s in r['presets'])} |")
lines += ['', '## 逐预设汇总（全部预设）', '', '| 预设文件名 | 标签 | 拒绝的不同牌名数 | 拒绝牌名 |', '| --- | --- | ---: | --- |']
for preset, label in data['presets'].items():
    names = sorted(set(affected[preset]))
    lines.append(f"| {cell(preset)} | {cell(label)} | {len(names)} | {'<br>'.join(cell(n) for n in names) or '—'} |")
(DOCS / 'unsupported-preset-cards.zh-CN.md').write_text('\n'.join(lines) + '\n')
lines = ['# 完整加载数据库：不支持牌面明细', '', '这不是所有 MTG 印刷版本的清单；按本次数据库唯一牌面名及 host 门禁判定。范围、版本与限制见 [审计说明](unsupported-cards.zh-CN.md)。', '', '| 牌面名 | gaps |', '| --- | --- |']
for r in data['database_unsupported']:
    lines.append(f"| {cell(r['name'])} | {gaps(r)} |")
(DOCS / 'unsupported-database-faces.zh-CN.md').write_text('\n'.join(lines) + '\n')
print(f"presets={len(data['presets'])}, names={len(cards)}, rejected={len(bad)}, missing={len(missing)}, affected={sum(bool(v) for v in affected.values())}, db_faces={data['database_face_names']}, db_rejected={len(data['database_unsupported'])}")
