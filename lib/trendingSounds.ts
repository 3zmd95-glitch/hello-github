import { createStore, get, update, type UseStore } from "idb-keyval";
import type { DiscoverItem, DiscoverPlatform } from "./discover";
import { canonicalRefUrl } from "./research";
import { postedAt } from "../workers/scout/src/postDate";

/**
 * Trending sounds in edits (packet 26, owner 14 Oct: "every trend has a trendy music"). Counts come only
 * from posts Discover itself read (the sound named on the post's own public page, its real post date
 * from the post id), never from a platform chart and never from reading sound pages.
 */

export interface SoundObservation {
  key: string;
  title: string;
  artist?: string;
  /** The platform's sound page, for "Open sound". */
  url?: string;
  platform: DiscoverPlatform;
  /** Canonical post URL: one row per post. */
  post: string;
  creator: string;
  /** A category id, or a Search topic ({@link searchSoundCategory}). */
  category: string;
  postedAt: string;
  observedAt: string;
  /** What the example card shows (and the editor filter reads). */
  handle: string;
  caption: string;
  thumb?: string;
}

export interface TrendingSound {
  key: string;
  title: string;
  artist?: string;
  /** "seen": not trending/emerging in 14 days, but used by 2+ creators within 30 days. */
  label: "trending" | "emerging" | "seen";
  posts: number;
  creators: number;
  categories: number;
  platforms: Partial<Record<DiscoverPlatform, number>>;
  urls: Partial<Record<"ig" | "tt", string>>;
  latest: string;
  examples: DiscoverItem[];
}

const DAY = 86_400_000;
const WINDOW = 14 * DAY;
const KEEP = 30 * DAY;
const MAX_ROWS = 2000;
const PLATFORMS = new Set(["ig", "tt", "yt"]);
// The poster's own audio: its title alone names no song, so it never groups different posters together.
const PERSONAL = /^(original (audio|sound)|son original|sonido original|som original|الصوت الأصلي)/;

const fold = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

/** Sound observations for the enriched items of one category feed or Search topic. */
export function soundObservations(
  items: readonly DiscoverItem[],
  category: string,
  now = Date.now(),
): SoundObservation[] {
  return items.flatMap((item) => {
    const sound = item.evidence?.sound;
    const title = sound?.title.replace(/\s+/g, " ").trim();
    const artist = sound?.artist?.replace(/\s+/g, " ").trim() || undefined;
    if (!sound || !title) return [];
    const personal = sound.original === true || PERSONAL.test(fold(title));
    // A song groups across platforms by name; personal audio only by its sound page or its poster.
    const key =
      personal && sound.url
        ? sound.url
        : personal && !artist
          ? null
          : `${fold(title)}|${fold(artist ?? "")}`;
    const posted = postedAt(item.url, new Date(now)) ?? item.evidence?.published;
    const creator = fold(item.evidence?.author || item.handle || "");
    const post = canonicalRefUrl(item.platform, item.url);
    if (!key || !posted || !Number.isFinite(Date.parse(posted)) || !creator) return [];
    return [
      {
        key,
        title,
        ...(artist ? { artist } : {}),
        ...(sound.url ? { url: sound.url } : {}),
        platform: item.platform,
        post,
        creator,
        category,
        postedAt: new Date(posted).toISOString(),
        observedAt: new Date(now).toISOString(),
        handle: item.handle,
        caption: (item.snippet || item.title).slice(0, 500),
        ...(item.thumb ? { thumb: item.thumb } : {}),
      },
    ];
  });
}

const isRow = (row: unknown): row is SoundObservation => {
  const value = row as Record<string, unknown> | null;
  return (
    !!value &&
    typeof value === "object" &&
    ["key", "title", "post", "creator", "category", "postedAt", "observedAt", "handle", "caption"]
      .map((name) => value[name])
      .every((field) => typeof field === "string") &&
    PLATFORMS.has(value.platform as string) &&
    Number.isFinite(Date.parse(value.postedAt as string))
  );
};

/** One row per post (the newest observation wins), posts older than 30 days dropped, newest 2,000 kept. */
export function mergeSoundObservations(
  existing: unknown,
  incoming: readonly SoundObservation[],
  now = Date.now(),
): SoundObservation[] {
  const rows = new Map<string, SoundObservation>();
  for (const row of [...(Array.isArray(existing) ? existing : []), ...incoming]) {
    if (!isRow(row) || now - Date.parse(row.postedAt) > KEEP) continue;
    const seen = rows.get(row.post);
    if (!seen || Date.parse(row.observedAt) >= Date.parse(seen.observedAt)) rows.set(row.post, row);
  }
  return [...rows.values()]
    .sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
    .slice(0, MAX_ROWS);
}

