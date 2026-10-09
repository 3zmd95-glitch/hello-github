import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import type { Inspiration } from "./inspiration";
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";
import { rankDiscoverItems } from "./discoverRanking";
import {
  DISCOVER_CANDIDATE_MAX,
  DISCOVER_CANDIDATE_MAX_CHARS,
  DISCOVER_CATEGORY_MAX,
  DISCOVER_FEEDBACK_MAX,
  DiscoverCandidatesSchema,
  DiscoverFeedbackListSchema,
  accumulateCategoryCandidates,
  mergeDiscoverCandidates,
  categoryCandidates,
  changeDiscoverFeedback,
  discoverCreatorKey,
  discoverFeedbackCreator,
  discoverFeedbackForItem,
  discoverPostKey,
  restoreDiscoverFeedback,
  savedDiscoverInterests,
  type DiscoverFeedbackInput,
} from "./discoverFeed";

const now = new Date("2026-10-09T12:00:00Z");
const later = new Date("2026-10-09T13:00:00Z");
const post = (id = "ABC123"): DiscoverItem => ({
  platform: "ig",
  handle: "@editor",
  title: "Coffee match cut",
  snippet: "Coffee to a spinning wheel match cut",
  url: `https://www.instagram.com/reel/${id}/?igsh=tracking`,
  lang: "en",
  section: "example",
  published: "2026-10-08",
});
const vote = (action: DiscoverFeedbackInput["action"], id = "ABC123"): DiscoverFeedbackInput => ({
  url: post(id).url,
  platform: "ig",
  creator: "@editor",
  genreId: "coffee",
  techniques: ["Match cut"],
  action,
});

