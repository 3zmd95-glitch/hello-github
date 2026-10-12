import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instagramShortcodeAt } from "../workers/scout/src/postDate";
import {
  FORMAT_OBSERVATIONS_MAX_BYTES,
  FormatObservationsSchema,
  selectFormatObservations,
  summarizeFormatObservations,
  upsertFormatObservation,
  type FormatObservation,
  type FormatObservationInput,
} from "./formatObservations";

const NOW = new Date("2026-10-11T20:00:00Z");
const DAY = 86_400_000;
const at = (offset: number) => new Date(NOW.getTime() + offset);
const target = {
  key: "format-local",
  name: { en: "Track — repeated figures" },
  visualPattern: { en: "Repeated figures across the frame" },
  audio: { title: "Track", artist: "Artist", url: "https://www.instagram.com/reels/audio/123/" },
};
function input(n = 0): FormatObservationInput {
  const source = {
    status: "available" as const,
    url: `https://www.instagram.com/reel/${instagramShortcodeAt(at(-DAY), n)}/`,
    title: "Repeated figures",
    description: "My repeated figure edit",
    thumbnailUrl: "https://scontent.cdninstagram.com/image.jpg",
    observedAt: at(-20_000).toISOString(),
    provenance: "instagram-public-embed" as const,
    author: "creator.one",
    audio: { ...target.audio },
  };
  return {
    target,
    source,
    inspection: {
      provider: "chatgpt",
      model: "gpt-6-astra",
      effort: "max",
      verification: {
        version: 1,
        formatKey: target.key,
        url: source.url,
        checkedAt: at(-10_000).toISOString(),
        visual: "match",
        audio: "match",
        teaching: "unknown",
        observations: ["Repeated figures at 1.5s"],
        limitations: ["sampled_frames", "motion_partial", "synchronization_unverified"],
        basis: "source-frames-and-metadata",
        source,
        durationSeconds: 2,
        frames: [
          { timestampSeconds: 0.5, sha256: "a".repeat(64) },
          { timestampSeconds: 1.5, sha256: "b".repeat(64) },
        ],
        videoSha256: "c".repeat(64),
        framesObservedAt: at(-15_000).toISOString(),
        frameCount: 2,
      },
    },
  };
}
const save = (value = input()) => upsertFormatObservation([], value, NOW);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("local format observations", () => {
  it("binds canonical post, complete target and separate original check/source/frame dates", () => {
    const rows = save();
    const selected = selectFormatObservations(rows, target, NOW);
    expect(selected[0]).toMatchObject({
      checkedAt: NOW.toISOString(),
      published: at(-DAY).toISOString(),
      audio: "match",
      source: { observedAt: at(-20_000).toISOString() },
      inspection: {
        model: "gpt-6-astra",
        effort: "max",
        verification: { checkedAt: at(-10_000).toISOString() },
      },
    });
    expect(selected[0].url).toContain("/p/");
    expect(summarizeFormatObservations(rows, target, NOW)).toEqual({
      checkedPosts: 1,
      audioMatches: 1,
      sampledMatches: 1,
      recentCreators: 1,
    });
    expect(
      selectFormatObservations(
        rows,
        { ...target, visualPattern: { en: "A different recipe" } },
        NOW,
      ),
    ).toEqual([]);
    expect(
      selectFormatObservations(rows, { ...target, audio: { title: "Other track" } }, NOW),
    ).toEqual([]);
  });

  it("deduplicates aliases and independent creators without refreshing identical evidence", () => {
    const original = save();
    const alias = input();
    alias.source.url = alias.source.url.replace("/reel/", "/p/") + "?utm_source=example";
    expect(upsertFormatObservation(original, alias, at(1000))).toBe(original);
    const sameCreator = input(1);
    sameCreator.source.author = "@Creator.One";
    let rows = upsertFormatObservation(original, sameCreator, NOW);
    expect(summarizeFormatObservations(rows, target, NOW).recentCreators).toBe(1);
    const independent = input(2);
    independent.source.author = "creator.two";
    rows = upsertFormatObservation(rows, independent, NOW);
    expect(summarizeFormatObservations(rows, target, NOW)).toEqual({
      checkedPosts: 3,
      audioMatches: 3,
      sampledMatches: 3,
      recentCreators: 2,
    });
  });

  it("keeps historical observations while freshness and publication windows stop recent counts", () => {
    const rows = save();
    expect(summarizeFormatObservations(rows, target, at(4 * DAY))).toEqual({
      checkedPosts: 1,
      audioMatches: 1,
      sampledMatches: 1,
      recentCreators: 0,
    });
    for (const date of [at(-8 * DAY), at(1000)]) {
      const value = input();
      value.source.url = `https://www.instagram.com/p/${instagramShortcodeAt(date)}/`;
      value.inspection!.verification.url = value.source.url;
      expect(summarizeFormatObservations(save(value), target, NOW).recentCreators).toBe(0);
    }
  });

  it("requires sampled visuals, matching displayed audio and a named creator for recent creators", () => {
    for (const change of ["preview", "uncertain", "audio", "unknown", "name"] as const) {
      const value = input();
      const verification = value.inspection!.verification;
      if (change === "preview") {
        verification.basis = "source-thumbnail-and-metadata";
        verification.imageSha256 = "d".repeat(64);
      }
      if (change === "uncertain") verification.visual = "uncertain";
      if (change === "audio") {
        value.source.audio = { title: "Other song" };
        verification.audio = "mismatch";
      }
      if (change === "unknown") {
        value.source.audio = { title: "Original audio" };
        verification.audio = "unknown";
      }
      if (change === "name") value.source.author = "unknown";
      const rows = save(value);
      expect(rows).toHaveLength(1);
      expect(summarizeFormatObservations(rows, target, NOW).recentCreators, change).toBe(0);
    }
    const named = input();
    named.target = {
      key: "format-named",
      name: target.name,
      visualPattern: target.visualPattern,
      namedFormat: "Repeated figures",
    };
    named.inspection!.verification.formatKey = named.target.key;
    named.inspection!.verification.audio = "unknown";
    expect(summarizeFormatObservations(save(named), named.target, NOW).recentCreators).toBe(1);
  });

  it("a later unavailable check replaces an earlier positive without inventing observedAt", () => {
    const original = save();
    const unavailable = {
      target,
      source: { ...input().source, status: "unavailable" as const, observedAt: null },
    };
    const next = upsertFormatObservation(original, unavailable, at(60_000));
    expect(next[0]).toMatchObject({
      checkedAt: at(60_000).toISOString(),
      source: { observedAt: null },
    });
    expect(next[0].inspection).toBeUndefined();
    expect(summarizeFormatObservations(next, target, at(60_000))).toEqual({
      checkedPosts: 1,
      audioMatches: 0,
      sampledMatches: 0,
      recentCreators: 0,
    });
    expect(upsertFormatObservation(next, input(), at(120_000))).toBe(next);
  });

  it("changed caption/audio/author or newer source-only checks cannot inherit a visual verdict", () => {
    for (const change of ["description", "audio", "author", "refresh"] as const) {
      const value = input();
      const source = { ...value.source, observedAt: at(60_000).toISOString() };
      if (change === "description") source.description = "An ordinary scene";
      if (change === "audio") source.audio = { title: "Other track" };
      if (change === "author") source.author = "different.creator";
      const rows = upsertFormatObservation(save(), { target, source }, at(60_000));
      expect(rows[0].inspection, change).toBeUndefined();
      expect(summarizeFormatObservations(rows, target, at(60_000)).sampledMatches).toBe(0);
    }
    const negative = input();
    negative.inspection!.verification.visual = "mismatch";
    negative.inspection!.verification.checkedAt = NOW.toISOString();
    expect(
      summarizeFormatObservations(upsertFormatObservation(save(), negative, NOW), target, NOW)
        .sampledMatches,
    ).toBe(0);
  });

  it("newer contradictory source evidence also invalidates another target's older positive", () => {
    const changed = input();
    changed.target = { ...target, key: "format-other" };
    changed.source = {
      ...changed.source,
      observedAt: at(60_000).toISOString(),
      description: "Changed caption",
    };
    delete changed.inspection;
    const rows = upsertFormatObservation(save(), changed, at(60_000));
    expect(selectFormatObservations(rows, target, at(60_000))).toEqual([]);
  });

  it("rejects unbound URLs, source snapshots, audio assessments and future evidence", () => {
    const original = save();
    for (const change of [
      "url",
      "source",
      "key",
      "audio",
      "sourceTime",
      "checkTime",
      "frameTime",
    ] as const) {
      const value = structuredClone(input());
      if (change === "url") value.inspection!.verification.url = input(99).source.url;
      if (change === "source")
        value.inspection!.verification.source = {
          ...value.inspection!.verification.source,
          description: "Different caption",
        };
      if (change === "key") value.inspection!.verification.formatKey = "format-other";
      if (change === "audio") value.inspection!.verification.audio = "mismatch";
      if (change === "sourceTime") value.source.observedAt = at(1000).toISOString();
      if (change === "checkTime") value.inspection!.verification.checkedAt = at(1000).toISOString();
      if (change === "frameTime")
        value.inspection!.verification.framesObservedAt = at(1000).toISOString();
      expect(upsertFormatObservation(original, value, NOW), change).toBe(original);
    }
  });

  it("sanitizes imports, future records and secrets while bounding count and UTF-8 bytes", () => {
    const withExtras = {
      ...input(),
      inspection: { ...input().inspection!, accountId: "secret-account", mediaUrl: "secret-media" },
    };
    const rows = save(withExtras);
    expect(JSON.stringify(rows)).not.toContain("secret-");
    const future = { ...rows[0], checkedAt: at(DAY).toISOString() };
    expect(FormatObservationsSchema.parse([{}, future, rows[0], rows[0]])).toEqual(rows);
    expect(FormatObservationsSchema.parse(undefined)).toEqual([]);
    const many: FormatObservation[] = [];
    for (let i = 0; i < 60; i++) many.push(...save(input(i)));
    expect(FormatObservationsSchema.parse(many)).toHaveLength(48);
    const large = many.map((row) => ({
      ...row,
      inspection: undefined,
      source: {
        ...row.source,
        description: "ع".repeat(6000),
        thumbnailUrl: "https://scontent.cdninstagram.com/" + "a".repeat(5500),
      },
    }));
    const bounded = FormatObservationsSchema.parse(large);
    expect(bounded.length).toBeGreaterThan(0);
    expect(bounded.length).toBeLessThan(48);
    expect(new TextEncoder().encode(JSON.stringify(bounded)).byteLength).toBeLessThanOrEqual(
      FORMAT_OBSERVATIONS_MAX_BYTES,
    );
  });
});
