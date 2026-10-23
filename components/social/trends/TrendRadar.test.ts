// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrendItemInput } from "@/lib/domain";
import { useStore } from "@/store";
import TrendRadar from "./TrendRadar";

// 🎬 The radar and the edit genres (round 31), rendered for real in jsdom: no Worker is configured, so nothing
// is fetched and the radar shows the feed the store already holds (as it does after a reload). Discover is the
// one place for genres: the radar has no genre select and filters by language tab and platform chip only, a
// row's genre chip is a plain chip (Discover is a Training route, tools/20), and the ⭐ is never given for a
// genre's own search words.

const SEEN_AT = new Date().toISOString();

const row = (over: Partial<TrendItemInput> & { id: string }): TrendItemInput => ({
  platform: "youtube",
  region: "SA",
  lang: "ar",
  title: over.id,
  source: "YouTube search",
  seenAt: SEEN_AT,
  ...over,
});

/** Three rows without a genre (two Arabic, one English) like the feed before round 31. */
const PLAIN = [
  row({ id: "plain-ar", platform: "google", source: "Google Trends", score: 100 }),
  row({ id: "plain-tt", platform: "tiktok", lang: "mixed", source: "Tavily scan" }),
  row({ id: "plain-en", region: "US", lang: "en", source: "YouTube charts", score: 100 }),
];

/** The tags the Worker's keyword scan writes: the query that found the video, then "short". */
const found = (query: string) => ({ tags: [query, "short"] });

/**
 * Keyword-scan rows as the Worker writes them: cars in both languages, food in Arabic (its query holds the
 * niche word "مونتاج"), and an id the app has no genre for. No title matches a niche keyword.
 */
const GENRE_ROWS = [
  row({ id: "cars-ar", score: 80, genre: "cars", ...found("ايديت سيارات") }),
  row({ id: "food-ar", score: 70, genre: "food", ...found("مونتاج أكل") }),
  row({ id: "cars-en", region: "US", lang: "en", score: 85, genre: "cars", ...found("car edit") }),
  row({ id: "kites-en", region: "US", lang: "en", score: 60, genre: "kites", ...found("kites") }),
];

let host: HTMLDivElement;
let root: Root;

const feed = (items: TrendItemInput[]) =>
  act(() => useStore.getState().setTrends({ items, fetchedAt: SEEN_AT }));

const rowIds = () =>
  [...host.querySelectorAll('[data-testid="trend-row"]')].map((r) => r.getAttribute("data-id"));