describe("category candidate library", () => {
  it("retains a sparse manual import in a full category without giving it evidence or Popular admission", () => {
    const strong = Array.from({ length: DISCOVER_CATEGORY_MAX }, (_, index) => ({
      ...post(`strong${index}`),
      evidence: {
        source: "instagram-public-embed" as const,
        observedAt: now.toISOString(),
        caption: "Coffee match cut",
        likes: 5000,
      },
    }));
    const full = accumulateCategoryCandidates([], strong, { genreId: "coffee", now });
    const sparse = {
      ...post("manual"),
      title: "A reference I saved",
      snippet: "",
      published: undefined,
    };
    const kept = accumulateCategoryCandidates(full, [sparse], {
      genreId: "coffee",
      manuallyAdded: true,
      now: later,
    });
    expect(kept).toHaveLength(DISCOVER_CATEGORY_MAX);
    const entry = kept.find((row) => row.item.url.endsWith("/manual"))!;
    expect(entry.origin).toBe("manual");
    expect(entry.item.evidence).toBeUndefined();
    expect(
      rankDiscoverItems([entry.item], {
        genreId: "coffee",
        mode: "inspiration",
        now: later.getTime(),
      }).items,
    ).toEqual([]);
    expect(
      rankDiscoverItems([entry.item], { genreId: "coffee", mode: "popular", now: later.getTime() })
        .items,
    ).toEqual([]);
    expect(
      DiscoverCandidatesSchema.parse(JSON.parse(JSON.stringify(kept))).find(
        (row) => row.item.url === entry.item.url,
      )?.origin,
    ).toBe("manual");
  });

  it("preserves manual origin independently of source selection and only within its imported category", () => {
    const imported = accumulateCategoryCandidates([], [post()], {
      genreId: "coffee",
      manuallyAdded: true,
      now,
    });
    const native = {
      ...post(),
      evidence: {
        source: "instagram-public-embed" as const,
        observedAt: later.toISOString(),
        caption: "Actual caption",
        likes: 5,
      },
    };
    const enriched = accumulateCategoryCandidates(imported, [native], {
      genreId: "coffee",
      now: later,
    });
    expect(enriched[0].origin).toBe("manual");
    expect(enriched[0].item.evidence).toEqual(native.evidence);
    const oldManual = mergeDiscoverCandidates(enriched, imported);
    expect(oldManual[0].origin).toBe("manual");
    expect(oldManual[0].item.evidence).toEqual(native.evidence);
    const sibling = accumulateCategoryCandidates(oldManual, [native], {
      genreId: "cars",
      now: later,
    });
    expect(sibling.find((row) => row.genreId === "cars")?.origin).toBeUndefined();
    const unavailable = {
      ...native,
      evidence: { ...native.evidence, availability: "unavailable" as const },
    };
    expect(
      rankDiscoverItems([unavailable], {
        genreId: "coffee",
        feedback: [{ ...vote("more"), techniques: [], at: later.toISOString() }],
        now: later.getTime(),
      }).items,
    ).toEqual([]);
  });

  it("deduplicates canonical posts within a genre while keeping separate genre context", () => {
    let pool = accumulateCategoryCandidates([], [post()], { genreId: "coffee", now });
    pool = accumulateCategoryCandidates(
      pool,
      [{ ...post(), url: "https://www.instagram.com/p/ABC123" }],
      { genreId: "coffee", now: later },
    );
    expect(pool).toHaveLength(1);
    expect(pool[0].obtainedAt).toBe(now.toISOString());
    expect(pool[0].item.url).toBe("https://www.instagram.com/p/ABC123");
    pool = accumulateCategoryCandidates(pool, [post()], { genreId: "cars", now: later });
    expect(pool).toHaveLength(2);
    expect(categoryCandidates(pool, "coffee")).toHaveLength(1);
    expect(categoryCandidates(pool, "missing")).toEqual([]);
  });

  it("keeps source evidence unchanged and never substitutes retrieval time for publication or observation", () => {
    const actual: DiscoverItem = {
      ...post(),
      evidence: {
        source: "instagram-public-embed",
        observedAt: "2026-10-08T11:00:00Z",
        likes: 734,
        caption: "Coffee match cut",
        author: "editor",
      },
    };
    const first = accumulateCategoryCandidates([], [actual], { genreId: "coffee", now });
    const next = accumulateCategoryCandidates(first, [actual], { genreId: "coffee", now: later });
    expect(next).toEqual(first);
    expect(next[0].item.evidence).toEqual(actual.evidence);
    expect(next[0].item.published).toBe("2026-10-08");
  });

  it("does not downgrade a source read to indexed text or overwrite it with an older source cache", () => {
    const actual: DiscoverItem = {
      ...post(),
      evidence: {
        source: "instagram-public-embed",
        observedAt: now.toISOString(),
        likes: 734,
        caption: "Actual caption",
      },
    };
    const pool = accumulateCategoryCandidates([], [actual], { genreId: "coffee", now });
    const stale: DiscoverItem = {
      ...post(),
      title: "Contaminated recipe",
      stats: { likes: 99_000_000 },
      evidence: { source: "indexed-excerpt", observedAt: later.toISOString() },
    };
    expect(accumulateCategoryCandidates(pool, [stale], { genreId: "coffee", now: later })).toEqual(
      pool,
    );
    const older = {
      ...actual,
      evidence: { ...actual.evidence!, observedAt: "2026-10-07T12:00:00Z", likes: 1 },
    };
    expect(accumulateCategoryCandidates(pool, [older], { genreId: "coffee", now: later })).toEqual(
      pool,
    );
    const newer = {
      ...actual,
      evidence: { ...actual.evidence!, observedAt: later.toISOString(), likes: 810 },
    };
    expect(
      accumulateCategoryCandidates(pool, [newer], { genreId: "coffee", now: later })[0].item
        .evidence?.likes,
    ).toBe(810);
    expect(
      accumulateCategoryCandidates(pool, [newer], { genreId: "coffee", now: later })[0].obtainedAt,
    ).toBe(now.toISOString());
  });

  it("retains a newer explicit unavailable source rather than keeping an apparently playable old item", () => {
    const item: DiscoverItem = {
      ...post(),
      platform: "tt",
      url: "https://www.tiktok.com/@editor/video/7691796347128761632",
      evidence: {
        source: "tiktok-public-page",
        observedAt: now.toISOString(),
        availability: "available",
        caption: "Coffee edit",
        likes: 1000,
      },
    };
    const pool = accumulateCategoryCandidates([], [item], { genreId: "coffee", now });
    const unavailable: DiscoverItem = {
      ...item,
      evidence: {
        source: "tiktok-public-page",
        observedAt: later.toISOString(),
        availability: "unavailable",
      },
    };
    expect(
      accumulateCategoryCandidates(pool, [unavailable], { genreId: "coffee", now: later })[0].item
        .evidence,
    ).toEqual(unavailable.evidence);
  });

  it("ignores invalid records and strips unknown payloads while retaining valid evidence", () => {
    const pool = DiscoverCandidatesSchema.parse([
      {},
      {
        genreId: "coffee",
        obtainedAt: now.toISOString(),
        item: { ...post(), url: "https://attacker.test/reel/ABC123" },
      },
      {
        genreId: "coffee",
        obtainedAt: now.toISOString(),
        item: { ...post(), evidence: { source: "youtube-api", observedAt: now.toISOString() } },
      },
      {
        genreId: "coffee",
        obtainedAt: now.toISOString(),
        item: { ...post(), stats: { likes: -1 } },
      },
      {
        genreId: "coffee",
        obtainedAt: now.toISOString(),
        item: {
          ...post(),
          token: "must-not-persist",
          thumb: "javascript:alert(1)",
          profile: "https://www.instagram.com/editor/?access_token=discard",
        },
      },
    ]);
    expect(pool).toHaveLength(1);
    expect(pool[0].item).not.toHaveProperty("token");
    expect(pool[0].item.thumb).toBeUndefined();
    expect(pool[0].item.profile).toBe("https://www.instagram.com/editor");
    expect(DiscoverCandidatesSchema.parse(undefined)).toEqual([]);
  });

  it("bounds per-category count, total count and serialized storage footprint", () => {
    const many = Array.from({ length: 130 }, (_, i) => post(`POST${i}`));
    expect(accumulateCategoryCandidates([], many, { genreId: "coffee", now })).toHaveLength(
      DISCOVER_CATEGORY_MAX,
    );
    let pool = accumulateCategoryCandidates([], [], { genreId: "coffee", now });
    const genres = Math.ceil(DISCOVER_CANDIDATE_MAX / DISCOVER_CATEGORY_MAX) + 2;
    for (let i = 0; i < genres; i++)
      pool = accumulateCategoryCandidates(pool, many, {
        genreId: `genre${i}`,
        now: new Date(now.getTime() + i),
      });
    expect(pool).toHaveLength(DISCOVER_CANDIDATE_MAX);
    for (let i = 0; i < genres; i++)
      expect(categoryCandidates(pool, `genre${i}`).length).toBeGreaterThanOrEqual(20);
    const large = Array.from({ length: 3000 }, (_, i) => ({
      genreId: `genre${Math.floor(i / 100)}`,
      obtainedAt: now.toISOString(),
      item: { ...post(`LARGE${i}`), snippet: "x".repeat(6000) },
    }));
    const bounded = DiscoverCandidatesSchema.parse(large);
    expect(bounded.length).toBeLessThan(3000);
    expect(JSON.stringify(bounded).length).toBeLessThanOrEqual(DISCOVER_CANDIDATE_MAX_CHARS);
  });

  it("retains a reusable sample in all twelve categories when later searches fill the library", () => {
    let pool = accumulateCategoryCandidates([], [], { genreId: "genre0", now });
    for (let genre = 0; genre < 12; genre++)
      pool = accumulateCategoryCandidates(
        pool,
        Array.from({ length: 100 }, (_, i) => post(`P${i}`)),
        { genreId: `genre${genre}`, now: new Date(now.getTime() + genre * 1000) },
      );
    expect(pool).toHaveLength(1200);
    for (let genre = 0; genre < 12; genre++)
      expect(categoryCandidates(pool, `genre${genre}`).length).toBe(100);
    expect(accumulateCategoryCandidates(pool, [], { genreId: "genre0", now: later })).toEqual(pool);
  });

  it("retains authentic category proof despite stale indexed flags, without rescuing wrong or missing captions", () => {
    const fillers = Array.from({ length: 100 }, (_, index) => post(`FILLER${index}`));
    const actual: DiscoverItem = {
      ...post("ACTUAL"),
      offTopic: true,
      outsideCategory: true,
      evidence: {
        source: "instagram-public-embed",
        observedAt: now.toISOString(),
        caption: "Coffee cinematic video montage",
        likes: 1500,
      },
    };
    const incoming = [
      actual,
      {
        ...actual,
        url: post("MISSING").url,
        evidence: { ...actual.evidence!, caption: undefined },
      },
      {
        ...actual,
        url: post("WRONG").url,
        evidence: { ...actual.evidence!, caption: "Anime beat sync" },
      },
      { ...actual, url: post("INDEXED").url, evidence: undefined, stats: { likes: 100_000 } },
      {
        ...actual,
        url: post("GONE").url,
        evidence: { ...actual.evidence!, availability: "unavailable" as const },
      },
    ];
    const pool = accumulateCategoryCandidates([], [...fillers, ...incoming], {
      genreId: "coffee",
      now,
    });
    expect(pool).toHaveLength(100);
    expect(pool.some((row) => row.item.url.endsWith("/ACTUAL"))).toBe(true);
    for (const id of ["MISSING", "WRONG", "INDEXED", "GONE"])
      expect(
        pool.some((row) => row.item.url.endsWith(`/${id}`)),
        id,
      ).toBe(false);
  });

  it("preserves useful examples and lessons in all twelve verbose categories after weak source updates", () => {
    let pool = accumulateCategoryCandidates([], [], { genreId: "coffee", now });
    for (const [genreId, profile] of Object.entries(CATEGORY_PROFILES)) {
      const subject = profile.subject.en;
      const items = Array.from({ length: 24 }, (_, index): DiscoverItem => {
        const lesson = index % 3 === 2;
        const platform = index % 3 === 0 ? "ig" : "yt";
        const title = lesson
          ? `${subject} match cut editing tutorial explained step by step`
          : platform === "ig"
            ? `${subject} cinematic video montage`
            : `${subject} match cut film`;
        const caption = `${title}. ${"Source description. ".repeat(220)}`.slice(0, 4000);
        return {
          ...post(`${genreId}${index}`),
          title,
          platform,
          url:
            platform === "ig"
              ? `https://www.instagram.com/p/${genreId}${index}/`
              : `https://www.youtube.com/watch?v=${genreId}${index}`,
          snippet: caption,
          section: lesson ? "tutorial" : "example",
          evidence: {
            source: platform === "ig" ? "instagram-public-embed" : "youtube-api",
            observedAt: now.toISOString(),
            caption,
            ...(platform === "ig" ? { likes: 1200 } : { views: lesson ? 60 : 60_000 }),
          },
        };
      });
      pool = accumulateCategoryCandidates(pool, items, { genreId, now });
    }
    for (const [genreId, profile] of Object.entries(CATEGORY_PROFILES)) {
      const lowCaption =
        `${profile.subject.en} match cut. ${"New source description. ".repeat(180)}`.slice(0, 4000);
      pool = accumulateCategoryCandidates(
        pool,
        Array.from({ length: 30 }, (_, index) => ({
          ...post(`WEAK${genreId}${index}`),
          title: `${profile.subject.en} match cut`,
          snippet: lowCaption,
          stats: { likes: 99_000_000 },
          evidence: {
            source: "instagram-public-embed" as const,
            observedAt: later.toISOString(),
            caption: lowCaption,
            likes: 5,
          },
        })),
        { genreId, now: later },
      );
    }
    expect(JSON.stringify(pool).length).toBeLessThanOrEqual(DISCOVER_CANDIDATE_MAX_CHARS);
    for (const genreId of Object.keys(CATEGORY_PROFILES)) {
      const items = categoryCandidates(pool, genreId);
      const examples = rankDiscoverItems(items, {
        genreId,
        mode: "inspiration",
        now: later.getTime(),
      });
      const lessons = rankDiscoverItems(items, { genreId, mode: "learning", now: later.getTime() });
      expect(
        examples.items.some((row) => row.platform === "yt"),
        genreId,
      ).toBe(true);
      expect(
        examples.items.some((row) => row.platform === "ig"),
        genreId,
      ).toBe(true);
      expect(lessons.items.length, genreId).toBeGreaterThan(0);
      expect(
        items.every((item) => item.evidence?.caption?.length === 4000),
        genreId,
      ).toBe(true);
      expect(
        examples.items.some((item) => item.url.includes("WEAK")),
        genreId,
      ).toBe(false);
      expect(items.filter((item) => !item.url.includes("WEAK")).length, genreId).toBe(24);
    }
    expect(accumulateCategoryCandidates(pool, [], { genreId: "coffee", now: later })).toEqual(pool);
    expect(DiscoverCandidatesSchema.parse(pool)).toEqual(pool);
  });
});

