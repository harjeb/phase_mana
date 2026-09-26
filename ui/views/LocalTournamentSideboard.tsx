import { useState } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { localMatchDecks, swapLocalSideboard, type LocalTournament } from "@/lib/localTournament";
import { useLocalTournamentStore } from "@/stores/useLocalTournamentStore";

export function LocalTournamentSideboard({ event, round, match }: { event: LocalTournament; round: number; match: number }) {
  const state = useLocalTournamentStore();
  const [main, setMain] = useState(0);
  const [side, setSide] = useState(0);
  const pairing = event.rounds[round][match];
  const deck = localMatchDecks(event, pairing)[pairing.players.indexOf(0)];
  return <fieldset className="space-y-2 rounded border border-border p-3" disabled={state.busy}>
    <legend className="text-sm font-semibold"><Trans>Between-game sideboarding</Trans></legend>
    <p className="text-sm text-muted-foreground"><Trans>Swap one main-deck copy with one sideboard copy. Each swap is saved immediately for this match. Original lists return next round; commanders cannot change.</Trans></p>
    <p className="text-sm"><Trans>Main deck</Trans>: {deck.cards.length} · <Trans>Sideboard</Trans>: {deck.sideboard?.length ?? 0}</p>
    {deck.sideboard?.length ? <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 text-sm"><Trans>Main-deck copy to remove</Trans><select aria-label={t`Main-deck copy to remove`} className="block max-w-full rounded border border-border bg-background p-2" value={main} onChange={e => setMain(Number(e.target.value))}>{deck.cards.map((card, i) => <option key={i} value={i}>{i + 1}. {card.identity.name}</option>)}</select></label>
      <label className="min-w-0 text-sm"><Trans>Sideboard copy to add</Trans><select aria-label={t`Sideboard copy to add`} className="block max-w-full rounded border border-border bg-background p-2" value={side} onChange={e => setSide(Number(e.target.value))}>{deck.sideboard.map((card, i) => <option key={i} value={i}>{i + 1}. {card.identity.name}</option>)}</select></label>
      <Button variant="outline" onClick={() => void state.run(async () => {
        const current = useLocalTournamentStore.getState().event;
        if (current?.id !== event.id) return;
        // Indexes refer to the displayed snapshot; don't swap different cards after another tab edits it.
        if (JSON.stringify(current.rounds[round]?.[match]) !== JSON.stringify(pairing)) throw new Error(t`The match changed in another tab. Review the current lists and try again.`);
        state.save(swapLocalSideboard(current, round, match, main, side));
      })}><Trans>Swap and save</Trans></Button>
    </div> : <p className="text-sm"><Trans>This deck has no sideboard cards.</Trans></p>}
  </fieldset>;
}
