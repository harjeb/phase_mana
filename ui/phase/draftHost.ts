/**
 * Wire shapes for a server-hosted draft, kept pure so the endpoint mapping and
 * the private-room fields are testable without a socket or a browser.
 *
 * A draft code is six enumerable characters, so the draft is created with a
 * random password and that password travels in the invitation, never the code
 * alone. Drafts are otherwise the same native protocol as a direct game.
 */
/** The native protocol route underneath the room wrapper's `/room` route. */
export function draftSocketEndpoint(endpoint: string): string {
  return endpoint.replace(/\/room\/?$/, "/ws");
}

export interface DraftHostSettings {
  displayName: string;
  setCode: string;
  kind: string;
  podSize: number;
  /** `null` only on the advanced code-only path, which predates invitations. */
  password: string | null;
}

export function draftCreateRequest(settings: DraftHostSettings) {
  return {
    type: "CreateDraftWithSettings",
    data: {
      display_name: settings.displayName,
      set_codes: [settings.setCode.trim().toUpperCase()],
      kind: settings.kind,
      public: false,
      password: settings.password,
      timer_seconds: null,
      tournament_format: "Swiss",
      pod_policy: "Casual",
      pod_size: settings.podSize,
    },
  };
}

export function draftJoinRequest(invite: { endpoint: string; gameCode: string; password: string }, displayName: string) {
  return {
    endpoint: draftSocketEndpoint(invite.endpoint),
    request: {
      type: "JoinDraftWithPassword",
      data: { draft_code: invite.gameCode, display_name: displayName, password: invite.password },
    },
  };
}
