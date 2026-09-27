/**
 * TikTok Display API through Login Kit (app at developers.tiktok.com; sandbox first, TikTok review before
 * non-sandbox). Docs: https://developers.tiktok.com/doc/display-api-overview
 *
 * OAuth (PKCE S256)
 *   authorize   https://www.tiktok.com/v2/auth/authorize/?client_key&scope=user.info.basic,user.info.profile,user.info.stats,video.list
 *   token       POST https://open.tiktokapis.com/v2/oauth/token/ (form-encoded; authorization_code, refresh_token)
 *               access tokens last 24 h, refresh tokens 365 days → refreshed before every sync
 * Sync
 *   GET  https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,avatar_url,follower_count,following_count,likes_count,video_count,profile_deep_link
 *   POST https://open.tiktokapis.com/v2/video/list/?fields=id,create_time,title,cover_image_url,share_url,view_count,like_count,comment_count,share_count,duration
 *        body { max_count: 20, cursor } paged with cursor / has_more (≤ 100 videos)
 * No scope returns audience demographics: those stay a manual entry in the dashboard.
 */

import {
  clip,
  fetchJson,
  formPost,
  int,
  bearer,
  withQuery,
  type Http,
  type JsonReply,
} from "./http";
import { isExpired, isoPlusSeconds, type ProviderAuth, type ProviderCreds } from "./oauth";
import type { SyncContext } from "./sync";
import { DAY_MS, unixToRiyadhIso } from "./time";
import { SocialError, type PostRow, type SyncResult, type TokenSet } from "./types";

export const TT_AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TT_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
export const TT_API = "https://open.tiktokapis.com/v2";
export const TT_SCOPES = "user.info.basic,user.info.profile,user.info.stats,video.list";
export const TT_VIDEOS_MAX = 100;
/** A token younger than this is used without a refresh. */
export const TT_FRESH_MS = 5 * 60_000;
const PAGE = 20;
const PLATFORM = "tiktok" as const;

interface TtToken {
  access_token?: string;
  expires_in?: number;
  open_id?: string;
  refresh_expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
  log_id?: string;
}

export const auth: ProviderAuth = {
  scopes: TT_SCOPES,
  pkce: true,
  authorizeUrl(
    creds: ProviderCreds,
    redirectUri: string,
    state: string,
    challenge?: string,
  ): string {
    return withQuery(TT_AUTHORIZE_URL, {
      client_key: creds.id,
      scope: TT_SCOPES,
      response_type: "code",
      redirect_uri: redirectUri,
      state,
      code_challenge: challenge,
      code_challenge_method: challenge ? "S256" : undefined,
    });
  },
  async exchange(creds, code, redirectUri, verifier, http, now): Promise<TokenSet> {
    const reply = await fetchJson<TtToken>(
      http,
      TT_TOKEN_URL,
      formPost({
        client_key: creds.id,
        client_secret: creds.secret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        ...(verifier ? { code_verifier: verifier } : {}),
      }),
    );
    if (!reply.ok || !reply.body?.access_token) {
      throw new SocialError("exchange_failed", reply.body?.error_description ?? reply.body?.error);
    }
    return {
      accessToken: reply.body.access_token,
      refreshToken: reply.body.refresh_token,
      expiresAt: isoPlusSeconds(now, reply.body.expires_in ?? 86_400),
      issuedAt: now.toISOString(),
      userId: reply.body.open_id,
      scope: reply.body.scope,
    };
  },
  // 24-hour access tokens: refreshed before every sync (the daily cron always finds one older than a day);
  // only a token issued moments ago (the first sync right after connecting) is used as is.
  needsRefresh(tokens, now): boolean {
    return now.getTime() - Date.parse(tokens.issuedAt) > TT_FRESH_MS || isExpired(tokens, now);
  },
  async refresh(creds, tokens, http, now): Promise<TokenSet> {
    if (!tokens.refreshToken) throw new SocialError("token_expired", "no refresh token");
    const reply = await fetchJson<TtToken>(
      http,
      TT_TOKEN_URL,
      formPost({
        client_key: creds.id,
        client_secret: creds.secret,
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      }),
    );
    if (!reply.ok || !reply.body?.access_token) {
      const err = reply.body?.error ?? "";
      if (err === "invalid_grant" || err === "invalid_request" || reply.status === 401) {
        throw new SocialError("token_expired", reply.body?.error_description ?? err);
      }
      throw new SocialError("upstream", `refresh: ${err || reply.status}`);
    }
    return {
      ...tokens,
      accessToken: reply.body.access_token,
      refreshToken: reply.body.refresh_token ?? tokens.refreshToken,
      expiresAt: isoPlusSeconds(now, reply.body.expires_in ?? 86_400),
      issuedAt: now.toISOString(),
      userId: reply.body.open_id ?? tokens.userId,
    };
  },
};

