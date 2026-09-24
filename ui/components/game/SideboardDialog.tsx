import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { DeckCardCount, SideboardInput, SideboardOutput } from "@/protocol/prompts/sideboard";

/** Only the seat-addressed authoritative prompt supplies this pool. Never use gameDecks. */
export function SideboardDialog({ input, pending, error, onSubmit }: {
  input: SideboardInput;
  pending: boolean;
  error?: string;
  onSubmit: (output: SideboardOutput) => void;
}) {
  const [main, setMain] = useState(() => input.main.map((card) => ({ ...card })));
  const [sideboard, setSideboard] = useState(() => input.sideboard.map((card) => ({ ...card })));
  const total = (cards: DeckCardCount[]) => cards.reduce((sum, card) => sum + card.count, 0);
  const mainCount = total(main);
  const sideCount = total(sideboard);
  const valid = mainCount >= input.minMainDeckSize &&
    (input.maxSideboardSize == null || sideCount <= input.maxSideboardSize);
  function move(name: string, fromMain: boolean) {
    if (pending) return;
    const source = fromMain ? main : sideboard;
    const target = fromMain ? sideboard : main;
    if (!source.some((card) => card.name === name && card.count > 0)) return;
    const nextSource = source.map((card) => card.name === name ? { ...card, count: card.count - 1 } : card).filter((card) => card.count > 0);
    const nextTarget = target.some((card) => card.name === name)
      ? target.map((card) => card.name === name ? { ...card, count: card.count + 1 } : card)
      : [...target, { name, count: 1 }];
    setMain(fromMain ? nextSource : nextTarget);
    setSideboard(fromMain ? nextTarget : nextSource);
  }
  return <Dialog open>
    <DialogContent className="max-w-3xl [&>button:last-child]:hidden" onEscapeKeyDown={(event) => event.preventDefault()} onPointerDownOutside={(event) => event.preventDefault()}>
      <DialogHeader>
        <DialogTitle><Trans>Sideboard</Trans></DialogTitle>
        <DialogDescription>{input.presentation.text}</DialogDescription>
      </DialogHeader>
      <p className="text-sm">Move cards between your main deck and sideboard. Minimum main deck: {input.minMainDeckSize}. {input.maxSideboardSize == null ? "No sideboard size limit." : `Maximum sideboard: ${input.maxSideboardSize}.`}</p>
      <div className="grid grid-cols-2 gap-4">
        {([true, false] as const).map((fromMain) => <section key={String(fromMain)}>
          <h3 className="font-semibold">{fromMain ? `Main deck (${mainCount})` : `Sideboard (${sideCount})`}</h3>
          <ul className="max-h-80 overflow-y-auto">
            {(fromMain ? main : sideboard).map((card) => <li key={card.name} className="flex items-center justify-between gap-2 py-1">
              <span>{card.count} × {card.name}</span>
              <Button size="sm" variant="outline" disabled={pending} aria-label={`Move ${card.name} to ${fromMain ? "sideboard" : "main deck"}`} onClick={() => move(card.name, fromMain)}>{fromMain ? "→" : "←"}</Button>
            </li>)}
          </ul>
        </section>)}
      </div>
      {!valid && <p role="alert"><Trans>Your deck does not meet the size requirements.</Trans></p>}
      {error && <p role="alert">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => { setMain(input.main.map((card) => ({ ...card }))); setSideboard(input.sideboard.map((card) => ({ ...card }))); }}><Trans>Reset</Trans></Button>
        <Button variant="primary" disabled={pending || !valid} onClick={() => onSubmit({ type: "submitSideboard", main, sideboard })}>{pending ? "Submitting…" : "Ready for next game"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
