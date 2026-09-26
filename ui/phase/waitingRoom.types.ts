export interface RoomDeck {
  main_deck: string[];
  sideboard: string[];
  commander: string[];
}
export interface RoomMember {
  id: string;
  name: string;
  seat: number | null;
  ready: boolean;
  connected: boolean;
  deckName: string | null;
}
export interface WaitingRoom {
  code: string;
  hostId: string;
  phase: "waiting" | "starting" | "playing";
  format: string;
  capacity: number;
  members: RoomMember[];
}
export interface WaitingRoomStatus {
  endpoint: string;
  memberId: string;
  connected: boolean;
  connecting: boolean;
  room: WaitingRoom | null;
  error: string;
}
