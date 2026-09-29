import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_TRENDS,
  TrendItemSchema,
  type CustomGenre,
  type Idea,
  type SaudiEvent,
  type TrendItem,
} from "./domain";
import en from "@/messages/trends.en.json";
import ar from "@/messages/trends.ar.json";
import { allGenres, discoverGenreHref, GENRES, genreIdFromSearch } from "./genres";
import {
  DEFAULT_TREND_KEYWORDS,
  eventToTrendItem,
  matchesKeywords,
  matchesNiche,
  normalizeTrendText,
  SOURCE_KEY,
  savedTrendIdea,
  sourceLabel,
  trendGenreHref,
  trendGenreLabel,
  trendIdeaText,
  trendsStale,
  upcomingEvents,
  visibleTrends,
  VOLUME_UNIT,
  volumeLabelKey,
  volumeUnit,
} from "./trends";
import { fetchTrends } from "./trendsClient";

const NOW = new Date("2026-09-28T10:00:00Z");

const item = (over: Partial<TrendItem> & { id: string }): TrendItem =>
  TrendItemSchema.parse({
    platform: "google",
    region: "SA",
    lang: "ar",
    title: over.id,
    source: "Google Trends",
    seenAt: "2026-09-28T06:00:00.000Z",
    ...over,
  });

const event = (over: Partial<SaudiEvent> & { id: string; date: string }): SaudiEvent => ({
  name: { ar: over.id, en: over.id },
  hashtags: [],
  leadDays: 14,
  kind: "other",
  approx: false,
  ...over,
});

describe("normalizeTrendText / matchesKeywords", () => {
  it("folds case, diacritics, kashida and the alef / ta marbuta / alef maqsura forms", () => {
    expect(normalizeTrendText("DaVinci  Resolve")).toBe("davinci resolve");
    expect(normalizeTrendText("تَصْحِيح الألوان")).toBe("تصحيح الالوان");
    expect(normalizeTrendText("مونتـــاج")).toBe("مونتاج");
    expect(normalizeTrendText("إضاءة")).toBe("اضاءه");
    expect(normalizeTrendText("مستشفى")).toBe("مستشفي");
  });

  it("matches a keyword on the title or the tags regardless of diacritics and case", () => {
    const i = item({ id: "a", title: "أفضل كامِيرا للتصوير", tags: ["B-Roll"] });
    expect(matchesKeywords(i, ["كاميرا"])).toBe(true);
    expect(matchesKeywords(i, ["b-roll"])).toBe(true);
    expect(matchesKeywords(i, ["تصوير"])).toBe(true);
    expect(matchesKeywords(i, ["مونتاج"])).toBe(false);
    expect(matchesKeywords(i, ["", "   "])).toBe(false);
    expect(matchesKeywords(i, [])).toBe(false);
  });

  it("the default keyword lists are non-empty in both languages", () => {
    expect(DEFAULT_TREND_KEYWORDS.ar.length).toBeGreaterThan(0);
    expect(DEFAULT_TREND_KEYWORDS.en.length).toBeGreaterThan(0);
    const en = item({ id: "e", lang: "en", title: "Color Grading in DaVinci Resolve 20" });
    expect(matchesKeywords(en, DEFAULT_TREND_KEYWORDS.en)).toBe(true);
    const ar = item({ id: "r", title: "مونتاج الفيديو بالجوال" });
    expect(matchesKeywords(ar, DEFAULT_TREND_KEYWORDS.ar)).toBe(true);
  });
});

