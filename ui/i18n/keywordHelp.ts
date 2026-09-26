import { translateKeyword } from "@/i18n/cardKeywords";
import { i18n } from "@/i18n/i18n";
import { KEYWORD_HELP_SOURCES, type KeywordHelpLocale } from "./keywordHelpSources";
import { normalizeKeyword } from "./keywordCost";
import { MTGCH_KEYWORD_HELP } from "./keywordHelpMtgch";
import { KEYWORD_RULE_HELP } from "./keywordHelpRules";
import { ABILITY_WORD_HELP } from "./keywordHelpAbilityWords";

const PRINTED_SOURCES = { ...KEYWORD_HELP_SOURCES, ...MTGCH_KEYWORD_HELP };

/** Printed reminders first, then verbatim MTGCH rule definitions. Rule parameters
 * stay generic unless a printed template explicitly permits mana substitution.
 * Raw engine Debug payloads are normalized for presentation only.
 */
export function getKeywordHelp(
  keywords: readonly string[],
  locale: string = i18n.locale,
): { key: string; name: string; description: string; example?: string }[] {
  const result: { key: string; name: string; description: string; example?: string }[] = [];
  const seen = new Set<string>();
  const language: KeywordHelpLocale = locale === "zh-Hans" || locale === "zh-Hant" ? locale : "en";
  for (const keyword of keywords) {
    const input = keyword.trim().replace(/\s+/g, " ");
    const normalized = normalizeKeyword(input);
    const label = normalized?.label ?? input;
    const key = label.toLowerCase();
    const sourceKey = /^hexproof\s+from\b/i.test(label) || /^hexprooffrom\b/i.test(input)
      ? "hexproof from"
      : Object.hasOwn(KEYWORD_RULE_HELP, key) ? key : normalized?.ability ?? key;
    if (seen.has(key)) continue;
    const printed = Object.hasOwn(PRINTED_SOURCES, sourceKey) ? PRINTED_SOURCES[sourceKey]?.[language] : undefined;
    const rule = Object.hasOwn(KEYWORD_RULE_HELP, sourceKey) ? KEYWORD_RULE_HELP[sourceKey] : undefined;
    const word = Object.hasOwn(ABILITY_WORD_HELP, sourceKey) ? ABILITY_WORD_HELP[sourceKey] : undefined;
    let description: string | undefined;
    let example: string | undefined;
    if (language !== "en" && word) {
      description = word.text;
      // Digital keywords have complete reminders; ability words cite a card's
      // condition as an example, never as a universal card-independent effect.
      if (!["double team", "descend"].includes(sourceKey)) example = word.source.card;
    } else if (printed && (!printed.parameter || normalized?.cost)) {
      description = printed.parameter ? printed.text.replaceAll(printed.parameter, normalized!.cost!) : printed.text;
    } else if (rule) {
      // MTGCH publishes the CR in Simplified Chinese. Preserve its original text
      // when no Traditional printed reminder exists; do not machine-translate it.
      description = language === "en" ? rule.en : rule.zh;
    }
    if (!description) continue;
    seen.add(key);
    const name = language === "zh-Hans" && word
      ? word.name + label.slice(sourceKey.length)
      : translateKeyword(label, locale);
    result.push({ key, name, description, ...(example ? { example } : {}) });
  }
  return result;
}
