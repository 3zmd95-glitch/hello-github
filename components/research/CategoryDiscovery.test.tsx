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
  checkRemaining: vi.fn(),
  store: {
    accumulateDiscoverCandidates: vi.fn(),
    discoverFeedback: [],
    discoverCandidates: [],
    settings: { discover: { editorScope: "mine" as "mine" | "all" } },
  },
}));
vi.mock("./useNativeSearch", () => ({ useNativeSearch: () => fixture.native }));
vi.mock("./useFeedSources", () => ({
  useFeedSources: (items: DiscoverItem[]) => ({ items, checkRemaining: fixture.checkRemaining }),
}));
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
    canAutoMore: true,
    search: vi.fn(),
    more: vi.fn(),
    cancel: vi.fn(),
    reconnect: vi.fn(),
  };
  fixture.lang = "en";
  fixture.checkRemaining.mockReset();
  fixture.store.settings.discover.editorScope = "mine";
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

function observeScrolling() {
  const instances: { intersect(visible: boolean): void; disconnect: ReturnType<typeof vi.fn> }[] =
    [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      target?: Element;
      disconnect = vi.fn();
      constructor(private callback: IntersectionObserverCallback) {
        instances.push(this);
      }
      observe(target: Element) {
        this.target = target;
      }
      intersect(visible: boolean) {
        this.callback(
          [{ target: this.target!, isIntersecting: visible } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        );
      }
    },
  );
  return instances;
}
const wheelDown = () => act(() => window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 })));

it("continues after revealing more cards near the end, but never loops on a batch with no growth", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(30);
  fixture.native!.canMore = true;
  render();
  const observer = observers.at(-1)!;
  act(() => observer.intersect(true));
  expect(cards()).toHaveLength(24);
  wheelDown();
  expect(cards()).toHaveLength(30);
  expect(fixture.native!.more).not.toHaveBeenCalled();
  act(() => observer.intersect(true));
  // Newly revealed local cards can continue into a native fetch without another gesture.
  expect(fixture.native!.more).toHaveBeenCalledOnce();
  fixture.native = { ...fixture.native!, busy: true, canMore: false };
  render();
  wheelDown();
  wheelDown();
  fixture.native = { ...fixture.native!, busy: false, canMore: true };
  render(); // A completed request with no growth must not chain another request.
  act(() => observer.intersect(true));
  expect(fixture.native.more).toHaveBeenCalledOnce();
  wheelDown();
  expect(fixture.native.more).toHaveBeenCalledTimes(2);
});

it("continues successive new batches in the same category without another gesture", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(12);
  fixture.native!.canMore = true;
  render();
  const observer = observers.at(-1)!;
  act(() => observer.intersect(true));
  expect(fixture.native!.more).not.toHaveBeenCalled();
  wheelDown();
  for (let batch = 1; batch <= 3; batch++) {
    expect(fixture.native!.more).toHaveBeenCalledTimes(batch);
    fixture.native = { ...fixture.native!, busy: true, canMore: false };
    render();
    expect(host.querySelector('[data-testid="native-scroll-loading"]')).not.toBeNull();
    // Removing/reflowing a loading row can move the browser's scroll anchor up;
    // that is not the reader reversing direction.
    scrollPageTo(600);
    scrollPageTo(580);
    wheelDown(); // Continuing to scroll while the request is in flight is not lost.
    fixture.native = {
      ...fixture.native!,
      snapshot: loadedSnapshot(12 + batch * 12),
      busy: false,
      canMore: true,
    };
    render();
    act(() => observer.intersect(true));
    expect(cards()).toHaveLength(12 + batch * 12);
  }
  expect(fixture.native!.more).toHaveBeenCalledTimes(4);
});

