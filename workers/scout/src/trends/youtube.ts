/**
 * YouTube charts for SA and US (round 30, planning/tools/08-trends.md): `videos.list chart=mostPopular`
 * for all categories and for How-to & Style (26), 25 videos each, with an API key (no OAuth). Since July
 * 2025 this chart is YouTube's Music / Movies / Gaming chart, not a general trending list, so the label is
 * "YouTube charts" and never "trending". Shorts have no flag: `contentDetails.duration ≤ 180 s` → tag "short".
 * Missing key → `{ ok: false, error: "not_configured" }` and the run goes on.
 */

import { int } from "../social/http";
import {
  DAY_MS,
  fetchText,
  isoPlus,
  langForRegion,
  oneLine,
  rankScore,
  trendId,
} from "./normalize";
import {
  SOURCE_LABELS,
  type SourceCtx,
  type SourceOutput,
  type TrendItem,
  type TrendRegion,
} from "./types";

export const YT_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos";
export const YT_MAX_RESULTS = 25;
/** ≤ 180 s counts as a Short (the same cut as social/youtube.ts). */
export const SHORT_MAX_S = 180;
export const YT_CHART_TTL_MS = 2 * DAY_MS;
export const YT_REGIONS: readonly TrendRegion[] = ["SA", "US"];
/** "0" = all categories (the API default), "26" = How-to & Style. */
export const YT_CATEGORIES: readonly { id: string; tag?: string }[] = [
  { id: "0" },
  { id: "26", tag: "how-to" },
];

/** What `videos.list` returns, the fields used here. */
export interface YtVideo {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Partial<Record<"default" | "medium" | "high", { url?: string }>>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string | number };
}

export interface YtListResponse {
  items?: YtVideo[];
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

/** ISO 8601 `PT1H2M3S` → seconds (0 when unparseable). */
export function durationSeconds(iso: string | undefined): number {
  const m = iso?.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86_400 + h * 3600 + mi * 60 + s;
}

export function ytThumb(v: YtVideo): string | undefined {
  const t = v.snippet?.thumbnails;
  return t?.medium?.url ?? t?.high?.url ?? t?.default?.url;
}

export function ytUrl(id: string, short: boolean): string {
  return short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
}

/**
 * One chart's videos as TrendItems in chart order (rank 1 = 100). `slugPrefix` keeps chart and search rows
 * apart when the same video shows in both.
 */
export function ytItems(
  videos: YtVideo[],
  region: TrendRegion,
  now: Date,
  opts: { source: TrendItem["source"]; tags?: string[]; ttlMs: number; slugPrefix?: string },
): TrendItem[] {
  const seenAt = now.toISOString();
  const expiresAt = isoPlus(now, opts.ttlMs);
  const rows = videos.filter((v) => typeof v.id === "string" && v.snippet?.title);
  return rows.map((v, i) => {
    const id = v.id as string;
    const short = durationSeconds(v.contentDetails?.duration) <= SHORT_MAX_S;
    const tags = [...(opts.tags ?? []), ...(short ? ["short"] : [])];
    return {
      id: trendId("youtube", region, `${opts.slugPrefix ?? ""}${id}`),
      platform: "youtube",
      region,
      lang: langForRegion(region),
      title: oneLine(v.snippet?.title, 120) ?? id,
      url: ytUrl(id, short),
      thumb: ytThumb(v),
      score: rankScore(i + 1, rows.length),
      volume: int(v.statistics?.viewCount) || undefined,
      source: opts.source,
      why: oneLine(v.snippet?.channelTitle, 80),
      seenAt,
      expiresAt,
      tags,
    };
  });
}

export function chartUrl(key: string, region: string, categoryId: string): string {
  const u = new URL(YT_VIDEOS_URL);
  u.searchParams.set("part", "snippet,contentDetails,statistics");
  u.searchParams.set("chart", "mostPopular");
  u.searchParams.set("regionCode", region);
  if (categoryId !== "0") u.searchParams.set("videoCategoryId", categoryId);
  u.searchParams.set("maxResults", String(YT_MAX_RESULTS));
  u.searchParams.set("key", key);
  return u.toString();
}

/** Maps the API's error reasons to the short codes the status shows. */
export function ytErrorCode(status: number, body: YtListResponse | null): string {
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  if (/quota/i.test(reason)) return "quota";
  if (status === 400 || status === 403) return `auth: ${reason || status}`;
  return `http ${status}`;
}

export function parseYtBody(text: string): YtListResponse | null {
  try {
    return JSON.parse(text) as YtListResponse;
  } catch {
    return null;
  }
}

/** Both regions × both categories (4 calls). A region/category without a chart (404) is just empty. */
export async function runYoutube(ctx: SourceCtx): Promise<SourceOutput> {
  const key = ctx.env.YOUTUBE_API_KEY;
  if (!key) return { ok: false, error: "not_configured" };
  const items: TrendItem[] = [];
  let charts = 0;
  for (const region of YT_REGIONS) {
    for (const cat of YT_CATEGORIES) {
      const r = await fetchText(ctx.fetch, ctx.budget, chartUrl(key, region, cat.id));
      const body = parseYtBody(r.text);
      if (r.status === 404) continue;
      if (!r.ok || !body) return { ok: false, error: ytErrorCode(r.status, body) };
      charts += 1;
      items.push(
        ...ytItems(body.items ?? [], region, ctx.now, {
          source: SOURCE_LABELS.youtube,
          tags: cat.tag ? [cat.tag] : [],
          ttlMs: YT_CHART_TTL_MS,
        }),
      );
    }
  }
  if (!charts) return { ok: false, error: "no charts" };
  return { ok: true, items };
}
