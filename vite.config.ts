import { execFile } from "node:child_process";
import { createReadStream, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { IncomingMessage } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import Icons from "unplugin-icons/vite";

const api = { target: "http://127.0.0.1:3001" };
// `manaSymbolUrl()` requests `/scryfall-symbols/*.svg` on the web platform, and
// the mana-symbol cache decodes the response body as SVG. Without this the
// default configuration falls back to a generic glyph.
const symbols = {
  target: "https://svgs.scryfall.io",
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/scryfall-symbols/, "/card-symbols"),
};
// `platformFetch` rewrites Scryfall to `${hub}/api/scryfall`, and dev's hub path
// is `/hub-api`. Without this proxy every card lookup 404s, which is what left
// the board drawing name plates.
const scryfall = {
  target: "https://api.scryfall.com",
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/hub-api\/api\/scryfall/, ""),
};
const proxy = {
  "/api": api,
  "/scryfall-symbols": symbols,
  "/hub-api/api/scryfall": scryfall,
};

/**
 * The local card-image library, laid out like Forge's `cardsfolder`:
 * `<letter>/<forge stem>.full.webp`.
 *
 * A miss answers from Scryfall: the `?fallback=` url the client already has,
 * or — when there is no Scryfall record to hand — the `?name=` lookup below.
 * Either way the library is preferred and a card it lacks still renders.
 */
const CARD_IMAGES_CONFIG_FILE = resolve("card-images.config.json");
const DEFAULT_CARD_IMAGES_DIR = resolve("card-images");
const CARD_IMAGE_EXTENSIONS = /\.(webp|png|jpe?g)$/i;

/** `PHASE_MANA_CARD_IMAGES` wins, then the folder chosen in the UI, then the default. */
function configuredCardImagesDir(): string {
  if (process.env.PHASE_MANA_CARD_IMAGES) return resolve(process.env.PHASE_MANA_CARD_IMAGES);
  try {
    const saved = JSON.parse(readFileSync(CARD_IMAGES_CONFIG_FILE, "utf8")) as { dir?: unknown };
    if (typeof saved.dir === "string" && saved.dir.trim()) return resolve(saved.dir.trim());
  } catch {
    // No saved choice yet, or a hand-edited file: the default applies.
  }
  return DEFAULT_CARD_IMAGES_DIR;
}
let cardImagesDir = configuredCardImagesDir();

interface CardImagesStatus {
  dir: string;
  exists: boolean;
  count: number;
  /** True when `PHASE_MANA_CARD_IMAGES` pins the folder and the UI cannot change it. */
  fromEnv: boolean;
}

/** Cached: the launch screen asks for this on every mount, and the scan is recursive. */
let cardImagesStatusCache: CardImagesStatus | null = null;
function cardImagesStatus(): CardImagesStatus {
  if (cardImagesStatusCache?.dir === cardImagesDir) return cardImagesStatusCache;
  let exists = false;
  let count = 0;
  try {
    exists = statSync(cardImagesDir).isDirectory();
    if (exists) {
      for (const entry of readdirSync(cardImagesDir, { recursive: true, withFileTypes: true })) {
        if (entry.isFile() && CARD_IMAGE_EXTENSIONS.test(entry.name)) count += 1;
      }
    }
  } catch {
    exists = false;
  }
  cardImagesStatusCache = { dir: cardImagesDir, exists, count, fromEnv: !!process.env.PHASE_MANA_CARD_IMAGES };
  return cardImagesStatusCache;
}

/** Opens the OS folder picker on the machine running this dev server. */
function pickCardImagesFolder(): Promise<string | null> {
  const [command, args]: [string, string[]] =
    process.platform === "win32"
      ? ["powershell.exe", ["-NoProfile", "-STA", "-Command", [
          "$ErrorActionPreference = 'Stop'",
          "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()",
          "Add-Type -AssemblyName System.Windows.Forms",
          "$d = New-Object System.Windows.Forms.FolderBrowserDialog",
          "$d.Description = 'Select the card image library'",
          "if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }",
        ].join("; ")]]
      : process.platform === "darwin"
        ? ["osascript", ["-e", 'POSIX path of (choose folder with prompt "Select the card image library")']]
        : ["zenity", ["--file-selection", "--directory", "--title=Select the card image library"]];
  return new Promise((settle, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error && !(process.platform === "linux" && error.code === 1) && !stderr.includes("(-128)")) {
        reject(error);
        return;
      }
      settle(stdout.trim() || null);
    });
  });
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((settle) => {
    let raw = "";
    req.on("error", () => settle(null));
    req.on("aborted", () => settle(null));
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 16384) {
        settle(null);
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        settle(JSON.parse(raw || "{}"));
      } catch {
        settle(null);
      }
    });
  });
}

const CARD_IMAGE_MIME: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const CARD_ART_FALLBACK_HOSTS = new Set(["cards.scryfall.io", "backs.scryfall.io"]);

