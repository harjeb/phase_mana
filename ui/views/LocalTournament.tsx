import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { msg, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { Button } from "@/components/ui/button";
import { usePresetDecks, usePresetDecksResolved } from "@/stores/usePresetDecksStore";
import { useLocalTournamentStore } from "@/stores/useLocalTournamentStore";
import { useGameStore } from "@/stores/useGameStore";
import { AI_DIFFICULTIES } from "@/lib/aiDifficulty";
import { LocalTournamentSideboard } from "@/views/LocalTournamentSideboard";
import { beginLocalGame, cancelLocalGame, gamesPlayed, localMatchDecks, createLocalTournament, supportsLocalTournamentFormat } from "@/lib/localTournament";
import { armTournamentReturn, hasTournamentEngineSession } from "@/lib/localTournamentReturn";
import { clear as clearGauntletReturn } from "@/lib/gauntletReturn";
import { simulateLocalTournamentGame } from "@/lib/localTournamentSimulation";

const formatLabels = {
  standard: msg`Standard`, pioneer: msg`Pioneer`, modern: msg`Modern`,
  legacy: msg`Legacy`, vintage: msg`Vintage`, pauper: msg`Pauper`,
  premodern: msg`Premodern`, commander: msg`Commander`, oathbreaker: msg`Oathbreaker`,
  tiny_leaders: msg`Tiny Leaders`, duel_commander: msg`Duel Commander`,
  pauper_commander: msg`Pauper Commander`,
};

export function LocalTournament() {
  const { i18n } = useLingui();
  const decks = usePresetDecks("Manabrew").filter(deck => supportsLocalTournamentFormat(deck.format ?? ""));
  const formatLabel = (id: string) => id in formatLabels ? i18n._(formatLabels[id as keyof typeof formatLabels]) : id;
  const resolved = usePresetDecksResolved();
  const state = useLocalTournamentStore();
  const navigate = useNavigate();
  const [format, setFormat] = useState("standard");
  const [deckId, setDeckId] = useState("");
  const [size, setSize] = useState(4);
  const [matchType, setMatchType] = useState<"BO1" | "BO3">("BO3");
  const [confirmReset, setConfirmReset] = useState(false);
  const pool = decks.filter(deck => deck.format === format && deck.cards.length);
  const selected = pool.find(deck => deck.id === deckId) ?? pool[0];
  const event = state.event;
  const play = (round: number, match: number) => state.run(async () => {
    const current = useLocalTournamentStore.getState().event;
    if (!current || current.id !== event?.id) return;
    const pairing = current.rounds[round]?.[match];
    if (!pairing || pairing.winner !== null || round !== current.rounds.length - 1) return;
    if (JSON.stringify(pairing) !== JSON.stringify(event.rounds[round]?.[match])) throw new Error(t`The match changed in another tab. Review the current lists and try again.`);
    if (useGameStore.getState().isGameActive) throw new Error(t`Finish or leave your current game first.`);
    const token = crypto.randomUUID();
    const lists = localMatchDecks(current, pairing);
    const players = pairing.players.map((id, slot) => ({ ...current.entrants[id], deck: lists[slot] }));
    state.save(beginLocalGame(current, round, match, token));
    try {
    if (pairing.players.includes(0)) {
      const opponent = players.find(player => player.id !== 0)!;
      clearGauntletReturn();
      const started = await useGameStore.getState().startGame(players.find(player => player.id === 0)!.deck, current.format, undefined, [opponent.deck], undefined, undefined, undefined, undefined, opponent.difficulty!);
      if (!started) throw new Error(t`The tournament game could not start. Retry this match.`);
      const game = useGameStore.getState();
      const humanSlot = game.myPlayerSlot;
      const opponentSlot = game.gameView?.players.find(player => player.id !== humanSlot)?.id;
      if (!humanSlot || !opponentSlot || !hasTournamentEngineSession()) { await game.endGame(); throw new Error(t`The engine did not identify both players. Retry this match.`); }
      const finished = armTournamentReturn({ eventId: current.id, round, match, token, humanSlot, opponentSlot });
      navigate("/game/local-tournament");
      await finished;
    } else {
      const winner = simulateLocalTournamentGame(players[0], players[1], Math.random);
      state.result(current.id, round, match, pairing.players[winner], token);
    }
    } finally {
      const latest = useLocalTournamentStore.getState().event;
      if (latest?.id === current.id && latest.rounds[round]?.[match]?.activeGame === token) state.save(cancelLocalGame(latest, round, match, token));
    }
  });
  const label = (id: number) => id === 0 ? t`You` : t`AI ${id}`;
  return <section className="space-y-4 px-4 py-4 sm:px-6 lg:px-8">
    <p className="rounded border border-border bg-muted p-3 text-sm"><Trans>Local AI tournament · Single elimination. One human and 3, 7, or 15 AI entrants. Decks and built-in AI difficulties are randomly assigned once and saved in this browser. Duplicate decks are allowed.</Trans></p>
    <p className="text-sm text-muted-foreground"><Trans>Play starts one real human game. Simulate AI game draws one AI-only winner locally at random, with modest weights for land balance, mana curve, and built-in AI difficulty. Missing card metadata reduces the deck weights. Each seat has a 25%–75% win chance; no game engine is used for these draws.</Trans></p>
    <p className="text-sm text-muted-foreground"><Trans>Each action records one game. BO1 requires one game win; BO3 requires two. Draws do not count as wins. BO3 allows sideboarding between games, never before game one. No prizes.</Trans></p>
    <p className="text-sm text-muted-foreground"><Trans>AI sideboarding uses a modest deterministic heuristic: swap at most one nonland copy to favor removal relevant to the opponent’s original deck types. It never reads live hands and is not an optimal strategy. Main and sideboard counts stay fixed.</Trans></p>
    <p className="text-sm text-muted-foreground"><Trans>Leaving or reloading a human game without an engine result leaves that game unscored. A confirmed concession counts as one game loss.</Trans></p>
    {state.error && <p role="alert" className="rounded border border-destructive p-3">{state.error}</p>}
    {!event ? <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void state.run(async () => {
      if (useLocalTournamentStore.getState().event) return;
      if (!selected || !pool.length) throw new Error(t`No compatible preset decks are available for this format.`);
      state.save(createLocalTournament(crypto.randomUUID(), selected, pool, size, AI_DIFFICULTIES.map(level => level.value), Math.random, matchType));
    }); }}>
      <label className="text-sm"><Trans>Format</Trans><select className="block rounded border border-border bg-background p-2" value={format} onChange={e => { setFormat(e.target.value); setDeckId(""); }}>{Array.from(new Set(["standard", ...decks.map(deck => deck.format ?? "standard")])).sort().map(value => <option key={value} value={value}>{formatLabel(value)}</option>)}</select></label>
      <label className="min-w-0 text-sm"><Trans>Your preset deck</Trans><select className="block max-w-full rounded border border-border bg-background p-2" value={selected?.id ?? ""} onChange={e => setDeckId(e.target.value)}>{pool.map(deck => <option key={deck.id} value={deck.id}>{deck.name}</option>)}</select></label>
      <label className="text-sm"><Trans>Total entrants</Trans><select className="block rounded border border-border bg-background p-2" value={size} onChange={e => setSize(Number(e.target.value))}>{[4, 8, 16].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm"><Trans>Match type</Trans><select className="block rounded border border-border bg-background p-2" value={matchType} onChange={e => setMatchType(e.target.value as "BO1" | "BO3")}><option value="BO1">{t`BO1 · First to 1 win`}</option><option value="BO3">{t`BO3 · First to 2 wins · Sideboarding`}</option></select></label>
      <Button type="submit" variant="primary" disabled={state.busy || !resolved || !selected}><Trans>Create local tournament</Trans></Button>
      {resolved && !pool.length && <p role="status"><Trans>No compatible preset decks are available for this format.</Trans></p>}
      {!resolved && <p role="status"><Trans>Loading preset decks…</Trans></p>}
    </form> : <>
      <p>{formatLabel(event.format)} · {event.matchType === "BO3" ? t`BO3 · First to 2 wins · Sideboarding` : t`BO1 · First to 1 win`} · <Trans>Total entrants</Trans>: {event.entrants.length}</p>
      <h2 className="font-semibold"><Trans>Entrants</Trans></h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{event.entrants.map(player => <li className="rounded border border-border p-3 text-sm" key={player.id}>{label(player.id)} · {player.deck.name}{player.difficulty && <> · {i18n._(AI_DIFFICULTIES.find(level => level.value === player.difficulty)!.label)}</>}</li>)}</ul>
      <div className="grid gap-4 lg:grid-cols-2">{event.rounds.map((round, r) => <section className="space-y-2" key={r}><h2 className="font-semibold"><Trans>Round</Trans> {r + 1}</h2>{round.map((match, m) => <div className="space-y-2 rounded border border-border p-3" key={m}>
        <p>{label(match.players[0])} {match.gameWins[0]} – {match.gameWins[1]} {label(match.players[1])}</p>
        <p className="text-sm">{match.winner === null ? t`Pending` : t`Winner: ${label(match.winner)}`}{match.draws > 0 && <> · <Trans>Draws requiring replay</Trans>: {match.draws}</>}</p>
        {event.matchType === "BO3" && r === event.rounds.length - 1 && match.winner === null && gamesPlayed(match) > 0 && match.players.includes(0) && <LocalTournamentSideboard event={event} round={r} match={m} />}
        {match.winner === null && <Button variant="primary" disabled={state.busy} onClick={() => void play(r, m)}>{match.players.includes(0) ? (match.draws > 0 ? t`Play next game / replay` : match.gameWins.some(Boolean) ? t`Play next game` : t`Play tournament game`) : (match.draws > 0 ? t`Simulate next AI game / replay` : match.gameWins.some(Boolean) ? t`Simulate next AI game` : t`Simulate AI game`)}</Button>}
      </div>)}</section>)}</div>
      {event.rounds.at(-1)?.length === 1 && event.rounds.at(-1)![0].winner !== null && <p role="status" className="font-semibold"><Trans>Champion</Trans>: {label(event.rounds.at(-1)![0].winner!)}</p>}
      <Button variant="outline" disabled={state.busy} onClick={() => setConfirmReset(true)}><Trans>Delete local tournament</Trans></Button>
      {confirmReset && <div className="flex flex-wrap items-center gap-2"><p><Trans>Delete this saved event and all its results?</Trans></p><Button variant="destructive" disabled={state.busy} onClick={() => void state.run(async () => { state.save(null); setConfirmReset(false); })}><Trans>Confirm deletion</Trans></Button><Button variant="ghost" onClick={() => setConfirmReset(false)}><Trans>Cancel</Trans></Button></div>}
    </>}
    {state.busy && <p role="status"><Trans>Tournament match in progress. Please wait; do not start another game.</Trans></p>}
  </section>;
}
