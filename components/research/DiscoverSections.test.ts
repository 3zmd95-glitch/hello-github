// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearDiscoverCache } from "@/lib/discover";
import { clearScoutCache } from "@/lib/scoutClient";
import { useStore } from "@/store";
import ResearchPanel, { RESEARCH_TAB_KEY } from "./ResearchPanel";

// 🔎 Discover search v2 (round 33) in the research panel, rendered in jsdom against fake Workers (a stubbed
// global fetch; nothing leaves the machine): one that serves POST /discover (its /health says `discover: true`)
// and one from before it, which keeps the per-platform /search path. e2e/discover.spec.ts covers the browser.

const WORKER = "https://v2.scout.test";
const OLD_WORKER = "https://old.scout.test";

const item = (n: number, over: Record<string, unknown> = {}) => ({
  platform: "tt",
  handle: "@ed",
  title: `flash transition edit ${n}`,
  snippet: "",
  url: `https://www.tiktok.com/@ed/video/${n}`,
  thumb: `${WORKER}/thumb/${n}.png`,
  lang: "en",
  section: "example",
  ...over,
});

/** 8 TikTok examples, 2 tutorials (one YouTube with views), 1 off-topic Instagram post; Instagram failed. */
const ANSWER = {
  topicKey: "flash-transition",
  understood: {
    termId: "flash-transition",
    label: { ar: "انتقال فلاش", en: "flash transition" },
    exact: false,
  },
  alternatives: [
    { termId: "camera-flash", label: { ar: "تصوير بالفلاش", en: "camera flash photography" } },
    { exact: true },
  ],
  items: [
    ...Array.from({ length: 8 }, (_, i) => item(i + 1)),
    item(20, {
      platform: "yt",
      url: "https://www.youtube.com/watch?v=abc",
      handle: "Cinecom",
      section: "tutorial",
      stats: { views: 90000 },
    }),
    item(21, { section: "tutorial", lang: "ar", title: "شرح تأثير فلاش" }),
    item(22, {
      platform: "ig",
      url: "https://www.instagram.com/p/OFF/",
      handle: "",
      title: "The Flash",
      offTopic: true,
    }),
  ],
  creators: [{ platform: "tt", handle: "@ed", url: "https://www.tiktok.com/@ed", count: 9 }],
  platforms: { tt: { ok: true }, ig: { ok: false, error: "upstream" }, yt: { ok: true } },
  cost: { tavily: 6, youtubeSearch: 3 },
  cached: false,
  complete: false,
};

let discovered: Record<string, unknown>[];
let searched: { platforms: string[] }[];
let answer: (body: Record<string, unknown>) => unknown;
/** Holds the old Worker's /health until the test lets it answer. */
let releaseHealth: (() => void) | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.pathname === "/health") {
    if (url.origin === OLD_WORKER) await new Promise<void>((r) => (releaseHealth = r));
    return json({
      ok: true,
      auth: true,
      tavily: true,
      ...(url.origin === WORKER ? { discover: true } : {}),
    });
  }
  if (url.pathname === "/discover" && init?.method === "POST") {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    discovered.push(body);
    return json(answer(body));
  }
  if (url.pathname === "/discover/usage") {
    return json({
      tavily: { used: 412, limit: 1000 },
      youtube: { usedToday: 9, cap: 70 },
      connector: { usedToday: 0, cap: 60 },
    });
  }
  if (url.pathname === "/search") {
    searched.push(JSON.parse(String(init?.body)) as { platforms: string[] });
    return json({ results: [] });
  }
  return json({ error: "not_found" }, 404);
}

let host: HTMLDivElement;
let root: Root;

const $ = (testId: string, within: ParentNode = host) =>
  within.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const all = (testId: string, within: ParentNode = host) => [
  ...within.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];
const count = (testId: string) => $(testId)?.getAttribute("data-count");

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function click(el: HTMLElement | null): Promise<void> {
  if (!el) throw new Error("nothing to click");
  act(() => el.click());
  await settle();
}

