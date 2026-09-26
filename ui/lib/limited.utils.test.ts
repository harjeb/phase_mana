import { describe, expect, it, vi } from "vitest";
import type { DraftCard } from "@/types/limited";
import type { ScryfallCard, ScryfallImageUris } from "@/types/scryfall";

vi.mock("@/stores/useScryfallStore", () => ({}));

import { refToDeckCard } from "./limited.utils";

function images(face: string): ScryfallImageUris {
  return Object.fromEntries(
    ["small", "normal", "large", "png", "art_crop", "border_crop"].map(
      (size) => [size, `https://cards.scryfall.io/${size}/${face}.jpg`],
    ),
  ) as unknown as ScryfallImageUris;
}

const ref: DraftCard = {
  id: "draft-id",
  name: "Grizzly Bears",
  setCode: "lea",
  cardNumber: "202",
  foil: true,
};

describe("refToDeckCard local art", () => {
  it("requests local art without Scryfall metadata while preserving draft identity", () => {
    const card = refToDeckCard(ref, null, 3);
    expect(card.identity).toMatchObject({
      id: "pool-3-lea-202",
      name: ref.name,
      setCode: "lea",
      cardNumber: "202",
      foil: true,
    });
    for (const uri of Object.values(card.uris)) {
      const url = new URL(uri, "http://localhost");
      expect(url.pathname).toBe("/card-images/g/grizzly_bears.full.webp");
      expect(url.searchParams.get("name")).toBe("Grizzly Bears");
    }
    expect(card.backFace).toBeUndefined();
  });

  it.each([
    [
      "transform",
      "Delver of Secrets",
      "Insectile Aberration",
      "Creature — Human Wizard",
      "Creature — Human Insect",
    ],
    ["modal_dfc", "Kazuul's Fury", "Kazuul's Cliffs", "Instant", "Land"],
  ])(
    "keeps %s front and back scans and canonical names distinct",
    (layout, frontName, backName, frontType, backType) => {
      const frontImages = images("front");
      const backImages = images("back");
      const info = {
        name: `${frontName} // ${backName}`,
        printed_name: "Localized name",
        layout,
        set: "test",
        collector_number: "1",
        cmc: 3,
        color_identity: ["R"],
        type_line: `${frontType} // ${backType}`,
        card_faces: [
          {
            name: frontName,
            printed_name: "Localized front",
            type_line: frontType,
            mana_cost: "{2}{R}",
            oracle_text: "Front rules",
            image_uris: frontImages,
          },
          {
            name: backName,
            printed_name: "Localized back",
            type_line: backType,
            oracle_text: "Back rules",
            image_uris: backImages,
          },
        ],
      } as ScryfallCard;
      // The store entry can select either face; Limited must display the front initially.
      const card = refToDeckCard(
        { ...ref, name: info.name },
        { info, uris: backImages },
        0,
      );
      expect(card.identity.name).toBe(frontName);
      expect(card.isDoubleFaced).toBe(true);
      expect(card.manaCost).toBe("{2}{R}");
      expect(card.text).toBe("Front rules");
      expect(card.types).not.toContain("//");
      expect(card.backFace).toMatchObject({
        name: backName,
        manaCost: "",
        typeLine: backType,
        oracleText: "Back rules",
      });
      const front = new URL(card.uris.normal, "http://localhost");
      const back = new URL(card.backFace!.uris.normal, "http://localhost");
      expect(front.pathname).not.toBe(back.pathname);
      expect(back.pathname).toBe(
        layout === "transform"
          ? "/card-images/i/insectile_aberration.full.webp"
          : "/card-images/k/kazuuls_cliffs.full.webp",
      );
      expect(front.searchParams.get("fallback")).toBe(frontImages.normal);
      expect(back.searchParams.get("fallback")).toBe(backImages.normal);
      expect(card.backFace!.uris.art_crop).toBe(backImages.art_crop);

      delete info.card_faces![1].image_uris;
      const withoutBackScan = refToDeckCard(ref, { info, uris: frontImages }, 0);
      const namedBack = new URL(withoutBackScan.backFace!.uris.normal, "http://localhost");
      expect(namedBack.searchParams.get("name")).toBe(backName);
      expect(namedBack.searchParams.has("fallback")).toBe(false);
      delete info.card_faces![0].image_uris;
      const withoutFrontScan = refToDeckCard(ref, { info, uris: backImages }, 0);
      const namedFront = new URL(withoutFrontScan.uris.normal, "http://localhost");
      expect(namedFront.searchParams.get("name")).toBe(frontName);
      expect(namedFront.searchParams.has("fallback")).toBe(false);
      info.layout = "split";
      info.card_faces![1].image_uris = backImages;
      expect(
        refToDeckCard(ref, { info, uris: frontImages }, 0).backFace,
      ).toBeUndefined();
    },
  );
});
