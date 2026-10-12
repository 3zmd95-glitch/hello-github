import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Genre } from "./domain";
import { discoverRequestKey, discoverSearch, type DiscoverAnswer } from "./discover";
import { categoryRefillCost, categoryRefillRequest, refillCategory } from "./discoverRefill";

vi.mock("./discover", async (original) => ({
  ...(await original<typeof import("./discover")>()),
  discoverSearch: vi.fn(),
}));
const config = { url: "https://scout.test", token: "test" };
const genre: Genre = {
  id: "anime",
  emoji: "",
  name: { en: "Anime", ar: "أنمي" },
  queries: { en: ["anime edit"], ar: ["ايديت أنمي"] },
  hashtags: [],
};
beforeEach(() => {
  vi.mocked(discoverSearch).mockReset();
  vi.mocked(discoverSearch).mockResolvedValue({ ok: false, error: { type: "quota" } });
});

describe("explicit evergreen category refill", () => {
  it("preserves the original all-platform cache key and omits the monthly exact-search filter", () => {
    const request = categoryRefillRequest(genre);
    expect(request).toEqual({ q: "anime edit", genreQuery: { ar: "ايديت أنمي" }, lang: "en" });
    expect(discoverRequestKey(config, request!)).toBe(
      discoverRequestKey(config, {
        q: "anime edit",
        genreQuery: { ar: "ايديت أنمي" },
        lang: "en",
      }),
    );
    expect(request).not.toHaveProperty("timeRange");
    expect(request).not.toHaveProperty("exact");
    expect(request).not.toHaveProperty("platforms");
  });

  it("can scope a deliberate refill to one platform without changing the baseline topic", () => {
    expect(categoryRefillRequest(genre, "yt")).toEqual({
      q: "anime edit",
      genreQuery: { ar: "ايديت أنمي" },
      lang: "en",
      platforms: ["yt"],
    });
    expect(categoryRefillCost()).toEqual({ tavilyMax: 6, youtubeSearchMax: 2 });
    expect(categoryRefillCost("ig")).toEqual({ tavilyMax: 4, youtubeSearchMax: 0 });
    expect(categoryRefillCost("tt")).toEqual({ tavilyMax: 4, youtubeSearchMax: 0 });
    expect(categoryRefillCost("yt")).toEqual({ tavilyMax: 0, youtubeSearchMax: 2 });
  });

  it("always allows cache lookup and never retries a quota response", async () => {
    const controller = new AbortController();
    const unsafe = { platform: "yt" as const, signal: controller.signal, force: true };
    const result = await refillCategory(config, genre, unsafe);
    expect(result).toEqual({ ok: false, error: { type: "quota" } });
    expect(discoverSearch).toHaveBeenCalledOnce();
    expect(discoverSearch).toHaveBeenCalledWith(config, categoryRefillRequest(genre, "yt"), {
      signal: controller.signal,
      force: false,
    });
  });

  it("returns cached or partial platform outcomes unchanged instead of issuing fallback searches", async () => {
    const answer: DiscoverAnswer = {
      topicKey: "anime",
      understood: { label: { en: "Anime", ar: "أنمي" }, exact: false },
      alternatives: [],
      items: [],
      creators: [],
      platforms: { ig: { ok: false, error: "quota" }, yt: { ok: true } },
      cost: { tavily: 0, youtubeSearch: 0 },
      cached: true,
      complete: false,
    };
    vi.mocked(discoverSearch).mockResolvedValue({ ok: true, answer });
    expect(await refillCategory(config, genre)).toEqual({ ok: true, answer });
    expect(discoverSearch).toHaveBeenCalledOnce();
  });

  it("does not issue a request for a category with no searchable query", async () => {
    expect(await refillCategory(config, { ...genre, queries: { en: [], ar: [] } })).toEqual({
      ok: false,
      error: { type: "upstream" },
    });
    expect(discoverSearch).not.toHaveBeenCalled();
  });
});
