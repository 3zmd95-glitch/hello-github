// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "@/lib/domain";
import { useStore } from "@/store";
import TrendingEffects from "./TrendingEffects";

// 🔥 Discover's trending-effects row (planning/tools/18-trending-effects.md §4), rendered in jsdom against a fake
// Worker (a stubbed global fetch; nothing leaves the machine). e2e/discover.spec.ts covers it in the panel.

const CONFIG = { url: "https://fx.scout.test", token: "tok" };
const HOUR = 3_600_000;

/** A dictionary effect; YouTube grew, but under 1.5×: no note. */
const CLONE = {
  key: "clone-effect",
  name: { en: "clone effect", ar: "تأثير الاستنساخ" },
  what: { en: "You show up twice in one shot", ar: "تطلع مرتين في نفس اللقطة" },
  termId: "clone-effect",
  isNew: false,
  checked: true,
  creators: 9,
  posts: 14,
  platforms: ["ig", "tt"],
  growth: 1.5,
  youtube: { newVideos: 20, views7d: 180000, growth: 1.2 },
  samples: [],
};
/** New, with YouTube views up 3×. */
const SWAGGER = {
  key: "swagger-trend",
  name: { en: "swagger trend", ar: "ترند السواقر" },
  what: { en: "Clone yourself with one hair flip", ar: "تستنسخ نفسك بحركة شعر" },
  isNew: true,
  checked: true,
  creators: 4,
  posts: 5,
  platforms: ["tt"],
  growth: 3,
  youtube: { newVideos: 12, views7d: 52000, growth: 3 },
  samples: [],
};
/** New, without an Arabic name, a line or YouTube figures. */
const FLASH = {
  key: "flash-clone-edit",
  name: { en: "flash clone edit" },
  isNew: true,
  checked: true,
  creators: 3,
  posts: 3,
  platforms: ["ig"],
  growth: 3,
  samples: [],
};

const docOf = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  ranOn: "2026-10-06",
  updatedAt: new Date(Date.now() - 5 * HOUR).toISOString(),
  items: [CLONE, SWAGGER, FLASH],
  ...over,
});
const NEVER = { status: "never", items: [] };

/** What `GET /effects/trending` answers; null = an older Worker without the route (404). */
let trending: unknown;
let runAnswer: { body: unknown; status: number };
let gets: number;
let posts: RequestInit[];
/** Holds `POST /effects/run` until the test lets it answer. */
let releaseRun: (() => void) | undefined;
let picked: string[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { pathname } = new URL(String(input));
  if (pathname === "/effects/trending" && !init?.method) {
    gets++;
    return trending === null ? json({ error: "not_found" }, 404) : json(trending);
  }
  if (pathname === "/effects/run" && init?.method === "POST") {
    posts.push(init);
    await new Promise<void>((r) => (releaseRun = r));
    return json(runAnswer.body, runAnswer.status);
  }
  return json({ error: "not_found" }, 404);
}

let host: HTMLDivElement;
let root: Root;

const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const chips = () => [...host.querySelectorAll<HTMLElement>('[data-testid="trending-effect"]')];
const chip = (key: string) =>
  host.querySelector<HTMLElement>(`[data-testid="trending-effect"][data-key="${key}"]`)!;

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

