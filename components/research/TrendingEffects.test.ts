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

/** A dictionary effect; YouTube's views up exactly 1.5×, the least that earns the note. */
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
  youtube: { newVideos: 20, views7d: 180000, growth: 1.5 },
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
/** A dictionary effect whose YouTube views grew just under 1.5×: no note. */
const SPEED = {
  key: "speed-ramp",
  name: { en: "speed ramp", ar: "سبيد رامب" },
  termId: "speed-ramp",
  isNew: false,
  checked: true,
  creators: 7,
  posts: 9,
  platforms: ["tt"],
  growth: 2,
  youtube: { newVideos: 9, views7d: 30000, growth: 1.49 },
  samples: [],
};

const docOf = (over: Record<string, unknown> = {}) => ({
  status: "ok",
  ranOn: "2026-10-06",
  updatedAt: new Date(Date.now() - 5 * HOUR).toISOString(),
  items: [CLONE, SWAGGER, FLASH, SPEED],
  ...over,
});
const NEVER = { status: "never", items: [] };
/** The Worker's own failed run, with no list yet. */
const FAILED_RUN = { status: "failed", ranOn: "2026-10-06", notes: ["quota"], items: [] };
const WAITING = "أدوّر على الترندات… ممكن تاخذ دقيقة";
const RUN_FAILED = "ما قدرت أشغّل الفحص، جرّب بعد شوي";
const RUN_LIMIT = "جرّبت كذا مرة اليوم، أرجع أجرّب بكرة";
const NONE = "لسه ما فيه مؤثر منتشر كفاية، أرجع أشيّك بكرة";

