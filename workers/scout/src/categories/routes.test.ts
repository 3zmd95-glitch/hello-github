/**
 * Category wiring (planning/tools/19-category-trends.md §2): the two routes through `handle()`, as
 * effects/routes.test.ts does, and the 4 cron slots. This Worker has no AI binding: a scan notes "ai_fallback" and
 * shows dictionary techniques only, and lessons (which need the AI) are not tried. Nor is TikTok for Business connected
 * (§6): a scan notes "tiktok_auth" and asks TikTok nothing.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usageKeys } from "../discover/usage";
import { EFFECTS_EVIDENCE_VERSION } from "../effects/types";
import { instagramShortcodeAt } from "../postDate";
import { handle, type Env } from "../scout";
import { runTick } from "../social/cron";
import { encryptJson } from "../social/crypto";
import { TAVILY_URL } from "../trends/tavily";
import { YT_SEARCH_URL } from "../trends/youtubeSearch";
import { handleCategories } from "./routes";
import { CATEGORY_QUALITY_VERSION } from "./run";
import { BRAVE_WEB_URL } from "./top";
import type { CategoryDoc } from "./types";

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-07T05:40:00Z");
const LATER = new Date("2026-10-07T20:00:00Z");
const KEY = "category:cars";
const ATTEMPTS = "category:attempts:cars:2026-10-07";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Tavily answering every search with 4 creators' speed-ramp reels (a category searches Instagram alone): a
 * dictionary technique, shown without the AI. YouTube's top-list search (§6) finds nothing, so no views call follows. */
function tavily() {
  // Posted the day before (the trends count each creator on the day they posted, read from the post id).
  const posted = new Date("2026-10-06T04:00:00Z");
  const results = ["c1", "c2", "c3", "c4"].map((handle, i) => ({
    url: `https://www.instagram.com/${handle}/reel/${instagramShortcodeAt(posted, i + 1)}/`,
    title: "speed ramp car edit 🔥",
    content: "#caredit",
  }));
  return vi.fn<typeof fetch>(async (input) =>
    String(input) === TAVILY_URL
      ? json({ results, usage: { credits: 1 } })
      : String(input).startsWith(YT_SEARCH_URL)
        ? json({ items: [] })
        : json({}, 404),
  );
}