async function submit(text: string): Promise<void> {
  const input = $("discover-topic") as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    $("research-bar")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function mount(worker = WORKER, tab = "all") {
  useStore
    .getState()
    .setSettings({ lang: "ar", apiKeys: { scoutUrl: worker, scoutToken: "tok", youtube: "" } });
  localStorage.setItem(RESEARCH_TAB_KEY, tab);
  act(() => root.render(createElement(ResearchPanel, {})));
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  discovered = [];
  searched = [];
  answer = () => ANSWER;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  localStorage.clear();
  clearScoutCache();
  clearDiscoverCache();
  useStore.setState({ recentTopics: [], customGenres: [], savedRefs: {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Discover v2 in the research panel", () => {
  it("one POST /discover for every platform: the sections, the tab counts and the usage", async () => {
    await mount();
    await submit("flash");
    expect(discovered).toEqual([{ q: "flash" }]);
    expect(searched).toEqual([]);

    expect($("discover-understood")!.textContent).toContain("فهمتها: انتقال فلاش · عربي + English");
    expect(count("discover-popular")).toBe("1");
    const examples = $("discover-section-example")!;
    expect(examples.getAttribute("data-count")).toBe("8");
    expect(all("result-card", examples)).toHaveLength(6);
    expect(count("discover-section-tutorial")).toBe("2");
    expect(all("discover-creator")).toHaveLength(1);
    // The badges count what shows (the off-topic post is hidden).
    expect(["all", "tt", "yt", "ig"].map((tb) => count(`tab-${tb}`))).toEqual([
      "10",
      "9",
      "1",
      "0",
    ]);
    expect($("discover-usage")!.textContent).toBe(
      "412 من 1000 بحث مجاني هالشهر · يوتيوب 9/70 اليوم",
    );
    expect($("scout-usage")).toBeNull();
    expect($("discover-down-ig")!.getAttribute("data-error")).toBe("upstream");

    await click($("discover-more-example"));
    expect(all("result-card", examples)).toHaveLength(8);
    expect($("discover-more-example")!.getAttribute("aria-expanded")).toBe("true");

    expect(count("discover-hidden")).toBe("1");
    expect($("discover-offtopic-chip")).toBeNull();
    await click($("discover-hidden-toggle"));
    expect(all("discover-offtopic-chip")).toHaveLength(1);

    // A tab filters every part; nothing new is asked.
    await click($("tab-tt"));
    expect($("discover-popular")).toBeNull();
    expect(count("discover-section-tutorial")).toBe("1");
    expect($("discover-down-ig")).toBeNull();
    expect(discovered).toHaveLength(1);
  });

  it("Not this? asks again with the meaning picked, then exactly; another topic starts without it", async () => {
    answer = (body) => ({
      ...ANSWER,
      understood: { ...ANSWER.understood, exact: body.exact === true },
    });
    await mount();
    await submit("speed ramp");
    await submit("flash");
    await click($("discover-alt-camera-flash"));
    expect(discovered.at(-1)).toEqual({ q: "flash", term: "camera-flash" });
    await click($("discover-alt-exact"));
    expect(discovered.at(-1)).toEqual({ q: "flash", exact: true });
    expect($("discover-understood")!.textContent).toContain("أدوّر بالضبط على «flash»");

    // A recent topic is another topic: the choice made for "flash" stays with it.
    const recent = all("discover-recent-topic").find((b) => b.textContent === "speed ramp")!;
    await click(recent);
    expect(discovered.at(-1)).toEqual({ q: "speed ramp" });
  });

  it("a failed platform keeps its line and Retry on an empty tab; Retry asks again", async () => {
    answer = () => ({ ...ANSWER, items: ANSWER.items.filter((i) => i.platform !== "ig") });
    await mount(WORKER, "ig");
    await submit("flash");
    expect($("research-empty")).not.toBeNull();
    expect($("discover-down-ig")!.textContent).toContain("Instagram ما رد");

    act(() => $("discover-retry-ig")!.click());
    // Asking again shows as a search, not as the old answer.
    expect($("discover-loading")).not.toBeNull();
    expect($("discover-sections")).toBeNull();
    await settle();
    expect(discovered).toHaveLength(2);
    expect($("discover-down-ig")).not.toBeNull();
  });

  it("a Worker from before v2: nothing is asked until /health answers, then the per-platform /search", async () => {
    await mount(OLD_WORKER);
    await submit("flash");
    // The search is on its way (skeletons) while the panel does not know which one the Worker serves.
    expect(searched).toEqual([]);
    expect(all("result-skeleton")).toHaveLength(3);
    expect($("research-results")!.getAttribute("aria-busy")).toBe("true");

    await act(async () => releaseHealth!());
    await settle();
    expect(searched.map((b) => b.platforms.join()).sort()).toEqual(["ig", "tt", "yt"]);
    expect(discovered).toEqual([]);
    expect($("discover-sections")).toBeNull();
    expect($("scout-usage")).not.toBeNull();
    expect($("discover-usage")).toBeNull();
  });
});
