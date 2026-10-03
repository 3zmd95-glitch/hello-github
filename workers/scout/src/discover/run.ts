/**
 * Discover v2: the whole search (planning/tools/13-discover-search-v2.md). Plan → Tavily (TikTok, Instagram) and
 * YouTube at once → one `videos.list` for the YouTube numbers → labels and creators → one answer, kept 6 h in KV
 * (`discover:answer:<sha-256 of the normalized request>`) when every platform answered, so the dashboard and the
 * connector asking the same thing spend once. At most ~16 outbound calls (9 searches, 2 retries, the statistics
 * call, KV) of the 50 a free invocation allows.
 */

import type { Platform, Profile, ScoutResult } from "../normalize";
import { enrichYoutubeStats } from "../youtubeStats";
import {
  reserveYoutube,
  tavilyCall,
  youtubeCall,
  type FetchEnv,
  type TavilyOutcome,
} from "./fetchers";
import { creatorsOf, labelCards } from "./label";
import { planSearch } from "./plan";
import type {
  DiscoverRequest,
  DiscoverResponse,
  PlannedQuery,
  PlatformError,
  PlatformStatus,
} from "./types";

export const ANSWER_TTL_S = 6 * 3600;
export const MAX_RETRIES = 2;
export const discoverAnswerKey = (hash: string) => `discover:answer:${hash}`;

export interface RunDeps {
  fetch: typeof fetch;
  now: Date;
  /** Each search call's limit (ms); tests may shorten it. */
  timeoutMs?: number;
}

/** SHA-256 of the request in a normal form (case, spaces and platform order do not matter). */
export async function requestHash(req: DiscoverRequest): Promise<string> {
  const canonical = JSON.stringify({
    q: req.q.trim().toLowerCase().replace(/\s+/g, " "),
    exact: !!req.exact,
    term: req.term ?? "",
    genre: [req.genreQuery?.ar ?? "", req.genreQuery?.en ?? ""],
    program: req.program ?? "",
    timeRange: req.timeRange ?? "",
    ytLength: req.ytLength ?? "",
    platforms: [...(req.platforms ?? ["tt", "ig", "yt"])].sort(),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Card = ScoutResult & { profile?: string };
interface QueryResult {
  query: PlannedQuery;
  cards: Card[];
  error?: PlatformError;
  retried?: boolean;
}

/** Round robin over the queries' cards, so every query shows near the top of its section. */
function interleave(results: readonly QueryResult[]): { card: Card; query: PlannedQuery }[] {
  const out: { card: Card; query: PlannedQuery }[] = [];
  const longest = Math.max(0, ...results.map((r) => r.cards.length));
  for (let i = 0; i < longest; i++) {
    for (const r of results) if (r.cards[i]) out.push({ card: r.cards[i], query: r.query });
  }
  return out;
}

/** A platform answered when one of its queries did; else the first query's error. */
function statusOf(results: readonly QueryResult[]): PlatformStatus {
  const ok = results.filter((r) => !r.error);
  if (ok.length) return ok.some((r) => r.retried) ? { ok: true, retried: true } : { ok: true };
  return { ok: false, error: results[0]?.error ?? "upstream" };
}

export async function runDiscover(
  env: FetchEnv,
  req: DiscoverRequest,
  deps: RunDeps,
): Promise<DiscoverResponse> {
  const key = discoverAnswerKey(await requestHash(req));
  const cached = env.SOCIAL_KV ? await env.SOCIAL_KV.get(key, "text").catch(() => null) : null;
  if (cached) {
    try {
      return { ...(JSON.parse(cached) as DiscoverResponse), cached: true };
    } catch {
      // A broken entry: search again (the new answer replaces it).
    }
  }

  const plan = planSearch(req);
  const profiles: Profile[] = [];
  let credits = 0;
  let retriesLeft = MAX_RETRIES;

  const tavily = plan.queries
    .filter((q) => q.platform !== "yt")
    .map(async (query): Promise<QueryResult> => {
      const call = {
        q: query.q,
        platform: query.platform as "tt" | "ig",
        lang: query.lang,
        timeRange: req.timeRange,
      };
      let out: TavilyOutcome = await tavilyCall(env, deps.fetch, call, deps.timeoutMs);
      if (out.ok) credits += out.credits;
      let retried = false;
      if (out.ok && out.cards.length === 0 && query.retryQ && retriesLeft > 0) {
        retriesLeft -= 1;
        retried = true;
        const again = await tavilyCall(
          env,
          deps.fetch,
          { ...call, q: query.retryQ },
          deps.timeoutMs,
        );
        if (again.ok) {
          credits += again.credits;
          out = { ...again, profiles: [...out.profiles, ...again.profiles] };
        }
      }
      if (!out.ok) return { query, cards: [], error: out.error };
      profiles.push(...out.profiles);
      return { query, cards: out.cards, retried };
    });

  const ytQueries = plan.queries.filter((q) => q.platform === "yt");
  let youtubeSearch = 0;
  const youtube = (async (): Promise<QueryResult[]> => {
    if (!ytQueries.length) return [];
    if (!env.YOUTUBE_API_KEY)
      return ytQueries.map((query) => ({ query, cards: [], error: "not_configured" as const }));
    const granted = await reserveYoutube(env, ytQueries.length, deps.now).catch(
      () => ytQueries.length,
    );
    youtubeSearch = granted;
    if (granted === 0)
      return ytQueries.map((query) => ({ query, cards: [], error: "daily_cap" as const }));
    return Promise.all(
      ytQueries.slice(0, granted).map(async (query): Promise<QueryResult> => {
        const call = {
          q: query.q,
          lang: query.lang,
          timeRange: req.timeRange,
          ytLength: req.ytLength,
        };
        const out = await youtubeCall(env, deps.fetch, call, deps.now, deps.timeoutMs);
        return out.ok ? { query, cards: out.cards } : { query, cards: [], error: out.error };
      }),
    );
  })();

  const [tavilyResults, ytResults] = await Promise.all([Promise.all(tavily), youtube]);
  const ytCards = ytResults.flatMap((r) => r.cards);
  if (ytCards.length) await enrichYoutubeStats(ytCards, env, deps.fetch);

  const results = [...tavilyResults, ...ytResults];
  const items = labelCards(interleave(results), plan);
  const platforms: Partial<Record<Platform, PlatformStatus>> = {};
  for (const p of ["tt", "ig", "yt"] as const) {
    const mine = results.filter((r) => r.query.platform === p);
    if (mine.length) platforms[p] = statusOf(mine);
  }
  const answer: DiscoverResponse = {
    topicKey: plan.topicKey,
    understood: plan.understood,
    alternatives: plan.alternatives,
    items,
    creators: creatorsOf(items, profiles),
    platforms,
    cost: { tavily: credits, youtubeSearch },
    cached: false,
  };
  if (env.SOCIAL_KV && Object.values(platforms).every((s) => s?.ok)) {
    await env.SOCIAL_KV.put(key, JSON.stringify(answer), { expirationTtl: ANSWER_TTL_S }).catch(
      () => undefined,
    );
  }
  return answer;
}
