import { describe, expect, it } from "vitest";
import { pillars, programs, skills as seedSkills, skillsByProgram } from "@/data";
import type { Note } from "./domain";
import {
  MISSING_LINK,
  backlinks,
  linkifyWikiLinks,
  noteFileName,
  noteTemplate,
  notesHref,
  parseNotesHash,
  resolveWikiLink,
  searchNotes,
  vaultTree,
  wikiLinks,
  wordCount,
} from "./notes";

const skills = [
  { id: "log", name: { ar: "تصوير Log", en: "Apple Log" } },
  { id: "cst", name: { ar: "تحويل الألوان", en: "Color Space Transform" } },
  { id: "bins", name: { ar: "الملفات الذكية", en: "Smart Bins" } },
];
const note = (body: string): Note => ({ body, updatedAt: "2026-09-28T10:00:00.000Z" });

describe("notes hash", () => {
  it("round-trips a skill id", () => {
    expect(notesHref("log")).toBe("/notes/#skill=log");
    expect(notesHref()).toBe("/notes/");
    expect(parseNotesHash("#skill=log")).toBe("log");
    expect(parseNotesHash("skill=a%20b")).toBe("a b");
    expect(parseNotesHash("#post=1")).toBeNull();
    expect(parseNotesHash("")).toBeNull();
    expect(parseNotesHash("#skill=%E0%A4%A")).toBeNull();
  });
});

describe("wordCount", () => {
  it("counts Arabic and Latin words, not punctuation", () => {
    expect(wordCount("")).toBe(0);
    expect(wordCount("# Log   is flat - ok")).toBe(4);
    expect(wordCount("الـ Log يعطيك مجال أوسع")).toBe(5);
  });
});

describe("wiki links", () => {
  it("finds links with aliases and skips code", () => {
    const body =
      "See [[Apple Log]] and [[cst|the CST node]].\n`[[bins]]`\n```\n[[bins]]\n```\n[[ ]]";
    expect(wikiLinks(body)).toEqual([
      { target: "Apple Log", label: "Apple Log" },
      { target: "cst", label: "the CST node" },
    ]);
  });

  it("resolves by id or either name, ignoring case and spaces", () => {
    expect(resolveWikiLink("apple  log", skills)).toBe("log");
    expect(resolveWikiLink("تحويل الألوان", skills)).toBe("cst");
    expect(resolveWikiLink("bins", skills)).toBe("bins");
    expect(resolveWikiLink("nope", skills)).toBeNull();
  });

  it("rewrites links into Markdown, known and missing", () => {
    expect(linkifyWikiLinks("[[Smart Bins]] then [[Nope|x]] `[[log]]`", skills)).toBe(
      `[Smart Bins](#skill=bins) then [x](${MISSING_LINK}) \`[[log]]\``,
    );
  });

  it("lists backlinks in skill order, never the note itself", () => {
    const notes = {
      log: note("[[Apple Log]] self link, and [[cst]]"),
      bins: note("tag your [[apple log]] clips"),
      cst: note("no links"),
    };
    expect(backlinks("log", notes, skills)).toEqual(["bins"]);
    expect(backlinks("cst", notes, skills)).toEqual(["log"]);
    expect(backlinks("bins", notes, skills)).toEqual([]);
  });
});

describe("searchNotes", () => {
  const notes = {
    cst: note("Use the Color Space Transform after the Log decode."),
    bins: note(""),
  };
  it("returns name hits first, then body hits with an excerpt", () => {
    const hits = searchNotes("log", notes, skills);
    expect(hits.map((h) => h.skillId)).toEqual(["log", "cst"]);
    expect(hits[0].excerpt).toBeNull();
    expect(hits[1].excerpt).toContain("Log decode");
  });
  it("is empty for a blank query", () => {
    expect(searchNotes("  ", notes, skills)).toEqual([]);
  });
});

