import { describe, expect, it } from "vitest";
import { CATEGORY_PROFILES } from "../discover/category-profiles";
import { categoryCreativeEvidence as evidence, rankCategoryVideos } from "./quality";
import type { TopVideo } from "./types";

describe("category recommendations grounded in metadata", () => {
  it("requires both subject and creative evidence across all12 category profiles", () => {
    for (const [id, profile] of Object.entries(CATEGORY_PROFILES)) {
      expect(evidence(id, profile.examples.en).eligible, id).toBe(true);
      expect(evidence(id, profile.examples.ar).eligible, `${id}:Arabic`).toBe(true);
    }
    expect(evidence("food", "Cinematic car edit with speed ramps").eligible).toBe(false);
    expect(evidence("cars", "carpet lighting review").category).toBe(false);
    expect(evidence("coffee", "coffeemaker price list").eligible).toBe(false);
  });
  it.each([
    "Stainless Steel Kitchen Prep: Perfect for Food Prep",
    "4 Food Processors for All Your Kitchen Prep in 2026",
    "Heavy Duty Stainless Steel Kitchen Prep Tables | Commercial Food Prep Work Tables",
    "maya.hayaa #trialreels .",
    "@nivyarodrigues2020 literally me around food.",
    "food POV viral aesthetic",
    "food prices and deals",
    "#foodedit #cinematic",
    "Food processor cinematic review with lighting tutorial",
  ])("rejects the observed Food filler: %s", (title) => {
    expect(evidence("food", title).eligible).toBe(false);
  });
  it.each([
    "5 shots every restaurant video needs",
    "Baba Restaurant Speed Ramp Edit | Food",
    "Food kitchen prep timelapse cinematic film",
    "Burger commercial",
    "Pizza stop motion ad",
    "إعلان مطعم سينمائي",
    "تصوير برجر تايم لابس",
    "New project: #foodedit",
  ])("preserves useful examples: %s", (title) =>
    expect(evidence("food", title).eligible).toBe(true),
  );
  it("does not treat ordinary espresso shots or hashtag-only numeric captions as creative evidence", () => {
    expect(evidence("coffee", "Two espresso shots for my morning coffee").eligible).toBe(false);
    expect(evidence("food", "#foodedit #cinematic 2026").eligible).toBe(false);
  });
  it("rejects equipment for generic lesson tutorials too, with no false creative flag", () => {
    expect(evidence("food", "How to use food processors - editing tutorial").creative).toBe(false);
    expect(evidence("food", "speed ramp editing tutorial")).toMatchObject({
      category: false,
      creative: true,
      eligible: false,
    });
  });
});

describe("ranking and diversity", () => {
  const video = (
    id: string,
    title = "Food cinematic edit",
    creator?: string,
    views = 0,
  ): TopVideo => ({
    url: `https://www.instagram.com/p/${id}`,
    title,
    creator,
    views,
  });
  it("specific visual techniques beat raw popularity or repeated search hits", () => {
    const repeated = video("repeated", "Food edit", "@one", 999999);
    const specific = video("specific", "Food cinematic match cut commercial", "@two", 10);
    const result = rankCategoryVideos("food", [
      repeated,
      repeated,
      repeated,
      specific,
      video("filler", "Food prices", "@three", 1000000),
    ]);
    expect(result.map((v) => v.url)).toEqual([specific.url, repeated.url]);
    expect(result[0].evidence).toEqual({
      basis: "metadata",
      subjects: ["food"],
      techniques: ["match cut", "cinematic", "creative commercial"],
    });
  });
  it("gives distinct creators the first places, caps one creator at three, never pads", () => {
    const same = [1, 2, 3, 4, 5].map((n) => video(`a${n}`, "Food cinematic speed ramp edit", "@A"));
    const other = video("other", "Food edit", "@b");
    expect(rankCategoryVideos("food", [...same, other]).map((v) => v.url)).toEqual([
      same[0].url,
      other.url,
      same[1].url,
      same[2].url,
    ]);
    expect(rankCategoryVideos("food", [video("bad", "Food processors")])).toEqual([]);
  });
  it("preserves descriptions and dates, validates links and recomputes untrusted stored evidence", () => {
    const good = {
      ...video("good", "Lunch shoot"),
      snippet: "Food cinematic match cut",
      publishedAt: "2026-10-06T00:00:00Z",
      source: "tavily" as const,
    };
    const bad = {
      ...video("bad", "Price list"),
      evidence: { basis: "metadata" as const, subjects: ["food"], techniques: ["cinematic"] },
    };
    const result = rankCategoryVideos("food", [
      good,
      bad,
      { ...good, url: "https://example.com/reel/x" },
      { ...good, url: "https://www.instagram.com/explore/tags/food" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(good);
  });
});
