/**
 * YouTube Data API v3 + YouTube Analytics API v2 (Google Cloud project, OAuth client "Web application").
 * Docs: https://developers.google.com/youtube/v3 · https://developers.google.com/youtube/analytics
 *
 * OAuth (PKCE S256, offline access for a refresh token)
 *   authorize   https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent&include_granted_scopes=true
 *               scopes https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly
 *   token       POST https://oauth2.googleapis.com/token (authorization_code, refresh_token)
 * Sync
 *   GET https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true
 *   GET https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=<uploads>&maxResults=50
 *   GET https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=<≤50 ids>
 *   GET https://youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&metrics=views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained&dimensions=creatorContentType
 *   GET …/reports?metrics=viewerPercentage&dimensions=ageGroup,gender
 *   GET …/reports?metrics=views&dimensions=country&sort=-views
 */

import {
  fetchJson,
  formPost,
  int,
  num2,
  percentages,
  bearer,
  withQuery,
  type Http,
  type JsonReply,
} from "./http";
import { isExpired, isoPlusSeconds, type ProviderAuth, type ProviderCreds } from "./oauth";
import type { SyncContext } from "./sync";
import { addDays, riyadhIso } from "./time";
import {
  SocialError,
  type DemographicRow,
  type PostRow,
  type SyncResult,
  type TokenSet,
} from "./types";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const YT_API = "https://www.googleapis.com/youtube/v3";
export const YT_ANALYTICS_URL = "https://youtubeanalytics.googleapis.com/v2/reports";
export const YT_SCOPES =
  "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly";
/** Access tokens last an hour; refreshed when less than this is left. */
export const YT_REFRESH_MARGIN_MS = 5 * 60_000;
/** Videos up to this long count as Shorts (the Data API has no explicit flag). */
export const SHORT_MAX_S = 180;
export const YT_VIDEOS_MAX = 100;
/** Audience breakdowns are taken over this many trailing days. */
export const YT_DEMOGRAPHICS_DAYS = 90;
const PLATFORM = "youtube" as const;

