import { describe, expect, it } from "vitest";
import { GenreSchema } from "@/lib/domain";
import { GENRES } from "./genres";

describe("edit genres (planning/data/genres.json)", () => {
  it("loads the twelve built-in genres in file order", () => {
    expect(GENRES.map((g) => g.id)).toEqual([
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
});
