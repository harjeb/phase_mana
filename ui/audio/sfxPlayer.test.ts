import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFX_FILES, SFX_IDS, sfxUrl } from "./sfxCatalog";
import { SfxPlayer } from "./sfxPlayer";

class FakeGain {
  gain = { value: 1 };
  connect = vi.fn();
  disconnect = vi.fn();
}

class FakeSource {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  disconnect = vi.fn();
  start = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: "running" | "suspended" = "running";
  destination = {};
  sources: FakeSource[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    return new FakeGain();
  }
  createBufferSource() {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  decodeAudioData = vi.fn(async () => ({ decoded: true }));
}

async function readyPlayer(): Promise<{ player: SfxPlayer; ctx: FakeAudioContext }> {
  const player = new SfxPlayer();
  player.init();
  // Let the fire-and-forget fetch + decode of every effect settle.
  await vi.waitFor(() => {
    expect(FakeAudioContext.instances[0].decodeAudioData).toHaveBeenCalledTimes(SFX_IDS.length);
  });
  await Promise.resolve();
  return { player, ctx: FakeAudioContext.instances[0] };
}

describe("sfx catalog", () => {
  it("serves every effect from /audio/sfx", () => {
    expect(SFX_IDS).toHaveLength(Object.keys(SFX_FILES).length);
    expect(sfxUrl("cardDraw")).toBe("/audio/sfx/sfx_card_draw_002.m4a");
  });
});

describe("SfxPlayer", () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("plays a decoded effect through the master gain", async () => {
    const { player, ctx } = await readyPlayer();
    player.configure({ enabled: true, volume: 0.5 });
    player.play("cardDraw", 0.8);
    expect(ctx.sources).toHaveLength(1);
    expect(ctx.sources[0].start).toHaveBeenCalledTimes(1);
  });

  it("stays silent when disabled or muted", async () => {
    const { player, ctx } = await readyPlayer();
    player.configure({ enabled: false, volume: 1 });
    player.play("cardDraw");
    player.configure({ enabled: true, volume: 0 });
    player.play("lifeGain");
    expect(ctx.sources).toHaveLength(0);
  });

  it("does not retrigger the same effect inside the repeat gap", async () => {
    const { player, ctx } = await readyPlayer();
    const now = vi.mocked(performance.now);
    player.play("lifeLoss");
    now.mockReturnValue(1020);
    player.play("lifeLoss");
    expect(ctx.sources).toHaveLength(1);
    now.mockReturnValue(1200);
    player.play("lifeLoss");
    expect(ctx.sources).toHaveLength(2);
  });

  it("drops sounds rather than queueing them while the context is suspended", async () => {
    const { player, ctx } = await readyPlayer();
    ctx.state = "suspended";
    ctx.resume = vi.fn(async () => undefined);
    player.play("cardDraw");
    expect(ctx.sources).toHaveLength(0);
    expect(ctx.resume).toHaveBeenCalled();
  });

  it("is a harmless no-op when the platform has no audio context", () => {
    vi.stubGlobal("AudioContext", undefined);
    const player = new SfxPlayer();
    expect(() => {
      player.init();
      player.play("cardDraw");
    }).not.toThrow();
  });

  it("survives an effect that fails to load", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const player = new SfxPlayer();
    player.init();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(SFX_IDS.length));
    expect(() => player.play("cardDraw")).not.toThrow();
    expect(FakeAudioContext.instances[0].sources).toHaveLength(0);
  });
});
