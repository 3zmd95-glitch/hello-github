// @vitest-environment jsdom
import { beforeEach, expect, it } from "vitest";
import { useStore, type DiscoverSemanticApplyGuard } from "./index";
import type { DiscoverItem } from "../lib/discover";
import type { DiscoverSemanticResponse } from "../lib/discoverSemantic";

const now = new Date("2026-10-11T12:00:00Z");
const caption = "Cinematic frames from Nice 🇫🇷 #filmmakers";
const item: DiscoverItem = {
  url: "https://www.tiktok.com/@alessvisuals/video/7677300576404770069",
  platform: "tt",
  handle: "@alessvisuals",
  title: caption,
  snippet: "",
  lang: "en",
  section: "example",
  evidence: {
    source: "tiktok-public-page",
    caption,
    author: "alessvisuals",
    observedAt: now.toISOString(),
    likes: 27600,
    views: 131800,
  },
};
const selection = {
  provider: "chatgpt" as const,
  model: "gpt-6-astra",
  effort: "low",
  accountId: "test-account",
};
const state = () => useStore.getState();
const guard = (over: Partial<DiscoverSemanticApplyGuard> = {}): DiscoverSemanticApplyGuard => ({
  epoch: state().discoverLibraryEpoch,
  genreId: "travel",
  urls: [item.url],
  selection,
  isCurrent: () => true,
  ...over,
});
const response = (): Extract<DiscoverSemanticResponse, { status: "assessed" }> => ({
  status: "assessed",
  selection,
  cached: false,
  modelCalls: 1,
  semantics: [
    {
      version: 1,
      url: item.url,
      genreId: "travel",
      checkedAt: now.toISOString(),
      model: selection.model,
      effort: selection.effort,
      source: {
        provenance: "tiktok-public-page",
        caption,
        author: "alessvisuals",
        observedAt: now.toISOString(),
      },
      assessment: {
        category: "supported",
        categoryQuote: "Nice 🇫🇷",
        project: "described",
        projectQuote: "Cinematic frames from Nice 🇫🇷",
        reason: "A caption describing the creator's destination film.",
      },
    },
  ],
});
beforeEach(() => {
  state().reset();
  state().accumulateDiscoverCandidates([item], { genreId: "travel", now });
});

it("persists caption understanding without mutating metrics or saved preferences", async () => {
  const original = state().discoverCandidates[0];
  expect(state().applyDiscoverSemanticResult(response(), guard(), now)).toBe("applied");
  expect(state().discoverCandidates[0].item).toEqual(original.item);
  expect(state().discoverCandidates[0].obtainedAt).toEqual(original.obtainedAt);
  expect(state().discoverFeedback).toEqual([]);
  expect(state().applyDiscoverSemanticResult(response(), guard(), now)).toBe("unchanged");
  const backup = state().exportState(now);
  state().reset();
  state().importState(backup);
  await useStore.persist.rehydrate();
  expect(state().discoverCandidates[0].semantic).toEqual(response().semantics[0]);
});
it("discards replies after library resets, cancellation or source changes", () => {
  const staleGuard = guard();
  state().reset();
  state().accumulateDiscoverCandidates([item], { genreId: "travel", now });
  expect(state().applyDiscoverSemanticResult(response(), staleGuard, now)).toBe("stale");
  expect(
    state().applyDiscoverSemanticResult(response(), guard({ isCurrent: () => false }), now),
  ).toBe("stale");
  state().accumulateDiscoverCandidates(
    [
      {
        ...item,
        evidence: {
          ...item.evidence!,
          caption: "Changed caption",
          observedAt: new Date(now.getTime() + 1000).toISOString(),
        },
      },
    ],
    { genreId: "travel", now },
  );
  expect(state().applyDiscoverSemanticResult(response(), guard(), now)).toBe("stale");
  expect(state().discoverCandidates[0].semantic).toBeUndefined();
});
it("rejects a wrong account, model, category, unrequested URL, and invalid quote", () => {
  expect(
    state().applyDiscoverSemanticResult(
      response(),
      guard({ selection: { ...selection, accountId: "other" } }),
      now,
    ),
  ).toBe("invalid");
  expect(
    state().applyDiscoverSemanticResult(
      response(),
      guard({ selection: { ...selection, model: "other" } }),
      now,
    ),
  ).toBe("invalid");
  expect(state().applyDiscoverSemanticResult(response(), guard({ genreId: "coffee" }), now)).toBe(
    "invalid",
  );
  expect(
    state().applyDiscoverSemanticResult(
      response(),
      guard({ urls: ["https://www.instagram.com/p/other/"] }),
      now,
    ),
  ).toBe("invalid");
  const invalid = response();
  invalid.semantics[0].assessment.categoryQuote = "not in caption";
  expect(state().applyDiscoverSemanticResult(invalid, guard(), now)).toBe("invalid");
  expect(state().discoverCandidates[0].semantic).toBeUndefined();
});
it("fails a mismatched batch atomically without applying its earlier valid result", () => {
  const invalid = response();
  invalid.semantics.push({
    ...invalid.semantics[0],
    url: "https://www.tiktok.com/@other/video/7490121492424903958",
  });
  expect(state().applyDiscoverSemanticResult(invalid, guard(), now)).toBe("invalid");
  expect(state().discoverCandidates[0].semantic).toBeUndefined();
});
