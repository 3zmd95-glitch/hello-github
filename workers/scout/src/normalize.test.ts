import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  cleanText,
  cleanTikTokTitle,
  handleFromUrl,
  isGenericInstagramTitle,
  isGenericTikTokTitle,
  isVideoUrl,
  normalizeDiscoverHits,
  normalizeHits,
  parseEngagement,
  platformForHost,
  profileFromUrl,
  tiktokTitleFromOembed,
  type Stats,
  type TavilyHit,
} from "./normalize";

const LRM = "‎";
const RLM = "‏";

describe("bounded rich captions for edit-format discovery", () => {
  it("retains the ordinary preview by default and permits a bounded richer internal caption", () => {
    const hits = [
      {
        url: "https://www.tiktok.com/@editor/video/7654321000000000000",
        title: "An edit",
        content: `${"Context. ".repeat(35)}multiple clones on every beat to Night Drive ${"end ".repeat(300)}`,
      },
    ];
    expect(normalizeHits(hits, ["tt"])[0].snippet.length).toBeLessThanOrEqual(220);
    const rich = normalizeDiscoverHits(hits, "tt", new Date(), 1000).cards[0].snippet;
    expect(rich).toContain("multiple clones on every beat to Night Drive");
    expect(rich.length).toBeLessThanOrEqual(1000);
    expect(normalizeHits(hits, ["tt"], new Date(), 999999)[0].snippet).toBe(rich);
    expect(normalizeHits(hits, ["tt"], new Date(), NaN)[0].snippet.length).toBeLessThanOrEqual(220);
  });
});

/** The one card normalizeHits makes from a single Instagram hit. */
function igCard(hit: TavilyHit) {
  const [card] = normalizeHits([hit], ["ig"]);
  return card;
}

function canon(url: string): string {
  const u = new URL(url);
  return canonicalUrl(platformForHost(u.hostname)!, u);
}

