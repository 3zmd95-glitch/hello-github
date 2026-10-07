/**
 * Category trends and lessons (planning/tools/19-category-trends.md §2–3): one KV document per category, `category:<id>`,
 * holding Trending effects' document (items, meta, history, diagnostics; never `slot`: a category searches the same 2
 * queries every scan) plus the week's lessons. The dashboard MIRRORS `Lessons` in lib/categories.ts (hand-copied):
 * change both together.
 */

import type { EffectsDoc } from "../effects/types";
import type { Platform } from "../normalize";

export type Area = "photo" | "video" | "edit";
export const AREAS: readonly Area[] = ["photo", "video", "edit"];

export interface LessonVideo {
  url: string;
  title: string;
  platform: Platform;
  kind: "example" | "tutorial";
  lang: "en" | "ar";
}
export interface Technique {
  name: { en: string; ar: string };
  howTo: { en: string; ar: string };
  skillId?: string;
  videos: LessonVideo[];
}
export interface Lessons {
  updatedAt: string;
  photo: Technique[];
  video: Technique[];
  edit: Technique[];
}
export interface CategoryDoc extends EffectsDoc {
  lessons?: Lessons;
}
