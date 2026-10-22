// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedTrendingEffects,
  effectQuery,
  fetchTrendingEffects,
  parseTrendingEffects,
  rowVisible,
  runTrendingEffectsNow,
  scanInFlight,
} from "./effects";

// 🔥 Trending effects in Discover (planning/tools/18-trending-effects.md §4): the Worker's answer checked field by
// field, which state the row is in, what a chip searches, and the 1 h cache in this tab's sessionStorage (jsdom's).

const config = { url: "https://w.example", token: "t" };
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-10-06T12:00:00Z");

/** A dictionary effect as the Worker stores it (EffectItem, workers/scout/src/effects/types.ts). */
const CLONE = {
  key: "clone-effect",
  name: { en: "clone effect", ar: "تأثير الاستنساخ" },
  what: { en: "You show up twice in one shot", ar: "تطلع مرتين في نفس اللقطة" },
  termId: "clone-effect",
  isNew: false,
  checked: true,
  creators: 9,
  posts: 14,
  platforms: ["ig", "tt"],
  growth: 1.5,
  youtube: { newVideos: 20, views7d: 180000, growth: 3 },
  samples: [{ url: "https://www.tiktok.com/@ed/video/1", title: "clone yourself" }],
};
/** A new name the AI approved, not in the dictionary yet. */
const SWAGGER = {
  key: "swagger-trend",
  name: { en: "swagger trend" },
  isNew: true,
  checked: true,
  creators: 4,
  posts: 5,
  platforms: ["tt"],
  growth: 3,
  samples: [],
};
/** `GET /effects/trending` (workers/scout/src/effects/routes.ts): the stored document without its memory. */
const DOC = {
  status: "ok",
  ranOn: "2026-10-06",
  updatedAt: "2026-10-06T05:35:12Z",
  items: [CLONE, SWAGGER],
};

/** A Worker that always gives this reply. */
const replying = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

