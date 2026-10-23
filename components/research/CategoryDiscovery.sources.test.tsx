// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GENRES } from "@/data/genres";
import type { DiscoverItem } from "@/lib/discover";
import { nativeResultsToItems, type NativeSearchSnapshot } from "@/lib/discoverNativeSearch";
import type { InstagramSource } from "@/workers/scout/src/instagramSource";
import type { TikTokSource } from "@/workers/scout/src/tiktokSource";
import { instagramShortcodeAt } from "@/workers/scout/src/postDate";
import type { NativeSearchState } from "./useNativeSearch";
import CategoryDiscovery from "./CategoryDiscovery";

const fixture = vi.hoisted(() => ({
  native: null as NativeSearchState | null,
  instagram: vi.fn(),
  nullReads: false,
  popularReads: false,
  sourceObservedAt: "2026-10-13T17:00:00Z",
  rerankOnEvidence: false,
  tiktok: vi.fn(),
  store: {
    accumulateDiscoverCandidates: vi.fn(),
    discoverFeedback: [],
    discoverCandidates: [],
    settings: { discover: { editorScope: "mine" as "mine" | "all" } },
  },
}));
vi.mock("./useNativeSearch", () => ({ useNativeSearch: () => fixture.native }));
// Use the real source hook: only the public network reads are deferred test doubles.
vi.mock("@/lib/formatSources", async (original) => ({
  ...(await original<typeof import("@/lib/formatSources")>()),
  localInstagramSource: fixture.instagram,
}));
vi.mock("@/lib/discoverSources", async (original) => ({
  ...(await original<typeof import("@/lib/discoverSources")>()),
  localTikTokSource: fixture.tiktok,
}));
// Synthetic re-ranking stress: completed cards fall behind unread ones. The real component
// and source hook must freeze their target instead of following evidence into offscreen cards.
vi.mock("@/lib/discoverRanking", async (original) => {
  const actual = await original<typeof import("@/lib/discoverRanking")>();
  return {
    ...actual,
    rankDiscoverItems: (...args: Parameters<typeof actual.rankDiscoverItems>) =>
      fixture.rerankOnEvidence
        ? {
            items: [...args[0]].sort(
              (a, b) => Number(!!a.evidence?.caption) - Number(!!b.evidence?.caption),
            ),
          }
        : actual.rankDiscoverItems(...args),
  };
});
vi.mock("@/store", () => ({
  getApiKey: () => "",
  useStore: (select: (state: typeof fixture.store) => unknown) => select(fixture.store),
}));
vi.mock("@/lib/i18n", () => ({
  useT: () => ({ lang: "en", t: (key: string) => key, L: (value: { en: string }) => value.en }),
}));
vi.mock("./BrowseCategoryFeed", () => ({ default: () => null }));
vi.mock("./ResultCard", () => ({
  default: ({ item }: { item: DiscoverItem }) =>
    createElement("li", {
      "data-testid": "native-result-card",
      "data-url": item.url,
      "data-caption": item.evidence?.caption,
      "data-observed": item.evidence?.observedAt,
    }),
}));
vi.mock("./SaveInspirationButton", () => ({ default: () => null }));
vi.mock("./CategoryTrends", () => ({
  useCategoryTrendsAvailable: () => false,
  default: () => null,
}));

const OBSERVED = "2026-10-13T17:00:00Z";
type Source = InstagramSource | TikTokSource | null;
type Read = {
  platform: "ig" | "tt";
  url: string;
  signal?: AbortSignal;
  settled: boolean;
  resolve: () => void;
};
let reads: Read[];
let inFlight: number;
let maxInFlight: number;
let host: HTMLDivElement;
let root: Root;
let props: Parameters<typeof CategoryDiscovery>[0];

