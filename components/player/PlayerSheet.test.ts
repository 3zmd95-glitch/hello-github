// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SkillSheet from "@/components/skills/SkillSheet";
import { useStore } from "@/store";
import { IG_START_HEIGHT, PLAYER_SLOW_MS } from "./PlayerSheet";
import { PLAYER_HISTORY_KEY } from "./useBackToClose";
import { useVideoPlayer, type PlayableItem } from "./VideoPlayerContext";
import VideoPlayerProvider from "./VideoPlayerProvider";

// ▶ Watch here (round 32): the player sheet, rendered for real in jsdom through its provider. The pre-checks
// answer from a stubbed global fetch and the players' messages are dispatched by hand, so nothing leaves the
// machine (jsdom never loads an iframe's page). e2e/player.spec.ts plays the same flows in a browser.

const ITEMS = {
  yt: {
    platform: "yt",
    url: "https://www.youtube.com/watch?v=abc123XYZ",
    title: "Match cuts explained",
    handle: "Cuts Channel",
  },
  short: {
    platform: "yt",
    url: "https://www.youtube.com/shorts/short000001",
    title: "A Short",
  },
  ytOff: {
    platform: "yt",
    url: "https://youtu.be/noEmbed0001",
    title: "Embedding off",
  },
  ytGone: {
    platform: "yt",
    url: "https://www.youtube.com/watch?v=gone0000001",
    title: "Removed",
  },
  ytOffline: {
    platform: "yt",
    url: "https://www.youtube.com/watch?v=offline0001",
    title: "Offline check",
  },
  tt: {
    platform: "tt",
    url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001",
    title: "Match cut in 10 seconds",
    handle: "@editor.sam",
  },
  ig: {
    platform: "ig",
    url: "https://www.instagram.com/cutsbyfaisal/reel/C1abcDEF",
    title: "Match cut reel",
    handle: "@cutsbyfaisal",
  },
  igOff: {
    platform: "ig",
    url: "https://www.instagram.com/p/Blocked0001/",
    title: "Not embeddable",
  },
  web: {
    platform: "web",
    url: "https://example.com/blog/match-cuts",
    title: "A blog post",
  },
} satisfies Record<string, PlayableItem>;
type ItemKey = keyof typeof ITEMS;

const SANDBOX =
  "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";

let asked: string[];
/** What asked to be scrolled into view, and how (jsdom lays nothing out and has no scrollIntoView). */
let scrolled: [Element, ScrollIntoViewOptions | boolean | undefined][];
const nativeScrollIntoView = Element.prototype.scrollIntoView;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** YouTube's and Instagram's oEmbed, the way they answered live (research, Sep 29 2026). */
async function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(String(input));
  asked.push(url.href);
  const video = url.searchParams.get("url") ?? "";
  if (url.hostname === "www.youtube.com" && url.pathname === "/oembed") {
    if (video.endsWith("/noEmbed0001")) return new Response("Unauthorized", { status: 401 });
    if (video.endsWith("/gone0000001")) return new Response("Bad Request", { status: 400 });
    if (video.endsWith("/offline0001")) throw new TypeError("Failed to fetch");
    if (video.endsWith("/short000001")) return json({ width: 113, height: 200 });
    return json({ width: 200, height: 113, title: "Match cuts explained" });
  }
  if (url.hostname === "graph.facebook.com") {
    if (video.endsWith("/Blocked0001")) {
      return json({ error: { code: 24, error_subcode: 2207045, message: "Media Not Found" } }, 400);
    }
    return json({ version: "1.0", type: "rich", html: "<blockquote></blockquote>" });
  }
  return json({ error: "not_found" }, 404);
}

let host: HTMLDivElement;
let root: Root;

const $ = <T extends HTMLElement = HTMLElement>(testId: string) =>
  document.querySelector<T>(`[data-testid="${testId}"]`);
const frame = () => $<HTMLIFrameElement>("player-frame");
const sheet = () => $("player-sheet");