it("stops continuation when new cards move the bottom away or the reader scrolls up", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(12);
  fixture.native!.canMore = true;
  render();
  const observer = observers.at(-1)!;
  act(() => observer.intersect(true));
  wheelDown();
  fixture.native = { ...fixture.native!, busy: true, canMore: false };
  render();
  act(() => window.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 })));
  fixture.native = { ...fixture.native!, snapshot: loadedSnapshot(24), busy: false, canMore: true };
  render();
  act(() => observer.intersect(true));
  expect(fixture.native!.more).toHaveBeenCalledOnce();
  act(() => observer.intersect(false));
  wheelDown();
  expect(fixture.native!.more).toHaveBeenCalledOnce();
});

it("clears downward intent when the reader scrolls back up before reaching the end", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(24);
  fixture.native!.canMore = true;
  render();
  const observer = observers.at(-1)!;
  const wheelUp = () => act(() => window.dispatchEvent(new WheelEvent("wheel", { deltaY: -100 })));
  const press = (key: string, shiftKey = false) =>
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, shiftKey })));
  const reversals = [
    wheelUp,
    () => press("ArrowUp"),
    () => press("PageUp"),
    () => press("Home"),
    () => press(" ", true),
  ];
  for (const reverse of reversals) {
    act(() => observer.intersect(false)); // The marker is far away while the reader scrolls.
    wheelDown(); // Intent is remembered while the marker is still far away.
    reverse();
    act(() => observer.intersect(true));
    expect(fixture.native!.more).not.toHaveBeenCalled();
  }
  wheelDown(); // Control: continued downward input at the end still loads.
  expect(fixture.native!.more).toHaveBeenCalledOnce();
});

it("does not auto-load away from the bottom, in Popular, in Checked references, or after cleanup", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(30);
  fixture.native!.canMore = true;
  render();
  const first = observers.at(-1)!;
  wheelDown();
  expect(cards()).toHaveLength(24);
  act(() => first.intersect(true));
  expect(cards()).toHaveLength(30);
  act(() =>
    [...host.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === feedEn["feed.popular"])!
      .click(),
  );
  expect(first.disconnect).toHaveBeenCalledOnce();
  wheelDown();
  act(() => first.intersect(true));
  expect(fixture.native!.more).not.toHaveBeenCalled();
  selectView("native-reviewed-view");
  wheelDown();
  expect(fixture.native!.more).not.toHaveBeenCalled();
});

it("keeps manual loading available when automatic loading pauses after an error", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(24);
  fixture.native!.canMore = true;
  fixture.native!.error = "unavailable";
  render();
  act(() => observers.at(-1)!.intersect(true));
  wheelDown();
  expect(fixture.native!.more).not.toHaveBeenCalled();
  loadMore();
  expect(fixture.native!.more).toHaveBeenCalledOnce();
});

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
  expect(host.querySelector('[data-testid="native-loaded-summary"]')).toBeNull();
  expect(host.querySelector('[data-testid="native-window-note"]')).toBeNull();
  fixture.lang = "ar";
  render();
  expect(host.querySelector('[data-testid="native-window-note"]')).toBeNull();
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
  expect(host.querySelector('[data-testid="native-loaded-summary"]')).toBeNull();
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-tab-tt"]')!.click());
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-show-all"]')!.click());
  expect(host.querySelector('[data-testid="native-tab-all"]')!.getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(cards()).toHaveLength(24);
  expect(host.querySelector('[data-testid="native-loaded-summary"]')).toBeNull();
});

it("labels retained earlier cards without disguising the current platform failure", () => {
  fixture.native!.snapshot = loadedSnapshot(2);
  fixture.native!.snapshot.platforms.ig!.status = "error";
  fixture.native!.snapshot.platforms.ig!.staleAsOf = "2026-10-11T12:00:00.000Z";
  render();
  expect(cards()).toHaveLength(2);
  expect(host.querySelector('[data-testid="native-platform-status"]')!.textContent).toContain(
    feedEn["feed.connectedPlatformError"],
  );
  expect(host.querySelector('[data-testid="native-stale-ig"]')!.textContent).toContain(
    "showing earlier results from",
  );
});

