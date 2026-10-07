import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_MODEL } from "../discover/ai";
import { TAVILY_USAGE_URL, usageKeys } from "../discover/usage";
import { instagramShortcodeAt } from "../postDate";
import { encryptJson } from "../social/crypto";
import { TAVILY_URL } from "../trends/tavily";
import { YT_SEARCH_URL } from "../trends/youtubeSearch";
import { aiContext, categoryById } from "./defs";
import { LESSON_MODEL } from "./lessons";
import { readCategory, runCategory } from "./run";
import { TT_TRENDING_URL, TT_VIDEOS_URL } from "./tiktok";
import type { CategoryDoc, Technique } from "./types";

const NOW = new Date("2026-10-07T05:40:00Z"); // 2026-10-07 is UTC day % 3 = 0: cars' turn, slot 05:40
const LATER = new Date("2026-10-07T18:00:00Z");
const KEY = "category:cars";
const ATTEMPTS = "category:attempts:cars:2026-10-07";
const SCOUT = "scout-token";
/** The owner's TikTok for Business token (fake), sealed as /oauth/tiktokads/callback keeps it: `setup` connects TikTok
 * unless told otherwise. */
const TIKTOK_TOKEN = await encryptJson(SCOUT, {
  access_token: "fake-tiktok-token",
  advertiser_ids: ["adv1"],
  connectedAt: "2026-10-06T09:00:00.000Z",
});
/** The lessons' second save waits 1.1 s after the first: no real wait where the spacing is not what a test checks. */
const NO_WAIT = async () => {};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** When the reels went up: the day before NOW (the trends count each creator on the day they posted, from the post id). */
const POSTED = new Date("2026-10-06T04:00:00Z");
type Hit = { url: string; title: string; content: string };
const ig = (handle: string, title: string, n: number): Hit => ({
  url: `https://www.instagram.com/${handle}/reel/${instagramShortcodeAt(POSTED, n)}/`,
  title,
  content: "#caredit",
});

/** Car reels (a category searches Instagram alone): rolling shots by 4 creators, low angles by 3, a speed ramp (a
 * dictionary technique) by 4, generic captions. */
const PROBE: Hit[] = [
  ig("r1", "Rolling shot of my M4 at sunset 🔥 #rollingshot", 1),
  ig("r2", "rolling shots on the highway", 2),
  ig("r3", "Cinematic Rolling Shot | BMW M3", 3),
  ig("r4", "rolling shot tutorial with a gimbal", 4),
  ig("l1", "Low Angle hero shot of the GT3", 5),
  ig("l2", "low angle car shot", 6),
  ig("l3", "low angle reveal", 7),
  ig("s1", "speed ramp car edit 🔥", 8),
  ig("s2", "speed ramp on the drift", 9),
  ig("s3", "speed ramp transition car edit", 10),
  ig("s4", "my speed ramp edit", 11),
  ig("g1", "car edit trend #caredit", 12),
  ig("g2", "cinematic car edit", 13),
];
/** A lesson's search (YouTube, Instagram and TikTok in one call) finds a YouTube how-to, a TikTok and a reel, each
 * titled with its search words: on topic. */
const lessonHits = (q: string, n: number): Hit[] => [
  {
    url: `https://www.youtube.com/watch?v=lesson${String(n).padStart(5, "0")}`,
    title: `How to shoot: ${q}`,
    content: "1/30 s, ND filter",
  },
  { url: `https://www.tiktok.com/@t${n}/video/${n}1`, title: `${q} clip`, content: "" },
  { url: `https://www.instagram.com/i${n}/reel/L${n}/`, title: `${q} reel`, content: "" },
];

/** YouTube's top list (§6): the search finds 3 car videos, the views call counts them. */
const YT_VIEWS: Record<string, number> = {
  carTop00001: 1_000,
  carTop00002: 50_000,
  carTop00003: 7_000,
};
function youtubeReply(input: string): Response {
  const u = new URL(input);
  if (`${u.origin}${u.pathname}` === YT_SEARCH_URL)
    return json({ items: Object.keys(YT_VIEWS).map((videoId) => ({ id: { videoId } })) });
  return json({
    items: u.searchParams
      .get("id")!
      .split(",")
      .map((id) => ({
        id,
        snippet: { title: `Top ${id}`, channelTitle: "Car Channel" },
        statistics: { viewCount: String(YT_VIEWS[id]) },
      })),
  });
}
/** The top list's YouTube videos, the most viewed first. */
const YT_TOP = ["carTop00002", "carTop00003", "carTop00001"].map((id) => ({
  url: `https://www.youtube.com/watch?v=${id}`,
  title: `Top ${id}`,
  creator: "Car Channel",
  views: YT_VIEWS[id],
}));

/** TikTok's Discovery API (§6): 3 popular car hashtags in the US, 2 videos each, their share links with a query. */
function tiktokReply(u: URL): Response {
  const ok = (list: unknown[]) => json({ code: 0, message: "OK", data: { list } });
  if (`${u.origin}${u.pathname}` === TT_TRENDING_URL)
    return ok(
      [1, 2, 3].map((n) => ({
        hashtag_id: `${n}000`,
        hashtag_name: `cars${n}`,
        rank_position: String(n),
        top_country_list: ["US"],
      })),
    );
  return ok(
    [1, 2, 3].map((n) => ({
      hashtag_id: `${n}000`,
      top_video_list: [1, 2].map((i) => ({
        video_id: `${n}${i}`,
        share_url: `https://www.tiktok.com/@car${n}${i}/video/${n}${i}?lang=en`,
      })),
    })),
  );
}
/** The TikTok list `tiktokReply` makes: each hashtag's 1st video in rank order, then its 2nd. */
const TT_TOP = [1, 2].flatMap((i) =>
  [1, 2, 3].map((n) => ({
    url: `https://www.tiktok.com/@car${n}${i}/video/${n}${i}`,
    title: `#cars${n}`,
    creator: `@car${n}${i}`,
  })),
);

