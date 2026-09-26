/**
 * Marks that this tab has a live game on the local Phase host.
 *
 * The host keeps the session in memory across a page refresh, so the game is
 * not really gone — the UI just forgets it. This marker is what tells the boot
 * hook to pull the session back with `GET /api/state`.
 *
 * `sessionStorage` is deliberate: it survives a refresh (what we want) but not
 * a new tab, because the host owns a single process-wide session — a second
 * tab starting a game replaces it, and restoring that into the first tab would
 * be wrong.
 */
const KEY = "manabrew.activeLocalGame";

export function armActiveLocalGame(): void {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // ignore
  }
}

export function isActiveLocalGame(): boolean {
  try {
    return window.sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearActiveLocalGame(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
