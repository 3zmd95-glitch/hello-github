import { describe, expect, it } from "vitest";
import { instagramPostedAt, postedAt, tiktokPostedAt } from "./postDate";

const NOW = new Date("2026-10-07T12:00:00Z");
const minute = (d: Date | null) => d?.toISOString().slice(0, 16);

// Verified against the owner's own posts with known dates (2026-10-07): the decode lands within ~2 minutes.
describe("instagramPostedAt", () => {
  it("decodes the shortcode's media id into the post time", () => {
    expect(minute(instagramPostedAt("DY-MjkYNiWG", NOW))).toBe("2026-05-30T17:50"); // real 17:52Z
    expect(minute(instagramPostedAt("DXr9Ex6Db09", NOW))).toBe("2026-04-28T19:17"); // real 19:19Z
    expect(minute(instagramPostedAt("DVZBfKRDa6D", NOW))).toBe("2026-03-02T17:47"); // real 17:49Z
    expect(instagramPostedAt("DX9hjwDsXXM", NOW)?.toISOString().slice(0, 10)).toBe("2026-05-05");
    expect(instagramPostedAt("Dd8IYtBSjUr", NOW)?.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("gives null for a character outside the alphabet or a date that cannot be a post", () => {
    expect(instagramPostedAt("DY-Mjk+NiWG", NOW)).toBeNull();
    expect(instagramPostedAt("", NOW)).toBeNull();
    // A short code decodes to Instagram's epoch (2011): a post, but an old one; before 2010 is never a post.
    expect(instagramPostedAt("R6", NOW)?.getUTCFullYear()).toBe(2011);
    // A long (private-link) code decodes past now + 1 day.
    expect(instagramPostedAt("DY-MjkYNiWGDY-MjkYNiWG", NOW)).toBeNull();
  });
});

describe("tiktokPostedAt", () => {
  it("reads Unix seconds from the video id's top 32 bits", () => {
    expect(tiktokPostedAt("7692240280929520917", NOW)?.toISOString()).toBe(
      "2026-10-03T01:00:55.000Z",
    );
  });

  it("gives null for an id that is no digits, or a date before 2010 or after now + 1 day", () => {
    expect(tiktokPostedAt("abc", NOW)).toBeNull();
    expect(tiktokPostedAt("", NOW)).toBeNull();
    expect(tiktokPostedAt("12345", NOW)).toBeNull(); // 1970
    const tomorrowPlus = String(BigInt(Math.floor(NOW.getTime() / 1000) + 2 * 86_400) << 32n);
    expect(tiktokPostedAt(tomorrowPlus, NOW)).toBeNull();
    const inAnHour = String(BigInt(Math.floor(NOW.getTime() / 1000) + 3_600) << 32n);
    expect(tiktokPostedAt(inAnHour, NOW)).not.toBeNull();
  });
});

describe("postedAt", () => {
  it("dates Instagram post, reel and TV links, with or without a user prefix", () => {
    const may30 = "2026-05-30T17:50";
    for (const path of ["p", "reel", "reels", "tv"])
      expect(postedAt(`https://www.instagram.com/${path}/DY-MjkYNiWG/`, NOW)?.slice(0, 16)).toBe(
        may30,
      );
    expect(postedAt("https://instagram.com/someone/reel/DY-MjkYNiWG", NOW)?.slice(0, 16)).toBe(
      may30,
    );
  });

  it("dates TikTok video and photo links, on any TikTok host", () => {
    const oct3 = "2026-10-03T01:00:55.000Z";
    expect(postedAt("https://www.tiktok.com/@a.b/video/7692240280929520917", NOW)).toBe(oct3);
    expect(postedAt("https://m.tiktok.com/@a/photo/7692240280929520917?lang=en", NOW)).toBe(oct3);
  });

  it("dates nothing else: profiles, sounds, other sites, bad links", () => {
    for (const url of [
      "https://www.instagram.com/someone/",
      "https://www.instagram.com/reels/audio/1234567890/",
      "https://www.tiktok.com/@someone",
      "https://www.youtube.com/watch?v=DY-MjkYNiWG",
      "https://example.com/p/DY-MjkYNiWG",
      "not a url",
    ])
      expect(postedAt(url, NOW), url).toBeUndefined();
  });
});
