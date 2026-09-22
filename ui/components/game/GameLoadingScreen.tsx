import { useEffect, useRef, useState } from "react";
import { t } from "@lingui/core/macro";
import { Check, Circle, Copy, Loader2 } from "lucide-react";
import { useGameStore } from "@/stores/useGameStore";
import { formatCommsLog } from "@/lib/commsLog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GameLoadingTip } from "./GameLoadingTip";

const STUCK_HINT_AFTER_MS = 10_000;
const STEP_MIN_MS = 200;
function gameLoadingSteps(): string[] {
  return [
    t`Start the game engine`,
    t`Load card images`,
    t`Take your seat`,
    t`Receive the first game state`,
  ];
}
interface GameLoadingScreenProps {
  debugInfo: string;
  onComplete?: () => void;
}
export function GameLoadingScreen({ debugInfo, onComplete }: GameLoadingScreenProps) {
  const isPrefetchingCards = useGameStore((s) => s.isPrefetchingCards);
  const hasGameView = useGameStore((s) => s.gameView !== null);
  const seated = useGameStore((s) => (s.gameView?.players?.length ?? 0) > 0);
  const endGame = useGameStore((s) => s.endGame);
  const lastAdvanceAt = useRef(0);
  const [stage, setStage] = useState(0);
  const [slow, setSlow] = useState(false);
  const [copied, setCopied] = useState(false);
  const steps = gameLoadingSteps();
  let target = 0;
  if (/started/i.test(debugInfo)) target = steps.length - 1;
  if (hasGameView && !isPrefetchingCards && seated) target = steps.length;
  useEffect(() => {
    lastAdvanceAt.current = Date.now();
    const timer = setTimeout(() => setSlow(true), STUCK_HINT_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (stage !== steps.length) return;
    onComplete?.();
  }, [stage, onComplete]);
  useEffect(() => {
    if (stage >= target) return;
    const wait = Math.max(0, STEP_MIN_MS - (Date.now() - lastAdvanceAt.current));
    const timer = setTimeout(() => {
      lastAdvanceAt.current = Date.now();
      setStage((current) => current + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [stage, target]);
  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(formatCommsLog());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.warn("Failed to copy logs:", e);
    }
  };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 py-6">
      <div className="space-y-1.5 text-center">
        <p className="text-2xl font-semibold">{t`Game starting…`}</p>
        <p className="text-base text-muted-foreground">
          {slow
            ? t`This is taking longer than expected. You can keep waiting, or leave and return to the lobby.`
            : t`Setting the table — this usually takes a few seconds.`}
        </p>
      </div>

      <div className="w-full max-w-lg overflow-hidden rounded-xl border bg-card/50 text-left shadow-xl">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between pb-3">
            <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              {t`Setup progress`}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground"
              onClick={() => void copyLogs()}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t`Copied` : t`Copy logs`}
            </Button>
          </div>
          <ul className="space-y-3">
            {steps.map((step, index) => {
              const label = step;
              const done = index < stage;
              const active = index === stage;
              return (
                <li key={label} className="flex items-center gap-3">
                  {done ? (
                    <Check className="h-5 w-5 shrink-0 text-success" />
                  ) : active ? (
                    <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                  ) : (
                    <Circle className="h-5 w-5 shrink-0 text-muted-foreground/40" />
                  )}
                  <span
                    className={cn(
                      "text-base transition-colors",
                      done && "text-success",
                      active && "text-foreground",
                      !done && !active && "text-muted-foreground/60",
                    )}
                  >
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
          {slow && debugInfo && (
            <p className="mt-4 truncate border-t pt-3 font-mono text-xs text-muted-foreground">
              {debugInfo}
            </p>
          )}
        </div>
        <GameLoadingTip />
      </div>

      <Button variant="outline" onClick={() => void endGame()}>
        {t`Leave game`}
      </Button>
    </div>
  );
}
