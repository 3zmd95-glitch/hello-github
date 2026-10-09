import { z } from "zod";
import { scoutCall, scoutConfig, type ScoutConfig } from "./scoutClient";

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
  }, TIMEOUT_MS);
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
      if (Number(response.headers.get("content-length")) > MAX_BYTES)
        throw new Error("large response");
      while (true) {
        if (controller.signal.aborted) throw new Error("cancelled");
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > MAX_BYTES) throw new Error("large response");
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
          ? { body: "{}", headers: { "Content-Type": "application/json" } }
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
