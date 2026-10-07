/**
 * Category trends (planning/tools/19-category-trends.md §2): the built-in categories of planning/data/genres.json
 * (bundled through trends/genres.ts), scanned in groups of 4 by UTC day (cars, food, anime, travel on day % 3 = 0),
 * one per cron slot; each category's 2 English searches, the camera words its styles may end in, its own words
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

/** The main English query with " trend" added, then the second as it is. */
export function categoryQueries(g: Genre): string[] {
  return [`${g.queries.en[0]} trend`, ...g.queries.en.slice(1, 2)];
}

/** The words of the category's English name, a plural one's singular too ("restaurants" → "restaurant", as keys are
 * stemmed), and of its main query ("car", "cars", "edit"): never a style on their own. The second query's words stay
 * free: it is there to find the category's signature styles (Fashion's "outfit transition", Gaming's "montage"). */
export function categoryGeneric(g: Genre): Set<string> {
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter(Boolean);
  const name = words(g.name.en);
  return new Set([...name, ...name.map(normalizeTerm), ...words(g.queries.en[0])]);
}

/** What the AI cleanup is told about the posts: "for car videos", from the main query without its " edit". */
export function aiContext(g: Genre): string {
  const subject = g.queries.en[0].replace(/\s+edit$/i, "");
  return (
    `These posts are about ${g.name.en}, for ${subject} videos: also keep the camera shots, angles, lighting and ` +
    `looks creators use for them ("rolling shot", "low angle"), and drop the subject itself (brands, models, places).`
  );
}
