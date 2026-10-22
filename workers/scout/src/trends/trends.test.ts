/**
 * Trend Radar tests (round 30, planning/tools/08-trends.md): every parser on a saved sample of the live
 * answer probed on 2026-09-28, the run's merge / budget / degraded rules, the routes, the cron slots, the
 * daily search cap and the `TREND_SOURCES` gate; round 31: the bundled genres, the keyword plan's rotation
 * by UTC day, the genre tag, the scan's ranking per language and the feed's cap above the sources' own.
 * Mocked fetch + in-memory KV, the social.test.ts style.
 */

import { describe, expect, it, vi } from "vitest";
import { CATEGORY_SLOTS } from "../categories/defs";
import {
  EFFECTS_SLOT,
  runTick,
  SYNC_SLOTS,
  TICK_CRON,
  TREND_SLOTS,
  trendKindAt,
  WEEKLY_SLOT,
} from "../social/cron";
import { handle, type Env } from "../scout";
import { daysUntil, eventItem, eventItems, parseEvent, SAUDI_EVENTS, upcoming } from "./events";
import { GENRE_KEYWORDS, genreKeywords, GENRES, parseGenre, parseGenres } from "./genres";
import {
  GOOGLE_MAX_PER_REGION,
  GOOGLE_REGIONS,
  googleItems,
  googleRpcBody,
  parseGoogleRpc,
  parseGoogleRss,
  runGoogle,
} from "./google";
import { KWORB_MAX, KWORB_REGIONS, kworbItems, parseKworb, runKworb } from "./kworb";
import { isoWeek, latestFeed, readSearchCount, trendKeys, utcDay } from "./kv";
import {
  dedupe,
  fetchText,
  FETCH_TIMEOUT_MS,
  mergeItems,
  MAX_ITEMS,
  parseVolume,
  rankScore,
  slugify,
  sortItems,
  trendId,
} from "./normalize";
import { healthTrends, parseRunBody } from "./routes";
import { enabledSources, RUN_BUDGET, runTrends, SOURCES } from "./run";
import {
  ALREADY_SCANNED,
  extractTerms,
  platformOfUrl,
  runTavily,
  scanTerms,
  TAVILY_MAX_ITEMS,
  TAVILY_QUERIES,
  TAVILY_URL,
} from "./tavily";
import { SOURCE_LABELS, type SourceCtx, type TrendItem, type TrendsFeed } from "./types";
import { parseTrends24, runX, X_MAX, xItems } from "./x";
import {
  durationSeconds,
  runYoutube,
  YT_CATEGORIES,
  YT_MAX_RESULTS,
  YT_REGIONS,
  YT_VIDEOS_URL,
} from "./youtube";
import {
  dayNumber,
  keptRows,
  keywordList,
  keywordPlan,
  pickVideoIds,
  planOffset,
  rankByViews,
  runYoutubeSearch,
  SEARCH_CAP,
  STATS_MAX_IDS,
  YT_SEARCH_URL,
  type Keyword,
} from "./youtubeSearch";
import { Budget } from "../social/http";

/* ---------- fixtures & fakes ---------- */

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
/** 2026-09-28 12:00 Riyadh (a Monday). */
const NOW = new Date("2026-09-28T09:00:00Z");
const AT = NOW.toISOString();

type KVEntry = { value: string; expirationTtl?: number };
type FakeKV = KVNamespace & { store: Map<string, KVEntry>; writes: number };

function fakeKV(): FakeKV {
  const store = new Map<string, KVEntry>();
  const kv = {
    store,
    writes: 0,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      kv.writes += 1;
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true };
    },
  };
  return kv as unknown as FakeKV;
}

function makeEnv(kv: FakeKV | null = fakeKV(), extra: Partial<Env> = {}): Env {
  return {
    SCOUT_TOKEN: TOKEN,
    ALLOWED_ORIGINS: `http://localhost:3000,${APP}`,
    SOCIAL_KV: kv ?? undefined,
    ...extra,
  };
}

type Handler = (url: URL, init: RequestInit | undefined) => Response | string | object;

const text = (body: string, status = 200, type = "text/plain") =>
  new Response(body, { status, headers: { "Content-Type": type } });
const jsonRes = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A mocked fetch answering by "host/path"; unmatched calls are 404. Records the URLs it was called with. */
function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const handler = routes[`${url.host}${url.pathname}`];
    if (!handler) return text("nope", 404);
    const out = handler(url, init);
    if (out instanceof Response) return out;
    return typeof out === "string" ? text(out) : jsonRes(out);
  });
  const urls = () =>
    fn.mock.calls.map(([input]) =>
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
    );
  return Object.assign(fn, { urls });
}

function ctx(env: Env, fetchImpl: typeof fetch, budget = RUN_BUDGET): SourceCtx {
  return { env, fetch: fetchImpl, budget: new Budget(budget), now: NOW };
}

function req(
  path: string,
  init: RequestInit & { token?: string | null; origin?: string | null; json?: unknown } = {},
): Request {
  const { token = TOKEN, origin = APP, json: body, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  if (origin !== null) headers.set("Origin", origin);
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    rest.body = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

function item(over: Partial<TrendItem> & { id: string }): TrendItem {
  return {
    platform: "google",
    region: "SA",
    lang: "ar",
    title: over.id,
    source: SOURCE_LABELS.google,
    seenAt: AT,
    tags: [],
    ...over,
  };
}

/* Google Trends batchexecute rows as probed on 2026-09-28 (geo=SA, 24 h). */
const RPC_ROWS = [
  [
    "belgium vs france",
    null,
    "SA",
    [1790617800],
    null,
    null,
    10000,
    null,
    1000,
    ["belgium vs france"],
    [17],
    [[4838405104, "en", "SA"]],
    "belgium vs france",
  ],
  [
    "حساب المواطن",
    null,
    "SA",
    [1790610600],
    null,
    null,
    10000,
    null,
    200,
    ["حساب المواطن", "حساب مواطن"],
    [11],
    [[4844195151, "ar", "SA"]],
    "حساب المواطن",
  ],
  [
    "flight cancellation and delay",
    null,
    "SA",
    [1790538600],
    [1790539800],
    null,
    100,
    null,
    800,
    ["flight cancellation and delay"],
    [19],
    [[4844412660, "en", "SA"]],
    "flight cancellation and delay",
  ],
];

const rpcAnswer = (rows: unknown[] = RPC_ROWS) =>
  `)]}'\n\n${JSON.stringify([
    ["wrb.fr", "i0OFE", JSON.stringify([null, rows]), null, null, null, "generic"],
    ["di", 37],
    ["af.httprm", 36, "-1234567890", 7],
  ])}`;

const RSS_SA = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
	<channel>
		<title>Daily Search Trends</title>
		<item>
			<title>ethiopia</title>
			<ht:approx_traffic>200+</ht:approx_traffic>
			<description/>
			<link>https://trends.google.com/trending/rss?geo=SA</link>
			<pubDate>Mon, 28 Sep 2026 12:10:00 -0700</pubDate>
			<ht:picture>https://encrypted-tbn3.gstatic.com/images?q=tbn:ANd9GcRKMwr</ht:picture>
			<ht:picture_source>ASHARQ AL-AWSAT English</ht:picture_source>
			<ht:news_item>
				<ht:news_item_title>Egyptian Source Denies Cairo Involvement in Ethiopia Unrest</ht:news_item_title>
				<ht:news_item_snippet/>
				<ht:news_item_url>https://english.aawsat.com/arab-world/5323055-egyptian-source</ht:news_item_url>
				<ht:news_item_source>ASHARQ AL-AWSAT English</ht:news_item_source>
			</ht:news_item>
			<ht:news_item>
				<ht:news_item_title>Second headline</ht:news_item_title>
				<ht:news_item_url>https://example.com/second</ht:news_item_url>
			</ht:news_item>
		</item>
		<item>
			<title>حساب المواطن</title>
			<ht:approx_traffic>20000+</ht:approx_traffic>
			<ht:picture>https://encrypted-tbn0.gstatic.com/images?q=tbn:citizen</ht:picture>
			<ht:news_item>
				<ht:news_item_title>حساب المواطن يودع الدفعة &amp; يوضح موعد الأهلية</ht:news_item_title>
				<ht:news_item_url>https://www.okaz.com.sa/news/local/2166000?a=1&amp;b=2</ht:news_item_url>
				<ht:news_item_source>عكاظ</ht:news_item_source>
			</ht:news_item>
		</item>
		<item>
			<title></title>
		</item>
	</channel>
</rss>`;

const KWORB_SA = `<div class="subcontainer"><table class="sortable" id="simpletable"><colgroup><col class="col-pos"><col class="col-pos"><col class="col-rest"></colgroup>
<thead><tr><th>Pos</th><th>P+</th><th class="mp text">Artist - Title</th></thead><tbody>
<tr><td>1</td><td>=</td><td class="mp text"><div>عايض - تعبت اكذب</div></td></tr>
<tr><td>2</td><td>=</td><td class="mp text"><div>لحن الحياة - موسيقى هادئة جميلة</div></td></tr>
<tr><td>3</td><td>=</td><td class="mp text"><div>Mohamed Nour &amp; Moustafa Amar - شوفتوا القمر</div></td></tr>
<tr><td>4</td><td>+1</td><td class="mp text"><div>محمود التركي - عاشق مجنون</div></td></tr>
<tr><td>15</td><td>NEW</td><td class="mp text"><div>Itz_shoaib_khan - Mehrab New Sad Song</div></td></tr>
</tbody></table></div>`;

const TRENDS24 = `<html><body><div class="px-2 scroll-smooth flex gap-x-4 w-fit pt-8"><div class=list-container><h3 class=title data-timestamp=1790620425.42>Mon Sep 28 2026 18:33:45 GMT+0000</h3><ol class=trend-card__list><li><span class=trend-name><a href="https://twitter.com/search?q=%23%D8%AA_%D8%A7%D9%84%D8%AD" class=trend-link>#ت_الح</a><span class=tweet-count data-count=""></span></span></li><li><span class=trend-name><a href="https://twitter.com/search?q=%23%D9%88%D9%84%D9%8A__%D8%A7%D9%84%D8%B9%D9%87%D8%AF" class=trend-link>#ولي__العهد</a><span class=tweet-count data-count="12K"></span></span></li><li><span class=trend-name><a href="https://twitter.com/search?q=%D8%A7%D9%84%D8%B9%D8%B1%D8%A7%D9%82" class=trend-link>العراق</a><span class=tweet-count data-count=""></span></span></li><li><span class=trend-name><a href="https://twitter.com/search?q=Rams&amp;src=x" class=trend-link>Rams</a><span class=tweet-count data-count="1.2M"></span></span></li></ol></div><div class=list-container><h3 class=title>older</h3><ol class=trend-card__list><li><span class=trend-name><a href="https://twitter.com/search?q=old" class=trend-link>#old_snapshot</a></span></li></ol></div></div></body></html>`;

const ytVideo = (id: string, title: string, duration: string, views: number, channel = "3z") => ({
  id,
  snippet: {
    title,
    channelTitle: channel,
    thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
  },
  contentDetails: { duration },
  statistics: { viewCount: String(views) },
});

/* ---------- normalize ---------- */

describe("normalize", () => {
  it("builds stable ids from titles of any script", () => {
    expect(slugify("  حساب المواطن ")).toBe("حساب-المواطن");
    expect(slugify("Belgium vs. France!")).toBe("belgium-vs-france");
    expect(slugify("#ولي__العهد")).toBe("ولي-العهد");
    expect(trendId("google", "SA", slugify("حساب المواطن"))).toBe("google:SA:حساب-المواطن");
    expect(trendId("x", "SA", "")).toBe("x:SA:untitled");
    expect(slugify("a".repeat(100)).length).toBe(80);
  });

  it("scores rank 1 as 100 and the last rank as 100 / total", () => {
    expect(rankScore(1, 25)).toBe(100);
    expect(rankScore(25, 25)).toBe(4);
    expect(rankScore(13, 25)).toBe(52);
    expect(rankScore(1, 1)).toBe(100);
    expect(rankScore(3, 0)).toBe(0);
  });

  it("parses approximate volumes", () => {
    expect(parseVolume("20000+")).toBe(20000);
    expect(parseVolume("12K")).toBe(12000);
    expect(parseVolume("1.2M")).toBe(1_200_000);
    expect(parseVolume("1,234")).toBe(1234);
    expect(parseVolume("")).toBeUndefined();
    expect(parseVolume("n/a")).toBeUndefined();
  });

  it("sorts score desc (unscored last) then seenAt desc, dedupes on the best score", () => {
    const a = item({ id: "a", score: 50, seenAt: "2026-09-28T08:00:00.000Z" });
    const b = item({ id: "b", score: 50, seenAt: "2026-09-28T09:00:00.000Z" });
    const c = item({ id: "c", seenAt: "2026-09-28T10:00:00.000Z" });
    const d = item({ id: "d", score: 90 });
    expect(sortItems([a, c, b, d]).map((i) => i.id)).toEqual(["d", "b", "a", "c"]);
    expect(dedupe([item({ id: "x", score: 10 }), item({ id: "x", score: 80 })])).toEqual([
      item({ id: "x", score: 80 }),
    ]);
  });

  it("merge: replaces the ran sources' rows, keeps the others until expiry, caps at MAX_ITEMS (400)", () => {
    const old = [
      item({ id: "google:SA:old", score: 10 }),
      item({ id: "youtube:SA:v1", platform: "youtube", source: SOURCE_LABELS.youtube, score: 60 }),
      item({
        id: "x:SA:gone",
        platform: "x",
        source: SOURCE_LABELS.x,
        score: 99,
        expiresAt: "2026-09-28T08:59:59Z",
      }),
      item({
        id: "x:SA:alive",
        platform: "x",
        source: SOURCE_LABELS.x,
        score: 70,
        expiresAt: "2026-09-29T09:00:00Z",
      }),
    ];
    const fresh = [item({ id: "google:SA:new", score: 100, url: undefined })];
    const merged = mergeItems(old, fresh, new Set([SOURCE_LABELS.google]), NOW);
    expect(merged.map((i) => i.id)).toEqual(["google:SA:new", "x:SA:alive", "youtube:SA:v1"]);
    expect("url" in merged[0]).toBe(false);

    expect(MAX_ITEMS).toBe(400);
    const many = Array.from({ length: MAX_ITEMS + 50 }, (_, i) =>
      item({ id: `google:SA:${i}`, score: i % 100 }),
    );
    const capped = mergeItems([], many, new Set([SOURCE_LABELS.google]), NOW);
    expect(capped).toHaveLength(MAX_ITEMS);
    // The cut takes the lowest scores: 450 rows hold every score of 0..99 four or five times.
    expect(Math.min(...capped.map((i) => i.score ?? -1))).toBe(10);
  });

  it("merge: a row already stored keeps its first-seen seenAt; a new or expired-and-back one gets now", () => {
    const monday = "2026-09-21T09:00:00.000Z";
    const old = [
      item({ id: "google:SA:still", seenAt: monday }),
      item({ id: "google:SA:back", seenAt: monday, expiresAt: "2026-09-23T09:00:00.000Z" }),
    ];
    const fresh = [
      item({ id: "google:SA:still" }),
      item({ id: "google:SA:back" }),
      item({ id: "google:SA:new" }),
    ];
    const merged = mergeItems(old, fresh, new Set([SOURCE_LABELS.google]), NOW);
    const seen = Object.fromEntries(merged.map((i) => [i.id, i.seenAt]));
    expect(seen).toEqual({ "google:SA:still": monday, "google:SA:back": AT, "google:SA:new": AT });
  });

  it("fetchText gives up on a hung call, the body read included", async () => {
    expect(FETCH_TIMEOUT_MS).toBe(12_000);
    /** Never answers, but aborts when the signal fires (what a real fetch does). */
    const hung = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    await expect(
      fetchText(hung, new Budget(5), "https://kworb.net/x", undefined, 20),
    ).rejects.toThrow("fetch failed: kworb.net");
    expect(hung.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

    /** Answers the headers at once, then never finishes the body (until the signal fires). */
    const slowBody = vi.fn<typeof fetch>(async (_input, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("partial"));
          init?.signal?.addEventListener("abort", () => c.error(init.signal!.reason));
        },
      });
      return new Response(body, { status: 200 });
    });
    await expect(
      fetchText(slowBody, new Budget(5), "https://trends24.in/x", { method: "GET" }, 20),
    ).rejects.toThrow("fetch failed: trends24.in");
    expect(slowBody.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });
});

