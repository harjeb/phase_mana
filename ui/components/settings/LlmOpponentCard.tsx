import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isLlmSeatUsable } from "@/lib/llmSeat";
import { usePreferencesStore } from "@/stores/usePreferencesStore";

/**
 * Settings for the optional LLM opponent.
 *
 * Applies to offline/local games: the configured OpenAI-compatible endpoint
 * plays the AI seats instead of the built-in engine AI, at the difficulty
 * chosen in the AI setup. The API key is stored with the rest of the local
 * preferences and sent only to the local host process.
 */
export function LlmOpponentCard() {
  const llmSeat = usePreferencesStore((state) => state.llmSeat);
  const setLlmSeat = usePreferencesStore((state) => state.setLlmSeat);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card/40 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <Checkbox
            id="llm-opponent-enabled"
            className="mt-0.5"
            checked={llmSeat.enabled}
            onCheckedChange={(checked) => setLlmSeat({ enabled: checked === true })}
          />
          <div className="space-y-1">
            <Label htmlFor="llm-opponent-enabled">
              <Trans>Use an LLM as the AI opponent</Trans>
            </Label>
            <p className="text-xs text-muted-foreground">
              <Trans>
                Offline games play their AI seats through an OpenAI-compatible endpoint instead of
                the built-in engine AI. Difficulty still applies: it sets the model's persona and
                how much of the game it is shown. If a request fails, that decision falls back to
                the built-in AI.
              </Trans>
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="llm-base-url">
              <Trans>Base URL</Trans>
            </Label>
            <Input
              id="llm-base-url"
              value={llmSeat.baseUrl}
              onChange={(event) => setLlmSeat({ baseUrl: event.target.value })}
              placeholder={t`e.g. http://localhost:11434/v1 or https://api.openai.com/v1`}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              <Trans>
                The API root, in OpenAI format. A full endpoint pasted from your provider's docs is
                normalized to its root.
              </Trans>
            </p>
          </div>

          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="llm-api-key">
              <Trans>API key</Trans>
            </Label>
            <Input
              id="llm-api-key"
              type="password"
              value={llmSeat.apiKey}
              onChange={(event) => setLlmSeat({ apiKey: event.target.value })}
              placeholder={t`Leave empty for a local server`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-model">
              <Trans>Model</Trans>
            </Label>
            <Input
              id="llm-model"
              value={llmSeat.model}
              onChange={(event) => setLlmSeat({ model: event.target.value })}
              placeholder={t`Model id, e.g. gpt-4o or llama3.1:8b`}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="llm-temperature">
              <Trans>Temperature</Trans>
            </Label>
            <Input
              id="llm-temperature"
              value={llmSeat.temperature}
              onChange={(event) => setLlmSeat({ temperature: event.target.value })}
              placeholder={t`Default`}
              inputMode="decimal"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </div>

        {llmSeat.enabled && !isLlmSeatUsable(llmSeat) && (
          <p className="mt-4 text-xs text-destructive">
            <Trans>Enter a base URL and a model to turn LLM mode on; until then the built-in AI plays.</Trans>
          </p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        <Trans>
          Your key is kept in this browser's local preferences and used only by the local game host
          on your machine. Turn this off to return every game to the built-in AI.
        </Trans>
      </p>
    </div>
  );
}
