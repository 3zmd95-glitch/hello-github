// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VideoPlayerContext, type PlayableItem } from "@/components/player/VideoPlayerContext";
import { getSkill } from "@/data";
import { GENRES } from "@/data/genres";
import { runCategoryNow } from "@/lib/categories";
import type { Lang } from "@/lib/domain";
import { useStore } from "@/store";
import CategoryPage from "./CategoryPage";

// 🚗 A Discover category's page (planning/tools/19-category-trends.md §1), rendered in jsdom against a fake Worker (a
// stubbed global fetch; nothing leaves the machine). e2e/discover.spec.ts covers it inside the panel.

const CONFIG = { url: "https://cat.scout.test", token: "tok" };
const HOUR = 3_600_000;
const CARS = GENRES.find((g) => g.id === "cars")!;

const ROLLING = {
  key: "rolling-shot",
  name: { en: "rolling shot", ar: "لقطة متحركة" },
  isNew: true,
  checked: true,
  creators: 6,
  posts: 7,
  platforms: ["ig", "tt"],
  growth: 3,
  samples: [],
};
const SPEED = {
  key: "speed-ramp",
  name: { en: "speed ramp", ar: "سبيد رامب" },
  termId: "speed-ramp",
  isNew: false,
  checked: true,
  creators: 9,
  posts: 12,
  platforms: ["tt"],
  growth: 1.2,
  samples: [],
};
/** The Worker's how-to since live fix 2: three labelled English lines. */
const lines = (en: string) =>
  `Shoot: Follow the car for the ${en}.\nSettings: Shutter 1/30 s at ISO 100.\nEdit: In CapCut add a speed curve.`;
const technique = (en: string, ar: string, n: number, skillId?: string) => ({
  name: { en, ar },
  howTo: {
    en: lines(en),
    ar: `طريقة ${ar}: الإعدادات والعدة والمونتاج.`,
  },
  ...(skillId ? { skillId } : {}),
  videos: [
    {
      url: `https://www.tiktok.com/@cars/video/${n}01`,
      title: `example ${n}a`,
      platform: "tt",
      kind: "example",
      lang: "en",
    },
    {
      url: `https://www.instagram.com/p/CARS${n}/`,
      title: `example ${n}b`,
      platform: "ig",
      kind: "example",
      lang: "en",
    },
    {
      url: `https://www.youtube.com/watch?v=carTutor00${n}`,
      title: `tutorial ${n}`,
      platform: "yt",
      kind: "tutorial",
      lang: "en",
    },
  ],
});
const AR_TUTORIAL = {
  url: "https://www.youtube.com/watch?v=arCars00001",
  title: "شرح لقطة السيارة المتحركة",
  platform: "yt",
  kind: "tutorial",
  lang: "ar",
};
const ROLLING_TECH = technique("rolling shot", "لقطة متحركة", 2, "not-a-real-skill");
const LESSONS = {
  updatedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
  photo: [technique("panning", "بانينق", 1, "phone-180-shutter")],
  video: [{ ...ROLLING_TECH, videos: [...ROLLING_TECH.videos, AR_TUTORIAL] }],
  edit: [technique("speed ramp", "سبيد رامب", 3, "speed-ramp-retime")],
};
/** A page made 30 hours ago: "updated 1 d ago". */
const docOf = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  updatedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
  items: [ROLLING, SPEED],
  lessons: LESSONS,
  ...over,
});
const NEVER = { status: "never", items: [] };
const RUN_FAILED = "ما قدرت أشغّل الفحص، جرّب بعد شوي";
// A category's own limit line: nothing retries it tomorrow (its next turn can be 3 days away).
const RUN_LIMIT = "خلصت فحوصات اليوم الثلاثة، تقدر تفحص مرة ثانية بكرة";
const STALE = "ما قدرت أحدّثها اليوم";
const BUDGET = "وقّفت الفحص عشان عمليات البحث حق هالشهر قرّبت تخلص";

