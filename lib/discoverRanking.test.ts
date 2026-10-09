import { describe, expect, it } from "vitest";
import type { DiscoverItem } from "./discover";
import type { DiscoverFeedback, DiscoverSavedInterest } from "./discoverFeed";
import { discoverPostKey } from "./discoverFeed";
import { creatorKey, discoverEvidence, rankDiscoverItems } from "./discoverRanking";
import { CATEGORY_PROFILES } from "../workers/scout/src/discover/category-profiles";
import { carxDraftCandidate } from "../workers/scout/src/categories/carxDraft.fixture";
import { creatorProjects } from "../workers/scout/src/categories/creatorProjects.fixture";
import { discoverVisualFixture, discoverVisualObservationFixture } from "./discoverVisual.fixture";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const RECENT = "2026-10-07T12:00:00Z";
const urls = (items: DiscoverItem[]) =>
  items.map((card) => discoverPostKey(card.platform, card.url));
function item(id: string, over: Partial<DiscoverItem> = {}): DiscoverItem {
  return {
    platform: "ig",
    handle: `@${id}`,
    url: `https://www.instagram.com/reel/${id}/`,
    title: "Anime split screen beat sync edit",
    snippet: "",
    lang: "en",
    section: "example",
    published: RECENT,
    stats: { likes: 5000 },
    ...over,
  };
}
function source(id: string, over: Partial<DiscoverItem> = {}): DiscoverItem {
  const base = item(id, over);
  return {
    ...base,
    evidence: {
      source: "instagram-public-embed",
      observedAt: new Date(NOW).toISOString(),
      caption: base.title,
      likes: 5000,
      ...over.evidence,
    },
  };
}
function vote(
  card: DiscoverItem,
  action: DiscoverFeedback["action"],
  over: Partial<DiscoverFeedback> = {},
): DiscoverFeedback {
  return {
    url: card.url,
    platform: card.platform,
    creator: card.handle,
    genreId: "anime",
    techniques: ["beat sync"],
    action,
    at: new Date(NOW).toISOString(),
    ...over,
  };
}
const ranked = (
  items: DiscoverItem[],
  mode: "inspiration" | "popular" | "learning" | "explore" = "inspiration",
  feedback: DiscoverFeedback[] = [],
) => rankDiscoverItems(items, { now: NOW, genreId: "anime", mode, feedback });

