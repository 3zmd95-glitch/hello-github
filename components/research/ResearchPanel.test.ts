// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSkill, skills } from "@/data";
import { clearDiscoverCache } from "@/lib/discover";
import { discoverPrompts } from "@/lib/discoverPrompts";
import type { TrendItemInput, TrendsFeedInput } from "@/lib/domain";
import { clearYoutubeCache } from "@/lib/research";
import { clearScoutCache } from "@/lib/scoutClient";
import { useStore } from "@/store";
import ResearchPanel, { RESEARCH_TAB_KEY } from "./ResearchPanel";
import { clearScoutCaps } from "./useDiscover";

// 🎬 The research panel's genre row, "Most popular" sort, stats chips and "Most viewed this week" strip
// (round 31), rendered for real in jsdom against a fake Scout Worker and a fake YouTube Data API (a stubbed
// global fetch; nothing leaves the machine). The Playwright specs (e2e/scout.spec.ts, e2e/research.spec.ts)
// cover the same flows in a browser.

const WORKER = "https://scout.test";
const CARS_AR = "ايديت سيارات";

// By popularity (views, else likes x 10): tt-b (450,000), tt-a (12,000), yt-a (5,400), then ig-a (unknown).
const RESULTS = [
  {
    platform: "tt",
    handle: "@a",
    title: "tt-a",
    snippet: "",
    url: "https://www.tiktok.com/@a/video/1",
    stats: { likes: 1200, comments: 56 },
  },
  {
    platform: "ig",
    handle: "@b",
    title: "ig-a",
    snippet: "",
    url: "https://www.instagram.com/p/abc",
  },
  {
    platform: "yt",
    handle: "c",
    title: "yt-a",
    snippet: "",
    url: "https://www.youtube.com/watch?v=ytA",
    stats: { views: 5400, likes: 310 },
  },
  {
    platform: "tt",
    handle: "@d",
    title: "tt-b",
    snippet: "",
    url: "https://www.tiktok.com/@d/video/2",
    stats: { likes: 45000 },
  },
];

const VIDEOS = [
  { id: "quiet", title: "Quiet one", views: "900" },
  { id: "big", title: "Big one", views: "2500000" },
  { id: "hidden", title: "No numbers" },
];

interface Asked {
  q: string;
  platforms: string[];
  lang?: string;
}

let asked: Asked[];
let ytSearches: URL[];
let ytStats: URL[];
let statsDown: boolean;
/** What the fake Worker's `GET /trends` answers; null = it has no such route (a 404). */
let workerFeed: TrendsFeedInput | null;
/** Every request to the Worker's trends routes, as "METHOD /path". */
let trendsCalls: string[];
let discoverV2: boolean;
let discoverAsked: Record<string, unknown>[];
let localPlans: Record<string, unknown>[];
/** What the fake Worker's `GET /effects/trending` answers; null = no such route (a 404). */
let effectsDoc: unknown;
let effectsAsked: number;
/** What the fake Worker's `GET /categories/:id` answers; null = no such route (a 404, an older Worker). */
let categoryDoc: unknown;

/** This week's trending effects: one dictionary effect. */
const EFFECTS = {
  status: "ok",
  ranOn: "2026-10-06",
  updatedAt: new Date().toISOString(),
  items: [
    {
      key: "clone-effect",
      name: { en: "clone effect", ar: "تأثير الاستنساخ" },
      termId: "clone-effect",
      isNew: false,
      checked: true,
      creators: 9,
      posts: 14,
      platforms: ["tt"],
      growth: 2,
      samples: [],
    },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), window.location.href);
  if (url.pathname === "/api/local-ai/status")
    return json({
      available: true,
      providers: {
        chatgpt: { connected: false, models: [] },
        claude: {
          connected: true,
          sharing: true,
          accountId: "test-account",
          models: [{ id: "claude-fable-5-1", name: "Fable", efforts: ["high", "max"] }],
        },
      },
    });
  if (url.pathname === "/api/local-ai/plan") {
    const body = JSON.parse(String(init?.body));
    localPlans.push(body);
    return json({
      provider: body.provider,
      model: body.model,
      effort: body.effort,
      plan: {
        summary: { ar: "قهوة", en: "Coffee" },
        queries: [{ q: "coffee lighting tutorial", lang: "en", intent: "tutorials" }],
        concepts: [["coffee", "قهوة"]],
        platforms: ["yt", "tt", "ig"],
        timeRange: "any",
        ytLength: "any",
      },
    });
  }
  if (url.origin === WORKER && url.pathname === "/health")
    return json({
      ok: true,
      auth: true,
      tavily: true,
      discover: discoverV2,
      discoverSubscriptions: true,
    });
  if (url.origin === WORKER && url.pathname === "/discover") {
    const body = JSON.parse(String(init?.body));
    discoverAsked.push(body);
    return json({
      topicKey: "test-category",
      understood: {
        label: { ar: "بحث النوع", en: "Category search" },
        exact: false,
        ...(body.mode === "ai" ? { ai: true } : {}),
        ...(body.aiPlan
          ? { provider: body.aiPlan.provider, model: body.aiPlan.model, effort: body.aiPlan.effort }
          : {}),
      },
      items: [],
      creators: [],
      alternatives: [],
      platforms: { yt: { ok: true }, tt: { ok: true }, ig: { ok: true } },
      cost: { tavily: 0, youtubeSearch: 0 },
      cached: false,
      complete: false,
    });
  }
  if (url.origin === WORKER && url.pathname === "/search") {
    const body = JSON.parse(String(init?.body)) as Asked;
    asked.push(body);
    return json({ results: RESULTS.filter((r) => body.platforms.includes(r.platform)) });
  }
  if (url.origin === WORKER && url.pathname.startsWith("/trends")) {
    trendsCalls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    return workerFeed ? json(workerFeed) : json({ error: "not_found" }, 404);
  }
  if (url.origin === WORKER && url.pathname === "/effects/trending") {
    effectsAsked++;
    return effectsDoc ? json(effectsDoc) : json({ error: "not_found" }, 404);
  }
  if (url.origin === WORKER && url.pathname.startsWith("/categories/"))
    return categoryDoc ? json(categoryDoc) : json({ error: "not_found" }, 404);
  if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/videos")) {
    ytStats.push(url);
    if (statsDown) return json({ error: {} }, 500);
    return json({
      items: VIDEOS.map((v) => ({ id: v.id, statistics: v.views ? { viewCount: v.views } : {} })),
    });
  }
  if (url.hostname === "www.googleapis.com") {
    ytSearches.push(url);
    return json({
      items: VIDEOS.map((v) => ({ id: { videoId: v.id }, snippet: { title: v.title } })),
    });
  }
  return json({ error: "not_found" }, 404);
}

