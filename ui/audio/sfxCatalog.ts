/** Short one-shot effects, served from `public/audio/sfx/`. */
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

export const SFX_BASE_URL = "/audio/sfx";

export function sfxUrl(id: SfxId): string {
  return `${SFX_BASE_URL}/${SFX_FILES[id]}`;
}
