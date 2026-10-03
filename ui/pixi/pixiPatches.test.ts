import { describe, expect, it } from "vitest";
import { TexturePool } from "pixi.js";
import { installPixiPatches } from "./pixiPatches";

describe("installPixiPatches", () => {
  it("lets a returned render texture be reused", () => {
    installPixiPatches();
    const first = TexturePool.getOptimalTexture({ width: 300, height: 150 });
    TexturePool.returnTexture(first);
    const second = TexturePool.getOptimalTexture({ width: 300, height: 150 });
    // A dropped return made every filter pass allocate a new render target,
    // which never freed its GPU memory.
    expect(second).toBe(first);
    TexturePool.returnTexture(second);
  });
});
