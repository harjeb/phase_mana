import { Trans } from "@lingui/react/macro";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import LimitedDeckBuilder from "@/components/limited/LimitedDeckBuilder";
import { DraftStatusBar } from "@/components/limited/DraftStatusBar";
import { DraftWorkspace } from "@/components/limited/DraftWorkspace";
import type { LimitedDraftMode } from "@/components/limited/LimitedModeToggle";
import { useLimitedStore } from "@/stores/useLimitedStore";
import { startLocalDeckGame } from "@/phase/transport";
import { ROUTES } from "@/lib/constants";
import type { DraftCard } from "@/types/limited";
type DraftMode = LimitedDraftMode;
export default function Draft() {
  const { draftId } = useParams<{
    draftId: string;
  }>();
  const navigate = useNavigate();
  const startGauntlet = useLimitedStore((s) => s.startGauntlet);
  const startCommanderGame = useLimitedStore((s) => s.startCommanderGame);
  const commanderDraftInfo = useLimitedStore((s) => s.commanderDraftInfo);
  const isStarting = useLimitedStore((s) => s.isStarting);
  const [builtDeck, setBuiltDeck] = useState<{ main: DraftCard[]; sideboard: DraftCard[] }>({ main: [], sideboard: [] });
  const [commanderNames, setCommanderNames] = useState<string[]>([]);
  const [commander, setCommander] = useState("");
  const activeDraft = useLimitedStore((s) => s.activeDraft);
  const pick = useLimitedStore((s) => s.pickDraftCard);
  const undo = useLimitedStore((s) => s.undoDraftPick);
  const refresh = useLimitedStore((s) => s.refreshDraftState);
  const conspiracyHooks = useLimitedStore((s) => s.conspiracyHooks);
  const fetchConspiracyHooks = useLimitedStore((s) => s.fetchConspiracyHooks);
  const lastError = useLimitedStore((s) => s.lastError);
  const [userMode, setUserMode] = useState<DraftMode>("drafting");
  const [picking, setPicking] = useState(false);
  const pickingRef = useRef(false);
  useEffect(() => {
    if (!draftId) return;
    if (!activeDraft || activeDraft.sessionId !== draftId) {
      refresh(draftId);
    }
  }, [draftId, activeDraft, refresh]);
  useEffect(() => {
    if (conspiracyHooks.length === 0) {
      fetchConspiracyHooks();
    }
  }, [conspiracyHooks.length, fetchConspiracyHooks]);
  // Derive the effective mode — the draft being complete forces the
  // builder, otherwise the user's selection wins. Computed in render
  // so we avoid the setState-in-effect anti-pattern.
  const mode: DraftMode = activeDraft?.isComplete ? "building" : userMode;
  const isCommanderDraft = activeDraft?.commanderDraft === true;
  const targetMain = isCommanderDraft ? 60 : 40;
  useEffect(() => {
    if (!isCommanderDraft || !activeDraft || commanderNames.length > 0) return;
    commanderDraftInfo(activeDraft.sessionId)
      .then((info) => {
        setCommanderNames(info.commanders);
        setCommander((prev) => prev || info.commanders[0] || "");
      })
      .catch(() => {});
  }, [isCommanderDraft, activeDraft, commanderDraftInfo, commanderNames.length]);
  if (!activeDraft) {
    return (
      <div className="flex h-full items-center justify-center">
        {lastError ? (
          <p className="text-destructive">{lastError}</p>
        ) : (
          <p className="text-muted-foreground"><Trans>Loading draft…</Trans></p>
        )}
      </div>
    );
  }
  const handlePick = async (card: DraftCard, useDraftEffect = false) => {
    if (!draftId || !activeDraft.awaitingHuman || pickingRef.current) return;
    pickingRef.current = true;
    setPicking(true);
    try {
      await pick(draftId, card, useDraftEffect);
    } catch {
      /* surfaced via lastError */
    } finally {
      pickingRef.current = false;
      setPicking(false);
    }
  };
  const handleUndo = async () => {
    if (!draftId) return;
    try {
      await undo(draftId);
    } catch {
      /* surfaced via lastError */
    }
  };
  const canBuild = activeDraft.pickedPile.length >= 1;
  return (
    <div className="flex h-full flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <DraftStatusBar
        draft={activeDraft}
        mode={mode}
        onModeChange={setUserMode}
        onUndo={!activeDraft.isComplete ? handleUndo : undefined}
        canBuild={canBuild}
      />

      {mode === "building" ? (
        <div className="min-h-0 flex-1">
          {isCommanderDraft && (
            <label className="mb-2 flex items-center gap-2 text-sm">
              <span className="text-muted-foreground"><Trans>Commander</Trans></span>
              <select
                value={commander}
                onChange={(e) => setCommander(e.target.value)}
                className="rounded border border-border/70 bg-background px-2 py-1 text-sm"
              >
                {commanderNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {activeDraft.isComplete && (
            <Button
              variant="primary"
              disabled={
                isStarting ||
                builtDeck.main.length < targetMain ||
                (isCommanderDraft && !commander)
              }
              onClick={async () => {
                try {
                  if (isCommanderDraft) {
                    const game = await startCommanderGame(
                      activeDraft.sessionId,
                      builtDeck.main,
                      builtDeck.sideboard,
                      commander,
                    );
                    await startLocalDeckGame({
                      format: "commander_draft",
                      humanDeck: game.humanDeck,
                      humanCommanders: game.humanCommanders,
                      humanConspiracies: activeDraft.humanConspiracies ?? [],
                      aiDeck: game.opponents[0]?.deck,
                      aiCommanders: game.opponents[0]?.commanders ?? [],
                      extraOpponents: game.opponents.slice(1),
                    });
                    navigate(ROUTES.PLAY);
                  } else {
                    const g = await startGauntlet(
                      "draft",
                      activeDraft.sessionId,
                      activeDraft.seatSummaries.length - 1,
                      builtDeck.main,
                      builtDeck.sideboard,
                    );
                    navigate(`/gauntlet/${g.gauntletId}`);
                  }
                } catch {
                  /* surfaced via lastError */
                }
              }}
            >
              {isStarting
                ? "Setting up…"
                : builtDeck.main.length < targetMain
                  ? `Need ${targetMain - builtDeck.main.length} more cards`
                  : isCommanderDraft
                    ? "Play 4-player Commander"
                    : "Play against this draft pod"}
            </Button>
          )}
          <LimitedDeckBuilder
            pool={activeDraft.pickedPile}
            initialSideboard={activeDraft.pickedPile}
            onChange={setBuiltDeck}
            defaultDeckName={isCommanderDraft ? "Commander Draft Deck" : "Booster Draft Deck"}
            format="draft"
            targetMainSize={targetMain}
          />
        </div>
      ) : (
        <DraftWorkspace
          draft={activeDraft}
          onPick={handlePick}
          onBuild={canBuild ? () => setUserMode("building") : undefined}
          conspiracyHooks={conspiracyHooks}
          pickPending={picking}
        />
      )}

      {lastError && (
        <p className="rounded border border-destructive/70 bg-destructive/10 p-3 text-sm text-destructive">
          {lastError}
        </p>
      )}
    </div>
  );
}