const radar = () => host.querySelector('[data-testid="ideas-trends"]')!;
const rowEl = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="trend-row"][data-id="${id}"]`)!;
const chipOf = (el: Element) => el.querySelector<HTMLElement>('[data-testid="trend-genre"]');
const starOf = (el: Element) => el.querySelector<HTMLElement>('[data-testid="trend-star"]');
/** The ids of the rows with the niche star, in list order. */
const starred = () =>
  [...host.querySelectorAll('[data-testid="trend-row"][data-star="true"]')].map((r) =>
    r.getAttribute("data-id"),
  );
/** Every row in list order with what its genre chip says (null: no chip). */
const chips = () =>
  [...host.querySelectorAll('[data-testid="trend-row"]')].map((r) => [
    r.getAttribute("data-id"),
    chipOf(r)?.textContent ?? null,
  ]);
/** Every genre chip is a plain span: Discover is a Training route and Social never links out (tools/20). */
function expectPlainChips(): void {
  const all = [...host.querySelectorAll<HTMLElement>('[data-testid="trend-genre"]')];
  expect(all.length).toBeGreaterThan(0);
  for (const chip of all) {
    expect(chip.tagName).toBe("SPAN");
    expect(chip.hasAttribute("href")).toBe(false);
    expect(chip.hasAttribute("aria-label")).toBe(false);
    expect(chip.closest("a, button, select, label")).toBeNull();
  }
  expect(host.querySelector('a[href*="discover"]')).toBeNull();
}

function click(testId: string, within: ParentNode = host): void {
  const el = within.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
  act(() => el.click());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver (the language tabs are a Segmented, which uses one).
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const s = useStore.getState();
  s.clearTrends();
  s.setSettings({ lang: "ar", apiKeys: { ...s.settings.apiKeys, scoutUrl: "", scoutToken: "" } });
  for (const g of s.customGenres) s.removeCustomGenre(g.id);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(TrendRadar)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("TrendRadar has no genre filter (Discover is the one place for genres)", () => {
  it("shows no genre select, with or without genre rows in the feed", () => {
    const noFilter = () => {
      expect(host.querySelector('[data-testid="trends-genre"]')).toBeNull();
      expect(radar().querySelector("select")).toBeNull();
      expect(radar().querySelector("label")).toBeNull();
      expect(radar().hasAttribute("data-genre")).toBe(false);
    };
    noFilter();
    feed(PLAIN);
    expect(rowIds()).toEqual(["plain-ar", "plain-tt"]);
    noFilter();
    feed([...PLAIN, ...GENRE_ROWS]);
    noFilter();
    expect(radar().textContent).not.toContain("كل الأنواع");
  });

  it("lists the genre rows with the others, filtered by the language tab and the platform chip only", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    expect(rowIds()).toEqual(["plain-ar", "cars-ar", "food-ar", "plain-tt"]);
    expect(radar().getAttribute("data-count")).toBe("4");
    expect(rowEl("cars-ar").getAttribute("data-genre")).toBe("cars");
    expect(rowEl("food-ar").getAttribute("data-genre")).toBe("food");
    expect(rowEl("plain-ar").hasAttribute("data-genre")).toBe(false);

    click("trends-platform-youtube");
    expect(rowIds()).toEqual(["cars-ar", "food-ar"]);
    click("trends-platform-google");
    expect(rowIds()).toEqual(["plain-ar"]);

    click("trends-tab-en");
    expect(rowIds()).toEqual([]);
    expect(host.querySelector('[data-testid="trends-empty"]')).not.toBeNull();
    click("trends-platform-youtube");
    expect(rowIds()).toEqual(["plain-en", "cars-en", "kites-en"]);
    click("trends-platform-all");
    expect(rowIds()).toEqual(["plain-en", "cars-en", "kites-en", "plain-tt"]);
    expect(radar().getAttribute("data-tab")).toBe("en");
  });

  it("keeps every other row when a genre row is dismissed", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    click("trend-dismiss", rowEl("food-ar"));
    expect(rowIds()).toEqual(["plain-ar", "cars-ar", "plain-tt"]);
    expect(chips()).toEqual([
      ["plain-ar", null],
      ["cars-ar", "سيارات"],
      ["plain-tt", null],
    ]);
    expectPlainChips();
  });
});

describe("TrendRadar with no feed yet", () => {
  it("points at the refresh button by its named icon, never a literal {icon}", () => {
    // With a Worker the radar shows its list; the first pull never answers here, so the feed stays empty.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    const s = useStore.getState();
    act(() =>
      s.setSettings({
        apiKeys: {
          ...s.settings.apiKeys,
          scoutUrl: "https://scout.test",
          scoutToken: "test-token",
        },
      }),
    );
    for (const [lang, name] of [
      ["ar", "حدّث الترند"],
      ["en", "Refresh trends"],
    ] as const) {
      act(() => useStore.getState().setSettings({ lang }));
      const empty = host.querySelector<HTMLElement>('[data-testid="trends-empty"]')!;
      expect(empty.textContent).not.toContain("{");
      const icon = empty.querySelector<HTMLElement>('[role="img"]')!;
      expect(icon.getAttribute("aria-label")).toBe(name);
      expect(icon.querySelector("svg")).not.toBeNull();
    }
  });
});

describe("TrendRadar niche star on genre rows", () => {
  it("does not star a genre row for its genre's own search words", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    expect(starred()).toEqual([]);
    expect(rowEl("food-ar").getAttribute("data-star")).toBe("false");
    expect(starOf(rowEl("food-ar"))).toBeNull();
    // Not starred, so the food row stays where its score puts it.
    expect(rowIds()).toEqual(["plain-ar", "cars-ar", "food-ar", "plain-tt"]);
  });

  it("stars a genre row for its title or for the niche keyword that found it, first in the list", () => {
    feed([
      ...PLAIN,
      ...GENRE_ROWS,
      row({
        id: "travel-title",
        title: "مونتاج سفر بالجوال",
        score: 10,
        genre: "travel",
        ...found("مونتاج سفر"),
      }),
      row({
        id: "food-niche",
        title: "أحلى مطاعم جدة",
        score: 5,
        genre: "food",
        ...found("مونتاج"),
      }),
      row({ id: "niche", title: "درس دافنشي", score: 1, ...found("دافنشي") }),
    ]);
    expect(starred()).toEqual(["travel-title", "food-niche", "niche"]);
    // The star is an icon with a name: "fits your niche".
    expect(starOf(rowEl("travel-title"))?.getAttribute("aria-label")).toBe("يناسب مجالك");
    expect(rowIds()).toEqual([
      "travel-title",
      "food-niche",
      "niche",
      "plain-ar",
      "cars-ar",
      "food-ar",
      "plain-tt",
    ]);
  });

  it("follows the owner's custom genres: their search words stop counting once the app knows them", () => {
    feed([
      ...PLAIN,
      row({ id: "zaffa", score: 50, genre: "custom-zaffa", ...found("مونتاج زفات") }),
    ]);
    // An id the app has no genre for: it cannot tell the genre's words, so the tags count.
    expect(starred()).toEqual(["zaffa"]);
    expect(rowIds()).toEqual(["zaffa", "plain-ar", "plain-tt"]);

    act(() => useStore.getState().addCustomGenre("Zaffa", "مونتاج زفات"));
    expect(useStore.getState().customGenres.map((g) => g.id)).toEqual(["custom-zaffa"]);
    expect(starred()).toEqual([]);
    expect(rowIds()).toEqual(["plain-ar", "zaffa", "plain-tt"]);

    act(() => useStore.getState().removeCustomGenre("custom-zaffa"));
    expect(starred()).toEqual(["zaffa"]);
  });
});

describe("TrendRadar volume chip (the number is shown in its source's unit)", () => {
  /**
   * A row with a volume from every source, as the Worker writes it: Google's searches, a YouTube video's
   * views (charts and keyword search), the pages the Tavily scan found, trends24.in's post count, and two
   * sources that have no unit the app knows (kworb.net sets no volume today; a label from a newer Worker).
   */
  const VOLUME_ROWS = [
    row({ id: "google", platform: "google", source: "Google Trends", volume: 500 }),
    row({ id: "yt-chart", source: "YouTube charts", volume: 105_000_000, tags: ["short"] }),
    row({ id: "yt-search", source: "YouTube search", volume: 12_300 }),
    row({ id: "tavily", platform: "tiktok", lang: "mixed", source: "Tavily scan", volume: 8 }),
    row({ id: "x", platform: "x", source: "trends24.in", volume: 12_000 }),
    row({ id: "kworb", platform: "tiktok", source: "kworb.net", volume: 900 }),
    row({ id: "newer", source: "Some new source", volume: 42 }),
    row({ id: "no-views", source: "YouTube charts", volume: 0 }),
  ];

  /** Each row's volume chip by row id: its `data-unit` and its text (null: no chip). */
  const volumes = () =>
    Object.fromEntries(
      [...host.querySelectorAll('[data-testid="trend-row"]')].map((r) => {
        const chip = r.querySelector('[data-testid="trend-volume"]');
        return [
          r.getAttribute("data-id"),
          chip ? [chip.getAttribute("data-unit"), chip.textContent] : null,
        ];
      }),
    );

  it("calls a YouTube row's number views and a Google row's searches, in Arabic and in English", () => {
    feed(VOLUME_ROWS);
    expect(volumes()).toEqual({
      google: ["searches", "500 بحث"],
      "yt-chart": ["views", "105M مشاهدة"],
      "yt-search": ["views", "12.3K مشاهدة"],
      tavily: ["pages", "8 صفحة"],
      x: ["posts", "12K تغريدة"],
      kworb: null,
      newer: null,
      "no-views": null,
    });

    act(() => useStore.getState().setSettings({ lang: "en" }));
    expect(volumes()).toEqual({
      google: ["searches", "500 searches"],
      "yt-chart": ["views", "105M views"],
      "yt-search": ["views", "12.3K views"],
      tavily: ["pages", "8 pages"],
      x: ["posts", "12K posts"],
      kworb: null,
      newer: null,
      "no-views": null,
    });
  });

  it("never shows a number without its unit: a source the app has no unit for shows no chip", () => {
    feed(VOLUME_ROWS);
    for (const id of ["kworb", "newer"]) {
      expect(rowEl(id).querySelector('[data-testid="trend-volume"]'), id).toBeNull();
      expect(rowEl(id).textContent, id).not.toMatch(/900|42/);
      // The row itself still shows, with its source badge.
      expect(rowEl(id).querySelector('[data-testid="trend-source"]'), id).not.toBeNull();
    }
    expect(rowEl("newer").querySelector('[data-testid="trend-source"]')?.textContent).toBe(
      "Some new source",
    );
    // No YouTube row's number is called a search.
    for (const id of ["yt-chart", "yt-search"]) {
      expect(
        rowEl(id).querySelector('[data-testid="trend-volume"]')?.textContent,
        id,
      ).not.toContain("بحث");
    }
  });
});

describe("TrendRadar genre chip", () => {
  // Social chips carry no emoji: the chip names the genre without the emoji Discover shows ("🚗 سيارات").
  it("names the genre on every row that has one, under both tabs", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    expect(chips()).toEqual([
      ["plain-ar", null],
      ["cars-ar", "سيارات"],
      ["food-ar", "أكل ومطاعم"],
      ["plain-tt", null],
    ]);

    click("trends-tab-en");
    expect(chips()).toEqual([
      ["plain-en", null],
      ["cars-en", "سيارات"],
      ["kites-en", "kites"],
      ["plain-tt", null],
    ]);
  });

  it("is a plain chip next to the row's other chips (Discover is a Training route, tools/20)", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    expectPlainChips();

    const chip = chipOf(rowEl("food-ar"))!;
    const platform = rowEl("food-ar").querySelector('[data-testid="trend-platform"]')!;
    expect(chip.classList.contains("px-chip")).toBe(true);
    expect(chip.parentElement).toBe(platform.parentElement);
    expect(chip.textContent).toBe("أكل ومطاعم");
    expect(chip.getAttribute("data-genre")).toBe("food");
    expect(chip.getAttribute("title")).toBe("نوع الإيديت");
    expect(chip.hasAttribute("tabindex")).toBe(false);
    expect(chip.tabIndex).toBe(-1);
    expect(chip.querySelector("a, button")).toBeNull();
  });

  it("shows the raw id for a genre the app does not know", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    click("trends-tab-en");
    expect(chips()).toEqual([
      ["plain-en", null],
      ["cars-en", "سيارات"],
      ["kites-en", "kites"],
      ["plain-tt", null],
    ]);
    expectPlainChips();
    expect(chipOf(rowEl("kites-en"))?.getAttribute("title")).toBe("نوع الإيديت");
  });

  it("follows the owner's custom genres and the UI language", () => {
    feed([
      ...GENRE_ROWS,
      row({
        id: "drift-en",
        region: "US",
        lang: "en",
        genre: "custom-drift",
        ...found("drift edit"),
      }),
    ]);
    click("trends-tab-en");
    expect(chipOf(rowEl("drift-en"))?.textContent).toBe("custom-drift");

    act(() => useStore.getState().addCustomGenre("Drift", "drift edit"));
    expect(chipOf(rowEl("drift-en"))?.textContent).toBe("Drift");
    expectPlainChips();

    act(() => useStore.getState().setSettings({ lang: "en" }));
    expect(chips()).toEqual([
      ["cars-en", "Cars"],
      ["kites-en", "kites"],
      ["drift-en", "Drift"],
    ]);
    expect(chipOf(rowEl("kites-en"))?.getAttribute("title")).toBe("Edit genre");

    // A name of emoji only is all the owner gave: the chip keeps it.
    act(() => useStore.getState().addCustomGenre("🏁", "drift race"));
    feed([...GENRE_ROWS, row({ id: "flag-en", region: "US", lang: "en", genre: "custom-1f3c1" })]);
    expect(chipOf(rowEl("flag-en"))?.textContent).toBe("✨ 🏁");
    act(() => useStore.getState().removeCustomGenre("custom-1f3c1"));
    feed([
      ...GENRE_ROWS,
      row({
        id: "drift-en",
        region: "US",
        lang: "en",
        genre: "custom-drift",
        ...found("drift edit"),
      }),
    ]);

    // Removed in Settings: the chip shows the raw id again.
    act(() => useStore.getState().removeCustomGenre("custom-drift"));
    expect(chipOf(rowEl("drift-en"))?.textContent).toBe("custom-drift");
    expectPlainChips();
  });

  it("names a custom genre with an Arabic id", () => {
    act(() => useStore.getState().addCustomGenre("هجولة", "ايديت هجولة"));
    const [genre] = useStore.getState().customGenres;
    expect(genre.id).toBe("custom-هجولة");
    feed([row({ id: "hajwala", genre: genre.id, ...found("ايديت هجولة") })]);

    const chip = chipOf(rowEl("hajwala"))!;
    expect(chip.textContent).toBe("هجولة");
    expect(chip.getAttribute("data-genre")).toBe("custom-هجولة");
    expectPlainChips();
  });
});
