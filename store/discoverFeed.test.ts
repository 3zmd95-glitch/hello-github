// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import { useStore, type DiscoverVisualApplyGuard } from "./index";
import type { DiscoverVisualResponse } from "../lib/discoverVisual";
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
const selection = {
  provider: "chatgpt" as const,
  model: "gpt-6-astra",
  effort: "max",
  accountId: "local-account",
};
const guard = (overrides: Partial<DiscoverVisualApplyGuard> = {}): DiscoverVisualApplyGuard => ({
  epoch: state().discoverLibraryEpoch,
  genreId: "coffee",
  url: item.url,
  selection,
  isCurrent: () => true,
  ...overrides,
});
const visualResult = (): Extract<DiscoverVisualResponse, { status: "assessed" }> => ({
  status: "assessed",
  selection,
  source: {
    status: "available",
    url: "https://www.instagram.com/p/ABC123/",
    title: "Cup match cut",
    description: "Cup match cut",
    thumbnailUrl: "",
    author: "editor",
    observedAt: now.toISOString(),
    provenance: "instagram-public-embed",
    likes: 2000,
  },
  cached: false,
  modelCalls: 1,
  visual: {
    version: 1,
    url: "https://www.instagram.com/p/ABC123/",
    genreId: "coffee",
    checkedAt: now.toISOString(),
    source: {
      provenance: "instagram-public-embed",
      caption: "Cup match cut",
      author: "editor",
      observedAt: now.toISOString(),
      sha256: "a".repeat(64),
    },
    media: {
      provenance: "instagram-public-embed-video",
      observedAt: now.toISOString(),
      durationSeconds: 12,
      videoSha256: "b".repeat(64),
      frames: [
        { timestampSeconds: 0, sha256: "c".repeat(64) },
        { timestampSeconds: 6, sha256: "d".repeat(64) },
      ],
    },
    provider: "chatgpt",
    model: selection.model,
    effort: selection.effort,
    assessment: {
      category: "supported",
      categoryFrames: [0, 1],
      observations: [
        {
          cue: "layout",
          origin: "uploader-added",
          description: "Coffee panels share a frame.",
          frames: [1],
        },
      ],
      uncertainty: "Sampled frames only.",
    },
    limitations: ["sampled_frames", "motion_partial", "audio_unverified"],
  },
});

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

