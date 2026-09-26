import { describe, expect, it } from "vitest";
import { getProgram, getSkill, programs, skills, skillsByProgram, validateSeed } from "@/data";

describe("seed data", () => {
  it("parses with the Zod schemas", () => {
    expect(() => validateSeed()).not.toThrow();
  });

  it("has 20 programs: 7 craft + 13 apps", () => {
    expect(programs).toHaveLength(20);
    expect(programs.filter((p) => p.kind === "craft")).toHaveLength(7);
    expect(programs.filter((p) => p.kind === "app")).toHaveLength(13);
  });

  it("DaVinci has the 7 real pages", () => {
    expect(getProgram("davinci")?.sections.map((s) => s.id)).toEqual([
      "media",
      "cut",
      "edit",
      "fusion",
      "color",
      "fair",
      "deliver",
    ]);
  });

  it("has 27 DaVinci skills (21 starter + 6 Studio AI)", () => {
    const dv = skillsByProgram.davinci;
    expect(dv).toHaveLength(27);
    expect(dv.filter((s) => s.source === "starter")).toHaveLength(21);
    expect(dv.filter((s) => s.source === "studio-ai")).toHaveLength(6);
    expect(dv.every((s) => s.gear === "any")).toBe(true);
  });

  it("converts refs from tuples to objects", () => {
    const s = getSkill("smart-bins-keywords");
    expect(s?.refs.length).toBeGreaterThan(0);
    expect(s?.refs[0]).toMatchObject({ platform: "tt", handle: "@justtjc" });
    expect(s?.refs[0].url).toMatch(/^https:\/\//);
  });

  it("has ~8 phone-first craft drafts with no refs", () => {
    const drafts = skills.filter((s) => s.source === "draft");
    expect(drafts).toHaveLength(8);
    for (const d of drafts) {
      expect(d.refs).toEqual([]);
      expect(d.steps?.length).toBeGreaterThanOrEqual(3);
      expect(d.steps?.length).toBeLessThanOrEqual(5);
      expect(getProgram(d.programId)?.kind).toBe("craft");
    }
  });

  it("every skill's section exists in its program", () => {
    for (const s of skills) {
      const p = getProgram(s.programId);
      expect(p, s.id).toBeDefined();
      expect(
        p!.sections.some((sec) => sec.id === s.sectionId),
        `${s.id} → ${s.sectionId}`,
      ).toBe(true);
    }
  });

  it("has no duplicate ids", () => {
    const skillIds = skills.map((s) => s.id);
    expect(new Set(skillIds).size).toBe(skillIds.length);
    const programIds = programs.map((p) => p.id);
    expect(new Set(programIds).size).toBe(programIds.length);
    for (const p of programs) {
      const ids = p.sections.map((s) => s.id);
      expect(new Set(ids).size, p.id).toBe(ids.length);
    }
  });

  it("skillsByProgram covers every program", () => {
    for (const p of programs) expect(Array.isArray(skillsByProgram[p.id])).toBe(true);
    const total = Object.values(skillsByProgram).reduce((n, l) => n + l.length, 0);
    expect(total).toBe(skills.length);
  });
});
