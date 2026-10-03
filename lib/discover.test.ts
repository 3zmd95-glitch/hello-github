import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoverCache,
  creatorsOn,
  DISCOVER_CACHE_BUDGET,
  DISCOVER_CACHE_KEY,
  DISCOVER_CACHE_MAX,
  DISCOVER_CACHE_TTL_MS,
  DISCOVER_CACHE_VERSION,
  discoverRequestFrom,
  discoverRequestKey,
  discoverSearch,
  discoverUsage,
  hiddenCount,
  parseDiscoverAnswer,
  peekDiscover,
  popularItems,
  sectionItems,
  tabCounts,
  type DiscoverAnswer,
  type DiscoverItem,
} from "./discover";
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

describe("parseDiscoverAnswer", () => {
  it("keeps well-formed items and drops broken ones", () => {
    const raw = answer([item({}), { ...item({}), url: 7 } as unknown as DiscoverItem]);
    expect(parseDiscoverAnswer(raw)?.items).toHaveLength(1);
    expect(parseDiscoverAnswer({ nope: true })).toBeNull();
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
    expect(sectionItems(a, "tutorial", opts).map((i) => i.platform)).toEqual(["yt", "tt"]);
    expect(sectionItems(a, "tutorial", { ...opts, arFirst: true })[0].lang).toBe("ar");
    expect(sectionItems(a, "example", { ...opts, tab: "ig", showHidden: true })).toHaveLength(1);
  });

  it("sorts a section by the numbers when asked (posts without numbers last, in the sources' order)", () => {
    const low = item({ stats: { likes: 1 } });
    const none = item({});
    const high = item({ platform: "yt", stats: { views: 50 } });
    const s = answer([low, none, high]);
    const opts = { tab: "all" as const, showHidden: false, arFirst: false };
    expect(sectionItems(s, "example", { ...opts, sort: "relevance" })).toEqual([low, none, high]);
    expect(sectionItems(s, "example", { ...opts, sort: "popular" })).toEqual([high, low, none]);
  });

  it("ranks Popular now by views, else likes x 10", () => {
    expect(popularItems(a, { tab: "all", showHidden: false }).map((i) => i.platform)).toEqual([
      "yt",
      "tt",
    ]);
  });

  it("lists creators of the tab", () => {
    expect(creatorsOn(a, "tt")).toHaveLength(1);
    expect(creatorsOn(a, "yt")).toHaveLength(0);
  });
});
