// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import type { Genre } from "@/lib/domain";
import type { NativeResult, NativeSearchSnapshot } from "@/lib/discoverNativeSearch";
import feedEn from "@/messages/feed.en.json";
import searchEn from "@/messages/search.en.json";
import type { NativeSearchState } from "./useNativeSearch";
import NativeKeywordResults from "./NativeKeywordResults";

const fixture = vi.hoisted(() => ({
  native: null as NativeSearchState | null,
  genres: [] as Genre[],
  selections: [] as { visibleUrls: string[] }[],
  store: { settings: { discover: { editorScope: "mine" as "mine" | "all" } } },
}));
vi.mock("./useNativeSearch", () => ({
  useNativeSearch: ({ genre }: { genre: Genre }) => {
    fixture.genres.push(genre);
    return fixture.native;
  },
}));
vi.mock("./useFeedSources", () => ({
  useFeedSources: (
    items: DiscoverItem[],
    _active: boolean,
    _key: string,
    selection: { visibleUrls: string[] },
  ) => {
    fixture.selections.push(selection);
    return { items, checking: false };
  },
}));
vi.mock("@/store", () => ({
  getApiKey: () => "",
  useStore: (select: (state: typeof fixture.store) => unknown) => select(fixture.store),
}));
vi.mock("@/lib/i18n", () => ({
  useT: () => ({
    lang: "en",
    t: (key: string, vars?: Record<string, string | number>) => {
      const dictionary: Record<string, string> = { ...feedEn, ...searchEn };
      return (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
        String(vars?.[name] ?? match),
      );
    },
    L: (value: { en: string }) => value.en,
  }),
}));
vi.mock("./ResultCard", () => ({
  default: ({ item, testId, action }: { item: DiscoverItem; testId: string; action: ReactNode }) =>
    createElement("li", { "data-testid": testId, "data-url": item.url }, item.title, action),
}));
vi.mock("./SaveInspirationButton", () => ({
  default: () => createElement("span", { "data-testid": "save-inspiration" }),
}));

let host: HTMLDivElement;
let root: Root;
let props: Parameters<typeof NativeKeywordResults>[0];
const render = () => act(() => root.render(createElement(NativeKeywordResults, props)));
const $ = <T extends HTMLElement = HTMLElement>(testId: string) =>
  host.querySelector<T>(`[data-testid="${testId}"]`);
const cards = () =>
  [...host.querySelectorAll<HTMLElement>('[data-testid="native-keyword-card"]')].map(
    (card) => card.dataset.url,
  );
const click = (testId: string) => act(() => $(testId)!.click());