describe("guarded category visual results", () => {
  beforeEach(() => {
    state().accumulateDiscoverCandidates([item], { genreId: "coffee", now });
  });

  it("applies authentic source data and a separately bound judgment, then round-trips backup and hydration", async () => {
    const response = visualResult();
    expect(state().applyDiscoverVisualResult(response, guard(), now)).toBe("applied");
    const record = state().discoverCandidates[0];
    expect(record.visual).toEqual(response.visual);
    expect(record.item.evidence?.likes).toBe(2000);
    expect(record.obtainedAt).toBe(now.toISOString());
    const backup = state().exportState(now);
    state().reset();
    state().importState(backup);
    await useStore.persist.rehydrate();
    expect(state().discoverCandidates[0]).toEqual(record);
    expect(state().applyDiscoverVisualResult(response, guard(), now)).toBe("unchanged");
  });

  it("accepts count-only refreshes without replacing newer native observations or renewing visual time", () => {
    const response = visualResult();
    state().applyDiscoverVisualResult(response, guard(), now);
    const previous = state().discoverCandidates[0];
    state().accumulateDiscoverCandidates(
      [
        {
          ...previous.item,
          evidence: { ...previous.item.evidence!, likes: 3000, observedAt: "2026-10-09T12:02:00Z" },
        },
      ],
      { genreId: "coffee", now: new Date("2026-10-09T12:02:00Z") },
    );
    const before = state().discoverCandidates;
    expect(
      state().applyDiscoverVisualResult(response, guard(), new Date("2026-10-09T12:03:00Z")),
    ).toBe("unchanged");
    expect(state().discoverCandidates).toBe(before);
    expect(before[0].item.evidence?.likes).toBe(3000);
    expect(before[0].visual?.checkedAt).toBe(now.toISOString());
  });

  it.each(["reset", "import"])(
    "rejects a late result after %s even when the same post is present",
    (operation) => {
      const pending = guard();
      const backup = state().exportState(now);
      if (operation === "reset") {
        state().reset();
        state().accumulateDiscoverCandidates([item], { genreId: "coffee", now });
      } else state().importState(backup);
      expect(state().applyDiscoverVisualResult(visualResult(), pending, now)).toBe("stale");
      expect(state().discoverCandidates[0].visual).toBeUndefined();
    },
  );

  it("rejects a cancelled/replaced caller generation and a removed candidate", () => {
    let current = true;
    const pending = guard({ isCurrent: () => current });
    current = false;
    expect(state().applyDiscoverVisualResult(visualResult(), pending, now)).toBe("stale");
    current = true;
    useStore.setState({ discoverCandidates: [] });
    expect(state().applyDiscoverVisualResult(visualResult(), pending, now)).toBe("stale");
  });

  it.each([
    { model: "other-model" },
    { effort: "low" },
    { accountId: "other-account" },
    { provider: "claude" as const },
  ])("rejects a result for another selection: %j", (change) => {
    const before = state().discoverCandidates;
    expect(
      state().applyDiscoverVisualResult(
        visualResult(),
        guard({ selection: { ...selection, ...change } }),
        now,
      ),
    ).toBe("invalid");
    expect(state().discoverCandidates).toBe(before);
  });

  it("binds both post and category and leaves another category's candidate untouched", () => {
    state().accumulateDiscoverCandidates([item], { genreId: "cars", now });
    expect(state().applyDiscoverVisualResult(visualResult(), guard({ genreId: "cars" }), now)).toBe(
      "invalid",
    );
    expect(state().applyDiscoverVisualResult(visualResult(), guard(), now)).toBe("applied");
    expect(
      state().discoverCandidates.find((row) => row.genreId === "cars")?.visual,
    ).toBeUndefined();
    const wrong = visualResult();
    wrong.source.url = "https://www.instagram.com/p/OTHER/";
    expect(state().applyDiscoverVisualResult(wrong, guard(), now)).toBe("invalid");
  });

  it.each([{ caption: "Updated source caption" }, { availability: "unavailable" as const }])(
    "rejects a late judgment against newer source truth: %j",
    (change) => {
      state().accumulateDiscoverCandidates(
        [
          {
            ...item,
            evidence: {
              ...item.evidence!,
              ...change,
              author: "editor",
              observedAt: "2026-10-09T12:02:00Z",
            },
          },
        ],
        { genreId: "coffee", now },
      );
      const before = state().discoverCandidates;
      expect(
        state().applyDiscoverVisualResult(
          visualResult(),
          guard(),
          new Date("2026-10-09T12:03:00Z"),
        ),
      ).toBe("stale");
      expect(state().discoverCandidates).toBe(before);
    },
  );

  it("keeps the source correction from an engagement skip without claiming visual inspection", () => {
    const response = visualResult();
    expect(
      state().applyDiscoverVisualResult(
        {
          status: "unavailable",
          selection,
          error: "source_low_engagement",
          modelCalls: 0,
          source: { ...response.source, likes: 5 },
        },
        guard(),
        now,
      ),
    ).toBe("applied");
    expect(state().discoverCandidates[0].item.evidence?.likes).toBe(5);
    expect(state().discoverCandidates[0].visual).toBeUndefined();
  });

  it("persists changed media after inference failure so old positives cannot return on hydration", async () => {
    const response = visualResult();
    state().applyDiscoverVisualResult(response, guard(), now);
    const { version, url, genreId, source, media } = response.visual;
    const later = "2026-10-09T12:02:00Z";
    const observation = {
      version,
      url,
      genreId,
      checkedAt: later,
      source,
      media: { ...media, observedAt: later, videoSha256: "e".repeat(64) },
    };
    expect(
      state().applyDiscoverVisualResult(
        {
          status: "unavailable",
          selection,
          error: "ai_limit",
          modelCalls: 1,
          source: response.source,
          observation,
        },
        guard(),
        new Date(later),
      ),
    ).toBe("applied");
    expect(state().discoverCandidates[0].visual).toBeUndefined();
    expect(state().discoverCandidates[0].visualObservation).toEqual(observation);
    expect(state().applyDiscoverVisualResult(response, guard(), new Date(later))).toBe("unchanged");
    await useStore.persist.rehydrate();
    expect(state().discoverCandidates[0].visual).toBeUndefined();
    expect(state().discoverCandidates[0].visualObservation).toEqual(observation);
  });

  it("rejects malformed, future-dated and expired live responses without changing native evidence", () => {
    const response = visualResult();
    const before = state().discoverCandidates;
    expect(
      state().applyDiscoverVisualResult(
        { ...response, visual: { ...response.visual, version: 99 } },
        guard(),
        now,
      ),
    ).toBe("invalid");
    expect(
      state().applyDiscoverVisualResult(response, guard(), new Date(now.getTime() - 600_000)),
    ).toBe("invalid");
    expect(
      state().applyDiscoverVisualResult(
        response,
        guard(),
        new Date(now.getTime() + 2 * 86_400_000),
      ),
    ).toBe("invalid");
    expect(state().discoverCandidates).toBe(before);
  });
});
