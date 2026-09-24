import { t } from "@lingui/core/macro";
export type TournamentRole = "Organizer" | "Player";
export type TournamentOutcome = "Draw" | { Decisive: { winner: string; game_wins: Record<string, number> } };
export interface TournamentPlayer { player_key: string; display_name: string; dropped: boolean }
export interface TournamentSummary {
  code: string; name: string; arity: number; bracket: "Swiss" | "SingleElimination";
  status: string; current_round: number; total_rounds: number; player_count: number;
  match_type: "Bo1" | "Bo3"; scoring: { win_points: number; draw_points: number; loss_points: number };
  open_actions: ("StartRound" | "EndTournament" | "Drop")[];
}
export interface TournamentView {
  summary: TournamentSummary; players: TournamentPlayer[];
  pairings: { id: number; round: number; players: TournamentPlayer[]; report_gate: string;
    outcome: null | "Bye" | { Forfeit: { winner: string } } | { Reported: TournamentOutcome } }[];
  standings: (TournamentPlayer & { match_points: number; matches_played: number; byes: number })[];
}
interface Credential { token: string; expires: number; playerKey?: string; nonce?: string }
type Credentials = Record<string, Partial<Record<TournamentRole, Credential>>>;
interface State {
  endpoint: string; connected: boolean; busy: boolean; error: string;
  list: TournamentSummary[]; view: TournamentView | null; credentials: Credentials;
}
interface Reply { code?: string; view?: TournamentView; [key: string]: unknown }
interface Pending {
  match: (type: string, data: Reply) => boolean; requestId?: number;
  resolve: (data: Reply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>;
}

/** Lobby-only connection. Secrets are scoped to the exact endpoint and browser tab. */
export class TournamentClient {
  private socket: WebSocket | null = null;
  private pending: Pending | null = null;
  private nextId = 1;
  private listeners = new Set<() => void>();
  private state: State = { endpoint: "", connected: false, busy: false, error: "", list: [], view: null, credentials: {} };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<State>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private persist() {
    sessionStorage.setItem(`phase-tournaments:${this.state.endpoint}`, JSON.stringify(this.state.credentials));
    this.update({ credentials: { ...this.state.credentials } });
  }
  private settle(error?: string, reply?: Reply) {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timer);
    this.update({ busy: false });
    if (error) pending.reject(new Error(error)); else pending.resolve(reply ?? {});
  }
  disconnect = () => {
    const old = this.socket;
    this.socket = null;
    old?.close();
    this.settle("Connection closed; the last action may have been applied. Refresh before retrying.");
    this.update({ connected: false });
  };
  connect = (endpoint: string) => {
    const url = new URL(endpoint);
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error(t`Enter a ws:// or wss:// broker URL without credentials or query parameters.`);
    }
    if (url.pathname === "/") url.pathname = "/ws";
    const address = url.href;
    const previousCode = this.state.endpoint === address ? this.state.view?.summary.code : undefined;
    const saved = sessionStorage.getItem(`phase-tournaments:${address}`);
    const credentials: Credentials = saved ? JSON.parse(saved) : {};
    this.disconnect();
    this.update({ endpoint: address, credentials, list: [], view: null, error: "" });
    const ws = new WebSocket(address);
    this.socket = ws;
    let hello = false;
    const timer = setTimeout(() => {
      if (this.socket === ws && !hello) { this.update({ error: "Broker handshake timed out." }); this.disconnect(); }
    }, 10000);
    ws.onmessage = event => {
      if (this.socket !== ws) return;
      try {
        const frame = JSON.parse(String(event.data));
        const data = (frame.data ?? {}) as Reply;
        if (frame.type === "ServerHello") {
          if (hello || typeof data.protocol_version !== "number" || typeof data.lobby_protocol_version !== "number" || data.lobby_protocol_version < 9) {
            throw new Error(t`Tournament management requires lobby protocol 9 or newer.`);
          }
          hello = true;
          clearTimeout(timer);
          ws.send(JSON.stringify({ type: "ClientHello", data: { client_version: "0.1.0", build_commit: "phase-mana", protocol_version: data.protocol_version, lobby_protocol_version: 9, wire_formats: [] } }));
          this.update({ connected: true });
          this.send("SubscribeLobby");
          if (previousCode) void this.open(previousCode).catch(error => this.update({ error: error.message }));
          return;
        }
        if (!hello) throw new Error(t`Broker sent data before its handshake.`);
        if (frame.type === "TournamentListUpdate" && Array.isArray(data.tournaments)) this.update({ list: data.tournaments as TournamentSummary[] });
        if (frame.type === "TournamentUpdate" && data.view && data.code === this.state.view?.summary.code) this.update({ view: data.view });
        if (frame.type === "TournamentRemoved") {
          this.update({ list: this.state.list.filter(item => item.code !== data.code), ...(this.state.view?.summary.code === data.code ? { view: null } : {}) });
        }
        const pending = this.pending;
        if (pending?.match(frame.type, data)) this.settle(undefined, data);
        else if (pending && ((frame.type === "TournamentActionRejected" && data.request_id === pending.requestId) || (frame.type === "Error" && pending.requestId === undefined))) {
          this.settle(String(data.message ?? "Broker rejected the request."));
        } else if (frame.type === "VersionMismatch") throw new Error(String(data.message ?? "Broker protocol mismatch."));
      } catch (error) {
        this.update({ error: error instanceof Error ? error.message : String(error) });
        this.disconnect();
      }
    };
    ws.onclose = () => {
      clearTimeout(timer);
      if (this.socket !== ws) return;
      this.socket = null;
      this.settle("Connection lost; the last action may have been applied. Reconnect and refresh before retrying.");
      this.update({ connected: false, error: this.state.error || "Disconnected. Reconnect to restore saved tournament credentials." });
    };
    ws.onerror = () => { if (this.socket === ws) this.update({ error: "Could not connect to the tournament broker." }); };
  };
  private send(type: string, data?: unknown) {
    if (!this.state.connected || this.socket?.readyState !== WebSocket.OPEN) throw new Error(t`Reconnect to the tournament broker first.`);
    this.socket.send(JSON.stringify(data === undefined ? { type } : { type, data }));
  }
  private request(type: string, data: Record<string, unknown>, reply: string, requestId?: number): Promise<Reply> {
    if (this.pending) return Promise.reject(new Error("Wait for the current request to finish."));
    this.update({ busy: true, error: "" });
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, requestId,
        match: (tag, value) => tag === reply && (data.code === undefined || value.code === data.code) &&
          (requestId === undefined || value.request_id === requestId) && (data.role === undefined || value.role === data.role),
        timer: setTimeout(() => this.settle("No confirmation received; the action may have been applied. Refresh before retrying."), 10000) };
      try { this.send(type, data); } catch (error) { this.settle((error as Error).message); }
    });
  }
  open = async (code: string) => {
    const reply = await this.request("GetTournament", { code: code.trim().toUpperCase() }, "TournamentUpdate");
    if (reply.view) this.update({ view: reply.view });
  };
  create = async (input: { name: string; arity: number; bracket: "Swiss" | "SingleElimination"; total_rounds: number | null; match_type: "Bo1" | "Bo3" }) => {
    const reply = await this.request("CreateTournament", { ...input, scoring: null }, "TournamentCreated");
    this.saveCredential(reply, "Organizer", "organizer_token");
  };
  join = async (code: string, displayName: string) => {
    const playerKey = crypto.randomUUID();
    const reply = await this.request("JoinTournament", { code, player_key: playerKey, display_name: displayName }, "TournamentJoined");
    this.saveCredential(reply, "Player", "player_token", playerKey);
  };
  private saveCredential(reply: Reply, role: TournamentRole, field: string, playerKey?: string) {
    if (!reply.code || typeof reply[field] !== "string" || typeof reply.expires_at_ms !== "number" || !reply.view) throw new Error(t`Broker omitted tournament credentials.`);
    this.state.credentials[reply.code] = { ...this.state.credentials[reply.code], [role]: { token: reply[field], expires: reply.expires_at_ms, playerKey } };
    this.update({ view: reply.view });
    this.persist();
  }
  renew = async (code: string, role: TournamentRole) => {
    const credential = this.state.credentials[code]?.[role];
    if (!credential) throw new Error(t`No saved credential for this role.`);
    // Persist BEFORE sending: a lost reply can be recovered with the same old secret and nonce.
    credential.nonce ??= crypto.randomUUID();
    this.persist();
    const reply = await this.request("RenewTournamentCredential", { code, role, token: credential.token, rotation_nonce: credential.nonce }, "TournamentCredentialRenewed");
    if (typeof reply.token !== "string" || typeof reply.expires_at_ms !== "number") throw new Error(t`Invalid credential renewal reply.`);
    this.state.credentials[code][role] = { token: reply.token, expires: reply.expires_at_ms, playerKey: credential.playerKey };
    this.persist();
  };
  action = async (type: "StartTournamentRound" | "ReportMatchResult" | "DropFromTournament" | "EndTournament", code: string, extra: Record<string, unknown> = {}) => {
    const role = type === "StartTournamentRound" || type === "EndTournament" ? "Organizer" : "Player";
    let credential = this.state.credentials[code]?.[role];
    if (!credential) throw new Error(t`No saved credential for this role.`);
    if (credential.nonce || credential.expires - Date.now() < 300000) await this.renew(code, role);
    credential = this.state.credentials[code][role]!;
    const requestId = this.nextId++;
    const reply = await this.request(type, { ...extra, code, [role === "Organizer" ? "organizer_token" : "player_token"]: credential.token, request_id: requestId }, "TournamentActionAck", requestId);
    if (reply.view) this.update({ view: reply.view });
  };
}
export const tournaments = new TournamentClient();