/** A fake internet: a category's searches answer `PROBE` and a lesson's search its `lessonHits`, unless `tavily` says
 * otherwise; Tavily's /usage answers `usage` (by default no figure: a 404, nothing kept); YouTube's Data API answers
 * the top list's calls (§6) unless `youtube` says otherwise; TikTok's Discovery API answers no popular hashtag unless
 * `tiktok` says otherwise (its calls kept in `tiktokAsked`, apart from `count`); anything else is counted. */
function web(
  over: {
    tavily?: (query: string) => Response | undefined;
    usage?: () => Response;
    youtube?: (url: string) => Response;
    tiktok?: (url: URL) => Response;
  } = {},
) {
  const count = { tavily: 0, usage: 0, youtube: 0, other: 0 };
  const searched: string[] = [];
  const tiktokAsked: URL[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (String(input) === TAVILY_USAGE_URL) {
      count.usage++;
      return over.usage?.() ?? json({ error: "not_found" }, 404);
    }
    if (String(input).startsWith("https://www.googleapis.com/youtube/v3/")) {
      count.youtube++;
      return over.youtube?.(String(input)) ?? youtubeReply(String(input));
    }
    if ([TT_TRENDING_URL, TT_VIDEOS_URL].some((u) => String(input).startsWith(u))) {
      const u = new URL(String(input));
      tiktokAsked.push(u);
      return over.tiktok?.(u) ?? json({ code: 0, message: "OK", data: { list: [] } });
    }
    if (String(input) !== TAVILY_URL) {
      count.other++;
      return json({ error: "not_found" }, 404);
    }
    count.tavily++;
    const { query, include_domains } = JSON.parse(String(init?.body)) as {
      query: string;
      include_domains: string[];
    };
    searched.push(query);
    const results = include_domains.length > 1 ? lessonHits(query, count.tavily) : PROBE;
    return over.tavily?.(query) ?? json({ results, usage: { credits: 1 } });
  });
  return { fetch, count, searched, tiktokAsked };
}
/** The Tavily searches as sent: query, sites and window. */
const sent = (fetch: ReturnType<typeof web>["fetch"]) =>
  fetch.mock.calls
    .filter(([url]) => String(url) === TAVILY_URL)
    .map(([, init]) => {
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return [b.query, b.include_domains, b.time_range];
    });

/** A fake built-in AI: the cleanup keeps every name it is shown, as it was written. Any other call (Task 3's
 * lessons) gets no usable answer here. */
function ai() {
  return {
    run: vi.fn(async (_model: string, input: Record<string, unknown>): Promise<unknown> => {
      const [system, user] = (input.messages as { content: string }[]).map((m) => m.content);
      if (!system.startsWith("You clean")) return { response: {} };
      const effects = [...user.matchAll(/^- key: (\S+) \| name: (.+?) \| posts:/gm)].map(
        ([, key, name]) => ({
          key,
          keep: true,
          name: { en: name.slice(0, 40), ar: "اسم الستايل" },
          what: { en: `What ${name} looks like`.slice(0, 90), ar: "وصف قصير للستايل" },
        }),
      );
      return { response: { effects } };
    }),
  };
}