describe("canonicalUrl: one card per post", () => {
  it.each([
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    ["https://youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://m.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://youtu.be/dQw4w9WgXcQ?si=x", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["https://www.instagram.com/reel/ABC123/", "https://www.instagram.com/p/ABC123"],
    ["https://instagram.com/reel/ABC123/?igsh=xyz", "https://www.instagram.com/p/ABC123"],
    ["https://www.instagram.com/reels/ABC123/", "https://www.instagram.com/p/ABC123"],
    ["https://www.instagram.com/editor.ali/reel/ABC123/", "https://www.instagram.com/p/ABC123"],
    ["https://www.instagram.com/p/ABC123/", "https://www.instagram.com/p/ABC123"],
    ["https://www.instagram.com/tv/ABC123", "https://www.instagram.com/p/ABC123"],
    [
      "https://www.tiktok.com/@bob/video/7300000000000000001?lang=en",
      "https://www.tiktok.com/@bob/video/7300000000000000001",
    ],
    [
      "https://m.tiktok.com/@bob/video/7300000000000000001/",
      "https://www.tiktok.com/@bob/video/7300000000000000001",
    ],
  ])("%s → %s", (url, expected) => {
    expect(canon(url)).toBe(expected);
  });

  it("falls back to host + path without www./m., query, hash or trailing slash", () => {
    expect(canon("https://M.TikTok.com/discover/match-cut/?x=1#top")).toBe(
      "https://www.tiktok.com/discover/match-cut",
    );
  });

  it("merges every shape of one post into one card, keeping the first hit's handle", () => {
    const cards = normalizeHits(
      [
        { title: "Instagram", url: "https://www.instagram.com/editor.ali/reel/ABC123/" },
        { title: "Instagram", url: "https://instagram.com/reel/ABC123/?igsh=xyz" },
        { title: "Instagram", url: "https://www.instagram.com/p/ABC123/" },
        { title: "A", url: "https://www.tiktok.com/@a/video/7300000000000000001" },
        { title: "A", url: "https://m.tiktok.com/@a/video/7300000000000000001" },
        { title: "Short", url: "https://www.youtube.com/shorts/dQw4w9WgXcQ" },
        { title: "Watch", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      ],
      ["tt", "ig", "yt"],
    );
    expect(cards.map((c) => [c.url, c.handle])).toEqual([
      ["https://www.instagram.com/p/ABC123", "@editor.ali"],
      ["https://www.tiktok.com/@a/video/7300000000000000001", "@a"],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube.com"],
    ]);
  });
});

describe("isVideoUrl('ig')", () => {
  const ig = (path: string) => isVideoUrl("ig", new URL(`https://www.instagram.com${path}`));

  it("accepts a single post or reel", () => {
    expect(ig("/reel/DOJukicCQ2_/")).toBe(true);
    expect(ig("/reels/DOJukicCQ2_")).toBe(true);
    expect(ig("/karanaujla/reel/DOJukicCQ2_/")).toBe(true);
    expect(ig("/p/Cmzn4-LMjt2/")).toBe(true);
    expect(ig("/tv/B1x2y3")).toBe(true);
  });

  it("rejects audio, profile, explore and nested pages", () => {
    expect(ig("/reels/audio/1234567890123456/")).toBe(false);
    expect(ig("/reel/audio/1234567890123456")).toBe(false);
    expect(ig("/karanaujla/")).toBe(false);
    expect(ig("/explore/tags/matchcut/")).toBe(false);
    expect(ig("/p/Cmzn4-LMjt2/liked_by/")).toBe(false);
  });

  it("drops an audio page from search results", () => {
    const hits = [
      { title: "Original audio", url: "https://www.instagram.com/reels/audio/123456/" },
    ];
    expect(normalizeHits(hits, ["ig"])).toEqual([]);
  });
});

describe("handleFromUrl", () => {
  it("never falls back to instagram.com", () => {
    expect(handleFromUrl("ig", new URL("https://www.instagram.com/reel/ABC/"))).toBe("");
    expect(handleFromUrl("ig", new URL("https://www.instagram.com/p/ABC/"))).toBe("");
    expect(handleFromUrl("ig", new URL("https://www.instagram.com/cuts.sa/reel/ABC/"))).toBe(
      "@cuts.sa",
    );
  });
});

describe("cleanText", () => {
  it("strips bidi marks and collapses whitespace", () => {
    expect(cleanText(`${LRM}نادي النصر السعودي${LRM}⁧ on\n\n Instagram⁩؜`)).toBe(
      "نادي النصر السعودي on Instagram",
    );
    expect(cleanText(undefined)).toBe("");
  });
});

describe("Instagram cards (real og:title / description / twitter:title shapes)", () => {
  it("emoji-only caption: og:title + description", () => {
    expect(
      igCard({
        title: 'Kendall on Instagram: "❥"',
        url: "https://www.instagram.com/p/3H0-Yqjo7u",
        content: '3M likes, 153K comments - kendalljenner on June 11, 2015: "❥". ',
      }),
    ).toEqual({
      platform: "ig",
      handle: "@kendalljenner",
      title: "❥",
      snippet: '3M likes, 153K comments - kendalljenner on June 11, 2015: "❥".',
      url: "https://www.instagram.com/p/3H0-Yqjo7u",
      stats: { likes: 3_000_000, comments: 153_000 },
      // The shortcode's own time (postDate.ts).
      published: "2015-05-25T22:51:17.422Z",
    });
  });

  it("hashtag-only caption from the description when the title is just 'Instagram'", () => {
    const card = igCard({
      title: "Instagram",
      url: "https://www.instagram.com/reel/C30RmkANa_S/",
      content: '30M likes, 81K comments - pop_cj6 on February 26, 2024: "#reels #pop_cj". ',
    });
    expect([card.handle, card.title]).toEqual(["@pop_cj6", "#reels #pop_cj"]);
  });

  it("a caption with its own quotes is kept whole", () => {
    const card = igCard({
      title: "Instagram",
      url: "https://www.instagram.com/reel/DKcalTzoftf/",
      content:
        '39K likes, 369 comments - martingarrix on June 3, 2025: "comment your favorite scene of the "MAD" music video.. 👇❤️". ',
    });
    expect(card.title).toBe('comment your favorite scene of the "MAD" music video.. 👇❤️');
  });

  it("no caption: the handle from the description becomes the title", () => {
    const card = igCard({
      title: "Leo Messi on Instagram",
      url: "https://www.instagram.com/p/CmWkQIrNiwK",
      content: "41M likes, 461K comments - leomessi on December 19, 2022",
    });
    expect([card.handle, card.title]).toEqual(["@leomessi", "@leomessi"]);
  });

  it("twitter:title only: the handle from '(@user) •'", () => {
    const card = igCard({
      title: "Mastercard (@mastercard) • Instagram reel",
      url: "https://www.instagram.com/reel/C8CaBfWs1mr/",
      content: "",
    });
    expect([card.handle, card.title]).toEqual(["@mastercard", "@mastercard"]);
  });

  it("nothing to go on: no handle, 'Instagram reel'", () => {
    const card = igCard({ title: "Instagram", url: "https://www.instagram.com/reel/DITBVk3z6pJ/" });
    expect([card.handle, card.title]).toEqual(["", "Instagram reel"]);
  });

  it("Arabic display name wrapped in bidi marks (English UI)", () => {
    const card = igCard({
      title: `${LRM}نادي النصر السعودي${LRM} on Instagram: "This is more than history in the making."`,
      url: "https://www.instagram.com/p/Cmzn4-LMjt2",
      content: `${LRM}نادي النصر السعودي (@alnassr)${LRM} • Instagram photos and videos`,
    });
    expect([card.handle, card.title]).toEqual([
      "@alnassr",
      "This is more than history in the making.",
    ]);
  });

  it("Arabic UI: '<Name> على Instagram : \"…\"' and '- <user> في <date>'", () => {
    const card = igCard({
      title: `${RLM}نادي النصر السعودي${LRM} على Instagram : "أهلاً بك في بيتك الجديد 💛"`,
      url: "https://www.instagram.com/p/Cmzn4-LMjt2/",
      content: `${RLM}٣٣ مليون تسجيل إعجاب، ${RLM}١ مليون تعليق - alnassr في ${RLM}30 ديسمبر 2022${RLM}: "أهلاً بك في بيتك الجديد 💛".`,
    });
    expect([card.handle, card.title]).toEqual(["@alnassr", "أهلاً بك في بيتك الجديد 💛"]);
    expect(card.snippet).not.toMatch(/[‎‏]/);
  });

  it("Arabic UI description alone gives the handle and the caption", () => {
    const card = igCard({
      title: "Instagram",
      url: "https://www.instagram.com/reel/DOJukicCQ2_/",
      content: `${RLM}١٢ ألف تسجيل إعجاب، ${RLM}٨٠ تعليقًا - hijazi.frames في ${RLM}2 يوليو 2025${RLM}: "ماتش كت بين جدة ومكة 🎬 #مونتاج".`,
    });
    expect([card.handle, card.title]).toEqual([
      "@hijazi.frames",
      "ماتش كت بين جدة ومكة 🎬 #مونتاج",
    ]);
  });

  it("keeps a non-generic title as-is (search engines often give the caption)", () => {
    const card = igCard({
      title: "Door to door match cut, shot on a phone 🎬",
      url: "https://www.instagram.com/reel/ABC/",
      content: "",
    });
    expect(card.title).toBe("Door to door match cut, shot on a phone 🎬");
  });

  it("falls back to the content's first sentence, never engagement boilerplate", () => {
    expect(
      igCard({
        title: "Instagram",
        url: "https://www.instagram.com/reel/ABC/",
        content: "Hand wipe match cut breakdown. Save it for later!",
      }).title,
    ).toBe("Hand wipe match cut breakdown.");
    expect(
      igCard({
        title: "Login • Instagram",
        url: "https://www.instagram.com/reel/ABC/",
        content: "2,431 likes, 18 comments",
      }).title,
    ).toBe("Instagram reel");
  });

  it("knows Instagram's generic titles", () => {
    for (const t of [
      "Instagram",
      "Login • Instagram",
      "Instagram photos and videos",
      "Kendall (@kendalljenner) • Instagram photo",
      "Leo Messi on Instagram",
    ]) {
      expect(isGenericInstagramTitle(t)).toBe(true);
    }
    expect(isGenericInstagramTitle("Match cut in CapCut")).toBe(false);
  });
});

describe("TikTok titles", () => {
  it("strips the ' | TikTok' suffix, also after a double space (Arabic hashtags)", () => {
    expect(cleanTikTokTitle("#طبخ #وصفات_سهله #رمضان  | TikTok")).toBe("#طبخ #وصفات_سهله #رمضان");
    const [card] = normalizeHits(
      [
        {
          url: "https://www.tiktok.com/@shoroq.kitchen/video/7476812364390698258",
          title: "#طبخ #وصفات_سهله #رمضان  | TikTok",
        },
      ],
      ["tt"],
    );
    expect(card.title).toBe("#طبخ #وصفات_سهله #رمضان");
  });

  it("strips the 'TikTok video from … (@h): ' prefix", () => {
    expect(
      cleanTikTokTitle('TikTok video from Sam (@editor.sam): "Match cut in 10s" | TikTok'),
    ).toBe("Match cut in 10s");
    expect(cleanTikTokTitle("TikTok video from سارة (@sara.edits): ماتش كت")).toBe("ماتش كت");
  });

  it("knows TikTok's generic titles", () => {
    for (const t of [
      "TikTok",
      "TikTok - Make Your Day",
      "TikTok · Sam the Editor",
      "Sam the Editor on TikTok",
      "Sam the Editor (@editor.sam)",
    ]) {
      expect(isGenericTikTokTitle(t)).toBe(true);
    }
    expect(isGenericTikTokTitle("Match cut in CapCut")).toBe(false);
  });

  it("a generic title shows the handle until oEmbed gives the caption", () => {
    const [card] = normalizeHits(
      [
        {
          url: "https://www.tiktok.com/@filmbro/video/7412345678901234569",
          title: "TikTok - Make Your Day",
        },
      ],
      ["tt"],
    );
    expect(card.title).toBe("@filmbro");
    expect(tiktokTitleFromOembed(card, "Door match cut 🚪 | TikTok")).toBe("Door match cut 🚪");
    expect(tiktokTitleFromOembed(card, "TikTok - Make Your Day")).toBeUndefined();
    expect(tiktokTitleFromOembed({ title: "Real title", handle: "@x" }, "Other")).toBeUndefined();
  });
});

describe("parseEngagement: the counts at the head of a description", () => {
  it.each<[string, Stats]>([
    [
      '1,234 likes, 56 comments - editor.ali on June 11, 2025: "Match cut in 10s". ',
      { likes: 1234, comments: 56 },
    ],
    [
      '3M likes, 153K comments - kendalljenner on June 11, 2015: "❥". ',
      { likes: 3_000_000, comments: 153_000 },
    ],
    ["12K likes", { likes: 12_000 }],
    ["1.2M likes", { likes: 1_200_000 }],
    ["2.5B views", { views: 2_500_000_000 }],
    ["1 like, 1 comment - a.b on May 1, 2025", { likes: 1, comments: 1 }],
    ["12,345,678 likes, 9 comments", { likes: 12_345_678, comments: 9 }],
    ["980 views, 45 likes, 3 comments", { views: 980, likes: 45, comments: 3 }],
    // A European page: "," before K is the decimal mark, "." in a plain count groups thousands.
    ["13,5K likes, 2.431 comments", { likes: 13_500, comments: 2431 }],
    [
      '13.5K Likes, 120 Comments. TikTok video from Sam (@editor.sam): "Match cut in 10s".',
      { likes: 13_500, comments: 120 },
    ],
    ["1.2M Likes. TikTok video from Sam (@editor.sam)", { likes: 1_200_000 }],
  ])("English: %s", (text, stats) => {
    expect(parseEngagement(text)).toEqual(stats);
  });

  it.each<[string, Stats]>([
    ["٢٬٥٠٧ تسجيلات إعجاب، ٥٥ تعليق", { likes: 2507, comments: 55 }],
    ["١٣٫٥ ألف إعجاب", { likes: 13_500 }],
    [
      '٣٣ مليون تسجيل إعجاب، ١ مليون تعليق - alnassr في 30 ديسمبر 2022: "أهلاً بك في بيتك الجديد 💛".',
      { likes: 33_000_000, comments: 1_000_000 },
    ],
    [
      "١٢ ألف تسجيل إعجاب، ٨٠ تعليقًا - hijazi.frames في 2 يوليو 2025",
      { likes: 12_000, comments: 80 },
    ],
    ["٤٥٠ ألف مشاهدة، ٣ آلاف إعجاب", { views: 450_000, likes: 3000 }],
    ["٢ مليار مشاهدة", { views: 2_000_000_000 }],
    // Western digits in Arabic text, and Persian digits.
    ["1.2 مليون إعجاب", { likes: 1_200_000 }],
    ["۱۲ ألف إعجاب", { likes: 12_000 }],
    [
      "13.5K من تسجيلات الإعجاب، 120 من التعليقات. فيديو TikTok من سارة (@sara.edits)",
      { likes: 13_500, comments: 120 },
    ],
  ])("Arabic: %s", (text, stats) => {
    expect(parseEngagement(text)).toEqual(stats);
  });

  it("reads the Arabic separators U+066C (thousands) and U+066B (decimal)", () => {
    const thousands = String.fromCharCode(0x066c);
    const decimal = String.fromCharCode(0x066b);
    expect(parseEngagement(`٢${thousands}٥٠٧ إعجاب`)).toEqual({ likes: 2507 });
    expect(parseEngagement(`١${thousands}٢٣٤${thousands}٥٦٧ إعجاب`)).toEqual({ likes: 1_234_567 });
    expect(parseEngagement(`١٣${decimal}٥ ألف إعجاب`)).toEqual({ likes: 13_500 });
    expect(parseEngagement(`٢${decimal}٣ مليون إعجاب`)).toEqual({ likes: 2_300_000 });
  });

  it("reads Instagram text once its bidi marks are cleaned", () => {
    const raw = `${RLM}٣٣ مليون تسجيل إعجاب، ${RLM}١ مليون تعليق - alnassr في ${RLM}30 ديسمبر 2022${RLM}`;
    expect(parseEngagement(cleanText(raw))).toEqual({ likes: 33_000_000, comments: 1_000_000 });
  });

  it("is not fooled by captions, dates, handles and odd numbers", () => {
    for (const text of [
      "",
      "Match cut in CapCut",
      "100 likes and I post part 2",
      "5 likes on my 2015 post",
      "Can we get 1M likes?",
      "Top 10 comments on my last reel",
      "June 11, 2015: my 3 likes",
      "user123 likes this",
      "v1.5 likes the new timeline",
      "12.5 likes",
      "12 Minutes of b-roll",
      "٥ دقائق مونتاج",
    ]) {
      expect(parseEngagement(text)).toBeUndefined();
    }
  });

  it("reads a head that does not open the text only when it names two counts", () => {
    expect(parseEngagement('Kendall on Instagram: "❥" 3M likes, 153K comments')).toEqual({
      likes: 3_000_000,
      comments: 153_000,
    });
    expect(parseEngagement('Kendall on Instagram: "❥" 3M likes')).toBeUndefined();
  });

  it("reads the first run of counts only, and the first count of each kind", () => {
    expect(
      parseEngagement('10 likes, 2 comments - a.b on May 1: "got 5 likes, 9 comments before"'),
    ).toEqual({ likes: 10, comments: 2 });
    expect(parseEngagement("10 likes, 12 likes, 2 comments")).toEqual({ likes: 10, comments: 2 });
  });
});

describe("normalizeHits: stats", () => {
  it("sets stats on TikTok and Instagram cards whose page text carries the counts, never an empty one", () => {
    const cards = normalizeHits(
      [
        {
          url: "https://www.tiktok.com/@editor.sam/video/7300000000000000001",
          title: "Match cut in 10s | TikTok",
          content:
            '13.5K Likes, 120 Comments. TikTok video from Sam (@editor.sam): "Match cut in 10s".',
        },
        {
          url: "https://www.instagram.com/reel/DOJukicCQ2_/",
          title: "Instagram",
          content: `${RLM}١٢ ألف تسجيل إعجاب، ${RLM}٨٠ تعليقًا - hijazi.frames في ${RLM}2 يوليو 2025${RLM}: "ماتش كت".`,
        },
        // The counts in the title (some engines put the description there).
        {
          url: "https://www.instagram.com/p/CmWkQIrNiwK",
          title: "41M likes, 461K comments - leomessi on December 19, 2022",
          content: "",
        },
        // No counts on the page.
        {
          url: "https://www.tiktok.com/@cuts/video/7300000000000000002",
          title: "Door cut | TikTok",
          content: "100 likes and I post the breakdown",
        },
        // YouTube counts come from the Data API (scout.ts), never from the text.
        {
          url: "https://www.youtube.com/watch?v=abc123XYZ",
          title: "Match cut tutorial",
          content: "1.2M views, 45K likes",
        },
      ],
      ["tt", "ig", "yt"],
    );
    expect(cards.map((c) => [c.platform, c.stats])).toEqual([
      ["tt", { likes: 13_500, comments: 120 }],
      ["ig", { likes: 12_000, comments: 80 }],
      ["ig", { likes: 41_000_000, comments: 461_000 }],
      ["tt", undefined],
      ["yt", undefined],
    ]);
    expect(cards.filter((c) => "stats" in c)).toHaveLength(3);
  });
});

describe("profileFromUrl", () => {
  const p = (platform: "tt" | "ig" | "yt", url: string) => profileFromUrl(platform, new URL(url));

  it("reads TikTok, Instagram and YouTube profile pages", () => {
    expect(p("tt", "https://www.tiktok.com/@zenko.edit")).toEqual({
      platform: "tt",
      handle: "@zenko.edit",
      url: "https://www.tiktok.com/@zenko.edit",
    });
    expect(p("ig", "https://www.instagram.com/nilstobli_nt/")).toEqual({
      platform: "ig",
      handle: "@nilstobli_nt",
      url: "https://www.instagram.com/nilstobli_nt/",
    });
    expect(p("yt", "https://www.youtube.com/@cinecom")).toEqual({
      platform: "yt",
      handle: "@cinecom",
      url: "https://www.youtube.com/@cinecom",
    });
  });

  it("is not fooled by posts, tags or Instagram routes", () => {
    expect(p("tt", "https://www.tiktok.com/@a/video/123")).toBeUndefined();
    expect(p("tt", "https://www.tiktok.com/tag/edit")).toBeUndefined();
    expect(p("ig", "https://www.instagram.com/explore/")).toBeUndefined();
    expect(p("ig", "https://www.instagram.com/p/ABC/")).toBeUndefined();
    expect(p("ig", "https://www.instagram.com/about/")).toBeUndefined();
    expect(p("yt", "https://www.youtube.com/watch?v=x")).toBeUndefined();
  });

  it("needs the platform's own host (not help., about. or another platform)", () => {
    expect(p("ig", "https://help.instagram.com/1077853922938491")).toBeUndefined();
    expect(p("ig", "https://about.instagram.com/blog")).toBeUndefined();
    expect(p("tt", "https://www.youtube.com/@cinecom")).toBeUndefined();
  });

  it("reads a profile tab as the profile", () => {
    expect(p("yt", "https://www.youtube.com/@cinecom/videos")).toEqual({
      platform: "yt",
      handle: "@cinecom",
      url: "https://www.youtube.com/@cinecom",
    });
    for (const tab of ["reels/", "tagged/"]) {
      expect(p("ig", `https://www.instagram.com/nilstobli_nt/${tab}`)).toEqual({
        platform: "ig",
        handle: "@nilstobli_nt",
        url: "https://www.instagram.com/nilstobli_nt/",
      });
    }
  });
});

describe("normalizeDiscoverHits", () => {
  it("splits posts from profile pages and dates a post by its id", () => {
    const { cards, profiles } = normalizeDiscoverHits(
      [
        {
          url: "https://www.tiktok.com/@zenko.edit/video/7300000000000000001",
          title: "flash transition tutorial | TikTok",
          content: "How I make the flash transition",
          published_date: "2026-09-30",
        },
        { url: "https://www.tiktok.com/@zenko.edit", title: "zenko (@zenko.edit) | TikTok" },
        { url: "https://www.instagram.com/p/XYZ/", title: "Instagram" },
      ],
      "tt",
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      platform: "tt",
      handle: "@zenko.edit",
      // The video id's time, not Tavily's "2026-09-30".
      published: "2023-11-11T00:48:18.000Z",
    });
    expect(profiles).toEqual([
      { platform: "tt", handle: "@zenko.edit", url: "https://www.tiktok.com/@zenko.edit" },
    ]);
  });

  it("keeps one profile per handle, and only the asked platform's", () => {
    const { profiles } = normalizeDiscoverHits(
      [
        { url: "https://www.tiktok.com/@Zen" },
        { url: "https://m.tiktok.com/@zen/?lang=en" },
        { url: "https://www.youtube.com/@cinecom" },
      ],
      "tt",
    );
    expect(profiles).toEqual([
      { platform: "tt", handle: "@Zen", url: "https://www.tiktok.com/@Zen" },
    ]);
  });
});

describe("normalizeHits: published", () => {
  const card = (url: string, published_date?: string) =>
    normalizeHits([{ url, title: "A", published_date }], ["tt", "ig", "yt"])[0];
  const YT = "https://www.youtube.com/watch?v=abc123XYZ";

  it("stores Tavily's RFC 2822 date as ISO 8601", () => {
    expect(card(YT, "Tue, 30 Sep 2026 17:00:00 GMT").published).toBe("2026-09-30T17:00:00.000Z");
  });

  it("leaves out a date it cannot read, without throwing", () => {
    expect(card(YT, "not a date")).not.toHaveProperty("published");
  });

  // Live, 2026-10-07: Tavily sent no date for any Instagram result, and a "week" search returned posts from May.
  it("dates Instagram and TikTok posts by their own id, whatever Tavily sent", () => {
    expect(card("https://www.instagram.com/reel/DY-MjkYNiWG/").published).toBe(
      "2026-05-30T17:50:47.305Z",
    );
    expect(
      card("https://www.tiktok.com/@a/video/7692240280929520917", "Tue, 06 Oct 2026 10:00:00 GMT")
        .published,
    ).toBe("2026-10-03T01:00:55.000Z");
    // No date at all rather than Tavily's for a post whose id cannot be a post time.
    expect(
      card("https://www.tiktok.com/@a/video/12345", "Tue, 06 Oct 2026 10:00:00 GMT"),
    ).not.toHaveProperty("published");
  });
});