it("says an app had no videos for this exact search when its No results screen showed", () => {
  fixture.native!.snapshot = loadedSnapshot(2);
  Object.assign(fixture.native!.snapshot.platforms.ig!, {
    status: "empty",
    results: [],
    noResults: true,
  });
  render();
  const status = host.querySelector('[data-testid="native-platform-status"]')!.textContent;
  expect(status).toContain(`Instagram · ${feedEn["feed.connectedPlatformNoResults"]}`);
  expect(feedEn["feed.connectedPlatformNoResults"]).toBe(
    "no videos for this exact search — open search",
  );
});
it("says when a Deep search could not load more because Discover was not in front", () => {
  fixture.native!.snapshot = loadedSnapshot(2);
  render();
  expect(host.querySelector('[data-testid="native-deep-skipped"]')).toBeNull();
  fixture.native!.snapshot = { ...loadedSnapshot(2), deepSkipped: "other-window" };
  render();
  expect(host.querySelector('[data-testid="native-deep-skipped"]')!.textContent).toBe(
    feedEn["feed.deepSkipped"],
  );
  expect(feedEn["feed.deepSkipped"]).toBe(
    "Deep search needs Discover in front to load more — showing normal results.",
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("category entry, view changes and late hydration never open source tabs", () => {
  render();
  expect(fixture.native!.search).not.toHaveBeenCalled();
  selectView("native-reviewed-view");
  props = { ...props, genre: travel };
  render();
  selectView("native-search-view");
  fixture.native = { ...fixture.native!, ready: false };
  render();
  fixture.native = { ...fixture.native!, ready: true };
  render();
  expect(fixture.native.search).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-search-run"]')!.click());
  expect(fixture.native.search).toHaveBeenCalledExactlyOnceWith(
    { ig: travel.queries.en[0], tt: travel.queries.en[0], yt: travel.queries.en[0] },
    { deep: false },
  );
});

// Packet 10: only reader input may arm automatic loading; a request (auto or manual) spends it.
const page = () => document.documentElement;
const scrollPageTo = (top: number) =>
  act(() => {
    page().scrollTop = top;
    document.dispatchEvent(new Event("scroll"));
  });
const settle = () => {
  fixture.native = { ...fixture.native!, busy: true, canMore: false };
  render();
  fixture.native = { ...fixture.native!, busy: false, canMore: true };
  render();
};
afterEach(() => {
  page().scrollTop = 0;
  localStorage.removeItem("3z-debug-native");
  delete (window as { __3zNativeLoads?: unknown }).__3zNativeLoads;
});

it("does not load when the page scrolls down without reader input (anchoring, scrollIntoView)", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(24);
  fixture.native!.canMore = true;
  render();
  act(() => observers.at(-1)!.intersect(true));
  scrollPageTo(600); // e.g. the status line above the grid grew and the browser kept the anchor.
  scrollPageTo(900);
  act(() => observers.at(-1)!.intersect(true));
  expect(fixture.native!.more).not.toHaveBeenCalled();
});

it("does not spend downward input from before a manual load once that load completes", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(24);
  fixture.native!.canMore = true;
  render();
  const observer = observers.at(-1)!;
  act(() => observer.intersect(false));
  wheelDown(); // Remembered while the marker is far away.
  loadMore();
  expect(fixture.native!.more).toHaveBeenCalledOnce();
  settle(); // The manual request finishes without growth.
  act(() => observer.intersect(true));
  expect(fixture.native!.more).toHaveBeenCalledOnce();
});

it("does not chain after a quiet automatic completion without new input", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(24);
  fixture.native!.canMore = true;
  render();
  const observer = observers.at(-1)!;
  act(() => observer.intersect(true));
  wheelDown();
  expect(fixture.native!.more).toHaveBeenCalledOnce();
  settle();
  act(() => observer.intersect(false));
  act(() => observer.intersect(true)); // e.g. the tab returns to the foreground.
  expect(fixture.native!.more).toHaveBeenCalledOnce();
});