describe("sampled visual craft remains separate from source popularity", () => {
  const withVisual = (card: DiscoverItem, genreId = "anime") => ({
    [discoverPostKey(card.platform, card.url)!]: {
      visual: discoverVisualFixture(card, genreId, NOW),
    },
  });
  it("recovers a source-popular plot-caption edit without inventing a named technique", () => {
    const card = source("plot", { title: "Naruto confronts his rival in this scene" });
    expect(ranked([card]).items).toEqual([]);
    const input = JSON.stringify(card);
    const result = rankDiscoverItems([card], {
      genreId: "anime",
      now: NOW,
      visual: withVisual(card),
    });
    expect(result.items).toHaveLength(1);
    expect(result.evidence[card.url]).toMatchObject({
      eligible: true,
      craft: "none",
      techniques: [],
      visualCraft: true,
      engagement: { value: 5000, basis: "source" },
    });
    expect(result.evidence[card.url].reasons).toContain("sampled-visual-craft");
    expect(result.evidence[card.url].reasons).not.toContain("named-technique");
    expect(JSON.stringify(card)).toBe(input);
  });
  it("can resolve empty prose, but cannot turn five likes or hidden counts into strong engagement", () => {
    const card = source("empty", { title: "#anime #edit" });
    expect(
      rankDiscoverItems([card], { genreId: "anime", now: NOW, visual: withVisual(card) }).items,
    ).toHaveLength(1);
    for (const likes of [5, undefined]) {
      const weak = { ...card, evidence: { ...card.evidence!, likes } };
      const result = rankDiscoverItems([weak], {
        genreId: "anime",
        now: NOW,
        visual: withVisual(weak),
      });
      expect(result.items).toEqual([]);
      expect(result.evidence[card.url].visualCraft).toBe(true);
      expect(result.evidence[card.url].engagement.strong).toBe(false);
    }
  });
  it("keeps all substantive metadata exclusions even with a positive model judgment", () => {
    for (const title of [
      "Anime full movie with typography",
      "Food processor anime video",
      "Foreground: anime hero. Background: realistic selfie photograph",
      "Anime edit, comment for my prompt pack",
      "Anime buy now discount code",
      "Anime full episode",
    ]) {
      const card = source("blocked", { title });
      for (const mode of ["inspiration", "popular", "learning", "explore"] as const)
        expect(
          rankDiscoverItems([card], { genreId: "anime", now: NOW, mode, visual: withVisual(card) })
            .items,
          title,
        ).toEqual([]);
    }
  });
  it("does not let uncertain frames or source-film imagery supply added craft, or demote existing references", () => {
    const plain = source("scene", { title: "Naruto confronts his rival in this scene" });
    const creative = source("existing");
    for (const card of [plain, creative]) {
      const record = withVisual(card);
      const value = Object.values(record)[0].visual;
      value.assessment.observations[0].origin = "source-content";
      let result = rankDiscoverItems([card], { genreId: "anime", now: NOW, visual: record });
      expect(result.items).toHaveLength(card === creative ? 1 : 0);
      value.assessment.observations[0].origin = "uploader-added";
      value.assessment.category = "uncertain";
      result = rankDiscoverItems([card], { genreId: "anime", now: NOW, visual: record });
      expect(result.items).toHaveLength(card === creative ? 1 : 0);
    }
  });
  it("preserves Popular date, freshness and native metric gates", () => {
    const card = source("popular-frames", { title: "Naruto confronts his rival in this scene" });
    const options = {
      genreId: "anime",
      now: NOW,
      mode: "popular" as const,
      visual: withVisual(card),
    };
    expect(rankDiscoverItems([card], options).items).toHaveLength(1);
    for (const changed of [
      { ...card, published: undefined },
      { ...card, published: "2025-01-01T12:00:00Z" },
      { ...card, evidence: { ...card.evidence!, likes: 500 } },
      { ...card, evidence: { ...card.evidence!, observedAt: "2026-10-01T12:00:00Z" } },
      { ...card, evidence: undefined },
    ])
      expect(rankDiscoverItems([changed], options).items).toEqual([]);
  });
  it("requires current source text, category and media, and never overrides a dismissal", () => {
    const card = source("binding", { title: "Naruto confronts his rival in this scene" });
    const visual = withVisual(card);
    const key = discoverPostKey("ig", card.url)!;
    const base = { genreId: "anime", now: NOW, visual };
    expect(
      rankDiscoverItems([{ ...card, evidence: { ...card.evidence!, likes: 7000 } }], base).items,
    ).toHaveLength(1);
    expect(
      rankDiscoverItems(
        [{ ...card, evidence: { ...card.evidence!, caption: "A different ordinary scene" } }],
        base,
      ).items,
    ).toEqual([]);
    expect(
      rankDiscoverItems(
        [{ ...card, evidence: { ...card.evidence!, availability: "unavailable" } }],
        base,
      ).items,
    ).toEqual([]);
    expect(rankDiscoverItems([card], { ...base, genreId: "cars" }).items).toEqual([]);
    expect(rankDiscoverItems([card], { ...base, now: NOW + 86_400_001 }).items).toEqual([]);
    expect(rankDiscoverItems([card], { ...base, feedback: [vote(card, "less")] }).items).toEqual(
      [],
    );
    expect(
      rankDiscoverItems([card], { ...base, feedback: [vote(card, "hide-creator")] }).items,
    ).toEqual([]);
    const changedMedia = discoverVisualObservationFixture(visual[key].visual);
    changedMedia.media.videoSha256 = "e".repeat(64);
    changedMedia.media.observedAt = new Date(NOW + 1000).toISOString();
    changedMedia.checkedAt = changedMedia.media.observedAt;
    expect(
      rankDiscoverItems([card], {
        ...base,
        now: NOW + 2000,
        visual: { [key]: { ...visual[key], visualObservation: changedMedia } },
      }).items,
    ).toEqual([]);
  });
  it("does not turn visible editor treatment into a lesson or change Learning admission", () => {
    const card = source("not-lesson", { title: "Naruto confronts his rival in this scene" });
    expect(
      rankDiscoverItems([card], {
        genreId: "anime",
        now: NOW,
        mode: "learning",
        visual: withVisual(card),
      }).items,
    ).toEqual([]);
    const unknownSubject = source("lesson-other-subject", {
      title: "Split screen tutorial: crop each panel",
    });
    expect(
      rankDiscoverItems([unknownSubject], {
        genreId: "anime",
        now: NOW,
        mode: "learning",
        visual: withVisual(unknownSubject),
      }).items,
    ).toEqual([]);
    const lesson = source("actual-lesson", {
      title: "Anime split screen tutorial: crop each panel",
    });
    const shown = rankDiscoverItems([lesson], {
      genreId: "anime",
      now: NOW,
      mode: "learning",
      visual: withVisual(lesson),
    });
    expect(shown.items).toHaveLength(1);
    expect(shown.evidence[lesson.url].visual).toBeDefined();
  });
  it("supports the twelve categories without transferring a judgment or inventing caption techniques", () => {
    for (const genreId of Object.keys(CATEGORY_PROFILES)) {
      const card = source(`visual-${genreId}`, { title: "#reel" });
      const result = rankDiscoverItems([card], {
        genreId,
        now: NOW,
        visual: withVisual(card, genreId),
      });
      expect(result.items, genreId).toHaveLength(1);
      expect(result.evidence[card.url].techniques, genreId).toEqual([]);
      expect(result.evidence[card.url].visual?.genreId).toBe(genreId);
    }
  });
});

