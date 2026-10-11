// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectFormatCandidates } from "@/lib/formatQueue";
import { STORAGE_KEY, useStore } from "./index";

const NOW = new Date("2026-10-11T20:00:00Z");
const state = () => useStore.getState();
const target = {
  key: "trip-figures",
  name: { en: "Track figures" },
  visualPattern: { en: "Repeated figures" },
  audio: { title: "Track", artist: "Artist" },
};
const url = "https://www.instagram.com/p/Post0/";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  state().reset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("persisted format candidate queue", () => {
  it("adds/removes exact-target leads without changing evidence, preferences or Saved or making requests", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    state().saveInspiration({
      platform: "ig",
      url,
      title: "Saved reference",
      snippet: "",
      handle: "creator",
    });
    state().setDiscoverFeedback(
      { platform: "ig", url, creator: "creator", genreId: "food", techniques: [], action: "more" },
      NOW,
    );
    state().recordFormatObservation(
      {
        target,
        source: {
          status: "available",
          url,
          title: "Reference",
          description: "Reference",
          author: "creator",
          thumbnailUrl: "",
          observedAt: NOW.toISOString(),
          provenance: "instagram-public-embed",
        },
      },
      NOW,
    );
    const before = {
      observations: state().formatObservations,
      feedback: state().discoverFeedback,
      saved: state().inspirations,
      candidates: state().discoverCandidates,
    };
    state().addFormatCandidates(target, [url]);
    const original = state().formatQueue;
    vi.setSystemTime(new Date(NOW.getTime() + 1000));
    state().addFormatCandidates(target, ["https://instagram.com/reel/Post0/"]);
    expect(state().formatQueue).toBe(original);
    const other = { ...target, visualPattern: { en: "Stacked cars" } };
    state().addFormatCandidates(other, [url]);
    state().removeFormatCandidate(target, url);
    expect(selectFormatCandidates(state().formatQueue, target)).toEqual([]);
    expect(selectFormatCandidates(state().formatQueue, other)).toHaveLength(1);
    expect(state().formatObservations).toBe(before.observations);
    expect(state().discoverFeedback).toBe(before.feedback);
    expect(state().inspirations).toBe(before.saved);
    expect(state().discoverCandidates).toBe(before.candidates);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("persists, exports, restores and resets queued leads while preserving original dates", async () => {
    state().addFormatCandidates(target, [url]);
    const original = state().formatQueue;
    const saved = localStorage.getItem(STORAGE_KEY)!;
    const exported = state().exportState(NOW);
    useStore.setState({ formatQueue: [] });
    localStorage.setItem(STORAGE_KEY, saved);
    await useStore.persist.rehydrate();
    expect(state().formatQueue).toEqual(original);
    state().reset();
    expect(state().formatQueue).toEqual([]);
    await useStore.persist.rehydrate();
    expect(state().formatQueue).toEqual([]);
    state().importState(exported);
    await useStore.persist.rehydrate();
    expect(state().formatQueue).toEqual(original);
  });

  it("defaults legacy backups empty and sanitizes malformed imported queues without losing progress", () => {
    state().addFormatCandidates(target, [url]);
    const backup = JSON.parse(state().exportState(NOW));
    const valid = state().formatQueue[0];
    delete backup.state.formatQueue;
    state().importState(JSON.stringify(backup));
    expect(state().formatQueue).toEqual([]);
    backup.state.recentTopics = ["kept topic"];
    backup.state.formatQueue = [
      null,
      { ...valid, addedAt: "2099-01-01T00:00:00Z" },
      { ...valid, inspection: { visual: "match" } },
      valid,
      valid,
    ];
    state().importState(JSON.stringify(backup));
    expect(state().formatQueue).toEqual([valid]);
    expect(state().recentTopics).toEqual(["kept topic"]);
  });

  it("keeps a lead queued when its source is checked, including an unavailable result", () => {
    state().addFormatCandidates(target, [url]);
    const original = state().formatQueue;
    expect(
      state().recordFormatObservation(
        {
          target,
          source: {
            status: "unavailable",
            url,
            title: "",
            description: "",
            author: "",
            thumbnailUrl: "",
            observedAt: null,
            provenance: "instagram-public-embed",
          },
        },
        NOW,
      ),
    ).toBe(true);
    expect(state().formatQueue).toBe(original);
  });
});
