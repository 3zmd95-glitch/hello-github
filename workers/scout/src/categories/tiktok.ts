/**
 * The TikTok tab's stored list (planning/tools/19-category-trends.md §6): TikTok's own Discovery API (TikTok API for
 * Business v1.3), read with the token of the owner's TikTok for Business app (tiktokads.ts) on every scan, cron, first
 * and forced alike: it costs nothing. Brave's index held TikTok topic pages, not single videos (live, Cars: 60 TikTok
 * links, 0 posts), and the owner said: "brave is not the answer then we need another solution".
 *
 * The popular hashtags of the category's industry in the country over 7 days (`trending_list`, TikTok's top 200 by
 * rank), the 10 best-ranked popular in the country, then one `video_list` call for their top 20 videos each (ranked by
 * TikTok on views, comments, likes and shares), taken in turns into ≤ 50: each hashtag's 1st video in rank order, then
 * its 2nd… each video once. TikTok sends no caption or counts: a video is titled with its hashtag, and the page's
 * TikTok oEmbed lookup brings its caption and thumbnail. 1 KV read and 2 calls a scan. Never throws.
 */

import { CALL_TIMEOUT_MS } from "../discover/fetchers";
import { isRecord } from "../effects/ai";
import { canonicalUrl, platformForHost } from "../normalize";
import { readAdsToken, type TikTokAdsEnv } from "../tiktokads";
import { answered, getJson, TOP_MAX, withParams, type Reply } from "./top";
import type { TopVideo } from "./types";

export const TT_TRENDING_URL =
  "https://business-api.tiktok.com/open_api/v1.3/discovery/trending_list/";
export const TT_VIDEOS_URL = "https://business-api.tiktok.com/open_api/v1.3/discovery/video_list/";

/** Each category's TikTok industry (`category_name`), level 2 where one fits. */
export const TIKTOK_INDUSTRY: Readonly<Record<string, string>> = {
  cars: "AUTOMOTIVE",
  food: "FOOD",
  anime: "ANIMATION_AND_COMICS",
  travel: "GENERAL_TRAVEL",
  football: "CONVENTIONAL_AND_MAINSTREAM_SPORTS",
  coffee: "DRINKS",
  perfume: "BEAUTY",
  camping: "OUTDOOR_RECREATION",
  fashion: "OUTFITS",
  gaming: "VIDEO_GAMES",
  weddings: "ROMANCE",
  gym: "EXERCISE_AND_FITNESS",
};

/** `video_list` takes at most 10 hashtags. */
const HASHTAGS = 10;
/** Fewer of them popular in the country than this, and the others fill in by rank (3 × 20 videos cover the 50). */
const IN_COUNTRY_MIN = 3;
const DATE_RANGE = "7DAY";
const MESSAGE_MAX = 120;
/** The only TikTok link the app's player plays (lib/embed `embedId`): one video, with its creator's handle. */
const PLAYABLE = /^https:\/\/www\.tiktok\.com\/(@[\w.-]+)\/video\/(\d+)$/;

/** TikTok's list, or why there is none: `tiktok_auth` (not connected) or `tiktok` (TikTok failed: its code and message,
 * ≤ 120 characters, in `diagnostics`). `diagnostics` on success: { hashtags, videos, raw (the videos TikTok sent),
 * country, industry }. */
export interface TikTokTop {
  videos?: TopVideo[];
  note?: "tiktok" | "tiktok_auth";
  diagnostics?: Record<string, unknown>;
}

type Hashtag = { id: string; name: string; rank: number; here: boolean };

/** TIKTOK_DISCOVERY_COUNTRY when it is a 2-letter code, else US (English first, global). */
function countryOf(env: TikTokAdsEnv): string {
  const c = env.TIKTOK_DISCOVERY_COUNTRY?.trim().toUpperCase();
  return c && /^[A-Z]{2}$/.test(c) ? c : "US";
}

/** `data.list` of an answer with `code: 0` ([] when it has none); undefined for any other answer. */
const listOf = (r: Reply): unknown[] | undefined =>
  answered(r) && r.body.code === 0
    ? isRecord(r.body.data) && Array.isArray(r.body.data.list)
      ? r.body.data.list
      : []
    : undefined;

/** TikTok's failure as the diagnostics keep it: its code and message, else the HTTP status. Never the token. */
function failure(r: Reply, token: string): TikTokTop {
  const body = isRecord(r.body) ? r.body : {};
  const message =
    typeof body.message === "string"
      ? body.message.split(token).join("…")
      : r.status
        ? `HTTP ${r.status}`
        : "no answer";
  return {
    note: "tiktok",
    diagnostics: {
      code: typeof body.code === "number" ? body.code : r.status,
      message: message.slice(0, MESSAGE_MAX),
    },
  };
}

/** The hashtags to ask videos of: by rank, the 10 best popular in the country; with fewer than 3 there, the others
 * fill in by rank. A hashtag without an id or a name is left out (it can't be asked or titled). */
