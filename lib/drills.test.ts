import { describe, expect, it } from "vitest";
import {
  DRILL_INTERVALS,
  DRILL_PROMPTS,
  advanceDrill,
  drillPrompt,
  dueDrills,
  newDrill,
  nextInterval,
} from "./drills";

describe("drills", () => {
  it("intervals go 3 → 7 → 14 → 30 and stay at 30", () => {
    expect([...DRILL_INTERVALS]).toEqual([3, 7, 14, 30]);
    expect(nextInterval(3)).toBe(7);
    expect(nextInterval(7)).toBe(14);
    expect(nextInterval(14)).toBe(30);
    expect(nextInterval(30)).toBe(30);
    expect(nextInterval(99)).toBe(30);
  });

  it("a new drill is due in 3 days; each completion advances it", () => {
    const d = newDrill("fair-voice-chain", "2026-09-26");
    expect(d).toEqual({
      skillId: "fair-voice-chain",
      nextDue: "2026-09-29",
      intervalDays: 3,
      reps: 0,
    });
    const d2 = advanceDrill(d, "2026-09-29");
    expect(d2).toMatchObject({ nextDue: "2026-10-06", intervalDays: 7, reps: 1 });
    const d3 = advanceDrill(d2, "2026-10-08"); // done late: counts from the day it was done
    expect(d3).toMatchObject({ nextDue: "2026-10-22", intervalDays: 14, reps: 2 });
    const d4 = advanceDrill(d3, "2026-10-22");
    expect(d4).toMatchObject({ nextDue: "2026-11-21", intervalDays: 30, reps: 3 });
    expect(advanceDrill(d4, "2026-11-21").intervalDays).toBe(30);
  });

  it("dueDrills returns due ones soonest first", () => {
    const drills = [
      newDrill("a", "2026-09-20"), // due 23
      newDrill("b", "2026-09-26"), // due 29
      newDrill("c", "2026-09-18"), // due 21
    ];
    expect(dueDrills(drills, "2026-09-25").map((d) => d.skillId)).toEqual(["c", "a"]);
    expect(dueDrills(drills, "2026-09-20")).toEqual([]);
    expect(dueDrills(drills, "2026-09-29")).toHaveLength(3);
  });

  it("has at least 10 bilingual prompts covering every quest type", () => {
    expect(DRILL_PROMPTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(DRILL_PROMPTS.map((p) => p.id)).size).toBe(DRILL_PROMPTS.length);
    for (const q of ["train", "research", "produce", "article", undefined])
      expect(DRILL_PROMPTS.some((p) => p.quest === q)).toBe(true);
    for (const p of DRILL_PROMPTS) {
      expect(p.text.ar).toBeTruthy();
      expect(p.text.en).toBeTruthy();
    }
  });

  it("drillPrompt is deterministic and walks the quest types by rep", () => {
    const d = newDrill("fair-voice-chain", "2026-09-26");
    expect(drillPrompt(d)).toEqual(drillPrompt(d));
    expect(drillPrompt(d).quest).toBe("train");
    expect(drillPrompt({ ...d, reps: 1 }).quest).toBe("research");
    expect(drillPrompt({ ...d, reps: 2 }).quest).toBe("produce");
    expect(drillPrompt({ ...d, reps: 3 }).quest).toBe("article");
    expect(drillPrompt({ ...d, reps: 4 }).quest).toBeUndefined();
    expect(drillPrompt({ ...d, reps: 5 }).quest).toBe("train");
  });
});
