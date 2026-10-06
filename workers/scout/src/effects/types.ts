/**
 * Trending effects (planning/tools/18-trending-effects.md): a daily job reads TikTok / Instagram posts from rotating
 * effect-family searches, pulls out candidate effect names, keeps each effect's distinct creators per day as short
 * hashes (a 7-day memory inside ≤ 14 days of history), scores creators × growth with a small YouTube boost, and stores
 * one KV document. `EffectsDoc.meta` keeps each key's name and samples, so an effect that drops out of today's scan
 * keeps its name while it is still in the 7-day memory.
 */

export type EffectPlatform = "tt" | "ig";
export interface EffectPost {
  platform: EffectPlatform;
  handle: string;
  title: string;
  snippet: string;
  url: string;
}
export interface Candidate {
  key: string;
  name: string;
  termId?: string;
  ids: Set<string>;
  posts: number;
  platforms: Set<EffectPlatform>;
  samples: { url: string; title: string }[];
}
export interface HistoryEntry {
  day: string;
  ids: string[];
  views7d?: number;
}
export interface EffectMeta {
  name: { en: string; ar?: string };
  what?: { en: string; ar?: string };
  termId?: string;
  checked: boolean;
  platforms: EffectPlatform[];
  posts: number;
  samples: { url: string; title: string }[];
}
export interface EffectItem {
  key: string;
  name: { en: string; ar?: string };
  what?: { en: string; ar?: string };
  termId?: string;
  isNew: boolean;
  checked: boolean;
  creators: number;
  posts: number;
  platforms: EffectPlatform[];
  growth: number;
  youtube?: { newVideos: number; views7d: number; growth?: number };
  samples: { url: string; title: string }[];
}
export type EffectsStatus = "ok" | "partial" | "failed";
export interface EffectsDoc {
  ranOn: string;
  updatedAt: string;
  status: EffectsStatus;
  notes?: string[];
  items: EffectItem[];
  meta: Record<string, EffectMeta>;
  history: Record<string, HistoryEntry[]>;
}
export const MIN_CREATORS = 3,
  MAX_ITEMS = 8,
  HISTORY_DAYS = 14,
  HISTORY_KEYS = 300,
  IDS_PER_DAY = 30;
