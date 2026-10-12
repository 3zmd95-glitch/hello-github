import type { DiscoverItem, DiscoverPlatform } from "./discover";
import type { Lang } from "./domain";
import { discoverPostKey, type DiscoverCandidate } from "./discoverFeed";

export const NATIVE_IMPORT_PREFIX = "#discover-import=";
export interface NativeImport {
  version: 1;
  platform: DiscoverPlatform;
  urls: string[];
}

/** An untrusted URL fragment carries identities only, never source claims or preferences. */
export function parseNativeImport(hash: string): NativeImport | null {
  if (!hash.startsWith(NATIVE_IMPORT_PREFIX) || hash.length > 12000) return null;
  try {
    const value = JSON.parse(decodeURIComponent(hash.slice(NATIVE_IMPORT_PREFIX.length)));
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "platform,urls,version" ||
      value.version !== 1 ||
      !["tt", "ig", "yt"].includes(value.platform) ||
      !Array.isArray(value.urls) ||
      !value.urls.length ||
      value.urls.length > 24
    )
      return null;
    const urls: string[] = [];
    for (const raw of value.urls) {
      if (typeof raw !== "string" || raw.length > 2048 || /[\u0000-\u0020\u007f]/.test(raw))
        return null;
      const url = new URL(raw);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
      const valid =
        value.platform === "tt"
          ? /^(www\.)?tiktok\.com$/.test(url.hostname) &&
            /^\/@[\w.]{1,64}\/video\/\d{15,22}\/?$/.test(url.pathname)
          : value.platform === "ig"
            ? /^(www\.)?instagram\.com$/.test(url.hostname) &&
              /^\/(p|reel|reels)\/[\w-]{1,64}\/?$/.test(url.pathname)
            : /^(www\.|m\.)?youtube\.com$/.test(url.hostname) &&
              ((/^\/watch\/?$/.test(url.pathname) &&
                url.searchParams.getAll("v").length === 1 &&
                /^[\w-]{11}$/.test(url.searchParams.get("v") ?? "")) ||
                /^\/shorts\/[\w-]{11}\/?$/.test(url.pathname));
      const key = valid ? discoverPostKey(value.platform, raw) : null;
      if (!key) return null;
      if (!urls.includes(key)) urls.push(key);
    }
    return { version: 1, platform: value.platform, urls };
  } catch {
    return null;
  }
}

/** Reuse observed evidence without copying a different category's rejection flags. */
export function nativeImportItems(
  payload: NativeImport,
  selected: readonly string[],
  genreId: string,
  current: readonly DiscoverCandidate[],
  lang: Lang,
): DiscoverItem[] {
  return payload.urls
    .filter((url) => selected.includes(url))
    .map((url) => {
      const matches = current.filter(
        (entry) =>
          entry.item.platform === payload.platform &&
          discoverPostKey(entry.item.platform, entry.item.url) === url,
      );
      const authority = (item: DiscoverItem) =>
        !item.evidence ? 0 : item.evidence.source === "indexed-excerpt" ? 1 : 2;
      const best = [...matches].sort(
        (a, b) =>
          authority(b.item) - authority(a.item) ||
          (Date.parse(b.item.evidence?.observedAt ?? "") || 0) -
            (Date.parse(a.item.evidence?.observedAt ?? "") || 0),
      )[0]?.item;
      const category = matches.find((entry) => entry.genreId === genreId)?.item;
      return best
        ? { ...best, url, offTopic: category?.offTopic, outsideCategory: category?.outsideCategory }
        : {
            platform: payload.platform,
            url,
            handle: "",
            title: { tt: "TikTok", ig: "Instagram", yt: "YouTube" }[payload.platform],
            snippet: "",
            lang,
            section: "example",
          };
    });
}
