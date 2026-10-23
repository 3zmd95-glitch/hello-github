import { describe, expect, it } from "vitest";
import type { DiscoverItem, DiscoverPlatform } from "./discover";
import { instagramShortcodeAt, tiktokIdAt } from "../workers/scout/src/postDate";
import {
  mergeSoundObservations,
  searchSoundCategory,
  soundObservations,
  trendingSounds,
  type SoundObservation,
} from "./trendingSounds";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86_400_000;
let n = 0;

function post(
  platform: DiscoverPlatform,
  daysAgo: number,
  creator: string,
  sound?: { title: string; artist?: string; url?: string; original?: boolean },
): DiscoverItem {
  const at = new Date(NOW - daysAgo * DAY);
  const url =
    platform === "tt"
      ? `https://www.tiktok.com/@${creator}/video/${tiktokIdAt(at, ++n)}`
      : platform === "ig"
        ? `https://www.instagram.com/reel/${instagramShortcodeAt(at, ++n)}/`
        : `https://www.youtube.com/watch?v=${String(++n).padStart(11, "x")}`;
  return {
    platform,
    url,
    handle: creator,
    title: `${creator} edit`,
    snippet: `${creator} edit caption`,
    lang: "en",
    section: "example",
    ...(platform === "yt" ? { published: at.toISOString() } : {}),
    ...(sound
      ? {
          evidence: {
            source: platform === "tt" ? "tiktok-public-page" : "instagram-public-embed",
            observedAt: new Date(NOW).toISOString(),
            author: creator,
            ...(platform === "yt" ? { published: at.toISOString() } : {}),
            sound: { ...sound, platform: platform === "tt" ? "tt" : "ig" },
          },
        }
      : {}),
  } as DiscoverItem;
}

const espresso = { title: "Espresso", artist: "Sabrina Carpenter" };
const observe = (items: DiscoverItem[], category: string) =>
  soundObservations(items, category, NOW);