function snapshot(counts: { ig?: number; tt?: number; yt?: number }): NativeSearchSnapshot {
  return {
    jobId: "native-anime",
    status: "complete",
    hasMore: false,
    genreId: "anime",
    queries: { ig: "anime edit", tt: "anime edit", yt: "anime edit" },
    cached: true,
    asOf: OBSERVED,
    platforms: Object.fromEntries(
      Object.entries(counts).map(([platform, count]) => [
        platform,
        {
          status: "done",
          searchUrl: "https://example.com/search",
          results: Array.from({ length: count }, (_, index) => ({
            platform,
            url:
              platform === "ig"
                ? `https://www.instagram.com/p/${instagramShortcodeAt(new Date("2026-10-12T17:00:00Z"), index)}/`
                : platform === "tt"
                  ? `https://www.tiktok.com/@creator${index}/video/${BigInt("7600000000000000000") + BigInt(index)}`
                  : `https://www.youtube.com/watch?v=YT${String(index).padStart(9, "0")}`,
            title: `Native ${platform} ${index}`,
            position: index + 1,
            observedAt: OBSERVED,
          })),
        },
      ]),
    ),
  };
}

function request(platform: "ig" | "tt", url: string, signal?: AbortSignal): Promise<Source> {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      inFlight--;
    }
  };
  signal?.addEventListener("abort", release, { once: true });
  return new Promise((resolve) => {
    const read: Read = {
      platform,
      url,
      signal,
      settled: false,
      resolve() {
        if (read.settled) return;
        read.settled = true;
        release();
        const common = {
          status: "available" as const,
          url,
          author: "editor",
          observedAt: fixture.sourceObservedAt,
          ...(fixture.popularReads ? { published: "2026-10-12T17:00:00Z" } : {}),
        };
        resolve(
          fixture.nullReads
            ? null
            : platform === "tt"
              ? {
                  ...common,
                  caption: fixture.popularReads
                    ? "Anime split screen beat sync edit"
                    : `Caption ${url}`,
                  provenance: "tiktok-public-page",
                  likes: 1234,
                }
              : {
                  ...common,
                  title: "Actual edit",
                  description: fixture.popularReads
                    ? "Anime split screen beat sync edit"
                    : `Caption ${url}`,
                  thumbnailUrl: "",
                  provenance: "instagram-public-embed",
                  likes: 1234,
                },
        );
      },
    };
    reads.push(read);
  });
}
const render = () => act(() => root.render(createElement(CategoryDiscovery, props)));
const cards = () =>
  Array.from(host.querySelectorAll<HTMLElement>('[data-testid="native-result-card"]'));
const click = (testId: string) =>
  act(() => host.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!.click());
const more = () => click("native-search-more");
async function drain() {
  for (let step = 0; step < 100; step++) {
    const pending = reads.filter((read) => !read.settled && !read.signal?.aborted);
    if (!pending.length) return;
    await act(async () => pending.forEach((read) => read.resolve()));
  }
  throw new Error("Source requests did not settle within the bounded test budget");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reads = [];
  fixture.nullReads = false;
  fixture.popularReads = false;
  fixture.sourceObservedAt = OBSERVED;
  fixture.rerankOnEvidence = false;
  inFlight = 0;
  maxInFlight = 0;
  fixture.instagram.mockReset().mockImplementation((url, signal) => request("ig", url, signal));
  fixture.tiktok.mockReset().mockImplementation((url, signal) => request("tt", url, signal));
  fixture.native = {
    ready: true,
    connection: "connected",
    snapshot: snapshot({ ig: 36, tt: 44, yt: 47 }),
    busy: false,
    canMore: false,
    canAutoMore: false,
    search: vi.fn(),
    more: vi.fn(),
    cancel: vi.fn(),
    reconnect: vi.fn(),
  };
  props = {
    genre: GENRES.find((genre) => genre.id === "anime")!,
    genres: GENRES,
    active: true,
    onBack: vi.fn(),
    onCategory: vi.fn(),
    onOpenInspiration: vi.fn(),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const popular = () =>
  act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "feed.popular")!
      .click(),
  );

it.each(["ig", "tt"] as const)(
  "checks a finite candidate page when Popular is selected before %s details arrive",
  async (platform) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(OBSERVED));
    fixture.popularReads = true;
    fixture.native!.snapshot = snapshot({ [platform]: 60 });
    render();
    popular();
    expect(host.textContent).toContain("feed.checking");
    await drain();
    expect(cards()).toHaveLength(24);
    expect(reads.filter((read) => read.settled)).toHaveLength(24);
    render();
    await drain();
    expect(reads.filter((read) => read.settled)).toHaveLength(24);
    expect(maxInFlight).toBe(2);
  },
);