/** What `GET /effects/trending` answers; null = an older Worker without the route (404). */
let trending: unknown;
let runAnswer: { body: unknown; status: number };
let gets: number;
let posts: RequestInit[];
/** Holds `POST /effects/run` until the test lets it answer. */
let releaseRun: (() => void) | undefined;
/** When set, `GET /effects/trending` waits for it. */
let getGate: Promise<void> | undefined;
let picked: string[];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { pathname } = new URL(String(input));
  if (pathname === "/effects/trending" && !init?.method) {
    gets++;
    // What the Worker holds when the request arrives, answered when the gate opens.
    const answer = trending;
    await getGate;
    return answer === null ? json({ error: "not_found" }, 404) : json(answer);
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
const runButton = () => $("trending-run") as HTMLButtonElement;
/** The scan's live line (always there before the first run, empty while idle). */
const status = () => $("trending-effects")!.querySelector('[role="status"]')!.textContent;

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

/** Renders the row; the caller settles (to see the first render). */
function render(lang: Lang = "ar") {
  useStore.getState().setSettings({ lang });
  act(() =>
    root.render(
      createElement(TrendingEffects, { config: CONFIG, onPick: (q: string) => picked.push(q) }),
    ),
  );
}

async function mount(lang: Lang = "ar") {
  render(lang);
  await settle();
}

/** Leaves Discover and comes back (a new row). */
function remount(lang: Lang = "ar") {
  act(() => root.unmount());
  root = createRoot(host);
  render(lang);
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  trending = docOf();
  runAnswer = { body: docOf(), status: 200 };
  gets = 0;
  posts = [];
  releaseRun = undefined;
  getGate = undefined;
  picked = [];
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  sessionStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  // A scan a failed test left waiting would hold up the next one (one scan per Worker at a time).
  releaseRun?.();
  await settle();
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

    // YouTube's note from 1.5× (inclusive): 1.5 shows it, 1.49 does not.
    expect(chips().map((c) => [c.getAttribute("data-key"), c.textContent])).toEqual([
      ["clone-effect", "تأثير الاستنساخ9 صنّاع · ▶ ↑1.5×"],
      ["swagger-trend", "ترند السواقرجديد4 صنّاع · ▶ ↑3×"],
      ["flash-clone-edit", "flash clone editجديد3 صنّاع"],
      ["speed-ramp", "سبيد رامب7 صنّاع"],
    ]);
    // The what line: the tooltip, and in what a screen reader reads.
    expect(chip("swagger-trend").title).toBe("تستنسخ نفسك بحركة شعر");
    expect(chip("swagger-trend").getAttribute("aria-label")).toBe(
      "ترند السواقر · جديد · 4 صنّاع · ▶ ↑3× · تستنسخ نفسك بحركة شعر",
    );
    expect(chip("clone-effect").getAttribute("aria-label")).toBe(
      "تأثير الاستنساخ · 9 صنّاع · ▶ ↑1.5× · تطلع مرتين في نفس اللقطة",
    );
    expect(chip("flash-clone-edit").hasAttribute("title")).toBe(false);
    expect($("trending-run")).toBeNull();
  });

  it("in English", async () => {
    await mount("en");
    expect($("trending-effects")!.textContent).toContain("updated 5 h ago");
    expect(chips().map((c) => c.textContent)).toEqual([
      "clone effect9 creators · ▶ ↑1.5×",
      "swagger trendNEW4 creators · ▶ ↑3×",
      "flash clone editNEW3 creators",
      "speed ramp7 creators",
    ]);
    expect(chip("clone-effect").getAttribute("aria-label")).toBe(
      "clone effect · 9 creators · ▶ ↑1.5× · You show up twice in one shot",
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
    expect(chips()).toHaveLength(4);
  });

  it("shows nothing for a list older than 3 days, or a run that found nothing", async () => {
    trending = docOf({ updatedAt: new Date(Date.now() - 73 * HOUR).toISOString() });
    await mount();
    expect(host.innerHTML).toBe("");
    trending = docOf({ items: [] });
    sessionStorage.clear();
    remount();
    await settle();
    expect(gets).toBe(2);
    expect(host.innerHTML).toBe("");
  });

  it("a tap searches the effect: a dictionary one its English label, a new one its English name", async () => {
    await mount("ar");
    act(() => chip("clone-effect").click());
    act(() => chip("flash-clone-edit").click());
    expect(picked).toEqual(["clone effect", "flash clone edit"]);
  });

  it("a revisit within the hour shows the row at once, from this tab's copy", async () => {
    await mount();
    expect(gets).toBe(1);
    remount();
    // Before any answer: the first render already has the chips, so nothing pops in under a tap.
    expect(chips()).toHaveLength(4);
    await settle();
    expect(gets).toBe(1);
  });
});

