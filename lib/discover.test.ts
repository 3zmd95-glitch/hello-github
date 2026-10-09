import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoverCache,
  creatorsOn,
  DISCOVER_CACHE_BUDGET,
  DISCOVER_CACHE_KEY,
  DISCOVER_CACHE_MAX,
  DISCOVER_CACHE_TTL_MS,
  DISCOVER_CACHE_VERSION,
  DISCOVER_QUALITY_VERSION,
  discoverLang,
  discoverRequestFrom,
  discoverRequestKey,
  discoverSearch,
  discoverUsage,
  hiddenCount,
  parseDiscoverAnswer,
  parsePicks,
  peekDiscover,
  picksFor,
  popularItems,
  sectionItems,
  tabCounts,
  type DiscoverAnswer,
  type DiscoverItem,
  type DiscoverRequest,
} from "./discover";
import type { AiSelection } from "./localAi";
import type { KeyValueStorage } from "./scoutClient";

const config = { url: "https://w.example", token: "t" };
let n = 0;
const item = (over: Partial<DiscoverItem>): DiscoverItem => ({
  platform: "tt",
  handle: "@a",
  title: "flash transition edit",
  snippet: "",
  url: `https://www.tiktok.com/@a/video/${++n}`,
  lang: "en",
  section: "example",
  ...over,
});
const answer = (items: DiscoverItem[], over: Partial<DiscoverAnswer> = {}): DiscoverAnswer => ({
  qualityVersion: DISCOVER_QUALITY_VERSION,
  topicKey: "flash-transition",
  understood: {
    termId: "flash-transition",
    label: { ar: "انتقال فلاش", en: "flash transition" },
    exact: false,
  },
  alternatives: [{ exact: true }],
  items,
  creators: [{ platform: "tt", handle: "@a", url: "https://www.tiktok.com/@a", count: 2 }],
  platforms: { tt: { ok: true } },
  cost: { tavily: 6, youtubeSearch: 3 },
  cached: false,
  complete: true,
  ...over,
});

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

/** A Worker that always gives this reply. */
const replying = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

/** The request keys kept in the device's storage, in their stored order. */
const keptKeys = (storage: KeyValueStorage) =>
  Object.keys(JSON.parse(storage.getItem(DISCOVER_CACHE_KEY) ?? "{}") as object);

const CARS = {
  id: "cars",
  emoji: "🚗",
  name: { ar: "سيارات", en: "Cars" },
  queries: { ar: ["ايديت سيارات"], en: ["car edit"] },
  hashtags: ["caredit"],
};

describe("discoverRequestFrom", () => {
  it("builds the Worker request from the panel's state", () => {
    expect(
      discoverRequestFrom({
        base: " flash ",
        genre: CARS,
        programHint: "DaVinci Resolve",
        recency: "week",
        length: "short",
      }),
    ).toEqual({
      q: "flash",
      genreQuery: { ar: "ايديت سيارات", en: "car edit" },
      program: "DaVinci Resolve",
      lang: "en",
      timeRange: "week",
      ytLength: "short",
    });
  });

  it("searches the genre's English query when nothing is typed (its Arabic one beside it), and passes the owner's pick", () => {
    expect(
      discoverRequestFrom({
        base: "",
        genre: CARS,
        recency: "any",
        length: "any",
        pick: { term: "camera-flash" },
      }),
    ).toEqual({
      q: "car edit",
      genreQuery: { ar: "ايديت سيارات" },
      term: "camera-flash",
      lang: "en",
    });
    expect(discoverRequestFrom({ base: "  ", recency: "any", length: "any" })).toBeNull();
  });

  it("keeps to the Worker's limits and never sends symbols only", () => {
    const long = discoverRequestFrom({
      base: "a".repeat(250),
      genre: { queries: { ar: ["ع".repeat(150)], en: ["e".repeat(150)] } },
      programHint: "p".repeat(80),
      recency: "any",
      length: "any",
    });
    expect([
      long?.q.length,
      long?.program?.length,
      long?.genreQuery?.ar?.length,
      long?.genreQuery?.en?.length,
    ]).toEqual([200, 60, 100, 100]);
    // Cut before half an emoji, not through it.
    const edge = discoverRequestFrom({
      base: `${"a".repeat(199)}🔥`,
      recency: "any",
      length: "any",
    });
    expect(edge?.q).toBe("a".repeat(199));
    expect(discoverRequestFrom({ base: "🔥🔥 !!!", recency: "any", length: "any" })).toBeNull();
    expect(discoverRequestFrom({ base: "🔥 2", recency: "any", length: "any" })?.q).toBe("🔥 2");
  });
});

