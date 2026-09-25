# 主机模式联机与邀请码设计（Forge 式本机主机）

> 状态：本地联机已实现，正在收敛审查发现的问题；历史验收记录不代表独立机器或公网已经验证。文件名保留历史上的 `p2p`，方案不使用 P2P/WebRTC。
>
> 当前启动步骤：先准备 `../phase/data/mtgjson/AtomicCards.json`，运行 `npm run host:build`，再启动 `npm run server` 与 `npm run dev`。构建脚本在 `.phase-host/source` 独立工作树固定 `27f190967c3eff7a54794078c654df05d0c66045`，编译兼容引擎和卡库导出器，不修改兄弟仓库检出版本。
>
> 控制 API 仅允许 loopback Host 和本地 UI Origin，POST 必须带 `X-Phase-Host: 1`。引擎默认开放 LAN；`PHASE_HOST_LAN=0` 关闭。`PHASE_HOST_PORT` 可固定转发端口。公网地址只表示广告值，不保证 DNS、TLS、隧道或防火墙已可用。
> 已确认方向：房主本机运行 Phase 原生引擎，通过 WebSocket 接受玩家连接；保留 ManaBrew UI；朋友粘贴邀请码加入，不需要手输 IP，不需要回传应答码。
> 不使用 WebRTC、PeerJS、应用层 ICE/STUN/TURN，不要求部署专用游戏服务器或邀请码查询服务。

## 1. 目标与边界

- 房主同时是玩家：点击「开房」，本机启动 Phase 多人服务，房主占一个席位。
- 房主复制邀请码发给朋友；朋友选牌表、粘贴邀请码即可加入，不需要输入 IP 或端口。
- 规则、随机数、合法动作与结算都在房主本机的 Phase 引擎内。
- 同一邀请码可邀请多个朋友，各自获得独立席位。
- 网络默认直连，可选 UPnP 映射路由器端口；不可达时使用玩家已有的虚拟局域网或 WebSocket 隧道。
- 不做账号、匹配、全球房间目录、主机迁移或新的游戏协议。

「不需要输入 IP」是交互目标，不是「连接不需要地址」。邀请码携带地址，由客户端解析。邀请码不隐藏 IP，也不解决网络可达性。

## 2. 现状：可直接复用的部分（已核对代码）

