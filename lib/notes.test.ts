import { describe, expect, it } from "vitest";
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
