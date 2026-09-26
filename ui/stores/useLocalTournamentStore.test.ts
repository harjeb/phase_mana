import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck } from "@/protocol/deck";
import { beginLocalGame, createLocalTournament, LOCAL_TOURNAMENT_KEY } from "@/lib/localTournament";
import { useLocalTournamentStore } from "@/stores/useLocalTournamentStore";
const deck = { name: "Test", format: "standard", cards: [{ identity: { name: "Plains" } }], sideboard: [] } as unknown as Deck;
const make = (id = "event") => beginLocalGame(createLocalTournament(id, deck, [deck], 4, ["Easy"], () => 0.99, "BO3"), 0, 0, "launch-a");
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  });
  useLocalTournamentStore.setState({ event: null, busy: false, error: "" });
});
describe("local tournament result persistence", () => {
  it("scores one launch once and rejects an old token after retry", () => {
    const store = useLocalTournamentStore.getState();
    store.save(make());
    store.result("event", 0, 0, 0, "launch-a");
    store.result("event", 0, 0, 0, "launch-a");
    expect(useLocalTournamentStore.getState().event!.rounds[0][0].gameWins).toEqual([1, 0]);
    store.save(beginLocalGame(useLocalTournamentStore.getState().event!, 0, 0, "launch-b"));
    store.result("event", 0, 0, 0, "launch-a");
    expect(useLocalTournamentStore.getState().event!.rounds[0][0].gameWins).toEqual([1, 0]);
    store.result("event", 0, 0, 0, "launch-b");
    expect(useLocalTournamentStore.getState().event!.rounds[0][0].gameWins).toEqual([2, 0]);
    expect(JSON.parse(localStorage.getItem(LOCAL_TOURNAMENT_KEY)!).rounds[0][0].winner).toBe(0);
  });
  it("uses saved state rather than stale memory and never revives a deleted/replaced event", () => {
    const store = useLocalTournamentStore.getState();
    store.save(make());
    const latest = beginLocalGame(make(), 0, 0, "new-launch");
    localStorage.setItem(LOCAL_TOURNAMENT_KEY, JSON.stringify(latest));
    store.result("event", 0, 0, 0, "launch-a");
    expect(JSON.parse(localStorage.getItem(LOCAL_TOURNAMENT_KEY)!)).toEqual(latest);
    localStorage.setItem(LOCAL_TOURNAMENT_KEY, JSON.stringify(make("replacement")));
    store.result("event", 0, 0, 0, "launch-a");
    expect(JSON.parse(localStorage.getItem(LOCAL_TOURNAMENT_KEY)!).id).toBe("replacement");
    localStorage.removeItem(LOCAL_TOURNAMENT_KEY);
    store.result("event", 0, 0, 0, "launch-a");
    expect(localStorage.getItem(LOCAL_TOURNAMENT_KEY)).toBeNull();
  });
  it("does not update in-memory scores when storage fails", () => {
    const store = useLocalTournamentStore.getState();
    store.save(make());
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => store.result("event", 0, 0, 0, "launch-a")).toThrow("quota");
    expect(useLocalTournamentStore.getState().event!.rounds[0][0].gameWins).toEqual([0, 0]);
  });
});
