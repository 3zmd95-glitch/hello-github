// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import { useStore } from "./index";
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";
import { categoryCandidates, DISCOVER_CANDIDATE_MAX_CHARS } from "../lib/discoverFeed";
import { rankDiscoverItems } from "../lib/discoverRanking";

const now = new Date("2026-10-09T12:00:00Z");
const item: DiscoverItem = {
  platform: "ig",
  handle: "@editor",
  title: "Coffee match cut",
  snippet: "Cup match cut",
  url: "https://www.instagram.com/reel/ABC123/",
  lang: "en",
  section: "example",
  evidence: {
    source: "instagram-public-embed",
    observedAt: "2026-10-08T12:00:00Z",
    caption: "Cup match cut",
    likes: 400,
  },
};
const input = {
  url: item.url,
  platform: item.platform,
  creator: item.handle,
  genreId: "coffee",
  techniques: ["match cut"],
};
const state = () => useStore.getState();

beforeEach(() => {
  localStorage.clear();
  state().reset();
});

describe("Discover feed persistence", () => {
  it("round-trips manual origin independently of preferences and removes it on reset", async () => {
    state().accumulateDiscoverCandidates([item], { genreId: "coffee", manuallyAdded: true, now });
    state().setDiscoverFeedback({ ...input, action: "more" }, now);
    state().clearDiscoverFeedback();
    expect(state().discoverCandidates[0].origin).toBe("manual");
    const backup = state().exportState(now);
    state().reset();
    state().importState(backup);
    await useStore.persist.rehydrate();
    expect(state().discoverCandidates[0].origin).toBe("manual");
    expect(state().discoverFeedback).toEqual([]);
    expect(
      rankDiscoverItems([state().discoverCandidates[0].item], {
        genreId: "coffee",
        mode: "popular",
        now: now.getTime(),
      }).items,
    ).toEqual([]);
    state().reset();
    expect(state().discoverCandidates).toEqual([]);
  });

  it("exports, imports, rehydrates and resets the candidate library and preferences together", async () => {
    state().accumulateDiscoverCandidates([item], { genreId: "coffee", now });
    state().setDiscoverFeedback({ ...input, action: "more" }, now);
    const before = { candidates: state().discoverCandidates, feedback: state().discoverFeedback };
    const backup = state().exportState(now);
    state().reset();
    expect(state().discoverCandidates).toEqual([]);
    expect(state().discoverFeedback).toEqual([]);
    state().importState(backup);
    await useStore.persist.rehydrate();
    expect(state().discoverCandidates).toEqual(before.candidates);
    expect(state().discoverFeedback).toEqual(before.feedback);
  });

  it("loads legacy backups and drops malformed entries without losing existing skill references", () => {
    state().addRef("a-skill", {
      platform: item.platform,
      url: item.url,
      handle: item.handle,
      title: item.title,
    });
    const backup = JSON.parse(state().exportState(now));
    delete backup.state.discoverCandidates;
    delete backup.state.discoverFeedback;
    state().importState(JSON.stringify(backup));
    expect(state().discoverCandidates).toEqual([]);
    expect(state().discoverFeedback).toEqual([]);
    expect(state().savedRefs["a-skill"]).toHaveLength(1);
    backup.state.discoverCandidates = [{}];
    backup.state.discoverFeedback = [{ action: "watch", url: item.url }];
    state().importState(JSON.stringify(backup));
    expect(state().discoverCandidates).toEqual([]);
    expect(state().discoverFeedback).toEqual([]);
  });

  it("loses no additional qualified recent examples when a full twelve-category library reloads", async () => {
    const order = ["anime", ...Object.keys(CATEGORY_PROFILES).filter((id) => id !== "anime")];
    let animeBeforeTour = 0;
    for (const genreId of order) {
      const subject = CATEGORY_PROFILES[genreId].subject.en;
      const caption = `${subject} match cut film. ${"Original source description. ".repeat(75)}`;
      const posts: DiscoverItem[] = Array.from({ length: 24 }, (_, index) => ({
        ...item,
        platform: "yt",
        url: `https://www.youtube.com/watch?v=${genreId}${index}`,
        title: `${subject} match cut film`,
        snippet: caption,
        published: "2026-10-08T12:00:00Z",
        evidence: {
          source: "youtube-api",
          observedAt: now.toISOString(),
          caption,
          views: 60_000,
          published: "2026-10-08T12:00:00Z",
        },
      }));
      state().accumulateDiscoverCandidates(posts, { genreId, now });
      if (genreId === "anime")
        animeBeforeTour = categoryCandidates(state().discoverCandidates, genreId).length;
    }
    const before = structuredClone(state().discoverCandidates);
    const animeAfterTour = categoryCandidates(before, "anime").length;
    expect(animeBeforeTour).toBe(24);
    expect(animeAfterTour).toBe(animeBeforeTour);
    expect(JSON.stringify(before).length).toBeLessThanOrEqual(DISCOVER_CANDIDATE_MAX_CHARS);
    await useStore.persist.rehydrate();
    expect(state().discoverCandidates).toEqual(before);
    for (const genreId of order) {
      const posts = categoryCandidates(state().discoverCandidates, genreId);
      expect(posts.length, genreId).toBeGreaterThan(0);
      expect(
        rankDiscoverItems(posts, { genreId, mode: "popular", now: now.getTime() }).items.length,
        genreId,
      ).toBe(posts.length);
    }
  });

  it("does not emit a state change or refresh obtainedAt for repeated cached/enriched payloads", () => {
    state().accumulateDiscoverCandidates([item], { genreId: "coffee", now });
    const previous = state();
    const listener = vi.fn();
    const unsubscribe = useStore.subscribe(listener);
    state().accumulateDiscoverCandidates([item], {
      genreId: "coffee",
      now: new Date(now.getTime() + 60_000),
    });
    expect(state()).toBe(previous);
    expect(listener).not.toHaveBeenCalled();
    expect(state().discoverCandidates[0].obtainedAt).toBe(now.toISOString());
    unsubscribe();
  });

  it("undoes a replacement and creator hide without losing previous item preferences", () => {
    state().setDiscoverFeedback({ ...input, action: "more" }, now);
    const before = state().discoverFeedback;
    const token = state().setDiscoverFeedback(
      { ...input, action: "less" },
      new Date(now.getTime() + 1000),
    );
    state().undoDiscoverFeedback(token!);
    expect(state().discoverFeedback).toEqual(before);
    const hide = state().setDiscoverFeedback(
      { ...input, action: "hide-creator" },
      new Date(now.getTime() + 2000),
    );
    expect(state().discoverFeedback).toHaveLength(2);
    state().undoDiscoverFeedback(hide!);
    expect(state().discoverFeedback).toEqual(before);
    state().clearDiscoverFeedback();
    expect(state().discoverFeedback).toEqual([]);
  });
});
