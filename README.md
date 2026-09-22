# phase-mana

Play Magic against the **real phase.rs engine and Phase AI** using **ManaBrew's game UI**, locally.

Every part does the job it already owns:

| Layer | Comes from | Owns |
| --- | --- | --- |
| Rules, legal actions, targeting, hidden information | `phase-engine` (`../phase`) | all game logic |
| Opponent decisions | `phase-ai` (`../phase`) | `auto_play::run_ai_actions`, priority, combat, choices |
| Wire protocol, state/response conversion | `manabrew-compat` (`../phase`) | snapshot, prompt, and response translation |
| Board, prompts, animations, i18n, theme | ManaBrew's React/Pixi client (copied into `ui/`) | display + dispatch only |
| Local session host | `server/` (this repo) | HTTP, trusted player identity, AI loop, errors |

The two source projects are **not modified**: `/home/jeb/code/phase` and `/home/jeb/code/manabrew` stay as they are. This is a separate checkout that builds phase's crates from source through path dependencies.

## Prerequisites

- **Node >= 24** (ManaBrew's UI).
- **Rust**, on the channel `rust-toolchain.toml` pins — the same `nightly-2026-04-19` as phase. `rustup` installs it automatically when you run `cargo` in this directory; if Rust is missing entirely:
  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  export PATH="$HOME/.cargo/bin:$PATH"   # add to your shell profile
  ```
  `cargo` must be on `PATH` for `npm run server` / `npm run test:server`.
- **The phase checkout as a sibling directory named `phase`** (`/home/jeb/code/phase` next to `/home/jeb/code/phase-mana`). It supplies the engine, AI, and adapter crates, plus the default card database.

## Run

```sh
npm install

# terminal 1 — engine/AI host on 127.0.0.1:3001
npm run server

# terminal 2 — UI on 127.0.0.1:1420
npm run dev
```

Bulk resource data is not committed (the preset-deck JSON, `token_archive.json`, the public/UI images). Fetch it once from a ManaBrew checkout before the first run:

```sh
scripts/fetch-resources.sh              # uses ../manabrew; override with MANABREW_DIR=/path/to/manabrew
```

Open <http://127.0.0.1:1420>. First run walks through a terms gate (tick the box) and a nickname step (**Let's brew**) — both work offline; the nickname is only stored locally. You then land on ManaBrew's Play page.

**Play → Offline** picks your deck and the AI's from the 65 bundled presets and starts a real game on this host: the chosen decks are sent to `POST /api/start` as card-name lists, so the offline picker and `#/deck-editor` are the deck selection for local play. Both decks must share a format or **Fight!** stays disabled. Everything else in the shell is reachable through the URL fragment: `#/play`, `#/deck-editor`, `#/search`, `#/limited`, `#/settings`, `#/about`. **Commander now uses Phase's Commander rules in local 1v1:** 40 life, separate command zones, and engine validation of both 100-card decks (including commanders), singleton, color identity and commander eligibility. This is not the separate Duel Commander format. Other accepted constructed labels still use the existing 20-life Standard engine configuration without tournament-legality enforcement. Brawl/Oathbreaker and four-player pods are not enabled; unsupported format requests are rejected. The Multiplayer tab needs ManaBrew's online service.

Choose the image library in **Settings → Card image library → Browse… → Use folder** (中文：**设置 → 卡图库目录 → 浏览… → 使用此文件夹**). Select the root containing the letter folders (`a`, `b`, …), not an individual letter folder. The choice is saved locally and the page reloads to clear old card textures. You can also paste a path into the field; no environment variable or manual config edit is needed. The native picker opens on the computer running the UI server (Windows/macOS, or Linux with `zenity`). This setting works with Vite dev/preview, not a standalone static-file server.

Without a deck of your own the host still has a casual 60-card demo (24 Forest, 36 Grizzly Bears) it falls back to for either seat; no tournament legality is claimed. The UI reaches the host through the Vite `/api` proxy — the host binds `127.0.0.1` only and serves no CORS headers.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PHASE_MANA_PORT` | `3001` | host port |
| `PHASE_CARD_DB` | `../phase/data/mtgjson/AtomicCards.json` when that cache exists, else `../phase/data/mtgjson/test_fixture.json` | engine card database. Both shapes the engine reads are accepted: a raw MTGJSON `AtomicCards.json` (its Oracle text parsed at startup — 36,046 cards of the 2026-09-21 vintage, ~2 min and ~1.3 GB) or a pre-parsed `oracle-gen` export from phase's `scripts/gen-card-data.sh`, which loads in seconds. The 87-card fixture keeps the demo deck working with no download. |
| `PHASE_MANA_CARD_IMAGES` | `card-images` | local card-image library, laid out like Forge's `cardsfolder`: `<letter>/<forge stem>.full.webp`. Cards it does not hold fall back to Scryfall. |

Host API: `POST /api/start` (`{seed?, format?, humanDeck?, aiDeck?, humanCommanders?, aiCommanders?}`, one card name per copy; Commander main decks exclude the separate commanders), `POST /api/respond` (a `manabrew-compat` `ClientToServerMessage`, including `{"kind":"directive","directive":{"type":"concede"}}`), `GET /api/state` (cached, never advances). Success is `{state: {gameView}, prompt, humanPlayerId, aiActions}`; failures are `{"error": "diagnostic"}` with 400 for engine rejection, 409 for a stale/replayed prompt, 422 for an engine state the adapter cannot render. Details and the exact JSON: [`server/README.md`](server/README.md).

## Verified

Everything below was run against this checkout, not inferred:

- `npm run check` (`tsc --noEmit`) and `npm run build` (production Vite build) pass.
- `npm run test:server` — 7/7 integration tests: real MTGJSON loading, Phase AI opening and turn decisions, human pass/priority progression, cached state, replay/zero/cross-game prompt-id rejection, unknown-card rejection, and the CR 514.1 cleanup hand-size discard being served and answered.
- `npm run server` + `npm run dev` + `npm run e2e` — a real browser game started through the shell (Play → Offline → **Pauper Mono Red Madness** vs **Pauper Elves** → **Fight!**): mulligan → the UI's own autopass → lands played from the board → casting → declare attackers/blockers → **Defeat, the Elves won on turn 18** (life -11). The harness also hits the human's hand-size discard, which ManaBrew renders as its own "Choose cards" overlay (`0 of 1 selected`, CONFIRM), and answers through the same store call the overlay's CONFIRM uses.
- `npm run e2e:leave` — concede, land back on the shell's Play page (`#/play`), and start a second game: fresh turn 1, no conceded state, no errors. (Both harnesses start their own session, so they work against whichever database the host loaded.)
- **The full MTGJSON card pool loads; parser coverage is incomplete.** `npm run server --release` against phase's cached `data/mtgjson/AtomicCards.json` (51 MB gzip / 161 MB raw, vintage 2026-09-21) loads **36,046 cards** and, in the earlier 20-life startup-only probe, accepted **53 of the 68** preset decks in `public/preset_decks/` (verified by POSTing each deck's expanded card list to `/api/start`). After curating 18 parser-unsupported cards out of five presets (Animar, Nicol Bolas, Ramses, Ghired, Yarok) for supported, colour-identity-legal replacements, the current audit accepts **58 of 68**. The other 10 contain at least one such card, and the host answers with the engine's own gap name — `Cannot play Time Vault: the engine has not implemented Effect:replacement_structure`, `Cannot play Demonlord Belzenlok: the engine has not implemented Effect:unrecognized_clause_head` — instead of starting a game that would mis-play the card. The ten remaining blockers are Rottenmouth Viper and Demonlord Belzenlok (unrecognized clause head); Steward of the Harvest and Lavinia, Azorius Renegade (`static_structure`); Path of Mettle and Tibalt's Trickery (`unparsed_verb_arguments`); Call the Coppercoats (`unparsed_quantity`); Glimpse the Impossible (`delayed_unplayed_exile_sweep`); Planar Nexus (`effect_structure`); Time Vault (`replacement_structure`). The full per-card scan of all 68 presets — and of the whole loaded database — is in [`docs/unsupported-cards.zh-CN.md`](docs/unsupported-cards.zh-CN.md): **10 / 68 presets affected, 10 distinct rejected card names**, **2834 / 36,046 database faces** refused by the same gate. phase tracks the parser causes itself in `docs/parser-misparse-backlog.md` (29 root causes, 4,587 cards implicated).
- `node pm-commander.mjs` — shell picker → Neheb vs Ognis → 1v1 → real engine mulligan: both decks send 99 main cards plus a separate commander, both players have 40 life and their commanders appear in the client command zones. All 12 Commander presets were re-probed using actual Commander configuration and validation: **8 start, 4 are blocked by parser gaps**. This startup check does not claim a completed Commander match. See the unsupported-card inventory under `docs/`.
- **ManaBrew's shell plays a real game on the local host.** `#/play/offline` → pick **Pauper Mono Red Madness** for YOU and **Pauper Elves** for the AI → **Fight!** → the table dialog's **Fight**: `POST /api/start` received the expanded Pauper deck lists, the store reached `Game started: phase host (Pauper Mono Red Madness)`, and the board rendered turn 1 with 20 life per seat, a seven-card hand painted from Scryfall art, the phase rail, and the MULLIGAN panel. No console errors on any of the shell routes (`#/play`, `#/lobby`, `#/deck-editor`, `#/search`, `#/limited`, `#/settings`, `#/about`). The shell's own `POST /api/stats/game` telemetry ping 404s against this host; that is the only failed request.
- **Double-faced back faces paint from the local library.** An injected client-state test set a transformed DFC (`isTransformed`, name `Insectile Aberration`) with an image library holding only `d/delver_of_secrets.full.webp` and `i/insectile_aberration.full.webp`: the board requested `200 /card-images/i/insectile_aberration.full.webp?name=Insectile%20Aberration` and made **no Scryfall request at all**. The front face of the same card asks for `d/delver_of_secrets.full.webp` first, with the both-faces spelling as `alt`.

