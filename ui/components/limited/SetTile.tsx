import { t } from "@lingui/core/macro";
import { SetSymbol } from "@/components/limited/SetSymbol";
import { cn } from "@/lib/utils";
import type { ScryfallSet } from "@/types/scryfall";
import { setTypeLabel } from "@/components/limited/setFilters";

interface SetTileProps {
  set: ScryfallSet;
  active: boolean;
  prefetching: boolean;
  onClick: () => void;
  size?: "sm" | "md";
}

export function SetTile({ set, active, prefetching, onClick, size = "md" }: SetTileProps) {
  const releasedYear = set.released_at?.slice(0, 4) ?? "—";
  const setType = setTypeLabel(set.set_type);
  const setName = set.name;
  const setCode = set.code.toUpperCase();
  const released = set.released_at ?? "—";
  const cardCount = set.card_count;
  const compact = size === "sm";
  return (
    <button
      type="button"
      onClick={onClick}
      title={t`${setName} (${setCode}) · ${setType} · ${released} · ${cardCount} cards`}
      className={cn(
        "group relative flex items-center gap-2 rounded-lg border px-3 text-left transition",
        compact ? "py-1.5" : "py-2",
        active
          ? "border-selection bg-selection/15 shadow-[0_0_0_1px_var(--color-selection)]/30"
          : "border-border/40 bg-card/30 hover:border-primary/50 hover:bg-card/60",
      )}
    >
      <SetSymbol
        setCode={set.code}
        className={cn(
          compact ? "h-5 w-5" : "h-7 w-7",
          active ? "text-selection" : "text-foreground/80 group-hover:text-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate font-medium leading-tight", compact ? "text-xs" : "text-sm")}>
          {set.name}
        </div>
        <div className={cn("text-[10px] text-muted-foreground", compact && "text-[9px]")}>
          {set.code.toUpperCase()} · {releasedYear} · {set.card_count}
        </div>
      </div>
      {prefetching && (
        <span className="absolute right-1.5 top-1.5 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      )}
      {active && !prefetching && (
        <span className="absolute right-1.5 top-1.5 inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
      )}
    </button>
  );
}