/* ---------- Google Trends ---------- */

describe("google", () => {
  it("sends the batchexecute form the trending page sends", () => {
    const body = new URLSearchParams(googleRpcBody("SA", "ar"));
    expect(JSON.parse(body.get("f.req")!)).toEqual([
      [["i0OFE", '[null,null,"SA",0,"ar",24,1]', null, "generic"]],
    ]);
  });

  it("parses the RPC answer (plain and chunked framing) and rejects other shapes", () => {
    const rows = parseGoogleRpc(rpcAnswer());
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      title: "belgium vs france",
      startUnix: 1790617800,
      endUnix: undefined,
      volume: 10000,
      growthPct: 1000,
      related: ["belgium vs france"],
    });
    expect(rows[2].endUnix).toBe(1790539800);

    const chunked = `)]}'\n\n1234\n${JSON.stringify([
      [
        "wrb.fr",
        "i0OFE",
        JSON.stringify([null, RPC_ROWS.slice(0, 1)]),
        null,
        null,
        null,
        "generic",
      ],
    ])}\n25\n${JSON.stringify([["di", 37]])}\n`;
    expect(parseGoogleRpc(chunked)).toHaveLength(1);

    expect(() => parseGoogleRpc("<html>blocked</html>")).toThrow();
    expect(() => parseGoogleRpc(`)]}'\n[["wrb.fr","other","[]"]]`)).toThrow(/i0OFE/);
    expect(() => parseGoogleRpc(`)]}'\n[["wrb.fr","i0OFE","[null,[]]"]]`)).toThrow(/empty/);
  });

  it("parses the RSS feed with entities decoded and the first news item only", () => {
    const items = parseGoogleRss(RSS_SA);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: "ethiopia",
      volume: 200,
      picture: "https://encrypted-tbn3.gstatic.com/images?q=tbn:ANd9GcRKMwr",
      newsTitle: "Egyptian Source Denies Cairo Involvement in Ethiopia Unrest",
      newsUrl: "https://english.aawsat.com/arab-world/5323055-egyptian-source",
      newsSource: "ASHARQ AL-AWSAT English",
    });
    expect(items[1].newsTitle).toBe("حساب المواطن يودع الدفعة & يوضح موعد الأهلية");
    expect(items[1].newsUrl).toBe("https://www.okaz.com.sa/news/local/2166000?a=1&b=2");
  });

  it("builds rows from the RPC by volume, enriched from the RSS by title", () => {
    const rows = googleItems("SA", "SA", parseGoogleRpc(rpcAnswer()), parseGoogleRss(RSS_SA), NOW);
    expect(rows.map((r) => r.title)).toEqual([
      "belgium vs france",
      "حساب المواطن",
      "flight cancellation and delay",
    ]);
    expect(rows[0]).toMatchObject({
      id: "google:SA:belgium-vs-france",
      platform: "google",
      region: "SA",
      lang: "ar",
      score: 100,
      volume: 10000,
      growthPct: 1000,
      source: "Google Trends",
      url: "https://trends.google.com/trends/explore?q=belgium%20vs%20france&geo=SA",
      seenAt: AT,
      expiresAt: "2026-09-30T09:00:00.000Z",
      tags: [],
    });
    expect(rows[0].why).toBeUndefined();
    expect(rows[1]).toMatchObject({
      id: "google:SA:حساب-المواطن",
      score: 67,
      why: "حساب المواطن يودع الدفعة & يوضح موعد الأهلية",
      url: "https://www.okaz.com.sa/news/local/2166000?a=1&b=2",
      thumb: "https://encrypted-tbn0.gstatic.com/images?q=tbn:citizen",
      tags: ["حساب مواطن"],
    });
  });

  it("falls back to the RSS alone (degraded) and fails only when both are gone", async () => {
    const env = makeEnv();
    const rssOnly = mockFetch({
      "trends.google.com/_/TrendsUi/data/batchexecute": () => text("<html>429</html>", 429),
      "trends.google.com/trending/rss": (url) =>
        url.searchParams.get("geo") === "SA" ? RSS_SA : RSS_SA,
    });
    const out = await runGoogle(ctx(env, rssOnly));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.degraded).toBe(true);
    expect(out.note).toMatch(/SA: rpc: http 429 \(rss only\)/);
    expect(out.items.map((i) => i.id)).toEqual([
      "google:SA:ethiopia",
      "google:SA:حساب-المواطن",
      "google:US:ethiopia",
      "google:US:حساب-المواطن",
    ]);
    expect(out.items[0]).toMatchObject({ score: 100, volume: 200, lang: "ar" });
    expect(out.items[2].lang).toBe("en");
    expect(rssOnly).toHaveBeenCalledTimes(4);

    const both = await runGoogle(ctx(env, mockFetch({})));
    expect(both).toEqual({
      ok: false,
      error: expect.stringMatching(/SA: rpc: http 404; rss: http 404/),
    });

    const full = mockFetch({
      "trends.google.com/_/TrendsUi/data/batchexecute": (url, init) => {
        expect(url.searchParams.get("rpcids")).toBe("i0OFE");
        expect(String(init?.body)).toContain("f.req=");
        return rpcAnswer();
      },
      "trends.google.com/trending/rss": () => RSS_SA,
    });
    const ok = await runGoogle(ctx(env, full));
    expect(ok.ok && !ok.degraded).toBe(true);
    if (ok.ok) expect(ok.items).toHaveLength(6);
  });
});

/* ---------- YouTube charts ---------- */

