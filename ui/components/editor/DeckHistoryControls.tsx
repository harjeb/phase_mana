import { t } from "@lingui/core/macro";
import { Redo2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { redoDeckEdit, undoDeckEdit, useDeckHistoryState } from "./deckEditor.history";

export function DeckHistoryControls() {
  const history = useDeckHistoryState();

  return (
    <div className="flex shrink-0 overflow-hidden rounded-md border">
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 rounded-none border-r"
        disabled={!history.undoLabel}
        title={history.undoLabel ? t`Undo ${history.undoLabel}` : t`Nothing to undo`}
        onClick={undoDeckEdit}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 rounded-none"
        disabled={!history.redoLabel}
        title={history.redoLabel ? t`Redo ${history.redoLabel}` : t`Nothing to redo`}
        onClick={redoDeckEdit}
      >
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
