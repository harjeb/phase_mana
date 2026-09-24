import { t } from "@lingui/core/macro";
import { getPlatform } from "@/platform";
import type { GameRuntime, GameRuntimeKind } from "./runtime.types";

// Retain ManaBrew's local runtime discriminator for its existing UI branches;
// it is never sent to the host, which links only phase-engine and phase-ai.
const runtime: GameRuntime = {
  kind: "manabrew",
  label: "Phase engine + Phase AI",
  capabilities: {
    multiplayer: false, snapshots: false, deckAvailabilityCheck: false,
    manualTabletop: false, concedeBehavior: "send-action",
  },
  get api() { return getPlatform().game; },
};
export const isIronsmithRuntimeEnabled = () => false;
export const getAvailableGameRuntimes = () => [runtime];
export const getSelectedGameRuntime = () => runtime;
export const getSelectedGameRuntimeKind = (): GameRuntimeKind => runtime.kind;
export const getDefaultGameRuntime = () => runtime;
export const resetSelectedGameRuntime = () => runtime;
export function selectGameRuntime(kind: GameRuntimeKind): GameRuntime {
  if (kind !== runtime.kind) throw new Error(t`Runtime unavailable: ${kind}`);
  return runtime;
}
