import { describe, expect, it } from "vitest";
import type {
  FocusSession,
  MicroAction,
  Program,
  QuestCompletion,
  QuestType,
  Skill,
  XpEvent,
} from "./domain";
import {
  DAY_NAMES,
  focusSessionMinutes,
  inWeek,
  insights,
  MAX_INSIGHTS,
  weekHistory,
  weekStats,
  type WeekStats,
  type WeekStatsState,
} from "./weekStats";

/* ---------- Fixtures ---------- */

const WEEK = "2026-09-26"; // Saturday (Riyadh)
const PREV = "2026-09-19";

const programs: Program[] = [
  {
    id: "camera",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "الكاميرا", en: "Camera" },
    icon: "📷",
    color: "#4f8cff",
    sections: [{ id: "s", name: { ar: "س", en: "S" } }],
  },
  {
    id: "davinci",
    pillarId: "editing",
    kind: "app",
    name: { ar: "دافنشي", en: "DaVinci" },
    icon: "🎬",
    color: "#e0493b",
    sections: [{ id: "s", name: { ar: "س", en: "S" } }],
  },
];

const q = (s: string) => ({ ar: s, en: s });
function skill(id: string, programId: string, tier: 1 | 2 | 3 = 1): Skill {
  return {
    id,
    programId,
    sectionId: "s",
    name: q(id),
    tier,
    gear: "any",
    studio: false,
    source: "draft",
    quests: { train: q("t"), research: q("r"), produce: q("p"), article: q("a") },
    refs: [],
  };
}
const skills = [skill("shutter", "camera"), skill("bins", "davinci", 2), skill("cst", "davinci")];
const ctx = { skills, programs };

/** Noon Riyadh of a day key, offset by `h` hours. */
const at = (day: string, h = 12) => `${day}T${String(h).padStart(2, "0")}:00:00+03:00`;

let ids = 0;
function quest(skillId: string, type: QuestType, when: string, xp = 10) {
  const completion: QuestCompletion = { skillId, quest: type, at: when };
  const event: XpEvent = {
    id: `x${ids++}`,
    source: "quest",
    amount: xp,
    at: when,
    refId: `${skillId}:${type}`,
  };
  return { completion, event };
}
function micro(when: string): { action: MicroAction; event: XpEvent } {
  return {
    action: { id: `m${ids++}`, at: when, text: q("m") },
    event: { id: `x${ids++}`, source: "micro", amount: 3, at: when, refId: `m${ids}` },
  };
}
function focus(start: string, minutes: 25 | 60, ranMinutes: number = minutes): FocusSession {
  const s = new Date(start);
  return {
    id: `f${ids++}`,
    startedAt: s.toISOString(),
    minutes,
    endedAt: new Date(s.getTime() + ranMinutes * 60_000).toISOString(),
    early: ranMinutes < minutes,
  };
}

const empty: WeekStatsState = {
  completions: [],
  xpEvents: [],
  microActions: [],
  focusSessions: [],
};

function build(
  quests: ReturnType<typeof quest>[],
  micros: ReturnType<typeof micro>[] = [],
  focusSessions: FocusSession[] = [],
  extraEvents: XpEvent[] = [],
): WeekStatsState {
  return {
    completions: quests.map((x) => x.completion),
    xpEvents: [...quests.map((x) => x.event), ...micros.map((x) => x.event), ...extraEvents],
    microActions: micros.map((x) => x.action),
    focusSessions,
  };
}

/* ---------- weekStats ---------- */