describe("youtube charts", () => {
  it("reads ISO durations", () => {
    expect(durationSeconds("PT45S")).toBe(45);
    expect(durationSeconds("PT3M")).toBe(180);
    expect(durationSeconds("PT1H2M3S")).toBe(3723);
    expect(durationSeconds("P1DT1S")).toBe(86_401);
    expect(durationSeconds(undefined)).toBe(0);
  });

  it("reports not_configured without a key and makes no call", async () => {
    const fetchMock = mockFetch({});
    expect(await runYoutube(ctx(makeEnv(), fetchMock))).toEqual({
      ok: false,
      error: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks both regions and both categories, tags shorts, skips a missing chart", async () => {
    const fetchMock = mockFetch({
      "www.googleapis.com/youtube/v3/videos": (url) => {
        expect(url.searchParams.get("chart")).toBe("mostPopular");
        expect(url.searchParams.get("key")).toBe("yt-key");
        expect(url.searchParams.get("maxResults")).toBe("25");
        const cat = url.searchParams.get("videoCategoryId");
        const region = url.searchParams.get("regionCode");
        if (cat === "26" && region === "SA") {
          return jsonRes({ error: { code: 404, errors: [{ reason: "videoChartNotFound" }] } }, 404);
        }
        return {
          items: [
            ytVideo(`${region}${cat ?? "0"}a`, "Long one", "PT10M5S", 5000, "Channel A"),
            ytVideo(`${region}${cat ?? "0"}b`, "Short one\nsecond line", "PT45S", 300),
          ],
        };
      },
    });
    const out = await runYoutube(ctx(makeEnv(fakeKV(), { YOUTUBE_API_KEY: "yt-key" }), fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.items).toHaveLength(6);
    expect(out.items[0]).toEqual({
      id: "youtube:SA:SA0a",
      platform: "youtube",
      region: "SA",
      lang: "ar",
      title: "Long one",
      url: "https://www.youtube.com/watch?v=SA0a",
      thumb: "https://i.ytimg.com/vi/SA0a/mqdefault.jpg",
      score: 100,
      volume: 5000,
      source: "YouTube charts",
      why: "Channel A",
      seenAt: AT,
      expiresAt: "2026-09-30T09:00:00.000Z",
      tags: [],
    });
    expect(out.items[1]).toMatchObject({
      id: "youtube:SA:SA0b",
      title: "Short one second line",
      url: "https://www.youtube.com/shorts/SA0b",
      score: 50,
      tags: ["short"],
    });
    const howto = out.items.find((i) => i.id === "youtube:US:US26a")!;
    expect(howto).toMatchObject({ lang: "en", tags: ["how-to"] });
    expect(out.items.find((i) => i.id === "youtube:US:US26b")!.tags).toEqual(["how-to", "short"]);
  });

  it("turns a quota error into a failure", async () => {
    const fetchMock = mockFetch({
      "www.googleapis.com/youtube/v3/videos": () =>
        jsonRes({ error: { code: 403, errors: [{ reason: "quotaExceeded" }] } }, 403),
    });
    expect(await runYoutube(ctx(makeEnv(fakeKV(), { YOUTUBE_API_KEY: "k" }), fetchMock))).toEqual({
      ok: false,
      error: "quota",
    });
  });
});

/* ---------- genres ---------- */

describe("genres", () => {
  const drift = {
    id: "drift",
    emoji: "🏎️",
    name: { ar: "هجولة", en: "Drift" },
    queries: { ar: ["ايديت هجولة"], en: ["drift edit", "drift cinematic"] },
  };

  it("bundles the planning file: twelve genres, two keywords each", () => {
    expect(GENRES.map((g) => g.id)).toEqual([
      "cars",
      "food",
      "anime",
      "travel",
      "football",
      "coffee",
      "perfume",
      "camping",
      "fashion",
      "gaming",
      "weddings",
      "gym",
    ]);
    expect(GENRES[0]).toEqual({
      id: "cars",
      emoji: "🚗",
      name: { ar: "سيارات", en: "Cars" },
      queries: { ar: ["ايديت سيارات", "مونتاج سيارات"], en: ["car edit", "cinematic car edit"] },
      hashtags: ["caredit", "carsoftiktok"],
    });
    expect(GENRE_KEYWORDS).toHaveLength(24);
    expect(GENRE_KEYWORDS.slice(0, 3)).toEqual([
      { q: "ايديت سيارات", region: "SA", lang: "ar", genre: "cars" },
      { q: "car edit", region: "US", lang: "en", genre: "cars" },
      { q: "مونتاج أكل", region: "SA", lang: "ar", genre: "food" },
    ]);
  });

  it("checks an entry by the rules of the dashboard's GenreSchema", () => {
    expect(parseGenre(drift)).toEqual({ ...drift, hashtags: [] });
    expect(parseGenre({ ...drift, hashtags: ["drift_edit", "drift2"] })?.hashtags).toEqual([
      "drift_edit",
      "drift2",
    ]);
    for (const bad of [
      null,
      "drift",
      { ...drift, id: "Drift" },
      { ...drift, id: "1drift" },
      { ...drift, id: "" },
      { ...drift, emoji: "" },
      { ...drift, name: { ar: "هجولة" } },
      { ...drift, queries: { ar: [], en: ["drift edit"] } },
      { ...drift, queries: { ar: ["ايديت هجولة"], en: [""] } },
      { ...drift, queries: { ar: ["ايديت هجولة"] } },
      { ...drift, queries: undefined },
      { ...drift, hashtags: ["Drift Edit"] },
      { ...drift, hashtags: "drift" },
    ]) {
      expect(parseGenre(bad)).toBeNull();
    }
  });

  it("drops malformed entries and repeated ids, and reads version 1 only", () => {
    const drone = { ...drift, id: "drone", name: { ar: "درون", en: "Drone" } };
    const file = {
      version: 1,
      genres: [drift, { ...drift, emoji: "" }, { ...drone, id: "drift" }, drone],
    };
    expect(parseGenres(file).map((g) => [g.id, g.name.en])).toEqual([
      ["drift", "Drift"],
      ["drone", "Drone"],
    ]);
    expect(parseGenres({ version: 2, genres: [drift] })).toEqual([]);
    expect(parseGenres({ version: 1 })).toEqual([]);
    expect(parseGenres([drift])).toEqual([]);
    expect(parseGenres(null)).toEqual([]);
    expect(genreKeywords(parseGenres({ version: 1, genres: [drift] }))).toEqual([
      { q: "ايديت هجولة", region: "SA", lang: "ar", genre: "drift" },
      { q: "drift edit", region: "US", lang: "en", genre: "drift" },
    ]);
  });
});

/* ---------- YouTube keyword search ---------- */

describe("youtube search", () => {
  const DAY = 86_400_000;
  const COUNTER = trendKeys.ytsearch("2026-09-28");
  const kw = (q: string, lang: "ar" | "en", genre?: string): Keyword => ({
    q,
    region: lang === "ar" ? "SA" : "US",
    lang,
    ...(genre ? { genre } : {}),
  });
  const keyOf = (k: { q: string; region: string }) => `${k.region}:${k.q}`;
  const rowKey = (i: TrendItem) => `${i.region}:${i.tags[0]}`;
  const calls = (fetchMock: { urls: () => string[] }, prefix: string) =>
    fetchMock.urls().filter((u) => u.startsWith(prefix));

  it("lists the niche keywords then the genres' main queries, Arabic and English interleaved", () => {
    const list = keywordList({});
    expect(list).toHaveLength(36);
    expect(list.slice(0, 4)).toEqual([
      { q: "تصوير", region: "SA", lang: "ar" },
      { q: "davinci resolve", region: "US", lang: "en" },
      { q: "مونتاج", region: "SA", lang: "ar" },
      { q: "color grading", region: "US", lang: "en" },
    ]);
    // Niche keywords carry no genre; the genres follow in the file's order, tagged.
    expect(list.slice(0, 12).some((k) => "genre" in k)).toBe(false);
    expect(list.slice(12, 16)).toEqual([
      { q: "ايديت سيارات", region: "SA", lang: "ar", genre: "cars" },
      { q: "car edit", region: "US", lang: "en", genre: "cars" },
      { q: "مونتاج أكل", region: "SA", lang: "ar", genre: "food" },
      { q: "food edit", region: "US", lang: "en", genre: "food" },
    ]);
    expect(list.slice(12).map((k) => k.genre)).toEqual(GENRES.flatMap((g) => [g.id, g.id]));

    // The env lists replace the niche defaults, never the genres.
    const own = keywordList({ TREND_KEYWORDS_AR: "مونتاج, مونتاج ,", TREND_KEYWORDS_EN: "b-roll" });
    expect(own).toHaveLength(26);
    expect(own.slice(0, 3)).toEqual([
      { q: "مونتاج", region: "SA", lang: "ar" },
      { q: "b-roll", region: "US", lang: "en" },
      { q: "ايديت سيارات", region: "SA", lang: "ar", genre: "cars" },
    ]);

    // A niche keyword that is also a genre's main query is searched once and carries the genre.
    const both = keywordList({ TREND_KEYWORDS_EN: "Car Edit,b-roll" });
    expect(both).toHaveLength(18 + 13);
    expect(both.filter((k) => k.q.toLowerCase() === "car edit")).toEqual([
      { q: "Car Edit", region: "US", lang: "en", genre: "cars" },
    ]);
  });

  it("rotates the plan by UTC day: two days in a row search every keyword, never more than the cap a day", () => {
    const list = keywordList({});
    const next = new Date(NOW.getTime() + DAY);
    expect([dayNumber(NOW), planOffset(NOW, list.length)]).toEqual([20_724, 0]);
    expect(planOffset(next, list.length)).toBe(SEARCH_CAP);
    expect(keywordPlan({}, NOW)).toEqual(list);
    expect(keywordPlan({}, next)).toEqual([
      ...list.slice(SEARCH_CAP),
      ...list.slice(0, SEARCH_CAP),
    ]);
    // One plan for the whole UTC day.
    expect(keywordPlan({}, new Date("2026-09-29T00:00:00Z"))).toEqual(
      keywordPlan({}, new Date("2026-09-29T23:59:59Z")),
    );

    for (const env of [{}, { TREND_KEYWORDS_AR: "مونتاج", TREND_KEYWORDS_EN: "b-roll" }]) {
      const all = keywordList(env);
      for (let d = 0; d < 6; d++) {
        const plan = keywordPlan(env, new Date(NOW.getTime() + d * DAY));
        const today = plan.slice(0, SEARCH_CAP);
        const tomorrow = keywordPlan(env, new Date(NOW.getTime() + (d + 1) * DAY)).slice(
          0,
          SEARCH_CAP,
        );
        // A rotation: the same keywords, none twice.
        expect(plan.map(keyOf).sort()).toEqual(all.map(keyOf).sort());
        expect(today).toHaveLength(SEARCH_CAP);
        expect(new Set([...today, ...tomorrow].map(keyOf))).toEqual(new Set(all.map(keyOf)));
        // Both tabs get their share every day.
        expect(today.filter((k) => k.lang === "ar")).toHaveLength(SEARCH_CAP / 2);
      }
    }

    // A plan that fits in one run is not rotated; a longer one takes ceil(length / cap) days.
    expect(planOffset(next, SEARCH_CAP)).toBe(0);
    const searchedIn = (days: number, length: number) => {
      const seen = new Set<number>();
      for (let d = 0; d < days; d++) {
        const from = planOffset(new Date(NOW.getTime() + d * DAY), length);
        for (let i = 0; i < SEARCH_CAP; i++) seen.add((from + i) % length);
      }
      return seen.size;
    };
    for (const length of [19, 26, 31, 36]) expect(searchedIn(2, length)).toBe(length);
    expect([searchedIn(2, 50), searchedIn(3, 50)]).toEqual([36, 50]);
  });

  it("shares the statistics call's ids between the keywords, each keyword's most viewed first", () => {
    expect(pickVideoIds([["a1", "a2", "a3"], ["b1"], [], ["c1", "c2"]], 4)).toEqual([
      "a1",
      "b1",
      "c1",
      "a2",
    ]);
    expect(pickVideoIds([["a1", "a2"], ["b1"]])).toEqual(["a1", "b1", "a2"]);
    expect(pickVideoIds([])).toEqual([]);
    expect(STATS_MAX_IDS).toBe(50);
  });

  /** `views`: a video's views by its id and its place in the statistics call (default 1000, 2000, …). */
  function ytFetch(
    searchIds: (q: string) => string[],
    now: Date = NOW,
    views: (id: string, i: number) => number = (_id, i) => 1000 * (i + 1),
  ) {
    return mockFetch({
      "www.googleapis.com/youtube/v3/search": (url) => {
        expect(url.searchParams.get("type")).toBe("video");
        expect(url.searchParams.get("order")).toBe("viewCount");
        expect(url.searchParams.get("videoDuration")).toBe("short");
        expect(url.searchParams.get("maxResults")).toBe("10");
        expect(url.searchParams.get("publishedAfter")).toBe(
          new Date(now.getTime() - 7 * DAY).toISOString(),
        );
        const lang = url.searchParams.get("relevanceLanguage");
        expect(url.searchParams.get("regionCode")).toBe(lang === "ar" ? "SA" : "US");
        return {
          items: searchIds(url.searchParams.get("q")!).map((videoId) => ({ id: { videoId } })),
        };
      },
      "www.googleapis.com/youtube/v3/videos": (url) => {
        const ids = url.searchParams.get("id")!.split(",");
        return { items: ids.map((id, i) => ytVideo(id, `Video ${id}`, "PT30S", views(id, i))) };
      },
    });
  }

  it("runs the keywords the day's cap allows, one statistics call, and writes the counter", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { YOUTUBE_API_KEY: "k" });
    const fetchMock = ytFetch((q) => (q === "مونتاج" ? ["ar1", "ar2"] : ["en1", "ar2"]));
    const out = await runYoutubeSearch(ctx(env, fetchMock), [
      kw("مونتاج", "ar"),
      kw("b-roll", "en"),
    ]);
    expect(calls(fetchMock, YT_SEARCH_URL)).toHaveLength(2);
    expect(calls(fetchMock, YT_VIDEOS_URL)).toHaveLength(1);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Views: ar1 1000, ar2 2000, en1 3000, ranked per language: ar2 and en1 are both a rank 1.
    expect(out.items.map((i) => [i.id, i.score, i.tags, i.lang, i.region])).toEqual([
      ["youtube:SA:q-ar2", 100, ["مونتاج", "short"], "ar", "SA"],
      ["youtube:US:q-en1", 100, ["b-roll", "short"], "en", "US"],
      ["youtube:SA:q-ar1", 50, ["مونتاج", "short"], "ar", "SA"],
    ]);
    expect(out.items[0]).toMatchObject({
      source: "YouTube search",
      expiresAt: "2026-10-05T09:00:00.000Z",
    });
    // Rows of a niche keyword carry no genre.
    expect(out.items.some((i) => "genre" in i)).toBe(false);
    expect(out.note).toBe("2 search calls (2/18 today)");
    expect(await readSearchCount(env, utcDay(NOW))).toBe(2);
    expect(kv.store.get(COUNTER)!.expirationTtl).toBe(2 * 86_400);
  });

  it("searches the day's 18 keywords of the whole plan and tags the genre rows", async () => {
    const env = makeEnv(fakeKV(), { YOUTUBE_API_KEY: "k" });
    // Ten videos per keyword: 180 found, 50 asked about, and every keyword keeps its most viewed ones.
    const fetchMock = ytFetch((q) => Array.from({ length: 10 }, (_, i) => `${q} ${i}`));
    const run = ctx(env, fetchMock);
    const out = await runYoutubeSearch(run);
    const today = keywordPlan(env, NOW).slice(0, SEARCH_CAP);
    expect(SEARCH_CAP).toBe(18);
    expect(calls(fetchMock, YT_SEARCH_URL).map((u) => new URL(u).searchParams.get("q"))).toEqual(
      today.map((k) => k.q),
    );
    const stats = calls(fetchMock, YT_VIDEOS_URL);
    expect(stats).toHaveLength(1);
    expect(new URL(stats[0]).searchParams.get("id")!.split(",")).toHaveLength(50);
    // 18 searches and the statistics call, of the run's 38.
    expect(run.budget.left).toBe(RUN_BUDGET - 19);
    if (!out.ok) throw new Error(out.error);
    expect(out.note).toBe("18 search calls (18/18 today)");
    expect(out.items).toHaveLength(50);
    for (const k of today) {
      const rows = out.items.filter((i) => rowKey(i) === keyOf(k));
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(
        rows
          .map((r) => r.title)
          .sort()
          .slice(0, 2),
      ).toEqual([`Video ${k.q} 0`, `Video ${k.q} 1`]);
      // Rows of a genre keyword carry its id, rows of a niche keyword carry none.
      expect(rows.every((r) => r.genre === k.genre && "genre" in r === !!k.genre)).toBe(true);
    }
    // 2026-09-28 is the day of the 12 niche keywords and the first three genres.
    expect(today.filter((k) => !k.genre)).toHaveLength(12);
    expect([...new Set(out.items.flatMap((i) => (i.genre ? [i.genre] : [])))].sort()).toEqual([
      "anime",
      "cars",
      "food",
    ]);
  });

  it("gives a row the genre of the genre keyword that found it, whichever keyword found it first", async () => {
    const env = makeEnv(fakeKV(), { YOUTUBE_API_KEY: "k" });
    const plan = [kw("مونتاج", "ar"), kw("car edit", "en", "cars"), kw("food edit", "en", "food")];
    const fetchMock = ytFetch((q) =>
      q === "مونتاج" ? ["n1", "both"] : q === "car edit" ? ["both", "c1"] : ["c1", "f1"],
    );
    const out = await runYoutubeSearch(ctx(env, fetchMock), plan);
    if (!out.ok) throw new Error(out.error);
    expect(Object.fromEntries(out.items.map((i) => [i.id, [i.tags[0], i.genre]]))).toEqual({
      "youtube:SA:q-n1": ["مونتاج", undefined],
      "youtube:SA:q-both": ["مونتاج", "cars"],
      "youtube:US:q-c1": ["car edit", "cars"],
      "youtube:US:q-f1": ["food edit", "food"],
    });
    expect("genre" in out.items.find((i) => i.id === "youtube:SA:q-n1")!).toBe(false);
  });

  it("honours the daily cap across runs and per run", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { YOUTUBE_API_KEY: "k" });
    await kv.put(COUNTER, String(SEARCH_CAP - 2));
    const fetchMock = ytFetch(() => ["v"]);
    const out = await runYoutubeSearch(ctx(env, fetchMock));
    expect(out.ok).toBe(true);
    expect(calls(fetchMock, YT_SEARCH_URL)).toHaveLength(2);
    expect(await readSearchCount(env, "2026-09-28")).toBe(SEARCH_CAP);

    const capped = mockFetch({});
    expect(await runYoutubeSearch(ctx(env, capped))).toEqual({
      ok: false,
      error: "daily cap reached",
    });
    expect(capped).not.toHaveBeenCalled();

    // A fresh day with a long plan (44 keywords): never more than SEARCH_CAP searches in one run.
    const fresh = makeEnv(fakeKV(), {
      YOUTUBE_API_KEY: "k",
      TREND_KEYWORDS_AR: Array.from({ length: 10 }, (_, i) => `ع${i}`).join(","),
      TREND_KEYWORDS_EN: Array.from({ length: 10 }, (_, i) => `e${i}`).join(","),
    });
    expect(keywordList(fresh)).toHaveLength(44);
    const many = ytFetch((q) => [q]);
    await runYoutubeSearch(ctx(fresh, many));
    expect(calls(many, YT_SEARCH_URL)).toHaveLength(SEARCH_CAP);
    expect(await readSearchCount(fresh, "2026-09-28")).toBe(SEARCH_CAP);

    // A run short of calls searches what its budget allows, the statistics call included.
    const tight = ytFetch((q) => [q]);
    await runYoutubeSearch(ctx(makeEnv(fakeKV(), { YOUTUBE_API_KEY: "k" }), tight, 5));
    expect(calls(tight, YT_SEARCH_URL)).toHaveLength(4);
    expect(calls(tight, YT_VIDEOS_URL)).toHaveLength(1);
  });

  it("keeps the stored rows of the keywords it did not search, and only those", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { YOUTUBE_API_KEY: "k" });
    const SEEN = "2026-09-27T21:05:00.000Z";
    const stored = (id: string, keyword: string, over: Partial<TrendItem> = {}) =>
      item({
        id: `youtube:SA:q-${id}`,
        platform: "youtube",
        source: SOURCE_LABELS.youtubeSearch,
        tags: [keyword, "short"],
        volume: 10,
        score: 50,
        seenAt: SEEN,
        expiresAt: "2026-10-04T21:05:00.000Z",
        ...over,
      });
    const previous = [
      stored("kept", "ايديت سيارات", { volume: 5000, genre: "cars" }),
      // Found again by today's search: the new row wins.
      stored("again", "ايديت سيارات", { genre: "cars" }),
      stored("expired", "ايديت سيارات", { expiresAt: "2026-09-28T08:00:00.000Z" }),
      // Its keyword was searched today.
      stored("replaced", "مونتاج"),
      // Its keyword left the plan, or is another region's.
      stored("unplanned", "كلمة قديمة"),
      stored("elsewhere", "ايديت سيارات", { id: "youtube:US:q-elsewhere", region: "US" }),
      // Another source's row is not this source's to keep (run.ts does that).
      item({ id: "google:SA:row", score: 90 }),
    ];
    // One search left today: the second keyword waits for its own day.
    await kv.put(COUNTER, String(SEARCH_CAP - 1));
    const fetchMock = ytFetch(() => ["new", "again"]);
    const out = await runYoutubeSearch({ ...ctx(env, fetchMock), previous }, [
      kw("مونتاج", "ar"),
      kw("ايديت سيارات", "ar", "cars"),
    ]);
    expect(calls(fetchMock, YT_SEARCH_URL)).toHaveLength(1);
    if (!out.ok) throw new Error(out.error);
    // One ranking by views for the run's rows and the kept ones (all Arabic here): kept 5000, again
    // 2000, new 1000.
    expect(out.items.map((i) => [i.id, i.score, i.tags[0], i.genre, i.seenAt])).toEqual([
      ["youtube:SA:q-kept", 100, "ايديت سيارات", "cars", SEEN],
      ["youtube:SA:q-again", 67, "مونتاج", undefined, AT],
      ["youtube:SA:q-new", 33, "مونتاج", undefined, AT],
    ]);
    expect(out.items[0].expiresAt).toBe("2026-10-04T21:05:00.000Z");

    expect(
      keptRows(previous, [kw("مونتاج", "ar")], new Set(), new Set(), NOW).map((i) => i.id),
    ).toEqual(["youtube:SA:q-replaced"]);
    expect(keptRows(previous, [], new Set(), new Set(), NOW)).toEqual([]);
  });

  it("scores each language on its own: rank 1 = 100 among the Arabic rows and among the English rows", async () => {
    const row = (
      id: string,
      lang: "ar" | "en",
      volume?: number,
      over: Partial<TrendItem> = {},
    ): TrendItem =>
      item({
        id: `youtube:${lang === "ar" ? "SA" : "US"}:q-${id}`,
        platform: "youtube",
        region: lang === "ar" ? "SA" : "US",
        lang,
        source: SOURCE_LABELS.youtubeSearch,
        ...(volume === undefined ? {} : { volume }),
        ...over,
      });
    // English Shorts have the views: one ranking for both would score the Arabic rows 60, 40 and 20.
    const ranked = rankByViews([
      row("en-big", "en", 9_000_000),
      row("ar-small", "ar", 50),
      row("en-mid", "en", 500_000),
      row("ar-big", "ar", 40_000),
      row("ar-none", "ar"),
    ]);
    // On an equal score (and seenAt) the Arabic row comes first.
    expect(ranked.map((i) => [i.id, i.score])).toEqual([
      ["youtube:SA:q-ar-big", 100],
      ["youtube:US:q-en-big", 100],
      ["youtube:SA:q-ar-small", 67],
      ["youtube:US:q-en-mid", 50],
      ["youtube:SA:q-ar-none", 33],
    ]);
    expect(rankByViews([row("only", "en", 1)]).map((i) => i.score)).toEqual([100]);
    expect(rankByViews([])).toEqual([]);

    // The rows a run brought and the ones it keeps are ranked together, language by language.
    const kv = fakeKV();
    const env = makeEnv(kv, { YOUTUBE_API_KEY: "k" });
    const SEEN = "2026-09-27T21:05:00.000Z";
    const previous = [
      row("kept-ar", "ar", 5000, { tags: ["ايديت سيارات", "short"], genre: "cars", seenAt: SEEN }),
      row("kept-en", "en", 500, { tags: ["car edit", "short"], genre: "cars", seenAt: SEEN }),
    ];
    // Two searches left today: the two genre keywords wait for their own day.
    await kv.put(COUNTER, String(SEARCH_CAP - 2));
    const fetchMock = ytFetch((q) => (q === "مونتاج" ? ["a1", "a2"] : ["e1"]));
    const out = await runYoutubeSearch({ ...ctx(env, fetchMock), previous }, [
      kw("مونتاج", "ar"),
      kw("b-roll", "en"),
      kw("ايديت سيارات", "ar", "cars"),
      kw("car edit", "en", "cars"),
    ]);
    expect(calls(fetchMock, YT_SEARCH_URL)).toHaveLength(2);
    if (!out.ok) throw new Error(out.error);
    // Arabic: kept-ar 5000, a2 2000, a1 1000. English: e1 3000, kept-en 500. Newer first on a tie.
    expect(out.items.map((i) => [i.id, i.lang, i.volume, i.score])).toEqual([
      ["youtube:US:q-e1", "en", 3000, 100],
      ["youtube:SA:q-kept-ar", "ar", 5000, 100],
      ["youtube:SA:q-a2", "ar", 2000, 67],
      ["youtube:US:q-kept-en", "en", 500, 50],
      ["youtube:SA:q-a1", "ar", 1000, 33],
    ]);
  });

  it("over two days the feed holds the rows of every keyword (runTrends hands over the stored rows)", async () => {
    const env = makeEnv(fakeKV(), { YOUTUBE_API_KEY: "k", TREND_SOURCES: "youtube" });
    const all = keywordList(env);
    const run = (now: Date) =>
      runTrends(env, { kinds: ["daily"], now, fetch: ytFetch((q) => [`v ${q}`], now) });

    const day1 = await run(NOW);
    expect(day1.sources).toEqual([
      { name: "YouTube search", ok: true, at: AT, error: "18 search calls (18/18 today)" },
    ]);
    expect(day1.items.map(rowKey).sort()).toEqual(all.slice(0, SEARCH_CAP).map(keyOf).sort());

    const day2 = await run(new Date(NOW.getTime() + DAY));
    expect(day2.items.map(rowKey).sort()).toEqual(all.map(keyOf).sort());
    expect(new Set(day2.items.flatMap((i) => (i.genre ? [i.genre] : [])))).toEqual(
      new Set(GENRES.map((g) => g.id)),
    );
    expect(day2.items.filter((i) => !i.genre)).toHaveLength(12);
    expect(day2.items[0].score).toBe(100);
    expect(day2.degraded).toBe(false);

    // The third day searches the first day's keywords again: still one row per keyword, first seen kept.
    const day3 = await run(new Date(NOW.getTime() + 2 * DAY));
    expect(day3.items.map(rowKey).sort()).toEqual(all.map(keyOf).sort());
    expect(day3.items.find((i) => i.tags[0] === "تصوير")).toMatchObject({
      seenAt: AT,
      expiresAt: new Date(NOW.getTime() + 9 * DAY).toISOString(),
    });
  });

  it("keeps the rows of every keyword of both languages when the other sources fill the feed to their caps", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, {
      YOUTUBE_API_KEY: "k",
      TREND_SOURCES: "google,youtube,kworb,x,tavily,events",
    });
    const all = keywordList(env);
    expect(all).toHaveLength(36);

    // Every other source at its cap, as its own runs stored it, alive on both days.
    const expiresAt = new Date(NOW.getTime() + 3 * DAY).toISOString();
    const full = (
      source: TrendItem["source"],
      platform: TrendItem["platform"],
      region: TrendItem["region"],
      slug: string,
      count: number,
    ) =>
      Array.from({ length: count }, (_, i) =>
        item({
          id: `${platform}:${region}:${slug}-${i}`,
          platform,
          region,
          lang: region === "US" ? "en" : "ar",
          source,
          score: rankScore(i + 1, count),
          expiresAt,
        }),
      );
    const moments = eventItems(SAUDI_EVENTS, NOW).map((e) => ({ ...e, expiresAt }));
    expect(moments.length).toBeGreaterThan(0);
    const others = [
      ...GOOGLE_REGIONS.flatMap(({ region }) =>
        full(SOURCE_LABELS.google, "google", region, "g", GOOGLE_MAX_PER_REGION),
      ),
      ...YT_REGIONS.flatMap((region) =>
        YT_CATEGORIES.flatMap((cat) =>
          full(SOURCE_LABELS.youtube, "youtube", region, `chart${cat.id}`, YT_MAX_RESULTS),
        ),
      ),
      ...KWORB_REGIONS.flatMap(({ region }) =>
        full(SOURCE_LABELS.kworb, "tiktok", region, "sound", KWORB_MAX),
      ),
      ...full(SOURCE_LABELS.x, "x", "SA", "tag", X_MAX),
      ...full(SOURCE_LABELS.tavily, "instagram", "SA", "scan", TAVILY_MAX_ITEMS),
      ...moments,
    ];
    expect(others).toHaveLength(50 + 100 + 60 + 30 + 40 + moments.length);
    const stored: TrendsFeed = { items: others, fetchedAt: AT, degraded: false, sources: [] };
    await kv.put(trendKeys.latest, JSON.stringify(stored));

    // Ten videos per keyword. English has the views and the genres (the end of the plan) the fewest, so
    // the Arabic genre rows are the scan's least viewed ones, as they are live.
    const place = new Map(all.map((k, i) => [k.q, i]));
    const views = (id: string) => {
      const at = place.get(id.slice(0, id.lastIndexOf(" ")))!;
      const nth = Number(id.slice(id.lastIndexOf(" ") + 1));
      return (all.length - at) * (all[at].lang === "en" ? 100_000 : 100) - nth;
    };
    const run = (now: Date) =>
      runTrends(env, {
        kinds: ["daily"],
        now,
        fetch: ytFetch((q) => Array.from({ length: 10 }, (_, i) => `${q} ${i}`), now, views),
      });

    const day1 = await run(NOW);
    expect(day1.items).toHaveLength(others.length + STATS_MAX_IDS);
    const day2 = await run(new Date(NOW.getTime() + DAY));
    expect(day2.degraded).toBe(false);

    const scan = day2.items.filter((i) => i.source === SOURCE_LABELS.youtubeSearch);
    expect(scan).toHaveLength(2 * STATS_MAX_IDS);
    // Every keyword still has the two or three rows its search brought, the first day's included.
    for (const k of all) {
      const rows = scan.filter((i) => rowKey(i) === keyOf(k));
      expect(rows.length, keyOf(k)).toBeGreaterThanOrEqual(2);
      expect(rows.every((r) => r.lang === k.lang && r.genre === k.genre)).toBe(true);
    }
    // Each language has its own ranking, from its most viewed row down to its least viewed one.
    for (const lang of ["ar", "en"] as const) {
      const scores = scan.filter((i) => i.lang === lang).map((i) => i.score ?? -1);
      expect(scores).toHaveLength(STATS_MAX_IDS);
      expect([Math.max(...scores), Math.min(...scores)]).toEqual([100, 2]);
    }
    // Nothing was cut: every source's rows fit under the feed's cap together.
    expect(day2.items.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(day2.items.map((i) => i.id).sort()).toEqual(
      [...others, ...scan].map((i) => i.id).sort(),
    );
  });

  it("stops at the first error and keeps what it got, or fails when nothing came", async () => {
    const env = makeEnv(fakeKV(), { YOUTUBE_API_KEY: "k" });
    let n = 0;
    const flaky = mockFetch({
      "www.googleapis.com/youtube/v3/search": () =>
        n++ === 0
          ? { items: [{ id: { videoId: "one" } }] }
          : jsonRes({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403),
      "www.googleapis.com/youtube/v3/videos": () => ({ items: [ytVideo("one", "One", "PT9S", 5)] }),
    });
    const waiting = item({
      id: "youtube:US:q-waiting",
      platform: "youtube",
      region: "US",
      lang: "en",
      source: SOURCE_LABELS.youtubeSearch,
      tags: ["b", "short"],
    });
    const out = await runYoutubeSearch({ ...ctx(env, flaky), previous: [waiting] }, [
      kw("a", "ar"),
      kw("b", "en"),
    ]);
    expect(out).toMatchObject({ ok: true, degraded: true, note: "stopped early: quota" });
    // The keyword whose search failed keeps its stored rows.
    expect(out.ok && out.items.map((i) => i.id)).toEqual([
      "youtube:SA:q-one",
      "youtube:US:q-waiting",
    ]);
    expect(await readSearchCount(env, "2026-09-28")).toBe(2);

    const dead = mockFetch({
      "www.googleapis.com/youtube/v3/search": () => jsonRes({ error: {} }, 500),
    });
    expect(await runYoutubeSearch(ctx(makeEnv(fakeKV(), { YOUTUBE_API_KEY: "k" }), dead))).toEqual({
      ok: false,
      error: "http 500",
    });
  });

  it("reserves the plan before the first search and refunds what a transport failure left unspent", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { YOUTUBE_API_KEY: "k" });
    await kv.put(COUNTER, "3");
    const counterAtCall: (string | undefined)[] = [];
    let n = 0;
    const flaky = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/videos"))
        return jsonRes({ items: [ytVideo("one", "One", "PT9S", 5)] });
      counterAtCall.push(kv.store.get(COUNTER)?.value);
      if (n++ === 0) return jsonRes({ items: [{ id: { videoId: "one" } }] });
      throw new TypeError("network down");
    });
    const out = await runYoutubeSearch(ctx(env, flaky), [
      kw("a", "ar"),
      kw("b", "en"),
      kw("c", "ar"),
      kw("d", "en"),
    ]);
    // The whole plan (4) was reserved before the first call went out.
    expect(counterAtCall).toEqual(["7", "7"]);
    expect(out).toMatchObject({
      ok: true,
      degraded: true,
      note: "stopped early: fetch failed: www.googleapis.com",
    });
    // Two calls were sent (the second one failed in transport): used 3 + 2, the other two refunded.
    expect(await readSearchCount(env, "2026-09-28")).toBe(5);
  });
});

