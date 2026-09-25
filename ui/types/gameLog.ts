export type GameLogEntryType = "info" | "action" | "stack" | "priority" | "rule" | "warning";

// Keep in sync with the GameLogEvent messages emitted bymanabrew-engine
// (cast_spell.rs ForetellExile -> "Foretold: {name}").
export const FORETELL_LOG_PREFIX = "Foretold: ";

export interface GameLogEntry {
  message: string;
  entryType: GameLogEntryType;
  timestampMs: number;
  /** Phase history position and engine turn/phase, when supplied by the host. */
  seq?: number;
  turn?: number;
  phase?: string;
  playerId?: string;
  cardId?: string;
  sourceCardId?: string;
  targetCardId?: string;
}

export function normalizeGameLogPayload(payload: unknown): GameLogEntry {
  const now = Date.now();
  if (typeof payload === "string") {
    return {
      message: payload,
      entryType: "info",
      timestampMs: now,
    };
  }

  if (payload && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const message = typeof obj.message === "string" ? obj.message : "";
    const entryType = normalizeEntryType(obj.entryType);
    const timestampMs = typeof obj.timestampMs === "number" ? obj.timestampMs : now;
    return {
      message,
      entryType,
      timestampMs,
      seq: typeof obj.seq === "number" ? obj.seq : undefined,
      turn: typeof obj.turn === "number" ? obj.turn : undefined,
      phase: typeof obj.phase === "string" ? obj.phase : undefined,
      playerId: typeof obj.playerId === "string" ? obj.playerId : undefined,
      cardId: typeof obj.cardId === "string" ? obj.cardId : undefined,
      sourceCardId: typeof obj.sourceCardId === "string" ? obj.sourceCardId : undefined,
      targetCardId: typeof obj.targetCardId === "string" ? obj.targetCardId : undefined,
    };
  }

  return {
    message: String(payload ?? ""),
    entryType: "info",
    timestampMs: now,
  };
}

function normalizeEntryType(value: unknown): GameLogEntryType {
  switch (value) {
    case "action":
    case "stack":
    case "priority":
    case "rule":
    case "warning":
      return value;
    default:
      return "info";
  }
}
