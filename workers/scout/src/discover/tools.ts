/**
 * The Claude connector's tools as plain functions (round 33, planning/tools/13-discover-search-v2.md), so Node
 * tests run them without the MCP runtime; `mcp.ts` only registers them. Platform names are spelled out for Claude
 * ("tiktok", "instagram", "youtube"). Tavily lookups through the connector are counted per Riyadh day
 * (`discover:mcp:<day>`) against `MCP_DAILY_LOOKUPS`; a cached answer costs nothing and counts nothing, and past the
 * cap it is still served.
 */

import type { Platform } from "../normalize";
import { riyadhDay } from "../social/time";
import { latestFeed } from "../trends/kv";
import { readPicks, savePicks, type PickInput } from "./picks";
import { keptAnswer, runDiscover } from "./run";
import { normalizeTerm, type Lang } from "./terms";
import type { DiscoverRequest, Intent } from "./types";
import { connectorCap, connectorUsedToday, usageKeys, type UsageEnv } from "./usage";

export type PlatformName = "tiktok" | "instagram" | "youtube";
const CODE: Record<PlatformName, Platform> = { tiktok: "tt", instagram: "ig", youtube: "yt" };
const NAME: Record<Platform, PlatformName> = { tt: "tiktok", ig: "instagram", yt: "youtube" };

export interface ToolDeps {
  fetch: typeof fetch;
  now: Date;
}

