import { t } from "@lingui/core/macro";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureOnlineDraftTransport, handleOnlineDraftFrame, onlineDraftStatus, reconnectOnlineDraft, sendOnlineDraftAction, startOnlineDraft } from "./onlineDraft";
const endpoint = "ws://localhost:9374/ws";
const connect = vi.fn();
const send = vi.fn();
beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  connect.mockReset(); send.mockReset();
  configureOnlineDraftTransport({ connect, send });
  startOnlineDraft(endpoint, { type: "CreateDraftWithSettings", data: {} });
});
const attach = () => handleOnlineDraftFrame({ type: "DraftCreated", data: { draft_code: "POD123", player_token: "private-seat", seat_index: 1 } }, endpoint);
describe("native draft client", () => {
  it("reconnects with the saved draft credential scoped to the exact server", () => {
    attach();
    reconnectOnlineDraft(endpoint);
    expect(connect).toHaveBeenLastCalledWith(endpoint, { type: "ReconnectDraft", data: { draft_code: "POD123", player_token: "private-seat" } });
    expect(() => reconnectOnlineDraft("ws://elsewhere/ws")).toThrow("No saved draft seat");
  });
  it("sends card instance IDs once until an authoritative view or refusal arrives", () => {
    attach();
    sendOnlineDraftAction("Pick", { seat: 1, card_instance_ids: ["card-copy-2"] });
    expect(send).toHaveBeenCalledWith("DraftAction", { draft_code: "POD123", action: { type: "Pick", data: { seat: 1, card_instance_ids: ["card-copy-2"] } } });
    expect(() => sendOnlineDraftAction("Pick", {})).toThrow("previous draft action");
    handleOnlineDraftFrame({ type: "DraftActionRejected", data: { reason: "Not your pack" } }, endpoint);
    expect(onlineDraftStatus()).toMatchObject({ pending: false, error: "Not your pack" });
  });
  it("retains only the private projection delivered by the server and delegates match frames", () => {
    attach();
    const view = { status: "Drafting", pool: [{ instance_id: "own-card" }], current_pack: [] };
    expect(handleOnlineDraftFrame({ type: "DraftStateUpdate", data: { view } }, endpoint)).toBe(true);
    expect(onlineDraftStatus().view).toBe(view);
    expect(handleOnlineDraftFrame({ type: "DraftMatchStart", data: { game_code: "MATCH1" } }, endpoint)).toBe(false);
    expect(onlineDraftStatus().matchCode).toBe("MATCH1");
    expect(handleOnlineDraftFrame({ type: "ManabrewSnapshot", data: {} }, endpoint)).toBe(false);
  });
  it("does not retain a pending lock after a disconnected send", () => {
    attach(); send.mockImplementation(() => { throw new Error(t`Disconnected`); });
    expect(() => sendOnlineDraftAction("StartDraft")).toThrow("Disconnected");
    expect(onlineDraftStatus().pending).toBe(false);
  });
});