/** `?name=` lookups, so a deck's worth of misses costs one request each. */
const scryfallImageByName = new Map<string, Promise<string | null>>();
function scryfallImageFor(name: string): Promise<string | null> {
  const pending = scryfallImageByName.get(name);
  if (pending) return pending;
  const lookup = (async () => {
    try {
      const response = await fetch(
        `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`,
        // Scryfall rejects a generic User-Agent with a 400; a browser fetch
        // sends its own, a Node one does not.
        { headers: { Accept: "application/json", "User-Agent": "phase-mana/0.1.0" } },
      );
      if (!response.ok) return null;
      const card = (await response.json()) as {
        image_uris?: { normal?: string };
        card_faces?: { image_uris?: { normal?: string } }[];
      };
      return card.image_uris?.normal ?? card.card_faces?.[0]?.image_uris?.normal ?? null;
    } catch {
      return null;
    }
  })();
  scryfallImageByName.set(name, lookup);
  // A failure must not stick for the session: only a hit is worth remembering.
  void lookup.then((url) => {
    if (!url) scryfallImageByName.delete(name);
  });
  return lookup;
}

async function cardArtFallback(url: URL): Promise<string | null> {
  const fallback = url.searchParams.get("fallback");
  if (fallback) {
    const host = URL.canParse(fallback) ? new URL(fallback).hostname : "";
    return CARD_ART_FALLBACK_HOSTS.has(host) ? fallback : null;
  }
  const name = url.searchParams.get("name");
  return name ? await scryfallImageFor(name) : null;
}

function cardImagesPlugin(): Plugin {
  /** Backs the launch screen's "card image library" control. */
  const configHandler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const isBrowse = url.pathname === "/card-images-config/browse";
    if (url.pathname !== "/card-images-config" && !isBrowse) return next();
    const send = (status: number, body: unknown) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
    };
    // Do not let another website read local paths, change settings, or open dialogs.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
      return send(403, { error: "Cross-origin request denied" });
    }
    if (url.pathname === "/card-images-config" && (req.method === "GET" || req.method === "HEAD")) {
      return send(200, cardImagesStatus());
    }
    if (req.method !== "POST") return send(405, { error: "POST required" });
    if (req.headers["content-type"] !== "application/json") return send(415, { error: "JSON required" });
    if (process.env.PHASE_MANA_CARD_IMAGES) return send(409, { error: "Pinned by PHASE_MANA_CARD_IMAGES" });
    if (isBrowse) {
      void pickCardImagesFolder().then(
        (dir) => send(200, dir ? { dir } : { cancelled: true }),
        () => send(500, { error: "picker_failed" }),
      );
      return;
    }
    void readJsonBody(req).then((body) => {
      const dir = (body as { dir?: unknown } | null)?.dir;
      if (typeof dir !== "string" || !dir.trim()) return send(400, { error: "dir required" });
      const selectedDir = resolve(dir.trim());
      try {
        if (!statSync(selectedDir).isDirectory()) throw new Error("Not a directory");
      } catch {
        return send(400, { error: "folder_missing" });
      }
      try {
        writeFileSync(`${CARD_IMAGES_CONFIG_FILE}.tmp`, `${JSON.stringify({ dir: selectedDir }, null, 2)}\n`);
        renameSync(`${CARD_IMAGES_CONFIG_FILE}.tmp`, CARD_IMAGES_CONFIG_FILE);
      } catch {
        return send(500, { error: "save_failed" });
      }
      cardImagesDir = selectedDir;
      cardImagesStatusCache = null;
      const status = cardImagesStatus();
      console.log(
        `[card-images] library → ${status.dir} (${status.exists ? `${status.count} images` : "not found"})`,
      );
      send(200, status);
    });
  };

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/card-images/")) return next();

    // The pack may spell a multi-face card's file either way; the client sends
    // the other spellings as `alt` paths. Only library-relative paths count.
    const relativePaths = [url.pathname.slice("/card-images/".length)];
    for (const alternate of url.searchParams.getAll("alt")) {
      if (alternate.startsWith("/card-images/")) {
        relativePaths.push(alternate.slice("/card-images/".length));
      }
    }

    let file: string | null = null;
    for (const relative of relativePaths) {
      try {
        const candidate = resolve(cardImagesDir, decodeURIComponent(relative));
        if (candidate.startsWith(cardImagesDir + sep) && statSync(candidate).isFile()) {
          file = candidate;
          break;
        }
      } catch {
        // Missing, unreadable, or a traversal attempt: try the next spelling.
      }
    }

    if (file) {
      res.setHeader(
        "Content-Type",
        CARD_IMAGE_MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      );
      res.setHeader("Cache-Control", "no-store");
      createReadStream(file).on("error", (error) => res.destroy(error)).pipe(res);
      return;
    }

    void cardArtFallback(url).then(
      (location) => {
        if (location) {
          res.statusCode = 302;
          res.setHeader("Location", location);
        } else {
          res.statusCode = 404;
        }
        res.end();
      },
      (error: unknown) => next(error as Error),
    );
  };
  return {
    name: "phase-mana-card-images",
    configureServer: (server) => {
      server.middlewares.use(configHandler);
      server.middlewares.use(handler);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(configHandler);
      server.middlewares.use(handler);
    },
    configResolved: () => {
      const status = cardImagesStatus();
      if (!status.exists) {
        console.warn(
          `[card-images] no library at ${status.dir} — choose one on the launch screen, or set PHASE_MANA_CARD_IMAGES`,
        );
      }
    },
  };
}

