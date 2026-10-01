import { i18n } from "@/i18n/i18n";
import type { GameLogEntryType } from "@/types/gameLog";
import { GAME_LOG_TEMPLATES } from "./gameLogTemplates";

const ZONES: Record<string, readonly [string, string]> = {
  Library: ["牌库", "牌庫"], Hand: ["手牌", "手牌"],
  Battlefield: ["战场", "戰場"], Graveyard: ["坟墓场", "墳墓場"],
  Stack: ["堆叠", "堆疊"], Exile: ["放逐区", "放逐區"],
  Command: ["统帅区", "統帥區"], Outside: ["游戏外", "遊戲外"],
};
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templates = GAME_LOG_TEMPLATES.map(([source, hans, hant]) => {
  const slots: { id: string; kind?: string }[] = [];
  let pattern = "";
  let end = 0;
  for (const match of source.matchAll(/\{(\d+)(?::(number|zone|mana))?\}/g)) {
    pattern += escapeRegex(source.slice(end, match.index));
    const kind = match[2];
    slots.push({ id: match[1], kind });
    pattern += kind === "number" ? "(-?\\d+)"
      : kind === "zone" ? `(${Object.keys(ZONES).join("|")})`
      : kind === "mana" ? "((?:\\{[WUBRGC0-9]+\\})+)" : "(.+?)";
    end = match.index! + match[0].length;
  }
  pattern += escapeRegex(source.slice(end));
  return { regex: new RegExp(`^${pattern}$`, "u"), slots, labels: [hans, hant] };
});

/** Display-only: keep canonical transport/history unchanged. Unknown messages,
 * opaque names and payloads are preserved verbatim. The flattened protocol has
 * no name boundaries, so we only recognize complete, case-sensitive templates.
 */
export function localizeGameLogMessage(message: string, locale = i18n.locale): string {
  if (locale !== "zh-Hans" && locale !== "zh-Hant") return message;
  const language = locale === "zh-Hans" ? 0 : 1;
  // Attack declarations can group several defenders; blocks can contain several
  // assignments. Split only when every clause is itself a combat declaration.
  const clauses = message.split("; ");
  if (clauses.length > 1 && clauses.every((clause) => /^.+? (?:attacks?|blocks) .+$/u.test(clause))) {
    return clauses.map((clause) => localizeGameLogMessage(clause, locale)).join("；");
  }
  for (const { regex, slots, labels } of templates) {
    const match = regex.exec(message);
    if (!match) continue;
    const values: Record<string, string> = {};
    slots.forEach(({ id, kind }, index) => {
      const value = match[index + 1];
      values[id] = kind === "zone" ? ZONES[value][language] : value;
    });
    // Callback replacement keeps dollar signs in player/card names literal.
    return labels[language].replace(/\{(\d+)\}/g, (_, id: string) => values[id]);
  }
  return message;
}

const BADGES: Record<string, readonly [string, string]> = {
  INFO: ["信息", "資訊"], ACTION: ["行动", "行動"], STACK: ["堆叠", "堆疊"],
  PRIO: ["优先权", "優先權"], RULE: ["规则", "規則"], WARN: ["警告", "警告"],
  RESOLVE: ["结算", "結算"], TURN: ["回合", "回合"],
};
const TYPE_BADGES: Record<GameLogEntryType, string> = {
  info: "INFO", action: "ACTION", stack: "STACK", priority: "PRIO", rule: "RULE", warning: "WARN",
};
export function gameLogBadge(type: GameLogEntryType, message: string, locale = i18n.locale): string {
  const key = type === "stack" && /\bresolve[ds]?\b/i.test(message) ? "RESOLVE"
    : /^TURN\b/i.test(message) ? "TURN" : TYPE_BADGES[type];
  return locale === "zh-Hans" ? BADGES[key][0] : locale === "zh-Hant" ? BADGES[key][1] : key;
}