/* ---------- kworb & trends24 ---------- */

describe("kworb", () => {
  it("parses the sounds table and builds tiktok rows", () => {
    const rows = parseKworb(KWORB_SA);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toEqual({
      pos: 3,
      change: "=",
      title: "Mohamed Nour & Moustafa Amar - شوفتوا القمر",
    });
    expect(rows[4]).toEqual({
      pos: 15,
      change: "NEW",
      title: "Itz_shoaib_khan - Mehrab New Sad Song",
    });
    const items = kworbItems(rows, "SA", NOW);
    expect(items[0]).toEqual({
      id: "tiktok:SA:عايض-تعبت-اكذب",
      platform: "tiktok",
      region: "SA",
      lang: "ar",
      title: "عايض - تعبت اكذب",
      url: "https://www.tiktok.com/search?q=%D8%B9%D8%A7%D9%8A%D8%B6%20-%20%D8%AA%D8%B9%D8%A8%D8%AA%20%D8%A7%D9%83%D8%B0%D8%A8",
      score: 100,
      source: "kworb.net",
      why: "#1 (=)",
      seenAt: AT,
      expiresAt: "2026-09-30T09:00:00.000Z",
      tags: ["sound"],
    });
    expect(items[3].why).toBe("#4 (+1)");
    // A NEW row has no English "why" (the dashboard shows its own word for the `new` tag).
    expect(items[4]).toMatchObject({ tags: ["sound", "new"], score: 20 });
    expect(items[4].why).toBeUndefined();
  });

  it("fetches both charts and fails on an empty page", async () => {
    const fetchMock = mockFetch({
      "kworb.net/charts/tiktok/sa.html": () => KWORB_SA,
      "kworb.net/charts/tiktok/us.html": () => KWORB_SA.replace("عايض", "Taylor"),
    });
    const out = await runKworb(ctx(makeEnv(), fetchMock));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.items).toHaveLength(10);
      expect(out.items[5]).toMatchObject({ region: "US", lang: "en", title: "Taylor - تعبت اكذب" });
    }
    const empty = mockFetch({
      "kworb.net/charts/tiktok/sa.html": () => "<html>no table</html>",
    });
    expect(await runKworb(ctx(makeEnv(), empty))).toEqual({ ok: false, error: "SA: no table" });
  });
});