describe("matchesNiche (the radar's ⭐ rule, round 31)", () => {
  const KEYWORDS = [...DEFAULT_TREND_KEYWORDS.ar, ...DEFAULT_TREND_KEYWORDS.en];
  const drift: CustomGenre = { id: "custom-drift", name: "Drift", query: "مونتاج درفت" };
  const genres = allGenres([drift]);
  /** A row as the Worker's keyword scan writes it: tagged with the query that found it, then "short". */
  const scan = (id: string, query: string, over: Partial<TrendItem> = {}): TrendItem =>
    item({ id, platform: "youtube", source: "YouTube search", tags: [query, "short"], ...over });

  it("does not star a genre row for the query that found it", () => {
    const food = scan("food", "مونتاج أكل", { genre: "food", title: "أحلى مطاعم الرياض" });
    // The plain keyword match stars it: the tag holds the niche word "مونتاج".
    expect(matchesKeywords(food, KEYWORDS)).toBe(true);
    expect(matchesNiche(food, KEYWORDS, genres)).toBe(false);
    const coffee = scan("coffee", "تصوير قهوة", { genre: "coffee", title: "Latte art" });
    expect(matchesNiche(coffee, KEYWORDS, genres)).toBe(false);
    // The genre's other queries and the other language's count as its own words too, folded like keywords.
    expect(matchesNiche(scan("f2", "تصوير مطاعم", { genre: "food" }), KEYWORDS, genres)).toBe(
      false,
    );
    expect(matchesNiche(scan("f3", "مونتاج  اكل", { genre: "food" }), KEYWORDS, genres)).toBe(
      false,
    );
    expect(matchesNiche(scan("f4", "Food Edit", { genre: "food" }), ["edit"], genres)).toBe(false);
  });

  it("stars no built-in genre for any of its own queries", () => {
    for (const g of GENRES) {
      for (const q of [...g.queries.ar, ...g.queries.en]) {
        const row = scan(`${g.id}:${q}`, q, { genre: g.id, title: "x" });
        expect(matchesNiche(row, KEYWORDS, genres), `${g.id}: ${q}`).toBe(false);
      }
    }
  });

  it("knows the owner's custom genres, and counts the tags of an id it does not know", () => {
    const row = scan("drift", "مونتاج درفت", { genre: "custom-drift", title: "Night drift" });
    expect(matchesNiche(row, KEYWORDS, genres)).toBe(false);
    // The owner removed the genre in Settings: the app no longer knows which words were its own.
    expect(matchesNiche(row, KEYWORDS, allGenres([]))).toBe(true);
    const drone = scan("drone", "تصوير درون", { genre: "drone", title: "FPV" });
    expect(matchesNiche(drone, KEYWORDS, genres)).toBe(true);
  });

  it("stars a genre row when its title matches or a niche keyword found it", () => {
    const byTitle = scan("t", "مونتاج أكل", { genre: "food", title: "مونتاج فيديو أكل بالجوال" });
    expect(matchesNiche(byTitle, KEYWORDS, genres)).toBe(true);
    // The niche keyword found the video first (tags[0]) and the genre's keyword found it again.
    const byKeyword = scan("k", "مونتاج", { genre: "food", title: "أحلى مطاعم الرياض" });
    expect(matchesNiche(byKeyword, KEYWORDS, genres)).toBe(true);
    const byOtherTag = item({ id: "o", genre: "food", tags: ["مونتاج أكل", "B-Roll"] });
    expect(matchesNiche(byOtherTag, KEYWORDS, genres)).toBe(true);
  });

  it("keeps a tag that is both the genre's query and a niche keyword", () => {
    const broll: CustomGenre = { id: "custom-b-roll", name: "B-roll", query: "B-Roll" };
    const row = scan("b", "b-roll", { genre: "custom-b-roll", title: "x" });
    expect(matchesNiche(row, KEYWORDS, allGenres([broll]))).toBe(true);
    const cars = scan("c", "car edit", { genre: "cars", title: "x" });
    expect(matchesNiche(cars, ["Car Edit"], genres)).toBe(true);
    expect(matchesNiche(cars, ["edit"], genres)).toBe(false);
  });

  it("is the plain keyword match for a row without a genre", () => {
    expect(matchesNiche(scan("a", "مونتاج"), KEYWORDS, genres)).toBe(true);
    expect(matchesNiche(scan("b", "مونتاج أكل"), KEYWORDS, genres)).toBe(true);
    expect(matchesNiche(item({ id: "c", title: "Color grading 101" }), KEYWORDS, genres)).toBe(
      true,
    );
    expect(matchesNiche(item({ id: "d", title: "حساب المواطن" }), KEYWORDS, genres)).toBe(false);
    expect(matchesNiche(scan("e", "مونتاج", { genre: "" }), KEYWORDS, genres)).toBe(true);
    expect(matchesNiche(scan("f", "مونتاج"), [], genres)).toBe(false);
  });

  it("does not change the row it is given", () => {
    const row = scan("food", "مونتاج أكل", { genre: "food" });
    matchesNiche(row, KEYWORDS, genres);
    expect(row.tags).toEqual(["مونتاج أكل", "short"]);
  });
});

