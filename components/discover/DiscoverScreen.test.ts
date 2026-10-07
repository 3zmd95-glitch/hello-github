// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ResearchPanel, { RESEARCH_TAB_KEY } from "@/components/research/ResearchPanel";
import { getSkill } from "@/data";
import { discoverGenreHref } from "@/lib/genres";
import { clearYoutubeCache } from "@/lib/research";
import { clearScoutCache } from "@/lib/scoutClient";
import { useStore } from "@/store";
import DiscoverScreen from "./DiscoverScreen";

// 🔗 Discover's deep link, `/discover/?genre=<id>` (the Trend Radar's genre chips open it): rendered for real
// in jsdom against a fake Scout Worker (a stubbed global fetch). e2e/scout.spec.ts opens the same link in a
// browser, and e2e/trends.spec.ts taps a radar chip to get there.

const WORKER = "https://scout.test";
const CARS_AR = "ايديت سيارات";

let asked: string[];
let trendsCalls: string[];
let host: HTMLDivElement;
let root: Root;
let scrolledTo: Element[];

/** The Worker's `GET /trends`: one Arabic car row of its keyword scan, read just now. */
const FEED = {
  items: [
    {
      id: "youtube:SA:q-car1",
      platform: "youtube",
      region: "SA",
      lang: "ar",
      title: "مونتاج سيارات في جدة",
      url: "https://www.youtube.com/shorts/car1",
      volume: 120_000,
      score: 100,
      source: "YouTube search",
      why: "قناة السيارات",
      seenAt: new Date().toISOString(),
      genre: "cars",
      tags: [CARS_AR, "short"],
    },
  ],
  fetchedAt: new Date().toISOString(),
  degraded: false,
  sources: [],
};

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (url.origin === WORKER && url.pathname === "/search") {
    asked.push((JSON.parse(String(init?.body)) as { q: string }).q);
    return json({ results: [] });
  }
  if (url.origin === WORKER && url.pathname.startsWith("/trends")) {
    trendsCalls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    return json(FEED);
  }
  return json({ error: "not_found" }, 404);
}

const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const pressed = (testId: string) => $(testId)?.getAttribute("aria-pressed");
const pressedChips = () =>
  [...host.querySelectorAll<HTMLElement>('[data-testid^="genre-"][aria-pressed="true"]')].map(
    (el) => el.getAttribute("data-testid"),
  );
const address = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Let the searches answer, the deep link's second look run, and React settle. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

/** Open Discover at that address, the way the page mounts after the store has loaded. */
async function open(path: string): Promise<void> {
  window.history.replaceState(null, "", path);
  act(() => root.render(createElement(DiscoverScreen)));
  await settle();
}