it("still loads from keyboard, touch and a held scrollbar drag near the end", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(24);
  fixture.native!.canMore = true;
  render();
  const observer = observers.at(-1)!;
  const touch = (type: string, clientY: number) =>
    act(() => window.dispatchEvent(Object.assign(new Event(type), { touches: [{ clientY }] })));
  const inputs = [
    ...["ArrowDown", "PageDown", "End", " "].map(
      (key) => () => act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key }))),
    ),
    () => {
      touch("touchstart", 400);
      touch("touchmove", 300); // The finger moves up: the page scrolls down.
    },
    () => {
      act(() => page().dispatchEvent(new Event("pointerdown", { bubbles: true })));
      scrollPageTo(page().scrollTop + 300);
      act(() => page().dispatchEvent(new Event("pointerup", { bubbles: true })));
    },
  ];
  inputs.forEach((input, index) => {
    act(() => observer.intersect(true));
    input();
    expect(fixture.native!.more).toHaveBeenCalledTimes(index + 1);
    settle();
  });
  scrollPageTo(page().scrollTop + 300); // Released: a later programmatic scroll does not load.
  expect(fixture.native!.more).toHaveBeenCalledTimes(inputs.length);
});

it("keeps load diagnostics off unless the local debug flag is set", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = loadedSnapshot(24);
  fixture.native!.canMore = true;
  render();
  act(() => observers.at(-1)!.intersect(true));
  wheelDown();
  expect((window as { __3zNativeLoads?: unknown }).__3zNativeLoads).toBeUndefined();
  localStorage.setItem("3z-debug-native", "1");
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-tab-ig"]')!.click());
  act(() => observers.at(-1)!.intersect(true));
  wheelDown();
  const loads = (window as { __3zNativeLoads?: readonly Record<string, unknown>[] })
    .__3zNativeLoads!;
  expect(loads.at(-1)).toMatchObject({ origin: "wheel", near: true, started: true });
  expect(Object.keys(loads.at(-1)!).sort()).toEqual(
    ["busy", "intent", "near", "origin", "scrollTop", "started", "t"].sort(),
  );
  expect(Object.isFrozen(loads)).toBe(true);
});

it("reveals loaded cards before asking for another native batch", () => {
  fixture.native!.snapshot = loadedSnapshot(60);
  fixture.native!.canMore = true;
  render();
  loadMore();
  expect(cards()).toHaveLength(48);
  loadMore();
  expect(cards()).toHaveLength(60);
  expect(fixture.native!.more).not.toHaveBeenCalled();
  loadMore();
  expect(fixture.native!.more).toHaveBeenCalledOnce();
  expect(fixture.checkRemaining).not.toHaveBeenCalled();
});

it("keeps count diagnostics out of the displayed platform controls", () => {
  fixture.native!.snapshot = loadedSnapshot(60);
  render();
  const instagram = host.querySelector('[data-testid="native-tab-ig"]')!;
  expect(instagram.textContent).toBe("Instagram");
  expect(instagram.getAttribute("data-count")).toBe("60");
  expect(host.querySelector('[data-testid="native-platform-status"]')!.textContent).not.toContain(
    "60",
  );
});

// Packet 14: the 13 Oct audit showed broad "coffee edit" pulling a musician; Coffee starts with its specific query.
const queryBox = () =>
  host.querySelector<HTMLInputElement>('input[aria-label="Search all three apps"]')!;
it("offers the specific Coffee query without opening tabs until clicked", () => {
  props = { ...props, genre: GENRES.find((genre) => genre.id === "coffee")! };
  render();
  expect(fixture.native!.search).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-search-run"]')!.click());
  expect(fixture.native!.search).toHaveBeenCalledExactlyOnceWith(
    {
      ig: "coffee cinematic",
      tt: "coffee cinematic",
      yt: "coffee cinematic",
    },
    { deep: false },
  );
  expect(queryBox().value).toBe("coffee cinematic");
});

it("keeps a category outside the specific-query list on its first query", () => {
  render();
  expect(fixture.native!.search).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-search-run"]')!.click());
  expect(fixture.native!.search).toHaveBeenCalledExactlyOnceWith(
    {
      ig: "anime edit",
      tt: "anime edit",
      yt: "anime edit",
    },
    { deep: false },
  );
  expect(queryBox().value).toBe("anime edit");
});