/** `tiktok: false`: TikTok for Business not connected (no token). */
function setup(over: { stored?: CategoryDoc; tiktok?: boolean } = {}) {
  const store = new Map<string, string>();
  if (over.stored) store.set(KEY, JSON.stringify(over.stored));
  if (over.tiktok !== false) store.set("tiktokads:token", TIKTOK_TOKEN);
  const KV = {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    // The attempt counter's 3rd argument (its TTL) is not needed here.
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
  const AI = ai();
  // A YouTube key too, so a YouTube call would really go out (and be counted): categories make none.
  const env = {
    TAVILY_API_KEY: "t",
    YOUTUBE_API_KEY: "y",
    SCOUT_TOKEN: SCOUT,
    AI,
    SOCIAL_KV: KV as unknown as KVNamespace,
  };
  return { env, KV, AI };
}
type FakeKV = ReturnType<typeof setup>["KV"];
const stored = (KV: FakeKV) => JSON.parse(KV.store.get(KEY)!) as CategoryDoc;
/** The keys written, in order. */
const writes = (KV: FakeKV) => KV.put.mock.calls.map(([key]) => key);

const TECHNIQUE: Technique = {
  name: { en: "rolling shot", ar: "لقطة متحركة" },
  howTo: {
    en: "Shoot from a car driving beside it at 1/30 s, then steady it in the edit.",
    ar: "صوّر من سيارة ماشية جنبها على 1/30، وبعدين ثبّتها في المونتاج.",
  },
  videos: [
    {
      url: "https://www.youtube.com/watch?v=rollTut0001",
      title: "Rolling shot tutorial",
      platform: "yt",
      kind: "tutorial",
      lang: "en",
    },
  ],
};
/** The page of 3 days ago; its lessons are 3 days old, so they are not due. */
const OLD: CategoryDoc = {
  ranOn: "2026-10-04",
  updatedAt: "2026-10-04T05:40:00.000Z",
  status: "ok",
  items: [
    {
      key: "rolling-shot",
      name: { en: "rolling shot" },
      isNew: true,
      checked: true,
      creators: 5,
      posts: 6,
      platforms: ["tt"],
      growth: 3,
      samples: [],
    },
  ],
  lessons: { v: 4, updatedAt: "2026-10-04T05:40:00.000Z", photo: [], video: [TECHNIQUE], edit: [] },
  meta: {},
  history: {},
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCategory", () => {
  it("a first scan: 6 queries over Instagram's month, camera words named, the category's own words never, trends first", async () => {
    const { env, KV, AI } = setup();
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });

    expect(doc.items.map((i) => i.key)).toEqual(["rolling-shot", "low-angle", "speed-ramp"]);
    expect(doc.items[0]).toMatchObject({
      name: { en: "rolling shot" },
      creators: 4,
      isNew: true,
      growth: 3,
    });
    // The dictionary technique has as many creators as the top trend, and still comes after the trends.
    expect(doc.items[2]).toMatchObject({ termId: "speed-ramp", creators: 4, isNew: false });
    expect(Object.keys(doc.meta).filter((k) => /(^|-)(car|cars|cinematic)(-|$)/.test(k))).toEqual(
      [],
    );
    expect(doc).toMatchObject({ ranOn: "2026-10-07", updatedAt: NOW.toISOString(), status: "ok" });
    // 6 credits, and besides Tavily only YouTube's top list (§6: 1 search.list, 1 videos.list). Live fix 1: Instagram
    // over a month alone, 6 queries (Instagram's week and TikTok found about 1 post a call in the first live scan).
    expect(count.tavily).toBe(6);
    expect(count.youtube).toBe(2);
    expect(count.other).toBe(0);
    expect(sent(fetch)).toEqual(
      [
        "car edit trend",
        "cinematic car edit",
        "viral car edit",
        "car edit transition",
        "car edit capcut template",
        "car video trend",
      ].map((q) => [q, ["instagram.com"], "month"]),
    );
    const system = (AI.run.mock.calls[0][1].messages as { content: string }[])[0].content;
    expect(system.endsWith(aiContext(categoryById("cars")!))).toBe(true);
    // The cleanup asks the lessons' model, gpt-oss-120b, with room to reason (Trending effects stays on llama).
    expect(AI.run.mock.calls[0][0]).toBe(LESSON_MODEL);
    expect(AI.run.mock.calls[0][1]).toMatchObject({ max_tokens: 3000 });
    // A spending run counts itself, then saves. A lessons refresh (Task 3) may save once more after that.
    expect(writes(KV).slice(0, 2)).toEqual([ATTEMPTS, KEY]);
    expect(stored(KV).items).toEqual(doc.items);
    expect(stored(KV).diagnostics).toMatchObject({
      id: "cars",
      credits: 6,
      // The model that answered each cleanup batch.
      ai: { models: ["gpt-oss-120b"] },
      families: [1, 2, 3, 4, 5, 6].map((family) => ({
        family,
        tt: 0,
        igWeek: 0,
        igMonth: 13,
        posts: 13,
      })),
    });
  });

  it("once a UTC day; force scans again; every spending run counts, forced ones too: the 4th answers 'attempts'", async () => {
    const { env, KV } = setup({ stored: OLD });
    const { fetch, count } = web();
    await runCategory(env, "cars", { fetch, now: NOW });
    expect(count.tavily).toBe(6);
    // Later the same UTC day, not forced: the stored page, nothing spent.
    expect((await runCategory(env, "cars", { fetch, now: LATER })).updatedAt).toBe(
      NOW.toISOString(),
    );
    expect(count.tavily).toBe(6);
    await runCategory(env, "cars", { fetch, now: LATER, force: true });
    await runCategory(env, "cars", { fetch, now: LATER, force: true });
    expect(count.tavily).toBe(18);
    expect(KV.store.get(ATTEMPTS)).toBe("3");
    const capped = await runCategory(env, "cars", { fetch, now: LATER, force: true });
    expect(count.tavily).toBe(18);
    expect(capped).toMatchObject({ status: "ok", updatedAt: LATER.toISOString() });
    expect(capped.notes).toContain("attempts");
    // Over the cap nothing is written.
    expect(stored(KV).notes ?? []).not.toContain("attempts");
  });

  it("pauses at 90 % of the month's credits: nothing spent or counted, the last page and lessons kept, noted", async () => {
    const { env, KV, AI } = setup({ stored: OLD });
    KV.store.set(usageKeys.tavily, JSON.stringify({ used: 950, limit: 1000 }));
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(count.tavily).toBe(0);
    expect(AI.run).not.toHaveBeenCalled();
    expect(doc).toMatchObject({
      status: "failed",
      notes: ["tavily_budget"],
      ranOn: "2026-10-07",
      updatedAt: OLD.updatedAt,
      items: OLD.items,
      lessons: OLD.lessons,
    });
    expect(writes(KV)).toEqual([KEY]);
    // Pay-as-you-go room left (1,100 of 1,625): the retry the same day scans.
    KV.store.set(
      usageKeys.tavily,
      JSON.stringify({ used: 1000, limit: 1000, paygoUsed: 100, paygoLimit: 625 }),
    );
    await runCategory(env, "cars", { fetch, now: NOW });
    expect(count.tavily).toBe(6);
    // A figure Discover keeps (10 minutes) is used as it is: Tavily's /usage is never asked.
    expect(count.usage).toBe(0);
  });

  it("with no figure kept (the cron's usual case), asks Tavily's /usage once and keeps it: 95 % pauses", async () => {
    const { env, KV } = setup({ stored: OLD });
    const { fetch, count } = web({
      usage: () => json({ account: { plan_usage: 950, plan_limit: 1000 } }),
    });
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(doc).toMatchObject({ status: "failed", notes: ["tavily_budget"], items: OLD.items });
    expect(count).toEqual({ tavily: 0, usage: 1, youtube: 0, other: 0 });
    // Kept 10 minutes, as Discover keeps it (the next slots read it), then the paused page.
    expect(KV.put.mock.calls[0]).toEqual([
      usageKeys.tavily,
      JSON.stringify({ used: 950, limit: 1000 }),
      { expirationTtl: 600 },
    ]);
    expect(writes(KV)).toEqual([usageKeys.tavily, KEY]);
  });

  it("with no figure kept and Tavily's /usage failing, the month is unknown: not tight, the scan runs", async () => {
    const { env, KV } = setup({ stored: OLD });
    const { fetch, count } = web({ usage: () => json({ error: "upstream" }, 500) });
    expect(await runCategory(env, "cars", { fetch, now: NOW })).toMatchObject({ status: "ok" });
    expect(count).toEqual({ tavily: 6, usage: 1, youtube: 2, other: 0 });
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
  });

  it("answers a page scanned fine today before looking at the budget: a tight month pauses nothing, writes nothing", async () => {
    const today: CategoryDoc = { ...OLD, ranOn: "2026-10-07", updatedAt: NOW.toISOString() };
    const { env, KV } = setup({ stored: today });
    KV.store.set(usageKeys.tavily, JSON.stringify({ used: 950, limit: 1000 }));
    const { fetch, count } = web();
    expect(await runCategory(env, "cars", { fetch, now: LATER })).toEqual(today);
    expect(count).toEqual({ tavily: 0, usage: 0, youtube: 0, other: 0 });
    expect(KV.put).not.toHaveBeenCalled();
  });

  it("Tavily refusing every search: failed, the last page and lessons kept, the attempt counted", async () => {
    const { env, KV } = setup({ stored: OLD });
    const { fetch } = web({ tavily: () => json({ error: "plan limit" }, 432) });
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(doc).toMatchObject({
      status: "failed",
      notes: ["quota"],
      updatedAt: OLD.updatedAt,
      items: OLD.items,
      lessons: OLD.lessons,
    });
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
  });

  it("KV trouble: an unreadable page spends and writes nothing; a counter or a save that fails is noted", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unreadable = setup({ stored: OLD });
    unreadable.KV.get.mockRejectedValue(new Error("KV GET failed: 500"));
    const searched = web();
    expect(
      await runCategory(unreadable.env, "cars", { fetch: searched.fetch, now: NOW }),
    ).toMatchObject({ status: "failed", notes: ["kv"] });
    expect(searched.count.tavily).toBe(0);
    expect(unreadable.KV.put).not.toHaveBeenCalled();

    const unwritable = setup({ stored: OLD });
    unwritable.KV.put.mockRejectedValue(new Error("KV PUT failed: 500"));
    const doc = await runCategory(unwritable.env, "cars", { fetch: web().fetch, now: NOW });
    expect(doc).toMatchObject({ status: "ok", ranOn: "2026-10-07" });
    expect(doc.notes).toEqual(["attempts_kv", "kv"]);
    // The lost save is logged (Workers Logs), counts only.
    expect(error).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ category: { write: "failed" } }),
    );
  });

  it("a cleanup batch gpt-oss-120b leaves without a list is asked once more of llama: the same trends, llama in the diagnostics", async () => {
    const { env, KV } = setup();
    const cleanup = ai();
    // gpt-oss answers nothing usable (an object without `effects`); llama answers as the fake above.
    env.AI = {
      run: vi.fn(async (model: string, input: Record<string, unknown>): Promise<unknown> =>
        model === LESSON_MODEL ? { response: {} } : cleanup.run(model, input),
      ),
    };
    const doc = await runCategory(env, "cars", { fetch: web().fetch, now: NOW, sleep: NO_WAIT });
    expect(doc.items.map((i) => i.key)).toEqual(["rolling-shot", "low-angle", "speed-ramp"]);
    const cleanups = env.AI.run.mock.calls.filter(([, input]) =>
      (input.messages as { content: string }[])[0].content.startsWith("You clean"),
    );
    expect(cleanups.map(([model]) => model)).toEqual([LESSON_MODEL, AI_MODEL]);
    expect(stored(KV).diagnostics).toMatchObject({
      ai: { models: ["llama-3.3-70b-instruct-fp8-fast"] },
    });
    expect(doc.notes ?? []).not.toContain("ai_fallback");
  });

  it("T6: a style 2 creators posted shows once the AI approved it (Trending effects needs 3)", async () => {
    const { env } = setup();
    const two = [ig("d1", "drift shot at night", 21), ig("d2", "Drift Shot from the roof", 22)];
    const { fetch } = web({ tavily: () => json({ results: two, usage: { credits: 1 } }) });
    const doc = await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });
    expect(doc.items.map((i) => [i.key, i.creators, i.checked])).toEqual([["drift-shot", 2, true]]);
  });

  it("keeps at most 200 names in a category's memory, today's names first", async () => {
    const history = Object.fromEntries(
      Array.from({ length: 260 }, (_, i) => [`old-${i}`, [{ day: "2026-10-04", ids: ["a"] }]]),
    );
    const meta = Object.fromEntries(
      Object.keys(history).map((k) => [
        k,
        {
          name: { en: k },
          checked: false,
          platforms: ["tt" as const],
          posts: 1,
          samples: [],
          firstSeen: "2026-10-04",
        },
      ]),
    );
    const { env } = setup({ stored: { ...OLD, history, meta } });
    const doc = await runCategory(env, "cars", { fetch: web().fetch, now: NOW });
    expect(Object.keys(doc.history)).toHaveLength(200);
    expect(doc.history["rolling-shot"]).toBeDefined();
    expect((doc.diagnostics as { trimmed: number }).trimmed).toBeGreaterThan(0);
  });

  it("answers an unknown category with a failed page, reading and writing nothing", async () => {
    const { env, KV } = setup();
    expect(await runCategory(env, "drift", { fetch: web().fetch, now: NOW })).toMatchObject({
      status: "failed",
      notes: ["unknown"],
    });
    expect(KV.get).not.toHaveBeenCalled();
    expect(KV.put).not.toHaveBeenCalled();
  });
});