describe("visibleTrends", () => {
  const items = [
    item({ id: "low", score: 20, seenAt: "2026-09-28T08:00:00.000Z" }),
    item({ id: "top", score: 100 }),
    item({ id: "no-score-old", seenAt: "2026-09-27T06:00:00.000Z" }),
    item({ id: "no-score-new", seenAt: "2026-09-28T09:00:00.000Z" }),
    item({ id: "gone", score: 90, expiresAt: "2026-09-28T09:00:00.000Z" }),
    item({ id: "later", score: 80, expiresAt: "2026-09-29T09:00:00.000Z" }),
    item({ id: "us", score: 70, region: "US", lang: "en", platform: "youtube", title: "Editing" }),
    item({ id: "mixed", score: 60, lang: "mixed", platform: "event", tags: ["#EWC2027"] }),
    item({ id: "hidden", score: 99 }),
  ];
  const state = { ...EMPTY_TRENDS, items, dismissed: ["hidden", "not-there"] };

  it("hides dismissed and expired rows and sorts by score then recency", () => {
    expect(visibleTrends(state, {}, NOW).map((i) => i.id)).toEqual([
      "top",
      "later",
      "us",
      "mixed",
      "low",
      "no-score-new",
      "no-score-old",
    ]);
  });

  it("filters by region, platform, language (mixed shows in both) and free text", () => {
    const ids = (f: Parameters<typeof visibleTrends>[1]) =>
      visibleTrends(state, f, NOW).map((i) => i.id);
    expect(ids({ region: "US" })).toEqual(["us"]);
    expect(ids({ platform: "event" })).toEqual(["mixed"]);
    expect(ids({ lang: "en" })).toEqual(["us", "mixed"]);
    expect(ids({ lang: "ar" })).not.toContain("us");
    expect(ids({ lang: "ar" })).toContain("mixed");
    expect(ids({ q: "ewc" })).toEqual(["mixed"]);
    expect(ids({ q: "  " })).toHaveLength(7);
    expect(ids({ region: "SA", platform: "youtube" })).toEqual([]);
  });

  it("returns nothing for the empty slice", () => {
    expect(visibleTrends(EMPTY_TRENDS, {}, NOW)).toEqual([]);
  });
});