describe("saved and practiced interest adapter", () => {
  const saved = (overrides: Partial<Inspiration> = {}): Inspiration => ({
    ref: { platform: "ig", url: post().url, handle: "@editor", title: "Cup match cut" },
    note: "Try this clone effect",
    stage: "saved",
    savedAt: now.toISOString(),
    ...overrides,
  });
  it("derives canonical exact-reference interests without inventing votes, genres or technique evidence", () => {
    expect(savedDiscoverInterests([saved({ stage: "tried" })])).toEqual([
      {
        url: "https://www.instagram.com/p/ABC123",
        platform: "ig",
        creator: "@editor",
        stage: "tried",
        savedAt: now.toISOString(),
      },
    ]);
    expect(savedDiscoverInterests([])).toEqual([]);
  });
  it("deduplicates saved variants, ignores web/spoofed links, and preserves actual practice stage", () => {
    const entries = [
      saved(),
      saved({
        ref: { ...saved().ref, url: "https://www.instagram.com/p/ABC123" },
        stage: "trying",
        savedAt: later.toISOString(),
      }),
      saved({ ref: { ...saved().ref, platform: "web", url: "https://example.com/lesson" } }),
      saved({ ref: { ...saved().ref, url: "https://evil.test/reel/ABC123" } }),
    ];
    const interests = savedDiscoverInterests(entries);
    expect(interests).toHaveLength(1);
    expect(interests[0].stage).toBe("trying");
    expect(interests[0].savedAt).toBe(later.toISOString());
  });
});

