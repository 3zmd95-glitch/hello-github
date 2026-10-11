// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instagramShortcodeAt } from "../workers/scout/src/postDate";
import { summarizeFormatObservations, type FormatObservationInput } from "@/lib/formatObservations";
import { STORAGE_KEY, useStore } from "./index";

const NOW = new Date("2026-10-11T20:00:00Z");
const state = () => useStore.getState();
function input(): FormatObservationInput {
  const target = {
    key: "format-local",
    name: { en: "Track figures" },
    visualPattern: { en: "Repeated figures" },
    audio: { title: "Track", artist: "Artist" },
  };
  const source = {
    status: "available" as const,
    url: `https://www.instagram.com/reel/${instagramShortcodeAt(new Date("2026-10-10T12:00:00Z"))}/`,
    title: "Figures",
    description: "A repeated figure edit",
    author: "creator.one",
    thumbnailUrl: "https://scontent.cdninstagram.com/image.jpg",
    observedAt: "2026-10-11T19:59:00Z",
    provenance: "instagram-public-embed" as const,
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
        checkedAt: "2026-10-11T19:59:30Z",
        visual: "match",
        audio: "match",
        teaching: "unknown",
        observations: ["Two figures"],
        limitations: ["sampled_frames", "motion_partial", "synchronization_unverified"],
        basis: "source-frames-and-metadata",
        source,
        durationSeconds: 2,
        frames: [
          { timestampSeconds: 0.5, sha256: "a".repeat(64) },
          { timestampSeconds: 1.5, sha256: "b".repeat(64) },
        ],
        videoSha256: "c".repeat(64),
        framesObservedAt: "2026-10-11T19:59:10Z",
        frameCount: 2,
      },
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  state().reset();
});
afterEach(() => vi.useRealTimers());

describe("persisted local format observations", () => {
  it("records once and removes only the selected target/post without changing preferences", () => {
    const value = input();
    expect(state().recordFormatObservation(value, NOW)).toBe(true);
    expect(state().recordFormatObservation(value, NOW)).toBe(false);
    const other = input();
    other.target.key = "format-other";
    other.inspection!.verification.formatKey = "format-other";
    expect(state().recordFormatObservation(other, NOW)).toBe(true);
    expect(state().formatObservations).toHaveLength(2);
    state().removeFormatObservation(value.target.key, value.source.url);
    expect(state().formatObservations.map((row) => row.target.key)).toEqual(["format-other"]);
    expect(state().followedFormats).toEqual([]);
    expect(state().inspirations).toEqual([]);
    expect(state().discoverFeedback).toEqual([]);
  });

  it("rehydrates complete source/model evidence from browser storage and export/import", async () => {
    state().recordFormatObservation(input(), NOW);
    const original = state().formatObservations;
    const saved = localStorage.getItem(STORAGE_KEY)!;
    const exported = state().exportState(NOW);
    useStore.setState({ formatObservations: [] });
    localStorage.setItem(STORAGE_KEY, saved);
    await useStore.persist.rehydrate();
    expect(state().formatObservations).toEqual(original);
    const oldEpoch = state().discoverLibraryEpoch;
    state().reset();
    expect(state().formatObservations).toEqual([]);
    expect(state().discoverLibraryEpoch).not.toBe(oldEpoch);
    state().importState(exported);
    await useStore.persist.rehydrate();
    expect(state().formatObservations).toEqual(original);
    expect(summarizeFormatObservations(original, input().target, NOW).recentCreators).toBe(1);
  });

  it("keeps a later unavailable check across reload and rejects older cached positives", async () => {
    state().recordFormatObservation(input(), NOW);
    const later = new Date(NOW.getTime() + 1000);
    vi.setSystemTime(later);
    const unavailable = {
      target: input().target,
      source: { ...input().source, status: "unavailable" as const, observedAt: null },
    };
    expect(state().recordFormatObservation(unavailable, later)).toBe(true);
    await useStore.persist.rehydrate();
    expect(state().formatObservations[0].source.observedAt).toBeNull();
    expect(state().formatObservations[0].inspection).toBeUndefined();
    expect(state().recordFormatObservation(input(), later)).toBe(false);
    expect(
      summarizeFormatObservations(state().formatObservations, input().target, later).recentCreators,
    ).toBe(0);
  });

  it("defaults old backups empty and drops malformed/future evidence without losing other progress", () => {
    state().recordFormatObservation(input(), NOW);
    const backup = JSON.parse(state().exportState(NOW));
    const valid = state().formatObservations[0];
    delete backup.state.formatObservations;
    state().importState(JSON.stringify(backup));
    expect(state().formatObservations).toEqual([]);
    backup.state.recentTopics = ["kept topic"];
    backup.state.formatObservations = [
      {},
      { ...valid, checkedAt: "2099-01-01T00:00:00Z" },
      valid,
      valid,
    ];
    state().importState(JSON.stringify(backup));
    expect(state().formatObservations).toEqual([valid]);
    expect(state().recentTopics).toEqual(["kept topic"]);
  });

  it("rejects unbound inspections without mutating saved evidence", () => {
    const value = input();
    state().recordFormatObservation(value, NOW);
    const before = state().formatObservations;
    value.inspection!.verification.formatKey = "different";
    expect(state().recordFormatObservation(value, NOW)).toBe(false);
    expect(state().formatObservations).toBe(before);
  });
});
