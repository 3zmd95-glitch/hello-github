// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VideoPlayerContext,
  type PlayableItem,
  type VideoPlayerApi,
} from "@/components/player/VideoPlayerContext";
import type { Lang } from "@/lib/domain";
import type { ResearchItem } from "@/lib/research";
import { clearScoutCache } from "@/lib/scoutClient";
import { useStore } from "@/store";
import ResultCard from "./ResultCard";

// ▶ Watch here (round 32), the cards' side: a card that is one post of YouTube, TikTok or Instagram turns
// its poster into a ▶ button that hands the post to the app's player (a fake one here: the sheet itself is
// components/player, with its own tests and e2e/player.spec.ts); anything else keeps the link it always
// had. An Instagram post without a picture gets the app's own poster. Rendered in jsdom; nothing leaves the
// machine (the one request, a fresh TikTok thumbnail, goes to a stubbed Worker).

const WORKER = "https://scout.test";

const YT: ResearchItem = {
  platform: "yt",
  handle: "Match Cut Academy",
  title: "Match cuts explained",
  snippet: "",
  url: "https://www.youtube.com/watch?v=abc123XYZ",
  thumb: `${WORKER}/thumb/yt.png`,
};
const TT: ResearchItem = {
  platform: "tt",
  handle: "@editor.sam",
  title: "Match cut in 10 seconds",
  snippet: "Two shots, one motion.",
  url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001",
  thumb: `${WORKER}/thumb/tt.png`,
};
const IG: ResearchItem = {
  platform: "ig",
  handle: "@cutsbyfaisal",
  title: "ماتش كت من باب لباب\nوالتصوير بالجوال #مونتاج",
  snippet: "",
  url: "https://www.instagram.com/p/C1abcDEF",
};
const WEB: ResearchItem = {
  platform: "web",
  handle: "blog.example",
  title: "How to match cut",
  snippet: "",
  url: "https://blog.example/match-cut",
};

let host: HTMLDivElement;
let root: Root;
let opened: PlayableItem[];

/** A player that only records what the cards hand it. */
const player: VideoPlayerApi = {
  current: null,
  open: (item) => {
    opened.push(item);
  },
  close: () => {},
};

const $ = <T extends HTMLElement = HTMLElement>(testId: string, within: ParentNode = host) =>
  within.querySelector<T>(`[data-testid="${testId}"]`);

/** One card in a list, inside the fake player (or with no player at all, like a card outside the shell). */
function render(
  props: Parameters<typeof ResultCard>[0],
  opts: { lang?: Lang; provider?: boolean } = {},
): void {
  act(() => useStore.getState().setSettings({ lang: opts.lang ?? "ar" }));
  const list = createElement("ul", null, createElement(ResultCard, props));
  act(() =>
    root.render(
      opts.provider === false
        ? list
        : createElement(VideoPlayerContext.Provider, { value: player }, list),
    ),
  );
}

function click(el: HTMLElement | null): void {
  if (!el) throw new Error("nothing to click");
  act(() => el.click());
}

