// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrendItemInput } from "@/lib/domain";
import { useStore } from "@/store";
import TrendRadar from "./TrendRadar";

// 🎬 The radar's edit-genre select (round 31), rendered for real in jsdom: no Worker is configured, so nothing
// is fetched and the radar shows the feed the store already holds (as it does after a reload). Also the genre
// chip of a row, and the ⭐ that a genre's own search words must not give.

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
  row({ id: "drone-en", region: "US", lang: "en", score: 60, genre: "drone", ...found("drone") }),
];

let host: HTMLDivElement;
let root: Root;

const feed = (items: TrendItemInput[]) =>
  act(() => useStore.getState().setTrends({ items, fetchedAt: SEEN_AT }));

const select = () => host.querySelector<HTMLSelectElement>('[data-testid="trends-genre"]');
const options = () => [...(select()?.options ?? [])].map((o) => [o.value, o.textContent]);
const rowIds = () =>
  [...host.querySelectorAll('[data-testid="trend-row"]')].map((r) => r.getAttribute("data-id"));
const radar = () => host.querySelector('[data-testid="ideas-trends"]')!;
const rowEl = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="trend-row"][data-id="${id}"]`)!;
const chipOf = (el: Element) => el.querySelector<HTMLElement>('[data-testid="trend-genre"]');
/** The ids of the rows with the ⭐, in list order. */
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

function pick(genre: string): void {
  const el = select()!;
  act(() => {
    el.value = genre;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(testId: string, within: ParentNode = host): void {
  const el = within.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!;
  act(() => el.click());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
});

describe("TrendRadar genre select", () => {
  it("is hidden while no row has a genre", () => {
    expect(select()).toBeNull();
    feed(PLAIN);
    expect(rowIds()).toEqual(["plain-ar", "plain-tt"]);
    expect(select()).toBeNull();
    expect(radar().getAttribute("data-genre")).toBe("all");
  });

  it("lists 'all' and the genres of the feed after the platform chips, labelled", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    const el = select()!;
    expect(el.value).toBe("all");
    expect(options()).toEqual([
      ["all", "كل الأنواع"],
      ["cars", "🚗 سيارات"],
      ["food", "🍔 أكل ومطاعم"],
      ["drone", "drone"],
    ]);
    const label = host.querySelector(`label[for="${el.id}"]`);
    expect(label?.textContent).toBe("🎬 نوع الإيديت");
    const chip = host.querySelector('[data-testid="trends-platform-x"]')!;
    const list = host.querySelector('[data-testid="trends-list"]')!;
    expect(chip.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("filters the rows together with the language tab and the platform chip", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    expect(rowIds()).toEqual(["plain-ar", "cars-ar", "food-ar", "plain-tt"]);

    pick("cars");
    expect(radar().getAttribute("data-genre")).toBe("cars");
    expect(rowIds()).toEqual(["cars-ar"]);
    expect(host.querySelector('[data-testid="trend-row"]')?.getAttribute("data-genre")).toBe(
      "cars",
    );

    click("trends-tab-en");
    expect(select()!.value).toBe("cars");
    expect(rowIds()).toEqual(["cars-en"]);

    click("trends-platform-google");
    expect(rowIds()).toEqual([]);
    expect(host.querySelector('[data-testid="trends-empty"]')).not.toBeNull();
    expect(select()!.value).toBe("cars");
    click("trends-platform-youtube");
    expect(rowIds()).toEqual(["cars-en"]);
    click("trends-platform-all");

    pick("drone");
    expect(rowIds()).toEqual(["drone-en"]);
    click("trends-tab-ar");
    expect(rowIds()).toEqual([]);
    expect(select()!.value).toBe("drone");

    pick("all");
    expect(radar().getAttribute("data-genre")).toBe("all");
    expect(rowIds()).toEqual(["plain-ar", "cars-ar", "food-ar", "plain-tt"]);
  });

  it("falls back to all when the picked genre leaves the feed, and hides with the last genre row", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    pick("food");
    expect(rowIds()).toEqual(["food-ar"]);

    // ✕ on the only food row: the genre has no rows left.
    click("trend-dismiss");
    expect(options().map(([value]) => value)).toEqual(["all", "cars", "drone"]);
    expect(select()!.value).toBe("all");
    expect(rowIds()).toEqual(["plain-ar", "cars-ar", "plain-tt"]);

    // A fresh feed without genre rows.
    pick("cars");
    expect(rowIds()).toEqual(["cars-ar"]);
    feed(PLAIN);
    expect(select()).toBeNull();
    expect(radar().getAttribute("data-genre")).toBe("all");
    expect(rowIds()).toEqual(["plain-ar", "plain-tt"]);

    // The genre comes back with the next feed: the owner's pick is still cars.
    feed([...PLAIN, ...GENRE_ROWS]);
    expect(select()!.value).toBe("cars");
    expect(rowIds()).toEqual(["cars-ar"]);
  });

  it("names the owner's custom genres from the store and follows the UI language", () => {
    feed([...GENRE_ROWS, row({ id: "drift-en", region: "US", lang: "en", genre: "custom-drift" })]);
    expect(options().at(-2)).toEqual(["custom-drift", "custom-drift"]);

    act(() => useStore.getState().addCustomGenre("Drift", "drift edit"));
    expect(options()).toEqual([
      ["all", "كل الأنواع"],
      ["cars", "🚗 سيارات"],
      ["food", "🍔 أكل ومطاعم"],
      ["custom-drift", "✨ Drift"],
      ["drone", "drone"],
    ]);

    act(() => useStore.getState().setSettings({ lang: "en" }));
    expect(options()).toEqual([
      ["all", "All genres"],
      ["cars", "🚗 Cars"],
      ["food", "🍔 Food & restaurants"],
      ["custom-drift", "✨ Drift"],
      ["drone", "drone"],
    ]);
    expect(host.querySelector(`label[for="${select()!.id}"]`)?.textContent).toBe("🎬 Edit genre");

    click("trends-tab-en");
    pick("custom-drift");
    expect(rowIds()).toEqual(["drift-en"]);
  });
});

describe("TrendRadar niche star on genre rows", () => {
  it("does not star a genre row for its genre's own search words", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    expect(starred()).toEqual([]);
    expect(rowEl("food-ar").getAttribute("data-star")).toBe("false");
    expect(rowEl("food-ar").textContent).not.toContain("⭐");
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
    expect(rowEl("travel-title").textContent).toContain("⭐");
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

describe("TrendRadar genre chip", () => {
  it("names the genre on every row that has one, under all genres and under one", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    expect(select()!.value).toBe("all");
    expect(chips()).toEqual([
      ["plain-ar", null],
      ["cars-ar", "🚗 سيارات"],
      ["food-ar", "🍔 أكل ومطاعم"],
      ["plain-tt", null],
    ]);

    click("trends-tab-en");
    expect(chips()).toEqual([
      ["plain-en", null],
      ["cars-en", "🚗 سيارات"],
      ["drone-en", "drone"],
      ["plain-tt", null],
    ]);

    pick("cars");
    expect(chips()).toEqual([["cars-en", "🚗 سيارات"]]);
  });

  it("is a plain chip beside the row's other chips, not a control", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    const chip = chipOf(rowEl("food-ar"))!;
    const platform = rowEl("food-ar").querySelector('[data-testid="trend-platform"]')!;
    expect(chip.tagName).toBe("SPAN");
    expect(chip.classList.contains("px-chip")).toBe(true);
    expect(chip.parentElement).toBe(platform.parentElement);
    expect(chip.hasAttribute("tabindex")).toBe(false);
    expect(chip.tabIndex).toBe(-1);
    expect(chip.closest("a, button, select, label")).toBeNull();
    expect(chip.getAttribute("title")).toBe("🎬 نوع الإيديت");
  });

  it("names the owner's custom genres and follows the UI language", () => {
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
    expect(chipOf(rowEl("drift-en"))?.textContent).toBe("✨ Drift");

    act(() => useStore.getState().setSettings({ lang: "en" }));
    expect(chips()).toEqual([
      ["cars-en", "🚗 Cars"],
      ["drone-en", "drone"],
      ["drift-en", "✨ Drift"],
    ]);
    expect(chipOf(rowEl("cars-en"))?.getAttribute("title")).toBe("🎬 Edit genre");
  });
});
