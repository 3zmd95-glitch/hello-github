// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  capturedReviewRequestFixture,
  capturedReviewResponseFixture,
} from "@/lib/nativeVideoCapture.fixture";
import { rankDiscoverItems } from "@/lib/discoverRanking";
import { DiscoverCandidatesSchema } from "@/lib/discoverFeed";
import { useStore, type DiscoverVisualApplyGuard } from "./index";

const now = new Date("2026-10-11T14:00:00Z");
const request = () => capturedReviewRequestFixture(now.getTime());
const guard = (changes: Partial<DiscoverVisualApplyGuard> = {}): DiscoverVisualApplyGuard => ({
  epoch: useStore.getState().discoverLibraryEpoch,
  genreId: "coffee",
  url: request().capture.url,
  selection: {
    provider: "chatgpt",
    model: "gpt-6-astra",
    effort: "max",
    accountId: "selected-account",
  },
  isCurrent: () => true,
  ...changes,
});
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  useStore.setState({
    discoverCandidates: [],
    discoverLibraryStatus: "ready",
    inspirations: [],
    discoverFeedback: [],
  });
});
afterEach(() => vi.unstubAllGlobals());

it("attaches a successful receipt only to the exact selected candidate/category, adding it if needed", async () => {
  const response = await capturedReviewResponseFixture(request(), now.getTime());
  expect(useStore.getState().applyCapturedVideoReviewResult(response, guard(), now)).toBe(
    "applied",
  );
  const state = useStore.getState();
  expect(state.discoverCandidates).toHaveLength(1);
  const candidate = state.discoverCandidates[0];
  expect(candidate).toMatchObject({
    genreId: "coffee",
    origin: "manual",
    item: {
      url: request().capture.url,
      platform: "tt",
      evidence: { source: "tiktok-public-page", likes: 2000 },
    },
    visual: { media: { provenance: "browser-visible-video" } },
  });
  expect(JSON.stringify(candidate)).not.toMatch(/data:image|selected-account|videoSha256/);
  expect(DiscoverCandidatesSchema.parse([candidate])).toEqual([candidate]);
  expect(state.inspirations).toEqual([]);
  expect(state.discoverFeedback).toEqual([]);
  state.accumulateDiscoverCandidates([candidate.item], { genreId: "cars", now });
  const other = useStore.getState().discoverCandidates.find((entry) => entry.genreId === "cars");
  expect(other?.visual).toBeUndefined();
  expect(useStore.getState().applyCapturedVideoReviewResult(response, guard(), now)).toBe(
    "unchanged",
  );
  expect(useStore.getState().discoverCandidates.find((entry) => entry.genreId === "cars")).toBe(
    other,
  );
});

it("rejects mismatched selection, post/category and stale lifecycle receipts", async () => {
  const response = await capturedReviewResponseFixture(request(), now.getTime());
  for (const mismatch of [
    { genreId: "cars" },
    { url: request().capture.url.replace("1234567890123456789", "1234567890123456788") },
    { selection: { ...guard().selection, model: "other-model" } },
    { selection: { ...guard().selection, accountId: "other-account" } },
  ])
    expect(useStore.getState().applyCapturedVideoReviewResult(response, guard(mismatch), now)).toBe(
      "invalid",
    );
  for (const mismatch of [{ epoch: "wrong-epoch" }, { isCurrent: () => false }])
    expect(useStore.getState().applyCapturedVideoReviewResult(response, guard(mismatch), now)).toBe(
      "stale",
    );
  for (const observedAt of [null, new Date(now.getTime() + 600_000).toISOString()])
    expect(
      useStore
        .getState()
        .applyCapturedVideoReviewResult(
          { ...response, source: { ...response.source, observedAt } },
          guard(),
          now,
        ),
    ).toBe("invalid");
  expect(useStore.getState().discoverCandidates).toEqual([]);
});

it("retains an earlier receipt unchanged when inference fails, including a newer capture observation", async () => {
  const response = await capturedReviewResponseFixture(request(), now.getTime());
  useStore.getState().applyCapturedVideoReviewResult(response, guard(), now);
  const previous = useStore.getState().discoverCandidates;
  const { version, url, genreId, checkedAt, source, media } = response.visual;
  const failure = {
    status: "unavailable",
    selection: response.selection,
    error: "subscription_failed",
    modelCalls: 1,
    source: response.source,
    observation: { version, url, genreId, checkedAt, source, media },
  };
  expect(useStore.getState().applyCapturedVideoReviewResult(failure, guard(), now)).toBe(
    "unchanged",
  );
  expect(useStore.getState().discoverCandidates).toBe(previous);
});

it("qualifies screenshot craft only through the existing source, engagement, recency and exclusion gates", async () => {
  const response = await capturedReviewResponseFixture(request(), now.getTime());
  useStore.getState().applyCapturedVideoReviewResult(response, guard(), now);
  const candidate = useStore.getState().discoverCandidates[0];
  const rank = (
    item = candidate.item,
    mode: "inspiration" | "popular" = "inspiration",
    time = now.getTime(),
  ) =>
    rankDiscoverItems([item], {
      genreId: "coffee",
      mode,
      now: time,
      visual: { [candidate.item.url]: candidate },
    }).items;
  expect(rank()).toHaveLength(1);
  expect(rank(candidate.item, "popular")).toHaveLength(1);
  expect(rank({ ...candidate.item, evidence: undefined, stats: { views: 900000 } })).toHaveLength(
    0,
  );
  expect(
    rank({ ...candidate.item, evidence: { ...candidate.item.evidence!, views: 2, likes: 1 } }),
  ).toHaveLength(0);
  expect(
    rank({
      ...candidate.item,
      evidence: { ...candidate.item.evidence!, availability: "unavailable" },
    }),
  ).toHaveLength(0);
  expect(
    rank({
      ...candidate.item,
      evidence: { ...candidate.item.evidence!, caption: "Follow for giveaway buy now" },
    }),
  ).toHaveLength(0);
  expect(rank(candidate.item, "popular", now.getTime() + 4 * 86_400_000)).toHaveLength(0);
  expect(rank(candidate.item, "inspiration", now.getTime() + 40 * 86_400_000)).toHaveLength(1);
});
