// This fork uses only the local Phase host, not ManaBrew's online services
// or alternative engines. Keep the existing UI's feature gates in one place.
export const featureFlags = {
  ironsmithRuntime: false,
  deckHub: false,
  accounts: false,
  emailSignIn: false,
  forgeWasm: false,
} as const;
export type FeatureFlag = keyof typeof featureFlags;
export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag];
}
