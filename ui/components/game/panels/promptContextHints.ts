import { msg } from "@lingui/core/macro";
import { i18n } from "@/i18n/i18n";

export const ATTACK_DRAG_HINT =
  msg`Drag a creature onto a target — or tap the creature, then its target — to attack.`;

export interface PromptContextInfo {
  mulliganCount?: number;
  mustAttackHint?: string | null;
  blockRestrictionHint?: string | null;
  payManaCostInfo?: {
    cardName: string;
    manaCost: string;
    description?: string;
    delveCount?: number;
    lifeToPay?: number;
  } | null;
  mulliganPutBackCount?: number;
  mulliganSelectedCount?: number;
}

export function getPromptContextLines(
  promptType: string | undefined,
  info: PromptContextInfo,
): string[] {
  switch (promptType) {
    case "mulligan": {
      const count = info.mulliganCount;
      return count
        ? [i18n._(msg`Mulligan ${count} — keeping puts ${count} back.`)]
        : [i18n._(msg`Keep this hand, or mulligan to draw a new one.`)];
    }
    case "mulliganPutBack": {
      const selectedCount = info.mulliganSelectedCount ?? 0;
      const putBackCount = info.mulliganPutBackCount ?? 0;
      return [i18n._(msg`${selectedCount}/${putBackCount} to library bottom`)];
    }
    case "chooseAction":
      return [i18n._(msg`Tap PASS to pass priority.`)];
    case "chooseAttackers": {
      const lines = [i18n._(ATTACK_DRAG_HINT)];
      if (info.mustAttackHint) lines.unshift(info.mustAttackHint);
      return lines;
    }
    case "chooseBlockers": {
      const lines = [i18n._(msg`Tap an attacker, then your blocker, to assign a block.`)];
      if (info.blockRestrictionHint) lines.unshift(info.blockRestrictionHint);
      return lines;
    }
    case "payManaCost": {
      const cost = info.payManaCostInfo;
      if (!cost) return [];
      const { cardName, manaCost, delveCount, lifeToPay } = cost;
      const lines = [cost.description || i18n._(msg`Cast ${cardName} for ${manaCost}`)];
      if (delveCount) lines.push(i18n._(msg`Delved for {${delveCount}}`));
      if (lifeToPay) lines.push(i18n._(msg`Tap ${lifeToPay} Life to pay with life`));
      return lines;
    }
    default:
      return [];
  }
}
