#!/usr/bin/env node
/**
 * Convert Forge `.dck` decks (e.g. the MTGCH deckhub tournament decks in
 * `F:/Solo Arcanum/decks`) into phase_mana preset decks
 * (`public/preset_decks/<id>.json` + entries in `index.json`).
 *
 * Card data comes from this repo's `data/scryfall.db` so every preset card
 * carries the same fields the loader expects (`lib/presetDecks.ts`
 * PresetDeckCardDefinition): name/count/set/cardNumber/uris + optional
 * manaCost, colors, colorIdentity, cmc, types, subtypes, supertypes, text,
 * layout, power, toughness, backFace, allParts.
 *
 * Usage:
 *   node tools/dck-to-preset-decks.mjs --report                 # resolve-only audit
 *   node tools/dck-to-preset-decks.mjs --write --limit 6        # write first N writable decks
 *   node tools/dck-to-preset-decks.mjs --write --only a.dck,b.dck
 *
 * Flags: --src <dir> --out <dir> --db <sqlite> --id-prefix <str> --write
 *        --limit <n> --only <files> --formats <a,b> --force
 *        --require-legal --report-file <path>
 * Names are globally unique in the index; same-name imports are skipped.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return dflt;
  const next = argv[i + 1];
  return next === undefined || next.startsWith("--") ? true : next;
};
const has = (name) => argv.includes(`--${name}`);

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.resolve(String(flag("src", "F:/Solo Arcanum/decks")));
const OUT = path.resolve(String(flag("out", path.join(ROOT, "public/preset_decks"))));
const DB = path.resolve(String(flag("db", path.join(ROOT, "data/scryfall.db"))));
const ID_PREFIX = String(flag("id-prefix", "tourney"));
const LIMIT = Number(flag("limit", 0)) || 0;
const ONLY = flag("only", null) ? String(flag("only", "")).split(",").map((s) => s.trim()) : null;
const FORMATS = flag("formats", null)
  ? new Set(String(flag("formats", "")).split(",").map((s) => s.trim()))
  : null;
const WRITE = has("write");
const FORCE = has("force");
const REQUIRE_LEGAL = has("require-legal");
const REPORT_FILE = path.resolve(String(flag("report-file", path.join(ROOT, "tools/_dck_conversion_report.json"))));

/** `.dck` format value -> phase_mana DeckFormat. Unmapped formats are skipped. */
const FORMAT_MAP = {
  standard: "standard",
  pioneer: "pioneer",
  modern: "modern",
  legacy: "legacy",
  vintage: "vintage",
  pauper: "pauper",
  commander: "commander",
  brawl: "brawl",
  oathbreaker: "oathbreaker",
  premodern: "premodern",
  // MTG Arena-only formats have no equivalent in phase_mana's format list.
  alchemy: null,
  historic: null,
  timeless: null,
  explorer: null,
  freeform: null,
  "freeform-commander": null,
};

const COLOR_CLASS = {
  W: "text-amber-300",
  U: "text-sky-300",
  B: "text-gray-400",
  R: "text-red-400",
  G: "text-green-400",
};

function slug(value) {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Parse one `.dck`: metadata fields plus section -> [ {count, name, set, collector} ]. */
function parseDck(text) {
  const meta = {};
  const sections = new Map();
  let section = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      section = header[1].toLowerCase();
      if (!sections.has(section)) sections.set(section, []);
      continue;
    }
    if (!section || section === "metadata") {
      const eq = line.indexOf("=");
      if (eq > 0) meta[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      continue;
    }
    const m = /^(\d+)\s+(.+)$/.exec(line);
    if (!m) continue;
    let name = m[2].trim();
    let set;
    let collector;
    const annotated = /^(.*?)\s*\(([A-Za-z0-9]{2,6})\)\s*([0-9]+[a-z]?)$/.exec(name);
    if (annotated) {
      name = annotated[1].trim();
      set = annotated[2].toLowerCase();
      collector = annotated[3];
    } else if (name.includes("|")) {
      const parts = name.split("|").map((p) => p.trim());
      name = parts[0];
      set = (parts[1] ?? "").toLowerCase() || undefined;
      collector = parts[2] || undefined;
    }
    sections.get(section).push({ count: Number(m[1]), name, set, collector });
  }
  return { meta, sections };
}

const db = new DatabaseSync(DB, { readOnly: true });
const byName = db.prepare("select json from cards where name = ? collate nocase");
const byNameNewest = db.prepare(
  "select json from cards where name = ? collate nocase order by json_extract(json,'$.released_at') desc",
);
const byFront = db.prepare(
  "select json from cards where name like ? collate nocase order by json_extract(json,'$.released_at') desc",
);
const byPrinting = db.prepare(
  "select json from cards where set_code = ? and collector_number = ? collate nocase limit 1",
);

