import { translateKeyword } from "@/i18n/cardKeywords";
import { i18n } from "@/i18n/i18n";
import { KEYWORD_HELP_SOURCES, type KeywordHelpLocale } from "./keywordHelpSources";
import { keywordManaCost } from "./keywordCost";
import { MTGCH_KEYWORD_HELP } from "./keywordHelpMtgch";

const SOURCES = { ...KEYWORD_HELP_SOURCES, ...MTGCH_KEYWORD_HELP };

/**
 * Exact printed reminders, not authored rules summaries. Missing Chinese quotes
 * are omitted instead of silently falling back to English. Never infer a generic
 * reminder from a parameterized ability (e.g. ward or protection): its printed
 * cost/quality may not apply to the card being previewed. Kicker explicitly uses
 * a sourced template, substituting only the verified mana-cost token.
 */
export function getKeywordHelp(
  keywords: readonly string[],
  locale: string = i18n.locale,
): { key: string; name: string; description: string }[] {
  const result: { key: string; name: string; description: string }[] = [];
  const seen = new Set<string>();
  const language: KeywordHelpLocale = locale === "zh-Hans" || locale === "zh-Hant" ? locale : "en";
  for (const keyword of keywords) {
    const normalized = keyword.trim().replace(/\s+/g, " ").replace(/^battlecry$/i, "Battle cry");
    const parameter = keywordManaCost(normalized);
    const cost = parameter?.cost;
    const label = parameter ? `${parameter.ability[0]!.toUpperCase()}${parameter.ability.slice(1)} ${parameter.cost}` : normalized;
    const key = label.toLowerCase();
    const sourceKey = parameter?.ability ?? key;
    if (seen.has(key) || !Object.hasOwn(SOURCES, sourceKey)) continue;
    const help = SOURCES[sourceKey]?.[language];
    if (!help || (help.parameter && !cost)) continue;
    seen.add(key);
    const description = help.parameter && cost ? help.text.replaceAll(help.parameter, cost) : help.text;
    result.push({ key, name: translateKeyword(label, locale), description });
  }
  return result;
}
