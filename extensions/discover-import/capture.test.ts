// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectVisibleDiscoverLinks } from "./capture.js";

const getComputedStyle = window.getComputedStyle.bind(window);
const videoId = "1234567890123456789";
const youtubeId = "abcdefghijk";

function source(href: string) {
  vi.stubGlobal("window", {
    location: { href },
    innerWidth: 1000,
    innerHeight: 800,
    getComputedStyle,
  });
}

function rect(left = 20, top = 20, width = 100, height = 100) {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON() {},
  };
}

function link(href: string, bounds = rect(), parent: HTMLElement = document.body) {
  const anchor = document.createElement("a");
  anchor.setAttribute("href", href);
  anchor.getClientRects = () => [bounds] as unknown as DOMRectList;
  parent.append(anchor);
  return anchor;
}

beforeEach(() => {
  document.body.replaceChildren();
  document.body.removeAttribute("style");
  document.documentElement.removeAttribute("style");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: undefined });
  source("https://www.tiktok.com/search?q=editing");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("allowed public search pages", () => {
  it.each([
    ["https://www.tiktok.com/search?q=edit", "tt"],
    ["https://tiktok.com/search/", "tt"],
    ["https://www.instagram.com/explore/search/keyword/?q=edit", "ig"],
    ["https://instagram.com/explore/tags/videoediting/", "ig"],
    ["https://www.youtube.com/results?search_query=edit", "yt"],
    ["https://m.youtube.com/results?search_query=edit", "yt"],
  ])("accepts %s", (url, platform) => {
    source(url);
    expect(collectVisibleDiscoverLinks()).toEqual({ version: 1, platform, urls: [] });
  });

  it.each([
    "http://www.tiktok.com/search",
    "https://www.tiktok.com:444/search",
    "https://user:pass@www.tiktok.com/search",
    "https://www.tiktok.com.evil.example/search",
    "https://evil.example/search",
    "https://www.tiktok.com/messages",
    "https://www.tiktok.com/@creator",
    "https://www.tiktok.com/search/messages",
    "https://www.instagram.com/direct/inbox/",
    "https://www.instagram.com/explore/",
    "https://www.instagram.com/creator/",
    "https://www.instagram.com/explore/tags/edit/private/",
    "https://www.youtube.com/feed/history",
    "https://www.youtube.com/watch?v=abcdefghijk",
    "https://youtu.be/results",
  ])("rejects %s before reading anchors", (url) => {
    source(url);
    const query = vi.spyOn(document, "querySelectorAll");
    expect(collectVisibleDiscoverLinks()).toEqual({ error: "unsupported-page", urls: [] });
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });
});

describe("direct post canonicalization", () => {
  it("captures only valid matching TikTok posts, deduplicated without tracking", () => {
    link(`/@creator/video/${videoId}?utm_source=search#tracking`);
    link(`https://tiktok.com/@creator/video/${videoId}/?other=true`);
    link(`/@creator/video/123`);
    link(`/@creator/photo/${videoId}`);
    link(`/@creator/video/${videoId}/extra`);
    link(`https://www.instagram.com/reel/AbCd123/`);
    link(`https://tiktok.com.evil.example/@creator/video/${videoId}`);
    link(`https://name:secret@www.tiktok.com/@creator/video/${videoId}`);
    link(`https://www.tiktok.com:8443/@creator/video/${videoId}`);
    link(`http://www.tiktok.com/@creator/video/${videoId}`);
    link(`javascript:alert(1)`);
    link(`data:text/plain,https://www.tiktok.com/@creator/video/${videoId}`);
    link(`/@creator/video/${videoId}\n`);
    expect(collectVisibleDiscoverLinks()).toEqual({
      version: 1,
      platform: "tt",
      urls: [`https://www.tiktok.com/@creator/video/${videoId}`],
    });
  });

  it("normalizes Instagram p, reel and reels links to one direct post", () => {
    source("https://www.instagram.com/explore/tags/edit/");
    link("/reel/AbC_d-123/?igsh=tracking");
    link("https://instagram.com/p/AbC_d-123/");
    link("/reels/AbC_d-123/");
    link("/stories/user/12345/");
    link("/p/abc/extra/");
    expect(collectVisibleDiscoverLinks().urls).toEqual(["https://www.instagram.com/p/AbC_d-123"]);
  });

  it("normalizes YouTube watch and shorts and rejects ambiguous IDs", () => {
    source("https://www.youtube.com/results?search_query=edit");
    link(`/watch?v=${youtubeId}&list=tracking#t=10`);
    link(`/shorts/${youtubeId}/?feature=share`);
    link(`https://m.youtube.com/watch?v=12345678901`);
    link(`/watch?v=${youtubeId}&v=12345678901`);
    link(`/watch?v=short`);
    link(`/embed/${youtubeId}`);
    link(`https://youtu.be/${youtubeId}`);
    expect(collectVisibleDiscoverLinks().urls).toEqual([
      `https://www.youtube.com/watch?v=${youtubeId}`,
      "https://www.youtube.com/watch?v=12345678901",
    ]);
  });
});