/** Let a fetch answer and React settle. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  opened = [];
  localStorage.clear();
  clearScoutCache();
  useStore.getState().setSettings({ lang: "ar", apiKeys: { scoutUrl: "", scoutToken: "" } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("ResultCard ▶ (full card)", () => {
  it("a YouTube video: the media frame is a ▶ button that hands the video to the player", () => {
    render({ item: YT });
    const play = $<HTMLButtonElement>("result-play")!;
    expect(play.tagName).toBe("BUTTON");
    expect(play.type).toBe("button");
    expect(play.getAttribute("aria-label")).toBe("شاهد «Match cuts explained» هنا");
    // Same 16:9 frame as the link it replaces, full width of the card: the card does not grow.
    expect(play.className.split(" ")).toEqual(
      expect.arrayContaining(["aspect-video", "w-full", "overflow-hidden", "relative"]),
    );
    // The picture is inside it, with the ▶ badge over it.
    expect($("result-thumb", play)!.getAttribute("src")).toBe(YT.thumb);
    expect($("result-play-badge", play)!.textContent).toBe("▶");
    expect($("result-play-badge", play)!.getAttribute("aria-hidden")).toBe("true");
    // No link around the media any more; the title link and "open ↗" are unchanged.
    expect(play.closest("a")).toBeNull();
    const links = [...host.querySelectorAll("a")].map((a) => a.getAttribute("data-testid"));
    expect(links).toEqual(["result-title", "result-open"]);
    expect($("result-title")!.getAttribute("href")).toBe(YT.url);
    expect($("result-open")!.getAttribute("href")).toBe(YT.url);
    expect($("result-open")!.getAttribute("target")).toBe("_blank");
    expect(opened).toEqual([]);

    click(play);
    expect(opened).toEqual([
      {
        platform: "yt",
        url: YT.url,
        title: "Match cuts explained",
        handle: "Match Cut Academy",
        thumb: YT.thumb,
      },
    ]);
    // Every tap opens it again (the player replaces what it plays).
    click(play);
    expect(opened).toHaveLength(2);
  });

  it("the card stays `relative` with its test id, platform and width from the caller", () => {
    render({ item: YT, testId: "genre-week-item", className: "w-60 shrink-0 snap-start" });
    const card = $("genre-week-item")!;
    expect(card.getAttribute("data-platform")).toBe("yt");
    expect(card.className.split(" ")).toEqual(
      expect.arrayContaining(["relative", "overflow-hidden", "w-60", "shrink-0"]),
    );
    expect($("result-play", card)).not.toBeNull();
  });

  it("a TikTok video with a picture: the 9:16 poster on its blurred copy, inside the ▶ button", () => {
    render({ item: TT });
    const play = $("result-play")!;
    const imgs = [...play.querySelectorAll("img")];
    expect(imgs).toHaveLength(2);
    expect(imgs[0].getAttribute("aria-hidden")).toBe("true");
    expect(imgs[1].getAttribute("data-testid")).toBe("result-thumb");
    expect(imgs[1].className).toContain("aspect-[9/16]");
    expect($("result-play-badge", play)).not.toBeNull();
    click(play);
    expect(opened).toEqual([
      {
        platform: "tt",
        url: TT.url,
        title: TT.title,
        handle: "@editor.sam",
        thumb: TT.thumb,
      },
    ]);
  });

  it("TikTok and YouTube without a picture keep their glyph tile and get the ▶ badge", () => {
    render({ item: { ...TT, thumb: undefined } });
    let tile = $("result-thumb-placeholder")!;
    expect(tile.hasAttribute("data-poster")).toBe(false);
    expect(tile.textContent).toBe("♪");
    expect($("result-play-badge")).not.toBeNull();
    click($("result-play"));
    // No picture, no `thumb` for the player.
    expect(opened[0]).not.toHaveProperty("thumb");

    render({ item: { ...YT, thumb: undefined, handle: "" } });
    tile = $("result-thumb-placeholder")!;
    expect(tile.textContent).toBe("▶");
    expect($("result-play-badge")).not.toBeNull();
    click($("result-play"));
    // A trend row has no channel: no handle for the player either.
    expect(opened[1]).toEqual({ platform: "yt", url: YT.url, title: YT.title });
  });

  it("an Instagram post without a picture gets the app's own 9:16 poster, honest about why", () => {
    render({ item: IG });
    const play = $("result-play")!;
    expect(play.getAttribute("aria-label")).toBe(`شاهد «${IG.title}» هنا`);
    const poster = $("result-thumb-placeholder", play)!;
    expect(poster.getAttribute("data-poster")).toBe("ig");
    // The ▶ is drawn in the poster, so no second badge; no picture, no camera glyph.
    expect(poster.textContent).toContain("▶");
    expect(poster.textContent).not.toContain("📷");
    expect($("result-play-badge")).toBeNull();
    expect($("result-thumb")).toBeNull();
    const handle = $("result-poster-handle", poster)!;
    expect(handle.textContent).toBe("@cutsbyfaisal");
    expect(handle.getAttribute("dir")).toBe("ltr");
    // The caption's first line, in its own direction, three lines at most.
    const caption = $("result-poster-caption", poster)!;
    expect(caption.textContent).toBe("ماتش كت من باب لباب");
    expect(caption.getAttribute("dir")).toBe("auto");
    expect(caption.className.split(" ")).toContain("line-clamp-3");
    expect($("result-poster-note", poster)!.textContent).toBe(
      "انستقرام ما يعطي صورة معاينة. اضغط وتفرّج.",
    );
    // A 9:16 box in the Instagram chip's colours (no Instagram logo or gradient), never wider than 9:16.
    const box = poster.firstElementChild!;
    expect(box.className.split(" ")).toEqual(
      expect.arrayContaining([
        "aspect-[9/16]",
        "h-full",
        "min-w-0",
        "overflow-hidden",
        "bg-[#57331a]",
        "text-[#ffc996]",
      ]),
    );
    expect(box.className).not.toMatch(/gradient/);

    click(play);
    expect(opened).toEqual([
      { platform: "ig", url: IG.url, title: IG.title, handle: "@cutsbyfaisal" },
    ]);
  });

  it("the Instagram poster in English, without a handle it knows, and without a title of its own", () => {
    render({ item: { ...IG, handle: "instagram.com", title: "instagram.com" } }, { lang: "en" });
    const poster = $("result-thumb-placeholder")!;
    expect(poster.getAttribute("data-poster")).toBe("ig");
    expect($("result-poster-handle")).toBeNull();
    expect($("result-poster-caption")).toBeNull();
    expect($("result-poster-note")!.textContent).toBe(
      "Instagram gives no preview image. Tap to watch.",
    );
    expect($("result-play")!.getAttribute("aria-label")).toBe("Watch “instagram.com” here");
  });

  it("an Instagram post with a picture from the search shows it, like the other vertical posters", () => {
    render({ item: { ...IG, thumb: `${WORKER}/thumb/ig.png` } });
    expect($("result-thumb")!.getAttribute("src")).toBe(`${WORKER}/thumb/ig.png`);
    expect($("result-thumb-placeholder")).toBeNull();
    expect($("result-play-badge")).not.toBeNull();
    click($("result-play"));
    expect(opened[0].thumb).toBe(`${WORKER}/thumb/ig.png`);
  });

  it("a web page or an Instagram profile has no player: the media frame stays the link", () => {
    for (const item of [
      WEB,
      { ...IG, url: "https://www.instagram.com/cutsbyfaisal", title: "Faisal" },
    ]) {
      render({ item });
      expect($("result-play")).toBeNull();
      expect($("result-play-badge")).toBeNull();
      const tile = $("result-thumb-placeholder")!;
      // The camera tile, not the "tap to watch" poster: there is nothing to watch here.
      expect(tile.hasAttribute("data-poster")).toBe(false);
      const frame = tile.closest("a")!;
      expect(frame.getAttribute("href")).toBe(item.url);
      expect(frame.getAttribute("target")).toBe("_blank");
      expect(frame.getAttribute("rel")).toBe("noopener noreferrer");
      expect(frame.getAttribute("aria-hidden")).toBe("true");
      expect(frame.getAttribute("tabindex")).toBe("-1");
      expect(frame.className.split(" ")).toContain("aspect-video");
    }
    expect(opened).toEqual([]);
  });

  it("outside the player's provider the ▶ is there and a tap does nothing", () => {
    render({ item: YT }, { provider: false });
    expect(() => click($("result-play"))).not.toThrow();
    expect(opened).toEqual([]);
  });

  it("an expired TikTok picture is swapped for a fresh one, and the player gets the fresh one", async () => {
    const fresh = `${WORKER}/thumb/fresh.png`;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        asked.push(url.pathname);
        return new Response(JSON.stringify({ title: "", author: "", thumb: fresh, url: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    act(() =>
      useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "tok" } }),
    );
    const item = { ...TT, url: "https://www.tiktok.com/@editor.sam/video/7300000000000000009" };
    render({ item });
    act(() => {
      $("result-thumb")!.dispatchEvent(new Event("error"));
    });
    await settle();
    expect(asked).toEqual(["/oembed"]);
    expect($("result-thumb")!.getAttribute("src")).toBe(fresh);
    click($("result-play"));
    expect(opened[0].thumb).toBe(fresh);
  });

  it("a TikTok card that arrives without a picture asks the Worker's oEmbed, once per post", async () => {
    // Discover v2 sends TikTok cards without pictures; the card asks for one itself.
    const fresh = `${WORKER}/thumb/asked.png`;
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        asked.push(new URL(String(input)).searchParams.get("url") ?? "");
        return new Response(JSON.stringify({ title: "", author: "", thumb: fresh, url: "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    act(() =>
      useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "tok" } }),
    );
    const item = {
      ...TT,
      thumb: undefined,
      url: "https://www.tiktok.com/@editor.sam/video/7300000000000000010",
    };
    render({ item });
    await settle();
    expect(asked).toEqual([item.url]);
    expect($("result-thumb")!.getAttribute("src")).toBe(fresh);

    // The same post elsewhere (the saved row) gets the same picture without asking again; YouTube never asks.
    render({ item, compact: true });
    await settle();
    expect($("saved-ref-thumb")!.getAttribute("src")).toBe(fresh);
    render({ item: { ...YT, thumb: undefined } });
    await settle();
    expect(asked).toHaveLength(1);
  });

  it("a TikTok card titled only by its handle shows the post's caption from the same lookup", async () => {
    // Discover v2 keeps a generic TikTok page title ("TikTok - Make Your Day") as the handle and no longer asks
    // oEmbed inside the search; the card's own lookup brings the caption.
    const caption = "Flash transition in CapCut 🔥";
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        asked.push(new URL(String(input)).searchParams.get("url") ?? "");
        return new Response(
          JSON.stringify({ title: caption, author: "@editor.sam", thumb: "", url: "" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }),
    );
    act(() =>
      useStore.getState().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "tok" } }),
    );
    const item = {
      ...TT,
      title: "@editor.sam",
      url: "https://www.tiktok.com/@editor.sam/video/7300000000000000011",
    };
    // It has a picture, so only the title sends it to ask.
    render({ item });
    await settle();
    expect(asked).toEqual([item.url]);
    expect($("result-title")!.textContent).toBe(caption);
    expect($("result-play")!.getAttribute("aria-label")).toBe(`شاهد «${caption}» هنا`);
    expect($("result-thumb")!.getAttribute("src")).toBe(TT.thumb);
    click($("result-play"));
    expect(opened[0].title).toBe(caption);

    // The saved row of the same post shows it without asking again; a card with a real title keeps its own.
    render({ item, compact: true });
    await settle();
    expect(host.querySelector("a")!.textContent).toBe(caption);
    render({ item: { ...item, title: "Match cut in 10 seconds" } });
    await settle();
    expect($("result-title")!.textContent).toBe("Match cut in 10 seconds");
    expect(asked).toHaveLength(1);
  });
});

describe("ResultCard ▶ (compact: the skill sheet's saved references)", () => {
  it("the thumbnail stays a picture; a small ▶ button of its own sits before the ✕", () => {
    const onRemove = vi.fn();
    render({ item: { ...TT, snippet: "" }, compact: true, onRemove });
    const row = $("saved-ref")!;
    expect(row.getAttribute("data-platform")).toBe("tt");
    // YouTube asks a thumbnail that starts playback to be at least 120x70; the row's is 48 px tall. So the
    // picture is only a picture: not in a button, no ▶ badge on it.
    const thumb = $("saved-ref-thumb", row)!;
    expect(thumb.getAttribute("src")).toBe(TT.thumb);
    expect(thumb.className.split(" ")).toEqual(
      expect.arrayContaining(["h-12", "aspect-[9/16]", "shrink-0"]),
    );
    expect(thumb.closest("button")).toBeNull();
    expect($("result-play-badge", row)).toBeNull();

    const play = $<HTMLButtonElement>("result-play", row)!;
    expect(play.type).toBe("button");
    expect(play.textContent).toBe("▶");
    expect(play.getAttribute("aria-label")).toBe("شاهد «Match cut in 10 seconds» هنا");
    // The ✕'s own size, so the row does not grow; the title keeps the room that is left.
    expect(play.className).toBe("px-btn px-btn-ghost px-btn-sm shrink-0");
    expect(play.className).toBe($("saved-ref-remove", row)!.className);
    expect(play.nextElementSibling).toBe($("saved-ref-remove", row));
    expect(row.querySelector("a")!.parentElement!.className.split(" ")).toEqual(
      expect.arrayContaining(["min-w-0", "flex-1"]),
    );
    const link = row.querySelector("a")!;
    expect(link.getAttribute("href")).toBe(TT.url);
    expect(link.textContent).toBe(TT.title);
    expect(play.closest("a")).toBeNull();

    click(play);
    expect(opened).toEqual([
      { platform: "tt", url: TT.url, title: TT.title, handle: "@editor.sam", thumb: TT.thumb },
    ]);
    click($("saved-ref-remove", row));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(1);
  });

  it("every platform that plays here gets the ▶, with or without a picture or a ✕", () => {
    render({ item: { ...YT, thumb: undefined }, compact: true });
    let row = $("saved-ref")!;
    expect($("result-play", row)!.getAttribute("aria-label")).toBe(
      "شاهد «Match cuts explained» هنا",
    );
    expect($("saved-ref-remove", row)).toBeNull();
    click($("result-play", row));
    expect(opened[0]).toEqual({
      platform: "yt",
      url: YT.url,
      title: YT.title,
      handle: "Match Cut Academy",
    });

    // Instagram without a picture: the plain glyph tile (not the full card's poster), and the ▶ beside it.
    render({ item: IG, compact: true, onRemove: () => {} });
    row = $("saved-ref")!;
    expect(row.textContent).toContain("📷");
    expect($("result-thumb-placeholder", row)).toBeNull();
    const tile = row.firstElementChild!;
    expect(tile.tagName).toBe("SPAN");
    expect(tile.className.split(" ")).toEqual(expect.arrayContaining(["h-12", "aspect-[9/16]"]));
    const play = $("result-play", row)!;
    expect(play.textContent).toBe("▶");
    expect(play.nextElementSibling).toBe($("saved-ref-remove", row));
    click(play);
    expect(opened[1]).toEqual({
      platform: "ig",
      url: IG.url,
      title: IG.title,
      handle: "@cutsbyfaisal",
    });
  });

  it("a web reference or a profile has no ▶: its plain thumbnail, link and ✕ only", () => {
    render({
      item: { ...WEB, thumb: `${WORKER}/thumb/web.png` },
      compact: true,
      onRemove: () => {},
    });
    expect($("result-play")).toBeNull();
    const thumb = $("saved-ref-thumb")!;
    expect(thumb.className.split(" ")).toEqual(expect.arrayContaining(["h-12", "aspect-video"]));
    expect(thumb.closest("button")).toBeNull();
    expect($("saved-ref-remove")).not.toBeNull();

    render({
      item: { ...IG, url: "https://www.instagram.com/cutsbyfaisal", title: "Faisal" },
      compact: true,
    });
    expect($("result-play")).toBeNull();
    expect(host.querySelectorAll("button")).toHaveLength(0);
    expect(opened).toEqual([]);
  });
});
