/**
 * `GET /tiktokads/music-probe?country=SA|US&range=7|30` (Bearer): a read-only live check of what TikTok's Discovery API
 * answers about trending music with the owner's TikTok for Business token (tiktokads.ts). It writes nothing.
 *
 * TikTok's docs (checked 2026-10-15 at business-api.tiktok.com/portal/docs):
 * - Music lives at `/discovery/cml/trending_list/` (id=1825119063013505): up to 100 Commercial Music Library tracks,
 *   `business_id` + `genre` (ALL) + `country_code` + `date_range` (1DAY|7DAY|30DAY|90DAY). It asks a TikTok *account*
 *   token (`/tt_user/oauth2/token/`, `business_id` = its `open_id`), not the advertiser token we keep, so attempt 1 is
 *   expected to fail; its code and message say how.
 * - `/discovery/trending_list/` (id=1825119032526849): "Currently, we only support `HASHTAG`". Attempts 2 and 3 ask
 *   the undocumented `MUSIC` and `SONG` once each, to see it live.
 * - Attempt 4 is documented and works with our token: the popular hashtags of the `MUSIC` industry (song names often).
 * 4 calls, in parallel, one KV read. Every failure is data, never a throw. The token is never in the answer.
 */

import { CALL_TIMEOUT_MS } from "./discover/fetchers";
import { isRecord } from "./effects/ai";
import { getJson, withParams, type Reply } from "./categories/top";
import { TT_TRENDING_URL } from "./categories/tiktok";
import { readAdsToken, type TikTokAdsEnv } from "./tiktokads";

export const TT_CML_TRENDING_URL =
  "https://business-api.tiktok.com/open_api/v1.3/discovery/cml/trending_list/";
const COUNTRIES = ["SA", "US"];
const RANGES: Record<string, string> = { "7": "7DAY", "30": "30DAY" };
const ITEMS = 10;
const MESSAGE_MAX = 200;
/** Stands in for the advertiser id in the answer's params. */
const ADVERTISER = "<advertiser_id>";

const str = (x: unknown) =>
  typeof x === "string" ? x : typeof x === "number" ? String(x) : undefined;

/** One item, track or hashtag, as the probe shows it; `keys` tells an unknown shape. */
function item(x: unknown): Record<string, unknown> {
  if (!isRecord(x)) return { raw: typeof x };
  const history = Array.isArray(x.trending_history) ? x.trending_history : undefined;
  const clip = (c: unknown) => (isRecord(c) ? str(c.song_clip_id) : undefined);
  return {
    rank: str(x.rank_position),
    title: str(x.commercial_music_name ?? x.hashtag_name ?? x.title ?? x.name),
    artist: str(x.artist),
    id: str(x.commercial_music_id ?? x.hashtag_id ?? x.id),
    genres: Array.isArray(x.genres) ? x.genres : undefined,
    rankChange: x.rank_change,
    posts: x.posts,
    views: x.views,
    previewUrl: str(x.preview_url),
    thumbnailUrl: str(x.thumbnail_url),
    trendingClipId: clip(x.trending_song_clip),
    fullClipId: clip(x.full_duration_song_clip),
    // The last 7 days of the up-to-30 TikTok sends.
    history: history?.slice(-7),
    keys: Object.keys(x).slice(0, 20),
  };
}

function attempt(
  name: string,
  endpoint: string,
  params: Record<string, string>,
  r: Reply,
  token: string,
) {
  const body = isRecord(r.body) ? r.body : {};
  const data = isRecord(body.data) ? body.data : {};
  const list = Array.isArray(data.list) ? data.list : [];
  return {
    name,
    endpoint,
    params,
    status: r.status,
    code: typeof body.code === "number" ? body.code : null,
    message:
      typeof body.message === "string"
        ? body.message.split(token).join("…").slice(0, MESSAGE_MAX)
        : null,
    count: list.length,
    items: list.slice(0, ITEMS).map(item),
  };
}

export async function musicProbe(
  req: Request,
  env: TikTokAdsEnv,
  doFetch: typeof fetch,
  now: Date,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const q = new URL(req.url).searchParams;
  const country = (q.get("country") ?? "US").toUpperCase();
  const dateRange = RANGES[q.get("range") ?? "7"];
  if (!COUNTRIES.includes(country) || !dateRange)
    return { status: 400, body: { error: "bad_request" } };
  const fetchedAt = now.toISOString();
  let token;
  try {
    token = await readAdsToken(env);
  } catch {
    return { status: 502, body: { error: "upstream", fetchedAt } };
  }
  const advertiser = token?.advertiser_ids[0];
  if (!token || !advertiser) return { status: 409, body: { error: "not_connected", fetchedAt } };

  const plan: { name: string; url: string; params: Record<string, string> }[] = [
    {
      name: "cml_trending_list",
      url: TT_CML_TRENDING_URL,
      params: {
        business_id: ADVERTISER,
        genre: "ALL",
        country_code: country,
        date_range: dateRange,
      },
    },
    ...["MUSIC", "SONG"].map((type) => ({
      name: `trending_list_${type}`,
      url: TT_TRENDING_URL,
      params: {
        advertiser_id: ADVERTISER,
        discovery_type: type,
        country_code: country,
        date_range: dateRange,
      },
    })),
    {
      name: "trending_list_HASHTAG_MUSIC",
      url: TT_TRENDING_URL,
      params: {
        advertiser_id: ADVERTISER,
        discovery_type: "HASHTAG",
        category_name: "MUSIC",
        country_code: country,
        date_range: dateRange,
      },
    },
  ];
  const headers = { Accept: "application/json", "Access-Token": token.access_token };
  const attempts = await Promise.all(
    plan.map(async (p) => {
      const real = Object.fromEntries(
        Object.entries(p.params).map(([k, v]) => [k, v === ADVERTISER ? advertiser : v]),
      );
      const r = await getJson(doFetch, withParams(p.url, real), headers, timeoutMs);
      return attempt(p.name, p.url, p.params, r, token.access_token);
    }),
  );
  return { status: 200, body: { country, dateRange, fetchedAt, attempts } };
}
