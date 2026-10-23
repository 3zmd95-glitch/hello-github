import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import type { DiscoverForYouRow } from "./discoverForYou";
import type { EditFormat } from "./editFormats";
import type { TrendingEffects } from "./effects";
import {
  editKey,
  localTrendingEdits,
  mergeTrendingEdits,
  postCounts,
  workerScanDay,
  workerTrendingEdits,
  type TrendingEdit,
} from "./trendingEdits";
import { instagramShortcodeAt, tiktokIdAt } from "../workers/scout/src/postDate";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-23T12:00:00Z");
let n = 0;

/** A For You row for a dated TikTok post by `creator` in `genreId` naming `techniques`. */
function row(
  creator: string,
  genreId: string,
  daysAgo: number,
  techniques = ["clone effect"],
  platform: "tt" | "ig" | "yt" = "tt",
): DiscoverForYouRow {
  const at = new Date(NOW - daysAgo * DAY);
  const url =
    platform === "tt"
      ? `https://www.tiktok.com/@${creator}/video/${tiktokIdAt(at, ++n)}`
      : platform === "ig"
        ? `https://www.instagram.com/reel/${instagramShortcodeAt(at, ++n)}/`
        : `https://www.youtube.com/watch?v=v${++n}`;
  const item: DiscoverItem = {
    platform,
    url,
    handle: creator ? `@${creator}` : "",
    title: `${techniques.join(" ")} edit`,
    snippet: "",
    lang: "en",
    section: "example",
    // A YouTube link carries no decodable post id: the reported date stands in.
    ...(platform === "yt" ? { published: at.toISOString() } : {}),
  };
  return {
    item,
    genreId,
    evidence: {
      techniques,
      date: { published: at.toISOString(), basis: "reported", recent: true },
    } as DiscoverForYouRow["evidence"],
  };
}

const sample = (handle: string, daysAgo: number, id = ++n) => ({
  url: `https://www.tiktok.com/@${handle}/video/${tiktokIdAt(new Date(NOW - daysAgo * DAY), id)}`,
  title: `${handle} edit`,
  published: new Date(NOW - daysAgo * DAY).toISOString(),
});

const effects = (over: Partial<TrendingEffects> = {}): TrendingEffects => ({
  evidenceVersion: 1,
  status: "ok",
  updatedAt: new Date(NOW - 2 * 3_600_000).toISOString(),
  items: [],
  ...over,
});

describe("editKey", () => {
  it("folds case, punctuation and the CREATIVE aliases in either language to one technique", () => {
    expect(editKey("Clone-Effect!")).toBe("clone effect");
    expect(editKey("duplicate effect")).toBe("clone effect");
    expect(editKey("تكرار الشخص")).toBe("clone effect");
    expect(editKey("Repeating figures")).toBe("stacked cutout figures");
    expect(editKey("Some New Trend")).toBe("some new trend");
  });
});