| 能力 | 位置与事实 |
| --- | --- |
| 权威多人服务 | `../phase/crates/phase-server`，Full 模式，同时提供 ManaBrew 投影 |
| 开房消息 | `ClientMessage::CreateGameWithSettings { deck, display_name, public, password, timer_seconds, player_count }`（`main.rs:4879`） |
| 入房消息 | `JoinGameWithPassword { game_code, deck, display_name, password }` |
| 房间码 | `generate_game_code()`：6 位 `A–Z0–9`（`server-core/src/session.rs:2858`） |
| 席位令牌 | `generate_player_token()`：32 位十六进制（同文件 `:2866`） |
| 人数上限 | `MAX_FULL_GAME_PLAYER_COUNT = 6`，服务端按 `clamp(2, 6)` 处理（`server-core/src/ai_seats_wire_guard.rs:13`、`phase-server/src/main.rs:1293`） |
| 入房密码 | `password: Option<String>`，上限 128 字节（`lobby-broker/src/validation.rs:26`），服务端**明文比较** `expected == provided`（`lobby-broker/src/lobby.rs:417`），失败回 `password_required` / `Wrong password`；已有 8 个单测覆盖正确/错误/缺失/房间不存在/超长（`cargo test -p lobby-broker password` 全通过）|
| 监听参数 | `--port` 默认 `9374`、`--bind` 默认 `0.0.0.0`、`--exit-on-stdin-close`（`phase-server/src/main.rs:853`） |
| Origin 校验 | `--allowed-origin` 为**单个精确匹配**字符串；不传则该检查被跳过（`phase-server/src/main.rs:4207`）|
| 可分享地址 | `ServerHello.public_url`：供分享 join code 使用的公共基址，来自 `--public-url` 或内嵌隧道（`server-core/src/protocol.rs:694`、`phase-server/src/main.rs:2831`）。phase-mana 的 `online.ts` **目前没读这个字段** |
| 内嵌隧道 | `--features ngrok` + `NGROK_AUTHTOKEN`：官方内嵌 ngrok 隧道，让自建主机无需端口映射与 TLS 即可分享（`phase-server/Cargo.toml:44`、`main.rs:4148`）；默认关闭 |
| ManaBrew 投影开关 | `manabrew` 是 phase-server 的 **opt-in feature**（`phase-server/Cargo.toml:40`），默认关闭；未开启时 `manabrew_version` 为 `None`（`main.rs:4420`），UI 会拒绝连接 |
| 协议版本 | 当前 `../phase` HEAD（合并提交 `681160905`）为 `PROTOCOL_VERSION = 78`（`lobby-broker/src/protocol.rs:612`）；UI 硬校验 `76`。UI 预期的配对（`76` + ManaBrew 2）存在于 `../phase` 的 `27f190967`（父提交为 `8843c6825`），该提交是 HEAD 的祖先 |
| 运行时验证（P0 已通过） | 用仓库内已构建的 `../phase/target/debug/phase-server` 实测：`ServerHello` 返回 `protocol_version=76`、`manabrew_version=2`、`mode=Full`、`server_version=0.90.0`、`build_commit=8843c6825`；据此跑通 `pm-online.mjs` 的 2 人与 4 人两局 |
| UI 连接层 | `ui/phase/online.ts`：校验 `mode === "Full"`、`protocol_version === 76`（`:126`）、`manabrew_version === 2`；席位凭证按 endpoint 存于 `sessionStorage`。endpoint 规范化已提到 `ui/phase/endpoint.ts:13` 的 `normalizeServer`（只接受 `ws:`/`wss:`，拒绝用户名密码/查询参数/fragment，裸 `host:port` 补 `/ws`），由 `online.ts` 转出 |
| UI 开房/入房 | `ui/views/OnlinePlay.tsx`：创建、加入、重连、人数 2/3/4、默认 endpoint `ws://127.0.0.1:9374/ws`；**目前恒发 `password: null`** |
| 现有多人端到端脚本 | `pm-online.mjs`：对 2 人与 4 人断言「开房 / 加入 / 手牌仅本席可见 / 刷新后重连 / 调度权 / 认输 / 房间退役后取回终局」；尚未挂进 `package.json`，需手动 `node pm-online.mjs` |
| 桌面端原生进程管理 | `../phase/client/src-tauri/src/native_engine.rs`：派生随包 `phase-server`，带 `--exit-on-stdin-close` 与 `--allowed-origin` |
| 局域网地址 | `../phase/client/src-tauri/src/lan.rs`：枚举私有 IPv4、mDNS 广播/发现（依赖 `if_addrs`、`mdns_sd`） |
| 壳内嵌宿主先例 | `/home/jeb/code/manabrew/src-tauri/src/forge_room.rs`：`start_forge_host` / `stop_forge_host`，把宿主节点嵌进 Tauri 应用 |

三个必须正视的事实：

