import { z } from "zod";
import raw from "@/planning/data/genres.json";
import { GenreSchema, type Genre } from "@/lib/domain";

/**
 * 🎬 Edit genres (round 31): the built-in genres Discover, the skill Research panel and the Trend Radar offer
 * (cars, food, anime, travel…), loaded straight from planning/data/genres.json. The JSON stays the single
 * source (the Scout Worker bundles the same file for its daily keyword scan); this file only validates it.
 * The owner's own genres live in the store (`customGenres`); lib/genres puts the two together.
 */

const GenresFileSchema = z.object({
  version: z.literal(1),
  genres: z.array(GenreSchema).min(1),
});

/** Every built-in genre, validated (defaults filled), in file order (the order of the chips). */
export const GENRES: readonly Genre[] = GenresFileSchema.parse(raw).genres;
