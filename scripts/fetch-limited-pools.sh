#!/usr/bin/env bash
# Fetch official MTGJSON exports, then use Phase's canonical extractor.
# Usage: scripts/fetch-limited-pools.sh --all (or SET [BONUS_SET ...])
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PHASE="${PHASE_REPO:-$ROOT/../phase}"
OUT="${PHASE_MANA_DRAFT_POOLS:-$ROOT/resources/draft-pools}"
DATA="$ROOT/data/mtgjson"
[[ $# -gt 0 ]] || { echo "Usage: $0 --all | SET [SET ...]" >&2; exit 2; }
mkdir -p "$OUT" "$DATA/sets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [[ "$1" == --all ]]; then
  [[ $# == 1 ]] || { echo '--all takes no set arguments' >&2; exit 2; }
  curl --fail --location --retry 3 https://mtgjson.com/api/v5/AllPrintings.json.xz -o "$TMP/AllPrintings.json.xz"
  python3 - "$TMP/AllPrintings.json.xz" "$DATA/sets" <<'PY'
import json, lzma, pathlib, re, sys
with lzma.open(sys.argv[1], 'rt') as stream:
    export = json.load(stream)
assert export.get('data'), 'Empty AllPrintings export'
directory = pathlib.Path(sys.argv[2])
for code, data in export['data'].items():
    assert re.fullmatch(r'[A-Za-z0-9]{1,16}', code), f'Invalid set code: {code}'
    path = directory / (code.upper() + '.json')
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps({'meta': export['meta'], 'data': data}))
    temporary.replace(path)
print(f"Saved {len(export['data'])} complete set exports to {directory}", flush=True)
PY
else
  for code in "$@"; do
    [[ "$code" =~ ^[A-Za-z0-9]{1,16}$ ]] || { echo "Invalid set code: $code" >&2; exit 2; }
    code="${code^^}"
    curl --fail --location --retry 3 "https://mtgjson.com/api/v5/$code.json" -o "$TMP/$code.json"
    python3 - "$TMP/$code.json" "$code" <<'PY'
import json, sys
with open(sys.argv[1]) as stream:
    data = json.load(stream)['data']
assert data['code'].upper() == sys.argv[2], 'Set code mismatch'
PY
    mv "$TMP/$code.json" "$DATA/sets/$code.json"
  done
fi
curl --fail --location --retry 3 https://mtgjson.com/api/v5/SetList.json -o "$TMP/SetList.json"
mv "$TMP/SetList.json" "$DATA/SetList.json"
cargo run --manifest-path "$PHASE/Cargo.toml" -p draft-core --bin draft-pool-gen -- "$DATA/sets" "$TMP/pools.json"
python3 - "$TMP/pools.json" "$OUT" <<'PY'
import json, pathlib, sys
pools = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert pools, 'No booster pools extracted'
for code, pool in pools.items():
    path = pathlib.Path(sys.argv[2]) / (code.upper() + '.json')
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(pool))
    temporary.replace(path)
print(f'Saved {len(pools)} booster pools to {sys.argv[2]}')
PY
printf '\nLocal booster data ready: %s\n' "$OUT"
