import { describe, expect, it, vi } from "vitest";
import { trendKeys } from "../trends/kv";
import { TAVILY_URL } from "../trends/tavily";
import { readPicks } from "./picks";
import { addConnectorLookups, getPicksTool, getTrends, savePicksTool, searchVideos } from "./tools";
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
const tavily = () =>
  vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) !== TAVILY_URL) return json({}, 404);
    const q = String((JSON.parse(String(init?.body)) as { query: string }).query);
    return json({
      results: [
        { url: `https://www.tiktok.com/@ed/video/${q.length}`, title: `${q} edit`, content: q },
      ],
      usage: { credits: 1 },
    });
  });

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
    expect((out.items as { platform: string }[]).every((i) => i.platform === "tiktok")).toBe(true);
    expect(env.SOCIAL_KV.store.get(usageKeys.connector("2026-10-03"))).toBe("2");
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
  it("filters the radar's feed by region and genre", async () => {
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
        ],
      }),
    );
    const out = await getTrends({ SOCIAL_KV: kv }, { region: "SA", genre: "cars" });
    expect(out.items).toEqual([
      {
        title: "car edit",
        platform: "youtube",
        region: "SA",
        source: "YouTube search",
        genre: "cars",
        score: 90,
      },
    ]);
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
});