- phase-mana **仍没有 `src-tauri/`**，而且本环境拉不到 crates.io（HTTP 403），新建桌面壳不可行。`ui/platform/tauri.ts:58` 调用的 `start_forge_host` / `stop_forge_host`、以及 `ui/game/hostedAiPlay.ts:208` 调用的 `start_local_relay` / `stop_local_relay`，都是继承自 ManaBrew 的桌面壳接口；实现体在 `/home/jeb/code/manabrew/src-tauri/`，在本仓库里仍是死代码，不依赖它。
- `ui/platform/index.ts` 是精简平台，`startMultiplayerGame` 为 `unsupported`；能连 Phase 服务的是 `#/play/online`。开房必须接这条在线路径。
- **版本对齐已实测确认**：UI 只接受 `protocol_version === 76`（`ui/phase/online.ts:101`），而当前 `../phase` HEAD 的服务器在 `ServerHello` 里广告 `78`（`main.rs:4423`），因此拿 HEAD 现编的 `phase-server` 会被 UI 拒绝。但仓库里已构建的 `../phase/target/debug/phase-server` 恰好是 `76` + `manabrew_version: 2` + `Full`，并且已用它跑通完整的 2 人与 4 人对局（见第 12 节 P0）——所以配对不是理论推演，而是实测成立的事实。随包二进制就按这个配对构建：`--features manabrew`、`PROTOCOL_VERSION = 76`，源码对应 `../phase` 的 `27f190967`（父提交 `8843c6825`，而那个二进制的 `build_commit` 正好上报 `8843c6825`，即构建时工作区已含该提交的 manabrew 改动）。若将来要跟进 HEAD 的 78，必须逐条核对 76→78 的 Full 消息形状差异，而不是只改数字。

## 3. 架构

```text
房主电脑
  本地 Axum 宿主 server/（npm run server，已存在）
    ├─ /api/host/start|stop|status：启动/停止 Phase 引擎进程
    └─ ManaBrew UI（房主玩家）
                 │ WebSocket
                 ▼
       Phase Full 多人服务（原生 Rust 权威引擎）
                 ▲
                 │ WebSocket：直连 / 虚拟局域网 / 隧道
                 │
       ManaBrew UI（访客玩家，仅浏览器）
```

- 访客不需要引擎，也不需要卡库；只提交牌表与动作，接收本席视图。
- 每个房间一个监听端口；朋友之间互不连接，也无需为自己做端口映射。
- 首版每个邀请码只指向一个 endpoint。

## 4. 本机运行入口（已实现）

纯网页无法启动原生进程、监听入站端口或调用 UPnP，所以「开房」必须有一个本机进程承办。**已落地的做法不是 Tauri 桌面壳，而是仓库里已有的本地 Axum 宿主 `server/`**：它本来就随 UI 一起跑（`npm run server`，vite 把 `/api` 代理到它），再加三个路由管理引擎进程即可，不需要新增桌面壳；协议探测复用缓存中的 tungstenite WebSocket 库。

已实现（`server/src/host_process.rs` + `server/src/lib.rs`）：

- `POST /api/host/start` → `{ endpoint, lanEndpoints, binary, port }`；已有活着的引擎就直接返回同一个。
- `GET /api/host/status` → `{ host: HostInfo | null }`。
- `POST /api/host/stop` → 停引擎并回收。
- 引擎路径：显式 `PHASE_SERVER_BIN` → `.phase-host/target/debug/phase-server`；不再自动选取兄弟仓库旧二进制。启动时实际读取 WebSocket `ServerHello`，要求 Full / 76 / ManaBrew 2。
- 卡库目录：`PHASE_HOST_DATA_DIR` → `.phase-host/data`；`npm run host:build` 从正式 AtomicCards 生成 `card-data.json`。缺失即报错，只有显式 `PHASE_DEV_FIXTURE=1` 才允许开发 fixture。
- 默认绑 `0.0.0.0`，回填 `lanEndpoints`（UDP 路由探测取地址）；`PHASE_HOST_LAN=0` 改绑 loopback。
- `PHASE_HOST_PUBLIC_URL=https://…` 时透传给引擎的 `--public-url`，于是 `ServerHello.public_url` 被填上，邀请码从局域网地址变成 `wss://` 地址。这是房主已有反代/隧道时让邀请码能跨网使用的代码路径。（引擎若用 `--features ngrok` 构建且环境里有 `NGROK_AUTHTOKEN`，它会自己开隧道并填 `public_url`，子进程直接继承环变量，不需额外传参。）
- 引擎用空闲端口启动，`--games-db` 写在临时目录（**不污染 phase 检出**），`--no-data-download`、`--exit-on-stdin-close`（stdin 由宿主持有），就绪探测最长 180 秒，失败则回收进程。