beforeEach(() => sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("parseTrendingEffects", () => {
  it("keeps what the row uses from a valid answer", () => {
    expect(parseTrendingEffects(DOC)).toEqual({
      status: "ok",
      updatedAt: "2026-10-06T05:35:12Z",
      items: [
        {
          key: "clone-effect",
          name: { en: "clone effect", ar: "تأثير الاستنساخ" },
          what: { en: "You show up twice in one shot", ar: "تطلع مرتين في نفس اللقطة" },
          termId: "clone-effect",
          isNew: false,
          creators: 9,
          growth: 1.5,
          youtube: { newVideos: 20, views7d: 180000, growth: 3 },
        },
        {
          key: "swagger-trend",
          name: { en: "swagger trend" },
          isNew: true,
          creators: 4,
          growth: 3,
        },
      ],
    });
    // Before the Worker's first run.
    expect(parseTrendingEffects({ status: "never", items: [] })).toEqual({
      status: "never",
      items: [],
    });
  });

  it("keeps the run's notes (the row reads 'attempts'), their strings only", () => {
    const over = { status: "failed", ranOn: "2026-10-06", items: [] };
    expect(parseTrendingEffects({ ...over, notes: ["quota", "attempts", 7, null] })).toEqual({
      status: "failed",
      notes: ["quota", "attempts"],
      items: [],
    });
    expect(parseTrendingEffects({ ...over, notes: "attempts" })).toEqual({
      status: "failed",
      items: [],
    });
  });

  it("a partial run (the AI or YouTube step skipped): effects without their line or YouTube figures", () => {
    expect(
      parseTrendingEffects({
        ...DOC,
        status: "partial",
        notes: ["ai_fallback", "youtube_cap"],
        items: [{ ...CLONE, what: undefined, youtube: undefined, checked: false }],
      }),
    ).toEqual({
      status: "partial",
      updatedAt: "2026-10-06T05:35:12Z",
      notes: ["ai_fallback", "youtube_cap"],
      items: [
        {
          key: "clone-effect",
          name: { en: "clone effect", ar: "تأثير الاستنساخ" },
          termId: "clone-effect",
          isNew: false,
          creators: 9,
          growth: 1.5,
        },
      ],
    });
  });

  it("drops a broken effect or the broken part of one, and keeps at most 12", () => {
    const parsed = parseTrendingEffects({
      ...DOC,
      items: [
        null,
        { ...CLONE, key: 7 },
        { ...CLONE, name: "clone effect" },
        // No English name: nothing a tap could search.
        { ...CLONE, name: { ar: "تأثير الاستنساخ" } },
        { ...CLONE, name: { en: "  ", ar: "تأثير الاستنساخ" } },
        { ...CLONE, creators: "9" },
        { ...CLONE, growth: Infinity },
        {
          ...CLONE,
          key: "odd-parts",
          name: { en: "odd parts", ar: 5 },
          what: { ar: "سطر بلا إنجليزي" },
          termId: 3,
          isNew: "yes",
          youtube: { newVideos: 4, views7d: 900, growth: "3" },
        },
        { ...CLONE, key: "no-views", youtube: { newVideos: 4, views7d: "many" } },
        ...Array.from({ length: 12 }, (_, i) => ({ ...SWAGGER, key: `fx-${i}` })),
      ],
    });
    expect(parsed!.items[0]).toEqual({
      key: "odd-parts",
      name: { en: "odd parts" },
      isNew: false,
      creators: 9,
      growth: 1.5,
      youtube: { newVideos: 4, views7d: 900 },
    });
    expect(parsed!.items[1]).not.toHaveProperty("youtube");
    expect(parsed!.items.map((e) => e.key)).toEqual([
      "odd-parts",
      "no-views",
      ...Array.from({ length: 10 }, (_, i) => `fx-${i}`),
    ]);
  });

  it("keeps an Arabic name or line only in Arabic script (live fix 1: English first, Arabic only when it is Arabic)", () => {
    const parsed = parseTrendingEffects({
      ...DOC,
      items: [
        {
          ...CLONE,
          name: { en: "clone effect", ar: "ta'thir al-istinsakh" },
          what: { en: "You show up twice in one shot", ar: "tatla' marratain" },
        },
      ],
    });
    expect(parsed!.items[0]).toMatchObject({
      name: { en: "clone effect" },
      what: { en: "You show up twice in one shot" },
    });
    expect(parsed!.items[0].name).not.toHaveProperty("ar");
    expect(parsed!.items[0].what).not.toHaveProperty("ar");
  });

  it("is null for a broken answer", () => {
    for (const raw of [
      null,
      "ok",
      [],
      {},
      { items: [] },
      { status: "ok" },
      { status: "ok", items: {} },
      { status: "done", items: [] },
    ])
      expect(parseTrendingEffects(raw), JSON.stringify(raw)).toBeNull();
  });
});

describe("rowVisible", () => {
  const at = (age: number) => new Date(NOW - age).toISOString();
  const items = parseTrendingEffects(DOC)!.items;

  it("hidden without an answer; the first-scan button before the first run; the list; a failed run's list", () => {
    expect(rowVisible(null, NOW)).toBe("hidden");
    expect(rowVisible({ status: "never", items: [] }, NOW)).toBe("never");
    expect(rowVisible({ status: "ok", updatedAt: at(2 * HOUR), items }, NOW)).toBe("list");
    expect(rowVisible({ status: "partial", updatedAt: at(2 * HOUR), items }, NOW)).toBe("list");
    expect(rowVisible({ status: "failed", updatedAt: at(2 * DAY), items }, NOW)).toBe(
      "stale-failed",
    );
  });

  it("hides a list older than 3 days, or one that does not say when it was made", () => {
    expect(rowVisible({ status: "ok", updatedAt: at(3 * DAY), items }, NOW)).toBe("list");
    expect(rowVisible({ status: "ok", updatedAt: at(3 * DAY + 1), items }, NOW)).toBe("hidden");
    expect(rowVisible({ status: "failed", updatedAt: at(3 * DAY + 1), items }, NOW)).toBe("hidden");
    expect(rowVisible({ status: "ok", items }, NOW)).toBe("hidden");
    expect(rowVisible({ status: "ok", updatedAt: "yesterday", items }, NOW)).toBe("hidden");
  });

  it("hides a run that found nothing", () => {
    expect(rowVisible({ status: "ok", updatedAt: at(HOUR), items: [] }, NOW)).toBe("hidden");
    expect(rowVisible({ status: "partial", updatedAt: at(HOUR), items: [] }, NOW)).toBe("hidden");
  });

  it("offers the first scan again when every run so far failed (no list yet), however long ago", () => {
    expect(rowVisible({ status: "failed", updatedAt: at(HOUR), items: [] }, NOW)).toBe("never");
    // A failed run keeps its first failure's time: the button stays past 3 days, or with no time at all.
    expect(rowVisible({ status: "failed", updatedAt: at(5 * DAY), items: [] }, NOW)).toBe("never");
    expect(rowVisible({ status: "failed", items: [] }, NOW)).toBe("never");
  });
});

it("effectQuery: a dictionary effect searches its dictionary label (the English name the Worker sends), a new one its English name", () => {
  const [clone, swagger] = parseTrendingEffects(DOC)!.items;
  expect(effectQuery(clone)).toBe("clone effect");
  expect(effectQuery(swagger)).toBe("swagger trend");
});

describe("fetchTrendingEffects", () => {
  it("asks the Worker at most once an hour per Worker", async () => {
    const fetchImpl = replying(DOC);
    const first = await fetchTrendingEffects(config, { fetchImpl, now: NOW });
    expect(first).toEqual(parseTrendingEffects(DOC));
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://w.example/effects/trending");
    expect(init?.method).toBeUndefined();
    expect(init?.headers).toEqual({ Authorization: "Bearer t" });

    expect(await fetchTrendingEffects(config, { fetchImpl, now: NOW + HOUR - 1 })).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledOnce();
    // The same copy, read at once (no request): what a revisit renders first.
    expect(cachedTrendingEffects(config, NOW + HOUR - 1)).toEqual(first);
    expect(cachedTrendingEffects(config, NOW + HOUR)).toBeNull();
    expect(cachedTrendingEffects({ ...config, url: "https://other.example" }, NOW)).toBeNull();
    // Another Worker has its own list.
    await fetchTrendingEffects(
      { ...config, url: "https://other.example" },
      { fetchImpl, now: NOW },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    // An hour on: asked again.
    await fetchTrendingEffects(config, { fetchImpl, now: NOW + HOUR });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("is null for an older Worker (404), a refused token, no network or a broken answer, and keeps none", async () => {
    const notFound = replying({ error: "not_found" }, 404);
    expect(await fetchTrendingEffects(config, { fetchImpl: notFound, now: NOW })).toBeNull();
    expect(await fetchTrendingEffects(config, { fetchImpl: notFound, now: NOW })).toBeNull();
    expect(notFound).toHaveBeenCalledTimes(2);
    const refused = replying({ error: "unauthorized" }, 401);
    expect(await fetchTrendingEffects(config, { fetchImpl: refused, now: NOW })).toBeNull();
    const offline = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchTrendingEffects(config, { fetchImpl: offline, now: NOW })).toBeNull();
    const broken = replying({ items: "?" });
    expect(await fetchTrendingEffects(config, { fetchImpl: broken, now: NOW })).toBeNull();
  });

  it("keeps only a list: not 'never', a failed first run or an empty run (the next run can land any minute)", async () => {
    for (const answer of [
      { status: "never", items: [] },
      { status: "failed", ranOn: "2026-10-06", updatedAt: DOC.updatedAt, items: [] },
      { status: "ok", ranOn: "2026-10-06", updatedAt: DOC.updatedAt, items: [] },
    ]) {
      const fetchImpl = replying(answer);
      expect(await fetchTrendingEffects(config, { fetchImpl, now: NOW })).toEqual(
        parseTrendingEffects(answer),
      );
      await fetchTrendingEffects(config, { fetchImpl, now: NOW });
      expect(fetchImpl, answer.status).toHaveBeenCalledTimes(2);
      expect(cachedTrendingEffects(config, NOW)).toBeNull();
    }
  });

  it("works with session storage blocked: it just asks each time", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const fetchImpl = replying(DOC);
    expect(await fetchTrendingEffects(config, { fetchImpl, now: NOW })).toEqual(
      parseTrendingEffects(DOC),
    );
    await fetchTrendingEffects(config, { fetchImpl, now: NOW });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(cachedTrendingEffects(config, NOW)).toBeNull();
  });
});

describe("runTrendingEffectsNow", () => {
  it("one POST /effects/run at a time per Worker (the Worker's once-a-day check has no lock); its answer is kept", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      await gate;
      return new Response(JSON.stringify(DOC));
    });
    expect(scanInFlight(config)).toBeUndefined();
    const first = runTrendingEffectsNow(config, { fetchImpl });
    const second = runTrendingEffectsNow(config, { fetchImpl });
    // A revisit of Discover meanwhile can wait for this same scan.
    const followed = scanInFlight(config);
    expect(scanInFlight({ ...config, url: "https://other.example" })).toBeUndefined();
    release();
    expect(await first).toEqual(parseTrendingEffects(DOC));
    expect(await second).toEqual(parseTrendingEffects(DOC));
    expect(await followed).toEqual(parseTrendingEffects(DOC));
    expect(scanInFlight(config)).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://w.example/effects/run");
    expect(init?.method).toBe("POST");
    // No body: the Worker's once-a-day check stands (no `force`).
    expect(init?.body).toBeUndefined();

    // The next visit reads the scan's answer from this tab.
    const get = replying({ status: "never", items: [] });
    expect(await fetchTrendingEffects(config, { fetchImpl: get })).toEqual(
      parseTrendingEffects(DOC),
    );
    expect(get).not.toHaveBeenCalled();
    // Once it has answered, a new tap asks again.
    await runTrendingEffectsNow(config, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("Scan again sends { force: true } (past the Worker's once-a-day guard and its tries cap) and keeps the new list", async () => {
    const old = { ...DOC, items: [SWAGGER] };
    await fetchTrendingEffects(config, { fetchImpl: replying(old) });
    expect(cachedTrendingEffects(config)).toEqual(parseTrendingEffects(old));
    const fetchImpl = replying(DOC);
    expect(await runTrendingEffectsNow(config, { fetchImpl, force: true })).toEqual(
      parseTrendingEffects(DOC),
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://w.example/effects/run");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ force: true });
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
    // The tab's copy is the new list.
    expect(cachedTrendingEffects(config)).toEqual(parseTrendingEffects(DOC));
  });

  it("is null when the scan fails", async () => {
    const fetchImpl = replying({ error: "upstream" }, 502);
    expect(await runTrendingEffectsNow(config, { fetchImpl })).toBeNull();
  });

  it("answers the Worker's own failed run (no list yet) without keeping it", async () => {
    const failedRun = { status: "failed", ranOn: "2026-10-06", notes: ["quota"], items: [] };
    const fetchImpl = replying({ ...failedRun, updatedAt: DOC.updatedAt });
    expect(await runTrendingEffectsNow(config, { fetchImpl })).toEqual({
      status: "failed",
      updatedAt: DOC.updatedAt,
      notes: ["quota"],
      items: [],
    });
    expect(cachedTrendingEffects(config)).toBeNull();
  });
});
