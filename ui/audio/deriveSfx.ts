import type { ClientCardDto, ClientGameView, ClientPlayerDto } from "@/stores/gameStore.types";
import type { SfxCue, SfxId } from "./sfxCatalog";


/** Loudest first. When one update trips many cues, only the first few play. */
const CUE_PRIORITY: readonly SfxId[] = [
  "attackDeclare",
  "combatBlock",
  "lifeLoss",
  "lifeGain",
  "creatureDestroy",
  "spellCountered",
  "spellCast",
  "abilityActivate",
  "tokenCreate",
  "landPlay",
  "cardDraw",
  "counterAdd",
  "sacrifice",
  "gameStart",
];
const MAX_CUES_PER_UPDATE = 4;
/** A bigger battlefield churn than this in one update is a resync or a mass
 *  effect, not something worth narrating one sample at a time. */
const MAX_BATTLEFIELD_CHURN = 12;
const OPPONENT_VOLUME = 0.6;

type Zone = "graveyard" | "exile" | "hand" | "library" | "command";

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function isCreature(card: ClientCardDto): boolean {
  return card.types.includes("Creature");
}

function counterTotal(card: ClientCardDto): number {
  let total = 0;
  for (const value of Object.values(card.counters)) total += value;
  return total;
}

/** Where a card that left the battlefield ended up; null when it is nowhere
 *  visible (a token that ceased to exist, or a card in a hidden zone). */
function locate(view: ClientGameView, id: string): Zone | null {
  for (const player of view.players) {
    if (player.graveyard.some((card) => card.id === id)) return "graveyard";
    if (player.exile.some((card) => card.id === id)) return "exile";
    if (player.hand.some((card) => card.id === id)) return "hand";
    if (player.library.some((card) => card.id === id)) return "library";
    if (player.commandZone.some((card) => card.id === id)) return "command";
  }
  return null;
}

function stackedVolume(count: number, base = 1): number {
  return base * (1 + Math.min(count - 1, 3) * 0.1);
}

class CueSet {
  private readonly volumes = new Map<SfxId, number>();

  add(id: SfxId, volume = 1): void {
    this.volumes.set(id, Math.max(this.volumes.get(id) ?? 0, volume));
  }

  has(id: SfxId): boolean {
    return this.volumes.has(id);
  }

  toCues(): SfxCue[] {
    return CUE_PRIORITY.flatMap((id) => {
      const volume = this.volumes.get(id);
      return volume === undefined ? [] : [{ id, volume }];
    }).slice(0, MAX_CUES_PER_UPDATE);
  }
}

function addPlayerCues(
  cues: CueSet,
  prev: ClientGameView,
  next: ClientGameView,
  myPlayerId: string | null,
): void {
  const prevPlayers = byId(prev.players);
  for (const player of next.players) {
    const before = prevPlayers.get(player.id);
    if (!before) continue;
    const volume = myPlayerId === null || player.id === myPlayerId ? 1 : OPPONENT_VOLUME;

    // Life: bigger swings hit a little harder.
    const lifeDelta = player.life - before.life;
    if (lifeDelta !== 0) {
      const swing = 0.85 + Math.min(Math.abs(lifeDelta), 8) * 0.05;
      cues.add(lifeDelta > 0 ? "lifeGain" : "lifeLoss", swing);
    }

    const drawn = cardsDrawn(before, player, prev.turn === next.turn);
    if (drawn > 0) cues.add("cardDraw", stackedVolume(drawn, volume));
  }
}

/** Cards that moved library -> hand. `cardsDrawnThisTurn` covers engines that
 *  report it; the zone counts cover the rest (and tutors, which sound alike). */
function cardsDrawn(before: ClientPlayerDto, after: ClientPlayerDto, sameTurn: boolean): number {
  const fromZones = Math.min(
    after.handCount - before.handCount,
    before.libraryCount - after.libraryCount,
  );
  const reported = sameTurn ? after.cardsDrawnThisTurn - before.cardsDrawnThisTurn : 0;
  return Math.max(fromZones, reported, 0);
}

function addCombatCues(cues: CueSet, prev: ClientGameView, next: ClientGameView): void {
  const prevAttackers = new Set(prev.battlefield.filter((c) => c.isAttacking).map((c) => c.id));
  const newAttackers = next.battlefield.filter((c) => c.isAttacking && !prevAttackers.has(c.id));
  if (newAttackers.length > 0) cues.add("attackDeclare", stackedVolume(newAttackers.length));

  const pairKey = (a: { blockerId: string; attackerId: string }) => `${a.blockerId}>${a.attackerId}`;
  const prevBlocks = new Set(prev.combatAssignments.map(pairKey));
  const newBlocks = next.combatAssignments.filter((a) => !prevBlocks.has(pairKey(a)));
  if (newBlocks.length > 0) cues.add("combatBlock", stackedVolume(newBlocks.length));
}

