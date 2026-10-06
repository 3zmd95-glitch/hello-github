import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TAVILY_URL } from "../trends/tavily";
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
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.href === TAVILY_URL) {
      count.tavily++;
      const { query } = JSON.parse(String(init?.body)) as { query: string };
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
  return { fetch, count, queries };
}

/** Answers the day's hits to the first family search only (as one family finds a trend); the rest find nothing. */
function firstSearchOnly() {
  let served = false;
  return () => (served ? json({ results: [] }) : ((served = true), undefined));
}
const docBytes = (doc: EffectsDoc) => new TextEncoder().encode(JSON.stringify(doc)).length;

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
      name: { en: "clone effect", ar: "اسم التأثير" }, // the dictionary label, not the AI's "Clone Effect"
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

    expect(count).toEqual({ tavily: 6, search: 2, stats: 1 });
    expect(AI.run).toHaveBeenCalledTimes(1);
    expect(KV.put).toHaveBeenCalledTimes(1);
    expect(stored(KV)).toEqual(doc);

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({
      effects: { status: "ok", items: 2, credits: 6, keys: 3, protected: 3, trimmed: 0 },
    });
    expect(line).not.toMatch(/c1|Clone/); // no handles, no titles
  });

  it("runs once a day; force runs again and replaces the day's creators", async () => {
    const { env, KV } = setup();
    const { fetch, count } = web();
    const first = await runEffects(env, { fetch, now: NOW });
    const calls = fetch.mock.calls.length;

    const later = new Date("2026-10-07T20:00:00Z");
    expect(await runEffects(env, { fetch, now: later })).toEqual(first);
    expect(fetch.mock.calls.length).toBe(calls);
    expect(KV.put).toHaveBeenCalledTimes(1);

    const forced = await runEffects(env, { fetch, now: later, force: true });
    expect(count).toEqual({ tavily: 12, search: 4, stats: 2 });
    expect(KV.put).toHaveBeenCalledTimes(2);
    expect(forced.items[0]).toMatchObject({ key: "clone-effect", creators: 8 });
    expect(forced.history["clone-effect"]).toHaveLength(1);
  });

  it("a Tavily quota on every call fails the day but keeps the previous chips", async () => {
    const day1 = setup();
    const prev = await runEffects(day1.env, { fetch: web().fetch, now: NOW });
    const { env, KV, AI } = setup({ stored: prev });
    const { fetch, count } = web({ tavily: () => json({ error: "quota" }, 432) });
    const doc = await runEffects(env, { fetch, now: NEXT_DAY });

    expect(doc).toEqual({ ...prev, ranOn: "2026-10-08", status: "failed", notes: ["quota"] });
    expect(doc.items).toHaveLength(2);
    expect(count).toEqual({ tavily: 6, search: 0, stats: 0 });
    expect(AI.run).not.toHaveBeenCalled();
    expect(KV.put).toHaveBeenCalledTimes(1);
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
    expect(count).toEqual({ tavily: 6, search: 2, stats: 1 });
  });

  it("without the AI the chips are dictionary effects only; new names wait for a day the AI works", async () => {
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
    expect(KV.put).toHaveBeenCalledTimes(1);

    const day2 = web();
    const next = await runEffects({ ...env, AI: ai() }, { fetch: day2.fetch, now: NEXT_DAY });
    expect(next.status).toBe("ok");
    expect(next.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(day2.count.search).toBe(2);
  });

  it("applies the AI's valid verdicts when one of them breaks the schema", async () => {
    const { env } = setup({
      judge: (key) =>
        key === "swagger-trend" ? { name: { en: "Swagger Trend", ar: "ا".repeat(41) } } : {},
    });
    const { fetch, count } = web();
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("ok");
    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect"]); // swagger-trend was never approved
    expect(doc.items[0]).toMatchObject({ checked: true, name: { ar: "اسم التأثير" } });
    expect(doc.meta["swagger-trend"]).toMatchObject({ checked: false });
    expect(count.search).toBe(1);
  });

  it("an AI answer with no usable verdict is noted ai_empty and shows dictionary effects only", async () => {
    const { env } = setup({ judge: () => ({ keep: "yes" }) });
    const { fetch, count } = web();
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("partial");
    expect(doc.notes).toEqual(["ai_empty"]);
    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect"]);
    expect(count.search).toBe(1);
  });

  it("AI cleanup drops a junk name and merges a spelling into the clone effect", async () => {
    const judged: Record<string, Verdict> = {
      "outfit-trend": { keep: false },
      "clone-trend": { sameAs: "clone-effect" },
      // A dictionary effect is never dropped or merged away.
      "clone-effect": { keep: false, sameAs: "swagger-trend" },
    };
    const { env } = setup({ judge: (key) => judged[key] ?? {} });
    const hits = [
      ...PROBE,
      tt("o1", "Fit check: Outfit Trend", 20),
      tt("o2", "Fit check: Outfit Trend", 21),
      tt("o3", "Fit check: Outfit Trend", 22),
      tt("n1", "The Clone Trend everyone is doing", 23),
      ig("n2", "The Clone Trend everyone is doing", 24),
    ];
    const { fetch, count } = web({ hits });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(doc.items[0]).toMatchObject({ creators: 10, checked: false }); // 8 + the 2 "clone trend" creators
    for (const gone of ["outfit-trend", "clone-trend"]) {
      expect(doc.meta[gone]).toBeUndefined();
      expect(doc.history[gone]).toBeUndefined();
    }
    expect(count.search).toBe(2);
  });

  it("a merged spelling's earlier days move into its effect; a dropped name's earlier days go", async () => {
    const day1 = setup();
    const hits = [
      ...PROBE,
      tt("n1", "The Clone Trend everyone is doing", 23),
      tt("o1", "Fit check: Outfit Trend", 20),
      tt("o2", "Fit check: Outfit Trend", 21),
      tt("o3", "Fit check: Outfit Trend", 22),
    ];
    const first = web({ hits });
    const prev = await runEffects(day1.env, { fetch: first.fetch, now: NOW });
    expect(prev.items.map((i) => i.key)).toContain("outfit-trend");
    expect(first.count.search).toBe(3);

    const { env } = setup({
      stored: prev,
      judge: (key) =>
        key === "outfit-trend"
          ? { keep: false }
          : key === "clone-trend"
            ? { sameAs: "clone-effect" }
            : {},
    });
    const today = [
      tt("c1", "clone effect tutorial | CapCut", 31),
      tt("n2", "The Clone Trend everyone is doing", 30),
      ...hits.slice(-3),
    ];
    const second = web({ hits: today });
    const doc = await runEffects(env, { fetch: second.fetch, now: NEXT_DAY });

    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    // c1–c8 and n1 yesterday (n1 moved over from "clone trend"), c1 and n2 today: 9 without the move.
    expect(doc.items[0].creators).toBe(10);
    // Yesterday's YouTube views survive the move, so today's growth compares with them.
    expect(doc.history["clone-effect"].find((e) => e.day === "2026-10-07")?.views7d).toBe(2000);
    expect(doc.items[0].youtube).toEqual({ newVideos: 2, views7d: 2000, growth: 1 });
    expect(doc.history["clone-trend"]).toBeUndefined();
    expect(doc.history["outfit-trend"]).toBeUndefined();
    expect(second.count.search).toBe(2);
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
    expect(count).toEqual({ tavily: 6, search: 1, stats: 0 });
  });

  it("YouTube answering the first effect, then hitting the cap, keeps the first effect's numbers", async () => {
    const { env } = setup();
    const { fetch, count } = web({ youtubeSearch: (n) => (n > 1 ? youtubeCap() : undefined) });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.notes).toEqual(["youtube_cap"]);
    expect(doc.items[0].youtube).toEqual({ newVideos: 2, views7d: 2000 });
    expect(doc.items[1].youtube).toBeUndefined();
    expect(count).toEqual({ tavily: 6, search: 2, stats: 1 });
  });

  it("a failed YouTube stats call gives no numbers and a youtube_stats note", async () => {
    const { env } = setup();
    const { fetch, count } = web({ stats: () => json({ error: "down" }, 500) });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("partial");
    expect(doc.notes).toEqual(["youtube_stats"]);
    expect(doc.items.every((i) => i.youtube === undefined)).toBe(true);
    expect(count).toEqual({ tavily: 6, search: 2, stats: 1 });
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

  it("a name building on its family's day survives a busy memory, is judged and shows", async () => {
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
  });

  it("in steady daily runs, a name rising on its family's day survives the cap and shows", async () => {
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
  });

  it("at the cap, approved names stay first while seen this week; older ones compete like any other", async () => {
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
  });

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
    expect(broken.KV.put).toHaveBeenCalledTimes(1);
    // The log line says why (a code error, clipped), never post text.
    const { error } = JSON.parse(String(log.mock.calls[0][0])).effects as { error: string };
    expect(error).toMatch(/ is not /); // "… is not iterable" or "… is not a function"
    expect(error.length).toBeLessThanOrEqual(200);
  });
});
