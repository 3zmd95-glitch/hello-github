// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getSkill, pillars, programsByPillar } from "@/data";
import { questXp } from "@/lib/xp";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  activeDays,
  getApiKey,
  hydrateStore,
  isQuestDone,
  pillarXp,
  programXp,
  skillProgress,
  streak,
  totalXp,
  useStore,
} from "./index";

const S = () => useStore.getState();
const at = (iso: string) => new Date(iso);

beforeEach(() => {
  localStorage.clear();
  S().reset();
});

describe("store defaults", () => {
  it("starts empty with owner defaults", () => {
    expect(S().settings).toEqual(DEFAULT_SETTINGS);
    expect(S().completions).toEqual([]);
    expect(totalXp(S())).toBe(0);
  });
});

describe("completeQuest", () => {
  it("awards tiered XP and is idempotent", () => {
    const skill = getSkill("smart-bins-keywords")!; // tier 2
    const r = S().completeQuest(skill.id, "train");
    expect(r.added).toBe(true);
    expect(r.xp).toBe(questXp("train", 2));
    expect(totalXp(S())).toBe(15);

    const again = S().completeQuest(skill.id, "train");
    expect(again.added).toBe(false);
    expect(again.xp).toBe(0);
    expect(totalXp(S())).toBe(15);
    expect(S().completions).toHaveLength(1);
    expect(skillProgress(S(), skill.id)).toBe(1);
    expect(isQuestDone(S(), skill.id, "train")).toBe(true);
  });

  it("stores and updates the proof link", () => {
    S().completeQuest("smart-bins-keywords", "produce", "https://youtu.be/a");
    expect(S().completions[0].proofUrl).toBe("https://youtu.be/a");
    S().completeQuest("smart-bins-keywords", "produce", "https://youtu.be/b");
    expect(S().completions[0].proofUrl).toBe("https://youtu.be/b");
    expect(S().xpEvents).toHaveLength(1);
  });

  it("ignores unknown skills", () => {
    expect(S().completeQuest("nope", "train").added).toBe(false);
    expect(S().completions).toHaveLength(0);
  });

  it("4 quests → mastery bonus once, and a level-up", () => {
    const id = "fair-voice-chain"; // tier 3: 20 + 30 + 50 + 60 + 20 = 180 XP
    expect(getSkill(id)?.tier).toBe(3);
    S().completeQuest(id, "train");
    S().completeQuest(id, "research");
    S().completeQuest(id, "produce");
    const last = S().completeQuest(id, "article");
    expect(last.mastered).toBe(true);
    expect(last.xp).toBe(60 + 20);
    expect(last.levelBefore).toBe(1);
    expect(last.levelAfter).toBe(2);
    expect(last.rankStepAfter).toBeGreaterThan(last.rankStepBefore);
    expect(totalXp(S())).toBe(180);
    expect(S().xpEvents.filter((e) => e.source === "mastery")).toHaveLength(1);
    expect(skillProgress(S(), id)).toBe(4);

    // Repeating a quest does not award mastery again.
    expect(S().completeQuest(id, "article").mastered).toBe(false);
    expect(totalXp(S())).toBe(180);
  });

  it("uncompleteQuest removes the quest XP and the mastery bonus", () => {
    const id = "scene-cut-detection"; // tier 1: 10 + 15 + 25 + 30 + 20
    for (const q of ["train", "research", "produce", "article"] as const) S().completeQuest(id, q);
    expect(totalXp(S())).toBe(100);
    S().uncompleteQuest(id, "article");
    expect(totalXp(S())).toBe(50);
    expect(skillProgress(S(), id)).toBe(3);
    const again = S().completeQuest(id, "article");
    expect(again.mastered).toBe(true);
    expect(totalXp(S())).toBe(100);
    S().uncompleteQuest(id, "article");
    S().uncompleteQuest(id, "article"); // no-op
    expect(totalXp(S())).toBe(50);
  });
});

