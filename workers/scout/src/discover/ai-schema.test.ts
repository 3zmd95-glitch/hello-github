import { describe, expect, it } from "vitest";
import genres from "../../../../planning/data/genres.json";
import { aiSearchInput } from "./ai-schema";

describe("shared AI category guidance", () => {
  it.each(genres.genres)("supplies bilingual, category-only guidance for $id", (genre) => {
    const input = JSON.parse(aiSearchInput({ q: genre.queries.en[0] }));
    expect(input.categoryContext).toMatchObject({ name: genre.name, categoryOnly: true });
    for (const kind of ["subject", "examples", "tutorials"]) {
      expect(input.categoryContext[kind].ar).toMatch(/[ء-ي]/);
      expect(input.categoryContext[kind].en).toMatch(/[a-z]/i);
    }
  });

  it("keeps a detailed brief and program intact without making category ideas requirements", () => {
    const q = "Car headlight match cuts at night";
    const input = JSON.parse(
      aiSearchInput({
        q,
        genreQuery: { en: "car edit" },
        program: "DaVinci Resolve",
      }),
    );
    expect(input).toMatchObject({
      brief: q,
      selectedProgram: "DaVinci Resolve",
      categoryContext: { name: { en: "Cars" }, categoryOnly: false },
    });
  });

  it("uses the clicked category and does not substitute a built-in profile for custom hints", () => {
    const chosen = JSON.parse(aiSearchInput({ q: "car edit", genreQuery: { en: "coffee edit" } }));
    expect(chosen.categoryContext).toMatchObject({ name: { en: "Coffee" }, categoryOnly: false });
    expect(
      JSON.parse(aiSearchInput({ q: "coffee edit", genreQuery: { en: "neon interiors" } })),
    ).toEqual({ brief: "coffee edit", selectedGenre: { en: "neon interiors" } });
  });
});
