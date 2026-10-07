// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedCategory,
  categoryScanInFlight,
  fetchCategory,
  fetchCategoryTop,
  pageState,
  parseCategory,
  runCategoryNow,
} from "./categories";

// 🚗 Category pages in Discover (planning/tools/19-category-trends.md §1): the Worker's answer checked field by field,
// the page's state, and the 1 h copy per Worker and category in this tab's sessionStorage (jsdom's).

const config = { url: "https://w.example", token: "t" };
const NOW = Date.parse("2026-10-07T12:00:00Z");
const ROLLING = {
  key: "rolling-shot",
  name: { en: "rolling shot", ar: "لقطة متحركة" },
  isNew: true,
  checked: true,
  creators: 4,
  posts: 4,
  platforms: ["ig", "tt"],
  growth: 3,
  samples: [],
};
const HOW = {
  en: "Shoot from a moving car at 1/30 s, keep the car sharp, then smooth it in the edit.",
  ar: "صوّر من سيارة ماشية على 1/30، خلّ السيارة حادة، وبعدين نعّمها في المونتاج.",
};
const TT = {
  url: "https://www.tiktok.com/@c/video/1",
  title: "rollers",
  platform: "tt",
  kind: "example",
  lang: "en",
};
const YT = {
  url: "https://www.youtube.com/watch?v=rollTut0001",
  title: "Rolling shot tutorial",
  platform: "yt",
  kind: "tutorial",
  lang: "en",
};
const TECH = {
  name: { en: "rolling shot", ar: "لقطة متحركة" },
  howTo: HOW,
  skillId: "phone-180-shutter",
  videos: [TT, YT],
};
const LESSONS = { updatedAt: "2026-10-07T05:41:00Z", photo: [], video: [TECH], edit: [] };
/** `GET /categories/cars` (workers/scout/src/categories/routes.ts). */
const DOC = { status: "ok", updatedAt: "2026-10-07T05:40:00Z", items: [ROLLING], lessons: LESSONS };
const replying = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => sessionStorage.clear());

describe("parseCategory", () => {
  it("keeps the trends and lessons the page uses", () => {
    expect(parseCategory(DOC)).toEqual({
      status: "ok",
      updatedAt: DOC.updatedAt,
      items: [{ key: "rolling-shot", name: ROLLING.name, isNew: true, creators: 4, growth: 3 }],
      lessons: LESSONS,
    });
  });

  it("drops a broken video, a technique left without a video or an English text, and lessons left empty", () => {
    const broken = {
      ...DOC,
      lessons: {
        ...LESSONS,
        photo: [{ ...TECH, videos: [{ ...TT, platform: "fb" }] }], // no video left
        video: [{ ...TECH, skillId: 7, videos: [TT, { ...YT, kind: "talk" }] }], // one video, no skill left
        edit: [
          { ...TECH, howTo: { ar: HOW.ar } }, // no English how-to
          { ...TECH, name: { en: " ", ar: "لقطة" } }, // no English name
        ],
      },
    };
    expect(parseCategory(broken)!.lessons).toEqual({
      updatedAt: LESSONS.updatedAt,
      photo: [],
      video: [{ name: TECH.name, howTo: HOW, videos: [TT] }],
      edit: [],
    });
    const empty = { ...DOC, lessons: { updatedAt: "x", photo: [], video: [], edit: [] } };
    expect(parseCategory(empty)).not.toHaveProperty("lessons");
    expect(parseCategory({ status: "never", items: [] })).toEqual({ status: "never", items: [] });
    expect(parseCategory({ items: [] })).toBeNull();
  });

  it("English first (live fix 1): the Arabic name and how-to are optional, and kept only in Arabic script", () => {
    const doc = {
      ...DOC,
      lessons: {
        ...LESSONS,
        video: [
          { ...TECH, name: { en: "rolling shot" }, howTo: { en: HOW.en } },
          // The first live Cars lessons: Arabic names in Latin letters.
          { ...TECH, name: { en: "hyperlapse", ar: "taswir mash' al" }, howTo: HOW },
        ],
      },
    };
    expect(parseCategory(doc)!.lessons!.video.map((t) => [t.name, t.howTo])).toEqual([
      [{ en: "rolling shot" }, { en: HOW.en }],
      [{ en: "hyperlapse" }, HOW],
    ]);
  });

  it("keeps https videos only, 3 techniques a shelf and 4 videos a technique, as the Worker writes them", () => {
    const tech = (n: number, videos: unknown[]) => ({
      ...TECH,
      name: { en: `t${n}`, ar: `ت${n}` },
      videos,
    });
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({
      ...TT,
      url: `https://www.tiktok.com/@c/video/${n}`,
    }));
    const doc = {
      ...DOC,
      lessons: {
        ...LESSONS,
        photo: [1, 2, 3, 4, 5].map((n) => tech(n, [TT, YT])),
        video: [
          tech(6, [
            { ...TT, url: "http://www.tiktok.com/@c/video/1" },
            { ...YT, url: "javascript:alert(1)" },
            YT,
          ]),
        ],
        // 3 English videos and 1 Arabic tutorial at most.
        edit: [tech(7, six)],
      },
    };
    const lessons = parseCategory(doc)!.lessons!;
    expect(lessons.photo.map((t) => t.name.en)).toEqual(["t1", "t2", "t3"]);
    expect(lessons.video[0].videos).toEqual([YT]);
    expect(lessons.edit[0].videos).toEqual(six.slice(0, 4));
  });
});

