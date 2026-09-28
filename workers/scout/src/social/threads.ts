/**
 * Threads API (same Meta app as Instagram, its own "Threads" product). Docs: https://developers.facebook.com/docs/threads
 *
 * OAuth
 *   authorize   https://threads.net/oauth/authorize (scopes threads_basic, threads_manage_insights)
 *   code→token  POST https://graph.threads.net/oauth/access_token                       (short-lived, 1 h)
 *   long-lived  GET  https://graph.threads.net/access_token?grant_type=th_exchange_token (60 days)
 *   refresh     GET  https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token
 * Sync
 *   GET /me?fields=id,username,threads_profile_picture_url
 *   GET /me/threads?fields=id,timestamp,text,permalink,media_type&limit=50
 *   GET /{threads-media-id}/insights?metric=views,likes,replies,reposts,quotes,shares
 *   GET /me/threads_insights?metric=views,likes,replies,reposts,quotes&since&until   (views takes since/until)
 *   GET /me/threads_insights?metric=followers_count                                    (no since/until)
 *   GET /me/threads_insights?metric=follower_demographics&breakdown=age|gender|country|city (100+ followers)
 */

import { clip, fetchJson, formPost, int, withQuery } from "./http";
import {
  BREAKDOWNS,
  DEMOGRAPHICS_MIN_FOLLOWERS,
  breakdownRows,
  metaBody,
  metaList,
  metricValue,
  type MetaError,
  type MetaInsight,
  type MetaPage,
} from "./meta";
import {
  ageDays,
  isExpired,
  isoPlusSeconds,
  type ProviderAuth,
  type ProviderCreds,
  scopeFor,
} from "./oauth";
import type { SyncContext } from "./sync";
import { riyadhIso } from "./time";
import {
  SocialError,
  type DemographicRow,
  type PostRow,
  type SyncResult,
  type TokenSet,
} from "./types";

export const TH_AUTHORIZE_URL = "https://threads.net/oauth/authorize";
export const TH_GRAPH = "https://graph.threads.net";
export const TH_API = `${TH_GRAPH}/v1.0`;
export const TH_SCOPES = "threads_basic,threads_manage_insights";
/** Asked for on top of TH_SCOPES when the owner allows auto-posting (publish.ts). */
export const TH_PUBLISH_SCOPES = "threads_content_publish";
export const TH_REFRESH_AFTER_DAYS = 30;
const LONG_LIVED_S = 60 * 24 * 3600;
/** Threads insights exist from this unix time (Apr 13, 2024); `since` may not be earlier. */
const INSIGHTS_EPOCH_S = 1_712_991_600;
const PLATFORM = "threads" as const;

