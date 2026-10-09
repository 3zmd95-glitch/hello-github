import { describe, expect, it, vi } from "vitest";
import { discoverForYou } from "./discoverForYou";
import type { DiscoverCandidate, DiscoverFeedback, DiscoverSavedInterest } from "./discoverFeed";
import { carxDraftCandidate } from "../workers/scout/src/categories/carxDraft.fixture";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const captions: Record<string, string> = {
  cars: "Car speed ramp",
  food: "Food stop motion",
  anime: "Anime beat sync",
  travel: "Travel whip pan",
  football: "Football freeze frame",
  coffee: "Coffee macro closeup",
  perfume: "Perfume reflection shot",
  camping: "Camping drone reveal",
  fashion: "Fashion motion graphics",
  gaming: "Gaming motion tracking",
  weddings: "Wedding sound design",
  gym: "Gym light sweep",
};
function candidate(genreId: string, id: string, caption = captions[genreId]): DiscoverCandidate {
  return {
    genreId,
    obtainedAt: new Date(NOW).toISOString(),
    item: {
      platform: "ig",
      url: `https://www.instagram.com/p/${id}`,
      handle: `@${id}`,
      title: caption,
      snippet: caption,
      lang: "en",
      section: "example",
      published: "2026-10-08T12:00:00Z",
      stats: { likes: 5000 },
      evidence: {
        source: "instagram-public-embed",
        caption,
        author: id,
        observedAt: new Date(NOW).toISOString(),
        likes: 5000,
        published: "2026-10-08T12:00:00Z",
      },
    },
  };
}
function feedback(
  entry: DiscoverCandidate,
  action: DiscoverFeedback["action"],
  at = NOW,
): DiscoverFeedback {
  return {
    url: entry.item.url,
    platform: entry.item.platform,
    creator: entry.item.handle,
    genreId: entry.genreId,
    techniques: [],
    action,
    at: new Date(at).toISOString(),
  };
}
function saved(entry: DiscoverCandidate): DiscoverSavedInterest {
  return {
    url: entry.item.url,
    platform: entry.item.platform,
    creator: entry.item.handle,
    savedAt: new Date(NOW).toISOString(),
    stage: "tried",
  };
}

