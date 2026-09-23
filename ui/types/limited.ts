import type { CardIdentity } from "@/types/manabrew";

export type LimitedPoolType =
  | "Full"
  | "Block"
  | "Prerelease"
  | "FantasyBlock"
  | "Custom"
  | "Chaos"
  | "Import";

export interface GauntletMatchDecks {
  humanDeckName: string;
  humanMain: DraftCard[];
  humanSideboard: DraftCard[];
  /** CR 905.4: submitted conspiracy cards, played from the command zone. */
  humanConspiracies?: string[];
  opponentConspiracies?: string[];
  opponentName: string;
  opponentMain: DraftCard[];
  opponentSideboard: DraftCard[];
}

export type DraftCard = CardIdentity;

export interface LimitedDeck {
  name: string;
  main: DraftCard[];
  sideboard: DraftCard[];
}

export interface SealedPool {
  sessionId: string;
  deckName: string;
  landSetCode: string | null;
  cards: DraftCard[];
  suggestedDeck: LimitedDeck | null;
  aiDecks: LimitedDeck[];
}

export interface SealedSetup {
  poolType: LimitedPoolType;
  numBoosters: number;
  pool: DraftCard[];
  variant?: string;
  seed?: number;
  singleton?: boolean;
}

export interface SealedTemplateMetadata {
  id: string;
  label: string;
  description: string;
  numPacks: number;
}

export interface DraftSeat {
  seat: number;
  name: string;
  isHuman: boolean;
  picksMade: number;
  lastPickName: string | null;
  currentPackSize?: number;
  packsWaiting?: number;
  awaitingPick?: boolean;
}

export interface DraftState {
  sessionId: string;
  round: number;
  totalRounds: number;
  pickNumber: number;
  packSize: number;
  currentPack: DraftCard[];
  pickedPile: DraftCard[];
  seatSummaries: DraftSeat[];
  isRoundOver: boolean;
  isComplete: boolean;
  awaitingHuman: boolean;
  humanConspiracies?: string[];
  draftEffectAvailable?: boolean;
  draftEffectActive?: boolean;
  picksPerPass: number;
  picksRemainingInPack: number;
  passDirection?: "left" | "right";
  /** True for a CR 903.13a Commander Draft pod. */
  commanderDraft?: boolean;
  /** Deck-construction floor reported by the session (40 draft, 60 commander). */
  minDeckSize?: number;
}

export interface CommanderGameSetup {
  humanDeck: string[];
  humanCommanders: string[];
  humanSideboard: string[];
  opponents: { deck: string[]; commanders: string[] }[];
}

export interface BoosterDraftSetup {
  podSize: number;
  rounds: number;
  pool: DraftCard[];
  variant?: string;
  seed?: number;
  picksPerPass?: number;
  customPool?: boolean;
}

export interface WinstonSetup {
  poolPacks: number;
  pool: DraftCard[];
  variant?: string;
  seed?: number;
  customPool?: boolean;
}

export interface WinstonState {
  sessionId: string;
  activeSeat: number;
  currentPile: number;
  piles: DraftCard[][];
  deckSize: number;
  pickedPile: DraftCard[];
  aiPickCount: number;
  awaitingHuman: boolean;
  isComplete: boolean;
}

export interface CubeImportRequest {
  cubeIdOrUrl: string;
}

export interface CubeImportResult {
  cubeId: string;
  name: string;
  cardCount: number;
  numPacks: number;
  singleton: boolean;
  pool?: DraftCard[];
  playableCardCount: number;
  rejectedCardCount: number;
}

export interface ChaosTheme {
  tag: string;
  label: string;
  orderNumber: number;
}

export interface GauntletOpponent {
  round: number;
  deckName: string;
  mainCount: number;
  sideboardCount: number;
}

export interface GauntletState {
  gauntletId: string;
  kind: "sealed" | "draft";
  rounds: number;
  currentRound: number;
  wins: number;
  losses: number;
  completed: boolean;
  humanDeckName: string;
  opponents: GauntletOpponent[];
  currentOpponent: GauntletOpponent | null;
}

export type GauntletOutcomeKind =
  | "matchInProgress"
  | "advanceNextRound"
  | "wonTournament"
  | "lostRound";

export interface GauntletOutcome {
  state: GauntletState;
  outcome: GauntletOutcomeKind;
  nextRoundIndex: number | null;
}

export interface ConspiracyHook {
  cardName: string;
  flagName: string;
  description: string;
}
