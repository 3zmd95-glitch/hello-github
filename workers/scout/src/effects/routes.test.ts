/**
 * Trending effects wiring (planning/tools/18-trending-effects.md §3): the two routes through `handle()`, as
 * discover/routes.test.ts does, and the daily 05:35 UTC cron slot. The run itself is covered in run.test.ts; this
 * Worker has neither the AI nor a YouTube key, so a run notes both and still makes the dictionary chip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { runTick } from "../social/cron";
import { TAVILY_URL } from "../trends/tavily";
import { EFFECTS_KEY } from "./kv";
import type { EffectsDoc } from "./types";

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-10-06T05:35:00Z");
const LATER = new Date("2026-10-06T20:00:00Z");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Tavily answering every family search with four creators' clone-effect posts (a chip needs 3). */
function tavily() {
  const results = ["c1", "c2", "c3", "c4"].map((handle, i) => ({
    url: `https://www.tiktok.com/@${handle}/video/${i + 1}`,
    title: "Clone Yourself in CapCut 🔥 #cloneyourself",
    content: "#capcut #edit",
  }));
  return vi.fn<typeof fetch>(async (input) =>
    String(input) === TAVILY_URL ? json({ results, usage: { credits: 1 } }) : json({}, 404),
  );
}

function setup(stored?: EffectsDoc) {
  const store = new Map<string, string>();
  if (stored) store.set(EFFECTS_KEY, JSON.stringify(stored));
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
    SOCIAL_KV: kv as unknown as KVNamespace,
  };
  return { env, kv };
}
const storedDoc = (kv: ReturnType<typeof setup>["kv"]) =>
  JSON.parse(kv.store.get(EFFECTS_KEY)!) as EffectsDoc;

