import { Parser } from "htmlparser2";

const MAX_HEAD_BYTES = 128 * 1024;
const TIMEOUT_MS = 5000;
const PREVIEW_TTL_S = 3600;
const MISSING_TTL_S = 300;

/** Only public post URLs; fetch a fixed host, never a caller-supplied origin or redirect. */
export function instagramPostUrl(input: string): string | null {
  try {
    const u = new URL(input);
    if (
      !["https:", "http:"].includes(u.protocol) ||
      !["instagram.com", "www.instagram.com", "m.instagram.com"].includes(u.hostname) ||
      u.username ||
      u.password ||
      u.port
    )
      return null;
    const id = u.pathname.match(/^\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([\w-]+)\/?$/)?.[1];
    if (!id || id === "audio") return null;
    return `https://www.instagram.com/p/${id}/`;
  } catch {
    return null;
  }
}

function imageUrl(input: string | undefined): string | undefined {
  if (!input) return;
  try {
    const u = new URL(input);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return;
    if (!["cdninstagram.com", "fbcdn.net"].some((host) => u.hostname.endsWith(`.${host}`))) return;
    return u.href;
  } catch {
    return;
  }
}

/** Read only bounded public Open Graph metadata. No scripts, cookies, login, or private API. */
export async function readInstagramPreview(res: Response, post: string): Promise<string> {
  if (!res.ok || !res.headers.get("content-type")?.includes("text/html") || !res.body) {
    await res.body?.cancel();
    return "";
  }
  let canonical: string | null = null;
  let thumb: string | undefined;
  let done = false;
  const parser = new Parser({
    onopentag(name, attrs) {
      if (done) return;
      if (name === "body") done = true;
      if (name !== "meta") return;
      if (attrs.property === "og:url") canonical = instagramPostUrl(attrs.content ?? "");
      if (attrs.property === "og:image") thumb = imageUrl(attrs.content);
      if (canonical && thumb) {
        done = true;
        parser.pause();
      }
    },
    onclosetag(name) {
      if (name === "head") done = true;
    },
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (!done && bytes < MAX_HEAD_BYTES) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value.subarray(0, MAX_HEAD_BYTES - bytes);
      bytes += chunk.byteLength;
      parser.write(decoder.decode(chunk, { stream: true }));
    }
  } finally {
    // Never download the rest of Instagram's large application payload for a card preview.
    await reader.cancel().catch(() => undefined);
  }
  return canonical === post ? (thumb ?? "") : "";
}

/** Independent of search: no Tavily credits and no extra work on the search's CPU budget. */
export async function lookupInstagramPreview(
  post: string,
  doFetch: typeof fetch,
  cache: Cache | null,
  // A Worker's ExecutionContext, by shape: the local server (scripts/local-ai) imports this file too.
  ctx?: { waitUntil(promise: Promise<unknown>): void },
) {
  const key = new Request(
    `https://www.instagram.com/__scout_preview_v1/${encodeURIComponent(post)}`,
  );
  const hit = await cache?.match(key).catch(() => undefined);
  if (hit) {
    try {
      const data = (await hit.json()) as {
        title: string;
        author: string;
        thumb: string;
        url: string;
      };
      if (data.url === post && (data.thumb === "" || imageUrl(data.thumb))) {
        return { ok: true as const, data, body: JSON.stringify(data) };
      }
    } catch {
      /* A broken cache entry is replaced. */
    }
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let thumb = "";
  try {
    thumb = await Promise.race([
      doFetch(post, {
        headers: { Accept: "text/html", "User-Agent": "3z-Scout/1.0 (public link previews)" },
        redirect: "manual",
        signal: controller.signal,
      }).then((res) => readInstagramPreview(res, post)),
      new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve("");
        }, TIMEOUT_MS);
      }),
    ]);
  } catch {
    /* Private, removed, blocked, and unavailable posts keep the card's fallback. */
  } finally {
    clearTimeout(timer);
  }
  const data = { title: "", author: "", thumb, url: post };
  const body = JSON.stringify(data);
  if (cache) {
    const put = cache
      .put(
        key,
        new Response(body, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${thumb ? PREVIEW_TTL_S : MISSING_TTL_S}`,
          },
        }),
      )
      .catch(() => undefined);
    if (ctx) ctx.waitUntil(put);
    else await put;
  }
  return { ok: true as const, data, body };
}
