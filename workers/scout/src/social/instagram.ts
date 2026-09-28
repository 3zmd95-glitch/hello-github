/**
 * Instagram API with Instagram Login (Meta app, Professional account; Standard Access is enough for the
 * owner's own account). Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 *
 * OAuth
 *   authorize   https://www.instagram.com/oauth/authorize (scopes instagram_business_basic, instagram_business_manage_insights)
 *   code→token  POST https://api.instagram.com/oauth/access_token                       (short-lived, 1 h)
 *   long-lived  GET  https://graph.instagram.com/access_token?grant_type=ig_exchange_token (60 days)
 *   refresh     GET  https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *               (allowed once the token is a day old, done here when it is older than 30 days)
 * Sync
 *   GET /me?fields=user_id,username,followers_count,media_count
 *   GET /me/media?fields=id,timestamp,media_product_type,media_type,like_count,comments_count,permalink,thumbnail_url,media_url,caption&limit=50
 *   GET /me/stories?fields=id,timestamp,media_type,permalink            (live stories only: polled daily)
 *   GET /{media-id}/insights?metric=views,reach,likes,comments,shares,saved  (+ ig_reels_avg_watch_time for reels; views for stories)
 *   GET /me/insights?metric=reach,views,accounts_engaged,total_interactions,profile_links_taps,follows_and_unfollows&metric_type=total_value&period=day&since&until
 *   GET /me/insights?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=age|gender|country|city&timeframe=this_month
 */

import { clip, fetchJson, formPost, int, mean2, withQuery, type Http } from "./http";
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
import { DAY_MS, riyadhIso } from "./time";
import {
  SocialError,
  type DemographicRow,
  type PostKind,
  type PostRow,
  type SyncResult,
  type TokenSet,
} from "./types";

export const IG_AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize";
export const IG_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
export const IG_GRAPH = "https://graph.instagram.com";
export const IG_API = `${IG_GRAPH}/v21.0`;
export const IG_SCOPES = "instagram_business_basic,instagram_business_manage_insights";
/** Asked for on top of IG_SCOPES when the owner allows auto-posting (publish.ts). */
export const IG_PUBLISH_SCOPES = "instagram_business_content_publish";
/** Long-lived tokens last 60 days; refreshed once older than this many days. */
export const IG_REFRESH_AFTER_DAYS = 30;
const LONG_LIVED_S = 60 * 24 * 3600;
const PLATFORM = "instagram" as const;

