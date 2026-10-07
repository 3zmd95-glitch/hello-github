import { describe, expect, it, vi } from "vitest";
import { creatorsBetween, mergeHistory } from "./score";
import { candidatesOf, creatorId, extractCandidates, suffixPatterns } from "./extract";
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

  it("files 'clone trend' posts under the clone effect, never as a separate trend", () => {
    expect(keys("The Clone Trend 👥 #clonetrend")).toEqual(["clone-effect"]);
    // "Flash Clone Edit" stays its own named trend.
    expect(keys("Flash Clone Edit")).toEqual(["flash-clone-edit"]);
  });

  it("files GIF-sticker posts under the dictionary's GIF stickers (the owner's second reel)", () => {
    for (const text of [
      "Animated GIF stickers on my hiking video 🏔️ | #gifstickers",
      "how to add moving stickers to your reels",
      "Hiking vlog with animated stickers ✨",
      "#stickeroverlay",
      // The owner's reel caption, as its creators write it (handles replaced), and two the live check found.
      "music: playground by @artist / gif stickers by @maker / #cinematicreels #naturevibes #visualstorytelling",
      "Gif sticker by @maker",
      "This moving sticker trend is everywhere",
    ])
      expect(keys(text), text).toEqual(["gif-stickers"]);
  });

  it("gives plural and singular spellings of a new name one key, keeping the name as written", () => {
    expect(keys("gif stickers trend")).toEqual(keys("gif sticker trend"));
    expect(keys("ghost frames trend")).toEqual(["ghost-frame-trend"]);
    expect(keys("ghost frame trend")).toEqual(["ghost-frame-trend"]);
    expect(candidatesOf("ghost frames trend").map((c) => c.name)).toEqual(["ghost frames trend"]);
  });

  it("never names a year", () => {
    expect(keys("2027 trend")).toEqual([]);
    expect(keys("#2027trend")).toEqual([]);
    expect(keys("1999 effect")).toEqual([]);
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

  it("never makes a name out of the catch-all 'transitions' entry", () => {
    expect(keys("seamless transition tutorial")).toEqual([]);
    expect(keys("#seamlesstransition")).toEqual([]);
  });

  it("reads a multi-word dictionary phrase written as one hashtag, never a bare word", () => {
    expect(keys("#cloneyourself #capcut #fyp")).toEqual(["clone-effect"]);
    expect(keys("#greenscreen")).toEqual(["chroma-key"]);
    expect(keys("#glitch #zoom")).toEqual([]);
  });

  it("reads 'trend' in any case, and 'edit trend' as a named edit", () => {
    expect(keys("Swagger trend tutorial")).toEqual(["swagger-trend"]);
    expect(keys("Reverse trend on CapCut")).toEqual(["reverse-trend"]);
    expect(keys("swagger edit trend")).toEqual(["swagger-edit"]);
    expect(keys("first month edit trend")).toEqual(["first-month-edit"]); // the Title-Case key
    expect(keys("New Dance Trend")).toEqual([]);
  });

  it("drops software names and possessives", () => {
    expect(keys("After Effects tutorial")).toEqual([]);
    expect(keys("Today's Trend")).toEqual([]);
    expect(keys("Today’s Trend")).toEqual([]);
    expect(keys("CapCut's Reverse Trend")).toEqual(["reverse-trend"]);
  });

  it("reads styled Unicode letters", () => {
    expect(keys("𝐒𝐰𝐚𝐠𝐠𝐞𝐫 𝐓𝐫𝐞𝐧𝐝")).toEqual(["swagger-trend"]);
  });

  it("starts a name at its first capitalised word when the suffix is capitalised", () => {
    expect(keys("omg Swagger Trend")).toEqual(["swagger-trend"]);
    expect(keys("mom does Swagger Trend")).toEqual(["swagger-trend"]);
    expect(keys("omg swagger trend")).toEqual(["omg-swagger-trend"]); // lowercase: the whole run
  });

  it("files '<dictionary phrase> trend' under that dictionary effect", () => {
    expect(keys("speed ramp trend")).toEqual(["speed-ramp"]);
  });

  it("files a dictionary phrase before any suffix word under that entry, with no new name beside it", () => {
    // The owner's reels: a second key could become a NEW chip next to the dictionary's own, and the AI no longer
    // sees a dictionary effect after its first day to merge it.
    for (const [text, key] of [
      ["gif sticker effect", "gif-stickers"],
      ["Animated Stickers Edit", "gif-stickers"],
      ["GIF Stickers Edit", "gif-stickers"],
      ["Clone Yourself Edit", "clone-effect"],
      ["gif stickers edit trend", "gif-stickers"],
      // The phrase written as one hashtag, as the post-text lookup reads it.
      ["#gifstickertrend", "gif-stickers"],
      ["#cloneyourselftrend", "clone-effect"],
    ])
      expect(keys(text), text).toEqual([key]);
    // Names that are more than a dictionary phrase stay their own.
    expect(keys("Flash Clone Edit")).toEqual(["flash-clone-edit"]);
    expect(keys("Shadow Clone Trend")).toEqual(["clone-effect", "shadow-clone-trend"]);
    expect(keys("Swagger Trend")).toEqual(["swagger-trend"]);
  });

  it("reads straight and curly apostrophes the same", () => {
    expect(keys("Don't Rush effect")).toEqual(["dont-rush-effect"]);
    expect(keys("Don’t Rush effect")).toEqual(["dont-rush-effect"]);
  });

  it("drops any name ending in 'after effect'", () => {
    expect(keys("Adobe After Effects")).toEqual([]);
    expect(keys("using After Effects")).toEqual([]);
  });

  it("never names lowercase-trend junk", () => {
    const junk =
      "hottest biggest favorite favourite current next big year her his their it let pov";
    for (const word of junk.split(" ")) expect(keys(`${word} trend`), word).toEqual([]);
  });
});

