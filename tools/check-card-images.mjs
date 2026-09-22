// Run: node tools/check-card-images.mjs. Isolated config/library; no running app required.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = await mkdtemp(resolve(tmpdir(), "phase-art-check-"));
const { PHASE_MANA_CARD_IMAGES: ignored, ...env } = process.env;
let server;
let base;
async function start() {
  server = spawn(process.execPath, [resolve(root, "node_modules/vite/bin/vite.js"), "preview", "--config", resolve(root, "vite.config.ts"), "--port", "0"], { cwd: temp, env, stdio: ["ignore", "pipe", "pipe"] });
  base = await new Promise((accept, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(log)), 15000);
    server.once("exit", () => { clearTimeout(timer); reject(new Error(log)); });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => {
      log += data;
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(log);
      if (match) { clearTimeout(timer); accept(match[0]); }
    });
  });
}
async function stop() {
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill();
    await exited;
  }
}
const config = () => fetch(`${base}/card-images-config`).then((r) => r.json());
const save = (dir, origin = base) => fetch(`${base}/card-images-config`, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ dir }),
});
try {
  await mkdir(resolve(temp, "dist"));
  await writeFile(resolve(temp, "lingui.config.js"), 'module.exports = { locales: ["en"], sourceLocale: "en", catalogs: [] };');
  const library = resolve(temp, "图库 with spaces");
  await mkdir(resolve(library, "f"), { recursive: true });
  await writeFile(resolve(library, "f/forest.full.webp"), "test-image");
  await writeFile(resolve(library, "f/front_face_only.full.webp"), "front-face");
  await start();
  assert.equal((await save(library, "https://untrusted.example")).status, 403);
  assert.equal((await fetch(`${base}/card-images-config/browse`, { method: "POST" })).status, 415);
  assert.equal((await save(library)).status, 200);
  assert.equal((await config()).count, 2);  assert.equal((await save(resolve(temp, "missing"))).status, 400);
  assert.equal((await config()).dir, library);
  assert.equal((await save(123)).status, 400);
  const image = await fetch(`${base}/card-images/f/forest.full.webp`);
  assert.equal(image.headers.get("cache-control"), "no-store");
  assert.equal(await image.text(), "test-image");
  assert.equal((await fetch(`${base}/card-images/..%2f..%2foutside.webp`)).status, 404);
  // A multi-face card the pack filed per-face: the first spelling misses, `alt` hits.
  const alt = await fetch(`${base}/card-images/f/both_faces.full.webp?name=Front&alt=${encodeURIComponent("/card-images/f/front_face_only.full.webp")}`);
  assert.equal(alt.status, 200);
  assert.equal(await alt.text(), "front-face");
  assert.equal((await fetch(`${base}/card-images/f/both_faces.full.webp?alt=${encodeURIComponent("/card-images/../../outside.webp")}`)).status, 404);
  assert.equal((await fetch(`${base}/card-images/f/both_faces.full.webp?alt=${encodeURIComponent("https://evil.example/x.webp")}`)).status, 404);
  await stop();
  await start();
  assert.equal((await config()).dir, library, "saved choice survives restart");
  await rm(resolve(temp, "card-images.config.json"));
  await mkdir(resolve(temp, "card-images.config.json"));
  assert.equal((await save(temp)).status, 500, "write failure must not claim success");
  assert.equal((await config()).dir, library, "failed save preserves active library");
  console.log("Card-image GUI API checks passed.");
} finally {
  await stop();
  await rm(temp, { recursive: true, force: true });
}
