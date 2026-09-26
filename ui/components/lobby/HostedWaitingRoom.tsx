import { useId } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { HostedWaitingRoomDeckPicker } from "@/components/lobby/HostedWaitingRoomDeckPicker";
import { GAME_FORMATS } from "@/lib/formats";
import { formatDisplayName } from "@/lib/formatLabels";
import { stripUsernameTag } from "@/lib/username";
import type { WaitingRoomStatus } from "@/phase/waitingRoom.types";

// Keep aligned with the hosted room's supported engine configurations.
const ROOM_FORMATS = new Set([
  "standard", "modern", "pioneer", "legacy", "vintage", "pauper",
  "commander", "two_headed_giant",
]);

interface Props {
  status: WaitingRoomStatus;
  onCommand: (type: string, data?: unknown) => void;
  onLeave: () => void;
}

export function HostedWaitingRoom({ status, onCommand, onLeave }: Props) {
  const id = useId();
  const room = status.room;
  if (!room) return null;
  const me = room.members.find((member) => member.id === status.memberId);
  const host = room.hostId === status.memberId;
  const seated = me?.seat != null;
  const editable = status.connected && room.phase === "waiting";
  const seats = Array.from({ length: room.capacity }, (_, seat) =>
    room.members.find((member) => member.seat === seat));
  const canStart = editable && host && seated && seats.every((member) =>
    member?.connected && member.ready && member.deckName != null);

  return (
    <section className="space-y-5 rounded-xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold"><Trans>Waiting room</Trans></h2>
        <Button variant="outline" onClick={onLeave}>{host ? t`Close room` : t`Leave room`}</Button>
      </div>
      {status.error && <p role="alert" className="text-sm text-destructive">{status.error}</p>}
      <p role="status" className="text-sm text-muted-foreground">
        {!status.connected ? (status.connecting ? t`Connecting…` : t`Disconnected`) :
          room.phase === "starting" ? t`Starting game…` :
          room.phase === "playing" ? t`Game started.` : t`Choose a seat, select a deck, then get ready.`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm" htmlFor={`${id}-format`}>
          <span className="font-medium"><Trans>Format</Trans></span>
          <select id={`${id}-format`} aria-label={t`Format`} value={room.format} disabled={!host || !editable}
            className="h-10 w-full rounded-md border border-input bg-background px-3 disabled:opacity-50"
            onChange={(event) => onCommand("RoomSettings", {
              format: event.target.value,
              capacity: event.target.value === "two_headed_giant" ? 4 : room.capacity,
            })}>
            {GAME_FORMATS.filter((format) => ROOM_FORMATS.has(format.id)).map((format) => (
              <option key={format.id} value={format.id}>{formatDisplayName(format)}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm" htmlFor={`${id}-capacity`}>
          <span className="font-medium"><Trans>Seats</Trans></span>
          <select id={`${id}-capacity`} aria-label={t`Seats`} value={room.capacity}
            disabled={!host || !editable || room.format === "two_headed_giant"}
            className="h-10 w-full rounded-md border border-input bg-background px-3 disabled:opacity-50"
            onChange={(event) => onCommand("RoomSettings", { format: room.format, capacity: Number(event.target.value) })}>
            {[2, 3, 4].map((capacity) => <option key={capacity} value={capacity}>{capacity}</option>)}
          </select>
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {seats.map((member, seat) => (
          <div key={seat} className="space-y-2 rounded-lg border bg-background p-3">
            <p className="text-sm font-medium"><Trans>Seat {seat + 1}</Trans></p>
            {member ? <>
              <p className="break-words font-medium">{stripUsernameTag(member.name)}
                {member.id === status.memberId && <span className="ml-2 text-sm text-muted-foreground"><Trans>You</Trans></span>}
                {member.id === room.hostId && <span className="ml-2 text-sm text-muted-foreground"><Trans>Host</Trans></span>}
              </p>
              <p className="text-sm text-muted-foreground">{member.connected ? t`Connected` : t`Disconnected`}</p>
              <p className="break-words text-sm">{member.deckName ?? t`No deck selected`}</p>
              <p className="text-sm">{member.ready ? t`Ready` : t`Not ready`}</p>
            </> : <Button variant="outline" disabled={!editable}
              onClick={() => onCommand("RoomSit", { seat })}><Trans>Sit here</Trans></Button>}
          </div>
        ))}
      </div>
      {seated && <Button variant="outline" disabled={!editable}
        onClick={() => onCommand("RoomSit", { seat: null })}><Trans>Stand up</Trans></Button>}
      {!seated && <p className="text-sm text-muted-foreground"><Trans>Take a seat to choose your deck and get ready.</Trans></p>}
      <HostedWaitingRoomDeckPicker key={`${room.code}:${room.format}`} format={room.format}
        disabled={!editable || !seated} onCommand={(type, data) => {
          if (!editable || !seated) return;
          if (me?.ready) onCommand("RoomReady", { ready: false });
          onCommand(type, data);
        }} />
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={!editable || !seated || me?.deckName == null}
          onClick={() => onCommand("RoomReady", { ready: !me?.ready })}>
          {me?.ready ? t`Not ready` : t`Ready`}
        </Button>
        {host && <Button variant="primary" disabled={!canStart} onClick={() => onCommand("RoomStart", {})}><Trans>Start game</Trans></Button>}
      </div>
      {host && room.phase === "waiting" && <p className="text-sm text-muted-foreground">
        <Trans>Take a seat and wait for every seat to be filled, connected, and ready before starting.</Trans>
      </p>}
    </section>
  );
}