仍然有效的硬要求：宿主机二进制必须带 `--features manabrew`（否则 `manabrew_version` 为 `None`，UI 拒绝），且其 `PROTOCOL_VERSION` 必须与 UI 接受的值一致（当前 UI = 76；`../phase` HEAD = 78 不兼容，可用 `27f190967`）。开房时用 `ServerHello.protocol_version` / `build_commit` 校验，不匹配就明确报错。

流程：`/api/host/start` → 就绪探测 → `CreateGameWithSettings`（`public:false` + 随机密码）→ `GameCreated` 取真实房间码 → 由 `ServerHello.public_url` 或本机地址生成邀请码。

`phase-server` 是独立二进制，不是为开房新写的游戏服务。本地单人 `server/`（`Host::start`，固定 `HUMAN = PlayerId(0)`）保持不动，只用它承载进程管理。

## 5. 邀请码

### 5.1 格式

```text
PMH1-<base64url(UTF-8 JSON)，省略末尾等号>
```

```json
{
  "v": 1,
  "endpoint": "wss://room.example.net/ws",
  "gameCode": "ABCDEF",
  "password": "<随机入房密码>"
}
```

- `v`：邀请码格式版本，与游戏协议版本（由宿主机二进制与 UI 锁定的 `PROTOCOL_VERSION`）无关。
- `endpoint`：完整 WebSocket URL，含协议、主机、端口与路径；IPv6 用标准方括号写法。必须能通过 `normalizeServer` 的既有校验，因此不得带查询参数、fragment 或 URL 凭据。
  - 优先取服务端广告的 `ServerHello.public_url` 拼 `/ws`（上游就是为「分享 join code」设计的字段，内嵌隧道或 `--public-url` 都会填它）。
  - 没有 `public_url` 时，才回退到房主自己选的局域网/虚拟局域网地址。这样「房主怎么知道该分享哪个地址」不需要另写猜测逻辑。
- `gameCode`：服务端生成的真实 6 位房间码，UI 不得自行生成。
- `password`：建私有房间时设置的密码。因服务端明文比较且上限 128 字节，取 16 字节安全随机数编码为约 22 个字符即可，无需自定义 KDF。

首版直接 JSON + base64url，不压缩、不分片、不引第三方编码库。长度已实测（16 字节密码 → 22 字符、6 位房间码）：

| 地址 | JSON | 邀请码长 | 改 deflate-raw |
| --- | --- | --- | --- |
| `ws://192.168.1.23:9374/ws` | 102 B | 141 字符 | 143（反而变长）|
| `wss://1a2b-3c4d-5e6f.ngrok-free.app/ws` | 120 B | 165 字符 | 160 |
| 长域名/自建反代 | 137 B | 188 字符 | 175 |
| 公网 IPv6 | 120 B | 165 字符 | 160 |

结论：都在百字符量级，可直接粘贴；`deflate-raw` 只省不到 8% 且对小载荷反而更长，所以**不引入压缩**。定位为复制粘贴，不定位为口述短码。同一编码/解码路径已做往返与拒绝验证：7 类畸形输入（小写化、篡改 base64、版本不符、非 `ws(s)`、带查询参数、房码长度不对、超 4096 字符）全部被拒。

上游自有分享格式是 `<code>@<host>`（`--public-url` 的帮助文本：clients surface `<code>@<host>`），比本格式短。本方案不直接用它，因为 ManaBrew 的 `online.ts` 不认这种字符串，而它又缺少 scheme/端口/路径与入房密码；若将来要与 Phase 客户端统一分享格式，应另开一个兼容语法，而不是把一个字符串硬塞给两套解析器。

### 5.2 为什么不是六位短码

短 `gameCode` 只能在「已知是哪台服务器」的前提下定位房间，无法告诉客户端连哪台房主电脑。在引入「短码 → 地址」查询服务之前，把地址与房间码一起放进邀请码是唯一自洽做法。若将来明确要求全球通用的六位码，再另立服务，不作为本设计依赖。

