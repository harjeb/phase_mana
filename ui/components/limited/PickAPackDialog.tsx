import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PickAPackView } from "@/types/limited";

interface PickAPackDialogProps {
  view: PickAPackView | null;
  pending: boolean;
  onPick: (index: number) => void | Promise<void>;
  onOpenChange: (open: boolean) => void;
}

/**
 * Pick-a-Pack (先选包): before the normal draft, each seat snake-picks which
 * unopened boosters it will open. The packs are face down, so only the set
 * label is shown; the AI seats pick automatically between the human's turns.
 */
export function PickAPackDialog({ view, pending, onPick, onOpenChange }: PickAPackDialogProps) {
  return (
    <Dialog open={view !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <Trans>Pick-a-Pack</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Before opening, snake-pick which unopened boosters you and the AI will draft from.
            </Trans>
          </DialogDescription>
        </DialogHeader>
        {view ? (
          <div className="grid gap-3">
            <p className="text-xs text-muted-foreground">
              <Trans>
                Your picks: {view.yourPicks} / {view.picksEach}
              </Trans>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {view.packs.map((pack) => (
                <button
                  key={pack.index}
                  type="button"
                  disabled={pack.taken || pending || !view.awaitingPick}
                  onClick={() => void onPick(pack.index)}
                  className="flex items-center justify-between gap-2 rounded border border-border/40 bg-card/30 px-3 py-2 text-left text-sm transition hover:border-primary/50 hover:bg-card/60 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="font-medium uppercase">{pack.setCode || t`Pack`}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {pack.taken ? t`Taken` : t`Open`}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                <Trans>Cancel</Trans>
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
