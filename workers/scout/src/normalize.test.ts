import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  cleanText,
  cleanTikTokTitle,
  handleFromUrl,
  isGenericInstagramTitle,
  isGenericTikTokTitle,
  isVideoUrl,
  normalizeHits,
  platformForHost,
  tiktokTitleFromOembed,
  type TavilyHit,
} from "./normalize";

const LRM = "‎";
const RLM = "‏";

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