describe("runCategory's top lists (§6)", () => {
  /** PROBE's reels as the stored Instagram list: every search found all 13, so they keep the order first seen. */
  const IG_TOP = PROBE.map((h) => {
    const [, handle, id] = h.url.match(/instagram\.com\/([\w.]+)\/reel\/([\w-]+)\//)!;
    return { url: `https://www.instagram.com/p/${id}`, title: h.title, creator: `@${handle}` };
  });
  const youtubeSearches = (fetch: ReturnType<typeof web>["fetch"]) =>
    fetch.mock.calls
      .map(([u]) => new URL(String(u)))
      .filter((u) => `${u.origin}${u.pathname}` === YT_SEARCH_URL);

  it("T1–T3: YouTube's most viewed of the main query (2 calls) and the scan's Instagram posts, saved with the page", async () => {
    const { env, KV } = setup();
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });
    expect(count.youtube).toBe(2);
    expect(youtubeSearches(fetch).map((u) => u.searchParams.get("q"))).toEqual(["car edit"]);
    expect(doc.top).toEqual({ updatedAt: NOW.toISOString(), yt: YT_TOP, ig: IG_TOP, tt: [] });
    expect(doc.notes ?? []).not.toContain("youtube");
    expect(stored(KV).top).toEqual(doc.top);
  });

  it("YouTube failing, or without its key: noted 'youtube', the page still saved with the last YouTube list", async () => {
    const last = { updatedAt: OLD.updatedAt, yt: YT_TOP.slice(0, 1), ig: [], tt: [] };
    const { env, KV } = setup({ stored: { ...OLD, top: last } });
    const quota = () => json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);
    const { fetch, count } = web({ youtube: quota });
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(doc).toMatchObject({ status: "partial", notes: ["youtube"] });
    expect(count.youtube).toBe(1);
    // The last list is kept with its own date: it never looks fresh (C1).
    expect(doc.top).toEqual({ updatedAt: OLD.updatedAt, yt: last.yt, ig: IG_TOP, tt: [] });
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
    expect(stored(KV).top).toEqual(doc.top);

    const keyless = setup();
    const noKey = {
      TAVILY_API_KEY: "t",
      AI: keyless.AI,
      SOCIAL_KV: keyless.KV as unknown as KVNamespace,
    };
    const none = web();
    const first = await runCategory(noKey, "cars", { fetch: none.fetch, now: NOW, sleep: NO_WAIT });
    expect(first.notes).toContain("youtube");
    expect(first.top).toMatchObject({ yt: [], ig: IG_TOP });
    expect(none.count.youtube).toBe(0);
  });

  it("T5: YouTube's videos feed the trends too: title and description as text, the channel's id as the creator", async () => {
    const { env } = setup();
    // Tavily finds one low-angle reel; YouTube three low-angle videos, one saying it in its description: two from one
    // channel (UC_a1), one from another channel that has the same name (UC_a2, C4).
    const videos = [
      {
        id: "lowAng00001",
        title: "Low angle car shots",
        channelTitle: "Chan A",
        channelId: "UC_a1",
        publishedAt: "2026-10-06T04:00:00Z",
        description: "",
      },
      {
        id: "lowAng00002",
        title: "GT3 night reveal",
        channelTitle: "Chan A",
        channelId: "UC_a1",
        publishedAt: "2026-10-06T04:00:00Z",
        description: "How I film a low angle reveal",
      },
      {
        id: "lowAng00003",
        title: "Low Angle Shot of the M5",
        channelTitle: "Chan A",
        channelId: "UC_a2",
        publishedAt: "2026-10-06T04:00:00Z",
        description: "",
      },
    ];
    const { fetch, count } = web({
      tavily: () =>
        json({ results: [ig("l1", "Low Angle hero shot of the GT3", 5)], usage: { credits: 1 } }),
      youtube: (url) =>
        url.startsWith(YT_SEARCH_URL)
          ? json({ items: videos.map((v) => ({ id: { videoId: v.id } })) })
          : json({
              items: videos.map(({ id, ...snippet }) => ({
                id,
                snippet,
                statistics: { viewCount: "100" },
              })),
            }),
    });
    const doc = await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });
    // The reel's creator and the 2 channels: 3 creators. A channel's two videos are one creator's; two channels of one
    // name are two.
    expect(doc.items.find((i) => i.key === "low-angle")).toMatchObject({
      creators: 3,
      platforms: ["ig", "yt"],
    });
    // The same 2 YouTube calls as the top list, which shows the channels' names.
    expect(count.youtube).toBe(2);
    expect(doc.top!.yt.map((v) => v.creator)).toEqual(["Chan A", "Chan A", "Chan A"]);
  });

  it("C1: Scan again never asks YouTube: it keeps the stored list and its date, whatever its length or the page's status", async () => {
    const { env } = setup();
    const { fetch, count } = web();
    await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });
    const again = await runCategory(env, "cars", {
      fetch,
      now: LATER,
      force: true,
      sleep: NO_WAIT,
    });
    expect(count.youtube).toBe(2);
    expect(count.tavily).toBeGreaterThan(6);
    // The reused list keeps its own date: it never looks fresh.
    expect(again.top).toEqual({ updatedAt: NOW.toISOString(), yt: YT_TOP, ig: IG_TOP, tt: [] });

    // Days later, an empty stored list on a failed page: still no YouTube call when forced.
    const empty = { updatedAt: OLD.updatedAt, yt: [], ig: [], tt: [] };
    const failedPage = setup({ stored: { ...OLD, status: "failed", top: empty } });
    const later = web();
    const forced = await runCategory(failedPage.env, "cars", {
      fetch: later.fetch,
      now: NOW,
      force: true,
    });
    expect(later.count.youtube).toBe(0);
    expect(forced.top).toMatchObject({ updatedAt: OLD.updatedAt, yt: [] });
    expect(forced.notes ?? []).not.toContain("youtube");
  });

  it("C1: the cron run and a category's first top scan ask YouTube, a forced one on a page from before §6 too", async () => {
    // The cron's run (never forced), days after the last scan.
    const stored = { updatedAt: OLD.updatedAt, yt: YT_TOP.slice(0, 1), ig: [], tt: [] };
    const cron = setup({ stored: { ...OLD, top: stored } });
    const daily = web();
    const doc = await runCategory(cron.env, "cars", { fetch: daily.fetch, now: NOW });
    expect(daily.count.youtube).toBe(2);
    expect(doc.top).toMatchObject({ updatedAt: NOW.toISOString(), yt: YT_TOP });
    // Scan again on a page stored before §6 (no top yet): its first top scan.
    const before = setup({ stored: OLD });
    const first = web();
    await runCategory(before.env, "cars", { fetch: first.fetch, now: NOW, force: true });
    expect(first.count.youtube).toBe(2);
  });

  it("TikTok's list comes from its Discovery API on every scan, forced ones too, with its own date; YouTube's date stays its own", async () => {
    const { env, KV } = setup();
    const { fetch, count, tiktokAsked } = web({ tiktok: tiktokReply });
    const doc = await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });
    // 2 calls: the category's industry's popular hashtags, then their videos.
    expect(tiktokAsked.map((u) => `${u.origin}${u.pathname}`)).toEqual([
      TT_TRENDING_URL,
      TT_VIDEOS_URL,
    ]);
    expect(tiktokAsked[0].searchParams.get("category_name")).toBe("AUTOMOTIVE");
    expect(count.other).toBe(0);
    expect(doc.top).toEqual({
      updatedAt: NOW.toISOString(),
      yt: YT_TOP,
      ig: IG_TOP,
      tt: TT_TOP,
      ttUpdatedAt: NOW.toISOString(),
    });
    for (const note of ["tiktok", "tiktok_auth"]) expect(doc.notes ?? []).not.toContain(note);
    expect(stored(KV).top).toEqual(doc.top);
    expect(stored(KV).diagnostics).toMatchObject({
      tiktok: { hashtags: 3, videos: 6, raw: 6, country: "US", industry: "AUTOMOTIVE" },
    });
    // Scan again: YouTube's list and date kept (C1); TikTok asked again (it costs nothing), dated by this scan.
    const again = await runCategory(env, "cars", {
      fetch,
      now: LATER,
      force: true,
      sleep: NO_WAIT,
    });
    expect(count.youtube).toBe(2);
    expect(tiktokAsked).toHaveLength(4);
    expect(again.top).toEqual({
      updatedAt: NOW.toISOString(),
      yt: YT_TOP,
      ig: IG_TOP,
      tt: TT_TOP,
      ttUpdatedAt: LATER.toISOString(),
    });
  });

  it("TikTok not connected: nothing asked of it, the last TikTok list kept with its date, noted 'tiktok_auth'", async () => {
    const last = {
      updatedAt: OLD.updatedAt,
      yt: YT_TOP.slice(0, 1),
      ig: [],
      tt: TT_TOP.slice(0, 2),
      ttUpdatedAt: OLD.updatedAt,
    };
    const { env, KV } = setup({ stored: { ...OLD, top: last }, tiktok: false });
    const { fetch, tiktokAsked } = web({ tiktok: tiktokReply });
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(tiktokAsked).toEqual([]);
    expect(doc).toMatchObject({ status: "partial", notes: ["tiktok_auth"] });
    expect(doc.top).toEqual({
      updatedAt: NOW.toISOString(),
      yt: YT_TOP,
      ig: IG_TOP,
      tt: last.tt,
      ttUpdatedAt: OLD.updatedAt,
    });
    expect(stored(KV).top).toEqual(doc.top);
    expect(stored(KV).diagnostics).not.toHaveProperty("tiktok");
  });

  it("TikTok failing: the last list kept with its date, noted 'tiktok', its code and message in the diagnostics; an empty answer keeps it quietly", async () => {
    const last = {
      updatedAt: OLD.updatedAt,
      yt: [],
      ig: [],
      tt: TT_TOP.slice(0, 2),
      ttUpdatedAt: OLD.updatedAt,
    };
    const { env, KV } = setup({ stored: { ...OLD, top: last } });
    const revoked = () =>
      json({ code: 40105, message: "Access token is invalid or has been revoked.", data: {} });
    const doc = await runCategory(env, "cars", { fetch: web({ tiktok: revoked }).fetch, now: NOW });
    expect(doc).toMatchObject({ status: "partial", notes: ["tiktok"] });
    expect(doc.top).toMatchObject({ tt: last.tt, ttUpdatedAt: OLD.updatedAt });
    expect(stored(KV).diagnostics).toMatchObject({
      tiktok: { code: 40105, message: "Access token is invalid or has been revoked." },
    });
    // No popular hashtag in TikTok's answer: the last list stays, with no note.
    const empty = setup({ stored: { ...OLD, top: last } });
    const quiet = await runCategory(empty.env, "cars", { fetch: web().fetch, now: NOW });
    expect(quiet.status).toBe("ok");
    expect(quiet.top).toMatchObject({ tt: last.tt, ttUpdatedAt: OLD.updatedAt });
  });
});