describe("weekStats", () => {
  it("is all zeros for an empty week", () => {
    const s = weekStats(empty, WEEK, ctx);
    expect(s).toEqual({
      week: WEEK,
      xp: 0,
      quests: 0,
      mastered: 0,
      micro: 0,
      craftQuests: 0,
      softwareQuests: 0,
      focusMinutes: 0,
      activeDays: [],
      perDay: [0, 0, 0, 0, 0, 0, 0],
      bestDay: null,
      topPillarId: null,
      xpByPillar: {},
    });
  });

  it("counts quests, XP, the craft/software split and XP by pillar", () => {
    const state = build(
      [
        quest("shutter", "train", at("2026-09-27"), 10), // Sun, craft
        quest("bins", "train", at("2026-09-29"), 15), // Tue, software
        quest("cst", "research", at("2026-09-29", 18), 15), // Tue, software
      ],
      [micro(at("2026-10-01"))], // Thu
    );
    const s = weekStats(state, WEEK, ctx);
    expect(s.quests).toBe(3);
    expect(s.craftQuests).toBe(1);
    expect(s.softwareQuests).toBe(2);
    expect(s.xp).toBe(43); // 10 + 15 + 15 + 3 micro
    expect(s.micro).toBe(1);
    expect(s.activeDays).toEqual(["2026-09-27", "2026-09-29", "2026-10-01"]);
    expect(s.perDay).toEqual([0, 1, 0, 2, 0, 0, 0]);
    expect(s.bestDay).toBe(3); // Tuesday
    expect(s.xpByPillar).toEqual({ capture: 10, editing: 30 });
    expect(s.topPillarId).toBe("editing");
  });

  it("counts mastery bonuses in the week and never lists zero pillars", () => {
    const state = build(
      [quest("bins", "article", at("2026-09-30"), 45)],
      [],
      [],
      [{ id: "m", source: "mastery", amount: 20, at: at("2026-09-30"), refId: "bins" }],
    );
    const s = weekStats(state, WEEK, ctx);
    expect(s.mastered).toBe(1);
    expect(s.xp).toBe(65);
    expect(s.xpByPillar).toEqual({ editing: 65 });
    expect(Object.keys(s.xpByPillar)).not.toContain("capture");
  });

  it("keeps a review's XP in the week total but out of the pillar split", () => {
    const state = build(
      [],
      [],
      [],
      [{ id: "r", source: "review", amount: 10, at: at("2026-10-02"), refId: WEEK }],
    );
    const s = weekStats(state, WEEK, ctx);
    expect(s.xp).toBe(10);
    expect(s.xpByPillar).toEqual({});
    expect(s.topPillarId).toBeNull();
  });

  it("adds focus minutes for sessions started in the week, counting early stops as run", () => {
    const state = build(
      [],
      [],
      [
        focus(at("2026-09-27"), 25),
        focus(at("2026-09-28"), 60, 40), // stopped early after 40 min
        focus(at("2026-09-25"), 60), // Friday before the week
      ],
    );
    expect(weekStats(state, WEEK, ctx).focusMinutes).toBe(65);
    expect(focusSessionMinutes(focus(at("2026-09-28"), 25, 90))).toBe(25);
  });

  it("uses the Riyadh Saturday–Friday boundaries", () => {
    const state = build([
      quest("bins", "train", "2026-09-25T21:30:00Z", 15), // 00:30 Sat 26 Riyadh: in
      quest("bins", "research", "2026-10-02T20:59:00Z", 15), // 23:59 Fri 2 Riyadh: in
      quest("bins", "produce", "2026-10-02T21:00:00Z", 38), // 00:00 Sat 3 Riyadh: next week
      quest("cst", "train", "2026-09-25T20:59:00Z", 10), // 23:59 Fri 25 Riyadh: previous week
    ]);
    const s = weekStats(state, WEEK, ctx);
    expect(s.quests).toBe(2);
    expect(s.xp).toBe(30);
    expect(s.perDay[0]).toBe(1);
    expect(s.perDay[6]).toBe(1);
    expect(weekStats(state, "2026-10-03", ctx).quests).toBe(1);
    expect(weekStats(state, PREV, ctx).quests).toBe(1);
    expect(inWeek("2026-10-02T20:59:00Z", WEEK)).toBe(true);
    expect(inWeek("2026-10-02T21:00:00Z", WEEK)).toBe(false);
  });

  it("picks the earliest day on a tie for the best day", () => {
    const state = build([
      quest("bins", "train", at("2026-09-27")),
      quest("cst", "train", at("2026-09-30")),
    ]);
    expect(weekStats(state, WEEK, ctx).bestDay).toBe(1);
  });
});

/* ---------- weekHistory ---------- */

describe("weekHistory", () => {
  it("returns the requested number of weeks, oldest first, ending on the current week", () => {
    const h = weekHistory(empty, 8, "2026-09-30");
    expect(h).toHaveLength(8);
    expect(h[0].week).toBe("2026-08-08");
    expect(h[7].week).toBe(WEEK);
    expect(h.every((w) => w.xp === 0 && w.quests === 0 && w.activeDays === 0)).toBe(true);
  });

  it("buckets XP, quests and active days per week and ignores anything outside the window", () => {
    const state = build(
      [
        quest("bins", "train", at("2026-09-29"), 15),
        quest("cst", "train", at("2026-09-22"), 10),
        quest("cst", "research", at("2026-09-22", 20), 15),
        quest("shutter", "train", at("2026-08-01"), 10), // before the 8-week window
        quest("shutter", "research", at("2026-10-05"), 15), // after today (next week)
      ],
      [micro(at("2026-09-20"))],
    );
    const h = weekHistory(state, 8, new Date("2026-09-30T09:00:00+03:00"));
    const cur = h[7];
    const prev = h[6];
    expect(cur).toEqual({ week: WEEK, xp: 15, quests: 1, activeDays: 1 });
    expect(prev).toEqual({ week: PREV, xp: 28, quests: 2, activeDays: 2 });
    expect(h.slice(0, 6).every((w) => w.xp === 0)).toBe(true);
  });

  it("never returns fewer than one week", () => {
    expect(weekHistory(empty, 0, "2026-09-30")).toHaveLength(1);
  });
});

/* ---------- insights ---------- */

const base = (over: Partial<WeekStats> = {}): WeekStats => ({
  ...weekStats(empty, WEEK, ctx),
  ...over,
});
const extra = { skills, programs, completions: [] as QuestCompletion[] };

