#!/usr/bin/env bash
# One-shot download of every runtime data file this project needs.
#
#   scripts/fetch-all.sh                  # all four download steps
#   scripts/fetch-all.sh --skip-pools     # skip the heavy draft-pool extraction
#   scripts/fetch-all.sh --skip-scryfall  # skip the Scryfall offline DB
#   scripts/fetch-all.sh --skip-resources # skip the ManaBrew bulk resources
#   scripts/fetch-all.sh --skip-mtgjson   # skip the MTGJSON / engine DB download
#
# Not downloaded here:
#   * Card images — point Settings -> Card image library at a local Forge
#     `cardsfolder`; cards it lacks fall back to Scryfall at runtime.
#   * The pre-parsed ../phase/data/card-data.json fast DB — generate it with
#     phase's own scripts/gen-card-data.sh. The server still works without it by
#     parsing AtomicCards.json at startup, just more slowly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PHASE="${PHASE_REPO:-$ROOT/../phase}"

skip_resources=0
skip_mtgjson=0
skip_pools=0
skip_scryfall=0
for arg in "$@"; do
  case "$arg" in
    --skip-resources) skip_resources=1 ;;
    --skip-mtgjson)   skip_mtgjson=1 ;;
    --skip-pools)     skip_pools=1 ;;
    --skip-scryfall)  skip_scryfall=1 ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

if [[ $skip_resources == 0 ]]; then
  step "1/4  ManaBrew bulk resources -> public/, ui/assets/"
  bash scripts/fetch-resources.sh
else
  step "1/4  ManaBrew bulk resources — skipped"
fi

if [[ $skip_mtgjson == 0 ]]; then
  step "2/4  MTGJSON exports + engine AtomicCards.json"
  PHASE_REPO="$PHASE" node scripts/download-mtgjson.mjs --all
else
  step "2/4  MTGJSON exports — skipped"
fi

if [[ $skip_pools == 0 ]]; then
  step "3/4  Limited booster pools -> resources/draft-pools/"
  if [[ -d "$PHASE/crates/draft-core" ]] && have cargo; then
    PHASE_REPO="$PHASE" bash scripts/fetch-limited-pools.sh --all
  else
    echo "   skipped: needs a phase checkout ($PHASE) and cargo on PATH" >&2
  fi
else
  step "3/4  Limited booster pools — skipped"
fi

if [[ $skip_scryfall == 0 ]]; then
  step "4/4  Scryfall offline DB -> data/scryfall.db"
  npm run download:scryfall
else
  step "4/4  Scryfall offline DB — skipped"
fi

step "Done."
echo "Card images are not downloaded; set them in Settings -> Card image library."
