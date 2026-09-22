#!/usr/bin/env bash
# Pull the bulk resource files that are intentionally not committed to this repo:
#   public/preset_decks/*.json  (except index.json and the two curated decks)
#   public/token_archive.json, public/*.png, public/*.ico
#   ui/assets/
#
# Source is a ManaBrew checkout. If ../manabrew exists it is used as-is; set
# MANABREW_DIR to point elsewhere. With neither, the script sparse-clones the
# ManaBrew repo into a temp dir (override the URL with MANABREW_REPO).
#
# The audit JSON (docs/card-audit*.json) is NOT fetched here; regenerate it with
#   cargo run --release --manifest-path server/Cargo.toml --example audit_cards -- \
#     ../phase/data/mtgjson/AtomicCards.json public/preset_decks docs/card-audit.json
#   python3 docs/render_card_audit.py
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${MANABREW_DIR:-$root/../manabrew}"
tmp=""

if [ ! -f "$src/public/token_archive.json" ]; then
  if [ -n "${MANABREW_DIR:-}" ]; then
    echo "No ManaBrew resources under MANABREW_DIR=$src" >&2
    exit 1
  fi
  tmp="$(mktemp -d)"
  src="$tmp/manabrew"
  echo "No local ManaBrew checkout; sparse-cloning ${MANABREW_REPO:-https://github.com/witchesofthehill/manabrew} ..." >&2
  git clone --depth 1 --filter=blob:none --sparse "${MANABREW_REPO:-https://github.com/witchesofthehill/manabrew}" "$src" >&2
  git -C "$src" sparse-checkout set public src/assets >&2
  trap 'rm -rf "$tmp"' EXIT
fi

cp -f "$src/public/token_archive.json" "$root/public/"
for f in "$src"/public/*.png "$src"/public/*.ico; do
  if [ -e "$f" ]; then cp -f "$f" "$root/public/"; fi
done

# Only fetch decks named in the committed index, and never overwrite files that
# are already here (the curated animar/ramses decks and index.json).
node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1]+"/public/preset_decks/index.json","utf8")).join("\n"))' "$root" |
  while IFS= read -r id; do
    out="$root/public/preset_decks/$id.json"
    if [ -e "$out" ]; then continue; fi
    cp -f "$src/public/preset_decks/$id.json" "$out"
  done

if [ -d "$src/src/assets" ]; then
  mkdir -p "$root/ui/assets"
  cp -Rf "$src/src/assets/." "$root/ui/assets/"
fi

echo "Fetched resources from $src"
