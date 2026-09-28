import { describe, expect, it } from "vitest";
import type { QuestCompletion, Settings, Skill } from "./domain";
import {
  MICRO_ACTIONS,
  isSkillAvailable,
  pickMainQuest,
  pickMicroAction,
  pickMoreQuests,
} from "./planner";

const lt = (s: string) => ({ ar: s, en: s });
const mk = (id: string, over: Partial<Skill> = {}): Skill => ({
  id,
  programId: "p",
  sectionId: "s",
  name: lt(id),
  tier: 1,
  gear: "any",
  studio: false,
  source: "draft",
  quests: { train: lt("t"), research: lt("r"), produce: lt("p"), article: lt("a") },
  refs: [],
  ...over,
});
const done = (skillId: string, ...quests: QuestCompletion["quest"][]): QuestCompletion[] =>
  quests.map((quest) => ({ skillId, quest, at: "2026-09-26T10:00:00+03:00" }));

const settings: Pick<Settings, "gear" | "davinciEdition"> = {
  gear: ["phone", "lights"],
  davinciEdition: "studio",
};

describe("pickMainQuest", () => {
  it("returns null when there is nothing to do", () => {
    expect(pickMainQuest([], [], settings)).toBeNull();
    const all = done("a", "train", "research", "produce", "article");
    expect(pickMainQuest([mk("a")], all, settings)).toBeNull();
  });

  it("starts with research on a fresh skill", () => {
    const p = pickMainQuest([mk("a")], [], settings);
    expect(p?.skill.id).toBe("a");
    expect(p?.quest).toBe("research");
    expect(p?.xp).toBe(15);
  });

  it("follows research → train → produce → article, skipping done ones", () => {
    expect(pickMainQuest([mk("a")], done("a", "research"), settings)?.quest).toBe("train");
    expect(pickMainQuest([mk("a")], done("a", "research", "produce"), settings)?.quest).toBe(
      "train",
    );
    expect(
      pickMainQuest([mk("a")], done("a", "train", "research", "produce"), settings)?.quest,
    ).toBe("article");
  });

  it("prefers the skill nearest to mastery", () => {
    const skills = [mk("a"), mk("b", { tier: 3 })];
    const p = pickMainQuest(skills, done("b", "train", "research"), settings);
    expect(p?.skill.id).toBe("b");
    expect(p?.quest).toBe("produce");
    expect(p?.xp).toBe(50);
  });

  it("breaks ties by lowest tier, then input order", () => {
    expect(
      pickMainQuest([mk("a", { tier: 2 }), mk("b", { tier: 1 })], [], settings)?.skill.id,
    ).toBe("b");
    expect(pickMainQuest([mk("x"), mk("y")], [], settings)?.skill.id).toBe("x");
    expect(pickMainQuest([mk("y"), mk("x")], [], settings)?.skill.id).toBe("y");
  });

  it("only picks skills the owner has gear for", () => {
    const skills = [
      mk("cam", { gear: "camera" }),
      mk("mic", { gear: "mic" }),
      mk("light", { gear: "lights" }),
    ];
    expect(pickMainQuest(skills, done("cam", "train", "research"), settings)?.skill.id).toBe(
      "light",
    );
    expect(pickMainQuest(skills, [], { ...settings, gear: ["camera"] })?.skill.id).toBe("cam");
  });

  it("skips Studio-only skills on the free edition", () => {
    const skills = [mk("studio", { studio: true }), mk("free", { tier: 3 })];
    expect(pickMainQuest(skills, [], settings)?.skill.id).toBe("studio");
    expect(pickMainQuest(skills, [], { ...settings, davinciEdition: "free" })?.skill.id).toBe(
      "free",
    );
    expect(isSkillAvailable(skills[0], { ...settings, davinciEdition: "free" })).toBe(false);
  });

  it("pickMoreQuests returns the next candidates after the main one", () => {
    const skills = [mk("a"), mk("b"), mk("c"), mk("d"), mk("e")];
    expect(pickMoreQuests(skills, [], settings, 3).map((p) => p.skill.id)).toEqual(["b", "c", "d"]);
  });
});

describe("pickMicroAction", () => {
  it("has ~10 bilingual actions", () => {
    expect(MICRO_ACTIONS.length).toBeGreaterThanOrEqual(8);
    for (const a of MICRO_ACTIONS) {
      expect(a.text.ar.length).toBeGreaterThan(0);
      expect(a.text.en.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic per seed and spreads over the list", () => {
    expect(pickMicroAction("2026-09-26")).toBe(pickMicroAction("2026-09-26"));
    const ids = new Set(Array.from({ length: 60 }, (_, i) => pickMicroAction(`2026-09-${i}`).id));
    expect(ids.size).toBeGreaterThan(5);
    expect(MICRO_ACTIONS).toContain(pickMicroAction(12345));
  });
});