const queriesFor = (query: string) => ({ ig: query, tt: query, yt: query });
function categorySnapshot(genreId: string, queries: NativeSearchSnapshot["queries"]) {
  return { ...loadedSnapshot(3), genreId, queries, cached: true };
}
function editQuery(value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      queryBox(),
      value,
    );
    queryBox().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it.each([
  ["coffee", "coffee edit", "coffee cinematic"],
  ["coffee", "cafe cinematic b-roll", "coffee cinematic"],
  ["camping", "camping edit", "desert cinematic video"],
  ["perfume", "perfume edit", "perfume cinematic ad"],
])("keeps the legacy %s cache without an automatic migration", (id, oldQuery) => {
  props = { ...props, genre: GENRES.find((genre) => genre.id === id)! };
  fixture.native!.snapshot = categorySnapshot(id, queriesFor(oldQuery));
  render();
  expect(queryBox().value).toBe(oldQuery);
  expect(cards()).toHaveLength(3);
  expect(fixture.native!.search).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-search-run"]')!.click());
  expect(fixture.native!.search).toHaveBeenCalledExactlyOnceWith(queriesFor(oldQuery), {
    deep: false,
  });
});

it.each([
  ["coffee", "coffee cinematic"],
  ["camping", "desert cinematic video"],
  ["perfume", "perfume cinematic ad"],
  ["coffee", "my own coffee lighting"],
  ["camping", "my desert road trip"],
  ["perfume", "bottle fluid simulation"],
  ["cars", "car edit"],
  ["anime", "anime edit"],
])("preserves current, custom and unaffected %s queries: %s", (id, query) => {
  props = { ...props, genre: GENRES.find((genre) => genre.id === id)! };
  fixture.native!.snapshot = categorySnapshot(id, queriesFor(query));
  render();
  expect(queryBox().value).toBe(query);
  expect(cards()).toHaveLength(3);
  expect(fixture.native!.search).not.toHaveBeenCalled();
});

it.each([
  { ig: "coffee edit" },
  { ig: "coffee edit", tt: "coffee slow motion", yt: "coffee edit" },
  { ig: "coffee edit", tt: "cafe cinematic b-roll", yt: "coffee edit" },
])("does not migrate partial or mixed custom platform searches", (queries) => {
  props = { ...props, genre: GENRES.find((genre) => genre.id === "coffee")! };
  fixture.native!.snapshot = categorySnapshot("coffee", queries);
  render();
  expect(fixture.native!.search).not.toHaveBeenCalled();
  expect(fixture.native!.snapshot?.queries).toEqual(queries);
  expect(queryBox().value).toBe(Object.keys(queries).length === 1 ? "coffee edit" : "");
});

it.each(["custom", "legacy"])(
  "waits for async cache hydration before resolving a %s query",
  (kind) => {
    props = { ...props, genre: GENRES.find((genre) => genre.id === "coffee")! };
    fixture.native!.ready = false;
    render();
    expect(fixture.native!.search).not.toHaveBeenCalled();
    const query = kind === "custom" ? "espresso macro filming" : "coffee edit";
    fixture.native = {
      ...fixture.native!,
      ready: true,
      snapshot: categorySnapshot("coffee", queriesFor(query)),
    };
    render();
    expect(queryBox().value).toBe(query);
    expect(fixture.native.search).not.toHaveBeenCalled();
  },
);

it.each(["disconnected", "busy", "inactive", "reviewed"])(
  "never starts a legacy migration after returning from %s",
  (state) => {
    props = {
      ...props,
      genre: GENRES.find((genre) => genre.id === "coffee")!,
      active: state !== "inactive",
    };
    fixture.native = {
      ...fixture.native!,
      snapshot: categorySnapshot("coffee", queriesFor("coffee edit")),
      connection: state === "disconnected" ? "missing" : "connected",
      busy: state === "busy",
      ready: state !== "reviewed",
    };
    render();
    if (state === "reviewed") {
      selectView("native-reviewed-view");
      fixture.native.ready = true;
      render();
    }
    expect(fixture.native.search).not.toHaveBeenCalled();
    fixture.native = { ...fixture.native, connection: "connected", busy: false, ready: true };
    props = { ...props, active: true };
    if (state === "reviewed") selectView("native-search-view");
    render();
    expect(fixture.native.search).not.toHaveBeenCalled();
    props = { ...props, active: false };
    render();
    props = { ...props, active: true };
    fixture.native = { ...fixture.native, connection: "missing", busy: true };
    render();
    fixture.native = { ...fixture.native, connection: "connected", busy: false };
    render();
    expect(fixture.native.search).not.toHaveBeenCalled();
    expect(queryBox().value).toBe("coffee edit"); // This fixture retains old results after a failed attempt.
  },
);