let host: HTMLDivElement;
let root: Root;

const $ = <T extends HTMLElement = HTMLElement>(testId: string) =>
  host.querySelector<T>(`[data-testid="${testId}"]`);
const all = (testId: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];
const titles = () => all("result-title").map((el) => el.textContent);
const pressed = (testId: string) => $(testId)?.getAttribute("aria-pressed");
const link = (testId: string) => $(testId)?.getAttribute("href");

/** Let the searches answer and React settle. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function click(testId: string): Promise<void> {
  const el = $(testId);
  if (!el) throw new Error(`no [data-testid="${testId}"]`);
  act(() => el.click());
  await settle();
}

/** Type into the topic box without submitting (React listens to the native input event). */
function type(text: string): void {
  const el = ($<HTMLInputElement | HTMLTextAreaElement>("discover-topic") ??
    $<HTMLInputElement>("research-topic"))!;
  const prototype =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setValue = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  act(() => {
    setValue.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(text: string): Promise<void> {
  type(text);
  const form = $<HTMLFormElement>("research-bar")!;
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

async function mount(
  opts: {
    skillId?: string;
    tab?: string;
    youtubeKey?: string;
    worker?: boolean;
    v2?: boolean;
    lang?: "ar" | "en";
  } = {},
) {
  discoverV2 = opts.v2 ?? false;
  const s = useStore.getState();
  const on = opts.worker ?? true;
  s.setSettings({
    lang: opts.lang ?? "ar",
    apiKeys: {
      scoutUrl: on ? WORKER : "",
      scoutToken: on ? "tok" : "",
      youtube: opts.youtubeKey,
    },
  });
  localStorage.setItem(RESEARCH_TAB_KEY, opts.tab ?? "tt");
  const skill = opts.skillId ? getSkill(opts.skillId) : undefined;
  act(() => root.render(createElement(ResearchPanel, { skill })));
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  ytSearches = [];
  ytStats = [];
  statsDown = false;
  workerFeed = null;
  trendsCalls = [];
  discoverV2 = false;
  discoverAsked = [];
  localPlans = [];
  effectsDoc = null;
  effectsAsked = 0;
  categoryDoc = null;
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  localStorage.clear();
  // The trending effects' 1 h copy lives in this tab's sessionStorage.
  sessionStorage.clear();
  clearScoutCache();
  clearScoutCaps();
  clearDiscoverCache();
  clearYoutubeCache();
  useStore.setState({ recentTopics: [], customGenres: [], savedRefs: {} });
  useStore.getState().clearTrends();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("ResearchPanel genre row", () => {
  it("lists the built-in genres, then the owner's own with ✨, under their label", async () => {
    useStore.getState().addCustomGenre("هجولة", "هجولة درفت");
    await mount();
    const row = $("genres-row")!;
    expect(row.textContent).toContain("🎬 نوع الإيديت");
    const chips = [...row.querySelectorAll<HTMLElement>('[data-testid^="genre-"]')];
    expect(chips).toHaveLength(13);
    expect(chips.slice(0, 3).map((c) => c.textContent)).toEqual([
      "🚗سيارات",
      "🍔أكل ومطاعم",
      "🎌أنمي",
    ]);
    expect(chips[12].getAttribute("data-testid")).toBe("genre-custom-هجولة");
    expect(chips[12].textContent).toBe("✨هجولة");
    expect(chips.every((c) => c.getAttribute("aria-pressed") === "false")).toBe(true);
    // One row that scrolls sideways (it wraps only where the panel is wide), before the platform tabs.
    const classes = $("genres-chips")!.className.split(" ");
    expect(classes).toContain("overflow-x-auto");
    expect(classes).not.toContain("flex-wrap");
    expect(chips.every((c) => c.className.split(" ").includes("shrink-0"))).toBe(true);
    const tabs = $("tab-all")!;
    expect(row.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(asked).toEqual([]);
  });

  it("searches the words of the genre alone, in the search language, and remembers no topic", async () => {
    await mount();
    await click("genre-cars");
    expect(pressed("genre-cars")).toBe("true");
    expect(asked).toEqual([{ q: CARS_AR, platforms: ["tt"], lang: "ar", max: 10, thumbs: true }]);
    expect(titles()).toEqual(["tt-a", "tt-b"]);
    expect($<HTMLInputElement>("discover-topic")!.value).toBe("");
    expect(useStore.getState().recentTopics).toEqual([]);
    expect($("research-start")).toBeNull();
    expect(link("research-link-tt")).toBe(
      `https://www.tiktok.com/search?q=${encodeURIComponent(CARS_AR)}`,
    );
    expect(link("research-link-ig-hashtag")).toBe(
      "https://www.instagram.com/explore/tags/caredit/",
    );

    await click("research-lang-en");
    expect(asked[1]).toMatchObject({ q: "car edit", lang: "en" });

    // A custom genre: the same words in both languages, and no hashtag link.
    act(() => useStore.getState().addCustomGenre("Drift", "drift edit"));
    await click("genre-custom-drift");
    expect(asked[2]).toMatchObject({ q: "drift edit", lang: "en" });
    expect($("research-link-ig-hashtag")).toBeNull();
  });

  it("commits what is typed, then searches topic + genre; only the topic is remembered", async () => {
    await mount();
    type("  drift ");
    await click("genre-cars");
    expect(asked.map((a) => a.q)).toEqual([`drift ${CARS_AR}`]);
    expect($<HTMLInputElement>("discover-topic")!.value).toBe("drift");
    expect(useStore.getState().recentTopics).toEqual(["drift"]);
    expect(link("research-link-ig-hashtag")).toBe("https://www.instagram.com/explore/tags/drift/");
    expect(link("none-link-tt-tt")).toBeUndefined();

    // Another genre replaces it; a new topic keeps the genre.
    await click("genre-food");
    expect(pressed("genre-cars")).toBe("false");
    expect(pressed("genre-food")).toBe("true");
    expect(asked[1].q).toBe("drift مونتاج أكل");
    await submit("night");
    expect(asked[2].q).toBe("night مونتاج أكل");
    expect(useStore.getState().recentTopics).toEqual(["night", "drift"]);
  });

  it("clears the genre on the active chip and on the ✕, with nothing new to pay for", async () => {
    await mount();
    await submit("match cut");
    expect($("genres-clear")).toBeNull();
    await click("genre-cars");
    expect(asked.map((a) => a.q)).toEqual(["match cut", `match cut ${CARS_AR}`]);
    expect($("genres-row")!.getAttribute("data-genre")).toBe("cars");

    await click("genre-cars");
    expect(pressed("genre-cars")).toBe("false");
    expect($("genres-row")!.getAttribute("data-genre")).toBe("");
    expect(link("research-link-tt")).toBe("https://www.tiktok.com/search?q=match%20cut");
    expect(titles()).toEqual(["tt-a", "tt-b"]);
    expect(asked).toHaveLength(2);

    await click("genre-anime");
    expect(asked).toHaveLength(3);
    expect($("genres-clear")!.getAttribute("aria-label")).toBe("✕ بدون نوع");
    await click("genres-clear");
    expect(pressed("genre-anime")).toBe("false");
    expect($("genres-clear")).toBeNull();
    expect(asked).toHaveLength(3);

    // A genre with no topic, cleared: nothing left to search.
    await submit("");
    await click("genre-cars");
    expect(asked[3].q).toBe(CARS_AR);
    await click("genre-cars");
    expect($("research-start")).not.toBeNull();
    expect(titles()).toEqual([]);
  });

  it("keeps the name of the skill as the base, and the genre through a reset", async () => {
    await mount({ skillId: "smart-bins-keywords" });
    const name = "الـ Smart Bins والكلمات المفتاحية";
    expect(asked.map((a) => a.q)).toEqual([`${name} DaVinci Resolve`]);
    await click("genre-cars");
    expect(asked[1].q).toBe(`${name} ${CARS_AR} DaVinci Resolve`);
    expect($<HTMLInputElement>("research-topic")!.value).toBe(name);
    expect(link("research-link-ig-hashtag")).toBe(
      "https://www.instagram.com/explore/tags/smartbinskeywords/",
    );

    await click("research-lang-en");
    expect(asked[2].q).toBe("Smart Bins + Keywords car edit DaVinci Resolve");
    await submit("match cut");
    expect(asked[3].q).toBe("match cut car edit DaVinci Resolve");
    await click("research-reset");
    expect($<HTMLInputElement>("research-topic")!.value).toBe("Smart Bins + Keywords");
    expect(pressed("genre-cars")).toBe("true");
    expect(link("research-link-tt")).toContain("Keywords%20car%20edit%20DaVinci%20Resolve");
    // Served from the cache: the same search as before the override.
    expect(asked).toHaveLength(4);
  });
});

async function select(testId: string, value: string): Promise<void> {
  const element = $<HTMLSelectElement>(testId)!;
  act(() => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await settle();
}

describe("Discover category ideas", () => {
  it.each([
    ["cars", "en", "Cars"],
    ["coffee", "ar", "قهوة"],
    ["travel", "en", "Travel"],
  ] as const)(
    "places %s ideas under its buttons and fills the draft without searching",
    async (genre, lang, name) => {
      await mount({ v2: true, lang });
      await click(`genre-${genre}`);
      expect(discoverAsked).toHaveLength(1);
      const ideas = $("discover-category-ideas")!;
      expect($("genres-row")!.nextElementSibling).toBe(ideas);
      expect($("research-bar")!.contains(ideas)).toBe(false);
      expect($("discover-category-focus")!.textContent).toContain(name);
      expect($("discover-category-only")).toBeNull();
      const prompts = [...$("discover-prompts")!.querySelectorAll<HTMLButtonElement>("button")];
      expect(prompts.map((button) => button.textContent)).toEqual(
        discoverPrompts(genre).map((prompt) => prompt[lang]),
      );
      expect(prompts).toHaveLength(3);
      act(() => prompts[2].click());
      await settle();
      expect($<HTMLInputElement>("discover-topic")!.value).toBe(discoverPrompts(genre)[2][lang]);
      expect(pressed(`genre-${genre}`)).toBe("true");
      expect(discoverAsked).toHaveLength(1);
      expect($("discover-category-only")).not.toBeNull();
      expect(prompts.every((button) => button.className.includes("whitespace-normal"))).toBe(true);
    },
  );

  it("keeps default AI briefs when no category is selected and replaces them with category ideas", async () => {
    await mount({ v2: true });
    await click("discover-mode-ai");
    expect($("research-bar")!.contains($("discover-prompts"))).toBe(true);
    expect($("discover-prompts")!.querySelectorAll("button")).toHaveLength(2);
    expect(discoverAsked).toHaveLength(0);
    await click("genre-coffee");
    expect($("research-bar")!.querySelector('[data-testid="discover-prompts"]')).toBeNull();
    expect(
      $("discover-category-ideas")!.querySelectorAll('[data-testid="discover-prompts"] button'),
    ).toHaveLength(3);
    await click("genres-clear");
    expect($("discover-category-ideas")).toBeNull();
    expect($("research-bar")!.contains($("discover-prompts"))).toBe(true);
  });

  it("searches only the category while preserving the selected AI model, program and filters", async () => {
    await mount({ v2: true, lang: "en", tab: "all" });
    await click("discover-mode-ai");
    await select("ai-provider", "claude");
    await select("ai-model", "claude-fable-5-1");
    await select("discover-program", "davinci");
    await click("filter-time-week");
    await click("filter-len-short");
    await click("filter-sort-popular");
    await click("filter-arfirst");
    type("coffee match cuts");
    await click("genre-coffee");
    type("a different unsubmitted coffee idea");
    const before = discoverAsked.length;
    await click("discover-category-only");
    expect(discoverAsked).toHaveLength(before + 1);
    expect(discoverAsked.at(-1)).toMatchObject({
      mode: "ai",
      q: "coffee edit",
      genreQuery: { ar: "تصوير قهوة" },
      program: "DaVinci Resolve",
      timeRange: "week",
      ytLength: "short",
      aiPlan: { provider: "claude", model: "claude-fable-5-1", effort: "max" },
    });
    expect(localPlans.at(-1)).toMatchObject({
      provider: "claude",
      model: "claude-fable-5-1",
      effort: "max",
      request: { q: "coffee edit" },
    });
    expect($<HTMLTextAreaElement>("discover-topic")!.value).toBe("");
    expect($<HTMLSelectElement>("ai-provider")!.value).toBe("claude");
    expect($<HTMLSelectElement>("ai-model")!.value).toBe("claude-fable-5-1");
    expect($<HTMLSelectElement>("discover-program")!.value).toBe("davinci");
    expect(pressed("genre-coffee")).toBe("true");
    expect(pressed("filter-time-week")).toBe("true");
    expect(pressed("filter-len-short")).toBe("true");
    expect(pressed("filter-sort-popular")).toBe("true");
    expect(pressed("filter-arfirst")).toBe("true");
    expect($("discover-category-only")).toBeNull();
  });

  it("blocks category-only and form/Enter submissions until a subscription model is selected", async () => {
    await mount({ v2: true });
    type("match cut");
    await click("genre-cars");
    await click("discover-mode-ai");
    await select("ai-provider", "claude");
    const before = discoverAsked.length;
    expect($<HTMLButtonElement>("research-search")!.disabled).toBe(true);
    expect($<HTMLButtonElement>("discover-category-only")!.disabled).toBe(true);
    expect($<HTMLButtonElement>("genre-travel")!.disabled).toBe(true);
    await click("discover-category-only");
    await submit("unsubmitted new brief");
    expect(discoverAsked).toHaveLength(before);
    expect(localPlans).toHaveLength(0);
    expect(pressed("genre-cars")).toBe("true");
    expect($<HTMLTextAreaElement>("discover-topic")!.value).toBe("unsubmitted new brief");
    // The suggestions can still prepare a draft without spending anything.
    act(() => $("discover-prompts")!.querySelector<HTMLButtonElement>("button")!.click());
    await settle();
    expect(localPlans).toHaveLength(0);
    expect(discoverAsked).toHaveLength(before);
  });

  it("does not add Discover ideas or category-only actions to skill or legacy panels", async () => {
    await mount({ skillId: "smart-bins-keywords" });
    await click("genre-cars");
    expect($("discover-category-ideas")).toBeNull();
    expect($("discover-category-only")).toBeNull();
  });
});

describe("Discover's trending effects row", () => {
  it("a chip is a Keywords search, even right after an AI search: no AI plan, no subscription use", async () => {
    effectsDoc = EFFECTS;
    await mount({ v2: true, lang: "en" });
    await click("discover-mode-ai");
    await select("ai-provider", "claude");
    await select("ai-model", "claude-fable-5-1");
    await submit("coffee match cuts");
    expect(discoverAsked.at(-1)).toMatchObject({ mode: "ai", q: "coffee match cuts" });
    expect(localPlans).toHaveLength(1);

    const chip = host.querySelector<HTMLElement>(
      '[data-testid="trending-effect"][data-key="clone-effect"]',
    )!;
    act(() => chip.click());
    await settle();
    expect(discoverAsked.at(-1)).toEqual({ q: "clone effect" });
    expect(localPlans).toHaveLength(1);
    expect(pressed("discover-mode-keyword")).toBe("true");
    expect(pressed("discover-mode-ai")).toBe("false");
    expect($<HTMLInputElement>("discover-topic")!.value).toBe("clone effect");
  });

  it("is not in a skill's panel, even on a Discover v2 Worker", async () => {
    effectsDoc = EFFECTS;
    await mount({ skillId: "smart-bins-keywords", v2: true });
    expect(discoverAsked).toHaveLength(1);
    expect($("trending-effects")).toBeNull();
    expect(effectsAsked).toBe(0);
  });
});

describe("ResearchPanel Most popular sort and stats chips", () => {
  it("shows views, else likes, on a card, with the raw counts as data attributes", async () => {
    await mount({ tab: "all" });
    await submit("match cut");
    expect(titles()).toEqual(["yt-a", "tt-a", "ig-a", "tt-b"]);
    const chips = all("result-card").map((c) => c.querySelector('[data-testid="result-stats"]'));
    expect(chips.map((c) => c?.getAttribute("data-kind") ?? null)).toEqual([
      "views",
      "likes",
      null,
      "likes",
    ]);
    const [yt, tt] = chips;
    expect(yt?.getAttribute("data-views")).toBe("5400");
    expect(yt?.getAttribute("data-likes")).toBe("310");
    expect(yt?.textContent).toContain("👁");
    expect(yt?.textContent).toContain("مشاهدة");
    expect(tt?.getAttribute("data-likes")).toBe("1200");
    expect(tt?.hasAttribute("data-views")).toBe(false);
    expect(tt?.textContent).toContain("❤️");
    expect(tt?.textContent).toContain("إعجاب");
  });

  it("orders what is shown by popularity, locally, and counts as an active filter", async () => {
    await mount({ tab: "all" });
    await submit("match cut");
    expect(asked).toHaveLength(3);
    expect(pressed("filter-sort-relevance")).toBe("true");
    expect($("filters-count")).toBeNull();

    await click("filter-sort-popular");
    expect(pressed("filter-sort-popular")).toBe("true");
    expect(pressed("filter-sort-relevance")).toBe("false");
    expect(titles()).toEqual(["tt-b", "tt-a", "yt-a", "ig-a"]);
    expect($("filters-count")?.textContent).toBe("1");
    expect($("popular-note")).toBeNull();
    // The same requests, the same credits, the same badges.
    expect(asked).toHaveLength(3);
    expect($("scout-usage")?.getAttribute("data-count")).toBe("3");
    expect($("tab-all")?.getAttribute("data-count")).toBe("4");

    await click("tab-tt");
    expect(titles()).toEqual(["tt-b", "tt-a"]);

    // No count on any shown card: the note says why nothing moved.
    await click("tab-ig");
    expect(titles()).toEqual(["ig-a"]);
    expect($("popular-note")?.textContent).toContain("ما وصلنا أرقام");

    await click("filter-sort-relevance");
    expect($("popular-note")).toBeNull();
    await click("tab-all");
    expect(titles()).toEqual(["yt-a", "tt-a", "ig-a", "tt-b"]);
    expect(asked).toHaveLength(3);
  });

  it("asks YouTube by view count only when popular, and fills the chips from the statistics call", async () => {
    await mount({ tab: "yt", youtubeKey: "AIzaFAKE" });
    await click("genre-cars");
    expect(titles()).toEqual(["Quiet one", "Big one", "No numbers"]);
    expect(ytSearches).toHaveLength(1);
    expect(ytSearches[0].searchParams.get("q")).toBe(CARS_AR);
    expect(ytSearches[0].searchParams.has("order")).toBe(false);
    expect(ytStats).toHaveLength(1);
    expect(ytStats[0].searchParams.get("id")).toBe("quiet,big,hidden");
    expect(all("result-stats").map((c) => c.getAttribute("data-views"))).toEqual([
      "900",
      "2500000",
    ]);

    await click("filter-sort-popular");
    expect(ytSearches).toHaveLength(2);
    expect(ytSearches[1].searchParams.get("order")).toBe("viewCount");
    expect(titles()).toEqual(["Big one", "Quiet one", "No numbers"]);
    expect($("tab-yt")?.getAttribute("data-count")).toBe("3");

    // Both orders are cached for the session; the Worker is never asked for YouTube.
    await click("filter-sort-relevance");
    expect(titles()).toEqual(["Quiet one", "Big one", "No numbers"]);
    await click("filter-sort-popular");
    expect(ytSearches).toHaveLength(2);
    expect(ytStats).toHaveLength(2);
    expect(asked).toEqual([]);
  });

  it("keeps the videos when the statistics call fails, and says there are no numbers", async () => {
    statsDown = true;
    await mount({ tab: "yt", youtubeKey: "AIzaFAKE" });
    await submit("car edit");
    expect(titles()).toEqual(["Quiet one", "Big one", "No numbers"]);
    expect($("yt-error")).toBeNull();
    expect(all("result-stats")).toEqual([]);
    expect($("popular-note")).toBeNull();
    await click("filter-sort-popular");
    expect(titles()).toEqual(["Quiet one", "Big one", "No numbers"]);
    expect($("popular-note")).not.toBeNull();
  });
});

describe("ResearchPanel Most viewed this week", () => {
  const HOUR = 3_600_000;
  const iso = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();

  /** A row as the Worker's keyword scan writes it for a genre's main query (Arabic cars by default). */
  const weekRow = (over: Partial<TrendItemInput> & { id: string }): TrendItemInput => ({
    platform: "youtube",
    region: "SA",
    lang: "ar",
    title: over.id,
    url: `https://www.youtube.com/shorts/${over.id}`,
    thumb: `https://i.ytimg.com/vi/${over.id}/mqdefault.jpg`,
    source: "YouTube search",
    why: "قناة السيارات",
    seenAt: iso(HOUR),
    genre: "cars",
    tags: ["ايديت سيارات", "short"],
    ...over,
  });
  const feed = (items: TrendItemInput[], fetchedAt = iso()): TrendsFeedInput => ({
    items,
    fetchedAt,
    degraded: false,
    sources: [],
  });
  /** Eight Arabic car rows (scores 10..80), a better one with no link, one English, one food, one plain. */
  const ROWS = [
    ...Array.from({ length: 8 }, (_, i) =>
      weekRow({ id: `car${i + 1}`, score: (i + 1) * 10, volume: (i + 1) * 1000 }),
    ),
    weekRow({ id: "no-link", score: 99, url: undefined }),
    weekRow({ id: "car-en", region: "US", lang: "en", score: 50, tags: ["car edit"] }),
    weekRow({ id: "food1", genre: "food", score: 60, tags: ["مونتاج أكل"] }),
    weekRow({ id: "plain", genre: undefined, score: 100 }),
  ];
  const store = (items: TrendItemInput[], fetchedAt?: string) =>
    act(() => useStore.getState().setTrends(feed(items, fetchedAt)));

  const strip = () => $("genre-week");
  const weekTitles = () =>
    [...(strip()?.querySelectorAll('[data-testid="result-title"]') ?? [])].map(
      (el) => el.textContent,
    );
  const weekItem = (title: string) =>
    all("genre-week-item").find((li) => li.textContent?.includes(title));

  it("shows the rows of the picked genre, in the search language, best first, six at most", async () => {
    store(ROWS);
    await mount();
    expect(strip()).toBeNull();

    await click("genre-cars");
    const section = strip()!;
    expect(section.getAttribute("data-genre")).toBe("cars");
    expect(section.getAttribute("data-count")).toBe("6");
    expect(weekTitles()).toEqual(["car8", "car7", "car6", "car5", "car4", "car3"]);
    expect($("genre-week-title")!.textContent).toBe("📈 الأكثر مشاهدة هالأسبوع");
    expect($("genre-week-title")!.tagName).toBe("H2");
    // Honest about where the rows come from: a YouTube search for the genre, read by the radar.
    expect($("genre-week-source")!.textContent).toBe("من رادار الترند: بحث يوتيوب عن سيارات");

    // The panel's own cards: YouTube, the channel, the views, the thumbnail, the one watch link.
    const top = weekItem("car8")!;
    expect(top.getAttribute("data-platform")).toBe("yt");
    expect(top.textContent).toContain("قناة السيارات");
    const stats = top.querySelector('[data-testid="result-stats"]')!;
    expect(stats.getAttribute("data-kind")).toBe("views");
    expect(stats.getAttribute("data-views")).toBe("8000");
    expect(top.querySelector('[data-testid="result-thumb"]')!.getAttribute("src")).toBe(
      "https://i.ytimg.com/vi/car8/mqdefault.jpg",
    );
    expect(top.querySelector('[data-testid="result-open"]')!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=car8",
    );
    // One row of fixed-width cards that scrolls sideways, above the results, never inside them.
    const list = $("genre-week-list")!;
    expect(list.className.split(" ")).toEqual(
      expect.arrayContaining(["overflow-x-auto", "min-w-0"]),
    );
    expect(list.className.split(" ")).not.toContain("flex-wrap");
    expect(all("genre-week-item").every((li) => li.className.split(" ").includes("shrink-0"))).toBe(
      true,
    );
    // Each card holds its absolute bits (the counts' screen-reader words): out of view, they stay in the row.
    expect(all("genre-week-item").every((li) => li.className.split(" ").includes("relative"))).toBe(
      true,
    );
    expect(section.className.split(" ")).toContain("min-w-0");
    const results = $("research-results")!;
    expect(
      section.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(results.contains(section)).toBe(false);
    // The stored feed is fresh: nothing was asked of the Worker's trends.
    expect(trendsCalls).toEqual([]);

    // The search language picks the rows: English ones for English words.
    await click("research-lang-en");
    expect(weekTitles()).toEqual(["car-en"]);

    // Another genre, another strip; one without rows has none.
    await click("research-lang-ar");
    await click("genre-food");
    expect(strip()!.getAttribute("data-genre")).toBe("food");
    expect(weekTitles()).toEqual(["food1"]);
    expect($("genre-week-source")!.textContent).toBe("من رادار الترند: بحث يوتيوب عن أكل ومطاعم");
    await click("genre-anime");
    expect(strip()).toBeNull();
    await click("genre-cars");
    expect(strip()).not.toBeNull();
    await click("genres-clear");
    expect(strip()).toBeNull();
    expect(trendsCalls).toEqual([]);
  });

  it("is hidden with Saved only on and for an owner's genre, with no empty state", async () => {
    store(ROWS);
    useStore.getState().addCustomGenre("Drift", "drift edit");
    await mount();

    await click("genre-custom-drift");
    expect(pressed("genre-custom-drift")).toBe("true");
    expect(strip()).toBeNull();
    expect(host.textContent).not.toContain("الأكثر مشاهدة");

    await click("genre-cars");
    expect(strip()).not.toBeNull();
    await click("filter-saved");
    expect(strip()).toBeNull();
    expect(host.textContent).not.toContain("الأكثر مشاهدة");
    await click("filter-saved");
    expect(weekTitles()).toHaveLength(6);
  });

  it("reads a stale feed from the Worker once a genre is picked: GET /trends only, once", async () => {
    store([weekRow({ id: "old", score: 90 })], iso(7 * HOUR));
    workerFeed = feed([weekRow({ id: "new1", score: 80 }), weekRow({ id: "new2", score: 70 })]);
    await mount();
    // Never on mount without a genre.
    expect(trendsCalls).toEqual([]);

    await click("genre-cars");
    expect(trendsCalls).toEqual(["GET /trends"]);
    expect(weekTitles()).toEqual(["new1", "new2"]);
    expect(useStore.getState().trends.items.map((i) => i.id)).toEqual(["new1", "new2"]);

    // Once in the panel's life: other genres, the same one again, another language ask nothing more.
    await click("genre-food");
    await click("genre-cars");
    await click("research-lang-en");
    expect(trendsCalls).toEqual(["GET /trends"]);
  });

  it("asks nothing without a Worker, and waits for Saved only to go off", async () => {
    store([weekRow({ id: "old", score: 90 })], iso(7 * HOUR));
    workerFeed = feed([weekRow({ id: "new1", score: 80 })]);
    await mount({ worker: false });
    await click("genre-cars");
    // No Worker: the stored rows still show, and nothing is fetched.
    expect(weekTitles()).toEqual(["old"]);
    expect(trendsCalls).toEqual([]);

    // With the Worker, but Saved only on: no strip to fill, so nothing is asked until it goes off.
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    await click("filter-saved");
    await click("genre-cars");
    expect(strip()).toBeNull();
    expect(trendsCalls).toEqual([]);
    await click("filter-saved");
    expect(trendsCalls).toEqual(["GET /trends"]);
    expect(weekTitles()).toEqual(["new1"]);
    await click("filter-saved");
    await click("filter-saved");
    expect(trendsCalls).toEqual(["GET /trends"]);
  });

  it("attaches a card of the strip to a skill like a search card (Discover)", async () => {
    store(ROWS);
    await mount();
    await click("genre-cars");
    const attach = weekItem("car8")!.querySelector<HTMLElement>('[data-testid="result-attach"]')!;
    act(() => attach.click());
    await settle();
    expect($("skill-picker")).not.toBeNull();
    await click("skill-picker-option");
    expect($("skill-picker")).toBeNull();
    const target = skills[0];
    // The same reference a search card for that video saves: the watch link, no counts.
    expect(useStore.getState().savedRefs[target.id]).toEqual([
      {
        platform: "yt",
        handle: "قناة السيارات",
        title: "car8",
        url: "https://www.youtube.com/watch?v=car8",
        thumb: "https://i.ytimg.com/vi/car8/mqdefault.jpg",
      },
    ]);
    const attached = weekItem("car8")!.querySelector('[data-testid="result-attached"]');
    expect(attached?.textContent).toContain(target.name.ar);
  });

  it("shows in the skill sheet's panel too, where a card attaches to that skill", async () => {
    store(ROWS);
    await mount({ skillId: "smart-bins-keywords" });
    expect(strip()).toBeNull();
    await click("genre-cars");
    expect(weekTitles()).toEqual(["car8", "car7", "car6", "car5", "car4", "car3"]);
    // One level under the sheet's own title (the skill's name is its h2).
    expect($("genre-week-title")!.tagName).toBe("H3");

    const attach = () =>
      weekItem("car7")!.querySelector<HTMLElement>('[data-testid="result-attach"]')!;
    expect(attach().getAttribute("aria-pressed")).toBe("false");
    act(() => attach().click());
    await settle();
    expect(attach().getAttribute("aria-pressed")).toBe("true");
    expect(useStore.getState().savedRefs["smart-bins-keywords"]?.map((r) => r.url)).toEqual([
      "https://www.youtube.com/watch?v=car7",
    ]);
    act(() => attach().click());
    await settle();
    expect(useStore.getState().savedRefs["smart-bins-keywords"] ?? []).toEqual([]);
  });
});

describe("Discover category pages (planning/tools/19-category-trends.md §1)", () => {
  const CATEGORY = {
    status: "ok",
    updatedAt: new Date().toISOString(),
    items: [
      {
        key: "rolling-shot",
        name: { en: "rolling shot", ar: "لقطة متحركة" },
        isNew: true,
        checked: true,
        creators: 4,
        posts: 4,
        platforms: ["tt"],
        growth: 3,
        samples: [],
      },
    ],
  };

  it("a category tapped with nothing typed shows its page instead of searching; Search all runs the category search", async () => {
    categoryDoc = CATEGORY;
    await mount({ v2: true, lang: "en" });
    await click("genre-cars");
    expect($("category-page")).not.toBeNull();
    expect(discoverAsked).toHaveLength(0);
    expect(pressed("genre-cars")).toBe("true");
    expect($("research-results")!.hidden).toBe(true);
    await click("category-search-all");
    expect($("category-page")).toBeNull();
    expect($("research-results")!.hidden).toBe(false);
    expect(discoverAsked).toEqual([{ q: "car edit", genreQuery: { ar: "ايديت سيارات" } }]);
  });

  it("a style is a Keywords search of it within the category, even from AI mode", async () => {
    categoryDoc = CATEGORY;
    await mount({ v2: true });
    await click("discover-mode-ai");
    await click("genre-cars");
    act(() =>
      host
        .querySelector<HTMLElement>('[data-testid="category-style"][data-key="rolling-shot"]')!
        .click(),
    );
    await settle();
    expect(discoverAsked).toEqual([
      { q: "rolling shot", genreQuery: { ar: "ايديت سيارات", en: "car edit" } },
    ]);
    expect(pressed("discover-mode-keyword")).toBe("true");
    expect($("category-page")).toBeNull();
    expect($<HTMLInputElement>("discover-topic")!.value).toBe("rolling shot");
  });

  it("typed text still narrows the search; an older Worker (404) gets the category search", async () => {
    categoryDoc = CATEGORY;
    await mount({ v2: true });
    type("drift");
    await click("genre-cars");
    expect($("category-page")).toBeNull();
    expect(discoverAsked.at(-1)).toMatchObject({ q: "drift", genreQuery: { en: "car edit" } });
    categoryDoc = null;
    await click("genres-clear");
    type("");
    await click("genre-food");
    expect($("category-page")).toBeNull();
    expect(discoverAsked.at(-1)).toMatchObject({ q: "food edit" });
  });

  it("an owner-added category keeps searching: only the built-in ones have a page", async () => {
    categoryDoc = CATEGORY; // the fake Worker would answer a page for any id
    useStore.getState().addCustomGenre("Drift", "drift edit");
    await mount({ v2: true, lang: "en" });
    await click("genre-custom-drift");
    expect($("category-page")).toBeNull();
    expect(discoverAsked).toEqual([{ q: "drift edit" }]);
  });

  it("with Saved only on, a category leaves the saved list in view; its page opens once Saved only is off", async () => {
    categoryDoc = CATEGORY;
    await mount({ v2: true, lang: "en" });
    await click("filter-saved");
    await click("genre-cars");
    expect($("category-page")).toBeNull();
    expect($("research-results")!.hidden).toBe(false);
    expect($("filters")!.hidden).toBe(false);
    await click("filter-saved");
    expect($("category-page")).not.toBeNull();
    expect($("research-results")!.hidden).toBe(true);
    expect(discoverAsked).toHaveLength(0);
  });
});