async function mount(lang: Lang = "ar") {
  useStore.getState().setSettings({ lang });
  act(() =>
    root.render(
      createElement(TrendingEffects, { config: CONFIG, onPick: (q: string) => picked.push(q) }),
    ),
  );
  await settle();
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trending = docOf();
  runAnswer = { body: docOf(), status: 200 };
  gets = 0;
  posts = [];
  releaseRun = undefined;
  picked = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the trending-effects row", () => {
  it("shows nothing for an older Worker (404)", async () => {
    trending = null;
    await mount();
    expect(gets).toBe(1);
    expect(host.innerHTML).toBe("");
  });

  it("in Arabic: the names (English without an Arabic one), the NEW badge, the reason with and without YouTube", async () => {
    await mount("ar");
    const row = $("trending-effects")!;
    expect(row.getAttribute("data-state")).toBe("list");
    expect(row.querySelector("h2")!.textContent).toBe("🔥 ترند المؤثرات هالأسبوع");
    expect(row.textContent).toContain("تحدّثت قبل 5 س");
    expect(row.textContent).not.toContain("ما قدرت أحدّثها اليوم");
    const link = row.querySelector("a")!;
    expect(link.textContent).toBe("TikTok Creative Center ↗");
    expect(link.getAttribute("href")).toBe(
      "https://ads.tiktok.com/business/creativecenter/inspiration/popular/hashtag/pc/en",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    expect(chips().map((c) => [c.getAttribute("data-key"), c.textContent])).toEqual([
      ["clone-effect", "تأثير الاستنساخ9 صنّاع"],
      ["swagger-trend", "ترند السواقرجديد4 صنّاع · ▶ ↑3×"],
      ["flash-clone-edit", "flash clone editجديد3 صنّاع"],
    ]);
    // The what line: the tooltip, and in what a screen reader reads.
    expect(chip("swagger-trend").title).toBe("تستنسخ نفسك بحركة شعر");
    expect(chip("swagger-trend").getAttribute("aria-label")).toBe(
      "ترند السواقر · جديد · 4 صنّاع · ▶ ↑3× · تستنسخ نفسك بحركة شعر",
    );
    expect(chip("clone-effect").getAttribute("aria-label")).toBe(
      "تأثير الاستنساخ · 9 صنّاع · تطلع مرتين في نفس اللقطة",
    );
    expect(chip("flash-clone-edit").hasAttribute("title")).toBe(false);
    expect($("trending-run")).toBeNull();
  });

  it("in English", async () => {
    await mount("en");
    expect($("trending-effects")!.textContent).toContain("updated 5 h ago");
    expect(chips().map((c) => c.textContent)).toEqual([
      "clone effect9 creators",
      "swagger trendNEW4 creators · ▶ ↑3×",
      "flash clone editNEW3 creators",
    ]);
    expect(chip("clone-effect").getAttribute("aria-label")).toBe(
      "clone effect · 9 creators · You show up twice in one shot",
    );
  });

  it("failed today but recent: the last list, with a faint line", async () => {
    trending = docOf({
      status: "failed",
      notes: ["tavily"],
      updatedAt: new Date(Date.now() - 30 * HOUR).toISOString(),
    });
    await mount();
    const row = $("trending-effects")!;
    expect(row.getAttribute("data-state")).toBe("stale-failed");
    expect(row.textContent).toContain("ما قدرت أحدّثها اليوم");
    expect(row.textContent).toContain("تحدّثت قبل 30 س");
    expect(chips()).toHaveLength(3);
  });

  it("shows nothing for a list older than 3 days", async () => {
    trending = docOf({ updatedAt: new Date(Date.now() - 73 * HOUR).toISOString() });
    await mount();
    expect(host.innerHTML).toBe("");
  });

  it("a tap searches the effect: a dictionary one its English label, a new one its English name", async () => {
    await mount("ar");
    act(() => chip("clone-effect").click());
    act(() => chip("flash-clone-edit").click());
    expect(picked).toEqual(["clone effect", "flash clone edit"]);
  });
});

describe("before the Worker's first run", () => {
  it("the button posts once however fast it is tapped, says it is waiting, then shows the chips", async () => {
    trending = NEVER;
    await mount();
    const row = $("trending-effects")!;
    expect(row.getAttribute("data-state")).toBe("never");
    expect(row.textContent).not.toContain("تحدّثت");
    const run = $("trending-run") as HTMLButtonElement;
    expect(run.textContent).toBe("شغّل أول فحص");

    act(() => {
      run.click();
      run.click();
    });
    await settle();
    expect(posts).toHaveLength(1);
    expect(run.disabled).toBe(true);
    expect(row.textContent).toContain("أدوّر على الترندات… ممكن تاخذ دقيقة");

    await act(async () => releaseRun!());
    await settle();
    expect($("trending-effects")!.getAttribute("data-state")).toBe("list");
    expect(chips()).toHaveLength(3);
    expect($("trending-run")).toBeNull();
    expect(posts).toHaveLength(1);
  });

  it("a failed scan brings the button back", async () => {
    trending = NEVER;
    runAnswer = { body: { error: "upstream" }, status: 502 };
    await mount();
    act(() => $("trending-run")!.click());
    await settle();
    await act(async () => releaseRun!());
    await settle();
    expect($("trending-effects")!.getAttribute("data-state")).toBe("never");
    expect(($("trending-run") as HTMLButtonElement).disabled).toBe(false);
    expect($("trending-effects")!.textContent).not.toContain("أدوّر على الترندات");
  });

  it("leaving Discover mid-scan neither cancels it nor loses its answer", async () => {
    trending = NEVER;
    await mount();
    act(() => $("trending-run")!.click());
    await settle();
    act(() => root.unmount());
    await act(async () => releaseRun!());
    await settle();
    // Nothing could cancel it: the request carries no abort signal.
    expect(posts[0].signal).toBeUndefined();

    // Back on Discover: the scan's answer, kept in this tab; nothing is asked again.
    root = createRoot(host);
    await mount();
    expect(chips()).toHaveLength(3);
    expect(posts).toHaveLength(1);
    expect(gets).toBe(1);
  });
});
