import { describe, expect, it } from "vitest";
import {
  HashtagSetSchema,
  PostSchema,
  type HashtagSet,
  type Post,
  type PostInput,
  type SocialPostStat,
} from "./domain";
import {
  HASHTAG_MAX_TAGS,
  HASHTAG_MIN_SAMPLE,
  hashtagSetStats,
  matchesSet,
  normalizeUrl,
  parseTags,
  statsOfPost,
} from "./hashtags";

/** Fri Oct 23 2026, 12:00 Riyadh. */
const NOW = Date.parse("2026-10-23T12:00:00+03:00");
const T = "2026-10-23T09:00:00.000Z";

let seq = 0;
const set = (name: string, tags: string[]): HashtagSet =>
  HashtagSetSchema.parse({ id: `s-${name}`, name, tags, createdAt: T });

const post = (over: Partial<PostInput> = {}): Post =>
  PostSchema.parse({
    id: `p${++seq}`,
    platform: "tiktok",
    title: "A post",
    stage: "posted",
    hashtags: ["#match_cut", "#editing"],
    createdAt: T,
    updatedAt: T,
    ...over,
  });

/** A TikTok video published `daysAgo` days before NOW, with `views`. */
const stat = (
  postId: string,
  views: number,
  extra: Partial<SocialPostStat> = {},
): SocialPostStat => ({
  platform: "tiktok",
  postId,
  publishedAt: "2026-10-10T20:00:00+03:00",
  kind: "video",
  views,
  likes: 0,
  comments: 0,
  shares: 0,
  ...extra,
});

describe("parseTags", () => {
  it("splits on spaces, commas and lines, adds the #, drops duplicates (any case) and empties", () => {
    expect(parseTags("  #match_cut, Cut  #سينما\n##Match_Cut # , ")).toEqual([
      "#match_cut",
      "#Cut",
      "#سينما",
    ]);
  });

  it("keeps at most 30 tags", () => {
    const many = Array.from({ length: 40 }, (_, i) => `t${i}`).join(" ");
    expect(parseTags(many)).toHaveLength(HASHTAG_MAX_TAGS);
  });
});

describe("matchesSet", () => {
  it("a post used a set when it carries every tag of it, in any case and order", () => {
    const s = set("cuts", ["#match_cut", "#Editing"]);
    expect(matchesSet(s, post({ hashtags: ["#EDITING", "#x", "match_cut"] }))).toBe(true);
    expect(matchesSet(s, post({ hashtags: ["#editing"] }))).toBe(false);
    expect(matchesSet(s, post({ hashtags: [] }))).toBe(false);
  });
});

describe("normalizeUrl and statsOfPost", () => {
  it("compares links without the www, query, fragment or closing slash", () => {
    expect(normalizeUrl("https://WWW.TikTok.com/@3z.prod/video/7001/?lang=en#x")).toBe(
      "tiktok.com/@3z.prod/video/7001",
    );
    expect(normalizeUrl("not a url")).toBeNull();
  });

  it("joins a post to its numbers by the Worker's post id, then by its link", () => {
    const stats = [
      stat("v1", 100, { permalink: "https://www.tiktok.com/@3z.prod/video/1" }),
      stat("ig1", 200, { platform: "instagram" }),
      stat("v3", 300, { permalink: "https://www.tiktok.com/@3z.prod/video/3/" }),
    ];
    const viaWorker = post({
      autoPost: {
        platforms: ["tiktok", "instagram"],
        results: { instagram: { state: "published", postId: "ig1" } },
      },
    });
    expect(statsOfPost(viaWorker, stats).map((s) => s.postId)).toEqual(["ig1"]);
    const viaLink = post({ postedUrl: "https://tiktok.com/@3z.prod/video/3?utm=1" });
    expect(statsOfPost(viaLink, stats).map((s) => s.postId)).toEqual(["v3"]);
    // An id of another platform does not match, and a post that was not posted has no numbers.
    expect(
      statsOfPost(
        post({
          autoPost: {
            platforms: ["tiktok"],
            results: { tiktok: { state: "published", postId: "ig1" } },
          },
        }),
        stats,
      ),
    ).toEqual([]);
    expect(
      statsOfPost(
        post({ stage: "edited", postedUrl: "https://tiktok.com/@3z.prod/video/3" }),
        stats,
      ),
    ).toEqual([]);
  });
});