it("checks incoming Popular candidates in explicit finite pages after native continuation", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(OBSERVED));
  fixture.popularReads = true;
  fixture.native!.snapshot = snapshot({ tt: 24 });
  fixture.native!.canMore = true;
  render();
  await drain();
  popular();
  await drain();
  more();
  expect(fixture.native!.more).toHaveBeenCalledOnce();
  fixture.native!.snapshot = snapshot({ tt: 60 });
  fixture.native!.canMore = false;
  render();
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(48);
  expect(cards()).toHaveLength(48);
  render();
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(48);
  more();
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(60);
  expect(cards()).toHaveLength(60);
  expect(maxInFlight).toBe(2);
});

it("allows checking the next Popular candidate page when the first page has no matches", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(OBSERVED));
  fixture.native!.snapshot = snapshot({ ig: 48 });
  render();
  await drain();
  popular();
  await drain();
  expect(cards()).toHaveLength(0);
  expect(host.querySelector('[data-testid="native-search-more"]')).not.toBeNull();
  fixture.popularReads = true;
  more();
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(48);
  expect(cards()).toHaveLength(24);
});

it("ranks new Popular source observations using their actual time after a long visit", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(OBSERVED));
  fixture.popularReads = true;
  fixture.native!.snapshot = snapshot({ tt: 48 });
  render();
  await drain();
  const later = new Date(Date.parse(OBSERVED) + 6 * 60_000);
  vi.setSystemTime(later);
  fixture.sourceObservedAt = later.toISOString();
  more();
  await drain();
  popular();
  await drain();
  expect(cards()).toHaveLength(48);
  expect(reads.filter((read) => read.settled)).toHaveLength(48);
});

it.each(["first", "second"])(
  "finishes visible metadata after all reveals made during the %s batch",
  async (batch) => {
    const order = nativeResultsToItems(fixture.native!.snapshot, "en").map((item) => item.url);
    render();
    if (batch === "second") {
      await drain();
      expect(reads).toHaveLength(16);
    }
    more();
    more();
    more();
    more();
    more(); // The final reveal leaves no Load more control to retry a lost action.
    expect(cards()).toHaveLength(127);
    expect(host.querySelector('[data-testid="native-search-more"]')).toBeNull();
    await drain();
    expect(reads.filter((read) => read.settled)).toHaveLength(80);
    expect(reads.filter((read) => read.platform === "ig" && read.settled)).toHaveLength(36);
    expect(reads.filter((read) => read.platform === "tt" && read.settled)).toHaveLength(44);
    expect(maxInFlight).toBe(2);
    expect(new Set(reads.filter((read) => read.settled).map((read) => read.url)).size).toBe(80);
    expect(cards().map((card) => card.dataset.url)).toEqual(order);
    expect(
      cards()
        .filter((card) => card.dataset.url?.includes("tiktok.com"))
        .every((card) => card.dataset.caption?.startsWith("Caption ")),
    ).toBe(true);
    expect(cards()[0].dataset.caption).toBe(`Caption ${reads[0].url}`);
    expect(cards()[0].dataset.observed).toBe(OBSERVED);
    render();
    await drain();
    expect(reads.filter((read) => read.settled)).toHaveLength(80);
    expect(fixture.native!.more).not.toHaveBeenCalled();
  },
);

it("finishes one busy reveal without draining untouched sources", async () => {
  fixture.native!.snapshot = snapshot({ tt: 120 });
  render();
  more();
  expect(cards()).toHaveLength(48);
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(48);
  expect(maxInFlight).toBe(2);
  render();
  render();
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(48);
});

it("finishes the final visible cards after rapid clicks without duplicate completed reads", async () => {
  fixture.native!.snapshot = snapshot({ tt: 60 });
  render();
  const button = host.querySelector<HTMLButtonElement>('[data-testid="native-search-more"]')!;
  act(() => {
    button.click(); // 24 -> 48
    button.click(); // 48 -> 60
    button.click(); // Already fully revealed, despite the stale rendered limit.
  });
  expect(cards()).toHaveLength(60);
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(60);
  expect(maxInFlight).toBe(2);
  render();
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(60);
});