### 5.3 解析与校验

邀请码是不可信输入：

1. 去首尾空白，限制长度（首版 4096 字符），校验前缀与 base64url 字母表。
2. 解码 UTF-8 与 JSON，校验版本、字段类型、长度与必填项；不支持的版本直接拒绝。
3. 用标准 `URL` 解析，复用 `normalizeServer` 的 scheme 与禁用字段规则。
4. 不要整体转大写：base64url、URL 路径与密码都区分大小写。`gameCode` 由服务端按既有规则处理。
5. 粘贴后先显示「局域网 / 互联网 / 虚拟局域网」提示，用户点「加入」才连接；高级详情可查看实际地址。
6. 一个码只含一个 endpoint，不自动扫描多网卡地址，也不把其中地址交给后端做任意代理请求。

密码不是房主权限或席位凭证。邀请码绝不携带 `player_token`、`full_key`、桌面壳控制令牌或任何牌局状态。

### 5.4 有效性与撤销

- 房间存在、未满且地址可达时有效；满员、密码错误、已关闭、版本不符要分别显示服务端返回的原因。
- 地址、外部端口或隧道域名改变后必须重新生成并分享；旧码失效不需要额外机制，因为它指向旧地址。
- 仅重新编码同一字段不会撤销旧码。首版撤销方式就是关闭房间；若将来要单独换密码，必须由服务端执行，并验证旧密码确实失效，不得只做前端检查。
- 不做仅客户端判断的「过期时间」来冒充服务端失效。
- 拿到邀请码的人可以尝试入房（受密码约束）；首版不承诺逐人批准机制。

## 6. 房主与访客流程

### 6.1 开房

1. 房主选牌表与人数，点「开房」。
2. 本地宿主启动匹配版本的 `phase-server`（带 `manabrew` feature），等待真正就绪；处理卡库缺失、端口占用与启动失败。
3. 房主 UI 用现有 `connectOnline` 连接本地服务，`CreateGameWithSettings` 传 `public: false` 与随机 `password`。
4. 从 `ServerHello` 取真实房间码与 `public_url`；有 `public_url` 就用它，没有才用房主选的局域网/虚拟局域网地址。生成邀请码并显示「复制邀请码 / 人数 / 地址适用范围」。
5. 房主自己也是本局玩家：现有 Full 流程中创建者即占席，`pm-online.mjs` 已在 2 人与 4 人两局中实测通过（第 12 节 P0）。

不要把 `0.0.0.0`、`::` 或房主自己的 `127.0.0.1` 写进给朋友的邀请码。

### 6.2 加入

1. 访客打开 `#/play/online`，填昵称、选牌表、粘贴邀请码。
2. 客户端解析并校验邀请码与浏览器连接条件。
3. 调 `connectOnline(endpoint, { type: "JoinGameWithPassword", data: { game_code, password, display_name, deck } })`。
4. 走现有握手、席位绑定、快照、提示与动作响应流程；席位凭证只存本地，不写回邀请码。
5. 加入界面主入口只需一个邀请码输入框；「服务器地址 + 房间码」保留在高级选项里。

现有 `OnlinePlay.tsx` 恒发 `password: null`，因此必须补齐：创建时的随机密码输入/展示，以及加入时的密码传递。这是实现工作量，不是设计缺口。

## 7. 地址与网络可达

| 场景 | 邀请码中的地址 | 边界 |
| --- | --- | --- |
| 同一局域网 | 本机私有 IPv4 + 监听端口 | 访客网络可能隔离或防火墙拦截 |
| 家庭路由器有公网 IPv4 | UPnP 外部地址与映射端口，或手动映射 | 映射成功不等于外网可达 |
| 公网 IPv6 | 全局 IPv6 地址 | 双方都要有可互通 IPv6 且放行防火墙；平台支持需实测 |
| 虚拟局域网 | 已配置的虚拟网卡地址或域名 | 玩家需先加入同一虚拟网络；选地址时不能只用 `is_private()` 过滤，会漏掉虚拟网段 |
| 内嵌隧道（推荐优先） | `--features ngrok` 得到的 `public_url` + `/ws`（`wss://`） | 需 `NGROK_AUTHTOKEN` 账号；牌局流量经过 ngrok；免费额度和域名稳定性需实测 |
| 自建反代 | 房主自己用有效证书的反向代理；设 `PHASE_HOST_PUBLIC_URL` 广告 | 需自己解决域名与证书 |

