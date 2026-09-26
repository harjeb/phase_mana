import { useId, useState } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { useOwnedDecks } from "@/hooks/useOwnedDecks";
import { usePresetDecks } from "@/stores/usePresetDecksStore";
import { filterPresetDecksForFormat } from "@/lib/presetDecks";
import { exportWaitingRoomDeck } from "@/components/lobby/hostedWaitingRoomDeck";

interface Props {
  format: string;
  disabled: boolean;
  onCommand: (type: string, data?: unknown) => void;
}

export function HostedWaitingRoomDeckPicker({ format, disabled, onCommand }: Props) {
  const owned = useOwnedDecks();
  const presets = filterPresetDecksForFormat(usePresetDecks("Manabrew"), format);
  const [selected, setSelected] = useState("");
  const id = useId();
  const choices = [
    ...owned.map((saved) => ({ key: `owned:${saved.id}`, deck: saved.deck })),
    ...presets.map((deck, index) => ({ key: `preset:${deck.id ?? index}`, deck })),
  ];
  const deck = choices.find((choice) => choice.key === selected)?.deck;

  return (
    <div className="space-y-3">
      <label htmlFor={id} className="text-sm font-medium"><Trans>Your deck</Trans></label>
      <select id={id} value={deck ? selected : ""} disabled={disabled}
        onChange={(event) => setSelected(event.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50">
        <option value="">{t`Choose a deck`}</option>
        <optgroup label={t`My Decks`}>
          {choices.filter((choice) => choice.key.startsWith("owned:")).map((choice) => (
            <option key={choice.key} value={choice.key}>{choice.deck.name}</option>
          ))}
        </optgroup>
        <optgroup label={t`Preset decks`}>
          {choices.filter((choice) => choice.key.startsWith("preset:")).map((choice) => (
            <option key={choice.key} value={choice.key}>{choice.deck.name}</option>
          ))}
        </optgroup>
      </select>
      {presets.length === 0 && <p className="text-sm text-muted-foreground"><Trans>No preset decks for this format.</Trans></p>}
      {deck && <p className="text-sm text-muted-foreground">
        <Trans>Main deck: {deck.cards.length} · Sideboard: {deck.sideboard.length} · Commanders: {deck.commanders?.length ?? 0}</Trans>
      </p>}
      <Button variant="outline" disabled={disabled || !deck || deck.cards.length === 0}
        onClick={() => {
          if (!disabled && deck) onCommand("RoomDeck", { deckName: deck.name, deck: exportWaitingRoomDeck(deck) });
        }}><Trans>Use deck</Trans></Button>
      <p className="text-sm text-muted-foreground"><Trans>Changing your deck clears your ready status.</Trans></p>
    </div>
  );
}
