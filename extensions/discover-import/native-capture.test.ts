// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { collectNativeDiscoverCards } from "./native-capture.js";

const igSearch = "https://www.instagram.com/explore/search/keyword/?q=anime%20edit";
const ttSearch = "https://www.tiktok.com/search?q=anime";
const ytSearch = "https://www.youtube.com/results?search_query=anime";
const computedStyle = window.getComputedStyle.bind(window);
const scrollBy = vi.fn();
function source(url = igSearch) {
  vi.stubGlobal("window", {
    location: { href: url },
    getComputedStyle: computedStyle,
    innerHeight: 800,
    scrollBy,
  });
}
function fixture(html: string) {
  document.body.innerHTML = html;
}

beforeEach(() => {
  fixture("");
  source();
  scrollBy.mockReset();
  vi.spyOn(Element.prototype, "getClientRects").mockImplementation(
    () => [{ width: 100, height: 100, top: 1200, bottom: 1300 }] as unknown as DOMRectList,
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("includes loaded Instagram reel tiles without text and reads only video.poster", () => {
  fixture(
    '<a href="/reel/Anime123/?tracking=1"><video src="https://private.invalid/media.mp4" poster="https://cdn.example/poster.jpg"></video></a><a href="/p/Still123/"><img src="https://cdn.example/photo.jpg" alt="Anime montage" /></a>',
  );
  Object.defineProperty(document.querySelector("video"), "src", {
    get() {
      throw new Error("Video sources must never be read");
    },
  });
  expect(collectNativeDiscoverCards("ig", igSearch).results).toMatchObject([
    {
      platform: "ig",
      url: "https://www.instagram.com/reel/Anime123/",
      title: "",
      thumb: "https://cdn.example/poster.jpg",
      position: 1,
    },
    {
      platform: "ig",
      url: "https://www.instagram.com/p/Still123/",
      title: "Anime montage",
      thumb: "https://cdn.example/photo.jpg",
      position: 2,
    },
  ]);
  expect(scrollBy).not.toHaveBeenCalled();
});

it("rejects hidden cards and hidden descendant text while including rendered cards below viewport", () => {
  fixture(
    '<div hidden><a href="/reel/Hidden1/">secret</a></div><a href="/reel/Loaded1/">Visible <span style="display:none">secret account data</span><script>private JSON</script></a><a style="opacity:0" href="/reel/Hidden2/">hidden</a>',
  );
  expect(collectNativeDiscoverCards("ig", igSearch).results).toMatchObject([
    { title: "Visible", url: "https://www.instagram.com/reel/Loaded1/" },
  ]);
});

it("never reads card DOM from navigated, private, wrong-query or lookalike pages", () => {
  for (const url of [
    "https://www.instagram.com/direct/inbox/",
    "https://www.instagram.com/accounts/login/",
    "https://www.instagram.com/explore/search/keyword/?q=other",
    "https://www.instagram.com.evil/explore/search/keyword/?q=anime%20edit",
  ]) {
    source(url);
    const query = vi.spyOn(document, "querySelectorAll");
    expect(collectNativeDiscoverCards("ig", igSearch).status).toBe("needs-attention");
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  }
});

it("reports a rendered login challenge and does not scroll or collect", () => {
  fixture('<input type="password" /><a href="/reel/Anime123/">Video</a>');
  expect(collectNativeDiscoverCards("ig", igSearch, 30, true)).toEqual({
    status: "needs-attention",
    results: [],
    error: "login-or-challenge",
  });
  expect(scrollBy).not.toHaveBeenCalled();
});

it("caps initial collection at30, deduplicates tracking variants and scrolls only on explicit more", () => {
  fixture(
    Array.from(
      { length: 100 },
      (_, i) =>
        `<a href="/reel/Post${i}/?tracking=${i}">Post ${i}</a><a href="/reel/Post${i}/">duplicate</a>`,
    ).join(""),
  );
  expect(collectNativeDiscoverCards("ig", igSearch).results).toHaveLength(30);
  expect(scrollBy).not.toHaveBeenCalled();
  expect(collectNativeDiscoverCards("ig", igSearch, 500, true).results).toHaveLength(90);
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 720, behavior: "instant" });
});

function scrollDimensions(id: string, height: number, contentHeight: number) {
  const element = document.getElementById(id)!;
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: contentHeight },
  });
  return element;
}

it("scrolls only the nearest visible results pane once on More and never on initial collection", () => {
  fixture(
    '<section id="outer" style="overflow-y:auto"><div id="inner" style="overflow-y:scroll"><a href="/reel/Anime123/">Anime</a></div></section>',
  );
  const outer = scrollDimensions("outer", 600, 2400);
  const inner = scrollDimensions("inner", 200, 1000);
  collectNativeDiscoverCards("ig", igSearch);
  expect(inner.scrollTop).toBe(0);
  expect(outer.scrollTop).toBe(0);
  expect(scrollBy).not.toHaveBeenCalled();
  collectNativeDiscoverCards("ig", igSearch, 60, true);
  expect(inner.scrollTop).toBe(180);
  expect(outer.scrollTop).toBe(0);
  expect(scrollBy).not.toHaveBeenCalled();
});

