import { z } from "zod";
import raw from "@/planning/data/genres.json";
import { GenreGroupSchema, GenreSchema, type Genre, type GenreGroup } from "@/lib/domain";

/**
 * 🎬 Edit genres (round 31): the built-in genres Discover, the skill Research panel and the Trend Radar offer
 * (cars, food, anime, travel…), loaded straight from planning/data/genres.json. The JSON stays the single
 * source (the Scout Worker bundles the same file for its daily keyword scan); this file only validates it.
 * The owner's own genres live in the store (`customGenres`); lib/genres puts the two together.
 * `groups` are the picker's headings (Sport → Football, Gym…); "mine" is kept for the owner's own genres.
 */

export const GenresFileSchema = z
  .object({
    version: z.literal(1),
    groups: z.array(GenreGroupSchema).min(1),
    genres: z.array(GenreSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = file.groups.map((g) => g.id);
    if (new Set(ids).size !== ids.length || ids.includes("mine"))
      ctx.addIssue({ code: "custom", message: "group ids must be unique and never 'mine'" });
    // `group` is optional in GenreSchema only for the owner's own genres; every built-in one must name a group.
    for (const genre of file.genres)
      if (genre.group === undefined || !ids.includes(genre.group))
        ctx.addIssue({ code: "custom", message: `${genre.id}: missing or unknown group` });
  });

const file = GenresFileSchema.parse(raw);
/** Every built-in genre, validated (defaults filled), in file order (the order of the chips). */
export const GENRES: readonly Genre[] = file.genres;
/** The picker's group headings, in file order. */
export const GENRE_GROUPS: readonly GenreGroup[] = file.groups;
