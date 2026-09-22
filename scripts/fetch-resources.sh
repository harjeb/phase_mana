#!/usr/bin/env bash
# Pull the bulk resource files that are intentionally not committed to this repo:
#   public/preset_decks/*.json  (except index.json and the two curated decks)
#   public/token_archive.json, public/*.png, public/*.ico
#   ui/assets/
#
# Source is a ManaBrew checkout — the tree the client, deck art and preset decks
# were copied from. Default ../manabrew; override with MANABREW_DIR.
#
# The audit JSON (docs/card-audit*.json) is NOT fetched here; regenerate it with
#   cargo run --release --manifest-path server/Cargo.toml --example audit_cards -- \
#     ../phase/data/mtgjson/AtomicCards.json public/preset_decks docs/card-audit.json
#   python3 docs/render_card_audit.py
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="${MANABREW_DIR:-$root/../manabrew}"

if [ ! -d "$src/public/preset_decks" ]; then
  echo "ManaBrew checkout not found at: $src" >&2
  echo "Clone it (https://github.com/witchesofthehill/manabrew) or set MANABREW_DIR." >&2
  exit 1
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