it("preserves an in-progress edit when the active custom cache arrives", () => {
  props = { ...props, genre: GENRES.find((genre) => genre.id === "coffee")! };
  fixture.native!.ready = false;
  render();
  editQuery("my unfinished espresso query");
  fixture.native = {
    ...fixture.native!,
    ready: true,
    snapshot: categorySnapshot("coffee", queriesFor("saved coffee montage")),
  };
  render();
  expect(queryBox().value).toBe("my unfinished espresso query");
  expect(fixture.native.search).not.toHaveBeenCalled();
  props = { ...props, genre: travel };
  fixture.native.snapshot = categorySnapshot("travel", queriesFor("custom roadtrip film"));
  render();
  expect(queryBox().value).toBe("custom roadtrip film");
});

it("does not replace a manual legacy query with an automatic migration", () => {
  props = { ...props, genre: GENRES.find((genre) => genre.id === "coffee")! };
  fixture.native!.ready = false;
  render();
  editQuery("coffee edit");
  act(() =>
    queryBox().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(fixture.native!.search).toHaveBeenCalledExactlyOnceWith(queriesFor("coffee edit"), {
    deep: false,
  });
  fixture.native = {
    ...fixture.native!,
    ready: true,
    snapshot: categorySnapshot("coffee", queriesFor("coffee edit")),
  };
  render();
  expect(queryBox().value).toBe("coffee edit");
  expect(fixture.native.search).toHaveBeenCalledOnce();
});

it("does not repeat a failed migration after visiting another category", () => {
  const coffee = GENRES.find((genre) => genre.id === "coffee")!;
  props = { ...props, genre: coffee };
  fixture.native!.snapshot = categorySnapshot("coffee", queriesFor("coffee edit"));
  render();
  expect(fixture.native!.search).not.toHaveBeenCalled();
  props = { ...props, genre: travel };
  fixture.native!.snapshot = categorySnapshot("travel", queriesFor("cinematic train journey"));
  render();
  expect(queryBox().value).toBe("cinematic train journey");
  props = { ...props, genre: coffee };
  fixture.native!.snapshot = categorySnapshot("coffee", queriesFor("coffee edit"));
  render();
  expect(queryBox().value).toBe("coffee edit");
  expect(fixture.native!.search).not.toHaveBeenCalled();
});

function mixedSnapshot(): NativeSearchSnapshot {
  const result = (platform: "ig" | "tt", id: string, title: string, position: number) => ({
    platform,
    url:
      platform === "tt"
        ? `https://www.tiktok.com/@maker/video/${id}`
        : `https://www.instagram.com/p/${id}/`,
    title,
    position,
    observedAt: new Date().toISOString(),
  });
  return {
    ...loadedSnapshot(0),
    queries: { ig: "anime edit", tt: "anime edit" },
    platforms: {
      ig: {
        status: "done",
        searchUrl: "https://www.instagram.com/explore/search/keyword/?q=anime",
        omittedCount: 0,
        results: [
          result("ig", "IgOne00001", "Anime edit one", 1),
          result("ig", "IgTwo00002", "Anime edit two", 2),
        ],
      },
      tt: {
        status: "done",
        searchUrl: "https://www.tiktok.com/search?q=anime",
        omittedCount: 0,
        results: [
          result("tt", "7000000000000000001", "Anime tutorial in After Effects", 1),
          result("tt", "7000000000000000002", "Anime edit three #capcut", 2),
        ],
      },
    },
  } as NativeSearchSnapshot;
}
const urls = () => [...cards()].map((card) => card.getAttribute("data-url"));
const hiddenLine = () => host.querySelector('[data-testid="native-hidden-editors"]');

it("hides a native card that mentions a hidden editor, keeps the rest in order, and says so", () => {
  fixture.native!.snapshot = mixedSnapshot();
  render();
  const shown = urls();
  expect(shown).toHaveLength(3);
  expect(shown.some((url) => url!.includes("7000000000000000001"))).toBe(false);
  expect(shown.filter((url) => url!.includes("instagram"))).toEqual([
    "https://www.instagram.com/p/IgOne00001/",
    "https://www.instagram.com/p/IgTwo00002/",
  ]);
  expect(hiddenLine()!.textContent).toBe("1 hidden · other editing apps");
  expect(host.querySelector('[data-testid="native-tab-all"]')!.getAttribute("data-count")).toBe(
    "3",
  );
  expect(host.querySelector('[data-testid="native-tab-tt"]')!.getAttribute("data-count")).toBe("1");
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="native-tab-ig"]')!.click());
  expect(hiddenLine()).toBeNull();
});

