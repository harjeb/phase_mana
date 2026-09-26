import { create } from "zustand";
import { t } from "@lingui/core/macro";
import { LOCAL_TOURNAMENT_KEY, parseLocalTournament, recordLocalResult, type LocalTournament } from "@/lib/localTournament";

function load(): LocalTournament | null { try { return parseLocalTournament(localStorage.getItem(LOCAL_TOURNAMENT_KEY)); } catch { return null; } }
interface State { event: LocalTournament | null; busy: boolean; error: string; save: (event: LocalTournament | null) => void; run: (action: () => Promise<void>) => Promise<void>; result: (id: string, round: number, match: number, winner: number | null, token: string) => void }
export const useLocalTournamentStore = create<State>((set, get) => ({
  event: load(), busy: false, error: "",
  save: event => {
    if (event) localStorage.setItem(LOCAL_TOURNAMENT_KEY, JSON.stringify(event));
    else localStorage.removeItem(LOCAL_TOURNAMENT_KEY);
    set({ event });
  },
  result: (id, round, match, winner, token) => {
    // Read disk as well: a replaced event or another tab's completed launch must not be overwritten.
    const event = load();
    if (event?.id === id) get().save(recordLocalResult(event, round, match, winner, token));
  },
  run: async action => {
    if (get().busy) return;
    set({ busy: true, error: "" });
    try {
      if (!navigator.locks) throw new Error(t`Local tournaments require a browser with Web Locks support.`);
      await navigator.locks.request(LOCAL_TOURNAMENT_KEY, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error(t`This tournament is busy in another tab.`);
        set({ event: load() });
        await action();
      });
    } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    finally { set({ busy: false }); }
  },
}));
if (typeof window !== "undefined") window.addEventListener("storage", event => {
  if (event.key === LOCAL_TOURNAMENT_KEY) useLocalTournamentStore.setState({ event: load() });
});
