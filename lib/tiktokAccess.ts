import { z } from "zod";
import { scoutCall, scoutConfig, type ScoutConfig } from "./scoutClient";
import type { DiscoverItem } from "./discover";
import { discoverPostKey } from "./discoverFeed";

const VIDEO_ID = /^\d{15,25}$/;
const EXCLUDED_IDS = z
  .array(z.string().regex(VIDEO_ID))
  .max(200)
  .refine((ids) => new Set(ids).size === ids.length);

/** Public post identities only; never send captions, preferences or other platform URLs. */
export function knownTikTokIds(items: readonly DiscoverItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.platform !== "tt") continue;
    const key = discoverPostKey("tt", item.url);
    const id = key?.match(/\/video\/(\d+)$/)?.[1];
    if (id && VIDEO_ID.test(id)) ids.add(id);
  }
  return [...ids].slice(0, 200);
}

const STATUS = z
  .object({ connected: z.boolean(), advertisers: z.number().int().nonnegative().safe() })
  .strict()
  .refine((value) => value.connected || value.advertisers === 0);
const PROBE = z
  .object({
    version: z.literal(1),
    categoryId: z.string().min(1).max(80),
    country: z.literal("US"),
    dateRange: z.literal("7DAY"),
    discoveryType: z.literal("HASHTAG"),
    stage: z.enum(["grant", "trending_list"]),
    status: z.enum([
      "accepted",
      "not_connected",
      "auth",
      "permission",
      "quota",
      "upstream",
      "malformed",
      "network",
      "timeout",
      "cancelled",
    ]),
    checkedAt: z.iso.datetime(),
    requests: z.union([z.literal(0), z.literal(1)]),
    hashtagCount: z.number().int().nonnegative().safe().optional(),
    httpStatus: z.number().int().min(100).max(599).optional(),
    providerCode: z.number().int().safe().optional(),
  })
  .strict()
  .refine((value) => value.requests === (value.stage === "grant" ? 0 : 1))
  .refine(
    (value) =>
      value.stage !== "grant" ||
      (["not_connected", "upstream", "timeout", "cancelled"].includes(value.status) &&
        value.httpStatus === undefined &&
        value.providerCode === undefined),
  )
  .refine((value) => value.status !== "not_connected" || value.stage === "grant")
  .refine((value) =>
    value.status === "accepted"
      ? value.stage === "trending_list" &&
        value.hashtagCount !== undefined &&
        value.httpStatus !== undefined &&
        value.httpStatus >= 200 &&
        value.httpStatus < 300 &&
        (value.providerCode === undefined || value.providerCode === 0)
      : value.hashtagCount === undefined,
  );

export type TikTokStoredStatus = z.infer<typeof STATUS>;
export type TikTokAccessProbe = z.infer<typeof PROBE>;
export type TikTokAccessError =
  | "unconfigured"
  | "worker_auth"
  | "worker_unavailable"
  | "network"
  | "timeout"
  | "cancelled"
  | "malformed"
  | "upstream";
type Result<T> = { ok: true; value: T } | { ok: false; error: TikTokAccessError };
export type TikTokCountry = "US" | "SA";
interface Options {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  now?: () => number;
}
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 16_384;

/** Reuse Scout authentication, with small bounded responses and no redirects, storage or retry. */
async function request(
  config: ScoutConfig | null,
  path: string,
  method: "GET" | "POST",
  opts: Options,
  limits = { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES },
  payload: { country?: TikTokCountry } = {},
): Promise<Result<unknown>> {
  const usable = scoutConfig(config?.url, config?.token);
  if (!usable) return { ok: false, error: "unconfigured" };
  if (opts.signal?.aborted) return { ok: false, error: "cancelled" };
  const controller = new AbortController();
  let timedOut = false;
  let malformed = false;
  let stop: (error: "cancelled" | "timeout") => void = () => undefined;
  const interrupted = new Promise<Result<unknown>>((resolve) => {
    stop = (error) => {
      resolve({ ok: false, error });
      controller.abort();
    };
  });
  const cancel = () => stop("cancelled");
  opts.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    stop("timeout");
  }, limits.timeoutMs);
  const boundedFetch: typeof fetch = async (input, init) => {
    const response = await (opts.fetchImpl ?? fetch)(input, init);
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      throw new Error("cancelled");
    }
    // Error meaning comes from the HTTP status even when its body is absent, HTML or stalled.
    // Never parse or expose provider error text at this boundary.
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return new Response("{}", { status: response.status });
    }
    const reader = response.body?.getReader();
    if (!reader) {
      malformed = true;
      throw new Error("empty response");
    }
    const chunks: Uint8Array[] = [];
    let length = 0;
    const cancelReader = () => void reader.cancel().catch(() => undefined);
    controller.signal.addEventListener("abort", cancelReader, { once: true });
    try {
      if (Number(response.headers.get("content-length")) > limits.maxBytes)
        throw new Error("large response");
      while (true) {
        if (controller.signal.aborted) throw new Error("cancelled");
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > limits.maxBytes) throw new Error("large response");
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new Response(bytes, { status: response.status, headers: response.headers });
    } catch {
      malformed = !controller.signal.aborted;
      void reader.cancel().catch(() => undefined);
      throw new Error("unreadable response");
    } finally {
      controller.signal.removeEventListener("abort", cancelReader);
      reader.releaseLock();
    }
  };
  const run = async (): Promise<Result<unknown>> => {
    const result = await scoutCall(
      usable,
      path,
      {
        method,
        ...(method === "POST"
          ? { body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } }
          : {}),
        signal: controller.signal,
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
      },
      { fetchImpl: boundedFetch },
    );
    if (opts.signal?.aborted) return { ok: false, error: "cancelled" };
    if (timedOut) return { ok: false, error: "timeout" };
    if (malformed) return { ok: false, error: "malformed" };
    if (!result.ok)
      return {
        ok: false,
        error:
          result.error.status === 404 || result.error.status === 405
            ? "worker_unavailable"
            : result.error.type === "auth"
              ? "worker_auth"
              : result.error.type === "network"
                ? "network"
                : "upstream",
      };
    return { ok: true, value: result.data };
  };
  try {
    return await Promise.race([run(), interrupted]);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", cancel);
  }
}

