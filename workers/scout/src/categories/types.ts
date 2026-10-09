/**
 * Category trends and lessons (planning/tools/19-category-trends.md §2–3): one KV document per category, `category:<id>`,
 * holding Trending effects' document (items, meta, history, diagnostics; never `slot`: a category searches the same 2
 * queries every scan) plus the week's lessons. The dashboard MIRRORS `Lessons` in lib/categories.ts (hand-copied):
 * change both together.
 */

import type { EffectsDoc } from "../effects/types";
import type { Platform } from "../normalize";
import type { TopVideo } from "./video";
export type { TopVideo } from "./video";

export type Area = "photo" | "video" | "edit";
export const AREAS: readonly Area[] = ["photo", "video", "edit"];

export interface LessonVideo {
  url: string;
  title: string;
  platform: Platform;
  kind: "example" | "tutorial";
  lang: "en" | "ar";
}
/** English first (live fix 1): the Arabic name and how-to only when the model wrote them in Arabic script. The English
 * how-to is "Shoot: …\nSettings: …\nEdit: …" since live fix 2 (`LESSONS_VERSION` 3). */
export interface Technique {
  name: { en: string; ar?: string };
  howTo: { en: string; ar?: string };
  study?: {
    watchFor: { en: string; ar?: string };
    tryIt: { en: string; ar?: string };
    sourceBasis: "title-and-description";
  };
  skillId?: string;
  videos: LessonVideo[];
}
export interface Lessons {
  /** `LESSONS_VERSION` (lessons.ts) when written; none before live fix 1. Older lessons are due at the next scan. */
  v?: number;
  updatedAt: string;
  photo: Technique[];
  video: Technique[];
  edit: Technique[];
}
/** A category candidate: YouTube metadata, indexed post metadata, or Discovery with a public TikTok caption.
 * `evidence` explains matching title/caption/description text, never visual verification or a quality guarantee.
 * Brave's separate, unstored group retains its provider order and attribution. */
/** The stored lists, ≤ 50 each, best first. `updatedAt` is YouTube's list's date (kept with a kept list, C1); TikTok's
 * list has its own (`ttUpdatedAt`, when TikTok's Discovery API last filled it; none before that). */
export interface TopLists {
  updatedAt: string;
  yt: TopVideo[];
  ig: TopVideo[];
  tt: TopVideo[];
  ttUpdatedAt?: string;
}
export interface CategoryDoc extends EffectsDoc {
  /** Internal version of the generated trend evidence; excludes legacy broad-category counts after a new scan. */
  qualityVersion?: number;
  lessons?: Lessons;
  top?: TopLists;
}
