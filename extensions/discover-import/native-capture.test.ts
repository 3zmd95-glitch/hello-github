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

const ttErrorSurface = (attrs = "") =>
  `<div ${attrs}><h2>Something went wrong</h2><p>Sorry, something wrong with the server, please try again.</p><button>Try again</button></div>`;
const ttCard = (id: string, caption: string) =>
  `<div data-e2e="search_top-item"><a href="/@editor/video/${id}"><img src="https://cdn.example/${id}.jpg" alt="" /></a><h3 data-e2e="search-card-video-caption">${caption}</h3></div>`;

it("reports TikTok's rendered server-error screen as a failed read, not an empty search", () => {
  source(ttSearch);
  fixture(`<nav><a href="/foryou">For You</a></nav><main>${ttErrorSurface()}</main>`);
  expect(collectNativeDiscoverCards("tt", ttSearch, 30, true)).toEqual({
    status: "error",
    results: [],
    error: "search-service-error",
  });
  expect(scrollBy).not.toHaveBeenCalled();
});

it("does not treat hidden error markup, card captions, no-results or loading pages as a source error", () => {
  source(ttSearch);
  fixture(`<main>${ttErrorSurface('style="display:none"')}</main>`);
  expect(collectNativeDiscoverCards("tt", ttSearch)).toMatchObject({
    status: "empty",
    results: [],
  });
  fixture(`<main>${ttErrorSurface("hidden")}</main>`);
  expect(collectNativeDiscoverCards("tt", ttSearch).status).toBe("empty");
  // An ordinary caption saying the same words is a card, never an error.
  fixture(
    `<main>${ttCard("7000000000000000001", "Something went wrong with my edit")}<button>Try again</button></main>`,
  );
  const grid = collectNativeDiscoverCards("tt", ttSearch);
  expect(grid.status).toBe("done");
  expect(grid.results).toMatchObject([
    {
      url: "https://www.tiktok.com/@editor/video/7000000000000000001",
      title: "Something went wrong with my edit",
    },
  ]);
  // Even the error markup beside real cards leaves the cards collected.
  fixture(`<main>${ttErrorSurface()}${ttCard("7000000000000000002", "Real caption")}</main>`);
  expect(collectNativeDiscoverCards("tt", ttSearch).status).toBe("done");
  fixture("<main><h2>No results found</h2><p>Try different keywords.</p></main>");
  expect(collectNativeDiscoverCards("tt", ttSearch)).toMatchObject({
    status: "empty",
    results: [],
  });
  fixture("<main><div>Loading</div></main>");
  expect(collectNativeDiscoverCards("tt", ttSearch)).toMatchObject({
    status: "empty",
    results: [],
  });
  // A heading without a retry control is not a strong error signal either.
  fixture("<main><h2>Something went wrong</h2></main>");
  expect(collectNativeDiscoverCards("tt", ttSearch).status).toBe("empty");
});

