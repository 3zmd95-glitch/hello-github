/**
 * Self-contained for chrome.scripting.executeScript's isolated world.
 * Reads only the current URL, visible anchor hrefs and visibility information.
 * Keep helpers inside this function: Chrome serializes the function alone.
 */
export function collectVisibleDiscoverLinks() {
  const hosts = {
    tt: ["tiktok.com", "www.tiktok.com"],
    ig: ["instagram.com", "www.instagram.com"],
    yt: ["youtube.com", "www.youtube.com", "m.youtube.com"],
  };
  const source = new URL(window.location.href);
  const platform = Object.keys(hosts).find((key) => hosts[key].includes(source.hostname));
  const safeOrigin = (url) =>
    url.protocol === "https:" && !url.username && !url.password && !url.port;
  const allowedPage =
    platform === "tt"
      ? /^\/search\/?$/.test(source.pathname)
      : platform === "ig"
        ? /^\/explore\/(?:search\/keyword|tags\/[^/]+)\/?$/.test(source.pathname)
        : platform === "yt" && /^\/results\/?$/.test(source.pathname);

  if (!safeOrigin(source) || !platform || !allowedPage) {
    return { error: "unsupported-page", urls: [] };
  }

  function canonicalUrl(href) {
    if (!href || /[\u0000-\u0020\u007f]/.test(href)) return null;
    let url;
    try {
      url = new URL(href, source.href);
    } catch {
      return null;
    }
    if (!safeOrigin(url) || !hosts[platform].includes(url.hostname)) return null;
    if (platform === "tt") {
      const match = url.pathname.match(/^\/@([A-Za-z0-9_.]{1,64})\/video\/(\d{15,22})\/?$/);
      return match ? `https://www.tiktok.com/@${match[1]}/video/${match[2]}` : null;
    }
    if (platform === "ig") {
      const match = url.pathname.match(/^\/(?:p|reel|reels)\/([A-Za-z0-9_-]{1,64})\/?$/);
      return match ? `https://www.instagram.com/p/${match[1]}` : null;
    }
    const shorts = url.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})\/?$/);
    const watchId =
      /^\/watch\/?$/.test(url.pathname) && url.searchParams.getAll("v").length === 1
        ? url.searchParams.get("v")
        : null;
    const id = shorts ? shorts[1] : watchId;
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }

  function isVisible(anchor) {
    if (
      anchor.checkVisibility &&
      !anchor.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    ) {
      return false;
    }
    const clips = [];
    for (let node = anchor; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (
        node.hidden ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden" ||
        Number(style.opacity || 1) === 0
      )
        return false;
      if (
        node !== anchor &&
        /(hidden|clip|scroll|auto)/.test(`${style.overflowX} ${style.overflowY} ${style.overflow}`)
      ) {
        clips.push({ rect: node.getBoundingClientRect(), style });
      }
    }
    for (const rect of anchor.getClientRects()) {
      let left = Math.max(0, rect.left);
      let top = Math.max(0, rect.top);
      let right = Math.min(window.innerWidth, rect.right);
      let bottom = Math.min(window.innerHeight, rect.bottom);
      for (const clip of clips) {
        if (/(hidden|clip|scroll|auto)/.test(clip.style.overflowX || clip.style.overflow)) {
          left = Math.max(left, clip.rect.left);
          right = Math.min(right, clip.rect.right);
        }
        if (/(hidden|clip|scroll|auto)/.test(clip.style.overflowY || clip.style.overflow)) {
          top = Math.max(top, clip.rect.top);
          bottom = Math.min(bottom, clip.rect.bottom);
        }
      }
      if (right <= left || bottom <= top) continue;
      // Hit testing excludes results covered by dialogs or overlays.
      if (!document.elementFromPoint) return true;
      for (const [x, y] of [
        [0.5, 0.5],
        [0.1, 0.1],
        [0.9, 0.1],
        [0.1, 0.9],
        [0.9, 0.9],
      ]) {
        const hit = document.elementFromPoint(left + (right - left) * x, top + (bottom - top) * y);
        if (hit && anchor.contains(hit)) return true;
      }
    }
    return false;
  }

  const urls = new Set();
  for (const anchor of document.querySelectorAll("a[href]")) {
    const url = canonicalUrl(anchor.getAttribute("href"));
    if (url && !urls.has(url) && isVisible(anchor)) urls.add(url);
    if (urls.size === 24) break;
  }
  return { version: 1, platform, urls: [...urls] };
}