describe("the search's language and a trend chip's editing flag", () => {
  const base = { base: "Glow Effect", recency: "any" as const, length: "any" as const };

  // English first (the owner, 2026-10-07): Arabic only when what was typed has Arabic letters or Arabic first is on,
  // worked out for each search (a chip's English never sticks to the next one).
  it("asks Arabic for Arabic typing or Arabic first, else English; a trend chip's editing flag; neither with an AI brief", () => {
    expect(discoverRequestFrom({ ...base, editing: true })).toEqual({
      q: "Glow Effect",
      lang: "en",
      editing: true,
    });
    expect(discoverRequestFrom({ ...base, base: "شرح فلاش", editing: false })).toEqual({
      q: "شرح فلاش",
      lang: "ar",
    });
    expect(discoverRequestFrom({ ...base, arFirst: true })).toEqual({
      q: "Glow Effect",
      lang: "ar",
    });
    expect(discoverRequestFrom({ ...base, mode: "ai", arFirst: true, editing: true })).toEqual({
      q: "Glow Effect",
      mode: "ai",
    });
    expect(discoverLang("speed ramp", false)).toBe("en");
    expect(discoverLang("سبيد رامب", false)).toBe("ar");
    expect(discoverLang("speed ramp", true)).toBe("ar");
  });

  it("keys them apart on this device (English is the default)", () => {
    const key = (req: DiscoverRequest) => discoverRequestKey(config, req);
    expect(key({ q: "x", lang: "en" })).toBe(key({ q: "x" }));
    expect(key({ q: "x", lang: "ar" })).not.toBe(key({ q: "x" }));
    expect(key({ q: "x", editing: true })).not.toBe(key({ q: "x" }));
  });
});

describe("parseDiscoverAnswer", () => {
  it("reads the producer's quality marker without inventing it for legacy or malformed replies", () => {
    expect(parseDiscoverAnswer(answer([]))?.qualityVersion).toBe(DISCOVER_QUALITY_VERSION);
    for (const qualityVersion of [undefined, "7", -1, 7.5, null]) {
      expect(
        parseDiscoverAnswer({ ...answer([]), qualityVersion })?.qualityVersion,
      ).toBeUndefined();
    }
  });
  it("keeps well-formed items and drops broken ones", () => {
    const raw = answer([item({}), { ...item({}), url: 7 } as unknown as DiscoverItem]);
    expect(parseDiscoverAnswer(raw)?.items).toHaveLength(1);
    expect(parseDiscoverAnswer({ nope: true })).toBeNull();
  });

  it("keeps the outside-category mark only when it is true", () => {
    const parsed = parseDiscoverAnswer(
      answer([
        item({ outsideCategory: true }),
        { ...item({}), outsideCategory: "yes" } as unknown as DiscoverItem,
      ]),
    );
    expect(parsed?.items.map((i) => i.outsideCategory)).toEqual([true, undefined]);
  });

  it("checks the nested fields: no answer without its label, broken parts dropped or zeroed", () => {
    const a = answer([item({})]);
    expect(parseDiscoverAnswer({ ...a, understood: { ...a.understood, label: null } })).toBeNull();
    const flash = { termId: "camera-flash", label: { ar: "فلاش الكاميرا", en: "camera flash" } };
    const parsed = parseDiscoverAnswer({
      ...a,
      understood: { label: a.understood.label, exact: "yes" },
      alternatives: [
        { exact: true },
        flash,
        { termId: "x" },
        { termId: "y", label: { ar: "ي" } },
        "no",
      ],
      platforms: {
        tt: { ok: true, retried: true },
        ig: { ok: false, error: "boom" },
        yt: { ok: false, error: "daily_cap" },
        fb: { ok: true },
      },
      cost: { tavily: -1, youtubeSearch: "3" },
    });
    expect(parsed?.understood).toEqual({ label: a.understood.label, exact: false });
    expect(parsed?.alternatives).toEqual([{ exact: true }, flash]);
    expect(parsed?.platforms).toEqual({
      tt: { ok: true, retried: true },
      yt: { ok: false, error: "daily_cap" },
    });
    expect(parsed?.cost).toEqual({ tavily: 0, youtubeSearch: 0 });
  });

  it("reads the Worker's complete flag; an older Worker's answer is complete when every platform answered or has no key", () => {
    const old = {
      ...answer([item({})], {
        platforms: { tt: { ok: true }, yt: { ok: false, error: "not_configured" } },
      }),
      complete: undefined,
    };
    expect(parseDiscoverAnswer(old)?.complete).toBe(true);
    const failed = { ...old, platforms: { ig: { ok: false, error: "upstream" } } };
    expect(parseDiscoverAnswer(failed)?.complete).toBe(false);
    expect(parseDiscoverAnswer({ ...old, complete: false })?.complete).toBe(false);
    expect(parseDiscoverAnswer({ ...old, complete: "yes" })?.complete).toBe(false);
  });
});

