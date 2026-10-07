import { describe, expect, it, vi } from "vitest";
import { TAVILY_URL } from "../trends/tavily";
import { discoverKeys } from "./fetchers";
import { planSearch } from "./plan";
import { ANSWER_TTL_S, MAX_RETRIES, discoverAnswerKey, requestHash, runDiscover } from "./run";
import type { DiscoverRequest } from "./types";
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
    expect(answer.complete).toBe(true);
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
    expect(again.complete).toBe(true);
    expect(again.cost).toEqual({ tavily: 0, youtubeSearch: 0 });
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

  it("retries category misses within the shared budget, preserving originals and YouTube call counts", async () => {
    const req: DiscoverRequest = {
      q: "coffee edit",
      genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
    };
    const firstQueries = new Set(planSearch(req).queries.map((q) => q.q));
    let n = 0;
    const fetchMock = web({
      tavily: (body) => {
        const first = firstQueries.has(String(body.query));
        const instagram = (body.include_domains as string[])[0] === "instagram.com";
        return json({
          results: [
            {
              url: instagram
                ? `https://www.instagram.com/p/category${++n}/`
                : `https://www.tiktok.com/@coffee/video/${++n}`,
              title: first ? "Easy coffee recipes" : "Cinematic coffee video b roll",
              content: first ? "How to prepare espresso" : "Coffee filmmaking and camera tutorial",
            },
          ],
          usage: { credits: 1 },
        });
      },
    });
    const answer = await runDiscover(ENV(), req, { fetch: fetchMock, now: NOW });
    const searches = fetchMock.mock.calls.filter(([url]) => String(url) === TAVILY_URL);
    expect(searches).toHaveLength(6 + MAX_RETRIES);
    expect(answer.cost).toEqual({ tavily: 6 + MAX_RETRIES, youtubeSearch: 3 });
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/youtube/v3/search")),
    ).toHaveLength(3);
    expect(answer.items.filter((card) => card.title === "Easy coffee recipes")).toHaveLength(6);
    expect(
      answer.items
        .filter((card) => card.title === "Easy coffee recipes")
        .every((card) => card.offTopic),
    ).toBe(true);
    expect(
      answer.items.filter((card) => card.title === "Cinematic coffee video b roll"),
    ).toHaveLength(MAX_RETRIES);
    expect(
      answer.items
        .filter((card) => card.title === "Cinematic coffee video b roll")
        .every((card) => !card.offTopic),
    ).toBe(true);
    expect(answer.complete).toBe(true);
  });

  it("does not spend retries when category queries already contain an eligible card", async () => {
    const fetchMock = web();
    const answer = await runDiscover(
      ENV(),
      { q: "coffee edit", genreQuery: { en: "coffee edit", ar: "تصوير قهوة" } },
      { fetch: fetchMock, now: NOW },
    );
    expect(answer.cost).toEqual({ tavily: 6, youtubeSearch: 3 });
    expect(
      Object.values(answer.platforms).some((platform) => platform?.ok && platform.retried),
    ).toBe(false);
    expect(answer.complete).toBe(true);
  });

  it("shows the typed idea's matches, marked outside the category, when nothing has both", async () => {
    const req: DiscoverRequest = {
      q: "match cut",
      genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
      platforms: ["tt"],
    };
    let n = 0;
    const fetchMock = web({
      tavily: () =>
        json({
          results: [
            {
              url: `https://www.tiktok.com/@cuts/video/${++n}`,
              title: "Match cut football edit tutorial",
              content: "match cut transitions",
            },
            {
              url: `https://www.tiktok.com/@chef/video/${++n}`,
              title: "Coffee and espresso recipes",
              content: "Learn how to make coffee at home",
            },
          ],
          usage: { credits: 1 },
        }),
    });
    const answer = await runDiscover(ENV(), req, { fetch: fetchMock, now: NOW });
    const shown = answer.items.filter((item) => !item.offTopic);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((item) => item.outsideCategory && /match cut/i.test(item.title))).toBe(true);
    expect(answer.items.some((item) => /recipes/.test(item.title) && !item.offTopic)).toBe(false);
    expect(answer.complete).toBe(true);
  });

  it.each(["off-topic", "upstream"])(
    "does not cache an all-off-topic category answer after %s retries",
    async (retryResult) => {
      const req: DiscoverRequest = {
        q: "coffee edit",
        genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
        platforms: ["tt"],
      };
      const firstQueries = new Set(planSearch(req).queries.map((query) => query.q));
      let n = 0;
      const fetchMock = web({
        tavily: (body) =>
          retryResult === "upstream" && !firstQueries.has(String(body.query))
            ? json({}, 500)
            : json({
                results: [
                  {
                    url: `https://www.tiktok.com/@recipes/video/${++n}`,
                    title: "Coffee and espresso recipes",
                    content: "Learn how to make coffee at home",
                  },
                ],
                usage: { credits: 1 },
              }),
      });
      const env = ENV();
      const answer = await runDiscover(env, req, { fetch: fetchMock, now: NOW });
      expect(answer.items).toHaveLength(3);
      expect(answer.items.every((item) => item.offTopic)).toBe(true);
      expect(answer.cost.tavily).toBe(3 + (retryResult === "upstream" ? 0 : MAX_RETRIES));
      expect(answer.complete).toBe(false);
      expect(env.SOCIAL_KV.store.has(discoverAnswerKey(await requestHash(req)))).toBe(false);
      const again = await runDiscover(env, req, { fetch: fetchMock, now: NOW });
      expect(again.cached).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(2 * (3 + MAX_RETRIES));
    },
  );

  it("uses an eligible retry's evidence for a repeated URL instead of keeping its old off-topic label", async () => {
    const req: DiscoverRequest = {
      q: "coffee edit",
      genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
      platforms: ["ig"],
    };
    const firstQueries = new Set(planSearch(req).queries.map((query) => query.q));
    const fetchMock = web({
      tavily: (body) =>
        json({
          results: [
            {
              url: "https://www.instagram.com/p/sameCoffee/",
              title: firstQueries.has(String(body.query))
                ? "Making espresso at home"
                : "Coffee cinematic b roll tutorial",
              content: "Coffee",
            },
          ],
          usage: { credits: 1 },
        }),
    });
    const answer = await runDiscover(ENV(), req, { fetch: fetchMock, now: NOW });
    expect(answer.items).toHaveLength(1);
    expect(answer.items[0].title).toBe("Coffee cinematic b roll tutorial");
    expect(answer.items[0].offTopic).toBeUndefined();
    expect(answer.complete).toBe(true);
  });

  it("does not let an earlier query's off-topic duplicate hide a later query's eligible evidence", async () => {
    const req: DiscoverRequest = {
      q: "coffee edit",
      genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
      platforms: ["ig"],
    };
    const queries = planSearch(req).queries;
    const fetchMock = web({
      tavily: (body) =>
        json({
          results: [
            {
              url: "https://www.instagram.com/p/duplicateCoffee/",
              title:
                body.query === queries[0].q
                  ? "How to brew espresso"
                  : "Coffee cinematic video tutorial",
              content: "Coffee",
            },
            {
              url: "https://www.instagram.com/p/otherCoffee/",
              title: "Coffee cinematic camera tutorial",
            },
          ],
          usage: { credits: 1 },
        }),
    });
    const answer = await runDiscover(ENV(), req, { fetch: fetchMock, now: NOW });
    expect(answer.items).toHaveLength(2);
    expect(answer.items.every((item) => !item.offTopic)).toBe(true);
    expect(answer.items.find((item) => item.url.includes("duplicateCoffee"))?.title).toBe(
      "Coffee cinematic video tutorial",
    );
    expect(answer.cost.tavily).toBe(3);
  });

  it("does not mark an AI concept search complete merely because off-topic videos were returned", async () => {
    const req: DiscoverRequest = {
      q: "Coffee match cuts",
      mode: "ai",
      platforms: ["ig"],
      aiPlan: {
        provider: "chatgpt",
        model: "test-model",
        plan: {
          summary: { en: "Coffee match cuts", ar: "انتقالات ماتش كت للقهوة" },
          queries: [{ q: "coffee match cut", lang: "en", intent: "examples" }],
          concepts: [
            ["coffee", "قهوة"],
            ["match cut", "ماتش كت"],
          ],
          platforms: ["ig"],
          timeRange: "any",
          ytLength: "any",
        },
      },
    };
    const env = ENV();
    const fetchMock = web({
      tavily: () =>
        json({
          results: [{ url: "https://www.instagram.com/p/unrelated/", title: "Sunset travel vlog" }],
          usage: { credits: 1 },
        }),
    });
    const answer = await runDiscover(env, req, { fetch: fetchMock, now: NOW });
    expect(answer.items).toHaveLength(1);
    expect(answer.items[0].offTopic).toBe(true);
    expect(answer.complete).toBe(false);
    expect(env.SOCIAL_KV.store.has(discoverAnswerKey(await requestHash(req)))).toBe(false);
  });

  it.each<DiscoverRequest>([
    { q: "coffee edit", exact: true },
    {
      q: "coffee edit",
      genreQuery: { en: "coffee edit", ar: "تصوير قهوة" },
      queries: [{ q: "coffee", platform: "tt", lang: "en", intent: "examples" }],
    },
    { q: "flash" },
  ])("preserves non-category, exact and connector retry behavior for %j", async (request) => {
    const req: DiscoverRequest = { ...request, platforms: ["tt"] };
    const fetchMock = web({
      tavily: () =>
        json({
          results: [{ url: "https://www.tiktok.com/@recipes/video/123", title: "A recipe" }],
          usage: { credits: 1 },
        }),
    });
    const expectedCalls = planSearch(req).queries.length;
    const answer = await runDiscover(ENV(), req, { fetch: fetchMock, now: NOW });
    expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
    expect(answer.cost.tavily).toBe(expectedCalls);
    expect(answer.platforms.tt).toEqual({ ok: true });
    expect(answer.complete).toBe(true);
  });

  it("reports a platform that failed and does not cache that answer", async () => {
    const env = ENV();
    const fetchMock = web({
      tavily: (body) =>
        (body.include_domains as string[])[0] === "instagram.com" ? json({}, 500) : undefined,
    });
    const answer = await runDiscover(env, { q: "flash" }, { fetch: fetchMock, now: NOW });
    expect(answer.platforms.ig).toEqual({ ok: false, error: "upstream" });
    expect(answer.complete).toBe(false);
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

  it("searches YouTube as far as the day's cap goes, and does not cache that part answer", async () => {
    const env = ENV();
    await env.SOCIAL_KV.put(discoverKeys.yt("2026-10-03"), "65");
    const fetchMock = web();
    const answer = await runDiscover(env, { q: "flash" }, { fetch: fetchMock, now: NOW });
    const searches = fetchMock.mock.calls.filter(([u]) => String(u).includes("/youtube/v3/search"));
    expect(searches).toHaveLength(1);
    expect(answer.platforms.yt).toEqual({ ok: true, partial: "daily_cap" });
    // The platform answered, but a query did not: not complete (the dashboard keeps it no more than KV does).
    expect(answer.complete).toBe(false);
    expect(answer.cost.youtubeSearch).toBe(1);
    expect([...env.SOCIAL_KV.store.keys()].some((k) => k.startsWith("discover:answer:"))).toBe(
      false,
    );
  });

  it("does not cache an answer that found nothing", async () => {
    const env = ENV();
    const empty = vi.fn<typeof fetch>(async (input) =>
      String(input) === TAVILY_URL
        ? json({ results: [], usage: { credits: 1 } })
        : json({ items: [] }),
    );
    const answer = await runDiscover(env, { q: "flash" }, { fetch: empty, now: NOW });
    expect(answer.items).toEqual([]);
    expect(Object.values(answer.platforms).every((s) => s?.ok)).toBe(true);
    expect(answer.complete).toBe(false);
    expect([...env.SOCIAL_KV.store.keys()].some((k) => k.startsWith("discover:answer:"))).toBe(
      false,
    );
  });

  it("names a failed platform's most telling error", async () => {
    const [examples, tutorials, arabic] = [
      "flash transition edit",
      "flash transition tutorial capcut davinci",
      "شرح تأثير فلاش مونتاج",
    ];
    const tiktok = async (codes: Record<string, number>) => {
      const fetchMock = web({ tavily: (body) => json({}, codes[String(body.query)]) });
      const answer = await runDiscover(
        ENV(),
        { q: "flash", platforms: ["tt"] },
        { fetch: fetchMock, now: NOW },
      );
      return answer.platforms.tt;
    };
    // quota > auth > daily_cap > not_configured > upstream, whichever query failed first.
    expect(await tiktok({ [examples]: 500, [tutorials]: 401, [arabic]: 429 })).toEqual({
      ok: false,
      error: "quota",
    });
    expect(await tiktok({ [examples]: 500, [tutorials]: 500, [arabic]: 403 })).toEqual({
      ok: false,
      error: "auth",
    });
  });

  it("says YouTube is not configured without its key", async () => {
    const answer = await runDiscover(
      { TAVILY_API_KEY: "k" },
      { q: "flash" },
      { fetch: web(), now: NOW },
    );
    expect(answer.platforms.yt).toEqual({ ok: false, error: "not_configured" });
    // A key that is not set never answers, so it does not hold the answer back.
    expect(answer.complete).toBe(true);
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
    // Claude's own queries are another search than the planned one.
    const mine = { q: "flash velocity", platform: "tt", lang: "en", intent: "examples" } as const;
    expect(await requestHash({ q: "flash", queries: [mine] })).not.toBe(
      await requestHash({ q: "flash" }),
    );
    expect(await requestHash({ q: "flash", queries: [mine] })).toBe(
      await requestHash({ q: "flash", queries: [{ ...mine, q: " Flash Velocity " }] }),
    );
  });

  it("hashes 'Not this?' back to the meaning the plan picks anyway as the plain search", async () => {
    expect(await requestHash({ q: "flash", term: "flash-transition" })).toBe(
      await requestHash({ q: "flash" }),
    );
    expect(await requestHash({ q: "flash", term: "camera-flash" })).not.toBe(
      await requestHash({ q: "flash" }),
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
      youtube: { usedToday: 9, cap: 66 },
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
    for (const status of [429, 432, 433]) {
      const limited = vi.fn<typeof fetch>(async () => json({}, status));
      expect((await discoverUsage({ TAVILY_API_KEY: "k" }, limited, NOW)).tavily).toEqual({
        error: "quota",
      });
    }
  });

  it("lets go of a refused answer's unread body, so it never holds the connection", async () => {
    for (const status of [401, 432, 500]) {
      let cancelled = false;
      const body = new ReadableStream({ cancel: () => void (cancelled = true) });
      const refused = vi.fn<typeof fetch>(async () => new Response(body, { status }));
      expect((await discoverUsage({ TAVILY_API_KEY: "k" }, refused, NOW)).tavily).toHaveProperty(
        "error",
      );
      expect(cancelled).toBe(true);
    }
  });

  it("does not keep a /usage answer without its numbers", async () => {
    const kv = fakeKV();
    const env = { TAVILY_API_KEY: "k", SOCIAL_KV: kv };
    const bodies = [
      () => json({}),
      () => json({ key: { usage: "12" } }),
      () => new Response("<html>"),
    ];
    for (const body of bodies) {
      const odd = vi.fn<typeof fetch>(async () => body());
      expect((await discoverUsage(env, odd, NOW)).tavily).toEqual({ error: "upstream" });
    }
    expect(kv.store.has(usageKeys.tavily)).toBe(false);
  });

  it("gives up on a /usage call that does not answer", async () => {
    const hanging = vi.fn<typeof fetch>(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const usage = await discoverUsage({ TAVILY_API_KEY: "k" }, hanging, NOW, 20);
    expect(usage.tavily).toEqual({ error: "upstream" });
    expect(hanging.mock.calls[0][1]?.signal?.aborted).toBe(true);
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
