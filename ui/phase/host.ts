import { t } from "@lingui/core/macro";
import { decodeInvite, inviteEndpoint } from "./invite";

const key = "phase-host-room";
export interface HostedRoom { endpoint: string; code: string; scope?: ReturnType<typeof inviteEndpoint>["scope"] }
export function hostedRoom(): HostedRoom | null {
  try {
    const room = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!room || typeof room.endpoint !== "string") return null;
    if (room.code) decodeInvite(room.code);
    return room;
  } catch { return null; }
}
export function saveHostedRoom(room: HostedRoom | null) {
  if (room) sessionStorage.setItem(key, JSON.stringify(room));
  else sessionStorage.removeItem(key);
}
export async function hostRequest(action: "start" | "stop" | "status") {
  const response = await fetch(`/api/host/${action}`, {
    method: action === "status" ? "GET" : "POST",
    headers: { "X-Phase-Host": "1" },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error ?? t`The host request failed.`);
  return data;
}
export async function stopHostedRoom() {
  await hostRequest("stop");
  saveHostedRoom(null);
}