/** Let the pre-check answer and React settle. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

/** A card's ▶: opens the player on its item. */
function Opener({ id }: { id: ItemKey }) {
  const player = useVideoPlayer();
  return createElement(
    "button",
    { type: "button", "data-testid": `open-${id}`, onClick: () => player.open(ITEMS[id]) },
    `▶ ${id}`,
  );
}

function mount(extra?: ReactNode): void {
  const openers = (Object.keys(ITEMS) as ItemKey[]).map((id) =>
    createElement(Opener, { key: id, id }),
  );
  act(() => {
    root.render(createElement(VideoPlayerProvider, null, extra, ...openers));
  });
}

async function tap(testId: string): Promise<void> {
  const el = $(testId);
  if (!el) throw new Error(`no [data-testid="${testId}"]`);
  act(() => {
    el.focus();
    el.click();
  });
  await settle();
}

function press(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** A message the way the browser delivers it from a frame. */
function post(data: unknown, origin: string, source: Window | null | undefined): void {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, origin, source: source ?? null }));
  });
}

const measure = (height: number) => JSON.stringify({ type: "MEASURE", details: { height } });
const tiktok = (type: string, value?: unknown) => ({ "x-tiktok-player": true, type, value });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  asked = [];
  scrolled = [];
  Element.prototype.scrollIntoView = function (
    this: Element,
    opts?: ScrollIntoViewOptions | boolean,
  ) {
    scrolled.push([this, opts]);
  };
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  vi.useRealTimers();
  act(() => root.unmount());
  // Unmounting an open player goes back one entry: let that traverse land before the next test opens one.
  await settle();
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = nativeScrollIntoView;
  document.body.style.overflow = "";
  useStore.getState().setSettings({ lang: "ar" });
});

