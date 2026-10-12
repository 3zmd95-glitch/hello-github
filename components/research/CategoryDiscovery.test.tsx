// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GENRES } from "@/data/genres";
import type { DiscoverItem } from "@/lib/discover";
import type { NativeSearchSnapshot } from "@/lib/discoverNativeSearch";
import feedEn from "@/messages/feed.en.json";
import feedAr from "@/messages/feed.ar.json";
import type { NativeSearchState } from "./useNativeSearch";
import CategoryDiscovery from "./CategoryDiscovery";

const fixture = vi.hoisted(() => ({
  native: null as NativeSearchState | null,
  lang: "en" as "en" | "ar",
  store: {
    accumulateDiscoverCandidates: vi.fn(),
    discoverFeedback: [],
    discoverCandidates: [],
  },
}));
vi.mock("./useNativeSearch", () => ({ useNativeSearch: () => fixture.native }));
vi.mock("./useFeedSources", () => ({ useFeedSources: (items: DiscoverItem[]) => ({ items }) }));
vi.mock("@/store", () => ({
  getApiKey: () => "",
  useStore: (select: (state: typeof fixture.store) => unknown) => select(fixture.store),
}));
vi.mock("@/lib/i18n", () => ({
  useT: () => ({
    lang: fixture.lang,
    t: (key: string, vars?: Record<string, string | number>) => {
      const dictionary: Record<string, string> = fixture.lang === "ar" ? feedAr : feedEn;
      return (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
        String(vars?.[name] ?? match),
      );
    },
    L: (value: { en: string }) => value.en,
  }),
}));
vi.mock("./BrowseCategoryFeed", () => ({
  default: () => createElement("div", { "data-testid": "checked-references-fixture" }),
}));
vi.mock("./ResultCard", () => ({
  default: ({ item }: { item: DiscoverItem }) =>
    createElement("li", { "data-testid": "native-result-card", "data-url": item.url }, item.title),
}));
vi.mock("./SaveInspirationButton", () => ({ default: () => null }));

const anime = GENRES.find((genre) => genre.id === "anime")!;
const travel = GENRES.find((genre) => genre.id === "travel")!;
let host: HTMLDivElement;
let root: Root;
let props: Parameters<typeof CategoryDiscovery>[0];
const render = () => act(() => root.render(createElement(CategoryDiscovery, props)));
const selectView = (view: "native-search-view" | "native-reviewed-view") =>
  act(() => host.querySelector<HTMLButtonElement>(`[data-testid="${view}"]`)!.click());
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.native = {
    ready: true,
    connection: "connected",
    snapshot: null,
    busy: false,
    canMore: false,
    search: vi.fn(),
    more: vi.fn(),
    cancel: vi.fn(),
    reconnect: vi.fn(),
  };
  fixture.lang = "en";
  props = {
    genre: anime,
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

function loadedSnapshot(count: number, omittedCount = 0): NativeSearchSnapshot {
  return {
    jobId: "native-anime",
    status: "complete",
    hasMore: true,
    genreId: "anime",
    queries: { ig: "anime edit" },
    cached: false,
    asOf: new Date().toISOString(),
    platforms: {
      ig: {
        status: "done",
        searchUrl: "https://www.instagram.com/explore/search/keyword/?q=anime",
        omittedCount,
        results: Array.from({ length: count }, (_, index) => ({
          platform: "ig",
          url: `https://www.instagram.com/p/Native${String(index + omittedCount).padStart(5, "0")}/`,
          title: `Native video ${index + omittedCount}`,
          position: index + 1,
          observedAt: new Date().toISOString(),
        })),
      },
    },
  };
}
const cards = () => host.querySelectorAll('[data-testid="native-result-card"]');
const loadMore = () =>
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-search-more"]')!.click());

it("uses one load-more action for local cards then reveals every newly fetched and rolling card", () => {
  fixture.native!.snapshot = loadedSnapshot(30);
  fixture.native!.canMore = true;
  render();
  expect(cards()).toHaveLength(24);
  expect(host.querySelectorAll('[data-testid="native-search-more"]')).toHaveLength(1);
  loadMore();
  expect(cards()).toHaveLength(30);
  expect(fixture.native!.more).not.toHaveBeenCalled();
  loadMore();
  expect(fixture.native!.more).toHaveBeenCalledOnce();
  fixture.native!.snapshot = loadedSnapshot(60);
  render();
  expect(cards()).toHaveLength(60);
  fixture.native!.snapshot = loadedSnapshot(300);
  render();
  loadMore();
  fixture.native!.snapshot = loadedSnapshot(300, 30);
  render();
  expect(cards()).toHaveLength(300);
  expect(cards()[0].getAttribute("data-url")).toContain("Native00030");
  expect(cards()[299].getAttribute("data-url")).toContain("Native00329");
  expect(host.querySelector('[data-testid="native-loaded-summary"]')!.textContent).toBe(
    "Showing 300 of 300 loaded videos.",
  );
  expect(host.querySelector('[data-testid="native-window-note"]')!.textContent).toBe(
    feedEn["feed.connectedWindow"],
  );
  fixture.lang = "ar";
  render();
  expect(host.querySelector('[data-testid="native-window-note"]')!.textContent).toBe(
    feedAr["feed.connectedWindow"],
  );
  expect(fixture.native!.more).toHaveBeenCalledTimes(2);
});

it("distinguishes popular matches from loaded videos and returns to all native results", () => {
  fixture.native!.snapshot = loadedSnapshot(30);
  render();
  act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === feedEn["feed.popular"])!
      .click(),
  );
  expect(cards()).toHaveLength(0);
  expect(host.querySelector('[data-testid="native-loaded-summary"]')!.textContent).toBe(
    "Showing 0 popular matches from 30 loaded videos.",
  );
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-tab-tt"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-show-all"]')!.click());
  expect(host.querySelector('[data-testid="native-tab-all"]')!.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(cards()).toHaveLength(24);
  expect(host.querySelector('[data-testid="native-loaded-summary"]')!.textContent).toBe(
    "Showing 24 of 30 loaded videos.",
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
});

it("waits for the Native search view before searching a newly selected category", () => {
  render();
  expect(fixture.native!.search).toHaveBeenCalledOnce();
  selectView("native-reviewed-view");
  expect(host.querySelector('[data-testid="checked-references-fixture"]')).not.toBeNull();
  props = { ...props, genre: travel };
  render();
  expect(fixture.native!.search).toHaveBeenCalledOnce();
  expect(fixture.native!.cancel).not.toHaveBeenCalled();
  selectView("native-search-view");
  expect(fixture.native!.search).toHaveBeenLastCalledWith({
    ig: travel.queries.en[0],
    tt: travel.queries.en[0],
    yt: travel.queries.en[0],
  });
  expect(fixture.native!.search).toHaveBeenCalledTimes(2);
  selectView("native-reviewed-view");
  selectView("native-search-view");
  expect(fixture.native!.search).toHaveBeenCalledTimes(2);
  expect(fixture.native!.cancel).not.toHaveBeenCalled();
});

it("does not open native searches when cache hydration finishes in Checked references", () => {
  fixture.native!.ready = false;
  render();
  selectView("native-reviewed-view");
  fixture.native = { ...fixture.native!, ready: true };
  render();
  expect(fixture.native.search).not.toHaveBeenCalled();
  selectView("native-search-view");
  expect(fixture.native.search).toHaveBeenCalledExactlyOnceWith({
    ig: anime.queries.en[0],
    tt: anime.queries.en[0],
    yt: anime.queries.en[0],
  });
});
