import { useState, useSyncExternalStore } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { tournaments } from "@/phase/tournaments";
import type { TournamentOutcome, TournamentRole } from "@/phase/tournaments";

import { LocalTournament } from "@/views/LocalTournament";

export function Tournaments() {
  const [mode, setMode] = useState<"local" | "remote">("local");
  return <>
    <div className="flex flex-wrap gap-2 px-4 pt-4 sm:px-6 lg:px-8" role="group" aria-label={t`Tournament mode`}>
      <Button variant={mode === "local" ? "primary" : "outline"} aria-pressed={mode === "local"} onClick={() => setMode("local")}><Trans>Local AI tournament</Trans></Button>
      <Button variant={mode === "remote" ? "primary" : "outline"} aria-pressed={mode === "remote"} onClick={() => setMode("remote")}><Trans>Remote / manual tournament</Trans></Button>
    </div>
    {mode === "local" ? <LocalTournament /> : <RemoteTournaments />}
  </>;
}

function RemoteTournaments() {
  const state = useSyncExternalStore(tournaments.subscribe, tournaments.getSnapshot);
  const [endpoint, setEndpoint] = useState(state.endpoint || "ws://127.0.0.1:9374/ws");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [code, setCode] = useState("");
  const [arity, setArity] = useState(2);
  const [bracket, setBracket] = useState<"Swiss" | "SingleElimination">("Swiss");
  const [matchType, setMatchType] = useState<"Bo1" | "Bo3">("Bo3");
  const [rounds, setRounds] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);
  const view = state.view;
  const eventCode = view?.summary.code ?? "";
  const credentials = state.credentials[eventCode] ?? {};
  const disabled = !state.connected || state.busy;
  const run = async (action: () => void | Promise<void>) => {
    setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const report = (pairingId: number, outcome: TournamentOutcome) => run(() => tournaments.action("ReportMatchResult", eventCode, { pairing_id: pairingId, outcome }));
  const roleLabel = (role: TournamentRole) => role === "Organizer" ? t`Organizer` : t`Player`;
  return <div className="space-y-6 px-4 py-4 sm:px-6 lg:px-8">
    <p className="rounded-md border border-border bg-muted p-3 text-sm">
      <Trans>Tournament organizer: manual results are unverified. Pairings do not create hosted games, verify decks, or automatically report results. Standings reflect player reports.</Trans>
    </p>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void run(() => tournaments.connect(endpoint)); }}>
      <label className="min-w-64 flex-1 text-sm"><Trans>Phase broker URL</Trans><Input value={endpoint} onChange={event => setEndpoint(event.target.value)} required /></label>
      <Button variant="primary" type="submit" disabled={state.busy}>{state.connected ? t`Reconnect` : t`Connect`}</Button>
      {state.connected && <Button type="button" variant="outline" onClick={tournaments.disconnect}><Trans>Disconnect</Trans></Button>}
      <span role="status" className="text-sm text-muted-foreground">{state.connected ? t`Connected` : t`Disconnected`}</span>
    </form>
    {(error || state.error) && <p role="alert" className="rounded-md border border-destructive p-3 text-sm">{error || state.error}</p>}
    <p className="text-sm text-muted-foreground"><Trans>Organizer and player credentials are saved separately for this server in this browser tab. Reconnect restores them. Renew before expiry; closing the tab loses access.</Trans></p>
    <div className="grid gap-6 lg:grid-cols-2">
      <form className="space-y-3 rounded-md border border-border p-4" onSubmit={event => { event.preventDefault(); void run(() => tournaments.create({ name: name.trim(), arity, bracket, total_rounds: rounds ? Number(rounds) : null, match_type: arity === 2 ? matchType : "Bo1" })); }}>
        <h2 className="font-semibold"><Trans>Create tournament</Trans></h2>
        <label className="block text-sm"><Trans>Event name</Trans><Input required maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm"><Trans>Players per table</Trans><select className="block rounded border border-border bg-background p-2" value={arity} onChange={event => { setArity(Number(event.target.value)); setBracket("Swiss"); }}>
            {[2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label className="text-sm"><Trans>Pairing system</Trans><select className="block rounded border border-border bg-background p-2" value={bracket} onChange={event => setBracket(event.target.value as typeof bracket)}>
            <option value="Swiss">{t`Swiss`}</option><option value="SingleElimination" disabled={arity !== 2}>{t`Single elimination`}</option>
          </select></label>
          {arity === 2 && <label className="text-sm"><Trans>Match structure</Trans><select className="block rounded border border-border bg-background p-2" value={matchType} onChange={event => setMatchType(event.target.value as typeof matchType)}>
            <option value="Bo1">{t`Best of one`}</option><option value="Bo3">{t`Best of three`}</option>
          </select></label>}
        </div>
        <label className="block text-sm"><Trans>Rounds (blank for automatic)</Trans><Input type="number" min={1} max={100} value={rounds} onChange={event => setRounds(event.target.value)} /></label>
        <Button variant="primary" type="submit" disabled={disabled || !name.trim()}><Trans>Create</Trans></Button>
      </form>
      <section className="space-y-3 rounded-md border border-border p-4">
        <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); setConfirmEnd(false); void run(() => tournaments.open(code)); }}>
          <label className="flex-1 text-sm"><Trans>Tournament code</Trans><Input required value={code} onChange={event => setCode(event.target.value)} /></label><Button variant="primary" type="submit" disabled={disabled}><Trans>Open</Trans></Button>
        </form>
        <h2 className="font-semibold"><Trans>Available tournaments</Trans></h2>
        {!state.list.length && <p className="text-sm text-muted-foreground"><Trans>No tournaments listed.</Trans></p>}
        {state.list.map(item => <Button className="h-auto w-full justify-start whitespace-normal text-left" variant="outline" key={item.code} disabled={disabled} onClick={() => { setConfirmEnd(false); void run(() => tournaments.open(item.code)); }}>
          {item.name} · {item.code} · {item.player_count} · {item.status}
        </Button>)}
      </section>
    </div>
    {view && <section className="space-y-4 rounded-md border border-border p-4">
      <h2 className="text-lg font-semibold">{view.summary.name} · {eventCode}</h2>
      <p className="text-sm">{view.summary.status} · {view.summary.bracket} · {view.summary.match_type} · <Trans>Round</Trans> {view.summary.current_round}/{view.summary.total_rounds} · <Trans>Points: win / draw / loss</Trans> {view.summary.scoring.win_points}/{view.summary.scoring.draw_points}/{view.summary.scoring.loss_points}</p>
      <div className="flex flex-wrap gap-3">
        {(["Organizer", "Player"] as const).map(role => credentials[role] && <div key={role} className="rounded border border-border p-2 text-sm">
          {roleLabel(role)} · <Trans>Expires</Trans> {new Date(credentials[role]!.expires).toLocaleString()} <Button size="sm" variant="outline" disabled={disabled} onClick={() => void run(() => tournaments.renew(eventCode, role))}><Trans>Renew credential</Trans></Button>
        </div>)}
      </div>
      {!credentials.Player && view.summary.status === "Registration" && <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); void run(() => tournaments.join(eventCode, displayName.trim())); }}>
        <label className="text-sm"><Trans>Player name</Trans><Input required maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} /></label><Button variant="primary" type="submit" disabled={disabled || !displayName.trim()}><Trans>Join as player</Trans></Button>
      </form>}
      <div className="flex flex-wrap gap-2">
        {credentials.Organizer && <>
          <Button variant="primary" disabled={disabled || !view.summary.open_actions.includes("StartRound")} onClick={() => void run(() => tournaments.action("StartTournamentRound", eventCode))}><Trans>Pair next round</Trans></Button>
          <Button variant="outline" disabled={disabled || !view.summary.open_actions.includes("EndTournament")} onClick={() => setConfirmEnd(true)}><Trans>End tournament</Trans></Button>
          {confirmEnd && <><Button variant="destructive" disabled={disabled} onClick={() => { setConfirmEnd(false); void run(() => tournaments.action("EndTournament", eventCode)); }}><Trans>Confirm end tournament</Trans></Button><Button variant="ghost" onClick={() => setConfirmEnd(false)}><Trans>Cancel</Trans></Button></>}
        </>}
        {credentials.Player && <Button variant="outline" disabled={disabled || !view.summary.open_actions.includes("Drop") || view.players.find(player => player.player_key === credentials.Player?.playerKey)?.dropped} onClick={() => void run(() => tournaments.action("DropFromTournament", eventCode))}><Trans>Drop from tournament</Trans></Button>}
        <Button variant="outline" disabled={disabled} onClick={() => void run(() => tournaments.open(eventCode))}><Trans>Refresh</Trans></Button>
      </div>
      <h3 className="font-semibold"><Trans>Entrants</Trans></h3>
      <p className="text-sm">{view.players.map(player => `${player.display_name}${player.dropped ? ` (${t`dropped`})` : ""}`).join(", ") || t`No entrants yet.`}</p>
      <h3 className="font-semibold"><Trans>Pairings and manual results (unverified)</Trans></h3>
      {view.pairings.map(pairing => <div className="space-y-2 rounded border border-border p-3" key={pairing.id}>
        <p><Trans>Round</Trans> {pairing.round} · {pairing.players.map(player => player.display_name).join(" / ")}</p>
        <p className="text-sm text-muted-foreground">{pairing.outcome === null ? t`Pending` : pairing.outcome === "Bye" ? t`Bye` : "Forfeit" in pairing.outcome ? t`Forfeit` : t`Manual result — unverified`}</p>
        {pairing.outcome && pairing.outcome !== "Bye" && <p className="text-sm">{(() => {
          const result = "Reported" in pairing.outcome ? pairing.outcome.Reported : { Decisive: { winner: pairing.outcome.Forfeit.winner, game_wins: {} } };
          if (result === "Draw") return t`Draw`;
          const winner = pairing.players.find(player => player.player_key === result.Decisive.winner)?.display_name ?? result.Decisive.winner;
          return `${winner} · ${Object.values(result.Decisive.game_wins).join("–")}`;
        })()}</p>}
        {credentials.Player && pairing.report_gate === "Open" && pairing.players.some(player => player.player_key === credentials.Player?.playerKey && !player.dropped) && <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const winner = String(form.get("winner"));
          const tally: Record<string, number> = {};
          if (winner !== "draw" && view.summary.match_type === "Bo3") pairing.players.forEach(player => { tally[player.player_key] = player.player_key === winner ? 2 : Number(form.get("losses") ?? 0); });
          void report(pairing.id, winner === "draw" ? "Draw" : { Decisive: { winner, game_wins: tally } });
        }}>
          <label className="text-sm"><Trans>Manual match outcome</Trans><select name="winner" className="block rounded border border-border bg-background p-2">{pairing.players.map(player => <option key={player.player_key} value={player.player_key}>{player.display_name}</option>)}<option value="draw">{t`Draw`}</option></select></label>
          {view.summary.match_type === "Bo3" && <label className="text-sm"><Trans>Loser's game wins</Trans><select name="losses" className="block rounded border border-border bg-background p-2"><option value="0">0</option><option value="1">1</option></select></label>}
          <Button variant="primary" type="submit" disabled={disabled}><Trans>Submit unverified result</Trans></Button>
        </form>}
      </div>)}
      <h3 className="font-semibold"><Trans>Standings from manual reports (unverified)</Trans></h3>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th><Trans>Rank</Trans></th><th><Trans>Player</Trans></th><th><Trans>Points</Trans></th><th><Trans>Matches</Trans></th><th><Trans>Byes</Trans></th></tr></thead><tbody>
        {view.standings.map((standing, index) => <tr className="border-t border-border" key={standing.player_key}><td>{index + 1}</td><td>{standing.display_name} {standing.dropped && t`(dropped)`}</td><td>{standing.match_points}</td><td>{standing.matches_played}</td><td>{standing.byes}</td></tr>)}
      </tbody></table></div>
    </section>}
  </div>;
}
export default Tournaments;