it("keeps login/challenge ahead of the source-error check", () => {
  source(ttSearch);
  fixture(`<main>${ttErrorSurface()}<input type="password" /></main>`);
  expect(collectNativeDiscoverCards("tt", ttSearch)).toEqual({
    status: "needs-attention",
    results: [],
    error: "login-or-challenge",
  });
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

it("scans beyond more than90 known cards and skips the old trimmed prefix using the last result boundary", () => {
  fixture(
    Array.from(
      { length: 160 },
      (_, index) => `<a href="/reel/Post${index}/">Post ${index}</a>`,
    ).join(""),
  );
  const result = collectNativeDiscoverCards("ig", igSearch, 30, false, {
    knownUrls: Array.from(
      { length: 100 },
      (_, index) => `https://www.instagram.com/reel/Post${index + 20}/`,
    ),
    lastUrl: "https://www.instagram.com/reel/Post119/",
  });
  expect(result.results).toHaveLength(30);
  expect(result.results[0].url).toBe("https://www.instagram.com/reel/Post120/");
  expect(result.results.at(-1)!.url).toBe("https://www.instagram.com/reel/Post149/");
  expect(result.lastUrl).toBe("https://www.instagram.com/reel/Post149/");
  expect(scrollBy).not.toHaveBeenCalled();
});

it("continues when virtualization removes the previous boundary and all older cards", () => {
  fixture(
    Array.from({ length: 35 }, (_, index) => `<a href="/reel/Post${index + 150}/">Next</a>`).join(
      "",
    ),
  );
  const result = collectNativeDiscoverCards("ig", igSearch, 30, false, {
    knownUrls: Array.from(
      { length: 150 },
      (_, index) => `https://www.instagram.com/reel/Post${index}/`,
    ),
    lastUrl: "https://www.instagram.com/reel/Post149/",
  });
  expect(result.results).toHaveLength(30);
  expect(result.results[0].url).toBe("https://www.instagram.com/reel/Post150/");
  expect(result.lastUrl).toBe("https://www.instagram.com/reel/Post179/");
});

it("deduplicates alternate public paths for the same Instagram post", () => {
  fixture(
    '<a href="/p/Same123/">Post</a><a href="/reel/Same123/">Reel</a><a href="/reel/New123/">New</a>',
  );
  const result = collectNativeDiscoverCards("ig", igSearch, 30, false, {
    knownUrls: ["https://www.instagram.com/reel/Same123/"],
    lastUrl: "https://www.instagram.com/reel/Same123/",
  });
  expect(result.results.map((item) => item.url)).toEqual([
    "https://www.instagram.com/reel/New123/",
  ]);
  expect(result.order).toEqual(["Same123", "New123"]);
});

it("recovers a late-hydrated card between known cards, returns DOM order and ends on the last card", () => {
  fixture(
    ["PostA", "PostB", "PostC", "PostD"].map((id) => `<a href="/reel/${id}/">${id}</a>`).join(""),
  );
  const progress = {
    knownUrls: ["https://www.instagram.com/reel/PostA/", "https://www.instagram.com/reel/PostC/"],
    lastUrl: "https://www.instagram.com/reel/PostC/",
  };
  const result = collectNativeDiscoverCards("ig", igSearch, 30, false, progress);
  expect(result.results.map((item) => item.url)).toEqual([
    "https://www.instagram.com/reel/PostB/",
    "https://www.instagram.com/reel/PostD/",
  ]);
  expect(result.lastUrl).toBe("https://www.instagram.com/reel/PostD/");
  expect(result.order).toEqual(["PostA", "PostB", "PostC", "PostD"]);
  expect(scrollBy).not.toHaveBeenCalled();
  collectNativeDiscoverCards("ig", igSearch, 30, true, progress);
  expect(scrollBy).toHaveBeenCalledTimes(1);
});

const reel = (id: string) => `https://www.instagram.com/reel/${id}/`;
const reelLinks = (ids: string[]) => ids.map((id) => `<a href="/reel/${id}/">${id}</a>`).join("");
const urls = (result: { results: { url: string }[] }) => result.results.map((item) => item.url);

it("recovers a never-trimmed late first card when the helper passed every read card", () => {
  fixture(reelLinks(["LateFirst", "PostA", "PostC", "PostD"]));
  const known = { knownUrls: [reel("PostA"), reel("PostC")], lastUrl: reel("PostC") };
  const result = collectNativeDiscoverCards("ig", igSearch, 30, false, {
    ...known,
    knownTotal: 2,
    omitted: 0,
  });
  expect(urls(result)).toEqual([reel("LateFirst"), reel("PostD")]);
  expect(result.lastUrl).toBe(reel("PostD"));
  expect(result.order).toEqual(["LateFirst", "PostA", "PostC", "PostD"]);
  // Trimmed (or unknown) bookkeeping keeps skipping the possibly old prefix.
  for (const context of [{ knownTotal: 3, omitted: 0 }, { knownTotal: 2, omitted: 1 }, {}]) {
    const trimmed = collectNativeDiscoverCards("ig", igSearch, 30, false, {
      ...known,
      ...context,
    });
    expect(urls(trimmed)).toEqual([reel("PostD")]);
    expect(trimmed.lastUrl).toBe(reel("PostD"));
  }
  // Virtualization with complete bookkeeping still reads from the top of the grid.
  fixture(reelLinks(["PostE", "PostF"]));
  expect(
    urls(
      collectNativeDiscoverCards("ig", igSearch, 30, false, {
        ...known,
        knownTotal: 2,
        omitted: 0,
      }),
    ),
  ).toEqual([reel("PostE"), reel("PostF")]);
});

it("returns ordering evidence around the known and new cards after a long rendered prefix", () => {
  const old = Array.from({ length: 600 }, (_, index) => `Old${index}`);
  fixture(reelLinks([...old, "PostA", "LateB", "PostC", "PostD"]));
  const result = collectNativeDiscoverCards("ig", igSearch, 30, false, {
    knownUrls: [reel("PostA"), reel("PostC")],
    lastUrl: reel("PostC"),
    knownTotal: 302,
    omitted: 600,
  });
  expect(urls(result)).toEqual([reel("LateB"), reel("PostD")]);
  expect(result.order).toEqual([...old.slice(590), "PostA", "LateB", "PostC", "PostD"]);
});

it("bounds ordering evidence to600 keys on a1,000-card grid, keeping both ends of the span", () => {
  const ids = Array.from({ length: 1000 }, (_, index) => `Post${index}`);
  fixture(reelLinks(ids));
  const result = collectNativeDiscoverCards("ig", igSearch, 30, false, {
    knownUrls: ids.slice(0, 600).map(reel),
    lastUrl: reel("Post599"),
    knownTotal: 600,
    omitted: 0,
  });
  expect(urls(result)).toEqual(ids.slice(600, 630).map(reel));
  expect(result.order).toHaveLength(600);
  expect(result.order).toEqual([...ids.slice(0, 300), ...ids.slice(340, 640)]);
  expect(collectNativeDiscoverCards("ig", igSearch, 90).order!.length).toBeLessThanOrEqual(600);
});

function scrollDimensions(id: string, height: number, contentHeight: number) {
  const element = document.getElementById(id)!;
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    scrollHeight: { configurable: true, value: contentHeight },
  });
  return element;
}

