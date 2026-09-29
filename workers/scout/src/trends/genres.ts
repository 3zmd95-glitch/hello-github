/**
 * The edit genres as keywords of the daily YouTube keyword scan (round 31, planning/tools/08-trends.md):
 * `planning/data/genres.json` is bundled at build like the moments calendar (events.ts; `json.d.ts` types
 * it for tsc), and every genre gives two keywords, its main Arabic query against SA and its main English
 * query against US. Rows they find carry `genre: "<id>"`, which the radar's genre filter reads.
 *
 * `Genre` is hand-copied from the dashboard's zod `GenreSchema` (lib/domain.ts), the same convention as
 * `types.ts`: the Worker has no zod, so `parseGenre` checks the same rules by hand and the tests keep
 * the two sides in step.
 */

import raw from "../../../../planning/data/genres.json";
import type { TrendRegion } from "./types";

export interface Genre {
  /** `^[a-z][a-z0-9-]*$`, unique in the file. */
  id: string;
  emoji: string;
  name: { ar: string; en: string };
  /** `queries.<lang>[0]` is the genre's main query: what Discover searches and what the scan runs. */
  queries: { ar: string[]; en: string[] };
  /** Without the "#": lower-case letters, digits and "_". */
  hashtags: string[];
}

/** One keyword of the scan that belongs to a genre (a `Keyword` of youtubeSearch.ts with its genre set). */
export interface GenreKeyword {
  q: string;
  region: TrendRegion;
  lang: "ar" | "en";
  /** The genre's id. */
  genre: string;
}

const GENRE_ID = /^[a-z][a-z0-9-]*$/;
const HASHTAG = /^[a-z0-9_]+$/;

function isLText(x: unknown): x is { ar: string; en: string } {
  const t = x as Record<string, unknown> | null;
  return !!t && typeof t === "object" && typeof t.ar === "string" && typeof t.en === "string";
}

/** A list of at least one non-empty string (no trimming: the dashboard's schema keeps the text as it is). */
function isQueryList(x: unknown): x is string[] {
  return Array.isArray(x) && x.length > 0 && x.every((q) => typeof q === "string" && q.length > 0);
}

/** One JSON entry as a Genre (`hashtags` defaults to []), or null when it breaks a rule of `GenreSchema`. */
export function parseGenre(x: unknown): Genre | null {
  if (!x || typeof x !== "object") return null;
  const g = x as Record<string, unknown>;
  if (typeof g.id !== "string" || !GENRE_ID.test(g.id)) return null;
  if (typeof g.emoji !== "string" || !g.emoji) return null;
  if (!isLText(g.name)) return null;
  const queries = g.queries as Record<string, unknown> | null | undefined;
  if (!queries || typeof queries !== "object") return null;
  if (!isQueryList(queries.ar) || !isQueryList(queries.en)) return null;
  if (g.hashtags !== undefined) {
    if (!Array.isArray(g.hashtags)) return null;
    if (!g.hashtags.every((h) => typeof h === "string" && HASHTAG.test(h))) return null;
  }
  return {
    id: g.id,
    emoji: g.emoji,
    name: { ar: g.name.ar, en: g.name.en },
    queries: { ar: [...queries.ar], en: [...queries.en] },
    hashtags: Array.isArray(g.hashtags) ? [...(g.hashtags as string[])] : [],
  };
}

/**
 * The genres of a `{ version: 1, genres: [...] }` file in file order. The Worker must not fail to start
 * over a data file, so a malformed entry or a repeated id is dropped here (the dashboard's loader,
 * data/genres.ts, is the strict one and its test fails the build on a broken file); another version or
 * shape gives no genres, and the scan then runs the niche keywords alone.
 */
export function parseGenres(file: unknown): Genre[] {
  const f = file as { version?: unknown; genres?: unknown } | null;
  if (!f || typeof f !== "object" || f.version !== 1 || !Array.isArray(f.genres)) return [];
  const seen = new Set<string>();
  const out: Genre[] = [];
  for (const entry of f.genres) {
    const genre = parseGenre(entry);
    if (!genre || seen.has(genre.id)) continue;
    seen.add(genre.id);
    out.push(genre);
  }
  return out;
}

/** Every well-formed genre of the bundled file, in file order. */
export const GENRES: readonly Genre[] = parseGenres(raw);

/** Two keywords per genre, Arabic (SA) then English (US): the genre's main query of each language. */
export function genreKeywords(genres: readonly Genre[]): GenreKeyword[] {
  return genres.flatMap((g): GenreKeyword[] => [
    { q: g.queries.ar[0], region: "SA", lang: "ar", genre: g.id },
    { q: g.queries.en[0], region: "US", lang: "en", genre: g.id },
  ]);
}

export const GENRE_KEYWORDS: readonly GenreKeyword[] = genreKeywords(GENRES);