describe("runCategory's lessons (§3)", () => {
  /** A how-to as the model writes it (live fix 2: three English lines, then the Arabic), and as it is stored. */
  const LINES = {
    shoot: "Pan with the car from the roadside, framing it side-on with room ahead.",
    settings: "Shutter 1/30 s, ISO 100, 35 mm, continuous autofocus locked on the car.",
    edit: "In Lightroom mask the car and add a little motion blur to the background.",
    ar: "تابع السيارة من جنب الطريق على شتر 1/30، وبعدين زيد البلر للخلفية في لايتروم.",
  };
  const HOW = {
    en: `Shoot: ${LINES.shoot}\nSettings: ${LINES.settings}\nEdit: ${LINES.edit}`,
    ar: LINES.ar,
  };
  const pick = (en: string, query: string) => ({ name: { en, ar: `اسم ${en}` }, query });
  const PICKS = {
    photo: [
      pick("panning", "car panning"),
      pick("light painting", "car light painting"),
      pick("hero shot", "car hero shot"),
    ],
    video: [
      pick("rolling shot", "car rolling shot"),
      pick("drone chase", "drone car chase"),
      pick("gimbal reveal", "gimbal car reveal"),
    ],
    edit: [
      pick("speed ramp", "speed ramp car"),
      pick("sound design", "car sound design"),
      pick("color grade", "car color grade"),
    ],
  };
  /** Last week's page: its lessons are 8 days old, so they are due. */
  const LAST_WEEK: CategoryDoc = {
    ...OLD,
    lessons: { ...OLD.lessons!, updatedAt: "2026-09-29T05:40:00.000Z" },
  };
  /** The cleanup of the fake above, plus the lessons' calls: PICKS, then each area's how-tos (its first technique
   * linked to a skill); `onPick` runs when the pick is asked. */
  function lessonsAi(howTos?: unknown, onPick = () => {}) {
    const cleanup = ai();
    return {
      run: vi.fn(async (model: string, input: Record<string, unknown>): Promise<unknown> => {
        const [system, user] = (input.messages as { content: string }[]).map((m) => m.content);
        if (system.startsWith("You plan")) {
          onPick();
          return { response: PICKS };
        }
        if (system.startsWith("You write")) {
          const techniques = [...user.matchAll(/^- (\d+) \|/gm)].map(([, i]) => ({
            i: Number(i),
            ...LINES,
            ...(i === "0" ? { skillId: "phone-180-shutter" } : {}),
          }));
          return { response: howTos ?? { techniques } };
        }
        return cleanup.run(model, input);
      }),
    };
  }
  /** The system prompts the AI was asked with, in order. */
  const asked = (run: { mock: { calls: unknown[][] } }) =>
    run.mock.calls.map(
      ([, input]) => (input as { messages: { content: string }[] }).messages[0].content,
    );

  it("a scan with lessons due refreshes them after saving the trends: 9 + 1 more searches", async () => {
    const { env, KV } = setup();
    env.AI = lessonsAi();
    const { fetch, count, searched } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });
    // PROBE answers every search: its TikTok / Instagram posts are the examples, its "tutorial" title the tutorial.
    expect(count.tavily).toBe(16);
    // Lessons find their YouTube videos through Tavily: the only YouTube calls are the top list's 2 (§6).
    expect(count.youtube).toBe(2);
    expect(count.other).toBe(0);
    // Live fix 1: examples for the subject, no " tutorial" added.
    expect(searched).toContain("car panning");
    expect(searched).not.toContain("car panning tutorial");
    expect(searched).toContain("شرح تصوير ومونتاج سيارات");
    expect(writes(KV)).toEqual([ATTEMPTS, KEY, KEY]);
    // The trends were saved first, without lessons: a refresh that never ends still leaves them saved.
    const trends = JSON.parse(KV.put.mock.calls[1][1]) as CategoryDoc;
    expect(trends.items).toEqual(doc.items);
    expect(trends.lessons).toBeUndefined();
    // The cleanup, the pick, then one how-to call an area: at most 7 AI calls a run.
    const systems = asked(env.AI.run);
    expect(systems.filter((s) => s.startsWith("You write"))).toHaveLength(3);
    expect(systems.length).toBeLessThanOrEqual(7);
    expect(doc.lessons!.photo).toHaveLength(3);
    expect(doc.lessons!.photo[0]).toMatchObject({ skillId: "phone-180-shutter", howTo: HOW });
    expect(doc.lessons!.video[0].videos.map((v) => v.kind)).toEqual([
      "example",
      "example",
      "tutorial",
    ]);
    expect(stored(KV).lessons).toEqual(doc.lessons);
    expect(stored(KV).lessons!.v).toBe(4);
    expect(stored(KV).diagnostics).toMatchObject({
      lessons: {
        picked: 9,
        written: 9,
        credits: 10,
        // B5: the model that answered each lessons call, for the live check.
        models: {
          pick: "gpt-oss-120b",
          photo: "gpt-oss-120b",
          video: "gpt-oss-120b",
          edit: "gpt-oss-120b",
        },
      },
    });
    expect(doc.notes ?? []).not.toContain("lessons");
  });

  it("older lessons (no version before live fix 1, 2 before live fix 2, 3 before live fix 3) are due at the next scan, however new; the stored page still reads", async () => {
    for (const v of [undefined, 2, 3]) {
      const before = { ...OLD.lessons!, v }; // 3 days old; KV's JSON leaves an undefined `v` out
      const { env, KV } = setup({ stored: { ...OLD, lessons: before } });
      env.AI = lessonsAi();
      const { fetch, count } = web();
      // The page as it was stored is still read as it is (the GET's answer included).
      expect((await readCategory(env, "cars"))!.lessons).toEqual(before);
      const doc = await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });
      expect(count.tavily).toBe(16);
      expect(doc.lessons).toMatchObject({ v: 4, updatedAt: NOW.toISOString() });
      expect(doc.lessons!.photo[0].howTo).toEqual(HOW);
      expect(stored(KV).lessons).toEqual(doc.lessons);
    }
  });

  it("lessons under 6 days old stay as they are", async () => {
    const { env, KV } = setup({ stored: OLD }); // 3 days old
    env.AI = lessonsAi();
    const { fetch, count } = web();
    await runCategory(env, "cars", { fetch, now: NOW });
    expect(stored(KV).lessons).toEqual(OLD.lessons);
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
    expect(count.tavily).toBe(6);
  });

  it("a refresh that keeps nothing keeps last week's lessons, noted 'lessons'", async () => {
    const { env, KV } = setup({ stored: LAST_WEEK });
    env.AI = lessonsAi({ techniques: "nope" });
    const doc = await runCategory(env, "cars", { fetch: web().fetch, now: NOW, sleep: NO_WAIT });
    expect(doc.lessons).toEqual(LAST_WEEK.lessons);
    expect(doc.notes).toContain("lessons");
    expect(writes(KV)).toEqual([ATTEMPTS, KEY, KEY]);
    expect(stored(KV).diagnostics).toMatchObject({
      lessons: { picked: 9, written: 0, failed: 3 },
    });
  });

  it("an area whose how-to call fails keeps last week's techniques there; the others are new", async () => {
    const { env, KV } = setup({ stored: LAST_WEEK });
    const answering = lessonsAi();
    env.AI = {
      run: vi.fn(async (model: string, input: Record<string, unknown>): Promise<unknown> => {
        const [system, user] = (input.messages as { content: string }[]).map((m) => m.content);
        // The videography call answers nothing.
        if (system.startsWith("You write") && / \| video \| /.test(user)) return { response: {} };
        return answering.run(model, input);
      }),
    };
    const doc = await runCategory(env, "cars", { fetch: web().fetch, now: NOW, sleep: NO_WAIT });
    expect(doc.lessons!.updatedAt).toBe(NOW.toISOString());
    expect(doc.lessons!.video).toEqual(LAST_WEEK.lessons!.video);
    expect(doc.lessons!.photo.map((t) => t.name.en)).toEqual([
      "panning",
      "light painting",
      "hero shot",
    ]);
    expect(doc.notes ?? []).not.toContain("lessons");
    expect(stored(KV).lessons).toEqual(doc.lessons);
    expect(stored(KV).diagnostics).toMatchObject({ lessons: { written: 6, failed: 1 } });
  });

  it("a refresh that throws keeps last week's lessons, noted 'lessons'", async () => {
    const { env, KV } = setup({ stored: LAST_WEEK });
    const cleanup = ai();
    env.AI = {
      run: vi.fn(async (model: string, input: Record<string, unknown>): Promise<unknown> => {
        const [system] = (input.messages as { content: string }[]).map((m) => m.content);
        // A pick whose reading throws: a code error inside the refresh, not a missing answer.
        if (system.startsWith("You plan"))
          return {
            response: {
              get photo(): never {
                throw new Error("boom");
              },
            },
          };
        return cleanup.run(model, input);
      }),
    };
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW, sleep: NO_WAIT });
    expect(doc.lessons).toEqual(LAST_WEEK.lessons);
    expect(doc.notes).toContain("lessons");
    expect(count.tavily).toBe(6);
    expect(writes(KV)).toEqual([ATTEMPTS, KEY, KEY]);
    expect(stored(KV).lessons).toEqual(LAST_WEEK.lessons);
    expect(stored(KV).diagnostics).toMatchObject({ lessons: { error: "boom" } });
  });

  it("a trends save that failed buys no lessons: they stay due for the next run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { env, KV } = setup({ stored: LAST_WEEK });
    env.AI = lessonsAi();
    KV.put.mockRejectedValue(new Error("KV PUT failed: 500"));
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(doc.notes).toContain("kv");
    expect(doc.notes).not.toContain("lessons");
    expect(doc.lessons).toEqual(LAST_WEEK.lessons);
    expect(count.tavily).toBe(6);
    expect(asked(env.AI.run).filter((s) => s.startsWith("You plan"))).toEqual([]);
    // The page was not saved, so neither tried a second time.
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
  });

  describe("the second save's spacing (KV takes one write a key a second, a quicker one is refused)", () => {
    /** A first scan with lessons due, on a clock the refresh moves by `took` ms (the pick moves it): the KV writes
     * and the waits, in order. */
    async function spaced(took: number) {
      let clock = Date.parse("2026-10-07T05:40:00Z");
      vi.spyOn(Date, "now").mockImplementation(() => clock);
      const { env, KV } = setup();
      env.AI = lessonsAi(undefined, () => (clock += took));
      const order: string[] = [];
      KV.put.mockImplementation(async (key: string, value: string) => {
        KV.store.set(key, value);
        order.push(key);
      });
      const sleep = vi.fn(async (ms: number) => void order.push(`wait ${ms}`));
      await runCategory(env, "cars", { fetch: web().fetch, now: NOW, sleep });
      return order;
    }

    it("a quick refresh waits out the rest of 1.1 s after the trends' save", async () => {
      expect(await spaced(0)).toEqual([ATTEMPTS, KEY, "wait 1100", KEY]);
    });

    it("waits only what is left of the 1.1 s", async () => {
      expect(await spaced(400)).toEqual([ATTEMPTS, KEY, "wait 700", KEY]);
    });

    it("a refresh that took 1.1 s or more saves at once", async () => {
      expect(await spaced(1_100)).toEqual([ATTEMPTS, KEY, KEY]);
    });

    it("never waits longer than 1.1 s, even with the clock set back", async () => {
      expect(await spaced(-60_000)).toEqual([ATTEMPTS, KEY, "wait 1100", KEY]);
    });
  });

  it("without the AI binding no refresh is tried, and the page is saved once", async () => {
    const { KV } = setup();
    const noAi = {
      TAVILY_API_KEY: "t",
      YOUTUBE_API_KEY: "y",
      SOCIAL_KV: KV as unknown as KVNamespace,
    };
    const { fetch, count } = web();
    await runCategory(noAi, "cars", { fetch, now: NOW });
    expect(count.tavily).toBe(6);
    expect(count.other).toBe(0);
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
  });

  it("a tight month pauses the lessons with the scan: no search, no AI, last week's lessons kept", async () => {
    const { env, KV } = setup({ stored: LAST_WEEK });
    env.AI = lessonsAi();
    KV.store.set(usageKeys.tavily, JSON.stringify({ used: 950, limit: 1000 }));
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(count).toEqual({ tavily: 0, usage: 0, youtube: 0, other: 0 });
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(doc).toMatchObject({
      status: "failed",
      notes: ["tavily_budget"],
      lessons: LAST_WEEK.lessons,
    });
    expect(writes(KV)).toEqual([KEY]);
  });
});
