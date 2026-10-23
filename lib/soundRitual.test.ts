import { describe, expect, it } from "vitest";
import ar from "@/messages/trends.ar.json";
import en from "@/messages/trends.en.json";
import type { Idea } from "./domain";
import {
  lastRitual,
  parseRitualIdea,
  RITUAL_NAME_MAX,
  ritualIdeaText,
  ritualTexts,
} from "./soundRitual";

// Scout 02, the weekly "paste 3 Instagram sounds" card: Instagram has no trends API, so the owner types the top
// sounds from the app's own list. The saved ideas carry the day they were pasted (Riyadh) in their text, which
// is how the card knows how old they are, with no nudge and no new stored slice.

const idea = (over: Partial<Idea> & { id: string; text: string }): Idea => ({
  source: "trend",
  platform: "instagram",
  createdAt: "2026-10-23T09:00:00.000+03:00",
  ...over,
});

describe("ritualIdeaText / parseRitualIdea", () => {
  it("writes the kind, the paste day and the name, in the UI language", () => {
    expect(ritualIdeaText("sound", "  Dua Lipa - Houdini ", "2026-10-23", "en")).toBe(
      "🎵 Instagram sound · 2026-10-23: Dua Lipa - Houdini",
    );
    expect(ritualIdeaText("sound", "اسم الصوت", "2026-10-23", "ar")).toBe(
      "🎵 صوت انستقرام · 2026-10-23: اسم الصوت",
    );
    expect(ritualIdeaText("format", "POV", "2026-10-23", "en")).toBe(
      "🎞️ Instagram format · 2026-10-23: POV",
    );
  });

  it("reads either language's text back, and nothing else", () => {
    for (const lang of ["ar", "en"] as const)
      for (const kind of ["sound", "format"] as const)
        expect(
          parseRitualIdea(ritualIdeaText(kind, "Name: with colon", "2026-10-23", lang)),
        ).toEqual({ kind, day: "2026-10-23", name: "Name: with colon" });
    expect(parseRitualIdea("📈 Trend: Something (Google Trends)")).toBeUndefined();
    expect(parseRitualIdea("🎵 Instagram sound · yesterday: Name")).toBeUndefined();
    expect(parseRitualIdea("🎵 Instagram sound · 2026-10-23: ")).toBeUndefined();
  });
});

describe("ritualTexts (what one paste saves)", () => {
  const base = { day: "2026-10-23", lang: "en" as const, ideas: [] as Idea[] };

  it("saves the sounds then the format, trimmed, without blanks or repeats", () => {
    expect(
      ritualTexts({ ...base, sounds: ["  A ", "", "a", "B"], format: " Before and after " }),
    ).toEqual([
      "🎵 Instagram sound · 2026-10-23: A",
      "🎵 Instagram sound · 2026-10-23: B",
      "🎞️ Instagram format · 2026-10-23: Before and after",
    ]);
  });

  it("clips a long name and skips what today's paste already saved (either language)", () => {
    const long = "x".repeat(RITUAL_NAME_MAX + 20);
    const [text] = ritualTexts({ ...base, sounds: [long], format: "" });
    expect(text).toBe(`🎵 Instagram sound · 2026-10-23: ${"x".repeat(RITUAL_NAME_MAX)}`);
    const saved = [idea({ id: "1", text: "🎵 صوت انستقرام · 2026-10-23: A" })];
    expect(ritualTexts({ ...base, ideas: saved, sounds: ["A", "B"], format: "" })).toEqual([
      "🎵 Instagram sound · 2026-10-23: B",
    ]);
  });

  it("saves nothing for an empty form", () => {
    expect(ritualTexts({ ...base, sounds: ["", " ", ""], format: "  " })).toEqual([]);
  });
});

describe("lastRitual", () => {
  const today = "2026-10-23";
  const text = (kind: "sound" | "format", name: string, day: string) =>
    ritualIdeaText(kind, name, day, "en");

  it("is undefined until something was pasted (other ideas never count)", () => {
    expect(lastRitual([], today)).toBeUndefined();
    expect(
      lastRitual(
        [
          idea({ id: "1", text: "📈 Trend: X (Google Trends)" }),
          idea({ id: "2", text: text("sound", "A", today), source: "me" }),
          idea({ id: "3", text: text("sound", "A", today), platform: "tiktok" }),
        ],
        today,
      ),
    ).toBeUndefined();
  });

  it("is the newest paste: its sounds and format, its day and its age", () => {
    const ideas = [
      idea({ id: "old", text: text("sound", "Old sound", "2026-10-12") }),
      idea({ id: "s1", text: text("sound", "Sound 1", "2026-10-20") }),
      idea({ id: "s2", text: text("sound", "Sound 2", "2026-10-20") }),
      idea({ id: "f1", text: text("format", "POV", "2026-10-20") }),
    ];
    expect(lastRitual(ideas, today)).toEqual({
      day: "2026-10-20",
      ageDays: 3,
      stale: false,
      sounds: [
        { id: "s1", name: "Sound 1" },
        { id: "s2", name: "Sound 2" },
      ],
      formats: [{ id: "f1", name: "POV" }],
    });
  });

  it("is stale after a week", () => {
    const seven = lastRitual([idea({ id: "a", text: text("sound", "A", "2026-10-16") })], today);
    const eight = lastRitual([idea({ id: "a", text: text("sound", "A", "2026-10-15") })], today);
    expect([seven?.ageDays, seven?.stale]).toEqual([7, false]);
    expect([eight?.ageDays, eight?.stale]).toEqual([8, true]);
  });
});

describe("the ritual's messages", () => {
  const keys = [
    "trends.ritual.title",
    "trends.ritual.steps",
    "trends.ritual.sound",
    "trends.ritual.soundPh",
    "trends.ritual.format",
    "trends.ritual.formatPh",
    "trends.ritual.save",
    "trends.ritual.saved",
    "trends.ritual.last",
    "trends.ritual.none",
    "trends.ritual.old",
    "trends.ritual.note",
  ] as const;
  it("exist in Arabic and English, and never promise a reminder (no nudge, by the owner's choice)", () => {
    for (const k of keys) {
      expect(Object.keys(ar), k).toContain(k);
      expect(Object.keys(en), k).toContain(k);
    }
    const all = [...Object.entries(ar), ...Object.entries(en)]
      .filter(([k]) => k.startsWith("trends.ritual."))
      .map(([, v]) => v)
      .join(" ");
    expect(all).not.toMatch(/remind|notif|nudge|تذكير|تنبيه|إشعار/i);
  });
});
