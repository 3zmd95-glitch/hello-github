/**
 * Claude's picks (round 33, planning/tools/13-discover-search-v2.md): the connector's `save_picks` writes the posts
 * Claude chose for a topic; Discover shows them as "⭐ Claude's picks". One KV document `discover:picks`
 * (`{ [topicKey]: PicksTopic }`, at most 50 topics × 20 posts, the oldest topic dropped). A pick is one post of
 * TikTok, Instagram or YouTube (https), stored in its canonical form. A save reads, merges and writes the whole
 * document, so a read that fails fails the save (it never writes over picks it could not read).
 */

import {
  canonicalUrl,
  isVideoUrl,
  platformForHost,
  youtubeVideoId,
  type Platform,
} from "../normalize";
import { planSearch } from "./plan";
import type { Section } from "./types";

export const PICKS_KEY = "discover:picks";
export const MAX_TOPICS = 50;
export const MAX_PICKS = 20;

export interface Pick {
  url: string;
  platform: Platform;
  title: string;
  handle?: string;
  /** YouTube only, from the video id (a TikTok card asks /oembed for its picture; Instagram has none). */
  thumb?: string;
  label: Section;
  note?: string;
  savedAt: string;
}

export interface PicksTopic {
  topicKey: string;
  topic: string;
  savedAt: string;
  items: Pick[];
}

export interface PickInput {
  url: string;
  title: string;
  handle?: string;
  label: Section;
  note?: string;
}

type PicksEnv = { SOCIAL_KV?: KVNamespace };
type PicksDoc = Record<string, PicksTopic>;

/** The dictionary id when the topic is a known effect ("flash" and "Flash transition" meet), else its words. */
export function topicKeyOf(topic: string): string {
  return planSearch({ q: topic }).topicKey;
}

export function pickFromInput(x: PickInput, savedAt: string): Pick | null {
  let u: URL;
  try {
    u = new URL(x.url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const platform = platformForHost(u.hostname);
  if (!platform || !isVideoUrl(platform, u)) return null;
  const title = (x.title ?? "").trim().slice(0, 160);
  if (!title) return null;
  const handle = x.handle?.trim().slice(0, 80);
  const note = x.note?.trim().slice(0, 200);
  const ytId = platform === "yt" ? youtubeVideoId(u) : undefined;
  return {
    url: canonicalUrl(platform, u),
    platform,
    title,
    ...(handle ? { handle } : {}),
    ...(ytId ? { thumb: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` } : {}),
    label: x.label === "tutorial" ? "tutorial" : "example",
    ...(note ? { note } : {}),
    savedAt,
  };
}

/** The stored document ({} when there is none or it is broken); a KV read error is thrown. */
async function readDoc(env: PicksEnv): Promise<PicksDoc> {
  if (!env.SOCIAL_KV) return {};
  const text = await env.SOCIAL_KV.get(PICKS_KEY, "text");
  if (!text) return {};
  try {
    const doc = JSON.parse(text) as unknown;
    return doc && typeof doc === "object" ? (doc as PicksDoc) : {};
  } catch {
    return {};
  }
}

/** Every topic's picks, newest first; only the topic's own when `topic` is given; none when KV can't be read. */
export async function readPicks(env: PicksEnv, topic?: string): Promise<PicksTopic[]> {
  const doc = await readDoc(env).catch((): PicksDoc => ({}));
  const all = Object.values(doc).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  if (!topic) return all;
  const key = topicKeyOf(topic);
  return all.filter((t) => t.topicKey === key);
}

export async function savePicks(
  env: PicksEnv,
  topic: string,
  inputs: PickInput[],
  replace: boolean,
  now: Date,
): Promise<{ topicKey: string; saved: number; rejected: number }> {
  const savedAt = now.toISOString();
  const picks = inputs.map((x) => pickFromInput(x, savedAt)).filter((p): p is Pick => !!p);
  const topicKey = topicKeyOf(topic);
  if (!env.SOCIAL_KV) return { topicKey, saved: 0, rejected: inputs.length };
  const doc = await readDoc(env);
  const seen = new Set<string>();
  const items = [...picks, ...(replace ? [] : (doc[topicKey]?.items ?? []))]
    .filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)))
    .slice(0, MAX_PICKS);
  doc[topicKey] = { topicKey, topic: topic.trim().slice(0, 100), savedAt, items };
  const kept = Object.values(doc)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, MAX_TOPICS);
  await env.SOCIAL_KV.put(
    PICKS_KEY,
    JSON.stringify(Object.fromEntries(kept.map((t) => [t.topicKey, t]))),
  );
  return { topicKey, saved: picks.length, rejected: inputs.length - picks.length };
}
