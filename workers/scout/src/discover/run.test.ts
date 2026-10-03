import { describe, expect, it, vi } from "vitest";
import { TAVILY_URL } from "../trends/tavily";
import { discoverKeys } from "./fetchers";
import { ANSWER_TTL_S, discoverAnswerKey, requestHash, runDiscover } from "./run";
import { connectorCap, discoverUsage, usageKeys } from "./usage";

const NOW = new Date("2026-10-03T09:00:00Z");

type Entry = { value: string; expirationTtl?: number };
function fakeKV() {
  const store = new Map<string, Entry>();
  return {
    store,
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, { value, expirationTtl: opts?.expirationTtl });
    },
  } as unknown as KVNamespace & { store: Map<string, Entry> };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Body = Record<string, unknown>;

/** A fake internet: Tavily answers per platform and query, YouTube search and statistics answer. */
function web(over: { tavily?: (body: Body) => Response | undefined } = {}) {
  let n = 0;
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.href === TAVILY_URL) {
      const body = JSON.parse(String(init?.body)) as Body;
      const custom = over.tavily?.(body);
      if (custom) return custom;
      const q = String(body.query);
      const domain = (body.include_domains as string[])[0];
      const results =
        domain === "tiktok.com"
          ? [
              { url: `https://www.tiktok.com/@ed/video/${++n}`, title: `${q} 🔥`, content: q },
              {
                url: `https://www.tiktok.com/@fan/video/${++n}`,
                title: "The Flash reaction",
                content: "superhero",
              },
            ]
          : [
              {
                url: `https://www.instagram.com/p/P${++n}/`,
                title: `${q} reel`,
                content: `${q} reel`,
              },
            ];
      return json({ results, usage: { credits: 1 } });
    }
    if (url.pathname.endsWith("/youtube/v3/search")) {
      const q = url.searchParams.get("q") ?? "";
      return json({
        items: [
          {
            id: { videoId: `v${++n}` },
            snippet: {
              title: q,
              description: "",
              channelTitle: "Cinecom",
              channelId: "UC1",
              publishedAt: "2026-09-01T00:00:00Z",
            },
          },
        ],
      });
    }
    if (url.pathname.endsWith("/youtube/v3/videos")) {
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return json({ items: ids.map((id) => ({ id, statistics: { viewCount: "1000" } })) });
    }
    return json({ error: "not_found" }, 404);
  });
}

const ENV = () => ({ TAVILY_API_KEY: "k", YOUTUBE_API_KEY: "y", SOCIAL_KV: fakeKV() });

