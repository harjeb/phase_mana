import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: "tauri",
  invoke: vi.fn(),
  platformFetch: vi.fn(),
  lanArtUrl: vi.fn(),
}));
vi.mock("@/platform", () => ({
  getPlatformType: () => mocks.platform,
  getPlatform: () => ({ invoke: mocks.invoke }),
}));
vi.mock("@/lib/platformFetch", () => ({ platformFetch: mocks.platformFetch }));
vi.mock("@/lib/lanCache", () => ({ lanArtUrl: mocks.lanArtUrl }));

const cdn = "https://cards.scryfall.io/normal/front/a/b/card.jpg?123";
const image = () => new Response("image bytes", { headers: { "content-type": "image/jpeg" } });
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.platform = "tauri";
  mocks.invoke.mockResolvedValue(true);
  mocks.lanArtUrl.mockReturnValue(null);
  mocks.platformFetch.mockImplementation(async () => image());
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:card");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Scryfall image cache fallback", () => {
  it("goes directly to Scryfall when no local route or LAN library is available", async () => {
    mocks.invoke.mockResolvedValue(false);
    const { loadScryfallImage } = await import("@/lib/scryfallImageSource");
    expect(await loadScryfallImage(cdn)).toBe("blob:card");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.platformFetch).toHaveBeenCalledWith(cdn, { cache: "reload" });
  });

  it.each([
    [404, "text/plain"],
    [200, "text/html"],
    [200, "application/json"],
  ])("does not turn a %s %s cache miss into a cached JPEG", async (status, type) => {
    fetchMock.mockResolvedValue(new Response("not an image", { status, headers: { "content-type": type } }));
    const { loadScryfallImage } = await import("@/lib/scryfallImageSource");
    expect(await loadScryfallImage(cdn)).toBe("blob:card");
    expect(fetchMock).toHaveBeenCalledWith("/scryfall-img/normal/front/a/b/card.jpg");
    expect(mocks.platformFetch).toHaveBeenCalledOnce();
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(await blob.text()).toBe("image bytes");
  });

  it("keeps valid local art local and deduplicates repeat loads", async () => {
    fetchMock.mockResolvedValue(image());
    const { loadScryfallImage } = await import("@/lib/scryfallImageSource");
    await Promise.all([loadScryfallImage(cdn), loadScryfallImage(cdn)]);
    await loadScryfallImage(cdn);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(mocks.platformFetch).not.toHaveBeenCalled();
  });

  it("skips a LAN SPA response and reads the CDN on web too", async () => {
    mocks.platform = "web";
    mocks.lanArtUrl.mockReturnValue("http://peer/scryfall-img/card.jpg");
    fetchMock.mockResolvedValue(new Response("<html></html>", { headers: { "content-type": "text/html" } }));
    const { loadScryfallImage } = await import("@/lib/scryfallImageSource");
    await loadScryfallImage(cdn);
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.platformFetch).toHaveBeenCalledOnce();
  });
});
