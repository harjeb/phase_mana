# Keyword preview help

Printed card previews and Pixi hand previews share `KeywordHelpPanel`. The rules
preview uses the same `getKeywordHelp` resolver. Explanations are immediately
visible next to the enlarged art, with scrolling inside the panel.

## Sources and coverage

- Prefer exact official printed reminders from MTGJSON foreign-language records
  (`keywordHelpSources.ts`) and MTGCH card records (`keywordHelpMtgch.ts`).
- `keywordHelpRules.ts` contains 284 bilingual keyword/action definitions or
  aliases extracted from MTGCH's comprehensive rules, version 2026-08-07.
  Chinese translation is credited to the Greater China judge community; it is
  hosted by MTGCH and is **not** an official Wizards Chinese translation.
  English rules copyright belongs to Wizards of the Coast.
- `keywordHelpAbilityWords.ts` contains 36 sourced entries. Ability words do not
  define identical effects across cards: their condition/cost quotations are
  visibly labeled as examples from the cited card. This also holds for the
  card-specific Starting Intensity example and Augment's example cost. Double
  Team and Descend have complete reminder quotations instead.
- The combined rule and example tables contain 320 lookup identities. This is
  not a count of distinct mechanics: it includes aliases and keyword actions.
- All 223 public entries in the existing 226-entry localized-name catalog have
  Simplified Chinese help. The other three are internal `etb counter` /
  `etbcounter` and unused engine placeholder `totem`. `Totem Armor` is a separate,
  supported keyword (the current CR calls it Umbra Armor).
- The additional engine keyword **Specialize** remains unverified in Chinese.
  MTGCH HBG/12 supplies `精进{3}` but no explanation. The official English
  announcement is https://magic.wizards.com/en/news/mtg-arena/mtg-arena-announcements-june-22-2022.
  It is deliberately not replaced by an invented Chinese translation.
- Traditional printed reminders remain preferred. Where they are unavailable,
  the fallback preserves MTGCH's original Simplified Chinese CR text instead of
  performing an unverified script conversion.

Mana and quantity normalization is display-only. Engine identities and costs
are never modified. Parsed mana costs appear as symbols in the label; generic
CR placeholders remain in the quotation. Only a printed template with an
explicit `parameter` field permits substitution (currently Kicker). Restricted
Hexproof uses its own rule, never the unconditional Hexproof reminder.

## Updating and verification

Run `python tools/build-keyword-rules.py` to extract the CR definitions from the
public MTGCH chapter/glossary APIs (or its local cached JSON responses). The
output records response SHA256 values, exact rule numbers, and source links.
Selection checks reject missing paragraphs, invalid aliases, empty definitions,
and category-only excerpts. Review changes in the source version before
replacing existing quotations.

Run `python tools/build-ability-word-help.py` to rebuild quotations from
`tools/ability-word-help-sources.json`. Every fragment must occur verbatim in its
recorded source text. Printed reminders retain their separate generator,
`tools/build-keyword-help-sources.py`.

Focused Vitest coverage checks the public catalog, normalization and actual
engine DTO forms, sourced reminders, variant distinctions, and local art paths.
`tools/keyword-preview-smoke.mjs` exercises the actual React preview, example
labels, edge placement, scrolling, and face-down suppression.
`NATURE_SMOKE=1 node tools/keyword-hand-preview-smoke.mjs` mirrors the running
game read-only and verifies Nature's Rhythm's actual Pixi hand preview, its
Chinese art response, and the Harmonize reminder. It never sends game actions.

## Nature's Rhythm image fix

The configured image library contains the Chinese image at
`F:\Solo Arcanum\card-images\n\nature_s_rhythm.full.webp` (48,136 bytes).
The former lookup asked only for `natures_rhythm.full.webp`, which is absent.
`localCardArt.ts` now includes the underscore spelling as an alternate, including
for already-saved local URLs, while retaining the original CDN fallback.
English canonical metadata remains unchanged. The actual browser hand preview
has been verified to show 大自然的韵律 and its sourced 谐颂 reminder together.
