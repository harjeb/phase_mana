import { msg } from "@lingui/core/macro";

/**
 * AI opponent difficulty levels, in ascending strength. The values are the
 * exact labels the Phase host parses (`AiDifficulty::from_label`), so they are
 * sent to the host verbatim and must not be localized.
 */
export const AI_DIFFICULTIES = [
  { value: "VeryEasy", label: msg`Very Easy` },
  { value: "Easy", label: msg`Easy` },
  { value: "Medium", label: msg`Medium` },
  { value: "Hard", label: msg`Hard` },
  { value: "VeryHard", label: msg`Very Hard` },
  { value: "CEDH", label: msg`cEDH` },
] as const;

export type AiDifficultyLabel = (typeof AI_DIFFICULTIES)[number]["value"];

/** Matches the host's own default (`AiConfig::default()`), so an untouched
 *  preference keeps the pre-selector behaviour. */
export const DEFAULT_AI_DIFFICULTY: AiDifficultyLabel = "Medium";
