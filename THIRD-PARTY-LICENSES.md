# Third-Party Licenses

phase-mana is distributed under **AGPL-3.0-or-later** (see [LICENSE](LICENSE)).
It contains, or links against, the third-party components below. Their
copyright and license notices are retained.

## Summary

| Component | Source | License |
| --- | --- | --- |
| phase-engine, phase-ai, draft-core, draft-wasm | <https://github.com/phase-rs/phase> (`8843c68`) | MIT OR Apache-2.0 |
| manabrew-compat | <https://github.com/phase-rs/phase> (`8843c68`) | AGPL-3.0-or-later |
| ManaBrew client (copied into `ui/`) | <https://github.com/witchesofthehill/manabrew> (`62ff9e7`) | AGPL-3.0-or-later |
| ManaBrew protocol crates (vendored under `tools/generate-types/`) | <https://github.com/witchesofthehill/manabrew> | GPL-3.0-or-later |
| manabrew-protocol | <https://crates.io/crates/manabrew-protocol> | AGPL-3.0-or-later |
| Forge (referenced, not vendored) | <https://github.com/Card-Forge/forge> | GPL-3.0-or-later |

## License texts

- **AGPL-3.0-or-later**: [LICENSE](LICENSE) and
  [tools/generate-types/LICENSE-AGPL-3.0-or-later](tools/generate-types/LICENSE-AGPL-3.0-or-later)
- **GPL-3.0-or-later**:
  [tools/generate-types/LICENSE-GPL-3.0-or-later](tools/generate-types/LICENSE-GPL-3.0-or-later)
- **MIT**: <https://github.com/phase-rs/phase/blob/main/LICENSE-MIT>
- **Apache-2.0**: <https://github.com/phase-rs/phase/blob/main/LICENSE-APACHE>

phase is consumed as a sibling path dependency and is **not** redistributed in
this repository, so its MIT/Apache license texts are not copied here; they are
available in the upstream repository linked above.

## Compatibility

MIT and Apache-2.0 are permissive and may be combined with AGPL-3.0-or-later.
GPL-3.0-or-later and AGPL-3.0-or-later are compatible: GPLv3 §13 permits the
combination, and the combined phase-mana work is distributed under
AGPL-3.0-or-later. The vendored GPL code under `tools/generate-types/`, and the
referenced Forge engine, remain under their upstream GPL-3.0-or-later terms.

## Source availability (AGPL-3.0 §13)

phase-mana is self-hostable and its client interacts with the local host over a
network. Users who interact with it over a network are offered the Corresponding
Source at this repository: <https://github.com/harjeb/phase_mana>