const at = new Date().toISOString();
const ig = (n: number, title = `ig ${n}`): NativeResult => ({
  platform: "ig",
  url: `https://www.instagram.com/p/Keyword${String(n).padStart(4, "0")}/`,
  title,
  position: n,
  observedAt: at,
});
const tt = (n: number, title = `tt ${n}`): NativeResult => ({
  platform: "tt",
  url: `https://www.tiktok.com/@editor/video/769000000000000${String(n).padStart(4, "0")}`,
  title,
  position: n,
  observedAt: at,
});
const yt = (n: number): NativeResult => ({
  platform: "yt",
  url: `https://www.youtube.com/watch?v=keyword${String(n).padStart(4, "0")}`,
  title: `yt ${n}`,
  position: n,
  observedAt: at,
});
function snapshot(
  platforms: NativeSearchSnapshot["platforms"],
  query = "match cut",
): NativeSearchSnapshot {
  return {
    jobId: "keyword-job",
    status: "complete",
    hasMore: true,
    genreId: "search",
    queries: { ig: query, tt: query, yt: query },
    cached: false,
    asOf: at,
    platforms,
  };
}
const done = (platform: "ig" | "tt" | "yt", results: NativeResult[]) => ({
  status: "done" as const,
  results,
  searchUrl:
    platform === "ig"
      ? "https://www.instagram.com/explore/search/keyword/?q=match%20cut"
      : platform === "tt"
        ? "https://www.tiktok.com/search?q=match%20cut"
        : "https://www.youtube.com/results?search_query=match%20cut",
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fixture.native = {
    ready: true,
    connection: "connected",
    snapshot: null,
    busy: false,
    canMore: false,
    canAutoMore: true,
    search: vi.fn(),
    more: vi.fn(),
    cancel: vi.fn(),
    reconnect: vi.fn(),
  };
  fixture.genres = [];
  fixture.selections = [];
  fixture.store.settings.discover.editorScope = "mine";
  props = { query: "match cut", active: true, onOpenInspiration: vi.fn() };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("searches the typed effect once on all three apps through a separate Search scope", () => {
  render();
  expect(fixture.native!.search).toHaveBeenCalledTimes(1);
  expect(fixture.native!.search).toHaveBeenCalledWith(
    {
      ig: "match cut",
      tt: "match cut",
      yt: "match cut",
    },
    { deep: false },
  );
  expect(fixture.genres.at(-1)).toMatchObject({
    id: "search",
    queries: { en: ["match cut"], ar: ["match cut"] },
  });
  render();
  expect(fixture.native!.search).toHaveBeenCalledTimes(1);
  props = { ...props, query: "velocity edit" };
  render();
  expect(fixture.native!.search).toHaveBeenCalledTimes(2);
  expect(fixture.native!.search).toHaveBeenLastCalledWith(
    {
      ig: "velocity edit",
      tt: "velocity edit",
      yt: "velocity edit",
    },
    { deep: false },
  );
});

it("waits for the helper and its cache read, and shows nothing without a connection", () => {
  fixture.native = { ...fixture.native!, connection: "checking" };
  render();
  expect(fixture.native.search).not.toHaveBeenCalled();
  expect($("native-keyword-results")).toBeNull();
  fixture.native = { ...fixture.native, connection: "connected", ready: false };
  render();
  expect(fixture.native.search).not.toHaveBeenCalled();
  fixture.native = { ...fixture.native, ready: true };
  render();
  expect(fixture.native.search).toHaveBeenCalledTimes(1);
});

it("lists the apps' own results in their native order, interleaved on All, one app per tab", () => {
  fixture.native!.snapshot = snapshot({
    ig: done("ig", [ig(1), ig(2)]),
    tt: done("tt", [tt(1), tt(2)]),
    yt: done("yt", [yt(1)]),
  });
  render();
  expect($("native-keyword-results")!.textContent).toContain("From Instagram, TikTok and YouTube");
  expect(cards()).toEqual([ig(1).url, tt(1).url, yt(1).url, ig(2).url, tt(2).url]);
  expect(host.querySelectorAll('[data-testid="save-inspiration"]')).toHaveLength(5);
  expect($("native-keyword-tab-all")!.dataset.count).toBe("5");
  click("native-keyword-tab-tt");
  expect(cards()).toEqual([tt(1).url, tt(2).url]);
});

it("hides other editing apps’ cards, says how many, and keeps the order of the rest", () => {
  fixture.native!.snapshot = snapshot({
    ig: done("ig", [ig(1), ig(2, "Alight Motion shake")]),
    tt: done("tt", [tt(1, "After Effects match cut tutorial"), tt(2, "CapCut vs After Effects")]),
  });
  render();
  expect(cards()).toEqual([ig(1).url, tt(2).url]);
  expect($("native-keyword-hidden-editors")!.textContent).toBe("2 hidden · other editing apps");
  fixture.store.settings.discover.editorScope = "all";
  render();
  expect(cards()).toEqual([ig(1).url, tt(1).url, ig(2).url, tt(2).url]);
  expect($("native-keyword-hidden-editors")).toBeNull();
});

it("shows each app's status with its stale label and never another query's cards", () => {
  fixture.native!.snapshot = snapshot({
    ig: done("ig", [ig(1)]),
    tt: { ...done("tt", [tt(1)]), status: "error", staleAsOf: at },
    yt: { ...done("yt", []), status: "loading" },
  });
  render();
  const status = $("native-keyword-status")!.textContent;
  expect(status).toContain("Instagram · received");
  expect(status).toContain("TikTok · couldn’t read — open search");
  expect(status).toContain("YouTube · loading");
  expect($("native-keyword-stale-tt")).not.toBeNull();
  fixture.native!.snapshot = snapshot({ ig: done("ig", [ig(1)]) }, "old query");
  render();
  expect(cards()).toEqual([]);
});

it("reveals 24 cards at a time, checks sources for what is shown, then asks the apps for more", () => {
  fixture.native!.snapshot = snapshot({
    ig: done(
      "ig",
      Array.from({ length: 30 }, (_, index) => ig(index + 1)),
    ),
  });
  fixture.native!.canMore = true;
  render();
  expect(cards()).toHaveLength(24);
  expect(fixture.selections.at(-1)!.visibleUrls).toHaveLength(24);
  click("native-keyword-more");
  expect(cards()).toHaveLength(30);
  expect(fixture.selections.at(-1)!.visibleUrls).toHaveLength(30);
  expect(fixture.native!.more).not.toHaveBeenCalled();
  click("native-keyword-more");
  expect(fixture.native!.more).toHaveBeenCalledTimes(1);
});

it("uses its own editor section scope and heading", () => {
  props = { ...props, query: "clone effect capcut", scope: "search-capcut", heading: "CapCut" };
  render();
  expect(fixture.genres.at(-1)).toMatchObject({ id: "search-capcut" });
  expect(fixture.native!.search).toHaveBeenCalledWith(
    {
      ig: "clone effect capcut",
      tt: "clone effect capcut",
      yt: "clone effect capcut",
    },
    { deep: false },
  );
  fixture.native!.snapshot = {
    ...snapshot({ ig: done("ig", [ig(1)]) }, "clone effect capcut"),
    genreId: "search-capcut",
  };
  render();
  expect($("native-keyword-results")!.querySelector("h2")!.textContent).toBe("CapCut");
  expect($("native-keyword-results")!.dataset.scope).toBe("search-capcut");
});

it("waits for its turn: no search or more while another section's job runs, and reports its own job", () => {
  const onBusy = vi.fn();
  props = { ...props, canStart: false, onBusy };
  render();
  expect(fixture.native!.search).not.toHaveBeenCalled();
  expect(onBusy).toHaveBeenLastCalledWith("search", false, "0|match cut");
  props = { ...props, canStart: true };
  render();
  expect(fixture.native!.search).toHaveBeenCalledTimes(1);
  fixture.native = { ...fixture.native!, busy: true };
  render();
  expect(onBusy).toHaveBeenLastCalledWith("search", true, "0|match cut");

  fixture.native = {
    ...fixture.native,
    busy: false,
    canMore: true,
    snapshot: snapshot({ ig: done("ig", [ig(1)]) }),
  };
  props = { ...props, canStart: false };
  render();
  expect($<HTMLButtonElement>("native-keyword-more")!.disabled).toBe(true);
  click("native-keyword-more");
  expect(fixture.native.more).not.toHaveBeenCalled();
  props = { ...props, canStart: true };
  render();
  click("native-keyword-more");
  expect(fixture.native.more).toHaveBeenCalledTimes(1);
});

it("asks for a deep job only when the panel's Deep search started this section", () => {
  props = { ...props, deep: true };
  render();
  expect(fixture.native!.search).toHaveBeenCalledExactlyOnceWith(
    { ig: "match cut", tt: "match cut", yt: "match cut" },
    { deep: true },
  );
});

it("asks Instagram for its own DaVinci query while TikTok and YouTube keep the section's", () => {
  props = {
    ...props,
    query: "clone effect davinci resolve",
    igQuery: "clone effect davinci",
    scope: "search-davinci",
    heading: "DaVinci Resolve",
  };
  render();
  expect(fixture.native!.search).toHaveBeenCalledExactlyOnceWith(
    {
      ig: "clone effect davinci",
      tt: "clone effect davinci resolve",
      yt: "clone effect davinci resolve",
    },
    { deep: false },
  );
  fixture.native!.snapshot = {
    ...snapshot(
      { ig: done("ig", [ig(1)]), tt: done("tt", [tt(1)]) },
      "clone effect davinci resolve",
    ),
    genreId: "search-davinci",
    queries: {
      ig: "clone effect davinci",
      tt: "clone effect davinci resolve",
      yt: "clone effect davinci resolve",
    },
  };
  render();
  expect(cards()).toEqual([ig(1).url, tt(1).url]);
});

it("says an app had no videos for this exact search only when its own No results screen showed", () => {
  fixture.native!.snapshot = snapshot({
    ig: { ...done("ig", []), status: "empty", noResults: true },
    tt: { ...done("tt", []), status: "empty" },
    yt: { ...done("yt", []), status: "error", error: "search-timeout" },
  });
  render();
  const status = $("native-keyword-status")!.textContent;
  expect(status).toContain("Instagram · no videos for this exact search — open search");
  expect(status).toContain("TikTok · no cards read — open search");
  expect(status).toContain("YouTube · couldn’t read — open search");
});

it("says once when a Deep search could not load more because Discover was not in front", () => {
  fixture.native!.snapshot = snapshot({ ig: done("ig", [ig(1)]), tt: done("tt", [tt(1)]) });
  render();
  expect($("native-keyword-deep-skipped")).toBeNull();
  fixture.native!.snapshot = { ...fixture.native!.snapshot!, deepSkipped: "window-not-focused" };
  render();
  expect($("native-keyword-deep-skipped")!.textContent).toBe(
    "Deep search needs Discover in front to load more — showing normal results.",
  );
  expect(cards()).toEqual([ig(1).url, tt(1).url]);
});
