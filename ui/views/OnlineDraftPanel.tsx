import { useEffect, useState, useSyncExternalStore } from "react";
import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { Button } from "@/components/ui/button";
import { decodeInvite, encodeInvite, inviteEndpoint, randomPassword } from "@/phase/invite";
import { hostedRoom, hostRequest, saveHostedRoom, stopHostedRoom, type HostedRoom } from "@/phase/host";
import { closeOnline, normalizeServer } from "@/phase/online";
import { draftCreateRequest, draftJoinRequest, draftSocketEndpoint } from "@/phase/draftHost";
import { onlineDraftStatus, reconnectOnlineDraft, resetOnlineDraft, sendOnlineDraftAction, startOnlineDraft, subscribeOnlineDraft } from "@/phase/onlineDraft";
import { useGameStore } from "@/stores/useGameStore";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import OnlineDraftBuilder from "@/views/OnlineDraftBuilder";

/** What `/api/host/start` returns, narrowed to what a draft needs. */
interface DraftHostInfo {
  endpoint: string;
  lanEndpoints: string[];
  publicEndpoint?: string | null;
}

export default function OnlineDraftPanel({ endpoint, name, connected }: { endpoint: string; name: string; connected: boolean }) {
  const isGameActive = useGameStore(store => store.isGameActive);
  const state = useSyncExternalStore(subscribeOnlineDraft, onlineDraftStatus);
  const [server, setServer] = useState(endpoint);
  const [setCode, setSetCode] = useState("M21");
  const [kind, setKind] = useState("Premier");
  const [podSize, setPodSize] = useState(8);
  const [code, setDraftCode] = useState("");
  const [invite, setInvite] = useState<HostedRoom | null>(() => hostedRoom("draft"));
  const [inviteText, setInviteText] = useState("");
  const [pendingHost, setPendingHost] = useState<{ endpoint: string; password: string; share: { endpoint: string; scope: string } } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"host" | "join" | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const view = state.view;
  const packIdentity = view?.current_pack?.map(card => card.instance_id).join(",") ?? "";
  useEffect(() => { setSelected([]); }, [packIdentity]);
  useEffect(() => {
    const saved = hostedRoom("draft");
    if (!saved) return;
    let disposed = false;
    void hostRequest("status").then(status => {
      if (disposed) return;
      if (status.host?.endpoint !== saved.endpoint) { saveHostedRoom(null); setInvite(null); }
    }).catch(() => { /* The status probe is advisory; a running engine still fails loudly on use. */ });
    return () => { disposed = true; };
  }, []);
  /**
   * The draft code only exists once the engine answers, so the invitation is
   * finished here rather than at click time.
   */
  useEffect(() => {
    if (!pendingHost || !state.code) return;
    const saved: HostedRoom = {
      endpoint: pendingHost.endpoint,
      code: encodeInvite({ endpoint: pendingHost.share.endpoint, gameCode: state.code, password: pendingHost.password }),
      scope: pendingHost.share.scope as HostedRoom["scope"],
      kind: "draft",
    };
    saveHostedRoom(saved);
    setInvite(saved);
    setPendingHost(null);
  }, [pendingHost, state.code]);
  const field = "w-full rounded border bg-background p-2";
  const busyAny = !!busy;
  function run(action: () => void) {
    try { setError(""); action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  const scopeNote = invite?.scope === "advertised"
    ? t`The host advertises this public address. Internet reachability has not been verified; the tunnel or port forwarding must remain available.`
    : invite?.scope === "loopback"
      ? t`This invitation works only on this machine. Enable LAN hosting or configure a public address to invite another computer.`
      : t`LAN address: guests need a route to this network and an open host firewall. For internet play, configure a TLS tunnel or port forwarding.`;
  async function hostDraftRoom() {
    setError("");
    setBusy("host");
    let started = false;
    try {
      const info = await hostRequest("start") as DraftHostInfo;
      if (new URL(info.endpoint).pathname !== "/room") throw new Error(t`This host does not support waiting rooms. Update the host and try again.`);
      started = true;
      const password = randomPassword();
      // Remembered before the draft exists so closing the page can still stop the engine.
      saveHostedRoom({ endpoint: info.endpoint, code: "", kind: "draft" });
      const share = inviteEndpoint(info.publicEndpoint ?? null, info.lanEndpoints[0] ?? info.endpoint);
      setServer(draftSocketEndpoint(info.endpoint));
      setPendingHost({ endpoint: info.endpoint, password, share });
      startOnlineDraft(draftSocketEndpoint(info.endpoint), draftCreateRequest({
        displayName: name.trim() || t`Player`, setCode, kind, podSize, password,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPendingHost(null);
      if (started) { try { await stopHostedRoom(); } catch { /* reported above */ } }
      saveHostedRoom(null);
    } finally {
      setBusy(null);
    }
  }
  async function joinWithInvite() {
    setError("");
    setBusy("join");
    try {
      const parsed = decodeInvite(inviteText);
      const join = draftJoinRequest(parsed, name.trim() || t`Player`);
      setInvite(null);
      setServer(join.endpoint);
      startOnlineDraft(join.endpoint, join.request);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }
  async function stopDraftHost() {
    setError("");
    setBusy("host");
    try {
      await stopHostedRoom();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      saveHostedRoom(null);
      setInvite(null);
      setPendingHost(null);
      resetOnlineDraft();
      closeOnline();
      setBusy(null);
    }
  }
  /** Advanced: dial a server by hand. Global-format drafts predate passwords. */
  function connect(join: boolean) {
    try {
      setError("");
      const target = draftSocketEndpoint(normalizeServer(server));
      if (join && !code.trim()) throw new Error(t`Enter the draft code.`);
      if (!join && !setCode.trim()) throw new Error(t`Enter a set code.`);
      setInvite(null);
      if (join) startOnlineDraft(target, {
        type: "JoinDraftWithPassword",
        data: { draft_code: code.trim().toUpperCase(), display_name: name.trim() || t`Player`, password: null },
      });
      else startOnlineDraft(target, draftCreateRequest({
        displayName: name.trim() || t`Player`, setCode, kind, podSize, password: null,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return <section className="space-y-4" aria-label={t`Online draft`}>
    <p><Trans>Draft with human players on the server, build from your private pool, and play the pod’s matches.</Trans></p>
    {!view && !pendingHost && !invite && <div className="space-y-2 rounded border p-3">
      <h2 className="font-semibold"><Trans>Host a draft room</Trans></h2>
      <p className="text-sm text-muted-foreground"><Trans>The game engine runs on this machine. Share the invitation; nobody has to type an address.</Trans></p>
      <label className="block"><Trans>Draft format</Trans><select className={field} value={kind} onChange={event => setKind(event.target.value)}>
        <option value="Premier"><Trans>Premier (Bo1)</Trans></option><option value="Traditional"><Trans>Traditional (Bo3)</Trans></option>
      </select></label>
      <label className="block"><Trans>Set code</Trans><input className={field} value={setCode} onChange={event => setSetCode(event.target.value)} /></label>
      <label className="block"><Trans>Pod size</Trans><select aria-label={t`Pod size`} className={field} value={podSize} onChange={event => setPodSize(Number(event.target.value))}>
        {[2, 4, 6, 8].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
      <Button variant="primary" onClick={() => void hostDraftRoom()} disabled={busyAny || connected}>
        {busy === "host" ? <Trans>Starting the engine…</Trans> : <Trans>Host and create invitation</Trans>}
      </Button>
    </div>}
    {invite && <div className="space-y-2 rounded border p-3">
      <h2 className="font-semibold"><Trans>Room invitation</Trans></h2>
      <label className="block"><Trans>Room invitation</Trans>
        <input aria-label={t`Room invitation`} className={field} readOnly value={invite.code} onFocus={event => event.target.select()} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(invite.code); } catch { /* The field is selectable when the clipboard is unavailable. */ }
        }}><Trans>Copy invitation</Trans></Button>
        <Button variant="outline" onClick={() => void stopDraftHost()} disabled={busyAny}><Trans>Close room and stop engine</Trans></Button>
      </div>
      <p className="text-sm" role="status">{scopeNote}</p>
    </div>}
    {!view && <div className="space-y-2 rounded border p-3">
      <h2 className="font-semibold"><Trans>Join with an invitation</Trans></h2>
      <label className="block"><Trans>Paste invitation</Trans>
        <textarea aria-label={t`Paste invitation`} className={field} rows={3} value={inviteText} onChange={event => setInviteText(event.target.value)} />
      </label>
      <Button variant="primary" onClick={() => void joinWithInvite()} disabled={busyAny || !!invite}>
        {busy === "join" ? <Trans>Joining…</Trans> : <Trans>Join with invitation</Trans>}
      </Button>
    </div>}
    <Button variant="outline" onClick={() => { try { reconnectOnlineDraft(draftSocketEndpoint(normalizeServer(server))); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }}>
      <Trans>Reconnect draft seat</Trans>
    </Button>
    {!view && <details className="space-y-2 rounded border p-3">
      <summary className="cursor-pointer font-semibold"><Trans>Advanced connection</Trans></summary>
      <label className="block"><Trans>Server URL</Trans><input className={field} value={server} onChange={event => setServer(event.target.value)} /></label>
      <label className="block"><Trans>Draft code</Trans><input className={field} value={code} onChange={event => setDraftCode(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => connect(false)} disabled={connected}><Trans>Create draft</Trans></Button>
        <Button variant="outline" onClick={() => connect(true)} disabled={connected}><Trans>Join draft</Trans></Button>
      </div>
    </details>}
    {state.code && <p><Trans>Draft code:</Trans> <strong>{state.code}</strong></p>}
    {view && <>
      <p role="status">{view.kind} · {view.status} · <Trans>Round</Trans> {view.current_round}</p>
      <ul className="flex flex-wrap gap-3">{view.seats.map(seat => <li key={seat.seat_index}>
        {seat.display_name} {seat.seat_index === state.seat && <Trans>(you)</Trans>} · {seat.connected ? t`Connected` : t`Disconnected`} · {seat.has_submitted_deck ? t`Deck ready` : seat.pick_status}
      </li>)}</ul>
      {state.seat === 0 && view.status === "Lobby" && <Button variant="primary" disabled={busyAny || state.pending} onClick={() => run(() => sendOnlineDraftAction("StartDraft"))}><Trans>Start draft</Trans></Button>}
      {view.status === "Drafting" && <>
        <p><Trans>Pack</Trans> {view.current_pack_number + 1} · <Trans>Pick</Trans> {view.pick_number + 1}
          {state.remainingMs !== null && <> · {Math.ceil(state.remainingMs / 1000)}s</>}</p>
        {view.current_pack?.length ? <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{view.current_pack.map(card => <Button key={card.instance_id}
            className="h-auto whitespace-normal py-3" variant={selected.includes(card.instance_id) ? "primary" : "outline"}
            disabled={busyAny || state.pending} aria-pressed={selected.includes(card.instance_id)} onClick={() => setSelected(previous =>
              previous.includes(card.instance_id) ? previous.filter(id => id !== card.instance_id)
                : [...previous, card.instance_id].slice(-view.required_pick_count))}>{card.name}</Button>)}</div>
          <Button variant="primary" disabled={busyAny || state.pending || selected.length !== view.required_pick_count} onClick={() => run(() => sendOnlineDraftAction("Pick", { seat: state.seat, card_instance_ids: selected }))}><Trans>Confirm pick</Trans> ({selected.length}/{view.required_pick_count})</Button>
        </> : <p><Trans>Waiting for the next pack…</Trans></p>}
        <details><summary><Trans>Your pool</Trans> ({view.pool.length})</summary><ul>{view.pool.map(card => <li key={card.instance_id}>{card.name}</li>)}</ul></details>
      </>}
      {view.status === "Deckbuilding" && <OnlineDraftBuilder key={state.code} view={view} seat={state.seat!} disabled={busyAny || state.pending} onSubmit={main => run(() => sendOnlineDraftAction("SubmitDeck", { seat: state.seat, main_deck: main, commanders: [] }))} />}
      {view.status === "Deckbuilding" && <p><Trans>The match starts when every player has submitted a deck.</Trans></p>}
      {state.seat === 0 && view.status === "RoundComplete" && <Button variant="primary" disabled={busyAny || state.pending} onClick={() => run(() => sendOnlineDraftAction("AdvanceRound"))}><Trans>Start next round</Trans> ({view.next_pairing_round})</Button>}
      {state.matchCode && isGameActive && <Link className="inline-block rounded border px-4 py-2" to={ROUTES.GAME}><Trans>Play match</Trans></Link>}
      {view.pairings.length > 0 && <ul>{view.pairings.map(pair => <li key={pair.match_id}>{pair.name_a} — {pair.name_b}: {pair.score_a ?? 0}–{pair.score_b ?? 0} · {pair.status}</li>)}</ul>}
      {view.standings.length > 0 && <table className="w-full text-left"><thead><tr><th><Trans>Player</Trans></th><th><Trans>Matches</Trans></th><th><Trans>Games</Trans></th></tr></thead><tbody>{view.standings.map(row => <tr key={row.seat_index}><td>{row.display_name}</td><td>{row.match_wins}–{row.match_losses}</td><td>{row.game_wins}–{row.game_losses}</td></tr>)}</tbody></table>}
    </>}
    {(error || state.error) && <p role="alert" className="text-destructive">{error || state.error}</p>}
  </section>;
}
