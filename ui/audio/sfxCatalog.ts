/** Short one-shot effects, bundled from `ui/audio/sfx/` by `virtual:sfx-data`. */
export const SFX_FILES = {
  gameStart: "sfx_game_start_001.m4a",
  cardDraw: "sfx_card_draw_002.m4a",
  landPlay: "sfx_land_play_001.m4a",
  spellCast: "sfx_spell_cast_001.m4a",
  spellCountered: "sfx_spell_counter_001.m4a",
  abilityActivate: "sfx_ability_activate_001.m4a",
  attackDeclare: "sfx_attack_declare_001.m4a",
  combatBlock: "sfx_combat_block_001.m4a",
  lifeGain: "sfx_life_gain_001.m4a",
  lifeLoss: "sfx_life_loss_001.m4a",
  creatureDestroy: "sfx_creature_destroy_001.m4a",
  sacrifice: "sfx_sacrifice_001.m4a",
  tokenCreate: "sfx_token_create_001.m4a",
  counterAdd: "sfx_counter_add_001.m4a",
} as const;

export type SfxId = keyof typeof SFX_FILES;

export const SFX_IDS = Object.keys(SFX_FILES) as SfxId[];

export interface SfxCue {
  id: SfxId;
  /** Relative loudness for this cue, 1 = as recorded. */
  volume?: number;
}

let bank: Promise<Record<string, string>> | null = null;

/**
 * The encoded bytes of one effect. All effects arrive together in one lazily
 * imported script rather than as `.m4a` requests, which download managers
 * (IDM) intercept with a failed-download dialog while cancelling the request.
 */
export async function loadSfxBytes(id: SfxId): Promise<ArrayBuffer> {
  bank ??= import("virtual:sfx-data").then((module) => module.default);
  // A failed chunk load must be retryable, not cached forever.
  const files = await bank.catch((error: unknown) => {
    bank = null;
    throw error;
  });
  const base64 = files[SFX_FILES[id]];
  if (base64 === undefined) throw new Error(`missing sound effect ${SFX_FILES[id]}`);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