describe("selectors", () => {
  it("programXp sums quest + mastery XP per program", () => {
    S().completeQuest("smart-bins-keywords", "train"); // davinci, 15
    S().completeQuest("iphone-lock-exposure-wb", "train"); // camera, 10
    S().addMicroAction({ ar: "درس", en: "Tutorial" }); // 3, no program
    expect(programXp(S(), "davinci")).toBe(15);
    expect(programXp(S(), "camera")).toBe(10);
    expect(programXp(S(), "lighting")).toBe(0);
    expect(totalXp(S())).toBe(28);
  });

  it("pillarXp sums programXp over the pillar's programs", () => {
    S().completeQuest("smart-bins-keywords", "train"); // davinci → editing, 15
    S().completeQuest("iphone-lock-exposure-wb", "train"); // camera → capture, 10
    S().completeQuest("iphone-lock-exposure-wb", "research"); // camera → capture
    S().addMicroAction({ ar: "درس", en: "Tutorial" }); // no pillar
    const capture = programsByPillar("capture").reduce((n, p) => n + programXp(S(), p.id), 0);
    expect(pillarXp(S(), "capture")).toBe(capture);
    expect(pillarXp(S(), "capture")).toBeGreaterThan(10);
    expect(pillarXp(S(), "editing")).toBe(15);
    expect(pillarXp(S(), "growth")).toBe(0);
    expect(pillars.reduce((n, p) => n + pillarXp(S(), p.id), 0)).toBe(totalXp(S()) - 3);
  });

  it("activeDays and streak use Riyadh days from quests and micro-actions", () => {
    S().completeQuest("smart-bins-keywords", "train", undefined, at("2026-09-24T10:00:00Z"));
    S().addMicroAction({ ar: "صوّر لقطة", en: "Film a shot" }, at("2026-09-25T22:30:00Z")); // 26th in Riyadh
    expect([...activeDays(S())].sort()).toEqual(["2026-09-24", "2026-09-26"]);
    const st = streak(S(), "2026-09-26");
    expect(st.current).toBe(1);
    expect(st.todayDone).toBe(true);
    expect(st.freezes).toBe(2); // Thu 24th and Sat 26th are in different Sat–Fri weeks
  });

  it("applyStreakFreezes bridges a missed day", () => {
    S().completeQuest("smart-bins-keywords", "train", undefined, at("2026-09-24T10:00:00Z"));
    expect(S().applyStreakFreezes(at("2026-09-26T10:00:00Z"))).toEqual(["2026-09-25"]);
    expect(S().freezesUsedOn).toEqual(["2026-09-25"]);
    S().addMicroAction({ ar: "x", en: "x" }, at("2026-09-26T10:00:00Z"));
    const st = streak(S(), "2026-09-26");
    expect(st.current).toBe(2);
    expect(st.freezes).toBe(1); // used one, earned a new one: Sat 26th starts a new week
  });
});

describe("settings, export/import, persistence", () => {
  it("setSettings merges and validates", () => {
    S().setSettings({ lang: "en", gear: ["phone", "lights", "camera"] });
    expect(S().settings.lang).toBe("en");
    expect(S().settings.sound).toBe(true);
    expect(() => S().setSettings({ reminderTime: "25:00" })).toThrow();
    expect(S().settings.reminderTime).toBe("20:00");
  });

  it("export → reset → import round-trips", () => {
    S().completeQuest("smart-bins-keywords", "train", "https://example.com/p");
    S().addMicroAction({ ar: "a", en: "a" });
    S().setSettings({ davinciEdition: "free" });
    const json = S().exportState();
    const before = { completions: S().completions, xpEvents: S().xpEvents, settings: S().settings };

    S().reset();
    expect(totalXp(S())).toBe(0);
    S().importState(json);
    expect(S().completions).toEqual(before.completions);
    expect(S().xpEvents).toEqual(before.xpEvents);
    expect(S().settings).toEqual(before.settings);
  });

  it("rejects invalid imports without changing state", () => {
    S().completeQuest("smart-bins-keywords", "train");
    expect(() => S().importState("{}")).toThrow();
    expect(() => S().importState("not json")).toThrow();
    expect(S().completions).toHaveLength(1);
  });

  it("persists to localStorage under 3z-prod-v1 and rehydrates", async () => {
    S().completeQuest("smart-bins-keywords", "train");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).state.completions).toHaveLength(1);
    expect(JSON.parse(raw!).state.completeQuest).toBeUndefined();

    useStore.setState({ completions: [], xpEvents: [] }); // simulate a fresh page (also persists)
    localStorage.setItem(STORAGE_KEY, raw!);
    await hydrateStore();
    expect(S().completions).toHaveLength(1);
    expect(totalXp(S())).toBe(15);
  });

  it("fills in new default settings when stored settings are partial", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: { lang: "en" } }, version: 1 }),
    );
    await hydrateStore();
    expect(S().settings).toEqual({ ...DEFAULT_SETTINGS, lang: "en" });
  });

  it("saves and round-trips a youtube API key via getApiKey", () => {
    expect(getApiKey(S(), "youtube")).toBeUndefined();
    S().setSettings({ apiKeys: { youtube: "AIzaTest123" } });
    expect(getApiKey(S(), "youtube")).toBe("AIzaTest123");
    const json = S().exportState();
    S().reset();
    expect(getApiKey(S(), "youtube")).toBeUndefined();
    S().importState(json);
    expect(getApiKey(S(), "youtube")).toBe("AIzaTest123");
  });

  it("migrates a legacy flat settings.youtubeApiKey into settings.apiKeys.youtube on hydrate", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { settings: { ...DEFAULT_SETTINGS, youtubeApiKey: "AIzaLegacy" } },
        version: 1,
      }),
    );
    await hydrateStore();
    expect(getApiKey(S(), "youtube")).toBe("AIzaLegacy");
    expect((S().settings as unknown as { youtubeApiKey?: string }).youtubeApiKey).toBeUndefined();
  });
});