const req = (path: string, init: RequestInit & { token?: string | null } = {}) => {
  const { token = TOKEN, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Origin", APP);
  return new Request(`${BASE}${path}`, { ...rest, headers });
};
const run = (body?: string, token?: string | null) =>
  req("/effects/run", { method: "POST", body, token });

/** What the routes answer for a stored document: everything but the job's memory (history, meta). */
const answer = (d: EffectsDoc) => ({
  status: d.status,
  ranOn: d.ranOn,
  updatedAt: d.updatedAt,
  notes: d.notes,
  items: d.items,
});

const DOC: EffectsDoc = {
  ranOn: "2026-10-05",
  updatedAt: "2026-10-05T05:35:12.000Z",
  status: "partial",
  notes: ["youtube_cap"],
  items: [
    {
      key: "clone-effect",
      name: { en: "clone effect", ar: "تأثير الاستنساخ" },
      what: { en: "You appear twice in one shot", ar: "تطلع مرتين في نفس اللقطة" },
      termId: "clone-effect",
      isNew: false,
      checked: true,
      creators: 9,
      posts: 12,
      platforms: ["ig", "tt"],
      growth: 2,
      samples: [{ url: "https://www.tiktok.com/@c1/video/1", title: "Clone Yourself in CapCut" }],
    },
  ],
  meta: {
    "clone-effect": {
      name: { en: "clone effect" },
      termId: "clone-effect",
      checked: true,
      platforms: ["ig", "tt"],
      posts: 12,
      samples: [],
    },
  },
  history: { "clone-effect": [{ day: "2026-10-05", ids: ["0a1b2c3d"] }] },
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("/effects routes", () => {
  it("need the token, before reading or spending anything", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    for (const r of [
      req("/effects/trending", { token: null }),
      req("/effects/trending", { token: "wrong" }),
      run(undefined, null),
    ]) {
      expect((await handle(r, env, undefined, { fetch: fetchMock })).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("GET before the first run answers never, with no items", async () => {
    const { env } = setup();
    const res = await handle(req("/effects/trending"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await res.json()).toEqual({ status: "never", items: [] });
  });

  it("GET answers the stored list without the job's memory", async () => {
    const { env } = setup(DOC);
    const res = await handle(req("/effects/trending"), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "partial",
      ranOn: "2026-10-05",
      updatedAt: "2026-10-05T05:35:12.000Z",
      notes: ["youtube_cap"],
      items: DOC.items,
    });
  });

  it("GET answers 502 with the CORS headers when KV can't be read", async () => {
    const { env, kv } = setup();
    kv.get.mockRejectedValue(new Error("KV GET failed: 500"));
    const res = await handle(req("/effects/trending"), env);
    expect(res.status).toBe(502);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    expect(await res.json()).toEqual({ error: "upstream" });
  });

  it("POST runs the job once a UTC day and answers like the GET; force runs it again", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    const waitUntil = vi.fn();
    const ctx = { waitUntil, passThroughOnException() {} } as unknown as ExecutionContext;
    const first = await handle(run(), env, ctx, { fetch: fetchMock, now: () => NOW });
    expect(first.status).toBe(200);
    expect(first.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    // The run itself is handed to waitUntil too, so a request dropped mid-run still finishes it.
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0][0]).resolves.toEqual(storedDoc(kv));
    const body = (await first.json()) as ReturnType<typeof answer>;
    expect(body).toEqual(answer(storedDoc(kv)));
    expect(body).toMatchObject({ ranOn: "2026-10-06", updatedAt: NOW.toISOString() });
    expect(body.items.map((i) => i.key)).toEqual(["clone-effect"]);
    // The day's six family searches, nothing else.
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.every(([url]) => String(url) === TAVILY_URL)).toBe(true);
    expect(kv.put).toHaveBeenCalledTimes(1);

    // Later the same UTC day: the stored list, nothing spent or written; the GET agrees. `force: false` is
    // accepted and is no force.
    const deps = { fetch: fetchMock, now: () => LATER };
    expect(await (await handle(run("{}"), env, undefined, deps)).json()).toEqual(body);
    const unforced = await handle(run('{"force":false}'), env, undefined, deps);
    expect(unforced.status).toBe(200);
    expect(await unforced.json()).toEqual(body);
    expect(await (await handle(req("/effects/trending"), env)).json()).toEqual(body);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(kv.put).toHaveBeenCalledTimes(1);

    const forced = await handle(run('{"force":true}'), env, undefined, deps);
    expect(forced.status).toBe(200);
    expect(await forced.json()).toEqual(answer(storedDoc(kv)));
    expect(storedDoc(kv).updatedAt).toBe(LATER.toISOString());
    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(kv.put).toHaveBeenCalledTimes(2);
  });

  it("POST refuses any body but { force?: boolean }, spending nothing", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    for (const body of [
      "{not json",
      "[]",
      "null",
      "1",
      '"force"',
      '{"force":"yes"}',
      '{"force":null}',
      '{"kinds":["fast"]}',
      '{"force":true,"extra":1}',
    ]) {
      const res = await handle(run(body), env, undefined, { fetch: fetchMock, now: () => NOW });
      expect(res.status, body).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it("a GET of the run route or a POST of the list is not found, and spends nothing", async () => {
    const { env } = setup();
    const fetchMock = tavily();
    const deps = { fetch: fetchMock, now: () => NOW };
    expect((await handle(req("/effects/run"), env, undefined, deps)).status).toBe(404);
    const post = req("/effects/trending", { method: "POST", body: "{}" });
    expect((await handle(post, env, undefined, deps)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the daily slot", () => {
  it("the 05:35 UTC tick (08:35 Riyadh) runs the job instead of publishing; 05:36 and 05:40 do not", async () => {
    const { env, kv } = setup();
    const fetchMock = tavily();
    const offGrid = await runTick(env, Date.parse("2026-10-06T05:36:00Z"), { fetch: fetchMock });
    expect(Object.keys(offGrid)).toEqual(["replies"]);
    // The next grid tick publishes as usual.
    const nextOnGrid = await runTick(env, Date.parse("2026-10-06T05:40:00Z"), { fetch: fetchMock });
    expect(Object.keys(nextOnGrid)).toEqual(["publish", "replies"]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.store.has(EFFECTS_KEY)).toBe(false);

    const tick = await runTick(env, Date.parse("2026-10-06T05:35:00Z"), { fetch: fetchMock });
    const doc = storedDoc(kv);
    expect(doc).toMatchObject({ ranOn: "2026-10-06", updatedAt: "2026-10-06T05:35:00.000Z" });
    expect(doc.items).toHaveLength(1);
    expect(tick).toEqual({
      effects: { status: doc.status, items: doc.items.length, notes: doc.notes },
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
