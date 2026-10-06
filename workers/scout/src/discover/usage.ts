/**
 * GET /discover/usage: the real numbers behind the dashboard's "412 of 1,000" line (planning/tools/13). Tavily's
 * own `GET /usage` (account and key), kept 10 minutes in KV so opening Discover does not ask every time; today's
 * YouTube calls of Discover + the connector (UTC day); today's connector lookups (Riyadh day, the connector's cap).
 */

import { riyadhDay } from "../social/time";
import { CALL_TIMEOUT_MS, youtubeCap, youtubeUsedToday, type FetchEnv } from "./fetchers";
import type { PlatformError } from "./types";

export const TAVILY_USAGE_URL = "https://api.tavily.com/usage";
export const USAGE_TTL_S = 600;
export const DEFAULT_CONNECTOR_CAP = 60;
export const usageKeys = {
  tavily: "discover:usage:tavily",
  connector: (riyadhDayKey: string) => `discover:mcp:${riyadhDayKey}`,
};

export interface UsageEnv extends FetchEnv {
  /** Var: Tavily lookups the connector may spend a Riyadh day (default 60). */
  MCP_DAILY_LOOKUPS?: string;
}

export interface TavilyUsage {
  used: number;
  limit: number | null;
  plan?: string;
  paygoUsed?: number;
  paygoLimit?: number | null;
}

export interface UsageAnswer {
  tavily: TavilyUsage | { error: PlatformError };
  youtube: { usedToday: number; cap: number };
  connector: { usedToday: number; cap: number };
}

interface TavilyUsageReply {
  key?: { usage?: unknown; limit?: unknown };
  account?: {
    current_plan?: unknown;
    plan_usage?: unknown;
    plan_limit?: unknown;
    paygo_usage?: unknown;
    paygo_limit?: unknown;
  };
}

const count = (x: unknown): number | undefined =>
  typeof x === "number" && Number.isFinite(x) && x >= 0 ? Math.floor(x) : undefined;

/** `MCP_DAILY_LOOKUPS` if it is a number ≥ 0; unset, blank or other: 60 (the same rule as `youtubeCap`). */
export function connectorCap(env: UsageEnv): number {
  const raw = env.MCP_DAILY_LOOKUPS?.trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_CONNECTOR_CAP;
}

export async function connectorUsedToday(env: UsageEnv, now: Date): Promise<number> {
  if (!env.SOCIAL_KV) return 0;
  const n = Number((await env.SOCIAL_KV.get(usageKeys.connector(riyadhDay(now)), "text")) ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Tavily's month: the figure kept 10 minutes in KV, else Tavily's own `GET /usage` (kept 10 minutes when it answers).
 * Also the budget guards' figure (effects/sources.ts `monthUsage`). */
export async function tavilyUsage(
  env: UsageEnv,
  doFetch: typeof fetch,
  timeoutMs: number,
): Promise<TavilyUsage | { error: PlatformError }> {
  if (!env.TAVILY_API_KEY) return { error: "not_configured" };
  const kept = env.SOCIAL_KV
    ? await env.SOCIAL_KV.get(usageKeys.tavily, "text").catch(() => null)
    : null;
  if (kept) {
    try {
      return JSON.parse(kept) as TavilyUsage;
    } catch {
      // ask again
    }
  }
  let res: Response;
  try {
    res = await doFetch(TAVILY_USAGE_URL, {
      headers: { Authorization: `Bearer ${env.TAVILY_API_KEY}`, Accept: "application/json" },
      // The limit covers the body read too; a call that runs out is an `upstream` error.
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { error: "upstream" };
  }
  // A refused answer's body is never read: let it go, so it does not hold the connection.
  if (!res.ok) await res.body?.cancel().catch(() => undefined);
  if (res.status === 401 || res.status === 403) return { error: "auth" };
  if (res.status === 429 || res.status === 432 || res.status === 433) return { error: "quota" };
  if (!res.ok) return { error: "upstream" };
  const body = (await res.json().catch(() => null)) as TavilyUsageReply | null;
  const k = body?.key ?? {};
  const a = body?.account ?? {};
  const used = count(a.plan_usage) ?? count(k.usage);
  // A reply without the usage figure is no answer: nothing to show, nothing kept.
  if (used === undefined) return { error: "upstream" };
  const paygoLimit = a.paygo_limit === null ? null : count(a.paygo_limit);
  const paygoUsed = count(a.paygo_usage);
  const usage: TavilyUsage = {
    used,
    limit: count(a.plan_limit) ?? count(k.limit) ?? null,
    ...(typeof a.current_plan === "string" ? { plan: a.current_plan } : {}),
    ...(paygoUsed !== undefined ? { paygoUsed } : {}),
    ...(paygoLimit !== undefined ? { paygoLimit } : {}),
  };
  if (env.SOCIAL_KV) {
    await env.SOCIAL_KV.put(usageKeys.tavily, JSON.stringify(usage), {
      expirationTtl: USAGE_TTL_S,
    }).catch(() => undefined);
  }
  return usage;
}

/** `timeoutMs`: the limit of Tavily's `/usage` call (tests shorten it). */
export async function discoverUsage(
  env: UsageEnv,
  doFetch: typeof fetch,
  now: Date,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<UsageAnswer> {
  const [tavily, yt, connector] = await Promise.all([
    tavilyUsage(env, doFetch, timeoutMs),
    youtubeUsedToday(env, now).catch(() => 0),
    connectorUsedToday(env, now).catch(() => 0),
  ]);
  return {
    tavily,
    youtube: { usedToday: yt, cap: youtubeCap(env) },
    connector: { usedToday: connector, cap: connectorCap(env) },
  };
}
