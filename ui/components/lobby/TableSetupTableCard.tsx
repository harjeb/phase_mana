import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
  BOARD_BACKGROUNDS,
  type BoardBackgroundId,
} from "@/pixi/board/boardBackgrounds";
import { cn } from "@/lib/utils";

function backgroundLabel(id: BoardBackgroundId) {
  switch (id) {
    case "none":
      return t`None`;
    case "dark_oak":
      return t`Dark oak`;
    case "dark_stone":
      return t`Dark stone`;
    case "dark_table":
      return t`Dark table`;
    case "dark_wood":
      return t`Dark wood`;
    case "glacier":
      return t`Glacier`;
    case "magic_cloth":
      return t`Magic cloth`;
    case "refined_redwood":
      return t`Refined redwood`;
    case "refined_stone":
      return t`Refined stone`;
    case "refined_wood":
      return t`Refined wood`;
    case "stone_slate":
      return t`Stone slate`;
    case "tavern_table":
      return t`Tavern table`;
    case "volcanic_stone":
      return t`Volcanic stone`;
  }
}

interface TableSetupTableCardProps {
  background: BoardBackgroundId;
  onBackgroundChange: (id: BoardBackgroundId) => void;
  columns?: number;
  className?: string;
  disabled?: boolean;
}

export function TableSetupTableCard({
  background,
  onBackgroundChange,
  columns,
  className = "border-b border-border/60 px-5 py-3",
  disabled = false,
}: TableSetupTableCardProps) {
  const cols = columns ?? Math.ceil(BOARD_BACKGROUNDS.length / 2);
  return (
    <div
      className={cn(
        "grid gap-2",
        className,
        disabled && "pointer-events-none opacity-50",
      )}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {BOARD_BACKGROUNDS.map((option) => {
        const selected = option.id === background;
        const label = backgroundLabel(option.id);
        return (
          <button
            key={option.id}
            type="button"
            title={label}
            onClick={() => onBackgroundChange(option.id)}
            className={cn(
              "aspect-[16/9] w-full overflow-hidden rounded-md border text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              selected
                ? "border-selection ring-1 ring-selection"
                : "border-border/70 hover:border-primary/50",
            )}
          >
            {option.url ? (
              <img
                src={option.url}
                alt={label}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-canvas-background text-muted-foreground">
                <Trans>None</Trans>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