export interface SearchInput {
  topic: string;
  queries?: { q: string; platform: PlatformName; lang: Lang; intent: Intent }[];
  platforms?: PlatformName[];
  timeRange?: "week" | "month" | "year";
  exact?: boolean;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
/** The rule of `parseDiscoverBody`: symbols or emoji only ("🔥🔥", "!!!") leave no word to search or key by. */
const BAD_TOPIC = "The topic needs at least one letter or digit.";

/** Best-effort: KV takes one write per key a second, so a count that can't be kept never fails the tool call. */
export async function addConnectorLookups(env: UsageEnv, n: number, now: Date): Promise<void> {
  if (!env.SOCIAL_KV || n <= 0) return;
  try {
    const used = await connectorUsedToday(env, now);
    await env.SOCIAL_KV.put(usageKeys.connector(riyadhDay(now)), String(used + n), {
      expirationTtl: 2 * 86_400,
    });
  } catch {
    // ponytail: an uncounted lookup or two; a Durable Object counter if the cap must be exact.
  }
}

export async function searchVideos(
  env: UsageEnv,
  deps: ToolDeps,
  input: SearchInput,
): Promise<Record<string, unknown>> {
  if (!normalizeTerm(input.topic)) return { error: "bad_topic", message: BAD_TOPIC };
  const cap = connectorCap(env);
  // Fail closed: a count that can't be read could spend past the cap.
  const used = await connectorUsedToday(env, deps.now).catch(() => null);
  if (used === null) {
    return { error: "unavailable", message: "Usage counter unavailable, try again in a minute." };
  }
  const req: DiscoverRequest = {
    q: input.topic,
    ...(input.exact ? { exact: true } : {}),
    ...(input.timeRange ? { timeRange: input.timeRange } : {}),
    ...(input.platforms?.length ? { platforms: input.platforms.map((p) => CODE[p]) } : {}),
    ...(input.queries?.length
      ? { queries: input.queries.map((q) => ({ ...q, platform: CODE[q.platform] })) }
      : {}),
  };
  // Past the day's cap only a kept answer is served (it spends nothing).
  const answer =
    used < cap
      ? await runDiscover(env, req, { fetch: deps.fetch, now: deps.now })
      : await keptAnswer(env, req);
  if (!answer) {
    return {
      error: "daily_limit",
      message: `Daily limit reached (${cap} lookups). It resets at midnight Riyadh time.`,
    };
  }
  const spent = answer.cached ? 0 : answer.cost.tavily;
  await addConnectorLookups(env, spent, deps.now);
  const items = [
    ...answer.items.filter((i) => !i.offTopic),
    ...answer.items.filter((i) => i.offTopic),
  ]
    .slice(0, 40)
    .map((i) => ({
      platform: NAME[i.platform],
      url: i.url,
      title: clip(i.title, 160),
      snippet: clip(i.snippet, 160),
      handle: i.handle,
      section: i.section,
      lang: i.lang,
      ...(i.offTopic ? { offTopic: true } : {}),
      ...(i.stats?.views !== undefined ? { views: i.stats.views } : {}),
      ...(i.stats?.likes !== undefined ? { likes: i.stats.likes } : {}),
      ...(i.published ? { published: i.published } : {}),
    }));
  return {
    topicKey: answer.topicKey,
    understood: answer.understood,
    alternatives: answer.alternatives,
    items,
    creators: answer.creators.map((c) => ({ ...c, platform: NAME[c.platform] })),
    platforms: Object.fromEntries(
      Object.entries(answer.platforms).map(([p, s]) => [NAME[p as Platform], s]),
    ),
    cached: answer.cached,
    lookupsLeftToday: Math.max(0, cap - used - spent),
  };
}

export async function getTrends(
  env: UsageEnv,
  input: { region?: "SA" | "US"; genre?: string; limit?: number },
): Promise<Record<string, unknown>> {
  const feed = await latestFeed(env);
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const items = feed.items
    .filter(
      (r) =>
        (!input.region || r.region === input.region) && (!input.genre || r.genre === input.genre),
    )
    .slice(0, limit)
    .map((r) => ({
      title: clip(r.title, 160),
      platform: r.platform,
      region: r.region,
      ...(r.url ? { url: r.url } : {}),
      source: r.source,
      ...(r.genre ? { genre: r.genre } : {}),
      ...(r.score !== undefined ? { score: r.score } : {}),
      ...(r.volume !== undefined ? { volume: r.volume } : {}),
      ...(r.why ? { why: clip(r.why, 160) } : {}),
    }));
  return { fetchedAt: feed.fetchedAt, items };
}

export async function savePicksTool(
  env: UsageEnv,
  deps: ToolDeps,
  input: { topic: string; items: PickInput[]; replace?: boolean },
): Promise<Record<string, unknown>> {
  if (!normalizeTerm(input.topic)) return { error: "bad_topic", message: BAD_TOPIC };
  const r = await savePicks(env, input.topic, input.items, !!input.replace, deps.now);
  return { ...r, where: `Discover → search "${input.topic}" (⭐ Claude's picks)` };
}

export async function getPicksTool(
  env: UsageEnv,
  input: { topic?: string },
): Promise<Record<string, unknown>> {
  return { picks: await readPicks(env, input.topic) };
}

// A type, not an interface: the SDK's CallToolResult has an index signature, which only a type alias meets.
export type ToolReply = { content: { type: "text"; text: string }[]; isError?: true };

const FAILED: Record<string, unknown> = {
  error: "failed",
  message: "Something went wrong on the Worker. Try again in a minute.",
};

/**
 * Every connector tool call goes through here (`mcp.ts`): the tool's answer as JSON text, and one log line
 * (`console.log` JSON, Workers observability) with the tool, the topic, the time, the error code, whether the answer
 * was kept, the lookups left today and how many items; never URLs, items or tokens. A thrown error (KV down, a
 * picks document that can't be read) answers `failed` with `isError`: a result Claude can read, never the raw
 * message (the SDK would send it as is).
 */
export async function toolCall(
  tool: string,
  input: { topic?: string },
  run: () => Promise<Record<string, unknown>>,
): Promise<ToolReply> {
  const started = Date.now();
  const out = await run().catch(() => null);
  const res = out ?? FAILED;
  const list = Array.isArray(res.items) ? res.items : Array.isArray(res.picks) ? res.picks : null;
  // JSON.stringify leaves the undefined fields out.
  console.log(
    JSON.stringify({
      mcp: tool,
      topic: input.topic ? clip(input.topic, 100) : undefined,
      ms: Date.now() - started,
      error: typeof res.error === "string" ? res.error : undefined,
      cached: typeof res.cached === "boolean" ? res.cached : undefined,
      lookups: typeof res.lookupsLeftToday === "number" ? res.lookupsLeftToday : undefined,
      count: list ? list.length : typeof res.saved === "number" ? res.saved : undefined,
    }),
  );
  const content = [{ type: "text" as const, text: JSON.stringify(res) }];
  return out ? { content } : { content, isError: true };
}