describe("hashtagSetStats", () => {
  const cuts = set("cuts", ["#match_cut", "#editing"]);
  /** 14 ordinary videos (1,000 views) and `n` videos of the set (`views`), every one posted from the calendar. */
  function world(n: number, views: number) {
    const ordinary = Array.from({ length: 14 }, (_, i) => stat(`o${i}`, 1000));
    const used = Array.from({ length: n }, (_, i) => stat(`u${i}`, views));
    const posts = used.map((s) =>
      post({ postedUrl: `https://www.tiktok.com/@3z/video/${s.postId}` }),
    );
    const stats = [
      ...ordinary,
      ...used.map((s) => ({ ...s, permalink: `https://www.tiktok.com/@3z/video/${s.postId}` })),
    ];
    return { posts, stats };
  }

  it("says how many posts used the set and how they did against the platform's median", () => {
    const { posts, stats } = world(6, 2500);
    const [r] = hashtagSetStats([cuts], posts, stats, NOW);
    expect(r).toMatchObject({ setId: cuts.id, n: 6, avgViews: 2500, enough: true });
    expect(r.vsMedian).toBeCloseTo(2.5, 5);
  });

  it(`needs ${HASHTAG_MIN_SAMPLE} posts before it dares to say anything`, () => {
    const { posts, stats } = world(HASHTAG_MIN_SAMPLE - 1, 2500);
    const [r] = hashtagSetStats([cuts], posts, stats, NOW);
    expect(r.n).toBe(HASHTAG_MIN_SAMPLE - 1);
    expect(r.enough).toBe(false);
  });

  it("caps one viral post at 4x, leaves out unsettled posts and stories, and ignores posts that did not use the set", () => {
    const { posts, stats } = world(5, 1_000_000);
    const [capped] = hashtagSetStats([cuts], posts, stats, NOW);
    expect(capped.vsMedian).toBeCloseTo(4, 5);

    const young = stats.map((s) =>
      s.postId === "u0" ? { ...s, publishedAt: "2026-10-22T20:00:00+03:00" } : s,
    );
    expect(hashtagSetStats([cuts], posts, young, NOW)[0].n).toBe(4);
    const story = stats.map((s) => (s.postId === "u1" ? { ...s, kind: "story" as const } : s));
    expect(hashtagSetStats([cuts], posts, story, NOW)[0].n).toBe(4);

    const other = posts.map((p) => ({ ...p, hashtags: ["#other"] }));
    expect(hashtagSetStats([cuts], other, stats, NOW)[0]).toMatchObject({
      n: 0,
      avgViews: null,
      vsMedian: null,
    });
  });

  it("measures each platform against its own median", () => {
    const tt = world(3, 2000);
    const igStats = [
      ...Array.from({ length: 14 }, (_, i) => stat(`io${i}`, 100, { platform: "instagram" })),
      ...Array.from({ length: 3 }, (_, i) =>
        stat(`iu${i}`, 200, {
          platform: "instagram",
          permalink: `https://www.instagram.com/reel/R${i}/`,
        }),
      ),
    ];
    const igPosts = [0, 1, 2].map((i) =>
      post({ platform: "instagram", postedUrl: `https://www.instagram.com/reel/R${i}/` }),
    );
    const [r] = hashtagSetStats([cuts], [...tt.posts, ...igPosts], [...tt.stats, ...igStats], NOW);
    expect(r.n).toBe(6);
    // 2000 / 1000 and 200 / 100 are both 2x their own platform's median.
    expect(r.vsMedian).toBeCloseTo(2, 5);
  });
});