describe("before the Worker's first run", () => {
  it("the button posts once however fast it is tapped, says it is waiting, then shows the chips with focus on the row", async () => {
    trending = NEVER;
    await mount();
    const row = $("trending-effects")!;
    expect(row.getAttribute("data-state")).toBe("never");
    expect(row.textContent).not.toContain("تحدّثت");
    expect(runButton().textContent).toBe("شغّل أول فحص");
    // The live line is there before anything happens, so what it says next is announced.
    expect(status()).toBe("");

    runButton().focus();
    act(() => {
      runButton().click();
      runButton().click();
    });
    await settle();
    expect(posts).toHaveLength(1);
    expect(runButton().disabled).toBe(true);
    expect(status()).toBe(WAITING);

    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    await act(async () => releaseRun!());
    await settle();
    expect($("trending-effects")!.getAttribute("data-state")).toBe("list");
    expect(chips()).toHaveLength(4);
    expect($("trending-run")).toBeNull();
    expect(posts).toHaveLength(1);
    // The button is gone: focus goes to the row's heading, not to the page, without scrolling to it (the owner may
    // have scrolled down during the minute).
    const heading = $("trending-effects")!.querySelector("h2")!;
    expect(document.activeElement).toBe(heading);
    expect(heading.tabIndex).toBe(-1);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focus).not.toHaveBeenCalledWith();
    focus.mockRestore();
  });

  it("a scan the Worker ran but failed (no list yet): the failure line under the button, enabled for a retry", async () => {
    trending = NEVER;
    runAnswer = { body: FAILED_RUN, status: 200 };
    await mount();
    act(() => runButton().click());
    await settle();
    await act(async () => releaseRun!());
    await settle();
    expect($("trending-effects")!.getAttribute("data-state")).toBe("never");
    expect(runButton().disabled).toBe(false);
    expect(status()).toBe(RUN_FAILED);
  });

  it("over the day's tries: the button stays off, with the run-limit line; a fresh visit offers it again", async () => {
    // The Worker answers its stored list over its cap: a failed day with no list, or no document yet, or an older
    // run that found nothing.
    for (const body of [
      { ...FAILED_RUN, notes: ["quota", "attempts"] },
      { status: "failed", ranOn: "2026-10-06", notes: ["attempts"], items: [] },
      docOf({ items: [], notes: ["attempts"] }),
    ]) {
      trending = NEVER;
      runAnswer = { body, status: 200 };
      remount();
      await settle();
      act(() => runButton().click());
      await settle();
      await act(async () => releaseRun!());
      await settle();
      expect($("trending-effects")!.getAttribute("data-state"), body.status).toBe("never");
      expect(runButton().disabled).toBe(true);
      expect(status()).toBe(RUN_LIMIT);
    }
    // A fresh visit asks the Worker again ("never"): the button is back (a tap over the cap spends nothing).
    remount();
    await settle();
    expect(runButton().disabled).toBe(false);
    expect(status()).toBe("");
  });

  it("a first scan that finds nothing: the row stays, the button off, with the nothing-yet line", async () => {
    for (const kind of ["ok", "partial"]) {
      trending = NEVER;
      runAnswer = { body: docOf({ status: kind, items: [] }), status: 200 };
      remount("en");
      await settle();
      act(() => runButton().click());
      await settle();
      await act(async () => releaseRun!());
      await settle();
      expect($("trending-effects")!.getAttribute("data-state"), kind).toBe("never");
      expect(runButton().disabled).toBe(true);
      expect(status()).toBe("Nothing is trending widely enough yet — I'll check again tomorrow");
    }
    // In Arabic too.
    trending = NEVER;
    remount();
    await settle();
    act(() => runButton().click());
    await settle();
    await act(async () => releaseRun!());
    await settle();
    expect(status()).toBe(NONE);
    // A later visit whose GET says the same (a run with nothing to show) hides the row.
    trending = docOf({ items: [] });
    remount();
    await settle();
    expect(host.innerHTML).toBe("");
  });

  it("a scan that lands without a list hands focus back to the re-enabled button, unless the owner is elsewhere", async () => {
    trending = NEVER;
    runAnswer = { body: { error: "upstream" }, status: 502 };
    await mount();
    runButton().focus();
    act(() => runButton().click());
    await settle();
    // Chrome drops focus from the disabled button to the page meanwhile (jsdom keeps it there, so it is done here:
    // a disabled button cannot be blurred).
    const away = document.createElement("input");
    document.body.append(away);
    away.focus();
    away.blur();
    away.remove();
    expect(document.activeElement).toBe(document.body);
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    await act(async () => releaseRun!());
    await settle();
    expect(runButton().disabled).toBe(false);
    expect(document.activeElement).toBe(runButton());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(focus).not.toHaveBeenCalledWith();
    focus.mockRestore();

    // The Worker's own failed run, while the owner types elsewhere: their focus stays.
    runAnswer = { body: FAILED_RUN, status: 200 };
    act(() => runButton().click());
    await settle();
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    await act(async () => releaseRun!());
    await settle();
    expect(status()).toBe(RUN_FAILED);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("the Worker's own failed first run (failed, no list yet): the button and the failure line, not an empty row", async () => {
    trending = FAILED_RUN;
    await mount();
    const row = $("trending-effects")!;
    expect(row.getAttribute("data-state")).toBe("never");
    expect(runButton().disabled).toBe(false);
    expect(status()).toBe(RUN_FAILED);
    // None of the stale-failed row: no age, no link, no "Couldn't update today", no strip.
    expect(row.textContent).not.toContain("تحدّثت");
    expect(row.querySelector("a")).toBeNull();
    expect(row.textContent).not.toContain("ما قدرت أحدّثها اليوم");
    expect(chips()).toHaveLength(0);

    // The retry fails on the Worker again: still the button, enabled, and the line.
    runAnswer = { body: trending, status: 200 };
    act(() => runButton().click());
    await settle();
    expect(status()).toBe(WAITING);
    await act(async () => releaseRun!());
    await settle();
    expect($("trending-effects")!.getAttribute("data-state")).toBe("never");
    expect(runButton().disabled).toBe(false);
    expect(status()).toBe(RUN_FAILED);

    // Another tap is a 2nd POST, and this one finds the list.
    runAnswer = { body: docOf(), status: 200 };
    act(() => runButton().click());
    await settle();
    await act(async () => releaseRun!());
    await settle();
    expect(posts).toHaveLength(2);
    expect(chips()).toHaveLength(4);
  });

  it("a failed scan says so and brings the button back; a new tap tries again", async () => {
    trending = NEVER;
    runAnswer = { body: { error: "upstream" }, status: 502 };
    await mount();
    act(() => runButton().click());
    await settle();
    await act(async () => releaseRun!());
    await settle();
    expect($("trending-effects")!.getAttribute("data-state")).toBe("never");
    expect(runButton().disabled).toBe(false);
    expect(status()).toBe(RUN_FAILED);

    runAnswer = { body: docOf(), status: 200 };
    act(() => runButton().click());
    await settle();
    expect(status()).toBe(WAITING);
    await act(async () => releaseRun!());
    await settle();
    expect(posts).toHaveLength(2);
    expect(chips()).toHaveLength(4);
  });

  it("back on Discover before the scan answers: the same scan, still waiting, then its chips", async () => {
    trending = NEVER;
    await mount();
    act(() => runButton().click());
    await settle();
    remount();
    await settle();
    expect(runButton().disabled).toBe(true);
    expect(status()).toBe(WAITING);
    expect(posts).toHaveLength(1);

    // Meanwhile the owner works elsewhere: the answer leaves their focus alone.
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);
    elsewhere.focus();
    await act(async () => releaseRun!());
    await settle();
    expect($("trending-effects")!.getAttribute("data-state")).toBe("list");
    expect(chips()).toHaveLength(4);
    expect(posts).toHaveLength(1);
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it("leaving Discover mid-scan neither cancels it nor loses its answer", async () => {
    trending = NEVER;
    await mount();
    act(() => runButton().click());
    await settle();
    act(() => root.unmount());
    await act(async () => releaseRun!());
    await settle();
    // Nothing could cancel it: the request carries no abort signal.
    expect(posts[0].signal).toBeUndefined();

    // Back on Discover: the scan's answer, kept in this tab; nothing is asked again.
    root = createRoot(host);
    await mount();
    expect(chips()).toHaveLength(4);
    expect(posts).toHaveLength(1);
    expect(gets).toBe(1);
  });

  it("the scan answering while a revisit's GET is on its way: the list it saved, not an idle button", async () => {
    trending = NEVER;
    await mount();
    act(() => runButton().click());
    await settle();
    // Back on Discover: the GET goes out (the Worker still says "never") and waits.
    let releaseGet!: () => void;
    getGate = new Promise((r) => (releaseGet = r));
    remount();
    await settle();
    // The scan answers before that GET does.
    await act(async () => releaseRun!());
    await settle();
    await act(async () => releaseGet());
    await settle();
    expect($("trending-effects")!.getAttribute("data-state")).toBe("list");
    expect(chips()).toHaveLength(4);
    expect(posts).toHaveLength(1);
  });
});