describe("extractCandidates", () => {
  const TODAY = "2026-10-07";
  const post = (
    handle: string,
    title: string,
    platform: "tt" | "ig" = "tt",
    n = 0,
    published = "2026-10-06T12:00:00.000Z",
  ): EffectPost => ({
    platform,
    handle,
    title,
    snippet: "",
    url: `https://www.tiktok.com/${handle}/video/${handle.length}${n}${title.length}`,
    published,
  });
  const found = async (posts: EffectPost[]) => (await extractCandidates(posts, TODAY)).cands;

  it("counts distinct creators, not posts, and keeps at most 2 samples", async () => {
    const clone = (
      await found([
        post("@a", "clone effect tutorial", "tt", 1),
        post("@a", "clone effect part 2", "tt", 2),
        post("@b", "my clone effect edit", "ig", 3),
        post("@c", "Clone effect in CapCut", "tt", 4),
      ])
    ).get("clone-effect")!;
    expect(clone.days.size).toBe(3);
    expect(clone.posts).toBe(4);
    expect([...clone.platforms].sort()).toEqual(["ig", "tt"]);
    expect(clone.samples).toHaveLength(2);
  });

  it("counts a post that two searches both returned once", async () => {
    const p = post("@a", "clone effect tutorial");
    expect((await found([p, p])).get("clone-effect")!.posts).toBe(1);
  });

  it("never turns unidentified posts or URL placeholders into independent accounts", async () => {
    const unidentified = [1, 2, 3].map((n) => ({
      ...post("", "clone effect tutorial", "ig", n),
      url: `https://www.instagram.com/p/UNKNOWN${n}`,
    }));
    expect((await found(unidentified)).size).toBe(0);
    const cands = await found([
      ...unidentified,
      post("@known", "clone effect tutorial", "ig", 4),
      post("https://www.instagram.com/p/PLACEHOLDER", "clone effect tutorial", "ig", 5),
    ]);
    expect(cands.get("clone-effect")?.days.size).toBe(1);
    expect(cands.get("clone-effect")?.posts).toBe(1);
  });

  it("keeps one account in both observed windows, deduplicating multiple posts on the same day", async () => {
    const cands = await found([
      post("@a", "clone effect tutorial", "tt", 1, "2026-10-03T12:00:00Z"),
      post("@a", "clone effect tutorial", "tt", 2, "2026-10-06T12:00:00Z"),
      post("@a", "clone effect tutorial", "tt", 3, "2026-10-06T16:00:00Z"),
    ]);
    const history = mergeHistory({}, TODAY, cands);
    expect(creatorsBetween(history["clone-effect"], TODAY, 0, 2).size).toBe(1);
    expect(creatorsBetween(history["clone-effect"], TODAY, 3, 5).size).toBe(1);
    expect(history["clone-effect"].every((day) => day.ids.length === 1)).toBe(true);
    expect(cands.get("clone-effect")?.samples[0].published).toBe("2026-10-06T16:00:00Z");
  });

  it("never runs a name across the title and the snippet", async () => {
    const cands = await found([{ ...post("@a", "Insane Ghost"), snippet: "Effect pack download" }]);
    expect([...cands.keys()]).toEqual([]);
  });

  // Live, 2026-10-07: "NEW · 6 creators this week" rested on posts from September 9–15.
  it("skips a post older than 14 days or without a date, and counts what it kept and skipped", async () => {
    const { cands, posts } = await extractCandidates(
      [
        post("@old", "clone effect tutorial", "tt", 1, "2026-09-17T10:00:00.000Z"), // 20 days
        post("@undated", "clone effect tutorial", "tt", 2, ""),
        post("@tenDays", "clone effect tutorial", "tt", 3, "2026-09-27T10:00:00.000Z"),
        post("@new", "clone effect tutorial", "tt", 4),
      ],
      TODAY,
    );
    expect(posts).toEqual({ kept: 2, old: 1, undated: 1 });
    expect([...cands.get("clone-effect")!.days.values()].sort()).toEqual([
      "2026-09-27",
      "2026-10-06",
    ]);
  });

  it("files each creator under the UTC day of their latest post, never after today", async () => {
    const days = (
      await found([
        post("@a", "clone effect tutorial", "tt", 1, "2026-10-03T23:30:00.000Z"),
        post("@a", "clone effect part 2", "tt", 2, "2026-10-05T00:30:00.000Z"),
        post("@b", "clone effect edit", "tt", 3, "2026-10-08T01:00:00.000Z"), // clock skew
      ])
    ).get("clone-effect")!.days;
    expect([...days.values()].sort()).toEqual(["2026-10-05", TODAY]);
  });

  it("keeps the newest posts as samples, newest first", async () => {
    const samples = (
      await found([
        post("@a", "clone effect one", "tt", 1, "2026-10-01T10:00:00.000Z"),
        post("@b", "clone effect three", "tt", 3, "2026-10-05T10:00:00.000Z"),
        post("@c", "clone effect two", "tt", 2, "2026-10-03T10:00:00.000Z"),
      ])
    ).get("clone-effect")!.samples;
    expect(samples.map((s) => s.title)).toEqual(["clone effect three", "clone effect two"]);
  });

  it("reads a day's 120 posts quickly (the Free plan allows 10 ms of CPU per run)", async () => {
    const titles = [
      "CapCut clone effect tutorial: how to clone yourself in a video",
      "How to Edit the New CapCut Reverse Trend | Easy Tutorial",
      "Chanel Confidence: Clone Yourself with One Hair (Swagger Trend)",
      "Most Trending Flash Clone Edit Tutorial: How to Make It",
    ];
    const snippet =
      "Learn this viral editing trick step by step: a smooth zoom transition, a speed ramp and a glitch effect, " +
      "all made in CapCut on your phone. Save it for later and follow for more editing tutorials every week. " +
      "Template in bio. #capcut #edit #transition #fyp #viral #trend #reels #tutorial";
    const posts = Array.from({ length: 120 }, (_, i) => ({
      ...post(`@u${i}`, titles[i % titles.length]),
      snippet,
    }));
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const start = process.cpuUsage();
      await extractCandidates(posts, TODAY);
      const { user, system } = process.cpuUsage(start);
      runs.push((user + system) / 1000);
    }
    // CPU time, not wall time, so other programs on a busy machine don't count (~8 ms alone): the bar catches a
    // runaway lookup. The 10 ms CPU budget itself is read live (Workers cpuTime).
    expect(Math.min(...runs)).toBeLessThan(150);
  });

  it("hashes creators so no handle is stored", async () => {
    const id = await creatorId("tt", "@someone");
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    expect(id).toBe(await creatorId("tt", "@someone"));
    expect(id).not.toBe(await creatorId("ig", "@someone"));
  });

  it("hashes a handle the same with or without '@', case or spaces", async () => {
    expect(await creatorId("tt", " @SomeOne ")).toBe(await creatorId("tt", "someone"));
  });
});

