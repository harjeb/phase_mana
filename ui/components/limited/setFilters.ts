import { t } from "@lingui/core/macro";

export const DRAFTABLE_SET_TYPES = new Set([
  "expansion",
  "core",
  "masters",
  "draft_innovation",
  "starter",
]);
/** The set-type filter chips, in display order. */
export const SET_TYPE_KEYS = ["all", "expansion", "core", "masters", "draft_innovation", "starter"] as const;
/** The localized name of a set type; an unknown type is shown as reported. */
export function setTypeLabel(key: string): string {
  switch (key) {
    case "all":
      return t`All`;
    case "expansion":
      return t`Expansion`;
    case "core":
      return t`Core`;
    case "masters":
      return t`Masters`;
    case "draft_innovation":
      return t`Draft Innovation`;
    case "starter":
      return t`Starter`;
    case "local":
      return t`Local`;
    default:
      return key;
  }
}