describe("source-specific discover evidence", () => {
  it("rejects the exact source-checked CarX multiline draft despite its real 401600 views", () => {
    const now = Date.parse("2026-10-09T19:00:00Z");
    const card = carxDraftCandidate.item;
    expect(discoverEvidence(card, "cars", now)).toMatchObject({
      eligible: false,
      popular: false,
      techniques: [],
      engagement: { value: 401600, basis: "source" },
    });
    for (const mode of ["inspiration", "popular", "learning"] as const)
      expect(rankDiscoverItems([card], { genreId: "cars", mode, now }).items).toEqual([]);
    expect(card.evidence.caption).toContain("\nCUTOUT TRANSITION EDIT");
  });

  it("keeps actual YouTube counts but does not promote unfinished caption drafts as named craft", () => {
    const title = "BMW M4 COMPETITION CAR TROLL FACE EDITING SHORT 🔥☠️";
    const description = `Smooth cutout transition with clean subject masking, speed ramp and professional high-quality editing." Or, if it's specifically for a car edit: KEYWORD BMW EDITS BMW CLIPS FOR EDITS`;
    const card = item("template", {
      platform: "yt",
      url: "https://www.youtube.com/watch?v=BxC-ShauMWQ",
      title,
      evidence: {
        source: "youtube-api",
        observedAt: new Date(NOW).toISOString(),
        published: RECENT,
        views: 2_500_000,
        caption: `${title} ${description}`,
      },
    });
    expect(discoverEvidence(card, "cars", NOW)).toMatchObject({
      eligible: false,
      popular: false,
      techniques: [],
      engagement: { value: 2_500_000, basis: "source" },
    });
    for (const mode of ["inspiration", "popular"] as const)
      expect(rankDiscoverItems([card], { genreId: "cars", mode, now: NOW }).items).toEqual([]);

    const creativeTitle = "BMW cinematic car film";
    const creative = {
      ...card,
      title: creativeTitle,
      evidence: { ...card.evidence!, caption: `${creativeTitle} ${description}` },
    };
    expect(discoverEvidence(creative, "cars", NOW)).toMatchObject({
      eligible: true,
      project: true,
      techniques: [],
      popular: true,
    });
    expect(
      rankDiscoverItems([creative], { genreId: "cars", mode: "popular", now: NOW }).items,
    ).toHaveLength(1);
  });

  it("cannot promote a five-like authentic post using inflated indexed statistics", () => {
    const small = source("small", {
      stats: { likes: 9999999, views: 99999999 },
      evidence: {
        source: "instagram-public-embed",
        observedAt: new Date(NOW).toISOString(),
        caption: "Anime beat sync edit",
        likes: 5,
      },
    });
    expect(discoverEvidence(small, "anime", NOW)).toMatchObject({
      engagement: { metric: "likes", value: 5, basis: "source", strong: false },
      popular: false,
    });
    expect(ranked([small]).items).toEqual([]);
    expect(ranked([small], "popular").items).toEqual([]);
    expect(ranked([small], "explore").items).toHaveLength(1);
  });
  it("keeps missing direct counts unknown instead of borrowing indexed engagement", () => {
    const unknown = source("unknown");
    delete unknown.evidence!.likes;
    expect(discoverEvidence(unknown, "anime", NOW).engagement).toMatchObject({
      basis: "unknown",
      strong: false,
    });
    expect(ranked([unknown]).items).toEqual([]);
  });
  it("does not relabel an authentic non-edit caption using a contaminated indexed snippet", () => {
    const contaminated = source("DaX6-f9ox7D", {
      title: "Anime clone effect tutorial cinematic beat sync",
      snippet: "50M views",
      evidence: {
        source: "instagram-public-embed",
        observedAt: new Date(NOW).toISOString(),
        caption: "My anime drawing today",
        likes: 300000,
      },
    });
    expect(discoverEvidence(contaminated, "anime", NOW)).toMatchObject({
      craft: "none",
      teaching: false,
      popular: false,
    });
    expect(ranked([contaminated]).items).toEqual([]);
  });
  it("reports source observation and publication basis separately", () => {
    const proof = discoverEvidence(source("date"), "anime", NOW);
    expect(proof.date).toMatchObject({ basis: "reported", recent: true, ageDays: 2 });
    expect(proof.engagement).toMatchObject({
      basis: "source",
      fresh: true,
      metric: "likes",
      value: 5000,
    });
    const dated = source("dated");
    dated.evidence!.published = RECENT;
    expect(discoverEvidence(dated, "anime", NOW).date.basis).toBe("source");
  });
  it("screens recent popularity with direct current metrics, known recent dates and specific craft", () => {
    const fresh = source("fresh");
    const old = source("old", { published: "2024-01-01T00:00:00Z" });
    const stale = source("stale");
    stale.evidence!.observedAt = "2026-10-01T00:00:00Z";
    const unknownDate = source("undated", { published: undefined });
    const future = source("future", { published: "2027-01-01T00:00:00Z" });
    const futureCount = source("futurecount");
    futureCount.evidence!.observedAt = "2027-01-01T00:00:00Z";
    const generic = source("amv", { title: "Naruto never gives up #animeedit" });
    const outside = source("outside", { title: "Car speed ramp", outsideCategory: true });
    const offTopic = source("offtopic", { title: "Anime full episode", offTopic: true });
    const indexed = item("index");
    const result = ranked(
      [old, stale, unknownDate, future, futureCount, generic, outside, offTopic, indexed, fresh],
      "popular",
    );
    expect(urls(result.items)).toEqual(urls([fresh]));
    expect(result.evidence[old.url].reasons).toContain("old-post");
    expect(result.evidence[stale.url].reasons).toContain("stale-engagement");
    expect(result.evidence[indexed.url].engagement.basis).toBe("indexed");
  });
  it("retains reported YouTube statistics but requires source engagement for Instagram and TikTok Inspiration", () => {
    const reported = item("reported", {
      platform: "yt",
      url: "https://www.youtube.com/watch?v=reported",
      stats: { views: 50000 },
    });
    expect(ranked([reported]).items).toHaveLength(1);
    expect(ranked([reported]).evidence[reported.url]).toMatchObject({
      sourceTier: "indexed",
      engagement: { basis: "indexed", strong: true },
      popular: false,
    });
    expect(ranked([reported]).evidence[reported.url].reasons).toContain("indexed-only");
    const instagram = item("instagram");
    const tiktok = item("tiktok", {
      platform: "tt",
      url: "https://www.tiktok.com/@editor/video/7670030287509671189",
      stats: { views: 900000 },
    });
    expect(ranked([instagram, tiktok]).items).toEqual([]);
    expect(ranked([instagram, tiktok], "explore").items).toHaveLength(2);
    expect(ranked([instagram], "inspiration", [vote(instagram, "more")]).items).toHaveLength(1);
    expect(ranked([instagram], "popular", [vote(instagram, "more")]).items).toEqual([]);
  });
  it("does not treat likes as manufactured views or collapse unlike metrics into one value", () => {
    const liked = source("liked");
    expect(discoverEvidence(liked, "anime", NOW).engagement).toMatchObject({
      metric: "likes",
      value: 5000,
    });
    expect(liked.stats?.views).toBeUndefined();
    const yt = item("yt", {
      platform: "yt",
      url: "https://www.youtube.com/watch?v=example",
      stats: { views: 6000, likes: 10 },
    });
    expect(discoverEvidence(yt, "anime", NOW).engagement).toMatchObject({
      metric: "views",
      value: 6000,
      strong: true,
    });
  });
  it("lets authentic category/project evidence correct stale indexed relevance labels", () => {
    const original = item("rescued", {
      title: "Unrelated indexed caption",
      offTopic: true,
      outsideCategory: true,
    });
    const actual = source("rescued", {
      ...original,
      evidence: {
        source: "instagram-public-embed",
        observedAt: new Date(NOW).toISOString(),
        caption: "Yuta edit reworked #animeedit",
        likes: 47100,
      },
    });
    expect(ranked([original]).items).toEqual([]);
    expect(ranked([actual]).items).toHaveLength(1);
    expect(ranked([actual], "popular").items).toHaveLength(1);
    expect(discoverEvidence(actual, "anime", NOW).reasons).not.toContain("off-topic");
    expect(discoverEvidence(actual, "anime", NOW).reasons).not.toContain("outside-category");
    actual.evidence!.likes = 5;
    expect(ranked([actual]).items).toEqual([]);
    expect(ranked([actual], "inspiration", [vote(actual, "more")]).items).toHaveLength(1);
    expect(ranked([actual], "popular", [vote(actual, "more")]).items).toEqual([]);
  });
  it.each([
    "",
    "My new post",
    "Car speed ramp",
    "Anime full episode",
    "Anime beat sync: comment ANIME for the AI prompt",
  ])(
    "does not erase indexed exclusions for an unknown or actually unsuitable source caption: %s",
    (caption) => {
      const actual = source("bad", { offTopic: true, outsideCategory: true });
      actual.evidence!.caption = caption;
      for (const mode of ["inspiration", "popular", "learning", "explore"] as const)
        expect(ranked([actual], mode, [vote(actual, "more")]).items, mode).toEqual([]);
    },
  );
  it("keeps indexed topic exclusions without a selected known category", () => {
    const actual = source("unscoped", { offTopic: true });
    expect(rankDiscoverItems([actual], { now: NOW }).items).toEqual([]);
    expect(rankDiscoverItems([actual], { now: NOW, genreId: "custom" }).items).toEqual([]);
  });
});

