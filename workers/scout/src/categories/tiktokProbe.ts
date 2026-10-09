import { isRecord } from "../effects/ai";
import { readAdsToken, type TikTokAdsEnv } from "../tiktokads";
import { TIKTOK_INDUSTRY, TT_TRENDING_URL } from "./tiktok";

const MAX_BYTES = 1024 * 1024;
const TIMEOUT_MS = 6000;

export interface TikTokProbeResult {
  version: 1;
  categoryId: string;
  country: "US";
  dateRange: "7DAY";
  discoveryType: "HASHTAG";
  stage: "grant" | "trending_list";
  status:
    | "accepted"
    | "not_connected"
    | "auth"
    | "permission"
    | "quota"
    | "upstream"
    | "malformed"
    | "network"
    | "timeout"
    | "cancelled";
  checkedAt: string;
  requests: 0 | 1;
  hashtagCount?: number;
  httpStatus?: number;
  providerCode?: number;
}

/** Bounded text, including streamed bodies that omit or understate Content-Length. */
async function readLimited(
  message: Request | Response,
  limit: number,
  signal: AbortSignal,
): Promise<string> {
  if (Number(message.headers.get("Content-Length")) > limit) {
    await message.body?.cancel().catch(() => undefined);
    throw new Error("oversize");
  }
  const reader = message.body?.getReader();
  if (!reader) return "";
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      if (signal.aborted) throw new Error("cancelled");
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new Error("oversize");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
  }
}

/** One explicit capability check, not candidate acquisition. null means an invalid request body.
 * The six-second deadline covers the grant read, response headers and body. No writes, fallback, retries,
 * provider messages, advertiser IDs, hashtag names or credentials leave this function. */
export async function probeTikTokAccess(
  req: Request,
  env: TikTokAdsEnv,
  categoryId: string,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<TikTokProbeResult | null> {
  let stage: TikTokProbeResult["stage"] = "grant";
  let requests: 0 | 1 = 0;
  const result = (
    status: TikTokProbeResult["status"],
    extra: Pick<TikTokProbeResult, "hashtagCount" | "httpStatus" | "providerCode"> = {},
  ): TikTokProbeResult => ({
    version: 1,
    categoryId,
    country: "US",
    dateRange: "7DAY",
    discoveryType: "HASHTAG",
    stage,
    status,
    checkedAt: (deps.now?.() ?? new Date()).toISOString(),
    requests,
    ...extra,
  });
  if (req.signal.aborted) return result("cancelled");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (status: "cancelled" | "timeout") => void = () => undefined;
  const interrupted = new Promise<TikTokProbeResult>((resolve) => {
    stop = (status) => {
      resolve(result(status));
      controller.abort();
    };
    timer = setTimeout(() => stop("timeout"), TIMEOUT_MS);
  });
  const cancel = () => stop("cancelled");
  req.signal.addEventListener("abort", cancel, { once: true });
  const run = async (): Promise<TikTokProbeResult | null> => {
    try {
      const body = (await readLimited(req, 256, controller.signal)).trim();
      if (body) {
        const parsed: unknown = JSON.parse(body);
        if (!isRecord(parsed) || Object.keys(parsed).length) return null;
      }
    } catch {
      return null;
    }
    let token;
    try {
      token = await readAdsToken(env);
    } catch {
      return result("upstream");
    }
    if (controller.signal.aborted) return result("cancelled");
    const advertiser = token?.advertiser_ids[0];
    if (!token || typeof advertiser !== "string" || !advertiser.trim() || advertiser.length > 128)
      return result("not_connected");
    const industry = TIKTOK_INDUSTRY[categoryId];
    if (!industry) return null;
    const endpoint = new URL(TT_TRENDING_URL);
    endpoint.search = new URLSearchParams({
      advertiser_id: advertiser,
      discovery_type: "HASHTAG",
      country_code: "US",
      date_range: "7DAY",
      category_name: industry,
    }).toString();
    stage = "trending_list";
    requests = 1;
    let response: Response;
    try {
      // Cloudflare has no cookie jar; omit is explicit for injected/browser-compatible transports too.
      const init = {
        method: "GET",
        headers: { Accept: "application/json", "Access-Token": token.access_token },
        credentials: "omit" as const,
        redirect: "error" as const,
        signal: controller.signal,
      };
      response = await (deps.fetch ?? fetch)(endpoint.toString(), init);
    } catch {
      return result("network");
    }
    const httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return result(
        httpStatus === 401
          ? "auth"
          : httpStatus === 403
            ? "permission"
            : httpStatus === 429
              ? "quota"
              : "upstream",
        { httpStatus },
      );
    }
    if (
      !/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(
        response.headers.get("Content-Type") ?? "",
      )
    ) {
      await response.body?.cancel().catch(() => undefined);
      return result("malformed", { httpStatus });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readLimited(response, MAX_BYTES, controller.signal));
    } catch {
      return result("malformed", { httpStatus });
    }
    if (!isRecord(parsed)) return result("malformed", { httpStatus });
    // The official schema permits an absent/null code on success. The actual list is still required;
    // never turn a missing code into an invented zero or accept a missing/malformed data envelope.
    if (
      parsed.code != null &&
      (!Number.isSafeInteger(parsed.code) || Math.abs(Number(parsed.code)) > 1_000_000_000)
    )
      return result("malformed", { httpStatus });
    const providerCode = typeof parsed.code === "number" ? parsed.code : undefined;
    const code = providerCode === undefined ? {} : { providerCode };
    // Only HTTP mappings above are established. Unknown nonzero provider codes are not guessed from text.
    if (providerCode !== undefined && providerCode !== 0)
      return result("upstream", { httpStatus, ...code });
    if (
      !isRecord(parsed.data) ||
      !Array.isArray(parsed.data.list) ||
      parsed.data.list.some(
        (tag) =>
          !isRecord(tag) ||
          !(typeof tag.hashtag_id === "string"
            ? tag.hashtag_id.trim()
            : Number.isSafeInteger(tag.hashtag_id) && Number(tag.hashtag_id) > 0) ||
          typeof tag.hashtag_name !== "string" ||
          !tag.hashtag_name.trim(),
      )
    )
      return result("malformed", { httpStatus, ...code });
    return result("accepted", { httpStatus, ...code, hashtagCount: parsed.data.list.length });
  };
  try {
    return await Promise.race([run(), interrupted]);
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener("abort", cancel);
  }
}
