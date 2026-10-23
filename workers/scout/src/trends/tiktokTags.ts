/**
 * TikTok's own trending hashtags for SA and US (scout 02, planning/tools/08-trends.md): the Discovery API with the
 * token of the owner's TikTok for Business app "ONUS Content Planner" (tiktokads.ts, the one the category pages
 * read). Per region, `trending_list` (discovery_type HASHTAG, the last 7 days) of SPECIAL_EFFECTS, PHOTOGRAPHY and
 * MUSIC, merged by TikTok's own rank, the topic-less tags (#fyp…) left out, the top 15 kept. SA is the Arabic tab,
 * US the English one (lib/trends.ts). Then one `video_list` per region for the first 10 hashtags' top videos: each
 * row shows up to 3 of them with the date its own id carries (postDate.ts), the owner's rule "trend claims need real
 * dates and live proof".
 *
 * Calls: 6 lists + 2 proofs = 8 per run, on the daily slot (a 7-day rank does not move faster); 1 KV read (the
 * token); the rows go into the feed's one write. A region whose lists fail keeps its previous rows (their own expiry
 * ends them) and marks the run partial; a missing token is `not_configured`, a setup state. SA support is not proven
 * live (scout 02 §6): an empty SA list is reported as SA's failure, never as "no trends". TikTok's words in a note
 * never carry the token. Hashtag fields other than id, name and rank are not read until a live probe shows them.
 */

import {
  parse as parseHashtags,
  TT_EFFECTS,
  TT_PHOTO,
  TT_TRENDING_URL,
  TT_VIDEOS_URL,
  tiktokVideo,
} from "../categories/tiktok";
import { withParams } from "../categories/top";
import { isRecord } from "../effects/ai";
import { postedAt } from "../postDate";
import { hide, readAdsToken, type AdsToken } from "../tiktokads";
import {
  DAY_MS,
  fetchText,
  isExpired,
  isoPlus,
  langForRegion,
  oneLine,
  rankScore,
  slugify,
  trendId,
} from "./normalize";
import { HASHTAG_STOPLIST } from "./tavily";
import {
  SOURCE_LABELS,
  type SourceCtx,
  type SourceOutput,
  type TrendItem,
  type TrendProof,
  type TrendRegion,
} from "./types";

export const TIKTOK_REGIONS: readonly TrendRegion[] = ["SA", "US"];
/** The industries asked, in tie-break order, with the slug a row carries in `tags`. */
export const TIKTOK_INDUSTRIES: readonly { name: string; tag: string }[] = [
  { name: TT_EFFECTS, tag: "special-effects" },
  { name: TT_PHOTO, tag: "photography" },
  { name: "MUSIC", tag: "music" },
];
export const TIKTOK_DATE_RANGE = "7DAY";
export const TIKTOK_PERIOD_DAYS = 7;
/** Rows kept per region. */
export const TIKTOK_TAGS_PER_REGION = 15;
/** `video_list` takes at most 10 hashtags. */
export const TIKTOK_PROOF_TAGS = 10;
export const TIKTOK_PROOF_VIDEOS = 3;
/** Documented horizon of a hashtag's video list; never walk an arbitrary upstream array. */
const VIDEOS_SEEN = 20;
/** A daily source: two days cover one missed run. */
export const TIKTOK_TTL_MS = 2 * DAY_MS;
const MESSAGE_MAX = 80;

type Answer = { list: unknown[] } | { error: string };

/** One budgeted Discovery call: its `data.list`, or why there is none (TikTok's code and message, else HTTP). */
async function ask(ctx: SourceCtx, url: string, token: string): Promise<Answer> {
  let reply;
  try {
    reply = await fetchText(ctx.fetch, ctx.budget, url, {
      headers: { Accept: "application/json", "Access-Token": token },
    });
  } catch (e) {
    return { error: e instanceof Error && e.message === "budget" ? "budget" : "no answer" };
  }
  let body: unknown = null;
  try {
    body = JSON.parse(reply.text);
  } catch {
    /* Not JSON: the HTTP status says what it was. */
  }
  const said = isRecord(body) ? body : {};
  const code = typeof said.code === "number" ? said.code : undefined;
  if (!reply.ok || (code !== undefined && code !== 0)) {
    const message =
      typeof said.message === "string" ? oneLine(hide(said.message, [token]), MESSAGE_MAX) : "";
    return {
      error:
        code !== undefined ? `code ${code}${message ? ` ${message}` : ""}` : `http ${reply.status}`,
    };
  }
  const data = isRecord(said.data) ? said.data : {};
  return Array.isArray(data.list) ? { list: data.list } : { error: "no list" };
}

interface Tag {
  id: string;
  name: string;
  rank: number;
  here: boolean;
  /** The industries whose list held it, first asked first. */
  industries: string[];
}

/** The lists merged: one entry per hashtag at its best rank, stoplisted tags out, best rank first (ties: asked order). */
function mergeLists(lists: { tag: string; list: unknown[] }[], region: TrendRegion): Tag[] {
  const byId = new Map<string, Tag>();
  for (const { tag, list } of lists)
    for (const h of parseHashtags(list, region)) {
      if (HASHTAG_STOPLIST.has(h.name.toLowerCase())) continue;
      const had = byId.get(h.id);
      if (!had) byId.set(h.id, { ...h, industries: [tag] });
      else {
        if (!had.industries.includes(tag)) had.industries.push(tag);
        if (h.rank < had.rank) had.rank = h.rank;
        had.here = had.here || h.here;
      }
    }
  return [...byId.values()]
    .sort((a, b) => (a.rank === b.rank ? 0 : a.rank - b.rank))
    .slice(0, TIKTOK_TAGS_PER_REGION);
}