describe("trends24", () => {
  it("reads the newest snapshot only, with counts and decoded links", () => {
    const rows = parseTrends24(TRENDS24);
    expect(rows.map((r) => r.name)).toEqual(["#ت_الح", "#ولي__العهد", "العراق", "Rams"]);
    expect(rows[1].count).toBe(12_000);
    expect(rows[3]).toEqual({
      name: "Rams",
      url: "https://twitter.com/search?q=Rams&src=x",
      count: 1_200_000,
    });
    expect(parseTrends24("<html></html>")).toEqual([]);
  });

  it("builds x rows and runs with one call", async () => {
    const items = xItems(parseTrends24(TRENDS24), NOW);
    expect(items[1]).toEqual({
      id: "x:SA:ولي-العهد",
      platform: "x",
      region: "SA",
      lang: "ar",
      title: "#ولي__العهد",
      url: "https://twitter.com/search?q=%23%D9%88%D9%84%D9%8A__%D8%A7%D9%84%D8%B9%D9%87%D8%AF",
      score: 75,
      volume: 12_000,
      source: "trends24.in",
      seenAt: AT,
      expiresAt: "2026-09-29T09:00:00.000Z",
      tags: ["hashtag"],
    });
    expect(items[3]).toMatchObject({ lang: "en", tags: [] });
    const fetchMock = mockFetch({ "trends24.in/saudi-arabia/": () => TRENDS24 });
    const out = await runX(ctx(makeEnv(), fetchMock));
    expect(out.ok && out.items.length).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await runX(ctx(makeEnv(), mockFetch({})))).toEqual({ ok: false, error: "http 404" });
  });
});