interface ShortToken extends MetaError {
  access_token?: string;
  user_id?: number | string;
  permissions?: string[] | string;
  data?: { access_token?: string; user_id?: number | string; permissions?: string[] | string }[];
  error_message?: string;
  error_type?: string;
}
interface LongToken extends MetaError {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

export const auth: ProviderAuth = {
  scopes: IG_SCOPES,
  publishScopes: IG_PUBLISH_SCOPES,
  pkce: false,
  authorizeUrl(
    creds: ProviderCreds,
    redirectUri: string,
    state: string,
    _challenge?: string,
    publish?: boolean,
  ): string {
    return withQuery(IG_AUTHORIZE_URL, {
      client_id: creds.id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopeFor(auth, publish),
      state,
    });
  },
  async exchange(creds, code, redirectUri, _verifier, http, now): Promise<TokenSet> {
    // Instagram appends "#_" to the redirect; browsers drop the fragment, but strip it defensively.
    const cleanCode = code.replace(/#_$/, "");
    const short = await fetchJson<ShortToken>(
      http,
      IG_TOKEN_URL,
      formPost({
        client_id: creds.id,
        client_secret: creds.secret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code: cleanCode,
      }),
    );
    const first = short.body?.data?.[0] ?? short.body;
    const shortToken = first?.access_token;
    if (!short.ok || !shortToken) {
      throw new SocialError(
        "exchange_failed",
        short.body?.error_message ?? `status ${short.status}`,
      );
    }
    const long = await fetchJson<LongToken>(
      http,
      withQuery(`${IG_GRAPH}/access_token`, {
        grant_type: "ig_exchange_token",
        client_secret: creds.secret,
        access_token: shortToken,
      }),
    );
    if (!long.ok || !long.body?.access_token) {
      throw new SocialError(
        "exchange_failed",
        long.body?.error?.message ?? `status ${long.status}`,
      );
    }
    const perms = first?.permissions;
    return {
      accessToken: long.body.access_token,
      expiresAt: isoPlusSeconds(now, long.body.expires_in ?? LONG_LIVED_S),
      issuedAt: now.toISOString(),
      userId: first?.user_id !== undefined ? String(first.user_id) : undefined,
      scope: Array.isArray(perms) ? perms.join(",") : perms,
    };
  },
  needsRefresh(tokens, now): boolean {
    return ageDays(tokens, now) > IG_REFRESH_AFTER_DAYS;
  },
  async refresh(_creds, tokens, http, now): Promise<TokenSet> {
    if (isExpired(tokens, now)) throw new SocialError("token_expired", "long-lived token expired");
    const reply = await fetchJson<LongToken>(
      http,
      withQuery(`${IG_GRAPH}/refresh_access_token`, {
        grant_type: "ig_refresh_token",
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

interface IgMe extends MetaError {
  user_id?: string | number;
  id?: string;
  username?: string;
  followers_count?: number;
  media_count?: number;
}

export interface IgMedia {
  id: string;
  timestamp?: string;
  media_product_type?: "FEED" | "REELS" | "STORY" | "AD" | string;
  media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | string;
  like_count?: number;
  comments_count?: number;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  caption?: string;
}

const MEDIA_FIELDS =
  "id,timestamp,media_product_type,media_type,like_count,comments_count,permalink,thumbnail_url,media_url,caption";
const STORY_FIELDS = "id,timestamp,media_type,permalink";
export const IG_MEDIA_MAX = 100;
/** Calls kept back for the account insights and the four demographic breakdowns. */
const RESERVE_ACCOUNT = 1;

export function igKind(m: IgMedia): PostKind {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_product_type === "STORY") return "story";
  if (m.media_type === "VIDEO") return "video";
  if (m.media_type === "IMAGE" || m.media_type === "CAROUSEL_ALBUM") return "image";
  return "other";
}

function mediaRow(m: IgMedia, kind: PostKind): PostRow {
  const row: PostRow = {
    platform: PLATFORM,
    postId: m.id,
    publishedAt: riyadhIso(m.timestamp ?? 0),
    kind,
  };
  if (kind !== "story") {
    row.likes = int(m.like_count);
    row.comments = int(m.comments_count);
  }
  const title = clip(m.caption);
  if (title) row.title = title;
  if (m.permalink) row.permalink = m.permalink;
  const thumb = m.thumbnail_url ?? m.media_url;
  if (thumb) row.thumbUrl = thumb;
  return row;
}

/** Per-media insights; a failure (media too old, unsupported metric) leaves the row as it is. */
async function addInsights(http: Http, token: string, row: PostRow): Promise<void> {
  const metric =
    row.kind === "story"
      ? "views"
      : row.kind === "reel"
        ? "views,reach,likes,comments,shares,saved,ig_reels_avg_watch_time"
        : "views,reach,likes,comments,shares,saved";
  const reply = await fetchJson<MetaPage<MetaInsight>>(
    http,
    withQuery(`${IG_API}/${row.postId}/insights`, { metric, access_token: token }),
  );
  if (!reply.ok || !reply.body?.data) return;
  const data = reply.body.data;
  const views = metricValue(data, "views");
  if (views !== undefined) row.views = views;
  const likes = metricValue(data, "likes");
  if (likes !== undefined) row.likes = likes;
  const comments = metricValue(data, "comments");
  if (comments !== undefined) row.comments = comments;
  const shares = metricValue(data, "shares");
  if (shares !== undefined) row.shares = shares;
  const saved = metricValue(data, "saved");
  if (saved !== undefined) row.saves = saved;
  // ig_reels_avg_watch_time is reported in milliseconds.
  const watch = metricValue(data, "ig_reels_avg_watch_time");
  if (watch !== undefined) row.watchTimeS = Math.round(watch / 10) / 100;
}

export async function sync(tokens: TokenSet, ctx: SyncContext): Promise<SyncResult> {
  const { http, now, today } = ctx;
  const token = tokens.accessToken;

  const me = metaBody(
    await fetchJson<IgMe>(
      http,
      withQuery(`${IG_API}/me`, {
        fields: "user_id,username,followers_count,media_count",
        access_token: token,
      }),
    ),
    "me",
  );
  const username = me.username ?? String(me.user_id ?? me.id ?? "");
  const followers = int(me.followers_count);

  const media = await metaList<IgMedia>(
    http,
    withQuery(`${IG_API}/me/media`, { fields: MEDIA_FIELDS, limit: 50, access_token: token }),
    "media",
    IG_MEDIA_MAX,
    2,
  );
  // Stories vanish after 24 h, so today's are pulled (and their views read) before anything optional.
  const stories = http.budget.ok
    ? await metaList<IgMedia>(
        http,
        withQuery(`${IG_API}/me/stories`, { fields: STORY_FIELDS, limit: 50, access_token: token }),
        "stories",
        50,
        1,
      ).catch(() => [] as IgMedia[])
    : [];

  const posts: PostRow[] = [
    ...stories.map((m) => mediaRow(m, "story")),
    ...media.map((m) => mediaRow(m, igKind(m))),
  ];
  const wantDemographics = followers >= DEMOGRAPHICS_MIN_FOLLOWERS;
  const reserve = RESERVE_ACCOUNT + (wantDemographics ? BREAKDOWNS.length : 0);
  // Newest first (stories first, they were listed first), as many as the budget allows.
  for (const row of posts) {
    if (http.budget.left <= reserve) break;
    await addInsights(http, token, row).catch(() => undefined);
  }

  // Account totals over the trailing 30 days (period=day with total_value: one aggregated value).
  let views30d: number | undefined;
  if (http.budget.ok) {
    const untilS = Math.floor(now.getTime() / 1000);
    const sinceS = untilS - 30 * 86_400 + 3600;
    const reply = await fetchJson<MetaPage<MetaInsight>>(
      http,
      withQuery(`${IG_API}/me/insights`, {
        metric:
          "reach,views,accounts_engaged,total_interactions,profile_links_taps,follows_and_unfollows",
        metric_type: "total_value",
        period: "day",
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
        withQuery(`${IG_API}/me/insights`, {
          metric: "follower_demographics",
          period: "lifetime",
          metric_type: "total_value",
          breakdown,
          timeframe: "this_month",
          access_token: token,
        }),
      );
      if (reply.ok)
        demographics.push(...breakdownRows(PLATFORM, today, breakdown, reply.body?.data));
    }
  }

  // Story views over the last 30 days: today's stories plus the ones stored by earlier daily syncs.
  const cutoff = now.getTime() - 30 * DAY_MS;
  const storyViews = new Map<string, number>();
  for (const row of [...Object.values(ctx.existing), ...posts]) {
    if (row.platform !== PLATFORM || row.kind !== "story" || row.views === undefined) continue;
    if (Date.parse(row.publishedAt) < cutoff) continue;
    storyViews.set(row.postId, row.views);
  }
  const avgStoryViews = mean2([...storyViews.values()]);

  return {
    account: {
      platform: PLATFORM,
      handle: username,
      url: `https://www.instagram.com/${username}/`,
    },
    snapshot: {
      platform: PLATFORM,
      day: today,
      followers,
      ...(views30d !== undefined ? { views30d } : {}),
      ...(avgStoryViews !== undefined ? { avgStoryViews } : {}),
      totalPosts: int(me.media_count),
    },
    posts,
    demographics,
  };
}