function addBattlefieldCues(cues: CueSet, prev: ClientGameView, next: ClientGameView): boolean {
  const prevCards = byId(prev.battlefield);
  const nextCards = byId(next.battlefield);

  const entered = next.battlefield.filter((card) => !prevCards.has(card.id));
  const left = prev.battlefield.filter((card) => !nextCards.has(card.id));
  if (entered.length + left.length > MAX_BATTLEFIELD_CHURN) return false;

  if (entered.some((card) => card.identity.isToken)) cues.add("tokenCreate");
  if (entered.some((card) => !card.identity.isToken && card.types.includes("Land"))) {
    cues.add("landPlay");
  }

  let creaturesLost = 0;
  let otherPermanentsLost = 0;
  for (const card of left) {
    const zone = locate(next, card.id);
    // Bounced, exiled or tucked into a hidden zone is not a death; a token
    // that vanished from the board has ceased to exist, which is.
    const died = zone === "graveyard" || (zone === null && card.identity.isToken);
    if (!died) continue;
    if (isCreature(card)) {
      creaturesLost++;
    } else if (zone === "graveyard") {
      otherPermanentsLost++;
    }
  }
  if (creaturesLost > 0) cues.add("creatureDestroy", stackedVolume(creaturesLost));
  if (otherPermanentsLost > 0) cues.add("sacrifice", 0.9);

  let countersAdded = false;
  let damaged = false;
  for (const card of next.battlefield) {
    const before = prevCards.get(card.id);
    if (!before) continue;
    if (counterTotal(card) > counterTotal(before)) countersAdded = true;
    if (isCreature(card) && card.damage > before.damage) damaged = true;
  }
  if (countersAdded) cues.add("counterAdd");
  // Damage to a creature with no life total change alongside it (combat
  // between creatures, a burn spell on a blocker) still wants an impact.
  if (damaged && !cues.has("lifeLoss")) cues.add("combatBlock", 0.8);
  return true;
}

function addStackCues(cues: CueSet, prev: ClientGameView, next: ClientGameView): void {
  const prevStack = new Set(prev.stack.map((obj) => obj.id));
  const battlefieldIds = new Set(next.battlefield.map((card) => card.id));
  for (const obj of next.stack) {
    if (prevStack.has(obj.id)) continue;
    // An object whose source sits on the battlefield is that permanent's
    // activated or triggered ability; anything else is a card being cast.
    const isAbility = !obj.isPermanentSpell && battlefieldIds.has(obj.sourceId);
    cues.add(isAbility ? "abilityActivate" : "spellCast");
  }

  // A permanent spell that left the stack for the graveyard instead of the
  // battlefield was countered (or fizzled).
  const nextStack = new Set(next.stack.map((obj) => obj.id));
  for (const obj of prev.stack) {
    if (nextStack.has(obj.id) || !obj.isPermanentSpell) continue;
    if (battlefieldIds.has(obj.sourceId)) continue;
    if (locate(next, obj.sourceId) === "graveyard") cues.add("spellCountered");
  }
}

/**
 * The sound effects a game-state transition calls for.
 *
 * The engine only streams whole-board snapshots, so effects are inferred by
 * diffing consecutive views. `myPlayerId` quiets the opponent's draws; pass
 * null for a spectator or manual table, where every seat plays at full volume.
 */
export function deriveSfx(
  prev: ClientGameView | null,
  next: ClientGameView,
  myPlayerId: string | null,
): SfxCue[] {
  if (!prev || prev.gameId !== next.gameId) {
    // The first view of a fresh game; a mid-game resume stays silent.
    return next.turn <= 1 ? [{ id: "gameStart" }] : [];
  }
  // An undo or rewind: the board is jumping, not playing.
  if (next.turn < prev.turn) return [];

  const cues = new CueSet();
  // Players first: the battlefield pass skips the damage thud when a life
  // loss already covers it.
  addPlayerCues(cues, prev, next, myPlayerId);
  if (!addBattlefieldCues(cues, prev, next)) return [];
  addCombatCues(cues, prev, next);
  addStackCues(cues, prev, next);
  return cues.toCues();
}
