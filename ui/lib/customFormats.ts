/**
 * P5 custom formats, client side.
 *
 * The engine owns semantic validation; local shape checks protect the editor. A new format
 * starts from `GET /api/custom-formats/base` (the host builds it through the
 * real `CustomFormatDef::from_lobby_config` constructor) and is checked with
 * `POST /api/custom-formats/validate` before it is saved, so a ruleset that the
 * host rejects does not land in local storage.
 *
 * Wire field names for `rules` are the engine's snake_case serde defaults; the
 * envelope endpoints are camelCase. Keep both in sync with `server/src/lib.rs`.
 */

/** Engine `CustomFormatId` is a transparent u16; `LOBBY_SAVE_CUSTOM_FORMAT_ID` is 0. */
import { t } from "@lingui/core/macro";
import { z } from "zod";

export const CUSTOM_FORMAT_SAVE_ID = 0;
const uint = z.number().int().nonnegative();
const strings = z.array(z.string());
const rulesSchema = z.object({
  id: uint.max(65535),
  structural: z.object({
    starting_life: z.number().int().positive(),
    min_players: uint.min(2).max(4), max_players: uint.min(2),
    deck_size: z.object({ type: z.enum(["Minimum", "Exactly"]), data: uint.max(65535) }).strict(),
    singleton: z.boolean(), team_based: z.boolean(),
    command_zone_mode: z.union([z.literal("Disabled"), z.object({ Enabled: z.object({
      commander_damage_threshold: uint.max(255).nullable(), eligibility_rule: z.enum(["Standard", "TinyLeaders", "OathbreakerSignatureSpell", "BrawlColorIdentity"]),
    }).passthrough() }).strict()]),
    sideboard_policy: z.union([z.object({ type: z.enum(["Forbidden", "Unlimited"]) }).strict(), z.object({ type: z.literal("Limited"), data: uint.max(4294967295) }).strict()]),
    default_deck_copy_limit: z.union([z.object({ type: z.literal("Unlimited") }).strict(), z.object({ type: z.literal("UpTo"), data: uint.max(4294967295) }).strict()]),
    range_of_influence: z.object({ default_range: uint.max(255), player_overrides: z.record(z.string(), uint.max(255)).optional() }).nullable().optional(),
  }).passthrough().refine((s) => s.min_players <= s.max_players, "Invalid player range"),
  legality: z.object({
    legal_sets: strings.nullable(), legal_cards: strings, banned: strings, restricted: strings,
    legacy: z.object({
      mana_burn: z.enum(["Modern", "Obsolete"]), damage_timing: z.enum(["Modern", "OnStack"]),
      wish_scope: z.enum(["PostM10SideboardOnly", "PreM10ReachesExile"]),
      legend_rule_scope: z.enum(["Modern", "PreM14AnyController"]), ante: z.enum(["Excluded", "Enabled"]),
    }).passthrough(),
  }).passthrough(),
}).passthrough();
const formatSchema = z.object({
  label: z.string().min(1).refine((s) => s.trim().length > 0), shortLabel: z.string().default(""), description: z.string().default(""), rules: rulesSchema,
}).passthrough();
const savedSchema = formatSchema.extend({ key: z.string().min(1), updatedAt: uint });

export function customFormatPlayerCount(rules: CustomFormatRules): number {
  return rulesSchema.parse(rules).structural.min_players;
}

/** format.rs uses adjacently tagged serde enums, including object-shaped unit variants. */
export type DeckSizeRule = { type: "Minimum" | "Exactly"; data: number };
export type SideboardPolicy = { type: "Forbidden" | "Unlimited" } | { type: "Limited"; data: number };
export type DeckCopyLimit = { type: "Unlimited" } | { type: "UpTo"; data: number };
export type CommanderEligibilityRule = "Standard" | "TinyLeaders" | "OathbreakerSignatureSpell" | "BrawlColorIdentity";
// custom_format.rs leaves command-zone and legacy enums externally tagged.
export type CommandZoneMode =
  | "Disabled"
  | { Enabled: { commander_damage_threshold: number | null; eligibility_rule: CommanderEligibilityRule } };

export interface StructuralRules {
  starting_life: number;
  min_players: number;
  max_players: number;
  deck_size: DeckSizeRule;
  singleton: boolean;
  command_zone_mode: CommandZoneMode;
  range_of_influence?: { default_range: number; player_overrides?: Record<string, number> } | null;
  team_based: boolean;
  sideboard_policy: SideboardPolicy;
  default_deck_copy_limit: DeckCopyLimit;
}

export interface LegacyRuleSet {
  mana_burn: "Modern" | "Obsolete";
  damage_timing: "Modern" | "OnStack";
  wish_scope: "PostM10SideboardOnly" | "PreM10ReachesExile";
  legend_rule_scope: "Modern" | "PreM14AnyController";
  ante: "Excluded" | "Enabled";
}

export interface LegalityRules {
  legal_sets: string[] | null;
  legal_cards: string[];
  banned: string[];
  restricted: string[];
  legacy: LegacyRuleSet;
}

export interface CustomFormatRules {
  id: number;
  structural: StructuralRules;
  legality: LegalityRules;
}

export interface SavedCustomFormat {
  /** Stable local key, independent of the preserved engine rules id. */
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  rules: CustomFormatRules;
  updatedAt: number;
}

/** Shape of `GET /api/custom-formats` (a bundled preset the user may clone). */
export interface BundledCustomFormat {
  id: number;
  label: string;
  shortLabel: string;
  description: string;
  reprintPolicy: unknown;
  printingFidelity: string;
  rules: CustomFormatRules;
}

