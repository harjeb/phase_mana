import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { Button } from "@/components/ui/button";
import { DraftCardTile } from "@/components/limited/DraftCardTile";
import { cn } from "@/lib/utils";
import type { DraftCard, DraftState } from "@/types/limited";

interface SolomonWorkspaceProps {
  draft: DraftState;
  onSplit: (pile: DraftCard[]) => void | Promise<void>;
  onChoosePile: (pileIndex: number, pick: DraftCard) => void | Promise<void>;
  onBuild?: () => void;
  pending?: boolean;
}

function cardKey(card: DraftCard, index: number): string {
  return `${card.name}:${card.setCode}:${card.cardNumber}:${index}`;
}

/**
 * Solomon Draft: the splitter assigns the batch into two piles, the other seat
 * chooses one. The human alternates between the two roles.
 */
export function SolomonWorkspace({
  draft,
  onSplit,
  onChoosePile,
  onBuild,
  pending = false,
}: SolomonWorkspaceProps) {
  const [pileA, setPileA] = useState<Set<string>>(new Set());
  const batch = draft.currentPack;
  const awaitingSplit = draft.awaitingSplit === true;
  const piles = draft.piles;

  const toggle = (key: string) => {
    setPileA((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const confirmSplit = async () => {
    const chosen = batch.filter((card, index) => pileA.has(cardKey(card, index)));
    if (chosen.length === 0 || chosen.length === batch.length) return;
    await onSplit(chosen);
    setPileA(new Set());
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-lg border border-border/70 bg-card/40 p-3 text-sm text-muted-foreground">
        {awaitingSplit ? (
          <Trans>
            Split this batch into two piles. Your opponent will take the stronger pile; you keep the
            other.
          </Trans>
        ) : (
          <Trans>Choose one of the two piles your opponent split.</Trans>
        )}
      </div>

      {awaitingSplit && (
        <section className="min-h-0 flex-1 overflow-y-auto">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Trans>Batch to split ({batch.length})</Trans>
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {batch.map((card, index) => {
              const key = cardKey(card, index);
              const inA = pileA.has(key);
              return (
                <DraftCardTile
                  key={key}
                  card={card}
                  index={index}
                  onClick={() => toggle(key)}
                  selected={inA}
                  disabled={pending}
                  pickPending={pending}
                  overlay={
                    <span
                      className={cn(
                        "absolute right-1 top-1 rounded px-1 text-[10px] font-semibold",
                        inA ? "bg-selection text-selection-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {inA ? "Pile 1" : "Pile 2"}
                    </span>
                  }
                />
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button
              variant="primary"
              disabled={pending || pileA.size === 0 || pileA.size === batch.length}
              onClick={confirmSplit}
            >
              <Trans>Confirm split</Trans>
            </Button>
            <span className="text-xs text-muted-foreground">
              <Trans>
                Pile 1: {pileA.size} · Pile 2: {batch.length - pileA.size}
              </Trans>
            </span>
          </div>
        </section>
      )}

      {!awaitingSplit && piles && (
        <section className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
          {piles.map((pile, pileIndex) => (
            <div key={pileIndex} className="flex flex-col gap-2 rounded-lg border border-border/70 p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Trans>Pile {pileIndex + 1} ({pile.length})</Trans>
                </h3>
                <Button
                  size="sm"
                  variant="primary"
                  className="h-7 text-xs"
                  disabled={pending}
                  onClick={() => pile[0] && onChoosePile(pileIndex, pile[0])}
                >
                  <Trans>Take this pile</Trans>
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {pile.map((card, index) => (
                  <DraftCardTile key={cardKey(card, index)} card={card} index={index} disabled />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {!awaitingSplit && !piles && (
        <p className="text-sm text-muted-foreground">
          <Trans>Waiting for the opponent to split…</Trans>
        </p>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
        <span className="text-xs text-muted-foreground">
          {t`Your picks: ${draft.pickedPile.length}`}
        </span>
        {onBuild && (
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={onBuild}>
            <Trans>Build deck</Trans>
          </Button>
        )}
      </div>
    </div>
  );
}
