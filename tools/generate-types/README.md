# Isolated ManaBrew TypeScript generation

Run from any directory:

```sh
/home/jeb/code/phase-mana/tools/generate-types/generate.sh
```

Requires Rust/Cargo; defaults to `/root/.cargo/bin/cargo`, falls back to PATH,
and accepts `CARGO=/path/to/cargo`. The checked-in Cargo.lock and `--locked`
keep dependency resolution reproducible. Build artifacts stay in this workspace's
`target/`, not the Phase or ManaBrew targets. No engine or hub crate is built.

## Sources and licenses

Copied from `/home/jeb/code/manabrew`, upstream commit
`62ff9e720792e49c49d6afc8b98e1e96d826878f`:

- `manabrew-rs/crates/manabrew-protocol`: version **5.11.1**, exact crate copy.
- `manabrew-rs/crates/manabrew-relay-protocol`: version **5.14.2**, exact crate copy,
  including its unmodified `src/bin/gen_protocol.rs` generator.
- `manabrew-rs/crates/manabrew-hub/src/dto.rs`: exact source copy under
  `crates/hub-dto/src/dto.rs`.
- `xtask/src/gen_types.rs`: adapted into `crates/hub-dto/src/main.rs`, retaining
  the same ts-rs export roots and imports, but replacing the hub dependency with
  the local DTO module and separating protocol generation into the shell script.

The isolated workspace supplies upstream's inherited package license/repository
and serde/serde_json/ts-rs dependency settings. Upstream `LICENSE.md`,
`LICENSE-AGPL-3.0-or-later`, and `LICENSE-GPL-3.0-or-later` are preserved here.
Rust source copies are AGPL-3.0-or-later; the upstream documentation's CC-BY
protocol-specification license should not be mistaken for the Rust source license.

## Outputs and ownership

- `../../ui/protocol/`: 33 generated TypeScript files. The upstream generator
  replaces this directory on each run; do not put handwritten files here.
- `../../ui/api/hubTypes.ts`: genuine ts-rs hub DTO output, with the upstream
  Deck/DeckFormat/EngineKind imports prepended.
- `generated/api/authTypes.ts`: generated for comparison, **not copied into UI**.
  Existing `ui/api/authTypes.ts` has the same DTO shapes (formatting differs).

No `any` stubs, engine dependencies, or modifications to original source checkouts.
The current protocol crates do **not** depend on `manabrew-compat`; neither does
this workspace. Therefore no semver `5.2` compatibility dependency is resolved.
Do not add one unless a future source snapshot actually requires it; if needed,
pin the matching version explicitly rather than assuming `5.2` means `=5.2.0`.

## Compatibility

Generated constants distinguish game DTO version `5.11.1`, relay crate version
`5.14.2`, and wire-major `PROTOCOL_VERSION = 5`, matching upstream. EngineKind
remains the exact upstream union `"Manabrew" | "Forge" | "Ironsmith"`; adding
Phase to it would be a deliberate protocol adaptation, not faithful generation.
No DTO shapes were changed locally.

## Verification

```sh
cd /home/jeb/code/phase-mana/tools/generate-types
/root/.cargo/bin/cargo fmt --all -- --check
npm exec --yes --package=typescript@5.8.3 -- tsc -p tsconfig.json
./generate.sh
```

Generation and the isolated strict TypeScript check passed. Two successive runs
produced byte-identical output for all 34 UI files. Vendored protocol crates and
hub DTO source were compared against the upstream copies without differences.
The TypeScript check covers generated files and their imports, not the entire UI.