多网卡时由房主选择「局域网 / 虚拟局域网 / 公网」，不许「猜第一个地址就当可用」。

**UPnP**：若将来做，由本地宿主执行，首次启用时说明会请求路由器放行游戏端口并记住选择；只映射所需 TCP 端口，记录映射所有权与租期，需要时续租，退出时只删本进程创建的映射。已核实：phase-mana、phase 与 manabrew **都没有** UPnP 依赖（`lan.rs` 只有 mDNS），且本机 cargo 缓存里也没有任何 `igd`/`upnp` 类 crate —— 这意味着它是一个全新的第三方依赖，需要联网拉取或自行 vendor。所以首版不做：**手动端口映射就足以交付**，UPnP 作为后续可选项。（Forge 的 UPnP 是 Java/jupnp，无法在这里复用。）

上游已内置一条隧道：`--features ngrok` + `NGROK_AUTHTOKEN` 时，`phase-server` 自己开一条 ngrok 隧道并把得到的公共地址放入 `ServerHello.public_url`（`main.rs:2831`、`:4148`）。这正好对应本方案要的「无需端口映射与 TLS 即可分享」场景，因此**优先复用这条**，不自研隧道客户端。它默认关闭，属于房主可选的构建/启动开关；不开启时退回局域网或 `--public-url`。

**获取公网地址不等于可达**：没有外部验证时只显示「公网映射已建立，尚未验证外网连接」。公网回环（NAT loopback）常不被支持，所以同网访客应另生成局域网邀请码，房间码与密码保持不变。

## 8. 浏览器与 TLS

- HTTPS 页面通常不能连明文 `ws://`。互联网访客需要带有效证书的 `wss://` endpoint。
- UPnP 只建立 TCP 映射，既不签发证书也不把 WS 变成 WSS。
- 开发/可信局域网可用本地 HTTP UI + `ws://`；这是明文，是否被浏览器私网访问策略拦截需实测，不得靠关闭安全机制兜底。
- `--allowed-origin` 是单个精确匹配。同机开发可指定 `http://127.0.0.1:1420`；局域网访客的 Origin 是 `http://<局域网IP>:1420`，与前者不同，必须另行设置或接受不校验。不校验意味着任何网页都能连该端口，因此**只在受信网络或已配置隧道时省略**，默认应显式设置。
- 桌面壳不复存在，但纯网页同样不默认豁免，其 WS 权限、CSP 与 Origin 需独立验证。
- 隧道若终止 TLS，就能读到经过它的游戏消息，因此不能称为端到端加密；明文 WS 也没有 WebRTC 的 DTLS 加密。密码与席位令牌只能在符合场景的可信传输上发送。
- 优先用上游内嵌 ngrok 隧道（`--features ngrok`）或房主自备的反代 + `--public-url` 来拿到带证书的 `wss://`；不自研隧道客户端。
- 不把「免费额度」当作设计前提；ngrok 需账号，额度与域名稳定性由实测确认。

## 9. 复用清单与最小改动

