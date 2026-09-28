/**
 * The daily pull: refresh tokens when due, call the platform module, write the rows to KV and record the
 * outcome in `status:<platform>`. Nothing here throws to the router or the cron: a failure becomes
 * `lastError` and an error code in the result.
 */

import { Budget, compact, type Http } from "./http";
import { sync as instagram } from "./instagram";
import { credentials, isExpired, PROVIDERS } from "./oauth";
import { Store, type SocialEnv } from "./store";
import { sync as threads } from "./threads";
import { sync as tiktok } from "./tiktok";
import { riyadhDay } from "./time";
import {
  SOCIAL_PLATFORMS,
  SocialError,
  type PostRow,
  type SocialErrorCode,
  type SocialPlatform,
  type SyncResult,
  type TokenSet,
} from "./types";
import { sync as youtube } from "./youtube";

/** What a platform module gets for one sync. */
export interface SyncContext {
  http: Http;
  now: Date;
  /** Riyadh day key of `now`: the snapshot's and the demographics' day. */
  today: string;
  /** Rows stored by earlier syncs (postId → row): stories that expired, insights past the budget. */
  existing: Record<string, PostRow>;
}

export type PlatformSync = (tokens: TokenSet, ctx: SyncContext) => Promise<SyncResult>;

export const SYNCERS: Record<SocialPlatform, PlatformSync> = {
  instagram,
  threads,
  youtube,
  tiktok,
};

/**
 * Outbound calls one sync may make. The free plan allows 50 subrequests per invocation including KV
 * operations (about ten per sync), so one platform gets 40 and `syncAll` shares them.
 */
export const FETCH_BUDGET = 40;

export interface SyncDeps {
  fetch?: typeof fetch;
  now?: Date;
  /** Outbound calls allowed for this sync (default FETCH_BUDGET). */
  budget?: number;
}

export type SyncOutcome = { ok: true } | { ok: false; error: SocialErrorCode };

/** Syncs one platform now; never throws. */
export async function syncPlatform(
  env: SocialEnv,
  platform: SocialPlatform,
  deps: SyncDeps = {},
): Promise<SyncOutcome> {
  const store = Store.from(env);
  const creds = credentials(env, platform);
  if (!store || !creds) return { ok: false, error: "not_configured" };
  let tokens = await store.getTokens(platform);
  if (!tokens) return { ok: false, error: "not_connected" };
  const status = (await store.getStatus(platform)) ?? {};
  const now = deps.now ?? new Date();
  const http: Http = {
    fetch: deps.fetch ?? fetch,
    budget: new Budget(deps.budget ?? FETCH_BUDGET),
  };

  try {
    const provider = PROVIDERS[platform];
    if (provider.needsRefresh(tokens, now)) {
      tokens = await provider.refresh(creds, tokens, http, now);
      await store.putTokens(platform, tokens);
    } else if (isExpired(tokens, now)) {
      throw new SocialError("token_expired", "access token expired");
    }
    const existing = await store.getPosts(platform);
    const result = await SYNCERS[platform](tokens, {
      http,
      now,
      today: riyadhDay(now),
      existing,
    });
    await store.putSnapshot(compact(result.snapshot));
    await store.mergePosts(platform, existing, result.posts.map(compact));
    await store.putDemographics(platform, result.snapshot.day, result.demographics);
    await store.putStatus(platform, {
      ...status,
      handle: result.account.handle,
      url: result.account.url,
      lastSyncAt: now.toISOString(),
      lastError: undefined,
      tokenExpiresAt: tokens.expiresAt,
    });
    return { ok: true };
  } catch (e) {
    const code: SocialErrorCode = e instanceof SocialError ? e.code : "upstream";
    await store
      .putStatus(platform, { ...status, lastError: code, tokenExpiresAt: tokens.expiresAt })
      .catch(() => undefined);
    return { ok: false, error: code };
  }
}

export interface SyncAllResult {
  synced: SocialPlatform[];
  errors: Partial<Record<SocialPlatform, SocialErrorCode>>;
}

/** The platforms with stored tokens. */
export async function connectedPlatforms(env: SocialEnv): Promise<SocialPlatform[]> {
  const store = Store.from(env);
  if (!store) return [];
  const out: SocialPlatform[] = [];
  for (const p of SOCIAL_PLATFORMS) if (await store.getTokens(p)) out.push(p);
  return out;
}

/**
 * Syncs the given platforms (default: every connected one), sharing the outbound budget between them.
 * Not-connected platforms that were asked for explicitly are reported as `not_connected`.
 */
export async function syncAll(
  env: SocialEnv,
  deps: SyncDeps = {},
  platforms?: SocialPlatform[],
): Promise<SyncAllResult> {
  const targets = platforms ?? (await connectedPlatforms(env));
  const result: SyncAllResult = { synced: [], errors: {} };
  if (!targets.length) return result;
  const budget = Math.max(1, Math.floor((deps.budget ?? FETCH_BUDGET) / targets.length));
  for (const p of targets) {
    const outcome = await syncPlatform(env, p, { ...deps, budget });
    if (outcome.ok) result.synced.push(p);
    else result.errors[p] = outcome.error;
  }
  return result;
}

/**
 * The four daily triggers of older deployments (UTC; Riyadh is UTC+3), one platform each. The current
 * wrangler.jsonc has a single five-minute trigger that syncs on the same times (cron.ts SYNC_SLOTS). An
 * unknown cron string syncs everything with a shared budget.
 */
export const CRON_PLATFORMS: Record<string, SocialPlatform> = {
  "0 3 * * *": "instagram",
  "10 3 * * *": "threads",
  "20 3 * * *": "youtube",
  "30 3 * * *": "tiktok",
};

/** Syncs one platform when it is connected (a cron tick's work); nothing to do otherwise. */
export async function syncIfConnected(
  env: SocialEnv,
  platform: SocialPlatform,
  deps: SyncDeps = {},
): Promise<SyncAllResult> {
  const store = Store.from(env);
  if (!store || !(await store.getTokens(platform))) return { synced: [], errors: {} };
  const outcome = await syncPlatform(env, platform, deps);
  return outcome.ok
    ? { synced: [platform], errors: {} }
    : { synced: [], errors: { [platform]: outcome.error } };
}

/** The `scheduled` handler's work for one of the legacy daily cron strings. */
export async function runScheduled(
  env: SocialEnv,
  cron: string,
  deps: SyncDeps = {},
): Promise<SyncAllResult> {
  const platform = CRON_PLATFORMS[cron];
  return platform ? syncIfConnected(env, platform, deps) : syncAll(env, deps);
}