/* ---------- Tavily scan ---------- */

describe("tavily scan", () => {
  it("extracts hashtags and quoted names, dropping the generic ones", () => {
    expect(
      extractTerms(
        'Top sounds: "Golden Hour" and «تعبت اكذب» #fyp #viral #DaVinciResolve #تصوير_سينمائي #2026 #_ "ok" “Sad Instrument”',
      ),
    ).toEqual(["#DaVinciResolve", "#تصوير_سينمائي", "Golden Hour", "تعبت اكذب", "Sad Instrument"]);
    expect(extractTerms("#davinciresolve #DaVinciResolve")).toEqual(["#davinciresolve"]);
  });

  it("maps result hosts to platforms, blogs to instagram", () => {
    expect(platformOfUrl("https://www.tiktok.com/@a/video/1")).toBe("tiktok");
    expect(platformOfUrl("https://www.instagram.com/reel/x/")).toBe("instagram");
    expect(platformOfUrl("https://youtube.com/shorts/y")).toBe("youtube");
    expect(platformOfUrl("https://www.threads.net/@a/post/1")).toBe("threads");
    expect(platformOfUrl("https://buffer.com/resources/trends")).toBe("instagram");
    expect(platformOfUrl(undefined)).toBe("instagram");
  });

  it("counts a term once per page across queries and keeps the best page", () => {
    const stats = scanTerms([
      {
        query: TAVILY_QUERIES[0],
        hits: [
          {
            title: "#ترند_السعودية now",
            url: "https://www.tiktok.com/@a/video/1",
            content: "#ترند_السعودية #ترند_السعودية",
          },
          {
            title: "x",
            url: "https://www.instagram.com/reel/2/",
            content: "#ترند_السعودية and #ريلز_جدة",
          },
        ],
      },
      {
        query: TAVILY_QUERIES[4],
        hits: [
          {
            title: '"Golden Hour"',
            url: "https://www.tiktok.com/@b/video/3",
            content: "#ترند_السعودية",
          },
        ],
      },
    ]);
    expect(stats.map((s) => [s.term, s.pages, s.region, s.best.url])).toEqual([
      ["#ترند_السعودية", 3, "SA", "https://www.tiktok.com/@a/video/1"],
      ["#ريلز_جدة", 1, "SA", "https://www.instagram.com/reel/2/"],
      ["Golden Hour", 1, "US", "https://www.tiktok.com/@b/video/3"],
    ]);
  });

  it("sends the eight queries in the /search shape with country and language, then ranks by pages", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = mockFetch({
      "api.tavily.com/search": (_url, init) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tvly-test");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        const n = bodies.length;
        return {
          results: [
            {
              title: `Reels #GoldenHour #trend${n}`,
              url: n === 8 ? "https://later.com/blog/trends" : "https://www.instagram.com/reel/r1/",
              content: `Everyone uses "Golden Hour" this week #GoldenHour`,
              score: 0.9,
            },
          ],
          usage: { credits: 1 },
        };
      },
    });
    const out = await runTavily(ctx(makeEnv(fakeKV(), { TAVILY_API_KEY: "tvly-test" }), fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(bodies[0]).toEqual({
      query: "ترند تيك توك السعودية هذا الأسبوع",
      include_domains: ["tiktok.com", "instagram.com", "youtube.com", "threads.net"],
      max_results: 10,
      search_depth: "basic",
      time_range: "week",
      country: "saudi arabia",
      language: "ar",
    });
    expect(bodies[4]).toMatchObject({
      query: "TikTok trending sounds this week",
      country: "united states",
      language: "en",
    });
    expect(bodies[7]).toMatchObject({
      query: "trending audio Reels TikTok this week",
      include_domains: ["buffer.com", "heyorca.com", "later.com", "socialpilot.co", "lightreel.ai"],
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.degraded).toBe(false);
    expect(out.items[0]).toEqual({
      id: "instagram:SA:goldenhour",
      platform: "instagram",
      region: "SA",
      lang: "en",
      title: "#GoldenHour",
      url: "https://www.instagram.com/reel/r1/",
      score: 100,
      volume: 8,
      source: "Tavily scan",
      why: 'Everyone uses "Golden Hour" this week #GoldenHour',
      seenAt: AT,
      expiresAt: "2026-10-12T09:00:00.000Z",
      tags: ["scan"],
    });
    expect(out.items[1]).toMatchObject({ title: "Golden Hour", volume: 8 });
    expect(out.items.find((i) => i.title === "#trend8")).toMatchObject({ region: "global" });
  });

  it("stops on quota, keeping earlier queries, and reports not_configured without a key", async () => {
    let n = 0;
    const fetchMock = mockFetch({
      "api.tavily.com/search": () =>
        n++ < 2
          ? { results: [{ title: "#one", url: "https://www.tiktok.com/@a/video/1", content: "" }] }
          : jsonRes({ error: "limit" }, 432),
    });
    const out = await runTavily(ctx(makeEnv(fakeKV(), { TAVILY_API_KEY: "k" }), fetchMock));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out).toMatchObject({ ok: true, degraded: true, note: "stopped after 2 queries: quota" });
    expect(await runTavily(ctx(makeEnv(), mockFetch({})))).toEqual({
      ok: false,
      error: "not_configured",
    });
    const auth = mockFetch({ "api.tavily.com/search": () => jsonRes({}, 401) });
    expect(await runTavily(ctx(makeEnv(fakeKV(), { TAVILY_API_KEY: "k" }), auth))).toEqual({
      ok: false,
      error: "auth",
    });
  });

  it("scans once per ISO week unless forced, stamping the week after a scan", async () => {
    expect(isoWeek(NOW)).toBe("2026-W40");
    expect(isoWeek(new Date("2026-10-03T21:15:00Z"))).toBe("2026-W40");
    expect(isoWeek(new Date("2026-10-05T00:00:00Z"))).toBe("2026-W41");
    expect(isoWeek(new Date("2027-01-01T12:00:00Z"))).toBe("2026-W53");

    const kv = fakeKV();
    const env = makeEnv(kv, { TAVILY_API_KEY: "k" });
    const scan = () =>
      mockFetch({
        "api.tavily.com/search": () => ({
          results: [{ title: "#one", url: "https://www.tiktok.com/@a/video/1", content: "" }],
        }),
      });
    const first = scan();
    expect((await runTavily(ctx(env, first))).ok).toBe(true);
    expect(first).toHaveBeenCalledTimes(8);
    const stamp = kv.store.get(trendKeys.tavily("2026-W40"))!;
    expect(stamp).toEqual({ value: AT, expirationTtl: 8 * 86_400 });

    const again = scan();
    expect(await runTavily(ctx(env, again))).toEqual({
      ok: true,
      items: [],
      skipped: true,
      note: ALREADY_SCANNED,
    });
    expect(ALREADY_SCANNED).toBe("already scanned this week");
    expect(again).not.toHaveBeenCalled();

    const forced = scan();
    const out = await runTavily({ ...ctx(env, forced), force: true });
    expect(out).toMatchObject({ ok: true, items: [expect.objectContaining({ title: "#one" })] });
    expect(forced).toHaveBeenCalledTimes(8);

    // A failed scan (nothing came) does not stamp the week.
    const kv2 = fakeKV();
    const dead = mockFetch({ "api.tavily.com/search": () => jsonRes({}, 500) });
    await runTavily(ctx(makeEnv(kv2, { TAVILY_API_KEY: "k" }), dead));
    expect(kv2.store.has(trendKeys.tavily("2026-W40"))).toBe(false);
  });
});

/* ---------- events ---------- */

describe("events", () => {
  it("bundles the planning calendar, validated and sorted", () => {
    expect(SAUDI_EVENTS.length).toBeGreaterThanOrEqual(13);
    expect(new Set(SAUDI_EVENTS.map((e) => e.id)).size).toBe(SAUDI_EVENTS.length);
    for (let i = 1; i < SAUDI_EVENTS.length; i++) {
      expect(SAUDI_EVENTS[i - 1].date <= SAUDI_EVENTS[i].date).toBe(true);
    }
    expect(SAUDI_EVENTS.find((e) => e.id === "riyadh-season-2026")).toMatchObject({
      date: "2026-10-21",
      endDate: "2026-12-31",
      kind: "season",
      approx: true,
      leadDays: 21,
    });
    expect(
      parseEvent({ id: "x", date: "2026-1-1", name: { ar: "a", en: "b" }, kind: "other" }),
    ).toBeNull();
    expect(
      parseEvent({ id: "x", date: "2026-01-01", name: { ar: "a", en: "b" }, kind: "party" }),
    ).toBeNull();
    expect(
      parseEvent({ id: "x", date: "2026-01-01", name: { ar: "a", en: "b" }, kind: "other" }),
    ).toEqual({
      id: "x",
      date: "2026-01-01",
      name: { ar: "a", en: "b" },
      hashtags: [],
      leadDays: 14,
      kind: "other",
      approx: false,
    });
  });

  it("keeps the moments within 60 days, running ones at 0 days", () => {
    const soon = upcoming(SAUDI_EVENTS, "2026-09-28");
    expect(soon.map((u) => [u.event.id, u.inDays])).toEqual([["riyadh-season-2026", 23]]);
    expect(upcoming(SAUDI_EVENTS, "2026-11-15").map((u) => [u.event.id, u.inDays])).toEqual([
      ["riyadh-season-2026", 0],
      ["soundstorm-2026", 25],
      ["afc-asian-cup-2027", 53],
    ]);
    const season = SAUDI_EVENTS.find((e) => e.id === "riyadh-season-2026")!;
    expect(daysUntil(season, "2027-01-01")).toBeNull();
    expect(daysUntil(season, "2026-12-31")).toBe(0);
  });

  it("builds the same row the dashboard's eventToTrendItem builds", () => {
    const season = SAUDI_EVENTS.find((e) => e.id === "riyadh-season-2026")!;
    expect(eventItem(season, 23, NOW)).toEqual({
      id: "event:SA:riyadh-season-2026",
      platform: "event",
      region: "SA",
      lang: "mixed",
      title: "موسم الرياض · Riyadh Season",
      score: 62,
      source: "3z calendar",
      why: "#موسم_الرياض #RiyadhSeason",
      seenAt: AT,
      expiresAt: "2027-01-01T00:00:00+03:00",
      tags: ["season", "#موسم_الرياض", "#RiyadhSeason"],
    });
    expect(eventItems(SAUDI_EVENTS, NOW).map((i) => i.id)).toEqual(["event:SA:riyadh-season-2026"]);
    expect(eventItems(SAUDI_EVENTS, new Date("2026-11-15T00:00:00+03:00"))[0].score).toBe(100);
  });
});

