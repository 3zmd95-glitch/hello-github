import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import {
  applicableDiscoverSemantic,
  canonicalDiscoverSemanticUrl,
  discoverSemanticSourceMatches,
  discoverSemanticInput,
  DiscoverSemanticRequestSchema,
  DiscoverSemanticResponseSchema,
  DiscoverSemanticSchema,
  DISCOVER_SEMANTIC_TTL_MS,
  type DiscoverSemantic,
} from "./discoverSemantic";

const when = "2026-10-11T12:00:00.000Z",
  now = Date.parse(when);
const url = "https://www.tiktok.com/@filmmaker/video/7677300576404770069";
const semantic: DiscoverSemantic = {
  version: 1,
  url,
  genreId: "travel",
  checkedAt: when,
  model: "selected-model",
  effort: "low",
  source: {
    provenance: "tiktok-public-page",
    caption: "Cinematic frames from Nice #France",
    author: "filmmaker",
    observedAt: when,
  },
  assessment: {
    category: "supported",
    categoryQuote: "frames from Nice #France",
    project: "described",
    projectQuote: "Cinematic frames from Nice",
    reason: "The caption describes a creative location film; footage was not assessed.",
  },
};
const item: DiscoverItem = {
  platform: "tt",
  url,
  title: "An indexed title",
  snippet: "An indexed excerpt",
  handle: "filmmaker",
  lang: "en",
  section: "example",
  evidence: {
    source: "tiktok-public-page",
    caption: semantic.source.caption,
    author: "filmmaker",
    observedAt: when,
    availability: "available",
  },
};
const selection = { provider: "chatgpt", model: semantic.model, effort: semantic.effort };

