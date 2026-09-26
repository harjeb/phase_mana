import type { ScryfallImageUris } from "@/types/scryfall";
import { forgeCardStems } from "./forgeCardStem";

/**
 * A local card-image library laid out exactly like Forge's `cardsfolder`:
 *
 *   <root>/<first letter of the stem>/<forge stem>.full.webp
 *   <root>/r/rabaroo_troop.full.webp
 *
 * served by the vite middleware in `vite.config.ts` from the directory in
 * `PHASE_MANA_CARD_IMAGES`. Cards the library does not hold 404, and the
 * middleware then answers from the Scryfall url carried in `?fallback=`, so a
 * local pack is authoritative without ever blanking a card it is missing.
 */
export const LOCAL_CARD_ART_ROUTE = "/card-images";

/**
 * Which Scryfall variants the one full-card scan stands in for. `art_crop` is
 * deliberately absent: it is a different *crop* — just the illustration — not a
 * smaller scan, so a full card is not a substitute for it.
 */
const SCAN_VARIANTS = ["small", "normal", "large", "png", "border_crop"] as const;

function scanPath(stem: string): string {
  return `${LOCAL_CARD_ART_ROUTE}/${stem.charAt(0)}/${stem}.full.webp`;
}

function imageStems(name: string): string[] {
  // Image packs use both Forge's punctuation deletion and word separators.
  // Keep existing candidates first; these are filename aliases, not fuzzy matches.
  const existing = [
    ...forgeCardStems(name),
    ...forgeCardStems(name.replace(/['’]/g, "_")),
  ];
  const packSlug = (value: string) => value.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/æ/g, "ae").replace(/œ/g, "oe")
    .replace(/ø/g, "o").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const faces = name.includes("//") ? [name, name.split("//")[0]!.trim()] : [name];
  return [...new Set([
    ...existing,
    ...existing.map(stem => stem.replace(/_+/g, "_").replace(/^_+|_+$/g, "")),
    ...faces.map(packSlug),
    ...faces.map(face => packSlug(face.replace(/[-‐‑‒–—]/g, ""))),
  ].filter(Boolean))];
}

function scanUrl(name: string, cdnVariant?: string): string | null {
  const [stem, ...alternateStems] = imageStems(name);
  if (!stem) return null;
  // With a Scryfall url in hand the middleware can answer a miss by redirect;
  // without one it has to ask Scryfall for the card by name (see vite.config).
  const query = cdnVariant
    ? `fallback=${encodeURIComponent(cdnVariant)}`
    : `name=${encodeURIComponent(name)}`;
  // `alt` covers both multi-face spellings and image-pack apostrophes; the
  // middleware serves an alternate when the first filename is absent.
  const alternates = alternateStems
    .map((alternate) => `&alt=${encodeURIComponent(scanPath(alternate))}`)
    .join("");
  return `${scanPath(stem)}?${query}${alternates}`;
}

/** Every variant pointed at the local scan, for when there is no Scryfall
 *  record to fall back to. */
export function localCardImageUris(name: string): ScryfallImageUris | null {
  const url = scanUrl(name);
  if (!url) return null;
  return { small: url, normal: url, large: url, png: url, art_crop: url, border_crop: url };
}

/** The same image uris, but with the local scan preferred and the Scryfall
 *  url kept as the server-side fallback. */
export function withLocalCardArt(
  uris: ScryfallImageUris | undefined,
  name: string,
): ScryfallImageUris | undefined {
  if (!uris) return uris;
  const next = { ...uris };
  for (const variant of SCAN_VARIANTS) {
    // Already pointing at the pack: preserve the CDN fallback while adding
    // any filename aliases introduced since this URL was saved.
    if (next[variant]?.startsWith(LOCAL_CARD_ART_ROUTE)) {
      const existing = next[variant]!;
      const url = new URL(existing, "http://localhost");
      const paths = new Set([url.pathname, ...url.searchParams.getAll("alt")]);
      // Persisted local URLs may predate the image-pack filename aliases.
      const additions = imageStems(name).filter(Boolean).map(scanPath)
        .filter((path) => !paths.has(path));
      const suffix = additions.map((path) => `alt=${encodeURIComponent(path)}`).join("&");
      next[variant] = suffix ? `${existing}${existing.includes("?") ? "&" : "?"}${suffix}` : existing;
      continue;
    }
    next[variant] = scanUrl(name, next[variant]) ?? next[variant];
  }
  return next;
}
