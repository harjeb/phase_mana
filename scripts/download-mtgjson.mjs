// Download the MTGJSON bulk exports that scripts/fetch-limited-pools.sh needs.
//
// The shell script uses curl, but in some sandboxed environments only Node's
// undici fetch can reach the network. This mirrors the two curl calls in that
// script so the rest of the pipeline (lzma extraction, draft-pool-gen) can run
// unchanged.
//
// Usage:
//   node scripts/download-mtgjson.mjs [--all]
//
//   --all (default)  AllPrintings.json.xz  ~94 MB  -> data/mtgjson/AllPrintings.json.xz
//   SetList.json always ~11 MB -> data/mtgjson/SetList.json
import { createWriteStream, mkdirSync, statSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";

const DATA = resolve("data/mtgjson");
// The engine's default DB path, i.e. ../phase/data/mtgjson/AtomicCards.json.
const PHASE = resolve(process.env.PHASE_REPO || "../phase");
const CARDS_OUT = resolve(PHASE, "data/mtgjson/AtomicCards.json");
mkdirSync(DATA, { recursive: true });
mkdirSync(resolve(CARDS_OUT, ".."), { recursive: true });

const targets = [
  {
    url: "https://mtgjson.com/api/v5/AllPrintings.json.xz",
    out: resolve(DATA, "AllPrintings.json.xz"),
    label: "AllPrintings.json.xz",
  },
  {
    url: "https://mtgjson.com/api/v5/SetList.json",
    out: resolve(DATA, "SetList.json"),
    label: "SetList.json",
  },
  {
    url: "https://mtgjson.com/api/v5/AtomicCards.json.gz",
    out: CARDS_OUT,
    label: "AtomicCards.json (engine DB)",
    gunzip: true,
  },
];

async function download({ url, out, label, gunzip }) {
  if (existsSync(out) && statSync(out).size > 0) {
    console.log(`[skip] ${label} already present (${statSync(out).size} bytes): ${out}`);
    return;
  }
  const tmp = `${out}.part`;
  console.log(`[get ] ${label} <- ${url}`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get("content-length") || 0);
  let seen = 0;
  let last = 0;
  const body = Readable.fromWeb(res.body);
  body.on("data", (chunk) => {
    seen += chunk.length;
    if (seen - last > 4 * 1024 * 1024) {
      last = seen;
      const pct = total ? ((seen / total) * 100).toFixed(1) + "%" : "";
      process.stdout.write(`\r       ${(seen / 1048576).toFixed(1)} MB ${pct}   `);
    }
  });
  if (gunzip) {
    await pipeline(body, createGunzip(), createWriteStream(tmp));
  } else {
    await pipeline(body, createWriteStream(tmp));
  }
  const { renameSync } = await import("node:fs");
  renameSync(tmp, out);
  const mb = (statSync(out).size / 1048576).toFixed(1);
  console.log(`\r[done] ${label} ${mb} MB -> ${out}                    `);
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all") || args.length === 0;
  for (const t of targets) {
    if (!all && t.label === "AllPrintings.json.xz") continue;
    await download(t);
  }
}

main().catch((err) => {
  console.error("\nDownload failed:", err.message);
  process.exit(1);
});
