#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
workspace="$PWD"
root="$(cd ../.. && pwd)"
cargo="${CARGO:-/root/.cargo/bin/cargo}"
if [[ ! -x "$cargo" ]]; then cargo=cargo; fi
# Keep build artifacts isolated even if the caller configures a shared target dir.
export CARGO_TARGET_DIR="$workspace/target"
"$cargo" run --locked --quiet -p manabrew-relay-protocol --bin gen-protocol -- "$root/ui/protocol"
"$cargo" run --locked --quiet -p generate-hub-types -- "$workspace/generated/api"
# Auth output is retained for comparison only: it is outside this tool's ownership.
cp "$workspace/generated/api/hubTypes.ts" "$root/ui/api/hubTypes.ts"
printf 'Generated %s/ui/protocol/ and %s/ui/api/hubTypes.ts\n' "$root" "$root"
