import { t } from "@lingui/core/macro";
import type { ChaosTheme, ConspiracyHook, SealedTemplateMetadata } from "@/types/limited";

// The local limited server (`server/src/limited.rs`) reports these labels as
// fixed English. Known ones are localized here by their stable id, tag or
// exact text; anything else is shown exactly as reported.

export function sealedTemplateLabel(template: SealedTemplateMetadata): string {
  return template.id === "standard" && template.label === "Standard Sealed" ? t`Standard Sealed` : template.label;
}

export function sealedTemplateDescription(template: SealedTemplateMetadata): string {
  return template.description === "Six MTGJSON set boosters" ? t`Six MTGJSON set boosters` : template.description;
}

export function chaosThemeLabel(theme: ChaosTheme): string {
  switch (theme.tag) {
    case "STANDARD":
      return t`Standard window (last 3 years)`;
    case "PIONEER":
      return t`Pioneer window (2012+)`;
    case "MODERN":
      return t`Modern window (2003+)`;
    case "DEFAULT":
      return t`All downloaded sets`;
    default:
      return theme.label;
  }
}

export function boosterSlotLabel(label: string): string {
  return label === "MTGJSON booster" ? t`MTGJSON booster` : label;
}

export function foilTypeLabel(foilType: string): string {
  return foilType === "MTGJSON sheet collation" ? t`MTGJSON sheet collation` : foilType;
}

export function conspiracyHookDescription(hook: ConspiracyHook): string {
  return hook.cardName === "Cogwork Librarian" && hook.flagName === "additional_pick"
    ? t`As you draft a card, you may draft an additional card from that booster pack, then return Cogwork Librarian to the pack (CR 905.2).`
    : hook.description;
}

/** The server names a sealed pool "<SET> Sealed". */
export function sealedPoolName(name: string): string {
  const setCode = /^(\S+) Sealed$/.exec(name)?.[1];
  return setCode ? t`${setCode} Sealed` : name;
}

// Online draft protocol values (`draft-core` enums serialize as variant names).

export function onlineDraftKindLabel(kind: string): string {
  switch (kind) {
    case "Quick":
      return t`Quick Draft`;
    case "Premier":
      return t`Premier Draft`;
    case "Traditional":
      return t`Traditional Draft`;
    case "Sealed":
      return t`Sealed`;
    case "CommanderDraft":
      return t`Commander Draft`;
    default:
      return kind;
  }
}

export function onlineDraftStatusLabel(status: string): string {
  switch (status) {
    case "Lobby":
      return t`Lobby`;
    case "Drafting":
      return t`Drafting`;
    case "Paused":
      return t`Paused`;
    case "Deckbuilding":
      return t`Deckbuilding`;
    case "Pairing":
      return t`Pairing`;
    case "MatchInProgress":
      return t`Match in progress`;
    case "RoundComplete":
      return t`Round complete`;
    case "Complete":
      return t`Complete`;
    case "Abandoned":
      return t`Abandoned`;
    default:
      return status;
  }
}

export function pickStatusLabel(status: string): string {
  switch (status) {
    case "Pending":
      return t`Picking`;
    case "Picked":
      return t`Picked`;
    case "Waiting":
      return t`Waiting`;
    case "TimedOut":
      return t`Timed out`;
    case "NotDrafting":
      return t`Not drafting`;
    default:
      return status;
  }
}

export function pairingStatusLabel(status: string): string {
  switch (status) {
    case "Pending":
      return t`Pending`;
    case "InProgress":
      return t`In progress`;
    case "Complete":
      return t`Complete`;
    default:
      return status;
  }
}
