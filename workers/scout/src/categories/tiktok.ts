/**
 * The TikTok tab's stored list (planning/tools/19-category-trends.md §6): TikTok's own Discovery API (TikTok API for
 * Business v1.3), read with the token of the owner's TikTok for Business app (tiktokads.ts) on every scan, cron, first
 * and forced alike: it costs nothing. Brave's index held TikTok topic pages, not single videos (live, Cars: 60 TikTok
 * links, 0 posts), and the owner said: "brave is not the answer then we need another solution".
 *
 * The popular hashtags in the country over 7 days (`trending_list`, TikTok's top 200 by rank) of the category's industry,
 * of SPECIAL_EFFECTS and of PHOTOGRAPHY: the owner saw general food videos on Food's tab and said "its not cool edits
 * trending videos", so edit hashtags come first (`pick`). Then one `video_list` call for the 10 picked's top 20
 * videos each. Hashtags select candidates only; at most12 public oEmbed captions are read, and only category-specific
 * creative metadata qualifies a recommendation. Missing/blocked captions leave fewer results, never filler.
 * 1 KV read, up to4 Business API calls and12 public oEmbed calls (cached when available).
 * Never throws.
 */

import { CALL_TIMEOUT_MS } from "../discover/fetchers";
import { isRecord } from "../effects/ai";
import { canonicalUrl, platformForHost } from "../normalize";
import { postedAt } from "../postDate";
import { readAdsToken, type TikTokAdsEnv } from "../tiktokads";
import { CATEGORY_PROFILES } from "../discover/category-profiles";
import { categoryCreativeEvidence, rankCategoryVideos } from "./quality";
import { answered, getJson, withParams, type Reply } from "./top";
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

/** The 2 industries whose popular hashtags are edit styles of any subject, asked besides the category's own. */
export const TT_EFFECTS = "SPECIAL_EFFECTS";
export const TT_PHOTO = "PHOTOGRAPHY";

/** `video_list` takes at most 10 hashtags. */
const HASHTAGS = 10;
/** Hard ceiling, three concurrent public oEmbed requests; Discovery hashtags never count as captions. */
export const TIKTOK_CAPTION_MAX = 12;
const CAPTION_TIMEOUT_MS = 4_000;
/** Prefer tags popular in the country; fewer than three permits other countries' subject-specific tags. */
const IN_COUNTRY_MIN = 3;
const DATE_RANGE = "7DAY";
const MESSAGE_MAX = 120;
/** The only TikTok link the app's player plays (lib/embed `embedId`): one video, with its creator's handle. */
const PLAYABLE = /^https:\/\/www\.tiktok\.com\/(@[\w.-]+)\/video\/(\d+)$/;

/** TikTok's list, or why there is none: `tiktok_auth` (not connected) or `tiktok` (TikTok failed: its code and message,
 * ≤ 120 characters, in `diagnostics`). `diagnostics` on success: { hashtags: [{ name, tier }] (the picked, in order),
 * lists: { industry, effects, photo } (how many hashtags each list held; null: that edit list failed), videos, raw (the
 * videos TikTok sent), country, industry }. */
export interface TikTokTop {
  videos?: TopVideo[];
  note?: "tiktok" | "tiktok_auth";
  diagnostics?: Record<string, unknown>;
}

type Hashtag = { id: string; name: string; rank: number; here: boolean };
/** 1: creative cue and category; 3: category only (still must pass caption evidence before recommending). */
type Tier = 1 | 3;
type Picked = Hashtag & { tier: Tier };

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

