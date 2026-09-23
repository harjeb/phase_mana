export interface OnlineDraftCard {
  instance_id: string; name: string; set_code: string; collector_number: string;
  type_line: string; rarity: string; cmc: number;
}
export interface OnlineDraftView {
  status: string; kind: string; current_pack_number: number; pick_number: number;
  current_pack: OnlineDraftCard[] | null; required_pick_count: number;
  pool: OnlineDraftCard[]; min_deck_size: number; addable_cards: string[];
  seats: { seat_index: number; display_name: string; connected: boolean; has_submitted_deck: boolean; pick_status: string }[];
  current_round: number; next_pairing_round: number;
  pairings: { match_id: string; name_a: string; name_b: string; status: string; score_a: number | null; score_b: number | null }[];
  standings: { seat_index: number; display_name: string; match_wins: number; match_losses: number; game_wins: number; game_losses: number }[];
}
interface DraftCredential { draft_code: string; player_token: string; seat_index: number }
interface DraftStatus {
  endpoint: string; code: string; seat: number | null; view: OnlineDraftView | null;
  pending: boolean; error: string; remainingMs: number | null; matchCode: string | null;
}
interface Request { type: string; data?: unknown }
interface DraftTransport { connect: (endpoint: string, request: Request) => void; send: (type: string, data?: unknown) => void }
let transport: DraftTransport | null = null;
let state: DraftStatus = { endpoint: "", code: "", seat: null, view: null, pending: false, error: "", remainingMs: null, matchCode: null };
const listeners = new Set<() => void>();
export const onlineDraftStatus = () => state;
export const subscribeOnlineDraft = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(patch: Partial<DraftStatus>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
const storageKey = (endpoint: string) => `phase-online-draft:${endpoint}`;
export function configureOnlineDraftTransport(value: DraftTransport) { transport = value; }
function connection() { if (!transport) throw new Error("Online draft transport is unavailable."); return transport; }
export function startOnlineDraft(endpoint: string, request: Request) {
  update({ endpoint, code: "", seat: null, view: null, pending: false, error: "", remainingMs: null, matchCode: null });
  connection().connect(endpoint, request);
}
export function reconnectOnlineDraft(endpoint: string) {
  const saved = sessionStorage.getItem(storageKey(endpoint));
  if (!saved) throw new Error("No saved draft seat for this server in this tab.");
  const credential = JSON.parse(saved) as DraftCredential;
  if (!credential.draft_code || !credential.player_token || !Number.isInteger(credential.seat_index)) throw new Error("Invalid saved draft seat.");
  update({ endpoint, code: credential.draft_code, seat: credential.seat_index, view: null, pending: false, error: "", matchCode: null });
  connection().connect(endpoint, { type: "ReconnectDraft", data: { draft_code: credential.draft_code, player_token: credential.player_token } });
}
/** Called only by the authenticated socket owner. Unknown frames remain with the game transport. */
export function handleOnlineDraftFrame(frame: { type: string; data?: unknown }, endpoint: string): boolean {
  const data = frame.data as Record<string, unknown> | undefined;
  if (frame.type === "DraftCreated" || frame.type === "DraftJoined") {
    const credential = data as unknown as DraftCredential;
    if (!credential?.draft_code || !credential.player_token || !Number.isInteger(credential.seat_index)) throw new Error("Invalid draft seat response");
    sessionStorage.setItem(storageKey(endpoint), JSON.stringify({ draft_code: credential.draft_code, player_token: credential.player_token, seat_index: credential.seat_index }));
    update({ endpoint, code: credential.draft_code, seat: credential.seat_index, pending: false, error: "", ...(data?.view ? { view: data.view as OnlineDraftView } : {}) });
    return true;
  }
  if (frame.type === "DraftStateUpdate") {
    update({ view: data?.view as OnlineDraftView, pending: false, error: "" }); return true;
  }
  if (frame.type === "DraftActionRejected") { update({ error: String(data?.reason ?? "Draft action rejected"), pending: false }); return true; }
  if (frame.type === "DraftTimerSync") { update({ remainingMs: Number(data?.remaining_ms) }); return true; }
  if (frame.type === "DraftOver") {
    update({ pending: false, view: state.view ? { ...state.view, status: "Complete", standings: data?.standings as OnlineDraftView["standings"] } : null }); return true;
  }
  if (["Error", "ActionRejected", "ActionFailed", "RequestRejected", "VersionMismatch"].includes(frame.type)) {
    update({ pending: false });
  }
  if (frame.type === "DraftMatchStart") { update({ matchCode: String(data?.game_code), pending: false }); }
  return false;
}
export function sendOnlineDraftAction(type: string, data?: unknown) {
  if (state.pending) throw new Error("Waiting for the server to confirm the previous draft action.");
  if (state.seat === null || !state.code) throw new Error("Join a draft first.");
  update({ pending: true, error: "" });
  try { connection().send("DraftAction", { draft_code: state.code, action: data === undefined ? { type } : { type, data } }); }
  catch (error) { update({ pending: false }); throw error; }
}