describe("parseCategory's top videos (§6)", () => {
  const V = {
    url: "https://www.youtube.com/watch?v=carVid00001",
    title: "Car edit",
    creator: "Car Channel",
    views: 1200,
    thumbnail: "https://i.ytimg.com/vi/carVid00001/mqdefault.jpg",
  };

  it("keeps each list's https videos with a title, entry by entry, ≤ 50 a platform", () => {
    const top = {
      updatedAt: "2026-10-07T05:40:00Z",
      yt: [
        V,
        { ...V, url: "http://www.youtube.com/watch?v=carVid00002" },
        { ...V, url: "javascript:alert(1)" },
        { ...V, title: " " },
        // Odd optional fields are left out, the video kept.
        { ...V, creator: 5, views: "lots", thumbnail: "http://x.example/t.jpg" },
        null,
      ],
      tt: "soon",
      ig: Array.from({ length: 60 }, (_, i) => ({
        url: `https://www.instagram.com/p/P${i}`,
        title: `reel ${i}`,
      })),
    };
    const parsed = parseCategory({ ...DOC, top })!.top!;
    expect(parsed.updatedAt).toBe(top.updatedAt);
    expect(parsed.yt).toEqual([V, { url: V.url, title: V.title }]);
    expect(parsed.tt).toEqual([]);
    expect(parsed.ig).toEqual(top.ig.slice(0, 50));
  });

  it("has none for a page from before §6, or a top without its date", () => {
    expect(parseCategory(DOC)).not.toHaveProperty("top");
    expect(parseCategory({ ...DOC, top: { yt: [V] } })).not.toHaveProperty("top");
    expect(parseCategory({ ...DOC, top: "soon" })).not.toHaveProperty("top");
  });
});

describe("fetchCategoryTop", () => {
  it("C3: keeps the stored list and Brave's own group apart, and the source; checked like the stored ones; kept nowhere (Brave's terms)", async () => {
    const scan = { url: "https://www.tiktok.com/@s/video/9", title: "scan post" };
    const tt = { url: "https://www.tiktok.com/@c/video/1", title: "Car edit | TikTok", views: 5 };
    const f = replying({
      platform: "tt",
      scan: [scan],
      brave: [tt, { url: "http://www.tiktok.com/@c/video/2", title: "plain http" }],
      source: "brave",
      endpoint: "videos",
    });
    expect(await fetchCategoryTop(config, "cars", "tt", { fetchImpl: f })).toEqual({
      scan: [scan],
      brave: [tt],
      source: "brave",
    });
    expect(String(f.mock.calls[0][0])).toBe("https://w.example/categories/cars/top/tt");
    expect(sessionStorage.length).toBe(0);
    const noKey = replying({ platform: "ig", scan: [], brave: [], source: "scan", note: "no_key" });
    expect(await fetchCategoryTop(config, "cars", "ig", { fetchImpl: noKey })).toEqual({
      scan: [],
      brave: [],
      source: "scan",
      note: "no_key",
    });
    const odd = replying({ scan: [], brave: [], source: "who", note: "who knows" });
    expect(await fetchCategoryTop(config, "cars", "tt", { fetchImpl: odd })).toEqual({
      scan: [],
      brave: [],
      source: "scan",
    });
  });

  it("is null when the request fails or answers no lists", async () => {
    for (const f of [
      replying({ error: "upstream" }, 502),
      replying({ items: [] }),
      replying({ scan: [], brave: "none" }),
    ])
      expect(await fetchCategoryTop(config, "cars", "tt", { fetchImpl: f })).toBeNull();
  });
});