/* ---------- sync ---------- */

interface TtEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string; log_id?: string };
}
interface TtUser {
  open_id?: string;
  display_name?: string;
  username?: string;
  avatar_url?: string;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
  profile_deep_link?: string;
}
export interface TtVideo {
  id: string;
  create_time?: number;
  title?: string;
  cover_image_url?: string;
  share_url?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  duration?: number;
}
interface TtVideoList {
  videos?: TtVideo[];
  cursor?: number;
  has_more?: boolean;
}

const EXPIRED = new Set(["access_token_invalid", "invalid_token", "token_expired"]);

function ttData<T>(reply: JsonReply<TtEnvelope<T>>, what: string): T {
  const code = reply.body?.error?.code;
  if (reply.ok && reply.body?.data && (!code || code === "ok")) return reply.body.data;
  const msg = `${what}: ${reply.body?.error?.message ?? code ?? reply.status}`;
  if (reply.status === 401 || (code && EXPIRED.has(code)))
    throw new SocialError("token_expired", msg);
  if (reply.status === 429 || code === "rate_limit_exceeded")
    throw new SocialError("rate_limited", msg);
  throw new SocialError("upstream", msg);
}

export function videoRow(v: TtVideo): PostRow {
  const row: PostRow = {
    platform: PLATFORM,
    postId: v.id,
    publishedAt: unixToRiyadhIso(v.create_time ?? 0),
    kind: "video",
    views: int(v.view_count),
    likes: int(v.like_count),
    comments: int(v.comment_count),
    shares: int(v.share_count),
  };
  const title = clip(v.title);
  if (title) row.title = title;
  if (v.share_url) row.permalink = v.share_url;
  if (v.cover_image_url) row.thumbUrl = v.cover_image_url;
  return row;
}

async function listVideos(http: Http, token: string): Promise<TtVideo[]> {
  const out: TtVideo[] = [];
  let cursor: number | undefined;
  for (let page = 0; page * PAGE < TT_VIDEOS_MAX; page++) {
    if (page > 0 && !http.budget.ok) break;
    const data = ttData(
      await fetchJson<TtEnvelope<TtVideoList>>(
        http,
        withQuery(`${TT_API}/video/list/`, {
          fields:
            "id,create_time,title,cover_image_url,share_url,view_count,like_count,comment_count,share_count,duration",
        }),
        {
          method: "POST",
          headers: bearer(token, { "Content-Type": "application/json" }),
          body: JSON.stringify({ max_count: PAGE, ...(cursor !== undefined ? { cursor } : {}) }),
        },
      ),
      "video.list",
    );
    out.push(...(data.videos ?? []));
    if (!data.has_more || data.cursor === undefined) break;
    cursor = data.cursor;
  }
  return out.slice(0, TT_VIDEOS_MAX);
}

export async function sync(tokens: TokenSet, ctx: SyncContext): Promise<SyncResult> {
  const { http, now, today } = ctx;
  const token = tokens.accessToken;

  const { user } = ttData(
    await fetchJson<TtEnvelope<{ user?: TtUser }>>(
      http,
      withQuery(`${TT_API}/user/info/`, {
        fields:
          "open_id,display_name,username,avatar_url,follower_count,following_count,likes_count,video_count,profile_deep_link",
      }),
      { headers: bearer(token) },
    ),
    "user.info",
  );
  const handle = user?.username || user?.display_name || user?.open_id || "";
  const videos = await listVideos(http, token);
  const posts = videos.filter((v) => v.id).map(videoRow);

  // TikTok reports lifetime views per video, not a 30-day account total: the closest figure is the sum
  // over the videos published in the last 30 days.
  const cutoff = now.getTime() - 30 * DAY_MS;
  const views30d = posts
    .filter((p) => Date.parse(p.publishedAt) >= cutoff)
    .reduce((s, p) => s + (p.views ?? 0), 0);

  return {
    account: {
      platform: PLATFORM,
      handle,
      url: user?.profile_deep_link ?? `https://www.tiktok.com/@${handle}`,
    },
    snapshot: {
      platform: PLATFORM,
      day: today,
      followers: int(user?.follower_count),
      views30d,
      totalPosts: int(user?.video_count),
    },
    posts,
    demographics: [],
  };
}
