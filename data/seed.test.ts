import { describe, expect, it } from "vitest";
import {
  getProgram,
  getSkill,
  pillars,
  programs,
  programsByPillar,
  skills,
  skillsByProgram,
  validateSeed,
} from "@/data";

describe("seed data", () => {
  it("parses with the Zod schemas", () => {
    expect(() => validateSeed()).not.toThrow();
  });

  it("has 34 programs: 17 craft + 17 apps", () => {
    expect(programs).toHaveLength(34);
    expect(programs.filter((p) => p.kind === "craft")).toHaveLength(17);
    expect(programs.filter((p) => p.kind === "app")).toHaveLength(17);
  });

  it("has the owner's 6 pillars in order with unique orders", () => {
    expect(pillars.map((p) => p.id)).toEqual([
      "capture",
      "editing",
      "design",
      "ai",
      "projects",
      "growth",
    ]);
    const orders = pillars.map((p) => p.order);
    expect(new Set(orders).size).toBe(6);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(pillars.map((p) => p.color)).size).toBe(6);
  });

  it("every program belongs to a known pillar and every pillar has programs", () => {
    const ids = new Set(pillars.map((p) => p.id));
    for (const p of programs) expect(ids.has(p.pillarId), p.id).toBe(true);
    for (const pl of pillars) expect(programsByPillar(pl.id).length, pl.id).toBeGreaterThan(0);
    const total = pillars.reduce((n, pl) => n + programsByPillar(pl.id).length, 0);
    expect(total).toBe(programs.length);
    expect(programsByPillar("nope")).toEqual([]);
  });

  it("maps programs to pillars per round 22", () => {
    const ids = (pl: string) => programsByPillar(pl).map((p) => p.id);
    expect(getProgram("davinci")?.pillarId).toBe("editing");
    expect(getProgram("lighting")?.pillarId).toBe("capture");
    expect(ids("capture")).toHaveLength(11);
    expect(ids("editing")).toEqual(["davinci", "capcut", "editing-theory", "color-craft"]);
    expect(ids("design")).toEqual(["canva", "photoshop", "illustrator", "brand-identity"]);
    expect(ids("ai")).toEqual(["claude", "gemini", "higgsfield", "ai-audio"]);
    expect(ids("projects")).toHaveLength(7);
    expect(ids("growth")).toEqual([
      "analytics",
      "publishing-strategy",
      "monetization",
      "web-newsletter",
    ]);
  });

  it("programs are sorted by pillar order", () => {
    const order = new Map(pillars.map((p) => [p.id, p.order]));
    const seq = programs.map((p) => order.get(p.pillarId)!);
    expect(seq).toEqual([...seq].sort((a, b) => a - b));
  });

  it("new round 22 programs have 2–6 draft sections", () => {
    for (const id of [
      "iphone-camera",
      "blackmagic-camera",
      "equipment",
      "editing-theory",
      "brand-identity",
      "gemini",
      "ai-audio",
      "files-backup",
      "download-sources",
      "inspiration",
      "analytics",
      "publishing-strategy",
      "monetization",
      "web-newsletter",
    ]) {
      const n = getProgram(id)?.sections.length ?? 0;
      expect(n, id).toBeGreaterThanOrEqual(2);
      expect(n, id).toBeLessThanOrEqual(6);
    }
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

  it("has 62 DaVinci skills (21 starter + 6 Studio AI + 35 core)", () => {
    const dv = skillsByProgram.davinci;
    expect(dv).toHaveLength(62);
    expect(dv.filter((s) => s.source === "starter")).toHaveLength(21);
    expect(dv.filter((s) => s.source === "studio-ai")).toHaveLength(6);
    expect(dv.filter((s) => s.source === "core")).toHaveLength(35);
    expect(dv.every((s) => s.gear === "any")).toBe(true);
  });

  it("every DaVinci page has at least 6 skills", () => {
    const dv = skillsByProgram.davinci;
    for (const sec of getProgram("davinci")!.sections) {
      expect(dv.filter((s) => s.sectionId === sec.id).length, sec.id).toBeGreaterThanOrEqual(6);
    }
  });

  it("core DaVinci skills are full cards with no refs and no URLs", () => {
    const core = skills.filter((s) => s.source === "core");
    expect(core).toHaveLength(35);
    for (const s of core) {
      expect(s.programId, s.id).toBe("davinci");
      expect(s.refs, s.id).toEqual([]);
      expect(s.ideas?.length, s.id).toBe(3);
      expect(s.steps?.length, s.id).toBeGreaterThanOrEqual(5);
      expect(s.steps?.length, s.id).toBeLessThanOrEqual(7);
      expect(s.what, s.id).toBeDefined();
      expect(s.arGap, s.id).toBeDefined();
      expect(JSON.stringify(s), s.id).not.toMatch(/https?:\/\//);
    }
    expect(core.filter((s) => s.studio).map((s) => s.id)).toEqual([
      "noise-reduction-temporal-spatial",
      "film-look-creator",
      "sky-replacement-magic-mask-alpha",
      "fair-voice-isolation",
      "fair-dialogue-leveler",
      "deliver-hdr-export",
    ]);
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
