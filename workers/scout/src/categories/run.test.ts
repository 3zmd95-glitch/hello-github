import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usageKeys } from "../discover/usage";
import { TAVILY_URL } from "../trends/tavily";
import { aiContext, categoryById } from "./defs";
import { monthTight, runCategory } from "./run";
import type { CategoryDoc, Technique } from "./types";

const NOW = new Date("2026-10-07T05:40:00Z"); // 2026-10-07 is UTC day % 3 = 0: cars' turn, slot 05:40
const LATER = new Date("2026-10-07T18:00:00Z");
const KEY = "category:cars";
const ATTEMPTS = "category:attempts:cars:2026-10-07";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Hit = { url: string; title: string; content: string };
const tt = (handle: string, title: string, n: number): Hit => ({
  url: `https://www.tiktok.com/@${handle}/video/${n}`,
  title,
  content: "#carsoftiktok",
});
const ig = (handle: string, title: string, n: number): Hit => ({
  url: `https://www.instagram.com/${handle}/reel/R${n}/`,
  title,
  content: "#caredit",
});

/** Car posts: rolling shots by 4 creators, low angles by 3, a speed ramp (a dictionary technique) by 4, generic captions. */
const PROBE: Hit[] = [
  tt("r1", "Rolling shot of my M4 at sunset 🔥 #rollingshot", 1),
  tt("r2", "rolling shots on the highway", 2),
  ig("r3", "Cinematic Rolling Shot | BMW M3", 3),
  ig("r4", "rolling shot tutorial with a gimbal", 4),
  tt("l1", "Low Angle hero shot of the GT3", 5),
  tt("l2", "low angle car shot", 6),
  tt("l3", "low angle reveal", 7),
  tt("s1", "speed ramp car edit 🔥", 8),
  tt("s2", "speed ramp on the drift", 9),
  tt("s3", "speed ramp transition car edit", 10),
  tt("s4", "my speed ramp edit", 11),
  tt("g1", "car edit trend #caredit", 12),
  tt("g2", "cinematic car edit", 13),
];

/** A fake internet: every Tavily search answers `PROBE` unless `tavily` says otherwise; anything else is counted. */
function web(over: { tavily?: (query: string) => Response | undefined } = {}) {
  const count = { tavily: 0, other: 0 };
  const searched: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (String(input) !== TAVILY_URL) {
      count.other++;
      return json({ error: "not_found" }, 404);
    }
    count.tavily++;
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    searched.push(query);
    return over.tavily?.(query) ?? json({ results: PROBE, usage: { credits: 1 } });
  });
  return { fetch, count, searched };
}

/** A fake built-in AI: the cleanup keeps every name it is shown, as it was written. Any other call (Task 3's
 * lessons) gets no usable answer here. */
function ai() {
  return {
    run: vi.fn(async (_model: string, input: Record<string, unknown>): Promise<unknown> => {
      const [system, user] = (input.messages as { content: string }[]).map((m) => m.content);
      if (!system.startsWith("You clean")) return { response: {} };
      const effects = [...user.matchAll(/^- key: (\S+) \| name: (.+?) \| posts:/gm)].map(
        ([, key, name]) => ({
          key,
          keep: true,
          name: { en: name.slice(0, 40), ar: "اسم الستايل" },
          what: { en: `What ${name} looks like`.slice(0, 90), ar: "وصف قصير للستايل" },
        }),
      );
      return { response: { effects } };
    }),
  };
}