interface ShortToken extends MetaError {
  access_token?: string;
  user_id?: number | string;
  error_message?: string;
}
interface LongToken extends MetaError {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export const auth: ProviderAuth = {
  scopes: TH_SCOPES,
  publishScopes: TH_PUBLISH_SCOPES,
  pkce: false,
  authorizeUrl(
    creds: ProviderCreds,
    redirectUri: string,
    state: string,
    _challenge?: string,
    publish?: boolean,
  ): string {
    return withQuery(TH_AUTHORIZE_URL, {
      client_id: creds.id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopeFor(auth, publish),
      state,
    });
  },
  async exchange(creds, code, redirectUri, _verifier, http, now): Promise<TokenSet> {
    const short = await fetchJson<ShortToken>(
      http,
      `${TH_GRAPH}/oauth/access_token`,
      formPost({
        client_id: creds.id,
        client_secret: creds.secret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: code.replace(/#_$/, ""),
      }),
    );
    if (!short.ok || !short.body?.access_token) {
      throw new SocialError(
        "exchange_failed",
        short.body?.error_message ?? short.body?.error?.message ?? `status ${short.status}`,
      );
    }
    const long = await fetchJson<LongToken>(
      http,
      withQuery(`${TH_GRAPH}/access_token`, {
        grant_type: "th_exchange_token",
        client_secret: creds.secret,
        access_token: short.body.access_token,
      }),
    );
    if (!long.ok || !long.body?.access_token) {
      throw new SocialError(
        "exchange_failed",
        long.body?.error?.message ?? `status ${long.status}`,
      );
    }
    return {
      accessToken: long.body.access_token,
      expiresAt: isoPlusSeconds(now, long.body.expires_in ?? LONG_LIVED_S),
      issuedAt: now.toISOString(),
      userId: short.body.user_id !== undefined ? String(short.body.user_id) : undefined,
      scope: TH_SCOPES,
    };
  },
  needsRefresh(tokens, now): boolean {
    return ageDays(tokens, now) > TH_REFRESH_AFTER_DAYS;
  },
  async refresh(_creds, tokens, http, now): Promise<TokenSet> {
    if (isExpired(tokens, now)) throw new SocialError("token_expired", "long-lived token expired");
    const reply = await fetchJson<LongToken>(
      http,
      withQuery(`${TH_GRAPH}/refresh_access_token`, {
        grant_type: "th_refresh_token",
        access_token: tokens.accessToken,
      }),
    );
    const body = metaBody(reply, "refresh");
    if (!body.access_token) throw new SocialError("upstream", "refresh: no access_token");
    return {
      ...tokens,
      accessToken: body.access_token,
      expiresAt: isoPlusSeconds(now, body.expires_in ?? LONG_LIVED_S),
      issuedAt: now.toISOString(),
    };
  },
};

/* ---------- sync ---------- */

interface ThMe extends MetaError {
  id?: string;
  username?: string;
  threads_profile_picture_url?: string;
}

export interface ThPost {
  id: string;
  timestamp?: string;
  text?: string;
  permalink?: string;
  media_type?: string;
}

export const TH_POSTS_MAX = 100;
/** Calls kept back for the two account insight calls. */
const RESERVE_ACCOUNT = 2;

function postRow(p: ThPost): PostRow {
  const row: PostRow = {
    platform: PLATFORM,
    postId: p.id,
    publishedAt: riyadhIso(p.timestamp ?? 0),
    kind: "thread",
  };
  const title = clip(p.text);
  if (title) row.title = title;
  if (p.permalink) row.permalink = p.permalink;
  return row;
}

/** Media insights: views, likes, replies (→ comments), reposts + quotes + shares (→ shares). */
async function addInsights(http: SyncContext["http"], token: string, row: PostRow): Promise<void> {
  const reply = await fetchJson<MetaPage<MetaInsight>>(
    http,
    withQuery(`${TH_API}/${row.postId}/insights`, {
      metric: "views,likes,replies,reposts,quotes,shares",
      access_token: token,
    }),
  );
  if (!reply.ok || !reply.body?.data) return;
  const data = reply.body.data;
  const views = metricValue(data, "views");
  if (views !== undefined) row.views = views;
  const likes = metricValue(data, "likes");
  if (likes !== undefined) row.likes = likes;
  const replies = metricValue(data, "replies");
  if (replies !== undefined) row.comments = replies;
  const reposts = metricValue(data, "reposts");
  const quotes = metricValue(data, "quotes");
  const shares = metricValue(data, "shares");
  if (reposts !== undefined || quotes !== undefined || shares !== undefined) {
    row.shares = (reposts ?? 0) + (quotes ?? 0) + (shares ?? 0);
  }
}

export async function sync(tokens: TokenSet, ctx: SyncContext): Promise<SyncResult> {
  const { http, now, today } = ctx;
  const token = tokens.accessToken;

  const me = metaBody(
    await fetchJson<ThMe>(
      http,
      withQuery(`${TH_API}/me`, {
        fields: "id,username,threads_profile_picture_url",
        access_token: token,
      }),
    ),
    "me",
  );
  const username = me.username ?? me.id ?? "";

  // Followers: the account insight (the profile endpoint has no follower count).
  const followersReply = metaBody(
    await fetchJson<MetaPage<MetaInsight>>(
      http,
      withQuery(`${TH_API}/me/threads_insights`, {
        metric: "followers_count",
        access_token: token,
      }),
    ),
    "followers_count",
  );
  const followers = metricValue(followersReply.data, "followers_count") ?? 0;

  const threads = await metaList<ThPost>(
    http,
    withQuery(`${TH_API}/me/threads`, {
      fields: "id,timestamp,text,permalink,media_type",
      limit: 50,
      access_token: token,
    }),
    "threads",
    TH_POSTS_MAX,
    2,
  );
  const posts = threads.map(postRow);
  const wantDemographics = followers >= DEMOGRAPHICS_MIN_FOLLOWERS;
  const reserve = RESERVE_ACCOUNT - 1 + (wantDemographics ? BREAKDOWNS.length : 0);
  for (const row of posts) {
    if (http.budget.left <= reserve) break;
    await addInsights(http, token, row).catch(() => undefined);
  }

  // Account views over the trailing 30 days (per-day values summed).
  let views30d: number | undefined;
  if (http.budget.ok) {
    const untilS = Math.floor(now.getTime() / 1000);
    const sinceS = Math.max(INSIGHTS_EPOCH_S, untilS - 30 * 86_400 + 3600);
    const reply = await fetchJson<MetaPage<MetaInsight>>(
      http,
      withQuery(`${TH_API}/me/threads_insights`, {
        metric: "views,likes,replies,reposts,quotes",
        since: sinceS,
        until: untilS,
        access_token: token,
      }),
    );
    if (reply.ok) views30d = metricValue(reply.body?.data, "views");
  }

  const demographics: DemographicRow[] = [];
  if (wantDemographics) {
    for (const breakdown of BREAKDOWNS) {
      if (!http.budget.ok) break;
      const reply = await fetchJson<MetaPage<MetaInsight>>(
        http,
        withQuery(`${TH_API}/me/threads_insights`, {
          metric: "follower_demographics",
          breakdown,
          access_token: token,
        }),
      );
      if (reply.ok)
        demographics.push(...breakdownRows(PLATFORM, today, breakdown, reply.body?.data));
    }
  }

  return {
    account: { platform: PLATFORM, handle: username, url: `https://www.threads.net/@${username}` },
    snapshot: {
      platform: PLATFORM,
      day: today,
      followers: int(followers),
      ...(views30d !== undefined ? { views30d } : {}),
      totalPosts: threads.length,
    },
    posts,
    demographics,
  };
}