const normalizedName = (name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'").toLowerCase();
let canonicalNames;
const URIS = ["small", "normal", "large", "png", "art_crop", "border_crop"];
const EMPTY_URIS = Object.fromEntries(URIS.map((k) => [k, ""]));
const PART_COMPONENTS = new Set(["token", "combo_piece", "meld_part", "meld_result"]);

function pickUris(uris) {
  if (!uris) return null;
  const out = {};
  for (const key of URIS) {
    if (typeof uris[key] !== "string" || !uris[key]) return null;
    out[key] = uris[key];
  }
  return out;
}

/** Resolve a deck card name to a Scryfall card object. */
function resolveCard(entry) {
  const playable = (card) => !["token", "double_faced_token", "emblem", "art_series", "reversible_card"].includes(card.layout)
    && !/\b(Token|Emblem)\b/.test(card.type_line ?? "");
  if (entry.set && entry.collector) {
    const row = byPrinting.get(entry.set, entry.collector);
    if (row) {
      const card = JSON.parse(row.json);
      if (playable(card)) return card;
    }
  }
  // Tokens can share an exact name with a real card/front face (Mutavault,
  // Aang). Never resolve a deck slot to a newer token instead of its card.
  const parsed = byNameNewest.all(entry.name).map((r) => JSON.parse(r.json)).filter(playable);
  if (parsed.length) {
    return parsed.find((c) => c.image_status && c.image_status !== "missing") ?? parsed[0];
  }
  const front = byFront.all(`${entry.name.split(" // ")[0]} // %`).map((row) => JSON.parse(row.json)).find(playable);
  if (front) return front;
  const plain = byName.get(entry.name.split(" // ")[0]);
  if (plain && playable(JSON.parse(plain.json))) return JSON.parse(plain.json);
  // Deck sites sometimes omit accents (Lorien / Lórien); match only unique
  // canonical names, never fuzzy-match a different card or drop a card.
  if (!canonicalNames) {
    canonicalNames = new Map();
    for (const { name } of db.prepare("select distinct name from cards").all()) {
      const key = normalizedName(name);
      canonicalNames.set(key, canonicalNames.has(key) ? null : name);
    }
  }
  const canonical = canonicalNames.get(normalizedName(entry.name));
  if (canonical && canonical !== entry.name) return resolveCard({ ...entry, name: canonical });
  return null;
}

function toPresetCard(entry) {
  const card = resolveCard(entry);
  if (!card) return { error: `unresolved: ${entry.name}` };
  const front = card.card_faces?.[0];
  const uris = pickUris(card.image_uris) ?? pickUris(front?.image_uris);
  if (!uris) return { error: `no image uris: ${entry.name}` };
  const back = card.card_faces?.[1];
  const backUris = pickUris(back?.image_uris);
  const name = card.name.includes(" // ") ? card.name.split(" // ")[0] : card.name;
  const definition = {
    name,
    count: entry.count,
    set: card.set,
    cardNumber: String(card.collector_number),
    // Presets keep the braces: "{2}{R}".
    manaCost: card.mana_cost ?? front?.mana_cost ?? "",
    colors: card.colors ?? front?.colors ?? [],
    colorIdentity: card.color_identity ?? [],
    cmc: card.cmc ?? 0,
    types: [],
    subtypes: [],
    supertypes: [],
    text: card.oracle_text ?? front?.oracle_text ?? "",
    layout: card.layout,
    power: card.power ?? front?.power,
    toughness: card.toughness ?? front?.toughness,
    uris,
  };
  // type_line split: keep supertypes/subtypes separate like the loader expects.
  // Split-face layouts carry "Front // Back" in type_line; presets describe the front face.
  const typeLine = (card.type_line ?? front?.type_line ?? "").split(" // ")[0];
  const [left, right] = typeLine.split(/\s+—\s+/);
  definition.types = left.split(/\s+/).filter(Boolean);
  if (right) definition.subtypes = right.split(/\s+/).filter(Boolean);
  definition.supertypes = definition.types.filter((t) =>
    ["Basic", "Legendary", "Snow", "World", "Ongoing", "Host", "Elite"].includes(t),
  );
  definition.types = definition.types.filter((t) => !definition.supertypes.includes(t));
  if (card.all_parts?.length) {
    definition.allParts = card.all_parts
      .filter((p) => PART_COMPONENTS.has(p.component))
      .map((p) => ({ name: p.name, component: p.component }));
    if (!definition.allParts.length) delete definition.allParts;
  }
  // Only true double-faced layouts have a physical back face; split / adventure /
  // aftermath faces are separate cards on the same piece of cardboard.
  if (back && backUris && ["transform", "modal_dfc", "meld"].includes(card.layout)) {
    definition.backFace = {
      name: back.name,
      manaCost: back.mana_cost ?? "",
      typeLine: back.type_line ?? "",
      oracleText: back.oracle_text ?? "",
      uris: backUris,
    };
  }
  if (definition.power == null) delete definition.power;
  if (definition.toughness == null) delete definition.toughness;
  return { card: definition, scryfall: card };
}

function colorClass(colorIdentity) {
  if (!colorIdentity?.length) return "text-gray-400";
  if (colorIdentity.length === 1) return COLOR_CLASS[colorIdentity[0]] ?? "text-gray-400";
  return "text-orange-400";
}

const files = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith(".dck"))
  .filter((f) => (ONLY ? ONLY.includes(f) : true))
  .sort();