describe("localTrendingEdits", () => {
  it("trends at 3 creators in 2 categories within 14 days; 2 creators emerge; 1 creator never shows", () => {
    const rows = [
      row("a", "cars", 1),
      row("b", "cars", 2),
      row("c", "anime", 3),
      row("d", "cars", 1, ["speed ramp"]),
      row("e", "cars", 2, ["speed ramp"]),
      row("f", "cars", 1, ["match cut"]),
      row("f", "anime", 2, ["match cut"]),
    ];
    const edits = localTrendingEdits(rows, NOW);
    expect(edits.map((e) => [e.key, e.tier, e.creators, e.categories])).toEqual([
      ["clone effect", "trending", 3, 2],
      ["speed ramp", "emerging", 2, 1],
    ]);
    const [clone] = edits;
    expect(clone.name).toEqual({ en: "clone effect", ar: "تأثير الاستنساخ" });
    expect(clone.source).toBe("local");
    expect(clone.firstSeen).toBe("2026-10-20");
    expect(clone.lastSeen).toBe("2026-10-22");
    expect(clone.learnQuery).toBe("clone effect edit tutorial");
    expect(clone.examples).toHaveLength(3);
  });

  it("counts only posts from the last 30 days, and none from the future", () => {
    const rows = [row("a", "cars", 1), row("b", "anime", 40), row("c", "cars", -3)];
    expect(localTrendingEdits(rows, NOW)).toEqual([]);
    expect(localTrendingEdits([...rows, row("d", "cars", 29)], NOW)[0].creators).toBe(2);
  });

  it("emerges at 2 creators within 30 days, and trends only with a post from the last 14", () => {
    const old = [row("a", "cars", 20), row("b", "cars", 25), row("c", "anime", 28)];
    // Three creators in two categories, but none posted in the last 14 days: emerging only.
    const [stale] = localTrendingEdits(old, NOW);
    expect(stale).toMatchObject({ tier: "emerging", creators: 3, firstSeen: "2026-09-25" });
    expect(stale.lastSeen).toBe("2026-10-03");
    const [fresh] = localTrendingEdits([...old, row("a", "cars", 13)], NOW);
    expect(fresh).toMatchObject({ tier: "trending", lastSeen: "2026-10-10" });
    expect(localTrendingEdits([row("a", "cars", 27), row("b", "cars", 29)], NOW)[0].tier).toBe(
      "emerging",
    );
  });

  it("counts distinct creators per platform, and drops posts with no known creator or date", () => {
    const undated = row("x", "cars", 1, ["clone effect"], "yt");
    delete undated.item.published;
    undated.evidence.date = { basis: "unknown", recent: false };
    const rows = [
      row("a", "cars", 1),
      row("a", "anime", 2),
      row("a", "cars", 3, ["clone effect"], "ig"),
      row("", "cars", 1),
      undated,
    ];
    const [edit] = localTrendingEdits(rows, NOW);
    // tt:a and ig:a are not known to be one person; the unnamed and undated posts do not count.
    expect(edit).toMatchObject({ tier: "emerging", creators: 2, categories: 2 });
  });

  it("marks a technique rising when more creators posted it in the last 3 days than the 3 before", () => {
    const rising = localTrendingEdits(
      [row("a", "cars", 0.5), row("b", "cars", 1), row("c", "anime", 4)],
      NOW,
    );
    expect(rising[0].rising).toBe(true);
    const flat = localTrendingEdits(
      [row("a", "cars", 0.5), row("b", "cars", 4), row("c", "anime", 5)],
      NOW,
    );
    expect(flat[0].rising).toBe(false);
  });

  it("shows up to 3 examples, a different platform first, newest first", () => {
    const rows = [
      row("a", "cars", 1),
      row("b", "cars", 2),
      row("c", "anime", 3, ["clone effect"], "ig"),
      row("d", "anime", 4),
    ];
    const [edit] = localTrendingEdits(rows, NOW);
    expect(edit.examples.map((e) => [e.platform, e.handle])).toEqual([
      ["tt", "@a"],
      ["ig", "@c"],
      ["tt", "@b"],
    ]);
  });
});

