// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GENRES } from "@/data/genres";
import type { DiscoverItem } from "@/lib/discover";
import type { NativeSearchState } from "./useNativeSearch";
import CategoryDiscovery from "./CategoryDiscovery";

const fixture = vi.hoisted(() => ({
  native: null as NativeSearchState | null,
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
  useT: () => ({ lang: "en", t: (key: string) => key, L: (value: { en: string }) => value.en }),
}));
vi.mock("./BrowseCategoryFeed", () => ({
  default: () => createElement("div", { "data-testid": "checked-references-fixture" }),
}));
vi.mock("./ResultCard", () => ({ default: () => null }));
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
