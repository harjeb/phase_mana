import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SFX_IDS } from "./sfxCatalog";
import { SfxPlayer } from "./sfxPlayer";

vi.mock("virtual:sfx-data", async () => {
  const { SFX_FILES } = await import("./sfxCatalog");
  return { default: Object.fromEntries(Object.values(SFX_FILES).map((name) => [name, "AAAA"])) };
});

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
  // Let the fire-and-forget decode of every effect settle.
  await vi.waitFor(() => {
    expect(FakeAudioContext.instances[0].decodeAudioData).toHaveBeenCalledTimes(SFX_IDS.length);
  });
  await Promise.resolve();
  return { player, ctx: FakeAudioContext.instances[0] };
}

describe("SfxPlayer", () => {
  beforeEach(() => {
    FakeAudioContext.instances = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    // Download managers intercept audio requests, so the effects must not make any.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("sound effects must not be fetched");
      }),
    );
    vi.spyOn(performance, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("decodes every effect from the bundle without a network request", async () => {
    await readyPlayer();
    expect(fetch).not.toHaveBeenCalled();
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

  it("survives an effect that fails to decode", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => undefined);
    const player = new SfxPlayer();
    player.init();
    const ctx = FakeAudioContext.instances[0];
    ctx.decodeAudioData.mockRejectedValue(new DOMException("bad data", "EncodingError"));
    await vi.waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalledTimes(SFX_IDS.length));
    expect(() => player.play("cardDraw")).not.toThrow();
    expect(ctx.sources).toHaveLength(0);
  });
});
