import { describe, expect, it } from "vitest";
import { skills as seedSkills } from "@/data";
import { DEFAULT_SETTINGS } from "@/store";
import { COMBO_PAIRS, skillKind, suggestCombo } from "./combo";
import type { Program, QuestCompletion, QuestType, Skill } from "./domain";
import { questMinutes } from "./weekPlan";
import { questXp } from "./xp";

const settings = DEFAULT_SETTINGS; // phone + lights, Studio edition

const programs: Program[] = [
  {
    id: "lighting",
    pillarId: "capture",
    kind: "craft",
    name: { ar: "الإضاءة", en: "Lighting" },
    icon: "💡",
    color: "#ffc53d",
    sections: [{ id: "s", name: { ar: "س", en: "S" } }],
  },
  {
    id: "capcut",
    pillarId: "editing",
    kind: "app",
    name: { ar: "كاب كات", en: "CapCut" },
    icon: "✂️",
    color: "#22d3ee",
    sections: [{ id: "s", name: { ar: "س", en: "S" } }],
  },
];

const q = (s: string) => ({ ar: s, en: s });
function skill(
  id: string,
  programId: string,
  tier: 1 | 2 | 3 = 1,
  gear: Skill["gear"] = "any",
): Skill {
  return {
    id,
    programId,
    sectionId: "s",
    name: q(id),
    tier,
    gear,
    studio: false,
    source: "draft",
    quests: { train: q("t"), research: q("r"), produce: q("p"), article: q("a") },
    refs: [],
  };
}
const done = (skillId: string, quest: QuestType): QuestCompletion => ({
  skillId,
  quest,
  at: "2026-09-20T12:00:00+03:00",
});

describe("COMBO_PAIRS", () => {
  it("has the four round-21 pairs with a DaVinci side that exists in the seed", () => {
    expect(COMBO_PAIRS.map((p) => p.id)).toEqual([
      "log-cst",
      "shutter-retime",
      "lav-voice",
      "storyboard-source-tape",
    ]);
    const ids = new Set(seedSkills.map((s) => s.id));
    for (const pair of COMBO_PAIRS)
      expect(
        pair.softwareSkillIds.some((id) => ids.has(id)),
        pair.id,
      ).toBe(true);
  });
});

describe("suggestCombo", () => {
  it("picks the first unfinished named pair (Log ↔ CST) on a fresh account", () => {
    const combo = suggestCombo({ skills: seedSkills, completions: [], settings });
    expect(combo).not.toBeNull();
    expect(combo!.id).toBe("log-cst");
    expect(combo!.craftSkillId).toBe("iphone-log-prores");
    expect(combo!.softwareSkillId).toBe("cst-log-workflow");
    expect(combo!.minutes).toBe(questMinutes("produce", 2) * 2);
    expect(combo!.xp).toBe(questXp("produce", 2) * 2);
    expect(combo!.brief.ar).toContain("CST");
  });

  it("moves to the next named pair once one side's produce quest is done", () => {
    const combo = suggestCombo({
      skills: seedSkills,
      completions: [done("cst-log-workflow", "produce")],
      settings,
    });
    expect(combo!.id).toBe("shutter-retime");
    expect(combo!.craftSkillId).toBe("phone-180-shutter");
    expect(combo!.softwareSkillId).toBe("speed-ramp-retime");
  });

  it("falls back to generic when the remaining named pairs need Studio or unseeded craft skills", () => {
    // Log side done; free edition locks both Retime and Speed Warp; the lav and storyboard pairs have
    // no craft skill in the seed yet → generic pairing.
    const combo = suggestCombo({
      skills: seedSkills,
      completions: [done("iphone-log-prores", "produce")],
      settings: { gear: ["phone"], davinciEdition: "free" },
    });
    expect(combo).not.toBeNull();
    expect(combo!.id.startsWith("generic:")).toBe(true);
  });

  it("falls back to the generic craft + software pairing, nearest to mastery first", () => {
    const skills = [
      skill("window-light", "lighting", 1),
      skill("golden-hour", "lighting", 2),
      skill("capcut-cut", "capcut", 1),
      skill("capcut-speed", "capcut", 2),
    ];
    const combo = suggestCombo({
      skills,
      completions: [done("golden-hour", "train"), done("golden-hour", "research")],
      settings,
      programs,
    });
    expect(combo).toEqual({
      id: "generic:golden-hour+capcut-cut",
      craftSkillId: "golden-hour",
      softwareSkillId: "capcut-cut",
      brief: {
        ar: "صوّر «golden-hour» ← عدّله بـ «capcut-cut»، كليب واحد",
        en: "Shoot golden-hour → edit it with capcut-cut, one clip",
      },
      minutes: questMinutes("produce", 2) + questMinutes("produce", 1),
      xp: questXp("produce", 2) + questXp("produce", 1),
    });
  });

  it("skips skills whose produce quest is done or whose gear is missing", () => {
    const skills = [
      skill("window-light", "lighting", 1),
      skill("gimbal-orbit", "lighting", 1, "gimbal"),
      skill("capcut-cut", "capcut", 1),
    ];
    const combo = suggestCombo({
      skills,
      completions: [done("window-light", "produce")],
      settings,
      programs,
    });
    expect(combo).toBeNull(); // window-light done, gimbal-orbit locked → no craft side left
  });

  it("returns null when one side has nothing", () => {
    expect(suggestCombo({ skills: [], completions: [], settings })).toBeNull();
    expect(
      suggestCombo({
        skills: [skill("capcut-cut", "capcut")],
        completions: [],
        settings,
        programs,
      }),
    ).toBeNull();
    expect(
      suggestCombo({
        skills: [skill("window-light", "lighting")],
        completions: [],
        settings,
        programs,
      }),
    ).toBeNull();
  });
});

describe("skillKind", () => {
  it("maps craft programs to craft and anything else to software", () => {
    expect(skillKind({ programId: "lighting" }, programs)).toBe("craft");
    expect(skillKind({ programId: "capcut" }, programs)).toBe("software");
    expect(skillKind({ programId: "unknown" }, programs)).toBe("software");
  });
});
