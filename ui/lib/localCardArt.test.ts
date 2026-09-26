import { describe, expect, it } from "vitest";

import { withLocalCardArt } from "./localCardArt";

// Regression: the front face of a multi-face card must ask for its *own* scan
// first. Looking it up under Forge's both-faces script name made every front
// face fall through to Scryfall even though the pack held it.
describe("withLocalCardArt", () => {
  it.each([
    ["C.A.M.P.", "c/c_a_m_p"],
    ["V.A.T.S.", "v/v_a_t_s"],
    ["Borrowing 100,000 Arrows", "b/borrowing_100_000_arrows"],
    ["Guan Yu's 1,000-Li March", "g/guan_yu_s_1_000_li_march"],
    ["Welcome to . . . // Jurassic Park", "w/welcome_to"],
    ["Welcome to . . .", "w/welcome_to"],
    ["I'm a Doctor, Not a . . .", "i/i_m_a_doctor_not_a"],
    ["Human—Time Lord Meta-Crisis", "h/human_time_lord_meta_crisis"],
    ["Monster Mash-Up", "m/monster_mashup"],
    ["M.O.D.O.K. // M.O.D.O.K.", "m/m_o_d_o_k"],
    ["M.O.D.O.K., Evil Intellect // M.O.D.O.K., Evil Intellect", "m/m_o_d_o_k_evil_intellect"],
  ])("includes the verified image-pack filename for %s", (name, path) => {
    const cdn = "https://cards.scryfall.io/normal/retained.jpg";
    const uris = withLocalCardArt({ normal: cdn }, name);
    const url = new URL(uris!.normal!, "http://localhost");
    expect([url.pathname, ...url.searchParams.getAll("alt")]).toContain(`/card-images/${path}.full.webp`);
    expect(url.searchParams.get("fallback")).toBe(cdn);
    expect(withLocalCardArt(uris, name)).toEqual(uris);
  });

  it("finds the Chinese Nature's Rhythm scan under the pack's apostrophe spelling", () => {
    const cdn = "https://cards.scryfall.io/normal/front/1/3/1397d904-c51d-451e-8505-7f3118acc1f6.jpg";
    for (const name of ["Nature's Rhythm", "Nature’s Rhythm"]) {
      const uris = withLocalCardArt({ normal: cdn }, name);
      const url = new URL(uris!.normal!, "http://localhost");
      expect(url.pathname).toBe("/card-images/n/natures_rhythm.full.webp");
      expect(url.searchParams.getAll("alt")).toContain("/card-images/n/nature_s_rhythm.full.webp");
      expect(url.searchParams.get("fallback")).toBe(cdn);
    }
  });

  it("upgrades persisted local URLs without losing their fallback or duplicating aliases", () => {
    const local = "/card-images/n/natures_rhythm.full.webp?fallback=https%3A%2F%2Fcards.scryfall.io%2Fx.jpg";
    const uris = withLocalCardArt({ normal: local }, "Nature's Rhythm");
    expect(uris?.normal).toBe(local + "&alt=%2Fcard-images%2Fn%2Fnature_s_rhythm.full.webp");
    expect(withLocalCardArt(uris, "Nature's Rhythm")).toEqual(uris);
  });

  it("routes old deck full-image URLs through the local library at every preview size", () => {
    const cdn = "https://cards.scryfall.io/large/front/g/grizzly.jpg";
    const uris = withLocalCardArt({ normal: cdn, large: cdn, border_crop: cdn }, "Grizzly Bears");
    for (const variant of ["small", "normal", "large", "png", "border_crop"] as const) {
      expect(uris?.[variant]).toMatch(/^\/card-images\/g\/grizzly_bears\.full\.webp\?/);
    }
    expect(new URL(uris!.large!, "http://localhost").searchParams.get("fallback")).toBe(cdn);
  });

  it("keeps illustration crops distinct from full printed scans", () => {
    const crop = "https://cards.scryfall.io/art_crop/front/g/grizzly.jpg";
    expect(withLocalCardArt({ art_crop: crop }, "Grizzly Bears")?.art_crop).toBe(crop);
  });

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