/** The top videos of each asked hashtag, by id, as proof (playable links only, dated by their own ids). */
function proofsOf(
  list: unknown[],
  names: ReadonlyMap<string, string>,
  now: Date,
): Map<string, TrendProof[]> {
  const out = new Map<string, TrendProof[]>();
  for (const e of list) {
    if (!isRecord(e) || !Array.isArray(e.top_video_list)) continue;
    const id = String(e.hashtag_id);
    const name = names.get(id);
    if (name === undefined) continue;
    const seen = new Set<string>();
    const proofs: TrendProof[] = [];
    for (const v of e.top_video_list.slice(0, VIDEOS_SEEN)) {
      const found = tiktokVideo(v, name);
      if (!found || seen.has(found.id)) continue;
      seen.add(found.id);
      const at = postedAt(found.video.url, now);
      proofs.push({
        url: found.video.url,
        ...(found.video.creator ? { creator: found.video.creator } : {}),
        ...(at ? { postedAt: at } : {}),
      });
      if (proofs.length === TIKTOK_PROOF_VIDEOS) break;
    }
    if (proofs.length) out.set(id, proofs);
  }
  return out;
}

function tagItems(
  tags: readonly Tag[],
  region: TrendRegion,
  now: Date,
  proofs: ReadonlyMap<string, TrendProof[]>,
): TrendItem[] {
  const seenAt = now.toISOString();
  const expiresAt = isoPlus(now, TIKTOK_TTL_MS);
  return tags.map((t, i) => ({
    id: trendId("tiktok", region, `tag-${slugify(t.name)}`),
    platform: "tiktok",
    region,
    lang: langForRegion(region),
    title: `#${t.name}`,
    url: `https://www.tiktok.com/tag/${encodeURIComponent(t.name)}`,
    score: rankScore(i + 1, tags.length),
    source: SOURCE_LABELS.tiktok,
    seenAt,
    expiresAt,
    tags: t.industries,
    kind: "hashtag",
    periodDays: TIKTOK_PERIOD_DAYS,
    ...(proofs.has(t.id) ? { proof: proofs.get(t.id) } : {}),
  }));
}

/** SA and US (8 calls). */
export async function runTikTokTags(ctx: SourceCtx): Promise<SourceOutput> {
  let token: AdsToken | null;
  try {
    token = await readAdsToken(ctx.env);
  } catch {
    return { ok: false, error: "token read failed" };
  }
  const advertiser = token?.advertiser_ids[0];
  if (!token || !advertiser) return { ok: false, error: "not_configured" };
  const accessToken = token.access_token;
  const common = {
    advertiser_id: advertiser,
    discovery_type: "HASHTAG",
    date_range: TIKTOK_DATE_RANGE,
  };

  const items: TrendItem[] = [];
  const problems: string[] = [];
  const counts: string[] = [];
  let regionsOk = 0;
  for (const region of TIKTOK_REGIONS) {
    const answers = await Promise.all(
      TIKTOK_INDUSTRIES.map((industry) =>
        ask(
          ctx,
          withParams(TT_TRENDING_URL, {
            ...common,
            country_code: region,
            category_name: industry.name,
          }),
          accessToken,
        ),
      ),
    );
    const lists: { tag: string; list: unknown[] }[] = [];
    answers.forEach((a, i) => {
      if ("list" in a) lists.push({ tag: TIKTOK_INDUSTRIES[i].tag, list: a.list });
      else problems.push(`${region} ${TIKTOK_INDUSTRIES[i].tag}: ${a.error}`);
    });
    const tags = mergeLists(lists, region);
    if (!tags.length) {
      if (lists.length) problems.push(`${region}: no hashtags`);
      // The region's last rows stay until their own expiry (a fresh row is never expiry-checked by the merge).
      items.push(
        ...(ctx.previous ?? []).filter(
          (i) => i.source === SOURCE_LABELS.tiktok && i.region === region && !isExpired(i, ctx.now),
        ),
      );
      continue;
    }
    regionsOk += 1;

    // The proof: videos only for hashtags that are top in this country (video_list asks for it).
    const asking = tags.filter((t) => t.here).slice(0, TIKTOK_PROOF_TAGS);
    let proofs = new Map<string, TrendProof[]>();
    if (asking.length) {
      const found = await ask(
        ctx,
        withParams(TT_VIDEOS_URL, {
          ...common,
          country_code: region,
          hashtag_ids: JSON.stringify(asking.map((t) => t.id)),
        }),
        accessToken,
      );
      if ("list" in found)
        proofs = proofsOf(found.list, new Map(asking.map((t) => [t.id, t.name])), ctx.now);
      else problems.push(`${region} videos: ${found.error}`);
    }
    counts.push(`${region} ${tags.length} (${proofs.size} with videos)`);
    items.push(...tagItems(tags, region, ctx.now, proofs));
  }

  if (!regionsOk) return { ok: false, error: oneLine(problems.join("; "), 200) ?? "no hashtags" };
  // Problems first: the 200-character clip must never cut off what went wrong.
  const note = oneLine([...problems, ...counts].join("; "), 200);
  return {
    ok: true,
    items,
    ...(problems.length ? { degraded: true } : {}),
    ...(note ? { note } : {}),
  };
}
