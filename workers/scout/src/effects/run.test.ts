import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usageKeys } from "../discover/usage";
import { TAVILY_URL } from "../trends/tavily";
import { FAMILY_QUERIES, familiesForDay } from "./families";
import { EFFECTS_KEY } from "./kv";
import { runEffects } from "./run";
import { HISTORY_KEYS, type EffectsDoc } from "./types";

const NOW = new Date("2026-10-07T05:35:00Z");
const NEXT_DAY = new Date("2026-10-08T05:35:00Z");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const youtubeCap = () => json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403);

type Hit = { url: string; title: string; content: string };
const tt = (handle: string, title: string, n: number): Hit => ({
  url: `https://www.tiktok.com/@${handle}/video/${n}`,
  title,
  content: "#capcut #edit",
});
const ig = (handle: string, title: string, n: number): Hit => ({
  url: `https://www.instagram.com/${handle}/reel/R${n}/`,
  title,
  content: "#capcut #edit",
});

/** The live probe's titles (planning/tools/18-trending-effects.md): 8 creators post clone edits (3 of them the Swagger
 * Trend), 1 the CapCut Reverse Trend, and 3 post generic "CapCut trend" captions. */
const PROBE: Hit[] = [
  tt("c1", "Clone Yourself in CapCut 🔥 #cloneyourself", 1),
  tt("c2", "CapCut clone effect tutorial: how to clone yourself in a video", 2),
  tt("c3", "clone effect tutorial | CapCut", 3),
  tt("c4", "Clone Yourself in CapCut 🔥 #cloneyourself", 4),
  tt("c5", "clone effect tutorial | CapCut", 5),
  ig("c6", "Chanel Confidence: Clone Yourself with One Hair (Swagger Trend)", 6),
  ig("c7", "Chanel Confidence: Clone Yourself with One Hair (Swagger Trend)", 7),
  ig("c8", "Chanel Confidence: Clone Yourself with One Hair (Swagger Trend)", 8),
  tt("r1", "How to Edit the New CapCut Reverse Trend | Easy Tutorial", 9),
  tt("g1", "CapCut edit trend: easy viral-style video edits", 10),
  tt("g2", "CapCut edit trend: easy viral-style video edits", 11),
  tt("g3", "Hopping on the Latest CapCut Trend 🙈 #viraltrend #capcuttrend", 12),
];

/**
 * A fake internet: every Tavily family search answers `hits`; YouTube finds 2 videos per effect, 1,000 views each.
 * `tavily`, `youtubeSearch` (given the call's number) and `stats` may answer instead.
 */
function web(
  over: {
    hits?: Hit[];
    tavily?: (query: string) => Response | undefined;
    youtubeSearch?: (n: number) => Response | undefined;
    stats?: () => Response;
  } = {},
) {
  const count = { tavily: 0, search: 0, stats: 0 };
  const queries: string[] = [];
  const searched: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.href === TAVILY_URL) {
      count.tavily++;
      const { query } = JSON.parse(String(init?.body)) as { query: string };
      searched.push(query);
      return over.tavily?.(query) ?? json({ results: over.hits ?? PROBE, usage: { credits: 1 } });
    }
    if (url.pathname.endsWith("/youtube/v3/search")) {
      count.search++;
      const q = url.searchParams.get("q") ?? "";
      queries.push(q);
      return (
        over.youtubeSearch?.(count.search) ??
        json({
          items: [1, 2].map((n) => ({ id: { videoId: `${q}-${n}` }, snippet: { title: q } })),
        })
      );
    }
    if (url.pathname.endsWith("/youtube/v3/videos")) {
      count.stats++;
      if (over.stats) return over.stats();
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return json({ items: ids.map((id) => ({ id, statistics: { viewCount: "1000" } })) });
    }
    return json({ error: "not_found" }, 404);
  });
  return { fetch, count, queries, searched };
}

/** Answers the day's hits to the first family's searches only (as one family finds a trend); the rest find nothing. */
function firstSearchOnly() {
  let first: string | undefined;
  return (query: string) => ((first ??= query) === query ? undefined : json({ results: [] }));
}
const docBytes = (doc: EffectsDoc) => new TextEncoder().encode(JSON.stringify(doc)).length;
/** The family queries a run searched, in order (each is asked 3 times). */
const familiesOf = (searched: string[]) => [...new Set(searched)];

type Verdict = Record<string, unknown>;
const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
/** A fake built-in AI: keeps every candidate it is shown under a Title-Case English name, unless `judge` says
 * otherwise. */
function ai(judge: (key: string) => Verdict = () => ({})) {
  return {
    run: vi.fn(async (_model: string, input: Record<string, unknown>): Promise<unknown> => {
      const effects = [...userText(input).matchAll(/^- key: (\S+) \| name: (.+?) \| posts:/gm)].map(
        ([, key, name]) => ({
          key,
          keep: true,
          name: { en: titleCase(name).slice(0, 40), ar: "اسم التأثير" },
          what: { en: `What ${name} looks like`.slice(0, 90), ar: "وصف قصير للتأثير" },
          ...judge(key),
        }),
      );
      return { response: { effects } };
    }),
  };
}
const userText = (input: Record<string, unknown>) =>
  (input.messages as { content: string }[])[1].content;

function kv(stored?: EffectsDoc) {
  const store = new Map<string, string>();
  if (stored) store.set(EFFECTS_KEY, JSON.stringify(stored));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
}