it("finishes the initial 24 visible single-platform cards, then stops", async () => {
  fixture.native!.snapshot = snapshot({ tt: 60 });
  render();
  await drain();
  expect(reads).toHaveLength(24);
  expect(cards()).toHaveLength(24);
  expect(cards().every((card) => card.dataset.caption?.startsWith("Caption "))).toBe(true);
  render();
  await drain();
  expect(reads).toHaveLength(24);
  expect(maxInFlight).toBe(2);
});

it.each(["category", "tab", "reviewed", "inactive"] as const)(
  "cancels obsolete visible reads after a %s change",
  async (change) => {
    fixture.native!.snapshot = snapshot({ tt: 60 });
    render();
    more();
    const abandoned = reads.slice();
    if (change === "category")
      props = { ...props, genre: GENRES.find((genre) => genre.id === "travel")! };
    if (change === "tab") click("native-tab-ig");
    if (change === "reviewed") click("native-reviewed-view");
    if (change === "inactive") props = { ...props, active: false };
    render();
    await act(async () => abandoned.forEach((read) => read.resolve()));
    await drain();
    expect(abandoned.every((read) => read.signal?.aborted)).toBe(true);
    expect(reads).toHaveLength(abandoned.length);
    expect(maxInFlight).toBe(2);
  },
);

it("reads all newly visible native-More results while retaining completed evidence", async () => {
  fixture.native!.snapshot = snapshot({ tt: 24 });
  fixture.native!.canMore = true;
  render();
  await drain();
  more();
  expect(fixture.native!.more).toHaveBeenCalledOnce();
  fixture.native!.snapshot = snapshot({ tt: 60 });
  render();
  await drain();
  expect(cards()).toHaveLength(60);
  expect(reads).toHaveLength(60);
  expect(maxInFlight).toBe(2);
  expect(cards().every((card) => card.dataset.caption?.startsWith("Caption "))).toBe(true);
});

it("records failed reads once and stops at the requested visible set", async () => {
  fixture.native!.snapshot = snapshot({ tt: 60 });
  fixture.nullReads = true;
  render();
  await drain();
  expect(reads).toHaveLength(24);
  render();
  await drain();
  expect(reads).toHaveLength(24);
  more();
  await drain();
  expect(reads).toHaveLength(48);
  expect(new Set(reads.map((read) => read.url)).size).toBe(48);
});

it("does not chase evidence-driven Popular re-ranking into offscreen cards", async () => {
  fixture.native!.snapshot = snapshot({ tt: 60 });
  fixture.rerankOnEvidence = true;
  render();
  act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "feed.popular")!
      .click(),
  );
  const targets = cards().map((card) => card.dataset.url);
  await drain();
  expect(reads.filter((read) => read.settled).map((read) => read.url)).toEqual(
    expect.arrayContaining(targets),
  );
  expect(reads.filter((read) => read.settled)).toHaveLength(24);
  expect(cards().some((card) => !targets.includes(card.dataset.url))).toBe(true);
  render();
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(24);
});

it("can reveal again after revisiting a previously fully revealed platform tab", async () => {
  fixture.native!.snapshot = snapshot({ tt: 50 });
  render();
  click("native-tab-tt");
  more();
  more();
  expect(cards()).toHaveLength(50);
  click("native-tab-all");
  click("native-tab-tt");
  expect(cards()).toHaveLength(24);
  more();
  expect(cards()).toHaveLength(48);
  await drain();
  expect(reads.filter((read) => read.settled)).toHaveLength(48);
});

it.each(["query", "job"] as const)("cancels in-flight work for a replaced %s", async (change) => {
  fixture.native!.snapshot = snapshot({ tt: 60 });
  render();
  const old = reads.slice();
  fixture.native!.snapshot = {
    ...fixture.native!.snapshot!,
    ...(change === "query" ? { queries: { tt: "new search" } } : { jobId: "new job" }),
  };
  render();
  expect(old.every((read) => read.signal?.aborted)).toBe(true);
  await act(async () => old.forEach((read) => read.resolve()));
  expect(cards().every((card) => !card.dataset.caption)).toBe(true);
  await drain();
  expect(reads.filter((read) => read.settled && !read.signal?.aborted)).toHaveLength(24);
  expect(maxInFlight).toBe(2);
});
