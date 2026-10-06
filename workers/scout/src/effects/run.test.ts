import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TAVILY_URL } from "../trends/tavily";
import { EFFECTS_KEY } from "./kv";
import { runEffects } from "./run";
import type { EffectsDoc } from "./types";

const NOW = new Date("2026-10-07T05:35:00Z");
const NEXT_DAY = new Date("2026-10-08T05:35:00Z");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

/** A fake internet: every Tavily family search answers `hits`; YouTube finds 2 videos per effect, 1,000 views each. */
function web(over: { hits?: Hit[]; tavily?: () => Response; youtubeSearch?: () => Response } = {}) {
  const count = { tavily: 0, search: 0, stats: 0 };
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.href === TAVILY_URL) {
      count.tavily++;
      return over.tavily?.() ?? json({ results: over.hits ?? PROBE, usage: { credits: 1 } });
    }
    if (url.pathname.endsWith("/youtube/v3/search")) {
      count.search++;
      if (over.youtubeSearch) return over.youtubeSearch();
      const q = url.searchParams.get("q") ?? "";
      return json({
        items: [1, 2].map((n) => ({ id: { videoId: `${q}-${n}` }, snippet: { title: q } })),
      });
    }
    if (url.pathname.endsWith("/youtube/v3/videos")) {
      count.stats++;
      const ids = (url.searchParams.get("id") ?? "").split(",");
      return json({ items: ids.map((id) => ({ id, statistics: { viewCount: "1000" } })) });
    }
    return json({ error: "not_found" }, 404);
  });
  return { fetch, count };
}

type Verdict = Record<string, unknown>;
/** A fake built-in AI: keeps every candidate it is shown, unless `judge` says otherwise. */
function ai(judge: (key: string) => Verdict = () => ({})) {
  return {
    run: vi.fn(async (_model: string, input: Record<string, unknown>): Promise<unknown> => {
      const user = (input.messages as { content: string }[])[1].content;
      const effects = [...user.matchAll(/^- key: (\S+) \| name: (.+?) \| posts:/gm)].map(
        ([, key, name]) => ({
          key,
          keep: true,
          name: { en: name.slice(0, 40), ar: "اسم التأثير" },
          what: { en: `What ${name} looks like`.slice(0, 90), ar: "وصف قصير للتأثير" },
          ...judge(key),
        }),
      );
      return { response: { effects } };
    }),
  };
}

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
      name: { en: "clone effect", ar: "اسم التأثير" },
      creators: 8,
      isNew: false,
      growth: 3,
      checked: true,
      platforms: ["ig", "tt"],
      youtube: { newVideos: 2, views7d: 2000 },
    });
    expect(doc.items[1]).toMatchObject({ creators: 3, isNew: true, checked: true });
    expect(doc.meta["reverse-trend"]).toBeDefined(); // remembered, but 1 creator is below the bar
    expect(doc).toMatchObject({ ranOn: "2026-10-07", updatedAt: NOW.toISOString(), status: "ok" });
    expect(doc.notes).toBeUndefined();

    expect(count.tavily).toBe(6);
    expect(count.search).toBeLessThanOrEqual(6);
    expect(count.stats).toBe(1);
    expect(AI.run).toHaveBeenCalledTimes(1);
    expect(KV.put).toHaveBeenCalledTimes(1);
    expect(stored(KV)).toEqual(doc);

    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(JSON.parse(line)).toEqual({ effects: { status: "ok", items: 2, credits: 6 } });
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
    expect(count.tavily).toBe(12);
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

  it("without the AI the chips are dictionary effects only; new names wait for a day the AI works", async () => {
    const { env, KV } = setup();
    env.AI.run.mockResolvedValue({ response: "{not json" });
    const doc = await runEffects(env, { fetch: web().fetch, now: NOW });

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
    expect(KV.put).toHaveBeenCalledTimes(1);

    const next = await runEffects({ ...env, AI: ai() }, { fetch: web().fetch, now: NEXT_DAY });
    expect(next.status).toBe("ok");
    expect(next.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
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
    const doc = await runEffects(env, { fetch: web({ hits }).fetch, now: NOW });

    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    expect(doc.items[0]).toMatchObject({ creators: 10, checked: false }); // 8 + the 2 "clone trend" creators
    for (const gone of ["outfit-trend", "clone-trend"]) {
      expect(doc.meta[gone]).toBeUndefined();
      expect(doc.history[gone]).toBeUndefined();
    }
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
    const prev = await runEffects(day1.env, { fetch: web({ hits }).fetch, now: NOW });
    expect(prev.items.map((i) => i.key)).toContain("outfit-trend");

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
    const doc = await runEffects(env, { fetch: web({ hits: today }).fetch, now: NEXT_DAY });

    expect(doc.items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend"]);
    // c1–c8 and n1 yesterday (n1 moved over from "clone trend"), c1 and n2 today: 9 without the move.
    expect(doc.items[0].creators).toBe(10);
    expect(doc.history["clone-trend"]).toBeUndefined();
    expect(doc.history["outfit-trend"]).toBeUndefined();
  });

  it("YouTube's daily cap: no YouTube numbers, a youtube_cap note, no more calls", async () => {
    const { env } = setup();
    const { fetch, count } = web({
      youtubeSearch: () => json({ error: { errors: [{ reason: "quotaExceeded" }] } }, 403),
    });
    const doc = await runEffects(env, { fetch, now: NOW });

    expect(doc.status).toBe("partial");
    expect(doc.notes).toEqual(["youtube_cap"]);
    expect(doc.items.length).toBeGreaterThan(0);
    expect(doc.items.every((i) => i.youtube === undefined)).toBe(true);
    expect(count).toMatchObject({ search: 1, stats: 0 });
  });

  it("history across days: 3 creators on day D, 6 new ones on D+3 → growth 2 over 9 creators", async () => {
    const clone = (handles: string[], from: number) =>
      handles.map((h, i) => tt(h, "clone effect tutorial | CapCut", from + i));
    const day = setup();
    const d = await runEffects(day.env, {
      fetch: web({ hits: clone(["a", "b", "c"], 1) }).fetch,
      now: new Date("2026-10-04T05:35:00Z"),
    });
    expect(d.items[0]).toMatchObject({ key: "clone-effect", creators: 3, growth: 3 });

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
    const failed = await runEffects(broken.env, { fetch: web().fetch, now: NEXT_DAY });
    expect(failed).toMatchObject({ status: "failed", notes: ["error"], items: prev.items });
    expect(broken.KV.put).toHaveBeenCalledTimes(1);
  });
});