it("advances the nested pane to the latest collected result boundary rather than the old first viewport", () => {
  fixture(
    `<section id="results-pane" style="overflow-y:auto">${Array.from({ length: 100 }, (_, index) => `<a href="/reel/Post${index}/">Post ${index}</a>`).join("")}</section>`,
  );
  const pane = scrollDimensions("results-pane", 500, 12000);
  for (const [index, anchor] of [...pane.querySelectorAll("a")].entries()) {
    anchor.getBoundingClientRect = () => ({
      top: index * 100,
      bottom: (index + 1) * 100,
      left: 0,
      right: 100,
      width: 100,
      height: 100,
      x: 0,
      y: index * 100,
      toJSON() {},
    });
  }
  const result = collectNativeDiscoverCards("ig", igSearch, 30, true, {
    knownUrls: Array.from(
      { length: 60 },
      (_, index) => `https://www.instagram.com/reel/Post${index}/`,
    ),
    lastUrl: "https://www.instagram.com/reel/Post59/",
  });
  expect(result.lastUrl).toBe("https://www.instagram.com/reel/Post89/");
  expect(pane.scrollTop).toBe(8950);
  expect(scrollBy).not.toHaveBeenCalled();
});

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

const igNoResults = (attrs = "") =>
  `<div ${attrs}><span>No results</span><span>We couldn’t find anything for "clone effect davinci resolve".</span></div>`;
const noResults = { status: "empty", results: [], order: [], lastUrl: null, noResults: true };

it("reports each platform's rendered No results screen without cards as a genuinely empty search", () => {
  fixture(`<nav><a href="/explore/">Explore</a></nav><main>${igNoResults()}</main>`);
  expect(collectNativeDiscoverCards("ig", igSearch, 30, true)).toEqual(noResults);
  source(ttSearch);
  fixture("<main><h2>No results found</h2><p>Try different keywords.</p></main>");
  expect(collectNativeDiscoverCards("tt", ttSearch)).toEqual(noResults);
  fixture("<main><p>Couldn't find this search</p></main>");
  expect(collectNativeDiscoverCards("tt", ttSearch)).toEqual(noResults);
  source(ytSearch);
  fixture(
    "<ytd-app><main><div>No results found</div><div>Try different keywords or remove search filters</div></main></ytd-app>",
  );
  expect(collectNativeDiscoverCards("yt", ytSearch)).toEqual(noResults);
});

it("never reads hidden, partial or in-card No results text as a No results screen", () => {
  fixture(`<main>${igNoResults('style="display:none"')}</main>`);
  expect(collectNativeDiscoverCards("ig", igSearch)).not.toHaveProperty("noResults");
  fixture(`<main>${igNoResults("hidden")}</main>`);
  expect(collectNativeDiscoverCards("ig", igSearch)).not.toHaveProperty("noResults");
  // Instagram needs both lines; "No results" alone is not its screen.
  fixture("<main><span>No results</span></main>");
  expect(collectNativeDiscoverCards("ig", igSearch)).not.toHaveProperty("noResults");
  // A link saying it is not the page saying it.
  fixture(`<main><a href="/explore/">${igNoResults()}</a></main>`);
  expect(collectNativeDiscoverCards("ig", igSearch)).not.toHaveProperty("noResults");
  // An ordinary caption saying the same words is a card.
  source(ttSearch);
  fixture(`<main>${ttCard("7000000000000000003", "no results found with this effect")}</main>`);
  const grid = collectNativeDiscoverCards("tt", ttSearch);
  expect(grid).toMatchObject({
    status: "done",
    results: [{ title: "no results found with this effect" }],
  });
  expect(grid).not.toHaveProperty("noResults");
});

it("keeps the source-error and login checks ahead of the No results screen", () => {
  source(ttSearch);
  fixture(`<main>${ttErrorSurface()}<h2>No results found</h2></main>`);
  expect(collectNativeDiscoverCards("tt", ttSearch)).toEqual({
    status: "error",
    results: [],
    error: "search-service-error",
  });
  fixture('<main><h2>No results found</h2><input type="password" /></main>');
  expect(collectNativeDiscoverCards("tt", ttSearch)).toMatchObject({
    status: "needs-attention",
    error: "login-or-challenge",
  });
});