describe("trending sounds in edits", () => {
  it("labels a sound trending at 3 posts by 3 creators across 2 categories in 14 days, merging platforms", () => {
    const observations = [
      ...observe(
        [
          post("ig", 1, "a", { ...espresso, url: "https://www.instagram.com/reels/audio/1/" }),
          post("tt", 2, "b", {
            title: "espresso ",
            artist: "Sabrina  Carpenter",
            url: "https://www.tiktok.com/music/Espresso-6800000000000000001",
          }),
        ],
        "cars",
      ),
      ...observe([post("ig", 3, "c", espresso), post("ig", 4, "d")], "anime"),
    ];
    const [sound] = trendingSounds(observations, NOW);
    expect(sound).toMatchObject({
      title: "Espresso",
      artist: "Sabrina Carpenter",
      label: "trending",
      posts: 3,
      creators: 3,
      categories: 2,
      platforms: { ig: 2, tt: 1 },
      urls: {
        ig: "https://www.instagram.com/reels/audio/1/",
        tt: "https://www.tiktok.com/music/Espresso-6800000000000000001",
      },
    });
    expect(sound.latest.slice(0, 13)).toBe(new Date(NOW - DAY).toISOString().slice(0, 13));
    expect(sound.examples.map((example) => example.handle)).toEqual(["a", "b", "c"]);
    expect(sound.examples[0]).toMatchObject({ platform: "ig", section: "example" });
  });

  it("calls 2 posts by 2 creators emerging and does not list a sound one creator posted twice", () => {
    const sounds = trendingSounds(
      [
        ...observe([post("tt", 1, "a", espresso), post("ig", 2, "b", espresso)], "cars"),
        ...observe(
          [post("tt", 1, "solo", { title: "Song" }), post("tt", 2, "solo", { title: "Song" })],
          "cars",
        ),
      ],
      NOW,
    );
    expect(sounds.map((sound) => [sound.title, sound.label])).toEqual([["Espresso", "emerging"]]);
  });

  it("never merges different people's personal original audio, but counts a reused original sound by its id", () => {
    const personal = ["a", "b", "c"].flatMap((creator, index) =>
      observe(
        [post("ig", 1, creator, { title: "Original audio", artist: creator })],
        `cat-${index}`,
      ),
    );
    const anonymous = observe(
      [
        post("ig", 1, "x", { title: "Original audio" }),
        post("ig", 1, "y", { title: "Original audio" }),
      ],
      "cars",
    );
    expect(anonymous).toEqual([]);
    const reusedUrl = "https://www.tiktok.com/music/original-sound-7000000000000000001";
    const reused = observe(
      [
        post("tt", 1, "maker", {
          title: "original sound",
          artist: "maker",
          url: reusedUrl,
          original: true,
        }),
        post("tt", 2, "fan", {
          title: "original sound",
          artist: "maker",
          url: reusedUrl,
          original: true,
        }),
      ],
      "cars",
    );
    const sounds = trendingSounds([...personal, ...reused], NOW);
    expect(sounds).toHaveLength(1);
    expect(sounds[0]).toMatchObject({ label: "emerging", posts: 2, urls: { tt: reusedUrl } });
  });

  it("ignores posts outside 14 days and posts without a real post date", () => {
    const old = observe(
      [post("tt", 15, "a", espresso), post("tt", 20, "b", espresso), post("tt", 1, "c", espresso)],
      "cars",
    );
    const undated = observe(
      [{ ...post("ig", 1, "d", espresso), url: "https://www.instagram.com/p/" } as DiscoverItem],
      "anime",
    );
    expect(undated).toEqual([]);
    expect(trendingSounds([...old, ...undated], NOW)).toEqual([]);
  });

  it("lists a sound 2 creators used within 30 days as seen in edits, below the 14-day tiers", () => {
    const older = { title: "Older" };
    const seen = observe(
      [post("tt", 20, "a", older), post("ig", 25, "b", older), post("tt", 28, "g", older)],
      "cars",
    );
    const solo = observe(
      [post("tt", 20, "s", { title: "Solo" }), post("tt", 21, "s", { title: "Solo" })],
      "cars",
    );
    const mixed = observe(
      [post("tt", 3, "e", { title: "Mixed" }), post("ig", 20, "f", { title: "Mixed" })],
      "anime",
    );
    const fresh = observe(
      [post("tt", 1, "c", espresso), post("ig", 2, "d", espresso), post("tt", 22, "h", espresso)],
      "cars",
    );
    const all = [...seen, ...solo, ...mixed, ...fresh];
    const sounds = trendingSounds(all, NOW, 10, { seen: true });
    expect(sounds.map((sound) => [sound.title, sound.label, sound.posts, sound.creators])).toEqual([
      // The 14-day tiers keep counting only the last 14 days.
      ["Espresso", "emerging", 2, 2],
      ["Older", "seen", 3, 3],
      ["Mixed", "seen", 2, 2],
    ]);
    expect(sounds[1].latest.slice(0, 10)).toBe(new Date(NOW - 20 * DAY).toISOString().slice(0, 10));
    expect(sounds[2]).toMatchObject({ categories: 1, platforms: { tt: 1, ig: 1 } });
    // Without the option the list stays the 14-day one.
    expect(trendingSounds(all, NOW).map((sound) => sound.label)).toEqual(["emerging"]);
  });

  it("weighs Instagram and TikTok posts over YouTube, then recency", () => {
    const tube = { title: "Tube" };
    const youtube = observe(
      [post("yt", 1, "a", tube), post("yt", 1, "b", tube), post("yt", 1, "c", tube)],
      "cars",
    );
    const social = observe([post("tt", 5, "d", espresso), post("ig", 6, "e", espresso)], "cars");
    const fresher = observe(
      [post("tt", 2, "f", { title: "New" }), post("ig", 2, "g", { title: "New" })],
      "cars",
    );
    expect(trendingSounds([...youtube, ...social, ...fresher], NOW).map((s) => s.title)).toEqual([
      "New",
      "Espresso",
      "Tube",
    ]);
  });

  it("keeps a bounded store: one row per post (newest wins), at most 2,000, nothing older than 30 days", () => {
    const first = observe([post("tt", 1, "a", espresso)], "cars");
    const again = first.map((row) => ({
      ...row,
      category: "anime",
      observedAt: new Date(NOW + 1000).toISOString(),
    }));
    const merged = mergeSoundObservations(first, again, NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0].category).toBe("anime");
    const old = observe([post("tt", 31, "z", espresso)], "cars");
    expect(old).toHaveLength(1);
    expect(mergeSoundObservations(old, [], NOW)).toEqual([]);
    const many: SoundObservation[] = Array.from({ length: 2100 }, (_, index) => ({
      ...first[0],
      post: `https://www.tiktok.com/@a/video/${index}`,
    }));
    expect(mergeSoundObservations([], many, NOW)).toHaveLength(2000);
    expect(mergeSoundObservations("corrupt", [], NOW)).toEqual([]);
    expect(mergeSoundObservations([{ post: 1 }, null], first, NOW)).toEqual(first);
  });

  it("files a Search section's sounds under its topic, not under the editor it was searched with", () => {
    expect(searchSoundCategory("Car Edit capcut")).toBe("search:car edit");
    expect(searchSoundCategory("car edit davinci resolve")).toBe("search:car edit");
    expect(searchSoundCategory("car  edit davinci")).toBe("search:car edit");
  });
});