describe("workerTrendingEdits", () => {
  it("turns dated effects into rows with the Worker's 7-day creators and unknown categories", () => {
    const edits = workerTrendingEdits(
      effects({
        items: [
          {
            key: "clone-effect",
            name: { en: "clone effect", ar: "تأثير الاستنساخ" },
            isNew: false,
            creators: 9,
            growth: 1.5,
            samples: [sample("cloner", 2), sample("twin", 5)],
          },
          // No dated sample: no row.
          { key: "speed-ramp", name: { en: "speed ramp" }, isNew: false, creators: 5, growth: 1 },
          // One creator: hidden.
          {
            key: "one",
            name: { en: "one-off" },
            isNew: true,
            creators: 1,
            growth: 1,
            samples: [sample("solo", 1)],
          },
        ],
      }),
      NOW,
    );
    // The undated speed ramp now rests on the scan day (see the scan-date tests); one creator is still hidden.
    expect(edits.map((e) => e.key)).toEqual(["clone effect", "speed ramp"]);
    // 9 identified accounts (under 10), growth 1.5: emerging, and rising since the Worker growth reaches 1.5.
    expect(edits[0]).toMatchObject({
      key: "clone effect",
      source: "effects",
      tier: "emerging",
      creators: 9,
      categories: 0,
      firstSeen: "2026-10-18",
      lastSeen: "2026-10-21",
      rising: true,
    });
    expect(edits[0].scanDated).toBeUndefined();
    expect(edits[0].examples.map((e) => e.handle)).toEqual(["@cloner", "@twin"]);
  });

  it("renders a row with no samples on the scan day (a real date), without examples", () => {
    const item = (key: string, creators: number, growth: number) => ({
      key,
      name: { en: key },
      isNew: false,
      creators,
      growth,
      samples: [],
    });
    // A doc without evidenceVersion (the cached one the owner browser holds) works the same.
    const [edit] = workerTrendingEdits(
      effects({ evidenceVersion: undefined, items: [item("freeze frame", 21, 1)] }),
      NOW,
    );
    expect(edit).toMatchObject({
      key: "freeze frame",
      source: "effects",
      tier: "trending",
      creators: 21,
      categories: 0,
      firstSeen: "2026-10-23",
      lastSeen: "2026-10-23",
      scanDated: true,
      examples: [],
    });
    expect(edit.learnQuery).toBe("freeze frame edit tutorial");
    // Samples older than 14 days are no examples and no date: the scan day stands.
    const [old] = workerTrendingEdits(
      effects({ items: [{ ...item("glitch", 3, 1), samples: [sample("old", 20)] }] }),
      NOW,
    );
    expect(old).toMatchObject({ scanDated: true, lastSeen: "2026-10-23", examples: [] });
  });

  it("trends a Worker-only row at 10 accounts, or growth 2 with 5+ accounts; rising from growth 1.5", () => {
    const item = (key: string, creators: number, growth: number) => ({
      key,
      name: { en: key },
      isNew: false,
      creators,
      growth,
    });
    const edits = workerTrendingEdits(
      effects({
        items: [
          item("a1", 9, 1.49),
          item("a2", 10, 1),
          item("a3", 4, 3),
          item("a4", 4, 1.5),
          item("a5", 1, 5),
          item("a6", 5, 2),
          item("a7", 5, 1.9),
        ],
      }),
      NOW,
    );
    expect(edits.map((e) => [e.key, e.tier, e.rising])).toEqual([
      ["a1", "emerging", false],
      ["a2", "trending", false],
      // 3 or 4 accounts at x3 is emerging and rising, never trending.
      ["a3", "emerging", true],
      ["a4", "emerging", true],
      ["a6", "trending", true],
      ["a7", "emerging", true],
    ]);
  });

  it("keeps a row rising when either source says so, and the scan day when either has no sample", () => {
    const local = localTrendingEdits(
      [row("a", "cars", 4), row("b", "cars", 5), row("c", "anime", 6)],
      NOW,
    );
    expect(local[0].rising).toBe(false);
    const worker = workerTrendingEdits(
      effects({
        items: [
          { key: "dup", name: { en: "duplicate effect" }, isNew: false, creators: 4, growth: 3 },
        ],
      }),
      NOW,
    );
    const [merged] = mergeTrendingEdits([local, worker]);
    expect(merged).toMatchObject({ rising: true, scanDated: true, lastSeen: "2026-10-23" });
  });

  it("names the scan day only while the scan is usable, and counts the posts Discover has read", () => {
    expect(workerScanDay(effects(), NOW)).toBe("2026-10-23");
    expect(workerScanDay(effects({ status: "never" }), NOW)).toBeNull();
    expect(
      workerScanDay(effects({ updatedAt: new Date(NOW - 4 * DAY).toISOString() }), NOW),
    ).toBeNull();
    expect(workerScanDay(null, NOW)).toBeNull();
    const posts = [row("a", "cars", 1), row("b", "cars", 13), row("c", "cars", 15)].map(
      ({ item }) => ({ item }),
    );
    // A post with no date at all counts as read but not as recent.
    const undated = {
      item: { ...posts[0].item, url: "https://example.com/x", published: undefined },
    };
    expect(postCounts([...posts, undated], NOW)).toEqual({ posts: 4, recent: 2 });
  });

  it("keeps first/last days and examples inside the 14-day window", () => {
    const [edit] = workerTrendingEdits(
      effects({
        items: [
          {
            key: "clone-effect",
            name: { en: "clone effect" },
            isNew: false,
            creators: 4,
            growth: 1,
            samples: [sample("old", 30), sample("new", 2)],
          },
        ],
      }),
      NOW,
    );
    expect([edit.firstSeen, edit.lastSeen]).toEqual(["2026-10-21", "2026-10-21"]);
    expect(edit.examples.map((e) => e.handle)).toEqual(["@new"]);
  });

  it("shows nothing from a missing, never-run or stale daily scan", () => {
    const one = {
      key: "clone-effect",
      name: { en: "clone effect" },
      isNew: false,
      creators: 9,
      growth: 1,
      samples: [sample("a", 1)],
    };
    expect(workerTrendingEdits(null, NOW)).toEqual([]);
    expect(workerTrendingEdits(effects({ status: "never", items: [one] }), NOW)).toEqual([]);
    expect(
      workerTrendingEdits(
        effects({ items: [one], updatedAt: new Date(NOW - 4 * DAY).toISOString() }),
        NOW,
      ),
    ).toEqual([]);
  });

  it("keeps an edit format with its key, its exact tutorial query and its sample handles", () => {
    const checked = new Date(NOW - DAY).toISOString();
    const format = {
      key: "night-walk|clone",
      name: { en: "Night Walk — clone figures", ar: "مشية الليل — نسخ" },
      visualPattern: { en: "clone figures on each beat" },
      audio: { title: "Night Walk", artist: "Fixture Artist" },
      firstSeen: checked,
      lastChecked: checked,
      source: "indexed-public-posts",
      evidence: {
        state: "repeated",
        creators7d: 4,
        posts7d: 5,
        latestPostAt: checked,
        scope: "indexed-public-posts",
      },
      samples: [
        {
          url: "https://www.instagram.com/reel/NW1/",
          title: "clone figures",
          platform: "ig",
          handle: "walker",
          published: new Date(NOW - 3 * DAY).toISOString(),
          observedAt: checked,
        },
      ],
    } as EditFormat;
    const [edit] = workerTrendingEdits(effects({ formatVersion: 1, formats: [format] }), NOW);
    expect(edit).toMatchObject({
      source: "format",
      formatKey: "night-walk|clone",
      tier: "emerging",
      creators: 4,
      firstSeen: "2026-10-20",
      lastSeen: "2026-10-22",
    });
    expect(edit.learnQuery).toContain("Night Walk");
    expect(edit.learnQuery).toContain("tutorial");
    expect(edit.examples[0]).toMatchObject({ platform: "ig", handle: "walker" });
  });
});

