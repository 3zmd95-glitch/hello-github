import { describe, expect, it } from "vitest";
import type { ScoutResult } from "../normalize";
import { creatorsOf, labelCards, TUTORIAL_RE } from "./label";
import { planSearch } from "./plan";
import type { PlannedQuery } from "./types";

// An Arabic search: its plan holds the queries of both languages.
const plan = planSearch({ q: "flash", lang: "ar" });
const query = (id: string): PlannedQuery => plan.queries.find((q) => q.id === id)!;
let n = 0;
const card = (over: Partial<ScoutResult>): ScoutResult => ({
  platform: "tt",
  handle: "@a",
  title: "",
  snippet: "",
  url: `https://www.tiktok.com/@a/video/${++n}`,
  ...over,
});

describe("labelCards", () => {
  it("requires both the technique and selected genre, in either language", () => {
    const coffee = planSearch({
      q: "match cut",
      genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
    });
    const items = labelCards(
      [
        "Match cut coffee commercial tutorial",
        "Match cut football edit tutorial",
        "Coffee pour b-roll",
        "شرح ماتش كت للقهوة",
      ].map((title) => ({ card: card({ title }), query: coffee.queries[0] })),
      coffee,
    );
    expect(items.map((i) => !!i.offTopic)).toEqual([false, true, true, false]);
  });

  describe("category fallback", () => {
    const coffee = planSearch({
      q: "match cut",
      genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
    });
    const label = (titles: string[], relaxCategory?: boolean) =>
      labelCards(
        titles.map((title) => ({ card: card({ title }), query: coffee.queries[0] })),
        coffee,
        { relaxCategory },
      ).map((i) => [!!i.offTopic, !!i.outsideCategory]);

    it("shows the idea's matches, marked, when nothing matches the idea and the category together", () => {
      expect(label(["Match cut football edit tutorial", "Cooking recipe vlog"], true)).toEqual([
        [false, true],
        [true, false],
      ]);
    });

    it("stays strict while anything matches both, and when the caller does not ask", () => {
      expect(
        label(["Match cut coffee commercial tutorial", "Match cut football edit tutorial"], true),
      ).toEqual([
        [false, false],
        [true, false],
      ]);
      expect(label(["Match cut football edit tutorial"])).toEqual([[true, false]]);
    });

    it("never relaxes a category-only search", () => {
      const cars = planSearch({ q: "car edit", genreQuery: { ar: "ايديت سيارات" } });
      expect(cars.categoryGroups).toBeUndefined();
      const [item] = labelCards(
        [{ card: card({ title: "Football edit" }), query: cars.queries[0] }],
        cars,
        { relaxCategory: true },
      );
      expect(item.offTopic).toBe(true);
      expect(item.outsideCategory).toBeUndefined();
    });
  });

  // A trend chip's search (`editing`): live, 2026-10-07, the "Glow Effect" chip showed Arabic beauty-serum reels.
  describe("a trend chip's search", () => {
    const labels = (plan: ReturnType<typeof planSearch>, titles: string[]) =>
      labelCards(
        titles.map((title) => ({ card: card({ title }), query: plan.queries[0] })),
        plan,
      ).map((i) => !!i.offTopic);
    const TITLES = [
      // The live beauty reel: "Effect" is only the product's name.
      "سيروم كولاجين جلو بوستر (Collagen Glow Effect)",
      "Glow effect serum for glass skin ✨",
      "Product Cutout … Insta Edit में Glow Effect",
      "Glow effect in After Effects",
      "Glow Effect tutorial",
      "the new glow effect trend 🔥",
    ];

    it("needs an editing cue besides the effect's own name", () => {
      const glow = planSearch({ q: "Glow Effect", editing: true });
      expect(labels(glow, TITLES)).toEqual([true, true, false, false, false, false]);
    });

    it("an ordinary search keeps them as before", () => {
      expect(labels(planSearch({ q: "Glow Effect" }), TITLES).slice(0, 2)).toEqual([false, false]);
    });

    it("inside a category, its filming words count as cues (a camera style names no edit)", () => {
      const cars = planSearch({
        q: "rolling shot",
        genreQuery: { en: "car edit", ar: "ايديت سيارات" },
        editing: true,
      });
      expect(
        labels(cars, ["Cinematic rolling shot of a BMW M3", "rolling shot car for sale"]),
      ).toEqual([false, true]);
    });
  });

  it("does not call a finished edit a tutorial just because of the query", () => {
    const [item] = labelCards(
      [{ card: card({ title: "My flash transition edit" }), query: query("tt-tutorials-en") }],
      plan,
    );
    expect(item.section).toBe("example");
  });

  it("requires the subject for a genre-only search, not just the word edit", () => {
    const cars = planSearch({ q: "car edit", genreQuery: { ar: "ايديت سيارات" } });
    const items = labelCards(
      ["Football edit", "Cinematic BMW edit", "ايديت سيارات"].map((title) => ({
        card: card({ title }),
        query: cars.queries[0],
      })),
      cars,
    );
    expect(items.map((i) => !!i.offTopic)).toEqual([true, false, false]);
  });

  it("files tutorials by evidence of teaching in their words", () => {
    const items = labelCards(
      [
        {
          card: card({ title: "How to do the flash transition in CapCut" }),
          query: query("tt-examples-en"),
        },
        { card: card({ title: "My flash transition edit" }), query: query("tt-tutorials-en") },
        { card: card({ title: "flash effect edit 🔥" }), query: query("tt-examples-en") },
      ],
      plan,
    );
    expect(items.map((i) => i.section)).toEqual(["tutorial", "example", "example"]);
  });

  it("marks cards that are not about the effect as off-topic", () => {
    const items = labelCards(
      [
        {
          card: card({ title: "WATCHING THE FLASH FOR THE FIRST TIME" }),
          query: query("tt-examples-en"),
        },
        { card: card({ title: "Bike ride vlog" }), query: query("tt-examples-en") },
        { card: card({ title: "شرح تأثير فلاش في كاب كت" }), query: query("tt-tutorials-ar") },
      ],
      plan,
    );
    expect(items.map((i) => i.offTopic ?? false)).toEqual([true, true, false]);
    expect(items[2].lang).toBe("ar");
  });

  it("keeps an Arabic tutorial about a vague word: ال dropped, the tutorial word is editing context", () => {
    const [item] = labelCards(
      [{ card: card({ title: "شرح الفلاش بطريقه سهله" }), query: query("tt-examples-en") }],
      plan,
    );
    expect(item).toMatchObject({ section: "tutorial", lang: "ar" });
    expect(item.offTopic).toBeUndefined();
  });

  it("matches ه typed for ة", () => {
    const split = planSearch({ q: "split screen" });
    const [item] = labelCards(
      [{ card: card({ title: "تقسيم الشاشه في كاب كت" }), query: split.queries[0] }],
      split,
    );
    expect(item.offTopic).toBeUndefined();
  });

  it("counts a plural editing word", () => {
    const glitch = planSearch({ q: "glitch" });
    const [item] = labelCards(
      [{ card: card({ title: "glitch transitions pack" }), query: glitch.queries[0] }],
      glitch,
    );
    expect(item.offTopic).toBeUndefined();
  });

  it("hides nothing on an exact search and keeps the first copy of a post", () => {
    const exact = planSearch({ q: "flash", exact: true });
    const c = card({ title: "The Flash" });
    const items = labelCards(
      [
        { card: c, query: exact.queries[0] },
        { card: { ...c, title: "How to flash" }, query: query("tt-tutorials-en") },
      ],
      exact,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: "The Flash", section: "example" });
    expect(items[0].offTopic).toBeUndefined();
  });
});