/** Sounds posted by at least two creators in the last 14 days, Instagram/TikTok first, then the newest.
 * With `seen`, sounds that miss the 14-day tiers but 2+ creators used within 30 days follow as "seen". */
export function trendingSounds(
  observations: readonly SoundObservation[],
  now = Date.now(),
  limit = 10,
  { seen = false }: { seen?: boolean } = {},
): TrendingSound[] {
  const groups = new Map<string, SoundObservation[]>();
  for (const row of mergeSoundObservations(observations, [], now)) {
    if (now - Date.parse(row.postedAt) < -DAY) continue;
    groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
  }
  return [...groups.values()]
    .flatMap((all) => {
      // Rows arrive newest first: the newest names the sound and leads the examples.
      const recent = all.filter((row) => now - Date.parse(row.postedAt) <= WINDOW);
      const tally = (rows: SoundObservation[]) => ({
        creators: new Set(rows.map((row) => row.creator)).size,
        categories: new Set(rows.map((row) => row.category)).size,
      });
      const fresh = tally(recent);
      const month = tally(all);
      const [label, rows, { creators, categories }] =
        recent.length >= 3 && fresh.creators >= 3 && fresh.categories >= 2
          ? (["trending", recent, fresh] as const)
          : recent.length >= 2 && fresh.creators >= 2
            ? (["emerging", recent, fresh] as const)
            : seen && all.length >= 2 && month.creators >= 2
              ? (["seen", all, month] as const)
              : [null, all, month];
      if (!label) return [];
      const platforms: TrendingSound["platforms"] = {};
      const urls: TrendingSound["urls"] = {};
      for (const row of rows) {
        platforms[row.platform] = (platforms[row.platform] ?? 0) + 1;
        if (row.url && row.platform !== "yt") urls[row.platform] ??= row.url;
      }
      const [newest] = rows;
      const artist = rows.find((row) => row.artist)?.artist;
      return [
        {
          sound: {
            key: newest.key,
            title: newest.title,
            ...(artist ? { artist } : {}),
            label,
            posts: rows.length,
            creators,
            categories,
            platforms,
            urls,
            latest: newest.postedAt,
            examples: rows.slice(0, 3).map((row): DiscoverItem => ({
              platform: row.platform,
              url: row.post,
              handle: row.handle,
              title: row.caption.slice(0, 160) || row.handle,
              snippet: row.caption,
              published: row.postedAt,
              lang: "en",
              section: "example",
              ...(row.thumb ? { thumb: row.thumb } : {}),
            })),
          },
          score: rows.reduce((sum, row) => sum + (row.platform === "yt" ? 0.5 : 1), 0),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(a.sound.label === "seen") - Number(b.sound.label === "seen") ||
        b.score - a.score ||
        Date.parse(b.sound.latest) - Date.parse(a.sound.latest),
    )
    .slice(0, limit)
    .map(({ sound }) => sound);
}

/** A Search section's topic: the CapCut and DaVinci Resolve sections of one search are one topic. */
export const searchSoundCategory = (query: string) =>
  `search:${fold(query)
    .replace(/\b(capcut|davinci resolve|davinci)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()}`;

/* ---------- this device's store (IndexedDB, beside the native search cache) ---------- */

export const TRENDING_SOUNDS_EVENT = "3z-trending-sounds-change";
let store: UseStore | undefined;
const soundsDb = () => (store ??= createStore("3z-prod-trending-sounds", "observations"));

export async function readSoundObservations(now = Date.now()): Promise<SoundObservation[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    return mergeSoundObservations(await get("recent", soundsDb()), [], now);
  } catch {
    return [];
  }
}

export async function recordSoundObservations(incoming: readonly SoundObservation[]) {
  if (!incoming.length || typeof indexedDB === "undefined") return;
  try {
    await update<SoundObservation[]>(
      "recent",
      (old) => mergeSoundObservations(old, incoming),
      soundsDb(),
    );
    window.dispatchEvent(new Event(TRENDING_SOUNDS_EVENT));
  } catch {
    /* Discover stays usable when storage is full, blocked or unavailable. */
  }
}
