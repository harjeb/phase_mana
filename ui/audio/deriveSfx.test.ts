import { describe, expect, it } from "vitest";
import type { StackObjectDto } from "@/protocol/game";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import type { ClientCardDto, ClientGameView, ClientPlayerDto } from "@/stores/gameStore.types";
import { deriveSfx } from "./deriveSfx";
import type { SfxId } from "./sfxCatalog";

function player(id: string, over: Partial<ClientPlayerDto> = {}): ClientPlayerDto {
  return {
    id,
    name: id,
    status: "playing",
    isHuman: true,
    life: 20,
    maxHandSize: 7,
    unlimitedHandSize: false,
    landsPlayedThisTurn: 0,
    maxLandPlaysPerTurn: 1,
    unlimitedLandPlays: false,
    cardsDrawnThisTurn: 0,
    damagePrevention: 0,
    isExtraTurn: false,
    extraTurnCount: 0,
    playerKeywords: [],
    commanderCasts: {},
    counters: {},
    manaPool: {},
    commanderDamage: {},
    hasCityBlessing: false,
    hasEnduringStory: false,
    ringLevel: 0,
    speed: 0,
    hand: [],
    graveyard: [],
    exile: [],
    commandZone: [],
    library: [],
    libraryCount: 40,
    handCount: 7,
    poison: 0,
    energyCounters: 0,
    radiationCounters: 0,
    experienceCounters: 0,
    ticketCounters: 0,
    ...over,
  };
}

function card(id: string, over: Partial<ClientCardDto> = {}): ClientCardDto {
  return {
    ...GAME_CARD_DEFAULTS,
    id,
    identity: { name: id, setCode: "", cardNumber: "", isToken: false },
    types: ["Creature"],
    zoneId: "battlefield",
    ...over,
  };
}

function stackObject(id: string, over: Partial<StackObjectDto> = {}): StackObjectDto {
  return {
    id,
    sourceId: id,
    controllerId: "p1",
    ownerId: "p1",
    identity: { name: id, setCode: "", cardNumber: "", isToken: false },
    text: "",
    isPermanentSpell: false,
    isCasting: false,
    isDoubleFaced: false,
    faceIndex: 0,
    targets: [],
    ...over,
  };
}

function view(over: Partial<ClientGameView> = {}): ClientGameView {
  return {
    gameId: "g1",
    turn: 3,
    step: "main1",
    combatAssignments: [],
    activePlayerId: "p1",
    priorityPlayerId: "p1",
    players: [player("p1"), player("p2")],
    zones: [],
    battlefield: [],
    stack: [],
    gameOver: false,
    winnerId: null,
    monarchId: null,
    initiativeHolderId: null,
    dayTime: "neither",
    ...over,
  };
}

const ids = (cues: { id: SfxId }[]) => cues.map((cue) => cue.id);

