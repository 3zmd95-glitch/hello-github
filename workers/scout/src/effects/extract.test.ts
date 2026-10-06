import { describe, expect, it } from "vitest";
import { candidatesOf, creatorId, extractCandidates } from "./extract";
import type { EffectPost } from "./types";

const keys = (text: string) =>
  candidatesOf(text)
    .map((c) => c.key)
    .sort();

describe("candidatesOf", () => {
  it("finds dictionary effects, named trends, phrases and hashtags", () => {
    expect(keys("CapCut clone effect tutorial: how to clone yourself in a video")).toContain(
      "clone-effect",
    );
    expect(keys("How to Edit the New CapCut Reverse Trend | Easy Tutorial")).toContain(
      "reverse-trend",
    );
    expect(keys("Chanel Confidence: Clone Yourself with One Hair (Swagger Trend)")).toContain(
      "swagger-trend",
    );
    expect(keys("Most Trending Flash Clone Edit Tutorial: How to Make It")).toContain(
      "flash-clone-edit",
    );
    expect(keys("insane ghost trail effect on my car clip")).toContain("ghost-trail-effect");
    expect(keys("#cloneeffect #reversetrend #fyp")).toEqual(
      expect.arrayContaining(["clone-effect", "reverse-trend"]),
    );
  });

  it("never keeps generic or junk names", () => {
    expect(keys("CapCut edit trend: easy viral-style video edits")).toEqual([]);
    expect(keys("Hopping on the Latest CapCut Trend 🙈 #viraltrend #capcuttrend")).toEqual([]);
    expect(keys("best sound effect pack and the butterfly effect explained")).toEqual([]);
  });

  it("files a phrase that is a dictionary effect under the dictionary id", () => {
    const [c] = candidatesOf("This clone effect is everywhere");
    expect(c).toMatchObject({ key: "clone-effect", termId: "clone-effect" });
  });

  it("counts every dictionary effect a post names, but never the catch-all 'transitions'", () => {
    // Spec §1 step 2: every matched entry counts, so an earlier entry in the file never hides a later one.
    expect(keys("speed ramp and match cut combo")).toEqual(["match-cut", "speed-ramp"]);
    // A bare "transition" is a generic word, not a trend (the dictionary marks that entry `generic`).
    expect(keys("new transition trend reels #transitions")).toEqual([]);
  });

  it("reads hashtags ending in trick or a plural, and starts names at a word", () => {
    expect(keys("#clonetrick #glitcheffects")).toEqual(["clone-effect", "glitch"]);
    expect(keys("3D text effect")).toEqual(["text-animation"]); // not "d text effect"
  });

  it("files clone-yourself posts under the clone effect, but not biology cloning", () => {
    expect(keys("Clone yourself in CapCut 🔥 #cloneyourself")).toEqual(["clone-effect"]);
    expect(keys("طريقة استنساخ نفسك بالفيديو")).toEqual(["clone-effect"]);
    expect(keys("درس الاستنساخ في الأحياء")).toEqual([]);
  });

  it("needs more than a bare word in the post for entries whose word means other things", () => {
    const flash = keys("Most Trending Flash Clone Edit Tutorial: How to Make It");
    expect(flash).toContain("flash-clone-edit");
    expect(flash).not.toContain("flash-transition"); // "flash" alone: flash-transition is not `specific`
    expect(keys("flash transition tutorial")).toContain("flash-transition");
    expect(keys("cloning myself in capcut")).toEqual(["clone-effect"]); // a specific entry keeps its words
  });

  it("names an effect by the words right before its suffix, never across a generic word", () => {
    const names = (text: string) => candidatesOf(text).map((c) => c.name);
    expect(keys("glitch and zoom transition")).toEqual(["zoom-transition"]);
    expect(names("New CapCut Reverse Trend")).toEqual(["reverse trend"]);
    expect(names("Trending Flash Clone Edit")).toEqual(["flash clone edit"]);
    // The nearest suffix wins: "Edit" before "Trend".
    expect(names("First Month Edit Trend")).toEqual(["first month edit"]);
  });
});

describe("extractCandidates", () => {
  const post = (
    handle: string,
    title: string,
    platform: "tt" | "ig" = "tt",
    n = 0,
  ): EffectPost => ({
    platform,
    handle,
    title,
    snippet: "",
    url: `https://www.tiktok.com/${handle}/video/${handle.length}${n}${title.length}`,
  });

  it("counts distinct creators, not posts, and keeps at most 2 samples", async () => {
    const found = await extractCandidates([
      post("@a", "clone effect tutorial", "tt", 1),
      post("@a", "clone effect part 2", "tt", 2),
      post("@b", "my clone effect edit", "ig", 3),
      post("@c", "Clone effect in CapCut", "tt", 4),
    ]);
    const clone = found.get("clone-effect")!;
    expect(clone.ids.size).toBe(3);
    expect(clone.posts).toBe(4);
    expect([...clone.platforms].sort()).toEqual(["ig", "tt"]);
    expect(clone.samples).toHaveLength(2);
  });

  it("counts a post that two searches both returned once", async () => {
    const p = post("@a", "clone effect tutorial");
    expect((await extractCandidates([p, p])).get("clone-effect")!.posts).toBe(1);
  });

  it("hashes creators so no handle is stored", async () => {
    const id = await creatorId("tt", "@someone");
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id).toBe(await creatorId("tt", "@someone"));
    expect(id).not.toBe(await creatorId("ig", "@someone"));
  });
});