/** Stored connection presence is not a claim that TikTok has accepted Discovery access. */
export async function readTikTokStoredStatus(
  config: ScoutConfig | null,
  opts: Options = {},
): Promise<Result<TikTokStoredStatus>> {
  const result = await request(config, "/tiktokads/status", "GET", opts);
  if (!result.ok) return result;
  const parsed = STATUS.safeParse(result.value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "malformed" };
}

/** One explicitly requested native hashtag capability probe; never a category scan or search. */
export async function probeTikTokAccess(
  config: ScoutConfig | null,
  categoryId: string,
  opts: Options = {},
): Promise<Result<TikTokAccessProbe>> {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(categoryId)) return { ok: false, error: "malformed" };
  const result = await request(
    config,
    `/categories/${encodeURIComponent(categoryId)}/native/tt/probe`,
    "POST",
    opts,
  );
  if (!result.ok) return result;
  const parsed = PROBE.safeParse(result.value);
  if (
    !parsed.success ||
    parsed.data.categoryId !== categoryId ||
    Math.abs(Date.parse(parsed.data.checkedAt) - (opts.now ?? Date.now)()) > 5 * 60_000
  )
    return { ok: false, error: "malformed" };
  return { ok: true, value: parsed.data };
}

const ACQUISITION = z
  .object({
    version: z.literal(1),
    categoryId: z.string(),
    country: z.enum(["US", "SA"]),
    dateRange: z.literal("7DAY"),
    checkedAt: z.iso.datetime(),
    status: z.enum(["accepted", "not_connected", "upstream", "timeout", "cancelled"]),
    captioned: z.number().int().min(0).max(12),
    supply: z
      .object({
        matchedHashtags: z.number().int().min(0).max(10),
        videoCandidates: z.number().int().min(0).max(12),
        unseenRemaining: z.number().int().min(0).max(200).optional(),
        skippedKnown: z.number().int().min(0).max(200).optional(),
      })
      .strict()
      .optional(),
    items: z
      .array(
        z
          .object({
            platform: z.literal("tt"),
            handle: z.string().max(160),
            url: z.string().regex(/^https:\/\/www\.tiktok\.com\/@[\w.-]+\/video\/\d+$/),
            title: z.string().min(1).max(160),
            snippet: z.string().max(1200),
            section: z.literal("example"),
            lang: z.enum(["ar", "en"]),
            thumb: z
              .string()
              .url()
              .max(8192)
              .refine((url) => url.startsWith("https://"))
              .optional(),
          })
          .strict(),
      )
      .max(12),
  })
  .strict()
  .refine(
    (value) =>
      value.captioned <= value.items.length &&
      (!value.supply ||
        (value.supply.videoCandidates === value.items.length &&
          (value.supply.matchedHashtags > 0 || value.items.length === 0) &&
          ((value.supply.unseenRemaining === undefined &&
            value.supply.skippedKnown === undefined) ||
            (value.supply.unseenRemaining !== undefined &&
              value.supply.skippedKnown !== undefined &&
              value.supply.unseenRemaining + value.supply.skippedKnown + value.items.length <=
                200)))) &&
      (value.status === "accepted" || (value.items.length === 0 && value.captioned === 0)),
  );

export type TikTokAcquisition = Omit<z.infer<typeof ACQUISITION>, "items"> & {
  items: DiscoverItem[];
};

/** Explicit native candidates; no indexed search, preferences, AI or cache writes. */
export async function acquireTikTokEdits(
  config: ScoutConfig | null,
  categoryId: string,
  opts: Options & { country?: TikTokCountry; excludeVideoIds?: readonly string[] } = {},
): Promise<Result<TikTokAcquisition>> {
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(categoryId)) return { ok: false, error: "malformed" };
  if (opts.country !== undefined && opts.country !== "US" && opts.country !== "SA")
    return { ok: false, error: "malformed" };
  if (opts.excludeVideoIds !== undefined && !EXCLUDED_IDS.safeParse(opts.excludeVideoIds).success)
    return { ok: false, error: "malformed" };
  const result = await request(
    config,
    `/categories/${encodeURIComponent(categoryId)}/native/tt/acquire`,
    "POST",
    opts,
    { timeoutMs: 32_000, maxBytes: 128 * 1024 },
    {
      ...(opts.country ? { country: opts.country } : {}),
      ...(opts.excludeVideoIds !== undefined ? { excludeVideoIds: opts.excludeVideoIds } : {}),
    },
  );
  if (!result.ok) return result;
  const parsed = ACQUISITION.safeParse(result.value);
  if (
    !parsed.success ||
    parsed.data.categoryId !== categoryId ||
    parsed.data.country !== (opts.country ?? "US") ||
    Math.abs(Date.parse(parsed.data.checkedAt) - (opts.now ?? Date.now)()) > 5 * 60_000
  )
    return { ok: false, error: "malformed" };
  const ids = knownTikTokIds(parsed.data.items);
  if (
    ids.length !== parsed.data.items.length ||
    ids.some((id) => opts.excludeVideoIds?.includes(id))
  )
    return { ok: false, error: "malformed" };
  return { ok: true, value: parsed.data };
}
