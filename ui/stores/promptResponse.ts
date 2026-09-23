import type { PromptOutput, PromptType } from "@/protocol/prompts";

/** Preserve extension envelopes instead of wrapping autoPass as chooseAction. */
export function promptResponse(promptType: PromptType, output: PromptOutput["output"]): PromptOutput | null {
  // A dismissed sideboard editor must never answer a later prompt (and vice versa).
  if ((promptType === "sideboard") !== (output.type === "submitSideboard")) return null;
  if (output.type === "autoPass") {
    return promptType === "chooseAction" ? { type: "autoPass", output } : null;
  }
  return { type: promptType, output } as PromptOutput;
}
