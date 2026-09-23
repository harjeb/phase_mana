import { isToggledOff, type PromptResolver } from "./promptHandlers";

export const skipBoolean: PromptResolver<"chooseBoolean"> = (_prompt, ctx) => {
  // Play/draw is a match decision, never an optional ability to auto-decline.
  if (_prompt.input.confirmLabel === "Play" && _prompt.input.denyLabel === "Draw") {
    return { kind: "force-show" };
  }
  if (!isToggledOff("chooseBoolean", ctx)) return { kind: "force-show" };
  return {
    kind: "auto",
    respond: { type: "decision", value: false },
    reason: `boolean prompt toggled off; defaulting to decline`,
  };
};
