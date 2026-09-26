import { useState } from "react";
import { t } from "@lingui/core/macro";
import { Label } from "@/components/ui/label";
import type { PromptType } from "@/protocol";
import { usePromptPreferencesStore } from "@/stores/usePromptPreferencesStore";
import { isPromptLoggingEnabled, setPromptLoggingEnabled } from "@/lib/debugPrompts";
interface OptionalCostRow {
  promptType: PromptType;
  label: string;
  description: string;
}
function optionalCostRows(): OptionalCostRow[] {
  return [
    {
      promptType: "chooseBoolean",
      label: t`Optional yes/no costs`,
      description: t`Skip yes/no cost prompts (kicker, buyback, Phyrexian) — never pay the extra cost.`,
    },
  ];
}
export function PromptPreferencesPanel() {
  const showOverrides = usePromptPreferencesStore((s) => s.show);
  const setShow = usePromptPreferencesStore((s) => s.setShow);
  const clearShow = usePromptPreferencesStore((s) => s.clearShow);
  const fullControl = usePromptPreferencesStore((s) => s.fullControl);
  const setFullControl = usePromptPreferencesStore((s) => s.setFullControl);
  const [logPrompts, setLogPrompts] = useState(isPromptLoggingEnabled);
  function setOptionalCostSkip(promptType: PromptType, skip: boolean) {
    if (skip) setShow(promptType, false);
    else clearShow(promptType);
  }
  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">{t`Prompts`}</h2>
        <p className="text-xs text-muted-foreground max-w-prose">
          {t`The auto-resolver answers prompts that have a single legal answer (target, mode, …) and informational acks (RevealCards, dice rolls). Those are always automatic — no toggle. The list below covers optional costs you may prefer to never be asked about.`}
        </p>
      </header>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t`Priority`}</h3>
        <div className="rounded-lg border bg-card/40 p-3 flex items-start gap-3">
          <input
            id="prompt-full-control"
            type="checkbox"
            checked={fullControl}
            onChange={(e) => setFullControl(e.target.checked)}
            className="mt-1 accent-selection h-4 w-4"
          />
          <div className="space-y-1">
            <Label htmlFor="prompt-full-control">{t`Full control`}</Label>
            <p className="text-xs text-muted-foreground">
              {t`Stop at every priority window, even when you have no possible response. When off, windows where you can only tap for mana pass automatically after a short delay, and the opponent's upkeep/draw pass after 5s unless you act.`}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t`Auto-skip optional costs`}</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {optionalCostRows().map((row) => {
            const skipped = showOverrides[row.promptType] === false;
            const id = `prompt-skip-${row.promptType}`;
            return (
              <div
                key={row.promptType}
                className="rounded-lg border bg-card/40 p-3 flex items-start gap-3"
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={skipped}
                  onChange={(e) => setOptionalCostSkip(row.promptType, e.target.checked)}
                  className="mt-1 accent-selection h-4 w-4"
                />
                <div className="space-y-1">
                  <Label htmlFor={id}>{row.label}</Label>
                  <p className="text-xs text-muted-foreground">{row.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">{t`Debug`}</h3>
        <div className="rounded-lg border bg-card/40 p-3 flex items-start gap-3">
          <input
            id="prompt-debug-log"
            type="checkbox"
            checked={logPrompts}
            onChange={(e) => {
              setPromptLoggingEnabled(e.target.checked);
              setLogPrompts(e.target.checked);
            }}
            className="mt-1 accent-selection h-4 w-4"
          />
          <div className="space-y-1">
            <Label htmlFor="prompt-debug-log">{t`Log prompts to console`}</Label>
            <p className="text-xs text-muted-foreground">
              {t`Print every prompt the UI receives (not state updates) to the dev console, including the full JSON. Useful for reporting prompt issues.`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