/* ---------- the run ---------- */

describe("runTrends", () => {
  it("gates sources on TREND_SOURCES (kworb and x off by default, unknown names ignored)", () => {
    expect(enabledSources({})).toEqual(["google", "youtube", "tavily", "events"]);
    expect(enabledSources({ TREND_SOURCES: " x, kworb ,nope,Google" })).toEqual([
      "google",
      "kworb",
      "x",
    ]);
    expect(enabledSources({ TREND_SOURCES: "   " })).toEqual([
      "google",
      "youtube",
      "tavily",
      "events",
    ]);
    expect(SOURCES.map((s) => `${s.kind}:${s.label}`)).toEqual([
      "fast:Google Trends",
      "fast:YouTube charts",
      "fast:kworb.net",
      "fast:trends24.in",
      "fast:3z calendar",
      "daily:YouTube search",
      "weekly:Tavily scan",
    ]);
    expect(healthTrends({ YOUTUBE_API_KEY: "k", TREND_SOURCES: "events" })).toEqual({
      youtube: true,
      sources: ["events"],
    });
  });

  const googleFetch = () =>
    mockFetch({
      "trends.google.com/_/TrendsUi/data/batchexecute": () => rpcAnswer(),
      "trends.google.com/trending/rss": () => RSS_SA,
    });

  it("replaces the ran sources' rows, keeps the others, records statuses, writes latest and prev", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { TREND_SOURCES: "google,youtube,events" });
    const previous: TrendsFeed = {
      items: [
        item({ id: "google:SA:stale", score: 1 }),
        item({
          id: "youtube:SA:kept",
          platform: "youtube",
          source: SOURCE_LABELS.youtube,
          score: 40,
        }),
        item({ id: "x:SA:disabled", platform: "x", source: SOURCE_LABELS.x, score: 99 }),
      ],
      fetchedAt: "2026-09-28T03:00:00.000Z",
      degraded: false,
      sources: [
        { name: SOURCE_LABELS.youtube, ok: true, at: "2026-09-28T03:00:00.000Z" },
        { name: SOURCE_LABELS.x, ok: true, at: "2026-09-28T03:00:00.000Z" },
      ],
    };
    await kv.put(trendKeys.latest, JSON.stringify(previous));
    kv.writes = 0;

    const feed = await runTrends(env, { kinds: ["fast"], now: NOW, fetch: googleFetch() });
    expect(feed.fetchedAt).toBe(AT);
    expect(feed.sources).toEqual([
      { name: "Google Trends", ok: true, at: AT },
      { name: "YouTube charts", ok: false, at: AT, error: "not_configured" },
      { name: "3z calendar", ok: true, at: AT },
    ]);
    // A missing key is a setup state, not a failure: the feed is not degraded by it.
    expect(feed.degraded).toBe(false);
    const ids = feed.items.map((i) => i.id);
    expect(ids).toContain("google:SA:belgium-vs-france");
    expect(ids).toContain("event:SA:riyadh-season-2026");
    // YouTube failed (no key): its old rows stay; Google ran: its stale row is gone; x is disabled and gone.
    expect(ids).toContain("youtube:SA:kept");
    expect(ids).not.toContain("google:SA:stale");
    expect(ids).not.toContain("x:SA:disabled");
    expect(ids).toHaveLength(8);
    expect(feed.items[0].score).toBe(100);

    expect(kv.writes).toBe(2);
    expect(JSON.parse(kv.store.get(trendKeys.latest)!.value)).toEqual(feed);
    expect(JSON.parse(kv.store.get(trendKeys.prev)!.value)).toEqual(previous);
    expect(await latestFeed(env)).toEqual(feed);
  });

  it("keeps the last good copy and fetchedAt when every source fails, and marks degraded", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { TREND_SOURCES: "google" });
    const good = await runTrends(env, { kinds: ["fast"], now: NOW, fetch: googleFetch() });
    expect(good.degraded).toBe(false);
    expect(kv.writes).toBe(1);

    const later = new Date(NOW.getTime() + 6 * 3_600_000);
    const bad = await runTrends(env, { kinds: ["fast"], now: later, fetch: mockFetch({}) });
    expect(bad.items).toEqual(good.items);
    expect(bad.fetchedAt).toBe(AT);
    expect(bad.degraded).toBe(true);
    expect(bad.sources).toEqual([
      {
        name: "Google Trends",
        ok: false,
        at: later.toISOString(),
        error: expect.stringMatching(/404/),
      },
    ]);
    // No good source: prev is not touched, latest is (the statuses changed).
    expect(kv.writes).toBe(2);
    expect(kv.store.has(trendKeys.prev)).toBe(false);

    // Two days later the rows have expired on their own.
    const gone = await runTrends(env, {
      kinds: ["fast"],
      now: new Date(NOW.getTime() + 49 * 3_600_000),
      fetch: mockFetch({}),
    });
    expect(gone.items).toEqual([]);
    expect(gone.degraded).toBe(true);
  });

  it("marks a partly working source degraded and keeps its note", async () => {
    const env = makeEnv(fakeKV(), { TREND_SOURCES: "google" });
    const rssOnly = mockFetch({ "trends.google.com/trending/rss": () => RSS_SA });
    const feed = await runTrends(env, { kinds: ["fast"], now: NOW, fetch: rssOnly });
    expect(feed.degraded).toBe(true);
    expect(feed.sources[0]).toMatchObject({ ok: true, error: expect.stringMatching(/rss only/) });
  });

  it("runs only the asked kinds, and nothing (no write) when no enabled source matches", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { TREND_SOURCES: "google,tavily", TAVILY_API_KEY: "k" });
    const fetchMock = mockFetch({
      "api.tavily.com/search": () => ({
        results: [{ title: "#weekly", url: "https://www.tiktok.com/@a/video/1", content: "" }],
      }),
    });
    const weekly = await runTrends(env, { kinds: ["weekly"], now: NOW, fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(weekly.sources.map((s) => s.name)).toEqual(["Tavily scan"]);
    expect(weekly.items.map((i) => i.id)).toEqual(["tiktok:SA:weekly"]);
    // The week's stamp and the feed.
    expect(kv.writes).toBe(2);

    const daily = await runTrends(env, { kinds: ["daily"], now: NOW, fetch: mockFetch({}) });
    expect(daily).toEqual(weekly);
    expect(kv.writes).toBe(2);

    // The same week again: no credits, the rows and fetchedAt stay, the status says why; prev untouched.
    const later = new Date(NOW.getTime() + 3_600_000);
    const again = await runTrends(env, { kinds: ["weekly"], now: later, fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(8);
    expect(again.items).toEqual(weekly.items);
    expect(again.fetchedAt).toBe(AT);
    expect(again.degraded).toBe(false);
    expect(again.sources).toEqual([
      {
        name: "Tavily scan",
        ok: true,
        at: later.toISOString(),
        error: "already scanned this week",
      },
    ]);
    expect(kv.store.has(trendKeys.prev)).toBe(false);

    // force: true scans again.
    await runTrends(env, { kinds: ["weekly"], now: later, fetch: fetchMock, force: true });
    expect(fetchMock).toHaveBeenCalledTimes(16);
  });

  it("stops at the call budget and reports the sources that could not run", async () => {
    const env = makeEnv(fakeKV(), { TREND_SOURCES: "google,kworb,x" });
    const fetchMock = mockFetch({
      "trends.google.com/_/TrendsUi/data/batchexecute": () => rpcAnswer(),
      "trends.google.com/trending/rss": () => RSS_SA,
      "kworb.net/charts/tiktok/sa.html": () => KWORB_SA,
      "kworb.net/charts/tiktok/us.html": () => KWORB_SA,
      "trends24.in/saudi-arabia/": () => TRENDS24,
    });
    const feed = await runTrends(env, { kinds: ["fast"], now: NOW, fetch: fetchMock, budget: 5 });
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(feed.sources).toEqual([
      { name: "Google Trends", ok: true, at: AT },
      { name: "kworb.net", ok: false, at: AT, error: "budget" },
      { name: "trends24.in", ok: false, at: AT, error: "budget" },
    ]);
    expect(feed.degraded).toBe(true);
    expect(RUN_BUDGET).toBe(38);
  });

  it("fits every kind in one run: fast 11, daily 19 and weekly 8 are the budget's 38 calls", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, {
      TREND_SOURCES: "google,youtube,kworb,x,tavily,events",
      YOUTUBE_API_KEY: "k",
      TAVILY_API_KEY: "tvly-test",
    });
    const fetchMock = mockFetch({
      "trends.google.com/_/TrendsUi/data/batchexecute": () => rpcAnswer(),
      "trends.google.com/trending/rss": () => RSS_SA,
      "kworb.net/charts/tiktok/sa.html": () => KWORB_SA,
      "kworb.net/charts/tiktok/us.html": () => KWORB_SA,
      "trends24.in/saudi-arabia/": () => TRENDS24,
      "www.googleapis.com/youtube/v3/search": (url) => ({
        items: [{ id: { videoId: `v ${url.searchParams.get("q")}` } }],
      }),
      // The charts (`chart=mostPopular`) and the keyword search's statistics call (`id=`).
      "www.googleapis.com/youtube/v3/videos": (url) => {
        const chart = `${url.searchParams.get("regionCode")}${url.searchParams.get("videoCategoryId") ?? "0"}`;
        const ids = url.searchParams.get("id")?.split(",") ?? [chart];
        return { items: ids.map((id, i) => ytVideo(id, `Video ${id}`, "PT30S", 1000 + i)) };
      },
      "api.tavily.com/search": () => ({
        results: [{ title: "#weekly", url: "https://www.tiktok.com/@a/video/1", content: "" }],
      }),
    });
    const feed = await runTrends(env, {
      kinds: ["fast", "daily", "weekly"],
      now: NOW,
      fetch: fetchMock,
    });
    expect(feed.sources.map((s) => [s.name, s.ok])).toEqual([
      ["Google Trends", true],
      ["YouTube charts", true],
      ["kworb.net", true],
      ["trends24.in", true],
      ["3z calendar", true],
      ["YouTube search", true],
      ["Tavily scan", true],
    ]);
    expect(feed.degraded).toBe(false);
    const callsTo = (host: string) => fetchMock.urls().filter((u) => new URL(u).host === host);
    expect(callsTo("trends.google.com")).toHaveLength(4);
    expect(callsTo("kworb.net")).toHaveLength(2);
    expect(callsTo("trends24.in")).toHaveLength(1);
    // Four charts, 18 keyword searches and their one statistics call.
    expect(callsTo("www.googleapis.com")).toHaveLength(4 + SEARCH_CAP + 1);
    expect(callsTo("api.tavily.com")).toHaveLength(8);
    expect(fetchMock).toHaveBeenCalledTimes(RUN_BUDGET);
    // KV: the search reservation, the week's stamp and the feed (no previous feed to copy here).
    expect(kv.writes).toBe(3);
  });

  it("a hung source times out and the next source still runs", async () => {
    // Shorten the 12 s limit so the test does not wait for it.
    const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException("timed out", "TimeoutError")), 10);
      return c.signal;
    });
    try {
      const kv = fakeKV();
      const env = makeEnv(kv, { TREND_SOURCES: "kworb,events" });
      const hung = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
          }),
      );
      const feed = await runTrends(env, { kinds: ["fast"], now: NOW, fetch: hung });
      expect(spy).toHaveBeenCalledWith(FETCH_TIMEOUT_MS);
      expect(feed.sources).toEqual([
        { name: "kworb.net", ok: false, at: AT, error: "fetch failed: kworb.net" },
        { name: "3z calendar", ok: true, at: AT },
      ]);
      expect(feed.items.map((i) => i.id)).toEqual(["event:SA:riyadh-season-2026"]);
      expect(kv.store.has(trendKeys.latest)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("never throws on a KV failure: a failed read writes nothing, a failed write answers degraded", async () => {
    const previous: TrendsFeed = {
      items: [item({ id: "youtube:SA:kept", platform: "youtube", source: SOURCE_LABELS.youtube })],
      fetchedAt: "2026-09-28T03:00:00.000Z",
      degraded: false,
      sources: [],
    };
    const readBroken = fakeKV();
    await readBroken.put(trendKeys.latest, JSON.stringify(previous));
    readBroken.writes = 0;
    Object.assign(readBroken, {
      get: async () => {
        throw new Error("KV GET failed: 500");
      },
    });
    const env = makeEnv(readBroken, { TREND_SOURCES: "events" });
    const fed = await runTrends(env, { kinds: ["fast"], now: NOW, fetch: mockFetch({}) });
    expect(readBroken.writes).toBe(0);
    expect(JSON.parse(readBroken.store.get(trendKeys.latest)!.value)).toEqual(previous);
    expect(fed.degraded).toBe(true);
    expect(fed.items.map((i) => i.id)).toEqual(["event:SA:riyadh-season-2026"]);
    expect(fed.sources).toEqual([
      { name: "3z calendar", ok: true, at: AT },
      { name: "kv", ok: false, at: AT, error: "read failed: KV GET failed: 500" },
    ]);

    const writeBroken = fakeKV();
    Object.assign(writeBroken, {
      put: async () => {
        throw new Error("KV PUT failed: 429");
      },
    });
    const out = await runTrends(makeEnv(writeBroken, { TREND_SOURCES: "events" }), {
      kinds: ["fast"],
      now: NOW,
      fetch: mockFetch({}),
    });
    expect(out.items.map((i) => i.id)).toEqual(["event:SA:riyadh-season-2026"]);
    expect(out.degraded).toBe(true);
    expect(out.sources.at(-1)).toEqual({
      name: "kv",
      ok: false,
      at: AT,
      error: "write failed: KV PUT failed: 429",
    });
  });

  it("works without KV (nothing stored, the feed is still answered)", async () => {
    const feed = await runTrends(makeEnv(null, { TREND_SOURCES: "events" }), {
      kinds: ["fast"],
      now: NOW,
      fetch: mockFetch({}),
    });
    expect(feed.items.map((i) => i.id)).toEqual(["event:SA:riyadh-season-2026"]);
    expect(feed.fetchedAt).toBe(AT);
  });
});

