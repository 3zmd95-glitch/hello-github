import { describe, expect, it } from "vitest";
import genres from "../../../../planning/data/genres.json";
import { labelCards } from "./label";
import { planSearch } from "./plan";
import { genreWords, mentions } from "./relevance";
import { normalizeTerm } from "./terms";

describe("every built-in edit genre", () => {
  for (const genre of genres.genres) {
    it(`${genre.id}: retains the subject in examples, tutorials and retries`, () => {
      const req = {
        q: "match cut",
        genreQuery: { en: genre.queries.en[0], ar: genre.queries.ar[0] },
        program: "DaVinci Resolve",
      };
      const plan = planSearch(req);
      for (const query of plan.queries) {
        expect(query.q).toContain(req.genreQuery[query.lang]);
        if (query.retryQ) expect(query.retryQ).toContain(req.genreQuery[query.lang]);
        if (query.intent === "tutorials") expect(query.q).toContain(req.program);
      }
      const words = genreWords(req);
      expect(words.length).toBeGreaterThan(1);
      expect(words).not.toContain("edit");
      expect(words).not.toContain("video");
      const examples = [
        "Generic match cut tutorial",
        `${genre.queries.en[0]} match cut tutorial`,
        `${genre.queries.ar[0]} ماتش كت`,
      ];
      const items = labelCards(
        examples.map((title, i) => ({
          card: {
            title,
            snippet: "",
            platform: "yt" as const,
            handle: "Test",
            url: `https://www.youtube.com/watch?v=${i}`,
          },
          query: plan.queries[0],
        })),
        plan,
      );
      expect(items.map((item) => !!item.offTopic)).toEqual([true, false, false]);
    });
  }

  it("handles Arabic attached articles without matching inside unrelated words", () => {
    for (const text of ["للقهوة", "بالقهوة", "القهوة", "والقهوة"])
      expect(mentions(normalizeTerm(text), normalizeTerm("قهوة"))).toBe(true);
    expect(mentions("carpet", "car")).toBe(false);
    expect(mentions("مدرسه", "درس")).toBe(false);
  });
});
