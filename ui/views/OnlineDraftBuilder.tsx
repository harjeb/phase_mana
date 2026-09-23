import { useState } from "react";
import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { Button } from "@/components/ui/button";
import type { OnlineDraftView } from "@/phase/onlineDraft";

/** Edits a deck proposal only. The server validates pool ownership and construction rules. */
export default function OnlineDraftBuilder({ view, seat, disabled, onSubmit }: {
  view: OnlineDraftView; seat: number; disabled: boolean; onSubmit: (names: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Record<string, number>>({});
  const names = [...view.pool.filter(card => selected.has(card.instance_id)).map(card => card.name),
    ...view.addable_cards.flatMap(name => Array<string>(added[name] ?? 0).fill(name))];
  const submitted = view.seats.find(player => player.seat_index === seat)?.has_submitted_deck;
  return <section className="space-y-3" aria-label={t`Build draft deck`}>
    <p><Trans>Main deck:</Trans> {names.length} · <Trans>Minimum:</Trans> {view.min_deck_size}</p>
    <p><Trans>Choose cards for your main deck. The server retains the remaining pool as your sideboard.</Trans></p>
    <div className="grid max-h-96 grid-cols-1 gap-2 overflow-auto sm:grid-cols-2">{view.pool.map(card => <label className="flex items-center gap-2 rounded border p-2" key={card.instance_id}>
      <input type="checkbox" disabled={disabled || submitted} checked={selected.has(card.instance_id)} onChange={() => setSelected(previous => {
        const next = new Set(previous); if (next.has(card.instance_id)) next.delete(card.instance_id); else next.add(card.instance_id); return next;
      })} />{card.name}
    </label>)}</div>
    <div className="flex flex-wrap gap-3">{view.addable_cards.map(name => <label key={name} className="flex items-center gap-2">{name}<input aria-label={name} type="number" min={0} max={250} value={added[name] ?? 0} disabled={disabled || submitted}
      className="w-20 rounded border bg-background p-2" onChange={event => setAdded(previous => ({ ...previous, [name]: Math.max(0, Math.min(250, Math.trunc(Number(event.target.value) || 0))) }))} /></label>)}</div>
    <Button variant="primary" disabled={disabled || submitted} onClick={() => onSubmit(names)}>{submitted ? <Trans>Deck submitted</Trans> : <Trans>Submit deck</Trans>}</Button>
  </section>;
}
