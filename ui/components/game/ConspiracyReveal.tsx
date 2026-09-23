import { useState } from "react";
import { revealConspiracy } from "@/phase/transport";
import type { ClientCardDto } from "@/stores/gameStore.types";

/**
 * CR 905.4a + CR 702.106: a hidden-agenda conspiracy starts the game face down in
 * its controller's command zone; any time its controller has priority they may
 * turn it face up. The control submits the engine's offered reveal action through
 * the same authenticated response path as the rest of the game.
 *
 * Compat blanks the name of a face-down command-zone card for every viewer
 * (including its controller), so this control keys on the wire card id and
 * labels each face-down command-zone card generically. A face-down command-zone
 * card can only be a hidden-agenda conspiracy, so the filter is exact.
 */
export function ConspiracyReveal({ commandZone, canReveal }: { commandZone: ClientCardDto[]; canReveal: boolean }) {
  const [pending, setPending] = useState<string | null>(null);
  const faceDown = commandZone.filter((card) => card.isFaceDown);
  if (faceDown.length === 0) return null;
  return (
    <div className="pointer-events-auto absolute right-3 top-3 z-40 flex flex-col gap-1 rounded-md border border-primary/40 bg-background/95 p-2 text-xs shadow-lg">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
        Hidden agenda
      </span>
      {faceDown.map((card, index) => (
        <button
          key={card.id}
          type="button"
          disabled={!canReveal || pending !== null}
          className="rounded px-2 py-1 text-left hover:bg-primary/10 disabled:opacity-50"
          onClick={async () => {
            setPending(card.id);
            try {
              await revealConspiracy(card.id);
            } catch {
              // Transport reports the rejection; retain the current authoritative snapshot.
            } finally {
              setPending(null);
            }
          }}
        >
          Reveal {faceDown.length > 1 ? `conspiracy ${index + 1}` : "conspiracy"}
        </button>
      ))}
    </div>
  );
}
