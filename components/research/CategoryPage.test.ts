// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
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
  study: {
    watchFor: {
      en: "Watch where the car stays in the frame while the background moves.",
      ar: "لاحظ مكان السيارة في الكادر مع حركة الخلفية.",
    },
    tryIt: {
      en: "Film one short movement and compare two different crops.",
      ar: "صوّر حركة قصيرة وقارن كادرين مختلفين.",
    },
    sourceBasis: "title-and-description",
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
/** What `POST /tiktokads/connect` answers (TikTok for Business's authorization page), and the bodies it was sent. */
let connectAnswer: { body: unknown; status?: number };
let connectAsked: unknown[];
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
  if (pathname === "/tiktokads/connect" && init?.method === "POST") {
    connectAsked.push(JSON.parse(String(init.body)));
    return json(connectAnswer.body, connectAnswer.status ?? 200);
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

async function mount(
  lang: Lang = "ar",
  props: Partial<Pick<ComponentProps<typeof CategoryPage>, "searchBlocked" | "renderAction">> = {},
) {
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
  connectAnswer = { body: { error: "not_configured" }, status: 409 };
  connectAsked = [];
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
  it("saves the selected example, shows its preview before study, and keeps one study panel open", async () => {
    const saved: string[] = [];
    await mount("en", {
      renderAction: (item) =>
        createElement(
          "button",
          {
            "data-testid": "save-example",
            onClick: () => saved.push(item.url),
          },
          "Save",
        ),
    });
    const cards = all("category-technique");
    const first = cards[0];
    const preview = first.querySelector('[data-testid="category-lesson-preview"]')!;
    const choices = first.querySelectorAll<HTMLElement>('[data-testid="category-video"]');
    act(() => choices[1].click());
    act(() => first.querySelector<HTMLElement>('[data-testid="save-example"]')!.click());
    expect(saved).toEqual([LESSONS.photo[0].videos[1].url]);
    expect(calls.played).toHaveLength(0); // selecting a preview never autoplays
    act(() => first.querySelector<HTMLElement>('[data-testid="category-study-toggle"]')!.click());
    const panel = first.querySelector('[data-testid="category-study"]')!;
    expect(
      first
        .querySelector('[data-testid="category-lesson-preview"]')!
        .compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(preview).not.toBeNull();
    expect(panel.textContent).toContain("not analysis of the video");
    expect(panel.textContent).not.toContain("1/30");
    act(() =>
      cards[1].querySelector<HTMLElement>('[data-testid="category-study-toggle"]')!.click(),
    );
    expect(all("category-study")).toHaveLength(1);
    expect(first.querySelector('[data-testid="category-study"]')).toBeNull();
  });

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
    expect(panning.querySelector('[data-testid="category-lesson-preview"]')).not.toBeNull();
    expect(panning.querySelector('[data-testid="category-study"]')).toBeNull();
    act(() => panning.querySelector<HTMLElement>('[data-testid="category-study-toggle"]')!.click());
    const watch = panning.querySelector('[data-testid="category-watch-for"]')!;
    expect(watch.getAttribute("dir")).toBe("ltr");
    expect(watch.textContent).toContain("Watch where the car stays");
    expect(
      panning.querySelector('[data-testid="category-watch-for-ar"]')!.getAttribute("dir"),
    ).toBe("rtl");
    expect(panning.querySelector('[data-testid="category-study-basis"]')!.textContent).toContain(
      "مو من تحليل الفيديو",
    );
    expect(panning.textContent).not.toContain("1/30");
    expect(panning.querySelector('[data-testid="category-skill"]')!.textContent).toContain(
      getSkill("phone-180-shutter")!.name.ar,
    );
    act(() => speed.querySelector<HTMLElement>('[data-testid="category-study-toggle"]')!.click());
    expect(panning.querySelector('[data-testid="category-study"]')).toBeNull();
    expect(speed.querySelector('[data-testid="category-skill"]')).not.toBeNull();
    expect(rolling.querySelector('[data-testid="category-skill"]')).toBeNull();
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

  it("withholds old lesson links until refreshed study prompts and a real example are available", async () => {
    const legacy = {
      ...technique("legacy panning", "قديم", 1),
      study: undefined,
      videos: [
        {
          url: "https://www.youtube.com/watch?v=foodProc001",
          title: "Kitchen food processor",
          platform: "yt",
          kind: "example",
          lang: "en",
        },
      ],
    };
    page = docOf({ lessons: { ...LESSONS, photo: [legacy] } });
    await mount("en");
    expect(all("category-technique")).toHaveLength(2);
    expect($("category-page")!.textContent).not.toContain("Kitchen food processor");
    expect($("category-page")!.textContent).not.toContain("legacy panning");
  });

  it("a style searches it, Search all searches the category, the skill opens, a video plays in the app", async () => {
    await mount();
    act(() => style("rolling-shot").click());
    act(() => $("category-search-all")!.click());
    const panning = all("category-technique")[0];
    act(() => panning.querySelector<HTMLElement>('[data-testid="category-study-toggle"]')!.click());
    act(() => panning.querySelector<HTMLElement>('[data-testid="category-skill"]')!.click());
    act(() =>
      panning
        .querySelector<HTMLElement>('[data-testid="category-video"][data-kind="tutorial"]')!
        .click(),
    );
    act(() => panning.querySelector<HTMLElement>('[data-testid="result-play"]')!.click());
    expect(calls.style).toEqual(["rolling shot"]);
    expect(calls.all).toBe(1);
    expect(calls.skill).toEqual(["phone-180-shutter"]);
    expect(calls.played).toHaveLength(1);
    expect(calls.played[0]).toMatchObject({
      platform: "yt",
      url: "https://www.youtube.com/watch?v=carTutor001",
      title: "tutorial 1",
    });
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
    expect($("category-page")!.textContent).toContain("أعد الفحص عشان تلاقي أمثلة وتمارين جديدة.");
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

  it("does not present an unplayable profile or photo-page link as a lesson video", async () => {
    page = docOf({
      lessons: {
        ...LESSONS,
        photo: [
          {
            ...technique("bad link", "قديم", 1),
            videos: [
              {
                url: "https://www.tiktok.com/@cars/photo/7001",
                title: "carousel",
                platform: "tt",
                kind: "example",
                lang: "en",
              },
            ],
          },
        ],
      },
    });
    await mount("en");
    expect(all("category-technique")).toHaveLength(2);
    expect($("category-page")!.textContent).not.toContain("carousel");
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
      videos: [
        { ...tutorial, kind: "example" },
        { ...tutorial, title: "شرح", lang: "ar" },
      ],
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
  it("an empty filtered TikTok list is not a sign-in failure; connection and source errors stay distinct", async () => {
    page = docOf({ top: { ...TOP, tt: [topVideo("tt", 1)] } });
    for (const [discoveryStatus, expected] of [
      ["ready", "No matching edits found here yet."],
      ["unavailable", "TikTok discovery is unavailable right now."],
      ["not_scanned", "TikTok is connected. Scan this category"],
    ]) {
      topAnswers = {
        tt: {
          body: {
            platform: "tt",
            scan: [],
            brave: [],
            source: "scan",
            note: "no_key",
            discoveryStatus,
          },
        },
      };
      await mount("en");
      await open("tt");
      expect(items()).toHaveLength(0); // an empty answer never restores old unqualified candidates
      expect(line()).toContain(expected);
      expect($("category-top-connect")).toBeNull();
      act(() => root.unmount());
      root = createRoot(host);
    }
  });
  it("shows metadata evidence without claiming visual verification and offers save for each match", async () => {
    const matched = {
      ...topVideo("ig", 1),
      snippet: "Car rolling shot with a match cut",
      source: "tavily",
      evidence: { basis: "metadata", subjects: ["car"], techniques: ["rolling shot", "match cut"] },
    };
    page = docOf({ top: { ...TOP, ig: [matched] } });
    const saved: string[] = [];
    await mount("en", {
      renderAction: (item) =>
        createElement(
          "button",
          {
            "data-testid": "save-example",
            onClick: () => saved.push(item.url),
          },
          "Save",
        ),
    });
    const card = all("category-top-item")[0];
    expect(card.textContent).toContain("Mentions: rolling shot · match cut");
    expect(card.textContent).toContain(matched.snippet);
    expect(all("category-top-item")).toHaveLength(1);
    act(() => card.querySelector<HTMLElement>('[data-testid="save-example"]')!.click());
    expect(saved).toEqual([matched.url]);
  });
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
  /** The Worker's answer with Brave's group (`brave`, as Brave gave it) beside the stored list (`scan`). */
  const fromBrave = (p: "tt" | "ig", brave: unknown[], scan: unknown[] = []) => ({
    body: { platform: p, scan, brave, source: "brave", endpoint: "videos" },
  });
  /** The Worker's answer without Brave: the stored list and why. */
  const alone = (p: "tt" | "ig", scan: unknown[], note: string) => ({
    body: { platform: p, scan, brave: [], source: "scan", note },
  });
  const press = async (key: string) => {
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await settle();
  };
  const selected = () => tabs().find((b) => b.getAttribute("aria-selected") === "true")!;

  // The owner (2026-10-07): "English First. Instagram and tiktok first".
  it("after the 🔥 row: Instagram · TikTok · YouTube with their counts, Instagram chosen; 12 show, Show more adds 12", async () => {
    page = docOf({ top: TOP });
    await mount("en");
    const headings = [...$("category-page")!.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings.slice(0, 2)).toEqual([
      "Edits to study · Cars",
      "🔥 Trending in Cars this week",
    ]);
    const list = $("category-top")!.querySelector('[role="tablist"]')!;
    expect(list.getAttribute("aria-label")).toBe("Study examples by platform");
    // TikTok's count comes with its list (Brave's, asked when the tab opens).
    expect(tabs().map((b) => [b.dataset.platform, b.textContent, b.dataset.count])).toEqual([
      ["ig", "📷14Instagram", "14"],
      ["tt", "♪TikTok", ""],
      ["yt", "▶30YouTube", "30"],
    ]);
    expect(tab("ig").getAttribute("aria-selected")).toBe("true");
    expect(tab("ig").tabIndex).toBe(0);
    expect(tab("tt").tabIndex).toBe(-1);
    expect(tab("yt").tabIndex).toBe(-1);
    const panel = $("category-top-panel")!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab("ig").id);
    // Instagram's stored reels show at once, 12 at a time. Chosen by default, it asks nothing: its Brave top-up waits
    // for a tap, as TikTok's does.
    expect(titles()).toEqual(TOP.ig.slice(0, 12).map((v) => v.title));
    expect(items().every((i) => i.dataset.platform === "ig")).toBe(true);
    expect(more()!.textContent).toBe("Show more (2)");
    expect(topAsked).toEqual([]);
    // YouTube's most viewed first, 12 at a time, as Discover's result cards: views and the creator when known.
    await open("yt");
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
    // No Brave group, and no credit, on YouTube.
    expect($("category-top-brave")).toBeNull();
    expect($("category-top-credit")).toBeNull();
    // A video plays in the app's player.
    act(() => first.querySelector<HTMLElement>('[data-testid="result-play"]')!.click());
    expect(calls.played[0]).toMatchObject({
      platform: "yt",
      url: TOP.yt[0].url,
      handle: "creator1",
    });
    expect(topAsked).toEqual([]);
  });

  it("TikTok loads on its first open, once a visit: 'Loading…', then Brave's group", async () => {
    page = docOf({ top: TOP });
    let release!: () => void;
    topGate = new Promise<void>((r) => (release = r));
    topAnswers = { tt: fromBrave("tt", [topVideo("tt", 1, 900), topVideo("tt", 2)]) };
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

  it("C2, C3: the scan's list, then 'More from Brave Search' in Brave's order, 12 at a time across both, Brave credited under its group", async () => {
    const scan = [1, 2, 3].map((n) => topVideo("tt", 100 + n));
    // Brave's order, its least viewed first: never sorted by views.
    const brave = Array.from({ length: 14 }, (_, i) => topVideo("tt", i + 1, (i + 1) * 1000));
    page = docOf({ top: { ...TOP, tt: scan } });
    topAnswers = { tt: fromBrave("tt", brave, scan) };
    await mount("en");
    await open("tt");
    expect(tab("tt").dataset.count).toBe("17");
    expect(titles()).toEqual([
      ...scan.map((v) => v.title),
      ...brave.slice(0, 9).map((v) => v.title),
    ]);
    const group = $("category-top-brave")!;
    expect(group.textContent).toBe("More from Brave Search");
    // The group's heading sits between the stored list and Brave's.
    const order = all("category-top-item").concat(group);
    expect(order.indexOf(group)).toBe(order.length - 1);
    expect(
      group.compareDocumentPosition(items()[2]) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(
      group.compareDocumentPosition(items()[3]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The credit under Brave's group, outside the status line: Brave's page, in a new tab.
    const credit = $("category-top-credit")!;
    const link = credit.querySelector("a")!;
    expect(link.textContent).toBe("Powered by Brave Search");
    expect(link.getAttribute("href")).toBe("https://brave.com/search/api/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(credit.closest('[role="status"]')).toBeNull();
    expect(
      items()[11].compareDocumentPosition(credit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(more()!.textContent).toBe("Show more (5)");
    act(() => more()!.click());
    expect(titles()).toEqual([...scan, ...brave].map((v) => v.title));
    expect(more()).toBeNull();
    // Brave's items play in the app's player too.
    act(() => items()[3].querySelector<HTMLElement>('[data-testid="result-play"]')!.click());
    expect(calls.played[0]).toMatchObject({ platform: "tt", url: brave[0].url });
  });

  it("in Arabic, Brave's credit reads 'النتائج من Brave Search', its group 'أكثر من Brave Search'", async () => {
    page = docOf({ top: TOP });
    topAnswers = { tt: fromBrave("tt", [topVideo("tt", 1)]) };
    await mount("ar");
    await open("tt");
    expect($("category-top-brave")!.textContent).toBe("أكثر من Brave Search");
    expect($("category-top-credit")!.textContent).toBe("النتائج من Brave Search");
  });

  it("says why a list is the stored one alone: Brave out of reach, or today's searches used up; Brave off (no_key) says nothing; no credit", async () => {
    page = docOf({ top: { ...TOP, tt: [topVideo("tt", 9)] } });
    const lines = [
      // Off by choice since the TikTok tab reads TikTok's Discovery API (§6).
      ["no_key", ""],
      ["brave_failed", "Couldn't reach Brave search right now"],
      ["daily_cap", "Today's Brave searches are used up — more tomorrow"],
    ];
    for (const [note, text] of lines) {
      topAnswers = { tt: alone("tt", [topVideo("tt", 9)], note) };
      act(() => root.unmount());
      root = createRoot(host);
      await mount("en");
      await open("tt");
      expect(line(), note).toBe(text);
      expect(titles()).toEqual(["Top car edit 9"]);
      expect($("category-top-credit")).toBeNull();
    }
    // No answer at all: retain the stored list and name the platform request, not Brave.
    topAnswers = { tt: { body: { error: "upstream" }, status: 502 } };
    act(() => root.unmount());
    root = createRoot(host);
    await mount("en");
    await open("tt");
    expect(line()).toBe("Couldn't refresh this platform right now.");
    expect(titles()).toEqual(["Top car edit 9"]);
  });

  it("an explicitly empty stored list replaces old candidates rather than resurrecting filtered matches", async () => {
    const [a, b, c] = [1, 2, 3].map((n) => topVideo("tt", n));
    page = docOf({ top: { ...TOP, tt: [a, b] } });
    topAnswers = { tt: fromBrave("tt", [{ ...b, title: "b as Brave writes it" }, c], []) };
    await mount("en");
    await open("tt");
    expect(titles()).toEqual(["b as Brave writes it", c.title]);
    expect(tab("tt").dataset.count).toBe("2");
  });

  it("Instagram tops up from Brave on its first open while its list is under 50; a full list asks nothing", async () => {
    page = docOf({ top: TOP });
    const brave = Array.from({ length: 20 }, (_, i) => topVideo("ig", 100 + i));
    topAnswers = { ig: fromBrave("ig", brave, TOP.ig) };
    await mount("en");
    // Chosen when the page opens, but not asked: a tap on its tab asks.
    expect(tab("ig").getAttribute("aria-selected")).toBe("true");
    expect(topAsked).toEqual([]);
    await open("ig");
    expect(topAsked).toEqual(["ig"]);
    // The 14 stored reels, then Brave's 20.
    expect(tab("ig").dataset.count).toBe("34");
    expect(titles()).toEqual(TOP.ig.slice(0, 12).map((v) => v.title));
    // Without Brave the stored reels stand on their own: no line on Instagram.
    act(() => root.unmount());
    root = createRoot(host);
    topAnswers = { ig: alone("ig", TOP.ig, "no_key") };
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
    expect($("category-top")!.querySelector("h3")!.textContent).toBe("مونتاج تتعلّم منه · سيارات");
    expect(tabs().map((b) => b.textContent)).toEqual(["📷14Instagram", "♪TikTok", "▶30YouTube"]);
    const title = items()[0].querySelector('[data-testid="result-title"]')!;
    expect(title.textContent).toBe("Top car edit 1");
    expect(title.getAttribute("dir")).toBe("auto");
    expect($("category-top")!.querySelector('[role="tablist"]')!.getAttribute("aria-label")).toBe(
      "أمثلة للتعلّم حسب المنصة",
    );
  });

  it("C7: the arrow keys move focus between the tabs, mirrored in Arabic; TikTok and Instagram wait for Enter, Space or a tap", async () => {
    page = docOf({ top: TOP });
    topAnswers = { ig: fromBrave("ig", [topVideo("ig", 100)], TOP.ig) };
    await mount("en");
    tab("ig").focus();
    // Onto TikTok: focus moves, nothing is selected or asked.
    await press("ArrowRight");
    expect(document.activeElement).toBe(tab("tt"));
    expect(selected().dataset.platform).toBe("ig");
    // YouTube's list is already here: it follows focus.
    await press("ArrowRight");
    expect(document.activeElement).toBe(tab("yt"));
    expect(selected().dataset.platform).toBe("yt");
    // Round to Instagram: focus moves, YouTube stays chosen, nothing is asked.
    await press("ArrowRight");
    expect(document.activeElement).toBe(tab("ig"));
    expect(selected().dataset.platform).toBe("yt");
    expect(topAsked).toEqual([]);
    // A tap (Enter or Space on a focused tab is one) selects and loads it.
    await open("ig");
    expect(selected().dataset.platform).toBe("ig");
    expect(topAsked).toEqual(["ig"]);
    act(() => root.unmount());
    root = createRoot(host);
    await mount("ar");
    tab("ig").focus();
    await press("ArrowLeft");
    expect(document.activeElement).toBe(tab("tt"));
    expect(selected().dataset.platform).toBe("ig");
    expect(topAsked).toEqual(["ig"]);
  });

  it("D1: an empty TikTok tab offers 'Connect TikTok trends': it asks the Worker for TikTok's page with this page's address and goes there", async () => {
    page = docOf({ top: TOP });
    let release!: () => void;
    topGate = new Promise<void>((r) => (release = r));
    topAnswers = {
      tt: { body: { ...alone("tt", [], "no_key").body, discoveryStatus: "not_connected" } },
    };
    window.history.replaceState(null, "", "/discover/?x=1");
    const here = window.location.href;
    // TikTok's page, as a same-page address jsdom can follow.
    connectAnswer = { body: { url: `${here}#tiktok-portal` } };
    await mount("en");
    await open("tt");
    // Not while TikTok's list is on its way.
    expect(line()).toBe("Loading…");
    expect($("category-top-connect")).toBeNull();
    release();
    await settle();
    expect(line()).toBe("Connect TikTok to include its discovery matches.");
    const button = $("category-top-connect") as HTMLButtonElement;
    expect(button.textContent).toBe("Connect TikTok trends");
    act(() => button.click());
    await settle();
    expect(connectAsked).toEqual([{ returnTo: here }]);
    expect(window.location.hash).toBe("#tiktok-portal");
    // On its way to TikTok: the button rests.
    expect(($("category-top-connect") as HTMLButtonElement).disabled).toBe(true);
    window.history.replaceState(null, "", "/");
  });

  it("D1: a refused connect (no secret on the Worker, no answer) says so, and the button stays; in Arabic too", async () => {
    page = docOf({ top: TOP });
    topAnswers = {
      tt: { body: { ...alone("tt", [], "no_key").body, discoveryStatus: "not_connected" } },
    };
    await mount("en");
    await open("tt");
    act(() => $("category-top-connect")!.click());
    await settle();
    expect(connectAsked).toHaveLength(1);
    expect(line()).toBe("Couldn't connect TikTok — try again in a bit");
    expect(($("category-top-connect") as HTMLButtonElement).disabled).toBe(false);
    act(() => root.unmount());
    root = createRoot(host);
    await mount("ar");
    await open("tt");
    expect($("category-top-connect")!.textContent).toBe("اربط ترندات تيك توك");
    act(() => $("category-top-connect")!.click());
    await settle();
    expect(line()).toBe("ما قدرت أربط تيك توك، جرّب بعد شوي");
  });

  it("D1: a TikTok tab with videos offers no connect; nor does Instagram, even empty", async () => {
    const tt = [topVideo("tt", 1), topVideo("tt", 2)];
    page = docOf({ top: { ...TOP, tt, ig: [] } });
    topAnswers = { tt: alone("tt", tt, "no_key"), ig: alone("ig", [], "no_key") };
    await mount("en");
    await open("tt");
    expect(titles()).toEqual(tt.map((v) => v.title));
    expect(line()).toBe("");
    expect($("category-top-connect")).toBeNull();
    await open("ig");
    expect(line()).toBe("No matching edits found here yet. Try another platform or scan again.");
    expect($("category-top-connect")).toBeNull();
    await open("yt");
    expect($("category-top-connect")).toBeNull();
  });

  it("a page from before §6 says the top videos come with the next scan", async () => {
    await mount("en");
    expect($("category-top")).toBeNull();
    expect($("category-page")!.textContent).toContain("Scan this category to find edits to study.");
  });
});