| 部分 | 现状 | 处理 |
| --- | --- | --- |
| 权威多人引擎 | `phase-server` Full 模式 | 直接用原生服务；二进制按已验证的配对构建（`76` + `manabrew`，源码对应 `27f190967`，见第 2 节）|
| UI 连接/握手/重连 | `ui/phase/online.ts` | 复用，不改协议；补上从 `ServerHello` 读 `public_url` 与协议/`build_commit` 校验 |
| 开房/入房界面 | `ui/views/OnlinePlay.tsx` | 增加邀请码输入、随机密码生成与展示 |
| 邀请码编解码 | 无 | 新增小型模块：base64url + JSON + 严格校验（含单测） |
| 本机开房入口 | 无（原计划的新建 `src-tauri/` 因拉不到 crates.io 而放弃） | 已改用 `server/` 新增 `/api/host/*` 三个路由，引擎进程管理在 `server/src/host_process.rs` |
| 分享地址选择 | `lan.rs` 有私有地址枚举 | 增加地址分类与选择；不整段复制 Tauri 状态与授权逻辑 |
| UPnP | 无 | 可选，后置；先支持手动端口映射 |
| 本地单人 `server/` | `Host` 固定 1 人 | 不动，不改成多人服务 |

## 10. 权限、隐藏信息与服务暴露

- 复用服务端的席位令牌、动作授权与状态版本处理：房主自己也走同一条连接与同一套授权，不设「本机就是房主」的后门。
- `public: false` 不等于入房密码，两者都要用。随机密码是为防止 6 位码被猜到（36⁶ 空间可暴力枚举）。
- 每个访客只收到其有权看到的游戏帧。验收时检查所有帧类型，不只是 ManaBrew 快照。
- 隐藏信息过滤由引擎与兼容层承担；`seat-reducer` 是席位配置能力，不能当作隐藏信息过滤。
- 房主本机持有完整权威状态，本方案不防恶意房主窥牌或改程序。
- 只暴露玩家连接所需路由与端口；引擎的启动/停止路由、管理接口与本地文件访问不对访客开放（默认只绑 `127.0.0.1`）。
- 审核创建房间、连接数与消息大小的资源上限；CORS/Origin 检查不能替代游戏身份校验。
- 日志与遥测不记录完整邀请码、密码或席位令牌。

## 11. 生命周期与错误

| 事件 | 行为 |
| --- | --- |
| 访客临时掉线 | 沿用服务端既有席位与超时策略，用独立凭证重连（已实测：`pm-online.mjs` 刷新后重连通过）；不重分配空位冒充重连，也不另做 AI 托管 |
| 访客刷新 | 复用同标签页、同 endpoint 的 `sessionStorage` 凭证 |
| 房主 UI 刷新 | 本地宿主与引擎仍活着时服务不随之消失，应能重连 |
| 房主关闭程序 | 明确提示其他玩家会断线；有序停止自己启动的服务、撤销 UPnP 映射 |
| 进程崩溃/休眠 | 显示主机失联；持久化恢复以现有服务能力为准，不承诺无缝恢复 |
| endpoint 变化 | 重新分享邀请码；凭证按 endpoint 存储，首版不跨地址迁移。启用隧道时 `public_url` 可能在重启后变化，因此**每次开房重新生成邀请码**，不缓存旧码 |
| 邀请码损坏或版本过旧 | 联网前报出具体原因 |
| 连接失败 | 按可能的网络/TLS/浏览器策略/主机离线分别提示；浏览器只给笼统错误时不伪造精确诊断 |

