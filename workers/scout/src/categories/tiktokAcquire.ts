import { isRecord } from "../effects/ai";
import type { TikTokAdsEnv } from "../tiktokads";
import { readLimited } from "./tiktokProbe";
import { tiktokTop, TT_TRENDING_URL, TT_VIDEOS_URL } from "./tiktok";

/** Explicit native-only retrieval. No search provider, AI, cron, persistent write or retry. */
export async function acquireTikTok(
  req: Request,
  env: TikTokAdsEnv,
  categoryId: string,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
) {
  const controller = new AbortController();
  const base = () => ({
    version: 1,
    categoryId,
    country: "US",
    dateRange: "7DAY",
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
    items: [],
    captioned: 0,
  });
  let interrupt: (status: "cancelled" | "timeout") => void = () => undefined;
  const stopped = new Promise<ReturnType<typeof base> & { status: string }>((resolve) => {
    interrupt = (status) => {
      resolve({ ...base(), status });
      controller.abort();
    };
  });
  const cancel = () => interrupt("cancelled");
  if (req.signal.aborted) return { ...base(), status: "cancelled" };
  req.signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => interrupt("timeout"), 28_000);
  let requests = 0;
  const nativeFetch: typeof fetch = async (input, init) => {
    if (controller.signal.aborted || ++requests > 16) throw new Error("stopped");
    const url = new URL(String(input));
    const endpoint = url.origin + url.pathname;
    if (![TT_TRENDING_URL, TT_VIDEOS_URL, "https://www.tiktok.com/oembed"].includes(endpoint))
      throw new Error("unexpected endpoint");
    const headers = new Headers(init?.headers);
    if (endpoint === "https://www.tiktok.com/oembed") headers.delete("Access-Token");
    const signal = AbortSignal.any([controller.signal, ...(init?.signal ? [init.signal] : [])]);
    const requestInit = {
      ...init,
      method: "GET",
      headers,
      signal,
      redirect: "manual" as const,
      credentials: "omit" as const,
    };
    const response = await (deps.fetch ?? fetch)(input, requestInit);
    if (signal.aborted || !response.ok) {
      void response.body?.cancel().catch(() => undefined);
      if (signal.aborted) throw new Error("stopped");
      return new Response(null, { status: response.status });
    }
    const text = await readLimited(response, 1024 * 1024, signal);
    return new Response(text, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  const run = async () => {
    try {
      const text = (await readLimited(req, 256, controller.signal)).trim();
      if (text) {
        const body: unknown = JSON.parse(text);
        if (!isRecord(body) || Object.keys(body).length) return null;
      }
    } catch {
      return null;
    }
    const found = await tiktokTop(
      { ...env, TIKTOK_DISCOVERY_COUNTRY: "US" },
      nativeFetch,
      categoryId,
      6_000,
      null,
    );
    if (controller.signal.aborted) return { ...base(), status: "cancelled" };
    if (found.note)
      return { ...base(), status: found.note === "tiktok_auth" ? "not_connected" : "upstream" };
    return {
      ...base(),
      status: "accepted",
      captioned: typeof found.diagnostics?.captioned === "number" ? found.diagnostics.captioned : 0,
      items: (found.candidates ?? []).slice(0, 12).map((video) => ({
        platform: "tt",
        handle: video.creator ?? "",
        url: video.url,
        title: video.title,
        snippet: video.snippet ?? "",
        section: "example",
        lang: /[\u0600-\u06ff]/.test(video.title) ? "ar" : "en",
        ...(video.thumbnail ? { thumb: video.thumbnail } : {}),
        // Hashtag membership/rank is never copied into caption, engagement or popularity evidence.
        // The client source-reader must ground these leads before recommending them.
      })),
    };
  };
  try {
    return await Promise.race([run(), stopped]);
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", cancel);
    controller.abort();
  }
}
