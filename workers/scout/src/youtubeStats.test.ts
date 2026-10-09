import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScoutResult } from "./normalize";
import { enrichYoutubeStats } from "./youtubeStats";

const ID = "abc123XYZ_0";
const NOW = new Date("2026-10-10T00:00:00Z");
const card = (): ScoutResult => ({
  platform: "yt",
  url: `https://www.youtube.com/watch?v=${ID}`,
  title: "Indexed fake speed-ramp tutorial",
  snippet: "Search boilerplate claims a recent editing lesson",
  handle: "Wrong indexed author",
  published: "2026-10-09T00:00:00Z",
  stats: { views: 99999999, likes: 999999 },
});
const native = {
  title: "Old travel soundtrack suggestions",
  description: "Photos from Pinterest. Music for the background.",
  channelTitle: "Actual source author",
  publishedAt: "2022-06-01T12:00:00Z",
};
const answer = (items: unknown[]) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ items }), {
        headers: { "Content-Type": "application/json" },
      }),
  );
afterEach(() => vi.useRealTimers());

describe("YouTube metadata provenance", () => {
  it("replaces indexed text/date with the exact video's native snippet in the same statistics call", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const source = card();
    const fetch = answer([
      { id: ID, snippet: native, statistics: { viewCount: "1250", likeCount: "5" } },
    ]);
    await enrichYoutubeStats([source], { YOUTUBE_API_KEY: "test-key" }, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.searchParams.get("part")).toBe("snippet,statistics");
    expect(url.searchParams.get("id")).toBe(ID);
    expect(source).toMatchObject({
      title: native.title,
      snippet: native.description,
      handle: native.channelTitle,
      published: "2022-06-01T12:00:00.000Z",
      stats: { views: 1250, likes: 5 },
      evidence: {
        source: "youtube-api",
        observedAt: NOW.toISOString(),
        caption: `${native.title}\n${native.description}`,
        author: native.channelTitle,
        published: "2022-06-01T12:00:00.000Z",
        views: 1250,
        likes: 5,
      },
    });
    expect(JSON.stringify(source)).not.toContain("Indexed fake");
    expect(JSON.stringify(source)).not.toContain("2026-10-09");
  });

  it.each([
    undefined,
    {},
    { ...native, title: null },
    { ...native, description: null },
    { ...native, channelTitle: "" },
  ])(
    "preserves counts independently without promoting an incomplete snippet: %j",
    async (snippet) => {
      const source = card();
      await enrichYoutubeStats(
        [source],
        { YOUTUBE_API_KEY: "test-key" },
        answer([{ id: ID, snippet, statistics: { viewCount: "15" } }]),
      );
      expect(source.stats).toEqual({ views: 15 });
      expect(source.evidence).toBeUndefined();
      expect(source.title).toBe(card().title);
    },
  );

  it.each([undefined, "not-a-date", "2099-01-01T00:00:00Z"])(
    "never substitutes an indexed recent date for missing or invalid native date: %s",
    async (publishedAt) => {
      const source = card();
      await enrichYoutubeStats(
        [source],
        { YOUTUBE_API_KEY: "test-key" },
        answer([{ id: ID, snippet: { ...native, publishedAt }, statistics: { viewCount: "15" } }]),
      );
      expect(source.published).toBeUndefined();
      expect(source.evidence?.published).toBeUndefined();
      expect(source.evidence?.caption).toContain(native.description);
    },
  );

  it("does not borrow another returned video's snippet or counts", async () => {
    const source = card();
    const original = structuredClone(source);
    await enrichYoutubeStats(
      [source],
      { YOUTUBE_API_KEY: "test-key" },
      answer([{ id: "unasked0000", snippet: native, statistics: { viewCount: "15" } }]),
    );
    expect(source).toEqual(original);
  });

  it("keeps an empty authentic description and missing native counts instead of indexed claims", async () => {
    const source = card();
    await enrichYoutubeStats(
      [source],
      { YOUTUBE_API_KEY: "test-key" },
      answer([{ id: ID, snippet: { ...native, description: "" }, statistics: {} }]),
    );
    expect(source.snippet).toBe("");
    expect(source.evidence?.caption).toBe(native.title);
    expect(source.stats).toBeUndefined();
    expect(source.evidence?.views).toBeUndefined();
  });

  it("bounds the native snapshot while preserving title/description separation", async () => {
    const source = card();
    const description = "A".repeat(6000);
    await enrichYoutubeStats(
      [source],
      { YOUTUBE_API_KEY: "test-key" },
      answer([{ id: ID, snippet: { ...native, description }, statistics: { likeCount: "0" } }]),
    );
    expect(source.evidence?.caption).toHaveLength(4000);
    expect(source.evidence?.caption).toBe(`${native.title}\n${description}`.slice(0, 4000));
    expect(source.snippet).toHaveLength(220);
    expect(source.evidence?.likes).toBe(0);
  });
});
