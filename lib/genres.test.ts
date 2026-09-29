import { describe, expect, it } from "vitest";
import { GENRES as DATA_GENRES } from "@/data/genres";
import { CustomGenreSchema, type CustomGenre, type Genre } from "@/lib/domain";
import {
  CUSTOM_GENRE_EMOJI,
  GENRES,
  allGenres,
  customGenreId,
  genreById,
  genreHashtag,
  genreQuery,
  isGenreNameTaken,
} from "./genres";

const drift: CustomGenre = { id: "custom-drift", name: "Drift", query: "drift edit" };
const hajwala: CustomGenre = { id: "custom-هجولة", name: "هجولة", query: "ايديت هجولة" };
const cars = GENRES.find((g) => g.id === "cars")!;

describe("GENRES", () => {
  it("is the validated list of data/genres", () => {
    expect(GENRES).toBe(DATA_GENRES);
    expect(GENRES).toHaveLength(12);
  });
});

describe("allGenres", () => {
  it("is the built-in list when the owner added none", () => {
    expect(allGenres([])).toEqual([...GENRES]);
  });

  it("puts the custom genres after the built-in ones, in the order added", () => {
    const all = allGenres([drift, hajwala]);
    expect(all.map((g) => g.id)).toEqual([
      ...GENRES.map((g) => g.id),
      "custom-drift",
      "custom-هجولة",
    ]);
  });

  it("turns a custom genre into ✨ with one name and the same words for both languages", () => {
    const own = allGenres([drift]).at(-1)!;
    expect(own).toEqual<Genre>({
      id: "custom-drift",
      emoji: "✨",
      name: { ar: "Drift", en: "Drift" },
      queries: { ar: ["drift edit"], en: ["drift edit"] },
      hashtags: [],
    });
    expect(own.emoji).toBe(CUSTOM_GENRE_EMOJI);
  });

  it("returns a new array and never touches its inputs", () => {
    const custom = Object.freeze([drift]);
    const all = allGenres(custom);
    all.pop();
    expect(GENRES).toHaveLength(12);
    expect(custom).toHaveLength(1);
    expect(allGenres(custom)).toHaveLength(13);
  });
});

describe("genreById", () => {
  it("finds built-in and custom genres and gives undefined for an unknown id", () => {
    expect(genreById("cars", [])).toBe(cars);
    expect(genreById("custom-drift", [drift])?.name.en).toBe("Drift");
    expect(genreById("custom-drift", [])).toBeUndefined();
    expect(genreById("nope", [drift])).toBeUndefined();
    expect(genreById("", [drift])).toBeUndefined();
  });

  it("prefers the built-in genre when a stored custom one carries the same id", () => {
    const clash: CustomGenre = { id: "cars", name: "My cars", query: "x" };
    expect(genreById("cars", [clash])).toBe(cars);
  });
});

describe("genreQuery", () => {
  it("is the genre's main query in the asked language when there is no topic", () => {
    expect(genreQuery(cars, "en")).toBe("car edit");
    expect(genreQuery(cars, "ar")).toBe("ايديت سيارات");
    expect(genreQuery(cars, "en", "")).toBe("car edit");
    expect(genreQuery(cars, "en", "   ")).toBe("car edit");
    expect(genreQuery(cars, "en", undefined)).toBe("car edit");
  });

  it("puts the topic first and collapses spaces", () => {
    expect(genreQuery(cars, "en", "Smart Bins")).toBe("Smart Bins car edit");
    expect(genreQuery(cars, "en", "  match   cut \n")).toBe("match cut car edit");
    expect(genreQuery(cars, "ar", "ترانزيشن")).toBe("ترانزيشن ايديت سيارات");
  });

  it("uses a custom genre's words in both languages", () => {
    const own = genreById("custom-drift", [drift])!;
    expect(genreQuery(own, "ar")).toBe("drift edit");
    expect(genreQuery(own, "en", "speed ramp")).toBe("speed ramp drift edit");
  });

  it("collapses spaces inside the genre's own words too", () => {
    const messy = genreById("custom-x", [{ id: "custom-x", name: "X", query: " a   b " }])!;
    expect(genreQuery(messy, "en")).toBe("a b");
    expect(genreQuery(messy, "en", "t")).toBe("t a b");
  });

  it("every built-in genre gives a non-empty query in both languages", () => {
    for (const g of GENRES) {
      expect(genreQuery(g, "ar"), g.id).toBe(g.queries.ar[0]);
      expect(genreQuery(g, "en"), g.id).toBe(g.queries.en[0]);
    }
  });
});

describe("genreHashtag", () => {
  it("is the first hashtag slug, and undefined for a genre without hashtags", () => {
    expect(genreHashtag(cars)).toBe("caredit");
    expect(genreHashtag(genreById("anime", [])!)).toBe("animeedit");
    expect(genreHashtag(genreById("custom-drift", [drift])!)).toBeUndefined();
  });
});