describe("mergeTrendingEdits", () => {
  const edit = (over: Partial<TrendingEdit>): TrendingEdit => ({
    key: "x",
    name: { en: "x" },
    source: "local",
    tier: "emerging",
    creators: 2,
    categories: 1,
    firstSeen: "2026-10-20",
    lastSeen: "2026-10-21",
    rising: false,
    examples: [],
    learnQuery: "x edit tutorial",
    ...over,
  });

  it("merges the same technique by alias: most creators, widest dates, examples capped at 3", () => {
    const local = localTrendingEdits(
      [row("a", "cars", 1), row("b", "cars", 2), row("c", "anime", 3)],
      NOW,
    );
    const worker = workerTrendingEdits(
      effects({
        items: [
          {
            key: "duplicate",
            name: { en: "Duplicate effect", ar: "نسخ الشخص" },
            isNew: false,
            creators: 9,
            growth: 1,
            samples: [sample("cloner", 6)],
          },
        ],
      }),
      NOW,
    );
    const [merged, ...rest] = mergeTrendingEdits([local, worker]);
    expect(rest).toEqual([]);
    expect(merged).toMatchObject({
      key: "clone effect",
      source: "merged",
      tier: "trending",
      creators: 9,
      categories: 2,
      firstSeen: "2026-10-17",
      lastSeen: "2026-10-22",
    });
    expect(merged.examples).toHaveLength(3);
    // The local name keeps its own search, not the Worker's synonym.
    expect(merged.learnQuery).toBe("clone effect edit tutorial");
  });

  it("keeps the better tier of two sources judged separately, and both sources' counts", () => {
    const cloneRows = [row("a", "cars", 1), row("b", "cars", 2), row("c", "anime", 3)];
    const scan = (creators: number, growth = 1) =>
      workerTrendingEdits(
        effects({
          items: [{ key: "clone", name: { en: "clone effect" }, isNew: false, creators, growth }],
        }),
        NOW,
      );
    // Local trending + Worker emerging (8 accounts): trending, the local count and the scan count both kept.
    const [a] = mergeTrendingEdits([localTrendingEdits(cloneRows, NOW), scan(8)]);
    expect(a).toMatchObject({ tier: "trending", creators: 8, localCreators: 3, scanCreators: 8 });
    // Local emerging (2 creators) + Worker trending (12 accounts): trending.
    const two = [row("a", "cars", 1), row("b", "cars", 2)];
    const [b] = mergeTrendingEdits([localTrendingEdits(two, NOW), scan(12)]);
    expect(b).toMatchObject({ tier: "trending", localCreators: 2, scanCreators: 12 });
    // Both emerging: emerging, and still both counts.
    const [c] = mergeTrendingEdits([localTrendingEdits(two, NOW), scan(8)]);
    expect(c).toMatchObject({ tier: "emerging", localCreators: 2, scanCreators: 8, categories: 1 });
    // A Worker-only row has no local count.
    expect(scan(8)[0].localCreators).toBeUndefined();
  });

  it("never ranks a local row lower for having a scan count: 3 creators in 2 categories trend alike", () => {
    const scan = (creators: number) =>
      workerTrendingEdits(
        effects({
          items: [{ key: "ramp", name: { en: "speed ramp" }, isNew: false, creators, growth: 0 }],
        }),
        NOW,
      );
    // Posts dated today (3 creators, 2 categories) + 8 scan accounts, growth 0: trending.
    const freshRamp = ["a", "b", "c"].map((c, i) =>
      row(c, i < 2 ? "cars" : "anime", i, ["speed ramp"]),
    );
    const [today] = mergeTrendingEdits([localTrendingEdits(freshRamp, NOW), scan(8)]);
    expect(today).toMatchObject({ tier: "trending", localCreators: 3, scanCreators: 8 });
    expect(today.lastSeen).toBe("2026-10-23");
    // The same breadth, but the newest post is 20 days old: alone it is emerging (no recent post) ...
    const old = ["a", "b", "c"].map((c, i) =>
      row(c, i < 2 ? "cars" : "anime", 20 + i, ["speed ramp"]),
    );
    const [alone] = localTrendingEdits(old, NOW);
    expect(alone).toMatchObject({ tier: "emerging", needsRecent: true });
    // ... and with the scan row (8 identified accounts in 7 days) it trends: never worse off with a scan count.
    const [merged] = mergeTrendingEdits([localTrendingEdits(old, NOW), scan(8)]);
    expect(merged).toMatchObject({ tier: "trending", localCreators: 3, scanCreators: 8 });
    // Not broad enough (2 creators): the scan does not make it trend.
    const [narrow] = mergeTrendingEdits([localTrendingEdits(old.slice(0, 2), NOW), scan(8)]);
    expect(narrow.tier).toBe("emerging");
  });

  it("sorts trending first, then creators, then rising, then the latest date, and keeps 12", () => {
    const rows = [
      edit({ key: "a", tier: "emerging", creators: 50 }),
      edit({ key: "b", tier: "trending", creators: 3 }),
      edit({ key: "c", tier: "trending", creators: 3, rising: true }),
      edit({ key: "d", tier: "trending", creators: 5 }),
      edit({ key: "e", tier: "trending", creators: 5, lastSeen: "2026-10-22" }),
    ];
    // Rising only breaks a tie in creators: c (3, rising) stays under d and e (5).
    expect(mergeTrendingEdits([rows]).map((e) => e.key)).toEqual(["e", "d", "c", "b", "a"]);
    expect(
      mergeTrendingEdits([
        [
          edit({ key: "x", tier: "trending", creators: 4 }),
          edit({ key: "y", tier: "trending", creators: 4, rising: true }),
        ],
      ]).map((e) => e.key),
    ).toEqual(["y", "x"]);
    const many = Array.from({ length: 20 }, (_, i) => edit({ key: `k${i}`, creators: 2 + i }));
    expect(mergeTrendingEdits([many])).toHaveLength(12);
    expect(mergeTrendingEdits([many], 5).map((e) => e.key)).toEqual([
      "k19",
      "k18",
      "k17",
      "k16",
      "k15",
    ]);
  });
});