describe("visible links only", () => {
  it("captures visible YouTube titles when a zero-height body's overflow belongs to the viewport", () => {
    source("https://www.youtube.com/results?search_query=cinematiccoffee");
    document.documentElement.style.overflow = "visible";
    document.body.style.overflowX = "auto";
    document.body.style.overflowY = "scroll";
    vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue(rect(0, 0, 1000, 0));
    const results = document.createElement("ytd-search");
    results.style.overflowX = "auto";
    results.style.overflowY = "hidden";
    results.getBoundingClientRect = () => rect(0, 0, 1000, 7637);
    document.body.append(results);
    for (const [index, id] of [youtubeId, "12345678901", "ABCDEFGHIJK"].entries()) {
      const thumbnail = link(`/watch?v=${id}`, rect(20, 20 + index * 150), results);
      thumbnail.setAttribute("aria-hidden", "true");
      link(`/watch?v=${id}`, rect(150, 20 + index * 150), results);
    }
    link("/watch?v=offscreen01", rect(20, 810), results);
    expect(collectVisibleDiscoverLinks().urls).toEqual([
      `https://www.youtube.com/watch?v=${youtubeId}`,
      "https://www.youtube.com/watch?v=12345678901",
      "https://www.youtube.com/watch?v=ABCDEFGHIJK",
    ]);
  });
  it.each([
    ["auto", "auto"],
    ["visible", "hidden"],
  ])("preserves body clipping when root overflow is %s/%s", (x, y) => {
    document.documentElement.style.overflowX = x;
    document.documentElement.style.overflowY = y;
    document.body.style.overflowX = "hidden";
    document.body.style.overflowY = "hidden";
    vi.spyOn(document.documentElement, "getBoundingClientRect").mockReturnValue(
      rect(0, 0, 1000, 0),
    );
    vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue(rect(0, 0, 1000, 50));
    link(`/@visible/video/${videoId}`, rect(20, 20, 100, 10));
    link(`/@clipped/video/${videoId}`, rect(20, 100, 100, 10));
    expect(collectVisibleDiscoverLinks().urls).toEqual([
      `https://www.tiktok.com/@visible/video/${videoId}`,
    ]);
  });
  it.each(["html", "body"])("preserves body clipping with containment on %s", (tag) => {
    document.documentElement.style.overflow = "visible";
    document.querySelector<HTMLElement>(tag)!.style.contain = "layout";
    document.body.style.overflowX = "hidden";
    document.body.style.overflowY = "hidden";
    vi.spyOn(document.body, "getBoundingClientRect").mockReturnValue(rect(0, 0, 1000, 50));
    link(`/@clipped/video/${videoId}`, rect(20, 100));
    expect(collectVisibleDiscoverLinks().urls).toEqual([]);
  });
  it("keeps nested clipping and body visibility guards when body overflow propagates", () => {
    document.documentElement.style.overflow = "visible";
    document.body.style.overflowX = "auto";
    document.body.style.overflowY = "auto";
    const parent = document.createElement("div");
    parent.style.overflowX = "hidden";
    parent.style.overflowY = "hidden";
    parent.getBoundingClientRect = () => rect(0, 0, 1000, 50);
    document.body.append(parent);
    link(`/@clipped/video/${videoId}`, rect(20, 100), parent);
    link(`/@visible/video/${videoId}`, rect(20, 20, 100, 10), parent);
    expect(collectVisibleDiscoverLinks().urls).toEqual([
      `https://www.tiktok.com/@visible/video/${videoId}`,
    ]);
    document.body.style.visibility = "hidden";
    expect(collectVisibleDiscoverLinks().urls).toEqual([]);
    document.body.style.visibility = "visible";
    document.documentElement.style.opacity = "0";
    expect(collectVisibleDiscoverLinks().urls).toEqual([]);
  });
  it("excludes offscreen, empty, hidden, transparent and aria-hidden anchors", () => {
    const hidden = link(`/@hidden/video/${videoId}`);
    hidden.hidden = true;
    link(`/@offscreen/video/${videoId}`, rect(0, 810));
    link(`/@empty/video/${videoId}`, rect(0, 0, 0, 0));
    const invisible = link(`/@invisible/video/${videoId}`);
    invisible.style.visibility = "hidden";
    const parent = document.createElement("div");
    parent.style.opacity = "0";
    document.body.append(parent);
    link(`/@transparent/video/${videoId}`, rect(), parent);
    const aria = link(`/@aria/video/${videoId}`);
    aria.setAttribute("aria-hidden", "true");
    link(`/@visible/video/${videoId}`, rect(-10, 20));
    expect(collectVisibleDiscoverLinks().urls).toEqual([
      `https://www.tiktok.com/@visible/video/${videoId}`,
    ]);
  });

  it("excludes anchors clipped by scroll containers", () => {
    const parent = document.createElement("div");
    parent.style.overflowX = "hidden";
    parent.style.overflowY = "hidden";
    parent.getBoundingClientRect = () => rect(0, 0, 300, 50);
    document.body.append(parent);
    link(`/@clipped/video/${videoId}`, rect(0, 100), parent);
    link(`/@partlyvisible/video/${videoId}`, rect(0, 30), parent);
    expect(collectVisibleDiscoverLinks().urls).toEqual([
      `https://www.tiktok.com/@partlyvisible/video/${videoId}`,
    ]);
  });

  it("excludes anchors covered by an overlay", () => {
    link(`/@covered/video/${videoId}`);
    const visible = link(`/@visible/video/${videoId}`, rect(300, 20));
    const overlay = document.createElement("div");
    document.body.append(overlay);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: (x: number) => (x > 250 ? visible : overlay),
    });
    expect(collectVisibleDiscoverLinks().urls).toEqual([
      `https://www.tiktok.com/@visible/video/${videoId}`,
    ]);
  });

  it("honors the browser visibility check", () => {
    const anchor = link(`/@hidden/video/${videoId}`);
    anchor.checkVisibility = () => false;
    expect(collectVisibleDiscoverLinks().urls).toEqual([]);
  });

  it("caps unique visible links at 24 without copying other page data", () => {
    for (let i = 0; i < 30; i++) {
      const anchor = link(`/@creator${i}/video/${videoId}?token=private`);
      anchor.textContent = "Caption and private text must not be returned";
      link(`/@creator${i}/video/${videoId}`);
    }
    const result = collectVisibleDiscoverLinks();
    expect(result.urls).toHaveLength(24);
    expect(result.urls[23]).toBe(`https://www.tiktok.com/@creator23/video/${videoId}`);
    expect(Object.keys(result).sort()).toEqual(["platform", "urls", "version"]);
    expect(JSON.stringify(result)).not.toMatch(/token|private|Caption/);
  });
});
