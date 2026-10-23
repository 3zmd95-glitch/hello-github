import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditFormatSchema, type EditFormat } from "./editFormats";
import { formatVerificationTarget } from "./formatVerification";
import {
  FORMAT_QUEUE_MAX,
  FORMAT_QUEUE_MAX_BYTES,
  FormatQueueSchema,
  addFormatCandidates,
  formatQueueOptions,
  formatTargetId,
  removeFormatCandidate,
  selectFormatCandidates,
  type FormatQueueEntry,
} from "./formatQueue";

const NOW = new Date("2026-10-11T20:00:00Z");
const target = {
  key: "trip-figures",
  name: { en: "Track figures" },
  visualPattern: { en: "Repeated figures across the frame" },
  audio: { title: "Track", artist: "Artist", url: "https://www.instagram.com/reels/audio/123/" },
};
const url = (n = 0) => `https://www.instagram.com/p/Post${n}/`;
const entry = (n = 0): FormatQueueEntry => ({ target, url: url(n), addedAt: NOW.toISOString() });
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("format queue inspector options", () => {
  const current: EditFormat = {
    ...target,
    firstSeen: NOW.toISOString(),
    lastChecked: NOW.toISOString(),
    evidence: { state: "repeated", creators7d: 3, posts7d: 5, scope: "indexed-public-posts" },
    samples: [
      { url: url(9), title: "Current reference", platform: "ig", observedAt: NOW.toISOString() },
    ],
  };

  it("keeps a queued older target accessible beside a changed current format with the same key", () => {
    const changed = { ...current, visualPattern: { en: "New pattern", ar: "نمط جديد" } };
    const options = formatQueueOptions([changed], [entry()], NOW);
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({
      id: formatTargetId(formatVerificationTarget(changed)),
      format: changed,
      target: formatVerificationTarget(changed),
      historical: false,
    });
    expect(options[0].format).toBe(changed);
    expect(options[1].id).toBe(formatTargetId(target));
    expect(options[1].id).not.toBe(options[0].id);
    expect(options[1].target).toEqual(target);
    expect(options[1].historical).toBe(true);
    expect(selectFormatCandidates([entry()], options[0].target, NOW)).toEqual([]);
    expect(selectFormatCandidates([entry()], options[1].target, NOW)).toEqual([entry()]);
  });

  it("deduplicates exact normalized targets, preserves current evidence, and gives stable IDs", () => {
    const alias = {
      ...target,
      audio: { ...target.audio, url: "https://instagram.com/reels/audio/123?tracking=1" },
    };
    const options = formatQueueOptions(
      [current, { ...current, ...alias }],
      [entry(), entry(1)],
      NOW,
    );
    expect(options).toHaveLength(1);
    expect(options[0].format).toBe(current);
    expect(options[0].format.evidence).toEqual(current.evidence);
    expect(formatTargetId(alias)).toBe(options[0].id);
    expect(formatQueueOptions([], [entry(1)], NOW)[0].id).toBe(options[0].id);
    expect(formatTargetId({ ...target, audio: undefined })).toBeNull();
  });

  it("reopens a removed format as a neutral adapter without fabricating evidence or refreshing dates", () => {
    const original = "2026-10-01T20:00:00.000Z";
    const records = [
      { ...entry(), addedAt: original },
      { ...entry(1), target: { ...target, key: "future" }, addedAt: "2027-01-01T00:00:00.000Z" },
    ];
    const [option] = formatQueueOptions([], records, NOW);
    expect(formatQueueOptions([], records, NOW)).toHaveLength(1);
    expect(option.historical).toBe(true);
    expect(EditFormatSchema.safeParse(option.format).success).toBe(true);
    expect(formatVerificationTarget(option.format)).toEqual(target);
    expect(option.format).toEqual({
      ...target,
      firstSeen: original,
      lastChecked: original,
      evidence: { state: "candidate", creators7d: 0, posts7d: 0, scope: "reviewed-references" },
      samples: [{ url: url(), title: target.name.en, platform: "ig", observedAt: original }],
    });
  });
});
afterEach(() => vi.useRealTimers());