/** A list's hashtags; one without an id or a name is left out (it can't be asked or titled). */
function parse(list: unknown[], country: string): Hashtag[] {
  return list.flatMap((h): Hashtag[] => {
    if (!isRecord(h)) return [];
    const id =
      typeof h.hashtag_id === "string" || typeof h.hashtag_id === "number"
        ? String(h.hashtag_id)
        : "";
    const name = typeof h.hashtag_name === "string" ? h.hashtag_name.trim().replace(/^#/, "") : "";
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
  });
}

function tierOf(name: string, id: string): Tier | undefined {
  const evidence = categoryCreativeEvidence(id, name.replace(/_/g, " ") + ` #${name}`);
  return evidence.category ? (evidence.creative ? 1 : 3) : undefined;
}

/** At most10 subject-specific hashtags, creative ones first, then plain category tags. No unrelated fill tier. */
function pick(
  lists: { tags: unknown[]; editList: boolean }[],
  country: string,
  id: string,
): Picked[] {
  const best = new Map<string, Picked>();
  for (const { tags } of lists)
    for (const t of parse(tags, country)) {
      const tier = tierOf(t.name, id);
      const had = best.get(t.id);
      if (tier && (!had || tier < had.tier)) best.set(t.id, { ...t, tier });
    }
  const out: Picked[] = [];
  for (const tier of [1, 3]) {
    const tags = [...best.values()]
      .filter((t) => t.tier === tier)
      .sort((a, b) => (a.rank === b.rank ? 0 : a.rank - b.rank));
    const here = tags.filter((t) => t.here);
    out.push(...(here.length >= IN_COUNTRY_MIN ? here : [...here, ...tags.filter((t) => !t.here)]));
  }
  return out.slice(0, HASHTAGS);
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

/** Diversify the bounded caption-candidate pool before inspecting any caption, each video once. */
function inTurns(columns: { name: string; videos: unknown[] }[]): TopVideo[] {
  const out: TopVideo[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...columns.map((c) => c.videos.length));
  for (let i = 0; i < depth && out.length < TIKTOK_CAPTION_MAX; i++)
    for (const c of columns) {
      const v = tiktokVideo(c.videos[i], c.name);
      if (!v || seen.has(v.id) || out.length >= TIKTOK_CAPTION_MAX) continue;
      seen.add(v.id);
      out.push(v.video);
    }
  return out;
}

/** Reuses /oembed's normalized public cache entries and its six-hour TikTok TTL. Never sends the Business token.
 * A cache/network error rejects this candidate rather than recommending a hashtag-labelled unknown video. */
async function caption(
  video: TopVideo,
  doFetch: typeof fetch,
  timeoutMs: number,
  cache: Cache | null,
): Promise<TopVideo | undefined> {
  const endpoint = `https://www.tiktok.com/oembed?url=${encodeURIComponent(video.url)}`;
  const key = new Request(endpoint, { method: "GET" });
  let data: Record<string, unknown> | undefined;
  try {
    const hit = await cache?.match(key);
    const body: unknown = await hit?.json();
    if (isRecord(body) && typeof body.title === "string" && body.url === video.url) data = body;
  } catch {
    /* Missing/corrupt cache entries are fetched again. */
  }
  if (!data) {
    const reply = await getJson(
      doFetch,
      endpoint,
      { Accept: "application/json" },
      Math.min(timeoutMs, CAPTION_TIMEOUT_MS),
    );
    if (!answered(reply) || typeof reply.body.title !== "string") return undefined;
    data = {
      title: reply.body.title,
      author: video.creator ?? "",
      thumb: reply.body.thumbnail_url ?? "",
      url: video.url,
    };
    try {
      await cache?.put(
        key,
        new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=21600" },
        }),
      );
    } catch {
      /* Cache writes are optional; the caption is still usable. */
    }
  }
  const title = String(data.title)
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 1200);
  if (!title) return undefined;
  const publishedAt = postedAt(video.url);
  return {
    ...video,
    title: title.slice(0, 160),
    snippet: title,
    source: "tiktok-discovery",
    ...(typeof data.thumb === "string" && data.thumb.startsWith("https://")
      ? { thumbnail: data.thumb }
      : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}

const defaultCache = (): Cache | null => (typeof caches === "undefined" ? null : caches.default);

/** The category's TikTok list (`id` is a built-in category: each has its industry). */
export async function tiktokTop(
  env: TikTokAdsEnv,
  doFetch: typeof fetch,
  id: string,
  timeoutMs = CALL_TIMEOUT_MS,
  cache: Cache | null = defaultCache(),
): Promise<TikTokTop> {
  try {
    const token = await readAdsToken(env);
    const advertiser = token?.advertiser_ids[0];
    if (!token || !advertiser) return { note: "tiktok_auth" };
    const country = countryOf(env);
    const industry = TIKTOK_INDUSTRY[id];
    if (!industry || !CATEGORY_PROFILES[id]) return { videos: [] };
    const headers = { Accept: "application/json", "Access-Token": token.access_token };
    const asked = {
      advertiser_id: advertiser,
      discovery_type: "HASHTAG",
      country_code: country,
      date_range: DATE_RANGE,
    };
    const [trending, effects, photo] = await Promise.all(
      [industry, TT_EFFECTS, TT_PHOTO].map((category_name) =>
        getJson(
          doFetch,
          withParams(TT_TRENDING_URL, { ...asked, category_name }),
          headers,
          timeoutMs,
        ),
      ),
    );
    const hashtags = listOf(trending);
    if (!hashtags) return failure(trending, token.access_token);
    // An edit list failing is left out: the industry's list still makes a tab.
    const effectTags = listOf(effects);
    const photoTags = listOf(photo);
    const picked = pick(
      [
        { tags: hashtags, editList: false },
        { tags: effectTags ?? [], editList: true },
        { tags: photoTags ?? [], editList: true },
      ],
      country,
      id,
    );
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
      // The picked order, whatever order TikTok answers in.
      columns = picked.map((h) => ({ name: h.name, videos: byId.get(h.id) ?? [] }));
    }
    const candidates = inTurns(columns);
    const captioned: TopVideo[] = [];
    for (let i = 0; i < candidates.length; i += 3) {
      const batch = await Promise.all(
        candidates.slice(i, i + 3).map((v) => caption(v, doFetch, timeoutMs, cache)),
      );
      captioned.push(...batch.filter((v): v is TopVideo => !!v));
    }
    const videos = rankCategoryVideos(id, captioned);
    return {
      videos,
      diagnostics: {
        hashtags: picked.map((h) => ({ name: h.name, tier: h.tier })),
        lists: {
          industry: hashtags.length,
          effects: effectTags?.length ?? null,
          photo: photoTags?.length ?? null,
        },
        videos: videos.length,
        captionCandidates: candidates.length,
        captioned: captioned.length,
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
