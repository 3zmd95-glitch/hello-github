import { beforeEach, describe, expect, it, vi } from "vitest";
import * as quality from "../workers/scout/src/categories/quality";
import {
  DISCOVER_METADATA_MAX_CHARS,
  DISCOVER_METADATA_MAX_ENTRIES,
  discoverCreativeEvidence,
  discoverSourceCaption,
  discoverMetadataCacheSize,
  resetDiscoverMetadataCache,
} from "./discoverMetadata";

beforeEach(() => {
  resetDiscoverMetadataCache();
  vi.restoreAllMocks();
});

describe("bounded local caption analysis cache", () => {
  it("restores only an exact official YouTube title boundary without admitting indexed title contamination", () => {
    const item = {
      platform: "yt" as const,
      url: "https://www.youtube.com/watch?v=123",
      handle: "editor",
      title: "Car match cut film",
      snippet: "",
      lang: "en" as const,
      section: "example" as const,
      evidence: {
        source: "youtube-api" as const,
        observedAt: "2026-10-09T12:00:00Z",
        caption: "Car match cut film Actual native description",
      },
    };
    expect(discoverSourceCaption(item)).toBe("Car match cut film\nActual native description");
    expect(discoverSourceCaption({ ...item, title: "Invented speed ramp title" })).toBe(
      item.evidence.caption,
    );
    expect(
      discoverSourceCaption({
        ...item,
        platform: "ig",
        evidence: { ...item.evidence, source: "instagram-public-embed" },
      }),
    ).toBe(item.evidence.caption);
  });

  it("reuses exact category/text analysis across cloned inputs and isolates returned arrays", () => {
    const spy = vi.spyOn(quality, "categoryCreativeEvidence");
    const first = discoverCreativeEvidence("coffee", "Coffee match cut");
    first.techniques.push("invented");
    first.subjects.length = 0;
    const cloned = structuredClone({ genre: "coffee", caption: "Coffee match cut" });
    const repeated = discoverCreativeEvidence(cloned.genre, cloned.caption);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(repeated.techniques).toContain("match cut");
    expect(repeated.techniques).not.toContain("invented");
    expect(repeated.subjects).toContain("coffee");
    expect(discoverMetadataCacheSize().entries).toBe(1);
  });

  it("reanalyzes a changed native caption or category instead of retaining stale relevance", () => {
    const spy = vi.spyOn(quality, "categoryCreativeEvidence");
    expect(discoverCreativeEvidence("coffee", "Coffee match cut").eligible).toBe(true);
    expect(discoverCreativeEvidence("coffee", "Anime plot scene").eligible).toBe(false);
    expect(discoverCreativeEvidence("anime", "Coffee match cut").category).toBe(false);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("keeps both the entry and text-memory limits, evicting least recently used captions", () => {
    const spy = vi.spyOn(quality, "categoryCreativeEvidence");
    for (let index = 0; index < DISCOVER_METADATA_MAX_ENTRIES; index++)
      discoverCreativeEvidence("coffee", `Coffee match cut ${index}`);
    discoverCreativeEvidence("coffee", "Coffee match cut 0");
    discoverCreativeEvidence("coffee", "Coffee match cut overflow");
    expect(discoverMetadataCacheSize().entries).toBe(DISCOVER_METADATA_MAX_ENTRIES);
    const calls = spy.mock.calls.length;
    discoverCreativeEvidence("coffee", "Coffee match cut 0");
    expect(spy).toHaveBeenCalledTimes(calls);
    discoverCreativeEvidence("coffee", "Coffee match cut 1");
    expect(spy).toHaveBeenCalledTimes(calls + 1);

    resetDiscoverMetadataCache();
    for (let index = 0; index < 300; index++)
      discoverCreativeEvidence("coffee", `Coffee match cut ${index} ${"caption ".repeat(700)}`);
    const size = discoverMetadataCacheSize();
    expect(size.entries).toBeLessThan(300);
    expect(size.chars).toBeLessThanOrEqual(DISCOVER_METADATA_MAX_CHARS);
    expect(size.entries).toBeGreaterThan(0);
    resetDiscoverMetadataCache();
    expect(discoverMetadataCacheSize()).toEqual({ entries: 0, chars: 0 });
  });
});
