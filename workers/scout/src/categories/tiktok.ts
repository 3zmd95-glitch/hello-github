/**
 * The TikTok tab's stored list (planning/tools/19-category-trends.md §6): TikTok's own Discovery API (TikTok API for
 * Business v1.3), read with the token of the owner's TikTok for Business app (tiktokads.ts) on every scan, cron, first
 * and forced alike: it costs nothing. Brave's index held TikTok topic pages, not single videos (live, Cars: 60 TikTok
 * links, 0 posts), and the owner said: "brave is not the answer then we need another solution".
 *
 * The popular hashtags in the country over 7 days (`trending_list`, TikTok's top 200 by rank) of the category's industry,
 * of SPECIAL_EFFECTS and of PHOTOGRAPHY: the owner saw general food videos on Food's tab and said "its not cool edits
 * trending videos", so edit hashtags come first (`pick`). Then one `video_list` call for the 10 picked's top 20
 * videos each (ranked by TikTok on views, comments, likes and shares), taken in turns into ≤ 50: each hashtag's 1st
 * video in the picked order, then its 2nd… each video once. TikTok sends no caption or counts: a video is titled with
 * its hashtag, and the page's TikTok oEmbed lookup brings its caption and thumbnail. 1 KV read and 4 calls a scan.
 * Never throws.
 */

import { CALL_TIMEOUT_MS } from "../discover/fetchers";
import { isRecord } from "../effects/ai";
import { canonicalUrl, platformForHost } from "../normalize";
import { readAdsToken, type TikTokAdsEnv } from "../tiktokads";
import { categoryById, categoryWords } from "./defs";
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

/** The 2 industries whose popular hashtags are edit styles of any subject, asked besides the category's own. */
export const TT_EFFECTS = "SPECIAL_EFFECTS";
export const TT_PHOTO = "PHOTOGRAPHY";

/** Words that mark an edit video's hashtag, found anywhere in its name (hashtags have no spaces: "foodedit").
 * ponytail: substring match, so "shot" also hits "screenshot"; a word list per cue if that shows up live. */
const EDIT_CUES: readonly string[] = [
  "edit",
  "edits",
  "editing",
  "cinematic",
  "videography",
  "broll",
  "transition",
  "transitions",
  "aesthetic",
  "montage",
  "effect",
  "effects",
  "asmr",
  "slowmo",
  "slowmotion",
  "timelapse",
  "hyperlapse",
  "pov",
  "filmmaking",
  "shot",
  "shots",
  "reel",
  "visuals",
];

/** `video_list` takes at most 10 hashtags. */
const HASHTAGS = 10;
/** Fewer of a tier popular in the country than this, and its others fill in by rank (3 × 20 videos cover the 50). */
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
/** 1: an edit cue and a subject word; 2: an edit cue, from an edit list; 3: a subject word. */
type Tier = 1 | 2 | 3;
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

function tierOf(name: string, subject: string[], editList: boolean): Tier | undefined {
  const n = name.toLowerCase();
  const cue = EDIT_CUES.some((c) => n.includes(c));
  const about = subject.some((w) => n.includes(w));
  return cue && about ? 1 : cue && editList ? 2 : about ? 3 : undefined;
}

/** The hashtags to ask videos of, ≤ 10: tier 1, then 2, then 3 (`Tier`), each hashtag once in its best tier. In each
 * tier by rank, the ones popular in the country; with fewer than 3 there, the tier's others fill in by rank. A hashtag
 * with neither an edit cue nor a subject word is left out ("Trunk or Treat" on Food's tab). */
function pick(
  lists: { tags: unknown[]; editList: boolean }[],
  country: string,
  subject: string[],
): Picked[] {
  const best = new Map<string, Picked>();
  for (const { tags, editList } of lists)
    for (const t of parse(tags, country)) {
      const tier = tierOf(t.name, subject, editList);
      const had = best.get(t.id);
      if (tier && (!had || tier < had.tier)) best.set(t.id, { ...t, tier });
    }
  const out: Picked[] = [];
  for (const tier of [1, 2, 3]) {
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

/** Each hashtag's 1st video in the picked order (tier 1 first), then its 2nd…, each video once, ≤ 50. */
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
    const genre = categoryById(id);
    // The category's English name's words, their singulars and its subject's: "food", "restaurants", "restaurant".
    const subject = genre ? [...categoryWords(genre)] : [];
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
      subject,
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
    const videos = inTurns(columns);
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