describe("quality and learning modes", () => {
  it("admits a source-supported finished edit without inventing a technique from plot hashtags", () => {
    const yuta = source("yuta", { title: "Yuta edit reworked #animeedit" });
    yuta.evidence!.likes = 47100;
    const plot = source("naruto", { title: "Naruto never gives up #animeedit" });
    plot.evidence!.likes = 143000;
    const specific = source("specific", { title: "Anime split screen beat sync edit" });
    expect(discoverEvidence(yuta, "anime", NOW)).toMatchObject({
      craft: "generic",
      project: true,
      techniques: [],
      teaching: false,
    });
    expect(discoverEvidence(plot, "anime", NOW).project).toBe(false);
    expect(urls(ranked([plot, yuta, specific]).items)).toEqual(urls([specific, yuta]));
    expect(urls(ranked([plot, yuta], "popular").items)).toEqual(urls([yuta]));
    expect(ranked([plot], "explore").items).toHaveLength(1);
  });
  it.each([
    ["camping", "Cinematic camping film"],
    ["football", "Football montage"],
  ])(
    "keeps %s creative projects with actual strong counts without requiring named techniques",
    (genreId, title) => {
      const reference = source("reference", { title, published: "2021-01-01T00:00:00Z" });
      const proof = discoverEvidence(reference, genreId, NOW);
      expect(proof).toMatchObject({ project: true, craft: "generic", techniques: [] });
      expect(rankDiscoverItems([reference], { genreId, now: NOW }).items).toHaveLength(1);
      expect(rankDiscoverItems([reference], { genreId, now: NOW, mode: "popular" }).items).toEqual(
        [],
      );
      reference.evidence!.likes = 5;
      expect(rankDiscoverItems([reference], { genreId, now: NOW }).items).toEqual([]);
    },
  );
  it("passes a frozen synthetic 12-genre screening evaluation, without claiming live visual quality", () => {
    const cases = {
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
    const scores: {
      genre: string;
      precisionAt6: number;
      independentCreatorsAt6: number;
      tinyPromoted: number;
      oldPromoted: number;
    }[] = [];
    for (const [genre, title] of Object.entries(cases)) {
      const useful = Array.from({ length: 6 }, (_, i) => source(`${genre}good${i}`, { title }));
      const tiny = source(`${genre}tiny`, { title, stats: { likes: 9000000 } });
      tiny.evidence!.likes = 5;
      const old = source(`${genre}old`, { title, published: "2020-01-01T00:00:00Z" });
      const generic = source(`${genre}generic`, {
        title: `${CATEGORY_PROFILES[genre].subject.en} #edit #cinematic`,
      });
      const wrong = source(`${genre}wrong`, {
        title: genre === "cars" ? "Anime beat sync" : "Car speed ramp",
      });
      const input = [tiny, generic, old, wrong, ...useful];
      const result = rankDiscoverItems(input, { genreId: genre, now: NOW });
      const top = result.items.slice(0, 6);
      scores.push({
        genre,
        precisionAt6: top.filter((post) => urls(useful).includes(post.url)).length / 6,
        independentCreatorsAt6: new Set(top.map(creatorKey)).size,
        tinyPromoted: top.filter((post) => post.url === discoverPostKey(tiny.platform, tiny.url))
          .length,
        oldPromoted: top.filter((post) => post.url === discoverPostKey(old.platform, old.url))
          .length,
      });
      expect(
        rankDiscoverItems(input, { genreId: genre, now: NOW, mode: "popular" }).items,
        genre,
      ).toHaveLength(6);
    }
    expect(scores).toHaveLength(12);
    for (const score of scores)
      expect(score, score.genre).toMatchObject({
        precisionAt6: 1,
        independentCreatorsAt6: 6,
        tinyPromoted: 0,
        oldPromoted: 0,
      });
  });
  it("keeps hashtag-only craft and unknown or tiny engagement in Explore, not default Inspiration", () => {
    const generic = item("generic", { title: "Anime #amv #edit", stats: { likes: 900000 } });
    const unknown = item("unknown", { stats: undefined });
    const small = item("small", { stats: { likes: 5 } });
    expect(ranked([generic, unknown, small]).items).toEqual([]);
    expect(ranked([generic, unknown, small], "explore").items).toHaveLength(3);
    expect(discoverEvidence(generic, "anime", NOW)).toMatchObject({
      techniques: [],
      craft: "generic",
    });
  });
  it("keeps evergreen teaching in Learn and timeless craft examples in Inspiration, never recent Popular", () => {
    const old = item("old", {
      published: "2021-01-01T00:00:00Z",
      title: "Anime rotoscoping tutorial",
      section: "example",
    });
    expect(ranked([old]).items).toEqual([]);
    expect(ranked([old], "learning").items[0].section).toBe("tutorial");
    const example = source("timeless", {
      published: "2021-01-01T00:00:00Z",
      title: "Anime beat sync edit",
      stats: { likes: 186500 },
    });
    expect(ranked([example]).items).toHaveLength(1);
    expect(ranked([example], "popular").items).toHaveLength(0);
    const recent = source("fresh", { title: example.title, stats: example.stats });
    expect(urls(ranked([example, recent]).items)).toEqual(urls([recent, example]));
  });
  it("places the observed tagged CapCut timeline tutorial in Learn rather than Inspiration or Popular", () => {
    const lesson = item("zayn", {
      platform: "tt",
      url: "https://www.tiktok.com/@zaynccedit/video/7670030287509671189",
      evidence: {
        source: "tiktok-public-page",
        observedAt: new Date(NOW).toISOString(),
        caption:
          "Four Corner Beat Sync effect #CapCut #capcutpioneer #animeedit #demonslayer #tutorial",
        published: RECENT,
        likes: 25000,
        views: 582200,
      },
    });
    expect(ranked([lesson]).items).toHaveLength(0);
    expect(ranked([lesson], "popular").items).toHaveLength(0);
    expect(ranked([lesson], "learning").items).toHaveLength(1);
  });
  it("moves the observed car filming-process title and explanatory shot lesson into Learn", () => {
    const carProcess = item("carprocess", {
      platform: "yt",
      url: "https://www.youtube.com/watch?v=NgFiMUG2fkQ",
      title: "How I Film Cinematic Car Videos (Rollers + B-Roll)",
      snippet: "Join the #1 Automotive Filmmakers Community",
      stats: { views: 17300 },
    });
    const shotLesson = source("DTxIse6jZci", {
      evidence: {
        source: "instagram-public-embed",
        observedAt: new Date(NOW).toISOString(),
        likes: 22400,
        caption:
          "A Simple list to make your videos feel more cinematic. –Wide shot This sets the scene. –Low angle. –Close-up. –High angle. –Profile shot.",
      },
    });
    for (const [post, genreId] of [
      [carProcess, "cars"],
      [shotLesson, undefined],
    ] as const) {
      expect(rankDiscoverItems([post], { genreId, now: NOW }).items).toHaveLength(0);
      expect(rankDiscoverItems([post], { genreId, now: NOW, mode: "learning" }).items).toHaveLength(
        1,
      );
    }
  });
  it.each([
    "Anime masking tutorial coming tomorrow",
    "Anime beat sync edit. Comment TUTORIAL for the guide",
    "Anime split screen edit. Want a tutorial?",
    "Anime AMV edit #tutorial",
  ])("does not file a promise or request as a lesson: %s", (title) => {
    const card = item("notlesson", { title, section: "tutorial" });
    expect(ranked([card], "learning").items).toEqual([]);
    expect(ranked([card], "explore").items[0].section).toBe("example");
    expect(card.section).toBe("tutorial");
  });
  it("does not mistake a coffee room's ambient lighting for a filmmaking technique", () => {
    const coffee = item("room", {
      title: "Cozy coffee room lighting ideas",
      stats: { views: 9000000 },
    });
    const proof = discoverEvidence(coffee, "coffee", NOW);
    expect(proof).toMatchObject({ craft: "none", techniques: [], eligible: false });
    expect(rankDiscoverItems([coffee], { genreId: "coffee", now: NOW }).items).toEqual([]);
    expect(
      discoverEvidence(
        item("shoot", { title: "Coffee photography rim light tutorial" }),
        "coffee",
        NOW,
      ).techniques,
    ).toContain("lighting");
  });
  it.each(creatorProjects)(
    "keeps the source-popular $title project in Inspiration instead of Learn",
    (project) => {
      const card = item(project.id, {
        platform: "yt",
        url: `https://www.youtube.com/watch?v=${project.id}`,
        title: project.title,
        snippet: project.description,
        handle: project.author,
        evidence: {
          source: "youtube-api",
          observedAt: new Date(NOW).toISOString(),
          caption: `${project.title} ${project.description}`,
          views: project.views,
          published: project.published,
        },
      });
      expect(discoverEvidence(card, "anime", NOW)).toMatchObject({
        eligible: true,
        teaching: false,
        project: true,
      });
      expect(ranked([card], "learning").items).toEqual([]);
      expect(ranked([card], "inspiration").items).toHaveLength(1);
      expect(ranked([card], "popular").items).toHaveLength(
        ["ZRD2hb_Qz8w", "bxtmvGt-ujk"].includes(project.id) ? 1 : 0,
      );
    },
  );
  it("excludes the source-popular two-hour cafe background-music upload despite its B-roll title", () => {
    const title =
      "CAFÉ in 4K | 2 Hours | Real Cafe B-Roll Footage Relaxing Jazz Music Coffee Shop Vibes Ambience LoFi";
    const snippet =
      "Enjoy beautiful footage of cafes, baristas, and latte art with relaxing coffee shop ambient sounds and jazz music. Play in the background as you work, study, meditate, exercise, work out, sleep, rest, focus, de-stress, or relax.";
    const card = item("Amh5NZMkf3I", {
      platform: "yt",
      url: "https://www.youtube.com/watch?v=Amh5NZMkf3I",
      handle: "REST EASY FILMS",
      title,
      snippet,
      evidence: {
        source: "youtube-api",
        observedAt: new Date(NOW).toISOString(),
        caption: `${title} ${snippet}`,
        views: 206500,
        published: "2022-10-18T12:00:00Z",
      },
    });
    const proof = discoverEvidence(card, "coffee", NOW);
    expect(proof.engagement).toMatchObject({ basis: "source", strong: true, value: 206500 });
    expect(proof).toMatchObject({ eligible: false, craft: "none", techniques: [] });
    for (const mode of ["inspiration", "popular", "learning", "explore"] as const)
      expect(rankDiscoverItems([card], { genreId: "coffee", now: NOW, mode }).items).toEqual([]);
  });
  it("keeps actual Arabic named craft and learning in every category without promoting generic subjects", () => {
    const cues = {
      cars: "سيارة روتوسكوب",
      food: "أكل تحريك القصاصات",
      anime: "أنمي تقسيم الشاشة",
      travel: "سفر ويب بان",
      football: "كورة فريز فريم",
      coffee: "قهوة تصوير ماكرو",
      perfume: "عطر تصوير انعكاسات",
      camping: "كشتة لقطة درون",
      fashion: "أزياء موشن جرافيك",
      gaming: "قيمنق تتبع الحركة",
      weddings: "زواج تصميم صوت",
      gym: "جيم لايت سويب",
    };
    expect(Object.keys(cues).sort()).toEqual(Object.keys(CATEGORY_PROFILES).sort());
    for (const [genreId, title] of Object.entries(cues)) {
      const card = item(genreId, { title: `شرح ${title}` });
      const result = rankDiscoverItems([card], { genreId, now: NOW, mode: "learning" });
      expect(result.items, genreId).toHaveLength(1);
      expect(result.evidence[card.url].craft, genreId).toBe("specific");
    }
  });
});

describe("personal ranking, diversity and duplicates", () => {
  it("uses saved practice as a bounded preference without admission or popularity exceptions", () => {
    const good = source("practiced", { title: "Anime rotoscoping edit" });
    const other = source("other", { title: "Anime rotoscoping edit" });
    const tiny = source("tiny");
    tiny.evidence!.likes = 5;
    const interests: DiscoverSavedInterest[] = [good, tiny].map((card) => ({
      url: card.url,
      platform: card.platform,
      creator: card.handle,
      stage: "tried",
      savedAt: RECENT,
    }));
    const rank = (feedback: DiscoverFeedback[] = []) =>
      rankDiscoverItems([other, tiny, good], {
        now: NOW,
        genreId: "anime",
        savedInterests: interests,
        feedback,
      });
    expect(urls(rank().items)).toEqual(urls([good, other]));
    expect(rank().evidence[good.url].reasons).toContain("personal-interest");
    expect(rank().evidence[tiny.url].popular).toBe(false);
    expect(urls(rank([vote(good, "less")]).items)).toEqual(urls([other]));
    const absent = {
      ...interests[0],
      url: "https://www.instagram.com/p/absent/",
      creator: other.handle,
    };
    const baseline = rankDiscoverItems([other], { now: NOW, genreId: "anime" });
    const ungrounded = rankDiscoverItems([other], {
      now: NOW,
      genreId: "anime",
      savedInterests: [absent],
    });
    expect(ungrounded.evidence[other.url].score).toBe(baseline.evidence[other.url].score);
  });
  it("gives independent creators their first place before repetitions without padding", () => {
    const repeats = Array.from({ length: 6 }, (_, i) => source(`repeat${i}`, { handle: "@same" }));
    const diverse = Array.from({ length: 5 }, (_, i) => source(`other${i}`));
    const result = ranked([...repeats, ...diverse]).items;
    expect(new Set(result.slice(0, 6).map(creatorKey)).size).toBe(6);
    expect(result).toHaveLength(11);
    expect(ranked([]).items).toEqual([]);
  });
  it("does not merge unknown creators or same-named creators on different platforms", () => {
    expect(creatorKey(item("one", { handle: "unknown" }))).not.toBe(
      creatorKey(item("two", { handle: "unknown" })),
    );
    expect(creatorKey(item("one", { handle: "@ONE" }))).toBe("ig:one");
    expect(
      creatorKey(
        item("one", {
          platform: "yt",
          profile: "https://www.youtube.com/channel/UCabc",
          evidence: {
            source: "youtube-api",
            observedAt: new Date(NOW).toISOString(),
            author: "One",
          },
        }),
      ),
    ).toBe("yt:channel:UCabc");
  });
  it("canonicalizes duplicate reels and prefers direct evidence even when it reduces eligibility", () => {
    const indexed = item("same", { url: "https://www.instagram.com/p/same/?utm_source=search" });
    const observed = source("same");
    observed.evidence!.likes = 5;
    const result = ranked([indexed, observed, indexed], "explore");
    expect(result.items).toHaveLength(1);
    expect(result.evidence[indexed.url].engagement.value).toBe(5);
    expect(result.excluded).toBe(2);
    expect(ranked([indexed, observed]).items).toEqual([]);
  });
  it("an exact positive vote can keep a captionless visual reference without claiming popularity", () => {
    const reference = source("DdP6LgrT_aD", {
      title: "Untitled",
      evidence: {
        source: "instagram-public-embed",
        observedAt: new Date(NOW).toISOString(),
        caption: "",
        likes: 5,
      },
    });
    const result = ranked([reference], "inspiration", [vote(reference, "more")]);
    expect(result.items).toHaveLength(1);
    expect(result.evidence[reference.url]).toMatchObject({ craft: "none", popular: false });
    expect(result.evidence[reference.url].reasons).toContain("personal-interest");
    expect(ranked([reference], "popular", [vote(reference, "more")]).items).toEqual([]);
    expect(
      ranked([reference], "inspiration", [vote(reference, "more", { genreId: "cars" })]).items,
    ).toEqual([]);
  });
  it("personal interest cannot promote a known off-topic post or promotional bait", () => {
    const outside = item("car", { title: "Car speed ramp", outsideCategory: true });
    const bait = item("bait", { title: "Anime beat sync - comment ANIME for the AI prompt" });
    expect(
      ranked([outside, bait], "inspiration", [vote(outside, "more"), vote(bait, "more")]).items,
    ).toEqual([]);
  });
  it("dismisses an exact item, hides a creator across genres, and does not leak genre-specific votes", () => {
    const a = item("a", { handle: "@same" });
    const b = item("b", { handle: "@same" });
    const c = item("c");
    expect(urls(ranked([a, b, c], "explore", [vote(a, "less")]).items)).toEqual(urls([b, c]));
    expect(
      urls(ranked([a, b, c], "explore", [vote(a, "hide-creator", { genreId: "cars" })]).items),
    ).toEqual(urls([c]));
    expect(ranked([a], "explore", [vote(a, "less", { genreId: "cars" })]).items).toHaveLength(1);
  });
  it("related preferences reorder eligible items but cannot qualify a low-count item", () => {
    const liked = item("liked", { handle: "@fav" });
    const low = source("low", { handle: "@fav", stats: { likes: 5 } });
    low.evidence!.likes = 5;
    const favored = source("favored", { handle: "@fav" });
    const other = source("other", { title: "Anime rotoscoping edit" });
    const result = ranked([other, low, favored], "inspiration", [vote(liked, "more")]);
    expect(urls(result.items)).toEqual(urls([favored, other]));
  });
  it("excludes a source-confirmed unavailable video from every mode, even with positive affinity", () => {
    const unavailable = item("gone", {
      platform: "tt",
      url: "https://www.tiktok.com/@xutakoi/video/7682973506094533919",
      evidence: {
        source: "tiktok-public-page",
        observedAt: new Date(NOW).toISOString(),
        caption: "Anime beat sync tutorial",
        views: 1000000,
        published: RECENT,
        availability: "unavailable",
      },
    });
    for (const mode of ["inspiration", "popular", "learning", "explore"] as const)
      expect(ranked([unavailable], mode, [vote(unavailable, "more")]).items, mode).toEqual([]);
    expect(discoverEvidence(unavailable, "anime", NOW).reasons).toContain("source-unavailable");
  });
  it("accepts exact public TikTok metadata with real views, date and caption as source evidence", () => {
    const publicPost = item("public", {
      platform: "tt",
      url: "https://www.tiktok.com/@editor/video/7682973506094533919",
      evidence: {
        source: "tiktok-public-page",
        observedAt: new Date(NOW).toISOString(),
        caption: "Anime beat sync edit",
        views: 1000000,
        published: RECENT,
        availability: "available",
      },
    });
    expect(discoverEvidence(publicPost, "anime", NOW)).toMatchObject({
      sourceTier: "direct",
      popular: true,
      engagement: { metric: "views", value: 1000000, basis: "source" },
      date: { basis: "source" },
    });
  });
});