interface GoogleToken {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

export const auth: ProviderAuth = {
  scopes: YT_SCOPES,
  pkce: true,
  authorizeUrl(
    creds: ProviderCreds,
    redirectUri: string,
    state: string,
    challenge?: string,
  ): string {
    return withQuery(GOOGLE_AUTHORIZE_URL, {
      client_id: creds.id,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: YT_SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
      code_challenge: challenge,
      code_challenge_method: challenge ? "S256" : undefined,
    });
  },
  async exchange(creds, code, redirectUri, verifier, http, now): Promise<TokenSet> {
    const reply = await fetchJson<GoogleToken>(
      http,
      GOOGLE_TOKEN_URL,
      formPost({
        code,
        client_id: creds.id,
        client_secret: creds.secret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        ...(verifier ? { code_verifier: verifier } : {}),
      }),
    );
    if (!reply.ok || !reply.body?.access_token) {
      const why = [reply.body?.error ?? `status ${reply.status}`, reply.body?.error_description];
      throw new SocialError("exchange_failed", why.filter(Boolean).join(" · "));
    }
    return {
      accessToken: reply.body.access_token,
      refreshToken: reply.body.refresh_token,
      expiresAt: isoPlusSeconds(now, reply.body.expires_in ?? 3600),
      issuedAt: now.toISOString(),
      scope: reply.body.scope,
    };
  },
  needsRefresh(tokens, now): boolean {
    return isExpired(tokens, now, YT_REFRESH_MARGIN_MS);
  },
  async refresh(creds, tokens, http, now): Promise<TokenSet> {
    if (!tokens.refreshToken) throw new SocialError("token_expired", "no refresh token");
    const reply = await fetchJson<GoogleToken>(
      http,
      GOOGLE_TOKEN_URL,
      formPost({
        client_id: creds.id,
        client_secret: creds.secret,
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }),
    );
    if (!reply.ok || !reply.body?.access_token) {
      // invalid_grant: revoked, or a Testing-mode consent screen's 7-day refresh token ran out.
      if (reply.body?.error === "invalid_grant" || reply.status === 400 || reply.status === 401) {
        throw new SocialError("token_expired", reply.body?.error_description ?? reply.body?.error);
      }
      throw new SocialError("upstream", `refresh: ${reply.body?.error ?? reply.status}`);
    }
    return {
      ...tokens,
      accessToken: reply.body.access_token,
      refreshToken: reply.body.refresh_token ?? tokens.refreshToken,
      expiresAt: isoPlusSeconds(now, reply.body.expires_in ?? 3600),
      issuedAt: now.toISOString(),
    };
  },
};

/* ---------- sync ---------- */

interface GoogleError {
  error?: { code?: number; message?: string; errors?: { reason?: string }[]; status?: string };
}
interface ChannelsList extends GoogleError {
  items?: {
    id?: string;
    snippet?: { title?: string; customUrl?: string };
    statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }[];
}
interface PlaylistItems extends GoogleError {
  items?: { contentDetails?: { videoId?: string } }[];
  nextPageToken?: string;
}
export interface YtVideo {
  id: string;
  snippet?: {
    publishedAt?: string;
    title?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}
interface VideosList extends GoogleError {
  items?: YtVideo[];
}
interface Report extends GoogleError {
  columnHeaders?: { name?: string }[];
  rows?: (string | number)[][];
}

const RATE_REASONS = new Set(["quotaExceeded", "rateLimitExceeded", "userRateLimitExceeded"]);

function googleBody<T extends GoogleError>(reply: JsonReply<T>, what: string): T {
  if (reply.ok && reply.body && !reply.body.error) return reply.body;
  const err = reply.body?.error;
  const reason = err?.errors?.[0]?.reason;
  if (reply.status === 401)
    throw new SocialError("token_expired", `${what}: ${err?.message ?? 401}`);
  if (reply.status === 429 || (reason && RATE_REASONS.has(reason))) {
    throw new SocialError("rate_limited", `${what}: ${err?.message ?? reply.status}`);
  }
  throw new SocialError("upstream", `${what}: ${err?.message ?? reply.status}`);
}

/** ISO 8601 duration ("PT1M5S", "PT2H3M") → seconds. */
export function durationSeconds(iso: string | undefined): number {
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => (x ? Number(x) : 0));
  return d * 86_400 + h * 3600 + mi * 60 + s;
}

export function videoRow(v: YtVideo): PostRow {
  const seconds = durationSeconds(v.contentDetails?.duration);
  const row: PostRow = {
    platform: PLATFORM,
    postId: v.id,
    publishedAt: riyadhIso(v.snippet?.publishedAt ?? 0),
    kind: seconds > 0 && seconds <= SHORT_MAX_S ? "short" : "video",
    views: int(v.statistics?.viewCount),
    likes: int(v.statistics?.likeCount),
    comments: int(v.statistics?.commentCount),
    permalink: `https://www.youtube.com/watch?v=${v.id}`,
  };
  if (v.snippet?.title) row.title = v.snippet.title.slice(0, 120);
  const thumb = v.snippet?.thumbnails?.medium?.url ?? v.snippet?.thumbnails?.default?.url;
  if (thumb) row.thumbUrl = thumb;
  return row;
}

/** Column index by header name, so metric order in the request does not matter. */
function col(report: Report, name: string): number {
  return report.columnHeaders?.findIndex((h) => h.name === name) ?? -1;
}

async function report(
  http: Http,
  token: string,
  params: Record<string, string | number | undefined>,
): Promise<Report | null> {
  if (!http.budget.ok) return null;
  const reply = await fetchJson<Report>(
    http,
    withQuery(YT_ANALYTICS_URL, { ids: "channel==MINE", ...params }),
    {
      headers: bearer(token),
    },
  );
  try {
    return googleBody(reply, "analytics");
  } catch (e) {
    // Analytics is optional (the API may not be enabled yet); only a dead token stops the sync.
    if (e instanceof SocialError && e.code === "token_expired") throw e;
    return null;
  }
}

/** "age18-24" → "18-24", "age65-" → "65+". */
export function ageBucket(raw: string): string {
  const s = raw.replace(/^age/, "");
  return s.endsWith("-") ? `${s.slice(0, -1)}+` : s;
}

export async function sync(tokens: TokenSet, ctx: SyncContext): Promise<SyncResult> {
  const { http, today } = ctx;
  const token = tokens.accessToken;
  const headers = { headers: bearer(token) };

  const channels = googleBody(
    await fetchJson<ChannelsList>(
      http,
      withQuery(`${YT_API}/channels`, { part: "snippet,statistics,contentDetails", mine: "true" }),
      headers,
    ),
    "channels",
  );
  const ch = channels.items?.[0];
  if (!ch?.id) throw new SocialError("upstream", "channels: no channel for this account");
  const custom = ch.snippet?.customUrl?.replace(/^@/, "");
  const handle = custom || ch.snippet?.title || ch.id;
  const url = custom
    ? `https://www.youtube.com/@${custom}`
    : `https://www.youtube.com/channel/${ch.id}`;
  const followers = int(ch.statistics?.subscriberCount);

  // Uploads playlist → newest video ids (two pages of 50).
  const ids: string[] = [];
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  let pageToken: string | undefined;
  for (let page = 0; uploads && page < 2 && ids.length < YT_VIDEOS_MAX; page++) {
    if (page > 0 && (!pageToken || !http.budget.ok)) break;
    const body = googleBody(
      await fetchJson<PlaylistItems>(
        http,
        withQuery(`${YT_API}/playlistItems`, {
          part: "contentDetails",
          playlistId: uploads,
          maxResults: 50,
          pageToken,
        }),
        headers,
      ),
      "playlistItems",
    );
    for (const it of body.items ?? [])
      if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
    pageToken = body.nextPageToken;
  }

  const posts: PostRow[] = [];
  for (let i = 0; i < ids.length && i < YT_VIDEOS_MAX; i += 50) {
    if (!http.budget.ok) break;
    const body = googleBody(
      await fetchJson<VideosList>(
        http,
        withQuery(`${YT_API}/videos`, {
          part: "snippet,statistics,contentDetails",
          id: ids.slice(i, i + 50).join(","),
          maxResults: 50,
        }),
        headers,
      ),
      "videos",
    );
    for (const v of body.items ?? []) if (v.id) posts.push(videoRow(v));
  }

  // Analytics: trailing 30 days split by content type (watch times are per-view averages in seconds).
  let views30d: number | undefined;
  let avgVideoWatchTime: number | undefined;
  let avgShortsWatchTime: number | undefined;
  const totals = await report(http, token, {
    startDate: addDays(today, -30),
    endDate: today,
    metrics:
      "views,estimatedMinutesWatched,averageViewDuration,likes,comments,shares,subscribersGained",
    dimensions: "creatorContentType",
  });
  if (totals) {
    const cType = col(totals, "creatorContentType");
    const cViews = col(totals, "views");
    const cAvg = col(totals, "averageViewDuration");
    views30d = 0;
    for (const row of totals.rows ?? []) {
      views30d += int(row[cViews]);
      if (row[cType] === "SHORTS") avgShortsWatchTime = num2(row[cAvg]);
      if (row[cType] === "VIDEO_ON_DEMAND") avgVideoWatchTime = num2(row[cAvg]);
    }
  }

  const demographics: DemographicRow[] = [];
  const demoStart = addDays(today, -YT_DEMOGRAPHICS_DAYS);
  const ages = await report(http, token, {
    startDate: demoStart,
    endDate: today,
    metrics: "viewerPercentage",
    dimensions: "ageGroup,gender",
  });
  if (ages?.rows?.length) {
    const cAge = col(ages, "ageGroup");
    const cGender = col(ages, "gender");
    const cPct = col(ages, "viewerPercentage");
    const byAge = new Map<string, number>();
    const byGender = new Map<"male" | "female", number>();
    for (const row of ages.rows) {
      const age = ageBucket(String(row[cAge]));
      const gender = String(row[cGender]);
      const pct = num2(row[cPct]);
      byAge.set(age, (byAge.get(age) ?? 0) + pct);
      if (gender === "male" || gender === "female") {
        byGender.set(gender, (byGender.get(gender) ?? 0) + pct);
        demographics.push({
          platform: PLATFORM,
          day: today,
          dimension: "age",
          key: age,
          pct,
          gender,
        });
      }
    }
    for (const [key, pct] of byGender) {
      demographics.push({
        platform: PLATFORM,
        day: today,
        dimension: "gender",
        key,
        pct: num2(pct),
      });
    }
    for (const [key, pct] of byAge) {
      demographics.push({ platform: PLATFORM, day: today, dimension: "age", key, pct: num2(pct) });
    }
  }
  const countries = await report(http, token, {
    startDate: demoStart,
    endDate: today,
    metrics: "views",
    dimensions: "country",
    sort: "-views",
    maxResults: 25,
  });
  if (countries?.rows?.length) {
    const cCountry = col(countries, "country");
    const cViews = col(countries, "views");
    const rows = countries.rows.map((r) => ({ key: String(r[cCountry]), value: int(r[cViews]) }));
    for (const r of percentages(rows)) {
      demographics.push({
        platform: PLATFORM,
        day: today,
        dimension: "country",
        key: r.key,
        pct: r.pct,
      });
    }
  }

  return {
    account: { platform: PLATFORM, handle, url },
    snapshot: {
      platform: PLATFORM,
      day: today,
      followers,
      ...(views30d !== undefined ? { views30d } : {}),
      totalPosts: int(ch.statistics?.videoCount),
      ...(avgVideoWatchTime !== undefined ? { avgVideoWatchTime } : {}),
      ...(avgShortsWatchTime !== undefined ? { avgShortsWatchTime } : {}),
    },
    posts,
    demographics,
  };
}
