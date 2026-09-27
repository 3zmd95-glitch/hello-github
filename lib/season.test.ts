import { describe, expect, it } from "vitest";
import { getSkill } from "@/data";
import type { QuestCompletion } from "./domain";
import {
  SEASONS,
  SEASON_ANCHOR,
  SEASON_DAYS,
  SEASON_TARGET,
  seasonForDay,
  seasonState,
  skillMatchesTheme,
} from "./season";

const c = (skillId: string, at: string): QuestCompletion => ({ skillId, quest: "train", at });

describe("seasons", () => {
  it("has at least 6 bilingual seasons with a shared badge and target 10", () => {
    expect(SEASONS.length).toBeGreaterThanOrEqual(6);
    expect(new Set(SEASONS.map((s) => s.id)).size).toBe(SEASONS.length);
    for (const s of SEASONS) {
      expect(s.name.ar).toBeTruthy();
      expect(s.name.en).toBeTruthy();
      expect(s.badgeId).toBe("season-finisher");
      expect(s.target).toBe(SEASON_TARGET);
    }
  });

  it("windows are 30 days anchored at 2026-09-01 and rotate", () => {
    expect(SEASON_ANCHOR).toBe("2026-09-01");
    expect(SEASON_DAYS).toBe(30);
    const first = seasonForDay("2026-09-01");
    expect(first).toMatchObject({ start: "2026-09-01", end: "2026-09-30", cycle: 0 });
    expect(first.season.id).toBe("color");
    expect(first.key).toBe("2026-09-01:color");
    expect(seasonForDay("2026-09-30").season.id).toBe("color");
    const second = seasonForDay("2026-10-01");
    expect(second).toMatchObject({ start: "2026-10-01", end: "2026-10-30", cycle: 1 });
    expect(second.season.id).toBe("capture");
    // Before the anchor the rotation still resolves (negative cycles wrap).
    const before = seasonForDay("2026-08-31");
    expect(before.cycle).toBe(-1);
    expect(before.season.id).toBe(SEASONS[SEASONS.length - 1].id);
    // A full rotation later the first season returns.
    expect(seasonForDay(seasonForDay("2026-09-01").start).season.id).toBe("color");
    const later = seasonForDay("2027-05-01");
    expect(later.season.id).toBe(SEASONS[later.cycle % SEASONS.length].id);
  });

  it("matches skills by program, pillar and section", () => {
    const davinci = getSkill("cst-log-workflow")!;
    const fair = getSkill("fair-voice-chain")!;
    const camera = getSkill("iphone-lock-exposure-wb")!;
    expect(skillMatchesTheme(davinci, { programIds: ["davinci"] })).toBe(true);
    expect(skillMatchesTheme(camera, { programIds: ["davinci"] })).toBe(false);
    expect(skillMatchesTheme(camera, { pillarId: "capture" })).toBe(true);
    expect(skillMatchesTheme(davinci, { pillarId: "capture" })).toBe(false);
    expect(skillMatchesTheme(fair, { sections: ["davinci/fair"] })).toBe(true);
    expect(skillMatchesTheme(davinci, { sections: ["davinci/fair"] })).toBe(false);
  });

  it("counts only themed quests inside the window", () => {
    const completions = [
      c("cst-log-workflow", "2026-09-05T10:00:00Z"), // davinci, in Color Month
      c("fair-voice-chain", "2026-09-06T10:00:00Z"), // davinci
      c("iphone-lock-exposure-wb", "2026-09-07T10:00:00Z"), // camera: not the theme
      c("smart-bins-keywords", "2026-08-31T10:00:00Z"), // before the window
      c("scene-cut-detection", "2026-09-30T21:30:00Z"), // Oct 1 in Riyadh: next season
    ];
    const s = seasonState(completions, "2026-09-12");
    expect(s.season.id).toBe("color");
    expect(s).toMatchObject({ day: 12, daysLeft: 19, questsDone: 2, target: 10, done: false });
    expect(s.next.id).toBe("capture");
    const oct = seasonState(completions, new Date("2026-10-01T05:00:00Z"));
    expect(oct.season.id).toBe("capture");
    expect(oct.questsDone).toBe(0); // scene-cut is davinci, not capture
    expect(oct.day).toBe(1);
  });

  it("is done at the target", () => {
    const completions = Array.from({ length: 10 }, (_, i) =>
      c("cst-log-workflow", `2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`),
    );
    expect(seasonState(completions, "2026-09-20").done).toBe(true);
    expect(seasonState(completions.slice(1), "2026-09-20").done).toBe(false);
  });
});
