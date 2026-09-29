import { describe, expect, it } from "vitest";
import {
  EMPTY_TRENDS,
  TrendItemSchema,
  type Idea,
  type SaudiEvent,
  type TrendItem,
} from "./domain";
import en from "@/messages/trends.en.json";
import ar from "@/messages/trends.ar.json";
import {
  DEFAULT_TREND_KEYWORDS,
  eventToTrendItem,
  matchesKeywords,
  normalizeTrendText,
  SOURCE_KEY,
  savedTrendIdea,
  sourceLabel,
  trendIdeaText,
  trendsStale,
  upcomingEvents,
  visibleTrends,
} from "./trends";

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