async function click(testId: string): Promise<void> {
  const el = $(testId);
  if (!el) throw new Error(`no [data-testid="${testId}"]`);
  act(() => el.click());
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  trendsCalls = [];
  scrolledTo = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  // jsdom lays nothing out and has no scrollIntoView: record which element asked to be shown.
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolledTo.push(this);
  };
  localStorage.clear();
  // One platform, so every search is one Worker request.
  localStorage.setItem(RESEARCH_TAB_KEY, "tt");
  clearScoutCache();
  clearYoutubeCache();
  useStore.setState({ recentTopics: [], customGenres: [], savedRefs: {} });
  useStore.getState().clearTrends();
  useStore.getState().setSettings({ lang: "ar", apiKeys: { scoutUrl: WORKER, scoutToken: "tok" } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Discover deep link (?genre=<id>)", () => {
  it("opens with that genre picked like a tap on its chip, then takes it off the address", async () => {
    await open(discoverGenreHref("cars"));
    expect(pressed("genre-cars")).toBe("true");
    expect(pressedChips()).toEqual(["genre-cars"]);
    expect($("genres-row")!.getAttribute("data-genre")).toBe("cars");
    // A chip tap is a search: the genre's own words, in the search language; no topic is remembered.
    expect(asked).toEqual([CARS_AR]);
    expect(($("discover-topic") as HTMLInputElement).value).toBe("");
    expect(useStore.getState().recentTopics).toEqual([]);
    expect($("research-start")).toBeNull();
    // Its chip is brought into view in the row, and the address no longer names the genre.
    expect(scrolledTo).toEqual([$("genre-cars")]);
    expect(address()).toBe("/discover/");
    // The app had no feed yet: it is read once (never run), and the genre's most viewed show.
    expect(trendsCalls).toEqual(["GET /trends"]);
    expect($("genre-week")!.getAttribute("data-genre")).toBe("cars");
    expect($("genre-week")!.textContent).toContain("مونتاج سيارات في جدة");
  });

  it("keeps the address's other parameters and hash", async () => {
    await open("/discover/?from=radar&genre=gym#top");
    expect(pressedChips()).toEqual(["genre-gym"]);
    expect(asked).toEqual(["ايديت جيم"]);
    expect(scrolledTo).toEqual([$("genre-gym")]);
    expect(address()).toBe("/discover/?from=radar#top");
  });

  it("opens an owner's genre too, whatever its script", async () => {
    useStore.getState().addCustomGenre("هجولة", "هجولة درفت");
    await open(discoverGenreHref("custom-هجولة"));
    expect(pressedChips()).toEqual(["genre-custom-هجولة"]);
    expect(asked).toEqual(["هجولة درفت"]);
    expect(address()).toBe("/discover/");
  });

  it("ignores a genre the app does not know, and an empty one, and cleans the address either way", async () => {
    await open("/discover/?genre=drone");
    expect(pressedChips()).toEqual([]);
    expect($("genres-row")!.getAttribute("data-genre")).toBe("");
    expect(asked).toEqual([]);
    expect(scrolledTo).toEqual([]);
    expect(address()).toBe("/discover/");
    expect($("research-start")).not.toBeNull();
    // No genre, no trends read.
    expect(trendsCalls).toEqual([]);

    act(() => root.unmount());
    root = createRoot(host);
    await open("/discover/?genre=&x=1");
    expect(pressedChips()).toEqual([]);
    expect(asked).toEqual([]);
    expect(address()).toBe("/discover/?x=1");
  });

  it("leaves a plain Discover address alone", async () => {
    window.history.replaceState(null, "", "/discover/?from=radar");
    const replace = vi.spyOn(window.history, "replaceState");
    act(() => root.render(createElement(DiscoverScreen)));
    await settle();
    expect(pressedChips()).toEqual([]);
    expect(asked).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
    expect(address()).toBe("/discover/?from=radar");
  });

  it("a reload after the link does not force the genre again", async () => {
    await open(discoverGenreHref("food"));
    expect(pressedChips()).toEqual(["genre-food"]);
    // The same address, loaded again (the parameter is gone from it).
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(createElement(DiscoverScreen)));
    await settle();
    expect(address()).toBe("/discover/");
    expect(pressedChips()).toEqual([]);
    expect(asked).toEqual(["مونتاج أكل"]);
  });

  it("reads an address written just after the page mounted (an in-app link)", async () => {
    window.history.replaceState(null, "", "/discover/");
    // The page's effects have run (act flushes them) and found no genre yet...
    act(() => root.render(createElement(DiscoverScreen)));
    expect(pressedChips()).toEqual([]);
    // ...when the address changes, before the second look.
    window.history.pushState(null, "", discoverGenreHref("anime"));
    await settle();
    expect(pressedChips()).toEqual(["genre-anime"]);
    expect(asked).toEqual(["ايديت انمي"]);
    expect(address()).toBe("/discover/");
  });

  it("then the genre is the owner's to change: the link does not come back", async () => {
    await open(discoverGenreHref("cars"));
    await click("genre-cars");
    expect(pressedChips()).toEqual([]);
    await click("genre-food");
    expect(pressedChips()).toEqual(["genre-food"]);
    expect(asked).toEqual([CARS_AR, "مونتاج أكل"]);
  });

  it("is Discover's only: the skill sheet's panel never reads the address", async () => {
    const skill = getSkill("smart-bins-keywords");
    window.history.replaceState(null, "", "/skills/?genre=cars");
    act(() => root.render(createElement(ResearchPanel, { skill })));
    await settle();
    expect(pressedChips()).toEqual([]);
    expect(address()).toBe("/skills/?genre=cars");
    expect(scrolledTo).toEqual([]);
  });
});

// Back from TikTok for Business (planning/tools/19-category-trends.md §6): the Worker's /oauth/tiktokads/callback sends
// the owner to the page he tapped "Connect TikTok trends" on, Discover, with ?tiktokads=connected or ?tiktokads_error=.
describe("back from TikTok for Business (?tiktokads)", () => {
  const line = () => $("tiktokads-line")!.textContent;

  it("says TikTok is connected, then takes the parameter off the address, keeping the others and the hash", async () => {
    await open("/discover/?from=radar&tiktokads=connected#top");
    expect(line()).toBe("انربط تيك توك — تبويب تيك توك يتعبّى مع الفحص الجاي حق هالفئة");
    expect(address()).toBe("/discover/?from=radar#top");
    // A reload of the same address says nothing.
    act(() => root.unmount());
    root = createRoot(host);
    act(() => root.render(createElement(DiscoverScreen)));
    await settle();
    expect(line()).toBe("");
  });

  it("says connecting failed for ?tiktokads_error, in English too; the genre link still works beside it", async () => {
    useStore.getState().setSettings({ lang: "en" });
    await open("/discover/?genre=cars&tiktokads_error=exchange_failed");
    expect(line()).toBe("Couldn't connect TikTok — try again in a bit");
    expect(pressedChips()).toEqual(["genre-cars"]);
    expect(address()).toBe("/discover/");
  });

  it("says nothing on a plain Discover address", async () => {
    await open("/discover/?from=radar");
    expect(line()).toBe("");
    expect(address()).toBe("/discover/?from=radar");
  });
});
