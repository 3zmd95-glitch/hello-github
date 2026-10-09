import { Parser } from "htmlparser2";

export interface TikTokSource {
  status: "available" | "unavailable" | "unknown";
  url: string;
  observedAt: string | null;
  provenance: "tiktok-public-page";
  caption?: string;
  author?: string;
  likes?: number;
  views?: number;
  published?: string;
  thumbnailUrl?: string;
}

export function tiktokPostUrl(input: string): string | null {
  try {
    const u = new URL(input);
    if (
      u.protocol !== "https:" ||
      !["www.tiktok.com", "tiktok.com"].includes(u.hostname) ||
      u.port ||
      u.username ||
      u.password
    )
      return null;
    const match = u.pathname.match(/^\/@([\w.-]+)\/video\/(\d{15,22})\/?$/);
    return match ? `https://www.tiktok.com/@${match[1]}/video/${match[2]}` : null;
  } catch {
    return null;
  }
}
const unknown = (url: string): TikTokSource => ({
  status: "unknown",
  url,
  observedAt: null,
  provenance: "tiktok-public-page",
});
const count = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};

/** Only the public page's inert, typed video-detail JSON. No script evaluation or private API. */
export async function readTikTokSource(response: Response, input: string): Promise<TikTokSource> {
  const post = tiktokPostUrl(input);
  if (
    !post ||
    !response.ok ||
    !response.headers.get("content-type")?.includes("text/html") ||
    !response.body
  ) {
    await response.body?.cancel().catch(() => undefined);
    return unknown(post ?? "");
  }
  let active = false;
  let done = false;
  let payload = "";
  const parser = new Parser({
    onopentag(name, attrs) {
      active = name === "script" && attrs.id === "__UNIVERSAL_DATA_FOR_REHYDRATION__";
    },
    ontext(text) {
      if (active) payload += text;
    },
    onclosetag(name) {
      if (name === "script" && active) {
        done = true;
        parser.pause();
      }
    },
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (!done && bytes < 640 * 1024) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bounded = chunk.value.subarray(0, 640 * 1024 - bytes);
      bytes += bounded.byteLength;
      parser.write(decoder.decode(bounded, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (!done) return unknown(post);
  try {
    const detail = JSON.parse(payload)?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
    // This typed response was cross-checked against TikTok's visible unavailable page.
    if (detail?.statusCode === 10204)
      return { ...unknown(post), status: "unavailable", observedAt: new Date().toISOString() };
    const item = detail?.itemInfo?.itemStruct;
    if (
      detail?.statusCode !== 0 ||
      item?.id !== post.split("/").at(-1) ||
      typeof item.desc !== "string" ||
      typeof item.author?.uniqueId !== "string"
    )
      return unknown(post);
    const likes = count(item.stats?.diggCount);
    const views = count(item.stats?.playCount);
    const seconds = count(item.createTime);
    let thumbnailUrl: string | undefined;
    try {
      const cover = new URL(item.video?.cover);
      if (
        cover.protocol === "https:" &&
        cover.hostname.endsWith(".tiktokcdn.com") &&
        !cover.port &&
        !cover.username &&
        !cover.password
      )
        thumbnailUrl = cover.href;
    } catch {
      /* A missing or unrelated poster never prevents reading the post. */
    }
    const published =
      seconds && seconds > 1262304000 && seconds * 1000 <= Date.now()
        ? new Date(seconds * 1000).toISOString()
        : undefined;
    return {
      status: "available",
      url: post,
      observedAt: new Date().toISOString(),
      provenance: "tiktok-public-page",
      caption: item.desc.slice(0, 4000),
      author: item.author.uniqueId.slice(0, 200),
      ...(likes !== undefined ? { likes } : {}),
      ...(views !== undefined ? { views } : {}),
      ...(published ? { published } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    };
  } catch {
    return unknown(post);
  }
}

export async function lookupTikTokSource(
  input: string,
  doFetch: typeof fetch = fetch,
): Promise<TikTokSource> {
  const post = tiktokPostUrl(input);
  if (!post) return unknown("");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      doFetch(post, {
        redirect: "manual",
        headers: { Accept: "text/html", "User-Agent": "3z-Scout/1.0 (public link previews)" },
        signal: controller.signal,
      }).then((r) => readTikTokSource(r, post)),
      new Promise<TikTokSource>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(unknown(post));
        }, 6000);
      }),
    ]);
  } catch {
    return unknown(post);
  } finally {
    clearTimeout(timer);
  }
}
