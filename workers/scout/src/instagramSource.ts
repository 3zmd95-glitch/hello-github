import { Parser } from "htmlparser2";
import { instagramImageUrl, instagramPostUrl } from "./instagramPreview";
import { parseEngagement } from "./normalize";

const MAX_SOURCE_BYTES = 384 * 1024;
const TIMEOUT_MS = 5000;
const MAX_CAPTION_CHARS = 4000;

/** Public, post-bound visible metadata. Neither audio playback nor video frames were inspected. */
export interface InstagramSource {
  status: "available" | "unavailable";
  url: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  author: string;
  observedAt: string | null;
  provenance: "instagram-public-embed";
  audio?: { title: string; artist?: string; url?: string };
  /** Only the exact post's visible SocialProof, never a number in its caption. */
  likes?: number;
}

function unavailable(url: string): InstagramSource {
  return {
    status: "unavailable",
    url,
    title: "",
    description: "",
    thumbnailUrl: "",
    author: "",
    observedAt: null,
    provenance: "instagram-public-embed",
  };
}

function audioUrl(input: string | undefined): string | undefined {
  if (!input) return;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !["www.instagram.com", "instagram.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return;
    const id = url.pathname.match(/^\/reels\/audio\/(\d+)\/?$/)?.[1];
    if (id) return `https://www.instagram.com/reels/audio/${id}/`;
  } catch {
    /* Untrusted link is not evidence. */
  }
}

function authorName(input: string | undefined): string | undefined {
  if (!input) return;
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !["www.instagram.com", "instagram.com"].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return;
    return url.pathname.match(/^\/([\w.]+)\/?$/)?.[1];
  } catch {
    return;
  }
}

interface Element {
  classes: Set<string>;
  ignored: boolean;
  mediaPost: string | null;
}

/** Parse inert visible embed markup only. Scripts and their application payload are never parsed. */
export async function readInstagramSource(res: Response, post: string): Promise<InstagramSource> {
  const empty = unavailable(post);
  if (!res.ok || !res.headers.get("content-type")?.includes("text/html") || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    return empty;
  }
  const stack: Element[] = [];
  let rootDepth = 0;
  let completed = false;
  let mediaPost: string | null = null;
  let conflictingPost = false;
  let thumbnailUrl = "";
  let author = "";
  let description = "";
  let audioLabel = "";
  let musicUrl: string | undefined;
  let socialProof = "";
  const has = (name: string) => stack.some((element) => element.classes.has(name));
  const parser = new Parser({
    onopentag(name, attrs) {
      if (completed) return;
      const classes = new Set((attrs.class ?? "").split(/\s+/));
      const ignored =
        stack.at(-1)?.ignored === true ||
        ["script", "style", "noscript", "template"].includes(name) ||
        attrs.hidden !== undefined ||
        attrs["aria-hidden"] === "true" ||
        /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style ?? "");
      const currentPost = name === "a" ? instagramPostUrl(attrs.href ?? "") : null;
      stack.push({ classes, ignored, mediaPost: currentPost });
      if (ignored) return;
      if (classes.has("Embed") && !rootDepth) rootDepth = stack.length;
      if (!rootDepth) return;
      if (name === "a" && classes.has("EmbeddedMedia")) {
        if (currentPost !== post || (mediaPost && mediaPost !== currentPost))
          conflictingPost = true;
        mediaPost = currentPost;
      }
      if (
        name === "img" &&
        classes.has("EmbeddedMediaImage") &&
        stack.some((element) => element.mediaPost === post)
      ) {
        thumbnailUrl = instagramImageUrl(attrs.src) ?? "";
      }
      if (name === "a" && classes.has("Username")) author = authorName(attrs.href) ?? "";
      if (name === "a" && has("HeaderSecondaryContent"))
        musicUrl = audioUrl(attrs.href) ?? musicUrl;
      if (name === "br" && has("Caption") && description.length < MAX_CAPTION_CHARS) {
        description += "\n";
      }
    },
    ontext(value) {
      if (completed || !rootDepth || stack.at(-1)?.ignored) return;
      if (has("Caption") && !has("CaptionUsername") && !has("CaptionCommentsExpand")) {
        description += value.slice(0, Math.max(0, MAX_CAPTION_CHARS - description.length));
      }
      if (has("HeaderSecondaryContent")) {
        audioLabel += value.slice(0, Math.max(0, 500 - audioLabel.length));
      }
      if (has("SocialProof") && stack.some((element) => element.mediaPost === post)) {
        socialProof += value.slice(0, Math.max(0, 200 - socialProof.length));
      }
    },
    onclosetag() {
      if (completed) return;
      if (rootDepth && stack.length === rootDepth) {
        completed = true;
        parser.pause();
      }
      stack.pop();
    },
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  try {
    while (!completed && bytes < MAX_SOURCE_BYTES) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value.subarray(0, MAX_SOURCE_BYTES - bytes);
      bytes += chunk.byteLength;
      parser.write(decoder.decode(chunk, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (!completed || conflictingPost || mediaPost !== post) return empty;
  description = description.trim();
  audioLabel = audioLabel.replace(/\s+/g, " ").trim();
  if (!description && !thumbnailUrl && !audioLabel) return empty;
  const separator = audioLabel.indexOf(" · ");
  const audio = audioLabel
    ? {
        title: separator > 0 ? audioLabel.slice(separator + 3).trim() : audioLabel,
        ...(separator > 0 ? { artist: audioLabel.slice(0, separator).trim() } : {}),
        ...(musicUrl ? { url: musicUrl } : {}),
      }
    : undefined;
  const likes = parseEngagement(socialProof.trim())?.likes;
  return {
    status: "available",
    url: post,
    title: description.slice(0, 160),
    description,
    thumbnailUrl,
    author,
    observedAt: new Date().toISOString(),
    provenance: "instagram-public-embed",
    ...(audio?.title ? { audio } : {}),
    ...(likes !== undefined ? { likes } : {}),
  };
}

/** Fixed public endpoint, no cookies, private APIs, caller headers, redirects, or search snippets. */
export async function lookupInstagramSource(
  input: string,
  doFetch: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<InstagramSource> {
  const post = instagramPostUrl(input);
  if (!post) return unavailable("");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) return unavailable(post);
  signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      doFetch(`${post}embed/captioned/`, {
        headers: { Accept: "text/html", "User-Agent": "3z-Scout/1.0 (public link previews)" },
        redirect: "manual",
        signal: controller.signal,
      }).then((res) => readInstagramSource(res, post)),
      new Promise<InstagramSource>((resolve) => {
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