describe("customGenreId", () => {
  it("is custom- plus the lower-case slug of the name", () => {
    expect(customGenreId("Drift")).toBe("custom-drift");
    expect(customGenreId("  Street   Food!  ")).toBe("custom-street-food");
    expect(customGenreId("Real Estate & Villas")).toBe("custom-real-estate-villas");
    expect(customGenreId("4K drone")).toBe("custom-4k-drone");
  });

  it("keeps letters and digits of any script", () => {
    expect(customGenreId("هجولة")).toBe("custom-هجولة");
    expect(customGenreId("سيارات كلاسيك")).toBe("custom-سيارات-كلاسيك");
    expect(customGenreId("رمضان ٢٠٢٧")).toMatch(/^custom-رمضان-/);
    expect(customGenreId("Café ☕")).toBe("custom-café");
  });

  it("gives the same id to the same name typed another way", () => {
    expect(customGenreId("drift")).toBe(customGenreId(" DRIFT "));
    expect(customGenreId("street food")).toBe(customGenreId("Street-Food"));
    // Tashkeel and the tatweel do not make a new genre.
    expect(customGenreId("قهوَة")).toBe(customGenreId("قهوة"));
    expect(customGenreId("قهـــوة")).toBe(customGenreId("قهوة"));
  });

  it("is never empty and never a built-in id", () => {
    expect(customGenreId("")).toBe("custom-genre");
    expect(customGenreId("   ")).toBe("custom-genre");
    expect(customGenreId("🔥")).toBe("custom-1f525");
    expect(customGenreId("🔥")).not.toBe(customGenreId("🌊"));
    expect(customGenreId("!!!")).toMatch(/^custom-[0-9a-f-]+$/);
    for (const g of GENRES) {
      expect(customGenreId(g.name.en)).not.toBe(g.id);
      expect(GENRES.some((x) => x.id === customGenreId(g.id))).toBe(false);
    }
  });

  it("makes ids the custom genre schema accepts", () => {
    for (const name of ["Drift", "هجولة", "🔥", "", "  "]) {
      const genre = { id: customGenreId(name), name: name.trim() || "x", query: "q" };
      expect(CustomGenreSchema.safeParse(genre).success, name).toBe(true);
    }
  });
});

describe("isGenreNameTaken", () => {
  it("is false for a new name", () => {
    expect(isGenreNameTaken("Drift", [])).toBe(false);
    expect(isGenreNameTaken("Drift", [hajwala])).toBe(false);
  });

  it("is true for a custom genre with the same normalized name", () => {
    expect(isGenreNameTaken("Drift", [drift])).toBe(true);
    expect(isGenreNameTaken("  drift ", [drift])).toBe(true);
    expect(isGenreNameTaken("DRIFT!", [drift])).toBe(true);
    expect(isGenreNameTaken("هجولة", [hajwala])).toBe(true);
  });

  it("is true for the name of a built-in genre in either language", () => {
    expect(isGenreNameTaken("Cars", [])).toBe(true);
    expect(isGenreNameTaken("cars", [])).toBe(true);
    expect(isGenreNameTaken("سيارات", [])).toBe(true);
    expect(isGenreNameTaken("food & restaurants", [])).toBe(true);
    expect(isGenreNameTaken("Classic cars", [])).toBe(false);
  });

  it("treats emoji-only names by their own id", () => {
    const fire: CustomGenre = { id: customGenreId("🔥"), name: "🔥", query: "fire edit" };
    expect(isGenreNameTaken("🔥", [fire])).toBe(true);
    expect(isGenreNameTaken("🌊", [fire])).toBe(false);
  });
});

describe("Discover deep link", () => {
  it("builds the Discover URL of a genre, encoding ids of any script", async () => {
    const { discoverGenreHref } = await import("./genres");
    expect(discoverGenreHref("cars")).toBe("/discover/?genre=cars");
    expect(discoverGenreHref("custom-هجولة")).toBe(
      `/discover/?genre=${encodeURIComponent("custom-هجولة")}`,
    );
  });

  it("reads the genre id back from a search string", async () => {
    const { discoverGenreHref, genreIdFromSearch } = await import("./genres");
    expect(genreIdFromSearch("?genre=cars")).toBe("cars");
    expect(genreIdFromSearch("?q=x&genre=food")).toBe("food");
    expect(genreIdFromSearch(discoverGenreHref("custom-هجولة").split("?")[1])).toBe("custom-هجولة");
    expect(genreIdFromSearch("")).toBeUndefined();
    expect(genreIdFromSearch("?genre=")).toBeUndefined();
    expect(genreIdFromSearch("?genre=%20")).toBeUndefined();
  });
});