function pick(list: unknown[], country: string): Hashtag[] {
  const tags = list
    .flatMap((h): Hashtag[] => {
      if (!isRecord(h)) return [];
      const id =
        typeof h.hashtag_id === "string" || typeof h.hashtag_id === "number"
          ? String(h.hashtag_id)
          : "";
      const name =
        typeof h.hashtag_name === "string" ? h.hashtag_name.trim().replace(/^#/, "") : "";
      const rank = Number(h.rank_position ?? NaN);
      const countries = Array.isArray(h.top_country_list) ? h.top_country_list : [];
      return id && name
        ? [
            {
              id,
              name,
              rank: Number.isFinite(rank) ? rank : Infinity,
              here: countries.includes(country),
            },
          ]
        : [];
    })
    .sort((a, b) => (a.rank === b.rank ? 0 : a.rank - b.rank));
  const here = tags.filter((t) => t.here);
  return (here.length >= IN_COUNTRY_MIN ? here : [...here, ...tags.filter((t) => !t.here)]).slice(
    0,
    HASHTAGS,
  );
}

/** One of TikTok's videos as a top video: its share link without the query, kept only when it is an https tiktok.com
 * link to one video with its creator's handle (no `/@/video/<id>` is made up for one without: the player refuses it). */
function tiktokVideo(x: unknown, hashtag: string): { id: string; video: TopVideo } | undefined {
  if (!isRecord(x) || typeof x.share_url !== "string") return undefined;
  let u: URL;
  try {
    u = new URL(x.share_url);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" || platformForHost(u.hostname) !== "tt") return undefined;
  const m = canonicalUrl("tt", u).match(PLAYABLE);
  if (!m) return undefined;
  const id = typeof x.video_id === "string" && x.video_id ? x.video_id : m[2];
  return { id, video: { url: m[0], title: `#${hashtag}`, creator: m[1] } };
}

/** Each hashtag's 1st video in rank order, then its 2nd…, each video once, ≤ 50. */
function inTurns(columns: { name: string; videos: unknown[] }[]): TopVideo[] {
  const out: TopVideo[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...columns.map((c) => c.videos.length));
  for (let i = 0; i < depth && out.length < TOP_MAX; i++)
    for (const c of columns) {
      const v = tiktokVideo(c.videos[i], c.name);
      if (!v || seen.has(v.id) || out.length >= TOP_MAX) continue;
      seen.add(v.id);
      out.push(v.video);
    }
  return out;
}

/** The category's TikTok list (`id` is a built-in category: each has its industry). */
export async function tiktokTop(
  env: TikTokAdsEnv,
  doFetch: typeof fetch,
  id: string,
  timeoutMs = CALL_TIMEOUT_MS,
): Promise<TikTokTop> {
  try {
    const token = await readAdsToken(env);
    const advertiser = token?.advertiser_ids[0];
    if (!token || !advertiser) return { note: "tiktok_auth" };
    const country = countryOf(env);
    const industry = TIKTOK_INDUSTRY[id];
    const headers = { Accept: "application/json", "Access-Token": token.access_token };
    const asked = {
      advertiser_id: advertiser,
      discovery_type: "HASHTAG",
      country_code: country,
      date_range: DATE_RANGE,
    };
    const trending = await getJson(
      doFetch,
      withParams(TT_TRENDING_URL, { ...asked, category_name: industry }),
      headers,
      timeoutMs,
    );
    const hashtags = listOf(trending);
    if (!hashtags) return failure(trending, token.access_token);
    const picked = pick(hashtags, country);
    let columns: { name: string; videos: unknown[] }[] = [];
    if (picked.length) {
      const found = await getJson(
        doFetch,
        withParams(TT_VIDEOS_URL, {
          ...asked,
          hashtag_ids: JSON.stringify(picked.map((h) => h.id)),
        }),
        headers,
        timeoutMs,
      );
      const lists = listOf(found);
      if (!lists) return failure(found, token.access_token);
      const byId = new Map<string, unknown[]>();
      for (const e of lists)
        if (isRecord(e) && Array.isArray(e.top_video_list))
          byId.set(String(e.hashtag_id), e.top_video_list);
      // The rank order, whatever order TikTok answers in.
      columns = picked.map((h) => ({ name: h.name, videos: byId.get(h.id) ?? [] }));
    }
    const videos = inTurns(columns);
    return {
      videos,
      diagnostics: {
        hashtags: picked.length,
        videos: videos.length,
        raw: columns.reduce((n, c) => n + c.videos.length, 0),
        country,
        industry,
      },
    };
  } catch (e) {
    // The token's KV read failing, or a code error: the last list stays. No message here carries the token.
    const message = e instanceof Error ? e.message : String(e);
    return { note: "tiktok", diagnostics: { code: 0, message: message.slice(0, MESSAGE_MAX) } };
  }
}