/** A top video (§6) of a platform: YouTube's with views and a thumbnail, the others as the scan stores them. */
const topVideo = (platform: "yt" | "tt" | "ig", n: number, views?: number) => ({
  url:
    platform === "yt"
      ? `https://www.youtube.com/watch?v=carTop${String(n).padStart(5, "0")}`
      : platform === "tt"
        ? `https://www.tiktok.com/@car${n}/video/${7_000_000 + n}`
        : `https://www.instagram.com/p/CarTop${n}`,
  title: `Top car edit ${n}`,
  creator: `creator${n}`,
  ...(views === undefined ? {} : { views }),
  ...(platform === "yt"
    ? { thumbnail: `https://i.ytimg.com/vi/carTop${String(n).padStart(5, "0")}/mqdefault.jpg` }
    : {}),
});
/** The stored lists: 30 YouTube videos (most viewed first), no TikTok post, 14 reels. */
const TOP = {
  updatedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
  yt: Array.from({ length: 30 }, (_, i) => topVideo("yt", i + 1, (30 - i) * 1000)),
  tt: [],
  ig: Array.from({ length: 14 }, (_, i) => topVideo("ig", i + 1)),
};

/** What `GET /categories/cars` answers; null = an older Worker without the route (404). */
let page: unknown;
let runAnswer: { body: unknown; status: number };
let posts: RequestInit[];
/** Holds `POST /categories/cars/run` until the test lets it answer. */
let releaseRun: (() => void) | undefined;
/** When set, `GET /categories/cars` waits for it. */
let getGate: Promise<void> | undefined;
/** What `GET /categories/cars/top/<platform>` answers (Brave on demand), the platforms asked in order, and a gate the
 * answer waits for when set. */
let topAnswers: Partial<Record<"tt" | "ig", { body: unknown; status?: number }>>;
let topAsked: string[];
let topGate: Promise<void> | undefined;
let calls: {
  style: string[];
  all: number;
  skill: string[];
  unavailable: number;
  played: PlayableItem[];
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { pathname } = new URL(String(input));
  if (pathname === "/categories/cars" && !init?.method) {
    await getGate;
    return page === null ? json({ error: "not_found" }, 404) : json(page);
  }
  if (pathname === "/categories/cars/run" && init?.method === "POST") {
    posts.push(init);
    await new Promise<void>((r) => (releaseRun = r));
    return json(runAnswer.body, runAnswer.status);
  }
  const top = pathname.match(/^\/categories\/cars\/top\/(tt|ig)$/);
  if (top && !init?.method) {
    const p = top[1] as "tt" | "ig";
    topAsked.push(p);
    await topGate;
    const a = topAnswers[p] ?? {
      body: { platform: p, items: [], source: "scan", note: "no_key" },
    };
    return json(a.body, a.status ?? 200);
  }
  return json({ error: "not_found" }, 404);
}

