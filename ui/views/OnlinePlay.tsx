import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { parseDeckListText } from "@/lib/deckImport";
import { closeOnline, connectOnline, onlineStatus, subscribeOnline } from "@/phase/online";
import OnlineDraftPanel from "@/views/OnlineDraftPanel";

export default function OnlinePlay() {
  const state = useSyncExternalStore(subscribeOnline, onlineStatus);
  const [mode, setMode] = useState<"constructed" | "draft">("constructed");
  const [endpoint, setEndpoint] = useState(state.endpoint || "ws://127.0.0.1:9374/ws");
  const [name, setName] = useState("Player");
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState(2);
  const [deck, setDeck] = useState("");
  const [error, setError] = useState("");
  function connect(kind: "create" | "join" | "reconnect") {
    try {
      setError("");
      if (kind === "reconnect") return connectOnline(endpoint, "reconnect");
      const entries = parseDeckListText(deck).filter(card => !card.maybe);
      if (!entries.length || entries.some(card => !Number.isSafeInteger(card.count) || card.count < 1 || card.count > 250)
        || entries.reduce((total, card) => total + card.count, 0) > 500) throw new Error(t`Enter a deck list with valid card quantities (up to 500 cards).`);
      const names = (section: "main" | "side" | "commander") => entries.filter(card =>
        section === "commander" ? card.commander : section === "side" ? card.side && !card.commander : !card.side && !card.commander,
      ).flatMap(card => Array<string>(card.count).fill(card.name));
      const data = { main_deck: names("main"), sideboard: names("side"), commander: names("commander") };
      if (kind === "create") connectOnline(endpoint, { type: "CreateGameWithSettings", data: {
        deck: data, display_name: name.trim() || "Player", public: false, password: null,
        timer_seconds: null, player_count: players,
      } });
      else {
        if (!code.trim()) throw new Error(t`Enter the room code.`);
        connectOnline(endpoint, { type: "JoinGameWithPassword", data: {
          game_code: code.trim().toUpperCase(), deck: data,
          display_name: name.trim() || "Player", password: null,
        } });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  const field = "w-full rounded border bg-background p-2";
  return <section className="mx-auto max-w-2xl space-y-4 p-6">
    <h1 className="text-2xl font-bold"><Trans>Online multiplayer</Trans></h1>
    <p><Trans>Connect to a Phase server. Each player submits their own deck; the server runs the game and keeps hands private.</Trans></p>
    <label className="block"><Trans>Server URL</Trans><input className={field} value={endpoint} onChange={event => setEndpoint(event.target.value)} /></label>
    <label className="block"><Trans>Your name</Trans><input className={field} value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
    <div className="flex gap-2"><Button variant={mode === "constructed" ? "primary" : "outline"} onClick={() => setMode("constructed")}><Trans>Constructed</Trans></Button><Button variant={mode === "draft" ? "primary" : "outline"} onClick={() => setMode("draft")}><Trans>Draft</Trans></Button></div>
    {mode === "draft" ? <OnlineDraftPanel endpoint={endpoint} name={name} connected={state.connected} /> : <>
    <label className="block"><Trans>Players</Trans><select aria-label={t`Players`} className={field} value={players} onChange={event => setPlayers(Number(event.target.value))}>
      {[2, 3, 4].map(count => <option key={count} value={count}>{count}</option>)}
    </select></label>
    <label className="block"><Trans>Deck list</Trans><textarea className={field} rows={10} placeholder={"4 Lightning Bolt\n24 Mountain\n…"} value={deck} onChange={event => setDeck(event.target.value)} /></label>
    <label className="block"><Trans>Room code</Trans><input className={field} value={code} onChange={event => setCode(event.target.value)} /></label>
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={() => connect("create")} disabled={state.connected}><Trans>Create room</Trans></Button>
      <Button variant="primary" onClick={() => connect("join")} disabled={state.connected}><Trans>Join room</Trans></Button>
      <Button variant="outline" onClick={() => connect("reconnect")}><Trans>Reconnect saved seat</Trans></Button>
    </div>
    </>}
    <Button variant="outline" onClick={closeOnline}><Trans>Disconnect</Trans></Button>
    {state.code && <p>Room code: <strong>{state.code}</strong></p>}
    <p role="status">{state.message}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