describe("discoverSearch", () => {
  beforeEach(() => {
    clearDiscoverCache(null);
  });

  it("rejects an older Worker's silent keyword fallback for an AI request", async () => {
    const storage = memoryStorage();
    const result = await discoverSearch(
      config,
      { q: "coffee match cuts", mode: "ai" },
      {
        storage,
        fetchImpl: replying(answer([item({})])),
      },
    );
    expect(result).toEqual({ ok: false, error: { type: "ai_unavailable" } });
    expect(keptKeys(storage)).toEqual([]);
  });

  it("does not reuse a keyword answer accidentally stored under an AI cache key", async () => {
    const storage = memoryStorage();
    const req = { q: "coffee match cuts", mode: "ai" as const };
    storage.setItem(
      DISCOVER_CACHE_KEY,
      JSON.stringify({
        [discoverRequestKey(config, req)]: { at: Date.now(), answer: answer([item({})]) },
      }),
    );
    const fetchImpl = replying(answer([item({})]));
    expect(await discoverSearch(config, req, { storage, fetchImpl })).toEqual({
      ok: false,
      error: { type: "ai_unavailable" },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("asks once, caches a complete answer, and serves it from the cache", async () => {
    const storage = memoryStorage();
    const fetchImpl = replying(answer([item({})]));
    const first = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    const second = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.answer.cached).toBe(true);
    // A cache hit spent nothing; the first answer keeps what it cost.
    expect(second.ok && second.answer.cost).toEqual({ tavily: 0, youtubeSearch: 0 });
    expect(first.ok && first.answer.cost).toEqual({ tavily: 6, youtubeSearch: 3 });
    // A peek serves that same kept answer (one object: safe to read during a render).
    expect(peekDiscover(config, { q: "flash" })).toBe(second.ok ? second.answer : undefined);
    // A reload: the memory is gone, the device's storage still has it.
    clearDiscoverCache(null);
    const third = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(third.ok && third.answer.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://w.example/discover");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ q: "flash" });
  });

  it("does not keep an answer the Worker calls incomplete", async () => {
    const storage = memoryStorage();
    // Every platform answered, but one of Instagram's queries did not: the Worker says so.
    const body = answer([item({})], {
      platforms: { tt: { ok: true }, ig: { ok: true } },
      complete: false,
    });
    const fetchImpl = replying(body);
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([undefined, 6, 8])(
    "a Worker quality version %s stays visible without poisoning the new cache",
    async (qualityVersion) => {
      const storage = memoryStorage();
      const req = { q: "car edit" };
      const old = answer([item({ title: "Legacy category result" })], { qualityVersion });
      const upgraded = answer([item({ title: "Car rotoscoping tutorial" })]);
      const fetchImpl = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(JSON.stringify(old)))
        .mockResolvedValueOnce(new Response(JSON.stringify(upgraded)));
      const first = await discoverSearch(config, req, { fetchImpl, storage });
      expect(first.ok && first.answer.items[0].title).toBe("Legacy category result");
      expect(keptKeys(storage)).toEqual([]);
      expect(peekDiscover(config, req)).toBeUndefined();
      const next = await discoverSearch(config, req, { fetchImpl, storage });
      expect(next.ok && next.answer.items[0].title).toBe("Car rotoscoping tutorial");
      expect(next.ok && next.answer.cached).toBe(false);
      clearDiscoverCache(null);
      const repeat = await discoverSearch(config, req, { fetchImpl, storage });
      expect(repeat.ok && repeat.answer.cached).toBe(true);
      expect(repeat.ok && repeat.answer.items[0].title).toBe("Car rotoscoping tutorial");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );

  it("does not keep an empty answer", async () => {
    const storage = memoryStorage();
    const fetchImpl = replying(answer([]));
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares one call between identical searches at once, but not a failed one afterwards", async () => {
    const storage = memoryStorage();
    const fetchImpl = replying({ error: "upstream" }, 502);
    const both = await Promise.all([
      discoverSearch(config, { q: "flash" }, { fetchImpl, storage }),
      discoverSearch(config, { q: "flash" }, { fetchImpl, storage }),
    ]);
    const failed = { ok: false, error: { type: "upstream", status: 502 } };
    expect(both).toEqual([failed, failed]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("turns a malformed answer into an upstream error", async () => {
    const storage = memoryStorage();
    for (const body of [{ nope: true }, { ...answer([item({})]), understood: { label: null } }]) {
      const r = await discoverSearch(
        config,
        { q: "flash" },
        { fetchImpl: replying(body), storage },
      );
      expect(r).toEqual({ ok: false, error: { type: "upstream" } });
    }
  });

  it("asks again when forced", async () => {
    const storage = memoryStorage();
    const fetchImpl = replying(answer([item({})]));
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    const forced = await discoverSearch(
      config,
      { q: "flash" },
      { fetchImpl, storage, force: true },
    );
    expect(forced.ok && forced.answer.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("forgets an answer after 24 hours", async () => {
    const storage = memoryStorage();
    const fetchImpl = replying(answer([item({})]));
    let t = 1_000_000;
    const now = () => t;
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage, now });
    t += DISCOVER_CACHE_TTL_MS - 1;
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage, now });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    t += 1;
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage, now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("subscription-backed Discover search", () => {
  const selection: AiSelection = {
    provider: "chatgpt",
    model: "test-model",
    effort: "high",
    accountId: "account-a",
  };
  const request: DiscoverRequest = { q: "coffee match cuts", mode: "ai", subscription: selection };
  const localPlan = {
    provider: selection.provider,
    model: selection.model,
    effort: selection.effort,
    plan: { summary: { ar: "قهوة", en: "Coffee" } },
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const resultFor = (selected: AiSelection) =>
    answer([item({})], {
      understood: {
        label: { ar: "قهوة", en: "Coffee" },
        exact: false,
        ai: true,
        provider: selected.provider,
        model: selected.model,
        ...(selected.effort ? { effort: selected.effort } : {}),
      },
    });
  beforeEach(() => clearDiscoverCache(null));

  it("checks Worker capability first, plans locally without the Scout token, then sends only the validated envelope", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith("/health")) return json({ ok: true, discoverSubscriptions: true });
      if (url === "/api/local-ai/plan") return json(localPlan);
      return json(resultFor(selection));
    });
    const req = {
      ...request,
      genreQuery: { en: "coffee edit" },
      program: "DaVinci Resolve",
      timeRange: "week" as const,
    };
    expect((await discoverSearch(config, req, { fetchImpl, storage: null })).ok).toBe(true);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://w.example/health",
      "/api/local-ai/plan",
      "https://w.example/discover",
    ]);
    const local = fetchImpl.mock.calls[1][1];
    expect(new Headers(local?.headers).has("Authorization")).toBe(false);
    expect(JSON.parse(String(local?.body))).toEqual({
      ...selection,
      request: { q: req.q, genreQuery: req.genreQuery, program: req.program },
    });
    const external = fetchImpl.mock.calls[2][1];
    expect(new Headers(external?.headers).get("Authorization")).toBe("Bearer t");
    expect(JSON.parse(String(external?.body))).toEqual({
      q: req.q,
      mode: "ai",
      genreQuery: req.genreQuery,
      program: req.program,
      timeRange: "week",
      aiPlan: localPlan,
    });
    expect(String(external?.body)).not.toContain("account-a");
    expect(String(external?.body)).not.toContain("subscription");
  });

  it.each([{}, { discoverSubscriptions: false }, { discoverSubscriptions: "true" }])(
    "does not spend inference on an older or disabled Worker: %j",
    async (capability) => {
      const fetchImpl = vi.fn<typeof fetch>(async () => json(capability));
      expect(await discoverSearch(config, request, { fetchImpl, storage: null })).toEqual({
        ok: false,
        error: { type: "subscription_worker_upgrade" },
      });
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(fetchImpl.mock.calls[0][0]).toBe("https://w.example/health");
    },
  );

  it("propagates Worker auth failure before planning", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ error: "unauthorized" }, 401));
    expect(await discoverSearch(config, request, { fetchImpl, storage: null })).toEqual({
      ok: false,
      error: { type: "auth", status: 401 },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    { ...localPlan, provider: "claude" },
    { ...localPlan, model: "downgraded-model" },
    { ...localPlan, effort: "low" },
  ])("rejects a local planner mismatch before contacting retrieval: %j", async (reply) => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/health") ? json({ discoverSubscriptions: true }) : json(reply),
    );
    expect(await discoverSearch(config, request, { fetchImpl, storage: null })).toEqual({
      ok: false,
      error: { type: "subscription_failed" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith("/discover"))).toBe(false);
  });

  it.each(["provider", "model", "effort"] as const)(
    "rejects a Worker %s mismatch and does not cache or downgrade it",
    async (field) => {
      const storage = memoryStorage();
      const mismatched = resultFor(selection);
      Object.assign(mismatched.understood, {
        [field]: field === "provider" ? "claude" : "different",
      });
      const fetchImpl = vi.fn<typeof fetch>(async (url) =>
        String(url).endsWith("/health")
          ? json({ discoverSubscriptions: true })
          : url === "/api/local-ai/plan"
            ? json(localPlan)
            : json(mismatched),
      );
      expect(await discoverSearch(config, request, { fetchImpl, storage })).toEqual({
        ok: false,
        error: { type: "subscription_worker_upgrade" },
      });
      expect(keptKeys(storage)).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    },
  );

  it("keeps built-in, provider, model, effort and account caches separate; identical repeats cost nothing", async () => {
    const storage = memoryStorage();
    const selections: AiSelection[] = [
      selection,
      { ...selection, provider: "claude" },
      { ...selection, model: "other-model" },
      { ...selection, effort: "max" },
      { ...selection, accountId: "account-b" },
    ];
    const requests = selections.map((subscription) => ({ ...request, subscription }));
    expect(
      new Set(
        [...requests, { ...request, subscription: undefined }, { q: request.q }].map((req) =>
          discoverRequestKey(config, req),
        ),
      ).size,
    ).toBe(7);
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).endsWith("/health")) return json({ discoverSubscriptions: true });
      const body = JSON.parse(String(init?.body));
      if (url === "/api/local-ai/plan")
        return json({
          provider: body.provider,
          model: body.model,
          effort: body.effort,
          plan: localPlan.plan,
        });
      return json(resultFor(body.aiPlan));
    });
    for (const req of requests) {
      expect((await discoverSearch(config, req, { fetchImpl, storage })).ok).toBe(true);
      const repeat = await discoverSearch(config, req, { fetchImpl, storage });
      expect(repeat.ok && repeat.answer.cached).toBe(true);
      expect(repeat.ok && repeat.answer.cost).toEqual({ tavily: 0, youtubeSearch: 0 });
    }
    expect(fetchImpl).toHaveBeenCalledTimes(15);
    expect(keptKeys(storage)).toHaveLength(5);
  });

  it("does not trust cached built-in output under a subscription key", async () => {
    const storage = memoryStorage();
    storage.setItem(
      DISCOVER_CACHE_KEY,
      JSON.stringify({
        [discoverRequestKey(config, request)]: {
          at: Date.now(),
          answer: answer([item({})], {
            understood: { label: { ar: "قهوة", en: "Coffee" }, exact: false, ai: true },
          }),
        },
      }),
    );
    const fetchImpl = vi.fn<typeof fetch>(async () => json({ discoverSubscriptions: false }));
    expect(await discoverSearch(config, request, { fetchImpl, storage })).toEqual({
      ok: false,
      error: { type: "subscription_worker_upgrade" },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns subscription exhaustion without issuing a fallback search", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/health")
        ? json({ discoverSubscriptions: true })
        : json({ error: "usage_limit" }, 429),
    );
    expect(await discoverSearch(config, request, { fetchImpl, storage: null })).toEqual({
      ok: false,
      error: { type: "subscription_limit" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("the device's storage", () => {
  beforeEach(() => {
    clearDiscoverCache(null);
  });

  it("skips entries of another version or with a broken answer, and drops them on the next write", async () => {
    const storage = memoryStorage();
    const key = discoverRequestKey(config, { q: "flash" });
    const older = key.replace(`v${DISCOVER_CACHE_VERSION}|`, "v1|");
    const entry = { at: Date.now(), answer: answer([item({})]) };
    const broken = { ...entry, answer: { nope: true } };
    storage.setItem(DISCOVER_CACHE_KEY, JSON.stringify({ [older]: entry, [key]: broken }));
    const fetchImpl = replying(answer([item({})]));
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(keptKeys(storage)).toEqual([key]);
  });
  it.each([undefined, 6, 8])(
    "ignores a predeployment reply marked %s even under the current frontend key",
    async (qualityVersion) => {
      const storage = memoryStorage();
      const req = { q: "coffee edit" };
      const key = discoverRequestKey(config, req);
      storage.setItem(
        DISCOVER_CACHE_KEY,
        JSON.stringify({
          [key]: {
            at: Date.now(),
            answer: answer([item({ title: "Legacy coffee deal" })], {
              qualityVersion,
              cached: true,
            }),
          },
        }),
      );
      const fetchImpl = replying(answer([item({ title: "Coffee macro closeup tutorial" })]));
      const result = await discoverSearch(config, req, { fetchImpl, storage });
      expect(result.ok && result.answer.items[0].title).toBe("Coffee macro closeup tutorial");
      expect(result.ok && result.answer.cached).toBe(false);
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(JSON.parse(storage.getItem(DISCOVER_CACHE_KEY)!)[key].answer.qualityVersion).toBe(
        DISCOVER_QUALITY_VERSION,
      );
    },
  );

  it("is read once, not on every miss", async () => {
    const storage = memoryStorage();
    const getItem = vi.spyOn(storage, "getItem");
    const fetchImpl = replying(answer([item({})]));
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    await discoverSearch(config, { q: "zoom" }, { fetchImpl, storage });
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it(`keeps the ${DISCOVER_CACHE_MAX} newest answers`, async () => {
    const storage = memoryStorage();
    const fetchImpl = replying(answer([item({})]));
    let t = 0;
    const now = () => ++t;
    for (let i = 0; i <= DISCOVER_CACHE_MAX; i++) {
      await discoverSearch(config, { q: `topic ${i}` }, { fetchImpl, storage, now });
    }
    const kept = keptKeys(storage);
    expect(kept).toHaveLength(DISCOVER_CACHE_MAX);
    expect(kept).not.toContain(discoverRequestKey(config, { q: "topic 0" }));
  });

  it("keeps the newest answers within its share of the quota", async () => {
    const storage = memoryStorage();
    const big = answer([item({ snippet: "x".repeat(DISCOVER_CACHE_BUDGET * 0.4) })]);
    const fetchImpl = replying(big);
    let t = 0;
    const now = () => ++t;
    for (const q of ["one", "two", "three"]) {
      await discoverSearch(config, { q }, { fetchImpl, storage, now });
    }
    expect(keptKeys(storage)).toEqual(
      ["three", "two"].map((q) => discoverRequestKey(config, { q })),
    );
    expect((storage.getItem(DISCOVER_CACHE_KEY) ?? "").length).toBeLessThanOrEqual(
      DISCOVER_CACHE_BUDGET,
    );
  });

  it("still answers when the storage refuses the write, and gives its room back", async () => {
    const storage = memoryStorage();
    storage.setItem(DISCOVER_CACHE_KEY, "{}");
    storage.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const fetchImpl = replying(answer([item({})]));
    const r = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(r.ok).toBe(true);
    expect(storage.getItem(DISCOVER_CACHE_KEY)).toBeNull();
    // This session's memory still serves it.
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("discoverUsage", () => {
  it("asks the upgraded Worker to bypass usage caches while preserving unknown freshness on old replies", async () => {
    const usage = {
      tavily: { used: 947, limit: 1000 },
      youtube: { usedToday: 26, cap: 66 },
      connector: { usedToday: 0, cap: 60 },
    };
    const fetchImpl = replying(usage);
    expect(await discoverUsage(config, { fetchImpl, refresh: true })).toEqual({ ok: true, usage });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://w.example/discover/usage?refresh=1");
    expect(fetchImpl.mock.calls[0][1]?.cache).toBe("no-store");
    expect(usage.tavily).not.toHaveProperty("observedAt");
    expect(usage.tavily).not.toHaveProperty("cached");
  });
  it("reads the Worker's usage, and calls a malformed one upstream", async () => {
    const usage = {
      tavily: { used: 412, limit: 1000, plan: "Researcher" },
      youtube: { usedToday: 9, cap: 70 },
      connector: { usedToday: 12, cap: 60 },
    };
    const fetchImpl = replying(usage);
    expect(await discoverUsage(config, { fetchImpl })).toEqual({ ok: true, usage });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://w.example/discover/usage");
    expect(await discoverUsage(config, { fetchImpl: replying({ tavily: 1 }) })).toEqual({
      ok: false,
      error: { type: "upstream" },
    });
  });
});

describe("views over an answer", () => {
  const items = [
    item({ section: "example", stats: { likes: 10 } }),
    item({ section: "tutorial", platform: "yt", stats: { views: 5000 }, published: "2026-09-01" }),
    item({ section: "example", platform: "ig", offTopic: true }),
    item({ section: "tutorial", lang: "ar", title: "شرح فلاش" }),
  ];
  const a = answer(items);

  it("counts the posts per tab, hidden ones apart", () => {
    expect(tabCounts(a, false)).toEqual({ all: 3, tt: 2, ig: 0, yt: 1 });
    expect(tabCounts(a, true)).toEqual({ all: 4, tt: 2, ig: 1, yt: 1 });
    expect(hiddenCount(a, "all")).toBe(1);
    expect(hiddenCount(a, "tt")).toBe(0);
  });

  it("fills a section for a tab, popular first or Arabic first when asked", () => {
    const opts = {
      tab: "all" as const,
      showHidden: false,
      sort: "relevance" as const,
      arFirst: false,
    };
    expect(sectionItems(a, "tutorial", opts).map((i) => i.platform)).toEqual(["tt", "yt"]);
    expect(sectionItems(a, "tutorial", { ...opts, arFirst: true })[0].lang).toBe("ar");
    expect(sectionItems(a, "example", { ...opts, tab: "ig", showHidden: true })).toHaveLength(1);
  });

  it("sorts a section by the numbers when asked (posts without numbers last, in the sources' order)", () => {
    const low = item({ stats: { likes: 1 } });
    const none = item({});
    const high = item({ platform: "ig", stats: { likes: 50 } });
    const s = answer([low, none, high]);
    const opts = { tab: "all" as const, showHidden: false, arFirst: false };
    expect(sectionItems(s, "example", { ...opts, sort: "relevance" })).toEqual([low, none, high]);
    expect(sectionItems(s, "example", { ...opts, sort: "popular" })).toEqual([low, high, none]);
  });

  // The owner (2026-10-07): "Instagram and tiktok first".
  it("keeps platform preference for relevance but interleaves platform metrics for popularity", () => {
    const yt = item({ platform: "yt", stats: { views: 9000 } });
    const tt = item({ stats: { likes: 5 } });
    const ig = item({ platform: "ig", stats: { likes: 50 } });
    const tt2 = item({});
    const s = answer([yt, tt, ig, tt2]);
    const opts = { tab: "all" as const, showHidden: false, arFirst: false };
    expect(sectionItems(s, "example", { ...opts, sort: "relevance" })).toEqual([tt, ig, tt2, yt]);
    expect(sectionItems(s, "example", { ...opts, sort: "popular" })).toEqual([yt, tt, ig, tt2]);
    expect(sectionItems(s, "example", { ...opts, tab: "yt", sort: "relevance" })).toEqual([yt]);
  });

  it("does not promote tiny, old, lesson, or hidden indexed hits into recent popularity", () => {
    expect(popularItems(a, { tab: "all", showHidden: false })).toEqual([]);
    expect(popularItems(a, { tab: "all", showHidden: true })).toEqual([]);
    const current = item({
      platform: "ig",
      url: "https://www.instagram.com/p/current/",
      title: "Anime match cut edit",
      published: new Date().toISOString(),
      evidence: {
        source: "instagram-public-embed",
        observedAt: new Date().toISOString(),
        likes: 12000,
        caption: "Anime match cut edit",
      },
    });
    expect(popularItems(answer([current, ...items]), { tab: "ig", showHidden: true })).toHaveLength(
      1,
    );
  });

  it("lists creators of the tab", () => {
    expect(creatorsOn(a, "tt")).toHaveLength(1);
    expect(creatorsOn(a, "yt")).toHaveLength(0);
  });
});

describe("picks", () => {
  it("parses the Worker's picks and finds a topic's", () => {
    const picks = parsePicks({
      picks: [
        {
          topicKey: "flash-transition",
          topic: "flash",
          savedAt: "2026-10-03T09:00:00Z",
          items: [
            {
              url: "https://www.tiktok.com/@ed/video/1",
              platform: "tt",
              title: "clean flash",
              label: "example",
              note: "0:03",
              savedAt: "x",
            },
            { url: 5, platform: "tt", title: "broken", label: "example", savedAt: "x" },
          ],
        },
        { nope: true },
      ],
    });
    expect(picks).toHaveLength(1);
    expect(picks[0].items).toHaveLength(1);
    expect(picksFor(picks, "flash-transition")?.topic).toBe("flash");
    expect(picksFor(picks, "speed-ramp")).toBeUndefined();
  });

  it("keeps only https posts, and a picture only when it is https (Claude picked them off the web)", () => {
    const yt = { platform: "yt", title: "flash tutorial", label: "tutorial", savedAt: "x" };
    const picks = parsePicks({
      picks: [
        {
          topicKey: "flash-transition",
          topic: "flash",
          savedAt: "x",
          items: [
            {
              ...yt,
              url: "https://www.youtube.com/watch?v=a",
              thumb: "https://i.ytimg.com/vi/a/hqdefault.jpg",
            },
            {
              ...yt,
              url: "https://www.youtube.com/watch?v=b",
              thumb: "http://i.ytimg.com/vi/b/hqdefault.jpg",
            },
            { ...yt, url: "http://www.youtube.com/watch?v=c" },
          ],
        },
        // Its only post is not a link to open: the topic goes with it.
        {
          topicKey: "zoom",
          topic: "zoom",
          savedAt: "x",
          items: [{ ...yt, url: "javascript:alert(1)" }],
        },
      ],
    });
    expect(picks.map((t) => t.topicKey)).toEqual(["flash-transition"]);
    expect(picks[0].items.map((p) => [p.url, p.thumb])).toEqual([
      ["https://www.youtube.com/watch?v=a", "https://i.ytimg.com/vi/a/hqdefault.jpg"],
      ["https://www.youtube.com/watch?v=b", undefined],
    ]);
  });
});
