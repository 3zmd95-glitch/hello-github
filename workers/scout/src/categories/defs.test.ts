import { describe, expect, it } from "vitest";
import {
  aiContext,
  attemptsKey,
  CATEGORY_SLOTS,
  categoriesForDay,
  categoryById,
  categoryGeneric,
  categoryKey,
  categoryQueries,
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

  it("2 English queries: the main one with ' trend', then the second as it is", () => {
    expect(categoryQueries(cars)).toEqual(["car edit trend", "cinematic car edit"]);
    expect(categoryQueries(food)).toEqual(["food edit trend", "restaurant cinematic video"]);
  });

  it("the words of its English name and queries are generic for it", () => {
    expect([...categoryGeneric(cars)].sort()).toEqual(["car", "cars", "cinematic", "edit"]);
    expect(categoryGeneric(food)).toEqual(
      new Set(["food", "restaurants", "edit", "restaurant", "cinematic", "video"]),
    );
  });

  it("tells the AI the subject, and keys its KV documents", () => {
    expect(aiContext(cars)).toContain("for car videos");
    expect(categoryKey("cars")).toBe("category:cars");
    expect(attemptsKey("cars", "2026-10-07")).toBe("category:attempts:cars:2026-10-07");
    expect(categoryById("custom-drift")).toBeUndefined();
  });
});