const STORAGE_KEY = "custom-formats";

function storage() {
  return {
    load(): SavedCustomFormat[] {
      const raw = localStorage.getItem(`phase-mana:${STORAGE_KEY}`);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        const entries = Array.isArray(parsed) ? parsed : parsed?.version === 1 ? parsed.formats : [];
        if (!Array.isArray(entries)) return [];
        return entries.flatMap((entry) => {
          const result = savedSchema.safeParse(entry);
          return result.success ? [result.data as SavedCustomFormat] : [];
        });
      } catch {
        return [];
      }
    },
    save(formats: SavedCustomFormat[]) {
      const raw = localStorage.getItem(`phase-mana:${STORAGE_KEY}`);
      if (raw) {
        const previous = JSON.parse(raw);
        if (!Array.isArray(previous) && previous?.version !== 1) {
          throw new Error(t`Unsupported custom format storage version; existing data was not overwritten.`);
        }
      }
      localStorage.setItem(`phase-mana:${STORAGE_KEY}`, JSON.stringify({ version: 1, formats }));
    },
  };
}

export function listCustomFormats(): SavedCustomFormat[] {
  return storage()
    .load()
    .slice()
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function upsertCustomFormat(format: SavedCustomFormat): Promise<SavedCustomFormat[]> {
  savedSchema.parse(format);
  await requireValidCustomFormat(format.rules);
  const formats = storage().load().filter((f) => f.key !== format.key);
  formats.push({ ...format, updatedAt: Date.now() });
  storage().save(formats);
  return listCustomFormats();
}

export function deleteCustomFormat(key: string): SavedCustomFormat[] {
  storage().save(storage().load().filter((f) => f.key !== key));
  return listCustomFormats();
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A fresh local key, unique against the formats already saved. */
export function newCustomFormatKey(label: string, existing: SavedCustomFormat[]): string {
  const base = slugify(label) || "custom-format";
  const taken = new Set(existing.map((f) => f.key));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** `GET /api/custom-formats/base` — a complete, engine-valid starter ruleset. */
export async function fetchCustomFormatBase(): Promise<{
  label: string;
  shortLabel: string;
  rules: CustomFormatRules;
}> {
  const response = await fetch("/api/custom-formats/base");
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

/** `GET /api/custom-formats` — the bundled presets (Old School 93/94 + 95). */
export async function fetchBundledCustomFormats(): Promise<BundledCustomFormat[]> {
  const response = await fetch("/api/custom-formats");
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

/** `POST /api/custom-formats/validate`. */
export async function validateCustomFormat(
  rules: CustomFormatRules,
  playerCount = customFormatPlayerCount(rules),
): Promise<{ valid: boolean; reasons: string[] }> {
  rulesSchema.parse(rules);
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4 ||
      playerCount < rules.structural.min_players || playerCount > rules.structural.max_players) {
    throw new Error(t`Unsupported player count for this custom format.`);
  }
  const response = await fetch("/api/custom-formats/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules, playerCount }),
  });
  if (!response.ok) throw new Error(await response.text());
  return z.object({ valid: z.boolean(), reasons: strings }).parse(await response.json());
}

export async function requireValidCustomFormat(rules: CustomFormatRules, playerCount?: number): Promise<void> {
  const result = await validateCustomFormat(rules, playerCount);
  if (!result.valid) throw new Error(result.reasons.join("; ") || "The host rejected this format.");
}

/** Export a saved format as the JSON the import box accepts (and that the host
 *  would accept as `StartRequest.customRules`). */
export function exportCustomFormat(format: SavedCustomFormat): string {
  return JSON.stringify(
    {
      ...format,
      version: 1,
      label: format.label,
      shortLabel: format.shortLabel,
      description: format.description,
      rules: format.rules,
    },
    null,
    2,
  );
}

/** Parse and shape-check an export; upsert validates with the host before persistence. */
export function importCustomFormat(
  json: string,
  existing: SavedCustomFormat[],
): SavedCustomFormat {
  const input = JSON.parse(json);
  if (input?.version !== undefined && input.version !== 1) throw new Error(t`Unsupported custom format version.`);
  const parsed = formatSchema.parse(input);
  const label = parsed.label;
  return {
    ...parsed,
    key: newCustomFormatKey(label, existing),
    label,
    shortLabel: parsed.shortLabel,
    description: parsed.description ?? "",
    rules: parsed.rules as CustomFormatRules,
    updatedAt: Date.now(),
  };
}

/** Human-readable one-line summary for a picker row. */
export function describeCustomFormat(format: SavedCustomFormat): string {
  const { structural, legality } = format.rules;
  const life = `${structural.starting_life} life`;
  const size =
    structural.deck_size.type === "Exactly"
      ? `${structural.deck_size.data} cards`
      : `${structural.deck_size.data}+ cards`;
  const copies =
    structural.default_deck_copy_limit.type === "Unlimited"
      ? "no copy limit"
      : `max ${structural.default_deck_copy_limit.data} copies`;
  const axes: string[] = [];
  if (legality.legacy.mana_burn === "Obsolete") axes.push("mana burn");
  if (legality.legacy.wish_scope === "PreM10ReachesExile") axes.push("pre-M10 wishes");
  if (legality.legacy.legend_rule_scope === "PreM14AnyController") axes.push("old legend rule");
  return [size, life, copies, ...axes].join(" · ");
}
