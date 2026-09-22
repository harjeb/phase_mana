import { FORGE_CARD_STEM_OVERRIDES } from "./forgeCardStemOverrides";

/**
 * Forge's own card-name -> filename rule, copied from
 * `CardScriptInfo.getScriptFor` (`forge-gui`):
 *
 *   name.toLowerCase().replaceAll("[^-a-z0-9_\s]","")
 *       .replaceAll("[-\s]","_").replaceAll("__","_")
 *
 * with NFD accent stripping first, because Forge's rule *deletes* a character
 * outside `a-z` rather than transliterating it, and the filenames on disk keep
 * the base letter (`Lim-Dûl's Vault` -> `lim_duls_vault`).
 */
export function forgeCardSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^-a-z0-9_\s]/g, "")
    .replace(/[-\s]/g, "_")
    .replace(/__/g, "_");
}

/**
 * Every spelling a card image may be filed under, most likely first.
 *
 * A multi-face card is ambiguous: Forge names the card *script* after both
 * faces, but a picture pack may hold one scan per face. `Delver of Secrets` is
 * therefore both `delver_of_secrets.full.webp` and
 * `delver_of_secrets_insectile_aberration.full.webp` in the wild, so the lookup
 * tries the per-face name first and the both-faces name second.
 */
export function forgeCardStems(name: string): string[] {
  const slug = forgeCardSlug(name);
  const candidates = [slug];
  // A split or double-faced card is known by both faces at once in places that
  // use Scryfall's canonical name, while a picture pack files its front face
  // under the front name alone.
  const frontFace = name.includes("//") ? forgeCardSlug(name.split("//")[0].trim()) : "";
  if (frontFace && frontFace !== slug) candidates.push(frontFace);
  const bothFaces = FORGE_CARD_STEM_OVERRIDES[slug];
  if (bothFaces && !candidates.includes(bothFaces)) candidates.push(bothFaces);
  return candidates;
}

/** The preferred spelling, for callers that only need one. */
export function forgeCardStem(name: string): string {
  return forgeCardStems(name)[0];
}
