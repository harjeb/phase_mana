import { describe, expect, it } from "vitest";

import { withLocalCardArt } from "./localCardArt";

// Regression: the front face of a multi-face card must ask for its *own* scan
// first. Looking it up under Forge's both-faces script name made every front
// face fall through to Scryfall even though the pack held it.
describe("withLocalCardArt", () => {
  it("asks for the per-face scan of a multi-face front, with the both-faces spelling as alt", () => {
    const uris = withLocalCardArt({ normal: "https://cards.scryfall.io/normal/x.jpg" }, "Delver of Secrets");
    expect(uris?.normal).toBe(
      "/card-images/d/delver_of_secrets.full.webp" +
        "?fallback=https%3A%2F%2Fcards.scryfall.io%2Fnormal%2Fx.jpg" +
        "&alt=%2Fcard-images%2Fd%2Fdelver_of_secrets_insectile_aberration.full.webp",
    );
  });

  it("asks for the front face of a modal double-faced card the same way", () => {
    const uris = withLocalCardArt({ normal: "https://cards.scryfall.io/normal/y.jpg" }, "Kazuul's Fury");
    expect(uris?.normal).toContain("/card-images/k/kazuuls_fury.full.webp?");
    expect(uris?.normal).toContain("alt=%2Fcard-images%2Fk%2Fkazuuls_fury_kazuuls_cliffs.full.webp");
  });

  it("names a card with no Scryfall record for the server-side lookup", () => {
    const uris = withLocalCardArt({ small: "", normal: "" }, "Grizzly Bears");
    expect(uris?.normal).toBe("/card-images/g/grizzly_bears.full.webp?name=Grizzly%20Bears");
  });

  it("leaves an already-local uri alone so its CDN fallback survives", () => {
    const local =
      "/card-images/g/grizzly_bears.full.webp" +
      "?fallback=https%3A%2F%2Fcards.scryfall.io%2Fnormal%2Fx.jpg";
    const uris = withLocalCardArt(
      { small: local, normal: local, large: local, png: local, art_crop: local, border_crop: local },
      "Grizzly Bears",
    );
    expect(uris?.normal).toBe(local);
    expect(uris?.art_crop).toBe(local);
  });
});