/* ---------- routes ---------- */

describe("routes", () => {
  it("requires the bearer token", async () => {
    const env = makeEnv();
    for (const r of [
      req("/trends", { token: null }),
      req("/trends", { token: "wrong" }),
      req("/trends/run", { method: "POST", token: null }),
    ]) {
      const res = await handle(r, env);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("GET /trends answers the empty feed with 200 before any run, then the stored one", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { TREND_SOURCES: "events" });
    const empty = await handle(req("/trends"), env);
    expect(empty.status).toBe(200);
    expect(empty.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await empty.json()).toEqual({ items: [], fetchedAt: null, degraded: true, sources: [] });

    const run = await handle(
      req("/trends/run", { method: "POST", json: { kinds: ["fast"] } }),
      env,
      undefined,
      {
        fetch: mockFetch({}),
        now: () => NOW,
      },
    );
    expect(run.status).toBe(200);
    const feed = (await run.json()) as TrendsFeed;
    expect(feed.items.map((i) => i.id)).toEqual(["event:SA:riyadh-season-2026"]);
    expect(feed.sources).toEqual([{ name: "3z calendar", ok: true, at: AT }]);
    expect(await (await handle(req("/trends"), env)).json()).toEqual(feed);

    // No KV: still 200 and the empty feed.
    expect(await (await handle(req("/trends"), makeEnv(null))).json()).toEqual({
      items: [],
      fetchedAt: null,
      degraded: true,
      sources: [],
    });
  });

  it("POST /trends/run takes an optional kinds list (fast by default) and force, and refuses a bad one", async () => {
    // No kinds: the fast sources only, never the capped daily search or the weekly scan.
    expect(await parseRunBody(new Request(BASE, { method: "POST" }))).toEqual({
      kinds: ["fast"],
      force: false,
    });
    expect(await parseRunBody(new Request(BASE, { method: "POST", body: "{}" }))).toEqual({
      kinds: ["fast"],
      force: false,
    });
    expect(
      await parseRunBody(
        new Request(BASE, { method: "POST", body: '{"kinds":["daily","daily"]}' }),
      ),
    ).toEqual({ kinds: ["daily"], force: false });
    expect(
      await parseRunBody(
        new Request(BASE, { method: "POST", body: '{"kinds":["weekly"],"force":true}' }),
      ),
    ).toEqual({ kinds: ["weekly"], force: true });
    for (const body of [
      "[]",
      "{nope",
      '{"kinds":[]}',
      '{"kinds":["hourly"]}',
      '{"kinds":"fast"}',
      '{"kinds":["weekly"],"force":"yes"}',
    ]) {
      expect(await parseRunBody(new Request(BASE, { method: "POST", body }))).toBeNull();
    }
    const env = makeEnv(fakeKV(), { TREND_SOURCES: "events" });
    const bad = await handle(
      req("/trends/run", { method: "POST", json: { kinds: ["hourly"] } }),
      env,
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "bad_request", detail: "body" });
    expect((await handle(req("/trends/run"), env)).status).toBe(404);
    expect((await handle(req("/trends", { method: "POST" }), env)).status).toBe(404);

    // An empty body runs the fast sources only: the weekly scan spends no credits.
    const scan = mockFetch({ "api.tavily.com/search": () => ({ results: [] }) });
    const fastOnly = await handle(
      req("/trends/run", { method: "POST" }),
      makeEnv(fakeKV(), { TREND_SOURCES: "tavily,events", TAVILY_API_KEY: "k" }),
      undefined,
      { fetch: scan, now: () => NOW },
    );
    expect(fastOnly.status).toBe(200);
    expect(((await fastOnly.json()) as TrendsFeed).sources.map((s) => s.name)).toEqual([
      "3z calendar",
    ]);
    expect(scan).not.toHaveBeenCalled();
  });

  it("answers 502 with CORS headers when KV fails", async () => {
    const kv = fakeKV();
    Object.assign(kv, {
      get: async () => {
        throw new Error("KV GET failed: 500");
      },
    });
    const res = await handle(req("/trends"), makeEnv(kv));
    expect(res.status).toBe(502);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await res.json()).toEqual({ error: "upstream" });
  });

  it("GET /health reports the YouTube key and the enabled sources", async () => {
    const res = await handle(req("/health"), makeEnv(fakeKV(), { YOUTUBE_API_KEY: "k" }));
    const body = (await res.json()) as { trends: unknown };
    expect(body.trends).toEqual({
      youtube: true,
      sources: ["google", "youtube", "tavily", "events"],
    });
  });
});

/* ---------- cron ---------- */

describe("cron slots", () => {
  it("maps the trend ticks to kinds, the weekly one on Saturdays only", () => {
    expect(TREND_SLOTS).toEqual({
      "00:05": "fast",
      "06:05": "fast",
      "12:05": "fast",
      "18:05": "fast",
      "21:05": "daily",
    });
    expect(WEEKLY_SLOT).toBe("21:15");
    expect(trendKindAt(Date.parse("2026-09-28T06:05:00Z"))).toBe("fast");
    expect(trendKindAt(Date.parse("2026-09-28T21:05:00Z"))).toBe("daily");
    // 2026-10-03 is a Saturday, 2026-09-28 a Monday.
    expect(trendKindAt(Date.parse("2026-10-03T21:15:00Z"))).toBe("weekly");
    expect(trendKindAt(Date.parse("2026-09-28T21:15:00Z"))).toBeUndefined();
    expect(trendKindAt(Date.parse("2026-09-28T03:00:00Z"))).toBeUndefined();
    expect(trendKindAt(Date.parse("2026-09-28T09:00:00Z"))).toBeUndefined();
  });

  it("every slot sits on the five-minute grid of the one trigger, and no two jobs share a slot", () => {
    expect(TICK_CRON).toBe("* * * * *");
    const slots = [
      ...Object.keys(TREND_SLOTS),
      WEEKLY_SLOT,
      EFFECTS_SLOT,
      ...CATEGORY_SLOTS,
      ...Object.keys(SYNC_SLOTS),
    ];
    for (const slot of slots) {
      expect(slot).toMatch(/^([01]\d|2[0-3]):[0-5]\d$/);
      expect(Number(slot.slice(3)) % 5, slot).toBe(0);
    }
    // The trend, weekly, daily effects and category slots never take a sync slot or one another's.
    expect(new Set(slots).size, slots.join(" ")).toBe(slots.length);
  });

  it("an on-grid trend tick (06:05 UTC) runs the radar", async () => {
    const env = makeEnv(fakeKV(), { TREND_SOURCES: "events" });
    expect(
      await runTick(env, Date.parse("2026-09-28T06:05:00Z"), { fetch: mockFetch({}) }),
    ).toEqual({
      trends: {
        kinds: ["fast"],
        items: 1,
        degraded: false,
        sources: [{ name: "3z calendar", ok: true, at: "2026-09-28T06:05:00.000Z" }],
      },
    });
  });

  it("a trend tick runs the radar instead of publishing", async () => {
    const kv = fakeKV();
    const env = makeEnv(kv, { TREND_SOURCES: "events" });
    const fetchMock = mockFetch({});
    const tick = await runTick(env, Date.parse("2026-09-28T12:05:00Z"), { fetch: fetchMock });
    expect(tick).toEqual({
      trends: {
        kinds: ["fast"],
        items: 1,
        degraded: false,
        sources: [{ name: "3z calendar", ok: true, at: "2026-09-28T12:05:00.000Z" }],
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.store.has(trendKeys.latest)).toBe(true);
    // A daily tick with only fast sources enabled: nothing runs, nothing written.
    kv.writes = 0;
    const daily = await runTick(env, Date.parse("2026-09-28T21:05:00Z"), { fetch: fetchMock });
    expect(daily).toMatchObject({ trends: { kinds: ["daily"], items: 1 } });
    expect(kv.writes).toBe(0);
    // An ordinary tick still publishes (and, having published nothing, polls for auto-reply comments:
    // none configured here).
    expect(await runTick(env, Date.parse("2026-09-28T12:10:00Z"), { fetch: fetchMock })).toEqual({
      replies: { checked: 0, sent: [], failed: [], skipped: "none" },
      publish: { advanced: [], published: [], failed: [] },
    });
  });
});

/* ---------- sanity: labels ---------- */

describe("labels", () => {
  it("never calls a chart or a scan trending", () => {
    for (const label of Object.values(SOURCE_LABELS))
      expect(label.toLowerCase()).not.toMatch(/trending/);
    expect(TAVILY_URL).toBe("https://api.tavily.com/search");
  });
});
