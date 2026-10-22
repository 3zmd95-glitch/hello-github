/**
 * Category trends (planning/tools/19-category-trends.md §2): the built-in categories of planning/data/genres.json
 * (bundled through trends/genres.ts), scanned in groups of 4 by UTC day (cars, food, anime, travel on day % 3 = 0),
 * one per cron slot; each category's 6 English searches, the camera words its styles may end in, its own words
 * (generic for it), the line that tells the AI what the posts are, and its KV keys.
 */

import { normalizeTerm } from "../discover/terms";
import { GENRES, type Genre } from "../trends/genres";

/** UTC "HH:MM" of the category slots, right after the effects slot (05:35): slot i scans the day's i-th category. */
export const CATEGORY_SLOTS: readonly string[] = ["05:40", "05:45", "05:50", "05:55"];
/** Camera words a category style may end in ("rolling shot", "low angle"). */
export const CATEGORY_SUFFIXES: readonly string[] = ["shot", "angle", "lighting", "look"];
/** A category's memory keeps at most this many names (Trending effects keeps 400). */
export const CATEGORY_KEYS = 200;
/** Creators this week a category style needs (Trending effects needs 3): after live fix 1, Cars' 6 searches found 35
 * posts and 1 style with 3 creators. A name outside the dictionary still needs the AI's approval. */
export const CATEGORY_MIN_CREATORS = 2;

export const categoryKey = (id: string) => `category:${id}`;
export const attemptsKey = (id: string, day: string) => `category:attempts:${id}:${day}`;

export function categoryById(id: string): Genre | undefined {
  return GENRES.find((g) => g.id === id);
}

/** A UTC day's categories, one per slot: UTC day number % 3 picks the group (12 categories, 4 a day). */
export function categoriesForDay(day: string): string[] {
  const perDay = CATEGORY_SLOTS.length;
  const groups = Math.ceil(GENRES.length / perDay);
  const group = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % groups;
  return GENRES.slice(group * perDay, (group + 1) * perDay).map((g) => g.id);
}

/** What the category's videos show: its main query without its " edit" ("car"). */
export const categorySubject = (g: Genre) => g.queries.en[0].replace(/\s+edit$/i, "");

/**
 * 6 English queries, each searched on Instagram over a month (live fix 1, §2): the main query q1 with " trend", the
 * second as it is, "viral q1", "q1 transition", "q1 capcut template" and "<subject> video trend". For Cars: "car edit
 * trend", "cinematic car edit", "viral car edit", "car edit transition", "car edit capcut template", "car video trend".
 */
export function categoryQueries(g: Genre): string[] {
  const q1 = g.queries.en[0];
  return [
    `${q1} trend`,
    ...g.queries.en.slice(1, 2),
    `viral ${q1}`,
    `${q1} transition`,
    `${q1} capcut template`,
    `${categorySubject(g)} video trend`,
  ];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter(Boolean);

/** The words that name the category: its English name's, a plural one's singular too ("restaurants" → "restaurant",
 * as keys are stemmed), and its subject's ("car", "cars"). A lesson's search without one gets the subject (§3). */
export function categoryWords(g: Genre): Set<string> {
  const name = words(g.name.en);
  return new Set([...name, ...name.map(normalizeTerm), ...words(categorySubject(g))]);
}

/** Its own words and its main query's ("car", "cars", "edit"): never a style on their own. The second query's words
 * stay free: it is there to find the category's signature styles (Fashion's "outfit transition", Gaming's
 * "montage"). */
export function categoryGeneric(g: Genre): Set<string> {
  return new Set([...categoryWords(g), ...words(g.queries.en[0])]);
}

/** What the AI cleanup is told about the posts: "for car videos", and to judge every key (Cars' first live scan got
 * an empty list back, which hid why). */
export function aiContext(g: Genre): string {
  return (
    `These posts are about ${g.name.en}, for ${categorySubject(g)} videos: also keep the camera shots, angles, ` +
    `lighting and looks creators use for them ("rolling shot", "low angle"), and drop the subject itself (brands, ` +
    `models, places). Return one entry for every candidate key, keep true or false.`
  );
}