const report = { decks: [], skipped: [], unresolved: {}, written: [], duplicateNames: [] };
const writable = [];

for (const file of files) {
  const text = fs.readFileSync(path.join(SRC, file), "utf8");
  const { meta, sections } = parseDck(text);
  const dckFormat = (meta.Format ?? "").toLowerCase();
  const format = FORMAT_MAP[dckFormat];
  if (FORMATS && !FORMATS.has(dckFormat)) continue;
  if (!format) {
    report.skipped.push({ file, reason: `format '${dckFormat}' has no phase_mana equivalent` });
    continue;
  }
  const commanders = sections.get("commander") ?? [];
  const main = sections.get("main") ?? [];
  const sideboard = sections.get("sideboard") ?? [];
  const errors = [];
  const cards = [];
  let commanderName;
  // Commander decks must carry the commander inside `cards`: the loader moves it
  // into `commanders[]` and throws if it cannot find it.
  for (const entry of [...commanders, ...main]) {
    const result = toPresetCard(entry);
    if (result.error) {
      errors.push(result.error);
      report.unresolved[entry.name] = (report.unresolved[entry.name] ?? 0) + 1;
      continue;
    }
    if (REQUIRE_LEGAL && !["legal", "restricted"].includes(result.scryfall.legalities?.[format])) {
      errors.push(`not legal in ${format}: ${entry.name}`);
    }
    if (commanders.includes(entry) && commanderName === undefined) commanderName = result.card.name;
    cards.push(result.card);
  }
  const COMMANDER_FORMATS = new Set([
    "commander",
    "brawl",
    "oathbreaker",
    "duel_commander",
    "pauper_commander",
  ]);
  if (COMMANDER_FORMATS.has(format) && !commanderName) {
    errors.push("commander deck without a [Commander] entry");
  }
  const side = [];
  for (const entry of sideboard) {
    const result = toPresetCard(entry);
    if (result.error) {
      errors.push(result.error);
      report.unresolved[entry.name] = (report.unresolved[entry.name] ?? 0) + 1;
      continue;
    }
    if (REQUIRE_LEGAL && !["legal", "restricted"].includes(result.scryfall.legalities?.[format])) {
      errors.push(`not legal in ${format}: ${entry.name}`);
    }
    side.push(result.card);
  }
  const totalCards = cards.reduce((n, c) => n + c.count, 0);
  if (REQUIRE_LEGAL) {
    if ([...main, ...sideboard, ...commanders].some((entry) => !Number.isInteger(entry.count) || entry.count <= 0)) {
      errors.push("invalid card count");
    }
    if (format === "commander") {
      if (totalCards !== 100) errors.push(`commander requires 100 cards, got ${totalCards}`);
      // The preset schema currently only supports one commander.
      if (commanders.length !== 1) errors.push("preset loader requires exactly one commander");
    } else if (totalCards < 60) errors.push(`main deck below 60 cards: ${totalCards}`);
    if (side.reduce((n, c) => n + c.count, 0) > 15) errors.push("sideboard exceeds 15 cards");
    const totals = new Map();
    for (const entry of [...commanders, ...main, ...sideboard]) {
      const resolved = resolveCard(entry);
      if (!resolved) continue;
      const previous = totals.get(resolved.name);
      totals.set(resolved.name, { card: resolved, count: (previous?.count ?? 0) + entry.count });
    }
    const commanderIdentity = new Set(cards.find((card) => card.name === commanderName)?.colorIdentity ?? []);
    for (const { card, count } of totals.values()) {
      const basic = /\bBasic\b/.test(card.type_line ?? "");
      const text = card.oracle_text ?? card.card_faces?.[0]?.oracle_text ?? "";
      const unlimited = /deck can have any number of cards named/i.test(text);
      const exception = /deck can have up to (\w+) cards named/i.exec(text)?.[1];
      const wordCounts = { seven: 7, nine: 9 };
      const max = basic || unlimited ? Infinity : exception ? (wordCounts[exception] ?? Number(exception)) : format === "commander" ? 1 : 4;
      if (count > max) errors.push(`too many copies: ${count} ${card.name} (max ${max})`);
      if (card.legalities?.[format] === "restricted" && count > 1) errors.push(`restricted card has ${count} copies: ${card.name}`);
      if (format === "commander" && (card.color_identity ?? []).some((color) => !commanderIdentity.has(color))) {
        errors.push(`outside commander color identity: ${card.name}`);
      }
    }
  }
  const colorIdentity = [
    ...new Set(cards.flatMap((c) => c.colorIdentity ?? [])),
  ].filter((c) => "WUBRG".includes(c));
  const id = `${ID_PREFIX}_${file.replace(/\.dck$/, "").replace(/[^a-zA-Z0-9]+/g, "_")}`;
  const deck = {
    id,
    label: meta.Name ?? file.replace(/\.dck$/, ""),
    desc: [meta.Description, meta.Event, meta.Place ? `#${meta.Place}` : "", meta.Author, meta.Retrieved]
      .filter(Boolean)
      .join(" · "),
    color: colorClass(colorIdentity),
    format,
    ...(commanderName ? { commander: commanderName } : {}),
    source: meta.SourceURL ?? meta.Source,
    ...(meta.Budget === "true" ? { budget: true } : {}),
    file,
    totalCards,
    sideboardSize: side.reduce((n, c) => n + c.count, 0),
    errors,
    cards,
    side,
  };
  report.decks.push({
    id,
    file,
    label: deck.label,
    format,
    dckFormat,
    totalCards,
    sideboard: deck.sideboardSize,
    errors: errors.length,
    errorDetails: errors,
  });
  if (!errors.length) writable.push(deck);
}