describe("the tab's copy (B7)", () => {
  it("keeps no page without lessons: a scan's lessons are saved after its trends, and the next open asks again", async () => {
    const trendsOnly = { ...DOC, lessons: undefined };
    const f = replying(trendsOnly);
    await fetchCategory(config, "cars", { fetchImpl: f, now: NOW });
    await fetchCategory(config, "cars", { fetchImpl: f, now: NOW });
    expect(f).toHaveBeenCalledTimes(2);
    expect(cachedCategory(config, "cars", NOW)).toBeNull();
    await runCategoryNow(config, "cars", { fetchImpl: replying(trendsOnly) });
    expect(cachedCategory(config, "cars")).toBeNull();
    // With its lessons it is kept, as before.
    await fetchCategory(config, "cars", { fetchImpl: replying(DOC), now: NOW });
    expect(cachedCategory(config, "cars", NOW)).toEqual(parseCategory(DOC));
  });
});

describe("pageState", () => {
  const data = (over: object) => parseCategory({ ...DOC, ...over })!;
  it("the first scan before anything shows; the old page after a failed update; else the page", () => {
    expect(pageState(data({ status: "never", items: [], lessons: undefined }))).toBe("never");
    expect(pageState(data({ status: "failed", items: [], lessons: undefined }))).toBe("never");
    expect(pageState(data({ status: "failed" }))).toBe("stale");
    expect(pageState(data({ status: "failed", items: [] }))).toBe("stale"); // lessons only
    expect(pageState(data({ status: "partial" }))).toBe("page");
    expect(pageState(data({ items: [], lessons: undefined }))).toBe("page"); // a scan that found nothing
  });
});

describe("fetchCategory", () => {
  it("asks the Worker at most once an hour per Worker and category", async () => {
    const f = replying(DOC);
    expect(await fetchCategory(config, "cars", { fetchImpl: f, now: NOW })).toEqual(
      parseCategory(DOC),
    );
    await fetchCategory(config, "cars", { fetchImpl: f, now: NOW + 59 * 60_000 });
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe("https://w.example/categories/cars");
    await fetchCategory(config, "food", { fetchImpl: f, now: NOW });
    await fetchCategory(config, "cars", { fetchImpl: f, now: NOW + 61 * 60_000 });
    expect(f).toHaveBeenCalledTimes(3);
    expect(cachedCategory(config, "cars", NOW + 61 * 60_000)).toEqual(parseCategory(DOC));
  });

  it("is null for an older Worker (404) or no network, keeping nothing; 'never' is not kept", async () => {
    expect(
      await fetchCategory(config, "cars", { fetchImpl: replying({ error: "not_found" }, 404) }),
    ).toBeNull();
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    expect(await fetchCategory(config, "cars", { fetchImpl: offline })).toBeNull();
    const never = replying({ status: "never", items: [] });
    await fetchCategory(config, "cars", { fetchImpl: never, now: NOW });
    await fetchCategory(config, "cars", { fetchImpl: never, now: NOW });
    expect(never).toHaveBeenCalledTimes(2);
  });
});

describe("runCategoryNow", () => {
  it("one POST per category at a time; Scan again sends { force: true }; the answer is kept", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const f = vi.fn<typeof fetch>(async () => {
      await gate;
      return new Response(JSON.stringify(DOC));
    });
    const a = runCategoryNow(config, "cars", { fetchImpl: f });
    const b = runCategoryNow(config, "cars", { fetchImpl: f });
    expect(categoryScanInFlight(config, "cars")).toBeDefined();
    release();
    expect(await a).toEqual(parseCategory(DOC));
    expect(await b).toEqual(parseCategory(DOC));
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0][0])).toBe("https://w.example/categories/cars/run");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(f.mock.calls[0][1]?.body).toBeUndefined();
    expect(categoryScanInFlight(config, "cars")).toBeUndefined();
    expect(cachedCategory(config, "cars")).toEqual(parseCategory(DOC));
    const forced = replying(DOC);
    await runCategoryNow(config, "cars", { fetchImpl: forced, force: true });
    expect(JSON.parse(String(forced.mock.calls[0][1]?.body))).toEqual({ force: true });
  });

  it("is null when the scan request fails", async () => {
    expect(
      await runCategoryNow(config, "cars", { fetchImpl: replying({ error: "upstream" }, 502) }),
    ).toBeNull();
  });
});
