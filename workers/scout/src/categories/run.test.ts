import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TAVILY_USAGE_URL, usageKeys } from "../discover/usage";
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

/** A fake internet: every Tavily search answers `PROBE` unless `tavily` says otherwise; Tavily's /usage answers `usage`
 * (by default no figure: a 404, nothing kept); anything else is counted. */
function web(
  over: { tavily?: (query: string) => Response | undefined; usage?: () => Response } = {},
) {
  const count = { tavily: 0, usage: 0, other: 0 };
  const searched: string[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    if (String(input) === TAVILY_USAGE_URL) {
      count.usage++;
      return over.usage?.() ?? json({ error: "not_found" }, 404);
    }
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
  // A YouTube key too, so a YouTube call would really go out (and be counted): categories make none.
  const env = {
    TAVILY_API_KEY: "t",
    YOUTUBE_API_KEY: "y",
    AI,
    SOCIAL_KV: KV as unknown as KVNamespace,
  };
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
    // A figure Discover keeps (10 minutes) is used as it is: Tavily's /usage is never asked.
    expect(count.usage).toBe(0);
  });

  it("with no figure kept (the cron's usual case), asks Tavily's /usage once and keeps it: 95 % pauses", async () => {
    const { env, KV } = setup({ stored: OLD });
    const { fetch, count } = web({
      usage: () => json({ account: { plan_usage: 950, plan_limit: 1000 } }),
    });
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(doc).toMatchObject({ status: "failed", notes: ["tavily_budget"], items: OLD.items });
    expect(count).toEqual({ tavily: 0, usage: 1, other: 0 });
    // Kept 10 minutes, as Discover keeps it (the next slots read it), then the paused page.
    expect(KV.put.mock.calls[0]).toEqual([
      usageKeys.tavily,
      JSON.stringify({ used: 950, limit: 1000 }),
      { expirationTtl: 600 },
    ]);
    expect(writes(KV)).toEqual([usageKeys.tavily, KEY]);
  });

  it("with no figure kept and Tavily's /usage failing, the month is unknown: not tight, the scan runs", async () => {
    const { env, KV } = setup({ stored: OLD });
    const { fetch, count } = web({ usage: () => json({ error: "upstream" }, 500) });
    expect(await runCategory(env, "cars", { fetch, now: NOW })).toMatchObject({ status: "ok" });
    expect(count).toEqual({ tavily: 6, usage: 1, other: 0 });
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
  });

  it("answers a page scanned fine today before looking at the budget: a tight month pauses nothing, writes nothing", async () => {
    const today: CategoryDoc = { ...OLD, ranOn: "2026-10-07", updatedAt: NOW.toISOString() };
    const { env, KV } = setup({ stored: today });
    KV.store.set(usageKeys.tavily, JSON.stringify({ used: 950, limit: 1000 }));
    const { fetch, count } = web();
    expect(await runCategory(env, "cars", { fetch, now: LATER })).toEqual(today);
    expect(count).toEqual({ tavily: 0, usage: 0, other: 0 });
    expect(KV.put).not.toHaveBeenCalled();
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
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
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
    // The lost save is logged (Workers Logs), counts only.
    expect(error).toHaveBeenCalledExactlyOnceWith(
      JSON.stringify({ category: { write: "failed" } }),
    );
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

describe("runCategory's lessons (§3)", () => {
  const HOW = {
    en: "Pan with the car at 1/30 s and keep it sharp, then add motion blur in the edit.",
    ar: "تابع السيارة بالكاميرا على 1/30 وخلّها حادة، وبعدين زيد البلر في المونتاج.",
  };
  const pick = (en: string, query: string) => ({ name: { en, ar: `اسم ${en}` }, query });
  const PICKS = {
    photo: [
      pick("panning", "car panning"),
      pick("light painting", "car light painting"),
      pick("hero shot", "car hero shot"),
    ],
    video: [
      pick("rolling shot", "car rolling shot"),
      pick("drone chase", "drone car chase"),
      pick("gimbal reveal", "gimbal car reveal"),
    ],
    edit: [
      pick("speed ramp", "speed ramp car"),
      pick("sound design", "car sound design"),
      pick("color grade", "car color grade"),
    ],
  };
  /** Last week's page: its lessons are 8 days old, so they are due. */
  const LAST_WEEK: CategoryDoc = {
    ...OLD,
    lessons: { ...OLD.lessons!, updatedAt: "2026-09-29T05:40:00.000Z" },
  };
  /** The cleanup of the fake above, plus the lessons' calls: PICKS, then each area's how-tos (its first technique
   * linked to a skill); `onPick` runs when the pick is asked. */
  function lessonsAi(howTos?: unknown, onPick = () => {}) {
    const cleanup = ai();
    return {
      run: vi.fn(async (model: string, input: Record<string, unknown>): Promise<unknown> => {
        const [system, user] = (input.messages as { content: string }[]).map((m) => m.content);
        if (system.startsWith("You plan")) {
          onPick();
          return { response: PICKS };
        }
        if (system.startsWith("You write")) {
          const techniques = [...user.matchAll(/^- (\d+) \|/gm)].map(([, i]) => ({
            i: Number(i),
            howTo: HOW,
            ...(i === "0" ? { skillId: "phone-180-shutter" } : {}),
          }));
          return { response: howTos ?? { techniques } };
        }
        return cleanup.run(model, input);
      }),
    };
  }
  /** The system prompts the AI was asked with, in order. */
  const asked = (run: { mock: { calls: unknown[][] } }) =>
    run.mock.calls.map(
      ([, input]) => (input as { messages: { content: string }[] }).messages[0].content,
    );

  it("a scan with lessons due refreshes them after saving the trends: 9 + 1 more searches", async () => {
    const { env, KV } = setup();
    env.AI = lessonsAi();
    const { fetch, count, searched } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    // PROBE answers every search: its TikTok / Instagram posts are the examples, its "tutorial" title the tutorial.
    expect(count.tavily).toBe(16);
    // Lessons find their YouTube videos through Tavily: no YouTube call (the env has YouTube's key).
    expect(count.other).toBe(0);
    expect(searched).toContain("car panning tutorial");
    expect(searched).toContain("شرح تصوير ومونتاج سيارات");
    expect(writes(KV)).toEqual([ATTEMPTS, KEY, KEY]);
    // The trends were saved first, without lessons: a refresh that never ends still leaves them saved.
    const trends = JSON.parse(KV.put.mock.calls[1][1]) as CategoryDoc;
    expect(trends.items).toEqual(doc.items);
    expect(trends.lessons).toBeUndefined();
    // The cleanup, the pick, then one how-to call an area: at most 7 AI calls a run.
    const systems = asked(env.AI.run);
    expect(systems.filter((s) => s.startsWith("You write"))).toHaveLength(3);
    expect(systems.length).toBeLessThanOrEqual(7);
    expect(doc.lessons!.photo).toHaveLength(3);
    expect(doc.lessons!.photo[0]).toMatchObject({ skillId: "phone-180-shutter", howTo: HOW });
    expect(doc.lessons!.video[0].videos.map((v) => v.kind)).toEqual([
      "example",
      "example",
      "tutorial",
    ]);
    expect(stored(KV).lessons).toEqual(doc.lessons);
    expect(stored(KV).diagnostics).toMatchObject({
      lessons: { picked: 9, written: 9, credits: 10 },
    });
    expect(doc.notes ?? []).not.toContain("lessons");
  });

  it("lessons under 6 days old stay as they are", async () => {
    const { env, KV } = setup({ stored: OLD }); // 3 days old
    env.AI = lessonsAi();
    const { fetch, count } = web();
    await runCategory(env, "cars", { fetch, now: NOW });
    expect(stored(KV).lessons).toEqual(OLD.lessons);
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
    expect(count.tavily).toBe(6);
  });

  it("a refresh that keeps nothing keeps last week's lessons, noted 'lessons'", async () => {
    const { env, KV } = setup({ stored: LAST_WEEK });
    env.AI = lessonsAi({ techniques: "nope" });
    const doc = await runCategory(env, "cars", { fetch: web().fetch, now: NOW });
    expect(doc.lessons).toEqual(LAST_WEEK.lessons);
    expect(doc.notes).toContain("lessons");
    expect(writes(KV)).toEqual([ATTEMPTS, KEY, KEY]);
    expect(stored(KV).diagnostics).toMatchObject({
      lessons: { picked: 9, written: 0, failed: 3 },
    });
  });

  it("an area whose how-to call fails keeps last week's techniques there; the others are new", async () => {
    const { env, KV } = setup({ stored: LAST_WEEK });
    const answering = lessonsAi();
    env.AI = {
      run: vi.fn(async (model: string, input: Record<string, unknown>): Promise<unknown> => {
        const [system, user] = (input.messages as { content: string }[]).map((m) => m.content);
        // The videography call answers nothing.
        if (system.startsWith("You write") && / \| video \| /.test(user)) return { response: {} };
        return answering.run(model, input);
      }),
    };
    const doc = await runCategory(env, "cars", { fetch: web().fetch, now: NOW });
    expect(doc.lessons!.updatedAt).toBe(NOW.toISOString());
    expect(doc.lessons!.video).toEqual(LAST_WEEK.lessons!.video);
    expect(doc.lessons!.photo.map((t) => t.name.en)).toEqual([
      "panning",
      "light painting",
      "hero shot",
    ]);
    expect(doc.notes ?? []).not.toContain("lessons");
    expect(stored(KV).lessons).toEqual(doc.lessons);
    expect(stored(KV).diagnostics).toMatchObject({ lessons: { written: 6, failed: 1 } });
  });

  it("a refresh that throws keeps last week's lessons, noted 'lessons'", async () => {
    const { env, KV } = setup({ stored: LAST_WEEK });
    const cleanup = ai();
    env.AI = {
      run: vi.fn(async (model: string, input: Record<string, unknown>): Promise<unknown> => {
        const [system] = (input.messages as { content: string }[]).map((m) => m.content);
        // A pick whose reading throws: a code error inside the refresh, not a missing answer.
        if (system.startsWith("You plan"))
          return {
            response: {
              get photo(): never {
                throw new Error("boom");
              },
            },
          };
        return cleanup.run(model, input);
      }),
    };
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(doc.lessons).toEqual(LAST_WEEK.lessons);
    expect(doc.notes).toContain("lessons");
    expect(count.tavily).toBe(6);
    expect(writes(KV)).toEqual([ATTEMPTS, KEY, KEY]);
    expect(stored(KV).lessons).toEqual(LAST_WEEK.lessons);
    expect(stored(KV).diagnostics).toMatchObject({ lessons: { error: "boom" } });
  });

  it("without the AI binding no refresh is tried, and the page is saved once", async () => {
    const { KV } = setup();
    const noAi = {
      TAVILY_API_KEY: "t",
      YOUTUBE_API_KEY: "y",
      SOCIAL_KV: KV as unknown as KVNamespace,
    };
    const { fetch, count } = web();
    await runCategory(noAi, "cars", { fetch, now: NOW });
    expect(count.tavily).toBe(6);
    expect(count.other).toBe(0);
    expect(writes(KV)).toEqual([ATTEMPTS, KEY]);
  });

  it("a tight month pauses the lessons with the scan: no search, no AI, last week's lessons kept", async () => {
    const { env, KV } = setup({ stored: LAST_WEEK });
    env.AI = lessonsAi();
    KV.store.set(usageKeys.tavily, JSON.stringify({ used: 950, limit: 1000 }));
    const { fetch, count } = web();
    const doc = await runCategory(env, "cars", { fetch, now: NOW });
    expect(count).toEqual({ tavily: 0, usage: 0, other: 0 });
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(doc).toMatchObject({
      status: "failed",
      notes: ["tavily_budget"],
      lessons: LAST_WEEK.lessons,
    });
    expect(writes(KV)).toEqual([KEY]);
  });
});