function setup(over: { stored?: EffectsDoc; judge?: (key: string) => Verdict } = {}) {
  const KV = kv(over.stored);
  const AI = ai(over.judge);
  const env = {
    TAVILY_API_KEY: "t",
    YOUTUBE_API_KEY: "y",
    AI,
    SOCIAL_KV: KV as unknown as KVNamespace,
  };
  return { env, KV, AI };
}
const stored = (KV: ReturnType<typeof kv>) => JSON.parse(KV.store.get(EFFECTS_KEY)!) as EffectsDoc;
/** The keys the runs wrote, in order: a spending run counts itself first, then saves the document. */
const writes = (KV: ReturnType<typeof kv>) => KV.put.mock.calls.map(([key]) => key);
/** NOW's attempt counter. */
const ATTEMPTS = "effects:attempts:2026-10-07";

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("runEffects", () => {
  it("first run from the probe titles: the clone effect leads, within the day's budget", async () => {
    const { env, KV, AI } = setup();
    const { fetch, count } = web();
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(doc.items[0]).toMatchObject({
      termId: "clone-effect",
      // The dictionary's own labels, never the AI's "Clone Effect" / "اسم التأثير"; its line is the AI's.
      name: { en: "clone effect", ar: "تأثير الاستنساخ" },
      what: { en: "What clone effect looks like", ar: "وصف قصير للتأثير" },
      creators: 8,
      isNew: false,
      growth: 3,
      checked: true,
      platforms: ["ig", "tt"],
      youtube: { newVideos: 2, views7d: 2000 },
    });
    expect(doc.items[1]).toMatchObject({
      name: { en: "Swagger Trend", ar: "اسم التأثير" }, // a new name takes the AI's English name
      creators: 3,
      isNew: true,
      checked: true,
    });
    expect(doc.meta["reverse-trend"]).toBeDefined(); // remembered, but 1 creator is below the bar
    expect(doc).toMatchObject({ ranOn: "2026-10-07", updatedAt: NOW.toISOString(), status: "ok" });
    expect(doc.notes).toBeUndefined();

    // 3 Tavily searches a family (Instagram over a week and a month, TikTok over a month).
    expect(count).toEqual({ tavily: 18, search: 2, stats: 1 });
    expect(AI.run).toHaveBeenCalledTimes(1);
    expect(writes(KV)).toEqual([ATTEMPTS, EFFECTS_KEY]);
    expect(stored(KV)).toEqual(doc);

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({
      effects: {
        status: "ok",
        items: 2,
        credits: 18,
        // Each family's post pages per search (the same PROBE every time), and its posts once each.
        families: [1, 2, 3, 4, 5, 6].map((family) => ({
          family,
          tt: 9,
          igWeek: 3,
          igMonth: 3,
          posts: 12,
        })),
        keys: 3,
        protected: 3,
        trimmed: 0,
        // The AI's counts: 3 names judged, 1 of them the dictionary's, 2 new names approved, none rejected.
        ai: { judged: 3, dictionary: 1, approved: 2, dropped: 0, merged: 0, rejects: {} },
        // The dictionary effects seen today, by our own ids, with today's creators.
        dictionary: { "clone-effect": 8 },
      },
    });
    // No handles, titles or links.
    expect(line).not.toMatch(/\b(c[1-8]|r1|g[1-3])\b|Swagger|CapCut|https?:/i);
    for (const hit of PROBE) expect(line).not.toContain(hit.title);
    // The same counts are kept with the list (Workers Logs dropped the line on live runs).
    expect(stored(KV).diagnostics).toEqual(JSON.parse(line).effects);
  });

  it("with Tavily's month 90 % spent (Discover's cached figure), only the Instagram month search a family, noted", async () => {
    const { env, KV } = setup();
    KV.store.set(usageKeys.tavily, JSON.stringify({ used: 950, limit: 1000 }));
    const { fetch, count } = web();
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(count.tavily).toBe(6);
    expect(doc).toMatchObject({ status: "partial", notes: ["tavily_budget"] });
    // Instagram's 3 swagger-trend creators, who clone themselves: both still show.
    expect(doc.items.map((i) => [i.key, i.creators])).toEqual([
      ["clone-effect", 3],
      ["swagger-trend", 3],
    ]);
    const { effects } = JSON.parse(String(log.mock.calls[0][0]));
    expect(effects).toMatchObject({ credits: 6, notes: ["tavily_budget"] });
    expect(effects.families).toEqual(
      [1, 2, 3, 4, 5, 6].map((family) => ({ family, tt: 0, igWeek: 0, igMonth: 3, posts: 3 })),
    );
  });

  it("runs once a day; force runs again and adds to the day's creators (the same ones count once)", async () => {
    const { env, KV } = setup();
    const { fetch, count } = web();
    const first = await runEffects(env, { fetch, now: NOW });
    const calls = fetch.mock.calls.length;

    const later = new Date("2026-10-07T20:00:00Z");
    expect(await runEffects(env, { fetch, now: later })).toEqual(first);
    expect(fetch.mock.calls.length).toBe(calls);
    expect(writes(KV)).toEqual([ATTEMPTS, EFFECTS_KEY]);

    // A forced run is not counted against the day's cap.
    const forced = await runEffects(env, { fetch, now: later, force: true });
    expect(count).toEqual({ tavily: 36, search: 4, stats: 2 });
    expect(writes(KV)).toEqual([ATTEMPTS, EFFECTS_KEY, EFFECTS_KEY]);
    expect(forced.items[0]).toMatchObject({ key: "clone-effect", creators: 8 });
    expect(forced.history["clone-effect"]).toHaveLength(1);
  });

  it("Scan again the same day searches the next 6 families and adds to what the day already found", async () => {
    // The first scan (no memory): families 1–6 find the clone effect (8 creators).
    const first = web();
    const doc1 = await runEffects(setup().env, { fetch: first.fetch, now: NOW });
    expect(familiesOf(first.searched)).toEqual(FAMILY_QUERIES.slice(0, 6));
    expect(doc1.slot).toBe(0);
    expect(doc1.items.find((i) => i.key === "clone-effect")?.creators).toBe(8);

    // Scan again: families 7–12 find 3 speed-ramp creators, 1 more clone creator and 1 already counted.
    const second = web({
      hits: [
        tt("s1", "Speed Ramp tutorial", 101),
        tt("s2", "speed ramp edit", 102),
        tt("s3", "smooth speed ramp", 103),
        tt("c9", "clone effect tutorial | CapCut", 109),
        tt("c1", "Clone Yourself in CapCut 🔥 #cloneyourself", 1),
      ],
    });
    const doc2 = await runEffects(setup({ stored: doc1 }).env, {
      fetch: second.fetch,
      now: new Date("2026-10-07T09:00:00Z"),
      force: true,
    });
    expect(familiesOf(second.searched)).toEqual(FAMILY_QUERIES.slice(6, 12));
    const creators = Object.fromEntries(doc2.items.map((i) => [i.key, i.creators]));
    expect(creators).toMatchObject({ "clone-effect": 9, "speed-ramp": 3 });
    // A name this run did not find keeps the day's earlier creators.
    expect(creators["swagger-trend"]).toBe(3);
    expect(doc2.history["clone-effect"]).toHaveLength(1);

    // A third tap: families 13–18; a fourth starts over at 1–6.
    const third = web({ hits: [] });
    const doc3 = await runEffects(setup({ stored: doc2 }).env, {
      fetch: third.fetch,
      now: new Date("2026-10-07T10:00:00Z"),
      force: true,
    });
    expect(familiesOf(third.searched)).toEqual(FAMILY_QUERIES.slice(12, 18));
    const fourth = web({ hits: [] });
    await runEffects(setup({ stored: doc3 }).env, {
      fetch: fourth.fetch,
      now: new Date("2026-10-07T11:00:00Z"),
      force: true,
    });
    expect(familiesOf(fourth.searched)).toEqual(FAMILY_QUERIES.slice(0, 6));

    // A document saved before turns were kept (no `slot`), already run today: the turn after the day's (2026-10-07's
    // is families 1–6, so 7–12).
    const legacy = web({ hits: [] });
    await runEffects(setup({ stored: { ...doc1, slot: undefined } }).env, {
      fetch: legacy.fetch,
      now: new Date("2026-10-07T12:00:00Z"),
      force: true,
    });
    expect(familiesForDay("2026-10-07")).toEqual(FAMILY_QUERIES.slice(0, 6));
    expect(familiesOf(legacy.searched)).toEqual(FAMILY_QUERIES.slice(6, 12));
  });

  it("the first scan (no memory yet) searches families 1–6, the owner's two reels; later scans the day's rotation", async () => {
    // 2026-10-06's rotation is families 13–18.
    const day = new Date("2026-10-06T05:35:00Z");
    expect(familiesForDay("2026-10-06")).toEqual(FAMILY_QUERIES.slice(12, 18));
    expect(FAMILY_QUERIES.slice(0, 2)).toEqual([
      "clone yourself video trend",
      "gif stickers video edit",
    ]);
    const first = web();
    const doc = await runEffects(setup().env, { fetch: first.fetch, now: day });
    expect(familiesOf(first.searched)).toEqual(FAMILY_QUERIES.slice(0, 6));

    // A stored document with no memory (every run so far failed) is a first scan too.
    const retry = web();
    const noMemory = { ...doc, status: "failed" as const, items: [], meta: {}, history: {} };
    await runEffects(setup({ stored: noMemory }).env, { fetch: retry.fetch, now: day });
    expect(familiesOf(retry.searched)).toEqual(FAMILY_QUERIES.slice(0, 6));

    // With a memory, the day's rotation: 2026-10-09 is families 13–18 again.
    const later = web();
    await runEffects(setup({ stored: doc }).env, {
      fetch: later.fetch,
      now: new Date("2026-10-09T05:35:00Z"),
    });
    expect(familiesOf(later.searched)).toEqual(FAMILY_QUERIES.slice(12, 18));
  });

  it("a day whose run failed runs again without force (the first-scan button's retry); a good day does not", async () => {
    const { env, KV } = setup();
    // The day's first run fails: Tavily's quota on every search, nothing to show yet.
    const down = web({ tavily: () => json({ error: "quota" }, 432) });
    const failedRun = await runEffects(env, { fetch: down.fetch, now: NOW });
    expect(failedRun).toMatchObject({ status: "failed", ranOn: "2026-10-07", items: [] });
    expect(writes(KV)).toEqual([ATTEMPTS, EFFECTS_KEY]);

    // A retry the same UTC day runs the job again and replaces the failed document.
    const later = new Date("2026-10-07T09:00:00Z");
    const { fetch, count } = web();
    const doc = await runEffects(env, { fetch, now: later });
    expect(count).toEqual({ tavily: 18, search: 2, stats: 1 });
    expect(doc).toMatchObject({
      status: "ok",
      ranOn: "2026-10-07",
      updatedAt: later.toISOString(),
    });
    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(writes(KV)).toEqual([ATTEMPTS, EFFECTS_KEY, ATTEMPTS, EFFECTS_KEY]);
    expect(KV.store.get(ATTEMPTS)).toBe("2");
    expect(stored(KV)).toEqual(doc);

    // That good day is once a day again: another run answers the stored list, spends nothing and never reads or
    // counts an attempt.
    const again = web();
    KV.get.mockClear();
    expect(
      await runEffects(env, { fetch: again.fetch, now: new Date("2026-10-07T20:00:00Z") }),
    ).toEqual(doc);
    expect(again.fetch).not.toHaveBeenCalled();
    expect(KV.get.mock.calls.map(([key]) => key)).toEqual([EFFECTS_KEY]);
    expect(writes(KV)).toHaveLength(4);
  });

  it("at most 3 spending runs a UTC day: a 4th spends nothing and says so; force skips the cap", async () => {
    const { env, KV } = setup();
    // Run 1 is lost before it saves (its write fails, as for a run the edge cuts off); runs 2 and 3 fail on Tavily's
    // quota. Each left the day open to another run, and each counted itself before its first search.
    let lose = true;
    KV.put.mockImplementation(async (key: string, value: string) => {
      if (key === EFFECTS_KEY && lose) {
        lose = false;
        throw new Error("KV PUT failed");
      }
      KV.store.set(key, value);
    });
    const lost = web();
    const run1 = await runEffects(env, { fetch: lost.fetch, now: NOW });
    expect(run1.notes).toEqual(["kv"]); // the answer says the list was not saved
    expect(KV.store.has(EFFECTS_KEY)).toBe(false);
    expect(KV.put.mock.invocationCallOrder[0]).toBeLessThan(lost.fetch.mock.invocationCallOrder[0]);
    expect(KV.put.mock.calls[0]).toEqual([ATTEMPTS, "1", { expirationTtl: 172_800 }]);
    for (const hour of [9, 10]) {
      const down = web({ tavily: () => json({ error: "quota" }, 432) });
      const failedRun = await runEffects(env, {
        fetch: down.fetch,
        now: new Date(Date.UTC(2026, 9, 7, hour)),
      });
      expect(failedRun).toMatchObject({ status: "failed", notes: ["quota"] });
      expect(down.count.tavily).toBe(18);
    }
    expect(KV.store.get(ATTEMPTS)).toBe("3");

    // The 4th: no search, nothing written; the stored (failed) list, noted.
    const written = writes(KV).length;
    const fourth = web();
    const capped = await runEffects(env, {
      fetch: fourth.fetch,
      now: new Date("2026-10-07T11:00:00Z"),
    });
    expect(fourth.fetch).not.toHaveBeenCalled();
    expect(capped).toEqual({ ...stored(KV), notes: ["quota", "attempts"] });
    expect(writes(KV)).toHaveLength(written);

    // Force skips the cap and never counts.
    const forced = web();
    KV.get.mockClear();
    const doc = await runEffects(env, { fetch: forced.fetch, now: NOW, force: true });
    expect(forced.count.tavily).toBe(18);
    expect(doc.status).toBe("ok");
    // It reads its list and Discover's Tavily figure (the budget guard), never the attempt counter.
    expect(KV.get.mock.calls.map(([key]) => key)).toEqual([EFFECTS_KEY, usageKeys.tavily]);
    expect(KV.store.get(ATTEMPTS)).toBe("3");

    // The next UTC day starts a new count.
    const tomorrow = web();
    await runEffects(env, { fetch: tomorrow.fetch, now: NEXT_DAY });
    expect(tomorrow.count.tavily).toBe(18);
    expect(KV.store.get("effects:attempts:2026-10-08")).toBe("1");
  });

  it("over the cap with no document yet: a failed answer with no list, never written", async () => {
    const { env, KV } = setup();
    KV.store.set(ATTEMPTS, "3");
    const { fetch } = web();
    const doc = await runEffects(env, { fetch, now: NOW });
    expect(fetch).not.toHaveBeenCalled();
    expect(doc).toEqual({
      status: "failed",
      ranOn: "2026-10-07",
      updatedAt: NOW.toISOString(),
      notes: ["attempts"],
      items: [],
      meta: {},
      history: {},
    });
    expect(KV.put).not.toHaveBeenCalled();
  });

  it("a counter KV can't read or write never stops a run (noted attempts_kv)", async () => {
    const unreadable = setup();
    unreadable.KV.get.mockImplementation(async (key: string) => {
      if (key === ATTEMPTS) throw new Error("KV GET failed");
      return unreadable.KV.store.get(key) ?? null;
    });
    const unwritable = setup();
    unwritable.KV.put.mockImplementation(async (key: string, value: string) => {
      if (key === ATTEMPTS) throw new Error("KV PUT failed");
      unwritable.KV.store.set(key, value);
    });
    for (const { env, KV } of [unreadable, unwritable]) {
      const { fetch, count } = web();
      const doc = await runEffects(env, { fetch, now: NOW });
      expect(count.tavily).toBe(18);
      expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
      // The run itself went well: still "ok", with the note.
      expect(doc).toMatchObject({ status: "ok", notes: ["attempts_kv"] });
      expect(stored(KV)).toEqual(doc);
    }
  });

  it("a Tavily quota on every call fails the day but keeps the previous chips", async () => {
    const day1 = setup();
    const prev = await runEffects(day1.env, { fetch: web().fetch, now: NOW });
    const { env, KV, AI } = setup({ stored: prev });
    const { fetch, count } = web({ tavily: () => json({ error: "quota" }, 432) });
    const doc = await runEffects(env, { fetch, now: NEXT_DAY });

    expect(doc).toEqual({
      ...prev,
      ranOn: "2026-10-08",
      status: "failed",
      notes: ["quota"],
      // The failed run's own counts, not the previous day's.
      diagnostics: expect.objectContaining({ status: "failed", items: 2, notes: ["quota"] }),
    });
    expect(doc.items).toHaveLength(2);
    expect(count).toEqual({ tavily: 18, search: 0, stats: 0 });
    expect(AI.run).not.toHaveBeenCalled();
    expect(writes(KV)).toEqual(["effects:attempts:2026-10-08", EFFECTS_KEY]);
  });

  it("some Tavily calls failing still makes a list, noted as partial", async () => {
    const { env } = setup();
    const { fetch, count } = web({
      tavily: (q) => (q === "clone yourself video trend" ? undefined : json({}, 432)),
    });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("partial");
    expect(doc.notes).toEqual(["quota"]);
    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(count).toEqual({ tavily: 18, search: 2, stats: 1 });
  });

  it("without the AI the chips are dictionary effects and names it approved before; new names wait for a day it works", async () => {
    const { env, KV } = setup();
    env.AI.run.mockResolvedValue({ response: "{not json" });
    const day1 = web();
    const doc = await runEffects(env, { fetch: day1.fetch, now: NOW });

    expect(doc.status).toBe("partial");
    expect(doc.notes).toEqual(["ai_fallback"]);
    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect"]);
    expect(doc.items[0]).toMatchObject({
      name: { en: "clone effect", ar: "تأثير الاستنساخ" }, // the dictionary's own label
      checked: false,
      creators: 8,
    });
    expect(doc.meta["swagger-trend"]).toMatchObject({
      name: { en: "swagger trend" },
      checked: false,
    });
    expect(day1.count.search).toBe(1);
    expect(writes(KV)).toEqual([ATTEMPTS, EFFECTS_KEY]);

    const day2 = web();
    const next = await runEffects({ ...env, AI: ai() }, { fetch: day2.fetch, now: NEXT_DAY });
    expect(next.status).toBe("ok");
    expect(next.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(day2.count.search).toBe(2);

    // The AI fails again: the swagger trend, approved yesterday, still shows; today's new Outfit Trend waits.
    const outfit = [20, 21, 22].map((n) => tt(`o${n}`, "Fit check: Outfit Trend", n));
    const day3 = web({ hits: [...PROBE, ...outfit] });
    const third = await runEffects(env, {
      fetch: day3.fetch,
      now: new Date("2026-10-09T05:35:00Z"),
    });
    expect(third.notes).toEqual(["ai_fallback"]);
    expect(third.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(third.meta["outfit-trend"]).toMatchObject({ checked: false });
  });

  it("a dictionary effect goes to the AI until it has a line, then leaves its slot to new names", async () => {
    const sent = (AI: ReturnType<typeof ai>) => userText(AI.run.mock.calls[0][1]);
    const line = { en: "What clone effect looks like", ar: "وصف قصير للتأثير" };
    // Day 1 without the AI: the clone effect gets no line.
    const day1 = setup();
    day1.AI.run.mockResolvedValue({ response: "{not json" });
    const first = await runEffects(day1.env, { fetch: web().fetch, now: NOW });
    expect(sent(day1.AI)).toContain("- key: clone-effect |");
    expect(first.meta["clone-effect"].what).toBeUndefined();
    // Day 2: sent again, and judged.
    const day2 = setup({ stored: first });
    const second = await runEffects(day2.env, { fetch: web().fetch, now: NEXT_DAY });
    expect(sent(day2.AI)).toContain("- key: clone-effect |");
    expect(second.meta["clone-effect"].what).toEqual(line);
    // Day 3: it has its line, so only new names take the AI's slots; the line stays.
    const day3 = setup({ stored: second });
    const third = await runEffects(day3.env, {
      fetch: web().fetch,
      now: new Date("2026-10-09T05:35:00Z"),
    });
    expect(sent(day3.AI)).not.toContain("- key: clone-effect |");
    expect(sent(day3.AI)).toContain("- key: swagger-trend |");
    expect(third.items[0]).toMatchObject({ key: "clone-effect", what: line });
  });

  it("applies the AI's valid verdicts when one of them breaks the schema, and logs why it broke", async () => {
    const { env } = setup({
      judge: (key) => (key === "swagger-trend" ? { what: undefined } : {}),
    });
    const { fetch, count } = web();
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("ok");
    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect"]); // swagger-trend was never approved
    expect(doc.items[0]).toMatchObject({
      checked: true,
      what: { en: "What clone effect looks like", ar: "وصف قصير للتأثير" },
    });
    expect(doc.meta["swagger-trend"]).toMatchObject({ checked: false });
    expect(count.search).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0][0])).effects.ai).toMatchObject({
      judged: 2,
      rejects: { "what:invalid_type": 1 },
    });
  });

  it("an AI answer with no usable verdict is noted ai_empty and shows dictionary effects only", async () => {
    const { env } = setup({ judge: () => ({ keep: "yes" }) });
    const { fetch, count } = web();
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("partial");
    expect(doc.notes).toEqual(["ai_empty"]);
    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect"]);
    expect(count.search).toBe(1);
    // The log says why, as counts: all 3 verdicts on their keep field.
    expect(JSON.parse(String(log.mock.calls[0][0])).effects.ai).toMatchObject({
      judged: 0,
      rejects: { "keep:invalid_type": 3 },
    });
  });

  it("the AI's real output (an empty, null or self merge; over-long lines) is used, not ai_empty (live check 2026-10-06)", async () => {
    const sameAs: Record<string, unknown> = {
      "clone-effect": "",
      "swagger-trend": null,
      "reverse-trend": "reverse-trend",
    };
    const what =
      "Two of you share one shot: you walk in, meet yourself, then both of you dance the same steps in sync until the beat drops";
    const { env } = setup({
      judge: (key) => ({ sameAs: sameAs[key], what: { en: what, ar: "وصف قصير للتأثير" } }),
    });
    const doc = await runEffects(env, { fetch: web().fetch, now: NOW });

    expect(doc.status).toBe("ok");
    expect(doc.notes).toBeUndefined();
    expect(doc.items.map((i) => [i.key, i.checked])).toEqual([
      ["clone-effect", true],
      ["swagger-trend", true],
    ]);
    // 121 characters, clipped at a word within the limit of 90.
    expect(doc.items[1].what!.en).toBe(
      "Two of you share one shot: you walk in, meet yourself, then both of you dance the same",
    );
    expect(JSON.parse(String(log.mock.calls[0][0])).effects.ai).toEqual({
      judged: 3,
      dictionary: 1,
      approved: 2,
      dropped: 0,
      merged: 0,
      rejects: {},
    });
  });

  it("AI cleanup drops a junk name and merges a spelling into the clone effect", async () => {
    const judged: Record<string, Verdict> = {
      "outfit-trend": { keep: false },
      "twin-trend": { sameAs: "clone-effect" },
      // A dictionary effect is never dropped or merged away.
      "clone-effect": { keep: false, sameAs: "swagger-trend" },
    };
    const { env } = setup({ judge: (key) => judged[key] ?? {} });
    const hits = [
      ...PROBE,
      tt("o1", "Fit check: Outfit Trend", 20),
      tt("o2", "Fit check: Outfit Trend", 21),
      tt("o3", "Fit check: Outfit Trend", 22),
      tt("n1", "The Twin Trend everyone is doing", 23),
      ig("n2", "The Twin Trend everyone is doing", 24),
    ];
    const { fetch, count } = web({ hits });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(doc.items[0]).toMatchObject({ creators: 10, checked: false }); // 8 + the 2 "twin trend" creators
    for (const gone of ["outfit-trend", "twin-trend"]) {
      expect(doc.meta[gone]).toBeUndefined();
      expect(doc.history[gone]).toBeUndefined();
    }
    expect(count.search).toBe(2);
    // The log counts what the AI did (no names): 5 verdicts, 1 on the dictionary's clone effect; the swagger and
    // reverse trends approved, the outfit trend dropped, the twin trend merged.
    expect(JSON.parse(String(log.mock.calls[0][0])).effects.ai).toEqual({
      judged: 5,
      dictionary: 1,
      approved: 2,
      dropped: 1,
      merged: 1,
      rejects: {},
    });
  });

  it("a merged spelling's earlier days move into its effect; a dropped name's earlier days go", async () => {
    const day1 = setup();
    const hits = [
      ...PROBE,
      tt("n1", "The Swagger Edit everyone is doing", 23),
      tt("o1", "Fit check: Outfit Trend", 20),
      tt("o2", "Fit check: Outfit Trend", 21),
      tt("o3", "Fit check: Outfit Trend", 22),
    ];
    const first = web({ hits });
    const prev = await runEffects(day1.env, { fetch: first.fetch, now: NOW });
    expect(prev.items.map((i) => i.key)).toContain("outfit-trend");
    expect(prev.meta["swagger-edit"]).toMatchObject({ checked: true });
    expect(first.count.search).toBe(3);

    const { env } = setup({
      stored: prev,
      judge: (key) =>
        key === "outfit-trend"
          ? { keep: false }
          : key === "swagger-edit"
            ? { sameAs: "swagger-trend" }
            : {},
    });
    const today = [
      ig("c6", "Chanel Confidence: Clone Yourself with One Hair (Swagger Trend)", 31),
      tt("n2", "The Swagger Edit everyone is doing", 30),
      ...hits.slice(-3),
    ];
    const second = web({ hits: today });
    const doc = await runEffects(env, { fetch: second.fetch, now: NEXT_DAY });

    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    // c6–c8 and n1 yesterday (n1 moved over from "swagger edit"), c6 and n2 today: 4 without the move.
    expect(doc.items[1].creators).toBe(5);
    // Yesterday's YouTube views survive the move, so today's growth compares with them.
    expect(doc.history["swagger-trend"].find((e) => e.day === "2026-10-07")?.views7d).toBe(2000);
    expect(doc.items[1].youtube).toEqual({ newVideos: 2, views7d: 2000, growth: 1 });
    expect(doc.history["swagger-edit"]).toBeUndefined();
    expect(doc.history["outfit-trend"]).toBeUndefined();
    expect(second.count.search).toBe(2);
  });

  it("asks YouTube only about effects mentioned today, the top 6 of them", async () => {
    const day1 = setup();
    const first = web();
    const prev = await runEffects(day1.env, { fetch: first.fetch, now: NOW });
    expect(first.queries).toEqual(["clone effect edit", "swagger trend edit"]);

    // Today only the clone effect is mentioned: the swagger trend still shows from yesterday, with no YouTube call
    // (its views would have nowhere to go: they are kept on the day's own entry).
    const { env } = setup({ stored: prev });
    const second = web({ hits: [tt("c9", "clone effect tutorial | CapCut", 40)] });
    const doc = await runEffects(env, { fetch: second.fetch, now: NEXT_DAY });
    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(second.queries).toEqual(["clone effect edit"]);
    expect(doc.items[1].youtube).toBeUndefined();
  });

  it("asks YouTube about a new name as the rules read it today: never its stemmed key, nor the AI's name", async () => {
    const hits = ["g1", "g2", "g3"].map((h, i) => tt(h, "Ghost Frames Trend", 50 + i));
    const { env } = setup({
      judge: () => ({ name: { en: "Ghost Frame Effect", ar: "اسم التأثير" } }),
    });
    const { fetch, queries } = web({ hits });
    const doc = await runEffects(env, { fetch, now: NOW });
    expect(doc.items.map((i) => [i.key, i.name.en])).toEqual([
      ["ghost-frame-trend", "Ghost Frame Effect"],
    ]);
    expect(queries).toEqual(["ghost frames trend edit"]);
  });

  it("gives the AI's slots by creators this week: a slowly building name is judged and shows", async () => {
    // 26 names by the same 2 creators every day, then one name by 1 new creator a day: below every day's top 25 by
    // today's creators.
    const nato =
      "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec " +
      "romeo sierra tango uniform victor whiskey xray yankee zulu";
    const fillers = nato
      .split(" ")
      .flatMap((w, i) =>
        ["fa", "fb"].map((h, j) => tt(h, `${titleCase(w)} Trend`, 100 + 2 * i + j)),
      );
    let prev: EffectsDoc | undefined;
    const judged: boolean[] = [];
    for (const day of [5, 6, 7]) {
      const { env, AI } = setup({ stored: prev });
      const hits = [...fillers, tt(`s${day}`, "Ghost Walk Trend", 200 + day)];
      prev = await runEffects(env, {
        fetch: web({ hits }).fetch,
        now: new Date(`2026-10-0${day}T05:35:00Z`),
      });
      judged.push(userText(AI.run.mock.calls[0][1]).includes("- key: ghost-walk-trend |"));
    }
    // Day 2: it ties the fillers at 2 creators and was never checked, so it goes first. Day 3: 3 creators lead.
    expect(judged).toEqual([false, true, true]);
    expect(prev!.items.map((i) => [i.key, i.creators, i.checked])).toEqual([
      ["ghost-walk-trend", 3, true],
    ]);
  });

  it("asks YouTube the same query for an effect whatever the AI calls it today", async () => {
    const day1 = setup();
    const first = web();
    const prev = await runEffects(day1.env, { fetch: first.fetch, now: NOW });

    const { env } = setup({
      stored: prev,
      judge: (key) =>
        key === "swagger-trend" ? { name: { en: "Swagger Hair Trend", ar: "ترند الشعرة" } } : {},
    });
    const second = web();
    const doc = await runEffects(env, { fetch: second.fetch, now: NEXT_DAY });

    expect(doc.items[1].name.en).toBe("Swagger Hair Trend");
    expect(first.queries).toEqual(["clone effect edit", "swagger trend edit"]);
    expect(second.queries).toEqual(first.queries);
  });

  it("YouTube's daily cap: no YouTube numbers, a youtube_cap note, no more calls", async () => {
    const { env } = setup();
    const { fetch, count } = web({ youtubeSearch: youtubeCap });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("partial");
    expect(doc.notes).toEqual(["youtube_cap"]);
    expect(doc.items.length).toBeGreaterThan(0);
    expect(doc.items.every((i) => i.youtube === undefined)).toBe(true);
    expect(count).toEqual({ tavily: 18, search: 1, stats: 0 });
  });

  it("YouTube answering the first effect, then hitting the cap, keeps the first effect's numbers", async () => {
    const { env } = setup();
    const { fetch, count } = web({ youtubeSearch: (n) => (n > 1 ? youtubeCap() : undefined) });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.notes).toEqual(["youtube_cap"]);
    expect(doc.items[0].youtube).toEqual({ newVideos: 2, views7d: 2000 });
    expect(doc.items[1].youtube).toBeUndefined();
    expect(count).toEqual({ tavily: 18, search: 2, stats: 1 });
  });

  it("a failed YouTube stats call gives no numbers and a youtube_stats note", async () => {
    const { env } = setup();
    const { fetch, count } = web({ stats: () => json({ error: "down" }, 500) });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("partial");
    expect(doc.notes).toEqual(["youtube_stats"]);
    expect(doc.items.every((i) => i.youtube === undefined)).toBe(true);
    expect(count).toEqual({ tavily: 18, search: 2, stats: 1 });
  });

  it(
    "a shorter search timeout never cuts the AI short; the AI has its own",
    { timeout: 15_000 },
    async () => {
      const { env } = setup();
      const answer = env.AI.run.getMockImplementation()!;
      env.AI.run.mockImplementation(async (model, input) => {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return answer(model, input);
      });
      // 2 s for each instant fake search call, so a pause under parallel load cannot time one out; the AI takes 2.5 s.
      const doc = await runEffects(env, { fetch: web().fetch, now: NOW, timeoutMs: 2000 });
      expect(doc.status).toBe("ok");

      const cut = await runEffects(env, {
        fetch: web().fetch,
        now: NOW,
        force: true,
        aiTimeoutMs: 100,
      });
      expect(cut.notes).toEqual(["ai_fallback"]);
    },
  );

  // Three runs over a full memory: well under 1 s alone, but over 5 s in the full suite on a busy machine
  // (2026-10-06), so it gets its own limit like the two below.
  it(
    "a name building on its family's day survives a busy memory, is judged and shows",
    { timeout: 60_000 },
    async () => {
      // Scans D, D+3, D+6 search the same families. Each brings 150 one-creator names; the slow name gains 1 creator.
      let prev: EffectsDoc | undefined;
      for (const [scan, day] of [
        [1, "2026-10-01"],
        [2, "2026-10-04"],
        [3, "2026-10-07"],
      ] as const) {
        const junk = Array.from({ length: 150 }, (_, i) =>
          tt(`j${scan}x${i}`, `Zork${scan}x${i} Trend`, scan * 1000 + i),
        );
        const hits = [...junk, tt(`s${scan}`, "Ghost Walk Trend", scan)];
        const { env } = setup({ stored: prev });
        prev = await runEffects(env, {
          fetch: web({ hits, tavily: firstSearchOnly() }).fetch,
          now: new Date(`${day}T05:35:00Z`),
        });
      }
      expect(prev!.items.map((i) => [i.key, i.creators, i.checked])).toEqual([
        ["ghost-walk-trend", 3, true],
      ]);
      expect(Object.keys(prev!.history)).toHaveLength(HISTORY_KEYS); // 451 names trimmed to the cap
      expect(docBytes(prev!)).toBeLessThan(250_000);
    },
  );

  // These two simulate many daily runs: about 1 s alone, but over 5 s on a busy machine, so they get their own limit.
  it(
    "in steady daily runs, a name rising on its family's day survives the cap and shows",
    { timeout: 60_000 },
    async () => {
      // 14 daily runs of 120 one-creator names; the AI approves 12 of the 25 it judges (odd ones) and drops the rest.
      // The slow name gains a creator on days 7, 10 and 13 (its family's days). With approved names protected for all
      // 14 days (fix round 2) it was cut twice and ended with 1 creator.
      const judge = (key: string) =>
        Number(/^q\d+x(\d+)-trend$/.exec(key)?.[1] ?? 1) % 2 ? {} : { keep: false };
      let prev: EffectsDoc | undefined;
      for (let d = 0; d < 14; d++) {
        const junk = Array.from({ length: 120 }, (_, i) =>
          tt(`u${d}x${i}`, `Q${d}x${i} Trend`, d * 1000 + i),
        );
        const hits = [7, 10, 13].includes(d)
          ? [...junk, tt(`s${d}`, "Ghost Walk Trend", 90_000 + d)]
          : junk;
        const { env } = setup({ stored: prev, judge });
        log.mockClear();
        prev = await runEffects(env, {
          fetch: web({ hits, tavily: firstSearchOnly() }).fetch,
          now: new Date(Date.UTC(2026, 9, 1 + d, 5, 35)),
        });
      }
      expect(prev!.items.map((i) => [i.key, i.creators, i.checked])).toEqual([
        ["ghost-walk-trend", 3, true],
      ]);
      const { keys, protected: kept, trimmed } = JSON.parse(String(log.mock.calls[0][0])).effects;
      expect(keys).toBe(HISTORY_KEYS);
      expect(kept).toBeLessThan(100); // the last 7 days' approved names; all 14 days' would be ~170
      expect(trimmed).toBeGreaterThan(0);
      expect(docBytes(prev!)).toBeLessThan(250_000); // ~104 KB: 400 keys after 14 days
    },
  );

  it(
    "at the cap, approved names stay first while seen this week; older ones compete like any other",
    { timeout: 60_000 },
    async () => {
      const approved =
        "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november " +
        "oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee";
      const day1 = approved.split(" ").map((w, i) => tt(`a${i}`, `${titleCase(w)} Trend`, i));
      const first = setup();
      const prev = await runEffects(first.env, { fetch: web({ hits: day1 }).fetch, now: NOW });
      const keys = Object.keys(prev.meta);
      expect(keys).toHaveLength(25);
      expect(keys.every((k) => prev.meta[k].checked)).toBe(true);

      // 400 new one-creator names, newer than the approved 25: 425 keys must lose 25.
      const crowd = Array.from({ length: 400 }, (_, i) => tt(`z${i}`, `Zork${i} Trend`, 1000 + i));
      const after = async (now: Date) =>
        runEffects(setup({ stored: prev }).env, {
          fetch: web({ hits: crowd, tavily: firstSearchOnly() }).fetch,
          now,
        });
      // The boundary: last seen 6 days ago is this week, kept first (unprotected, a tie on 1 creator would cut the
      // older names); 7 days ago is not, no creators this week, cut first.
      const sixDays = await after(new Date("2026-10-13T05:35:00Z"));
      expect(Object.keys(sixDays.history)).toHaveLength(HISTORY_KEYS);
      expect(keys.filter((k) => !sixDays.history[k] || !sixDays.meta[k])).toEqual([]);
      const sevenDays = await after(new Date("2026-10-14T05:35:00Z"));
      expect(Object.keys(sevenDays.history)).toHaveLength(HISTORY_KEYS);
      expect(keys.filter((k) => sevenDays.history[k] || sevenDays.meta[k])).toEqual([]);
    },
  );

  it("history across days: 3 creators on day D, 6 new ones on D+3 → growth 2 over 9 creators", async () => {
    const clone = (handles: string[], from: number) =>
      handles.map((h, i) => tt(h, "clone effect tutorial | CapCut", from + i));
    const day = setup();
    const dayD = web({ hits: clone(["a", "b", "c"], 1) });
    const d = await runEffects(day.env, {
      fetch: dayD.fetch,
      now: new Date("2026-10-04T05:35:00Z"),
    });
    expect(d.items[0]).toMatchObject({ key: "clone-effect", creators: 3, growth: 3 });
    expect(dayD.count.search).toBe(1);

    const { env } = setup({ stored: d });
    const doc = await runEffects(env, {
      fetch: web({ hits: clone(["d", "e", "f", "g", "h", "i"], 10) }).fetch,
      now: NOW, // 2026-10-07, D+3
    });
    expect(doc.items[0]).toMatchObject({ key: "clone-effect", creators: 9, growth: 2 });
  });

  it("never throws: unreadable KV is left alone, a broken document keeps the previous chips", async () => {
    const { env, KV } = setup();
    KV.get.mockRejectedValue(new Error("kv down"));
    const { fetch } = web();
    const doc = await runEffects(env, { fetch, now: NOW });
    expect(doc).toMatchObject({ status: "failed", notes: ["kv"], items: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(KV.put).not.toHaveBeenCalled();

    const prev = await runEffects(setup().env, { fetch: web().fetch, now: NOW });
    const broken = setup({ stored: { ...prev, history: { "clone-effect": 5 } } as never });
    log.mockClear();
    const failed = await runEffects(broken.env, { fetch: web().fetch, now: NEXT_DAY });
    expect(failed).toMatchObject({ status: "failed", notes: ["error"], items: prev.items });
    expect(writes(broken.KV)).toEqual(["effects:attempts:2026-10-08", EFFECTS_KEY]);
    // The log line says why (a code error, clipped), never post text.
    const { error } = JSON.parse(String(log.mock.calls[0][0])).effects as { error: string };
    expect(error).toMatch(/ is not /); // "… is not iterable" or "… is not a function"
    expect(error.length).toBeLessThanOrEqual(200);
  });
});
