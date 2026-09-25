import { msg, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OpenTableSeats } from "@/components/lobby/OpenTableSeats";
import {
  BOARD_BACKGROUNDS,
  boardBackgroundUrl,
  type BoardBackgroundId,
} from "@/pixi/board/boardBackgrounds";
import { cn } from "@/lib/utils";
import type { RoomPlayerInfo } from "@/types/server";

const BACKGROUND_LABELS = {
  none: msg`None`,
  dark_oak: msg`Dark oak`,
  dark_stone: msg`Dark stone`,
  dark_table: msg`Dark table`,
  dark_wood: msg`Dark wood`,
  glacier: msg`Glacier`,
  magic_cloth: msg`Magic cloth`,
  refined_redwood: msg`Refined redwood`,
  refined_stone: msg`Refined stone`,
  refined_wood: msg`Refined wood`,
  stone_slate: msg`Stone slate`,
  tavern_table: msg`Tavern table`,
  volcanic_stone: msg`Volcanic stone`,
};

const SEATS: RoomPlayerInfo[] = [
  { username: "You", ready: true, connected: true },
  { username: "AI", ready: true, connected: true, is_bot: true },
];

interface TablePickerDialogProps {
  open: boolean;
  background: BoardBackgroundId;
  onBackgroundChange: (id: BoardBackgroundId) => void;
  onStart: () => void;
  onCancel: () => void;
  centerContent?: ReactNode;
}

export function TablePickerDialog({
  open,
  background,
  onBackgroundChange,
  onStart,
  onCancel,
  centerContent,
}: TablePickerDialogProps) {
  const { i18n } = useLingui();
  const seats = SEATS.map((seat) => ({ ...seat, username: seat.is_bot ? t`AI` : t`You` }));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle><Trans>Choose your table</Trans></DialogTitle>
          <DialogDescription><Trans>The felt you'll play this game on.</Trans></DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="flex items-center justify-center sm:pr-2">
            <OpenTableSeats
              players={seats}
              maxPlayers={2}
              showSeatLabels
              youUsername={t`You`}
              size="card"
              className="w-full max-w-none"
              backgroundUrl={boardBackgroundUrl(background)}
              centerContent={centerContent}
            />
          </div>
          <div className="grid grid-cols-3 gap-2 content-start sm:grid-cols-4">
            {BOARD_BACKGROUNDS.map((option) => {
              const isSelected = option.id === background;
              return (
                <button
                  key={option.id}
                  type="button"
                  title={i18n._(BACKGROUND_LABELS[option.id])}
                  onClick={() => onBackgroundChange(option.id)}
                  className={cn(
                    "overflow-hidden rounded-md border text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isSelected
                      ? "border-selection ring-1 ring-selection"
                      : "border-border/70 hover:border-primary/50",
                  )}
                >
                  {option.url ? (
                    <img
                      src={option.url}
                      alt=""
                      className="aspect-[16/9] w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex aspect-[16/9] w-full items-center justify-center bg-canvas-background text-[10px] text-muted-foreground">
                      <Trans>None</Trans>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            <Trans>Back</Trans>
          </Button>
          <Button variant="primary" onClick={onStart}>
            <Trans>Fight</Trans>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