describe("insights", () => {
  it("points an empty week at the planner", () => {
    const list = insights(base(), null, extra);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "empty", go: "/planner" });
    expect(list[0].text.ar.length).toBeGreaterThan(0);
    expect(list[0].text.en.length).toBeGreaterThan(0);
  });

  it("names the best day and suggests the planner", () => {
    const stats = base({
      quests: 4,
      craftQuests: 2,
      softwareQuests: 2,
      perDay: [0, 0, 0, 3, 1, 0, 0],
      bestDay: 3,
      focusMinutes: 25,
    });
    const list = insights(stats, null, extra);
    expect(list.map((i) => i.id)).toEqual(["best-day"]);
    expect(list[0].text.ar).toContain(DAY_NAMES[3].ar);
    expect(list[0].text.en).toContain("Tuesday");
    expect(list[0].text.en).toContain("75%");
    expect(list[0].go).toBe("/planner");
  });

  it("flags a craft/software imbalance in either direction", () => {
    const soft = insights(
      base({ quests: 3, craftQuests: 0, softwareQuests: 3, focusMinutes: 1 }),
      null,
      extra,
    );
    expect(soft.map((i) => i.id)).toContain("balance-craft");
    const craft = insights(
      base({ quests: 4, craftQuests: 3, softwareQuests: 1, focusMinutes: 1 }),
      null,
      extra,
    );
    expect(craft.map((i) => i.id)).toContain("balance-software");
    const even = insights(
      base({ quests: 4, craftQuests: 2, softwareQuests: 2, focusMinutes: 1 }),
      null,
      extra,
    );
    expect(even.map((i) => i.id)).not.toContain("balance-craft");
    expect(even.map((i) => i.id)).not.toContain("balance-software");
  });

  it("compares XP with the previous week (±20 %)", () => {
    const prev = base({ xp: 100 });
    const up = insights(base({ xp: 150, quests: 1, focusMinutes: 1 }), prev, extra);
    expect(up.find((i) => i.id === "xp-up")?.text.en).toBe("XP up 50% on last week");
    const down = insights(base({ xp: 60, quests: 1, focusMinutes: 1 }), prev, extra);
    expect(down.find((i) => i.id === "xp-down")?.text.ar).toContain("40٪");
    const flat = insights(base({ xp: 110, quests: 1, focusMinutes: 1 }), prev, extra);
    expect(flat.map((i) => i.id)).not.toContain("xp-up");
    expect(
      insights(base({ xp: 50, quests: 1, focusMinutes: 1 }), base({ xp: 0 }), extra).map(
        (i) => i.id,
      ),
    ).not.toContain("xp-up");
  });

  it("spots a skill one quest from mastery", () => {
    const completions: QuestCompletion[] = (["train", "research", "produce"] as const).map((t) => ({
      skillId: "bins",
      quest: t,
      at: at("2026-09-20"),
    }));
    const list = insights(base({ quests: 1, focusMinutes: 1 }), null, { ...extra, completions });
    const near = list.find((i) => i.id === "near-bins");
    expect(near?.go).toBe("/skills");
    expect(near?.text.en).toContain("bins");
  });

  it("mentions a nearly beaten boss and a close season target", () => {
    const list = insights(base({ quests: 1, focusMinutes: 1 }), null, {
      ...extra,
      boss: { name: q("Ogre"), hp: 300, hpLeft: 60 },
      season: { name: q("Color"), questsDone: 8, target: 10, daysLeft: 5 },
    });
    expect(list.find((i) => i.id === "boss")).toMatchObject({ go: "/rewards" });
    expect(list.find((i) => i.id === "season")?.text.en).toBe("Color: 2 quests to the target");
    const far = insights(base({ quests: 1, focusMinutes: 1 }), null, {
      ...extra,
      boss: { name: q("Ogre"), hp: 300, hpLeft: 200 },
      season: { name: q("Color"), questsDone: 2, target: 10, daysLeft: 5 },
    });
    expect(far.map((i) => i.id)).not.toContain("boss");
    expect(far.map((i) => i.id)).not.toContain("season");
  });

  it("suggests a focus potion when quests were done without one", () => {
    const list = insights(base({ quests: 1, focusMinutes: 0 }), null, extra);
    expect(list.map((i) => i.id)).toEqual(["no-focus"]);
    expect(insights(base({ quests: 1, focusMinutes: 25 }), null, extra)).toEqual([]);
  });

  it("caps the list at four", () => {
    const completions: QuestCompletion[] = (["train", "research", "produce"] as const).map((t) => ({
      skillId: "bins",
      quest: t,
      at: at("2026-09-20"),
    }));
    const list = insights(
      base({
        xp: 200,
        quests: 5,
        craftQuests: 0,
        softwareQuests: 5,
        perDay: [0, 0, 4, 1, 0, 0, 0],
        bestDay: 2,
        focusMinutes: 0,
      }),
      base({ xp: 100 }),
      {
        ...extra,
        completions,
        boss: { name: q("Ogre"), hp: 300, hpLeft: 10 },
        season: { name: q("Color"), questsDone: 9, target: 10, daysLeft: 2 },
      },
    );
    expect(list).toHaveLength(MAX_INSIGHTS);
    expect(list.map((i) => i.id)).toEqual(["best-day", "balance-craft", "xp-up", "near-bins"]);
  });
});
