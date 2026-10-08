import { Parser } from "htmlparser2";
import { instagramImageUrl, instagramPostUrl } from "./instagramPreview";

const MAX_EMBED_BYTES = 384 * 1024;
const TIMEOUT_MS = 5000;

export type InstagramMedia =
  | {
      status: "available";
      sourceUrl: string;
      observedAt: string;
      provenance: "instagram-public-embed-context";
      video: { url: string; durationSeconds: number; width: number; height: number };
    }
  | {
      status: "unavailable";
      sourceUrl: string;
      observedAt: null;
      provenance: "instagram-public-embed-context";
    };

function unavailable(sourceUrl: string): InstagramMedia {
  return {
    status: "unavailable",
    sourceUrl,
    observedAt: null,
    provenance: "instagram-public-embed-context",
  };
}

/** Decode only the public embed's JSON string, never its surrounding JavaScript. */
function contextMedia(
  script: string,
  shortcode: string,
): {
  url: string;
  durationSeconds: number;
  width: number;
  height: number;
} | null {
  const literals = [...script.matchAll(/"contextJSON"\s*:\s*("(?:[^"\\]|\\.)*")/g)];
  if (literals.length !== 1) return null;
  try {
    const value = JSON.parse(JSON.parse(literals[0][1]));
    const context = value?.context;
    const media = value?.gql_data?.shortcode_media;
    if (
      context?.shortcode !== shortcode ||
      context?.type !== "GraphVideo" ||
      context.copyright_blocked === true ||
      media?.shortcode !== shortcode ||
      media?.__typename !== "GraphVideo" ||
      media.is_video !== true
    )
      return null;
    const url =
      typeof media.video_url === "string" ? instagramImageUrl(media.video_url) : undefined;
    const durationSeconds = media.video_duration;
    const width = media.dimensions?.width;
    const height = media.dimensions?.height;
    if (
      !url ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isInteger(width) ||
      width <= 0 ||
      width > 8192 ||
      !Number.isInteger(height) ||
      height <= 0 ||
      height > 8192
    )
      return null;
    return { url, durationSeconds, width, height };
  } catch {
    return null;
  }
}

/** The public embed identifies the post twice; unrelated, blocked, or incomplete payloads fail closed. */
export async function readInstagramMedia(
  res: Response,
  sourceUrl: string,
): Promise<InstagramMedia> {
  const empty = unavailable(sourceUrl);
  const shortcode = sourceUrl.match(/\/p\/([\w-]+)\/$/)?.[1];
  if (
    !shortcode ||
    !res.ok ||
    !res.headers.get("content-type")?.includes("text/html") ||
    !res.body
  ) {
    await res.body?.cancel().catch(() => undefined);
    return empty;
  }
  let inScript = false;
  let script = "";
  let video: { url: string; durationSeconds: number; width: number; height: number } | null = null;
  let found = false;
  const parser = new Parser({
    onopentag(name) {
      if (name === "script") {
        inScript = true;
        script = "";
      }
    },
    ontext(text) {
      if (inScript) script += text;
    },
    onclosetag(name) {
      if (name !== "script" || !inScript) return;
      inScript = false;
      if (!script.includes('"contextJSON"')) return;
      video = contextMedia(script, shortcode);
      found = true;
      parser.pause();
    },
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (!found && bytes < MAX_EMBED_BYTES) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value.subarray(0, MAX_EMBED_BYTES - bytes);
      bytes += chunk.byteLength;
      parser.write(decoder.decode(chunk, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (!video) return empty;
  return {
    status: "available",
    sourceUrl,
    observedAt: new Date().toISOString(),
    provenance: "instagram-public-embed-context",
    video,
  };
}

/** An explicit verification step; normal image cards do not fetch this larger public embed. */
export async function lookupInstagramMedia(
  input: string,
  doFetch: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<InstagramMedia> {
  const post = instagramPostUrl(input);
  if (!post || signal?.aborted) return unavailable(post ?? "");
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      doFetch(`${post}embed/captioned/`, {
        headers: { Accept: "text/html", "User-Agent": "3z-Scout/1.0 (public link previews)" },
        redirect: "manual",
        signal: controller.signal,
      }).then((response) => readInstagramMedia(response, post)),
      new Promise<InstagramMedia>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(unavailable(post));
        }, TIMEOUT_MS);
      }),
    ]);
  } catch {
    return unavailable(post);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
