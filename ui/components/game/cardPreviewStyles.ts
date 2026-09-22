import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import type { InlineCardStyle, InGameCardPreviewStyle } from "@/stores/usePreferencesStore";

// Options carry translated labels, so they are built per render rather than as
// module constants (which would freeze the launch-language labels).
export function inGameCardPreviewStyleOptions(): ReadonlyArray<{
  value: InGameCardPreviewStyle;
  label: string;
}> {
  return [
    { value: "printed", label: t`Realistic` },
    { value: "rules", label: t`Rules` },
  ];
}

export function inlineCardStyleOptions(): ReadonlyArray<{
  value: InlineCardStyle;
  label: string;
}> {
  return [
    { value: "printed", label: t`Realistic` },
    { value: "rules", label: t`Rules` },
  ];
}

export const ACTIONABLE_CARD_GLOW_CLASS = "ring-2 transition-shadow duration-200" as const;
export function actionableCardGlowStyle(color: string): CSSProperties {
  return {
    "--tw-ring-color": color,
    boxShadow: `0 0 20px ${color}`,
  } as CSSProperties;
}
