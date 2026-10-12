// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "./discover";
import {
  assessCategoryVisual,
  categoryVisualCandidates,
  categoryVisualCanContinue,
} from "./discoverVisualClient";
import type { DiscoverVisualRequest } from "./discoverVisual";

const item = (id: string, likes: number, direct = true, author = id): DiscoverItem => ({
  platform: "ig",
  url: `https://www.instagram.com/p/${id}/`,
  title: "#anime",
  snippet: "#anime",
  handle: author,
  lang: "en",
  section: "example",
  offTopic: true,
  stats: { likes },
  evidence: direct
    ? {
        source: "instagram-public-embed",
        observedAt: new Date().toISOString(),
        caption: "#anime",
        author,
        likes,
      }
    : undefined,
});
const selection = {
  provider: "chatgpt" as const,
  model: "chosen-model",
  effort: "ultra",
  accountId: "chosen-account",
};
const request: DiscoverVisualRequest = {
  ...selection,
  url: item("A", 2000).url,
  genreId: "anime",
  lang: "ar",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("category visual candidate selection", () => {
  it("prioritizes uncertain native craft before already described edits and skips native hard exclusions", () => {
    const described = item("described", 9000);
    described.evidence!.caption = "Anime typography edit with tracked text";
    const unknown = item("unknown", 800);
    const excluded = item("movie", 900000);
    excluded.evidence!.caption = "Full anime movie watch full episode";
    const indexed = { ...excluded, url: item("indexedMovie", 3000).url, evidence: undefined };
    expect(
      categoryVisualCandidates([described, unknown, excluded, indexed], "anime").map(
        (candidate) => candidate.url,
      ),
    ).toEqual([unknown.url, described.url, indexed.url]);
  });
  it("takes strong native candidates even when captions miss the editing, diversifies creators, then uses indexed leads", () => {
    const items = [
      item("indexed", 900000, false),
      item("one", 3000, true, "same"),
      item("repeat", 2500, true, "same"),
      item("two", 700),
      item("low", 5),
    ];
    expect(categoryVisualCandidates(items, "anime").map((candidate) => candidate.url)).toEqual([
      items[1].url,
      items[3].url,
      items[0].url,
      items[2].url,
    ]);
  });
  it("never resurrects native low counts or unavailable posts from an inflated indexed duplicate", () => {
    const low = item("low", 5);
    const gone = item("gone", 9000);
    gone.evidence!.availability = "unavailable";
    expect(
      categoryVisualCandidates(
        [item("low", 500000, false), low, gone, item("gone", 700000, false)],
        "anime",
      ),
    ).toEqual([]);
    const conflicting = item("metrics", 5);
    conflicting.evidence!.views = 800000;
    expect(categoryVisualCandidates([conflicting], "anime")).toEqual([]);
  });
  it("honors hides and Not useful, dedupes canonical links and refuses other platforms or arbitrary hosts", () => {
    const first = item("first", 1000);
    const second = item("second", 1000);
    expect(
      categoryVisualCandidates(
        [
          first,
          { ...first, url: "https://instagram.com/reel/first/?tracking=1" },
          second,
          { ...item("evil", 900000), url: "https://evil.test/p/evil/" },
          { ...item("tt", 99999), platform: "tt" },
        ],
        "anime",
        [
          {
            url: second.url,
            platform: "ig",
            creator: "second",
            genreId: "anime",
            techniques: [],
            action: "hide-creator",
            at: new Date().toISOString(),
          },
        ],
      ),
    ).toEqual([first]);
  });
  it("continues only recoverable post/media failures, never model, account, budget, decoder or network errors", () => {
    for (const error of [
      "source_low_engagement",
      "source_engagement_unknown",
      "source_frames_too_large",
      "source_frames_decode_failed",
    ])
      expect(categoryVisualCanContinue(error)).toBe(true);
    for (const error of [
      "budget",
      "auth",
      "account_changed",
      "busy",
      "source_frames_decoder_unavailable",
      "source_frames_cancelled",
      "invalid_response",
      "assessment_failed",
    ])
      expect(categoryVisualCanContinue(error)).toBe(false);
  });
});

describe("category visual HTTP boundary", () => {
  it("sends only the exact selected model/account, category and canonical post request to the local endpoint", async () => {
    const data = {
      status: "unavailable",
      selection,
      error: "source_low_engagement",
      modelCalls: 0,
    };
    const fetcher = vi.fn().mockResolvedValue(json(data));
    expect(await assessCategoryVisual(request, undefined, fetcher)).toEqual({ ok: true, data });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/local-ai/assess-category");
    expect(JSON.parse(init.body)).toEqual(request);
    expect(init.headers["X-Local-AI"]).toBe("1");
  });
  it("rejects account/model changes and wrong source identities rather than accepting fallback output", async () => {
    const base = { status: "unavailable", selection, error: "source_unavailable", modelCalls: 0 };
    for (const data of [
      { ...base, selection: { ...selection, accountId: "other" } },
      { ...base, selection: { ...selection, model: "fallback" } },
      {
        ...base,
        source: {
          status: "unavailable",
          url: "https://www.instagram.com/p/OTHER/",
          title: "",
          description: "",
          thumbnailUrl: "",
          author: "",
          observedAt: null,
          provenance: "instagram-public-embed",
        },
      },
    ])
      expect(
        await assessCategoryVisual(request, undefined, vi.fn().mockResolvedValue(json(data))),
      ).toEqual({ ok: false, error: "invalid_response" });
  });
  it("refuses unsafe URLs before a fetch and preserves terminal server errors", async () => {
    const fetcher = vi.fn();
    expect(
      await assessCategoryVisual({ ...request, url: "https://evil.test/p/A/" }, undefined, fetcher),
    ).toEqual({ ok: false, error: "invalid_request" });
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(json({ error: "account_changed" }, 409));
    expect(await assessCategoryVisual(request, undefined, fetcher)).toEqual({
      ok: false,
      error: "account_changed",
    });
  });
});