describe("source-qualified identity", () => {
  it("canonicalizes all supported public post variants and rejects spoofed hosts and audio pages", () => {
    expect(discoverPostKey("yt", "https://www.youtube.com/live/ABC123?t=5")).toBe(
      "https://www.youtube.com/watch?v=ABC123",
    );
    expect(discoverPostKey("yt", "https://www.youtube.com/embed/ABC123")).toBe(
      "https://www.youtube.com/watch?v=ABC123",
    );
    expect(discoverPostKey("yt", "https://youtu.be/ABC123")).toBe(
      "https://www.youtube.com/watch?v=ABC123",
    );
    expect(discoverPostKey("ig", "https://www.instagram.com/editor/reel/ABC123/")).toBe(
      "https://www.instagram.com/p/ABC123",
    );
    for (const url of [
      "https://instagram.com.attacker.test/reel/ABC123",
      "https://name:secret@instagram.com/reel/ABC123",
      "javascript:alert(1)",
      "https://www.instagram.com/reels/audio/123/",
    ])
      expect(discoverPostKey("ig", url)).toBeNull();
  });

  it("normalizes creator handles and platform profiles without merging platforms or unknown names", () => {
    expect(discoverCreatorKey("ig", "@Editor")).toBe("ig:editor");
    expect(discoverCreatorKey("ig", "https://www.instagram.com/editor/")).toBe("ig:editor");
    expect(discoverCreatorKey("tt", "https://www.tiktok.com/@editor")).toBe("tt:editor");
    expect(discoverCreatorKey("yt", "https://www.youtube.com/channel/UCAbCd")).toBe(
      "yt:channel:UCAbCd",
    );
    for (const value of [
      "",
      "unknown",
      "www.instagram.com",
      "https://www.instagram.com/reels/",
      "https://evil.test/editor",
    ])
      expect(discoverCreatorKey("ig", value)).toBeNull();
  });

  it("uses actual creator attribution and stable YouTube channel profiles consistently", () => {
    const actual: DiscoverItem = {
      ...post(),
      handle: "wrong-index-author",
      evidence: {
        source: "instagram-public-embed",
        observedAt: now.toISOString(),
        author: "actual.editor",
      },
    };
    expect(discoverFeedbackCreator(actual)).toBe("actual.editor");
    expect(
      discoverFeedbackCreator({
        ...actual,
        evidence: { ...actual.evidence!, source: "youtube-api" },
      }),
    ).toBe("wrong-index-author");
    expect(
      discoverFeedbackCreator({
        ...actual,
        platform: "yt",
        profile: "https://www.youtube.com/channel/UCAbCd",
        evidence: {
          source: "youtube-api",
          author: "Shared display name",
          observedAt: now.toISOString(),
        },
      }),
    ).toBe("https://www.youtube.com/channel/UCAbCd");
  });
});

