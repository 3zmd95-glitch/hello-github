import { describe, expect, it } from "vitest";
import genres from "../../../../planning/data/genres.json";
import { labelCards, TUTORIAL_RE } from "./label";
import { planSearch } from "./plan";
import { categoryHint, genreWords, isCategoryOnly, mentions, selectedGenre } from "./relevance";
import { normalizeTerm } from "./terms";

describe("every built-in edit genre", () => {
  it("keeps short plural subjects and techniques without corrupting unrelated words", () => {
    const plan = planSearch({ q: "match cut", genreQuery: { en: "car edit", ar: "ايديت سيارات" } });
    const [item] = labelCards(
      [
        {
          card: {
            title: "Cinematic cars with match cuts",
            snippet: "",
            platform: "yt",
            handle: "Test",
            url: "https://www.youtube.com/watch?v=plural",
          },
          query: plan.queries[0],
        },
      ],
      plan,
    );
    expect(item.offTopic).toBeUndefined();
    expect(normalizeTerm("lens news gas")).toBe("lens news gas");
  });
  for (const genre of genres.genres) {
    it(`${genre.id}: genre alone requires filming/editing context in either language`, () => {
      for (const q of [genre.name.en, genre.name.ar, ...genre.queries.en, ...genre.queries.ar]) {
        const plan = planSearch({ q });
        expect(selectedGenre({ q })?.id).toBe(genre.id);
        expect(isCategoryOnly({ q })).toBe(true);
        const subject = genreWords({ q })[0];
        const items = labelCards(
          [
            `${subject} explained: a beginner lesson`,
            `Cinematic ${subject} lighting tutorial`,
            `شرح تصوير ${subject}`,
          ].map((title, i) => ({
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
        const queries = plan.queries.filter((query) => query.platform === "yt");
        expect(queries.map(({ intent, lang }) => [intent, lang])).toEqual([
          ["examples", "en"],
          ["tutorials", "en"],
          ["tutorials", "ar"],
        ]);
        expect(queries.every((query) => query.q.length <= 80)).toBe(true);
        expect(
          queries
            .filter((query) => query.intent === "tutorials")
            .every((query) => TUTORIAL_RE.test(query.q)),
        ).toBe(true);
        const queryCards = labelCards(
          plan.queries.map((query, i) => ({
            card: {
              title: query.q,
              snippet: "",
              platform: query.platform,
              handle: "",
              url: `query-${i}`,
            },
            query,
          })),
          plan,
        );
        expect(queryCards.every((item) => !item.offTopic)).toBe(true);
        for (const platform of ["yt", "tt", "ig"]) {
          const own = plan.queries.filter((query) => query.platform === platform);
          expect(own).toHaveLength(3);
          const words = own.flatMap((query) => [query.q, ...(query.retryQ ? [query.retryQ] : [])]);
          expect(new Set(words.map(normalizeTerm)).size).toBe(words.length);
        }
      }
    });
    it(`${genre.id}: retains the subject in examples, tutorials and retries`, () => {
      const req = {
        q: "match cut",
        genreQuery: { en: genre.queries.en[0], ar: genre.queries.ar[0] },
        program: "DaVinci Resolve",
      };
      const plan = planSearch(req);
      for (const query of plan.queries) {
        const hint = categoryHint(req, query.lang)!;
        expect(query.q).toContain(hint);
        if (query.retryQ) expect(query.retryQ).toContain(hint);
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

  it("rejects brewing lessons found in the live Coffee audit but keeps filming examples", () => {
    const plan = planSearch({ q: "coffee edit", genreQuery: { ar: "تصوير قهوة" } });
    const items = labelCards(
      [
        "All Espresso Drinks Explained: Cappuccino vs Latte vs Flat White",
        "Homemade Cold Brew Coffee Tutorial",
        "شرح تحضير قهوة للمبتدئين",
        "Coffee pour b-roll lighting tutorial",
        "2 AM COFFEE - A short film | Sony FX3",
        "شرح كواليس تصوير كوب قهوة",
      ].map((title, i) => ({
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
    expect(items.map((item) => !!item.offTopic)).toEqual([true, true, true, false, false, false]);
  });

  it("handles Arabic attached articles without matching inside unrelated words", () => {
    for (const text of ["للقهوة", "بالقهوة", "القهوة", "والقهوة"])
      expect(mentions(normalizeTerm(text), normalizeTerm("قهوة"))).toBe(true);
    expect(mentions("carpet", "car")).toBe(false);
    expect(mentions("مدرسه", "درس")).toBe(false);
  });
});

describe("category constraints", () => {
  const coffee = { en: "coffee edit", ar: "تصوير قهوة" };
  const titles = (plan: ReturnType<typeof planSearch>, values: string[]) =>
    labelCards(
      values.map((title, i) => ({
        card: {
          title,
          snippet: "",
          platform: "yt" as const,
          handle: "",
          url: `https://www.youtube.com/watch?v=${i}`,
        },
        query: plan.queries[0],
      })),
      plan,
    ).map((item) => !!item.offTopic);

  it("gives an explicit category precedence over a category in the typed topic", () => {
    const req = { q: "car edit", genreQuery: coffee };
    expect(selectedGenre(req)?.id).toBe("coffee");
    expect(isCategoryOnly(req)).toBe(false);
    const plan = planSearch(req);
    expect(
      titles(plan, [
        "Cinematic car edit",
        "Coffee commercial lighting",
        "Car and coffee cinematic edit",
      ]),
    ).toEqual([true, true, false]);
  });

  it("does not replace an explicit custom category with a built-in topic", () => {
    const req = { q: "coffee edit", genreQuery: { en: "ceramics", ar: "سيراميك" } };
    expect(selectedGenre(req)).toBeUndefined();
    expect(isCategoryOnly(req)).toBe(false);
    expect(categoryHint(req, "en")).toBe("ceramics");
    expect(
      titles(planSearch(req), [
        "Coffee cinematic b roll",
        "Ceramics commercial",
        "Coffee ceramic cup lighting tutorial",
      ]),
    ).toEqual([true, true, false]);
  });

  it("keeps a typed technique and category as separate mandatory concepts", () => {
    const plan = planSearch({ q: "match cut", genreQuery: coffee });
    expect(
      titles(plan, [
        "Coffee commercial",
        "Travel match cut tutorial",
        "Coffee match cut tutorial",
        "شرح ماتش كت للقهوة",
      ]),
    ).toEqual([true, true, false, false]);
  });

  it("does not broaden a specific coffee subject into the whole category", () => {
    const req = { q: "espresso", genreQuery: coffee };
    expect(isCategoryOnly(req)).toBe(false);
    const plan = planSearch(req);
    expect(plan.queries.every((query) => query.q.includes("espresso"))).toBe(true);
    expect(
      titles(plan, [
        "Coffee cinematic lighting",
        "Espresso brewing explained",
        "Espresso commercial lighting tutorial",
      ]),
    ).toEqual([true, true, false]);
  });

  it("uses focused bilingual category searches without repeated edit boilerplate", () => {
    const plan = planSearch({ q: "coffee edit", genreQuery: coffee, program: "DaVinci Resolve" });
    expect(plan.queries.filter((query) => query.platform === "yt").map((query) => query.q)).toEqual(
      [
        "coffee commercial cinematic b roll",
        "coffee videography lighting tutorial DaVinci Resolve",
        "شرح تصوير القهوة وإضاءتها DaVinci Resolve",
      ],
    );
    expect(
      plan.queries
        .filter((query) => query.intent === "tutorials")
        .every((query) => !query.retryQ || query.retryQ.includes("DaVinci Resolve")),
    ).toBe(true);
  });
});
