import { t } from "@lingui/core/macro";
import type { BattlefieldCardStyle } from "@/stores/usePreferencesStore";

export function battlefieldCardStyleOptions(): ReadonlyArray<{
  value: BattlefieldCardStyle;
  label: string;
}> {
  return [
    { value: "realistic", label: t`Realistic` },
    { value: "art", label: t`Art-forward` },
    { value: "frame", label: t`Mini-frame` },
  ];
}
