import { describe, expect, it, vi } from "vitest";
import {
  clearDiscoverCache,
  creatorsOn,
  discoverRequestFrom,
  discoverSearch,
  hiddenCount,
  parseDiscoverAnswer,
  popularItems,
  sectionItems,
  tabCounts,
  type DiscoverAnswer,
  type DiscoverItem,
} from "./discover";

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

  it("searches the genre alone when nothing is typed, and passes the owner's pick", () => {
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
      genreQuery: { ar: "ايديت سيارات", en: "car edit" },
      term: "camera-flash",
    });
    expect(discoverRequestFrom({ base: "  ", recency: "any", length: "any" })).toBeNull();
  });
});

describe("parseDiscoverAnswer", () => {
  it("keeps well-formed items and drops broken ones", () => {
    const raw = answer([item({}), { ...item({}), url: 7 } as unknown as DiscoverItem]);
    expect(parseDiscoverAnswer(raw)?.items).toHaveLength(1);
    expect(parseDiscoverAnswer({ nope: true })).toBeNull();
  });
});

describe("discoverSearch", () => {
  it("asks once, caches an answer where every platform answered, and serves it from the cache", async () => {
    clearDiscoverCache(null);
    const storage = memoryStorage();
    const body = answer([item({})]);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    const first = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    const second = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.answer.cached).toBe(true);
    // A cache hit spent nothing; the first answer keeps what it cost.
    expect(second.ok && second.answer.cost).toEqual({ tavily: 0, youtubeSearch: 0 });
    expect(first.ok && first.answer.cost).toEqual({ tavily: 6, youtubeSearch: 3 });
    // A reload: the memory is gone, the device's storage still has it.
    clearDiscoverCache(null);
    const third = await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(third.ok && third.answer.cached).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://w.example/discover");
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ q: "flash" });
  });

  it("does not keep an answer with a failed platform", async () => {
    clearDiscoverCache(null);
    const storage = memoryStorage();
    const body = answer([item({})], {
      platforms: { tt: { ok: true }, ig: { ok: false, error: "upstream" } },
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps an answer where a platform has no key (not_configured)", async () => {
    clearDiscoverCache(null);
    const storage = memoryStorage();
    const body = answer([item({})], {
      platforms: { tt: { ok: true }, yt: { ok: false, error: "not_configured" } },
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body)));
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not keep an empty answer", async () => {
    clearDiscoverCache(null);
    const storage = memoryStorage();
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(answer([]))));
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    await discoverSearch(config, { q: "flash" }, { fetchImpl, storage });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
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
