import { t } from "@lingui/core/macro";

/**
 * The host labels a cycling ability built from its keyword with the keyword
 * as printed ("Cycling {2}", "Basic landcycling {2}"). That label has no
 * printed line to match against the card's localized text, so it is
 * translated here; any other label is returned as given.
 */
export function localizeKeywordAbilityLabel(label: string): string {
  const match = /^(Cycling|Basic landcycling|Plainscycling|Islandcycling|Swampcycling|Mountaincycling|Forestcycling)(?: (.+))?$/.exec(label);
  if (!match) return label;
  const cost = match[2] ?? "";
  const name = (() => {
    switch (match[1]) {
      case "Cycling":
        return t`Cycling`;
      case "Basic landcycling":
        return t`Basic landcycling`;
      case "Plainscycling":
        return t`Plainscycling`;
      case "Islandcycling":
        return t`Islandcycling`;
      case "Swampcycling":
        return t`Swampcycling`;
      case "Mountaincycling":
        return t`Mountaincycling`;
      default:
        return t`Forestcycling`;
    }
  })();
  return cost ? `${name} ${cost}` : name;
}