describe("visibleTrends by edit genre (round 31)", () => {
  const items = [
    item({ id: "cars-ar", score: 90, platform: "youtube", genre: "cars" }),
    item({
      id: "cars-en",
      score: 80,
      platform: "youtube",
      region: "US",
      lang: "en",
      genre: "cars",
    }),
    item({ id: "cars-tt", score: 70, platform: "tiktok", lang: "mixed", genre: "cars" }),
    item({ id: "food-ar", score: 60, platform: "youtube", genre: "food" }),
    item({ id: "carshow", score: 50, platform: "youtube", genre: "cars-show" }),
    item({
      id: "niche",
      score: 40,
      platform: "youtube",
      title: "car edit tutorial",
      tags: ["cars"],
    }),
    item({ id: "cars-gone", score: 95, genre: "cars", expiresAt: "2026-09-28T09:00:00.000Z" }),
    item({ id: "cars-hidden", score: 99, genre: "cars" }),
  ];
  const state = { ...EMPTY_TRENDS, items, dismissed: ["cars-hidden"] };
  const ids = (f: Parameters<typeof visibleTrends>[1]) =>
    visibleTrends(state, f, NOW).map((i) => i.id);

  it("keeps only the rows tagged with exactly that genre id, best score first", () => {
    expect(ids({ genre: "cars" })).toEqual(["cars-ar", "cars-en", "cars-tt"]);
    expect(ids({ genre: "food" })).toEqual(["food-ar"]);
    expect(ids({ genre: "cars-show" })).toEqual(["carshow"]);
  });

  it("matches the id only: no prefix, no other case, no title or tag, and never a row without a genre", () => {
    expect(ids({ genre: "car" })).toEqual([]);
    expect(ids({ genre: "Cars" })).toEqual([]);
    expect(ids({ genre: " cars" })).toEqual([]);
    expect(ids({ genre: "anime" })).toEqual([]);
    expect(ids({ genre: "cars" })).not.toContain("niche");
  });

  it("shows every row when no genre is picked (undefined or empty)", () => {
    const all = ["cars-ar", "cars-en", "cars-tt", "food-ar", "carshow", "niche"];
    expect(ids({})).toEqual(all);
    expect(ids({ genre: undefined })).toEqual(all);
    expect(ids({ genre: "" })).toEqual(all);
  });

  it("composes with the language tab, the platform chip, the region and free text", () => {
    // The radar's Arabic tab is { region: "SA", lang: "ar" }; its English tab is { lang: "en" }.
    expect(ids({ region: "SA", lang: "ar", genre: "cars" })).toEqual(["cars-ar", "cars-tt"]);
    expect(ids({ lang: "en", genre: "cars" })).toEqual(["cars-en", "cars-tt"]);
    expect(ids({ region: "SA", lang: "ar", platform: "tiktok", genre: "cars" })).toEqual([
      "cars-tt",
    ]);
    expect(ids({ lang: "en", platform: "youtube", genre: "cars" })).toEqual(["cars-en"]);
    expect(ids({ lang: "en", genre: "food" })).toEqual([]);
    expect(ids({ platform: "google", genre: "cars" })).toEqual([]);
    expect(ids({ genre: "cars", q: "cars-e" })).toEqual(["cars-en"]);
  });

  it("an old feed without genres parses and has nothing under any genre", () => {
    const old = { ...EMPTY_TRENDS, items: [item({ id: "a" }), item({ id: "b", score: 10 })] };
    expect(old.items.every((i) => i.genre === undefined)).toBe(true);
    expect(visibleTrends(old, { genre: "cars" }, NOW)).toEqual([]);
    expect(visibleTrends(old, {}, NOW)).toHaveLength(2);
  });
});

describe("trendGenreLabel", () => {
  const drift: CustomGenre = { id: "custom-drift", name: "Drift", query: "drift edit" };

  it("names a genre the app knows with its emoji, in the UI language", () => {
    expect(trendGenreLabel("cars", allGenres([]), "ar")).toBe("🚗 سيارات");
    expect(trendGenreLabel("cars", allGenres([]), "en")).toBe("🚗 Cars");
    expect(trendGenreLabel("food", allGenres([drift]), "ar")).toBe("🍔 أكل ومطاعم");
    expect(trendGenreLabel("custom-drift", allGenres([drift]), "ar")).toBe("✨ Drift");
    expect(trendGenreLabel("custom-drift", allGenres([drift]), "en")).toBe("✨ Drift");
  });

  it("shows an id the app does not know as it is", () => {
    expect(trendGenreLabel("drone", allGenres([drift]), "ar")).toBe("drone");
    expect(trendGenreLabel("custom-drift", allGenres([]), "en")).toBe("custom-drift");
    expect(trendGenreLabel("Cars", allGenres([]), "en")).toBe("Cars");
    expect(trendGenreLabel("constructor", allGenres([]), "en")).toBe("constructor");
  });
});

describe("trendGenreHref (the genre chip opens Discover)", () => {
  const drift: CustomGenre = { id: "custom-drift", name: "Drift", query: "drift edit" };
  const hajwala: CustomGenre = { id: "custom-هجولة", name: "هجولة", query: "ايديت هجولة" };

  it("links a genre the app knows to Discover opened on it", () => {
    expect(trendGenreHref("cars", allGenres([]))).toBe("/discover/?genre=cars");
    expect(trendGenreHref("food", allGenres([drift]))).toBe("/discover/?genre=food");
    expect(trendGenreHref("custom-drift", allGenres([drift]))).toBe(
      "/discover/?genre=custom-drift",
    );
    for (const g of allGenres([drift, hajwala])) {
      expect(trendGenreHref(g.id, allGenres([drift, hajwala]))).toBe(discoverGenreHref(g.id));
    }
  });

  it("encodes an id of any script, and Discover reads the same id back", () => {
    const href = trendGenreHref("custom-هجولة", allGenres([hajwala]));
    expect(href).toBe(`/discover/?genre=${encodeURIComponent("custom-هجولة")}`);
    expect(genreIdFromSearch(href!.slice(href!.indexOf("?")))).toBe("custom-هجولة");
  });

  it("has no link for an id the app does not know (the chip stays plain)", () => {
    expect(trendGenreHref("drone", allGenres([drift]))).toBeUndefined();
    expect(trendGenreHref("custom-drift", allGenres([]))).toBeUndefined();
    expect(trendGenreHref("Cars", allGenres([]))).toBeUndefined();
    expect(trendGenreHref("constructor", allGenres([]))).toBeUndefined();
    expect(trendGenreHref("", allGenres([drift]))).toBeUndefined();
    expect(trendGenreHref("cars", [])).toBeUndefined();
  });

  it("links exactly the genres the chip names, never a raw id", () => {
    const genres = allGenres([drift]);
    for (const id of ["travel", "custom-drift", "drone", "cars", "all"]) {
      const named = trendGenreLabel(id, genres, "en") !== id;
      expect(trendGenreHref(id, genres) !== undefined, id).toBe(named);
    }
  });
});