it("hides an Alight Motion card from the pool under DaVinci Resolve and CapCut only", () => {
  const snapshot = mixedSnapshot();
  snapshot.platforms.ig!.results[1].title = "Anime edit two in Alight Motion";
  fixture.native!.snapshot = snapshot;
  render();
  expect(urls().some((url) => url!.includes("IgTwo00002"))).toBe(false);
  expect(hiddenLine()!.textContent).toBe("2 hidden · other editing apps");
});

it("shows the hidden card again, with no line, when the setting is off", () => {
  fixture.store.settings.discover.editorScope = "all";
  fixture.native!.snapshot = mixedSnapshot();
  render();
  expect(urls()).toHaveLength(4);
  expect(urls().some((url) => url!.includes("7000000000000000001"))).toBe(true);
  expect(hiddenLine()).toBeNull();
});

it("says the hidden count in Arabic", () => {
  fixture.lang = "ar";
  fixture.native!.snapshot = mixedSnapshot();
  render();
  expect(hiddenLine()!.textContent).toBe("1 مخفي · برامج مونتاج ثانية");
});

it("opens tabs only through explicit background or show-source buttons", () => {
  render();
  expect(fixture.native!.search).not.toHaveBeenCalled();
  editQuery("anime amv");
  const deep = host.querySelector<HTMLButtonElement>('[data-testid="native-deep-search"]')!;
  expect(deep.textContent).toBe("Open and show source tabs");
  expect(deep.type).toBe("button");
  act(() => deep.click());
  expect(fixture.native!.search).toHaveBeenLastCalledWith(queriesFor("anime amv"), { deep: true });
  act(() =>
    queryBox().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(fixture.native!.search).toHaveBeenLastCalledWith(queriesFor("anime amv"), {
    deep: false,
  });
  expect(host.textContent).toContain(feedEn["feed.deepSearchHint"]);
});

it("scrolling reveals cached cards but waits for a button before opening source tabs", () => {
  const observers = observeScrolling();
  fixture.native!.snapshot = { ...loadedSnapshot(30), cached: true, deep: true };
  fixture.native!.canMore = true;
  fixture.native!.canAutoMore = false;
  render();
  act(() => window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 })));
  act(() => observers.at(-1)!.intersect(true));
  expect(cards()).toHaveLength(30);
  act(() => observers.at(-1)!.intersect(true));
  act(() => window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 })));
  expect(fixture.native!.more).not.toHaveBeenCalled();
  expect(fixture.native!.search).not.toHaveBeenCalled();
  const button = host.querySelector<HTMLButtonElement>('[data-testid="native-search-more"]')!;
  expect(button.textContent).toBe("Open source tabs for more");
  act(() => button.click());
  expect(fixture.native!.more).toHaveBeenCalledExactlyOnceWith({ automatic: false });
});
