import { useEffect, useState, useSyncExternalStore } from "react";
import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { Button } from "@/components/ui/button";
import { normalizeServer } from "@/phase/online";
import { onlineDraftStatus, reconnectOnlineDraft, sendOnlineDraftAction, startOnlineDraft, subscribeOnlineDraft } from "@/phase/onlineDraft";
import { useGameStore } from "@/stores/useGameStore";
import { Link } from "react-router-dom";
import { ROUTES } from "@/lib/constants";
import OnlineDraftBuilder from "@/views/OnlineDraftBuilder";

export default function OnlineDraftPanel({ endpoint, name, connected }: { endpoint: string; name: string; connected: boolean }) {
  const isGameActive = useGameStore(store => store.isGameActive);
  const state = useSyncExternalStore(subscribeOnlineDraft, onlineDraftStatus);
  const [setCode, setSetCode] = useState("M21");
  const [kind, setKind] = useState("Premier");
  const [podSize, setPodSize] = useState(8);
  const [code, setDraftCode] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const view = state.view;
  const packIdentity = view?.current_pack?.map(card => card.instance_id).join(",") ?? "";
  useEffect(() => { setSelected([]); }, [packIdentity]);
  function run(action: () => void) { try { setError(""); action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }
  function connect(join: boolean) {
    const server = normalizeServer(endpoint);
    if (join && !code.trim()) throw new Error(t`Enter the draft code.`);
    if (!join && !setCode.trim()) throw new Error(t`Enter a set code.`);
    startOnlineDraft(server, join ? { type: "JoinDraftWithPassword", data: {
      draft_code: code.trim().toUpperCase(), display_name: name.trim() || "Player", password: null,
    } } : { type: "CreateDraftWithSettings", data: {
      display_name: name.trim() || "Player", set_codes: [setCode.trim().toUpperCase()], kind,
      public: false, password: null, timer_seconds: null, tournament_format: "Swiss", pod_policy: "Casual", pod_size: podSize,
    } });
  }
  const field = "w-full rounded border bg-background p-2";
  const busy = !connected || state.pending;
  const host = state.seat === 0;
  return <section className="space-y-4" aria-label={t`Online draft`}>
    <p><Trans>Draft with human players on the server, build from your private pool, and play the pod’s matches.</Trans></p>
    {!view && <>
      <label className="block"><Trans>Draft format</Trans><select className={field} value={kind} onChange={event => setKind(event.target.value)}>
        <option value="Premier">Premier (Bo1)</option><option value="Traditional">Traditional (Bo3)</option>
      </select></label>
      <label className="block"><Trans>Set code</Trans><input className={field} value={setCode} onChange={event => setSetCode(event.target.value)} /></label>
      <label className="block"><Trans>Pod size</Trans><select className={field} value={podSize} onChange={event => setPodSize(Number(event.target.value))}>
        {[2, 4, 6, 8].map(count => <option key={count} value={count}>{count}</option>)}</select></label>
      <label className="block"><Trans>Draft code</Trans><input className={field} value={code} onChange={event => setDraftCode(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => run(() => connect(false))} disabled={connected}><Trans>Create draft</Trans></Button>
        <Button variant="primary" onClick={() => run(() => connect(true))} disabled={connected}><Trans>Join draft</Trans></Button>
      </div>
    </>}
    <Button variant="outline" onClick={() => run(() => reconnectOnlineDraft(normalizeServer(endpoint)))}><Trans>Reconnect draft seat</Trans></Button>
    {state.code && <p><Trans>Draft code:</Trans> <strong>{state.code}</strong></p>}
    {view && <>
      <p role="status">{view.kind} · {view.status} · <Trans>Round</Trans> {view.current_round}</p>
      <ul className="flex flex-wrap gap-3">{view.seats.map(seat => <li key={seat.seat_index}>
        {seat.display_name} {seat.seat_index === state.seat && <Trans>(you)</Trans>} · {seat.connected ? t`Connected` : t`Disconnected`} · {seat.has_submitted_deck ? t`Deck ready` : seat.pick_status}
      </li>)}</ul>
      {host && view.status === "Lobby" && <Button variant="primary" disabled={busy} onClick={() => run(() => sendOnlineDraftAction("StartDraft"))}><Trans>Start draft</Trans></Button>}
      {view.status === "Drafting" && <>
        <p><Trans>Pack</Trans> {view.current_pack_number + 1} · <Trans>Pick</Trans> {view.pick_number + 1}
          {state.remainingMs !== null && <> · {Math.ceil(state.remainingMs / 1000)}s</>}</p>
        {view.current_pack?.length ? <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{view.current_pack.map(card => <Button key={card.instance_id}
            className="h-auto whitespace-normal py-3" variant={selected.includes(card.instance_id) ? "primary" : "outline"}
            disabled={busy} aria-pressed={selected.includes(card.instance_id)} onClick={() => setSelected(previous =>
              previous.includes(card.instance_id) ? previous.filter(id => id !== card.instance_id)
                : [...previous, card.instance_id].slice(-view.required_pick_count))}>{card.name}</Button>)}</div>
          <Button variant="primary" disabled={busy || selected.length !== view.required_pick_count} onClick={() => run(() => sendOnlineDraftAction("Pick", { seat: state.seat, card_instance_ids: selected }))}><Trans>Confirm pick</Trans> ({selected.length}/{view.required_pick_count})</Button>
        </> : <p><Trans>Waiting for the next pack…</Trans></p>}
        <details><summary><Trans>Your pool</Trans> ({view.pool.length})</summary><ul>{view.pool.map(card => <li key={card.instance_id}>{card.name}</li>)}</ul></details>
      </>}
      {view.status === "Deckbuilding" && <OnlineDraftBuilder key={state.code} view={view} seat={state.seat!} disabled={busy} onSubmit={main => run(() => sendOnlineDraftAction("SubmitDeck", { seat: state.seat, main_deck: main, commanders: [] }))} />}
      {view.status === "Deckbuilding" && <p><Trans>The match starts when every player has submitted a deck.</Trans></p>}
      {host && view.status === "RoundComplete" && <Button variant="primary" disabled={busy} onClick={() => run(() => sendOnlineDraftAction("AdvanceRound"))}><Trans>Start next round</Trans> ({view.next_pairing_round})</Button>}
      {state.matchCode && isGameActive && <Link className="inline-block rounded border px-4 py-2" to={ROUTES.GAME}><Trans>Play match</Trans></Link>}
      {view.pairings.length > 0 && <ul>{view.pairings.map(pair => <li key={pair.match_id}>{pair.name_a} — {pair.name_b}: {pair.score_a ?? 0}–{pair.score_b ?? 0} · {pair.status}</li>)}</ul>}
      {view.standings.length > 0 && <table className="w-full text-left"><thead><tr><th><Trans>Player</Trans></th><th><Trans>Matches</Trans></th><th><Trans>Games</Trans></th></tr></thead><tbody>{view.standings.map(row => <tr key={row.seat_index}><td>{row.display_name}</td><td>{row.match_wins}–{row.match_losses}</td><td>{row.game_wins}–{row.game_losses}</td></tr>)}</tbody></table>}
    </>}
    {(error || state.error) && <p role="alert" className="text-destructive">{error || state.error}</p>}
  </section>;
}