function setup(over: { stored?: CategoryDoc } = {}) {
  const store = new Map<string, string>();
  if (over.stored) store.set(KEY, JSON.stringify(over.stored));
  const KV = {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    // The attempt counter's 3rd argument (its TTL) is not needed here.
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
  const AI = ai();
  const env = { TAVILY_API_KEY: "t", AI, SOCIAL_KV: KV as unknown as KVNamespace };
  return { env, KV, AI };
}
type FakeKV = ReturnType<typeof setup>["KV"];
const stored = (KV: FakeKV) => JSON.parse(KV.store.get(KEY)!) as CategoryDoc;
/** The keys written, in order. */
const writes = (KV: FakeKV) => KV.put.mock.calls.map(([key]) => key);

const TECHNIQUE: Technique = {
  name: { en: "rolling shot", ar: "لقطة متحركة" },
  howTo: {
    en: "Shoot from a car driving beside it at 1/30 s, then steady it in the edit.",
    ar: "صوّر من سيارة ماشية جنبها على 1/30، وبعدين ثبّتها في المونتاج.",
  },
  videos: [
    {
      url: "https://www.youtube.com/watch?v=rollTut0001",
      title: "Rolling shot tutorial",
      platform: "yt",
      kind: "tutorial",
      lang: "en",
    },
  ],
};
/** The page of 3 days ago; its lessons are 3 days old, so they are not due. */
const OLD: CategoryDoc = {
  ranOn: "2026-10-04",
  updatedAt: "2026-10-04T05:40:00.000Z",
  status: "ok",
  items: [
    {
      key: "rolling-shot",
      name: { en: "rolling shot" },
      isNew: true,
      checked: true,
      creators: 5,
      posts: 6,
      platforms: ["tt"],
      growth: 3,
      samples: [],
    },
  ],
  lessons: { updatedAt: "2026-10-04T05:40:00.000Z", photo: [], video: [TECHNIQUE], edit: [] },
  meta: {},
  history: {},
};

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("monthTight (§4: 90 % of the month's credits)", () => {
  it("counts a positive pay-as-you-go limit in the month; no figure or no plan limit is not tight", () => {
    expect(monthTight(null)).toBe(false);
    expect(monthTight({ used: 950, limit: null })).toBe(false);
    expect(monthTight({ used: 899, limit: 1000 })).toBe(false);
    expect(monthTight({ used: 900, limit: 1000 })).toBe(true);
    expect(monthTight({ used: 1000, limit: 1000, paygoUsed: 400, paygoLimit: 625 })).toBe(false); // 86 %
    expect(monthTight({ used: 1000, limit: 1000, paygoUsed: 500, paygoLimit: 625 })).toBe(true); // 92 %
    // No known pay-as-you-go allowance: the plan alone.
    expect(monthTight({ used: 950, limit: 1000, paygoLimit: null })).toBe(true);
  });
});

describe("runCategory", () => {
  it("a first scan: 2 queries × 3 searches, camera words named, the category's own words never, trends first", async () => {
    const { env, KV, AI } = setup();
    const { fetch, count, searched } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW });

    expect(doc.items.map((i) => i.key)).toEqual(["rolling-shot", "low-angle", "speed-ramp"]);
    expect(doc.items[0]).toMatchObject({
      name: { en: "rolling shot" },
      creators: 4,
      isNew: true,
      growth: 3,
    });
    // The dictionary technique has as many creators as the top trend, and still comes after the trends.
    expect(doc.items[2]).toMatchObject({ termId: "speed-ramp", creators: 4, isNew: false });
    expect(Object.keys(doc.meta).filter((k) => /(^|-)(car|cars|cinematic)(-|$)/.test(k))).toEqual(
      [],
    );
    expect(doc).toMatchObject({ ranOn: "2026-10-07", updatedAt: NOW.toISOString(), status: "ok" });
    // 6 credits, and nothing but Tavily: no YouTube for categories.
    expect(count.tavily).toBe(6);
    expect(count.other).toBe(0);
    expect([...new Set(searched)]).toEqual(["car edit trend", "cinematic car edit"]);
    const system = (AI.run.mock.calls[0][1].messages as { content: string }[])[0].content;
    expect(system.endsWith(aiContext(categoryById("cars")!))).toBe(true);
    // A spending run counts itself, then saves. A lessons refresh (Task 3) may save once more after that.
    expect(writes(KV).slice(0, 2)).toEqual([ATTEMPTS, KEY]);
    expect(stored(KV).items).toEqual(doc.items);
    expect(stored(KV).diagnostics).toMatchObject({
      id: "cars",
      credits: 6,
      families: [{ family: 1 }, { family: 2 }],
    });
  });

  it("once a UTC day; force scans again; every spending run counts, forced ones too: the 4th answers 'attempts'", async () => {
    const { env, KV } = setup({ stored: OLD });
    const { fetch, count } = web();
    await runCategory(env, "cars", { fetch, now: NOW });
    expect(count.tavily).toBe(6);
    // Later the same UTC day, not forced: the stored page, nothing spent.
    expect((await runCategory(env, "cars", { fetch, now: LATER })).updatedAt).toBe(
      NOW.toISOString(),
    );
    expect(count.tavily).toBe(6);
    await runCategory(env, "cars", { fetch, now: LATER, force: true });
    await runCategory(env, "cars", { fetch, now: LATER, force: true });
    expect(count.tavily).toBe(18);
    expect(KV.store.get(ATTEMPTS)).toBe("3");
    const capped = await runCategory(env, "cars", { fetch, now: LATER, force: true });
    expect(count.tavily).toBe(18);
    expect(capped).toMatchObject({ status: "ok", updatedAt: LATER.toISOString() });
    expect(capped.notes).toContain("attempts");
    // Over the cap nothing is written.
    expect(stored(KV).notes ?? []).not.toContain("attempts");
  });

  it("pauses at 90 % of the month's credits: nothing spent or counted, the last page and lessons kept, noted", async () => {
    const { env, KV, AI } = setup({ stored: OLD });
    KV.store.set(usageKeys.tavily, JSON.stringify({ used: 950, limit: 1000 }));
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(count.tavily).toBe(0);
    expect(AI.run).not.toHaveBeenCalled();
    expect(doc).toMatchObject({
      status: "failed",
      notes: ["tavily_budget"],
      ranOn: "2026-10-07",
      updatedAt: OLD.updatedAt,
      items: OLD.items,
      lessons: OLD.lessons,
    });
    expect(writes(KV)).toEqual([KEY]);
    // Pay-as-you-go room left (1,100 of 1,625): the retry the same day scans.
    KV.store.set(
      usageKeys.tavily,
      JSON.stringify({ used: 1000, limit: 1000, paygoUsed: 100, paygoLimit: 625 }),
    );
    await runCategory(env, "cars", { fetch, now: NOW });
    expect(count.tavily).toBe(6);
  });

  it("Tavily refusing every search: failed, the last page and lessons kept, the attempt counted", async () => {
    const { env, KV } = setup({ stored: OLD });
    const { fetch } = web({ tavily: () => json({ error: "plan limit" }, 432) });
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(doc).toMatchObject({
      status: "failed",
      notes: ["quota"],
      updatedAt: OLD.updatedAt,
      items: OLD.items,
      lessons: OLD.lessons,
    });
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
  });

  it("KV trouble: an unreadable page spends and writes nothing; a counter or a save that fails is noted", async () => {
    const unreadable = setup({ stored: OLD });
    unreadable.KV.get.mockRejectedValue(new Error("KV GET failed: 500"));
    const searched = web();
    expect(
      await runCategory(unreadable.env, "cars", { fetch: searched.fetch, now: NOW }),
    ).toMatchObject({ status: "failed", notes: ["kv"] });
    expect(searched.count.tavily).toBe(0);
    expect(unreadable.KV.put).not.toHaveBeenCalled();

    const unwritable = setup({ stored: OLD });
    unwritable.KV.put.mockRejectedValue(new Error("KV PUT failed: 500"));
    const doc = await runCategory(unwritable.env, "cars", { fetch: web().fetch, now: NOW });
    expect(doc).toMatchObject({ status: "ok", ranOn: "2026-10-07" });
    expect(doc.notes).toEqual(["attempts_kv", "kv"]);
  });

  it("keeps at most 200 names in a category's memory, today's names first", async () => {
    const history = Object.fromEntries(
      Array.from({ length: 260 }, (_, i) => [`old-${i}`, [{ day: "2026-10-04", ids: ["a"] }]]),
    );
    const meta = Object.fromEntries(
      Object.keys(history).map((k) => [
        k,
        { name: { en: k }, checked: false, platforms: ["tt" as const], posts: 1, samples: [] },
      ]),
    );
    const { env } = setup({ stored: { ...OLD, history, meta } });
    const doc = await runCategory(env, "cars", { fetch: web().fetch, now: NOW });
    expect(Object.keys(doc.history)).toHaveLength(200);
    expect(doc.history["rolling-shot"]).toBeDefined();
    expect((doc.diagnostics as { trimmed: number }).trimmed).toBeGreaterThan(0);
  });

  it("answers an unknown category with a failed page, reading and writing nothing", async () => {
    const { env, KV } = setup();
    expect(await runCategory(env, "drift", { fetch: web().fetch, now: NOW })).toMatchObject({
      status: "failed",
      notes: ["unknown"],
    });
    expect(KV.get).not.toHaveBeenCalled();
    expect(KV.put).not.toHaveBeenCalled();
  });
});