describe("format candidate queue", () => {
  it("canonicalizes aliases and accepts only six distinct new links per action", () => {
    const rows = addFormatCandidates(
      [],
      target,
      [
        "https://example.com/p/Post0/",
        "https://m.instagram.com/reel/Post0/?tracking=1",
        url(),
        ...Array.from({ length: 8 }, (_, i) => url(i + 1)),
      ],
      NOW,
    );
    expect(rows.map((row) => row.url)).toEqual(Array.from({ length: 6 }, (_, i) => url(i)));
    expect(rows.every((row) => row.addedAt === NOW.toISOString())).toBe(true);
    expect(Object.keys(rows[0])).toEqual(["target", "url", "addedAt"]);
  });

  it("binds the entire target snapshot and removes only that target's canonical post", () => {
    const changes = [
      { ...target, key: "other" },
      { ...target, name: { en: "Other name" } },
      { ...target, visualPattern: { en: "Stacked cars" } },
      { ...target, audio: { ...target.audio, title: "Other track" } },
      { ...target, audio: { ...target.audio, artist: "Other artist" } },
      { ...target, audio: { ...target.audio, url: "https://www.instagram.com/reels/audio/456/" } },
    ];
    let rows = addFormatCandidates([], target, [url()], NOW);
    for (const changed of changes) {
      expect(selectFormatCandidates(rows, changed, NOW)).toEqual([]);
      rows = addFormatCandidates(rows, changed, [url()], NOW);
    }
    expect(selectFormatCandidates(rows, target, NOW)).toEqual([entry()]);
    expect(removeFormatCandidate(rows, target, "https://instagram.com/reel/Post0")).toHaveLength(
      changes.length,
    );
    expect(
      selectFormatCandidates(removeFormatCandidate(rows, target, url()), changes[0], NOW),
    ).toHaveLength(1);
  });

  it("preserves the first addedAt for duplicate actions and duplicate imported aliases", () => {
    const rows = addFormatCandidates([], target, [url()], NOW);
    const later = new Date(NOW.getTime() + 1000);
    expect(addFormatCandidates(rows, target, ["https://instagram.com/reel/Post0/"], later)).toBe(
      rows,
    );
    const earlier = new Date(NOW.getTime() - 1000).toISOString();
    const restored = FormatQueueSchema.parse([
      entry(),
      { ...entry(), url: "https://instagram.com/reel/Post0/", addedAt: earlier },
    ]);
    expect(restored).toEqual([{ ...entry(), addedAt: earlier }]);
    const aliasTarget = {
      ...target,
      audio: { ...target.audio, url: "https://instagram.com/reels/audio/123?tracking=1" },
    };
    expect(selectFormatCandidates(rows, aliasTarget, NOW)).toEqual(rows);
  });

  it("retains existing leads at capacity and can add again after an explicit removal", () => {
    let rows: readonly FormatQueueEntry[] = [];
    for (let batch = 0; batch < 8; batch++)
      rows = addFormatCandidates(
        rows,
        target,
        Array.from({ length: 6 }, (_, i) => url(batch * 6 + i)),
        NOW,
      );
    expect(rows).toHaveLength(FORMAT_QUEUE_MAX);
    expect(addFormatCandidates(rows, { ...target, key: "new" }, [url(99)], NOW)).toBe(rows);
    const reduced = removeFormatCandidate(rows, target, url());
    const added = addFormatCandidates(reduced, target, [url(99)], NOW);
    expect(added).toHaveLength(FORMAT_QUEUE_MAX);
    expect(added.at(-1)?.url).toBe(url(99));
  });

  it("bounds restored and newly added bytes even for long multilingual target snapshots", () => {
    const largeTarget = {
      ...target,
      name: { en: "ع".repeat(500), ar: "ع".repeat(500) },
      visualPattern: { en: "ع".repeat(500), ar: "ع".repeat(500) },
    };
    const imported = FormatQueueSchema.parse(
      Array.from({ length: 60 }, (_, i) => ({ ...entry(i), target: largeTarget })),
    );
    const rows = addFormatCandidates(imported, largeTarget, [url(100)], NOW);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(FORMAT_QUEUE_MAX);
    expect(new TextEncoder().encode(JSON.stringify(rows)).byteLength).toBeLessThanOrEqual(
      FORMAT_QUEUE_MAX_BYTES,
    );
    expect(addFormatCandidates(rows, target, ["x".repeat(FORMAT_QUEUE_MAX_BYTES)], NOW)).toBe(rows);
  });

  it("rejects forged verdicts, invalid/future records and non-public URLs without dropping valid rows", () => {
    const badUrls = [
      "http://instagram.com/p/Post0/",
      "https://evil.test/p/Post0/",
      "https://instagram.com.evil.test/p/Post0/",
      "https://name:secret@instagram.com/p/Post0/",
      "https://instagram.com:444/p/Post0/",
      "https://instagram.com/reels/audio/123/",
      "https://instagram.com/explore/tags/food/",
      "https://instagram.com/p/Post0/\n",
    ];
    const malformed = [
      null,
      {},
      { ...entry(), addedAt: "invalid" },
      { ...entry(), addedAt: new Date(NOW.getTime() + 1).toISOString() },
      { ...entry(), visual: "match" },
      { ...entry(), source: { likes: 100000 } },
      { ...entry(), target: { ...target, accountId: "forged" } },
      {
        ...entry(),
        target: { key: "empty", name: target.name, visualPattern: target.visualPattern },
      },
      ...badUrls.map((value) => ({ ...entry(), url: value })),
    ];
    expect(FormatQueueSchema.parse([...malformed, entry()])).toEqual([entry()]);
    expect(addFormatCandidates([], target, badUrls, NOW)).toEqual([]);
    expect(selectFormatCandidates([entry()], target, new Date(NOW.getTime() - 1))).toEqual([]);
    expect(FormatQueueSchema.parse(undefined)).toEqual([]);
    expect(FormatQueueSchema.parse({ rows: [entry()] })).toEqual([]);
  });

  it("copies target snapshots and leaves unrelated or invalid removals untouched", () => {
    const input = structuredClone(target);
    const rows = addFormatCandidates([], input, [url()], NOW);
    input.visualPattern.en = "Changed afterward";
    expect(rows[0].target.visualPattern).toEqual(target.visualPattern);
    expect(removeFormatCandidate(rows, input, url())).toBe(rows);
    expect(removeFormatCandidate(rows, target, "https://evil.test/p/Post0/")).toBe(rows);
    expect(addFormatCandidates(rows, input, [url()], new Date("invalid"))).toBe(rows);
  });
});