describe("references (Scout v0)", () => {
  const ref = {
    platform: "tt",
    handle: "@editor.sam",
    title: "Great cut",
    url: "https://tiktok.com/a",
  } as const;
  const other = {
    platform: "yt",
    handle: "@x",
    title: "Another",
    url: "https://youtube.com/b",
  } as const;

  it("addRef saves a ref, deduped by url", () => {
    S().addRef("scene-cut-detection", ref);
    expect(S().savedRefs["scene-cut-detection"]).toEqual([ref]);
    S().addRef("scene-cut-detection", ref); // same url, no duplicate
    expect(S().savedRefs["scene-cut-detection"]).toHaveLength(1);
    S().addRef("scene-cut-detection", other);
    expect(S().savedRefs["scene-cut-detection"]).toEqual([ref, other]);
  });

  it("addRef keeps refs on different skills separate", () => {
    S().addRef("scene-cut-detection", ref);
    S().addRef("smart-bins-keywords", other);
    expect(S().savedRefs["scene-cut-detection"]).toEqual([ref]);
    expect(S().savedRefs["smart-bins-keywords"]).toEqual([other]);
  });

  it("removeRef removes by url and no-ops for an unknown skill/url", () => {
    S().addRef("scene-cut-detection", ref);
    S().addRef("scene-cut-detection", other);
    S().removeRef("scene-cut-detection", ref.url);
    expect(S().savedRefs["scene-cut-detection"]).toEqual([other]);
    S().removeRef("scene-cut-detection", "https://nope.com");
    S().removeRef("no-such-skill", ref.url);
    expect(S().savedRefs["scene-cut-detection"]).toEqual([other]);
  });

  it("refs round-trip through export/import", () => {
    S().addRef("scene-cut-detection", ref);
    const json = S().exportState();
    S().reset();
    expect(S().savedRefs).toEqual({});
    S().importState(json);
    expect(S().savedRefs["scene-cut-detection"]).toEqual([ref]);
  });
});

describe("recent topics (Scout v0)", () => {
  it("adds topics most-recent-first, ignores blanks, and dedupes by moving to the front", () => {
    S().addRecentTopic("match cut");
    S().addRecentTopic("  ");
    S().addRecentTopic("b-roll");
    S().addRecentTopic("match cut"); // re-searched -> moves back to the front
    expect(S().recentTopics).toEqual(["match cut", "b-roll"]);
  });

  it("caps recent topics at 8", () => {
    for (let i = 0; i < 10; i++) S().addRecentTopic(`topic ${i}`);
    expect(S().recentTopics).toHaveLength(8);
    expect(S().recentTopics[0]).toBe("topic 9");
  });
});
