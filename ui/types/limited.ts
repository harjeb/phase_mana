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
  /** Deck-construction floor reported by the session (40, or 30 for Pack Wars). */
  minDeckSize?: number;
  /** Casual mode this pool came from (pack_wars, duplicate_sealed, ...). */
  variantKind?: string;
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
  /** Casual mode this session belongs to (solomon, rotisserie, continuous, ...). */
  variantKind?: string;
  /** Solomon Draft: the human is assigning the current batch into two piles. */
  awaitingSplit?: boolean;
  /** Solomon Draft: the two piles offered to the human to choose from. */
  piles?: DraftCard[][];
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
  /** Reject Rare sub-variant: rare (default), mythic, uncommon/silver, common/iron. */
  rarity?: string;
  seed?: number;
  picksPerPass?: number;
  customPool?: boolean;
}

/** Setup for the bespoke interactive variants (Solomon/Rotisserie/Continuous). */
export interface VariantSetup {
  pool: DraftCard[];
  variant: string;
  seed?: number;
  customPool?: boolean;
  poolType?: LimitedPoolType;
  singleton?: boolean;
  /** Pod size for variants that need one (Pick-a-Pack); defaults to 2. */
  podSize?: number;
}

export interface VariantMetadata {
  id: string;
  label: string;
  description: string;
  players: number;
  packs: number;
  deckSize: number;
  engine: "draft" | "sealed" | "variant";
}

/** One unopened booster on offer during a Pick-a-Pack pre-draft. */
export interface PickAPackOffer {
  index: number;
  setCode: string;
  taken: boolean;
}

/** Pick-a-Pack (\u5148\u9009\u5305): snake-pick which boosters to open, then draft. */
export interface PickAPackView {
  sessionId: string;
  variantKind: "pick_a_pack";
  awaitingPick: boolean;
  done: boolean;
  seatCount: number;
  picksEach: number;
  yourPicks: number;
  packs: PickAPackOffer[];
}

/** The Pick-a-Pack commands either report the next pick or hand over the draft. */
export type PickAPackResponse =
  | { kind: "pick"; state: PickAPackView }
  | { kind: "draft"; state: DraftState };

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
  /** Casual variant this gauntlet came from, when any (e.g. `pack_wars_hand`). */
  variantKind?: string;
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