describe("the radar's genre messages", () => {
  it("names the chip's link with the genre in both languages, and the select's label is gone", () => {
    expect(ar["trends.genreOpen"]).toContain("{genre}");
    expect(en["trends.genreOpen"]).toContain("{genre}");
    expect(Object.keys(ar)).not.toContain("trends.genreLabel");
    expect(Object.keys(en)).not.toContain("trends.genreLabel");
  });
});

describe("genre rows from the Worker (lib/trendsClient → visibleTrends)", () => {
  it("GET /trends keeps a row's genre, so the stored feed can be read by genre (Discover's strip)", async () => {
    const seenAt = "2026-09-28T06:00:00.000Z";
    const row = { platform: "youtube", region: "SA", lang: "ar", source: "YouTube search", seenAt };
    const body = {
      items: [
        { ...row, id: "youtube:SA:a", title: "ايديت سيارات", genre: "cars" },
        { ...row, id: "youtube:SA:b", title: "مونتاج سفر", genre: "travel" },
        { ...row, id: "youtube:SA:c", title: "مونتاج بالجوال" },
      ],
      fetchedAt: seenAt,
    };
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
    );
    const r = await fetchTrends({ url: "https://scout.test", token: "tok" }, { fetchImpl });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.feed.items.map((i) => i.genre)).toEqual(["cars", "travel", undefined]);
    const state = { ...r.feed, dismissed: [] };
    expect(visibleTrends(state, { genre: "travel" }, NOW).map((i) => i.id)).toEqual([
      "youtube:SA:b",
    ]);
    expect(visibleTrends(state, { genre: "cars" }, NOW).map((i) => i.id)).toEqual(["youtube:SA:a"]);
    expect(visibleTrends(state, {}, NOW)).toHaveLength(3);
  });
});

describe("trendsStale", () => {
  it("is stale when never fetched, unreadable, or older than the max age", () => {
    expect(trendsStale(null, NOW)).toBe(true);
    expect(trendsStale("not a date", NOW)).toBe(true);
    expect(trendsStale("2026-09-28T03:00:00.000Z", NOW)).toBe(true);
    expect(trendsStale("2026-09-28T05:00:00.000Z", NOW)).toBe(false);
    expect(trendsStale("2026-09-28T05:00:00.000Z", NOW, 1)).toBe(true);
    expect(trendsStale("2026-09-28T04:00:00.000Z", NOW, 6)).toBe(false);
  });
});

describe("trendIdeaText", () => {
  it("prefixes the title in the owner's language and credits the source", () => {
    const i = item({ id: "x", title: "حساب المواطن", source: "Google Trends" });
    expect(trendIdeaText(i, "ar")).toBe("📈 ترند: حساب المواطن (Google Trends)");
    expect(trendIdeaText(i, "en")).toBe("📈 Trend: حساب المواطن (Google Trends)");
  });
});

