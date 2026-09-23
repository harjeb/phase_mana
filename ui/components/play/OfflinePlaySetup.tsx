import { DeckVsSelector } from "@/components/lobby/DeckVsSelector";
import type { CustomFormatRules } from "@/lib/customFormats";
import type { Deck } from "@/protocol/deck";

interface OfflinePlaySetupProps {
  preSelectedDeckId?: string;
  preSelectedHubDeckId?: string;
  preSelectedFormatId?: string;
  onStart: (
    playerDeck: Deck,
    opponentDecks: Deck[],
    formatId?: string,
    commanderName?: string,
    customRules?: CustomFormatRules,
  ) => Promise<boolean>;
}

export function OfflinePlaySetup({
  preSelectedDeckId,
  preSelectedHubDeckId,
  preSelectedFormatId,
  onStart,
}: OfflinePlaySetupProps) {
  return (
    <div className="h-full min-h-0">
      <DeckVsSelector
        preSelectedDeckId={preSelectedDeckId}
        preSelectedHubDeckId={preSelectedHubDeckId}
        preSelectedFormatId={preSelectedFormatId}
        onStart={onStart}
      />
    </div>
  );
}
