import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyYoutubeEvidence,
  fetchYoutubeEvidence,
  resetYoutubeEvidenceCache,
} from "./youtubeEvidence";
import type { DiscoverItem } from "./discover";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const ID = "dyyF6YHbW6s";
const OTHER = "uL3SWSm97-I";
const item = (id = ID): DiscoverItem => ({
  platform: "yt",
  url: `https://www.youtube.com/watch?v=${id}`,
  title: "Indexed title",
  snippet: "Indexed description",
  handle: "index author",
  stats: { views: 9000000 },
  lang: "en",
  section: "example",
});
const apiVideo = (id = ID) => ({
  id,
  snippet: {
    title: "Anime beat sync edit",
    description: "My editing process",
    channelTitle: "Actual channel",
    channelId: "UCabcdefghijklmnopqrstuv",
    publishedAt: "2026-10-08T10:00:00Z",
  },
  statistics: { viewCount: "27800", likeCount: "1234" },
  status: { privacyStatus: "public", uploadStatus: "processed" },
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(resetYoutubeEvidenceCache);

describe("official YouTube metadata grounding with an existing key", () => {
  it("requests one official bounded batch and binds source fields to the returned exact ID", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ items: [apiVideo(), apiVideo(OTHER)] }),
    );
    const sources = await fetchYoutubeEvidence(
      [item(), { ...item(), url: `https://youtu.be/${ID}?t=20` }, item(OTHER)],
      "test-key",
      { fetch, now: () => NOW },
    );
    expect(fetch).toHaveBeenCalledOnce();
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
    expect(url.searchParams.get("part")).toBe("snippet,statistics,status");
    expect(url.searchParams.get("id")).toBe(`${ID},${OTHER}`);
    expect(fetch.mock.calls[0][1]?.method).toBe("GET");
    expect(sources[item().url]).toMatchObject({
      title: "Anime beat sync edit",
      author: "Actual channel",
      profile: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
      evidence: {
        source: "youtube-api",
        observedAt: new Date(NOW).toISOString(),
        caption: "Anime beat sync edit My editing process",
        views: 27800,
        likes: 1234,
        published: "2026-10-08T10:00:00.000Z",
      },
    });
    expect(JSON.stringify(sources)).not.toContain("test-key");
  });

  it("makes no request without a key or for unsupported or spoofed video URLs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await fetchYoutubeEvidence([item()], undefined, { fetch })).toEqual({});
    expect(
      await fetchYoutubeEvidence(
        [
          { platform: "ig", url: "https://www.instagram.com/p/ABC" },
          { platform: "yt", url: `https://evil.test/watch?v=${ID}` },
          { platform: "yt", url: "https://www.youtube.com/watch?v=short" },
        ],
        "test",
        { fetch },
      ),
    ).toEqual({});
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches at most fifty new IDs in one request and does not auto-paginate", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ items: [] }));
    await fetchYoutubeEvidence(
      Array.from({ length: 80 }, (_, i) => item(String(i).padStart(11, "0"))),
      "test",
      { fetch, now: () => NOW },
    );
    expect(fetch).toHaveBeenCalledOnce();
    expect(new URL(String(fetch.mock.calls[0][0])).searchParams.get("id")?.split(",")).toHaveLength(
      50,
    );
  });

  it("reuses six-hour memory evidence without making an old count look newly observed, and isolates keys", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ items: [apiVideo()] }));
    const first = await fetchYoutubeEvidence([item()], "one", { fetch, now: () => NOW });
    const cached = await fetchYoutubeEvidence([item()], "one", { fetch, now: () => NOW + 60_000 });
    expect(cached).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchYoutubeEvidence([item()], "two", { fetch, now: () => NOW + 60_000 });
    expect(fetch).toHaveBeenCalledTimes(2);
    const refreshed = await fetchYoutubeEvidence([item()], "one", {
      fetch,
      now: () => NOW + 6 * 60 * 60_000,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(refreshed[item().url].evidence.observedAt).not.toBe(
      first[item().url].evidence.observedAt,
    );
  });

  it("leaves omitted and unrelated IDs unknown without declaring them unavailable", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ items: [apiVideo(OTHER)] }));
    expect(await fetchYoutubeEvidence([item()], "test", { fetch, now: () => NOW })).toEqual({});
    expect(await fetchYoutubeEvidence([item()], "test", { fetch, now: () => NOW + 1000 })).toEqual(
      {},
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    await fetchYoutubeEvidence([item()], "test", { fetch, now: () => NOW + 15 * 60_000 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses an explicit API privacy/deletion state only when returned for the requested ID", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ items: [{ id: ID, status: { privacyStatus: "private" } }] }),
    );
    const sources = await fetchYoutubeEvidence([item()], "test", { fetch, now: () => NOW });
    expect(sources[item().url].evidence.availability).toBe("unavailable");
  });

  it("does not inherit indexed counts when API counts are hidden or invalid, or invent a future date", async () => {
    const raw = apiVideo();
    raw.statistics = { viewCount: "9007199254740992", likeCount: "-1" };
    raw.snippet.publishedAt = "2027-01-01T00:00:00Z";
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ items: [raw] }));
    const sources = await fetchYoutubeEvidence([item()], "test", { fetch, now: () => NOW });
    const applied = applyYoutubeEvidence(item(), sources[item().url]);
    expect(applied.stats).toBeUndefined();
    expect(applied.evidence?.published).toBeUndefined();
    expect(applied.title).toBe(raw.snippet.title);
    expect(applied.snippet).toBe(raw.snippet.description);
  });

  it("fails softly on refused, malformed or oversized responses without caching a fabricated source", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ error: "not authorized" }, 403))
      .mockResolvedValueOnce(json({ items: "wrong" }))
      .mockResolvedValueOnce(json({ items: [], extra: "x".repeat(1024 * 1024) }));
    for (let i = 0; i < 3; i++)
      expect(await fetchYoutubeEvidence([item()], "test", { fetch, now: () => NOW })).toEqual({});
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("honors cancellation even when an injected transport ignores its signal", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => undefined));
    const pending = fetchYoutubeEvidence([item()], "test", { fetch, signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({});
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("does not apply another post's source or roll back a newer source observation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ items: [apiVideo()] }));
    const sources = await fetchYoutubeEvidence([item()], "test", { fetch, now: () => NOW });
    const source = sources[item().url];
    expect(applyYoutubeEvidence(item(OTHER), source)).toEqual(item(OTHER));
    const enriched = applyYoutubeEvidence(item(), source);
    expect(applyYoutubeEvidence(enriched, source)).toBe(enriched);
    expect(
      applyYoutubeEvidence(enriched, {
        ...source,
        evidence: { ...source.evidence, observedAt: "2026-10-08T00:00:00Z", views: 1 },
      }),
    ).toBe(enriched);
    expect(
      applyYoutubeEvidence(item(), { ...source, url: `https://evil.test/watch?v=${ID}` }),
    ).toEqual(item());
  });
});
