// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "./discover";
import { assessCategorySemantic, categorySemanticCandidates } from "./discoverSemanticClient";
import type { DiscoverSemanticRequest } from "./discoverSemantic";

const item = (id: number, likes = 1000, platform: "ig" | "tt" = "ig"): DiscoverItem => ({
  platform,
  url:
    platform === "ig"
      ? `https://www.instagram.com/p/Post${id}/`
      : `https://www.tiktok.com/@editor${id}/video/769000000000000000${id}`,
  title: "indexed unrelated title",
  snippet: "indexed unrelated text",
  handle: `editor${id}`,
  lang: "en",
  section: "example",
  outsideCategory: true,
  offTopic: true,
  stats: { likes: 900000 },
  evidence: {
    source: platform === "ig" ? "instagram-public-embed" : "tiktok-public-page",
    observedAt: new Date().toISOString(),
    availability: "available",
    caption: "We brought this little story to life. #anime",
    author: `editor${id}`,
    likes,
  },
});
const selection = {
  provider: "chatgpt" as const,
  model: "chosen-model",
  effort: "high",
  accountId: "account",
};
const request: DiscoverSemanticRequest = {
  ...selection,
  genreId: "anime",
  urls: [item(1).url],
  lang: "en",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("caption candidate selection", () => {
  it("uses both native platforms and unresolved caption text despite indexed flags, max three by default", () => {
    const items = [item(1), item(2, 2000, "tt"), item(3), item(4)];
    expect(categorySemanticCandidates(items, "anime")).toHaveLength(3);
    expect(categorySemanticCandidates(items, "anime")[0]).toBe(items[1]);
    expect(categorySemanticCandidates(items, "anime", [], "tt")).toEqual([items[1]]);
    expect(categorySemanticCandidates(items, "anime", [], "yt")).toEqual([]);
  });
  it("requires native captions and strong observed counts, never inflated indexed counts or older available duplicates", () => {
    const low = item(1, 5);
    low.evidence!.views = 500000;
    const missing = item(2);
    delete missing.evidence;
    const gone = item(3);
    gone.evidence!.availability = "unavailable";
    const earlierAvailable = item(3);
    earlierAvailable.evidence!.observedAt = new Date(
      Date.parse(gone.evidence!.observedAt) - 1000,
    ).toISOString();
    const old = item(4);
    old.evidence!.observedAt = new Date(Date.now() - 4 * 86400000).toISOString();
    const blank = item(5);
    blank.evidence!.caption = "";
    expect(
      categorySemanticCandidates([low, missing, earlierAvailable, gone, old, blank], "anime"),
    ).toEqual([]);
  });
  it("skips already described captions, substantive exclusions, hidden creators and arbitrary URLs", () => {
    const described = item(1);
    described.evidence!.caption = "Anime typography edit with tracked text";
    const excluded = item(2);
    excluded.evidence!.caption = "Full anime movie watch full episode";
    const unsafe = { ...item(3), url: "https://evil.test/p/Post3/" };
    const hidden = item(4);
    expect(
      categorySemanticCandidates([described, excluded, unsafe, hidden], "anime", [
        {
          url: hidden.url,
          platform: "ig",
          creator: hidden.handle,
          genreId: "anime",
          techniques: [],
          action: "hide-creator",
          at: new Date().toISOString(),
        },
      ]),
    ).toEqual([]);
  });
  it("deduplicates canonical posts and diversifies creators before repeats", () => {
    const first = item(1, 3000);
    const repeated = item(2, 2000);
    repeated.evidence!.author = first.evidence!.author;
    const other = item(3);
    expect(
      categorySemanticCandidates(
        [first, { ...first, url: "https://instagram.com/reel/Post1/?tracking=1" }, repeated, other],
        "anime",
      ).map((candidate) => candidate.url),
    ).toEqual(["https://instagram.com/reel/Post1/?tracking=1", other.url, repeated.url]);
  });
});

describe("caption HTTP boundary", () => {
  it("makes exactly one request containing only selected identity, category and URLs", async () => {
    const data = { status: "unavailable", selection, error: "source_unavailable", modelCalls: 0 };
    const fetcher = vi.fn().mockResolvedValue(json(data));
    expect(await assessCategorySemantic(request, undefined, fetcher)).toEqual({ ok: true, data });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/local-ai/assess-caption");
    expect(JSON.parse(init.body)).toEqual(request);
    expect(init.headers["X-Local-AI"]).toBe("1");
  });
  it("rejects unsafe requests, oversized batches and changed model/account responses", async () => {
    const fetcher = vi.fn();
    for (const urls of [["https://evil.test/p/Post1/"], [1, 2, 3, 4].map((id) => item(id).url)]) {
      expect(await assessCategorySemantic({ ...request, urls }, undefined, fetcher)).toEqual({
        ok: false,
        error: "invalid_request",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
    for (const changed of [
      { ...selection, model: "fallback" },
      { ...selection, accountId: "other" },
    ]) {
      fetcher.mockResolvedValue(
        json({
          status: "unavailable",
          selection: changed,
          error: "source_unavailable",
          modelCalls: 0,
        }),
      );
      expect(await assessCategorySemantic(request, undefined, fetcher)).toEqual({
        ok: false,
        error: "invalid_response",
      });
    }
  });
  it("preserves terminal failures without retrying and reports cancellation", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ error: "account_changed" }, 409));
    expect(await assessCategorySemantic(request, undefined, fetcher)).toEqual({
      ok: false,
      error: "account_changed",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    fetcher.mockRejectedValue(new Error("aborted"));
    expect(await assessCategorySemantic(request, controller.signal, fetcher)).toEqual({
      ok: false,
      error: "cancelled",
    });
  });
});
