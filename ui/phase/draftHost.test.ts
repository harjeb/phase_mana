import { describe, expect, it } from "vitest";
import { draftCreateRequest, draftJoinRequest, draftSocketEndpoint } from "./draftHost";

describe("server-hosted draft wire mapping", () => {
  it("dials the native protocol route behind the room wrapper", () => {
    expect(draftSocketEndpoint("ws://127.0.0.1:5000/room")).toBe("ws://127.0.0.1:5000/ws");
    expect(draftSocketEndpoint("ws://127.0.0.1:5000/room/")).toBe("ws://127.0.0.1:5000/ws");
    expect(draftSocketEndpoint("ws://127.0.0.1:5000/ws")).toBe("ws://127.0.0.1:5000/ws");
    expect(draftSocketEndpoint("wss://draft.example.com/ws")).toBe("wss://draft.example.com/ws");
  });

  it("creates a private draft so a six-character code is never the only defence", () => {
    expect(draftCreateRequest({ displayName: "Host", setCode: " m21 ", kind: "Traditional", podSize: 4, password: "pw" })).toEqual({
      type: "CreateDraftWithSettings",
      data: {
        display_name: "Host", set_codes: ["M21"], kind: "Traditional", public: false, password: "pw",
        timer_seconds: null, tournament_format: "Swiss", pod_policy: "Casual", pod_size: 4,
      },
    });
  });

  it("turns an invitation into a password-authenticated join on the socket route", () => {
    expect(draftJoinRequest({ endpoint: "ws://192.168.1.2:5000/room", gameCode: "ABC123", password: "pw" }, "Guest")).toEqual({
      endpoint: "ws://192.168.1.2:5000/ws",
      request: { type: "JoinDraftWithPassword", data: { draft_code: "ABC123", display_name: "Guest", password: "pw" } },
    });
  });
});
