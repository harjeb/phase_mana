/** Deliberately memory-only: a reloaded or abandoned engine game can never report a result. */
interface PendingTournamentReturn { eventId: string; round: number; match: number; token: string; humanSlot: string; opponentSlot: string; release: () => void }
let pending: PendingTournamentReturn | null = null;
let engineSessionId: string | null = null;
let armedEngineSessionId: string | null = null;
export function noteTournamentEngineSession(id: string | undefined): void {
  engineSessionId = id || null;
  if (pending && engineSessionId !== armedEngineSessionId) clearTournamentReturn();
}
export function hasTournamentEngineSession(): boolean { return engineSessionId !== null; }
export function armTournamentReturn(value: Omit<PendingTournamentReturn, "release">): Promise<void> {
  clearTournamentReturn();
  armedEngineSessionId = engineSessionId;
  return new Promise(resolve => { pending = { ...value, release: resolve }; });
}
export function peekTournamentReturn(): PendingTournamentReturn | null { return pending; }
export function clearTournamentReturn(): void { const previous = pending; pending = null; previous?.release(); }
export function consumeTournamentResult(winnerId: string | null | undefined): { eventId: string; round: number; match: number; token: string; humanWon: boolean | null } | null {
  const value = pending;
  if (!value || (winnerId != null && winnerId !== value.humanSlot && winnerId !== value.opponentSlot)) return null;
  clearTournamentReturn();
  return { eventId: value.eventId, round: value.round, match: value.match, token: value.token, humanWon: winnerId == null ? null : winnerId === value.humanSlot };
}