function setup(stored?: CategoryDoc) {
  const store = new Map<string, string>();
  if (stored) store.set(KEY, JSON.stringify(stored));
  // Discover's Tavily figure kept, 8 % of the month: no run here asks Tavily's /usage, so the fetch counts are the
  // searches alone (run.test.ts covers no figure kept).
  store.set(usageKeys.tavily, JSON.stringify({ used: 80, limit: 1000 }));
  const kv = {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
  const env: Env = {
    SCOUT_TOKEN: TOKEN,
    ALLOWED_ORIGINS: APP,
    TAVILY_API_KEY: "t",
    // So YouTube's top-list search (§6) really goes out and shows in the fetch counts: one a scan.
    YOUTUBE_API_KEY: "y",
    SOCIAL_KV: kv as unknown as KVNamespace,
  };
  return { env, kv };
}
const storedDoc = (kv: ReturnType<typeof setup>["kv"]) =>
  JSON.parse(kv.store.get(KEY)!) as CategoryDoc;
const writes = (kv: ReturnType<typeof setup>["kv"]) => kv.put.mock.calls.map(([key]) => key);

const req = (path: string, init: RequestInit & { token?: string | null } = {}) => {
  const { token = TOKEN, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Origin", APP);
  return new Request(`${BASE}${path}`, { ...rest, headers });
};
const run = (id: string, body?: string, token?: string | null) =>
  req(`/categories/${id}/run`, { method: "POST", body, token });

/** What the routes answer for a stored document: no `ranOn`, memory (history, meta) or diagnostics. */
const answer = (d: CategoryDoc) => ({
  evidenceVersion: d.evidenceVersion,
  status: d.status,
  updatedAt: d.updatedAt,
  notes: d.notes,
  items: d.items,
  lessons: d.lessons,
  top: d.top,
});

const DOC: CategoryDoc = {
  evidenceVersion: EFFECTS_EVIDENCE_VERSION,
  qualityVersion: CATEGORY_QUALITY_VERSION,
  ranOn: "2026-10-04",
  updatedAt: "2026-10-04T05:40:09.000Z",
  status: "partial",
  notes: ["ai_fallback"],
  items: [
    {
      key: "speed-ramp",
      name: { en: "speed ramp", ar: "سبيد رامب" },
      termId: "speed-ramp",
      isNew: false,
      checked: false,
      creators: 4,
      posts: 4,
      platforms: ["tt"],
      growth: 3,
      samples: [],
    },
  ],
  lessons: { updatedAt: "2026-10-04T05:41:30.000Z", photo: [], video: [], edit: [] },
  meta: {},
  history: { "speed-ramp": [{ day: "2026-10-04", ids: ["0a1b2c3d"] }] },
  diagnostics: { id: "cars", credits: 6 },
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("/categories routes", () => {
  it("need the token, before reading or spending anything", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    for (const r of [
      req("/categories/cars", { token: null }),
      req("/categories/cars", { token: "wrong" }),
      run("cars", undefined, null),
    ])
      expect((await handle(r, env, undefined, { fetch: fetchMock })).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("GET: never before the first scan, the stored page without the job's memory, 404 for an unknown category", async () => {
    const empty = setup();
    const never = await handle(req("/categories/cars"), empty.env);
    expect(never.status).toBe(200);
    expect(never.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await never.json()).toEqual({ status: "never", items: [] });
    const { env } = setup(DOC);
    expect(await (await handle(req("/categories/cars"), env)).json()).toEqual(answer(DOC));
    for (const path of ["/categories/drift", "/categories/custom-x/run", "/categories/cars/run"])
      expect((await handle(req(path), env)).status, path).toBe(404);
  });

  it("GET answers 502 with the CORS headers when KV can't be read", async () => {
    const { env, kv } = setup();
    kv.get.mockRejectedValue(new Error("KV GET failed: 500"));
    const res = await handle(req("/categories/cars"), env);
    expect(res.status).toBe(502);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await res.json()).toEqual({ error: "upstream" });
  });
  it("hides legacy trend claims on reads and cached no-op runs without changing storage or spending", async () => {
    for (const qualityVersion of [undefined, 0, CATEGORY_QUALITY_VERSION + 1]) {
      const legacy = { ...DOC, qualityVersion, ranOn: "2026-10-07" };
      const { env, kv } = setup(legacy);
      const storedBefore = kv.store.get(KEY);
      const fetchMock = tavily();
      const deps = { fetch: fetchMock, now: () => NOW };
      for (const request of [req("/categories/cars"), run("cars")]) {
        const response = await handle(request, env, undefined, deps);
        expect(await response.json()).toEqual({ ...answer(legacy), items: [] });
      }
      expect(kv.store.get(KEY)).toBe(storedBefore);
      expect(kv.put).not.toHaveBeenCalled();
      expect(kv.store.has(ATTEMPTS)).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });
  it("exposes current-version trend evidence without leaking internal migration metadata", async () => {
    const { env, kv } = setup(DOC);
    const fetchMock = tavily();
    const response = await handle(req("/categories/cars"), env, undefined, { fetch: fetchMock });
    const body = await response.json();
    expect(body).toEqual(answer(DOC));
    expect(body).not.toHaveProperty("qualityVersion");
    expect(kv.put).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a stored page's lessons as untrusted: the GET and a scan drop a malformed one", async () => {
    const malformed = [
      "soon",
      null,
      [],
      { updatedAt: 5, photo: [], video: [], edit: [] },
      { updatedAt: "2026-10-04T05:41:30.000Z", photo: {}, video: [], edit: [] },
    ];
    for (const lessons of malformed) {
      const { env, kv } = setup({ ...DOC, lessons } as unknown as CategoryDoc);
      const got = await handle(req("/categories/cars"), env);
      expect(await got.json(), JSON.stringify(lessons)).toEqual(
        answer({ ...DOC, lessons: undefined }),
      );
      const ran = await handle(run("cars"), env, undefined, { fetch: tavily(), now: () => NOW });
      expect(ran.status).toBe(200);
      expect(await ran.json()).not.toHaveProperty("lessons");
      expect(storedDoc(kv)).not.toHaveProperty("lessons");
    }
  });

  it("GET answers the stored top lists (§6): a malformed entry is dropped alone; a page from before §6 has none", async () => {
    const yt = {
      url: "https://www.youtube.com/watch?v=carVid00001",
      title: "Car match cut",
      creator: "Car Channel",
      views: 1200,
    };
    const ig = { url: "https://www.instagram.com/p/R1", title: "rolling shot", creator: "@c1" };
    const top = {
      updatedAt: "2026-10-04T05:40:09.000Z",
      yt: [yt, { ...yt, url: "http://www.youtube.com/watch?v=carVid00002" }, { title: "no link" }],
      ig: [ig],
      tt: "soon",
    };
    const { env } = setup({ ...DOC, top } as unknown as CategoryDoc);
    const got = (await (await handle(req("/categories/cars"), env)).json()) as ReturnType<
      typeof answer
    >;
    // A legacy title with no category evidence is removed; qualifying metadata gets explicit provenance.
    expect(got.top).toEqual({
      updatedAt: top.updatedAt,
      yt: [
        { ...yt, evidence: { basis: "metadata", subjects: ["car"], techniques: ["match cut"] } },
      ],
      ig: [],
      tt: [],
    });
    const before = setup(DOC);
    expect(await (await handle(req("/categories/cars"), before.env)).json()).not.toHaveProperty(
      "top",
    );
  });

  it("POST scans once a UTC day and answers like the GET; force scans again and counts", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    const waitUntil = vi.fn();
    const ctx = { waitUntil, passThroughOnException() {} } as unknown as ExecutionContext;
    const first = await handle(run("cars"), env, ctx, { fetch: fetchMock, now: () => NOW });
    expect(first.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    const body = (await first.json()) as ReturnType<typeof answer>;
    expect(body).toEqual(answer(storedDoc(kv)));
    expect(body).toMatchObject({
      status: "partial",
      notes: ["tiktok_auth", "ai_fallback"],
      updatedAt: NOW.toISOString(),
    });
    expect(body.items.map((i) => i.key)).toEqual(["speed-ramp"]);
    // 6 Tavily searches and YouTube's top-list search (§6), which found nothing: no views call.
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(writes(kv)).toEqual([ATTEMPTS, KEY]);

    const deps = { fetch: fetchMock, now: () => LATER };
    expect(await (await handle(run("cars", "{}"), env, undefined, deps)).json()).toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    const forced = await handle(run("cars", '{"force":true}'), env, undefined, deps);
    expect(await forced.json()).toEqual(answer(storedDoc(kv)));
    // Scan again keeps the stored YouTube list, empty as it is (C1): its 6 Tavily searches alone.
    expect(fetchMock).toHaveBeenCalledTimes(13);
    expect(writes(kv)).toEqual([ATTEMPTS, KEY, ATTEMPTS, KEY]);
    expect(kv.store.get(ATTEMPTS)).toBe("2");
  });

  it("POST refuses any body but { force?: boolean }, spending nothing", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    for (const body of ["{not json", "[]", "null", '{"force":"yes"}', '{"force":true,"extra":1}']) {
      const res = await handle(run("cars", body), env, undefined, {
        fetch: fetchMock,
        now: () => NOW,
      });
      expect(res.status, body).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("a POST to an unknown category, or to a page without /run, is not ours: the router's 404, nothing read or spent", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    const deps = { fetch: fetchMock, now: () => NOW };
    const posts = () => [
      run("drift", "{}"),
      req("/categories/cars", { method: "POST", body: "{}" }),
    ];
    for (const r of posts()) expect(await handleCategories(r, env, new Headers(), deps)).toBeNull();
    expect(kv.get).not.toHaveBeenCalled();
    for (const r of posts()) expect((await handle(r, env, undefined, deps)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe("GET /categories/:id/top/:platform (§6: Brave on demand, never stored)", () => {
  const SCAN = { url: "https://www.tiktok.com/@scan/video/9000001", title: "scan post" };
  const HIT = {
    url: "https://www.tiktok.com/@car1/video/7000001",
    title: "Car edit 1 | TikTok",
    meta_url: { hostname: "www.tiktok.com" },
    thumbnail: { src: "https://imgs.search.brave.com/t1.jpg" },
    video: { views: 4200, creator: "car1" },
  };
  const top = { updatedAt: DOC.updatedAt, yt: [], ig: [], tt: [SCAN] };
  const braveFetch = () =>
    vi.fn<typeof fetch>(async (input) =>
      String(input).startsWith(BRAVE_WEB_URL) ? json({ web: { results: [HIT] } }) : json({}, 404),
    );

  it("Bearer like the others; TikTok and Instagram only; the stored list and Brave's own group, kept nowhere", async () => {
    const { env, kv } = setup({ ...DOC, top });
    env.BRAVE_API_KEY = "brave-test-key";
    const fetchMock = braveFetch();
    const deps = { fetch: fetchMock, now: () => NOW };
    expect(
      (await handle(req("/categories/cars/top/tt", { token: null }), env, undefined, deps)).status,
    ).toBe(401);
    for (const path of [
      "/categories/cars/top/yt",
      "/categories/cars/top",
      "/categories/drift/top/tt",
    ])
      expect((await handle(req(path), env, undefined, deps)).status, path).toBe(404);
    expect(
      (await handle(req("/categories/cars/top/tt", { method: "POST" }), env, undefined, deps))
        .status,
    ).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();

    const res = await handle(req("/categories/cars/top/tt"), env, undefined, deps);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    // No copy kept anywhere, the browser's cache included (Brave's terms).
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // The stored list, then Brave's group as Brave gave it (its title as written).
    expect(await res.json()).toEqual({
      platform: "tt",
      scan: [],
      discoveryStatus: "not_connected",
      brave: [
        {
          url: HIT.url,
          title: "Car edit 1 | TikTok",
          creator: "car1",
          views: 4200,
          thumbnail: HIT.thumbnail.src,
        },
      ],
      source: "brave",
      endpoint: "web",
      stats: { raw: 1, hosts: { "www.tiktok.com": 1 } },
    });
    // 1 result, fewer than a page: 1 request. The only KV writes are the day's counter: 3 reserved, then 1.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(writes(kv)).toEqual(["brave:count:2026-10-07", "brave:count:2026-10-07"]);
    expect(kv.store.get("brave:count:2026-10-07")).toBe("1");
    expect(JSON.stringify([...kv.store.values()])).not.toContain("car1");
  });

  it("without the key: the stored list noted 'no_key', nothing asked; a page never scanned has none to give", async () => {
    const { env, kv } = setup({ ...DOC, top });
    const fetchMock = braveFetch();
    const deps = { fetch: fetchMock, now: () => NOW };
    const res = await handle(req("/categories/cars/top/ig"), env, undefined, deps);
    expect(await res.json()).toEqual({
      platform: "ig",
      scan: [],
      brave: [],
      source: "scan",
      note: "no_key",
    });
    expect(
      await (await handle(req("/categories/cars/top/tt"), env, undefined, deps)).json(),
    ).toEqual({
      platform: "tt",
      scan: [],
      discoveryStatus: "not_connected",
      brave: [],
      source: "scan",
      note: "no_key",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    const never = setup();
    never.env.BRAVE_API_KEY = "brave-test-key";
    const fresh = await handle(req("/categories/cars/top/tt"), never.env, undefined, deps);
    expect(await fresh.json()).toMatchObject({
      source: "brave",
      scan: [],
      brave: [{ url: HIT.url }],
    });
  });
});

describe("TikTok empty source status", () => {
  it("distinguishes connected empty results, scan needed and upstream failure without fetching videos", async () => {
    const sealed = await encryptJson(TOKEN, {
      access_token: "fake-business",
      advertiser_ids: ["adv1"],
      connectedAt: "2026-10-07T00:00:00Z",
    });
    for (const [doc, status] of [
      [{ ...DOC, top: { updatedAt: DOC.updatedAt, yt: [], ig: [], tt: [] } }, "ready"],
      [undefined, "not_scanned"],
      [
        { ...DOC, notes: ["tiktok"], top: { updatedAt: DOC.updatedAt, yt: [], ig: [], tt: [] } },
        "unavailable",
      ],
    ] as const) {
      const { env, kv } = setup(doc as CategoryDoc | undefined);
      kv.store.set("tiktokads:token", sealed);
      const fetch = vi.fn<typeof globalThis.fetch>();
      const response = await handle(req("/categories/cars/top/tt"), env, undefined, { fetch });
      expect(await response.json()).toMatchObject({ scan: [], discoveryStatus: status });
      expect(fetch).not.toHaveBeenCalled();
    }
  });
});

describe("the category slots", () => {
  it("05:40–05:55 UTC scan the day's 4 categories in turn; 05:41 only polls the replies", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    const offGrid = await runTick(env, Date.parse("2026-10-07T05:41:00Z"), { fetch: fetchMock });
    expect(Object.keys(offGrid)).toEqual(["replies"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await runTick(env, Date.parse("2026-10-07T05:40:00Z"), { fetch: fetchMock })).toEqual({
      category: { id: "cars", status: "partial", items: 1, notes: ["tiktok_auth", "ai_fallback"] },
    });
    expect(
      await runTick(env, Date.parse("2026-10-07T05:55:00Z"), { fetch: fetchMock }),
    ).toMatchObject({
      category: { id: "travel" },
    });
    expect(kv.store.has("category:cars")).toBe(true);
    expect(kv.store.has("category:travel")).toBe(true);
    // Each scan: 6 Tavily searches and YouTube's top-list search (§6).
    expect(fetchMock).toHaveBeenCalledTimes(14);
  });
});