describe("savedTrendIdea", () => {
  const i = item({ id: "x", title: "حساب المواطن", source: "Google Trends" });
  const idea = (over: Partial<Idea>): Idea => ({
    id: "idea-1",
    text: trendIdeaText(i, "ar"),
    source: "trend",
    createdAt: "2026-09-28T06:00:00.000Z",
    ...over,
  });

  it("finds the idea whichever UI language saved it", () => {
    expect(savedTrendIdea([idea({})], i)?.id).toBe("idea-1");
    expect(savedTrendIdea([idea({ text: trendIdeaText(i, "en") })], i)?.id).toBe("idea-1");
  });

  it("ignores other trends and non-trend ideas with the same text", () => {
    const other = item({ id: "y", title: "غيره", source: "Google Trends" });
    expect(savedTrendIdea([idea({})], other)).toBeUndefined();
    expect(savedTrendIdea([idea({ source: "me" })], i)).toBeUndefined();
    expect(savedTrendIdea([], i)).toBeUndefined();
  });
});

describe("sourceLabel", () => {
  const dict = (d: Record<string, string>) => (key: string) => d[key] ?? key;

  it("maps every Worker source label to a message in both languages", () => {
    for (const key of Object.values(SOURCE_KEY)) {
      expect(ar).toHaveProperty([key]);
      expect(en).toHaveProperty([key]);
    }
    expect(sourceLabel("YouTube charts", dict(ar))).toBe("قوائم YouTube");
    expect(sourceLabel("Tavily scan", dict(ar))).toBe("فحص Tavily");
    expect(sourceLabel("3z calendar", dict(ar))).toBe("تقويم 3z");
    expect(sourceLabel("YouTube charts", dict(en))).toBe("YouTube charts");
    expect(sourceLabel("trends24.in", dict(en))).toBe("trends24.in");
  });

  it("shows an unknown label verbatim, including Object.prototype names", () => {
    expect(sourceLabel("Some new source", dict(ar))).toBe("Some new source");
    expect(sourceLabel("constructor", dict(ar))).toBe("constructor");
  });
});

describe("volumeLabelKey (the volume chip names what its number counts)", () => {
  const at = (source: string, platform: TrendItem["platform"] = "google") => ({ source, platform });
  const words = (d: Record<string, string>, source: string, platform?: TrendItem["platform"]) => {
    const key = volumeLabelKey(at(source, platform));
    return key && d[key].replace("{n}", "105M");
  };

  it("keeps searches for Google Trends only", () => {
    expect(volumeLabelKey(at("Google Trends"))).toBe("trends.volume");
    expect(volumeUnit(at("Google Trends"))).toBe("searches");
    expect(words(en, "Google Trends")).toBe("105M searches");
    expect(words(ar, "Google Trends")).toBe("105M بحث");
  });

  it("calls a YouTube row's number views (the Worker writes the video's view count), charts and search alike", () => {
    for (const source of ["YouTube charts", "YouTube search"]) {
      expect(volumeLabelKey(at(source, "youtube")), source).toBe("trends.views");
      expect(volumeUnit(at(source, "youtube")), source).toBe("views");
      expect(words(en, source, "youtube")).toBe("105M views");
      expect(words(ar, source, "youtube")).toBe("105M مشاهدة");
      expect(words(en, source, "youtube")).not.toContain("searches");
    }
  });

  it("calls the Tavily scan's number pages, whichever platform the row's link is on", () => {
    for (const platform of ["tiktok", "instagram", "youtube", "x"] as const) {
      expect(volumeLabelKey(at("Tavily scan", platform)), platform).toBe("trends.pages");
      expect(volumeUnit(at("Tavily scan", platform)), platform).toBe("pages");
    }
    expect(words(en, "Tavily scan", "tiktok")).toBe("105M pages");
    expect(words(ar, "Tavily scan", "tiktok")).toBe("105M صفحة");
  });

  it("calls trends24.in's number posts", () => {
    expect(volumeLabelKey(at("trends24.in", "x"))).toBe("trends.posts");
    expect(volumeUnit(at("trends24.in", "x"))).toBe("posts");
    expect(words(en, "trends24.in", "x")).toBe("105M posts");
    expect(words(ar, "trends24.in", "x")).toBe("105M تغريدة");
  });

  it("has no unit for a source without a volume, an unknown label, or none at all", () => {
    for (const source of [
      "kworb.net",
      "3z calendar",
      "Some new source",
      "google trends",
      "constructor",
      "toString",
      "",
    ]) {
      expect(volumeLabelKey(at(source, "youtube")), source).toBeUndefined();
      expect(volumeUnit(at(source, "youtube")), source).toBeUndefined();
    }
    const missing = { platform: "youtube" } as Pick<TrendItem, "source" | "platform">;
    expect(volumeLabelKey(missing)).toBeUndefined();
    expect(volumeUnit(missing)).toBeUndefined();
  });

  it("takes a whole feed row, and knows only the Worker's source labels", () => {
    expect(volumeLabelKey(item({ id: "g" }))).toBe("trends.volume");
    expect(volumeLabelKey(item({ id: "v", platform: "youtube", source: "YouTube search" }))).toBe(
      "trends.views",
    );
    for (const source of Object.keys(VOLUME_UNIT)) expect(SOURCE_KEY).toHaveProperty([source]);
  });

  it("says every unit in both languages, with the number, and leaves the searches wording as it was", () => {
    const keys = new Set(Object.keys(VOLUME_UNIT).map((s) => volumeLabelKey(at(s))!));
    expect([...keys].sort()).toEqual([
      "trends.pages",
      "trends.posts",
      "trends.views",
      "trends.volume",
    ]);
    for (const key of keys) {
      expect(ar[key as keyof typeof ar], key).toContain("{n}");
      expect(en[key as keyof typeof en], key).toContain("{n}");
    }
    expect(en["trends.volume"]).toBe("{n} searches");
    expect(ar["trends.volume"]).toBe("{n} بحث");
  });
});