describe("local For You mix", () => {
  it("does not recommend the real CarX multiline draft through For You source sharing", () => {
    const valid = candidate("cars", "genuine-car-speed-ramp");
    const input = [carxDraftCandidate, valid];
    const before = JSON.stringify(input);
    const feed = discoverForYou(input, { now: Date.parse("2026-10-09T19:00:00Z") });
    expect(feed.rows.map((row) => row.item.url)).toEqual([valid.item.url]);
    expect(feed.totalQualified).toBe(1);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("shows one qualified example per available category before repeats and retains row provenance", () => {
    const input = Object.keys(captions).flatMap((genre) =>
      Array.from({ length: 4 }, (_, i) => candidate(genre, `${genre}${i}`)),
    );
    const before = JSON.stringify(input);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const feed = discoverForYou(input, { now: NOW });
      expect(feed.rows).toHaveLength(30);
      expect(feed.totalQualified).toBe(48);
      expect(new Set(feed.rows.slice(0, 12).map((row) => row.genreId)).size).toBe(12);
      expect(Object.values(feed.genreCounts)).toEqual(Array(12).fill(4));
      expect(feed.rows[0].evidence.date).toMatchObject({ basis: "source", recent: true });
      expect(feed.rows[0].evidence.engagement.observedAt).toBe(new Date(NOW).toISOString());
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(JSON.stringify(input)).toBe(before);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("ranks inside the category instead of admitting another subject from a flattened pool", () => {
    const wrong = candidate("cars", "wrong", "Anime beat sync");
    const valid = candidate("coffee", "coffee");
    const feed = discoverForYou([wrong, valid], { now: NOW });
    expect(feed.rows.map((row) => row.item.url)).toEqual([valid.item.url]);
    expect(feed.genreCounts).toEqual({ cars: 0, coffee: 1 });
  });

  it("preserves category-specific preference ranking, without crowding out other categories", () => {
    const car = candidate("cars", "car");
    const coffee = candidate("coffee", "coffee");
    const otherCoffee = candidate("coffee", "coffee2");
    const feed = discoverForYou([car, coffee, otherCoffee], {
      now: NOW,
      feedback: [feedback(coffee, "more")],
    });
    expect(feed.rows[0].item.url).toBe(coffee.item.url);
    expect(feed.rows[0].evidence.reasons).toContain("personal-interest");
    expect(feed.rows.slice(0, 2).map((row) => row.genreId)).toEqual(["coffee", "cars"]);
  });

  it("deduplicates shared posts and does not resurrect a dismissal using its other genre", () => {
    const car = candidate("cars", "shared", "Car and coffee match cut");
    const coffee = { ...car, genreId: "coffee" };
    expect(discoverForYou([car, coffee], { now: NOW }).rows).toHaveLength(1);
    expect(
      discoverForYou([car, coffee], { now: NOW, feedback: [feedback(car, "less")] }).rows,
    ).toEqual([]);
    const reversed = discoverForYou([car, coffee], {
      now: NOW + 1000,
      feedback: [feedback(car, "less"), feedback(coffee, "more", NOW + 1000)],
    });
    expect(reversed.rows).toHaveLength(1);
    expect(reversed.rows[0].genreId).toBe("coffee");
  });

  it("shares source truth before ranking so an unavailable post cannot leak through an old category copy", () => {
    const old = candidate("cars", "shared", "Car and coffee match cut");
    const gone: DiscoverCandidate = {
      ...old,
      genreId: "coffee",
      item: {
        ...old.item,
        evidence: {
          source: "instagram-public-embed",
          observedAt: new Date(NOW + 1000).toISOString(),
          availability: "unavailable",
        },
      },
    };
    for (const mode of ["inspiration", "popular", "learning", "explore"] as const)
      expect(discoverForYou([old, gone], { now: NOW + 1000, mode }).rows).toEqual([]);
  });

  it("rechecks stale indexed flags when a shared authentic caption independently proves both categories", () => {
    const car = candidate("cars", "shared", "Car and coffee match cut");
    car.item.offTopic = true;
    const coffee: DiscoverCandidate = {
      ...car,
      genreId: "coffee",
      item: { ...car.item, offTopic: undefined },
    };
    const feed = discoverForYou([car, coffee], { now: NOW });
    expect(feed.rows).toHaveLength(1);
    expect(feed.genreCounts).toEqual({ cars: 1, coffee: 1 });
  });

  it("does not transfer one category's authentic source qualification to a different category", () => {
    const car = candidate("cars", "shared", "Car and coffee match cut");
    car.item.offTopic = true;
    const coffee: DiscoverCandidate = {
      ...car,
      genreId: "coffee",
      item: {
        ...car.item,
        offTopic: undefined,
        evidence: {
          ...car.item.evidence!,
          caption: "Coffee macro closeup",
          observedAt: new Date(NOW + 1000).toISOString(),
        },
      },
    };
    const feed = discoverForYou([car, coffee], { now: NOW + 1000 });
    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0].genreId).toBe("coffee");
    expect(feed.genreCounts).toEqual({ cars: 0, coffee: 1 });
  });

  it("offers other creators before a prolific creator repeats in another genre", () => {
    const car = candidate("cars", "car");
    const sameCreator = candidate("coffee", "coffee");
    sameCreator.item.evidence!.author = car.item.evidence!.author;
    const independent = candidate("coffee", "independent");
    const rows = discoverForYou([car, sameCreator, independent], { now: NOW }).rows;
    expect(rows.slice(0, 2).map((row) => row.item.url)).toEqual([
      car.item.url,
      independent.item.url,
    ]);
  });

  it("uses saved/practice affinity without qualifying tiny-count posts or overriding dismissals", () => {
    const car = candidate("cars", "car");
    const coffee = candidate("coffee", "coffee");
    const tiny = candidate("anime", "tiny");
    tiny.item.evidence!.likes = 5;
    const feed = discoverForYou([car, coffee, tiny], {
      now: NOW,
      savedInterests: [saved(coffee), saved(tiny)],
    });
    expect(feed.rows[0].item.url).toBe(coffee.item.url);
    expect(feed.rows.some((row) => row.item.url === tiny.item.url)).toBe(false);
    const hidden = discoverForYou([car, coffee], {
      now: NOW,
      savedInterests: [saved(coffee)],
      feedback: [feedback(coffee, "hide-creator")],
    });
    expect(hidden.rows.map((row) => row.item.url)).toEqual([car.item.url]);
  });

  it("keeps Learning and Popular admission unchanged and reports shortages honestly", () => {
    const lesson = candidate("coffee", "lesson", "Coffee macro closeup tutorial");
    lesson.item.evidence!.likes = 5;
    const recent = candidate("anime", "recent");
    const old = candidate("cars", "old");
    old.item.evidence!.published = "2020-01-01T00:00:00Z";
    expect(
      discoverForYou([lesson, recent, old], { now: NOW, mode: "learning" }).rows.map(
        (row) => row.item.url,
      ),
    ).toEqual([lesson.item.url]);
    expect(
      discoverForYou([lesson, recent, old], { now: NOW, mode: "popular" }).rows.map(
        (row) => row.item.url,
      ),
    ).toEqual([recent.item.url]);
    expect(discoverForYou([], { now: NOW })).toEqual({
      rows: [],
      totalQualified: 0,
      genreCounts: {},
    });
    expect(discoverForYou([recent], { now: NOW, limit: 0 })).toMatchObject({
      rows: [],
      totalQualified: 1,
    });
  });
});
