import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { parseDeckListText } from "@/lib/deckImport";
import { decodeInvite, encodeInvite, inviteEndpoint } from "@/phase/invite";
import { hostedRoom, hostRequest, saveHostedRoom, stopHostedRoom } from "@/phase/host";
import { closeOnline, connectOnline, createPrivateRoom, joinPrivateRoom, latestOnlineEndpoint, onlineStatus, subscribeOnline } from "@/phase/online";
import OnlineDraftPanel from "@/views/OnlineDraftPanel";

/** What `/api/host/start` returns: the engine this host spawned for us. */
interface HostInfo {
  endpoint: string;
  lanEndpoints: string[];
  binary: string;
  port: number;
}

/**
 * Start (or reuse) the multiplayer engine and open a private room on it.
 *
 * The engine runs on this machine and owns the rules; this client is just the
 * host's own seat. A room is private and password-protected because a
 * six-character code is enumerable, so the lobby list is not the defence.
 */
async function startHostEngine(): Promise<HostInfo> {
  return await hostRequest("start") as HostInfo;
}

export default function OnlinePlay() {
  const state = useSyncExternalStore(subscribeOnline, onlineStatus);
  const [mode, setMode] = useState<"constructed" | "draft">("constructed");
  const [endpoint, setEndpoint] = useState(state.endpoint || latestOnlineEndpoint() || "ws://127.0.0.1:9374/ws");
  const [name, setName] = useState(() => t`Player`);
  const [code, setCode] = useState("");
  const [players, setPlayers] = useState(2);
  const [deck, setDeck] = useState("");
  const [error, setError] = useState("");
  const [errorKind, setErrorKind] = useState<"host" | "join" | null>(null);
  const [inviteText, setInviteText] = useState("");
  const [invite, setInvite] = useState(hostedRoom);
  const [busy, setBusy] = useState<"host" | "join" | null>(null);
  useEffect(() => {
    let disposed = false;
    if (hostedRoom()) void hostRequest("status").then(status => {
      if (disposed) return;
      if (status.host?.endpoint !== hostedRoom()?.endpoint) {
        saveHostedRoom(null);
        setInvite(null);
      }
    }).catch(cause => { if (!disposed) setError(String(cause)); });
    return () => { disposed = true; };
  }, []);

  /**
   * The deck every mode submits. Each player sends their own list: the host
   * validates it against the engine that owns the game, never this browser.
   */
  function deckPayload() {
    const entries = parseDeckListText(deck).filter(card => !card.maybe);
    if (!entries.length || entries.some(card => !Number.isSafeInteger(card.count) || card.count < 1 || card.count > 250)
      || entries.reduce((total, card) => total + card.count, 0) > 500) throw new Error(t`Enter a deck list with valid card quantities (up to 500 cards).`);
    const names = (section: "main" | "side" | "commander") => entries.filter(card =>
      section === "commander" ? card.commander : section === "side" ? card.side && !card.commander : !card.side && !card.commander,
    ).flatMap(card => Array<string>(card.count).fill(card.name));
    return { main_deck: names("main"), sideboard: names("side"), commander: names("commander") };
  }

  async function run(kind: "host" | "join", action: () => Promise<void>) {
    try {
      setError("");
      setErrorKind(kind);
      setBusy(kind);
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  const hostRoom = () => run("host", async () => {
    const payload = deckPayload();
    const host = await startHostEngine();
    saveHostedRoom({ endpoint: host.endpoint, code: "" });
    setEndpoint(host.endpoint);
    try {
      const room = await createPrivateRoom(host.endpoint, { deck: payload, displayName: name.trim() || t`Player`, players });
      const share = inviteEndpoint(onlineStatus().publicUrl, host.lanEndpoints[0] ?? host.endpoint);
      const saved = { endpoint: host.endpoint, code: encodeInvite({ endpoint: share.endpoint, gameCode: room.gameCode, password: room.password }), scope: share.scope };
      saveHostedRoom(saved);
      setInvite(saved);
    } catch (cause) {
      closeOnline();
      try { await stopHostedRoom(); }
      catch (cleanup) { throw new Error(`${cause}; ${cleanup}`); }
      finally { setInvite(hostedRoom()); }
      throw cause;
    }
  });

  const joinByInvite = () => run("join", async () => {
    const payload = deckPayload();
    const parsed = decodeInvite(inviteText);
    // Show where this is going before the socket opens, so a bad invite is
    // attributable to the address it carried rather than to the seat.
    setCode(parsed.gameCode);
    setEndpoint(parsed.endpoint);
    await joinPrivateRoom(parsed.endpoint, {
      deck: payload, displayName: name.trim() || t`Player`, gameCode: parsed.gameCode, password: parsed.password,
    });
  });

  async function stopHost() {
    await run("host", async () => {
      await stopHostedRoom();
      setInvite(null);
      closeOnline();
    });
  }

  function connect(kind: "create" | "join" | "reconnect") {
    try {
      setError("");
      setErrorKind(null);
      if (kind === "reconnect") return connectOnline(endpoint, "reconnect");
      const data = deckPayload();
      if (kind === "create") connectOnline(endpoint, { type: "CreateGameWithSettings", data: {
        deck: data, display_name: name.trim() || t`Player`, public: false, password: null,
        timer_seconds: null, player_count: players,
      } });
      else {
        if (!code.trim()) throw new Error(t`Enter the room code.`);
        connectOnline(endpoint, { type: "JoinGameWithPassword", data: {
          game_code: code.trim().toUpperCase(), deck: data,
          display_name: name.trim() || t`Player`, password: null,
        } });
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  const field = "w-full rounded border bg-background p-2";
  const scopeNote = invite?.scope === "advertised"
    ? t`The host advertises this public address. Internet reachability has not been verified; the tunnel or port forwarding must remain available.`
    : invite?.scope === "loopback"
      ? t`This invitation works only on this machine. Enable LAN hosting or configure a public address to invite another computer.`
      : t`LAN address: guests need a route to this network and an open host firewall. For internet play, configure a TLS tunnel or port forwarding.`;
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

    <div className="space-y-2 rounded border p-3">
      <h2 className="font-semibold"><Trans>Host a room</Trans></h2>
      <p className="text-sm text-muted-foreground"><Trans>The game engine runs on this machine. Share the invitation; nobody has to type an address.</Trans></p>
      <Button variant="primary" onClick={hostRoom} disabled={!!busy || !!invite || state.connected}>
        {busy === "host" ? <Trans>Starting the engine…</Trans> : <Trans>Host and create invitation</Trans>}
      </Button>
      {error && errorKind === "host" && <p role="alert" className="text-destructive">{error}</p>}
      {invite && <>
        <label className="block"><Trans>Room invitation</Trans>
          <input aria-label={t`Room invitation`} className={field} readOnly value={invite.code} onFocus={event => event.target.select()} />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={async () => {
            try { await navigator.clipboard.writeText(invite.code); } catch { /* The field is selectable when the clipboard is unavailable. */ }
          }}><Trans>Copy invitation</Trans></Button>
          <Button variant="outline" onClick={stopHost}><Trans>Close room and stop engine</Trans></Button>
        </div>
        <p className="text-sm" role="status">{scopeNote}</p>
      </>}
    </div>

    <div className="space-y-2 rounded border p-3">
      <h2 className="font-semibold"><Trans>Join with an invitation</Trans></h2>
      <label className="block"><Trans>Paste invitation</Trans>
        <textarea aria-label={t`Paste invitation`} className={field} rows={3} value={inviteText} onChange={event => setInviteText(event.target.value)} />
      </label>
      <Button variant="primary" onClick={joinByInvite} disabled={!!busy || !!invite}>
        {busy === "join" ? <Trans>Joining…</Trans> : <Trans>Join with invitation</Trans>}
      </Button>
      {error && errorKind === "join" && <p role="alert" className="text-destructive">{error}</p>}
    </div>

    <details className="space-y-2 rounded border p-3">
      <summary className="cursor-pointer font-semibold"><Trans>Advanced connection (room code)</Trans></summary>
      <label className="block"><Trans>Room code</Trans><input className={field} value={code} onChange={event => setCode(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => connect("create")} disabled={state.connected}><Trans>Create room</Trans></Button>
        <Button variant="outline" onClick={() => connect("join")} disabled={state.connected}><Trans>Join room</Trans></Button>
      </div>
    </details>
    </>}
    <Button variant="outline" onClick={() => connect("reconnect")} disabled={!!busy}><Trans>Reconnect saved seat</Trans></Button>
    <Button variant="outline" onClick={closeOnline}><Trans>Disconnect</Trans></Button>
    {state.code && <p><Trans>Room code: <strong>{state.code}</strong></Trans></p>}
    <p role="status">{state.message}</p>
    {error && errorKind === null && <p role="alert" className="text-destructive">{error}</p>}
  </section>;
}
