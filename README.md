# phase-mana

**English** · [简体中文](#简体中文)

Play real *Magic: The Gathering* games locally against the **phase.rs** rules engine and **Phase AI**, rendered by **ManaBrew's** client.

在本地使用 **phase.rs** 规则引擎与 **Phase AI**，配合 **ManaBrew** 客户端，进行真实的万智牌对局。

`AGPL-3.0-or-later` · [`LICENSE`](LICENSE) · [`NOTICE`](NOTICE) · [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md)

---

## English

### What this is

phase-mana is a local session host that plays real games on phase.rs with the Phase AI, using ManaBrew's client for the board and prompts. Each layer owns its own job:

| Layer | Comes from | Owns |
| --- | --- | --- |
| Rules, legal actions, targeting, hidden information | `phase-engine` (`../phase`) | all game logic |
| Opponent decisions | `phase-ai` (`../phase`) | priority, combat, choices |
| Wire protocol, state/response conversion | `manabrew-compat` (`../phase`) | snapshot, prompt, and response translation |
| Board, prompts, animations, i18n, theme | ManaBrew's React/Pixi client (copied into `ui/`) | display + dispatch only |
| Local session host | `server/` (this repo) | HTTP, trusted player identity, AI loop, errors |

This checkout builds the sibling `../phase` crates through path dependencies. It requires the local Phase card fixes, 2–4-player compatibility, and native `draft-wasm` helper exports. Those changes live in the separate Phase repository, so publishing phase-mana alone does not include them. The original `../manabrew` checkout is left untouched.

### Requirements

- **Node >= 24.**
- **Rust** on the channel pinned by `rust-toolchain.toml` (the same nightly as phase). `rustup` installs it automatically when you run `cargo` in this directory; if Rust is missing entirely:
  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  export PATH="$HOME/.cargo/bin:$PATH"   # add to your shell profile
  ```
  `cargo` must be on `PATH` for `npm run server` / `npm run test:server`.
- **A sibling `phase` checkout**, named `phase` and sitting next to this checkout (e.g. `../phase` next to `../phase-mana`). It supplies the engine, AI, and adapter crates, plus the default card database.

### Quick start

```sh
npm install

# one-time: fetch the bulk resources (preset decks, token archive, images)
scripts/fetch-resources.sh              # uses ../manabrew; override with MANABREW_DIR=/path/to/manabrew

# terminal 1 — engine/AI host on 127.0.0.1:3001
npm run server

# terminal 2 — UI on 127.0.0.1:1420
npm run dev
```

Open <http://127.0.0.1:1420>. The first run walks through a terms gate (tick the box) and a nickname step (**Let's brew**) — both work offline; the nickname is stored locally only.

Bulk resource data is intentionally not committed (preset-deck JSON, `token_archive.json`, the public/UI images). Fetch it once from a ManaBrew checkout before the first run, as shown above.

### Features

**Play**
- **Offline vs AI** — pick your deck and the AI's from the bundled presets; both must share a format or **Fight!** stays disabled. The offline picker and `#/deck-editor` are the deck selection for local play.
- **Commander** — Phase's Commander rules in local 2–4-player games: 40 life, separate command zones, and engine validation of every 100-card deck (commanders, singleton, colour identity, commander eligibility). Choose **4-player pod** for one human and three AI opponents.
- **Casual Modes** (`#/play/offline/casual`) — Oathbreaker, Tiny Leaders, Duel Commander, Pauper Commander, Old School 93/94 and 95, Momir, Archenemy, Planechase, and Two-Headed Giant.
- **Draft & Sealed** (`#/limited`) — Quick Draft (2–8 seats, three packs, one card per pick), six-pack Sealed, **Winston Draft**, **Cube / imported pool**, **Themed Chaos Draft**, **Commander Draft** (CR 903.13), and the Conspiracy/Mystery Booster special pick (Cogwork Librarian, CR 905.2). Phase's `draft-core` collates real MTGJSON booster sheets and runs the same AI.

**Shell** — deck editor, card search, collection, and settings are reachable through the hash router: `#/play`, `#/deck-editor`, `#/search`, `#/limited`, `#/settings`, `#/about`.

**Card art** — a local Forge-`cardsfolder`-shaped library first, Scryfall for anything missing.

**Interface language** — English and **Simplified Chinese (`zh-Hans`)**, fully translated with Lingui; the language is chosen in the settings.

### Card database

The host picks the engine card database in this order:

1. `../phase/data/card-data.json` — a pre-parsed `oracle-gen` export from phase's pipeline (loads in seconds).
2. `../phase/data/mtgjson/AtomicCards.json` — raw MTGJSON; its Oracle text is parsed at startup (2026-09-21 vintage: 36,046 cards, ~2 min and ~1.3 GB).
3. `../phase/data/mtgjson/test_fixture.json` — the 87-card fixture that ships with phase, so the demo deck works with no download.

Both database shapes the engine reads are accepted. Override with `PHASE_CARD_DB`.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PHASE_MANA_PORT` | `3001` | host port |
| `PHASE_CARD_DB` | see above | engine card database |
| `PHASE_MANA_CARD_IMAGES` | `card-images` | local card-image library, laid out like Forge's `cardsfolder`: `<letter>/<forge stem>.full.webp`. Misses fall back to Scryfall |
| `PHASE_MANA_DRAFT_POOLS` | `resources/draft-pools` | booster pools for draft/sealed; override with an absolute path if you run from elsewhere |

The card-image library can also be chosen in **Settings → Card image library → Browse… → Use folder** (中文：**设置 → 卡图库目录 → 浏览… → 使用此文件夹**). Select the root that contains the letter folders (`a`, `b`, …), not an individual letter folder; pasting a path works too. The native picker runs on the machine hosting the UI server (Windows/macOS, or Linux with `zenity`).

Without a deck of your own, the host still has a casual 60-card demo (24 Forest, 36 Grizzly Bears) it falls back to for either seat. The UI reaches the host through the Vite `/api` proxy — the host binds `127.0.0.1` only and serves no CORS headers.

### Project layout

```
ui/                     ManaBrew client (copied), plus:
  phase/                transport.ts — host session start / rehydrate / respond
  platform/             local web platform adapter -> Phase host
  router.tsx            ManaBrew's hash-routed shell (#/play, …)
  game/                 runtime registry: single "Phase engine + Phase AI" runtime
  i18n/locales/         Lingui catalogs (en, zh-Hans, zh-Hant, …)
index.html              the single entry -> ui/main.tsx
server/                 local Axum host: session, AI loop, trusted identity, errors
tools/generate-types/   regenerates ui/protocol + ui/api/hubTypes.ts from the
                        upstream protocol crates, without building them
pm-e2e.mjs              browser end-to-end harness (a full game)
pm-return.mjs           browser harness: concede, return, restart
pm-commander.mjs        browser harness: Commander picker, payload, 40 life, zones
docs/                   card/parser audits and design notes
```

### Development

```sh
npm run check            # tsc --noEmit
npm run build            # type-check + production Vite build
npm run server           # Axum host (see server/README.md for the API)
npm run test:server      # server integration tests
npm run e2e              # full browser game (needs server + dev running)
npm run e2e:leave        # concede / return / restart
npm run check:card-images
npm run extract          # refresh the Lingui catalogs (tools/lingui-extract.mjs)
npm run download:scryfall
```

The browser harnesses drive the store through a dev-only handle (`window.__pm`, set in `ui/phase/transport.ts` when `import.meta.env.DEV`) so they exercise the same actions the UI dispatches instead of guessing canvas coordinates.

Regenerate the protocol types after the upstream crates change:

```sh
tools/generate-types/generate.sh
```

Host API: `POST /api/start` (`{seed?, format?, humanDeck?, aiDeck?, humanCommanders?, aiCommanders?, extraOpponents?}`), `POST /api/respond` (a `manabrew-compat` `ClientToServerMessage`), and `GET /api/state` (cached, never advances). Success is `{state, prompt, humanPlayerId, aiActions}`; failures are `{"error": "diagnostic"}` with 400 for engine rejection, 409 for a stale/replayed prompt, and 422 for a state the adapter cannot render. Exact JSON: [`server/README.md`](server/README.md).

### Status and limitations

- **One local session, one human seat.** The host fixes the human to engine `PlayerId(0)` / wire `player-0` and the AI to seat 1; the client never supplies a trusted actor. No multiplayer, accounts, matchmaking, or persistence. The Multiplayer tab still needs ManaBrew's online service — these tables run locally against AI.
- **Unsupported interactions fail loudly.** If the engine reaches a state the ManaBrew adapter cannot render, the host returns 422 naming the engine's own `WaitingFor` variant and who owes it, and the previous prompt stays intact. Nothing is auto-answered, skipped, or guessed.
- **Parser coverage is phase's, not this repo's.** This version gives you the real engine's behaviour, including its gaps. On the 2026-09-21 database, 58/68 preset decks start and 2,834/36,046 database faces are refused by the same gate; the full per-card scan is in [`docs/unsupported-cards.zh-CN.md`](docs/unsupported-cards.zh-CN.md).
- **ManaBrew backends are off**: the Forge/WASM engine, Ironsmith runtime, deck hub, accounts, email sign-in, snapshot restore, and the external usage telemetry the copied UI would otherwise report. The first-run gate works offline — tick the terms checkbox and pick any nickname; nothing is registered anywhere and the name is stored in this browser.
- **Protocol versions differ by build, not by behaviour.** The host pins `manabrew-protocol = "=5.2.0"` to match phase's lockfile, while the generated TypeScript types in `ui/protocol/` are newer. Every newer-only field the UI reads is optional-guarded, so those elements simply do not render.

### Licensing

`AGPL-3.0-or-later` — see [`LICENSE`](LICENSE).

| Component | License |
| --- | --- |
| This project (`server/`, tooling, docs) | AGPL-3.0-or-later |
| ManaBrew client copied into `ui/` | AGPL-3.0-or-later |
| `manabrew-compat` (`../phase`) | AGPL-3.0-or-later |
| `manabrew-protocol` (crates.io) | AGPL-3.0-or-later |
| phase engine / AI / core crates (`../phase`) | MIT OR Apache-2.0 |
| ManaBrew protocol crates under `tools/generate-types/` | GPL-3.0-or-later |
| Forge (referenced, not vendored) | GPL-3.0-or-later |

Sources: `phase` at commit `8843c68`, `manabrew` at commit `62ff9e7`. See [`NOTICE`](NOTICE) and [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md) for attribution and full license-text locations.

---

## 简体中文

### 项目简介

phase-mana 是一个本地对局宿主：用 **phase.rs** 规则引擎和 **Phase AI** 运行真实的万智牌对局，界面由 **ManaBrew** 客户端渲染。每一层各司其职：

| 层 | 来源 | 负责 |
| --- | --- | --- |
| 规则、合法动作、指定目标、隐藏信息 | `phase-engine`（`../phase`） | 全部对局逻辑 |
| 对手决策 | `phase-ai`（`../phase`） | 优先权、战斗、选择 |
| 通信协议、状态/响应转换 | `manabrew-compat`（`../phase`） | 快照、提示与响应的翻译 |
| 棋盘、提示、动画、国际化、主题 | ManaBrew 的 React/Pixi 客户端（已复制到 `ui/`） | 仅显示与派发 |
| 本地会话宿主 | `server/`（本仓库） | HTTP、可信玩家身份、AI 循环、错误 |

本仓库通过 path 依赖编译同级的 `../phase` crates，依赖 phase 仓库中的本地卡牌修复、2–4 人兼容支持以及原生 `draft-wasm` 辅助导出。这些改动位于单独的 phase 仓库，因此**单独发布 phase-mana 并不包含它们**。原始的 `../manabrew` 检出保持不变。

### 环境要求

- **Node >= 24。**
- **Rust**：使用 `rust-toolchain.toml` 钉住的 channel（与 phase 相同的 nightly）。在本目录运行 `cargo` 时 `rustup` 会自动安装；若尚未安装 Rust：
  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  export PATH="$HOME/.cargo/bin:$PATH"   # 写进你的 shell 配置
  ```
  `npm run server` / `npm run test:server` 需要 `cargo` 在 `PATH` 上。
- **一个同级 `phase` 检出**，目录名为 `phase`，与本仓库并排（例如 `../phase` 与 `../phase-mana`）。它提供引擎、AI、适配器 crates，以及默认卡牌数据库。

### 快速开始

```sh
npm install

# 一次性：拉取批量资源（预设卡组、token 归档、图片）
scripts/fetch-resources.sh              # 默认用 ../manabrew；可用 MANABREW_DIR=/path/to/manabrew 覆盖

# 终端 1 — 引擎/AI 宿主，监听 127.0.0.1:3001
npm run server

# 终端 2 — 界面，监听 127.0.0.1:1420
npm run dev
```

打开 <http://127.0.0.1:1420>。首次运行会经过条款确认（勾选）和昵称步骤（**Let's brew**），两者均可离线完成，昵称只保存在本地。

批量资源有意不提交（预设卡组 JSON、`token_archive.json`、public/UI 图片）。首次运行前按上面的命令从 ManaBrew 检出拉取一次即可。

### 功能

**对局**
- **离线对战 AI** —— 从内置预设中分别选择你和 AI 的卡组；两副卡组格式必须一致，否则 **Fight!** 不可用。离线选择器与 `#/deck-editor` 就是本地对局的选牌入口。
- **指挥官** —— 本地 2–4 人对局使用 Phase 的指挥官规则：40 点生命、独立指挥区，并对每副 100 张卡组（指挥官、单张、颜色标识、指挥官资格）做引擎校验。选择 **4-player pod** 即可 1 人对 3 个 AI。
- **休闲模式**（`#/play/offline/casual`）—— Oathbreaker、Tiny Leaders、Duel Commander、Pauper Commander、Old School 93/94 与 95、Momir、Archenemy、Planechase、双头巨人。
- **轮抽与现开**（`#/limited`）—— 快速轮抽（2–8 人，三包，每挑一张）、六包现开、**Winston Draft**、**Cube / 导入牌池**、**主题混沌轮抽**、**指挥官轮抽**（CR 903.13），以及 Conspiracy/Mystery Booster 的特殊挑牌（Cogwork Librarian，CR 905.2）。Phase 的 `draft-core` 会拼装真实的 MTGJSON 补充包表，并由同一个 AI 完成选牌与组牌。

**界面** —— 卡组编辑器、卡牌搜索、收藏、设置，均为 hash 路由：`#/play`、`#/deck-editor`、`#/search`、`#/limited`、`#/settings`、`#/about`。

**卡图** —— 优先使用本地 Forge `cardsfolder` 形态的卡图库，缺失的才回退 Scryfall。

**界面语言** —— 英文与**简体中文（`zh-Hans`）**，已用 Lingui 完整翻译；在设置中选择语言。

### 卡牌数据库

宿主的引擎卡库按以下顺序选择：

1. `../phase/data/card-data.json` —— phase 流水线生成的预解析 `oracle-gen` 导出（秒级加载）。
2. `../phase/data/mtgjson/AtomicCards.json` —— 原始 MTGJSON，启动时解析 Oracle 文本（2026-09-21 版本：36,046 张，约 2 分钟、约 1.3 GB）。
3. `../phase/data/mtgjson/test_fixture.json` —— phase 自带的 87 张 fixture，无需下载即可让演示卡组可用。

引擎能读的两种数据库形态都接受。可用 `PHASE_CARD_DB` 覆盖。

### 配置

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `PHASE_MANA_PORT` | `3001` | 宿主端口 |
| `PHASE_CARD_DB` | 见上 | 引擎卡牌数据库 |
| `PHASE_MANA_CARD_IMAGES` | `card-images` | 本地卡图库，布局同 Forge 的 `cardsfolder`：`<字母>/<forge stem>.full.webp`；缺失时回退 Scryfall |
| `PHASE_MANA_DRAFT_POOLS` | `resources/draft-pools` | 轮抽/现开用的补充包池；从其他目录运行时用绝对路径覆盖 |

卡图库也可在 **设置 → 卡图库目录 → 浏览… → 使用此文件夹** 中选择。请选择包含字母文件夹（`a`、`b` …）的根目录，而不是单个字母文件夹；也可以直接粘贴路径。原生选择器运行在托管 UI 服务的那台机器上（Windows/macOS，或带 `zenity` 的 Linux）。

没有自己的卡组时，宿主仍有一副休闲 60 张演示牌（24 Forest、36 Grizzly Bears）作为任一席位的兜底。界面通过 Vite 的 `/api` 代理访问宿主——宿主只绑定 `127.0.0.1`，且不发送 CORS 头。

### 目录结构

```
ui/                     ManaBrew 客户端（已复制），另含：
  phase/                transport.ts —— 宿主会话的启动 / 恢复 / 响应
  platform/             本地 web 平台适配层 -> Phase 宿主
  router.tsx            ManaBrew 的 hash 路由外壳（#/play 等）
  game/                 运行时注册表：唯一的「Phase 引擎 + Phase AI」运行时
  i18n/locales/         Lingui 词条（en、zh-Hans、zh-Hant 等）
index.html              唯一入口 -> ui/main.tsx
server/                本地 Axum 宿主：会话、AI 循环、可信身份、错误
tools/generate-types/  从上游协议 crates 重新生成 ui/protocol 与
                       ui/api/hubTypes.ts（无需编译它们）
pm-e2e.mjs              浏览器端到端脚本（完整一局）
pm-return.mjs           浏览器脚本：认输、返回、重开
pm-commander.mjs        浏览器脚本：指挥官选择器、载荷、40 点生命、指挥区
docs/                   卡牌/解析器审计与设计文档
```

### 开发

```sh
npm run check            # tsc --noEmit
npm run build            # 类型检查 + 生产 Vite 构建
npm run server           # Axum 宿主（API 见 server/README.md）
npm run test:server      # 服务端集成测试
npm run e2e              # 浏览器完整对局（需先启动 server 与 dev）
npm run e2e:leave        # 认输 / 返回 / 重开
npm run check:card-images
npm run extract          # 刷新 Lingui 词条（tools/lingui-extract.mjs）
npm run download:scryfall
```

浏览器脚本通过仅在开发环境启用的句柄（`window.__pm`，定义于 `ui/phase/transport.ts` 的 `import.meta.env.DEV` 分支）驱动 store，从而复现界面派发的同一批动作，而不是猜测画布坐标。

上游协议 crates 变更后，重新生成 TypeScript 协议类型：

```sh
tools/generate-types/generate.sh
```

宿主 API：`POST /api/start`（`{seed?, format?, humanDeck?, aiDeck?, humanCommanders?, aiCommanders?, extraOpponents?}`）、`POST /api/respond`（`manabrew-compat` 的 `ClientToServerMessage`）、`GET /api/state`（有缓存，绝不推进状态）。成功返回 `{state, prompt, humanPlayerId, aiActions}`；失败返回 `{"error": "diagnostic"}`，其中 400 为引擎拒绝、409 为过期/重放的提示、422 为适配层无法渲染的状态。完整 JSON 见 [`server/README.md`](server/README.md)。

### 状态与限制

- **单一本地会话、单一人类席位。** 宿主把人类固定为引擎 `PlayerId(0)` / 线协议 `player-0`，AI 固定为 1 号位；客户端从不提供可信操作者。没有联机、账号、匹配或持久化。Multiplayer 标签页仍依赖 ManaBrew 的在线服务——这里的牌桌全部是本地对 AI。
- **不支持的交互会明确报错。** 若引擎进入 ManaBrew 适配层无法渲染的状态，宿主返回 422，并给出引擎自己的 `WaitingFor` 变体及欠谁的响应，同时保留原有提示。绝不自动应答、跳过或猜测。
- **解析器覆盖率取决于 phase，而非本仓库。** 本版本提供真实引擎的行为，也包含它的空白。在 2026-09-21 数据库上，68 副预设中有 58 副可启动，36,046 个牌面中有 2,834 个被同一道门禁拒绝；完整的逐卡扫描见 [`docs/unsupported-cards.zh-CN.md`](docs/unsupported-cards.zh-CN.md)。
- **ManaBrew 的后端均已关闭**：Forge/WASM 引擎、Ironsmith 运行时、卡组 Hub、账号、邮箱登录、快照恢复，以及被复制界面原本会上报的外部埋点。首次运行的条款门槛可离线完成——勾选条款并随便填一个昵称即可；不会在任何地方注册，昵称保存在本浏览器。
- **协议版本按构建而异，而非按行为而异。** 宿主将 `manabrew-protocol` 钉在 `"=5.2.0"` 以匹配 phase 的 lockfile，而 `ui/protocol/` 中生成的 TypeScript 类型较新。界面读取的每个较新字段都做了可选保护，因此这些元素不会渲染，而不会显示臆造值。

### 许可

`AGPL-3.0-or-later` —— 见 [`LICENSE`](LICENSE)。

| 组件 | 许可 |
| --- | --- |
| 本项目（`server/`、工具、文档） | AGPL-3.0-or-later |
| 复制到 `ui/` 的 ManaBrew 客户端 | AGPL-3.0-or-later |
| `manabrew-compat`（`../phase`） | AGPL-3.0-or-later |
| `manabrew-protocol`（crates.io） | AGPL-3.0-or-later |
| phase 引擎 / AI / 核心 crates（`../phase`） | MIT OR Apache-2.0 |
| `tools/generate-types/` 下的 ManaBrew 协议 crates | GPL-3.0-or-later |
| Forge（仅引用，未内联） | GPL-3.0-or-later |

来源：`phase` 提交 `8843c68`，`manabrew` 提交 `62ff9e7`。署名与完整许可证文本见 [`NOTICE`](NOTICE) 与 [`THIRD-PARTY-LICENSES.md`](THIRD-PARTY-LICENSES.md)。
