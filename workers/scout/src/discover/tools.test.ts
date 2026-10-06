import { describe, expect, it, vi } from "vitest";
import { EFFECTS_KEY } from "../effects/kv";
import { trendKeys } from "../trends/kv";
import { TAVILY_URL } from "../trends/tavily";
import { readPicks } from "./picks";
import {
  addConnectorLookups,
  getPicksTool,
  getTrends,
  savePicksTool,
  searchVideos,
  toolCall,
} from "./tools";
import { usageKeys } from "./usage";

const NOW = new Date("2026-10-03T09:00:00Z");
function fakeKV() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  } as unknown as KVNamespace & { store: Map<string, string> };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const BAD_TOPIC = { error: "bad_topic", message: "The topic needs at least one letter or digit." };
/** Tavily answering each call with one new TikTok post. */
const tavily = () => {
  let n = 0;
  return vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) !== TAVILY_URL) return json({}, 404);
    const q = String((JSON.parse(String(init?.body)) as { query: string }).query);
    n += 1;
    return json({
      results: [{ url: `https://www.tiktok.com/@ed/video/${n}`, title: `${q} edit`, content: q }],
      usage: { credits: 1 },
    });
  });
};

describe("searchVideos", () => {
  it("runs Claude's own queries, counts the lookups and says how many are left", async () => {
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: fakeKV(), MCP_DAILY_LOOKUPS: "10" };
    const out = await searchVideos(
      env,
      { fetch: tavily(), now: NOW },
      {
        topic: "flash",
        queries: [
          { q: "flash transition velocity", platform: "tiktok", lang: "en", intent: "examples" },
          { q: "flash cut capcut tutorial", platform: "tiktok", lang: "en", intent: "tutorials" },
        ],
      },
    );
    expect(out.lookupsLeftToday).toBe(8);
    const items = out.items as { platform: string; title: string }[];
    expect(items.map((i) => i.title).sort()).toEqual([
      "flash cut capcut tutorial edit",
      "flash transition velocity edit",
    ]);
    expect(items.every((i) => i.platform === "tiktok")).toBe(true);
    expect(env.SOCIAL_KV.store.get(usageKeys.connector("2026-10-03"))).toBe("2");
  });

  it("refuses a topic without a letter or digit before reading or spending anything", async () => {
    const get = vi.fn();
    const put = vi.fn();
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: { get, put } as unknown as KVNamespace };
    const fetchMock = tavily();
    for (const topic of ["🔥🔥", "!!!"]) {
      expect(await searchVideos(env, { fetch: fetchMock, now: NOW }, { topic }), topic).toEqual(
        BAD_TOPIC,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it("fails closed when the day's count can't be read", async () => {
    const down = {
      async get() {
        throw new Error("KV GET failed");
      },
    } as unknown as KVNamespace;
    const fetchMock = tavily();
    const out = await searchVideos(
      { TAVILY_API_KEY: "k", SOCIAL_KV: down },
      { fetch: fetchMock, now: NOW },
      { topic: "flash" },
    );
    expect(out).toEqual({
      error: "unavailable",
      message: "Usage counter unavailable, try again in a minute.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses past the day's cap without searching", async () => {
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: fakeKV(), MCP_DAILY_LOOKUPS: "5" };
    await env.SOCIAL_KV.put(usageKeys.connector("2026-10-03"), "5");
    const fetchMock = tavily();
    const out = await searchVideos(env, { fetch: fetchMock, now: NOW }, { topic: "flash" });
    expect(out.error).toBe("daily_limit");
    expect(String(out.message)).toContain("midnight Riyadh");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a platform named twice: same request, same 6-hour answer", async () => {
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: fakeKV(), MCP_DAILY_LOOKUPS: "10" };
    const fetchMock = tavily();
    const once = await searchVideos(
      env,
      { fetch: fetchMock, now: NOW },
      { topic: "flash", platforms: ["tiktok"] },
    );
    expect(once.cached).toBe(false);
    const calls = fetchMock.mock.calls.length;
    const twice = await searchVideos(
      env,
      { fetch: fetchMock, now: NOW },
      { topic: "flash", platforms: ["tiktok", "tiktok"] },
    );
    expect(twice).toMatchObject({ cached: true, items: once.items });
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("still serves a kept answer past the cap, for free", async () => {
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: fakeKV(), MCP_DAILY_LOOKUPS: "3" };
    const fetchMock = tavily();
    const input = { topic: "flash", platforms: ["tiktok" as const] };
    const first = await searchVideos(env, { fetch: fetchMock, now: NOW }, input);
    expect(first).toMatchObject({ cached: false, lookupsLeftToday: 0 });
    const calls = fetchMock.mock.calls.length;
    const again = await searchVideos(env, { fetch: fetchMock, now: NOW }, input);
    expect(again).toMatchObject({ cached: true, lookupsLeftToday: 0, items: first.items });
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(env.SOCIAL_KV.store.get(usageKeys.connector("2026-10-03"))).toBe("3");
  });
});

describe("addConnectorLookups", () => {
  it("never fails the tool call when the count can't be kept", async () => {
    // KV takes one write per key a second: two searches in one second collide.
    const busy = {
      async get() {
        return "3";
      },
      async put() {
        throw new Error("KV PUT failed: 429 Too Many Requests");
      },
    } as unknown as KVNamespace;
    await expect(addConnectorLookups({ SOCIAL_KV: busy }, 2, NOW)).resolves.toBeUndefined();
    const down = {
      async get() {
        throw new Error("KV GET failed");
      },
    } as unknown as KVNamespace;
    await expect(addConnectorLookups({ SOCIAL_KV: down }, 2, NOW)).resolves.toBeUndefined();
  });
});

describe("getTrends", () => {
  it("filters the radar's feed by region and genre, its web text clipped", async () => {
    const kv = fakeKV();
    await kv.put(
      trendKeys.latest,
      JSON.stringify({
        fetchedAt: "2026-10-03T06:00:00Z",
        degraded: false,
        sources: [],
        items: [
          {
            id: "a",
            platform: "youtube",
            region: "SA",
            lang: "ar",
            title: "car edit",
            source: "YouTube search",
            seenAt: "x",
            tags: [],
            genre: "cars",
            score: 90,
          },
          {
            id: "b",
            platform: "google",
            region: "US",
            lang: "en",
            title: "news",
            source: "Google Trends",
            seenAt: "x",
            tags: [],
          },
          {
            id: "c",
            platform: "youtube",
            region: "SA",
            lang: "ar",
            title: "t".repeat(200),
            why: "w".repeat(200),
            source: "YouTube search",
            seenAt: "x",
            tags: [],
            genre: "cars",
          },
        ],
      }),
    );
    const out = await getTrends({ SOCIAL_KV: kv }, { region: "SA", genre: "cars" }, NOW);
    expect(out.items).toEqual([
      {
        title: "car edit",
        platform: "youtube",
        region: "SA",
        source: "YouTube search",
        genre: "cars",
        score: 90,
      },
      {
        title: `${"t".repeat(159)}…`,
        platform: "youtube",
        region: "SA",
        source: "YouTube search",
        genre: "cars",
        why: `${"w".repeat(159)}…`,
      },
    ]);
  });

  it("adds this week's trending effects and their time; none past 3 days, or when the list or an item can't be read", async () => {
    const kv = fakeKV();
    const what = { en: "You appear twice in one shot", ar: "تطلع مرتين في نفس اللقطة" };
    const youtube = { newVideos: 2, views7d: 2000, growth: 1.5 };
    await kv.put(
      EFFECTS_KEY,
      JSON.stringify({
        ranOn: "2026-10-03",
        updatedAt: "2026-10-03T05:35:00.000Z",
        status: "ok",
        items: [
          {
            key: "clone-effect",
            name: { en: "clone effect", ar: "تأثير الاستنساخ" },
            what,
            termId: "clone-effect",
            isNew: false,
            checked: true,
            creators: 9,
            posts: 12,
            platforms: ["ig", "tt"],
            growth: 2,
            youtube,
            samples: [{ url: "https://www.tiktok.com/@c1/video/1", title: "Clone Yourself" }],
          },
          {
            key: "swagger-trend",
            name: { en: "Swagger Trend" },
            isNew: true,
            checked: true,
            creators: 3,
            posts: 3,
            platforms: ["ig"],
            growth: 3,
            samples: [],
          },
          {
            key: "long-trend",
            name: { en: "n".repeat(60), ar: "ن".repeat(60) },
            what: { en: "w".repeat(120), ar: "و".repeat(120) },
            isNew: true,
            checked: true,
            creators: 3,
            posts: 3,
            platforms: ["tt"],
            growth: 1,
            samples: [],
          },
        ],
        meta: {},
        history: {},
      }),
    );
    const effects = await getTrends({ SOCIAL_KV: kv }, {}, NOW);
    expect(effects).toEqual({
      fetchedAt: null,
      items: [],
      effectsUpdatedAt: "2026-10-03T05:35:00.000Z",
      effects: [
        {
          name: { en: "clone effect", ar: "تأثير الاستنساخ" },
          what,
          creators: 9,
          isNew: false,
          growth: 2,
          youtube,
        },
        { name: { en: "Swagger Trend" }, creators: 3, isNew: true, growth: 3 },
        // Names come from web text: clipped to 40 characters, lines to 90.
        {
          name: { en: `${"n".repeat(39)}…`, ar: `${"ن".repeat(39)}…` },
          what: { en: `${"w".repeat(89)}…`, ar: `${"و".repeat(89)}…` },
          creators: 3,
          isNew: true,
          growth: 1,
        },
      ],
    });
    // The dashboard's rule: a list over 3 days old is not this week's any more. Its time still says how old it is.
    const at = (iso: string) => getTrends({ SOCIAL_KV: kv }, {}, new Date(iso));
    expect(await at("2026-10-06T05:35:00.000Z")).toEqual(effects);
    expect(await at("2026-10-07T09:00:00.000Z")).toEqual({
      fetchedAt: null,
      items: [],
      effectsUpdatedAt: "2026-10-03T05:35:00.000Z",
      effects: [],
    });

    // A read error costs the effects only, never the radar's rows or the tool call.
    const feed = {
      fetchedAt: "2026-10-03T06:00:00Z",
      degraded: false,
      sources: [],
      items: [
        {
          id: "a",
          platform: "youtube",
          region: "SA",
          lang: "ar",
          title: "car edit",
          source: "YouTube search",
          seenAt: "x",
          tags: [],
        },
      ],
    };
    const down = {
      async get(key: string) {
        if (key === EFFECTS_KEY) throw new Error("KV GET failed");
        return key === trendKeys.latest ? JSON.stringify(feed) : null;
      },
    } as unknown as KVNamespace;
    const radarOnly = {
      fetchedAt: "2026-10-03T06:00:00Z",
      items: [{ title: "car edit", platform: "youtube", region: "SA", source: "YouTube search" }],
      effectsUpdatedAt: null,
      effects: [],
    };
    expect(await getTrends({ SOCIAL_KV: down }, {}, NOW)).toEqual(radarOnly);

    // So does a stored item that is not an effect (say, from an older deploy): no name to read.
    const odd = fakeKV();
    await odd.put(trendKeys.latest, JSON.stringify(feed));
    await odd.put(
      EFFECTS_KEY,
      JSON.stringify({
        ranOn: "2026-10-03",
        updatedAt: "2026-10-03T05:35:00.000Z",
        status: "ok",
        items: [{ key: "clone-effect", creators: 9, isNew: false, growth: 2 }],
        meta: {},
        history: {},
      }),
    );
    expect(await getTrends({ SOCIAL_KV: odd }, {}, NOW)).toEqual(radarOnly);
  });
});

describe("save / get picks", () => {
  it("saves Claude's picks and reads them back", async () => {
    const env = { SOCIAL_KV: fakeKV() };
    const saved = await savePicksTool(
      env,
      { fetch: vi.fn(), now: NOW },
      {
        topic: "flash",
        items: [
          {
            url: "https://www.tiktok.com/@ed/video/1",
            title: "clean flash",
            label: "example",
            note: "watch 0:03",
          },
        ],
      },
    );
    expect(saved).toMatchObject({ saved: 1, rejected: 0, topicKey: "flash-transition" });
    expect((await readPicks(env, "flash"))[0].items[0].note).toBe("watch 0:03");
    const got = await getPicksTool(env, { topic: "flash" });
    expect((got.picks as unknown[]).length).toBe(1);
  });

  it("refuses a topic without a letter or digit, writing nothing", async () => {
    const get = vi.fn();
    const put = vi.fn();
    const out = await savePicksTool(
      { SOCIAL_KV: { get, put } as unknown as KVNamespace },
      { fetch: vi.fn(), now: NOW },
      {
        topic: "🔥🔥",
        items: [{ url: "https://www.tiktok.com/@ed/video/1", title: "x", label: "example" }],
      },
    );
    expect(out).toEqual(BAD_TOPIC);
    expect(get).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

describe("toolCall", () => {
  /** Runs `fn` with console.log captured: its answer and the lines it logged. */
  async function logged<T>(fn: () => Promise<T>): Promise<{ reply: T; lines: string[] }> {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const reply = await fn();
      return { reply, lines: log.mock.calls.map((c) => String(c[0])) };
    } finally {
      log.mockRestore();
    }
  }

  it("answers the result as JSON text and logs one line: no URLs, no items", async () => {
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: fakeKV(), MCP_DAILY_LOOKUPS: "10" };
    const topic = `flash ${"x".repeat(150)}`;
    const { reply, lines } = await logged(() =>
      toolCall("search_videos", { topic }, () =>
        searchVideos(env, { fetch: tavily(), now: NOW }, { topic, platforms: ["tiktok"] }),
      ),
    );
    expect(reply.isError).toBeUndefined();
    const out = JSON.parse(reply.content[0].text) as { items: unknown[]; lookupsLeftToday: number };
    expect(out.items.length).toBeGreaterThan(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("https://");
    expect(JSON.parse(lines[0])).toEqual({
      mcp: "search_videos",
      topic: `${topic.slice(0, 99)}…`,
      ms: expect.any(Number),
      cached: false,
      lookups: out.lookupsLeftToday,
      count: out.items.length,
    });
  });

  it("logs a tool's own error code and answers it as plain content", async () => {
    const { reply, lines } = await logged(() => toolCall("get_picks", {}, async () => BAD_TOPIC));
    expect(reply).toEqual({ content: [{ type: "text", text: JSON.stringify(BAD_TOPIC) }] });
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { mcp: "get_picks", ms: expect.any(Number), error: "bad_topic" },
    ]);
  });

  it("turns a thrown error into a readable failed result, logging its name, never its message", async () => {
    const down = {
      async get() {
        throw new TypeError("KV GET failed: internal detail");
      },
    } as unknown as KVNamespace;
    const items = [
      { url: "https://www.tiktok.com/@ed/video/1", title: "x", label: "example" as const },
    ];
    const { reply, lines } = await logged(() =>
      toolCall("save_picks", { topic: "flash" }, () =>
        savePicksTool({ SOCIAL_KV: down }, { fetch: vi.fn(), now: NOW }, { topic: "flash", items }),
      ),
    );
    expect(reply).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            error: "failed",
            message: "Something went wrong on the Worker. Try again in a minute.",
          }),
        },
      ],
    });
    expect(lines.join("\n")).not.toContain("internal detail");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      {
        mcp: "save_picks",
        topic: "flash",
        ms: expect.any(Number),
        error: "failed",
        cause: "TypeError",
      },
    ]);
  });
});
