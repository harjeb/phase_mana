# phase-mana native host

Single localhost human-v-AI session. Rules and validation run in `phase-engine`; the opponent uses `phase-ai::auto_play::run_ai_actions` with a persistent `AiSession` and RNG. No substitute host heuristics. ManaBrew serialization and response conversion come from `manabrew-compat` (including its prompt extensions).

## Run

Sibling layout: `phase-mana/server` alongside the existing `phase` checkout. The repository's `rust-toolchain.toml` pins phase's own nightly channel, so plain `cargo` works from any directory inside this project; the `+nightly-2026-04-19` form is equally valid.

```sh
cd server
cargo run
# optionally:
PHASE_CARD_DB=/absolute/path/to/card-data.json PHASE_MANA_PORT=3001 cargo run
cargo test
cargo fmt --all
```

Binds **127.0.0.1:3001** only. Proxy `/api` from the UI dev server (no permissive CORS). `PHASE_CARD_DB` selects the card database and accepts both shapes the engine reads: a raw MTGJSON `AtomicCards.json` (`CardDatabase::from_mtgjson`, Oracle text parsed at startup — 36,046 cards take ~2 min and ~1.3 GB in a release build, so never run the host in debug with it) or a pre-parsed `oracle-gen` export (`CardDatabase::from_export`), which loads in seconds. Without the variable, phase's `data/mtgjson/AtomicCards.json` is used when that cache exists, otherwise `data/mtgjson/test_fixture.json` (87 cards) — no generated export or download is required for the demo. The two formats are told apart by their first key (`{"meta"` vs `{"card name"`). Defaults are casual 60-card decks (24 Forest, 36 Grizzly Bears), not a tournament legality claim. Name arrays are validated for existence and engine support before the engine's resolver runs; deck-format legality is not enforced for ordinary games. Commander games enforce the engine's canonical deck-format validation.

## HTTP JSON schema

- `POST /api/start`: `{ "seed": 42, "humanDeck": ["Forest", "..."], "aiDeck": ["Forest", "..."] }`. Every property optional; omit decks for presets, seed defaults to 42. One string per copy, 7–250 cards. Starting again replaces the session only on success.
- Commander start additionally accepts `"format": "commander"`, `"humanCommanders": ["Linden, the Steadfast Queen"]`, and `"aiCommanders": ["Linden, the Steadfast Queen"]`. Both main decks must be explicit and **exclude commanders** (99 cards with one commander, 98 with a legal pair). Commander arrays default to empty. The engine validates commander eligibility/pairing, 100-card size, singleton exceptions, legality and color identity; all submitted cards must also be playable by the engine. Games use `FormatConfig::commander()`, two players and 40 starting life.
- Omitted format preserves the old ordinary-game behavior. `standard`, `modern`, `legacy`, `vintage`, `pioneer`, `pauper`, `historic`, `explorer`, `timeless`, `premodern`, and `casual` also retain that behavior (not tournament validation). Other format strings, including Commander variants such as Brawl and Duel Commander, are rejected. Commander slots in ordinary games are rejected.
- `GET /api/state`: read-only cached snapshot; never advances AI or rotates prompts.
- `POST /api/respond`: **compat `ClientToServerMessage` directly**, e.g.:
  ```json
  {"kind":"response","promptId":1,"action":{"type":"mulligan","output":{"type":"mulliganDecision","keep":true}}}
  ```
  Concede: `{"kind":"directive","directive":{"type":"concede"}}`.

All successful endpoints return:

```json
{
  "state": { "gameView": "<actual GameViewDto object>" },
  "prompt": {
    "promptId": 1,
    "decidingPlayerId": "player-0",
    "input": "<actual compat PromptInput object>"
  },
  "humanPlayerId": "player-0",
  "aiActions": 1
}
```

`state` is exactly compat `StateUpdate` with its **gameView wrapper**, not a flattened game view. `prompt` is exactly extension-aware compat `AgentPrompt`, with optional sourceCard. The custom Rust `PromptInput::Upstream` / `PromptOutput::Upstream` wrappers serialize transparently: do **not** add an `upstream` JSON tag. Responses must echo `prompt.promptId` and use the advertised family's protocol output. Render game-over prompts without answering them.

The human identity is fixed server-side to engine `PlayerId(0)` / wire `player-0`; the AI is seat 1. The client never supplies a trusted actor. IDs increase across actions **and session restarts**, and are checked against the stored snapshot's context. Invalid/replayed responses return 409; engine rejection is 400; unsupported compat interactions and AI stalls return 422. An unrenderable state reports the engine's own `WaitingFor::variant_name` and `acting_players`, so "this prompt is unimplemented" and "the AI is wedged" stay distinguishable. Errors are `{ "error": "diagnostic" }` (Axum malformed JSON extractor errors use its standard rejection body). No default answers or silent unsupported fallbacks are supplied.

A new game also binds a fresh engine interaction authority (`bind_interaction_authority` with a random session id), as phase's own `engine-wasm` host does. `GameState::new` leaves the session unset, and while it is unset the engine's `derive_viewer_interaction` reports `AuthorityUnbound` and returns no opportunities — which silently kills every prompt served by the generic interaction projection (the CR 514.1 cleanup hand-size discard, for one) while the hand-written compat families keep working.

Updates are transactional: a rejected response, AI failure, or unrenderable resulting prompt leaves the previous game and prompt intact. The native AI loop executes in `spawn_blocking`, behind a single session mutex. This is a local development host, not a multi-user/authenticated or Internet-facing service.

## Verification

Commander host regressions verify 40 life, separate command zones and 99-card library/hand totals, invalid requests preserving the previous session, and the return-to-command adapter seam. `CommanderZoneChoice` is served by compat's generic `ChooseFromSelection` projection, and both options translate to `DecideOptionalEffect` correctly. There is no dedicated Commander boolean/card presentation; clients must render the generic selection prompt. The regression synthesizes this waiting state: it does **not** claim end-to-end death/exile/return or casting/tax coverage. Those gameplay paths remain delegated to the engine and AI, and have not been exercised end-to-end by these host tests.

Seven integration tests exercise real MTGJSON loading, real phase-ai opening and turn decisions, human response advancement, cached state, replay/zero/cross-game prompt rejection, unknown-card rejection (the error names the engine's own gap, e.g. `Effect:replacement_structure`), the exact pass-until payload the copied UI emits, and the cleanup hand-size discard being served and answered. `cargo test` and `cargo clippy --all-targets -- -D warnings` pass. A live HTTP smoke test also verified start → keep → stale response 409 → concede/gameOver, and two browser harnesses in the repository root (`npm run e2e`, `npm run e2e:leave`) played full games against the running host.

One test wraps each body in an explicit 16 MiB stack, and the binary gives Tokio and AI workers the same size (`thread_stack_size`). The project root also carries `.cargo/config.toml` with `RUST_MIN_STACK`, because cargo reads config from the working directory upward and phase's own copy is in a sibling checkout. This is required for debug-mode engine execution: 2 MiB workers overflowed while loading the card database. The standalone lockfile pins `manabrew-protocol` 5.2.0 to match phase's lockfile: later semver-compatible protocol releases add Rust DTO fields that the existing compat crate does not construct.

AGPL-3.0-or-later: linking `manabrew-compat` brings ManaBrew protocol's copyleft obligations, including network use.
