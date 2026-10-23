import { describe, expect, it } from "vitest";
import { GenreGroupSchema, GenreSchema } from "@/lib/domain";
import raw from "@/planning/data/genres.json";
import { GENRE_GROUPS, GENRES, GenresFileSchema } from "./genres";

describe("edit genres (planning/data/genres.json)", () => {
  it("loads the 35 built-in genres in file order, the first twelve unchanged", () => {
    expect(GENRES).toHaveLength(35);
    expect(GENRES.slice(0, 12).map((g) => g.id)).toEqual([
      "cars",
      "food",
      "anime",
      "travel",
      "football",
      "coffee",
      "perfume",
      "camping",
      "fashion",
      "gaming",
      "weddings",
      "gym",
    ]);
    expect(GENRES.slice(12).map((g) => g.id)).toEqual([
      "combat",
      "basketball",
      "desserts",
      "cooking",
      "beauty",
      "family",
      "luxury",
      "sea",
      "drone",
      "music",
      "cinematic",
      "podcast",
      "comedy",
      "bikes",
      "racing",
      "realestate",
      "services",
      "product",
      "corporate",
      "tech",
      "photography",
      "colorgrading",
      "vfx",
    ]);
  });

  it("has unique ids that follow the id rule and never look like a custom genre", () => {
    const ids = GENRES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(id.startsWith("custom-"), id).toBe(false);
    }
  });

  it("names every genre in Arabic and English with an emoji", () => {
    for (const g of GENRES) {
      expect(g.emoji.trim().length, g.id).toBeGreaterThan(0);
      expect(g.name.ar.trim().length, g.id).toBeGreaterThan(0);
      expect(g.name.en.trim().length, g.id).toBeGreaterThan(0);
    }
    const names = GENRES.flatMap((g) => [g.name.ar, g.name.en]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every genre Arabic and English queries, trimmed, the main one first", () => {
    for (const g of GENRES) {
      for (const lang of ["ar", "en"] as const) {
        expect(g.queries[lang].length, `${g.id} ${lang}`).toBeGreaterThan(0);
        for (const q of g.queries[lang]) {
          expect(q, `${g.id} ${lang}`).toBe(q.trim());
          expect(q.length, `${g.id} ${lang}`).toBeGreaterThan(0);
          expect(q, `${g.id} ${lang}`).not.toMatch(/\s{2,}/);
        }
        expect(new Set(g.queries[lang]).size, `${g.id} ${lang}`).toBe(g.queries[lang].length);
      }
      // Arabic queries are written in Arabic, English ones in Latin letters.
      expect(g.queries.ar[0], g.id).toMatch(/[\u0600-\u06FF]/);
      expect(g.queries.en[0], g.id).toMatch(/^[a-z0-9 -]+$/);
    }
    // The radar scans the main queries: two genres must never share one.
    for (const lang of ["ar", "en"] as const) {
      const main = GENRES.map((g) => g.queries[lang][0]);
      expect(new Set(main).size, lang).toBe(main.length);
    }
  });

  it("has hashtag slugs (no #, lower-case letters, digits and _) on every genre", () => {
    for (const g of GENRES) {
      expect(g.hashtags.length, g.id).toBeGreaterThan(0);
      for (const h of g.hashtags) expect(h, g.id).toMatch(/^[a-z0-9_]+$/);
      expect(new Set(g.hashtags).size, g.id).toBe(g.hashtags.length);
    }
  });

  it("GenreSchema fills the hashtags default and refuses a bad id, an empty query list or a # hashtag", () => {
    const base = {
      id: "drift",
      emoji: "🏎️",
      name: { ar: "درفت", en: "Drift" },
      queries: { ar: ["ايديت درفت"], en: ["drift edit"] },
    };
    expect(GenreSchema.parse(base).hashtags).toEqual([]);
    expect(GenreSchema.safeParse({ ...base, id: "Drift" }).success).toBe(false);
    expect(GenreSchema.safeParse({ ...base, id: "1drift" }).success).toBe(false);
    expect(GenreSchema.safeParse({ ...base, queries: { ar: [], en: ["x"] } }).success).toBe(false);
    expect(GenreSchema.safeParse({ ...base, queries: { ar: ["x"] } }).success).toBe(false);
    expect(GenreSchema.safeParse({ ...base, hashtags: ["#drift"] }).success).toBe(false);
    expect(GenreSchema.safeParse({ ...base, hashtags: ["Drift"] }).success).toBe(false);
  });

  it("groups every built-in genre in 8 groups: football and gym under Sport, each group used, mine reserved", () => {
    expect(GENRE_GROUPS.map((g) => g.id)).toEqual([
      "sport",
      "food",
      "lifestyle",
      "outdoors",
      "entertainment",
      "automotive",
      "business",
      "craft",
    ]);
    const ids = new Set(GENRE_GROUPS.map((g) => g.id));
    expect(ids.size).toBe(GENRE_GROUPS.length);
    for (const g of GENRE_GROUPS) {
      expect(g.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(g.id).not.toBe("mine");
      expect(g.emoji.trim().length, g.id).toBeGreaterThan(0);
      expect(g.name.ar.trim().length, g.id).toBeGreaterThan(0);
      expect(g.name.en.trim().length, g.id).toBeGreaterThan(0);
    }
    // No genre without a group, and every group names a defined one.
    for (const g of GENRES) expect(ids.has(g.group ?? ""), g.id).toBe(true);
    const of = (group: string) => GENRES.filter((g) => g.group === group).map((g) => g.id);
    expect(of("sport")).toEqual(["football", "gym", "combat", "basketball"]);
    expect(of("food")).toEqual(["food", "coffee", "desserts", "cooking"]);
    expect(of("lifestyle")).toEqual([
      "perfume",
      "fashion",
      "weddings",
      "beauty",
      "family",
      "luxury",
    ]);
    expect(of("outdoors")).toEqual(["travel", "camping", "sea", "drone"]);
    expect(of("entertainment")).toEqual([
      "anime",
      "gaming",
      "music",
      "cinematic",
      "podcast",
      "comedy",
    ]);
    expect(of("automotive")).toEqual(["cars", "bikes", "racing"]);
    expect(of("business")).toEqual(["realestate", "services", "product", "corporate", "tech"]);
    expect(of("craft")).toEqual(["photography", "colorgrading", "vfx"]);
    for (const group of GENRE_GROUPS) expect(of(group.id).length, group.id).toBeGreaterThan(0);
  });

  it("refuses a file whose built-in genre has no group, an unknown group, or a group called mine", () => {
    const file = raw as { groups: { id: string }[]; genres: Record<string, unknown>[] };
    expect(GenresFileSchema.safeParse(file).success).toBe(true);
    const genres = (change: Record<string, unknown>) =>
      file.genres.map((g, i) => (i === 0 ? { ...g, ...change } : g));
    expect(
      GenresFileSchema.safeParse({ ...file, genres: genres({ group: undefined }) }).success,
    ).toBe(false);
    expect(
      GenresFileSchema.safeParse({ ...file, genres: genres({ group: "drift" }) }).success,
    ).toBe(false);
    const mine = { id: "mine", emoji: "✨", name: { ar: "حقّي", en: "Mine" } };
    expect(GenresFileSchema.safeParse({ ...file, groups: [...file.groups, mine] }).success).toBe(
      false,
    );
  });

  it("GenreSchema keeps an optional group id; GenreGroupSchema checks a group", () => {
    const base = {
      id: "drift",
      emoji: "🏎️",
      name: { ar: "درفت", en: "Drift" },
      queries: { ar: ["ايديت درفت"], en: ["drift edit"] },
    };
    expect(GenreSchema.parse(base).group).toBeUndefined();
    expect(GenreSchema.parse({ ...base, group: "cars" }).group).toBe("cars");
    expect(GenreSchema.safeParse({ ...base, group: "Cars" }).success).toBe(false);
    const group = { id: "sport", emoji: "🏟️", name: { ar: "رياضة", en: "Sport" } };
    expect(GenreGroupSchema.parse(group)).toEqual(group);
    expect(GenreGroupSchema.safeParse({ ...group, id: "1sport" }).success).toBe(false);
    expect(GenreGroupSchema.safeParse({ ...group, emoji: "" }).success).toBe(false);
  });
});
