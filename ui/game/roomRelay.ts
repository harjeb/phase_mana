import { ROOM_RELAY_KIND, isRoomRelayEnvelope } from "@/types/server";
import type { RoomRelayEnvelope } from "@/types/server";

export const MANUAL_TABLETOP_RELAY_PROTOCOL = "manual-tabletop";
export const SELF_HOSTED_NODE_RELAY_PROTOCOL = "self-hosted-node";

export function createRoomRelayEnvelope<TPayload>(params: {
  protocol: string;
  payload: TPayload;
  fromPlayer?: string;
  targetPlayer?: string;
  roomId?: string;
}): RoomRelayEnvelope<TPayload> {
  return {
    kind: ROOM_RELAY_KIND,
    protocol: params.protocol,
    version: 1,
    messageId: createMessageId(),
    fromPlayer: params.fromPlayer,
    targetPlayer: params.targetPlayer,
    roomId: params.roomId,
    payload: params.payload,
  };
}

export function isRoomRelayProtocol<TPayload>(
  value: unknown,
  protocol: string,
): value is RoomRelayEnvelope<TPayload> {
  return isRoomRelayEnvelope(value) && value.protocol === protocol;
}

function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