describe("caption semantic contract", () => {
  it("binds a category and project judgment to source text, not indexed text or context", () => {
    expect(DiscoverSemanticSchema.parse(semantic)).toEqual(semantic);
    expect(applicableDiscoverSemantic({ genreId: "travel", semantic }, item, now)).toEqual(
      semantic,
    );
    expect(applicableDiscoverSemantic({ genreId: "cars", semantic }, item, now)).toBeUndefined();
    expect(
      discoverSemanticSourceMatches(semantic, {
        ...item,
        title: "changed",
        snippet: "changed",
        evidence: { ...item.evidence!, observedAt: new Date(now + 1000).toISOString() },
      }),
    ).toBe(true);
    for (const evidence of [
      { ...item.evidence!, caption: semantic.source.caption + "!" },
      { ...item.evidence!, author: "someone-else" },
      { ...item.evidence!, source: "indexed-excerpt" as const },
      { ...item.evidence!, availability: "unavailable" as const },
    ])
      expect(discoverSemanticSourceMatches(semantic, { ...item, evidence })).toBe(false);
    expect(discoverSemanticSourceMatches(semantic, { ...item, platform: "ig" })).toBe(false);
    expect(
      discoverSemanticSourceMatches(semantic, { ...item, url: url.replace("7677", "8677") }),
    ).toBe(false);
  });

  it("accepts native Instagram and TikTok oEmbed with the matching platform only", () => {
    const instagram = {
      ...semantic,
      url: "https://www.instagram.com/p/EXAMPLE/",
      source: { ...semantic.source, provenance: "instagram-public-embed" as const },
    };
    expect(DiscoverSemanticSchema.safeParse(instagram).success).toBe(true);
    expect(
      DiscoverSemanticSchema.safeParse({ ...semantic, source: instagram.source }).success,
    ).toBe(false);
    const oembed = {
      ...semantic,
      source: { ...semantic.source, provenance: "tiktok-oembed" as const },
    };
    expect(
      discoverSemanticSourceMatches(oembed, {
        ...item,
        evidence: { ...item.evidence!, source: "tiktok-oembed" },
      }),
    ).toBe(true);
  });

  it("rejects fabricated or missing quotes, extra claims, and malformed records without throwing", () => {
    for (const patch of [
      { categoryQuote: "" },
      { projectQuote: "   " },
      { projectQuote: "cinematic frames from nice" },
      { categoryQuote: "travel" },
      { techniques: ["speed ramps"] },
      { reason: "" },
    ])
      expect(
        DiscoverSemanticSchema.safeParse({
          ...semantic,
          assessment: { ...semantic.assessment, ...patch },
        }).success,
      ).toBe(false);
    for (const patch of [
      { version: 0 },
      { genreId: "unknown" },
      { url: "bad" },
      { checkedAt: "yesterday" },
      { source: { ...semantic.source, caption: "" } },
      { visual: true },
    ])
      expect(DiscoverSemanticSchema.safeParse({ ...semantic, ...patch }).success).toBe(false);
    expect(
      DiscoverSemanticSchema.safeParse({
        ...semantic,
        assessment: {
          category: "uncertain",
          categoryQuote: "",
          project: "none",
          projectQuote: "",
          reason: "The caption does not establish the requested subject or a creative project.",
        },
      }).success,
    ).toBe(true);
  });

  it("expires both assessment and source, rejects future times and unsupported versions", () => {
    for (const clock of [now + DISCOVER_SEMANTIC_TTL_MS, now - 300001, NaN])
      expect(
        applicableDiscoverSemantic({ genreId: "travel", semantic }, item, clock),
      ).toBeUndefined();
    const oldSource = {
      ...semantic,
      source: {
        ...semantic.source,
        observedAt: new Date(now - DISCOVER_SEMANTIC_TTL_MS + 1000).toISOString(),
      },
    };
    expect(
      applicableDiscoverSemantic({ genreId: "travel", semantic: oldSource }, item, now + 1000),
    ).toBeUndefined();
    const future = {
      ...semantic,
      source: { ...semantic.source, observedAt: new Date(now + 300001).toISOString() },
    };
    expect(DiscoverSemanticSchema.safeParse(future).success).toBe(false);
  });

  it("allows only bounded canonical public post requests without client-supplied captions", () => {
    const request = { ...selection, genreId: "travel", urls: [url], lang: "en" };
    expect(DiscoverSemanticRequestSchema.safeParse(request).success).toBe(true);
    for (const patch of [
      { urls: [] },
      { urls: [url, url] },
      { urls: [url, url, url, url] },
      { caption: "client asserted source" },
      { provider: "claude" },
      { genreId: "other" },
      { urls: [url + "?tracking=1"] },
    ])
      expect(DiscoverSemanticRequestSchema.safeParse({ ...request, ...patch }).success).toBe(false);
    expect(canonicalDiscoverSemanticUrl(url + "?tracking=1")).toBe(url);
    expect(canonicalDiscoverSemanticUrl("https://instagram.com/reel/EXAMPLE/")).toBe(
      "https://www.instagram.com/p/EXAMPLE/",
    );
    for (const bad of [
      "https://evil.test/@creator/video/1234567890123456",
      "https://www.tiktok.com/@creator",
      "http://www.tiktok.com/@creator/video/1234567890123456",
      "https://user@www.tiktok.com/@c/video/1234567890123456",
      "https://www.tiktok.com:123/@c/video/1234567890123456",
      "https://www.tiktok.com\\@evil.test/@c/video/1234567890123456",
      "https://www.tiktok.com/@c/video/1234567890123456\n",
      "https://www.instagram.com/reels/audio/1234/",
    ])
      expect(canonicalDiscoverSemanticUrl(bad)).toBeNull();
  });

  it("validates selection, cache provenance and unique same-category response batches", () => {
    const response = {
      status: "assessed",
      selection,
      semantics: [semantic],
      modelCalls: 1,
      cached: false,
    };
    expect(DiscoverSemanticResponseSchema.safeParse(response).success).toBe(true);
    for (const patch of [
      { selection: { ...selection, model: "other" } },
      { selection: { ...selection, effort: "max" } },
      { cached: true },
      { modelCalls: 2 },
      { semantics: [semantic, semantic] },
      { semantics: [] },
      { semantics: [semantic, { ...semantic, url: url.replace("7677", "8677"), genreId: "cars" }] },
    ])
      expect(DiscoverSemanticResponseSchema.safeParse({ ...response, ...patch }).success).toBe(
        false,
      );
  });

  it("passes only category definition and source caption/author to the model", () => {
    const input = JSON.parse(discoverSemanticInput("travel", [semantic], "ar"));
    expect(input).toEqual({
      outputLanguage: "Arabic",
      category: { id: "travel", subject: { en: "travel", ar: "سفر" } },
      sources: [{ index: 0, caption: semantic.source.caption, author: "filmmaker" }],
    });
    expect(input.sources[0]).not.toHaveProperty("url");
    expect(input.sources[0]).not.toHaveProperty("observedAt");
  });
});