describe("runDiscover", () => {
  it("searches every platform, labels, ranks creators, counts the cost and caches the answer", async () => {
    const env = ENV();
    const fetchMock = web();
    const answer = await runDiscover(env, { q: "flash" }, { fetch: fetchMock, now: NOW });

    expect(answer.topicKey).toBe("flash-transition");
    expect(answer.platforms).toEqual({ tt: { ok: true }, ig: { ok: true }, yt: { ok: true } });
    expect(answer.cost).toEqual({ tavily: 6, youtubeSearch: 3 });
    expect(answer.cached).toBe(false);
    const tiktok = answer.items.filter((i) => i.platform === "tt");
    expect(tiktok).toHaveLength(6);
    expect(tiktok.filter((i) => i.offTopic)).toHaveLength(3);
    expect(
      answer.items.filter((i) => i.platform === "yt").every((i) => i.stats?.views === 1000),
    ).toBe(true);
    expect(answer.creators.slice(0, 2).map((c) => c.handle)).toEqual(["Cinecom", "@ed"]);
    expect(new Set(answer.items.map((i) => i.section))).toEqual(new Set(["example", "tutorial"]));

    const key = discoverAnswerKey(await requestHash({ q: "flash" }));
    expect(env.SOCIAL_KV.store.get(key)?.expirationTtl).toBe(ANSWER_TTL_S);
    expect(env.SOCIAL_KV.store.get(discoverKeys.yt("2026-10-03"))?.value).toBe("3");

    const calls = fetchMock.mock.calls.length;
    const again = await runDiscover(env, { q: "  FLASH " }, { fetch: fetchMock, now: NOW });
    expect(again.cached).toBe(true);
    expect(again.items).toEqual(answer.items);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("asks an empty TikTok query once more with its other words", async () => {
    const fetchMock = web({
      tavily: (body) =>
        body.query === "flash transition edit" &&
        (body.include_domains as string[])[0] === "tiktok.com"
          ? json({
              results: [{ url: "https://www.tiktok.com/@ed", title: "ed" }],
              usage: { credits: 1 },
            })
          : undefined,
    });
    const answer = await runDiscover(ENV(), { q: "flash" }, { fetch: fetchMock, now: NOW });
    expect(answer.platforms.tt).toEqual({ ok: true, retried: true });
    expect(answer.cost.tavily).toBe(7);
  });

  it("reports a platform that failed and does not cache that answer", async () => {
    const env = ENV();
    const fetchMock = web({
      tavily: (body) =>
        (body.include_domains as string[])[0] === "instagram.com" ? json({}, 500) : undefined,
    });
    const answer = await runDiscover(env, { q: "flash" }, { fetch: fetchMock, now: NOW });
    expect(answer.platforms.ig).toEqual({ ok: false, error: "upstream" });
    expect(answer.items.some((i) => i.platform === "tt")).toBe(true);
    expect([...env.SOCIAL_KV.store.keys()].some((k) => k.startsWith("discover:answer:"))).toBe(
      false,
    );
  });

  it("stops YouTube at the day's cap without calling it", async () => {
    const env = ENV();
    await env.SOCIAL_KV.put(discoverKeys.yt("2026-10-03"), "70");
    const fetchMock = web();
    const answer = await runDiscover(env, { q: "flash" }, { fetch: fetchMock, now: NOW });
    expect(answer.platforms.yt).toEqual({ ok: false, error: "daily_cap" });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/youtube/v3/search"))).toBe(
      false,
    );
    expect(answer.cost.youtubeSearch).toBe(0);
  });

  it("says YouTube is not configured without its key", async () => {
    const answer = await runDiscover(
      { TAVILY_API_KEY: "k" },
      { q: "flash" },
      { fetch: web(), now: NOW },
    );
    expect(answer.platforms.yt).toEqual({ ok: false, error: "not_configured" });
  });

  it("searches on when KV fails (KV takes one write per key a second)", async () => {
    const kv = fakeKV();
    const down = async () => {
      throw new Error("KV down");
    };
    Object.assign(kv, { get: down, put: down });
    const env = { TAVILY_API_KEY: "k", YOUTUBE_API_KEY: "y", SOCIAL_KV: kv };
    const answer = await runDiscover(env, { q: "flash" }, { fetch: web(), now: NOW });
    expect(answer.platforms).toEqual({ tt: { ok: true }, ig: { ok: true }, yt: { ok: true } });
    expect(answer.cost.youtubeSearch).toBe(3);
  });

  it("hashes the request, not its spelling", async () => {
    expect(await requestHash({ q: "Flash" })).toBe(await requestHash({ q: " flash  " }));
    expect(await requestHash({ q: "flash" })).not.toBe(
      await requestHash({ q: "flash", exact: true }),
    );
    expect(await requestHash({ q: "flash", platforms: ["yt", "tt"] })).toBe(
      await requestHash({ q: "flash", platforms: ["tt", "yt"] }),
    );
  });
});

describe("discoverUsage", () => {
  it("reads Tavily's usage once per 10 minutes and today's counters", async () => {
    const kv = fakeKV();
    await kv.put(discoverKeys.yt("2026-10-03"), "9");
    await kv.put(usageKeys.connector("2026-10-03"), "12");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({
        key: { usage: 400, limit: null },
        account: {
          current_plan: "Researcher",
          plan_usage: 412,
          plan_limit: 1000,
          paygo_usage: 0,
          paygo_limit: 5000,
        },
      }),
    );
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: kv };
    const usage = await discoverUsage(env, fetchMock, NOW);
    expect(usage).toEqual({
      tavily: { used: 412, limit: 1000, plan: "Researcher", paygoUsed: 0, paygoLimit: 5000 },
      youtube: { usedToday: 9, cap: 70 },
      connector: { usedToday: 12, cap: 60 },
    });
    expect(kv.store.get(usageKeys.tavily)?.expirationTtl).toBe(600);
    await discoverUsage(env, fetchMock, NOW);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says why Tavily's usage is missing", async () => {
    expect((await discoverUsage({}, vi.fn(), NOW)).tavily).toEqual({ error: "not_configured" });
    const refused = vi.fn<typeof fetch>(async () => json({}, 401));
    expect((await discoverUsage({ TAVILY_API_KEY: "k" }, refused, NOW)).tavily).toEqual({
      error: "auth",
    });
  });
});

describe("connectorCap", () => {
  it("reads MCP_DAILY_LOOKUPS: blank is unset (60), only a number ≥ 0 overrides", () => {
    expect(connectorCap({})).toBe(60);
    expect(connectorCap({ MCP_DAILY_LOOKUPS: "" })).toBe(60);
    expect(connectorCap({ MCP_DAILY_LOOKUPS: "   " })).toBe(60);
    expect(connectorCap({ MCP_DAILY_LOOKUPS: "abc" })).toBe(60);
    expect(connectorCap({ MCP_DAILY_LOOKUPS: "-1" })).toBe(60);
    expect(connectorCap({ MCP_DAILY_LOOKUPS: "0" })).toBe(0);
    expect(connectorCap({ MCP_DAILY_LOOKUPS: "25" })).toBe(25);
  });
});
