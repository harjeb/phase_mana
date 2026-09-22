const KEY = "manabrew.pendingGauntletMatch";

export interface PendingGauntletMatch {
  gauntletId: string;
  round: number;
}

export function arm(gauntletId: string, round: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ gauntletId, round }));
  } catch {
    // ignore
  }
}

export function peek(): PendingGauntletMatch | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingGauntletMatch;
  } catch {
    return null;
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function tryConsumeGauntletMatch(): PendingGauntletMatch | null {
  const match = peek();
  if (match) clear();
  return match;
}
