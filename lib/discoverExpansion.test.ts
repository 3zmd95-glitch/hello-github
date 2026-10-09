import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  categoryExpansionQuery,
  discoverSourceDiagnostics,
  expandCategory,
} from "./discoverExpansion";
import type { Genre } from "./domain";
import { GENRES } from "@/data/genres";
import {
  discoverSearch,
  type DiscoverAnswer,
  type DiscoverItem,
  type DiscoverPlatformError,
} from "./discover";
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";

vi.mock("./discover", () => ({ discoverSearch: vi.fn() }));
beforeEach(() => {
  vi.mocked(discoverSearch).mockReset();
  vi.mocked(discoverSearch).mockResolvedValue({ ok: false, error: { type: "network" } });
});

describe("truthful expansion provider diagnostics", () => {
  const item = (id: string, platform: "ig" | "yt" = "ig"): DiscoverItem => ({
    platform,
    url:
      platform === "ig"
        ? `https://www.instagram.com/reel/${id}/`
        : `https://www.youtube.com/watch?v=${id}`,
    handle: "@editor",
    title: "Anime edit",
    snippet: "",
    lang: "en",
    section: "example",
  });
  const answer = (over: Partial<DiscoverAnswer> = {}): DiscoverAnswer => ({
    topicKey: "anime",
    understood: { label: { en: "Anime", ar: "أنمي" }, exact: true },
    alternatives: [],
    creators: [],
    items: [],
    platforms: {},
    cost: { tavily: 0, youtubeSearch: 0 },
    cached: false,
    complete: false,
    ...over,
  });
  it.each<DiscoverPlatformError>(["quota", "auth", "upstream", "daily_cap", "not_configured"])(
    "carries explicit %s failures without erasing valid posts from another platform",
    (error) => {
      const response = answer({
        items: [item("ytpost", "yt")],
        platforms: { ig: { ok: false, error }, yt: { ok: true } },
      });
      expect(discoverSourceDiagnostics(response)).toEqual([
        { platform: "ig", state: "error", error, returned: 0, cached: false },
        { platform: "tt", state: "unknown", returned: 0, cached: false },
        { platform: "yt", state: "found", returned: 1, cached: false },
      ]);
      expect(response.items).toHaveLength(1);
    },
  );
  it("distinguishes partial results, a successful empty answer, and an omitted status", () => {
    const first = item("first");
    const duplicate = {
      ...first,
      url: "https://www.instagram.com/p/first/?utm_source=search",
      offTopic: true as const,
    };
    expect(
      discoverSourceDiagnostics(
        answer({
          items: [first, duplicate],
          platforms: { ig: { ok: true, partial: "quota" }, tt: { ok: true } },
          cached: true,
        }),
      ),
    ).toEqual([
      { platform: "ig", state: "partial", error: "quota", returned: 1, cached: true },
      { platform: "tt", state: "empty", returned: 0, cached: true },
      { platform: "yt", state: "unknown", returned: 0, cached: true },
    ]);
  });
  it("reports only attempted platforms and never infers quota from cost or an unchanged counter", () => {
    const response = answer({ platforms: { ig: { ok: true } } });
    expect(discoverSourceDiagnostics(response, ["ig", "ig"])).toEqual([
      { platform: "ig", state: "empty", returned: 0, cached: false },
    ]);
    expect(
      discoverSourceDiagnostics(answer({ items: [item("one")], cached: true }), ["ig"]),
    ).toEqual([{ platform: "ig", state: "unknown", returned: 1, cached: true }]);
  });
});
const genre: Genre = {
  id: "anime",
  emoji: "",
  name: { en: "Anime", ar: "أنمي" },
  queries: { en: ["anime edit"], ar: ["ايديت أنمي"] },
  hashtags: [],
};
describe("bounded category discovery expansion", () => {
  it.each(GENRES)(
    "offers distinct discovery wording beyond $id's initial query and retry",
    (genre) => {
      const qs = [0, 1, 2].map((round) => categoryExpansionQuery(genre, round));
      expect(new Set(qs).size).toBe(3);
      const profile = CATEGORY_PROFILES[genre.id];
      const alreadyAsked = [
        profile.examples.en,
        profile.retryExamples.en,
        profile.tutorials.en,
        profile.retryTutorials.en,
      ];
      for (const query of qs) {
        expect(query).toBeTruthy();
        expect(alreadyAsked).not.toContain(query);
        expect(query).not.toMatch(/202\d/);
      }
      expect(categoryExpansionQuery(genre, 3)).toBeNull();
    },
  );

  it("uses a broad AMV candidate query without asserting a named effect or popularity", () => {
    expect(categoryExpansionQuery(genre, 0)).toBe("anime AMV edit");
    expect(categoryExpansionQuery(genre, 0)).not.toMatch(/beat sync|trending|viral/);
  });

  it("sends a real month filter through the existing cached request path without force or extra queries", async () => {
    const config = { url: "https://scout.test", token: "test" };
    await expandCategory(config, genre, { round: 0, platform: "ig" });
    expect(discoverSearch).toHaveBeenCalledOnce();
    const [actualConfig, request, options] = vi.mocked(discoverSearch).mock.calls[0];
    expect(actualConfig).toBe(config);
    expect(request).toEqual({
      q: "anime AMV edit",
      exact: true,
      lang: "en",
      timeRange: "month",
      platforms: ["ig"],
    });
    expect(options).not.toHaveProperty("force");
    expect(request).not.toHaveProperty("queries");
  });

  it("cannot make an unbounded fourth provider request", async () => {
    expect(
      await expandCategory({ url: "https://invalid.test", token: "" }, genre, { round: 3 }),
    ).toEqual({ ok: false, error: { type: "upstream" } });
    expect(discoverSearch).not.toHaveBeenCalled();
  });
});
