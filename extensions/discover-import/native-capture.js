/** Self-contained: Chrome serializes this function into an isolated world.
 * Reads rendered public cards only. Never reads script JSON, hidden application
 * state, cookies, video sources, screenshots, or the account's other tabs.
 */
export function collectNativeDiscoverCards(platform, expectedUrl, limit = 30, scrollOnce = false) {
  const source = new URL(window.location.href);
  const hosts = { ig: "www.instagram.com", tt: "www.tiktok.com", yt: "www.youtube.com" };
  let expected;
  try {
    expected = new URL(expectedUrl);
  } catch {
    return { status: "error", results: [], error: "unsupported-page" };
  }
  const searchKey = platform === "yt" ? "search_query" : "q";
  const searchPath = { ig: "/explore/search/keyword", tt: "/search", yt: "/results" }[platform];
  if (
    source.protocol !== "https:" ||
    source.hostname !== hosts[platform] ||
    source.username ||
    source.password ||
    source.port ||
    source.origin !== expected.origin ||
    source.pathname.replace(/\/$/, "") !== searchPath ||
    expected.pathname.replace(/\/$/, "") !== searchPath ||
    source.searchParams.getAll(searchKey).length !== 1 ||
    expected.searchParams.getAll(searchKey).length !== 1 ||
    source.searchParams.get(searchKey) !== expected.searchParams.get(searchKey)
  )
    return { status: "needs-attention", results: [], error: "search-page-changed" };

  const cap = Math.max(1, Math.min(90, Number(limit) || 30));
  function rendered(node, includeAriaHidden = false) {
    if (!node || ![...node.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0))
      return false;
    for (let element = node; element; element = element.parentElement) {
      const style = window.getComputedStyle(element);
      if (
        element.hidden ||
        (!includeAriaHidden && element.getAttribute("aria-hidden") === "true") ||
        style.display === "none" ||
        ["hidden", "collapse"].includes(style.visibility) ||
        style.contentVisibility === "hidden" ||
        Number(style.opacity || 1) === 0
      )
        return false;
    }
    return true;
  }
  // Authentication/challenge surfaces require the user's attention; never act on them.
  if (
    [
      ...document.querySelectorAll(
        'input[type="password"], iframe[src*="captcha"], [data-e2e="captcha"]',
      ),
    ].some((node) => rendered(node))
  )
    return { status: "needs-attention", results: [], error: "login-or-challenge" };

  function canonical(href) {
    if (!href || /[\u0000-\u0020\u007f]/.test(href)) return null;
    let url;
    try {
      url = new URL(href, source.href);
    } catch {
      return null;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== hosts[platform] ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    if (platform === "ig") {
      const match = url.pathname.match(/^\/(p|reel|reels)\/([A-Za-z0-9_-]{1,64})\/?$/);
      return match
        ? `https://www.instagram.com/${match[1] === "p" ? "p" : "reel"}/${match[2]}/`
        : null;
    }
    if (platform === "tt") {
      const match = url.pathname.match(/^\/@([A-Za-z0-9_.]{1,64})\/video\/(\d{15,22})\/?$/);
      return match ? `https://www.tiktok.com/@${match[1]}/video/${match[2]}` : null;
    }
    const shorts = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/);
    if (shorts) return `https://www.youtube.com/shorts/${shorts[1]}`;
    const id =
      url.pathname === "/watch" &&
      url.searchParams.getAll("v").length === 1 &&
      url.searchParams.get("v");
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  function renderedText(node) {
    if (!rendered(node)) return "";
    // Walking rendered text excludes hidden descendants, even on sites using
    // hidden accessibility copies. No whole-page text is collected.
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    const parts = [];
    let next;
    while ((next = walker.nextNode()) && parts.join(" ").length < 800) {
      if (
        next.parentElement &&
        !["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(next.parentElement.tagName) &&
        rendered(next.parentElement)
      )
        parts.push(next.textContent || "");
    }
    return parts.join(" ").replace(/\s+/g, " ").trim();
  }
  const results = [];
  const seen = new Set();
  const observedAt = new Date().toISOString();
  let scrollTarget = null;
  function nearestScrollPane(anchor) {
    for (let node = anchor.parentElement; node; node = node.parentElement) {
      if (node === document.scrollingElement || node === document.documentElement) break;
      const style = window.getComputedStyle(node);
      const overflow = style.overflowY || style.overflow;
      if (
        /^(auto|scroll|overlay)$/.test(overflow) &&
        node.clientHeight > 0 &&
        node.scrollHeight > node.clientHeight + 1 &&
        rendered(node, true)
      )
        return node;
    }
    return null;
  }
  for (const anchor of document.querySelectorAll("a[href]")) {
    const url = canonical(anchor.getAttribute("href"));
    if (!url || seen.has(url) || !rendered(anchor)) continue;
    if (scrollOnce && !scrollTarget) scrollTarget = nearestScrollPane(anchor);
    const selector =
      platform === "yt"
        ? "ytd-video-renderer,ytd-reel-item-renderer,ytm-shorts-lockup-view-model,ytd-rich-item-renderer"
        : platform === "tt"
          ? '[data-e2e="search_top-item"],[data-e2e="search_video-item"],[data-e2e="search-common-link"],article'
          : "article";
    // A generic grid parent may contain many posts or account UI. Only use a
    // known card container when it contains exactly this distinct post.
    let card = anchor.closest(selector) || anchor;
    const links = new Set(
      [...card.querySelectorAll("a[href]")]
        .map((link) => canonical(link.getAttribute("href")))
        .filter(Boolean),
    );
    if (links.size > 1) card = anchor;
    // YouTube hides duplicate thumbnail links from assistive technology while
    // keeping their images visible. Accept those images only inside this
    // validated public-post card; CSS-hidden content remains excluded.
    // Prefer the matching post's thumbnail over an earlier creator avatar.
    const postImages = [...card.querySelectorAll("a[href]")]
      .filter((link) => canonical(link.getAttribute("href")) === url)
      .flatMap((link) => [...link.querySelectorAll("img")]);
    const image = [...new Set([...postImages, ...card.querySelectorAll("img")])].find((node) =>
      rendered(node, true),
    );
    const video = [...card.querySelectorAll("video[poster]")].find((node) => rendered(node));
    const titleNode = card.querySelector(
      '[id="video-title"],h3,[data-e2e="search-card-video-caption"],[data-e2e="video-desc"]',
    );
    const title = (
      renderedText(titleNode) ||
      renderedText(anchor) ||
      image?.getAttribute("alt") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);
    const item = { platform, url, title, position: results.length + 1, observedAt };
    const thumbValue =
      image?.currentSrc || image?.getAttribute("src") || video?.getAttribute("poster");
    if (thumbValue) {
      try {
        const thumb = new URL(thumbValue, source.href);
        if (
          thumb.protocol === "https:" &&
          !thumb.username &&
          !thumb.password &&
          !thumb.port &&
          thumb.href.length <= 4096
        )
          item.thumb = thumb.href;
      } catch {
        /* Missing/invalid thumbnails do not remove the public card. */
      }
    }
    if (platform === "tt") item.handle = `@${new URL(url).pathname.split("/")[1].slice(1)}`;
    const author = card.querySelector('[data-e2e="search-card-user-unique-id"],ytd-channel-name');
    const handle = renderedText(author).slice(0, 80);
    if (handle) item.handle = handle;
    const stats = card.querySelector(
      '[data-e2e="video-views"],[data-e2e="search-card-like-container"],#metadata-line',
    );
    const displayedStats = renderedText(stats).slice(0, 200);
    if (displayedStats) item.displayedStats = displayedStats;
    seen.add(url);
    results.push(item);
    if (results.length >= cap) break;
  }
  // Only explicit More scrolls. Search results can live inside an app-owned
  // scroll pane rather than the document. Move one viewport-sized step on the
  // nearest visible scrollable ancestor of a validated public result, once.
  if (scrollOnce) {
    if (scrollTarget) scrollTarget.scrollTop += Math.min(scrollTarget.clientHeight * 0.9, 1000);
    else
      window.scrollBy({
        top: Math.max(1, Math.min(window.innerHeight * 0.9, 1000)),
        behavior: "instant",
      });
  }
  return { status: results.length ? "done" : "empty", results };
}
