export const NATIVE_ORIGINS = [
  "https://www.instagram.com/*",
  "https://www.tiktok.com/*",
  "https://www.youtube.com/*",
];

export function trustedDiscoverSender(sender) {
  if (!Number.isInteger(sender?.tab?.id) || sender.tab.id < 0) return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;
  try {
    const url = new URL(sender.url);
    return (
      url.origin === "http://localhost:3000" &&
      url.pathname === "/discover/" &&
      !url.username &&
      !url.password &&
      (sender.origin === undefined || sender.origin === url.origin)
    );
  } catch {
    return false;
  }
}

const plainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);

export function parseNativeRequest(value) {
  if (!plainObject(value) || value.version !== 1) return null;
  const keys = Object.keys(value).sort().join(",");
  if (value.type === "status")
    return keys === "type,version" ? { version: 1, type: "status" } : null;
  if (["poll", "cancel", "more"].includes(value.type)) {
    return keys === "jobId,type,version" && identifier(value.jobId)
      ? { version: 1, type: value.type, jobId: value.jobId }
      : null;
  }
  if (
    value.type !== "search" ||
    keys !== "queries,requestId,type,version" ||
    !identifier(value.requestId) ||
    !plainObject(value.queries)
  )
    return null;
  const queries = Object.entries(value.queries);
  if (!queries.length || queries.length > 3) return null;
  if (
    queries.some(
      ([key, query]) =>
        !["ig", "tt", "yt"].includes(key) ||
        typeof query !== "string" ||
        !query.trim() ||
        query.length > 120 ||
        /[\u0000-\u001f\u007f]/.test(query),
    )
  )
    return null;
  return {
    version: 1,
    type: "search",
    requestId: value.requestId,
    queries: Object.fromEntries(queries.map(([key, query]) => [key, query.trim()])),
  };
}

export function nativeSearchUrl(platform, query) {
  const encoded = encodeURIComponent(query);
  if (platform === "ig") return `https://www.instagram.com/explore/search/keyword/?q=${encoded}`;
  if (platform === "tt") return `https://www.tiktok.com/search?q=${encoded}`;
  if (platform === "yt") return `https://www.youtube.com/results?search_query=${encoded}`;
  throw new Error("unsupported-platform");
}

export function sameNativeSearchPage(platform, current, expected) {
  try {
    const url = new URL(current);
    const target = new URL(expected);
    const host = { ig: "www.instagram.com", tt: "www.tiktok.com", yt: "www.youtube.com" }[platform];
    const path = { ig: "/explore/search/keyword", tt: "/search", yt: "/results" }[platform];
    const key = platform === "yt" ? "search_query" : "q";
    return (
      url.protocol === "https:" &&
      url.hostname === host &&
      !url.port &&
      !url.username &&
      !url.password &&
      target.origin === url.origin &&
      target.pathname.replace(/\/$/, "") === path &&
      url.pathname.replace(/\/$/, "") === path &&
      url.searchParams.getAll(key).length === 1 &&
      target.searchParams.getAll(key).length === 1 &&
      url.searchParams.get(key) === target.searchParams.get(key)
    );
  } catch {
    return false;
  }
}

export function canonicalNativePost(platform, href) {
  if (typeof href !== "string" || href.length > 2048 || /[\u0000-\u0020\u007f]/.test(href))
    return null;
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const hosts = { ig: "www.instagram.com", tt: "www.tiktok.com", yt: "www.youtube.com" };
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

export function sanitizeNativeResults(platform, results, observedAt) {
  if (!Array.isArray(results)) return [];
  const seen = new Set();
  const clean = [];
  for (const result of results.slice(0, 600)) {
    const url = canonicalNativePost(platform, result?.url);
    const key = nativePostIdentity(platform, url);
    if (!url || seen.has(key)) continue;
    seen.add(key);
    const text = (value, limit) =>
      typeof value === "string"
        ? value
            .replace(/[\u0000-\u001f\u007f]/g, " ")
            .trim()
            .slice(0, limit)
        : "";
    const item = {
      platform,
      url,
      title: text(result.title, 400),
      position: clean.length + 1,
      observedAt,
    };
    const handle = text(result.handle, 80);
    const stats = text(result.displayedStats, 200);
    if (handle) item.handle = handle;
    if (stats) item.displayedStats = stats;
    try {
      const thumb = new URL(result.thumb);
      // Only already-rendered HTTPS image URLs; never blob/video/data URLs or credentials.
      if (
        thumb.protocol === "https:" &&
        !thumb.username &&
        !thumb.password &&
        !thumb.port &&
        thumb.href.length <= 4096
      )
        item.thumb = thumb.href;
    } catch {
      /* A card can have no thumbnail. */
    }
    clean.push(item);
    if (clean.length === 300) break;
  }
  return clean;
}

export function nativePostIdentity(platform, href) {
  const canonical = canonicalNativePost(platform, href);
  if (!canonical) return null;
  const url = new URL(canonical);
  return `${platform}:${platform === "yt" && url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.split("/").filter(Boolean).at(-1)}`;
}