describe("deriveSfx", () => {
  it("plays the start chime for the first view of a new game only", () => {
    expect(ids(deriveSfx(null, view({ turn: 1 }), "p1"))).toEqual(["gameStart"]);
    expect(ids(deriveSfx(view({ gameId: "old" }), view({ turn: 1 }), "p1"))).toEqual(["gameStart"]);
    // Resuming a game already under way stays quiet.
    expect(deriveSfx(null, view({ turn: 7 }), "p1")).toEqual([]);
  });

  it("is silent when nothing changed or the board jumped backwards", () => {
    const before = view();
    expect(deriveSfx(before, view(), "p1")).toEqual([]);
    expect(deriveSfx(view({ turn: 5 }), view({ turn: 4, players: [player("p1", { life: 1 })] }), "p1")).toEqual(
      [],
    );
  });

  describe("life", () => {
    it("plays loss and gain, harder for bigger swings", () => {
      const lost = deriveSfx(view(), view({ players: [player("p1", { life: 19 }), player("p2")] }), "p1");
      const bigLoss = deriveSfx(view(), view({ players: [player("p1", { life: 10 }), player("p2")] }), "p1");
      expect(ids(lost)).toEqual(["lifeLoss"]);
      expect(bigLoss[0].volume!).toBeGreaterThan(lost[0].volume!);

      const gained = deriveSfx(view(), view({ players: [player("p1"), player("p2", { life: 23 })] }), "p1");
      expect(ids(gained)).toEqual(["lifeGain"]);
    });
  });

  describe("drawing", () => {
    it("detects a draw from the zone counts, quieter for the opponent", () => {
      const mine = deriveSfx(
        view(),
        view({ players: [player("p1", { handCount: 8, libraryCount: 39 }), player("p2")] }),
        "p1",
      );
      const theirs = deriveSfx(
        view(),
        view({ players: [player("p1"), player("p2", { handCount: 8, libraryCount: 39 })] }),
        "p1",
      );
      expect(ids(mine)).toEqual(["cardDraw"]);
      expect(ids(theirs)).toEqual(["cardDraw"]);
      expect(theirs[0].volume!).toBeLessThan(mine[0].volume!);
    });

    it("uses the engine's draw counter within a turn", () => {
      const cues = deriveSfx(
        view(),
        view({ players: [player("p1", { cardsDrawnThisTurn: 1 }), player("p2")] }),
        "p1",
      );
      expect(ids(cues)).toEqual(["cardDraw"]);
    });

    it("does not call a hand-to-battlefield move a draw", () => {
      const cues = deriveSfx(
        view(),
        view({ players: [player("p1", { handCount: 6 }), player("p2")] }),
        "p1",
      );
      expect(ids(cues)).not.toContain("cardDraw");
    });
  });

  describe("combat", () => {
    it("plays attack and block cues for new attackers and new block pairs", () => {
      const bear = card("bear");
      const wall = card("wall");
      const attack = deriveSfx(
        view({ battlefield: [bear, wall] }),
        view({ battlefield: [{ ...bear, isAttacking: true }, wall] }),
        "p1",
      );
      expect(ids(attack)).toEqual(["attackDeclare"]);

      const block = deriveSfx(
        view({ battlefield: [{ ...bear, isAttacking: true }, wall] }),
        view({
          battlefield: [{ ...bear, isAttacking: true }, wall],
          combatAssignments: [{ blockerId: "wall", attackerId: "bear" }],
        }),
        "p1",
      );
      expect(ids(block)).toEqual(["combatBlock"]);
    });

    it("plays an impact for creature damage unless a life loss already covers it", () => {
      const bear = card("bear");
      const hurt = { ...bear, damage: 2 };
      expect(ids(deriveSfx(view({ battlefield: [bear] }), view({ battlefield: [hurt] }), "p1"))).toEqual([
        "combatBlock",
      ]);
      const withLifeLoss = deriveSfx(
        view({ battlefield: [bear] }),
        view({ battlefield: [hurt], players: [player("p1", { life: 17 }), player("p2")] }),
        "p1",
      );
      expect(ids(withLifeLoss)).toEqual(["lifeLoss"]);
    });
  });

  describe("permanents leaving", () => {
    const bear = card("bear", { ownerId: "p1" });

    it("plays a destroy cue for a creature that reached the graveyard", () => {
      const next = view({
        players: [player("p1", { graveyard: [{ ...bear, zoneId: "graveyard" }] }), player("p2")],
      });
      expect(ids(deriveSfx(view({ battlefield: [bear] }), next, "p1"))).toEqual(["creatureDestroy"]);
    });

    it("stays quiet for a creature that was bounced or exiled", () => {
      const bounced = view({
        players: [player("p1", { hand: [{ ...bear, zoneId: "hand" }], handCount: 8 }), player("p2")],
      });
      const exiled = view({
        players: [player("p1", { exile: [{ ...bear, zoneId: "exile" }] }), player("p2")],
      });
      expect(deriveSfx(view({ battlefield: [bear] }), bounced, "p1")).toEqual([]);
      expect(deriveSfx(view({ battlefield: [bear] }), exiled, "p1")).toEqual([]);
    });

    it("treats a vanished token as dead but a vanished real card as hidden", () => {
      const token = card("token", { identity: { name: "Goblin", setCode: "", cardNumber: "", isToken: true } });
      expect(ids(deriveSfx(view({ battlefield: [token] }), view(), "p1"))).toEqual(["creatureDestroy"]);
      expect(deriveSfx(view({ battlefield: [bear] }), view(), "p1")).toEqual([]);
    });

    it("plays the sacrifice cue for a non-creature permanent sent to the graveyard", () => {
      const relic = card("relic", { types: ["Artifact"] });
      const next = view({
        players: [player("p1", { graveyard: [{ ...relic, zoneId: "graveyard" }] }), player("p2")],
      });
      expect(ids(deriveSfx(view({ battlefield: [relic] }), next, "p1"))).toEqual(["sacrifice"]);
    });
  });

  describe("permanents entering", () => {
    it("plays land and token cues", () => {
      const land = card("forest", { types: ["Land"] });
      const token = card("token", { identity: { name: "Goblin", setCode: "", cardNumber: "", isToken: true } });
      expect(ids(deriveSfx(view(), view({ battlefield: [land] }), "p1"))).toEqual(["landPlay"]);
      expect(ids(deriveSfx(view(), view({ battlefield: [token] }), "p1"))).toEqual(["tokenCreate"]);
    });

    it("plays the counter cue when a permanent gains counters", () => {
      const bear = card("bear", { counters: { "+1/+1": 1 } });
      const grown = { ...bear, counters: { "+1/+1": 2 } };
      expect(ids(deriveSfx(view({ battlefield: [bear] }), view({ battlefield: [grown] }), "p1"))).toEqual([
        "counterAdd",
      ]);
    });
  });

  describe("the stack", () => {
    it("tells a cast spell from a permanent's ability by where its source sits", () => {
      const spell = stackObject("bolt");
      const engine = card("engine", { types: ["Artifact"] });
      const ability = stackObject("engine-ability", { sourceId: "engine" });

      expect(ids(deriveSfx(view(), view({ stack: [spell] }), "p1"))).toEqual(["spellCast"]);
      expect(
        ids(deriveSfx(view({ battlefield: [engine] }), view({ battlefield: [engine], stack: [ability] }), "p1")),
      ).toEqual(["abilityActivate"]);
    });

    it("recognises a permanent spell that ended in the graveyard as countered", () => {
      const bear = card("bear", { ownerId: "p1", zoneId: "graveyard" });
      const spell = stackObject("bear", { isPermanentSpell: true });
      const countered = view({ players: [player("p1", { graveyard: [bear] }), player("p2")] });
      expect(ids(deriveSfx(view({ stack: [spell] }), countered, "p1"))).toEqual(["spellCountered"]);

      const resolved = view({ battlefield: [{ ...bear, zoneId: "battlefield" }] });
      expect(deriveSfx(view({ stack: [spell] }), resolved, "p1")).toEqual([]);
    });
  });

  it("keeps only the loudest few cues from a busy update", () => {
    const attacker = card("attacker");
    const land = card("forest", { types: ["Land"] });
    const relic = card("relic", { types: ["Artifact"] });
    const next = view({
      battlefield: [{ ...attacker, isAttacking: true }, land],
      stack: [stackObject("bolt")],
      players: [
        player("p1", { life: 18, handCount: 8, libraryCount: 39 }),
        player("p2", { life: 25 }),
      ],
      combatAssignments: [{ blockerId: "wall", attackerId: "attacker" }],
    });
    const cues = ids(deriveSfx(view({ battlefield: [attacker, relic] }), next, "p1"));
    expect(cues).toEqual(["attackDeclare", "combatBlock", "lifeLoss", "lifeGain"]);
  });

  it("ignores a resync-sized jump instead of narrating it", () => {
    const crowd = Array.from({ length: 15 }, (_, i) => card(`c${i}`, { types: ["Land"] }));
    expect(deriveSfx(view(), view({ battlefield: crowd }), "p1")).toEqual([]);
  });
});