describe("a category's extras (planning/tools/19-category-trends.md §2)", () => {
  const CARS = {
    suffixes: ["shot", "angle", "lighting", "look"],
    generic: new Set(["car", "cars", "edit", "cinematic"]),
  };
  const keysFor = (text: string) =>
    candidatesOf(text, CARS)
      .map((c) => c.key)
      .sort();

  it("names camera shots, angles, lighting and looks, in phrases and hashtags", () => {
    expect(keysFor("insane rolling shot on the highway")).toEqual(["rolling-shot"]);
    expect(keysFor("Cinematic Rolling Shot | BMW M3")).toEqual(["rolling-shot"]);
    expect(keysFor("Low Angle hero shots of my M4")).toEqual(["hero-shot", "low-angle"]);
    expect(keysFor("golden hour lighting #rollingshots")).toEqual([
      "golden-hour-lighting",
      "rolling-shot",
    ]);
  });

  it("never makes a style of the category's own words", () => {
    expect(keysFor("car edit trend #caredit")).toEqual([]);
    expect(keysFor("cinematic car shot")).toEqual([]);
  });

  it("leaves Trending effects' rules as they were without extras", () => {
    expect(keys("insane rolling shot on the highway")).toEqual([]);
    expect(keys("clone effect tutorial | CapCut")).toEqual(["clone-effect"]);
  });

  it("builds its RegExps once per suffix list, not on every post (CPU on the free plan)", () => {
    expect(suffixPatterns([...CARS.suffixes])).toBe(suffixPatterns(CARS.suffixes));
    expect(suffixPatterns()).toBe(suffixPatterns([]));
    expect(suffixPatterns()).not.toBe(suffixPatterns(CARS.suffixes));
    // In use: a second post with the same extras compiles no pattern. Counted are RegExps made from a pattern's text;
    // `matchAll` makes its working copy from the RegExp itself.
    const made = vi.spyOn(globalThis, "RegExp");
    try {
      const compiled = () =>
        made.mock.calls.filter(([source]) => typeof source === "string").length;
      expect(keysFor("insane rolling shot on the highway")).toEqual(["rolling-shot"]);
      const first = compiled();
      expect(keysFor("Low Angle hero shots of my M4")).toEqual(["hero-shot", "low-angle"]);
      expect(compiled()).toBe(first);
    } finally {
      made.mockRestore();
    }
  });
});
