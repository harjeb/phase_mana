import { describe, expect, it } from "vitest";
import { SFX_IDS, loadSfxBytes } from "./sfxCatalog";

describe("sfx catalog", () => {
  it("bundles every effect as real MP4 audio bytes", async () => {
    for (const id of SFX_IDS) {
      const bytes = new Uint8Array(await loadSfxBytes(id));
      // An MP4/M4A file opens with a box whose type is "ftyp".
      expect(String.fromCharCode(...bytes.subarray(4, 8)), id).toBe("ftyp");
    }
  });
});