## 12. 实施阶段与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P0 验证复用链路 ✅ **已实测通过** | 用仓库内已构建的 `../phase/target/debug/phase-server`（构建时带 `manabrew`；`ServerHello` 实测为 `protocol_version=76`、`manabrew_version=2`、`mode=Full`），以 `PHASE_DEV_FIXTURE=1` + 临时 `--data-dir`/`--games-db` 启动，配合 `npm run dev` 的 UI，跑 `pm-online.mjs` | **达成**：`PHASE_ONLINE_URL=ws://127.0.0.1:9374/ws node pm-online.mjs` 退出码 0，2 人与 4 人两局均输出 `create/join, private hands, reconnect, mulligan, priority, concession, and retired-result recovery passed`。边界：用的是 90 张 dev fixture，不是完整卡库；此阶段验证的是联网/席位/UI 链，不是卡牌覆盖 |
| P1 邀请码 ✅ | `PMH1-` 编解码与校验、私有房间随机密码、复制/粘贴加入 | **已实现**：`ui/phase/invite.ts` 8 个单测 + `ui/phase/online.ts` 新增 5 个单测（共 11）+ `pm-host.mjs` 端到端（粘贴邀请码入座、改密码后被 `Wrong password` 拒绝、正确密码入座）；不输 IP、不回传应答码 |
| P2 本机开房 ✅ | 本地宿主 `/api/host/*`、进程启停、卡库就绪、地址选择、Origin 设置 | 已过 `node pm-host.mjs`：点「开房」完成启动；端口冲突与退出无残留 |
| P3 公网可达（部分完成） | 优先 `--features ngrok` 或 `--public-url` 拿到 `wss://`；手动端口映射 → 可选 UPnP；浏览器策略验证 | **已验证**：设 `PHASE_HOST_PUBLIC_URL` 后引擎在 `ServerHello` 广告它，UI 生成的邀请码确实为 `wss://play.example.test/ws` 且提示改为“Reachable from the internet…”（一次性脚本，非仓库内用例）；`PHASE_HOST_LAN=1` 下用 LAN 地址跑通了 2 人与 4 人全套流程。**未验证**：真实外网跨机、ngrok（需账号+带 feature 的二进制）、UPnP（本环境拉不到 crates.io，无法加依赖） |
| P4 交付检查 | 2–6 人、掉线/重连、异常退出、泄露与权限、暴露面复查 | 已覆盖：2 人与 4 人、手牌仅本席可见、刷新重连、引擎随房间启动与回收、关房后无残留。未覆盖：5–6 人、跨机、UPnP |

邀请码的单元检查至少覆盖：UTF-8 往返、IPv4/IPv6/域名与端口、大小写保留、超长与畸形输入、非 `ws(s)` scheme、不支持的版本、含禁用字段的 payload。

公网验收必须区分「直连成功」与「经隧道成功」，不得用同机双标签页或「路由器映射成功」代替外网验证。

## 13. 明确不做

- 不做 WebRTC / PeerJS / STUN / TURN / 手动 SDP 交换。
- 不把 Phase 引擎搬到浏览器 WASM 里运行。
- 不做短房间码查询服务、账号、匹配、排行。
- 不做主机迁移、无缝存档恢复、逐人批准入房。
- 不替换 ManaBrew UI，不改 phase 自有客户端。

## 14. 关键决策记录

1. **运行形态**：Forge 式本机主机 + Phase 原生服务，WebSocket 承载；不用 P2P。
2. **分享方式**：自包含邀请码（地址 + 房间码 + 密码），单次发送，无应答码；不做短码。
3. **可达性**：默认直连；公网优先用上游内嵌 ngrok 隧道或 `--public-url`，手动端口映射次之，UPnP 可选后置；不由本方案自建中继。
4. **加密边界**：不再享有 WebRTC 的 DTLS；公网场景要求 `wss`，并明确隧道终止 TLS 时不是端到端加密。
5. **版本对齐**：宿主机二进制与 UI 必须同一 `PROTOCOL_VERSION`。当前 `../phase` HEAD（78）与 UI（76）不匹配，但 `76` + ManaBrew 2 的配对已实测可用（源码对应 `../phase` 的 `27f190967`，父 `8843c6825`），并已用它跑通 P0。宿主机二进制必须带 `manabrew` feature。
6. **席位上限**：服务端允许 2–6 人；UI 首版沿用 2/3/4 选项，验证至少覆盖 2 人与 4 人。
7. **掉线策略**：沿用服务端现有席位超时与凭证重连，不另写状态机。
8. **房主即玩家**：创建者占席，走与其他玩家相同的连接与授权路径。
9. **分享地址来源**：优先取 `ServerHello.public_url`，而不是房主自己猜地址；无该字段时才回退到本地选的局域网/虚拟局域网地址。
