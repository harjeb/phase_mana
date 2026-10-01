import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Texture } from "pixi.js";
import { fetchImageElement } from "@/api/scryfall";
import { cardKey, useScryfallStore } from "./useScryfallStore";
import { withLocalCardArt } from "@/lib/localCardArt";
import type { DeckCard } from "@/protocol/deck";
import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";

vi.mock("pixi.js", () => ({
  ImageSource: class { destroyed = false; },
  Texture: class {
    static EMPTY = {};
    destroyed = false;
    source = { destroyed: false };
    destroy() { this.destroyed = true; }
  },
}));
vi.mock("@/api/scryfall", () => ({ fetchImageElement: vi.fn(), fetchSets: vi.fn() }));

const uris = (face: string): ScryfallImageUris => ({
  small: `https://images.test/${face}/small`,
  normal: `https://images.test/${face}/normal`,
  large: `https://images.test/${face}/large`,
  png: `https://images.test/${face}/png`,
  art_crop: `https://images.test/${face}/art`,
  border_crop: `https://images.test/${face}/full`,
});
const card = (): DeckCard => ({
  identity: { id: "test", name: "Front", setCode: "test", cardNumber: "1" },
  uris: uris("front"), color: "", colorIdentity: [], manaCost: "", cmc: 0,
  types: [], subtypes: [], supertypes: [], text: "",
});
const entry = (info: Partial<ScryfallCard>) => ({
  info: { name: "Front", layout: "normal", image_uris: uris("localized"), ...info } as ScryfallCard,
  texture: Texture.EMPTY, uris: uris("localized"),
});
const originalGetCard = useScryfallStore.getState().getCard;

beforeEach(() => {
  useScryfallStore.getState().clearImageCaches();
  useScryfallStore.setState({ cards: {}, locale: "zhs", getCard: originalGetCard });
  vi.mocked(fetchImageElement).mockReset().mockResolvedValue({} as HTMLImageElement);
});
afterEach(() => useScryfallStore.setState({ getCard: originalGetCard }));

describe("saved card textures", () => {
  it.each(["en", "zhs", "zht", "ja"] as const)("loads saved images in %s despite unavailable metadata", async (locale) => {
    const getCard = vi.fn().mockRejectedValue(new Error("card details unavailable"));
    useScryfallStore.setState({ locale, getCard });
    const saved = card();
    expect(await useScryfallStore.getState().getCardTexture(saved)).not.toBe(Texture.EMPTY);
    expect(fetchImageElement).toHaveBeenCalledWith(withLocalCardArt(saved.uris, "Front")!.border_crop);
    expect(getCard).not.toHaveBeenCalled();
  });

  it("does not wait for pending metadata", async () => {
    const pendingPromise = new Promise<ReturnType<typeof entry>>(() => {});
    const getCard = vi.fn().mockReturnValue(pendingPromise);
    const saved = card();
    useScryfallStore.setState({ getCard, cards: {
      [cardKey({ setCode: "test", collectorNumber: "1" })]: { pendingPromise },
    } });
    expect(await useScryfallStore.getState().getCardTexture(saved, "art")).not.toBe(Texture.EMPTY);
    expect(fetchImageElement).toHaveBeenCalledWith(saved.uris.art_crop);
    expect(getCard).not.toHaveBeenCalled();
  });

  it("prefers cached localized art without a metadata request", async () => {
    const getCard = vi.fn();
    useScryfallStore.setState({ locale: "ja", getCard, cards: {
      [cardKey({ setCode: "test", collectorNumber: "1" })]: { card: entry({}) },
    } });
    await useScryfallStore.getState().getCardTexture(card(), "art");
    expect(fetchImageElement).toHaveBeenCalledWith(uris("localized").art_crop);
    expect(getCard).not.toHaveBeenCalled();
  });

  it.each(["full", "art"] as const)("selects the stored back's %s variant", async (variant) => {
    const saved = { ...card(), layout: "transform", backFace: { name: "Back", uris: uris("back") } } as DeckCard;
    await useScryfallStore.getState().getCardTexture(saved, variant, 1);
    expect(fetchImageElement).toHaveBeenCalledWith(withLocalCardArt(saved.backFace!.uris, "Back")![variant === "art" ? "art_crop" : "border_crop"]);
  });

  it.each([true, false])("does not substitute front art for an absent back (back summary: %s)", async (summary) => {
    const saved = { ...card(), layout: "transform", ...(summary ? { backFace: { name: "Back" } } : {}) } as DeckCard;
    const getCard = vi.fn().mockResolvedValue(entry({ layout: "transform", image_uris: undefined,
      card_faces: [{ name: "Front", image_uris: uris("front") }, { name: "Back" }],
    }));
    useScryfallStore.setState({ getCard });
    expect(await useScryfallStore.getState().getCardTexture(saved, "full", 1)).toBe(Texture.EMPTY);
    expect(fetchImageElement).not.toHaveBeenCalled();
  });

  it("keeps the sole image of a record synthesized for a transformed name", async () => {
    const saved = card();
    saved.identity.name = "Back";
    saved.uris = uris("back");
    await useScryfallStore.getState().getCardTexture(saved, "art", 1);
    expect(fetchImageElement).toHaveBeenCalledWith(saved.uris.art_crop);
  });

  it("fetches metadata when the requested art variant is missing", async () => {
    const saved = card();
    saved.uris.art_crop = "";
    const getCard = vi.fn().mockResolvedValue(entry({}));
    useScryfallStore.setState({ getCard });
    await useScryfallStore.getState().getCardTexture(saved, "art");
    expect(getCard).toHaveBeenCalledOnce();
    expect(fetchImageElement).toHaveBeenCalledWith(uris("localized").art_crop);
  });
});