describe("explicit feedback with scoped Undo", () => {
  it("replaces a vote and restores the previous preference while preserving unrelated new actions", () => {
    const first = changeDiscoverFeedback([], vote("more"), now).feedback;
    const changed = changeDiscoverFeedback(first, vote("less"), later);
    const other = changeDiscoverFeedback(
      changed.feedback,
      vote("more", "OTHER"),
      new Date(later.getTime() + 1000),
    );
    const undone = restoreDiscoverFeedback(other.feedback, changed.undo!);
    expect(undone).toHaveLength(2);
    expect(discoverFeedbackForItem(undone, post(), "coffee")?.action).toBe("more");
    expect(discoverFeedbackForItem(undone, post("OTHER"), "coffee")?.action).toBe("more");
    expect(discoverFeedbackForItem(undone, post(), "cars")).toBeUndefined();
  });

  it("does not use an obsolete Undo to overwrite a newer choice", () => {
    const first = changeDiscoverFeedback([], vote("more"), now);
    const next = changeDiscoverFeedback(first.feedback, vote("less"), later);
    expect(restoreDiscoverFeedback(next.feedback, first.undo!)).toEqual(next.feedback);
  });

  it("hides creators across genres, keeps prior post feedback, and genuinely undoes the hide", () => {
    const first = changeDiscoverFeedback([], vote("more"), now).feedback;
    const hidden = changeDiscoverFeedback(first, vote("hide-creator"), later);
    expect(hidden.feedback).toHaveLength(2);
    expect(discoverFeedbackForItem(hidden.feedback, post("OTHER"), "cars")?.action).toBe(
      "hide-creator",
    );
    expect(
      discoverFeedbackForItem(
        hidden.feedback,
        { ...post(), platform: "tt", url: "https://www.tiktok.com/@editor/video/123" },
        "coffee",
      ),
    ).toBeUndefined();
    expect(restoreDiscoverFeedback(hidden.feedback, hidden.undo!)).toEqual(first);
  });

  it("clears related preferences reversibly and rejects unknown creator hides", () => {
    const first = changeDiscoverFeedback([], vote("more"), now).feedback;
    const hidden = changeDiscoverFeedback(first, vote("hide-creator"), later).feedback;
    const cleared = changeDiscoverFeedback(hidden, vote("clear"), new Date(later.getTime() + 1000));
    expect(cleared.feedback).toEqual([]);
    expect(restoreDiscoverFeedback(cleared.feedback, cleared.undo!)).toEqual(hidden);
    expect(
      changeDiscoverFeedback(first, { ...vote("hide-creator"), creator: "unknown" }, later),
    ).toEqual({ feedback: first });
  });

  it("normalizes techniques and imports only bounded, latest valid effective preferences", () => {
    const first = changeDiscoverFeedback(
      [],
      { ...vote("more"), techniques: ["Match cut", "match cut"] },
      now,
    ).feedback;
    expect(first[0].techniques).toEqual(["match cut"]);
    const entries = Array.from({ length: DISCOVER_FEEDBACK_MAX + 20 }, (_, i) => ({
      ...vote("more", `POST${i}`),
      at: new Date(now.getTime() + i).toISOString(),
    }));
    const parsed = DiscoverFeedbackListSchema.parse([{}, ...entries]);
    expect(parsed).toHaveLength(DISCOVER_FEEDBACK_MAX);
    expect(parsed[0].url).toContain("POST519");
    expect(DiscoverFeedbackListSchema.parse(undefined)).toEqual([]);
    expect(changeDiscoverFeedback(first, vote("less"), new Date("2026-10-08T12:00:00Z"))).toEqual({
      feedback: first,
    });
  });
});
