/**
 * Category wiring (planning/tools/19-category-trends.md §2): the two routes through `handle()`, as
 * effects/routes.test.ts does, and the 4 cron slots. This Worker has no AI binding: a scan notes "ai_fallback" and
 * shows dictionary techniques only, and lessons (which need the AI) are not tried.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usageKeys } from "../discover/usage";
import { handle, type Env } from "../scout";
import { runTick } from "../social/cron";
import { TAVILY_URL } from "../trends/tavily";
import { handleCategories } from "./routes";
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
 * dictionary technique, shown without the AI. */
function tavily() {
  const results = ["c1", "c2", "c3", "c4"].map((handle, i) => ({
    url: `https://www.instagram.com/${handle}/reel/R${i + 1}/`,
    title: "speed ramp car edit 🔥",
    content: "#caredit",
  }));
  return vi.fn<typeof fetch>(async (input) =>
    String(input) === TAVILY_URL ? json({ results, usage: { credits: 1 } }) : json({}, 404),
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
    // So a YouTube call would really go out and show in the fetch counts: categories make none.
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
  status: d.status,
  updatedAt: d.updatedAt,
  notes: d.notes,
  items: d.items,
  lessons: d.lessons,
});

const DOC: CategoryDoc = {
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
      notes: ["ai_fallback"],
      updatedAt: NOW.toISOString(),
    });
    expect(body.items.map((i) => i.key)).toEqual(["speed-ramp"]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(writes(kv)).toEqual([ATTEMPTS, KEY]);

    const deps = { fetch: fetchMock, now: () => LATER };
    expect(await (await handle(run("cars", "{}"), env, undefined, deps)).json()).toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const forced = await handle(run("cars", '{"force":true}'), env, undefined, deps);
    expect(await forced.json()).toEqual(answer(storedDoc(kv)));
    expect(fetchMock).toHaveBeenCalledTimes(12);
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

describe("the category slots", () => {
  it("05:40–05:55 UTC scan the day's 4 categories in turn; 05:41 only polls the replies", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    const offGrid = await runTick(env, Date.parse("2026-10-07T05:41:00Z"), { fetch: fetchMock });
    expect(Object.keys(offGrid)).toEqual(["replies"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await runTick(env, Date.parse("2026-10-07T05:40:00Z"), { fetch: fetchMock })).toEqual({
      category: { id: "cars", status: "partial", items: 1, notes: ["ai_fallback"] },
    });
    expect(
      await runTick(env, Date.parse("2026-10-07T05:55:00Z"), { fetch: fetchMock }),
    ).toMatchObject({
      category: { id: "travel" },
    });
    expect(kv.store.has("category:cars")).toBe(true);
    expect(kv.store.has("category:travel")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });
});
