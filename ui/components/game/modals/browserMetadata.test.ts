import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAME_CARD_DEFAULTS } from "@/lib/gameCard";
import type { ScryfallCard } from "@/types/scryfall";
import { loadBrowserMetadata, peekBrowserMetadata } from "./browserMetadata";

const { getCard, cards } = vi.hoisted(() => ({ getCard: vi.fn(), cards: {} }));
vi.mock("@/stores/useScryfallStore", () => ({
  useScryfallStore: { getState: () => ({ getCard, cards }) },
  peekCard: (
    bucket: Record<string, { card: { info: unknown } }>,
    lookup: { name: string; setCode?: string },
  ) => bucket[lookup.setCode ?? lookup.name]?.card.info ?? null,
}));
const card = {
  ...GAME_CARD_DEFAULTS,
  identity: {
    name: "Lightning Bolt",
    setCode: "OLD",
    cardNumber: "1",
    isToken: false,
  },
};
const info = {
  name: "Lightning Bolt",
  oracle_text: "Deal 3 damage to any target.",
} as ScryfallCard;

describe("card browser search metadata", () => {
  beforeEach(() => {
    getCard.mockReset();
  });

  it("loads rules by name when the exact printing is unavailable", async () => {
    getCard
      .mockRejectedValueOnce(new Error("printing not cached"))
      .mockResolvedValueOnce({ info });
    await loadBrowserMetadata(card);
    expect(getCard.mock.calls).toEqual([
      [{ name: "Lightning Bolt", setCode: "OLD", cardNumber: "1" }],
      [{ name: "Lightning Bolt" }],
    ]);
  });

  it("reads the name fallback for each printing without claiming exact artwork", () => {
    const bucket = {
      "Lightning Bolt": {
        card: { info, texture: {} as never, uris: {} as never },
      },
    };
    expect(peekBrowserMetadata(bucket, card)).toBe(info);
    expect(
      peekBrowserMetadata(bucket, {
        ...card,
        identity: { ...card.identity, setCode: "NEW" },
      }),
    ).toBe(info);
    expect(bucket).not.toHaveProperty("OLD");
  });

  it("keeps genuine missing records failed", async () => {
    getCard.mockRejectedValue(new Error("offline"));
    await expect(loadBrowserMetadata(card)).rejects.toThrow("offline");
    expect(peekBrowserMetadata({}, card)).toBeNull();
  });

  it("does not substitute an ambiguous token name", async () => {
    getCard.mockRejectedValue(new Error("missing token"));
    const token = { ...card, identity: { ...card.identity, isToken: true } };
    await expect(loadBrowserMetadata(token)).rejects.toThrow("missing token");
    expect(getCard).toHaveBeenCalledTimes(1);
  });
});