let host: HTMLDivElement;
let root: Root;
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const all = (testId: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`),
];
const style = (key: string) =>
  host.querySelector<HTMLElement>(`[data-testid="category-style"][data-key="${key}"]`)!;
const styleKeys = () => all("category-style").map((s) => s.getAttribute("data-key"));
const shelves = () => all("category-shelf");
const runButton = () => $("category-run") as HTMLButtonElement;
const rescan = () => $("category-rescan") as HTMLButtonElement;
const status = () => $("category-status")!.textContent;
const videos = (card: HTMLElement) =>
  [...card.querySelectorAll('[data-testid="category-video"]')].map(
    (v) => `${v.getAttribute("data-kind")}:${v.getAttribute("data-lang")}`,
  );
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function mount(lang: Lang = "ar", props: { searchBlocked?: boolean } = {}) {
  useStore.getState().setSettings({ lang });
  const player = {
    current: null,
    open: (i: PlayableItem) => void calls.played.push(i),
    close() {},
  };
  act(() =>
    root.render(
      createElement(
        VideoPlayerContext.Provider,
        { value: player },
        createElement(CategoryPage, {
          config: CONFIG,
          genre: CARS,
          onPickStyle: (q: string) => void calls.style.push(q),
          onSearchAll: () => void calls.all++,
          onOpenSkill: (id: string) => void calls.skill.push(id),
          onUnavailable: () => void calls.unavailable++,
          ...props,
        }),
      ),
    ),
  );
  await settle();
}

/** Lets the held scan answer, and React settle. */
async function answerRun() {
  releaseRun!();
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  page = docOf();
  runAnswer = { body: docOf({ updatedAt: new Date().toISOString() }), status: 200 };
  posts = [];
  releaseRun = undefined;
  getGate = undefined;
  topAnswers = {};
  topAsked = [];
  topGate = undefined;
  calls = { style: [], all: 0, skill: [], unavailable: 0, played: [] };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  // A scan a failed test left waiting would hold up the next one (one scan per category at a time).
  releaseRun?.();
  await settle();
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("the category page", () => {
  it("hands back to the category search when the Worker has no page (an older Worker's 404)", async () => {
    page = null;
    await mount();
    expect(calls.unavailable).toBe(1);
    expect($("category-page")).toBeNull();
  });

  it("in Arabic: the header, this week's styles, the three shelves and their technique cards", async () => {
    await mount("ar");
    const cat = $("category-page")!;
    expect(cat.getAttribute("data-state")).toBe("page");
    expect(cat.querySelector("h2")!.textContent).toBe("🚗 سيارات");
    expect(cat.textContent).toContain("تحدّثت قبل 1 يوم");
    expect(cat.textContent).toContain("🔥 الترند في سيارات هالأسبوع");
    expect(styleKeys()).toEqual(["rolling-shot", "speed-ramp"]);
    // English first (live fix 1): a style shows its English name, its Arabic one in the tooltip.
    expect(style("rolling-shot").textContent).toContain("rolling shot");
    expect(style("rolling-shot").textContent).not.toContain("لقطة متحركة");
    expect(style("rolling-shot").title).toBe("لقطة متحركة");
    expect(style("rolling-shot").textContent).toContain("جديد");
    expect(style("rolling-shot").textContent).toContain("6 صنّاع");
    expect(style("speed-ramp").textContent).not.toContain("جديد");
    // The 🔥 row's label: the English name first, NEW, creators (and the line of what it is, when there is one).
    expect(style("rolling-shot").getAttribute("aria-label")).toBe("rolling shot · جديد · 6 صنّاع");
    expect(style("speed-ramp").getAttribute("aria-label")).toBe("speed ramp · 9 صنّاع");
    expect(
      shelves().map((s) => [s.getAttribute("data-area"), s.querySelector("h3")!.textContent]),
    ).toEqual([
      ["photo", "📷 تصوير فوتو"],
      ["video", "🎥 تصوير فيديو"],
      ["edit", "✂️ مونتاج"],
    ]);
    const [panning, rolling, speed] = all("category-technique");
    // English first: the name, then the Arabic one as a muted line, right to left.
    expect(panning.querySelector("h4")!.textContent).toBe("panning");
    const nameAr = panning.querySelector('[data-testid="category-name-ar"]')!;
    expect(nameAr.textContent).toBe("بانينق");
    expect(nameAr.getAttribute("dir")).toBe("rtl");
    // The English how-to, left to right with its ✦ AI badge, then the Arabic one, right to left. e2e/discover.spec.ts
    // checks the directions and the lines in Chromium.
    const howTo = panning.querySelector('[data-testid="category-howto"]')!;
    expect(howTo.getAttribute("dir")).toBe("ltr");
    expect(howTo.querySelector('[data-testid="category-ai"]')!.textContent).toBe("✦ AI");
    // Live fix 2: its Shoot, Settings and Edit lines, each on its own line.
    expect(howTo.textContent).toBe(`✦ AI${lines("panning")}`);
    expect(howTo.classList.contains("whitespace-pre-line")).toBe(true);
    const howToAr = panning.querySelector('[data-testid="category-howto-ar"]')!;
    expect(howToAr.getAttribute("dir")).toBe("rtl");
    expect(howToAr.textContent).toBe("طريقة بانينق: الإعدادات والعدة والمونتاج.");
    // 🎯 only for a skill the app knows: the craft skill and the DaVinci one, never an unknown id.
    expect(panning.querySelector('[data-testid="category-skill"]')!.textContent).toContain(
      getSkill("phone-180-shutter")!.name.ar,
    );
    expect(rolling.querySelector('[data-testid="category-skill"]')).toBeNull();
    expect(speed.querySelector('[data-testid="category-skill"]')).not.toBeNull();
    expect(videos(rolling)).toEqual(["example:en", "example:en", "tutorial:en", "tutorial:ar"]);
    expect(rolling.textContent).toContain("شرح بالعربي");
    expect($("category-search-all")!.textContent).toBe("شوف كل فيديوهات سيارات ←");
  });

  it("in English: the same page in English", async () => {
    await mount("en");
    const cat = $("category-page")!;
    expect(cat.querySelector("h2")!.textContent).toBe("🚗 Cars");
    expect(cat.textContent).toContain("updated 1 d ago");
    expect(cat.textContent).toContain("🔥 Trending in Cars this week");
    expect(shelves().map((s) => s.querySelector("h3")!.textContent)).toEqual([
      "📷 Photography",
      "🎥 Videography",
      "✂️ Editing",
    ]);
    expect(all("category-technique")[1].querySelector("h4")!.textContent).toBe("rolling shot");
    // In English no Arabic lines; a style's Arabic name stays in its tooltip.
    expect($("category-name-ar")).toBeNull();
    expect($("category-howto-ar")).toBeNull();
    expect(style("rolling-shot").title).toBe("لقطة متحركة");
    expect($("category-search-all")!.textContent).toBe("Search all Cars videos →");
  });

  it("a technique in English only (live fix 1) shows no Arabic lines, in Arabic too", async () => {
    const english = {
      ...technique("panning", "بانينق", 1),
      name: { en: "panning" },
      howTo: { en: "Pan with the car at 1/30 s, then add blur in CapCut." },
    };
    page = docOf({ lessons: { ...LESSONS, photo: [english] } });
    await mount("ar");
    const panning = all("category-technique")[0];
    expect(panning.querySelector("h4")!.textContent).toBe("panning");
    expect(panning.querySelector('[data-testid="category-name-ar"]')).toBeNull();
    expect(panning.querySelector('[data-testid="category-howto-ar"]')).toBeNull();
    expect(panning.querySelector('[data-testid="category-howto"]')!.textContent).toBe(
      "✦ AIPan with the car at 1/30 s, then add blur in CapCut.",
    );
  });

  it("a style searches it, Search all searches the category, the skill opens, a video plays in the app", async () => {
    await mount();
    act(() => style("rolling-shot").click());
    act(() => $("category-search-all")!.click());
    const panning = all("category-technique")[0];
    act(() => panning.querySelector<HTMLElement>('[data-testid="category-skill"]')!.click());
    act(() =>
      panning
        .querySelector<HTMLElement>('[data-testid="category-video"][data-kind="tutorial"]')!
        .click(),
    );
    expect(calls.style).toEqual(["rolling shot"]);
    expect(calls.all).toBe(1);
    expect(calls.skill).toEqual(["phone-180-shutter"]);
    expect(calls.played).toEqual([
      { platform: "yt", url: "https://www.youtube.com/watch?v=carTutor001", title: "tutorial 1" },
    ]);
  });

  it("before the first scan: 'Scan Cars now' runs it once, waits, then shows the page", async () => {
    page = NEVER;
    await mount();
    expect($("category-page")!.getAttribute("data-state")).toBe("never");
    expect($("category-styles")).toBeNull();
    act(() => runButton().click());
    await settle();
    expect(runButton().disabled).toBe(true);
    expect(status()).toBe("أفحص سيارات… ممكن ياخذ دقيقة");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toBeUndefined();
    await answerRun();
    expect($("category-page")!.getAttribute("data-state")).toBe("page");
    expect(styleKeys()).toEqual(["rolling-shot", "speed-ramp"]);
  });

  it("a first scan that gets no answer keeps the button with its line; so does the Worker's own failed run", async () => {
    page = NEVER;
    runAnswer = { body: { error: "upstream" }, status: 502 };
    await mount();
    act(() => runButton().click());
    await settle();
    await answerRun();
    expect(runButton().disabled).toBe(false);
    expect(status()).toBe(RUN_FAILED);
    act(() => root.unmount());
    root = createRoot(host);
    page = { status: "failed", updatedAt: new Date().toISOString(), notes: ["quota"], items: [] };
    await mount();
    expect($("category-page")!.getAttribute("data-state")).toBe("never");
    expect(status()).toBe(RUN_FAILED);
  });

  it("Scan again sends force: true and shows 'just now'; over the day's tries it rests with the limit line", async () => {
    await mount();
    act(() => rescan().click());
    await settle();
    expect(rescan().disabled).toBe(true);
    await answerRun();
    expect(JSON.parse(String(posts[0].body))).toEqual({ force: true });
    expect($("category-page")!.textContent).toContain("تحدّثت الحين");
    runAnswer = { body: docOf({ notes: ["attempts"] }), status: 200 };
    act(() => rescan().click());
    await settle();
    await answerRun();
    expect(status()).toBe(RUN_LIMIT);
    expect(rescan().disabled).toBe(true);
  });

  it("stale: a failed update keeps the old page with 'Couldn't update today'", async () => {
    page = docOf({ status: "failed", notes: ["quota"] });
    await mount();
    expect($("category-page")!.getAttribute("data-state")).toBe("stale");
    expect($("category-page")!.textContent).toContain(STALE);
    expect(styleKeys()).toHaveLength(2);
  });

  it("says so when nothing trends widely enough yet, and when the lessons come with the next scan", async () => {
    page = docOf({ items: [], lessons: undefined });
    await mount();
    expect($("category-page")!.textContent).toContain("لسه ما فيه ستايل منتشر كفاية هنا");
    expect($("category-page")!.textContent).toContain("الدروس توصل مع الفحص الجاي");
    expect(shelves()).toHaveLength(0);
  });

  // Task 2's review: a scan paused on the month's credits answers `failed`, its page and date kept, noted
  // `tavily_budget`. The line comes from the notes and the date, never from the status alone.
  it("a paused month says so, never 'Couldn't update today'; a page made earlier today failed a scan, not the day", async () => {
    // Scan again while the month's credits are nearly spent: the page stays as it was, the line says why.
    page = docOf({ updatedAt: new Date().toISOString() });
    runAnswer = {
      body: docOf({
        status: "failed",
        notes: ["tavily_budget"],
        updatedAt: new Date().toISOString(),
      }),
      status: 200,
    };
    await mount();
    act(() => rescan().click());
    await settle();
    await answerRun();
    const cat = $("category-page")!;
    expect(cat.getAttribute("data-state")).toBe("stale");
    expect(status()).toBe(BUDGET);
    expect(cat.textContent).not.toContain(STALE);
    expect(styleKeys()).toHaveLength(2);
    expect(rescan().disabled).toBe(false); // a paused scan spends nothing: a retry may go through
    act(() => root.unmount());

    // The same page opened later: still the budget line, once.
    root = createRoot(host);
    sessionStorage.clear();
    page = runAnswer.body;
    await mount();
    expect(status()).toBe("");
    expect($("category-page")!.textContent).not.toContain(STALE);
    expect($("category-page")!.textContent!.split(BUDGET)).toHaveLength(2);
    act(() => root.unmount());

    // A failed update over a page made earlier today: the scan failed, the day had its update. On a fixed clock (local
    // noon, the page made at 09:00), so the page and the check never fall on two sides of midnight.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    root = createRoot(host);
    sessionStorage.clear();
    page = docOf({
      status: "failed",
      notes: ["quota"],
      updatedAt: new Date(2026, 9, 7, 9).toISOString(),
    });
    await mount();
    expect($("category-page")!.textContent).toContain(RUN_FAILED);
    expect($("category-page")!.textContent).not.toContain(STALE);
    act(() => root.unmount());
    vi.useRealTimers();

    // Never scanned, and the month already tight: the first-scan button with the budget line.
    root = createRoot(host);
    sessionStorage.clear();
    page = {
      status: "failed",
      updatedAt: new Date().toISOString(),
      notes: ["tavily_budget"],
      items: [],
    };
    await mount();
    expect($("category-page")!.getAttribute("data-state")).toBe("never");
    expect(status()).toBe(BUDGET);
    expect(runButton().disabled).toBe(false);
  });

  it("a scan answered with no page (the Worker could not read its copy) leaves the page on screen", async () => {
    runAnswer = {
      body: { status: "failed", updatedAt: new Date().toISOString(), notes: ["kv"], items: [] },
      status: 200,
    };
    await mount();
    act(() => rescan().click());
    await settle();
    await answerRun();
    expect($("category-page")!.getAttribute("data-state")).toBe("page");
    expect(styleKeys()).toHaveLength(2);
    expect(shelves()).toHaveLength(3);
    expect(status()).toBe(RUN_FAILED);
  });

  it("opened again during its scan, waits for that same scan: no second request", async () => {
    await mount();
    act(() => rescan().click());
    await settle();
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(status()).toBe("أفحص سيارات… ممكن ياخذ دقيقة");
    expect(rescan().disabled).toBe(true);
    await answerRun();
    expect(posts).toHaveLength(1);
    expect($("category-page")!.textContent).toContain("تحدّثت الحين");
    expect(status()).toBe("");
  });

  it("after a scan, moves focus to its heading only when the owner was on the page", async () => {
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    try {
      await mount();
      const scan = async () => {
        act(() => rescan().click());
        await settle();
        await answerRun();
      };
      // Busy elsewhere (typing in another box): focus stays there.
      elsewhere.focus();
      await scan();
      expect(document.activeElement).toBe(elsewhere);
      // On the page (a style chip), or nowhere: the heading, which reads out the new page.
      const heading = $("category-page")!.querySelector("h2");
      style("rolling-shot").focus();
      await scan();
      expect(document.activeElement).toBe(heading);
      elsewhere.focus();
      elsewhere.blur();
      await scan();
      expect(document.activeElement).toBe(heading);
    } finally {
      elsewhere.remove();
    }
  });

  it("a video the player can't embed (a TikTok photo post) links out in a new tab", async () => {
    const photoPost = {
      url: "https://www.tiktok.com/@cars/photo/7001",
      title: "carousel",
      platform: "tt",
      kind: "example",
      lang: "en",
    };
    page = docOf({
      lessons: {
        ...LESSONS,
        photo: [{ ...technique("panning", "بانينق", 1), videos: [photoPost] }],
      },
    });
    await mount();
    const video = all("category-technique")[0].querySelector('[data-testid="category-video"]')!;
    expect(video.tagName).toBe("A");
    expect(video.getAttribute("href")).toBe(photoPost.url);
    expect(video.getAttribute("target")).toBe("_blank");
    expect(video.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("a GET answering 'never' after this tab's scan landed shows that scan's page, not the first scan", async () => {
    page = NEVER;
    let releaseGet!: () => void;
    getGate = new Promise<void>((r) => (releaseGet = r));
    await mount();
    expect($("category-page")).toBeNull(); // the GET is on its way
    // Meanwhile a scan from another mount of the page answers into this tab's copy.
    await runCategoryNow(CONFIG, "cars", {
      fetchImpl: async () => json(docOf({ updatedAt: new Date().toISOString() })),
    });
    releaseGet();
    await settle();
    expect($("category-page")!.getAttribute("data-state")).toBe("page");
    expect(styleKeys()).toEqual(["rolling-shot", "speed-ramp"]);
  });

  it("drops 'this week' from the trends' title once the page is over 7 days old", async () => {
    page = docOf({ updatedAt: new Date(Date.now() - 8 * 24 * HOUR).toISOString() });
    await mount();
    const titles = () => [...$("category-page")!.querySelectorAll("h3")].map((h) => h.textContent);
    expect(titles()[0]).toBe("🔥 الترند في سيارات");
    act(() => root.unmount());
    root = createRoot(host);
    sessionStorage.clear();
    page = docOf({ updatedAt: new Date(Date.now() - 6 * 24 * HOUR).toISOString() });
    await mount();
    expect(titles()[0]).toBe("🔥 الترند في سيارات هالأسبوع");
  });

  it("renders techniques and videos that share a name or a link (React keys never collide)", async () => {
    const [tutorial] = technique("panning", "بانينق", 1).videos.slice(2);
    const twin = {
      ...technique("panning", "بانينق", 1),
      // The Arabic tutorial at the English one's link.
      videos: [tutorial, { ...tutorial, title: "شرح", lang: "ar" }],
    };
    page = docOf({ lessons: { ...LESSONS, photo: [twin, twin] } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await mount();
      const photo = shelves()[0];
      expect(photo.querySelectorAll('[data-testid="category-technique"]')).toHaveLength(2);
      expect(photo.querySelectorAll('[data-testid="category-video"]')).toHaveLength(4);
      expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    } finally {
      errors.mockRestore();
    }
  });

  it("while Discover can't search (AI mode, no model chosen), Search all rests; a style still searches", async () => {
    await mount("ar", { searchBlocked: true });
    const searchAll = $("category-search-all") as HTMLButtonElement;
    expect(searchAll.disabled).toBe(true);
    act(() => searchAll.click());
    act(() => style("rolling-shot").click());
    expect(calls.all).toBe(0);
    expect(calls.style).toEqual(["rolling shot"]);
  });
});

describe("the 🏆 top videos per platform (§6)", () => {
  const tabs = () => all("category-top-tab");
  const tab = (p: string) =>
    host.querySelector<HTMLButtonElement>(
      `[data-testid="category-top-tab"][data-platform="${p}"]`,
    )!;
  const items = () => all("category-top-item");
  const titles = () =>
    items().map((i) => i.querySelector('[data-testid="result-title"]')!.textContent);
  const more = () => $("category-top-more");
  const line = () => $("category-top-line")!.textContent;
  const open = async (p: string) => {
    act(() => tab(p).click());
    await settle();
  };
  const brave = (p: "tt" | "ig", items: unknown[], note?: string) => ({
    body: { platform: p, items, source: note ? "scan" : "brave", ...(note ? { note } : {}) },
  });

  it("after the 🔥 row: YouTube · TikTok · Instagram with their counts; 12 show, Show more adds 12", async () => {
    page = docOf({ top: TOP });
    await mount("en");
    const headings = [...$("category-page")!.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual(["🔥 Trending in Cars this week", "🏆 Top in Cars"]);
    const list = $("category-top")!.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Top videos by platform");
    // TikTok's count comes with its list (Brave's, asked when the tab opens).
    expect(tabs().map((b) => [b.dataset.platform, b.textContent, b.dataset.count])).toEqual([
      ["yt", "▶30YouTube", "30"],
      ["tt", "♪TikTok", ""],
      ["ig", "📷14Instagram", "14"],
    ]);
    expect(tab("yt").getAttribute("aria-selected")).toBe("true");
    expect(tab("yt").tabIndex).toBe(0);
    expect(tab("tt").tabIndex).toBe(-1);
    const panel = $("category-top-panel")!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("yt").id);
    // Best first, 12 at a time, as Discover's result cards: views and the creator when known.
    expect(titles()).toEqual(TOP.yt.slice(0, 12).map((v) => v.title));
    const first = items()[0];
    expect(first.querySelector('[data-testid="result-stats"]')!.getAttribute("data-views")).toBe(
      "30000",
    );
    expect(first.textContent).toContain("creator1");
    expect(first.querySelector("img")!.getAttribute("src")).toBe(TOP.yt[0].thumbnail);
    expect(more()!.textContent).toBe("Show more (12)");
    act(() => more()!.click());
    expect(items()).toHaveLength(24);
    expect(more()!.textContent).toBe("Show more (6)");
    act(() => more()!.click());
    expect(items()).toHaveLength(30);
    expect(more()).toBeNull();
    // A video plays in the app's player.
    act(() => first.querySelector<HTMLElement>('[data-testid="result-play"]')!.click());
    expect(calls.played[0]).toMatchObject({
      platform: "yt",
      url: TOP.yt[0].url,
      handle: "creator1",
    });
    expect(topAsked).toEqual([]);
  });

  it("TikTok loads on its first open, once a visit: 'Loading…', then Brave's list", async () => {
    page = docOf({ top: TOP });
    let release!: () => void;
    topGate = new Promise<void>((r) => (release = r));
    const tt = [topVideo("tt", 1, 900), topVideo("tt", 2)];
    topAnswers = { tt: brave("tt", tt) };
    await mount("en");
    await open("tt");
    expect(tab("tt").getAttribute("aria-selected")).toBe("true");
    expect(line()).toBe("Loading…");
    release();
    await settle();
    expect(line()).toBe("");
    expect(titles()).toEqual(["Top car edit 1", "Top car edit 2"]);
    expect(items().map((i) => i.dataset.platform)).toEqual(["tt", "tt"]);
    expect(tab("tt").dataset.count).toBe("2");
    await open("yt");
    await open("tt");
    expect(titles()).toEqual(["Top car edit 1", "Top car edit 2"]);
    expect(topAsked).toEqual(["tt"]);
  });

  it("says why a list is the scan's alone: Brave not connected (TikTok), out of reach, or today's searches used up", async () => {
    page = docOf({ top: { ...TOP, tt: [topVideo("tt", 9)] } });
    const lines = [
      ["no_key", "More TikTok results once Brave search is connected"],
      ["brave_failed", "Couldn't reach Brave search right now"],
      ["daily_cap", "Today's Brave searches are used up — more tomorrow"],
    ];
    for (const [note, text] of lines) {
      topAnswers = { tt: brave("tt", [topVideo("tt", 9)], note) };
      act(() => root.unmount());
      root = createRoot(host);
      await mount("en");
      await open("tt");
      expect(line(), note).toBe(text);
      expect(titles()).toEqual(["Top car edit 9"]);
    }
    // No answer at all: the stored list, and Brave out of reach.
    topAnswers = { tt: { body: { error: "upstream" }, status: 502 } };
    act(() => root.unmount());
    root = createRoot(host);
    await mount("en");
    await open("tt");
    expect(line()).toBe("Couldn't reach Brave search right now");
    expect(titles()).toEqual(["Top car edit 9"]);
  });

  it("Instagram tops up from Brave on its first open while its list is under 50; a full list asks nothing", async () => {
    page = docOf({ top: TOP });
    topAnswers = {
      ig: brave(
        "ig",
        Array.from({ length: 20 }, (_, i) => topVideo("ig", i + 1)),
      ),
    };
    await mount("en");
    await open("ig");
    expect(topAsked).toEqual(["ig"]);
    expect(tab("ig").dataset.count).toBe("20");
    expect(items()).toHaveLength(12);
    // Without Brave the stored reels stand on their own: no line on Instagram.
    act(() => root.unmount());
    root = createRoot(host);
    topAnswers = { ig: brave("ig", TOP.ig, "no_key") };
    await mount("en");
    await open("ig");
    expect(line()).toBe("");
    expect(tab("ig").dataset.count).toBe("14");
    act(() => root.unmount());
    root = createRoot(host);
    sessionStorage.clear();
    topAsked = [];
    const full = Array.from({ length: 50 }, (_, i) => topVideo("ig", i + 1));
    page = docOf({ top: { ...TOP, ig: full } });
    await mount("en");
    await open("ig");
    expect(topAsked).toEqual([]);
    expect(tab("ig").dataset.count).toBe("50");
  });

  it("English first in Arabic too: the platforms' own names, the titles as given, read in their own direction", async () => {
    page = docOf({ top: TOP });
    await mount("ar");
    expect($("category-top")!.querySelector("h3")!.textContent).toBe("🏆 الأقوى في سيارات");
    expect(tabs().map((b) => b.textContent)).toEqual(["▶30YouTube", "♪TikTok", "📷14Instagram"]);
    const title = items()[0].querySelector('[data-testid="result-title"]')!;
    expect(title.textContent).toBe("Top car edit 1");
    expect(title.getAttribute("dir")).toBe("auto");
    expect($("category-top")!.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe(
      "أقوى الفيديوهات حسب المنصة",
    );
  });

  it("the arrow keys move between the tabs, mirrored in Arabic", async () => {
    page = docOf({ top: TOP });
    const press = async (key: string) => {
      act(() => {
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
      await settle();
    };
    const selected = () => tabs().find((b) => b.getAttribute("aria-selected") === "true")!;
    await mount("en");
    tab("yt").focus();
    await press("ArrowRight");
    expect(selected().dataset.platform).toBe("tt");
    expect(document.activeElement).toBe(tab("tt"));
    await press("ArrowLeft");
    await press("ArrowLeft");
    expect(selected().dataset.platform).toBe("ig");
    act(() => root.unmount());
    root = createRoot(host);
    await mount("ar");
    tab("yt").focus();
    await press("ArrowLeft");
    expect(selected().dataset.platform).toBe("tt");
  });

  it("a page from before §6 says the top videos come with the next scan", async () => {
    await mount("en");
    expect($("category-top")).toBeNull();
    expect($("category-page")!.textContent).toContain("Top videos come with the next scan");
  });
});
