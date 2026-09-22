import { describe, expect, it } from "vitest";

import { forgeCardStem, forgeCardSlug, forgeCardStems } from "./forgeCardStem";

// Single-face expectations are real files under
// `forge/forge-gui/res/cardsfolder/<letter>/<stem>.txt`, which the local
// card-image library mirrors.
describe("forgeCardStem", () => {
  it.each([
    ["Rabaroo Troop", "rabaroo_troop"],
    ["Ashnod's Altar", "ashnods_altar"],
    ["Borrowing 100,000 Arrows", "borrowing_100000_arrows"],
    ["Lim-Dûl's Vault", "lim_duls_vault"],
  ])("%s -> %s", (name, stem) => {
    expect(forgeCardStem(name)).toBe(stem);
  });

  it("prefers the per-face name for a multi-face card, then the both-faces name", () => {
    // A pack holding one scan per face files the front as `delver_of_secrets`;
    // one holding a single scan files it as `delver_of_secrets_insectile_aberration`.
    expect(forgeCardStems("Delver of Secrets")).toEqual([
      "delver_of_secrets",
      "delver_of_secrets_insectile_aberration",
    ]);
    expect(forgeCardStems("Delver of Secrets // Insectile Aberration")).toEqual([
      "delver_of_secrets_insectile_aberration",
      "delver_of_secrets",
    ]);
    // A modal double-faced card: Scryfall calls it both faces, the pack files
    // one scan per face.
    expect(forgeCardStems("Kazuul's Fury // Kazuul's Cliffs")).toEqual([
      "kazuuls_fury_kazuuls_cliffs",
      "kazuuls_fury",
    ]);
    expect(forgeCardStems("Fire // Ice")).toEqual(["fire_ice", "fire"]);
  });

  it("leaves a single-face card with one spelling", () => {
    expect(forgeCardStems("Forest")).toEqual(["forest"]);
  });

  it("falls back to the exception table when the plain rule names no file", () => {
    // Forge's script is `agents_of_s_h_i_e_l_d`; the plain rule spells the
    // abbreviation `agents_of_shield`, which is what a pack made by hand uses.
    expect(forgeCardStems("Agents of S.H.I.E.L.D.")).toEqual([
      "agents_of_shield",
      "agents_of_s_h_i_e_l_d",
    ]);
  });

  it("strips accents instead of deleting the letter", () => {
    expect(forgeCardSlug("Lim-Dûl's Vault")).toBe("lim_duls_vault");
  });
});
