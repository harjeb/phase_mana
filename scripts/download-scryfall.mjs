import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { mkdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_PATH = resolve("data/scryfall.db");
const USER_AGENT = "phase-mana/0.1.0";

async function main() {
  console.log("Fetching Scryfall bulk data metadata...");
  const bulkRes = await fetch("https://api.scryfall.com/bulk-data", {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!bulkRes.ok) {
    throw new Error(`Failed to query Scryfall bulk data: HTTP ${bulkRes.status}`);
  }

  const bulkJson = await bulkRes.json();
  const defaultCards = bulkJson.data?.find((item) => item.type === "default_cards");
  if (!defaultCards || !defaultCards.jsonl_download_uri) {
    throw new Error("Could not find default_cards bulk item from Scryfall");
  }

  const downloadUrl = defaultCards.jsonl_download_uri;
  const compressedMB = ((defaultCards.compressed_size || 0) / 1024 / 1024).toFixed(1);
  console.log(`Target: ${defaultCards.name} (${compressedMB} MB compressed)`);
  console.log(`URL: ${downloadUrl}`);

  mkdirSync(dirname(DB_PATH), { recursive: true });

  const tempDbPath = `${DB_PATH}.tmp`;
  if (existsSync(tempDbPath)) unlinkSync(tempDbPath);

  const db = new DatabaseSync(tempDbPath);
  db.exec("PRAGMA synchronous = OFF;");
  db.exec("PRAGMA journal_mode = MEMORY;");
  db.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      name TEXT,
      set_code TEXT,
      collector_number TEXT,
      json TEXT
    );
  `);

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO cards (id, name, set_code, collector_number, json)
    VALUES (?, ?, ?, ?, ?)
  `);

  console.log("Downloading and processing cards stream...");
  const response = await fetch(downloadUrl, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  // Convert Web ReadableStream to Node.js Readable stream
  const { Readable } = await import("node:stream");
  const nodeStream = Readable.fromWeb(response.body);
  const gunzip = createGunzip();
  const rl = createInterface({
    input: nodeStream.pipe(gunzip),
    crlfDelay: Infinity,
  });

  let count = 0;
  db.exec("BEGIN TRANSACTION;");

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const card = JSON.parse(line);
      const setCode = (card.set || "").toLowerCase();
      const cn = String(card.collector_number || "");
      insertStmt.run(card.id, card.name, setCode, cn, line);
      count += 1;

      if (count % 5000 === 0) {
        db.exec("COMMIT;");
        db.exec("BEGIN TRANSACTION;");
        process.stdout.write(`\rImported ${count} cards...`);
      }
    } catch {
      // Ignore corrupted lines
    }
  }

  db.exec("COMMIT;");
  console.log(`\nImported ${count} cards total.`);

  console.log("Building indexes for instant lookups...");
  db.exec("CREATE INDEX idx_set_cn ON cards (set_code, collector_number);");
  db.exec("CREATE INDEX idx_name ON cards (name COLLATE NOCASE);");
  db.close();

  // Rename temp to target
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  const { renameSync } = await import("node:fs");
  renameSync(tempDbPath, DB_PATH);

  console.log(`Successfully saved Scryfall offline database to ${DB_PATH}`);
}

main().catch((err) => {
  console.error("Error downloading Scryfall data:", err);
  process.exit(1);
});
