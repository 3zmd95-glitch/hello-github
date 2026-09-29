// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrendItemInput } from "@/lib/domain";
import { genreIdFromSearch } from "@/lib/genres";
import { useStore } from "@/store";
import TrendRadar from "./TrendRadar";

// 🎬 The radar and the edit genres (round 31), rendered for real in jsdom: no Worker is configured, so nothing
// is fetched and the radar shows the feed the store already holds (as it does after a reload). Discover is the
// one place for genres: the radar has no genre select and filters by language tab and platform chip only, a
// row's genre chip is a link that opens Discover on that genre, and the ⭐ is never given for a genre's own
// search words.

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
/**
 * Where a chip's link goes, the way Discover reads it: the page, then the genre id of the query ("/discover
 * cars"); null for a plain chip. The build writes "/discover/?genre=cars" (next.config's trailingSlash);
 * next/link under vitest has no build config and drops that slash, so the path is compared without it.
 */
function target(chip: Element): string | null {
  const href = chip.getAttribute("href");
  if (href === null) return null;
  const url = new URL(href, "https://3z.test");
  return `${url.pathname.replace(/\/$/, "")} ${genreIdFromSearch(url.search)}`;
}
/** Every genre chip in list order: its genre id and where it goes. */
const links = () =>
  [...host.querySelectorAll<HTMLElement>('[data-testid="trend-genre"]')].map((c) => [
    c.getAttribute("data-genre"),
    target(c),
  ]);

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
    expect(rowIds()).toEqual(["plain-en", "cars-en", "drone-en"]);
    click("trends-platform-all");
    expect(rowIds()).toEqual(["plain-en", "cars-en", "drone-en", "plain-tt"]);
    expect(radar().getAttribute("data-tab")).toBe("en");
  });

  it("keeps every other row when a genre row is dismissed", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    click("trend-dismiss", rowEl("food-ar"));
    expect(rowIds()).toEqual(["plain-ar", "cars-ar", "plain-tt"]);
    expect(links()).toEqual([["cars", "/discover cars"]]);
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
  it("names the genre on every row that has one, under both tabs", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
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
  });

  it("is a link that opens Discover on the genre, looking like the row's other chips", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    expect(links()).toEqual([
      ["cars", "/discover cars"],
      ["food", "/discover food"],
    ]);

    const chip = chipOf(rowEl("food-ar"))!;
    const platform = rowEl("food-ar").querySelector('[data-testid="trend-platform"]')!;
    expect(chip.tagName).toBe("A");
    expect(chip.classList.contains("px-chip")).toBe(true);
    expect(chip.parentElement).toBe(platform.parentElement);
    expect(chip.textContent).toBe("🍔 أكل ومطاعم");
    expect(chip.getAttribute("data-genre")).toBe("food");
    // The accessible name says where the chip goes and holds the text the chip shows.
    expect(chip.getAttribute("aria-label")).toBe("افتح 🍔 أكل ومطاعم في «اكتشف»");
    expect(chip.getAttribute("aria-label")).toContain(chip.textContent);
    expect(chip.getAttribute("title")).toBe("افتح 🍔 أكل ومطاعم في «اكتشف»");
    // It stays in this tab and is nothing but a link: not a button, not part of a form control.
    expect(chip.hasAttribute("target")).toBe(false);
    expect(chip.closest("button, select, label")).toBeNull();
    expect(chip.querySelector("a, button")).toBeNull();
  });

  it("stays a plain chip with the raw id for a genre the app does not know", () => {
    feed([...PLAIN, ...GENRE_ROWS]);
    click("trends-tab-en");
    expect(links()).toEqual([
      ["cars", "/discover cars"],
      ["drone", null],
    ]);

    const chip = chipOf(rowEl("drone-en"))!;
    expect(chip.tagName).toBe("SPAN");
    expect(chip.classList.contains("px-chip")).toBe(true);
    expect(chip.textContent).toBe("drone");
    expect(chip.hasAttribute("href")).toBe(false);
    expect(chip.hasAttribute("aria-label")).toBe(false);
    expect(chip.hasAttribute("tabindex")).toBe(false);
    expect(chip.tabIndex).toBe(-1);
    expect(chip.closest("a, button, select, label")).toBeNull();
    expect(chip.getAttribute("title")).toBe("🎬 نوع الإيديت");
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
    expect(chipOf(rowEl("drift-en"))?.tagName).toBe("SPAN");

    act(() => useStore.getState().addCustomGenre("Drift", "drift edit"));
    expect(chipOf(rowEl("drift-en"))?.textContent).toBe("✨ Drift");
    expect(chipOf(rowEl("drift-en"))?.tagName).toBe("A");
    expect(chipOf(rowEl("drift-en"))?.getAttribute("aria-label")).toBe("افتح ✨ Drift في «اكتشف»");

    act(() => useStore.getState().setSettings({ lang: "en" }));
    expect(chips()).toEqual([
      ["cars-en", "🚗 Cars"],
      ["drone-en", "drone"],
      ["drift-en", "✨ Drift"],
    ]);
    expect(links()).toEqual([
      ["cars", "/discover cars"],
      ["drone", null],
      ["custom-drift", "/discover custom-drift"],
    ]);
    expect(chipOf(rowEl("cars-en"))?.getAttribute("aria-label")).toBe("Open 🚗 Cars in Discover");
    expect(chipOf(rowEl("drift-en"))?.getAttribute("aria-label")).toBe("Open ✨ Drift in Discover");
    expect(chipOf(rowEl("drone-en"))?.getAttribute("title")).toBe("🎬 Edit genre");

    // Removed in Settings: Discover has no chip for it any more, so the radar's chip is plain again.
    act(() => useStore.getState().removeCustomGenre("custom-drift"));
    expect(chipOf(rowEl("drift-en"))?.textContent).toBe("custom-drift");
    expect(chipOf(rowEl("drift-en"))?.tagName).toBe("SPAN");
    expect(chipOf(rowEl("drift-en"))?.hasAttribute("href")).toBe(false);
  });

  it("encodes a custom genre's Arabic id in the link", () => {
    act(() => useStore.getState().addCustomGenre("هجولة", "ايديت هجولة"));
    const [genre] = useStore.getState().customGenres;
    expect(genre.id).toBe("custom-هجولة");
    feed([row({ id: "hajwala", genre: genre.id, ...found("ايديت هجولة") })]);

    const chip = chipOf(rowEl("hajwala"))!;
    expect(chip.tagName).toBe("A");
    expect(chip.textContent).toBe("✨ هجولة");
    expect(chip.getAttribute("data-genre")).toBe("custom-هجولة");
    expect(chip.getAttribute("href")).toContain(`genre=${encodeURIComponent("custom-هجولة")}`);
    expect(target(chip)).toBe("/discover custom-هجولة");
  });
});