describe("opening", () => {
  it("loads nothing from a platform until ▶, then checks, then mounts one sandboxed frame", async () => {
    mount();
    expect(document.querySelector("iframe")).toBeNull();
    expect(asked).toEqual([]);

    act(() => $("open-yt")!.click());
    // While YouTube's oEmbed answers: the loading line, no frame yet.
    expect($("player-loading")?.textContent).toBe("نجهّز الفيديو…");
    expect(frame()).toBeNull();
    await settle();

    expect(asked).toEqual([
      "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fshorts%2Fabc123XYZ",
    ]);
    expect($("player-loading")).toBeNull();
    expect(sheet()?.getAttribute("data-platform")).toBe("yt");
    expect(sheet()?.getAttribute("role")).toBe("dialog");
    expect(sheet()?.getAttribute("aria-modal")).toBe("true");
    const f = frame()!;
    expect(f.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123XYZ?autoplay=1&playsinline=1&rel=0&hl=ar",
    );
    expect(f.getAttribute("sandbox")).toBe(SANDBOX);
    expect(f.getAttribute("referrerpolicy")).toBe("strict-origin-when-cross-origin");
    expect(f.getAttribute("allow")).toBe(
      "autoplay; encrypted-media; fullscreen; picture-in-picture",
    );
    expect(f.hasAttribute("allowfullscreen")).toBe(true);
    expect(f.getAttribute("loading")).toBe("eager");
    expect(f.getAttribute("title")).toBe("يوتيوب · Match cuts explained");
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect($("player-box")?.getAttribute("data-shape")).toBe("wide");

    // The header sits above the frame, the rest below it: nothing of ours on top of the video.
    const title = $("player-title")!;
    expect(title.textContent).toBe("Match cuts explained");
    expect(title.getAttribute("dir")).toBe("auto");
    expect(sheet()?.getAttribute("aria-labelledby")).toBe(title.id);
    expect($("player-chip")?.textContent).toContain("YouTube");
    expect(f.closest("[data-testid=player-box]")?.querySelectorAll("*")).toHaveLength(1);
    const open = $<HTMLAnchorElement>("player-open")!;
    expect(open.getAttribute("href")).toBe(ITEMS.yt.url);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    expect(open.textContent).toBe("افتح في يوتيوب ↗");
    expect($("player-privacy")?.textContent).toContain("يوتيوب");
    expect($("player-note")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("speaks English with an English player", async () => {
    useStore.getState().setSettings({ lang: "en" });
    mount();
    await tap("open-yt");
    expect(frame()?.getAttribute("src")).toContain("&hl=en");
    expect(frame()?.getAttribute("title")).toBe("YouTube · Match cuts explained");
    expect($("player-open")?.textContent).toBe("Open on YouTube ↗");
    expect($("player-close")?.getAttribute("aria-label")).toBe("Close");
  });

  it("does nothing for a reference that cannot play here", async () => {
    mount();
    await tap("open-web");
    expect(sheet()).toBeNull();
    expect(asked).toEqual([]);
  });

  it("holds one player: opening another video replaces the frame in the same sheet", async () => {
    mount();
    await tap("open-yt");
    const entries = window.history.length;
    await tap("open-tt");
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    expect(document.querySelectorAll("[data-testid=player-sheet]")).toHaveLength(1);
    expect(sheet()?.getAttribute("data-platform")).toBe("tt");
    expect(frame()?.getAttribute("src")).toBe(
      "https://www.tiktok.com/player/v1/7300000000000000001?autoplay=1&rel=0&description=1&music_info=1",
    );
    // Still one history entry for the open player.
    expect(window.history.length).toBe(entries);
  });

  it("gives a YouTube Short a 9:16 frame", async () => {
    mount();
    await tap("open-short");
    expect(frame()?.getAttribute("src")).toContain("/embed/short000001?");
    expect($("player-box")?.getAttribute("data-shape")).toBe("tall");
  });
});

describe("closing", () => {
  it("closes on Escape, on the backdrop and on ✕, and gives focus back to the ▶ that opened it", async () => {
    mount();
    for (const how of ["escape", "backdrop", "close"] as const) {
      await tap("open-yt");
      expect(document.activeElement).toBe(sheet());
      if (how === "escape") press("Escape");
      if (how === "backdrop") {
        // A tap inside the sheet does not close it; a tap on the dimmed backdrop does.
        act(() => sheet()!.click());
        expect(sheet()).not.toBeNull();
        act(() => $("player-backdrop")!.click());
      }
      if (how === "close") act(() => $("player-close")!.click());
      expect(sheet(), how).toBeNull();
      expect(document.querySelector("iframe"), how).toBeNull();
      expect(document.activeElement, how).toBe($("open-yt"));
      expect(document.body.style.overflow, how).toBe("");
      await settle();
    }
  });

  it("Escape closes only the player when a skill sheet is open underneath", async () => {
    const closeSkill = vi.fn();
    mount(createElement(SkillSheet, { skillId: "smart-bins-keywords", onClose: closeSkill }));
    expect($("skill-sheet")).not.toBeNull();
    await tap("open-ig");
    expect(sheet()).not.toBeNull();

    press("Escape");
    expect(sheet()).toBeNull();
    expect(closeSkill).not.toHaveBeenCalled();
    // The skill sheet's own scroll lock is still on.
    expect(document.body.style.overflow).toBe("hidden");

    press("Escape");
    expect(closeSkill).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the sheet: past the last element it wraps to the first, and back", async () => {
    mount();
    await tap("open-yt");
    act(() => $("player-focus-end")!.focus());
    expect(document.activeElement).toBe($("player-close"));
    act(() => $("player-focus-start")!.focus());
    expect(document.activeElement).toBe($("player-open"));
  });

  it("scrolls a wrapped focus into view inside the sheet; opening and closing never scroll", async () => {
    mount();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    /** The options of every focus() call on one element. */
    const focusedWith = (el: Element | null) =>
      focus.mock.calls.filter((_, i) => focus.mock.contexts[i] === el).map(([opts]) => opts);

    // Opening: the sheet takes focus without scrolling anything.
    await tap("open-ig");
    expect(document.activeElement).toBe(sheet());
    expect(focusedWith(sheet())).toEqual([{ preventScroll: true }]);
    expect(scrolled).toEqual([]);

    // A tall Instagram post makes the sheet scroll: past the last control, the first one (✕, at the top)
    // is focused and scrolled into view within the sheet, and the other way round for the last one.
    post(measure(1400), "https://www.instagram.com", frame()!.contentWindow);
    expect(frame()!.style.height).toBe("1400px");
    act(() => $("player-focus-end")!.focus());
    expect(document.activeElement).toBe($("player-close"));
    expect(focusedWith($("player-close"))).toEqual([{ preventScroll: true }]);
    expect(scrolled).toEqual([[$("player-close"), { block: "nearest" }]]);
    act(() => $("player-focus-start")!.focus());
    expect(document.activeElement).toBe($("player-open"));
    expect(scrolled).toEqual([
      [$("player-close"), { block: "nearest" }],
      [$("player-open"), { block: "nearest" }],
    ]);

    // Closing: focus goes back to the ▶ without scrolling the page to it.
    press("Escape");
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe($("open-ig"));
    expect(focusedWith($("open-ig")).at(-1)).toEqual({ preventScroll: true });
    expect(scrolled).toHaveLength(2);
  });

  it("Back closes the player; closing by ✕ leaves no history entry behind", async () => {
    mount();
    await tap("open-tt");
    const state = () =>
      (window.history.state as Record<string, unknown> | null)?.[PLAYER_HISTORY_KEY];
    expect(state()).toBeTruthy();

    act(() => window.history.back());
    await settle();
    await vi.waitFor(() => expect(sheet()).toBeNull());
    expect(state()).toBeUndefined();

    await tap("open-ig");
    expect(state()).toBeTruthy();
    act(() => $("player-close")!.click());
    expect(sheet()).toBeNull();
    await vi.waitFor(() => expect(state()).toBeUndefined());
    // Forward onto the old entry does not bring the player back.
    act(() => window.history.forward());
    await settle();
    expect(sheet()).toBeNull();
  });
});

describe("refusals", () => {
  it("shows why instead of a frame, with the open link: embedding off, removed, Instagram's refusal", async () => {
    mount();
    for (const [id, reason, text] of [
      ["ytOff", "cantPlay", "هالفيديو ما ينفع يشتغل هنا. افتحه في يوتيوب."],
      ["ytGone", "gone", "الفيديو انحذف أو صار خاص."],
      ["igOff", "cantPlay", "هالفيديو ما ينفع يشتغل هنا. افتحه في انستقرام."],
    ] as const) {
      await tap(`open-${id}`);
      const error = $("player-error");
      expect(error?.getAttribute("data-reason"), id).toBe(reason);
      expect(error?.textContent, id).toBe(text);
      expect(error?.getAttribute("role")).toBe("alert");
      expect(document.querySelector("iframe"), id).toBeNull();
      expect($("player-open")?.getAttribute("href"), id).toBe(ITEMS[id].url);
      expect($("player-note"), id).toBeNull();
      act(() => $("player-close")!.click());
      await settle();
    }
  });

  it("mounts the frame anyway when the check itself fails", async () => {
    mount();
    await tap("open-ytOffline");
    expect($("player-error")).toBeNull();
    expect(frame()?.getAttribute("src")).toContain("/embed/offline0001?");
  });
});

describe("the players' messages", () => {
  it("Instagram: its MEASURE from its own frame sets the height; anything else is ignored", async () => {
    mount();
    await tap("open-ig");
    expect(asked).toEqual([
      "https://graph.facebook.com/v25.0/instagram_oembed?url=https%3A%2F%2Fwww.instagram.com%2Fp%2FC1abcDEF&omitscript=true",
    ]);
    const f = frame()!;
    expect(f.getAttribute("src")).toBe("https://www.instagram.com/p/C1abcDEF/embed/");
    expect($("player-box")?.getAttribute("data-shape")).toBe("post");
    expect(f.style.height).toBe(`${IG_START_HEIGHT}px`);
    expect($("player-note")?.textContent).toBe(
      "انستقرام يبغى ضغطة ثانية على زر التشغيل داخل الإطار.",
    );

    post(measure(0), "https://www.instagram.com", f.contentWindow);
    expect(f.style.height).toBe("620px");
    post(measure(700), "https://www.instagram.com", f.contentWindow);
    expect(f.style.height).toBe("700px");

    // A look-alike origin, the right origin from another window, junk and out-of-range heights.
    post(measure(1500), "https://www.instagram.com.evil.test", f.contentWindow);
    post(measure(1500), "https://www.tiktok.com", f.contentWindow);
    post(measure(1500), "https://www.instagram.com", window);
    post(measure(1500), "https://www.instagram.com", null);
    post(measure(5000), "https://www.instagram.com", f.contentWindow);
    post("{not json", "https://www.instagram.com", f.contentWindow);
    post(
      { type: "MEASURE", details: { height: 1500 } },
      "https://www.instagram.com",
      f.contentWindow,
    );
    expect(f.style.height).toBe("700px");
  });

  it("TikTok: no pre-check; sound on once it plays (once per video); an error replaces the frame", async () => {
    mount();
    await tap("open-tt");
    expect(asked).toEqual([]);
    expect($("player-note")?.textContent).toBe(
      "لو طلع لك طلب الكوكيز من تيك توك، جاوبه وبعدها يشتغل الفيديو.",
    );
    const f = frame()!;
    const win = f.contentWindow!;
    const sent = vi.fn();
    (win as unknown as { postMessage: typeof sent }).postMessage = sent;

    // Noise and look-alikes first: nothing is sent.
    post("[tea-sdk]ready", "https://www.tiktok.com", win);
    post(tiktok("onPlayerReady"), "https://www.tiktok.com", win);
    post(tiktok("onStateChange", 1), "https://www.tiktok.com.evil.test", win);
    post(tiktok("onStateChange", 1), "https://www.tiktok.com", window);
    expect(sent).not.toHaveBeenCalled();

    post(tiktok("onStateChange", 1), "https://www.tiktok.com", win);
    post(tiktok("onStateChange", 2), "https://www.tiktok.com", win);
    post(tiktok("onStateChange", 1), "https://www.tiktok.com", win);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith(
      { type: "unMute", "x-tiktok-player": true },
      "https://www.tiktok.com",
    );

    // Autoplay blocked is not an error (TikTok's own ▶ starts it); a spoofed error is ignored.
    post(tiktok("onPlayerError", { errorCode: 3002 }), "https://www.tiktok.com", win);
    post(tiktok("onPlayerError", { errorCode: 1001 }), "https://evil.test", win);
    expect(frame()).not.toBeNull();

    post(
      tiktok("onPlayerError", { errorCode: 1001, errorType: "INVALID_VIDEO" }),
      "https://www.tiktok.com",
      win,
    );
    expect(frame()).toBeNull();
    expect($("player-error")?.getAttribute("data-reason")).toBe("gone");
    expect($("player-open")?.getAttribute("href")).toBe(ITEMS.tt.url);
  });

  it("TikTok: any other player error means it cannot play here", async () => {
    mount();
    await tap("open-tt");
    const win = frame()!.contentWindow!;
    post(tiktok("onPlayerError", { errorCode: 2001 }), "https://www.tiktok.com", win);
    expect($("player-error")?.textContent).toBe("هالفيديو ما ينفع يشتغل هنا. افتحه في تيك توك.");
  });

  it("YouTube: a line under the frame when it has not loaded after 10 s, none once it loads", async () => {
    vi.useFakeTimers();
    const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
    mount();
    act(() => $("open-yt")!.click());
    await tick(0);
    expect(frame()).not.toBeNull();
    await tick(PLAYER_SLOW_MS - 1);
    expect($("player-slow")).toBeNull();
    await tick(1);
    expect($("player-slow")?.textContent).toBe("المشغّل تأخّر. جرّب تفتحه في يوتيوب.");
    // It loads late: the line goes.
    act(() => frame()!.dispatchEvent(new Event("load")));
    expect($("player-slow")).toBeNull();

    act(() => $("player-close")!.click());
    act(() => $("open-yt")!.click());
    await tick(0);
    act(() => frame()!.dispatchEvent(new Event("load")));
    await tick(PLAYER_SLOW_MS * 2);
    expect($("player-slow")).toBeNull();
  });
});
