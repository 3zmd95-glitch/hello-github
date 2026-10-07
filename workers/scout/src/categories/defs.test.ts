import { describe, expect, it } from "vitest";
import { candidatesOf } from "../effects/extract";
import {
  aiContext,
  attemptsKey,
  CATEGORY_SLOTS,
  CATEGORY_SUFFIXES,
  categoriesForDay,
  categoryById,
  categoryGeneric,
  categoryKey,
  categoryQueries,
  categorySubject,
  categoryWords,
} from "./defs";

describe("category turns (planning/tools/19-category-trends.md §2)", () => {
  it("4 slots right after the effects slot (05:35)", () => {
    expect(CATEGORY_SLOTS).toEqual(["05:40", "05:45", "05:50", "05:55"]);
  });

  it("groups the 12 categories by UTC day % 3 in genres.json order: each one every 3 days", () => {
    // UTC day numbers: 2026-10-07 is 20733 (% 3 = 0), 10-08 is 1, 10-09 is 2.
    expect(categoriesForDay("2026-10-07")).toEqual(["cars", "food", "anime", "travel"]);
    expect(categoriesForDay("2026-10-08")).toEqual(["football", "coffee", "perfume", "camping"]);
    expect(categoriesForDay("2026-10-09")).toEqual(["fashion", "gaming", "weddings", "gym"]);
    expect(categoriesForDay("2026-10-10")).toEqual(categoriesForDay("2026-10-07"));
  });
});

describe("a category's searches and words", () => {
  const cars = categoryById("cars")!;
  const food = categoryById("food")!;

  it("keeps six focused subject-and-technique searches without popularity boilerplate", () => {
    expect(categoryQueries(cars)).toEqual([
      "cinematic car rolling shots",
      "automotive commercial car edit",
      "car match cut transition",
      "car videography editing tutorial",
      "car speed ramp cinematic edit",
      "how to film cinematic car rollers",
    ]);
    expect(categoryQueries(food)).toEqual([
      "food commercial cinematic b roll",
      "restaurant food video ad",
      "food match cut transition",
      "food videography lighting tutorial",
      "food speed ramp cinematic edit",
      "food commercial editing breakdown",
    ]);
  });

  it("the words that name it: its English name's (a plural one's singular too) and its subject's, not 'edit'", () => {
    expect(categorySubject(cars)).toBe("car");
    expect([...categoryWords(cars)].sort()).toEqual(["car", "cars"]);
    expect([...categoryWords(food)].sort()).toEqual(["food", "restaurant", "restaurants"]);
  });

  it("the words of its English name (a plural one's singular too) and its main query are generic for it", () => {
    expect([...categoryGeneric(cars)].sort()).toEqual(["car", "cars", "edit"]);
    expect([...categoryGeneric(food)].sort()).toEqual([
      "edit",
      "food",
      "restaurant",
      "restaurants",
    ]);
  });

  it("leaves the second query's words free: it is there to find the category's signature styles", () => {
    const styles = (id: string, text: string) =>
      candidatesOf(text, {
        suffixes: CATEGORY_SUFFIXES,
        generic: categoryGeneric(categoryById(id)!),
      }).map((c) => c.key);
    expect(styles("fashion", "outfit transition trend 🔥 | #outfittransition")).toEqual([
      "outfit-transition",
    ]);
    // Its own words are still never a style: no "car edit", no "restaurant edit".
    expect(styles("cars", "car edit trend #caredit | Car Edit")).toEqual([]);
    expect(styles("food", "Restaurant Edit | restaurant edit trend #restauranttrend")).toEqual([]);
  });

  it("tells the AI the subject and to answer every key (live fix 1: the first scan's answer was an empty list), and keys its KV documents", () => {
    expect(aiContext(cars)).toContain("for car videos");
    expect(
      aiContext(cars).endsWith(" Return one entry for every candidate key, keep true or false."),
    ).toBe(true);
    expect(categoryKey("cars")).toBe("category:cars");
    expect(attemptsKey("cars", "2026-10-07")).toBe("category:attempts:cars:2026-10-07");
    expect(categoryById("custom-drift")).toBeUndefined();
  });
});