const SCRYFALL_DB_PATH = resolve("data/scryfall.db");

function readRequestBody(req: IncomingMessage, maxBytes = 524288): Promise<unknown> {
  return new Promise((settle) => {
    let raw = "";
    req.on("error", () => settle(null));
    req.on("aborted", () => settle(null));
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        settle(null);
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        settle(JSON.parse(raw || "{}"));
      } catch {
        settle(null);
      }
    });
  });
}

function localScryfallPlugin(): Plugin {
  let db: DatabaseSync | null = null;
  let selectBySetCn: any = null;
  let selectByName: any = null;
  let selectById: any = null;

  try {
    if (existsSync(SCRYFALL_DB_PATH)) {
      db = new DatabaseSync(SCRYFALL_DB_PATH, { readOnly: true });
      selectBySetCn = db.prepare(
        "SELECT json FROM cards WHERE set_code = ? AND collector_number = ? LIMIT 1",
      );
      selectByName = db.prepare(
        "SELECT json FROM cards WHERE name = ? COLLATE NOCASE LIMIT 1",
      );
      selectById = db.prepare("SELECT json FROM cards WHERE id = ? LIMIT 1");
      console.log(`[local-scryfall] Offline card database loaded from ${SCRYFALL_DB_PATH}`);
    }
  } catch (err) {
    console.warn("[local-scryfall] Could not open offline database:", err);
  }

  const handler: Connect.NextHandleFunction = (req, res, next) => {
    if (!db || !req.url?.startsWith("/hub-api/api/scryfall")) return next();

    const parsedUrl = new URL(req.url, "http://localhost");
    const subpath = parsedUrl.pathname.replace(/^\/hub-api\/api\/scryfall/, "");

    // 1. POST /cards/collection
    if (subpath === "/cards/collection" && req.method === "POST") {
      void readRequestBody(req).then((body) => {
        const identifiers = (body as { identifiers?: any[] })?.identifiers;
        if (!Array.isArray(identifiers)) return next();

        const data: any[] = [];
        const notFound: any[] = [];

        for (const id of identifiers) {
          let row: any = null;
          if (id.set && id.collector_number) {
            row = selectBySetCn.get(String(id.set).toLowerCase(), String(id.collector_number));
          }
          if (!row && id.name) {
            row = selectByName.get(String(id.name));
          }
          if (!row && id.id) {
            row = selectById.get(String(id.id));
          }

          if (row) {
            try {
              data.push(JSON.parse(row.json));
            } catch {
              notFound.push(id);
            }
          } else {
            notFound.push(id);
          }
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ object: "list", not_found: notFound, data }));
      });
      return;
    }

    // 2. GET /cards/named
    if (subpath === "/cards/named" && req.method === "GET") {
      const name = parsedUrl.searchParams.get("exact") || parsedUrl.searchParams.get("fuzzy");
      if (name) {
        const row: any = selectByName.get(name);
        if (row) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(row.json);
          return;
        }
      }
    }

    // 3. GET /cards/:set/:number
    const setNumMatch = subpath.match(/^\/cards\/([a-zA-Z0-9]+)\/([a-zA-Z0-9_\-]+)$/);
    if (setNumMatch && req.method === "GET") {
      const [, setCode, collectorNumber] = setNumMatch;
      const row: any = selectBySetCn.get(setCode.toLowerCase(), collectorNumber);
      if (row) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(row.json);
        return;
      }
    }

    // 4. GET /cards/:id
    const idMatch = subpath.match(/^\/cards\/([0-9a-fA-F\-]{36})$/);
    if (idMatch && req.method === "GET") {
      const [, id] = idMatch;
      const row: any = selectById.get(id);
      if (row) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(row.json);
        return;
      }
    }

    next();
  };

  return {
    name: "phase-mana-local-scryfall",
    configureServer: (server) => {
      server.middlewares.use(handler);
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [
    react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }),
    lingui(),
    tailwindcss(),
    Icons({ compiler: "raw" }),
    cardImagesPlugin(),
    localScryfallPlugin(),
  ],
  // One entry point: the ManaBrew shell (`index.html` → `ui/main.tsx`), whose
  // routes live in the URL fragment. This block is the vite default; it is
  // written out because the file list used to name a second entry.
  build: {
    rollupOptions: {
      input: { main: fileURLToPath(new URL("./index.html", import.meta.url)) },
    },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./ui", import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify("phase-mana-0.1.0") },
  server: { host: "127.0.0.1", port: 1420, strictPort: true, proxy, watch: { ignored: ["**/target/**", "**/card-images/**", "**/data/**"] } },
  preview: { host: "127.0.0.1", port: 1420, strictPort: true, proxy },
});