it.each(["hidden", "clip", "visible"])(
  "skips overflow-%s ancestors and scrolls the enclosing visible results pane",
  (overflow) => {
    fixture(
      `<section id="outer" style="overflow-y:auto"><div id="inner" style="overflow-y:${overflow}"><a href="/reel/Anime123/">Anime</a></div></section>`,
    );
    const outer = scrollDimensions("outer", 600, 2400);
    const inner = scrollDimensions("inner", 200, 1000);
    collectNativeDiscoverCards("ig", igSearch, 60, true);
    expect(inner.scrollTop).toBe(0);
    expect(outer.scrollTop).toBe(540);
    expect(scrollBy).not.toHaveBeenCalled();
  },
);

it("skips non-scrollable and hidden panes, falling back to one document scroll", () => {
  fixture(
    '<div id="hidden" style="overflow-y:auto;display:none"><a href="/reel/Hidden123/">Hidden</a></div><div id="flat" style="overflow-y:auto"><a href="/reel/Anime123/">Anime</a></div>',
  );
  const hidden = scrollDimensions("hidden", 200, 1000);
  const flat = scrollDimensions("flat", 200, 200);
  const result = collectNativeDiscoverCards("ig", igSearch, 60, true);
  expect(result.results).toHaveLength(1);
  expect(hidden.scrollTop).toBe(0);
  expect(flat.scrollTop).toBe(0);
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 720, behavior: "instant" });
});

it("collects rendered TikTok card titles, handles and displayed statistics without numeric guesses", () => {
  source(ttSearch);
  fixture(
    '<div data-e2e="search_video-item"><a href="/@artist/video/1234567890123456789"><img alt="Anime" src="https://cdn.example/tt.jpg" /></a><h3 data-e2e="video-desc">Anime transitions</h3><span data-e2e="video-views">12.4K</span><span hidden>private</span></div>',
  );
  expect(collectNativeDiscoverCards("tt", ttSearch).results).toMatchObject([
    { title: "Anime transitions", handle: "@artist", displayedStats: "12.4K" },
  ]);
});

it("collects YouTube shorts and watch cards with visible metadata", () => {
  source(ytSearch);
  fixture(
    '<ytd-video-renderer><a href="/watch?v=abcdefghijk&list=abc" id="video-title">Anime breakdown</a><ytd-channel-name>Editor</ytd-channel-name><div id="metadata-line">1.2M views · 3 days ago</div></ytd-video-renderer><a href="/shorts/12345678901"><img alt="Short anime" src="https://cdn.example/yt.jpg" /></a>',
  );
  expect(collectNativeDiscoverCards("yt", ytSearch).results).toMatchObject([
    {
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      title: "Anime breakdown",
      handle: "Editor",
      displayedStats: "1.2M views · 3 days ago",
    },
    { url: "https://www.youtube.com/shorts/12345678901", title: "Short anime" },
  ]);
});

it("reads YouTube's visually rendered ARIA-hidden thumbnail and prefers it to the creator avatar", () => {
  source(ytSearch);
  fixture(
    '<ytd-video-renderer><a href="/@editor"><img src="https://yt3.googleusercontent.com/avatar.jpg" alt="Editor avatar" /></a><a id="thumbnail" href="/watch?v=abcdefghijk&feature=search" aria-hidden="true" tabindex="-1"><yt-image><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" alt="" /></yt-image><span>Accessibility duplicate</span></a><a id="video-title" href="/watch?v=abcdefghijk">Anime breakdown</a><ytd-channel-name>Editor</ytd-channel-name></ytd-video-renderer>',
  );
  expect(collectNativeDiscoverCards("yt", ytSearch).results).toMatchObject([
    {
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      title: "Anime breakdown",
      thumb: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg",
      handle: "Editor",
    },
  ]);
  expect(scrollBy).not.toHaveBeenCalled();
});

it.each(['style="display:none"', 'style="visibility:hidden"', 'style="opacity:0"', "hidden"])(
  "still excludes CSS-hidden YouTube thumbnails (%s) despite allowing accessibility-hidden images",
  (hiddenAttribute) => {
    source(ytSearch);
    fixture(
      `<ytd-video-renderer><a id="thumbnail" href="/watch?v=abcdefghijk" aria-hidden="true" ${hiddenAttribute}><img src="https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" /></a><a id="video-title" href="/watch?v=abcdefghijk">Anime breakdown</a></ytd-video-renderer>`,
    );
    const results = collectNativeDiscoverCards("yt", ytSearch).results;
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty("thumb");
    expect(results[0].title).toBe("Anime breakdown");
  },
);

it("excludes unrelated container text and rejects credentials, private links, cross-platform links and non-image thumbnail schemes", () => {
  fixture(
    '<article><a href="/reel/First/"><img src="data:image/png;base64,secret" /></a><a href="/reel/Second/">Second</a><span>Unrelated account data</span></article><a href="/direct/inbox/">DMs</a><a href="https://user:pass@www.instagram.com/reel/Credentials/">bad</a><a href="https://www.tiktok.com/@name/video/1234567890123456789">wrong platform</a>',
  );
  expect(collectNativeDiscoverCards("ig", igSearch).results).toMatchObject([
    { title: "" },
    { title: "Second" },
  ]);
  expect(collectNativeDiscoverCards("ig", igSearch).results[0]).not.toHaveProperty("thumb");
});
