/**
 * The Claude connector's tools as plain functions (round 33, planning/tools/13-discover-search-v2.md), so Node
 * tests run them without the MCP runtime; `mcp.ts` only registers them. Platform names are spelled out for Claude
 * ("tiktok", "instagram", "youtube"). Tavily lookups through the connector are counted per Riyadh day
 * (`discover:mcp:<day>`) against `MCP_DAILY_LOOKUPS`; a cached answer costs nothing and counts nothing, and past the
 * cap it is still served.
 */

import { readEffects } from "../effects/kv";
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
const clipText = (x: { en: string; ar?: string }, max: number) => ({
  en: clip(x.en, max),
  ar: x.ar && clip(x.ar, max),
});
/** The rule of `parseDiscoverBody`: symbols or emoji only ("🔥🔥", "!!!") leave no word to search or key by. */
const BAD_TOPIC = "The topic needs at least one letter or digit.";
/** The dashboard's rule (MAX_AGE_MS in lib/effects.ts): an effects list older than 3 days is not this week's. */
const EFFECTS_MAX_AGE_MS = 3 * 86_400_000;

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
    // Deduped like parseDiscoverBody's, so a platform named twice keeps the same 6-hour answer key.
    ...(input.platforms?.length
      ? { platforms: [...new Set(input.platforms)].map((p) => CODE[p]) }
      : {}),
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
  now: Date,
): Promise<Record<string, unknown>> {
  // This week's trending editing effects (effects/, planning/tools/18-trending-effects.md); names and lines come from
  // web text, so they are clipped like the radar's. Like the dashboard's row, a list over 3 days old is not this
  // week's: none then, with its time. A bonus: a document or an item that can't be read gives none, never a failed
  // call (readEffects checks only the document's top level).
  const [feed, effects] = await Promise.all([
    latestFeed(env),
    readEffects(env)
      .then((doc) => {
        // No items, no list: a document whose every run failed holds the failure's time, not a list's.
        const updatedAt =
          typeof doc?.updatedAt === "string" && doc.items.length ? doc.updatedAt : null;
        const fresh = !!updatedAt && now.getTime() - Date.parse(updatedAt) <= EFFECTS_MAX_AGE_MS;
        const items =
          doc && fresh
            ? doc.items.map((i) => ({
                name: clipText(i.name, 40),
                what: i.what && clipText(i.what, 90),
                creators: i.creators,
                isNew: i.isNew,
                growth: i.growth,
                youtube: i.youtube,
              }))
            : [];
        return { updatedAt, items };
      })
      .catch(() => ({ updatedAt: null, items: [] })),
  ]);
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
  return {
    fetchedAt: feed.fetchedAt,
    items,
    effects: effects.items,
    effectsUpdatedAt: effects.updatedAt,
  };
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
 * (`console.log` JSON, Workers observability) with the tool, the topic, the time, the error code (and a thrown
 * error's name as `cause`), whether the answer was kept, the lookups left today and how many items; never URLs,
 * items, tokens or an error's message. A thrown error (KV down, a picks document that can't be read) answers
 * `failed` with `isError`: a result Claude can read, never the raw message (the SDK would send it as is).
 */
export async function toolCall(
  tool: string,
  input: { topic?: string },
  run: () => Promise<Record<string, unknown>>,
): Promise<ToolReply> {
  const started = Date.now();
  let cause: string | undefined;
  const out = await run().catch((e: unknown) => {
    cause = e instanceof Error ? e.name : typeof e;
    return null;
  });
  const res = out ?? FAILED;
  const list = Array.isArray(res.items) ? res.items : Array.isArray(res.picks) ? res.picks : null;
  // JSON.stringify leaves the undefined fields out.
  console.log(
    JSON.stringify({
      mcp: tool,
      topic: input.topic ? clip(input.topic, 100) : undefined,
      ms: Date.now() - started,
      error: typeof res.error === "string" ? res.error : undefined,
      cause,
      cached: typeof res.cached === "boolean" ? res.cached : undefined,
      lookups: typeof res.lookupsLeftToday === "number" ? res.lookupsLeftToday : undefined,
      count: list ? list.length : typeof res.saved === "number" ? res.saved : undefined,
    }),
  );
  const content = [{ type: "text" as const, text: JSON.stringify(res) }];
  return out ? { content } : { content, isError: true };
}
