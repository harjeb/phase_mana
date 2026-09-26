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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`/api/host/${action}`, {
      method: action === "status" ? "GET" : "POST",
      headers: { "X-Phase-Host": "1" },
      signal: controller.signal,
    });
    let data;
    try { data = await response.json(); }
    catch (cause) {
      if (controller.signal.aborted) throw cause;
      throw new Error(t`The local hosting service returned an invalid response. Start the local app and try again.`);
    }
    if (!response.ok) throw new Error(data?.error ?? t`The host request failed.`);
    return data;
  } catch (cause) {
    if (controller.signal.aborted) throw new Error(t`The hosting request timed out. Check the local app and try again.`);
    if (cause instanceof TypeError) throw new Error(t`Could not reach the local hosting service. Start the local app and try again.`);
    throw cause;
  } finally {
    clearTimeout(timeout);
  }
}
export async function stopHostedRoom() {
  await hostRequest("stop");
  saveHostedRoom(null);
}
