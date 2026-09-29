import { GENRES } from "@/data/genres";
import type { CustomGenre, Genre, Lang } from "@/lib/domain";

/**
 * 🎬 Edit genres (round 31): the pure helpers behind the genre chips of Discover, the skill Research panel,
 * Settings and the Trend Radar's genre filter. Built-in genres come from planning/data/genres.json (through
 * data/genres); the owner's own ones from the store (`customGenres`). No React, no store access: callers pass
 * the custom list in.
 */

export { GENRES };

/** What a custom genre shows instead of a hand-picked emoji. */
export const CUSTOM_GENRE_EMOJI = "✨";

const CUSTOM_PREFIX = "custom-";

/** Trim and turn every run of whitespace into one space. */
const squash = (text: string): string => text.trim().replace(/\s+/g, " ");

/**
 * Lower-case slug of a name: letters and digits of any script (Arabic included) joined by "-". Combining
 * marks (tashkeel, accents) and the tatweel are dropped first, so "قهوَة" and "قهوة" give the same slug. May be
 * empty (a name of emoji or punctuation only).
 */
function nameSlug(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{M}\u0640]+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/** A custom genre in the shape of a built-in one: ✨, the same name and the same words in both languages. */
function fromCustom(c: CustomGenre): Genre {
  return {
    id: c.id,
    emoji: CUSTOM_GENRE_EMOJI,
    name: { ar: c.name, en: c.name },
    queries: { ar: [c.query], en: [c.query] },
    hashtags: [],
  };
}

/** Every genre the owner can pick: the built-in ones in file order, then the custom ones in the order added. */
export function allGenres(custom: readonly CustomGenre[]): Genre[] {
  return [...GENRES, ...custom.map(fromCustom)];
}

/** The genre with that id (built-in first), or undefined for an id this app does not know. */
export function genreById(id: string, custom: readonly CustomGenre[]): Genre | undefined {
  const builtIn = GENRES.find((g) => g.id === id);
  if (builtIn) return builtIn;
  const own = custom.find((c) => c.id === id);
  return own ? fromCustom(own) : undefined;
}

/**
 * The search text of a genre in one language: its main query, after the topic when there is one
 * ("Smart Bins" + cars → "Smart Bins car edit"). Spaces are collapsed; a blank topic counts as none.
 */
export function genreQuery(genre: Genre, lang: Lang, topic?: string): string {
  const main = genre.queries[lang][0];
  const base = topic ? squash(topic) : "";
  return squash(base ? `${base} ${main}` : main);
}

/** The genre's Instagram hashtag slug (no "#"), when it has one (custom genres have none). */
export function genreHashtag(genre: Genre): string | undefined {
  return genre.hashtags[0];
}

/**
 * Id of an owner-added genre: "custom-" + the lower-case slug of its name, so the same name always gives the
 * same id and never a built-in one. Never empty: a name without letters or digits (emoji only) falls back to
 * its code points, a blank one to "custom-genre".
 */
export function customGenreId(name: string): string {
  const slug = nameSlug(name);
  if (slug) return CUSTOM_PREFIX + slug;
  const points = [...name.trim()].slice(0, 8).map((ch) => ch.codePointAt(0)!.toString(16));
  return CUSTOM_PREFIX + (points.length ? points.join("-") : "genre");
}

/**
 * True when a genre with that name already exists: a custom genre with the same normalized name (the same
 * id), or a built-in genre called that in Arabic or English. The store's addCustomGenre ignores such a name
 * and the Settings form marks it.
 */
export function isGenreNameTaken(name: string, custom: readonly CustomGenre[]): boolean {
  const id = customGenreId(name);
  if (custom.some((c) => c.id === id)) return true;
  const slug = nameSlug(name);
  if (!slug) return false;
  return GENRES.some((g) => nameSlug(g.name.ar) === slug || nameSlug(g.name.en) === slug);
}