describe("templates and files", () => {
  const skill = {
    id: "log",
    name: { ar: "تصوير Log", en: "Apple Log / ProRes" },
    quests: {
      train: { ar: "t", en: "t" },
      research: { ar: "نوت: إيش هو الـ Log", en: "Note: what Log is" },
      produce: { ar: "p", en: "p" },
      article: { ar: "a", en: "a" },
    },
  };
  it("starts the note with the name and the research brief", () => {
    const en = noteTemplate(skill, "en");
    expect(en.startsWith("# Apple Log / ProRes\n\n> Note: what Log is\n")).toBe(true);
    expect(noteTemplate(skill, "ar")).toContain("## إيش هي؟");
  });
  it("makes a safe .md file name", () => {
    expect(noteFileName(skill, "en")).toBe("Apple Log ProRes.md");
    expect(noteFileName(skill, "ar")).toBe("تصوير Log.md");
  });
});

describe("vaultTree: the notes follow the pillars, islands and regions", () => {
  const tree = vaultTree(pillars, programs, seedSkills);
  const placed = tree.flatMap(({ pillar, programs: branches }) =>
    branches.flatMap(({ program, sections }) =>
      sections.flatMap(({ section, skillIds }) =>
        skillIds.map((id) => ({ id, pillar: pillar.id, program: program.id, section: section.id })),
      ),
    ),
  );

  it("lists every skill exactly once", () => {
    expect(placed.map((p) => p.id).sort()).toEqual(seedSkills.map((s) => s.id).sort());
  });

  it("puts each skill under its own island, region and pillar", () => {
    for (const p of placed) {
      const skill = seedSkills.find((s) => s.id === p.id)!;
      expect(p.program).toBe(skill.programId);
      expect(p.section).toBe(skill.sectionId);
      expect(p.pillar).toBe(programs.find((pr) => pr.id === skill.programId)!.pillarId);
    }
  });

  it("keeps the map's order: pillars by order, islands and regions as in the data, skills as on the island", () => {
    expect(tree.map((g) => g.pillar.id)).toEqual(
      [...pillars]
        .sort((a, b) => a.order - b.order)
        .map((p) => p.id)
        .filter((id) => tree.some((g) => g.pillar.id === id)),
    );
    for (const { programs: branches } of tree)
      for (const { program, sections } of branches) {
        const onIsland = (skillsByProgram[program.id] ?? []).map((s) => s.id);
        const inVault = sections.flatMap((g) => g.skillIds);
        expect(new Set(inVault)).toEqual(new Set(onIsland));
        expect(sections.map((g) => g.section.id)).toEqual(
          program.sections
            .map((s) => s.id)
            .filter((id) => sections.some((g) => g.section.id === id)),
        );
      }
  });

  it("leaves out islands with no skills (fogged on the map)", () => {
    const shown = new Set(tree.flatMap((g) => g.programs.map((b) => b.program.id)));
    for (const p of programs)
      expect(shown.has(p.id)).toBe((skillsByProgram[p.id] ?? []).length > 0);
  });

  it("gives a newly added skill its note slot with no extra step", () => {
    const base = seedSkills.find((s) => s.programId === "camera")!;
    const added = { ...base, id: "brand-new-skill", name: { ar: "مهارة جديدة", en: "Brand new" } };
    const withNew = vaultTree(pillars, programs, [...seedSkills, added]);
    const branch = withNew.flatMap((g) => g.programs).find((b) => b.program.id === "camera")!;
    const section = branch.sections.find((g) => g.section.id === base.sectionId)!;
    expect(section.skillIds.at(-1)).toBe("brand-new-skill");
  });

  it("filters with keep (only notes I wrote)", () => {
    const only = vaultTree(pillars, programs, seedSkills, (s) => s.id === "smart-bins-keywords");
    expect(only).toHaveLength(1);
    expect(only[0].programs[0].sections[0].skillIds).toEqual(["smart-bins-keywords"]);
  });
});
