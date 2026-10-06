import { describe, expect, it } from "vitest";
import {
  creatorsBetween,
  daysBetween,
  mergeHistory,
  scoreEffects,
  setViews,
  youtubeGrowth,
} from "./score";
import { HISTORY_KEYS, type Candidate, type EffectMeta, type HistoryEntry } from "./types";

const cand = (key: string, ids: string[], termId?: string): Candidate => ({
  key,
  name: key.replace(/-/g, " "),
  ...(termId ? { termId } : {}),
  ids: new Set(ids),
  posts: ids.length,
  platforms: new Set(["tt"]),
  samples: [],
});
const meta = (key: string, termId?: string): EffectMeta => ({
  name: { en: key.replace(/-/g, " ") },
  ...(termId ? { termId } : {}),
  checked: true,
  platforms: ["tt"],
  posts: 3,
  samples: [],
});

describe("scoring", () => {
  it("days between UTC days", () => {
    expect(daysBetween("2026-10-01", "2026-10-06")).toBe(5);
  });

  it("adds today's ids (≤ 30), drops entries older than 14 days, keeps ≤ 400 keys", () => {
    const old: Record<string, HistoryEntry[]> = { gone: [{ day: "2026-09-20", ids: ["x"] }] };
    const merged = mergeHistory(
      old,
      "2026-10-06",
      new Map([
        [
          "clone-effect",
          cand(
            "clone-effect",
            Array.from({ length: 40 }, (_, i) => `i${i}`),
          ),
        ],
      ]),
    );
    expect(merged.gone).toBeUndefined();
    expect(merged["clone-effect"]).toEqual([{ day: "2026-10-06", ids: expect.any(Array) }]);
    expect(merged["clone-effect"][0].ids).toHaveLength(30);
  });

  it("keeps the 400 keys with the most creators this week", () => {
    expect(HISTORY_KEYS).toBe(400);
    const history: Record<string, HistoryEntry[]> = {};
    for (let i = 0; i <= HISTORY_KEYS; i++)
      history[`k${i}`] = [{ day: "2026-10-05", ids: i ? ["a", "b"] : ["a"] }];
    const merged = mergeHistory(history, "2026-10-06", new Map());
    expect(Object.keys(merged)).toHaveLength(HISTORY_KEYS);
    expect(merged.k0).toBeUndefined();
  });

  it("on a tie at the cut, keeps the key seen most recently", () => {
    const history: Record<string, HistoryEntry[]> = {};
    for (let i = 0; i < HISTORY_KEYS; i++) history[`old${i}`] = [{ day: "2026-10-01", ids: ["a"] }];
    const merged = mergeHistory(history, "2026-10-06", new Map([["fresh", cand("fresh", ["z"])]]));
    expect(Object.keys(merged)).toHaveLength(HISTORY_KEYS);
    expect(merged.fresh).toBeDefined();
  });

  it("at the cut, keeps dictionary and AI-approved keys first, before more creators or newer days", () => {
    const history: Record<string, HistoryEntry[]> = {
      approved: [{ day: "2026-10-01", ids: ["a"] }], // 1 creator, 5 days ago
    };
    for (let i = 0; i < HISTORY_KEYS; i++)
      history[`busy${i}`] = [{ day: "2026-10-05", ids: ["a", "b"] }];
    const merged = mergeHistory(history, "2026-10-06", new Map(), new Set(["approved"]));
    expect(Object.keys(merged)).toHaveLength(HISTORY_KEYS);
    expect(merged.approved).toBeDefined();
  });

  it("keeps 13-day-old entries, drops 14-day-old ones, and replaces today's entry on a re-run", () => {
    const merged = mergeHistory(
      {
        k: [
          { day: "2026-09-22", ids: ["old"] },
          { day: "2026-09-23", ids: ["kept"] },
          { day: "2026-10-06", ids: ["first-run"] },
        ],
        gone: [{ day: "2026-10-06", ids: ["x"] }],
      },
      "2026-10-06",
      new Map([["k", cand("k", ["re-run"])]]),
    );
    expect(merged).toEqual({
      k: [
        { day: "2026-09-23", ids: ["kept"] },
        { day: "2026-10-06", ids: ["re-run"] },
      ],
    });
  });

  it("unions creators over windows and computes growth between 3-day windows", () => {
    const entries: HistoryEntry[] = [
      { day: "2026-10-01", ids: ["a"] },
      { day: "2026-10-04", ids: ["a", "b"] },
      { day: "2026-10-06", ids: ["b", "c", "d"] },
    ];
    expect([...creatorsBetween(entries, "2026-10-06", 0, 6)].sort()).toEqual(["a", "b", "c", "d"]);
    expect(creatorsBetween(entries, "2026-10-06", 0, 2).size).toBe(4); // days 0-2: 10-04 and 10-06
    expect(creatorsBetween(entries, "2026-10-06", 3, 5).size).toBe(1); // day 5: 10-01
  });

  it("ranks by creators × growth, needs 3 creators, marks NEW only outside the dictionary", () => {
    const history: Record<string, HistoryEntry[]> = {
      "clone-effect": [{ day: "2026-10-06", ids: ["a", "b", "c", "d"] }],
      "swagger-trend": [{ day: "2026-10-06", ids: ["a", "b", "c"] }],
      "lonely-effect": [{ day: "2026-10-06", ids: ["a", "b"] }],
      "speed-ramp": [
        { day: "2026-10-01", ids: ["a", "b", "c", "d", "e", "f"] },
        { day: "2026-10-05", ids: ["a", "b", "c"] },
      ],
    };
    const items = scoreEffects(
      history,
      {
        "clone-effect": meta("clone-effect", "clone-effect"),
        "swagger-trend": meta("swagger-trend"),
        "lonely-effect": meta("lonely-effect"),
        "speed-ramp": meta("speed-ramp", "speed-ramp"),
      },
      "2026-10-06",
      {},
    );
    expect(items.map((i) => i.key)).toEqual(["clone-effect", "swagger-trend", "speed-ramp"]);
    expect(items.find((i) => i.key === "swagger-trend")).toMatchObject({
      isNew: true,
      creators: 3,
      growth: 3,
    });
    expect(items.find((i) => i.key === "clone-effect")).toMatchObject({
      isNew: false,
      creators: 4,
    });
    expect(items.find((i) => i.key === "speed-ramp")!.growth).toBeCloseTo(0.5, 5); // 3 recent vs 6 before
  });

  it("shows the top 8; an equal score goes to the effect first seen more recently", () => {
    const abc = ["a", "b", "c"];
    const history: Record<string, HistoryEntry[]> = {
      older: [{ day: "2026-10-04", ids: abc }],
      newer: [{ day: "2026-10-05", ids: abc }],
    };
    // Steady effects: the same 3 creators in both 3-day windows (growth 1, a lower score).
    for (let i = 0; i < 9; i++)
      history[`steady-${i}`] = [
        { day: "2026-10-02", ids: abc },
        { day: "2026-10-06", ids: abc },
      ];
    const metas = Object.fromEntries(Object.keys(history).map((k) => [k, meta(k)]));
    const items = scoreEffects(history, metas, "2026-10-06", {});
    expect(items).toHaveLength(8);
    expect(items.slice(0, 2).map((i) => i.key)).toEqual(["newer", "older"]);
  });

  it("leaves out a fading effect: 3 creators or more, but none in the last 3 days (score 0)", () => {
    const abc = ["a", "b", "c"];
    const history: Record<string, HistoryEntry[]> = {
      // Seen only 6 days ago, and only in days 3–5: growth 0 either way.
      faded: [{ day: "2026-09-30", ids: abc }],
      cooling: [
        { day: "2026-10-01", ids: abc },
        { day: "2026-10-03", ids: ["d"] },
      ],
      steady: [
        { day: "2026-10-02", ids: abc },
        { day: "2026-10-06", ids: abc },
      ],
    };
    const items = scoreEffects(
      history,
      { faded: meta("faded"), cooling: meta("cooling"), steady: meta("steady") },
      "2026-10-06",
      {},
    );
    expect(items.map((i) => [i.key, i.growth])).toEqual([["steady", 1]]);
  });

  it("stops marking an effect NEW 7 days after it was first seen", () => {
    const history = {
      old: [
        { day: "2026-09-29", ids: ["z"] },
        { day: "2026-10-06", ids: ["a", "b", "c"] },
      ],
    };
    const [item] = scoreEffects(history, { old: meta("old") }, "2026-10-06", {});
    expect(item).toMatchObject({ isNew: false, creators: 3 });
  });

  it("YouTube growth compares today's views with the last earlier views and boosts the score", () => {
    const entries: HistoryEntry[] = [
      { day: "2026-10-03", ids: ["a"], views7d: 1000 },
      { day: "2026-10-06", ids: ["a", "b", "c"], views7d: 3000 },
    ];
    expect(youtubeGrowth(entries, "2026-10-06")).toBe(3);
    // y has x's creators and growth and was first seen more recently: only the boost puts x first.
    const history = { x: entries, y: sameAsXButNewer };
    setViews(history, "2026-10-06", { x: 3000 });
    const items = scoreEffects(history, { x: meta("x"), y: meta("y") }, "2026-10-06", {
      x: { newVideos: 12, views7d: 3000 },
    });
    expect(items.map((i) => i.key)).toEqual(["x", "y"]);
    expect(items[0].youtube).toEqual({ newVideos: 12, views7d: 3000, growth: 3 });
  });

  it("boosts only at a real 1.5× (1.46× shows as 1.5 but gets no boost)", () => {
    const history = {
      x: [
        { day: "2026-10-03", ids: ["a"], views7d: 1000 },
        { day: "2026-10-06", ids: ["a", "b", "c"], views7d: 1460 },
      ],
      y: sameAsXButNewer,
    };
    expect(youtubeGrowth(history.x, "2026-10-06")).toBe(1.5);
    const items = scoreEffects(history, { x: meta("x"), y: meta("y") }, "2026-10-06", {});
    expect(items.map((i) => i.key)).toEqual(["y", "x"]);
  });
});

/** 3 creators, growth 3, first seen 2026-10-04: ties with the "x" effects above, which were first seen on 10-03. */
const sameAsXButNewer: HistoryEntry[] = [
  { day: "2026-10-04", ids: ["a"] },
  { day: "2026-10-06", ids: ["a", "b", "c"] },
];
