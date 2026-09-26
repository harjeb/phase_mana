import { Trans } from "@lingui/react/macro";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { useLimitedStore } from "@/stores/useLimitedStore";
import type { DraftCard } from "@/types/limited";
export default function Sealed() {
  const { id } = useParams<{
    id: string;
  }>();
  const navigate = useNavigate();
  const activeSealed = useLimitedStore((s) => s.activeSealed);
  const refresh = useLimitedStore((s) => s.refreshSealedPool);
  const startGauntlet = useLimitedStore((s) => s.startGauntlet);
  const isStarting = useLimitedStore((s) => s.isStarting);
  const lastError = useLimitedStore((s) => s.lastError);
  const [builtDeck, setBuiltDeck] = useState<{
    main: DraftCard[];
    sideboard: DraftCard[];
  }>({
    main: [],
    sideboard: [],
  });
  const TARGET_MAIN_SIZE = activeSealed?.minDeckSize ?? 40;
  // Mini-Master is played as opened: the pack is never shown or edited, so the
  // sealed suggestions are used verbatim.
  const isPackWars =
    activeSealed?.variantKind === "pack_wars" ||
    activeSealed?.variantKind === "pack_wars_hand";
  const effectiveMain = isPackWars ? (activeSealed?.suggestedDeck?.main ?? []) : builtDeck.main;
  const effectiveSideboard = isPackWars
    ? (activeSealed?.suggestedDeck?.sideboard ?? [])
    : builtDeck.sideboard;
  const mainShortBy = Math.max(0, TARGET_MAIN_SIZE - effectiveMain.length);
  useEffect(() => {
    if (!id) return;
    if (!activeSealed || activeSealed.sessionId !== id) {
      refresh(id);
    }
  }, [id, activeSealed, refresh]);
  const initialMain = useMemo(
    () => activeSealed?.suggestedDeck?.main ?? [],
    [activeSealed?.suggestedDeck],
  );
  const initialSideboard = useMemo(
    () => activeSealed?.suggestedDeck?.sideboard ?? [],
    [activeSealed?.suggestedDeck],
  );
  if (!activeSealed) {
    return (
      <div className="flex h-full items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground"><Trans>Loading sealed pool…</Trans></p>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{activeSealed.deckName}</p>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {activeSealed.cards.length} cards opened · {activeSealed.aiDecks.length} AI decks
              ready
            </span>
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
              Pool ready
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            disabled={isStarting || !id || activeSealed.aiDecks.length === 0 || mainShortBy > 0}
            title={
              mainShortBy > 0
                ? mainShortBy === 1
                  ? `Main deck needs one more card to start`
                  : `Main deck needs ${mainShortBy} more cards to start`
                : undefined
            }
            onClick={async () => {
              if (!id) return;
              try {
                const g = await startGauntlet(
                  "sealed",
                  id,
                  activeSealed.aiDecks.length,
                  effectiveMain,
                  effectiveSideboard,
                );
                navigate(`/gauntlet/${g.gauntletId}`);
              } catch {
                /* surfaced via lastError */
              }
            }}
          >
            {isStarting
              ? `Setting up\u2026`
              : mainShortBy > 0
                ? `Need ${mainShortBy} more card${mainShortBy === 1 ? "" : "s"}`
                : `Start Gauntlet`}
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {isPackWars ? (
          <div className="flex h-full items-center justify-center rounded border border-border/50 bg-card/30 p-6">
            <p className="max-w-md text-center text-sm text-muted-foreground">
              <Trans>
                Mini-Master plays the booster exactly as opened. The pack stays hidden
                until you draw it in the match.
              </Trans>
            </p>
          </div>
        ) : (
          <LimitedDeckBuilder
            pool={activeSealed.cards}
            initialMain={initialMain}
            initialSideboard={initialSideboard}
            defaultDeckName={activeSealed.deckName}
            format="sealed"
            onChange={setBuiltDeck}
          />
        )}
      </div>

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}
    </div>
  );
}