The harnesses drive the store through a dev-only handle (`window.__pm`, set in `ui/phase/transport.ts` when `import.meta.env.DEV`) so they exercise the same actions the UI dispatches, instead of guessing canvas coordinates. Both need the host and dev server already running.

## Limits (deliberate, this version)

- **One local session, one human seat.** The host fixes the human to engine `PlayerId(0)` / wire `player-0` and the AI to seat 1; the client never supplies a trusted actor. No multiplayer, accounts, matchmaking, or persistence.
- **Unsupported interactions fail loudly.** If the engine reaches a state the ManaBrew adapter cannot render, the host returns 422 naming the engine's own `WaitingFor` variant and who owes it, and the previous prompt stays intact. Nothing is auto-answered, skipped, or guessed — a missing capability is never hidden.
- **Card art comes from the local library first, then Scryfall.** Choose a folder in **Settings → Card image library** (or override it with `PHASE_MANA_CARD_IMAGES`) pointing at a Forge `cardsfolder`-shaped directory of `<letter>/<forge stem>.full.webp` scans and everything the library holds paints from disk; only the cards it is missing are fetched from Scryfall. With neither, cards render as name plates. The spellings come from `forgeCardStem`, which reproduces Forge's own name-to-filename rule; a multi-face card is filed either per face (`delver_of_secrets.full.webp`) or under Forge's both-faces script name (`delver_of_secrets_insectile_aberration.full.webp`), so `forgeCardStems` returns both spellings and the middleware serves whichever the pack holds. Regenerate the exception table with `node tools/gen-forge-stems.mjs <cardsfolder>`; `npm run check:card-images` covers the folder setting and that two-spelling lookup.
- **Protocol versions differ by build, not by behaviour.** The host pins `manabrew-protocol = "=5.2.0"` to match phase's lockfile (later 5.x releases add DTO fields `manabrew-compat` does not construct), while the generated TypeScript types in `ui/protocol/` are 5.11.1. Every 5.11.1-only field the UI reads is optional-guarded, so those elements simply do not render instead of showing invented values.
- **ManaBrew features that need its own backends are off**: Forge/WASM engine, Ironsmith runtime, deck hub, accounts, email sign-in, snapshot restore, and the external usage telemetry the copied UI would otherwise report. The first-run gate works offline — tick the terms checkbox and pick any nickname (**Let's brew**); nothing is registered anywhere and the name is stored in this browser — but that nickname is not reserved on ManaBrew's service, so it cannot be used for online play. Harnesses starting from an empty profile can skip both steps by setting `manabrew.termsAcceptance` and `manabrew.onboarding` in localStorage to `{"version":"1.5.0"|"1.0","acceptedAt":"…"}`.
- Keyword/coverage breadth is phase's, not this repo's. This version gives you the real engine's behaviour, including its gaps.

## Layout

```
ui/                 ManaBrew client (copied), plus:
  phase/            transport.ts: host session start / rehydrate / respond
  platform/         local web platform adapter -> Phase host
  router.tsx        ManaBrew's 19-route shell, hash-routed (`#/play`, …)
  game/             runtime registry: single "Phase engine + Phase AI" runtime
  protocol/         ManaBrew protocol types (generated)
index.html          the single entry -> ui/main.tsx
server/             local Axum host: session, AI loop, trusted identity, errors
tools/generate-types/  regenerates ui/protocol + ui/api/hubTypes.ts from the
                       upstream protocol crates, without building them
pm-e2e.mjs          browser end-to-end harness (a full game)
pm-return.mjs       browser harness: concede, return, restart
pm-commander.mjs    browser harness: Commander picker, payload, 40 life, zones
```

Regenerate the TypeScript protocol types after the upstream protocol crates change:

```sh
tools/generate-types/generate.sh
```

## Licensing

`AGPL-3.0-or-later` — see [`LICENSE`](LICENSE). The copied ManaBrew client and the linked `manabrew-compat` crate are AGPL-3.0-or-later, so this whole program is. phase's engine, AI, and core crates are MIT/Apache-2.0; ManaBrew's UI is AGPL-3.0-or-later; the ManaBrew protocol crates (vendored for type generation under `tools/generate-types/`) are GPL-3.0-or-later. Sources: `phase` at commit `8843c68`, `manabrew` at commit `62ff9e7`.
