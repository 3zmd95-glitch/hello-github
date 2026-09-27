import { describe, expect, it } from "vitest";
import { skillsByProgram } from "@/data";
import {
  BADGES,
  getBadge,
  hasMasteredRegion,
  nationalDayQuests,
  newBadges,
  type BadgeContext,
} from "./badges";
import type { QuestCompletion } from "./domain";

const emptyCtx = (over: Partial<BadgeContext> = {}): BadgeContext => ({
  completions: [],
  microActions: [],
  xpEvents: [],
  streak: { current: 0, best: 0, todayDone: false },
  masteredSkillIds: new Set(),
  programLevels: {},
  pillarLevels: {},
  chestsOpened: 0,
  focusSessions: [],
  reviews: [],
  bossesDefeated: [],
  seasonsFinished: [],
  now: new Date("2026-09-26T10:00:00Z"),
  ...over,
});

const q = (skillId: string, quest: QuestCompletion["quest"], at: string, proofUrl?: string) => ({
  skillId,
  quest,
  at,
  ...(proofUrl ? { proofUrl } : {}),
});

describe("badges", () => {
  it("has the required catalogue with unique ids and bilingual copy", () => {
    const ids = BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      "first-mastery",
      "streak-7",
      "streak-30",
      "quests-10",
      "quests-50",
      "quests-100",
      "first-proof",
      "first-article",
      "first-region",
      "first-island",
      "pillar-5",
      "first-chest",
      "focus-10",
      "first-review",
      "boss-slayer",
      "season-finisher",
      "green-green",
    ])
      expect(ids, id).toContain(id);
    for (const b of BADGES) {
      expect(b.icon).toBeTruthy();
      expect(b.name.ar && b.name.en && b.desc.ar && b.desc.en).toBeTruthy();
    }
    expect(getBadge("first-chest")?.icon).toBe("📦");
    expect(getBadge("nope")).toBeUndefined();
  });

  it("nothing is earned on an empty context", () => {
    expect(newBadges(emptyCtx(), [])).toEqual([]);
  });

  it("skips badges already earned", () => {
    const ctx = emptyCtx({ chestsOpened: 1, reviews: [{} as never] });
    expect(newBadges(ctx, []).map((b) => b.id)).toEqual(["first-chest", "first-review"]);
    expect(newBadges(ctx, [{ id: "first-chest", at: "x" }]).map((b) => b.id)).toEqual([
      "first-review",
    ]);
  });

  it("counts quests, proofs, articles, streaks and levels", () => {
    const many = Array.from({ length: 50 }, (_, i) => q("a", "train", `2026-09-${(i % 28) + 1}`));
    const ids = newBadges(
      emptyCtx({
        completions: [
          ...many,
          q("b", "produce", "2026-09-01T00:00:00Z", "https://x"),
          q("c", "article", "2026-09-01T00:00:00Z"),
        ],
        streak: { current: 3, best: 7, todayDone: true },
        programLevels: { davinci: 5 },
        pillarLevels: { editing: 4 },
      }),
      [],
    ).map((b) => b.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "quests-10",
        "quests-50",
        "first-proof",
        "first-article",
        "streak-7",
        "first-island",
      ]),
    );
    expect(ids).not.toContain("quests-100");
    expect(ids).not.toContain("streak-30");
    expect(ids).not.toContain("pillar-5");
    // A produce quest without a proof link is not "first proof".
    expect(
      newBadges(emptyCtx({ completions: [q("b", "produce", "2026-09-01T00:00:00Z")] }), []),
    ).toEqual([]);
  });

  it("first-region needs every skill of a section with ≥ 2 skills", () => {
    const fair = skillsByProgram.davinci.filter((s) => s.sectionId === "fair").map((s) => s.id);
    expect(fair.length).toBeGreaterThanOrEqual(2);
    expect(hasMasteredRegion(new Set(fair.slice(0, -1)))).toBe(false);
    expect(hasMasteredRegion(new Set(fair))).toBe(true);
    // Draft craft sections hold one skill each: mastering one does not count as a region.
    expect(hasMasteredRegion(new Set(["iphone-lock-exposure-wb"]))).toBe(false);
    const ids = newBadges(emptyCtx({ masteredSkillIds: new Set(fair) }), []).map((b) => b.id);
    expect(ids).toEqual(["first-mastery", "first-region"]);
  });

  it("green-green needs 3 quests on one Sept 23 in Riyadh", () => {
    const two = [
      q("a", "train", "2026-09-23T05:00:00Z"),
      q("a", "research", "2026-09-23T10:00:00Z"),
    ];
    expect(nationalDayQuests(two)).toBe(2);
    // 21:30Z on the 22nd is already the 23rd in Riyadh; 21:30Z on the 23rd is the 24th.
    expect(nationalDayQuests([...two, q("a", "produce", "2026-09-22T21:30:00Z")])).toBe(3);
    expect(nationalDayQuests([...two, q("a", "produce", "2026-09-23T21:30:00Z")])).toBe(2);
    // Split across years: 2 + 1 is not 3 on one day.
    expect(nationalDayQuests([...two, q("a", "produce", "2025-09-23T10:00:00Z")])).toBe(2);
    expect(
      newBadges(emptyCtx({ completions: [...two, q("b", "train", "2026-09-23T12:00:00Z")] }), [])
        .map((b) => b.id)
        .includes("green-green"),
    ).toBe(true);
  });

  it("boss, season, focus and pillar badges read their counters", () => {
    const ids = newBadges(
      emptyCtx({
        bossesDefeated: ["2026-09"],
        seasonsFinished: ["2026-09-01:color"],
        focusSessions: Array.from({ length: 10 }, (_, i) => ({
          id: String(i),
          startedAt: "2026-09-01T00:00:00Z",
          minutes: 25 as const,
          endedAt: "2026-09-01T00:25:00Z",
          early: false,
        })),
        pillarLevels: { capture: 5 },
      }),
      [],
    ).map((b) => b.id);
    expect(ids.sort()).toEqual(["boss-slayer", "focus-10", "pillar-5", "season-finisher"]);
  });
});
