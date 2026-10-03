import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const ID = "virtual:sfx-data";
const RESOLVED_ID = `\0${ID}`;

/**
 * Serves every `.m4a` in `dir` as `virtual:sfx-data`: a JS module whose default
 * export maps file name to base64. Download managers (IDM) capture `.m4a` and
 * `audio/*` responses, pop a "download failed" dialog and cancel the page's
 * own request, so the effects must never be fetched as audio URLs. This module
 * is requested as `/@id/__x00__virtual:sfx-data` in dev and as a hashed `.js`
 * chunk in a build — neither looks like media.
 */
export function sfxDataPlugin(dir: string): Plugin {
  return {
    name: "phase-mana-sfx-data",
    resolveId(id) {
      return id === ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined;
      const files: Record<string, string> = {};
      for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".m4a")).sort()) {
        const file = join(dir, name);
        this.addWatchFile(file);
        files[name] = readFileSync(file).toString("base64");
      }
      // Data has nothing to map; without this, dev embeds the base64 twice more.
      return { code: `export default ${JSON.stringify(files)};`, map: { mappings: "" } };
    },
  };
}