describe("TUTORIAL_RE", () => {
  it.each([
    ["شرح", true],
    ["الشرح", true],
    ["بطريقه", true],
    ["بطريقة", true],
    ["وكيف", true],
    ["تعلم", true],
    ["مدرسه", false],
    ["مدرسة", false],
    ["كيفك", false],
  ])("%s → %s", (word, tutorial) => {
    expect(TUTORIAL_RE.test(word)).toBe(tutorial);
  });
});

describe("creatorsOf", () => {
  it("ranks accounts by on-topic cards, then views, and adds profile pages last", () => {
    const items = labelCards(
      [
        {
          card: card({ handle: "@b", title: "flash transition edit" }),
          query: query("tt-examples-en"),
        },
        {
          card: card({ handle: "@a", title: "flash transition edit" }),
          query: query("tt-examples-en"),
        },
        {
          card: card({ handle: "@a", title: "flash transition tutorial" }),
          query: query("tt-tutorials-en"),
        },
        { card: card({ handle: "@c", title: "The Flash" }), query: query("tt-examples-en") },
        {
          card: {
            ...card({
              platform: "yt",
              handle: "Cinecom",
              title: "flash transition tutorial",
              stats: { views: 900 },
            }),
            profile: "https://www.youtube.com/channel/UC1",
          },
          query: query("yt-tutorials-en"),
        },
        {
          card: card({ platform: "ig", handle: "", title: "flash transition edit" }),
          query: query("ig-examples-en"),
        },
      ],
      plan,
    );
    const creators = creatorsOf(items, [
      { platform: "tt", handle: "@a", url: "https://www.tiktok.com/@a" },
      { platform: "ig", handle: "@zenko.edit", url: "https://www.instagram.com/zenko.edit/" },
    ]);
    expect(creators).toEqual([
      { platform: "tt", handle: "@a", url: "https://www.tiktok.com/@a", count: 2 },
      {
        platform: "yt",
        handle: "Cinecom",
        url: "https://www.youtube.com/channel/UC1",
        count: 1,
        views: 900,
      },
      { platform: "tt", handle: "@b", url: "https://www.tiktok.com/@b", count: 1 },
      {
        platform: "ig",
        handle: "@zenko.edit",
        url: "https://www.instagram.com/zenko.edit/",
        count: 0,
      },
    ]);
  });

  it("lists at most 8 creators", () => {
    const items = labelCards(
      Array.from({ length: 10 }, (_, i) => ({
        card: card({ handle: `@c${i}`, title: "flash transition edit" }),
        query: query("tt-examples-en"),
      })),
      plan,
    );
    expect(creatorsOf(items, [], 20)).toHaveLength(10);
    expect(creatorsOf(items, [])).toHaveLength(8);
  });

  it("keeps two YouTube channels with one name apart", () => {
    const yt = (handle: string, channel: string) => ({
      card: {
        ...card({ platform: "yt", handle, title: "flash transition tutorial" }),
        profile: `https://www.youtube.com/channel/${channel}`,
      },
      query: query("yt-tutorials-en"),
    });
    const creators = creatorsOf(labelCards([yt("Cinecom", "UC1"), yt("CINECOM", "UC2")], plan), []);
    expect(creators.map((c) => [c.handle, c.url])).toEqual([
      ["Cinecom", "https://www.youtube.com/channel/UC1"],
      ["CINECOM", "https://www.youtube.com/channel/UC2"],
    ]);
  });
});