const byFormat = {};
for (const d of report.decks) byFormat[d.format] = (byFormat[d.format] ?? 0) + 1;

if (!WRITE) {
  console.log(`scanned ${report.decks.length + report.skipped.length} decks in ${SRC}`);
  console.log("formats:", JSON.stringify(byFormat));
  console.log(`fully resolvable: ${writable.length}`);
  console.log(`skipped (no phase_mana format): ${report.skipped.length}`);
  console.log(`unresolved card names: ${Object.keys(report.unresolved).length}`);
  const top = Object.entries(report.unresolved).sort((a, b) => b[1] - a[1]).slice(0, 25);
  if (top.length) console.log(top.map(([n, c]) => `  ${c}x ${n}`).join("\n"));
  for (const s of report.skipped.slice(0, 40)) console.log(`  skip ${s.file}: ${s.reason}`);
  fs.writeFileSync(
    REPORT_FILE,
    JSON.stringify(report, null, 1),
  );
  process.exit(0);
}

const indexFile = path.join(OUT, "index.json");
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : [];
fs.mkdirSync(OUT, { recursive: true });
const nameKey = (name) => name.normalize("NFKC").trim().toLowerCase();
const indexedNames = new Map(index.map((id) => {
  const deck = JSON.parse(fs.readFileSync(path.join(OUT, `${id}.json`), "utf8"));
  return [nameKey(deck.label), id];
}));
const selected = LIMIT ? writable.slice(0, LIMIT) : writable;
for (const deck of selected) {
  const existing = indexedNames.get(nameKey(deck.label));
  if (existing && existing !== deck.id) {
    report.duplicateNames.push({ id: deck.id, label: deck.label, existing });
    console.log(`skip  ${deck.id}: name already indexed as ${existing}`);
    continue;
  }
  const { id, cards, side, file, totalCards, sideboardSize, errors, ...definition } = deck;
  const target = path.join(OUT, `${id}.json`);
  if (fs.existsSync(target) && !FORCE) {
    console.log(`keep  ${id}.json (exists; --force to overwrite)`);
    continue;
  }
  fs.writeFileSync(
    target,
    `${JSON.stringify({ ...definition, ...(side.length ? { sideboard: side } : {}), cards }, null, 1)}\n`,
  );
  if (!index.includes(id)) index.push(id);
  indexedNames.set(nameKey(deck.label), id);
  report.written.push(id);
  console.log(`write ${id}.json  cards=${totalCards} side=${sideboardSize}`);
}
fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
console.log(`index.json now lists ${index.length} presets`);
console.log(`skipped ${report.skipped.length} decks (unsupported format); ${errors0()} decks had unresolved cards`);
function errors0() {
  return report.decks.filter((d) => d.errors).length;
}
