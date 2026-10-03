import { t } from "@lingui/core/macro";
import { useMemo, type ReactNode } from "react";
import { ManaSymbols } from "@/components/game/ManaSymbols";
import { peekCard, useScryfallStore } from "@/stores/useScryfallStore";
import { countManaPips } from "@/lib/limited.utils";
import { cn } from "@/lib/utils";
import type { DraftCard } from "@/types/limited";
interface Props {
  cards: DraftCard[];
  className?: string;
  compact?: boolean;
}
const COLOR_KEYS = ["W", "U", "B", "R", "G"] as const;
type ColorKey = (typeof COLOR_KEYS)[number];
export function LimitedDeckStats({ cards, className, compact = false }: Props) {
  const cacheBucket = useScryfallStore((s) => s.cards);
  const stats = useMemo(() => {
    const colors: Record<ColorKey, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    const curve = [0, 0, 0, 0, 0, 0, 0];
    let creatures = 0;
    let lands = 0;
    let spells = 0;
    let nonland = 0;
    let curveSampleSize = 0;
    for (const card of cards) {
      const cached = peekCard(cacheBucket, {
        name: card.name,
        setCode: card.setCode,
        cardNumber: card.cardNumber,
      });
      if (!cached) continue;
      const types = cached.type_line ?? "";
      const isLand = /\bLand\b/i.test(types);
      const isCreature = /\bCreature\b/i.test(types);
      if (isLand) lands += 1;
      else if (isCreature) creatures += 1;
      else spells += 1;
      if (!isLand) {
        nonland += 1;
        const cmc = Math.max(0, Math.min(6, Math.round(cached.cmc ?? 0)));
        curve[cmc] += 1;
        curveSampleSize += 1;
        const cost = cached.mana_cost ?? "";
        for (const key of COLOR_KEYS) {
          colors[key] += countManaPips(cost, key);
        }
      }
    }
    const curveMax = Math.max(1, ...curve);
    return {
      colors,
      curve,
      curveMax,
      curveSampleSize,
      creatures,
      lands,
      spells,
      nonland,
      total: cards.length,
    };
  }, [cards, cacheBucket]);
  const colorTotal = COLOR_KEYS.reduce((acc, k) => acc + stats.colors[k], 0);
  // Leave headroom above the tallest bar for its count.
  const barPct = (count: number) => (count / stats.curveMax) * 80;
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-md border border-border/70 bg-card/40 p-3",
        compact && "gap-3 p-2.5",
        className,
      )}
    >
      <StatSection title={t`Composition`} detail={t`${stats.total} cards`}>
        <ul className="space-y-1.5">
          <BarRow label={t`Creatures`} value={stats.creatures} total={stats.total} />
          <BarRow label={t`Spells`} value={stats.spells} total={stats.total} />
          <BarRow label={t`Lands`} value={stats.lands} total={stats.total} />
        </ul>
      </StatSection>

      <StatSection
        title={t`Mana curve`}
        detail={stats.curveSampleSize ? t`${stats.curveSampleSize} non-land` : undefined}
      >
        <div className={cn("flex gap-0.5", compact ? "h-20" : "h-28")}>
          {stats.curve.map((count, i) => {
            const manaValue = i === 6 ? "6+" : String(i);
            return (
              <div
                key={`cmc-${i}`}
                className="relative h-full flex-1"
                title={t`Mana value ${manaValue}: ${count} cards`}
              >
                {count > 0 && (
                  <span
                    className="absolute inset-x-0 text-center text-xs font-medium tabular-nums text-foreground/80"
                    style={{ bottom: `calc(${barPct(count)}% + 2px)` }}
                  >
                    {count}
                  </span>
                )}
                <div
                  className="absolute inset-x-0 bottom-0 rounded-t bg-primary/70"
                  style={{ height: `${barPct(count)}%`, minHeight: count > 0 ? 3 : 0 }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-0.5 border-t border-border/60 pt-1">
          {stats.curve.map((_, i) => (
            <span key={`cmc-label-${i}`} className="flex-1 text-center text-xs tabular-nums text-muted-foreground">
              {i === 6 ? "6+" : i}
            </span>
          ))}
        </div>
      </StatSection>

      <StatSection title={t`Colour pips`} detail={colorTotal ? String(colorTotal) : undefined}>
        <ul className="space-y-1.5">
          {COLOR_KEYS.map((k) => (
            <BarRow
              key={k}
              label={<ManaSymbols cost={`{${k}}`} size="sm" />}
              value={stats.colors[k]}
              total={colorTotal}
            />
          ))}
        </ul>
      </StatSection>
    </div>
  );
}
function StatSection({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 flex items-baseline justify-between gap-2 text-sm font-semibold text-foreground">
        <span>{title}</span>
        {detail && <span className="text-xs font-normal text-muted-foreground">{detail}</span>}
      </h3>
      {children}
    </section>
  );
}
function BarRow({ label, value, total }: { label: ReactNode; value: number; total: number }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)_1.75rem_2.5rem] items-center gap-2 text-sm">
      <span className="truncate text-muted-foreground">{label}</span>
      <div className="h-2 overflow-hidden rounded-full bg-muted/60">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-right font-medium tabular-nums text-foreground">{value}</span>
      <span className="text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </li>
  );
}
