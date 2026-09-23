import { useCallback } from "react";
import type { Prompt, PromptOutput, PassUntil } from "@/protocol";
import { passOutput } from "@/components/prompts/internal/playerActions";
import type { GameViewDto } from "@/protocol/game";

interface UsePromptEffectsOptions {
  currentPrompt: Prompt | null;
  gameView: GameViewDto | null;
  isWaitingForResponse: boolean;
  respond: (output: PromptOutput["output"]) => void;
  myPlayerId: string;
}

export function usePromptEffects({
  currentPrompt,
  gameView,
  isWaitingForResponse,
  respond,
}: UsePromptEffectsOptions) {
  const pass = useCallback(
    (until: PassUntil | null, exhaustStack = false) => {
      const out = passOutput(currentPrompt, until, exhaustStack);
      if (out) respond(out);
    },
    [currentPrompt, respond],
  );
  const unifiedPass = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;

    // Ordinary passing remains one authoritative priority action.
    pass(null);
  }, [currentPrompt, gameView, isWaitingForResponse, pass]);

  const unifiedPassEndTurn = useCallback(() => {
    if (!currentPrompt || !gameView || isWaitingForResponse) return;
    if ((gameView.stack?.length ?? 0) > 0) {
      pass(null, true);
      return;
    }

    if (currentPrompt.input.type !== "chooseAction") return;
    respond({ type: "autoPass", mode: "turnBoundary" });
  }, [currentPrompt, gameView, isWaitingForResponse, pass, respond]);

  return {
    unifiedPass,
    unifiedPassEndTurn,
  };
}