describe("upcomingEvents", () => {
  const events = [
    event({ id: "past", date: "2026-09-23" }),
    event({ id: "running", date: "2026-09-20", endDate: "2026-10-05" }),
    event({ id: "today", date: "2026-09-28" }),
    event({ id: "soon", date: "2026-10-21", endDate: "2026-12-31" }),
    event({ id: "far", date: "2027-02-22" }),
    event({ id: "edge", date: "2026-11-27" }),
  ];

  it("keeps running and future events within the window, sorted by date, with days until start", () => {
    expect(upcomingEvents(events, "2026-09-28").map((u) => [u.event.id, u.inDays])).toEqual([
      ["running", 0],
      ["today", 0],
      ["soon", 23],
      ["edge", 60],
    ]);
    expect(upcomingEvents(events, "2026-09-28", 30).map((u) => u.event.id)).toEqual([
      "running",
      "today",
      "soon",
    ]);
    expect(upcomingEvents(events, "2026-09-28", 200).map((u) => u.event.id)).toContain("far");
  });

  it("drops an event the day after its last day", () => {
    expect(upcomingEvents(events, "2026-10-05").map((u) => u.event.id)).toContain("running");
    expect(upcomingEvents(events, "2026-10-06").map((u) => u.event.id)).not.toContain("running");
    expect(upcomingEvents([], "2026-10-06")).toEqual([]);
  });
});

describe("eventToTrendItem", () => {
  it("builds a valid SA event row with the hashtags as context, expiring after the last day", () => {
    const e = event({
      id: "riyadh-season-2026",
      date: "2026-10-21",
      endDate: "2026-12-31",
      name: { ar: "موسم الرياض", en: "Riyadh Season" },
      hashtags: ["#موسم_الرياض", "#RiyadhSeason"],
      kind: "season",
    });
    const row = eventToTrendItem(e, "2026-09-28T10:00:00.000Z");
    expect(TrendItemSchema.safeParse(row).success).toBe(true);
    expect(row).toMatchObject({
      id: "event:SA:riyadh-season-2026",
      platform: "event",
      region: "SA",
      lang: "mixed",
      title: "موسم الرياض · Riyadh Season",
      source: "3z calendar",
      why: "#موسم_الرياض #RiyadhSeason",
      seenAt: "2026-09-28T10:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00+03:00",
      tags: ["season", "#موسم_الرياض", "#RiyadhSeason"],
    });
    expect(matchesKeywords(row, ["riyadhseason"])).toBe(true);
  });

  it("leaves `why` out when the event has no hashtags and expires the day after a one-day event", () => {
    const row = eventToTrendItem(event({ id: "flag", date: "2027-03-11" }), "2027-03-01T00:00:00Z");
    expect(row.why).toBeUndefined();
    expect(row.expiresAt).toBe("2027-03-12T00:00:00+03:00");
  });
});
