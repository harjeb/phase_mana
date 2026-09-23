import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { customFormatPlayerCount, exportCustomFormat, importCustomFormat, listCustomFormats, upsertCustomFormat, type SavedCustomFormat } from "./customFormats";
import { getGameApi } from "@/platform";
import { startLocalDeckGame } from "@/phase/transport";
import type { Deck } from "@/protocol/deck";

vi.mock("@/phase/transport", () => ({ startLocalDeckGame: vi.fn() }));
const format: SavedCustomFormat = {
  key: "test", label: "Test", shortLabel: "T", description: "Rules", updatedAt: 1,
  rules: {
    id: 7,
    structural: {
      starting_life: 20, min_players: 3, max_players: 4, deck_size: { type: "Minimum", data: 60 },
      singleton: false, command_zone_mode: "Disabled", range_of_influence: { default_range: 1, player_overrides: {} },
      team_based: false, sideboard_policy: { type: "Limited", data: 15 }, default_deck_copy_limit: { type: "UpTo", data: 4 },
    },
    legality: {
      legal_sets: null, legal_cards: ["Forest"], banned: [], restricted: [],
      legacy: { mana_burn: "Modern", damage_timing: "Modern", wish_scope: "PostM10SideboardOnly", legend_rule_scope: "Modern", ante: "Excluded" },
    },
  },
};
let data: Map<string, string>;
beforeEach(() => {
  vi.clearAllMocks();
  data = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true, reasons: [] }) }));
});
afterEach(() => vi.unstubAllGlobals());

it("roundtrips rules and unedited metadata through versioned export and storage", async () => {
  const original = { ...format, printingFidelity: "Printed", reprintPolicy: { future: true } };
  const imported = importCustomFormat(exportCustomFormat(original), [format]);
  expect(imported.key).toBe("test-2");
  expect(imported).toMatchObject({ rules: original.rules, printingFidelity: "Printed", reprintPolicy: { future: true } });
  await upsertCustomFormat(imported);
  expect(JSON.parse(data.get("phase-mana:custom-formats")!).version).toBe(1);
  expect(listCustomFormats()[0]).toMatchObject({ ...imported, updatedAt: expect.any(Number) });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).playerCount).toBe(3);
  expect(customFormatPlayerCount(imported.rules)).toBe(3);
});

it.each(["Forbidden", "Unlimited"] as const)("roundtrips tagged unit sideboard %s and unlimited copies", async (type) => {
  const original = structuredClone(format);
  original.rules.structural.sideboard_policy = { type };
  original.rules.structural.default_deck_copy_limit = { type: "Unlimited" };
  original.rules.structural.deck_size = { type: "Exactly", data: 100 };
  original.rules.structural.command_zone_mode = { Enabled: { commander_damage_threshold: 21, eligibility_rule: "Standard" } };
  const imported = importCustomFormat(exportCustomFormat(original), []);
  await upsertCustomFormat(imported);
  expect(listCustomFormats()[0].rules).toEqual(original.rules);
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).rules).toEqual(original.rules);
});

it.each([
  { deck_size: { Minimum: 60 } },
  { default_deck_copy_limit: { UpTo: 4 } },
  { default_deck_copy_limit: "Unlimited" },
  { sideboard_policy: { Limited: 15 } },
  { sideboard_policy: "Forbidden" },
  { command_zone_mode: { type: "Disabled" } },
  { range_of_influence: { Limited: 1 } },
])("rejects incorrect enum wire shapes: %j", (structural) => {
  const input = structuredClone(format);
  Object.assign(input.rules.structural, structural);
  expect(() => importCustomFormat(JSON.stringify(input), [])).toThrow();
});

it("reads legacy arrays and skips corrupt records without crashing the picker", () => {
  data.set("phase-mana:custom-formats", JSON.stringify([null, { label: 9 }, format]));
  expect(listCustomFormats()).toEqual([format]);
  expect(() => importCustomFormat('{"version":99}', [])).toThrow("version");
  expect(() => importCustomFormat('{"rules":{"structural":{},"legality":{}}}', [])).toThrow();
});

it("does not overwrite a future storage version", async () => {
  const future = JSON.stringify({ version: 99, formats: [format] });
  data.set("phase-mana:custom-formats", future);
  expect(listCustomFormats()).toEqual([]);
  await expect(upsertCustomFormat(format)).rejects.toThrow("not overwritten");
  expect(data.get("phase-mana:custom-formats")).toBe(future);
});

it("never persists a rejected import or overwrites the previous save on network failure", async () => {
  await upsertCustomFormat(format);
  const previous = data.get("phase-mana:custom-formats");
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ valid: false, reasons: ["Unsupported axis"] }) } as Response);
  await expect(upsertCustomFormat(importCustomFormat(exportCustomFormat(format), []))).rejects.toThrow("Unsupported axis");
  vi.mocked(fetch).mockRejectedValueOnce(new Error("Offline"));
  await expect(upsertCustomFormat(format)).rejects.toThrow("Offline");
  expect(data.get("phase-mana:custom-formats")).toBe(previous);
});

it("validates actual seats before play and moves all commander slots into custom libraries", async () => {
  const card = (name: string) => ({ identity: { name } }) as Deck["cards"][number];
  const deck: Deck = { name: "Commander", format: "commander", cards: [card("Forest")], commanders: [card("Commander")], sideboard: [card("Island")] };
  const params = { deck, startingLife: 20, commanderName: "Commander", customRules: format.rules, format: "custom:test" };
  await expect(getGameApi().startGame({ ...params, opponentDecks: [deck] })).rejects.toThrow("player count");
  expect(startLocalDeckGame).not.toHaveBeenCalled();
  await getGameApi().startGame({ ...params, opponentDecks: [deck, deck] });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string).playerCount).toBe(3);
  expect(startLocalDeckGame).toHaveBeenCalledWith(expect.objectContaining({
    format: "custom:test", customRules: format.rules, humanDeck: ["Forest", "Commander"], humanCommanders: [],
    humanSideboard: ["Island"], aiSideboard: ["Island"],
    aiDeck: ["Forest", "Commander"], aiCommanders: [], extraOpponents: [{ deck: ["Forest", "Commander"], commanders: [], sideboard: ["Island"] }],
  }));
  vi.mocked(startLocalDeckGame).mockClear();
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ valid: false, reasons: ["Rejected"] }) } as Response);
  await expect(getGameApi().startGame({ ...params, opponentDecks: [deck, deck] })).rejects.toThrow("Rejected");
  expect(startLocalDeckGame).not.toHaveBeenCalled();
});
