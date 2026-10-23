// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSkill, pillars, programsByPillar, skills } from "@/data";
import { applyOverlay } from "@/components/planner/overlay";
import { buildWeekPlan } from "@/lib/weekPlan";
import { CHEST_EVERY, lootFor } from "@/lib/chests";
import { FREEZE_REWARD_ID, GEM_RULES, defaultRewards } from "@/lib/gems";
import { FREEZE_TOTAL_CAP } from "@/lib/streak";
import { DRILL_XP, MASTERY_BONUS, REVIEW_XP, questXp } from "@/lib/xp";
import {
  DEFAULT_AVATAR,
  EMPTY_SCRIPT,
  type Article,
  type Workflow,
  type WorkflowRun,
  EMPTY_TRENDS,
  type TrendItemInput,
  type TrendsFeedInput,
} from "@/lib/domain";
import { SOCIAL_SEED_DAY, SOCIAL_SEED_VERSION, applySocialSeed } from "@/data/social-seed";
import { HASHTAG_SETS, SHOT_TEMPLATES, bestTime, suggestHashtags } from "@/lib/social";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  accountFor,
  activeDays,
  analyticsState,
  articleBase,
  articlesGeneration,
  savesSettled,
  setArticlesLock,
  setWorkflowFault,
  workflowBase,
  businessBase,
  inboxDraftBase,
  type InboxSendOp,
  type InboxThreadsSendOp,
  type InboxInstagramSendOp,
  type InboxInstagramDmSendOp,
  type InboxInstagramDmControl,
  type ArticlesLock,
  type StoreState,
  boss,
  chestProgress,
  currentWeek,
  dueDrills,
  earnedBadges,
  focusActive,
  gems,
  getApiKey,
  hasBeaconsSeed,
  hydrateStore,
  ideasCount,
  isPlanItemDone,
  isQuestDone,
  masteredSkillIds,
  noteForSkill,
  nextPostFor,
  pillarXp,
  planItemsForWeek,
  postById,
  postForQuestProof,
  postStatsFor,
  postsForSkill,
  programXp,
  reviewForWeek,
  season,
  skillInCalendar,
  skillProgress,
  socialSyncState,
  streak,
  totalXp,
  trendsState,
  unusedIdeas,
  useStore,
} from "./index";
import { articlesExport } from "@/lib/articles";
import { kitProjection } from "@/lib/businessKit";

const S = () => useStore.getState();
/**
 * DT-7C-2A: the whole exported state equals `before`, except the cloud journal, which the reset in between kept (same
 * entries) with its suppression marker advanced once; the import keeps that maximum (contract item 5).
 */
const expectSameExceptJournal = (before: Record<string, unknown>) => {
  const { cloudJournal: after, ...rest } = JSON.parse(S().exportState()).state;
  const { cloudJournal: prior, ...restBefore } = before as { cloudJournal?: typeof after };
  expect(rest).toEqual(restBefore);
  expect(after.entries).toEqual(prior?.entries ?? []);
  expect(after.suppression.epoch).toBe((prior?.suppression.epoch ?? 0) + 1);
};
const at = (iso: string) => new Date(iso);
/** Complete all 4 quests of a skill at `when`. */
const master = (id: string, when = new Date("2026-09-10T10:00:00Z")) => {
  let last;
  for (const q of ["train", "research", "produce", "article"] as const)
    last = S().completeQuest(id, q, undefined, when);
  return last!;
};

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

  it("keeps what another tab saved when this tab writes next", async () => {
    await hydrateStore();
    const edited = S().addPost({ platform: "tiktok", title: "Coffee film" });
    const polled = S().addPost({ platform: "tiktok", title: "Inbox test" });
    // Another tab, opened on the same save, applies a Creator script to the first post and saves.
    const other = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    other.state.posts = other.state.posts.map((p: { id: string; script: object }) =>
      p.id === edited.id ? { ...p, script: { ...p.script, hook: "Watch the light" } } : p,
    );
    const raw = JSON.stringify(other);
    localStorage.setItem(STORAGE_KEY, raw);
    window.dispatchEvent(
      new StorageEvent("storage", { key: STORAGE_KEY, newValue: raw, storageArea: localStorage }),
    );
    // This tab's publish watcher then stamps the other post: every write saves the whole state.
    S().updatePost(polled.id, { title: "Inbox test, checked" });
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.posts;
    expect(saved.find((p: { id: string }) => p.id === edited.id).script.hook).toBe(
      "Watch the light",
    );
    expect(postById(S(), edited.id)?.script.hook).toBe("Watch the light");
  });

  it("reloads the save when the page comes back from the back/forward cache", async () => {
    await hydrateStore();
    const post = S().addPost({ platform: "tiktok", title: "Before" });
    const other = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    other.state.posts[0].title = "Saved while this page was cached";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(other));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    expect(postById(S(), post.id)?.title).toBe("Before");
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    expect(postById(S(), post.id)?.title).toBe("Saved while this page was cached");
  });

  it("fills in new default settings when stored settings are partial", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: { lang: "en" } }, version: 1 }),
    );
    await hydrateStore();
    expect(S().settings).toEqual({ ...DEFAULT_SETTINGS, lang: "en" });
  });

  it("setSettings({ avatar }) validates and persists the look", async () => {
    expect(S().settings.avatar).toEqual(DEFAULT_AVATAR);
    const look = { ...DEFAULT_AVATAR, skin: "dark" as const, headwear: "shemagh" as const };
    S().setSettings({ avatar: look });
    expect(S().settings.avatar).toEqual(look);
    expect(() =>
      S().setSettings({ avatar: { ...look, skin: "purple" as unknown as "dark" } }),
    ).toThrow();
    expect(S().settings.avatar).toEqual(look);

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).state.settings.avatar).toEqual(look);
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    localStorage.setItem(STORAGE_KEY, raw!);
    await hydrateStore();
    expect(S().settings.avatar).toEqual(look);

    const json = S().exportState();
    expect(JSON.parse(json).state.settings.avatar).toEqual(look);
    S().reset();
    expect(S().settings.avatar).toEqual(DEFAULT_AVATAR);
    S().importState(json);
    expect(S().settings.avatar).toEqual(look);
  });

  it("a persisted settings object without avatar (pre-customization save) merges to the default", async () => {
    const { avatar: _dropped, ...withoutAvatar } = DEFAULT_SETTINGS;
    void _dropped;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: { ...withoutAvatar, lang: "en" } }, version: 1 }),
    );
    await hydrateStore();
    expect(S().settings.avatar).toEqual(DEFAULT_AVATAR);
    expect(S().settings.lang).toBe("en");
  });

  it("a partial avatar in a save fills the missing parts with defaults", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { settings: { ...DEFAULT_SETTINGS, avatar: { skin: "brown" } } },
        version: 1,
      }),
    );
    await hydrateStore();
    expect(S().settings.avatar).toEqual({ ...DEFAULT_AVATAR, skin: "brown" });
  });

  it("shows only DaVinci Resolve and CapCut by default and a save without the field gets that default", async () => {
    expect(S().settings.discover).toEqual({ editorScope: "mine" });
    const { discover: _dropped, ...withoutDiscover } = DEFAULT_SETTINGS;
    void _dropped;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: { ...withoutDiscover, lang: "en" } }, version: 1 }),
    );
    await hydrateStore();
    expect(S().settings.discover).toEqual({ editorScope: "mine" });
    expect(S().settings.lang).toBe("en");
  });

  it.each([
    ["After Effects hiding turned off", [], "all"],
    ["After Effects hidden", ["after effects"], "mine"],
    ["another list", ["premiere pro", "filmora"], "mine"],
  ] as const)("migrates an old save with %s", async (_name, hiddenEditors, scope) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: { settings: { ...DEFAULT_SETTINGS, discover: { hiddenEditors } } },
        version: 1,
      }),
    );
    await hydrateStore();
    expect(S().settings.discover).toEqual({ editorScope: scope });
    const json = S().exportState();
    const old = JSON.parse(json);
    old.state.settings.discover = { hiddenEditors };
    S().reset();
    S().importState(JSON.stringify(old));
    expect(S().settings.discover).toEqual({ editorScope: scope });
  });

  it("setEditorScope validates and persists both choices", async () => {
    S().setEditorScope("all");
    expect(S().settings.discover.editorScope).toBe("all");
    expect(() => S().setEditorScope("some" as "all")).toThrow();
    expect(S().settings.discover.editorScope).toBe("all");

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).state.settings.discover).toEqual({ editorScope: "all" });
    useStore.setState({ settings: { ...DEFAULT_SETTINGS } });
    localStorage.setItem(STORAGE_KEY, raw!);
    await hydrateStore();
    expect(S().settings.discover.editorScope).toBe("all");

    const json = S().exportState();
    S().reset();
    expect(S().settings.discover.editorScope).toBe("mine");
    S().importState(json);
    expect(S().settings.discover.editorScope).toBe("all");
    S().setEditorScope("mine");
    expect(S().settings.discover.editorScope).toBe("mine");
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

  it("saves the Scout Worker URL and token alongside the YouTube key and round-trips them", () => {
    S().setSettings({
      apiKeys: { youtube: "AIzaTest123", scoutUrl: "https://scout.test", scoutToken: "tok" },
    });
    expect(getApiKey(S(), "scoutUrl")).toBe("https://scout.test");
    expect(getApiKey(S(), "scoutToken")).toBe("tok");
    const json = S().exportState();
    S().reset();
    S().importState(json);
    expect(S().settings.apiKeys).toEqual({
      youtube: "AIzaTest123",
      scoutUrl: "https://scout.test",
      scoutToken: "tok",
    });
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

  it("addRef and removeRef treat the same post in another URL form as the same ref", () => {
    const reel = {
      platform: "ig",
      handle: "@editor.ali",
      title: "Match cut",
      url: "https://www.instagram.com/editor.ali/reel/ABC123/?igsh=x",
    } as const;
    S().addRef("scene-cut-detection", reel);
    // The search card for the same post comes back in the canonical /p/<id> form: no duplicate.
    S().addRef("scene-cut-detection", { ...reel, url: "https://www.instagram.com/p/ABC123" });
    expect(S().savedRefs["scene-cut-detection"]).toEqual([reel]);
    // Detaching from that card removes the ref saved in the older form.
    S().removeRef("scene-cut-detection", "https://www.instagram.com/p/ABC123");
    expect(S().savedRefs["scene-cut-detection"]).toEqual([]);
  });

  it("refs round-trip through export/import", () => {
    S().addRef("scene-cut-detection", ref);
    const json = S().exportState();
    S().reset();
    expect(S().savedRefs).toEqual({});
    S().importState(json);
    expect(S().savedRefs["scene-cut-detection"]).toEqual([ref]);
  });

  it("keeps an optional thumbnail on a ref through export/import", () => {
    const withThumb = { ...other, thumb: "https://i.ytimg.com/vi/b/hqdefault.jpg" };
    S().addRef("scene-cut-detection", withThumb);
    const json = S().exportState();
    S().reset();
    S().importState(json);
    expect(S().savedRefs["scene-cut-detection"]).toEqual([withThumb]);
  });
});

describe("notes", () => {
  const id = "smart-bins-keywords";
  it("saves, updates and clears a skill's note without touching quests or XP", () => {
    S().setNote(id, "# Bins\n[[Scene cut]]", at("2026-09-28T10:00:00Z"));
    expect(noteForSkill(S(), id)).toEqual({
      body: "# Bins\n[[Scene cut]]",
      updatedAt: "2026-09-28T10:00:00.000Z",
    });
    expect(isQuestDone(S(), id, "research")).toBe(false);
    expect(totalXp(S())).toBe(0);

    S().setNote(id, "# Bins", at("2026-09-28T11:00:00Z"));
    expect(S().notes[id].updatedAt).toBe("2026-09-28T11:00:00.000Z");
    // Same text: timestamp kept.
    S().setNote(id, "# Bins", at("2026-09-28T12:00:00Z"));
    expect(S().notes[id].updatedAt).toBe("2026-09-28T11:00:00.000Z");

    S().setNote(id, "   \n ");
    expect(noteForSkill(S(), id)).toBeUndefined();
    expect(S().notes).toEqual({});
  });

  it("ignores unknown skills and caps the length", () => {
    S().setNote("no-such-skill", "hi");
    expect(S().notes).toEqual({});
    S().setNote(id, "x".repeat(100_050));
    expect(S().notes[id].body).toHaveLength(100_000);
  });

  it("round-trips through export/import", () => {
    S().setNote(id, "keep me");
    const json = S().exportState();
    S().reset();
    expect(S().notes).toEqual({});
    S().importState(json);
    expect(S().notes[id].body).toBe("keep me");
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

/* ---------- Sprint 2 gamification core ---------- */

describe("backwards compatibility", () => {
  const oldState = {
    settings: DEFAULT_SETTINGS,
    completions: [
      { skillId: "smart-bins-keywords", quest: "train", at: "2026-09-01T10:00:00.000Z" },
    ],
    xpEvents: [
      {
        id: "e1",
        source: "quest",
        amount: 15,
        at: "2026-09-01T10:00:00.000Z",
        refId: "smart-bins-keywords:train",
      },
    ],
    microActions: [],
    freezesUsedOn: [],
    reviews: [
      { foo: 1 },
      "junk",
      {
        week: "2026-08-29",
        mood: 4,
        wins: "w",
        blocks: "b",
        next: "n",
        at: "2026-09-04T10:00:00.000Z",
      },
    ],
  };

  it("imports an export file from before the new fields and fills defaults", () => {
    S().importState(
      JSON.stringify({ app: "3z-prod", version: 1, exportedAt: "2026-09-01", state: oldState }),
    );
    expect(S().completions).toHaveLength(1);
    expect(totalXp(S())).toBe(15);
    expect(S().reviews).toEqual([oldState.reviews[2]]); // unknown entries dropped
    expect(S().gemEvents).toEqual([]);
    expect(S().chestsOpened).toBe(0);
    expect(S().focus).toBeNull();
    expect(S().focusSessions).toEqual([]);
    expect(S().bonusFreezes).toBe(0);
    expect(S().badges).toEqual([]);
    expect(S().bossesDefeated).toEqual([]);
    expect(S().seasonsFinished).toEqual([]);
    expect(S().drills).toEqual([]);
    expect(S().planItems).toEqual([]);
    expect(S().purchases).toEqual([]);
    expect(S().rewards).toEqual(defaultRewards());
  });

  it("imports an export file whose settings predate the avatar and fills the default look", () => {
    const { avatar: _dropped, ...settings } = DEFAULT_SETTINGS;
    void _dropped;
    S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: { ...oldState, settings },
      }),
    );
    expect(S().settings.avatar).toEqual(DEFAULT_AVATAR);
    expect(totalXp(S())).toBe(15);
  });

  it("hydrates an old localStorage save and keeps the built-in freeze reward", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { ...oldState, rewards: [] }, version: 1 }),
    );
    await hydrateStore();
    expect(totalXp(S())).toBe(15);
    expect(S().reviews).toHaveLength(1);
    expect(S().rewards.map((r) => r.id)).toEqual([FREEZE_REWARD_ID]);
    expect(gems(S())).toBe(0);
  });

  it("round-trips every new field through export/import", () => {
    master("fair-voice-chain");
    S().startFocus(25, at("2026-09-11T10:00:00Z"));
    S().saveReview({ week: "2026-09-05", mood: 3, wins: "", blocks: "", next: "" });
    S().addPlanItem({
      id: "p1",
      week: "2026-09-12",
      day: 0,
      skillId: "scene-cut-detection",
      quest: "train",
      minutes: 20,
      by: "me",
    });
    S().addReward({ id: "r1", name: "Coffee", cost: 10, repeatable: true, icon: "☕" });
    S().buyReward("r1", at("2026-09-11T10:00:00Z"));
    const json = S().exportState();
    const before = JSON.parse(json).state;
    S().reset();
    expect(S().drills).toEqual([]);
    S().importState(json);
    expect(JSON.parse(S().exportState()).state).toEqual(before);
    expect(S().drills).toHaveLength(1);
    expect(S().focus?.minutes).toBe(25);
    expect(S().purchases).toHaveLength(1);
    expect(S().planItems).toHaveLength(1);
  });
});

describe("gems", () => {
  it("quest gems are xp/5 (min 1) and mastery adds +10; uncomplete takes them back", () => {
    const r = S().completeQuest("smart-bins-keywords", "train"); // 15 XP → 3 gems
    expect(r.gems).toBe(3);
    expect(gems(S())).toBe(3);
    const m = master("scene-cut-detection"); // 10+15+25+30 → 2+3+5+6 = 16, +10 mastery
    expect(m.mastered).toBe(true);
    // Last quest (6) + mastery (10) + two badges: first-mastery and first-article (15 each).
    expect(m.badges.map((b) => b.id).sort()).toEqual(["first-article", "first-mastery"]);
    expect(m.gems).toBe(6 + GEM_RULES.mastery + 2 * GEM_RULES.badge);
    expect(gems(S())).toBe(3 + 16 + 10 + 30);
    S().uncompleteQuest("scene-cut-detection", "article");
    expect(gems(S())).toBe(3 + 10 + 30); // article gems and mastery gems removed, badge gems stay
  });

  it("day complete gives +5 gems once per Riyadh day", () => {
    const q = S().completeQuest(
      "smart-bins-keywords",
      "train",
      undefined,
      at("2026-09-26T10:00:00Z"),
    );
    expect(q.dayDone).toBe(false);
    const m = S().addMicroAction({ ar: "س", en: "x" }, at("2026-09-26T11:00:00Z"));
    expect(m.dayDone).toBe(true);
    expect(m.xp).toBe(3);
    expect(m.gems).toBe(GEM_RULES.dayComplete);
    expect(m.id).toBeTruthy(); // still a MicroAction
    const again = S().addMicroAction({ ar: "س", en: "x" }, at("2026-09-26T12:00:00Z"));
    expect(again.dayDone).toBe(false);
    expect(again.gems).toBe(0);
    expect(S().gemEvents.filter((e) => e.reason === "dayComplete")).toHaveLength(1);
    // Next day, the flow starts over.
    S().completeQuest("smart-bins-keywords", "research", undefined, at("2026-09-27T10:00:00Z"));
    const next = S().addMicroAction({ ar: "س", en: "x" }, at("2026-09-27T11:00:00Z"));
    expect(next.dayDone).toBe(true);
    expect(S().gemEvents.filter((e) => e.reason === "dayComplete")).toHaveLength(2);
  });
});

describe("chests", () => {
  it("a chest is ready every 5 quests and opens deterministically", () => {
    expect(chestProgress(S())).toEqual({ done: 0, needed: CHEST_EVERY, ready: false, pending: 0 });
    expect(S().openChest()).toBeNull();
    const results = [
      S().completeQuest("scene-cut-detection", "train"),
      S().completeQuest("scene-cut-detection", "research"),
      S().completeQuest("scene-cut-detection", "produce"),
      S().completeQuest("scene-cut-detection", "article"),
      S().completeQuest("smart-bins-keywords", "train"),
    ];
    expect(results.slice(0, 4).every((r) => !r.chestReady)).toBe(true);
    expect(results[4].chestReady).toBe(true);
    expect(chestProgress(S())).toMatchObject({ done: 5, ready: true, pending: 1 });

    const gemsBefore = gems(S());
    const freezesBefore = S().bonusFreezes;
    const loot = S().openChest(at("2026-09-26T10:00:00Z"));
    expect(loot).toMatchObject({ ...lootFor(1), number: 1 });
    expect(loot!.badges.map((b) => b.id)).toEqual(["first-chest"]);
    expect(S().chestsOpened).toBe(1);
    if (loot!.kind === "gems") expect(gems(S())).toBe(gemsBefore + loot!.amount + GEM_RULES.badge);
    else expect(gems(S())).toBe(gemsBefore + GEM_RULES.badge);
    if (loot!.kind === "freeze") expect(S().bonusFreezes).toBe(freezesBefore + 1);
    expect(chestProgress(S())).toMatchObject({ done: 0, ready: false, pending: 0 });
    expect(S().openChest()).toBeNull();
  });

  it("chest loot of a freeze adds a bonus freeze that the streak reports", () => {
    // Find the first chest number whose loot is a freeze and open chests up to it.
    let n = 1;
    while (lootFor(n).kind !== "freeze") n++;
    const ids = [
      "scene-cut-detection",
      "smart-bins-keywords",
      "fusion-nodes",
      "source-tape",
      "youtube-export",
      "fair-auto-ducker",
      "cst-log-workflow",
      "speed-ramp-retime",
      "gamma-shift-fix",
      "screen-replace",
    ];
    let quests = 0;
    for (const id of ids) {
      for (const q of ["train", "research", "produce", "article"] as const) {
        if (quests >= n * CHEST_EVERY) break;
        S().completeQuest(id, q, undefined, at("2026-09-26T10:00:00Z"));
        quests++;
      }
    }
    for (let i = 1; i <= n; i++) expect(S().openChest(at("2026-09-26T10:00:00Z"))).not.toBeNull();
    expect(S().bonusFreezes).toBeGreaterThanOrEqual(1);
    const st = streak(S(), "2026-09-26");
    expect(st.freezes).toBe(1 + S().bonusFreezes); // 1 earned week + bonus
  });
});

describe("focus sessions", () => {
  const t0 = at("2026-09-26T10:00:00Z");

  it("boosts quest XP by 25 % while running, not the mastery bonus", () => {
    expect(focusActive(S(), t0)).toBeNull();
    const f = S().startFocus(25, t0);
    expect(f).toEqual({ startedAt: t0.toISOString(), minutes: 25 });
    expect(S().startFocus(60, at("2026-09-26T10:05:00Z"))).toEqual(f); // already running
    expect(focusActive(S(), at("2026-09-26T10:05:00Z"))).toMatchObject({
      remainingMs: 20 * 60_000,
      minutes: 25,
    });

    const r = S().completeQuest(
      "smart-bins-keywords",
      "train",
      undefined,
      at("2026-09-26T10:10:00Z"),
    );
    expect(r.xp).toBe(19); // round(15 × 1.25)
    expect(r.focusBonus).toBe(4);
    expect(r.gems).toBe(4); // round(19 / 5)

    // Mastery during focus: quest boosted, +20 bonus untouched.
    for (const q of ["train", "research", "produce"] as const)
      S().completeQuest("scene-cut-detection", q, undefined, at("2026-09-26T10:12:00Z"));
    const m = S().completeQuest(
      "scene-cut-detection",
      "article",
      undefined,
      at("2026-09-26T10:15:00Z"),
    );
    expect(m.mastered).toBe(true);
    expect(m.focusBonus).toBe(8); // 30 → 38
    expect(m.xp).toBe(38 + MASTERY_BONUS);

    // After the timer: no boost, and the session is settled into history as not early.
    const late = S().completeQuest(
      "smart-bins-keywords",
      "research",
      undefined,
      at("2026-09-26T10:30:00Z"),
    );
    expect(late.xp).toBe(23);
    expect(late.focusBonus).toBe(0);
    expect(S().focus).toBeNull();
    expect(S().focusSessions).toHaveLength(1);
    expect(S().focusSessions[0]).toMatchObject({
      minutes: 25,
      early: false,
      endedAt: "2026-09-26T10:25:00.000Z",
    });
  });

  it("stopFocus records early stops and returns null without a session", () => {
    expect(S().stopFocus(t0)).toBeNull();
    S().startFocus(60, t0);
    const s = S().stopFocus(at("2026-09-26T10:20:00Z"));
    expect(s).toMatchObject({
      minutes: 60,
      early: true,
      endedAt: "2026-09-26T10:20:00.000Z",
      badges: [],
    });
    expect(S().focus).toBeNull();
    expect(focusActive(S(), t0)).toBeNull();
  });

  it("ten sessions earn the focus-10 badge", () => {
    for (let i = 0; i < 9; i++) {
      S().startFocus(25, at(`2026-09-${String(i + 1).padStart(2, "0")}T10:00:00Z`));
      S().stopFocus(at(`2026-09-${String(i + 1).padStart(2, "0")}T10:25:00Z`));
    }
    S().startFocus(25, at("2026-09-10T10:00:00Z"));
    const s = S().stopFocus(at("2026-09-10T10:10:00Z"));
    expect(s!.badges.map((b) => b.id)).toEqual(["focus-10"]);
    expect(gems(S())).toBe(GEM_RULES.badge);
  });
});

describe("bonus freezes", () => {
  it("earned freezes are spent first, bonus ones last; total capped at 5", () => {
    S().completeQuest("smart-bins-keywords", "train", undefined, at("2026-09-18T10:00:00Z")); // Fri
    S().completeQuest("smart-bins-keywords", "research", undefined, at("2026-09-19T10:00:00Z")); // Sat → 2 earned
    useStore.setState({ bonusFreezes: 2 });
    expect(streak(S(), "2026-09-23").freezes).toBe(4);
    useStore.setState({ bonusFreezes: 9 });
    expect(streak(S(), "2026-09-23").freezes).toBe(FREEZE_TOTAL_CAP);
    useStore.setState({ bonusFreezes: 1 });
    // Missed 20, 21, 22 → needs 3: 2 earned + 1 bonus.
    expect(S().applyStreakFreezes(at("2026-09-23T10:00:00Z"))).toEqual([
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
    ]);
    expect(S().bonusFreezes).toBe(0);
    expect(streak(S(), "2026-09-23").freezes).toBe(0);
    S().addMicroAction({ ar: "س", en: "x" }, at("2026-09-23T10:00:00Z"));
    expect(streak(S(), "2026-09-23").current).toBe(3);
  });

  it("a 1-day gap with earned stock leaves the bonus freeze untouched", () => {
    S().completeQuest("smart-bins-keywords", "train", undefined, at("2026-09-19T10:00:00Z"));
    useStore.setState({ bonusFreezes: 1 });
    expect(S().applyStreakFreezes(at("2026-09-21T10:00:00Z"))).toEqual(["2026-09-20"]);
    expect(S().bonusFreezes).toBe(1);
  });
});

describe("badges", () => {
  it("awards badges from completeQuest with +15 gems each, once", () => {
    const ids = ["scene-cut-detection", "smart-bins-keywords", "fusion-nodes"];
    const seen: string[] = [];
    let n = 0;
    for (const id of ids)
      for (const q of ["train", "research", "produce", "article"] as const) {
        const r = S().completeQuest(id, q, undefined, at("2026-09-26T10:00:00Z"));
        n++;
        seen.push(...r.badges.map((b) => b.id));
        if (n === 10) expect(r.badges.map((b) => b.id)).toContain("quests-10");
      }
    expect(seen).toContain("first-mastery");
    expect(seen).toContain("first-article");
    expect(seen.filter((b) => b === "first-mastery")).toHaveLength(1);
    expect(
      S()
        .badges.map((b) => b.id)
        .sort(),
    ).toEqual([...new Set(seen)].sort());
    expect(S().gemEvents.filter((e) => e.reason === "badge")).toHaveLength(new Set(seen).size);
    expect(
      earnedBadges(S())
        .map((e) => e.badge.id)
        .sort(),
    ).toEqual([...new Set(seen)].sort());
    expect(S().checkBadges(at("2026-09-26T10:00:00Z"))).toEqual([]);
  });

  it("first-proof needs a produce quest with a link", () => {
    const r1 = S().completeQuest("scene-cut-detection", "produce");
    expect(r1.badges).toEqual([]);
    const r2 = S().completeQuest("smart-bins-keywords", "produce", "https://youtu.be/x");
    expect(r2.badges.map((b) => b.id)).toEqual(["first-proof"]);
  });

  it("checkBadges awards conditions that changed outside the XP actions", () => {
    useStore.setState({ chestsOpened: 1 });
    expect(
      S()
        .checkBadges()
        .map((b) => b.id),
    ).toEqual(["first-chest"]);
    expect(gems(S())).toBe(GEM_RULES.badge);
    expect(S().checkBadges()).toEqual([]);
  });
});

describe("monthly boss", () => {
  it("is defeated once per month by XP damage and pays +50 gems + boss-slayer", () => {
    const start = boss(S(), at("2026-09-01T10:00:00Z"));
    expect(start).toMatchObject({ month: "2026-09", hp: 300, damage: 0, defeated: false });
    master("fair-voice-chain", at("2026-09-05T10:00:00Z")); // 180
    expect(boss(S(), at("2026-09-05T10:00:00Z")).damage).toBe(180);
    const results = ["train", "research", "produce", "article"].map((q) =>
      S().completeQuest("gamma-shift-fix", q as "train", undefined, at("2026-09-06T10:00:00Z")),
    );
    // 180 + 20 + 30 + 50 = 280 < 300; the article (60 + 20) finishes it.
    expect(results.slice(0, 3).every((r) => !r.bossDefeated)).toBe(true);
    expect(results[3].bossDefeated).toBe(true);
    expect(results[3].badges.map((b) => b.id)).toContain("boss-slayer");
    expect(results[3].gems).toBe(12 + GEM_RULES.mastery + GEM_RULES.boss + GEM_RULES.badge);
    expect(S().bossesDefeated).toEqual(["2026-09"]);
    expect(boss(S(), at("2026-09-06T10:00:00Z"))).toMatchObject({
      defeated: true,
      hpLeft: 0,
      ratio: 1,
    });
    // More damage the same month does not celebrate again.
    const more = S().completeQuest(
      "scene-cut-detection",
      "train",
      undefined,
      at("2026-09-07T10:00:00Z"),
    );
    expect(more.bossDefeated).toBe(false);
    expect(S().gemEvents.filter((e) => e.reason === "boss")).toHaveLength(1);
    // October: a new boss with more HP (level went up), fresh damage.
    const oct = boss(S(), at("2026-10-02T10:00:00Z"));
    expect(oct.month).toBe("2026-10");
    expect(oct.boss.id).not.toBe(start.boss.id);
    expect(oct.hp).toBeGreaterThan(300);
    expect(oct.damage).toBe(0);
  });

  it("micro-actions do not damage the boss", () => {
    S().addMicroAction({ ar: "س", en: "x" }, at("2026-09-05T10:00:00Z"));
    expect(boss(S(), at("2026-09-05T10:00:00Z")).damage).toBe(0);
  });
});

describe("seasons", () => {
  it("10 themed quests finish the season once: +30 gems and the season-finisher badge", () => {
    expect(season(S(), "2026-09-12").season.id).toBe("color");
    master("scene-cut-detection", at("2026-09-02T10:00:00Z")); // davinci ×4
    master("fusion-nodes", at("2026-09-03T10:00:00Z")); // ×4 → 8
    S().completeQuest("iphone-lock-exposure-wb", "train", undefined, at("2026-09-04T10:00:00Z")); // camera: no
    const nine = S().completeQuest(
      "smart-bins-keywords",
      "train",
      undefined,
      at("2026-09-04T10:00:00Z"),
    );
    expect(nine.seasonDone).toBe(false);
    expect(season(S(), "2026-09-04").questsDone).toBe(9);
    const ten = S().completeQuest(
      "smart-bins-keywords",
      "research",
      undefined,
      at("2026-09-04T11:00:00Z"),
    );
    expect(ten.seasonDone).toBe(true);
    expect(ten.badges.map((b) => b.id)).toContain("season-finisher");
    expect(S().seasonsFinished).toEqual(["2026-09-01:color"]);
    expect(S().gemEvents.filter((e) => e.reason === "season")).toHaveLength(1);
    expect(season(S(), "2026-09-04").done).toBe(true);
    const eleven = S().completeQuest(
      "smart-bins-keywords",
      "produce",
      undefined,
      at("2026-09-05T10:00:00Z"),
    );
    expect(eleven.seasonDone).toBe(false);
  });
});

describe("drills", () => {
  it("mastery creates a drill due in 3 days; completing it gives +5 XP and advances the interval", () => {
    master("scene-cut-detection", at("2026-09-10T10:00:00Z"));
    expect(S().drills).toEqual([
      { skillId: "scene-cut-detection", nextDue: "2026-09-13", intervalDays: 3, reps: 0 },
    ]);
    expect(masteredSkillIds(S())).toEqual(new Set(["scene-cut-detection"]));
    expect(dueDrills(S(), "2026-09-12")).toEqual([]);
    expect(dueDrills(S(), "2026-09-13")).toHaveLength(1);

    const xpBefore = totalXp(S());
    const r = S().completeDrill("scene-cut-detection", at("2026-09-13T10:00:00Z"));
    expect(r.done).toBe(true);
    expect(r.xp).toBe(DRILL_XP);
    expect(r.levelBefore).toBe(r.levelAfter);
    expect(totalXp(S())).toBe(xpBefore + DRILL_XP);
    expect(S().drills[0]).toMatchObject({ nextDue: "2026-09-20", intervalDays: 7, reps: 1 });
    expect(S().xpEvents.at(-1)).toMatchObject({ source: "drill", refId: "scene-cut-detection" });
    // Drill XP counts toward the skill's program and pillar.
    expect(programXp(S(), "davinci")).toBe(xpBefore + DRILL_XP);
    expect(pillarXp(S(), "editing")).toBe(xpBefore + DRILL_XP);
    expect(boss(S(), at("2026-09-13T10:00:00Z")).damage).toBe(xpBefore + DRILL_XP);
  });

  it("unknown drills are refused and un-mastering removes the drill", () => {
    const r = S().completeDrill("nope");
    expect(r.done).toBe(false);
    expect(r.xp).toBe(0);
    master("scene-cut-detection");
    expect(S().drills).toHaveLength(1);
    S().uncompleteQuest("scene-cut-detection", "train");
    expect(S().drills).toEqual([]);
    master("scene-cut-detection"); // re-mastering recreates it
    expect(S().drills).toHaveLength(1);
  });
});

describe("weekly review", () => {
  const review = {
    week: "2026-09-19",
    mood: 4,
    wins: "cut faster",
    blocks: "audio",
    next: "lav mic",
  };

  it("saveReview gives +10 XP and +5 gems once per week, then replaces", () => {
    expect(currentWeek("2026-09-24")).toBe("2026-09-19");
    const r = S().saveReview(review, at("2026-09-24T10:00:00Z"));
    expect(r.added).toBe(true);
    expect(r.xp).toBe(REVIEW_XP);
    expect(r.gems).toBe(GEM_RULES.review + GEM_RULES.badge);
    expect(r.badges.map((b) => b.id)).toEqual(["first-review"]);
    expect(reviewForWeek(S(), "2026-09-19")).toMatchObject(review);
    expect(S().xpEvents.at(-1)).toMatchObject({ source: "review", refId: "2026-09-19" });

    const again = S().saveReview({ ...review, mood: 2 }, at("2026-09-25T10:00:00Z"));
    expect(again.added).toBe(false);
    expect(again.xp).toBe(0);
    expect(again.gems).toBe(0);
    expect(S().reviews).toHaveLength(1);
    expect(S().reviews[0].mood).toBe(2);
    expect(totalXp(S())).toBe(REVIEW_XP);

    expect(S().reviews[0].at).toBe("2026-09-25T10:00:00.000Z"); // a replacing save refreshes `at`
    S().updateReview("2026-09-19", { wins: "edited" });
    expect(S().reviews[0].wins).toBe("edited");
    expect(S().reviews[0].at).toBe("2026-09-25T10:00:00.000Z"); // an edit does not
    S().updateReview("2026-01-03", { wins: "x" }); // no-op
    expect(S().reviews).toHaveLength(1);
    expect(() => S().saveReview({ ...review, week: "2026-09-26", mood: 9 })).toThrow();
  });

  it("a review counts toward the boss and level bookkeeping", () => {
    const r = S().saveReview(review, at("2026-09-24T10:00:00Z"));
    expect(r.levelBefore).toBe(1);
    expect(r.rankStepBefore).toBe(r.rankStepAfter);
    expect(boss(S(), at("2026-09-24T10:00:00Z")).damage).toBe(REVIEW_XP);
  });
});

describe("plan items", () => {
  const item = (id: string, week: string, day: number) => ({
    id,
    week,
    day,
    skillId: "scene-cut-detection",
    quest: "train" as const,
    minutes: 20,
    by: "rules" as const,
  });

  it("set / add / remove and the week selector", () => {
    S().setPlanItems("2026-09-26", [item("b", "2026-09-26", 3), item("a", "2026-09-26", 1)]);
    S().addPlanItem(item("c", "2026-10-03", 0));
    expect(planItemsForWeek(S(), "2026-09-26").map((p) => p.id)).toEqual(["a", "b"]);
    expect(planItemsForWeek(S(), "2026-10-03").map((p) => p.id)).toEqual(["c"]);
    S().setPlanItems("2026-09-26", [item("d", "2026-09-26", 5), item("x", "2026-10-03", 0)]); // other weeks ignored
    expect(planItemsForWeek(S(), "2026-09-26").map((p) => p.id)).toEqual(["d"]);
    expect(planItemsForWeek(S(), "2026-10-03").map((p) => p.id)).toEqual(["c"]);
    S().addPlanItem({ ...item("d", "2026-09-26", 6), minutes: 45 }); // same id replaces
    expect(planItemsForWeek(S(), "2026-09-26")).toEqual([
      { ...item("d", "2026-09-26", 6), minutes: 45 },
    ]);
    S().removePlanItem("d");
    expect(planItemsForWeek(S(), "2026-09-26")).toEqual([]);
    expect(() => S().addPlanItem({ ...item("e", "2026-09-26", 7) })).toThrow();
  });

  it("done-ness is derived from completions", () => {
    const p = item("a", "2026-09-26", 1);
    S().addPlanItem(p);
    expect(isPlanItemDone(S(), p)).toBe(false);
    S().completeQuest("scene-cut-detection", "train");
    expect(isPlanItemDone(S(), p)).toBe(true);
  });
});

describe("rewards shop", () => {
  it("seeds defaults and refuses for gems / level / owned / unknown", () => {
    expect(S().rewards).toEqual(defaultRewards());
    expect(S().buyReward("nope")).toEqual({ ok: false, reason: "unknown" });
    expect(S().buyReward(FREEZE_REWARD_ID)).toEqual({ ok: false, reason: "gems" });
    useStore.setState({
      gemEvents: [{ id: "g", amount: 1000, at: "2026-09-01T00:00:00.000Z", reason: "chest" }],
    });
    expect(S().buyReward("pro-mist")).toEqual({ ok: false, reason: "level" });
    expect(S().buyReward("lut-pack")).toEqual({ ok: true });
    expect(S().buyReward("lut-pack")).toEqual({ ok: false, reason: "owned" });
    expect(S().buyReward("dinner")).toEqual({ ok: true });
    expect(S().buyReward("dinner")).toEqual({ ok: true }); // repeatable
    expect(gems(S())).toBe(1000 - 180 - 250 - 250);
    expect(S().purchases.map((p) => p.rewardId)).toEqual(["lut-pack", "dinner", "dinner"]);
    expect(
      S()
        .gemEvents.filter((e) => e.reason === "purchase")
        .map((e) => e.amount),
    ).toEqual([-180, -250, -250]);
  });

  it("buying the freeze adds a bonus freeze up to the cap", () => {
    useStore.setState({
      gemEvents: [{ id: "g", amount: 1000, at: "2026-09-01T00:00:00.000Z", reason: "chest" }],
    });
    const now = at("2026-09-26T10:00:00Z");
    for (let i = 0; i < 5; i++) expect(S().buyReward(FREEZE_REWARD_ID, now)).toEqual({ ok: true });
    expect(S().bonusFreezes).toBe(5);
    expect(streak(S(), now).freezes).toBe(FREEZE_TOTAL_CAP);
    expect(S().buyReward(FREEZE_REWARD_ID, now)).toEqual({ ok: false, reason: "full" });
    expect(gems(S())).toBe(1000 - 5 * 40);
  });

  it("add / update / remove rewards; the built-in freeze cannot be removed", () => {
    S().addReward({
      id: "coffee",
      name: "Coffee",
      cost: 10,
      repeatable: true,
      icon: "☕",
      builtIn: true,
    });
    expect(S().rewards.find((r) => r.id === "coffee")).toMatchObject({ builtIn: false });
    S().updateReward("coffee", { cost: 12, minLevel: 2 });
    expect(S().rewards.find((r) => r.id === "coffee")).toMatchObject({ cost: 12, minLevel: 2 });
    S().updateReward("nope", { cost: 1 }); // no-op
    S().removeReward("coffee");
    S().removeReward(FREEZE_REWARD_ID);
    S().removeReward("dinner");
    expect(S().rewards.map((r) => r.id)).toEqual([FREEZE_REWARD_ID, "lut-pack", "pro-mist"]);
    expect(() =>
      S().addReward({ id: "", name: "x", cost: 1, repeatable: true, icon: "x" }),
    ).toThrow();
  });
});

/* ---------- 📱 Social world ---------- */

describe("social: posts", () => {
  const now = at("2026-09-27T10:00:00Z");

  it("addPost fills defaults: idea stage, empty script, suggested hashtags, no shots", () => {
    const p = S().addPost({ platform: "tiktok", title: "Riyadh in match cuts" }, now);
    expect(p).toMatchObject({
      platform: "tiktok",
      title: "Riyadh in match cuts",
      stage: "idea",
      caption: "",
      script: EMPTY_SCRIPT,
      shots: [],
      plannedDay: null,
      plannedTime: null,
      hashtags: suggestHashtags("tiktok"),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect(p.id).toBeTruthy();
    expect(S().posts).toEqual([p]);
    expect(postById(S(), p.id)).toBe(p);
  });

  it("addPost keeps given hashtags, uses the template when asked, and validates", () => {
    const p = S().addPost(
      { platform: "youtube", title: "Full tutorial", hashtags: ["#mine"], withTemplate: true },
      now,
    );
    expect(p.hashtags).toEqual(["#mine"]);
    expect(p.shots).toHaveLength(SHOT_TEMPLATES.youtube.length);
    expect(p.shots[0]).toMatchObject({
      type: "hook",
      done: false,
      text: SHOT_TEMPLATES.youtube[0].text.ar,
    });
    expect(new Set(p.shots.map((s) => s.id)).size).toBe(p.shots.length);
    S().setSettings({ lang: "en" });
    const en = S().addPost({ platform: "x", title: "Thread", withTemplate: true }, now);
    expect(en.shots[0].text).toBe(SHOT_TEMPLATES.x[0].text.en);
    expect(() => S().addPost({ platform: "tiktok", title: "" })).toThrow();
    expect(() =>
      S().addPost({ platform: "tiktok", title: "x", plannedDay: "27/09/2026" }),
    ).toThrow();
    expect(() => S().addPost({ platform: "tiktok", title: "x", plannedTime: "9pm" })).toThrow();
    expect(S().posts).toHaveLength(2);
  });

  it("updatePost merges, validates and bumps updatedAt; unknown ids are ignored", () => {
    const p = S().addPost({ platform: "instagram", title: "Before/after" }, now);
    const later = at("2026-09-27T11:00:00Z");
    const u = S().updatePost(
      p.id,
      { caption: "cap", plannedDay: "2026-09-28", plannedTime: "20:30", script: { hook: "hi" } },
      later,
    );
    expect(u).toMatchObject({
      caption: "cap",
      plannedDay: "2026-09-28",
      plannedTime: "20:30",
      script: { hook: "hi", beats: ["", "", ""], cta: "" },
      createdAt: now.toISOString(),
      updatedAt: later.toISOString(),
    });
    expect(S().posts[0]).toEqual(u);
    expect(() => S().updatePost(p.id, { plannedTime: "25:00" })).toThrow();
    expect(S().posts[0].plannedTime).toBe("20:30");
    expect(S().updatePost("nope", { caption: "x" })).toBeUndefined();
  });

  it("updatePosts merges several patches in one save; unknown ids are skipped", () => {
    const a = S().addPost({ platform: "instagram", title: "A" }, now);
    const b = S().addPost({ platform: "tiktok", title: "B" }, now);
    const later = at("2026-09-27T11:00:00Z");
    const saves = vi.spyOn(Storage.prototype, "setItem");
    S().updatePosts(
      new Map([
        [a.id, { caption: "one" }],
        [b.id, { caption: "two" }],
        ["nope", { caption: "x" }],
      ]),
      later,
    );
    expect(saves).toHaveBeenCalledTimes(1);
    expect(postById(S(), a.id)).toMatchObject({
      caption: "one",
      createdAt: now.toISOString(),
      updatedAt: later.toISOString(),
    });
    expect(postById(S(), b.id)?.caption).toBe("two");
    S().updatePosts(new Map([["nope", { caption: "x" }]]));
    expect(saves).toHaveBeenCalledTimes(1);
    expect(() => S().updatePosts(new Map([[a.id, { plannedTime: "25:00" }]]))).toThrow();
    expect(postById(S(), a.id)?.caption).toBe("one");
    saves.mockRestore();
  });

  it("setPostStage moves the pipeline; posted here stamps postedAt but completes no quest", () => {
    const p = S().addPost({ platform: "tiktok", title: "t", skillId: "scene-cut-detection" }, now);
    expect(S().setPostStage(p.id, "filmed", now)?.stage).toBe("filmed");
    const posted = S().setPostStage(p.id, "posted", now);
    expect(posted?.postedAt).toBe(now.toISOString());
    expect(isQuestDone(S(), "scene-cut-detection", "produce")).toBe(false);
    expect(S().setPostStage("nope", "idea")).toBeUndefined();
  });

  it("shots: add, toggle, remove", () => {
    const p = S().addPost({ platform: "tiktok", title: "t" }, now);
    const a = S().addShot(p.id, { type: "hook", text: "face" }, now)!;
    const b = S().addShot(p.id, { type: "broll", text: "coffee", id: "b1", done: true }, now)!;
    expect(a).toMatchObject({ type: "hook", text: "face", done: false });
    expect(b).toEqual({ id: "b1", type: "broll", text: "coffee", done: true });
    expect(postById(S(), p.id)?.shots).toEqual([a, b]);
    expect(S().toggleShot(p.id, a.id, now)?.shots[0].done).toBe(true);
    expect(S().toggleShot(p.id, "missing", now)?.shots[0].done).toBe(true);
    expect(S().removeShot(p.id, "b1", now)?.shots).toHaveLength(1);
    expect(S().addShot("nope", { type: "wide", text: "" })).toBeUndefined();
    expect(S().toggleShot("nope", "x")).toBeUndefined();
  });

  it("removePost deletes the post and unlinks ideas pointing at it", () => {
    const idea = S().addIdea({ text: "Green look", source: "audience" }, now);
    const p = S().useIdea(idea.id, "tiktok", now)!;
    expect(S().ideas[0].usedInPostId).toBe(p.id);
    S().removePost(p.id);
    expect(S().posts).toEqual([]);
    expect(S().ideas[0].usedInPostId).toBeUndefined();
    S().removePost("nope");
  });
});

describe("social: the bridge (markPosted ↔ Produce quest)", () => {
  const now = at("2026-09-27T18:00:00Z");
  const skillId = "scene-cut-detection"; // tier 1 → produce = 25 XP

  it("createPostFromSkill titles the post after the skill, hooks it with the quest text and refuses duplicates", () => {
    const skill = getSkill(skillId)!;
    const p = S().createPostFromSkill(skillId, "tiktok", now)!;
    expect(p).toMatchObject({
      title: skill.name.ar,
      hook: skill.quests.produce.ar,
      skillId,
      platform: "tiktok",
      stage: "idea",
      plannedTime: bestTime("tiktok"),
      hashtags: suggestHashtags("tiktok", skill),
    });
    expect(p.hashtags[0]).toBe("#davinciresolve");
    expect(p.shots).toHaveLength(SHOT_TEMPLATES.tiktok.length);
    expect(p.ideaId).toBeUndefined();
    // Same skill + platform → the existing live post; another platform → a new one.
    expect(S().createPostFromSkill(skillId, "tiktok", now)).toBe(S().posts[0]);
    expect(S().createPostFromSkill(skillId, "youtube", now)?.id).not.toBe(p.id);
    expect(S().posts).toHaveLength(2);
    expect(postsForSkill(S(), skillId)).toHaveLength(2);
    expect(skillInCalendar(S(), skillId)?.id).toBe(p.id);
    expect(S().createPostFromSkill("nope", "tiktok")).toBeUndefined();
    S().setSettings({ lang: "en" });
    expect(S().createPostFromSkill("smart-bins-keywords", "x", now)?.title).toBe(
      getSkill("smart-bins-keywords")!.name.en,
    );
  });

  it("markPosted completes the Produce quest exactly once, with the proof url", () => {
    const p = S().createPostFromSkill(skillId, "tiktok", now)!;
    const r = S().markPosted(p.id, " https://tiktok.com/@3z/video/1 ", now);
    expect(r.post).toMatchObject({
      stage: "posted",
      postedAt: now.toISOString(),
      postedUrl: "https://tiktok.com/@3z/video/1",
    });
    expect(r.quest?.added).toBe(true);
    expect(r.quest?.xp).toBe(questXp("produce", 1));
    expect(isQuestDone(S(), skillId, "produce")).toBe(true);
    expect(S().completions[0].proofUrl).toBe("https://tiktok.com/@3z/video/1");
    expect(totalXp(S())).toBe(25);
    expect(postForQuestProof(S(), skillId)?.id).toBe(p.id);
    expect(skillInCalendar(S(), skillId)).toBeUndefined();

    // Again: link updates, no second completion, no more XP.
    const again = S().markPosted(
      p.id,
      "https://tiktok.com/@3z/video/2",
      at("2026-09-28T10:00:00Z"),
    );
    expect(again.quest).toBeNull();
    expect(again.post?.postedUrl).toBe("https://tiktok.com/@3z/video/2");
    expect(again.post?.postedAt).toBe(now.toISOString());
    expect(S().completions).toHaveLength(1);
    expect(S().completions[0].proofUrl).toBe("https://tiktok.com/@3z/video/1"); // quest proof untouched
    expect(totalXp(S())).toBe(25);

    // A second post for the same skill (another platform) does not award the quest twice either.
    const yt = S().createPostFromSkill(skillId, "youtube", now)!;
    expect(S().markPosted(yt.id, "https://youtu.be/x", now).quest).toBeNull();
    expect(totalXp(S())).toBe(25);
    expect(S().markPosted("nope", "u")).toEqual({ post: undefined, quest: null });
  });

  it("markPosted without a skill just posts; an empty url leaves postedUrl unset", () => {
    const p = S().addPost({ platform: "snapchat", title: "BTS" }, now);
    const r = S().markPosted(p.id, "", now);
    expect(r.quest).toBeNull();
    expect(r.post?.stage).toBe("posted");
    expect(r.post?.postedUrl).toBeUndefined();
    expect(S().completions).toEqual([]);
  });

  it("markPosted on a skill whose quest is already done leaves the quest alone", () => {
    S().completeQuest(skillId, "produce", "https://old", now);
    const p = S().createPostFromSkill(skillId, "tiktok", now)!;
    const r = S().markPosted(p.id, "https://new", now);
    expect(r.quest).toBeNull();
    expect(S().completions[0].proofUrl).toBe("https://old");
    expect(totalXp(S())).toBe(25);
  });

  it("markPosted carries the mastery bonus and other outcomes through", () => {
    for (const q of ["train", "research", "article"] as const)
      S().completeQuest(skillId, q, undefined, now);
    const p = S().createPostFromSkill(skillId, "tiktok", now)!;
    const r = S().markPosted(p.id, "https://tiktok.com/v", now);
    expect(r.quest?.mastered).toBe(true);
    expect(r.quest?.xp).toBe(25 + MASTERY_BONUS);
    expect(masteredSkillIds(S()).has(skillId)).toBe(true);
  });

  it("unmarkPosted returns the post to scheduled and keeps the quest", () => {
    const p = S().createPostFromSkill(skillId, "tiktok", now)!;
    S().markPosted(p.id, "https://tiktok.com/v", now);
    const back = S().unmarkPosted(p.id, at("2026-09-28T10:00:00Z"));
    expect(back).toMatchObject({ stage: "scheduled", updatedAt: "2026-09-28T10:00:00.000Z" });
    expect(back?.postedAt).toBeUndefined();
    expect(back?.postedUrl).toBeUndefined();
    expect(isQuestDone(S(), skillId, "produce")).toBe(true);
    expect(totalXp(S())).toBe(25);
    // Not posted → stage unchanged.
    const q = S().addPost({ platform: "x", title: "t", stage: "filmed" }, now);
    expect(S().unmarkPosted(q.id)?.stage).toBe("filmed");
    expect(S().unmarkPosted("nope")).toBeUndefined();
  });
});

describe("social: ideas, snapshots, asks, accounts", () => {
  const now = at("2026-09-27T10:00:00Z");

  it("ideas: add, use (idempotent, links the post), remove", () => {
    const i = S().addIdea(
      { text: "DaVinci on iPad?", source: "audience", platform: "youtube" },
      now,
    );
    expect(i).toMatchObject({ text: "DaVinci on iPad?", source: "audience", platform: "youtube" });
    const s = S().addIdea(
      { text: "Smart bins", source: "skill", skillId: "smart-bins-keywords" },
      now,
    );
    expect(ideasCount(S())).toBe(2);
    const p = S().useIdea(s.id, "tiktok", now)!;
    expect(p).toMatchObject({
      title: "Smart bins",
      platform: "tiktok",
      ideaId: s.id,
      skillId: "smart-bins-keywords",
      plannedTime: bestTime("tiktok"),
    });
    expect(S().ideas[1].usedInPostId).toBe(p.id);
    expect(S().useIdea(s.id, "youtube", now)).toBe(S().posts[0]); // idempotent
    expect(S().posts).toHaveLength(1);
    expect(unusedIdeas(S()).map((x) => x.id)).toEqual([i.id]);
    expect(ideasCount(S())).toBe(1);
    expect(S().useIdea("nope", "x")).toBeUndefined();
    expect(() => S().addIdea({ text: "", source: "me" })).toThrow();
    S().toggleIdeaFavorite(i.id);
    expect(S().ideas[0].favorite).toBe(true);
    expect(S().ideas[1].favorite).toBeUndefined();
    S().toggleIdeaFavorite(i.id);
    expect(S().ideas[0].favorite).toBe(false);
    S().removeIdea(i.id);
    expect(S().ideas).toHaveLength(1);
  });

  it("snapshots: add replaces the same platform + day, import upserts, remove drops", () => {
    S().addSnapshot({ platform: "tiktok", day: "2026-09-27", followers: 100, views30d: 1000 });
    S().addSnapshot({ platform: "tiktok", day: "2026-09-27", followers: 120, views30d: 1100 });
    S().importSnapshots([
      { platform: "tiktok", day: "2026-09-01", followers: 90, views30d: 900 },
      { platform: "x", day: "2026-09-27", followers: 5, views30d: 50, engagementPct: 2.5 },
    ]);
    expect(S().socialSnapshots).toHaveLength(3);
    expect(S().socialSnapshots[0]).toMatchObject({ followers: 120, views30d: 1100 });
    expect(() =>
      S().addSnapshot({ platform: "tiktok", day: "2026-9-1", followers: 1, views30d: 1 }),
    ).toThrow();
    expect(() =>
      S().addSnapshot({ platform: "tiktok", day: "2026-09-01", followers: -1, views30d: 1 }),
    ).toThrow();
    S().removeSnapshot("tiktok", "2026-09-01");
    expect(S().socialSnapshots.map((s) => `${s.platform}:${s.day}`)).toEqual([
      "tiktok:2026-09-27",
      "x:2026-09-27",
    ]);
  });

  it("asks: add merges the same text, bump adds, remove drops", () => {
    const a = S().addAsk({ text: "How do you get the green look?", platform: "tiktok" }, now);
    expect(a.count).toBe(1);
    const merged = S().addAsk({ text: "  how do you get the GREEN look? ", count: 3 }, now);
    expect(merged.id).toBe(a.id);
    expect(merged.count).toBe(4);
    expect(S().audienceAsks).toHaveLength(1);
    S().bumpAsk(a.id);
    S().bumpAsk(a.id, 5);
    expect(S().audienceAsks[0].count).toBe(10);
    S().bumpAsk(a.id, -100);
    expect(S().audienceAsks[0].count).toBe(1);
    expect(() => S().addAsk({ text: "  " })).toThrow();
    S().removeAsk(a.id);
    expect(S().audienceAsks).toEqual([]);
  });

  it("accounts: one per platform, handle without @", () => {
    S().setAccount("tiktok", "@3zprod", "https://tiktok.com/@3zprod");
    S().setAccount("tiktok", "3z.prod");
    S().setAccount("x", "3zprod", "  ");
    expect(S().socialAccounts).toEqual([
      { platform: "tiktok", handle: "3z.prod" },
      { platform: "x", handle: "3zprod" },
    ]);
    expect(accountFor(S(), "tiktok")?.handle).toBe("3z.prod");
    expect(accountFor(S(), "youtube")).toBeUndefined();
    expect(() => S().setAccount("x", "@")).toThrow();
    S().removeAccount("tiktok");
    expect(S().socialAccounts.map((a) => a.platform)).toEqual(["x"]);
  });

  it("nextPostFor reads the calendar", () => {
    S().addPost(
      { platform: "tiktok", title: "later", plannedDay: "2026-09-28", plannedTime: "21:00" },
      now,
    );
    const soon = S().addPost(
      { platform: "instagram", title: "soon", plannedDay: "2026-09-27", plannedTime: "20:30" },
      now,
    );
    const next = nextPostFor(S(), at("2026-09-27T17:00:00+03:00"));
    expect(next?.post.id).toBe(soon.id);
    expect(next?.countdownMs).toBe(3.5 * 3_600_000);
    expect(nextPostFor(S(), at("2026-10-01T00:00:00Z"))).toBeNull();
  });
});

describe("social: saved hashtag sets (A8)", () => {
  const now = at("2026-10-23T10:00:00Z");

  it("saves a clean set, replaces a same-named one in place, refuses empty ones and removes", () => {
    const a = S().addHashtagSet("  Cuts ", ["match_cut", "#Editing", "#MATCH_CUT"], now);
    expect(a).toMatchObject({ name: "Cuts", tags: ["#match_cut", "#Editing"] });
    expect(a?.createdAt).toBe(now.toISOString());
    expect(S().hashtagSets).toHaveLength(1);

    // The same name (any case) updates that set: same id, new tags, nothing added.
    const again = S().addHashtagSet("cuts", ["#new", "#tags"], at("2026-10-24T10:00:00Z"));
    expect(again).toMatchObject({ id: a?.id, createdAt: a?.createdAt, tags: ["#new", "#tags"] });
    expect(S().hashtagSets).toHaveLength(1);

    expect(S().addHashtagSet("   ", ["#x"], now)).toBeUndefined();
    expect(S().addHashtagSet("Empty", [" # ", ""], now)).toBeUndefined();
    expect(S().addHashtagSet("x".repeat(60), ["#x"], now)?.name).toHaveLength(40);
    expect(S().hashtagSets).toHaveLength(2);

    S().removeHashtagSet(a!.id);
    expect(S().hashtagSets.map((h) => h.name)).toEqual(["x".repeat(40)]);
    S().reset();
    expect(S().hashtagSets).toEqual([]);
  });
});

describe("social analytics: post stats, demographics, seed flag", () => {
  const stat = (platform: "tiktok" | "threads", postId: string, views: number) => ({
    platform,
    postId,
    publishedAt: "2026-09-20T18:00:00.000Z",
    views,
  });

  it("snapshots accept the analytics metrics and normalize the engagement alias", () => {
    S().addSnapshot({ platform: "threads", day: "2026-09-27", followers: 0, engagementRate: 6.5 });
    expect(S().socialSnapshots[0]).toMatchObject({
      views30d: 0,
      engagementPct: 6.5,
      engagementRate: 6.5,
    });
    S().importSnapshots([
      { platform: "tiktok", day: "2026-09-27", followers: 1200, avgViews: 30200, posts30d: 4 },
    ]);
    expect(S().socialSnapshots[1]).toMatchObject({ avgViews: 30200, posts30d: 4 });
    expect(() =>
      S().addSnapshot({ platform: "tiktok", day: "2026-09-27", followers: 1, avgViews: -1 }),
    ).toThrow();
  });

  it("post stats: import upserts by platform + postId, remove drops one", () => {
    S().importPostStats([stat("tiktok", "a", 10), stat("threads", "a", 5)]);
    S().importPostStats([{ ...stat("tiktok", "a", 20), kind: "video", likes: 3 }]);
    expect(S().socialPostStats).toHaveLength(2);
    expect(S().socialPostStats[0]).toEqual({
      platform: "tiktok",
      postId: "a",
      publishedAt: "2026-09-20T18:00:00.000Z",
      kind: "video",
      views: 20,
      likes: 3,
      comments: 0,
      shares: 0,
    });
    expect(S().socialPostStats[1].kind).toBe("other");
    expect(postStatsFor(S(), "threads")).toHaveLength(1);
    expect(() =>
      S().importPostStats([{ ...stat("tiktok", "b", 1), publishedAt: "yesterday" }]),
    ).toThrow();
    S().removePostStat("tiktok", "a");
    expect(S().socialPostStats.map((p) => p.platform)).toEqual(["threads"]);
    expect(analyticsState(S())).toEqual({
      snapshots: [],
      postStats: S().socialPostStats,
      accounts: [],
    });
  });

  it("demographics: import replaces the same platform + day + dimension set, clear drops by platform/day", () => {
    const row = (
      platform: "tiktok" | "instagram",
      day: string,
      dimension: "gender" | "age",
      key: string,
      pct: number,
    ) => ({ platform, day, dimension, key, pct });
    S().importDemographics([
      row("tiktok", "2026-09-27", "gender", "male", 60),
      row("tiktok", "2026-09-27", "gender", "female", 40),
      row("tiktok", "2026-09-27", "age", "25-34", 50),
      row("instagram", "2026-09-27", "gender", "male", 90),
      row("tiktok", "2026-09-01", "gender", "male", 55),
    ]);
    S().importDemographics([row("tiktok", "2026-09-27", "gender", "male", 56)]);
    const keys = () =>
      S().demographics.map((d) => `${d.platform}/${d.day}/${d.dimension}/${d.key}=${d.pct}`);
    expect(keys()).toEqual([
      "tiktok/2026-09-27/age/25-34=50",
      "instagram/2026-09-27/gender/male=90",
      "tiktok/2026-09-01/gender/male=55",
      "tiktok/2026-09-27/gender/male=56",
    ]);
    expect(() => S().importDemographics([row("tiktok", "2026-09-27", "age", "x", 101)])).toThrow();
    S().clearDemographics("tiktok", "2026-09-01");
    expect(keys()).toHaveLength(3);
    S().clearDemographics("tiktok");
    expect(keys()).toEqual(["instagram/2026-09-27/gender/male=90"]);
  });

  it("remembers the seed version and round-trips the new fields through export/import", () => {
    expect(S().socialSeedApplied).toBe("");
    S().setSocialSeedApplied("2026-09-27");
    S().importPostStats([stat("tiktok", "a", 10)]);
    S().importDemographics([
      {
        platform: "tiktok",
        day: "2026-09-27",
        dimension: "age",
        key: "25-34",
        pct: 53,
        gender: "male",
      },
    ]);
    const json = S().exportState();
    const before = JSON.parse(json).state;
    expect(before.socialSeedApplied).toBe("2026-09-27");
    S().reset();
    expect(S().socialPostStats).toEqual([]);
    expect(S().demographics).toEqual([]);
    expect(S().socialSeedApplied).toBe("");
    S().importState(json);
    expect(JSON.parse(S().exportState()).state).toEqual(before);
    expect(S().demographics[0].gender).toBe("male");
  });
});

describe("social: persistence", () => {
  it("round-trips every social field through export/import and the reset clears them", () => {
    const now = at("2026-09-27T10:00:00Z");
    const p = S().createPostFromSkill("scene-cut-detection", "tiktok", now)!;
    S().markPosted(p.id, "https://tiktok.com/v", now);
    const idea = S().addIdea({ text: "idea", source: "trend", platform: "instagram" }, now);
    S().useIdea(idea.id, "instagram", now);
    S().addSnapshot({ platform: "x", day: "2026-09-27", followers: 5, views30d: 50 });
    S().addAsk({ text: "ask" }, now);
    S().setAccount("youtube", "3zprod");
    const json = S().exportState();
    const before = JSON.parse(json).state;
    expect(before.posts).toHaveLength(2);
    S().reset();
    expect(S().posts).toEqual([]);
    expect(S().ideas).toEqual([]);
    expect(S().socialSnapshots).toEqual([]);
    expect(S().audienceAsks).toEqual([]);
    expect(S().socialAccounts).toEqual([]);
    S().importState(json);
    expect(JSON.parse(S().exportState()).state).toEqual(before);
    expect(S().posts[0].shots).toHaveLength(SHOT_TEMPLATES.tiktok.length);
    expect(S().ideas[0].usedInPostId).toBe(S().posts[1].id);
  });

  it("imports an export from before the Social world and fills empty lists", () => {
    S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
        },
      }),
    );
    expect(S().posts).toEqual([]);
    expect(S().ideas).toEqual([]);
    expect(S().socialSnapshots).toEqual([]);
    expect(S().audienceAsks).toEqual([]);
    expect(S().socialAccounts).toEqual([]);
    expect(S().socialPostStats).toEqual([]);
    expect(S().demographics).toEqual([]);
    expect(S().socialSeedApplied).toBe("");
  });

  it("imports an export from before the analytics fields (engagementPct-only snapshots) untouched", () => {
    S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-20",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
          socialSnapshots: [
            {
              platform: "tiktok",
              day: "2026-09-20",
              followers: 1000,
              views30d: 5000,
              engagementPct: 4,
            },
          ],
          socialAccounts: [{ platform: "x", handle: "3zprod" }],
        },
      }),
    );
    expect(S().socialSnapshots).toEqual([
      { platform: "tiktok", day: "2026-09-20", followers: 1000, views30d: 5000, engagementPct: 4 },
    ]);
    expect(S().socialPostStats).toEqual([]);
    expect(S().demographics).toEqual([]);
    expect(S().socialSeedApplied).toBe("");
  });

  it("hydrates an old localStorage save without the social fields and keeps them usable", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
        },
        version: 1,
      }),
    );
    await hydrateStore();
    expect(S().posts).toEqual([]);
    expect(S().socialAccounts).toEqual([]);
    const p = S().addPost({ platform: "tiktok", title: "after hydrate" });
    expect(S().posts).toEqual([p]);
    expect(p.hashtags).toEqual(HASHTAG_SETS.tiktok.slice(0, p.hashtags.length));
  });

  it("keeps the current state when a save holds an invalid post", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: DEFAULT_SETTINGS, posts: [{ id: "bad" }] }, version: 1 }),
    );
    await hydrateStore();
    // An invalid persisted shape is rejected as a whole (same rule as every other field).
    expect(S().posts).toEqual([]);
  });
});

describe("social sync: connected accounts slice and the Beacons seed removal", () => {
  const status = {
    instagram: {
      configured: true,
      connected: true,
      handle: "3z.prod",
      lastSyncAt: "2026-09-27T06:00:00.000Z",
    },
    youtube: { configured: true, connected: false },
  };

  it("starts empty and records status and pull results", () => {
    expect(S().socialSync).toEqual({
      lastPullAt: null,
      lastPullError: null,
      status: null,
      statusAt: null,
    });
    S().setSocialSyncStatus(status, at("2026-09-27T09:00:00Z"));
    expect(S().socialSync.status).toEqual(status);
    expect(S().socialSync.statusAt).toBe("2026-09-27T09:00:00.000Z");
    S().setSocialPullResult({ at: "2026-09-27T09:00:01.000Z", error: null });
    expect(S().socialSync.lastPullAt).toBe("2026-09-27T09:00:01.000Z");
    // A failed pull keeps the last successful time and stores the error key.
    S().setSocialPullResult({ at: null, error: "settings.accounts.err.network" });
    expect(S().socialSync).toMatchObject({
      lastPullAt: "2026-09-27T09:00:01.000Z",
      lastPullError: "settings.accounts.err.network",
      status,
    });
  });

  it("persists the slice, exports it and loads an old save without it", async () => {
    S().setSocialSyncStatus(status, at("2026-09-27T09:00:00Z"));
    S().setSocialPullResult({ at: "2026-09-27T09:00:01.000Z", error: null });
    const json = S().exportState();
    expect(JSON.parse(json).state.socialSync.status.instagram.handle).toBe("3z.prod");
    S().reset();
    expect(S().socialSync.status).toBeNull();
    S().importState(json);
    expect(S().socialSync.lastPullAt).toBe("2026-09-27T09:00:01.000Z");
    expect(socialSyncState(S())).toBe(S().socialSync);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: DEFAULT_SETTINGS, completions: [] }, version: 1 }),
    );
    await hydrateStore();
    expect(S().socialSync).toEqual({
      lastPullAt: null,
      lastPullError: null,
      status: null,
      statusAt: null,
    });
  });

  it("removeBeaconsSeed drops the seed rows, keeps live and manual data, and the seed never returns", () => {
    expect(applySocialSeed(S())).toBe("applied");
    expect(hasBeaconsSeed(S())).toBe(true);
    // A live TikTok pull and a hand-typed Snapchat row sit next to the seed.
    S().setSocialSyncStatus({ tiktok: { configured: true, connected: true, handle: "3z.prod" } });
    S().importSnapshots([
      { platform: "tiktok", day: "2026-09-28", followers: 1300 },
      { platform: "snapchat", day: SOCIAL_SEED_DAY, followers: 40 },
    ]);
    S().importDemographics([
      { platform: "tiktok", day: "2026-09-28", dimension: "gender", key: "male", pct: 60 },
    ]);
    S().setAccount("youtube", "3zprod-live", "https://www.youtube.com/@3zprod-live");

    S().removeBeaconsSeed();
    expect(
      S()
        .socialSnapshots.map((s) => `${s.platform}/${s.day}`)
        .sort(),
    ).toEqual([`snapchat/${SOCIAL_SEED_DAY}`, "tiktok/2026-09-28"]);
    expect(S().demographics).toEqual([
      { platform: "tiktok", day: "2026-09-28", dimension: "gender", key: "male", pct: 60 },
    ]);
    // TikTok is connected (the seed handle is now the live one) and YouTube was replaced by hand:
    // both stay; the untouched Instagram / Threads seed accounts go.
    expect(
      S()
        .socialAccounts.map((a) => a.platform)
        .sort(),
    ).toEqual(["tiktok", "youtube"]);
    expect(accountFor(S(), "youtube")?.handle).toBe("3zprod-live");
    expect(hasBeaconsSeed(S())).toBe(false);
    expect(S().socialSeedApplied).toBe(SOCIAL_SEED_VERSION);
    expect(applySocialSeed(S())).toBe("already-applied");
    expect(hasBeaconsSeed(S())).toBe(false);
  });

  it("removeBeaconsSeed on a store that never applied the seed still flags it", () => {
    S().addSnapshot({ platform: "x", day: SOCIAL_SEED_DAY, followers: 3 });
    S().removeBeaconsSeed();
    expect(S().socialSnapshots).toHaveLength(1);
    expect(S().socialSeedApplied).toBe(SOCIAL_SEED_VERSION);
    expect(applySocialSeed(S())).toBe("already-applied");
  });
});

describe("trend radar: persisted feed and dismissals (round 30)", () => {
  const row = (id: string, over: Partial<TrendItemInput> = {}): TrendItemInput => ({
    id,
    platform: "google",
    region: "SA",
    lang: "ar",
    title: id,
    source: "Google Trends",
    seenAt: "2026-09-28T06:00:00.000Z",
    ...over,
  });
  const feed = {
    items: [row("google:SA:a", { score: 100 }), row("google:SA:b", { tags: ["#x"] })],
    fetchedAt: "2026-09-28T06:00:00.000Z",
    degraded: false,
    sources: [{ name: "google", ok: true, at: "2026-09-28T06:00:00.000Z" }],
  };

  it("starts empty and setTrends replaces the feed with Zod defaults filled", () => {
    expect(S().trends).toEqual(EMPTY_TRENDS);
    S().setTrends(feed);
    expect(S().trends.items.map((i) => i.id)).toEqual(["google:SA:a", "google:SA:b"]);
    expect(S().trends.items[0].tags).toEqual([]);
    expect(S().trends.fetchedAt).toBe("2026-09-28T06:00:00.000Z");
    expect(S().trends.sources).toEqual(feed.sources);
    expect(trendsState(S())).toBe(S().trends);
    // The Worker's empty answer is a valid feed too.
    S().setTrends({ items: [], fetchedAt: null, degraded: true, sources: [] });
    expect(S().trends).toEqual({ ...EMPTY_TRENDS, degraded: true });
    S().setTrends({});
    expect(S().trends).toEqual(EMPTY_TRENDS);
  });

  it("dismissTrend hides an id once; a new feed keeps only the dismissed ids it still has", () => {
    S().setTrends(feed);
    S().dismissTrend("google:SA:a");
    S().dismissTrend("google:SA:a");
    expect(S().trends.dismissed).toEqual(["google:SA:a"]);
    S().setTrends({ ...feed, items: [row("google:SA:a"), row("google:SA:c")] });
    expect(S().trends.dismissed).toEqual(["google:SA:a"]);
    S().setTrends({ ...feed, items: [row("google:SA:c")] });
    expect(S().trends.dismissed).toEqual([]);
  });

  it("rejects an invalid feed without changing the slice", () => {
    S().setTrends(feed);
    expect(() => S().setTrends({ items: [{ id: "bad" }] } as unknown as TrendsFeedInput)).toThrow();
    expect(() => S().setTrends({ items: [row("x", { score: 101 })] })).toThrow();
    expect(S().trends.items).toHaveLength(2);
  });

  it("clearTrends, export/import and reset round-trip the slice", () => {
    S().setTrends(feed);
    S().dismissTrend("google:SA:b");
    const json = S().exportState();
    expect(JSON.parse(json).state.trends.dismissed).toEqual(["google:SA:b"]);
    S().clearTrends();
    expect(S().trends).toEqual(EMPTY_TRENDS);
    S().importState(json);
    expect(S().trends.items).toHaveLength(2);
    expect(S().trends.dismissed).toEqual(["google:SA:b"]);
    expect(JSON.parse(S().exportState()).state.trends).toEqual(JSON.parse(json).state.trends);
    S().reset();
    expect(S().trends).toEqual(EMPTY_TRENDS);
  });

  it("imports an export from before the radar and hydrates an old save without `trends`", async () => {
    S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-27T00:00:00.000Z",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
        },
      }),
    );
    expect(S().trends).toEqual(EMPTY_TRENDS);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: DEFAULT_SETTINGS, completions: [] }, version: 1 }),
    );
    await hydrateStore();
    expect(S().trends).toEqual(EMPTY_TRENDS);
    S().setTrends(feed);
    expect(S().trends.items).toHaveLength(2);
  });
});

describe("edit genres: the owner's custom genres (round 31)", () => {
  const drift = { id: "custom-drift", name: "Drift", query: "drift edit" };
  const oldExport = {
    app: "3z-prod",
    version: 1,
    exportedAt: "2026-09-28T00:00:00.000Z",
    state: {
      settings: DEFAULT_SETTINGS,
      completions: [],
      xpEvents: [],
      microActions: [],
      freezesUsedOn: [],
      reviews: [],
    },
  };

  it("starts empty; addCustomGenre trims, collapses spaces and ids the genre from its name", () => {
    expect(S().customGenres).toEqual([]);
    S().addCustomGenre("  Drift ", "  drift   edit ");
    S().addCustomGenre("هجولة", "ايديت هجولة");
    S().addCustomGenre("Street  Food", "street food reel");
    expect(S().customGenres).toEqual([
      drift,
      { id: "custom-هجولة", name: "هجولة", query: "ايديت هجولة" },
      { id: "custom-street-food", name: "Street Food", query: "street food reel" },
    ]);
  });

  it("ignores a blank name or blank search words", () => {
    S().addCustomGenre("", "drift edit");
    S().addCustomGenre("   ", "drift edit");
    S().addCustomGenre("Drift", "");
    S().addCustomGenre("Drift", "  \n ");
    expect(S().customGenres).toEqual([]);
  });

  it("ignores a name that exists already (normalized), custom or built in", () => {
    S().addCustomGenre("Drift", "drift edit");
    S().addCustomGenre(" drift ", "other words");
    S().addCustomGenre("DRIFT!", "other words");
    expect(S().customGenres).toEqual([drift]);
    // The built-in genres keep their names, in Arabic and in English.
    S().addCustomGenre("Cars", "my cars");
    S().addCustomGenre("سيارات", "سياراتي");
    expect(S().customGenres).toEqual([drift]);
    // A different name with the same words is its own genre.
    S().addCustomGenre("Drifting", "drift edit");
    expect(S().customGenres.map((g) => g.id)).toEqual(["custom-drift", "custom-drifting"]);
  });

  it("removeCustomGenre drops by id, no-ops for an unknown or built-in id, and frees the name", () => {
    S().addCustomGenre("Drift", "drift edit");
    S().addCustomGenre("Falconry", "falcon cinematic");
    const before = S().customGenres;
    S().removeCustomGenre("cars");
    S().removeCustomGenre("custom-nope");
    S().removeCustomGenre("");
    expect(S().customGenres).toBe(before);
    S().removeCustomGenre("custom-drift");
    expect(S().customGenres.map((g) => g.id)).toEqual(["custom-falconry"]);
    S().addCustomGenre("Drift", "drift cinematic");
    expect(S().customGenres.at(-1)).toEqual({ ...drift, query: "drift cinematic" });
  });

  it("round-trips through export/import and the reset clears it", () => {
    S().addCustomGenre("Drift", "drift edit");
    S().addCustomGenre("هجولة", "ايديت هجولة");
    const json = S().exportState();
    const before = JSON.parse(json).state;
    expect(before.customGenres).toHaveLength(2);
    S().reset();
    expect(S().customGenres).toEqual([]);
    S().importState(json);
    expect(S().customGenres).toEqual(before.customGenres);
    expect(JSON.parse(S().exportState()).state).toEqual(before);
  });

  it("imports an export from before the genres and fills an empty list", () => {
    S().addCustomGenre("Drift", "drift edit");
    S().importState(JSON.stringify(oldExport));
    expect(S().customGenres).toEqual([]);
    S().addCustomGenre("Drift", "drift edit");
    expect(S().customGenres).toEqual([drift]);
  });

  it("rejects an import with an invalid custom genre without changing state", () => {
    S().addCustomGenre("Drift", "drift edit");
    const bad = { ...oldExport, state: { ...oldExport.state, customGenres: [{ id: "x" }] } };
    expect(() => S().importState(JSON.stringify(bad))).toThrow();
    const blank = {
      ...oldExport,
      state: { ...oldExport.state, customGenres: [{ id: "custom-x", name: "", query: "q" }] },
    };
    expect(() => S().importState(JSON.stringify(blank))).toThrow();
    expect(S().customGenres).toEqual([drift]);
  });

  it("hydrates an old localStorage save without `customGenres` and keeps it usable", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: DEFAULT_SETTINGS, completions: [] }, version: 1 }),
    );
    await hydrateStore();
    expect(S().customGenres).toEqual([]);
    S().addCustomGenre("Drift", "drift edit");
    expect(S().customGenres).toEqual([drift]);
  });

  it("persists to localStorage and rehydrates", async () => {
    S().addCustomGenre("Drift", "drift edit");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).state.customGenres).toEqual([drift]);
    expect(JSON.parse(raw!).state.addCustomGenre).toBeUndefined();

    useStore.setState({ customGenres: [] }); // simulate a fresh page (also persists)
    localStorage.setItem(STORAGE_KEY, raw!);
    await hydrateStore();
    expect(S().customGenres).toEqual([drift]);
  });
});

describe("website articles (packet DT-3)", () => {
  const T0 = at("2026-10-16T10:00:00Z");
  const T1 = at("2026-10-16T11:00:00Z");
  const complete = {
    title: { ar: "تلوين الليل", en: "Night grading" },
    summary: { ar: "ملخص", en: "Summary" },
    body: { ar: "## مقدمة\n\nنص", en: "## Intro\n\nText" },
    slug: "night-grading",
  };
  const article = (id: string) => S().articles.find((a) => a.id === id)!;
  const storedList = (): Article[] => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.articles;
  const progress = () => ({ xp: S().xpEvents, gems: S().gemEvents, completions: S().completions });
  /** Serializes like Web Locks: each holder runs after the previous one released. */
  const queueLock = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };
  const add = async (input?: Parameters<StoreState["addArticle"]>[0]) => {
    const r = await S().addArticle(input, T0);
    if (!r.ok) throw new Error(r.reason);
    return r.article;
  };
  /** A complete article, saved through updateArticle and marked ready. */
  const ready = async (slug = complete.slug) => {
    const a = await add();
    const r = await S().updateArticle(a.id, { ...complete, slug }, articleBase(a), T0);
    if (!r.ok) throw new Error(r.reason);
    const s = await S().setArticleStatus(a.id, "ready", T0);
    expect(s.ok).toBe(true);
    return article(a.id);
  };
  /** Write the stored list as another tab would (its storage event not delivered yet). */
  const otherTab = (edit: (list: Article[]) => Article[]) => {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.articles = edit(raw.state.articles);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  };

  beforeEach(() => setArticlesLock(queueLock()));
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("adds an empty draft with a commit identity", async () => {
    const a = await add({ title: { ar: "عنوان", en: "" }, skillId: "smart-bins-keywords" });
    expect(a).toMatchObject({
      title: { ar: "عنوان", en: "" },
      body: { ar: "", en: "" },
      slug: "",
      status: "draft",
      revision: 1,
      skillId: "smart-bins-keywords",
      createdAt: T0.toISOString(),
    });
    expect(a.commitId).toBeTruthy();
    expect(S().articles).toEqual([a]);
  });

  it("persists articles to localStorage (pick) and round-trips them through export/import", async () => {
    const a = await ready();
    expect(storedList()).toEqual([a]);
    const json = S().exportState();
    const before = JSON.parse(json).state;
    expect(before.articles).toEqual([a]);
    await S().reset();
    expect(S().articles).toEqual([]);
    await S().importState(json);
    expect(S().articles).toEqual([a]);
    expectSameExceptJournal(before);
  });

  it("imports an old backup without articles and hydrates an old save", async () => {
    S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
        },
      }),
    );
    expect(S().articles).toEqual([]);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: DEFAULT_SETTINGS, completions: [] }, version: 1 }),
    );
    await hydrateStore();
    expect(S().articles).toEqual([]);
  });

  it("commits an edit with a new commit id and revision, verified in storage", async () => {
    const a = await add();
    const r = await S().updateArticle(a.id, { title: { ar: "ع", en: "E" } }, articleBase(a), T1);
    expect(r.ok).toBe(true);
    const b = article(a.id);
    expect(b.title).toEqual({ ar: "ع", en: "E" });
    expect(b.revision).toBe(2);
    expect(b.commitId).not.toBe(a.commitId);
    expect(b.updatedAt).toBe(T1.toISOString());
    expect(b.createdAt).toBe(a.createdAt);
    expect(storedList()[0].commitId).toBe(b.commitId);
  });

  it("rejects a second mutation on the same base as a conflict and leaves the article unchanged", async () => {
    const a = await add();
    const base = articleBase(a);
    expect((await S().updateArticle(a.id, { slug: "first" }, base, T1)).ok).toBe(true);
    const after = article(a.id);
    expect(await S().updateArticle(a.id, { slug: "second" }, base, T1)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(article(a.id)).toEqual(after);
    expect(await S().updateArticle("nope", { slug: "x" }, base, T1)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("serializes overlapping commits through the lock: the second sees the first's commit (Amendment C.1)", async () => {
    const a = await add();
    const base = articleBase(a);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const queue = queueLock();
    // The first holder waits until released, so both commits overlap.
    let first = true;
    setArticlesLock((fn) =>
      queue(async () => {
        if (first) {
          first = false;
          await held;
        }
        return fn();
      }),
    );
    const one = S().updateArticle(a.id, { slug: "one" }, base, T1);
    const two = S().updateArticle(a.id, { slug: "two" }, base, T1);
    release();
    expect((await one).ok).toBe(true);
    expect(await two).toEqual({ ok: false, reason: "conflict" });
    expect(article(a.id).slug).toBe("one");
  });

  it("refuses to save without Web Locks and leaves the article unchanged (Amendment C.1)", async () => {
    const a = await add();
    setArticlesLock(undefined); // jsdom has no navigator.locks
    expect(await S().updateArticle(a.id, { slug: "x" }, articleBase(a), T1)).toEqual({
      ok: false,
      reason: "unsupported-save",
    });
    expect(await S().addArticle(undefined, T1)).toEqual({ ok: false, reason: "unsupported-save" });
    setArticlesLock(null);
    expect((await S().setArticleStatus(a.id, "archived", T1)).ok).toBe(false);
    expect(S().articles).toEqual([a]);
  });

  it("treats malformed stored JSON as not persisted and leaves memory untouched (Amendment C.1)", async () => {
    const a = await add();
    localStorage.setItem(STORAGE_KEY, "{not json");
    const r = await S().updateArticle(a.id, { slug: "x" }, articleBase(a), T1);
    expect(r).toEqual({ ok: false, reason: "not-persisted" });
    expect(S().articles).toEqual([a]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("{not json");
  });

  it("answers missing when storage no longer holds the article, and never recreates it (Amendment C)", async () => {
    const a = await add();
    otherTab(() => []);
    expect(await S().updateArticle(a.id, { slug: "x" }, articleBase(a), T1)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(storedList()).toEqual([]);
  });

  it("keeps a sibling edited in another tab when this tab saves its own article (Amendment C)", async () => {
    const a = await add();
    const b = await add();
    otherTab((list) =>
      list.map((x) => (x.id === b.id ? { ...x, slug: "edited-elsewhere", commitId: "tab-2" } : x)),
    );
    const r = await S().updateArticle(a.id, { slug: "mine" }, articleBase(article(a.id)), T1);
    expect(r.ok).toBe(true);
    expect(article(b.id)).toMatchObject({ slug: "edited-elsewhere", commitId: "tab-2" });
    expect(storedList().find((x) => x.id === b.id)!.slug).toBe("edited-elsewhere");
    expect(storedList().find((x) => x.id === a.id)!.slug).toBe("mine");
  });

  it("creates on top of the fresh stored list (Amendment C)", async () => {
    const a = await add();
    const elsewhere: Article = { ...a, id: "from-tab-2", commitId: "tab-2", slug: "tab-2" };
    otherTab((list) => [elsewhere, ...list]);
    const c = await add();
    expect(S().articles.map((x) => x.id)).toEqual([c.id, "from-tab-2", a.id]);
    expect(storedList().map((x) => x.id)).toEqual([c.id, "from-tab-2", a.id]);
  });

  it("sees another tab's commit before its storage event: conflict, then rehydrate", async () => {
    const a = await add();
    const base = articleBase(a);
    otherTab((list) => [{ ...list[0], body: { ar: "تاب ثاني", en: "" }, commitId: "tab-2" }]);
    expect(await S().updateArticle(a.id, { slug: "mine" }, base, T1)).toEqual({
      ok: false,
      reason: "conflict",
    });
    await vi.waitFor(() => expect(article(a.id).commitId).toBe("tab-2"));
    expect(article(a.id).slug).toBe("");
  });

  it("sends a ready article back to draft on any meaningful edit, even a valid one (Amendment A)", async () => {
    const a = await ready();
    expect((await S().updateArticle(a.id, { category: "color" }, articleBase(a), T1)).ok).toBe(
      true,
    );
    expect(article(a.id).status).toBe("draft");
    expect((await S().setArticleStatus(a.id, "ready", T1)).ok).toBe(true);
    await S().updateArticle(a.id, { body: { ar: "", en: "x" } }, articleBase(article(a.id)), T1);
    expect(article(a.id).status).toBe("draft");
  });

  it("keeps status, revision and commit for an identical save (Amendment A)", async () => {
    const a = await ready();
    const r = await S().updateArticle(
      a.id,
      { ...complete, tags: [...a.tags], category: a.category },
      articleBase(a),
      T1,
    );
    expect(r).toEqual({ ok: true, article: a });
    expect(article(a.id)).toEqual(a);
  });

  it("refuses ready while issues exist and accepts it once they are fixed", async () => {
    const a = await add();
    expect(await S().setArticleStatus(a.id, "ready", T0)).toEqual({ ok: false, reason: "issues" });
    expect(article(a.id)).toEqual(a);
    await S().updateArticle(a.id, complete, articleBase(a), T0);
    expect((await S().setArticleStatus(a.id, "ready", T0)).ok).toBe(true);
    expect(article(a.id).status).toBe("ready");
    expect((await S().setArticleStatus("nope", "ready", T0)).ok).toBe(false);
  });

  it("changes the commit id on every status change, archive and restore (Amendment B)", async () => {
    const a = await ready();
    const seen = new Set([a.commitId]);
    expect((await S().setArticleStatus(a.id, "draft", T1)).ok).toBe(true);
    seen.add(article(a.id).commitId);
    expect((await S().setArticleStatus(a.id, "archived", T1)).ok).toBe(true);
    const archived = article(a.id);
    expect(archived.archivedAt).toBe(T1.toISOString());
    seen.add(archived.commitId);
    expect((await S().setArticleStatus(a.id, "ready", T1)).ok).toBe(false); // restore first
    expect((await S().restoreArticle(a.id, {}, T1)).ok).toBe(true);
    const restored = article(a.id);
    expect(restored.status).toBe("draft");
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.body).toEqual(complete.body);
    seen.add(restored.commitId);
    expect(seen.size).toBe(4);
    expect((await S().restoreArticle(a.id, {}, T1)).ok).toBe(false); // not archived
  });

  it("refuses a restore that would duplicate an active slug, then restores with a new slug (Amendment C)", async () => {
    const a = await ready("x");
    await S().setArticleStatus(a.id, "archived", T1);
    const b = await ready("x");
    const r = await S().restoreArticle(a.id, {}, T1);
    expect(r).toEqual({ ok: false, reason: "slug-duplicate", conflictsWith: article(b.id) });
    expect(article(a.id).status).toBe("archived");
    const again = await S().restoreArticle(a.id, { newSlug: true }, T1);
    expect(again.ok).toBe(true);
    expect(article(a.id)).toMatchObject({ status: "draft", slug: "x-2" });
    // A third copy gets the next free suffix.
    await S().setArticleStatus(a.id, "archived", T1);
    await ready("x-2");
    expect((await S().restoreArticle(a.id, { newSlug: true }, T1)).ok).toBe(true);
    expect(article(a.id).slug).toBe("x-3");
  });

  it("rejects a pending write captured before an import of the very same file (ABA, Amendment B)", async () => {
    const a = await add();
    const base = articleBase(a);
    const json = S().exportState();
    const gen = articlesGeneration();
    await S().importState(json); // same id, revision and commit id
    expect(articlesGeneration()).toBeGreaterThan(gen);
    expect(article(a.id).commitId).toBe(a.commitId);
    expect(await S().updateArticle(a.id, { slug: "stale" }, base, T1)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(article(a.id).slug).toBe("");
  });

  it("bumps the generation on reset, which invalidates a pending write", async () => {
    const a = await add();
    const base = articleBase(a);
    const gen = articlesGeneration();
    await S().reset();
    expect(articlesGeneration()).toBeGreaterThan(gen);
    expect((await S().updateArticle(a.id, { slug: "x" }, base, T1)).ok).toBe(false);
    expect(S().articles).toEqual([]);
  });

  it("bumps the generation when another tab imports or resets, not for its article edits", async () => {
    const a = await add();
    const gen = articlesGeneration();
    await useStore.persist.rehydrate(); // nothing changed
    otherTab((list) => [{ ...list[0], slug: "other-tab", commitId: "other" }]);
    await useStore.persist.rehydrate(); // an edit: caught by the commit id, not the generation
    expect(article(a.id).slug).toBe("other-tab");
    expect(articlesGeneration()).toBe(gen);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.discoverLibraryEpoch = "imported-in-tab-2";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await useStore.persist.rehydrate();
    expect(articlesGeneration()).toBeGreaterThan(gen);
  });

  it("reconciles the whole stored payload before committing: another tab's settings and ideas survive (Amendment D)", async () => {
    const a = await add();
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.settings = { ...raw.state.settings, lang: "en" };
    raw.state.ideas = [
      { id: "remote-idea", text: "from tab 2", source: "me", createdAt: T0.toISOString() },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(S().settings.lang).toBe("ar"); // this tab's memory is stale
    const r = await S().updateArticle(a.id, { slug: "mine" }, articleBase(a), T1);
    expect(r.ok).toBe(true);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
    expect(stored.settings.lang).toBe("en");
    expect(stored.ideas.map((i: { id: string }) => i.id)).toEqual(["remote-idea"]);
    expect(stored.articles[0]).toMatchObject({ slug: "mine", commitId: article(a.id).commitId });
  });

  it("leaves the Discover library epoch and candidates alone (Amendment D)", async () => {
    const a = await add();
    const before = {
      epoch: S().discoverLibraryEpoch,
      pending: S().discoverLibraryPendingReplacement,
      candidates: S().discoverCandidates,
    };
    await S().updateArticle(a.id, { slug: "x" }, articleBase(a), T1);
    await S().setArticleStatus(a.id, "archived", T1);
    expect({
      epoch: S().discoverLibraryEpoch,
      pending: S().discoverLibraryPendingReplacement,
      candidates: S().discoverCandidates,
    }).toEqual(before);
  });

  it("never lets memory run ahead of storage: a quota failure rolls back, a retry from the same base lands (Amendment D)", async () => {
    const a = await add();
    const base = articleBase(a);
    const real = Storage.prototype.setItem;
    let fail = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY && fail) {
        fail = false;
        throw new DOMException("full", "QuotaExceededError");
      }
      real.call(this, k, v);
    });
    expect(await S().updateArticle(a.id, { slug: "y" }, base, T1)).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().articles).toEqual([a]);
    expect(storedList()).toEqual([a]);
    const retry = await S().updateArticle(a.id, { slug: "y" }, base, T1);
    expect(retry.ok).toBe(true);
    expect(article(a.id).slug).toBe("y");
    expect(storedList()[0].commitId).toBe(article(a.id).commitId);
    expect(article(a.id).commitId).not.toBe(a.commitId);
  });

  it("rejects a commit when the storage probe fails (full quota) and keeps memory at X (Amendment E)", async () => {
    const a = await add();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(await S().updateArticle(a.id, { slug: "y" }, articleBase(a), T1)).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().articles).toEqual([a]);
    expect(await S().addArticle(undefined, T1)).toEqual({ ok: false, reason: "not-persisted" });
    expect(S().articles).toEqual([a]);
  });

  it("never touches XP, gems or quests for articles (no Article quest completion)", async () => {
    const before = progress();
    const a = await ready();
    await S().setArticleStatus(a.id, "archived", T1);
    await S().restoreArticle(a.id, {}, T1);
    S().exportState();
    expect(progress()).toEqual(before);
    expect(isQuestDone(S(), "smart-bins-keywords", "article")).toBe(false);
  });
});

describe("workflows (packet DT-4)", () => {
  const T0 = at("2026-10-16T10:00:00Z");
  const T1 = at("2026-10-16T11:00:00Z");
  const SKILL = "smart-bins-keywords";
  const WEEK = "2026-10-10";
  const complete = {
    title: { ar: "تلوين الليل", en: "Night grading" },
    summary: { ar: "ملخص", en: "A summary" },
    body: { ar: "نص", en: "Text" },
    slug: "night-grading",
    skillId: SKILL,
  };
  const actions: Workflow["actions"] = [
    { id: "i1", kind: "idea", text: { ar: "فكرة: {title}", en: "Idea: {title}" } },
    {
      id: "p1",
      kind: "post",
      platform: "tiktok",
      title: { ar: "{title}", en: "{title} in 30s" },
      caption: { ar: "{summary}", en: "{summary}" },
      offsetDays: 2,
    },
    { id: "q1", kind: "plan", quest: "produce", skillId: SKILL, minutes: 45, day: "lightest" },
  ];
  /** A manual run has no article: {date} only. */
  const manualActions: Workflow["actions"] = [
    { id: "i1", kind: "idea", text: { ar: "فكرة {date}", en: "Idea {date}" } },
    {
      id: "p1",
      kind: "post",
      platform: "tiktok",
      title: { ar: "مقطع {date}", en: "Clip {date}" },
      caption: { ar: "", en: "" },
      offsetDays: 2,
    },
    actions[2],
  ];
  const queueLock = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  const progress = () => ({ xp: S().xpEvents, gems: S().gemEvents, completions: S().completions });
  const count = (list: { id: string }[], id: string) => list.filter((x) => x.id === id).length;
  /** Throw a quota error for the app's key on the next `n` writes (the storage probe still works). */
  const failWrites = (n = 1, skip = 0) => {
    const real = Storage.prototype.setItem;
    let left = n;
    let pass = skip;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY && pass > 0) pass -= 1;
      else if (k === STORAGE_KEY && left > 0) {
        left -= 1;
        throw new DOMException("full", "QuotaExceededError");
      }
      real.call(this, k, v);
    });
  };
  const addWf = async (over: Partial<Pick<Workflow, "name" | "trigger" | "actions">> = {}) => {
    const r = await S().addWorkflow(
      {
        name: { ar: "بعد المقال", en: "After the article" },
        actions: over.trigger?.kind === "article-ready" ? actions : manualActions,
        ...over,
      },
      T0,
    );
    if (!r.ok) throw new Error(r.reason);
    return r.workflow;
  };
  const runNow = async (id: string) => {
    const r = await S().runWorkflowNow(id, {}, T0);
    if (!r.ok) throw new Error(r.reason);
    return r.run;
  };
  const run = (id: string) => S().workflowRuns.find((r) => r.id === id)!;
  const draftArticle = async () => {
    const a = await S().addArticle(undefined, T0);
    if (!a.ok) throw new Error(a.reason);
    const u = await S().updateArticle(a.article.id, complete, articleBase(a.article), T0);
    if (!u.ok) throw new Error(u.reason);
    return u.article;
  };

  beforeEach(() => setArticlesLock(queueLock()));
  afterEach(() => {
    setArticlesLock(undefined);
    setWorkflowFault(undefined);
    vi.restoreAllMocks();
  });

  it("starts empty, imports an old backup without workflows, and round-trips them", async () => {
    expect(S().workflows).toEqual([]);
    expect(S().workflowRuns).toEqual([]);
    await S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
        },
      }),
    );
    expect(S().workflows).toEqual([]);
    expect(S().workflowRuns).toEqual([]);
    S().reset();
    const w = await addWf({ trigger: { kind: "manual" } });
    await runNow(w.id);
    await S().drainWorkflowRuns(T0);
    const json = S().exportState();
    S().reset();
    await S().importState(json);
    expect(S().workflows).toEqual([w]);
    expect(S().workflowRuns).toHaveLength(1);
    expect(JSON.parse(S().exportState()).state.workflowRuns).toEqual(stored().workflowRuns);
  });

  it("adds and edits a workflow through the locked commit, with a fresh commit id each time", async () => {
    const w = await addWf();
    expect(w).toMatchObject({ enabled: true, revision: 1, trigger: { kind: "manual" } });
    expect(stored().workflows[0].commitId).toBe(w.commitId);
    const r = await S().updateWorkflow(
      w.id,
      { trigger: { kind: "article-ready" } },
      workflowBase(w),
      T1,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.workflow).toMatchObject({ revision: 2, trigger: { kind: "article-ready" } });
    expect(r.workflow.commitId).not.toBe(w.commitId);
    expect(stored().workflows[0].commitId).toBe(r.workflow.commitId);
    // A stale base is a conflict; an identical save changes nothing; unknown ids are missing.
    expect(await S().updateWorkflow(w.id, { name: w.name }, workflowBase(w), T1)).toEqual({
      ok: false,
      reason: "conflict",
    });
    const same = await S().updateWorkflow(
      w.id,
      { trigger: { kind: "article-ready" } },
      workflowBase(r.workflow),
      T1,
    );
    expect(same).toEqual({ ok: true, workflow: r.workflow });
    expect(await S().updateWorkflow("nope", {}, workflowBase(w), T1)).toEqual({
      ok: false,
      reason: "missing",
    });
    // An import replaces the list: a base captured before it conflicts even with the same commit id (ABA).
    const base = workflowBase(r.workflow);
    S().importState(S().exportState());
    expect(await S().updateWorkflow(w.id, { name: { ar: "x", en: "" } }, base, T1)).toEqual({
      ok: false,
      reason: "conflict",
    });
  });

  it("rolls a workflow edit back when storage did not keep it", async () => {
    const w = await addWf();
    failWrites();
    expect(
      await S().updateWorkflow(w.id, { name: { ar: "جديد", en: "" } }, workflowBase(w), T1),
    ).toEqual({ ok: false, reason: "not-persisted" });
    expect(S().workflows).toEqual([w]);
    expect(stored().workflows).toEqual([w]);
  });

  it("enqueues one run per enabled article-ready workflow inside the Ready commit", async () => {
    const a = await draftArticle();
    const w1 = await addWf({ trigger: { kind: "article-ready" } });
    const w2 = await addWf({ trigger: { kind: "article-ready" } });
    const paused = await addWf({ trigger: { kind: "article-ready" } });
    expect((await S().setWorkflowEnabled(paused.id, false, T0)).ok).toBe(true);
    await addWf({ trigger: { kind: "manual" } });
    await addWf({ trigger: { kind: "article-ready" }, name: { ar: "", en: "" } }); // issues
    S().setSettings({ lang: "en" });
    const r = await S().setArticleStatus(a.id, "ready", T0);
    expect(r.ok).toBe(true);
    const runs = stored().workflowRuns as WorkflowRun[];
    expect(runs.map((x) => x.workflowId).sort()).toEqual([w1.id, w2.id].sort());
    for (const x of runs) {
      expect(x.kind).toBe("article-ready");
      expect(x.snapshot.input).toEqual({
        articleId: a.id,
        title: complete.title,
        summary: complete.summary,
        slug: complete.slug,
        skillId: SKILL,
        lang: "en",
        day: "2026-10-16",
      });
    }
    await S().drainWorkflowRuns(T0);
    expect(S().workflowRuns.map((x) => x.status)).toEqual(["done", "done"]);
    expect(S().ideas.map((i) => i.text)).toEqual(["Idea: Night grading", "Idea: Night grading"]);
  });

  it("rolls the Ready commit and its runs back together when the read-back fails", async () => {
    const a = await draftArticle();
    await addWf({ trigger: { kind: "article-ready" } });
    failWrites();
    expect(await S().setArticleStatus(a.id, "ready", T0)).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().articles.find((x) => x.id === a.id)!.status).toBe("draft");
    expect(S().workflowRuns).toEqual([]);
    expect(stored().workflowRuns).toEqual([]);
    expect(stored().articles[0].status).toBe("draft");
  });

  it("enqueues nothing for an unchanged Ready, a paused workflow, an import or a rehydration", async () => {
    const a = await draftArticle();
    const w = await addWf({ trigger: { kind: "article-ready" } });
    await S().setArticleStatus(a.id, "ready", T0);
    await S().drainWorkflowRuns(T0);
    expect(S().workflowRuns).toHaveLength(1);
    expect((await S().setArticleStatus(a.id, "ready", T1)).ok).toBe(true); // unchanged
    S().importState(S().exportState());
    await hydrateStore();
    expect(S().workflowRuns).toHaveLength(1);
    // Paused: back to draft and Ready again adds nothing.
    expect((await S().setWorkflowEnabled(w.id, false, T1)).ok).toBe(true);
    await S().setArticleStatus(a.id, "draft", T1);
    await S().setArticleStatus(a.id, "ready", T1);
    expect(S().workflowRuns).toHaveLength(1);
    // A later explicit draft → ready transition with the workflow enabled is a new event.
    expect((await S().setWorkflowEnabled(w.id, true, T1)).ok).toBe(true);
    await S().setArticleStatus(a.id, "draft", T1);
    await S().setArticleStatus(a.id, "ready", T1);
    expect(S().workflowRuns).toHaveLength(2);
  });

  it("drains a run into an idea, a post and a planner row the planner shows, keeping owner rows and tombstones", async () => {
    const before = progress();
    const owner = {
      id: `${WEEK}:me:${SKILL}:train`,
      week: WEEK,
      day: 2,
      skillId: SKILL,
      quest: "train" as const,
      minutes: 20,
      by: "me" as const,
    };
    const tomb = { ...owner, id: `${WEEK}:x:y`, minutes: 0, by: "rules" as const };
    S().addPlanItem(owner);
    S().addPlanItem(tomb);
    const w = await addWf({ trigger: { kind: "manual" } });
    const queued = await runNow(w.id);
    expect(queued).toMatchObject({ status: "queued", attempt: 1, kind: "manual" });
    const d = await S().drainWorkflowRuns(T0);
    expect(d).toEqual({ resumed: 3, remaining: 0 });
    const done = run(queued.id);
    expect(done.status).toBe("done");
    expect(done.steps.map((s) => [s.status, s.outputKind, s.outputId])).toEqual([
      ["done", "idea", `wf:${queued.id}:i1`],
      ["done", "post", `wf:${queued.id}:p1`],
      ["done", "plan", `wf:${queued.id}:q1`],
    ]);
    expect(S().ideas.find((i) => i.id === `wf:${queued.id}:i1`)).toMatchObject({
      source: "workflow",
      text: "فكرة 2026-10-16",
    });
    expect(S().posts.find((p) => p.id === `wf:${queued.id}:p1`)).toMatchObject({
      stage: "idea",
      plannedDay: "2026-10-18",
    });
    const row = S().planItems.find((p) => p.id === `wf:${queued.id}:q1`)!;
    expect(row).toMatchObject({ by: "me", minutes: 45, week: WEEK, skillId: SKILL });
    expect(S().planItems.slice(0, 2)).toEqual([owner, tomb]);
    const derived = buildWeekPlan({
      skills,
      completions: [],
      settings: S().settings,
      weekStart: WEEK,
    });
    expect(applyOverlay(derived, S().planItems).items.find((i) => i.id === row.id)).toMatchObject({
      manual: true,
    });
    expect(progress()).toEqual(before);
    expect(stored().workflowRuns[0].commitId).toBe(done.commitId);
  });

  it("records a failed step, skips the rest (partial), and retries from the original snapshot without duplicates", async () => {
    const a = await draftArticle();
    const w = await addWf({ trigger: { kind: "article-ready" } });
    setWorkflowFault((r, action) => (action.id === "p1" && r.attempt === 1 ? "boom" : undefined));
    await S().setArticleStatus(a.id, "ready", T0);
    await S().drainWorkflowRuns(T0);
    const [first] = S().workflowRuns;
    expect(first.status).toBe("partial");
    expect(first.steps.map((s) => s.status)).toEqual(["done", "failed", "skipped"]);
    expect(first.steps[1].error).toBe("boom");
    const ideaId = `wf:${first.id}:i1`;
    expect(count(S().ideas, ideaId)).toBe(1);
    expect(S().posts).toEqual([]);

    // The owner edits the workflow and the article; Retry still uses what the run captured.
    const cur = S().workflows.find((x) => x.id === w.id)!;
    await S().updateWorkflow(w.id, { actions: actions.slice(0, 1) }, workflowBase(cur), T1);
    const art = S().articles.find((x) => x.id === a.id)!;
    await S().updateArticle(a.id, { title: { ar: "غيره", en: "Other" } }, articleBase(art), T1);
    const retried = await S().retryWorkflowRun(first.id, T1);
    expect(retried.ok && retried.run).toMatchObject({
      attempt: 2,
      status: "queued",
      kind: "article-ready",
    });
    await S().drainWorkflowRuns(T1);
    const after = run(first.id);
    expect(after.status).toBe("done");
    expect(after.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
    expect(count(S().ideas, ideaId)).toBe(1);
    expect(S().posts.map((p) => p.title)).toEqual(["تلوين الليل"]);
    expect(S().workflowRuns).toHaveLength(1);
    expect(await S().retryWorkflowRun(first.id, T1)).toEqual({
      ok: false,
      reason: "not-retryable",
    });
  });

  it("reconciles a crash between output and receipt without a second output", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    const queued = await runNow(w.id);
    const id = `wf:${queued.id}:i1`;
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.ideas.push({ id, text: "kept", source: "workflow", createdAt: T0.toISOString() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await S().drainWorkflowRuns(T0);
    expect(count(S().ideas, id)).toBe(1);
    expect(S().ideas.find((i) => i.id === id)!.text).toBe("kept");
    expect(run(queued.id).steps[0]).toMatchObject({ status: "done", outputId: id });
  });

  it("proves each receipt by its run commit: a quota failure on a reconciliation step changes nothing (Amendment A)", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    const queued = await runNow(w.id);
    const id = `wf:${queued.id}:i1`;
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.ideas.push({ id, text: "kept", source: "workflow", createdAt: T0.toISOString() });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    failWrites();
    expect(await S().drainWorkflowRuns(T0)).toEqual({
      resumed: 0,
      remaining: 1,
      stopped: "not-persisted",
    });
    expect(run(queued.id)).toEqual(queued);
    expect(stored().workflowRuns[0]).toEqual(queued);
    expect(count(S().ideas, id)).toBe(1);
    // Storage recovered: the step completes exactly once.
    expect((await S().drainWorkflowRuns(T0)).stopped).toBeUndefined();
    expect(run(queued.id).status).toBe("done");
    expect(count(S().ideas, id)).toBe(1);
    expect(count(stored().ideas, id)).toBe(1);
  });

  it("keeps the attempt and Retry when the retry transition is not persisted (Amendment A)", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    setWorkflowFault((r, action) => (action.id === "p1" && r.attempt === 1 ? "boom" : undefined));
    const queued = await runNow(w.id);
    await S().drainWorkflowRuns(T0);
    const partial = run(queued.id);
    expect(partial.status).toBe("partial");
    failWrites();
    expect(await S().retryWorkflowRun(queued.id, T1)).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(run(queued.id)).toEqual(partial);
    expect(stored().workflowRuns[0]).toEqual(partial);
    expect((await S().retryWorkflowRun(queued.id, T1)).ok).toBe(true);
    await S().drainWorkflowRuns(T1);
    expect(run(queued.id)).toMatchObject({ status: "done", attempt: 2 });
    expect(count(S().posts, `wf:${queued.id}:p1`)).toBe(1);
    expect(count(S().ideas, `wf:${queued.id}:i1`)).toBe(1);
  });

  it("refuses a backup holding a workflow with duplicate action ids (Amendment B)", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    const file = JSON.parse(S().exportState());
    file.state.workflows = [{ ...w, actions: [manualActions[0], manualActions[0]] }];
    const before = S().workflows;
    expect(() => S().importState(JSON.stringify(file))).toThrow();
    expect(S().workflows).toBe(before);
  });

  it("fails a run whose captured snapshot has duplicate action ids, before any output (Amendment B)", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    const queued = await runNow(w.id);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    const snap = raw.state.workflowRuns[0];
    snap.snapshot.workflow.actions = [manualActions[0], manualActions[0]];
    snap.steps = [
      { actionId: "i1", status: "pending" },
      { actionId: "i1", status: "pending" },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect((await S().drainWorkflowRuns(T0)).stopped).toBeUndefined();
    const failed = run(queued.id);
    expect(failed.status).toBe("failed");
    expect(failed.steps.map((s) => [s.status, s.error])).toEqual([
      ["failed", "action-duplicate-id"],
      ["skipped", undefined],
    ]);
    expect(S().ideas).toEqual([]);
  });

  it("keeps a quota-stopped run running and resumes it exactly once, without a new Run now (Amendment C)", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    const queued = await runNow(w.id);
    failWrites(1, 1); // the first step lands, the second write fails
    expect(await S().drainWorkflowRuns(T0)).toEqual({
      resumed: 1,
      remaining: 1,
      stopped: "not-persisted",
    });
    const stopped = run(queued.id);
    expect(stopped.status).toBe("running");
    expect(stopped.steps.map((s) => s.status)).toEqual(["done", "pending", "pending"]);
    expect(stored().workflowRuns[0].commitId).toBe(stopped.commitId);
    vi.restoreAllMocks();
    expect(await S().drainWorkflowRuns(T0)).toEqual({ resumed: 2, remaining: 0 });
    expect(run(queued.id)).toMatchObject({ status: "done", attempt: 1 });
    expect(S().workflowRuns).toHaveLength(1);
    expect(count(S().ideas, `wf:${queued.id}:i1`)).toBe(1);
    expect(count(S().posts, `wf:${queued.id}:p1`)).toBe(1);
    expect(count(S().planItems, `wf:${queued.id}:q1`)).toBe(1);
  });

  it("resumes a fresh `running` run after a reload, with no duplicate (Amendment C)", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    const queued = await runNow(w.id);
    // Another page ran step one a moment ago and was closed: the run is `running`, updated just now.
    const id = `wf:${queued.id}:i1`;
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.ideas.push({ id, text: "x", source: "workflow", createdAt: T0.toISOString() });
    const r = raw.state.workflowRuns[0];
    r.status = "running";
    r.updatedAt = T0.toISOString();
    r.steps[0] = {
      actionId: "i1",
      status: "done",
      outputKind: "idea",
      outputId: id,
      at: r.updatedAt,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await hydrateStore();
    expect(await S().drainWorkflowRuns(T0)).toEqual({ resumed: 2, remaining: 0 });
    expect(run(queued.id).status).toBe("done");
    expect(count(S().ideas, id)).toBe(1);
    expect(S().posts).toHaveLength(1);
  });

  it("captures the chosen article for Run now on an article-ready workflow (Amendment C)", async () => {
    const w = await addWf({ trigger: { kind: "article-ready" } });
    expect(await S().runWorkflowNow(w.id, {}, T0)).toEqual({ ok: false, reason: "needs-article" });
    const a = await draftArticle();
    const archived = await draftArticle();
    await S().updateArticle(
      archived.id,
      { slug: "other" },
      articleBase(S().articles.find((x) => x.id === archived.id)!),
      T0,
    );
    await S().setArticleStatus(archived.id, "archived", T0);
    expect(await S().runWorkflowNow(w.id, { articleId: archived.id }, T0)).toEqual({
      ok: false,
      reason: "needs-article",
    });
    expect(await S().runWorkflowNow(w.id, { articleId: "nope" }, T0)).toEqual({
      ok: false,
      reason: "needs-article",
    });
    S().setSettings({ lang: "en" });
    const r = await S().runWorkflowNow(w.id, { articleId: a.id }, T0);
    if (!r.ok) throw new Error(r.reason);
    expect(r.run.kind).toBe("manual");
    expect(r.run.snapshot.input).toMatchObject({
      articleId: a.id,
      title: complete.title,
      skillId: SKILL,
    });
    await S().drainWorkflowRuns(T0);
    expect(S().posts[0].title).toBe("Night grading in 30s");
  });

  it("refuses Run now on a manual workflow that needs an article (Amendment C)", async () => {
    const w = await addWf({
      trigger: { kind: "manual" },
      actions: [{ id: "q1", kind: "plan", quest: "produce", minutes: 30, day: "lightest" }],
    });
    expect(await S().runWorkflowNow(w.id, {}, T0)).toEqual({ ok: false, reason: "issues" });
    const p = await addWf({ trigger: { kind: "manual" }, actions: [actions[1]] });
    expect(await S().runWorkflowNow(p.id, {}, T0)).toEqual({ ok: false, reason: "issues" });
    expect(S().workflowRuns).toEqual([]);
  });

  it("runs one set of outputs when two drains overlap under the lock", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    const queued = await runNow(w.id);
    await Promise.all([S().drainWorkflowRuns(T0), S().drainWorkflowRuns(T0)]);
    expect(run(queued.id).status).toBe("done");
    expect(S().ideas).toHaveLength(1);
    expect(S().posts).toHaveLength(1);
    expect(S().planItems).toHaveLength(1);
  });

  it("refuses Run now while paused, with issues, or for an unknown workflow", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    await S().setWorkflowEnabled(w.id, false, T0);
    expect(await S().runWorkflowNow(w.id, {}, T0)).toEqual({ ok: false, reason: "paused" });
    const bad = await addWf({ trigger: { kind: "manual" }, actions: [] });
    expect(await S().runWorkflowNow(bad.id, {}, T0)).toEqual({ ok: false, reason: "issues" });
    expect(await S().runWorkflowNow("nope", {}, T0)).toEqual({ ok: false, reason: "missing" });
    expect(S().workflowRuns).toEqual([]);
  });

  it("keeps at most 200 runs, pruning the oldest finished ones in the same commit", async () => {
    const w = await addWf({ trigger: { kind: "manual" } });
    const r = await runNow(w.id);
    await S().drainWorkflowRuns(T0);
    const done = run(r.id);
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.workflowRuns = Array.from({ length: 200 }, (_, n) => ({ ...done, id: `old-${n}` }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    const next = await runNow(w.id);
    const ids = S().workflowRuns.map((x) => x.id);
    expect(ids).toHaveLength(200);
    expect(ids).not.toContain("old-0");
    expect(ids).toContain("old-1");
    expect(ids.at(-1)).toBe(next.id);
    expect(stored().workflowRuns).toHaveLength(200);
  });
});

describe("business kit and brand deals (packet DT-5)", () => {
  const T0 = at("2026-10-16T10:00:00Z");
  const T1 = at("2026-10-16T11:00:00Z");
  const queueLock = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  const progress = () => ({ xp: S().xpEvents, gems: S().gemEvents, completions: S().completions });
  const failWrites = () => {
    const real = Storage.prototype.setItem;
    let left = 1;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY && left > 0) {
        left -= 1;
        throw new DOMException("full", "QuotaExceededError");
      }
      real.call(this, k, v);
    });
  };
  const saveKit = async (patch: Parameters<StoreState["saveBusinessKit"]>[0]) => {
    const kit = S().businessKit;
    const r = await S().saveBusinessKit(patch, businessBase(kit), T0);
    if (!r.ok) throw new Error(r.reason);
    return r.kit;
  };

  beforeEach(() => setArticlesLock(queueLock()));
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("starts empty, imports an old backup without a kit or deals, and round-trips both", async () => {
    expect(S().businessKit).toBeNull();
    expect(S().brandDeals).toEqual([]);
    await S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
        },
      }),
    );
    expect(S().businessKit).toBeNull();
    expect(S().brandDeals).toEqual([]);
    await S().reset();
    const kit = await saveKit({ tagline: { ar: "أصوّر", en: "I film" } });
    const deal = await S().addBrandDeal({ brand: "Brand A", valueSar: 1200 }, T0);
    if (!deal.ok) throw new Error(deal.reason);
    const json = S().exportState();
    await S().reset();
    await S().importState(json);
    expect(S().businessKit).toEqual(kit);
    expect(S().brandDeals).toEqual([deal.deal]);
  });

  it("creates the kit on the first save, then edits it under its commit id; a stale base conflicts", async () => {
    const before = progress();
    const kit = await saveKit({ bio: { ar: "نبذة", en: "Bio" } });
    expect(kit).toMatchObject({ revision: 1, bio: { ar: "نبذة", en: "Bio" } });
    expect(stored().businessKit.commitId).toBe(kit.commitId);
    // A second "first save" (another tab created it meanwhile) is a conflict, not an overwrite.
    expect(await S().saveBusinessKit({ bio: { ar: "x", en: "" } }, businessBase(null), T1)).toEqual(
      {
        ok: false,
        reason: "conflict",
      },
    );
    const r = await S().saveBusinessKit(
      { contact: { email: "hi@3z.example", website: "", location: { ar: "", en: "" } } },
      businessBase(kit),
      T1,
    );
    if (!r.ok) throw new Error(r.reason);
    expect(r.kit).toMatchObject({ revision: 2, bio: kit.bio, contact: { email: "hi@3z.example" } });
    expect(r.kit.commitId).not.toBe(kit.commitId);
    expect(await S().saveBusinessKit({ bio: kit.bio }, businessBase(kit), T1)).toEqual({
      ok: false,
      reason: "conflict",
    });
    // An identical save changes nothing; an import fences a base captured before it (ABA).
    expect(await S().saveBusinessKit({ bio: kit.bio }, businessBase(r.kit), T1)).toEqual({
      ok: true,
      kit: r.kit,
    });
    const base = businessBase(r.kit);
    S().importState(S().exportState());
    expect(await S().saveBusinessKit({ bio: { ar: "y", en: "" } }, base, T1)).toEqual({
      ok: false,
      reason: "conflict",
    });
    // Invalid input writes nothing.
    expect(
      await S().saveBusinessKit(
        { tagline: { ar: "x".repeat(121), en: "" } },
        businessBase(S().businessKit!),
        T1,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(progress()).toEqual(before);
  });

  it("fences a first save by generation: a reset or import before it lands never recreates the text", async () => {
    const empty = businessBase(null);
    expect(empty).toEqual({ commitId: null, generation: articlesGeneration() });
    S().reset();
    expect(await S().saveBusinessKit({ bio: { ar: "نص قديم", en: "" } }, empty, T0)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(S().businessKit).toBeNull();
    const fresh = businessBase(null);
    S().importState(S().exportState());
    expect(await S().saveBusinessKit({ bio: { ar: "نص قديم", en: "" } }, fresh, T0)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(stored().businessKit ?? null).toBeNull();
    expect(
      (await S().saveBusinessKit({ bio: { ar: "جديد", en: "" } }, businessBase(null), T0)).ok,
    ).toBe(true);
  });

  it("rolls a kit save back when storage did not keep it, and refuses without Web Locks", async () => {
    const kit = await saveKit({ bio: { ar: "نبذة", en: "" } });
    failWrites();
    expect(
      await S().saveBusinessKit({ bio: { ar: "جديد", en: "" } }, businessBase(kit), T1),
    ).toEqual({ ok: false, reason: "not-persisted" });
    expect(S().businessKit).toEqual(kit);
    expect(stored().businessKit).toEqual(kit);
    vi.restoreAllMocks();
    setArticlesLock(null);
    expect(
      await S().saveBusinessKit({ bio: { ar: "جديد", en: "" } }, businessBase(kit), T1),
    ).toEqual({ ok: false, reason: "unsupported-save" });
  });

  it("adds deals, edits them and moves their stage under each deal's commit id, with no XP", async () => {
    const before = progress();
    const added = await S().addBrandDeal({ brand: "  Brand A  ", contact: "pr@a.example" }, T0);
    if (!added.ok) throw new Error(added.reason);
    expect(added.deal).toMatchObject({ brand: "Brand A", stage: "lead", valueSar: null });
    expect(stored().brandDeals[0].commitId).toBe(added.deal.commitId);
    expect(await S().addBrandDeal({ brand: "   " }, T0)).toEqual({ ok: false, reason: "invalid" });

    const edited = await S().updateBrandDeal(
      added.deal.id,
      { deliverable: "1 reel", valueSar: 1500, notes: "Due Friday" },
      businessBase(added.deal),
      T1,
    );
    if (!edited.ok) throw new Error(edited.reason);
    expect(edited.deal).toMatchObject({ deliverable: "1 reel", valueSar: 1500, brand: "Brand A" });
    expect(edited.deal.commitId).not.toBe(added.deal.commitId);
    // The base captured before the edit is stale now.
    expect(
      await S().setBrandDealStage(added.deal.id, "offer", businessBase(added.deal), T1),
    ).toEqual({ ok: false, reason: "conflict" });
    const staged = await S().setBrandDealStage(
      added.deal.id,
      "lost",
      businessBase(edited.deal),
      T1,
    );
    if (!staged.ok) throw new Error(staged.reason);
    expect(staged.deal.stage).toBe("lost");
    expect(stored().brandDeals).toEqual([staged.deal]);
    expect(
      await S().updateBrandDeal("nope", { notes: "x" }, businessBase(staged.deal), T1),
    ).toEqual({ ok: false, reason: "missing" });
    expect(progress()).toEqual(before);
  });

  it("rolls a deal write back when storage did not keep it", async () => {
    const added = await S().addBrandDeal({ brand: "Brand A" }, T0);
    if (!added.ok) throw new Error(added.reason);
    failWrites();
    expect(
      await S().setBrandDealStage(added.deal.id, "talking", businessBase(added.deal), T1),
    ).toEqual({ ok: false, reason: "not-persisted" });
    expect(S().brandDeals).toEqual([added.deal]);
    expect(stored().brandDeals).toEqual([added.deal]);
  });
});

describe("DT-5-R1 repair: durable publish-job allocation and the deal reply draft", () => {
  const T0 = at("2026-10-16T10:00:00Z");
  const queueLock = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  const storedJobId = (id: string) =>
    stored().posts.find((p: { id: string }) => p.id === id)?.autoPost?.jobId;
  const memJobId = (id: string) => S().posts.find((p) => p.id === id)?.autoPost?.jobId;
  const ready = (title: string) => {
    const p = S().addPost({ platform: "instagram", title });
    S().updatePost(p.id, { autoPost: { platforms: ["instagram"] } });
    return p.id;
  };

  beforeEach(() => setArticlesLock(queueLock()));
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("R2: saves the allocation through a read-back before anything may be sent; it survives a reload", async () => {
    const id = ready("A");
    expect(await S().allocatePublishJobId(id, "job-a")).toMatchObject({ ok: true });
    expect(storedJobId(id)).toBe("job-a");
    expect(memJobId(id)).toBe("job-a");
    expect(S().posts.find((p) => p.id === id)?.autoPost?.sentAt).toBeUndefined();
    await useStore.persist.rehydrate();
    expect(memJobId(id)).toBe("job-a");
    // The same id again is a no-op success; another id for an allocated post is refused.
    expect(await S().allocatePublishJobId(id, "job-a")).toMatchObject({ ok: true });
    expect(await S().allocatePublishJobId(id, "job-b")).toEqual({ ok: false, reason: "conflict" });
    expect(storedJobId(id)).toBe("job-a");
  });

  it("R2: a write the browser throws away or silently drops is rolled back, never kept in memory", async () => {
    const id = ready("A");
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    const real = Storage.prototype.setItem;
    const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(await S().allocatePublishJobId(id, "job-a")).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(memJobId(id)).toBeUndefined();
    quota.mockRestore();
    // Silent drop: the app key "saves" without changing storage.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k !== STORAGE_KEY) real.call(this, k, v);
    });
    expect(await S().allocatePublishJobId(id, "job-a")).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(memJobId(id)).toBeUndefined();
    expect(storedJobId(id)).toBeUndefined();
    vi.restoreAllMocks();
    // Storage is back: the retry succeeds without a reload.
    expect(await S().allocatePublishJobId(id, "job-a")).toMatchObject({ ok: true });
    expect(storedJobId(id)).toBe("job-a");
  });

  it("R2: decides on fresh storage: a removed post is never recreated, a taken id is refused", async () => {
    const a = ready("A");
    const b = ready("B");
    expect(await S().allocatePublishJobId(b, "job-x")).toMatchObject({ ok: true });
    expect(await S().allocatePublishJobId(a, "job-x")).toEqual({ ok: false, reason: "taken" });
    // Another post's Worker-safe id counts as taken too.
    expect(await S().allocatePublishJobId(a, b)).toEqual({ ok: false, reason: "taken" });
    // Removed in storage (another tab) while this tab still shows it: nothing is resurrected.
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.posts = raw.state.posts.filter((p: { id: string }) => p.id !== a);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    expect(await S().allocatePublishJobId(a, "job-a")).toEqual({ ok: false, reason: "missing" });
    expect(S().posts.some((p) => p.id === a)).toBe(false);
    expect(stored().posts.some((p: { id: string }) => p.id === a)).toBe(false);
  });

  it("R4: releases only the exact unconfirmed allocation", async () => {
    const id = ready("A");
    await S().allocatePublishJobId(id, "job-a");
    expect(await S().releasePublishJobId(id, "job-b")).toEqual({ ok: false, reason: "conflict" });
    expect(await S().releasePublishJobId(id, "job-a")).toMatchObject({ ok: true });
    expect(storedJobId(id)).toBeUndefined();
    expect(memJobId(id)).toBeUndefined();
    await S().allocatePublishJobId(id, "job-a");
    S().updatePost(id, {
      autoPost: { ...S().posts.find((p) => p.id === id)!.autoPost!, sentAt: T0.toISOString() },
    });
    // A confirmed job is cancelled, never released.
    expect(await S().releasePublishJobId(id, "job-a")).toEqual({ ok: false, reason: "conflict" });
    expect(storedJobId(id)).toBe("job-a");
  });

  it("keeps a reply draft per deal: old deals import with an empty one, edits go through the deal's commit", async () => {
    const added = await S().addBrandDeal({ brand: "Brand A" }, T0);
    if (!added.ok) throw new Error(added.reason);
    expect(added.deal.replyDraft).toBe("");
    const edited = await S().updateBrandDeal(
      added.deal.id,
      { replyDraft: "Hello Brand A" },
      businessBase(added.deal),
      T0,
    );
    if (!edited.ok) throw new Error(edited.reason);
    expect(stored().brandDeals[0].replyDraft).toBe("Hello Brand A");
    expect(edited.deal.commitId).not.toBe(added.deal.commitId);
    expect(
      await S().updateBrandDeal(
        added.deal.id,
        { replyDraft: "x".repeat(2001) },
        businessBase(edited.deal),
        T0,
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    // A backup from before reply drafts existed.
    const raw = JSON.parse(S().exportState());
    delete raw.state.brandDeals[0].replyDraft;
    await S().importState(JSON.stringify(raw));
    expect(S().brandDeals[0].replyDraft).toBe("");
  });
});

describe("DT-5-R2 repair: ownership inside the allocation commit and a provable release", () => {
  const queueLock = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };
  const storedJobId = (id: string) =>
    JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.posts.find(
      (p: { id: string }) => p.id === id,
    )?.autoPost?.jobId;
  const memJobId = (id: string) => S().posts.find((p) => p.id === id)?.autoPost?.jobId;
  const ready = (title: string) => {
    const p = S().addPost({ platform: "instagram", title });
    S().updatePost(p.id, { autoPost: { platforms: ["instagram"] } });
    return p.id;
  };
  /** Another post claiming `jobId`, written the way a same-tab import replaces state (memory and storage). */
  const claimant = (jobId: string) => {
    const id = ready("Imported claimant");
    useStore.setState({
      posts: S().posts.map((p) =>
        p.id === id ? { ...p, autoPost: { ...p.autoPost!, jobId } } : p,
      ),
    });
    return id;
  };

  beforeEach(() => setArticlesLock(queueLock()));
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("R1-A: the same remembered id is refused once another post also claims it (the no-op path too)", async () => {
    const id = ready("A");
    expect(await S().allocatePublishJobId(id, "job-a")).toMatchObject({ ok: true });
    const other = claimant("job-a");
    await savesSettled(); // DT-7C-2A-R1: the ordinary save is queued under the shared lock
    const before = localStorage.getItem(STORAGE_KEY);
    expect(await S().allocatePublishJobId(id, "job-a")).toEqual({
      ok: false,
      reason: "ambiguous",
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(before);
    expect(memJobId(other)).toBe("job-a");
    expect(memJobId(id)).toBe("job-a");
  });

  it("R1-A: a post whose safe id another post remembers is ambiguous, not allocated", async () => {
    const id = ready("A");
    claimant(id);
    expect(await S().allocatePublishJobId(id, id)).toEqual({ ok: false, reason: "ambiguous" });
    expect(storedJobId(id)).toBeUndefined();
  });

  it("R1-C: a failed release write with an unreadable read-back is not-persisted and keeps the id", async () => {
    const id = ready("A");
    await S().allocatePublishJobId(id, "job-a");
    const realSet = Storage.prototype.setItem;
    const realGet = Storage.prototype.getItem;
    let attempted = false;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) {
        attempted = true;
        throw new DOMException("full", "QuotaExceededError");
      }
      realSet.call(this, k, v);
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k) {
      if (k === STORAGE_KEY && attempted) throw new DOMException("denied", "SecurityError");
      return realGet.call(this, k);
    });
    expect(await S().releasePublishJobId(id, "job-a")).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    vi.restoreAllMocks();
    expect(memJobId(id)).toBe("job-a");
    expect(storedJobId(id)).toBe("job-a");
  });

  it("R1-C: a read-back of a malformed payload or a missing post is no proof of release", async () => {
    const id = ready("A");
    await S().allocatePublishJobId(id, "job-a");
    const good = localStorage.getItem(STORAGE_KEY)!;
    const realSet = Storage.prototype.setItem;
    for (const broken of ["{not json", JSON.stringify({ state: { posts: "nope" } })]) {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
        realSet.call(this, k, k === STORAGE_KEY ? broken : v);
      });
      expect(await S().releasePublishJobId(id, "job-a")).toEqual({
        ok: false,
        reason: "not-persisted",
      });
      vi.restoreAllMocks();
      expect(memJobId(id)).toBe("job-a");
      // Put the real payload back for the next shape (DT-7C-2A-R1: an ordinary save never overwrites an unreadable
      // payload, so the test restores the bytes itself).
      localStorage.setItem(STORAGE_KEY, good);
      expect(storedJobId(id)).toBe("job-a");
    }
  });

  it.each([
    ["a string autoPost", (p: Record<string, unknown>) => ({ ...p, autoPost: "broken" })],
    ["a null autoPost", (p: Record<string, unknown>) => ({ ...p, autoPost: null })],
    ["an array autoPost", (p: Record<string, unknown>) => ({ ...p, autoPost: [] })],
    ["a number autoPost", (p: Record<string, unknown>) => ({ ...p, autoPost: 7 })],
    [
      "an unparseable post without autoPost",
      (p: Record<string, unknown>) => ({ ...p, title: 42, autoPost: undefined }),
    ],
  ])(
    "DT-5-C1: a failed release write read back with %s is not-persisted and keeps the id",
    async (_, mangle) => {
      const id = ready("A");
      await S().allocatePublishJobId(id, "job-a");
      const realSet = Storage.prototype.setItem;
      const realGet = Storage.prototype.getItem;
      let attempted = false;
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
        if (k === STORAGE_KEY) {
          attempted = true;
          throw new DOMException("full", "QuotaExceededError");
        }
        realSet.call(this, k, v);
      });
      // Only the target post changes in the read-back; the rest of the payload stays valid.
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k) {
        const raw = realGet.call(this, k);
        if (k !== STORAGE_KEY || !attempted || raw === null) return raw;
        const env = JSON.parse(raw);
        env.state.posts = env.state.posts.map((p: Record<string, unknown>) =>
          p.id === id ? mangle(p) : p,
        );
        return JSON.stringify(env);
      });
      expect(await S().releasePublishJobId(id, "job-a")).toEqual({
        ok: false,
        reason: "not-persisted",
      });
      vi.restoreAllMocks();
      expect(memJobId(id)).toBe("job-a");
      expect(storedJobId(id)).toBe("job-a");
    },
  );

  it("DT-5-C1: a durable release (autoPost object without jobId) and a fresh allocation still succeed", async () => {
    const id = ready("A");
    expect(await S().allocatePublishJobId(id, "job-a")).toMatchObject({ ok: true });
    expect(await S().releasePublishJobId(id, "job-a")).toMatchObject({ ok: true });
    expect(memJobId(id)).toBeUndefined();
    const storedPost = JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.posts.find(
      (p: { id: string }) => p.id === id,
    );
    expect(storedPost.autoPost).toMatchObject({ platforms: ["instagram"] });
    expect(storedJobId(id)).toBeUndefined();
    expect(await S().allocatePublishJobId(id, "job-b")).toMatchObject({ ok: true });
    expect(storedJobId(id)).toBe("job-b");
  });
});

describe("inbox drafts (packet DT-6A)", () => {
  const T0 = at("2026-10-17T10:00:00Z");
  const SCOPE = "https%3A%2F%2Fscout.test|17841400000000001|conversation|c1";
  const queueLock = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  const save = async (scope: string, text: string, now = T0) => {
    const r = await S().saveInboxDraft(scope, text, inboxDraftBase(S().inboxDrafts[scope]), now);
    if (!r.ok) throw new Error(r.reason);
    return r.draft!;
  };

  beforeEach(() => setArticlesLock(queueLock()));
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("imports an old backup without inboxDrafts, and round-trips drafts through export", async () => {
    expect(S().inboxDrafts).toEqual({});
    await S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
        },
      }),
    );
    expect(S().inboxDrafts).toEqual({});
    await S().reset();
    const d = await save(SCOPE, "أهلين، أرسلت لك التفاصيل");
    expect(d).toMatchObject({ text: "أهلين، أرسلت لك التفاصيل", updatedAt: T0.toISOString() });
    expect(stored().inboxDrafts[SCOPE].commitId).toBe(d.commitId);
    const json = S().exportState();
    await S().reset();
    await S().importState(json);
    expect(S().inboxDrafts[SCOPE]).toEqual(d);
  });

  it("saves under the draft's commit id; a stale base or a moved generation conflicts", async () => {
    const first = await save(SCOPE, "one");
    // A second "first save" (another tab saved meanwhile) is a conflict, not an overwrite.
    expect(await S().saveInboxDraft(SCOPE, "x", inboxDraftBase(null), T0)).toEqual({
      ok: false,
      reason: "conflict",
    });
    const second = await save(SCOPE, "two");
    expect(second.commitId).not.toBe(first.commitId);
    expect(await S().saveInboxDraft(SCOPE, "three", inboxDraftBase(first), T0)).toEqual({
      ok: false,
      reason: "conflict",
    });
    const base = inboxDraftBase(second);
    S().reset();
    expect(await S().saveInboxDraft(SCOPE, "after reset", base, T0)).toEqual({
      ok: false,
      reason: "conflict",
    });
  });

  it("refuses text over 2,000 characters and an empty scope", async () => {
    expect(await S().saveInboxDraft(SCOPE, "x".repeat(2001), inboxDraftBase(null), T0)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await S().saveInboxDraft("", "x", inboxDraftBase(null), T0)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(S().inboxDrafts).toEqual({});
  });

  it("discards under the commit id, proven by the read-back", async () => {
    const d = await save(SCOPE, "bye");
    expect(await S().discardInboxDraft(SCOPE, inboxDraftBase(null))).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().discardInboxDraft(SCOPE, inboxDraftBase(d))).toEqual({
      ok: true,
      draft: null,
    });
    expect(S().inboxDrafts[SCOPE]).toBeUndefined();
    expect(stored().inboxDrafts[SCOPE]).toBeUndefined();
  });

  it("keeps at most 200 drafts, dropping the oldest inside the commit", async () => {
    for (let i = 0; i < 201; i++)
      await save(`scope-${i}`, `draft ${i}`, new Date(T0.getTime() + i * 1000));
    const keys = Object.keys(S().inboxDrafts);
    expect(keys).toHaveLength(200);
    expect(keys).not.toContain("scope-0");
    expect(S().inboxDrafts["scope-200"].text).toBe("draft 200");
    expect(Object.keys(stored().inboxDrafts)).toHaveLength(200);
  });

  it("a write the browser did not keep is not-persisted and memory rolls back", async () => {
    const d = await save(SCOPE, "kept");
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(await S().saveInboxDraft(SCOPE, "lost", inboxDraftBase(d), T0)).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().inboxDrafts[SCOPE]).toEqual(d);
    expect(await S().discardInboxDraft(SCOPE, inboxDraftBase(d))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().inboxDrafts[SCOPE]).toEqual(d);
  });

  // DT-6A-R1 (6A-2): after a failed write, a read-back is proof only when it parses as the persisted draft record.
  const failedWriteThenReadBack = (inboxDrafts: unknown) => {
    const realSet = Storage.prototype.setItem;
    const realGet = Storage.prototype.getItem;
    let failed = false;
    let attempted: Record<string, { commitId: string }> = {};
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) {
        failed = true;
        attempted = JSON.parse(v).state.inboxDrafts;
        throw new DOMException("full", "QuotaExceededError");
      }
      realSet.call(this, k, v);
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k) {
      const raw = realGet.call(this, k);
      if (k !== STORAGE_KEY || !failed || raw === null) return raw;
      if (inboxDrafts === "unreadable") return "{not json";
      const root = JSON.parse(raw);
      const drafts = typeof inboxDrafts === "function" ? inboxDrafts(attempted) : inboxDrafts;
      return JSON.stringify({ ...root, state: { ...root.state, inboxDrafts: drafts } });
    });
    return () => {
      vi.restoreAllMocks();
      return JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
    };
  };

  for (const [name, readBack] of [
    ["an array", []],
    ["a record with an invalid entry", { invalid: { text: 42 } }],
    ["a record whose other entry is invalid", { other: { text: "x", updatedAt: "t" } }],
    ["unreadable JSON", "unreadable"],
  ] as const) {
    it(`a failed discard whose read-back is ${name} is not-persisted; text and state stay`, async () => {
      const d = await save(SCOPE, "still here");
      const restore = failedWriteThenReadBack(readBack);
      expect(await S().discardInboxDraft(SCOPE, inboxDraftBase(d))).toEqual({
        ok: false,
        reason: "not-persisted",
      });
      expect(S().inboxDrafts[SCOPE]).toEqual(d);
      expect(restore().inboxDrafts[SCOPE]).toEqual(d);
    });
  }

  it("a failed save whose read-back is malformed is not-persisted, never proof", async () => {
    const d = await save(SCOPE, "first");
    // The read-back names the attempted commit id, but the entry is not a valid draft.
    const restore = failedWriteThenReadBack((attempted: Record<string, { commitId: string }>) => ({
      [SCOPE]: { commitId: attempted[SCOPE].commitId },
    }));
    expect(await S().saveInboxDraft(SCOPE, "second", inboxDraftBase(d), T0)).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().inboxDrafts[SCOPE]).toEqual(d);
    expect(restore().inboxDrafts[SCOPE]).toEqual(d);
  });

  it("a real discard of the last draft leaves a valid empty record, which is proof", async () => {
    const d = await save(SCOPE, "only one");
    expect(await S().discardInboxDraft(SCOPE, inboxDraftBase(d))).toEqual({
      ok: true,
      draft: null,
    });
    expect(stored().inboxDrafts).toEqual({});
  });

  it("without Web Locks nothing is written", async () => {
    setArticlesLock(null);
    expect(await S().saveInboxDraft(SCOPE, "x", inboxDraftBase(null), T0)).toEqual({
      ok: false,
      reason: "unsupported-save",
    });
    expect(S().inboxDrafts).toEqual({});
  });
});

// 📥 DT-6B-1: Threads/YouTube drafts use v2 provider scopes beside the untouched DT-6A Instagram keys; fetched
// Threads/YouTube bodies stay in memory (useProviderInbox) and never reach the persisted root, a backup, the media kit
// or the articles export.
describe("inbox drafts across providers (packet DT-6B-1)", () => {
  const T0 = at("2026-10-17T11:00:00Z");
  const LEGACY = "https%3A%2F%2Fscout.test|17841400000000001|conversation|c1";
  const THREADS = "v2|threads|https%3A%2F%2Fscout.test|25|comment|91001";
  const YOUTUBE = "v2|youtube|https%3A%2F%2Fscout.test|UCa|comment|Ug1";
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  const save = async (scope: string, text: string) => {
    const r = await S().saveInboxDraft(scope, text, inboxDraftBase(S().inboxDrafts[scope]), T0);
    if (!r.ok) throw new Error(r.reason);
    return r.draft!;
  };

  beforeEach(() => {
    let tail: Promise<unknown> = Promise.resolve();
    setArticlesLock((fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    });
  });
  afterEach(() => {
    setArticlesLock(undefined);
  });

  it("keeps an imported Instagram draft under its exact old key while v2 drafts round-trip beside it", async () => {
    const legacy = await save(LEGACY, "instagram words");
    const backup = S().exportState();
    S().reset();
    await S().importState(backup);
    expect(S().inboxDrafts[LEGACY]).toEqual(legacy);
    const th = await save(THREADS, "threads words");
    const yt = await save(YOUTUBE, "youtube words");
    expect(stored().inboxDrafts[LEGACY]).toEqual(legacy);
    const json = S().exportState();
    S().reset();
    await S().importState(json);
    expect(S().inboxDrafts).toEqual({ [LEGACY]: legacy, [THREADS]: th, [YOUTUBE]: yt });
    // Discarding a v2 draft leaves the Instagram one alone.
    expect((await S().discardInboxDraft(THREADS, inboxDraftBase(th))).ok).toBe(true);
    expect(S().inboxDrafts[LEGACY]).toEqual(legacy);
  });
});

// 📤 DT-6B-2A (planning/tools/37-inbox-send.md): the persisted send-operation handle beside each YouTube draft. Written
// BEFORE the prepare request through commitFresh (proven by its commit id), fenced by the operation id the caller
// expects, capped at 50 (settled ones go first), and never part of the media kit or the articles export.
describe("inbox send operations (packet DT-6B-2A)", () => {
  const T0 = at("2026-10-17T12:00:00Z");
  const SCOPE = "v2|youtube|https%3A%2F%2Fscout.test|UCa|comment|Ug1";
  const DIGEST = "a".repeat(64);
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  const op = (operationId = "op-aaaaaaaa", state: InboxSendOp["state"] = "preparing") => ({
    operationId,
    account: "UCa",
    draftRevision: "rev-1",
    digest: DIGEST,
    state,
  });
  const set = async (
    scope: string,
    o: Omit<InboxSendOp, "updatedAt" | "commitId">,
    expected: string | null,
    now = T0,
  ) => {
    const r = await S().setInboxSendOp(scope, o, expected, now);
    if (!r.ok) throw new Error(r.reason);
    return r.op!;
  };

  beforeEach(() => {
    let tail: Promise<unknown> = Promise.resolve();
    setArticlesLock((fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    });
  });
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("imports an old backup without inboxSendOps, and round-trips a handle through export", async () => {
    await S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
        },
      }),
    );
    expect(S().inboxSendOps).toEqual({});
    S().reset();
    const h = await set(SCOPE, op(), null);
    expect(h).toMatchObject({ ...op(), updatedAt: T0.toISOString() });
    expect(stored().inboxSendOps[SCOPE].commitId).toBe(h.commitId);
    const json = S().exportState();
    S().reset();
    await S().importState(json);
    expect(S().inboxSendOps[SCOPE]).toEqual(h);
  });

  it("updates only the operation the caller expects; a stale expectation conflicts", async () => {
    await set(SCOPE, op(), null);
    expect(await S().setInboxSendOp(SCOPE, op("op-bbbbbbbb"), null, T0)).toEqual({
      ok: false,
      reason: "conflict",
    });
    // The Worker converged on another operation id: the handle moves to it.
    const moved = await set(SCOPE, op("op-bbbbbbbb", "prepared"), "op-aaaaaaaa");
    expect(moved.operationId).toBe("op-bbbbbbbb");
    expect(await S().setInboxSendOp(SCOPE, op("op-aaaaaaaa"), "op-aaaaaaaa", T0)).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().clearInboxSendOp(SCOPE, "op-aaaaaaaa")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().clearInboxSendOp(SCOPE, "op-bbbbbbbb")).toEqual({ ok: true, op: null });
    expect(S().inboxSendOps[SCOPE]).toBeUndefined();
    expect(stored().inboxSendOps[SCOPE]).toBeUndefined();
  });

  it("refuses a malformed handle and leaves drafts alone", async () => {
    const draft = await S().saveInboxDraft(SCOPE, "my reply", inboxDraftBase(null), T0);
    for (const bad of [
      { ...op(), digest: "nothex" },
      { ...op(), operationId: "x" },
      { ...op(), state: "resend" as never },
      { ...op(), account: "" },
    ])
      expect(await S().setInboxSendOp(SCOPE, bad, null, T0)).toEqual({
        ok: false,
        reason: "invalid",
      });
    expect(S().inboxSendOps).toEqual({});
    await set(SCOPE, op(), null);
    expect(S().inboxDrafts[SCOPE]).toEqual(draft.ok && draft.draft);
  });

  it("keeps at most 50 handles, dropping settled ones before any uncertain one", async () => {
    await set("scope-unknown", op("op-unknown1", "unknown"), null, at("2026-10-01T00:00:00Z"));
    for (let i = 0; i < 50; i++)
      await set(
        `scope-${i}`,
        op(`op-sent-${String(i).padStart(4, "0")}`, "sent"),
        null,
        new Date(T0.getTime() + i * 1000),
      );
    const keys = Object.keys(S().inboxSendOps);
    expect(keys).toHaveLength(50);
    expect(keys).toContain("scope-unknown");
    expect(keys).not.toContain("scope-0");
    expect(Object.keys(stored().inboxSendOps)).toHaveLength(50);
  });

  it("a write the browser did not keep is not-persisted and memory rolls back", async () => {
    const h = await set(SCOPE, op(), null);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(
      await S().setInboxSendOp(SCOPE, op("op-aaaaaaaa", "dispatching"), "op-aaaaaaaa", T0),
    ).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().inboxSendOps[SCOPE]).toEqual(h);
  });

  it("holds no reply text, and never reaches the media kit or the articles export (privacy canary)", async () => {
    await S().saveInboxDraft(SCOPE, "CANARY-send-text-6e1f", inboxDraftBase(null), T0);
    await set(SCOPE, op("op-canary-77"), null);
    expect(JSON.stringify(S().inboxSendOps)).not.toContain("CANARY-send-text-6e1f");
    for (const out of [
      JSON.stringify(kitProjection(S(), T0)),
      JSON.stringify(articlesExport(S().articles, T0)),
    ]) {
      expect(out).not.toContain("op-canary-77");
      expect(out).not.toContain(DIGEST);
    }
  });

  // DT-6B-2A-R1 (2A-3): a full device never evicts an operation that may still be (or have been) sent.
  it("refuses a new handle with capacity when 50 unresolved ones are kept; updates still work", async () => {
    for (let i = 0; i < 50; i++)
      await set(
        `scope-${i}`,
        op(
          `op-unres-${String(i).padStart(4, "0")}`,
          (["preparing", "prepared", "dispatching", "unknown"] as const)[i % 4],
        ),
        null,
      );
    expect(await S().setInboxSendOp("scope-new", op("op-new-0001"), null, T0)).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(Object.keys(S().inboxSendOps)).toHaveLength(50);
    expect(Object.keys(stored().inboxSendOps)).toHaveLength(50);
    expect(S().inboxSendOps["scope-0"]).toBeDefined();
    // An existing unresolved handle still moves on.
    expect((await set("scope-0", op("op-unres-0000", "prepared"), "op-unres-0000")).state).toBe(
      "prepared",
    );
    // One settled handle frees exactly one place: the oldest settled goes, every unresolved one stays.
    await set("scope-1", { ...op("op-unres-0001", "sent"), receiptVersion: 5 }, "op-unres-0001");
    expect((await set("scope-new", op("op-new-0001"), null)).operationId).toBe("op-new-0001");
    expect(S().inboxSendOps["scope-1"]).toBeUndefined();
    expect(Object.keys(S().inboxSendOps)).toHaveLength(50);
  });

  // DT-6B-2A-R1 (2A-2): an older answer never overwrites newer proof about the same operation.
  it("a receipt cannot regress: settled is final, unknown never goes back, older versions are stale", async () => {
    const id = "op-aaaaaaaa";
    await set(SCOPE, { ...op(id, "prepared"), receiptVersion: 100 }, null);
    // Local step before the confirm request: keeps the Worker's version.
    expect((await set(SCOPE, op(id, "dispatching"), id)).receiptVersion).toBe(100);
    // The Worker's sent (same or later version) moves forward.
    expect((await set(SCOPE, { ...op(id, "sent"), receiptVersion: 200 }, id)).state).toBe("sent");
    for (const late of [
      { ...op(id, "dispatching"), receiptVersion: 200 },
      { ...op(id, "prepared"), receiptVersion: 100 },
      { ...op(id, "unknown"), receiptVersion: 300 },
      op(id, "dispatching"),
      op(id, "prepared"),
    ])
      expect(await S().setInboxSendOp(SCOPE, late, id, T0)).toEqual({ ok: false, reason: "stale" });
    expect(S().inboxSendOps[SCOPE].state).toBe("sent");
    expect(stored().inboxSendOps[SCOPE].state).toBe("sent");
    // The same receipt again is fine.
    expect((await set(SCOPE, { ...op(id, "sent"), receiptVersion: 200 }, id)).state).toBe("sent");

    const other = "v2|other";
    await set(other, { ...op(id, "unknown"), receiptVersion: 200 }, null);
    for (const late of [
      { ...op(id, "dispatching"), receiptVersion: 200 },
      op(id, "dispatching"),
      { ...op(id, "unknown"), receiptVersion: 100 },
    ])
      expect(await S().setInboxSendOp(other, late, id, T0)).toEqual({ ok: false, reason: "stale" });
    expect((await set(other, { ...op(id, "sent"), receiptVersion: 250 }, id)).state).toBe("sent");

    // A refusal before the claim rolls the local "dispatching" back to prepared; a Worker "prepared" may too.
    const third = "v2|third";
    await set(third, { ...op(id, "prepared"), receiptVersion: 100 }, null);
    await set(third, op(id, "dispatching"), id);
    expect((await set(third, op(id, "prepared"), id)).state).toBe("prepared");
    await set(third, op(id, "dispatching"), id);
    expect((await set(third, { ...op(id, "prepared"), receiptVersion: 100 }, id)).state).toBe(
      "prepared",
    );
    expect(
      await S().setInboxSendOp(third, { ...op(id, "prepared"), receiptVersion: 50 }, id, T0),
    ).toEqual({
      ok: false,
      reason: "stale",
    });
  });
});

// 📤 DT-6B-2B-2 (planning/tools/37-inbox-send.md): the persisted handle of a reviewed Threads reply, a separate slice
// from YouTube's. Compare-and-swap on the operation id the caller saw, then on the Worker's integer receiptVersion: an
// older version is stale, an equal version that says something else contradicts, and a stage never goes back. Capped at
// 50 (settled ones go first, unresolved ones are never evicted), no text, never in the media kit or articles export.
describe("inbox Threads send operations (packet DT-6B-2B-2)", () => {
  const T0 = at("2026-10-17T12:00:00Z");
  const SCOPE = "v2|threads|https%3A%2F%2Fscout.test|25|comment|91001";
  const DIGEST = "b".repeat(64);
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  type Op = Omit<InboxThreadsSendOp, "updatedAt" | "commitId">;
  const op = (
    operationId = "op-th-aaaaaa",
    state: InboxThreadsSendOp["state"] = "preparing",
    over: Partial<Op> = {},
  ): Op => ({
    operationId,
    account: "25",
    draftRevision: "rev-1",
    digest: DIGEST,
    state,
    ...over,
  });
  const set = async (scope: string, o: Op, expected: string | null, now = T0) => {
    const r = await S().setInboxThreadsSendOp(scope, o, expected, now);
    if (!r.ok) throw new Error(r.reason);
    return r.op!;
  };
  const refused = (o: Op, expected: string | null = o.operationId, scope = SCOPE) =>
    S().setInboxThreadsSendOp(scope, o, expected, T0);

  beforeEach(() => {
    let tail: Promise<unknown> = Promise.resolve();
    setArticlesLock((fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    });
  });
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("imports an old backup without the slice, and round-trips a handle through export", async () => {
    await S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
          inboxSendOps: {},
        },
      }),
    );
    expect(S().inboxThreadsSendOps).toEqual({});
    S().reset();
    const h = await set(SCOPE, op(), null);
    expect(h).toMatchObject({ ...op(), updatedAt: T0.toISOString() });
    expect(stored().inboxThreadsSendOps[SCOPE].commitId).toBe(h.commitId);
    const json = S().exportState();
    S().reset();
    await S().importState(json);
    expect(S().inboxThreadsSendOps[SCOPE]).toEqual(h);
    // The YouTube slice is a different one and stays untouched.
    expect(S().inboxSendOps).toEqual({});
  });

  it("updates only the operation the caller expects; canonical convergence moves the handle", async () => {
    await set(SCOPE, op(), null);
    expect(await refused(op("op-th-bbbbbb"), null)).toEqual({ ok: false, reason: "conflict" });
    const moved = await set(
      SCOPE,
      op("op-th-bbbbbb", "prepared", { receiptVersion: 1 }),
      "op-th-aaaaaa",
    );
    expect(moved.operationId).toBe("op-th-bbbbbb");
    expect(await refused(op("op-th-aaaaaa"), "op-th-aaaaaa")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().clearInboxThreadsSendOp(SCOPE, "op-th-aaaaaa")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().clearInboxThreadsSendOp(SCOPE, "op-th-bbbbbb")).toEqual({
      ok: true,
      op: null,
    });
    expect(S().inboxThreadsSendOps[SCOPE]).toBeUndefined();
    expect(stored().inboxThreadsSendOps[SCOPE]).toBeUndefined();
  });

  it("refuses malformed handles (no text, no YouTube state, integer versions, plain ids)", async () => {
    for (const bad of [
      op("op-th-aaaaaa", "preparing", { digest: "nothex" }),
      op("x"),
      op("op-th-aaaaaa", "sent" as never),
      op("op-th-aaaaaa", "dispatching" as never),
      op("op-th-aaaaaa", "preparing", { account: "" }),
      op("op-th-aaaaaa", "prepared", { receiptVersion: 1.5 }),
      op("op-th-aaaaaa", "created", { receiptVersion: 3, containerId: "a/b" }),
      { ...op(), text: "my reply" } as Op,
    ])
      expect(await refused(bad, null)).toEqual({ ok: false, reason: "invalid" });
    expect(S().inboxThreadsSendOps).toEqual({});
  });

  it("versions: older is stale, an equal version that says something else contradicts, stages never go back", async () => {
    const id = "op-th-aaaaaa";
    const C = "17800000000000001";
    await set(SCOPE, op(id), null);
    await set(SCOPE, op(id, "prepared", { receiptVersion: 1 }), id);
    // A local mark before Confirm keeps the Worker's version; the same receipt rolls it back.
    expect((await set(SCOPE, op(id, "confirming"), id)).receiptVersion).toBe(1);
    expect((await set(SCOPE, op(id, "prepared", { receiptVersion: 1 }), id)).state).toBe(
      "prepared",
    );
    await set(SCOPE, op(id, "confirming"), id);
    expect(await refused(op(id, "creating", { receiptVersion: 1 }))).toEqual({
      ok: false,
      reason: "stale",
    });
    const created = await set(SCOPE, op(id, "created", { receiptVersion: 3, containerId: C }), id);
    expect(created).toMatchObject({ state: "created", containerId: C });
    for (const late of [
      op(id, "prepared", { receiptVersion: 1 }),
      op(id, "creating", { receiptVersion: 2 }),
      // Same version, another state: a contradiction.
      op(id, "publishing", { receiptVersion: 3, containerId: C }),
      // A later version may not go back a stage.
      op(id, "creating", { receiptVersion: 9 }),
      op(id, "prepared", { receiptVersion: 9 }),
      op(id, "preparing"),
    ])
      expect(await refused(late)).toEqual({ ok: false, reason: "stale" });
    // A known container id never changes.
    expect(
      await refused(op(id, "publishing", { receiptVersion: 4, containerId: "17800000000000002" })),
    ).toEqual({ ok: false, reason: "stale" });
    // The same receipt again is fine; the next stage moves forward.
    expect(
      (await set(SCOPE, op(id, "created", { receiptVersion: 3, containerId: C }), id)).state,
    ).toBe("created");
    await set(SCOPE, op(id, "unknown_publication", { receiptVersion: 5, containerId: C }), id);
    for (const late of [
      op(id, "publishing", { receiptVersion: 6, containerId: C }),
      op(id, "created", { receiptVersion: 7, containerId: C }),
      op(id, "confirming"),
    ])
      expect(await refused(late)).toEqual({ ok: false, reason: "stale" });
    await set(
      SCOPE,
      op(id, "published", { receiptVersion: 8, containerId: C, publishedId: "18000000000000009" }),
      id,
    );
    for (const late of [
      op(id, "rejected", { receiptVersion: 9 }),
      op(id, "unknown_publication", { receiptVersion: 9 }),
      op(id, "published", { receiptVersion: 7 }),
    ])
      expect(await refused(late)).toEqual({ ok: false, reason: "stale" });
    expect(S().inboxThreadsSendOps[SCOPE]).toMatchObject({
      state: "published",
      receiptVersion: 8,
      publishedId: "18000000000000009",
    });
    expect(stored().inboxThreadsSendOps[SCOPE].state).toBe("published");
  });

  it("keeps at most 50 handles, dropping settled ones before any unresolved one", async () => {
    await set(
      "scope-unknown",
      op("op-th-unknown1", "unknown_creation", { receiptVersion: 2 }),
      null,
      at("2026-10-01T00:00:00Z"),
    );
    for (let i = 0; i < 50; i++)
      await set(
        `scope-${i}`,
        op(`op-th-pub-${String(i).padStart(4, "0")}`, "published", { receiptVersion: 5 }),
        null,
        new Date(T0.getTime() + i * 1000),
      );
    const keys = Object.keys(S().inboxThreadsSendOps);
    expect(keys).toHaveLength(50);
    expect(keys).toContain("scope-unknown");
    expect(keys).not.toContain("scope-0");
    expect(Object.keys(stored().inboxThreadsSendOps)).toHaveLength(50);
  });

  it("refuses a new handle with capacity when 50 unresolved ones are kept; updates still work", async () => {
    const unresolved = [
      "preparing",
      "prepared",
      "confirming",
      "creating",
      "created",
      "publishing",
      "unknown_creation",
      "unknown_publication",
    ] as const;
    for (let i = 0; i < 50; i++)
      await set(
        `scope-${i}`,
        op(`op-th-unres-${String(i).padStart(4, "0")}`, unresolved[i % 8]),
        null,
      );
    expect(await refused(op("op-th-new-0001"), null, "scope-new")).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(Object.keys(stored().inboxThreadsSendOps)).toHaveLength(50);
    expect(
      (
        await set(
          "scope-0",
          op("op-th-unres-0000", "prepared", { receiptVersion: 1 }),
          "op-th-unres-0000",
        )
      ).state,
    ).toBe("prepared");
    // One settled handle frees exactly one place: the oldest settled goes, every unresolved one stays.
    await set(
      "scope-1",
      op("op-th-unres-0001", "rejected", { receiptVersion: 4 }),
      "op-th-unres-0001",
    );
    expect((await set("scope-new", op("op-th-new-0001"), null)).operationId).toBe("op-th-new-0001");
    expect(S().inboxThreadsSendOps["scope-1"]).toBeUndefined();
    expect(Object.keys(S().inboxThreadsSendOps)).toHaveLength(50);
  });

  it("a write the browser did not keep is not-persisted and memory rolls back", async () => {
    const h = await set(SCOPE, op(), null);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(await refused(op("op-th-aaaaaa", "prepared", { receiptVersion: 1 }))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().inboxThreadsSendOps[SCOPE]).toEqual(h);
  });

  it("holds no reply text, and never reaches the media kit or the articles export (privacy canary)", async () => {
    await S().saveInboxDraft(SCOPE, "CANARY-threads-send-9c2a", inboxDraftBase(null), T0);
    await set(SCOPE, op("op-th-canary-77"), null);
    await set(
      SCOPE,
      op("op-th-canary-77", "created", { receiptVersion: 3, containerId: "17800000000000077" }),
      "op-th-canary-77",
    );
    expect(JSON.stringify(S().inboxThreadsSendOps)).not.toContain("CANARY-threads-send-9c2a");
    expect(JSON.stringify(stored().inboxThreadsSendOps)).not.toContain("CANARY-threads-send-9c2a");
    for (const out of [
      JSON.stringify(kitProjection(S(), T0)),
      JSON.stringify(articlesExport(S().articles, T0)),
    ]) {
      expect(out).not.toContain("op-th-canary-77");
      expect(out).not.toContain("17800000000000077");
      expect(out).not.toContain(DIGEST);
    }
  });

  // DT-6B-2B-2-R1 (2B2-1 / 2B2-2 / 2B2-3): immutable proof and identity at the store boundary, the handle's Worker origin,
  // and `current` read back after the commit (another writer may land before the caller resumes).
  it("R1: a recorded publication id, account, revision, digest or Worker origin never changes for the operation", async () => {
    const id = "op-th-aaaaaa";
    const C = "17800000000000001";
    const P = "18000000000000009";
    const W = "https://scout.test";
    await set(SCOPE, op(id, "preparing", { workerOrigin: W }), null);
    await set(SCOPE, op(id, "prepared", { receiptVersion: 1 }), id);
    for (const over of [
      { account: "26" },
      { draftRevision: "rev-2" },
      { digest: "c".repeat(64) },
      { workerOrigin: "https://other.test" },
    ])
      expect((await refused(op(id, "prepared", { receiptVersion: 1, ...over }))).ok).toBe(false);
    expect(stored().inboxThreadsSendOps[SCOPE]).toMatchObject({
      account: "25",
      draftRevision: "rev-1",
      digest: DIGEST,
      workerOrigin: W,
    });
    await set(
      SCOPE,
      op(id, "published", { receiptVersion: 5, containerId: C, publishedId: P }),
      id,
    );
    for (const receiptVersion of [5, 6])
      expect(
        await refused(
          op(id, "published", { receiptVersion, containerId: C, publishedId: "18000000000000777" }),
        ),
      ).toEqual({ ok: false, reason: "stale" });
    expect(stored().inboxThreadsSendOps[SCOPE]).toMatchObject({
      publishedId: P,
      receiptVersion: 5,
      workerOrigin: W,
    });
    // The same proof again is fine; a handle without an origin (2B-2) stays valid.
    expect(
      (
        await set(
          SCOPE,
          op(id, "published", { receiptVersion: 5, containerId: C, publishedId: P }),
          id,
        )
      ).publishedId,
    ).toBe(P);
    expect((await set("scope-legacy", op("op-th-legacy01"), null)).workerOrigin).toBeUndefined();
  });

  it("R1: a write answers with the handle stored after its commit, including a later writer's", async () => {
    const id = "op-th-aaaaaa";
    await set(SCOPE, op(id), null);
    const w = await S().setInboxThreadsSendOp(
      SCOPE,
      op(id, "prepared", { receiptVersion: 1 }),
      id,
      T0,
    );
    expect(w).toMatchObject({ ok: true, current: { state: "prepared", receiptVersion: 1 } });
    let injected = false;
    let tail: Promise<unknown> = Promise.resolve();
    const queue: ArticlesLock = (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
    setArticlesLock(async (fn) => {
      const r = await fn();
      if (!injected) {
        injected = true;
        setArticlesLock(queue);
        await set(SCOPE, op(id, "unknown_creation", { receiptVersion: 3 }), id);
      }
      return r;
    });
    const raced = await S().setInboxThreadsSendOp(
      SCOPE,
      op(id, "prepared", { receiptVersion: 1 }),
      id,
      T0,
    );
    expect(injected).toBe(true);
    expect(raced).toMatchObject({
      ok: true,
      op: { state: "prepared" },
      current: { state: "unknown_creation", receiptVersion: 3 },
    });
  });
});

// 📤 DT-6B-2C-4 (planning/tools/37-inbox-send.md): the persisted handle of a reviewed Instagram public reply, its own slice
// (keyed `instagram|<draft scope>`). Compare-and-swap on the operation id the caller saw, then on the Worker's integer
// receiptVersion and the public state order; identity (Worker origin, account, media, comment, revision, digest), the
// learned send generation and a known reply id never change; `current` is read back after the commit. Capped at 50
// (settled ones go first; preparing/confirming/prepared/dispatching/unknown survive), no text, never in the media kit or
// the articles export, old backups default to an empty slice.
describe("inbox Instagram public send operations (packet DT-6B-2C-4)", () => {
  const T0 = at("2026-10-17T12:00:00Z");
  const W = "https://scout.test";
  const SCOPE = "instagram|https%3A%2F%2Fscout.test|17841000000000001|comment|17900000000000001";
  const DIGEST = "b".repeat(64);
  const GEN = "e".repeat(32);
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  type Op = Omit<InboxInstagramSendOp, "updatedAt" | "commitId">;
  const op = (
    operationId = "op-ig-aaaaaa",
    state: InboxInstagramSendOp["state"] = "preparing",
    over: Partial<Op> = {},
  ): Op => ({
    operationId,
    workerOrigin: W,
    account: "17841000000000001",
    mediaId: "18000000000000001",
    commentId: "17900000000000001",
    draftRevision: "rev-1",
    digest: DIGEST,
    state,
    ...over,
  });
  const set = async (scope: string, o: Op, expected: string | null, now = T0) => {
    const r = await S().setInboxInstagramSendOp(scope, o, expected, now);
    if (!r.ok) throw new Error(r.reason);
    return r.op!;
  };
  const refused = (o: Op, expected: string | null = o.operationId, scope = SCOPE) =>
    S().setInboxInstagramSendOp(scope, o, expected, T0);
  const key = (i: number | string) => `instagram|https%3A%2F%2Fscout.test|1|comment|${i}`;

  beforeEach(() => {
    let tail: Promise<unknown> = Promise.resolve();
    setArticlesLock((fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    });
  });
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("imports an old backup without the slice, and round-trips a handle through export and merge", async () => {
    await S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
          inboxThreadsSendOps: {},
        },
      }),
    );
    expect(S().inboxInstagramSendOps).toEqual({});
    S().reset();
    const h = await set(SCOPE, op(), null);
    expect(h).toMatchObject({ ...op(), updatedAt: T0.toISOString() });
    expect(stored().inboxInstagramSendOps[SCOPE].commitId).toBe(h.commitId);
    const json = S().exportState();
    S().reset();
    await S().importState(json);
    expect(S().inboxInstagramSendOps[SCOPE]).toEqual(h);
    // Another tab's write reaches this one through the existing merge (rehydrate).
    const disk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    disk.state.inboxInstagramSendOps = { [key(9)]: { ...h, operationId: "op-ig-other1" } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(disk));
    await useStore.persist.rehydrate();
    expect(Object.keys(S().inboxInstagramSendOps)).toEqual([key(9)]);
    // The Threads and YouTube slices are different ones and stay untouched.
    expect(S().inboxThreadsSendOps).toEqual({});
    expect(S().inboxSendOps).toEqual({});
  });

  it("updates only the operation the caller expects; canonical convergence moves the handle", async () => {
    await set(SCOPE, op(), null);
    expect(await refused(op("op-ig-bbbbbb"), null)).toEqual({ ok: false, reason: "conflict" });
    const moved = await set(
      SCOPE,
      op("op-ig-bbbbbb", "prepared", { receiptVersion: 1, sendGeneration: GEN }),
      "op-ig-aaaaaa",
    );
    expect(moved).toMatchObject({ operationId: "op-ig-bbbbbb", sendGeneration: GEN });
    expect(await refused(op("op-ig-aaaaaa"), "op-ig-aaaaaa")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().clearInboxInstagramSendOp(SCOPE, "op-ig-aaaaaa")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().clearInboxInstagramSendOp(SCOPE, "op-ig-bbbbbb")).toEqual({
      ok: true,
      op: null,
    });
    expect(S().inboxInstagramSendOps[SCOPE]).toBeUndefined();
    expect(stored().inboxInstagramSendOps[SCOPE]).toBeUndefined();
  });

  it("refuses malformed handles (no text, no other provider's state, integer versions, plain ids, own key)", async () => {
    const cases: [Op, string][] = [
      [op("op-ig-aaaaaa", "preparing", { digest: "nothex" }), SCOPE],
      [op("x"), SCOPE],
      [op("op-ig-aaaaaa", "published" as never), SCOPE],
      [op("op-ig-aaaaaa", "created" as never), SCOPE],
      [op("op-ig-aaaaaa", "preparing", { account: "" }), SCOPE],
      [op("op-ig-aaaaaa", "preparing", { mediaId: "a/b" }), SCOPE],
      [op("op-ig-aaaaaa", "preparing", { workerOrigin: "scout.test" }), SCOPE],
      [op("op-ig-aaaaaa", "preparing", { workerOrigin: undefined }), SCOPE],
      [op("op-ig-aaaaaa", "prepared", { receiptVersion: 1.5 }), SCOPE],
      [op("op-ig-aaaaaa", "sent", { receiptVersion: 3, providerReplyId: "a/b" }), SCOPE],
      [op("op-ig-aaaaaa", "prepared", { receiptVersion: 1, sendGeneration: "zz" }), SCOPE],
      [{ ...op(), text: "my reply" } as Op, SCOPE],
      [op(), "v2|threads|x|1|comment|2"],
    ];
    for (const [bad, scope] of cases)
      expect(await refused(bad, null, scope)).toEqual({ ok: false, reason: "invalid" });
    expect(S().inboxInstagramSendOps).toEqual({});
  });

  it("versions and the public state order: older is stale, an equal version that says something else contradicts", async () => {
    const id = "op-ig-aaaaaa";
    await set(SCOPE, op(id), null);
    await set(SCOPE, op(id, "prepared", { receiptVersion: 1, sendGeneration: GEN }), id);
    // The local pending-confirm mark keeps the Worker's version. DT-6B-2C-4-R1 (2C4-2): neither the same prepared
    // receipt nor a bare roll-back undoes it (a prepared read cannot prove the Confirm will not land); only the named
    // rollback of that exact mark can (its own test below).
    const mark = await set(SCOPE, op(id, "confirming"), id);
    expect(mark.receiptVersion).toBe(1);
    expect(await refused(op(id, "prepared"))).toEqual({ ok: false, reason: "stale" });
    expect(await refused(op(id, "prepared", { receiptVersion: 1, sendGeneration: GEN }))).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(S().inboxInstagramSendOps[SCOPE]).toEqual(mark);
    expect(await refused(op(id, "dispatching", { receiptVersion: 1 }))).toEqual({
      ok: false,
      reason: "stale",
    });
    const d = await set(SCOPE, op(id, "dispatching", { receiptVersion: 2 }), id);
    // A step without it never forgets the learned send generation.
    expect(d).toMatchObject({ state: "dispatching", receiptVersion: 2, sendGeneration: GEN });
    for (const late of [
      op(id, "prepared", { receiptVersion: 1 }),
      op(id, "prepared", { receiptVersion: 9 }),
      op(id, "unknown", { receiptVersion: 2 }),
      op(id, "cancelled", { receiptVersion: 3 }),
      op(id, "expired", { receiptVersion: 3 }),
      op(id, "already_claimed", { receiptVersion: 3 }),
      op(id, "confirming"),
      op(id, "preparing"),
    ])
      expect(await refused(late)).not.toMatchObject({ ok: true });
    // The learned send generation never changes.
    expect(
      await refused(op(id, "dispatching", { receiptVersion: 2, sendGeneration: "f".repeat(32) })),
    ).toEqual({ ok: false, reason: "invalid" });
    // unknown (a lost receipt) may still become sent or rejected; sent is final and its reply id never changes.
    await set(SCOPE, op(id, "unknown", { receiptVersion: 3 }), id);
    const sent = await set(
      SCOPE,
      op(id, "sent", { receiptVersion: 4, providerReplyId: "17950000000000001" }),
      id,
    );
    expect(sent).toMatchObject({ state: "sent", providerReplyId: "17950000000000001" });
    for (const late of [
      op(id, "rejected", { receiptVersion: 5 }),
      op(id, "unknown", { receiptVersion: 5 }),
      op(id, "sent", { receiptVersion: 3, providerReplyId: "17950000000000001" }),
      op(id, "sent", { receiptVersion: 4, providerReplyId: "17950000000000777" }),
      op(id, "sent", { receiptVersion: 6, providerReplyId: "17950000000000777" }),
    ])
      expect(await refused(late)).toEqual({ ok: false, reason: "stale" });
    expect(stored().inboxInstagramSendOps[SCOPE]).toMatchObject({
      state: "sent",
      receiptVersion: 4,
      providerReplyId: "17950000000000001",
      sendGeneration: GEN,
    });
  });

  it("identity never changes for the operation: origin, account, media, comment, revision, digest", async () => {
    const id = "op-ig-aaaaaa";
    await set(SCOPE, op(id), null);
    await set(SCOPE, op(id, "prepared", { receiptVersion: 1 }), id);
    for (const over of [
      { workerOrigin: "https://other.test" },
      { account: "17841000000000002" },
      { mediaId: "18000000000000002" },
      { commentId: "17900000000000002" },
      { draftRevision: "rev-2" },
      { digest: "c".repeat(64) },
    ])
      expect(await refused(op(id, "prepared", { receiptVersion: 1, ...over }))).toEqual({
        ok: false,
        reason: "invalid",
      });
    expect(stored().inboxInstagramSendOps[SCOPE]).toMatchObject(op(id, "prepared"));
  });

  it("keeps at most 50 handles, dropping settled ones (already_claimed included) before any unresolved one", async () => {
    await set(
      key("u"),
      op("op-ig-unknown1", "unknown", { receiptVersion: 2 }),
      null,
      at("2026-10-01T00:00:00Z"),
    );
    await set(
      key("c"),
      op("op-ig-claimed1", "already_claimed", { receiptVersion: 2 }),
      null,
      at("2026-10-02T00:00:00Z"),
    );
    for (let i = 0; i < 49; i++)
      await set(
        key(i),
        op(`op-ig-sent-${String(i).padStart(4, "0")}`, "sent", {
          receiptVersion: 5,
          providerReplyId: "1795",
        }),
        null,
        new Date(T0.getTime() + i * 1000),
      );
    const keys = Object.keys(S().inboxInstagramSendOps);
    expect(keys).toHaveLength(50);
    expect(keys).toContain(key("u"));
    expect(keys).not.toContain(key("c"));
    expect(Object.keys(stored().inboxInstagramSendOps)).toHaveLength(50);
  });

  it("refuses a new handle with capacity when 50 unresolved ones are kept; updates still work; reload keeps them", async () => {
    const unresolved = ["preparing", "confirming", "prepared", "dispatching", "unknown"] as const;
    for (let i = 0; i < 50; i++) {
      const s = unresolved[i % 5];
      await set(
        key(i),
        op(`op-ig-unres-${String(i).padStart(4, "0")}`, s, {
          ...(s === "preparing" || s === "confirming" ? {} : { receiptVersion: 2 }),
        }),
        null,
      );
    }
    expect(await refused(op("op-ig-new-0001"), null, key("new"))).toEqual({
      ok: false,
      reason: "capacity",
    });
    await useStore.persist.rehydrate();
    expect(Object.keys(S().inboxInstagramSendOps)).toHaveLength(50);
    expect(
      (
        await set(
          key(2),
          op("op-ig-unres-0002", "dispatching", { receiptVersion: 3 }),
          "op-ig-unres-0002",
        )
      ).state,
    ).toBe("dispatching");
    // One settled handle frees exactly one place.
    await set(
      key(3),
      op("op-ig-unres-0003", "sent", { receiptVersion: 4, providerReplyId: "1" }),
      "op-ig-unres-0003",
    );
    expect((await set(key("new"), op("op-ig-new-0001"), null)).operationId).toBe("op-ig-new-0001");
    expect(S().inboxInstagramSendOps[key(3)]).toBeUndefined();
    expect(Object.keys(stored().inboxInstagramSendOps)).toHaveLength(50);
  });

  it("a write the browser did not keep is not-persisted and memory rolls back", async () => {
    const h = await set(SCOPE, op(), null);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(await refused(op("op-ig-aaaaaa", "prepared", { receiptVersion: 1 }))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().inboxInstagramSendOps[SCOPE]).toEqual(h);
  });

  it("a write answers with the handle stored after its commit, including a later writer's", async () => {
    const id = "op-ig-aaaaaa";
    await set(SCOPE, op(id), null);
    let injected = false;
    let tail: Promise<unknown> = Promise.resolve();
    const queue: ArticlesLock = (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
    setArticlesLock(async (fn) => {
      const r = await fn();
      if (!injected) {
        injected = true;
        setArticlesLock(queue);
        await set(SCOPE, op(id, "dispatching", { receiptVersion: 3 }), id);
      }
      return r;
    });
    const raced = await S().setInboxInstagramSendOp(
      SCOPE,
      op(id, "prepared", { receiptVersion: 1 }),
      id,
      T0,
    );
    expect(injected).toBe(true);
    expect(raced).toMatchObject({
      ok: true,
      op: { state: "prepared" },
      current: { state: "dispatching", receiptVersion: 3 },
    });
  });

  it("holds no reply text, and never reaches the media kit or the articles export (privacy canary)", async () => {
    const draft = "https%3A%2F%2Fscout.test|17841000000000001|comment|17900000000000001";
    await S().saveInboxDraft(draft, "CANARY-ig-send-4b7e", inboxDraftBase(null), T0);
    await set(SCOPE, op("op-ig-canary-77"), null);
    await set(
      SCOPE,
      op("op-ig-canary-77", "sent", {
        receiptVersion: 3,
        sendGeneration: GEN,
        providerReplyId: "17950000000000077",
      }),
      "op-ig-canary-77",
    );
    expect(JSON.stringify(S().inboxInstagramSendOps)).not.toContain("CANARY-ig-send-4b7e");
    expect(JSON.stringify(stored().inboxInstagramSendOps)).not.toContain("CANARY-ig-send-4b7e");
    for (const out of [
      JSON.stringify(kitProjection(S(), T0)),
      JSON.stringify(articlesExport(S().articles, T0)),
    ]) {
      expect(out).not.toContain("op-ig-canary-77");
      expect(out).not.toContain("17950000000000077");
      expect(out).not.toContain(DIGEST);
      expect(out).not.toContain("CANARY-ig-send-4b7e");
    }
  });

  // DT-6B-2C-4-R1 (2C4-1): a preparing handle is let go only while it is still that exact, unchanged preparing record.
  it("conditional clear deletes an unchanged preparing record and keeps any newer proof of the operation", async () => {
    const id = "op-ig-aaaaaa";
    const prep = await set(SCOPE, op(id), null);
    const expectOf = (h: InboxInstagramSendOp) => ({
      operationId: h.operationId,
      state: "preparing" as const,
      receiptVersion: h.receiptVersion,
      commitId: h.commitId,
    });
    // Nothing stored: nothing to do.
    expect(await S().clearInboxInstagramSendOpIf(key("none"), expectOf(prep))).toMatchObject({
      ok: true,
      op: null,
    });
    // The newer records a request may have produced meanwhile all stay (memory and disk), with what is stored now.
    for (const newer of [
      op(id, "prepared", { receiptVersion: 1, sendGeneration: GEN }),
      op(id, "unknown", { receiptVersion: 3, sendGeneration: GEN }),
      op(id, "sent", {
        receiptVersion: 3,
        sendGeneration: GEN,
        providerReplyId: "17950000000000001",
      }),
    ]) {
      await S().reset();
      const p = await set(SCOPE, op(id), null);
      const h = await set(SCOPE, newer, id);
      const r = await S().clearInboxInstagramSendOpIf(SCOPE, expectOf(p));
      expect(r).toEqual({ ok: false, reason: "stale", current: h });
      expect(S().inboxInstagramSendOps[SCOPE]).toEqual(h);
      expect(stored().inboxInstagramSendOps[SCOPE]).toEqual(h);
    }
    // The pending-confirm mark (a request may have reached the Worker) stays too.
    await S().reset();
    const p = await set(SCOPE, op(id), null);
    await set(SCOPE, op(id, "prepared", { receiptVersion: 1, sendGeneration: GEN }), id);
    const mark = await set(SCOPE, op(id, "confirming"), id);
    expect(await S().clearInboxInstagramSendOpIf(SCOPE, expectOf(p))).toEqual({
      ok: false,
      reason: "stale",
      current: mark,
    });
    // Another operation, or the same one written again (another commit), is not the captured record.
    await S().reset();
    const other = await set(SCOPE, op("op-ig-bbbbbb"), null);
    expect(await S().clearInboxInstagramSendOpIf(SCOPE, expectOf(prep))).toEqual({
      ok: false,
      reason: "stale",
      current: other,
    });
    expect(
      await S().clearInboxInstagramSendOpIf(SCOPE, {
        ...expectOf(other),
        commitId: "older-commit",
      }),
    ).toMatchObject({ ok: false, reason: "stale" });
    // The unchanged preparing record is let go, on disk too.
    expect(await S().clearInboxInstagramSendOpIf(SCOPE, expectOf(other))).toMatchObject({
      ok: true,
      op: null,
    });
    expect(S().inboxInstagramSendOps[SCOPE]).toBeUndefined();
    expect(stored().inboxInstagramSendOps[SCOPE]).toBeUndefined();
  });

  // DT-6B-2C-4-R1 (2C4-2): `confirming` is the pending/uncertain Confirm; no status write may turn it back into a review.
  it("no prepared write undoes a pending Confirm or later proof; only the named rollback of that exact mark", async () => {
    const id = "op-ig-aaaaaa";
    await set(SCOPE, op(id), null);
    await set(SCOPE, op(id, "prepared", { receiptVersion: 1, sendGeneration: GEN }), id);
    const mark = await set(SCOPE, op(id, "confirming"), id);
    for (const v of [undefined, 1, 2, 9])
      expect(
        await refused(op(id, "prepared", v === undefined ? {} : { receiptVersion: v })),
      ).toEqual({ ok: false, reason: "stale" });
    // A second mark over the mark is not a step either.
    expect(await refused(op(id, "confirming"))).toEqual({ ok: false, reason: "stale" });
    // Only the exact captured mark rolls back, by one of the two named reasons; the version and generation stay.
    expect(
      await S().rollbackInboxInstagramSendConfirm(
        SCOPE,
        { ...mark, commitId: "other" },
        "beforeRequest",
      ),
    ).toEqual({ ok: false, reason: "stale", current: mark });
    const back = await S().rollbackInboxInstagramSendConfirm(SCOPE, mark, "preClaimRefusal");
    expect(back).toMatchObject({
      ok: true,
      op: { operationId: id, state: "prepared", receiptVersion: 1, sendGeneration: GEN },
    });
    if (!back.ok) throw new Error("rollback");
    expect(back.current).toEqual(back.op);
    expect(stored().inboxInstagramSendOps[SCOPE]).toEqual(back.op);
    // The rollback of a mark already rolled back (or of a non-mark) is stale.
    expect(await S().rollbackInboxInstagramSendConfirm(SCOPE, mark, "beforeRequest")).toEqual({
      ok: false,
      reason: "stale",
      current: back.op,
    });
    // Later proof over the mark still lands (real cancellation, claim, outcome), and prepared never comes back.
    for (const later of [
      op(id, "cancelled", { receiptVersion: 2 }),
      op(id, "expired", { receiptVersion: 2 }),
      op(id, "dispatching", { receiptVersion: 2 }),
      op(id, "already_claimed", { receiptVersion: 2 }),
    ]) {
      await S().reset();
      await set(SCOPE, op(id), null);
      await set(SCOPE, op(id, "prepared", { receiptVersion: 1, sendGeneration: GEN }), id);
      const m = await set(SCOPE, op(id, "confirming"), id);
      const h = await set(SCOPE, later, id);
      expect(h.state).toBe(later.state);
      expect(await refused(op(id, "prepared", { receiptVersion: 3 }))).toMatchObject({ ok: false });
      expect(await S().rollbackInboxInstagramSendConfirm(SCOPE, m, "beforeRequest")).toEqual({
        ok: false,
        reason: "stale",
        current: h,
      });
    }
    // Nothing stored: nothing to roll back.
    await S().reset();
    expect(await S().rollbackInboxInstagramSendConfirm(SCOPE, mark, "beforeRequest")).toEqual({
      ok: false,
      reason: "stale",
      current: null,
    });
  });

  it("a rollback answers with the handle stored after its commit, including a later writer's", async () => {
    const id = "op-ig-aaaaaa";
    await set(SCOPE, op(id), null);
    await set(SCOPE, op(id, "prepared", { receiptVersion: 1, sendGeneration: GEN }), id);
    const mark = await set(SCOPE, op(id, "confirming"), id);
    let injected = false;
    let tail: Promise<unknown> = Promise.resolve();
    const queue: ArticlesLock = (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
    setArticlesLock(async (fn) => {
      const r = await fn();
      if (!injected) {
        injected = true;
        setArticlesLock(queue);
        await set(SCOPE, op(id, "sent", { receiptVersion: 3, providerReplyId: "1795" }), id);
      }
      return r;
    });
    const raced = await S().rollbackInboxInstagramSendConfirm(SCOPE, mark, "preClaimRefusal");
    expect(injected).toBe(true);
    expect(raced).toMatchObject({
      ok: true,
      op: { state: "prepared" },
      current: { state: "sent", receiptVersion: 3 },
    });
  });
});

// 💬 DT-6B-2C-5A (planning/tools/37-inbox-send.md): the persisted handle of a reviewed Instagram DM, its own slice keyed
// `origin|account|conversation|inbound message` (one handle per inbound event, so a later turn never replaces an
// unresolved answer to an earlier one). Compare-and-swap on the operation id the caller saw, then on the Worker's integer
// receiptVersion and the DM state order (a DM `unknown` is a final settlement); identity (Worker origin, account,
// conversation, recipient, inbound message, revision, digest), the learned inbound time and DM send generation and a
// known message id never change; the pending-settlement observation lives only beside `dispatching`; `current` is read
// back after the commit. Capped at 50 (settled ones go first), no text, never in the media kit or the articles export,
// old backups default to an empty slice.
describe("inbox Instagram DM send operations (packet DT-6B-2C-5A)", () => {
  const T0 = at("2026-10-17T12:00:00Z");
  const W = "https://scout.test";
  const ME = "17841000000000001";
  const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
  const IN1 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE=";
  const PERSON = "990000000000001";
  const KEY = [W, ME, CONV, IN1].map(encodeURIComponent).join("|");
  const DIGEST = "b".repeat(64);
  const GEN = "e".repeat(32);
  const AT = "2026-10-17T11:55:00.000Z";
  const MID = "aWdfZAG1faXRlbToxOk1lc3NhZA2U=";
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  type Op = Omit<InboxInstagramDmSendOp, "updatedAt" | "commitId">;
  type State = InboxInstagramDmSendOp["state"];
  const op = (
    operationId = "op-dm-aaaaaa",
    state: State = "preparing",
    over: Partial<Op> = {},
  ): Op => ({
    operationId,
    workerOrigin: W,
    account: ME,
    conversationId: CONV,
    recipientId: PERSON,
    inboundMessageId: IN1,
    draftRevision: "rev-1",
    digest: DIGEST,
    state,
    ...over,
  });
  /** A Worker receipt of `state` at `v` (the learned generation and inbound time included). */
  const receipt = (id: string, state: State, v: number, over: Partial<Op> = {}) =>
    op(id, state, { receiptVersion: v, sendGeneration: GEN, inboundAt: AT, ...over });
  const set = async (key: string, o: Op, expected: string | null, now = T0) => {
    const r = await S().setInboxInstagramDmSendOp(key, o, expected, now);
    if (!r.ok) throw new Error(r.reason);
    return r.op!;
  };
  const refused = (o: Op, expected: string | null = o.operationId, key = KEY) =>
    S().setInboxInstagramDmSendOp(key, o, expected, T0);
  const inb = (i: number | string) => `aWdfZAG1faXRlbToxOk${i}`;
  const keyOf = (i: number | string) => [W, ME, CONV, inb(i)].map(encodeURIComponent).join("|");
  const opAt = (i: number | string, id: string, state: State, over: Partial<Op> = {}) =>
    op(id, state, { inboundMessageId: inb(i), ...over });
  const queue = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };

  beforeEach(() => {
    setArticlesLock(queue());
  });
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("imports an old backup without the slice, and round-trips a handle through export and merge", async () => {
    await S().importState(
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-09-01",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
          inboxInstagramSendOps: {},
        },
      }),
    );
    expect(S().inboxInstagramDmSendOps).toEqual({});
    S().reset();
    const h = await set(KEY, op(), null);
    expect(h).toMatchObject({ ...op(), updatedAt: T0.toISOString() });
    expect(stored().inboxInstagramDmSendOps[KEY].commitId).toBe(h.commitId);
    const json = S().exportState();
    S().reset();
    await S().importState(json);
    expect(S().inboxInstagramDmSendOps[KEY]).toEqual(h);
    // Another tab's write reaches this one through the existing merge (rehydrate).
    const disk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    disk.state.inboxInstagramDmSendOps = {
      [keyOf(9)]: { ...h, operationId: "op-dm-other1", inboundMessageId: inb(9) },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(disk));
    await useStore.persist.rehydrate();
    expect(Object.keys(S().inboxInstagramDmSendOps)).toEqual([keyOf(9)]);
    // The public Instagram, Threads and YouTube slices are different ones and stay untouched.
    expect(S().inboxInstagramSendOps).toEqual({});
    expect(S().inboxThreadsSendOps).toEqual({});
    expect(S().inboxSendOps).toEqual({});
  });

  it("a private backup keeps a validated pending handle; one with text or a misplaced observation is refused whole", async () => {
    const h = {
      ...op("op-dm-aaaaaa", "dispatching", { receiptVersion: 2 }),
      updatedAt: T0.toISOString(),
      commitId: "c-1",
    };
    const file = (ops: unknown) =>
      JSON.stringify({
        app: "3z-prod",
        version: 1,
        exportedAt: "2026-10-17",
        state: {
          settings: DEFAULT_SETTINGS,
          completions: [],
          xpEvents: [],
          microActions: [],
          freezesUsedOn: [],
          reviews: [],
          inboxInstagramDmSendOps: ops,
        },
      });
    await S().reset();
    await S().importState(
      file({ [KEY]: { ...h, pending: { observed: "rejected", code: "meta_10" } } }),
    );
    expect(S().inboxInstagramDmSendOps[KEY]?.pending).toEqual({
      observed: "rejected",
      code: "meta_10",
    });
    for (const bad of [
      { ...h, text: "my DM" },
      { ...h, state: "sent", pending: { observed: "unknown", code: "receipt" } },
      { ...h, pending: { observed: "sent", code: "x" } },
    ]) {
      await S().reset();
      expect(() => S().importState(file({ [KEY]: bad }))).toThrow();
      expect(S().inboxInstagramDmSendOps).toEqual({});
    }
  });

  it("updates only the operation the caller expects; canonical convergence moves the handle", async () => {
    await set(KEY, op(), null);
    expect(await refused(op("op-dm-bbbbbb"), null)).toEqual({ ok: false, reason: "conflict" });
    const moved = await set(KEY, receipt("op-dm-bbbbbb", "prepared", 1), "op-dm-aaaaaa");
    expect(moved).toMatchObject({
      operationId: "op-dm-bbbbbb",
      sendGeneration: GEN,
      inboundAt: AT,
    });
    expect(await refused(op("op-dm-aaaaaa"), "op-dm-aaaaaa")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().clearInboxInstagramDmSendOp(KEY, "op-dm-aaaaaa")).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(await S().clearInboxInstagramDmSendOp(KEY, "op-dm-bbbbbb")).toEqual({
      ok: true,
      op: null,
    });
    expect(S().inboxInstagramDmSendOps[KEY]).toBeUndefined();
    expect(stored().inboxInstagramDmSendOps[KEY]).toBeUndefined();
  });

  it("refuses malformed handles: no text, DM ids only, integer versions, its own exact key, pending beside dispatching only", async () => {
    const cases: [Op, string][] = [
      [op("op-dm-aaaaaa", "preparing", { digest: "nothex" }), KEY],
      [op("x"), KEY],
      [op("op-dm-aaaaaa", "published" as never), KEY],
      [op("op-dm-aaaaaa", "preparing", { account: "a=b" }), KEY],
      [op("op-dm-aaaaaa", "preparing", { recipientId: "a/b" }), KEY],
      [op("op-dm-aaaaaa", "preparing", { workerOrigin: "scout.test" }), KEY],
      [op("op-dm-aaaaaa", "prepared", { receiptVersion: 1.5 }), KEY],
      [
        op("op-dm-aaaaaa", "prepared", { receiptVersion: 1, inboundAt: "2026-10-17T11:55:00Z" }),
        KEY,
      ],
      [op("op-dm-aaaaaa", "sent", { receiptVersion: 3, providerMessageId: "has space" }), KEY],
      [op("op-dm-aaaaaa", "prepared", { receiptVersion: 1, sendGeneration: "zz" }), KEY],
      [
        op("op-dm-aaaaaa", "sent", {
          receiptVersion: 3,
          pending: { observed: "unknown", code: "receipt" },
        }),
        KEY,
      ],
      [
        op("op-dm-aaaaaa", "dispatching", {
          receiptVersion: 2,
          pending: { observed: "rejected", code: "Meta 10" },
        }),
        KEY,
      ],
      [{ ...op(), text: "my DM" } as Op, KEY],
      // The key is exactly origin | account | conversation | inbound message of the handle itself.
      [op(), [W, ME, CONV, "other"].map(encodeURIComponent).join("|")],
      [op(), `instagram|${KEY}`],
    ];
    for (const [bad, key] of cases)
      expect(await refused(bad, null, key), JSON.stringify(bad)).toEqual({
        ok: false,
        reason: "invalid",
      });
    expect(S().inboxInstagramDmSendOps).toEqual({});
    // Base64-style ids with `=` are DM ids.
    expect((await set(KEY, op(), null)).conversationId).toBe(CONV);
  });

  it("versions and the DM state order: older is stale, equal-but-different contradicts, unknown is final", async () => {
    const id = "op-dm-aaaaaa";
    await set(KEY, op(id), null);
    await set(KEY, receipt(id, "prepared", 1), id);
    // The local pending-confirm mark keeps the Worker's version; no prepared write undoes it.
    const mark = await set(KEY, op(id, "confirming"), id);
    expect(mark).toMatchObject({ receiptVersion: 1, sendGeneration: GEN, inboundAt: AT });
    for (const v of [undefined, 1, 2, 9])
      expect(
        await refused(op(id, "prepared", v === undefined ? {} : { receiptVersion: v })),
      ).toEqual({ ok: false, reason: "stale" });
    expect(await refused(op(id, "dispatching", { receiptVersion: 1 }))).toEqual({
      ok: false,
      reason: "stale",
    });
    // The lost settlement: dispatching at the claim's version with what was observed.
    const d = await set(
      KEY,
      op(id, "dispatching", {
        receiptVersion: 2,
        pending: { observed: "rejected", code: "meta_10" },
      }),
      id,
    );
    expect(d).toMatchObject({
      state: "dispatching",
      receiptVersion: 2,
      sendGeneration: GEN,
      inboundAt: AT,
    });
    // A later read of the same claim keeps the observation (it is still only uncertainty).
    const again = await set(KEY, op(id, "dispatching", { receiptVersion: 2 }), id);
    expect(again.pending).toEqual({ observed: "rejected", code: "meta_10" });
    for (const late of [
      op(id, "prepared", { receiptVersion: 3 }),
      op(id, "cancelled", { receiptVersion: 3 }),
      op(id, "expired", { receiptVersion: 3 }),
      op(id, "already_claimed", { receiptVersion: 3 }),
      op(id, "confirming"),
      op(id, "preparing"),
    ])
      expect(await refused(late)).not.toMatchObject({ ok: true });
    // Identity facts learned from Prepare never change.
    for (const over of [
      { sendGeneration: "f".repeat(32) },
      { inboundAt: "2026-10-17T11:00:00.000Z" },
    ])
      expect(await refused(op(id, "dispatching", { receiptVersion: 2, ...over }))).toEqual({
        ok: false,
        reason: "invalid",
      });
    // A durable unknown is final (its settlement is recorded); the observation goes with dispatching.
    const u = await set(KEY, op(id, "unknown", { receiptVersion: 3 }), id);
    expect(u.pending).toBeUndefined();
    for (const late of [
      op(id, "sent", { receiptVersion: 4, providerMessageId: MID }),
      op(id, "rejected", { receiptVersion: 4 }),
      op(id, "dispatching", { receiptVersion: 4 }),
    ])
      expect(await refused(late)).toEqual({ ok: false, reason: "stale" });
    expect(stored().inboxInstagramDmSendOps[KEY]).toMatchObject({
      state: "unknown",
      receiptVersion: 3,
    });
  });

  it("sent is final and its message id never changes", async () => {
    const id = "op-dm-aaaaaa";
    await set(KEY, op(id), null);
    await set(KEY, receipt(id, "prepared", 1), id);
    await set(
      KEY,
      op(id, "dispatching", {
        receiptVersion: 2,
        pending: { observed: "unknown", code: "receipt" },
      }),
      id,
    );
    const sent = await set(KEY, op(id, "sent", { receiptVersion: 3, providerMessageId: MID }), id);
    expect(sent).toMatchObject({ state: "sent", providerMessageId: MID });
    expect(sent.pending).toBeUndefined();
    for (const late of [
      op(id, "rejected", { receiptVersion: 4 }),
      op(id, "unknown", { receiptVersion: 4 }),
      op(id, "sent", { receiptVersion: 3, providerMessageId: "other-mid" }),
      op(id, "sent", { receiptVersion: 5, providerMessageId: "other-mid" }),
    ])
      expect(await refused(late)).toEqual({ ok: false, reason: "stale" });
  });

  it("identity never changes for the operation: origin, account, conversation, recipient, inbound message, revision, digest", async () => {
    const id = "op-dm-aaaaaa";
    await set(KEY, op(id), null);
    await set(KEY, receipt(id, "prepared", 1), id);
    for (const over of [
      { workerOrigin: "https://other.test" },
      { account: "17841000000000002" },
      { conversationId: "aWdfZAG06OTk5" },
      { recipientId: "990000000000002" },
      { inboundMessageId: inb(9) },
      { draftRevision: "rev-2" },
      { digest: "c".repeat(64) },
    ])
      expect(await refused(receipt(id, "prepared", 1, over))).toEqual({
        ok: false,
        reason: "invalid",
      });
    expect(stored().inboxInstagramDmSendOps[KEY]).toMatchObject(op(id, "prepared"));
  });

  it("keeps at most 50 handles, dropping settled ones before any unresolved one (unknown and dispatching kept)", async () => {
    await set(
      keyOf("u"),
      opAt("u", "op-dm-unknown1", "unknown", { receiptVersion: 3 }),
      null,
      at("2026-10-01T00:00:00Z"),
    );
    await set(
      keyOf("p"),
      opAt("p", "op-dm-pending1", "dispatching", {
        receiptVersion: 2,
        pending: { observed: "unknown", code: "receipt" },
      }),
      null,
      at("2026-10-01T00:00:01Z"),
    );
    await set(
      keyOf("c"),
      opAt("c", "op-dm-claimed1", "already_claimed", { receiptVersion: 2 }),
      null,
      at("2026-10-02T00:00:00Z"),
    );
    for (let i = 0; i < 48; i++)
      await set(
        keyOf(i),
        opAt(i, `op-dm-sent-${String(i).padStart(4, "0")}`, "sent", {
          receiptVersion: 3,
          providerMessageId: MID,
        }),
        null,
        new Date(T0.getTime() + i * 1000),
      );
    const keys = Object.keys(S().inboxInstagramDmSendOps);
    expect(keys).toHaveLength(50);
    expect(keys).toContain(keyOf("u"));
    expect(keys).toContain(keyOf("p"));
    expect(keys).not.toContain(keyOf("c"));
    expect(Object.keys(stored().inboxInstagramDmSendOps)).toHaveLength(50);
  });

  it("refuses a new handle with capacity when 50 unresolved ones are kept; updates still work; reload keeps them", async () => {
    const unresolved = ["preparing", "confirming", "prepared", "dispatching", "unknown"] as const;
    for (let i = 0; i < 50; i++) {
      const s = unresolved[i % 5];
      await set(
        keyOf(i),
        opAt(i, `op-dm-unres-${String(i).padStart(4, "0")}`, s, {
          ...(s === "preparing" || s === "confirming" ? {} : { receiptVersion: 2 }),
        }),
        null,
      );
    }
    expect(await refused(opAt("new", "op-dm-new-0001", "preparing"), null, keyOf("new"))).toEqual({
      ok: false,
      reason: "capacity",
    });
    await useStore.persist.rehydrate();
    expect(Object.keys(S().inboxInstagramDmSendOps)).toHaveLength(50);
    // One settled handle frees exactly one place.
    await set(
      keyOf(3),
      opAt(3, "op-dm-unres-0003", "sent", { receiptVersion: 4, providerMessageId: MID }),
      "op-dm-unres-0003",
    );
    const fresh = await set(keyOf("new"), opAt("new", "op-dm-new-0001", "preparing"), null);
    expect(fresh.operationId).toBe("op-dm-new-0001");
    expect(S().inboxInstagramDmSendOps[keyOf(3)]).toBeUndefined();
    expect(Object.keys(stored().inboxInstagramDmSendOps)).toHaveLength(50);
  });

  it("a write the browser did not keep is not-persisted and memory rolls back", async () => {
    const h = await set(KEY, op(), null);
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(await refused(receipt("op-dm-aaaaaa", "prepared", 1))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(S().inboxInstagramDmSendOps[KEY]).toEqual(h);
  });

  it("a write answers with the handle stored after its commit, including a later writer's", async () => {
    const id = "op-dm-aaaaaa";
    await set(KEY, op(id), null);
    let injected = false;
    const q = queue();
    setArticlesLock(async (fn) => {
      const r = await fn();
      if (!injected) {
        injected = true;
        setArticlesLock(q);
        await set(KEY, receipt(id, "dispatching", 2), id);
      }
      return r;
    });
    const raced = await S().setInboxInstagramDmSendOp(KEY, receipt(id, "prepared", 1), id, T0);
    expect(injected).toBe(true);
    expect(raced).toMatchObject({
      ok: true,
      op: { state: "prepared" },
      current: { state: "dispatching", receiptVersion: 2 },
    });
  });

  it("holds no DM text, and never reaches the media kit or the articles export (privacy canary)", async () => {
    const draft = [W, ME, "conversation", CONV].map(encodeURIComponent).join("|");
    await S().saveInboxDraft(draft, "CANARY-ig-dm-9c2f", inboxDraftBase(null), T0);
    await set(KEY, op("op-dm-canary-77"), null);
    await set(
      KEY,
      receipt("op-dm-canary-77", "sent", 3, { providerMessageId: "mid-canary-77" }),
      "op-dm-canary-77",
    );
    expect(JSON.stringify(S().inboxInstagramDmSendOps)).not.toContain("CANARY-ig-dm-9c2f");
    expect(JSON.stringify(stored().inboxInstagramDmSendOps)).not.toContain("CANARY-ig-dm-9c2f");
    for (const out of [
      JSON.stringify(kitProjection(S(), T0)),
      JSON.stringify(articlesExport(S().articles, T0)),
    ]) {
      expect(out).not.toContain("op-dm-canary-77");
      expect(out).not.toContain("mid-canary-77");
      expect(out).not.toContain(PERSON);
      expect(out).not.toContain(DIGEST);
      expect(out).not.toContain("CANARY-ig-dm-9c2f");
    }
  });

  it("conditional clear deletes an unchanged preparing record and keeps any newer proof of the operation", async () => {
    const id = "op-dm-aaaaaa";
    const prep = await set(KEY, op(id), null);
    const expectOf = (h: InboxInstagramDmSendOp) => ({
      operationId: h.operationId,
      state: "preparing" as const,
      receiptVersion: h.receiptVersion,
      commitId: h.commitId,
    });
    expect(await S().clearInboxInstagramDmSendOpIf(keyOf("none"), expectOf(prep))).toMatchObject({
      ok: true,
      op: null,
    });
    for (const newer of [
      receipt(id, "prepared", 1),
      op(id, "dispatching", {
        receiptVersion: 2,
        pending: { observed: "unknown", code: "receipt" },
      }),
      receipt(id, "sent", 3, { providerMessageId: MID }),
    ]) {
      await S().reset();
      const p = await set(KEY, op(id), null);
      const h = await set(KEY, newer, id);
      expect(await S().clearInboxInstagramDmSendOpIf(KEY, expectOf(p))).toEqual({
        ok: false,
        reason: "stale",
        current: h,
      });
      expect(stored().inboxInstagramDmSendOps[KEY]).toEqual(h);
    }
    await S().reset();
    const other = await set(KEY, op("op-dm-bbbbbb"), null);
    expect(await S().clearInboxInstagramDmSendOpIf(KEY, expectOf(prep))).toEqual({
      ok: false,
      reason: "stale",
      current: other,
    });
    expect(
      await S().clearInboxInstagramDmSendOpIf(KEY, { ...expectOf(other), commitId: "older" }),
    ).toMatchObject({ ok: false, reason: "stale" });
    expect(await S().clearInboxInstagramDmSendOpIf(KEY, expectOf(other))).toMatchObject({
      ok: true,
      op: null,
    });
    expect(stored().inboxInstagramDmSendOps[KEY]).toBeUndefined();
  });

  it("only the named rollback of that exact pending-confirm mark goes back to prepared; read back after its commit", async () => {
    const id = "op-dm-aaaaaa";
    await set(KEY, op(id), null);
    await set(KEY, receipt(id, "prepared", 1), id);
    const mark = await set(KEY, op(id, "confirming"), id);
    expect(await refused(op(id, "confirming"))).toEqual({ ok: false, reason: "stale" });
    expect(
      await S().rollbackInboxInstagramDmSendConfirm(
        KEY,
        { ...mark, commitId: "other" },
        "beforeRequest",
      ),
    ).toEqual({ ok: false, reason: "stale", current: mark });
    const back = await S().rollbackInboxInstagramDmSendConfirm(KEY, mark, "preClaimRefusal");
    expect(back).toMatchObject({
      ok: true,
      op: {
        operationId: id,
        state: "prepared",
        receiptVersion: 1,
        sendGeneration: GEN,
        inboundAt: AT,
      },
    });
    if (!back.ok) throw new Error("rollback");
    expect(back.current).toEqual(back.op);
    expect(await S().rollbackInboxInstagramDmSendConfirm(KEY, mark, "beforeRequest")).toEqual({
      ok: false,
      reason: "stale",
      current: back.op,
    });
    // Later proof over the mark still lands, and its rollback is refused.
    for (const later of [
      op(id, "cancelled", { receiptVersion: 2 }),
      op(id, "expired", { receiptVersion: 2 }),
      op(id, "dispatching", {
        receiptVersion: 2,
        pending: { observed: "unknown", code: "receipt" },
      }),
      op(id, "already_claimed", { receiptVersion: 2 }),
    ]) {
      await S().reset();
      await set(KEY, op(id), null);
      await set(KEY, receipt(id, "prepared", 1), id);
      const m = await set(KEY, op(id, "confirming"), id);
      const h = await set(KEY, later, id);
      expect(await S().rollbackInboxInstagramDmSendConfirm(KEY, m, "beforeRequest")).toEqual({
        ok: false,
        reason: "stale",
        current: h,
      });
    }
    // A rollback raced by a later writer answers the record stored after its commit.
    await S().reset();
    await set(KEY, op(id), null);
    await set(KEY, receipt(id, "prepared", 1), id);
    const m2 = await set(KEY, op(id, "confirming"), id);
    let injected = false;
    const q = queue();
    setArticlesLock(async (fn) => {
      const r = await fn();
      if (!injected) {
        injected = true;
        setArticlesLock(q);
        await set(KEY, op(id, "sent", { receiptVersion: 3, providerMessageId: MID }), id);
      }
      return r;
    });
    expect(await S().rollbackInboxInstagramDmSendConfirm(KEY, m2, "preClaimRefusal")).toMatchObject(
      {
        ok: true,
        op: { state: "prepared" },
        current: { state: "sent", receiptVersion: 3 },
      },
    );
  });
});

// 🛟 DT-6B-2C-5B (planning/tools/37-inbox-send.md): the persisted verified control handle of one Instagram conversation,
// its own slice keyed `origin|account|conversation` (never the DM send slice). Compare-and-swap on the commit the caller
// read, `current` read back after the commit; a verified handle and its recipient never change or disappear; the
// revision never goes back and one revision has one mode; the pending action is persisted before a request; capped at
// 50 (idle entries go first, pending/uncertain ones never, explicit `capacity`); validated private backup/import that
// merges without overwriting newer proof or discarding pending/uncertain work; never in the media kit or the articles
// export.
describe("inbox Instagram DM conversation controls (packet DT-6B-2C-5B)", () => {
  const T0 = at("2026-10-17T12:00:00Z");
  const W = "https://scout.test";
  const OLD = "https://old.test";
  const ME = "17841000000000001";
  const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
  const PERSON = "990000000000001";
  const H = "a".repeat(32);
  const GEN = "e".repeat(32);
  const EVI = "f".repeat(64);
  const keyOf = (conv = CONV, origin = W) => [origin, ME, conv].map(encodeURIComponent).join("|");
  const KEY = keyOf();
  const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  type Entry = Omit<InboxInstagramDmControl, "updatedAt" | "commitId">;
  const verified = (over: Partial<Entry> = {}): Entry => ({
    workerOrigin: W,
    account: ME,
    conversationId: CONV,
    handleId: H,
    recipientId: PERSON,
    registeredGeneration: GEN,
    evidenceDigest: EVI,
    mode: "auto",
    revision: 0,
    inFlightTotal: 0,
    inFlightTruncated: false,
    uncertainTotal: 0,
    ...over,
  });
  const queue = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };
  const put = async (e: Entry | null, expected: string | null, key = KEY, now = T0) => {
    const r = await S().setInboxInstagramDmControl(key, e, expected, now);
    if (!r.ok) throw new Error(r.reason);
    return r;
  };
  const file = (controls: unknown) =>
    JSON.stringify({
      app: "3z-prod",
      version: 1,
      exportedAt: "2026-10-17",
      state: {
        settings: DEFAULT_SETTINGS,
        completions: [],
        xpEvents: [],
        microActions: [],
        freezesUsedOn: [],
        reviews: [],
        inboxInstagramDmControls: controls,
      },
    });

  beforeEach(() => {
    setArticlesLock(queue());
  });
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("imports an old backup without the slice; a verified handle round-trips through export and import", async () => {
    await S().importState(file(undefined));
    expect(S().inboxInstagramDmControls).toEqual({});
    const { entry } = await put(verified(), null);
    expect(entry).toMatchObject({ ...verified(), updatedAt: T0.toISOString() });
    expect(stored().inboxInstagramDmControls[KEY].commitId).toBe(entry!.commitId);
    const json = S().exportState();
    S().reset();
    await S().importState(json);
    expect(S().inboxInstagramDmControls[KEY]).toEqual(entry);
    // The DM send slice is a different one and stays untouched.
    expect(S().inboxInstagramDmSendOps).toEqual({});
  });

  it("compare-and-swap on the commit the caller read; `current` is what is durable after the commit", async () => {
    const a = (await put(verified(), null)).entry!;
    expect(await S().setInboxInstagramDmControl(KEY, verified(), null, T0)).toMatchObject({
      ok: false,
      reason: "conflict",
      current: { commitId: a.commitId },
    });
    const b = await put(verified({ mode: "human", revision: 1 }), a.commitId);
    expect(b.current).toEqual(b.entry);
    expect(await S().setInboxInstagramDmControl(KEY, verified(), a.commitId, T0)).toMatchObject({
      ok: false,
      reason: "conflict",
    });
  });

  it("a verified handle and recipient never change or disappear; the revision never goes back; one revision has one mode", async () => {
    const a = (await put(verified({ revision: 3 }), null)).entry!;
    const cases: [Entry | null, string][] = [
      [verified({ revision: 3, handleId: "b".repeat(32) }), "invalid"],
      [verified({ revision: 3, recipientId: "990000000000002" }), "invalid"],
      [
        {
          workerOrigin: W,
          account: ME,
          conversationId: CONV,
        },
        "invalid",
      ],
      [null, "invalid"],
      [verified({ revision: 2 }), "stale"],
      [verified({ revision: 3, mode: "human" }), "invalid"],
    ];
    for (const [e, reason] of cases)
      expect(
        await S().setInboxInstagramDmControl(KEY, e, a.commitId, T0),
        JSON.stringify(e),
      ).toMatchObject({
        ok: false,
        reason,
      });
    // Same handle: an explicit re-registration may refresh the registration proof.
    const r = await put(
      verified({
        revision: 3,
        registeredGeneration: "d".repeat(32),
        evidenceDigest: "c".repeat(64),
      }),
      a.commitId,
    );
    expect(r.entry).toMatchObject({ registeredGeneration: "d".repeat(32), revision: 3 });
    expect(S().inboxInstagramDmControls[KEY]).toMatchObject({ handleId: H, revision: 3 });
  });

  it("refuses malformed entries: its own exact key, complete proof, consistent pending, no message text", async () => {
    const bad: [Entry, string][] = [
      [verified(), keyOf("other")],
      [verified({ workerOrigin: OLD }), KEY],
      [verified({ handleId: "A".repeat(32) }), KEY],
      [verified({ registeredGeneration: undefined }), KEY],
      [verified({ revision: -1 }), KEY],
      [verified({ revision: 1.5 }), KEY],
      [verified({ mode: undefined }), KEY],
      [verified({ uncertainTotal: undefined }), KEY],
      [
        verified({
          pending: {
            action: "takeover",
            expectedRevision: 0,
            requestedMode: "auto",
            at: T0.toISOString(),
          },
        }),
        KEY,
      ],
      [
        verified({ pending: { action: "resume", requestedMode: "auto", at: T0.toISOString() } }),
        KEY,
      ],
      [
        verified({ pending: { action: "register", expectedRevision: 0, at: T0.toISOString() } }),
        KEY,
      ],
      [{ workerOrigin: W, account: ME, conversationId: CONV, uncertain: "mutation" }, KEY],
      [{ ...verified(), text: "hello" } as Entry, KEY],
      [verified({ account: "a=b" }), [W, "a=b", CONV].map(encodeURIComponent).join("|")],
    ];
    for (const [e, key] of bad)
      expect(await S().setInboxInstagramDmControl(key, e, null, T0), JSON.stringify(e)).toEqual({
        ok: false,
        reason: "invalid",
      });
    expect(S().inboxInstagramDmControls).toEqual({});
    // A registration in progress has no handle yet; it may be let go while it has none.
    const reg = (
      await put(
        {
          workerOrigin: W,
          account: ME,
          conversationId: CONV,
          pending: { action: "register", at: T0.toISOString() },
        },
        null,
      )
    ).entry!;
    expect(reg.handleId).toBeUndefined();
    await put(null, reg.commitId);
    expect(S().inboxInstagramDmControls[KEY]).toBeUndefined();
    expect(stored().inboxInstagramDmControls[KEY]).toBeUndefined();
  });

  it("a write the browser did not keep is not-persisted and memory stays as it was", async () => {
    const a = (await put(verified(), null)).entry!;
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(
      await S().setInboxInstagramDmControl(
        KEY,
        verified({
          pending: {
            action: "takeover",
            expectedRevision: 0,
            requestedMode: "human",
            at: T0.toISOString(),
          },
        }),
        a.commitId,
        T0,
      ),
    ).toEqual({ ok: false, reason: "not-persisted" });
    expect(S().inboxInstagramDmControls[KEY]).toEqual(a);
  });

  it("capacity 50: idle entries go first, pending and uncertain ones never; with no room it refuses explicitly", async () => {
    const pending = {
      action: "takeover" as const,
      expectedRevision: 0,
      requestedMode: "human" as const,
      at: T0.toISOString(),
    };
    for (let i = 0; i < 50; i++)
      await put(
        verified({
          conversationId: `c${i}`,
          handleId: i.toString(16).padStart(32, "0"),
          ...(i < 48 ? { pending } : {}),
        }),
        null,
        keyOf(`c${i}`),
        new Date(T0.getTime() + i * 1000),
      );
    // Two idle entries can make room; the older one goes first.
    await put(
      verified({ conversationId: "n1", pending }),
      null,
      keyOf("n1"),
      new Date(T0.getTime() + 99_000),
    );
    expect(S().inboxInstagramDmControls[keyOf("c48")]).toBeUndefined();
    expect(S().inboxInstagramDmControls[keyOf("c49")]).toBeDefined();
    await put(
      verified({ conversationId: "n2", uncertain: "mutation", pending }),
      null,
      keyOf("n2"),
      new Date(T0.getTime() + 100_000),
    );
    // Now the last idle one went; only pending/uncertain work remains.
    expect(S().inboxInstagramDmControls[keyOf("c49")]).toBeUndefined();
    expect(S().inboxInstagramDmControls[keyOf("n1")]?.pending).toEqual(pending);
    expect(Object.keys(S().inboxInstagramDmControls)).toHaveLength(50);
    expect(
      await S().setInboxInstagramDmControl(
        keyOf("n3"),
        verified({ conversationId: "n3" }),
        null,
        T0,
      ),
    ).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(Object.keys(stored().inboxInstagramDmControls)).toHaveLength(50);
    for (let i = 0; i < 48; i++)
      expect(S().inboxInstagramDmControls[keyOf(`c${i}`)]?.pending).toEqual(pending);
  });

  it("a private backup keeps handles, pending proofs, origin bindings and unresolved recovery; malformed ones are refused whole", async () => {
    const pending = {
      action: "takeover",
      expectedRevision: 2,
      requestedMode: "human",
      at: T0.toISOString(),
    };
    const entries = {
      [KEY]: {
        ...verified({ revision: 2 }),
        pending,
        uncertain: "mutation",
        updatedAt: T0.toISOString(),
        commitId: "c-1",
      },
      [keyOf(CONV, OLD)]: {
        ...verified({ workerOrigin: OLD }),
        updatedAt: T0.toISOString(),
        commitId: "c-2",
      },
      [keyOf("lost")]: {
        workerOrigin: W,
        account: ME,
        conversationId: "lost",
        pending: { action: "register", at: T0.toISOString() },
        uncertain: "registration",
        updatedAt: T0.toISOString(),
        commitId: "c-3",
      },
    };
    await S().importState(file(entries));
    expect(S().inboxInstagramDmControls).toEqual(entries);
    // The imported origin stays that Worker's (never reinterpreted as the configured one).
    expect(S().inboxInstagramDmControls[keyOf(CONV, OLD)].workerOrigin).toBe(OLD);
    for (const bad of [
      { [KEY]: { ...entries[KEY], text: "hello" } },
      { [keyOf("other")]: entries[KEY] },
      { [KEY]: { ...entries[KEY], handleId: "nothex" } },
      { [KEY]: { ...entries[KEY], pending: { ...pending, requestedMode: "auto" } } },
    ]) {
      const before = S().inboxInstagramDmControls;
      expect(() => S().importState(file(bad))).toThrow();
      expect(S().inboxInstagramDmControls).toEqual(before);
    }
  });

  it("import merge: never overwrites newer proof, never discards pending or uncertain work, never swaps a handle", async () => {
    const pending = {
      action: "takeover" as const,
      expectedRevision: 4,
      requestedMode: "human" as const,
      at: T0.toISOString(),
    };
    await put(verified({ revision: 4, pending, uncertain: "mutation" }), null);
    await put(
      verified({ conversationId: "newer", revision: 7, mode: "human" }),
      null,
      keyOf("newer"),
    );
    await put(verified({ conversationId: "swap", handleId: "b".repeat(32) }), null, keyOf("swap"));
    const mine = S().inboxInstagramDmControls;
    const backup = {
      // Older proof without the pending action: the pending work here stays.
      [KEY]: { ...verified({ revision: 4 }), updatedAt: T0.toISOString(), commitId: "x-1" },
      // An older revision never overwrites a newer one.
      [keyOf("newer")]: {
        ...verified({ conversationId: "newer", revision: 5 }),
        updatedAt: T0.toISOString(),
        commitId: "x-2",
      },
      // Another handle for the same conversation is never swapped in.
      [keyOf("swap")]: {
        ...verified({ conversationId: "swap", revision: 9 }),
        updatedAt: T0.toISOString(),
        commitId: "x-3",
      },
      // Something only the backup knows is restored, its pending action included.
      [keyOf("only")]: {
        ...verified({ conversationId: "only", revision: 1, mode: "human" }),
        pending: {
          action: "resume",
          expectedRevision: 1,
          requestedMode: "auto",
          at: T0.toISOString(),
        },
        updatedAt: T0.toISOString(),
        commitId: "x-4",
      },
    };
    await S().importState(file(backup));
    const got = S().inboxInstagramDmControls;
    expect(got[KEY]).toEqual(mine[KEY]);
    expect(got[keyOf("newer")]).toEqual(mine[keyOf("newer")]);
    expect(got[keyOf("swap")]).toEqual(mine[keyOf("swap")]);
    expect(got[keyOf("only")]).toEqual(backup[keyOf("only")]);
    // Newer proof in the backup resolves an older pending action here (its revision moved past the expected one).
    await S().importState(
      file({
        [KEY]: {
          ...verified({ revision: 5, mode: "human" }),
          updatedAt: T0.toISOString(),
          commitId: "x-5",
        },
      }),
    );
    expect(S().inboxInstagramDmControls[KEY]).toMatchObject({ revision: 5, mode: "human" });
    expect(S().inboxInstagramDmControls[KEY].pending).toBeUndefined();
    expect(stored().inboxInstagramDmControls[KEY]).toMatchObject({ revision: 5 });
  });

  it("holds no message text and never reaches the media kit or the articles export (privacy canary)", async () => {
    const draft = [W, ME, "conversation", CONV].map(encodeURIComponent).join("|");
    await S().saveInboxDraft(draft, "CANARY-ig-control-3b8e", inboxDraftBase(null), T0);
    await put(verified({ handleId: "c".repeat(32) }), null);
    expect(JSON.stringify(S().inboxInstagramDmControls)).not.toContain("CANARY-ig-control-3b8e");
    for (const out of [
      JSON.stringify(kitProjection(S(), T0)),
      JSON.stringify(articlesExport(S().articles, T0)),
    ]) {
      expect(out).not.toContain("c".repeat(32));
      expect(out).not.toContain(EVI);
      expect(out).not.toContain(PERSON);
      expect(out).not.toContain("CANARY-ig-control-3b8e");
    }
  });
});

// 🛟 DT-6B-2C-5B-R1: a private restore keeps the immutable identity and the monotonic proof of each conversation
// control, refuses inconsistent pending blocks entry by entry (keeping this device's entry and reporting the key), and
// merges into what storage holds NOW under the same lock the control actions use, reading its write back before it
// reports success.
describe("DT-6B-2C-5B-R1 control restore invariants and durable merge", () => {
  const T0 = at("2026-10-17T12:00:00Z");
  const W = "https://scout.test";
  const ME = "17841000000000001";
  const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
  const PERSON = "990000000000001";
  const H = "a".repeat(32);
  const KEY = [W, ME, CONV].map(encodeURIComponent).join("|");
  const disk = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
  const entry = (over: Partial<InboxInstagramDmControl> = {}): InboxInstagramDmControl => ({
    workerOrigin: W,
    account: ME,
    conversationId: CONV,
    handleId: H,
    recipientId: PERSON,
    registeredGeneration: "e".repeat(32),
    evidenceDigest: "f".repeat(64),
    mode: "auto",
    revision: 0,
    inFlightTotal: 0,
    inFlightTruncated: false,
    uncertainTotal: 0,
    updatedAt: T0.toISOString(),
    commitId: "local",
    ...over,
  });
  const takeover = (expectedRevision: number) => ({
    action: "takeover" as const,
    expectedRevision,
    requestedMode: "human" as const,
    at: T0.toISOString(),
  });
  const file = (controls: unknown) =>
    JSON.stringify({
      app: "3z-prod",
      version: 1,
      exportedAt: "2026-10-17",
      state: {
        settings: DEFAULT_SETTINGS,
        completions: [],
        xpEvents: [],
        microActions: [],
        freezesUsedOn: [],
        reviews: [],
        ...(controls === undefined ? {} : { inboxInstagramDmControls: controls }),
      },
    });
  const queue = (): ArticlesLock => {
    let tail: Promise<unknown> = Promise.resolve();
    return (fn) => {
      const run = tail.then(fn);
      tail = run.catch(() => undefined);
      return run;
    };
  };
  /** Seeds this device's control slice (memory and storage) through a restore. */
  const local = async (e: InboxInstagramDmControl) => {
    expect(await S().importState(file({ [KEY]: e }))).toMatchObject({ ok: true });
    expect(S().inboxInstagramDmControls[KEY]).toEqual(e);
  };

  beforeEach(() => setArticlesLock(queue()));
  afterEach(() => {
    setArticlesLock(undefined);
    vi.restoreAllMocks();
  });

  it("5B-3: the same handle with another recipient is refused and reported; this device's entry stays", async () => {
    await local(entry());
    const r = await S().importState(
      file({
        [KEY]: entry({ recipientId: "990000000000002", revision: 1, mode: "human", commitId: "x" }),
      }),
    );
    expect(r).toEqual({ ok: true, rejected: [KEY] });
    expect(S().inboxInstagramDmControls[KEY]).toEqual(entry());
    expect(disk().inboxInstagramDmControls[KEY].recipientId).toBe(PERSON);
  });

  it("5B-3: another handle, or the same revision with another mode, is refused for the same conversation", async () => {
    await local(entry({ revision: 2 }));
    for (const bad of [
      entry({ handleId: "b".repeat(32), revision: 9, commitId: "x1" }),
      entry({ revision: 2, mode: "human", commitId: "x2" }),
    ]) {
      expect(await S().importState(file({ [KEY]: bad }))).toEqual({ ok: true, rejected: [KEY] });
      expect(S().inboxInstagramDmControls[KEY]).toEqual(entry({ revision: 2 }));
    }
  });

  it("5B-3: an inconsistent pending block is refused; newer stored proof is never regressed", async () => {
    await local(entry({ mode: "human", revision: 3 }));
    const r = await S().importState(
      file({ [KEY]: entry({ pending: takeover(5), uncertain: "mutation", commitId: "future" }) }),
    );
    expect(r).toEqual({ ok: true, rejected: [KEY] });
    expect(S().inboxInstagramDmControls[KEY]).toMatchObject({ mode: "human", revision: 3 });
    expect(S().inboxInstagramDmControls[KEY].pending).toBeUndefined();
    // Consistent but older pending work never regresses the stored revision either.
    const older = entry({
      revision: 1,
      pending: takeover(1),
      uncertain: "mutation",
      commitId: "older",
    });
    expect(await S().importState(file({ [KEY]: older }))).toEqual({ ok: true, rejected: [] });
    expect(S().inboxInstagramDmControls[KEY]).toMatchObject({ mode: "human", revision: 3 });
    expect(disk().inboxInstagramDmControls[KEY]).toMatchObject({ revision: 3 });
  });

  it("5B-3 control: a compatible higher revision restores; local open pending work stays; a backup without the slice keeps this device's", async () => {
    await local(entry());
    const newer = entry({ mode: "human", revision: 1, commitId: "higher" });
    expect(await S().importState(file({ [KEY]: newer }))).toEqual({ ok: true, rejected: [] });
    expect(S().inboxInstagramDmControls[KEY]).toEqual(newer);
    const open = entry({
      mode: "human",
      revision: 1,
      pending: { ...takeover(1), action: "resume", requestedMode: "auto" },
      uncertain: "mutation",
      commitId: "open",
    });
    await local(open);
    expect(await S().importState(file({ [KEY]: newer }))).toEqual({ ok: true, rejected: [] });
    expect(S().inboxInstagramDmControls[KEY]).toEqual(open);
    expect(await S().importState(file(undefined))).toEqual({ ok: true, rejected: [] });
    expect(S().inboxInstagramDmControls[KEY]).toEqual(open);
  });

  it("5B-4: another tab's pending action in storage survives a restore of an idle backup (this tab's memory was idle)", async () => {
    await local(entry());
    const durable = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    const other = entry({ pending: takeover(0), uncertain: "mutation", commitId: "other-tab" });
    durable.state.inboxInstagramDmControls[KEY] = other;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(durable));
    expect(S().inboxInstagramDmControls[KEY].pending).toBeUndefined();
    expect(await S().importState(file({ [KEY]: entry() }))).toEqual({ ok: true, rejected: [] });
    expect(disk().inboxInstagramDmControls[KEY]).toEqual(other);
    expect(S().inboxInstagramDmControls[KEY]).toEqual(other);
  });

  it("5B-4: the restore waits for the control lock and merges what storage holds once it has it", async () => {
    await local(entry());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = queue();
    setArticlesLock(async (fn) => {
      await gate;
      return q(fn);
    });
    const restoring = S().importState(file({ [KEY]: entry() }));
    // Another tab persists its pending action while the restore waits.
    const durable = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    const other = entry({ pending: takeover(0), commitId: "other-tab" });
    durable.state.inboxInstagramDmControls[KEY] = other;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(durable));
    release();
    expect(await restoring).toEqual({ ok: true, rejected: [] });
    expect(disk().inboxInstagramDmControls[KEY]).toEqual(other);
  });

  it("5B-4: a restore the browser did not keep says not-persisted; memory and storage keep the pending work", async () => {
    await local(entry({ pending: takeover(0), commitId: "pending" }));
    const before = disk().inboxInstagramDmControls;
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(await S().importState(file({ [KEY]: entry() }))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    vi.restoreAllMocks();
    expect(disk().inboxInstagramDmControls).toEqual(before);
    expect(S().inboxInstagramDmControls[KEY].pending).toEqual(takeover(0));
  });

  it("5B-4: an unreadable control slice in storage is never merged as empty: not-persisted", async () => {
    await local(entry({ pending: takeover(0), commitId: "pending" }));
    const durable = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    durable.state.inboxInstagramDmControls[KEY] = { broken: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(durable));
    expect(await S().importState(file({ [KEY]: entry() }))).toEqual({
      ok: false,
      reason: "not-persisted",
    });
    expect(disk().inboxInstagramDmControls[KEY]).toEqual({ broken: true });
  });

  it("5B-4 without Web Locks: the same fresh merge happens at once (no control action can persist without them)", async () => {
    setArticlesLock(null);
    const first = S().importState(file({ [KEY]: entry() }));
    // Applied before the promise settles (legacy synchronous callers keep working).
    expect(S().inboxInstagramDmControls[KEY]).toEqual(entry());
    expect(await first).toEqual({ ok: true, rejected: [] });
    const durable = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    const other = entry({ pending: takeover(0), commitId: "other-tab" });
    durable.state.inboxInstagramDmControls[KEY] = other;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(durable));
    expect(await S().importState(file({ [KEY]: entry() }))).toEqual({ ok: true, rejected: [] });
    expect(disk().inboxInstagramDmControls[KEY]).toEqual(other);
  });
});

describe("🗂 global inbox (seen marks and tab)", () => {
  const A = "2026-10-22T10:00:00.000Z";
  const B = "2026-10-22T11:00:00.000Z";

  it("starts with nothing seen and the All tab", () => {
    expect(S().inboxSeen).toEqual({});
    expect(S().inboxTab).toBe("all");
  });

  it("markInboxSeen keeps the later time", () => {
    S().markInboxSeen("instagram:conversation:c1", A);
    expect(S().inboxSeen).toEqual({ "instagram:conversation:c1": A });
    S().markInboxSeen("instagram:conversation:c1", B);
    expect(S().inboxSeen["instagram:conversation:c1"]).toBe(B);
    S().markInboxSeen("instagram:conversation:c1", A); // an older open never lowers the mark
    expect(S().inboxSeen["instagram:conversation:c1"]).toBe(B);
    S().markInboxSeen("instagram:post:m9", A);
    expect(Object.keys(S().inboxSeen)).toEqual(["instagram:conversation:c1", "instagram:post:m9"]);
  });

  it("markInboxSeen ignores an empty key or a time that is not a date", () => {
    S().markInboxSeen("instagram:post:m9", A);
    const before = S().inboxSeen;
    S().markInboxSeen("instagram:post:m9", "undefined");
    S().markInboxSeen("instagram:post:m9", "");
    S().markInboxSeen("instagram:post:new", "undefined");
    S().markInboxSeen("instagram:post:new", "");
    S().markInboxSeen("", A);
    expect(S().inboxSeen).toBe(before);
    expect(S().inboxSeen).toEqual({ "instagram:post:m9": A });
    S().markInboxSeen("instagram:post:m9", B); // a valid later time still wins
    expect(S().inboxSeen).toEqual({ "instagram:post:m9": B });
  });

  it("pruneInboxSeen keeps only the listed keys, and ignores anything but strings", () => {
    S().markInboxSeen("instagram:conversation:c1", A);
    S().markInboxSeen("instagram:conversation:c2", A);
    S().markInboxSeen("instagram:post:m9", B);
    S().pruneInboxSeen([
      "instagram:post:m9",
      5 as never,
      null as never,
      "instagram:conversation:c1",
    ]);
    expect(S().inboxSeen).toEqual({ "instagram:conversation:c1": A, "instagram:post:m9": B });

    const before = S().inboxSeen;
    S().pruneInboxSeen(["instagram:conversation:c1", "instagram:post:m9", "never-seen"]);
    expect(S().inboxSeen).toBe(before); // nothing to drop: untouched
    S().pruneInboxSeen("instagram:post:m9" as never);
    S().pruneInboxSeen(undefined as never);
    expect(S().inboxSeen).toBe(before);

    S().pruneInboxSeen([]);
    expect(S().inboxSeen).toEqual({});
  });

  it("setInboxTab switches the tab", () => {
    S().setInboxTab("tiktok");
    expect(S().inboxTab).toBe("tiktok");
    S().setInboxTab("all");
    expect(S().inboxTab).toBe("all");
  });

  it("setInboxTab ignores a tab that does not exist", () => {
    S().setInboxTab("tiktok");
    S().setInboxTab("threads" as never);
    S().setInboxTab(undefined as never);
    S().setInboxTab("" as never);
    expect(S().inboxTab).toBe("tiktok");
  });

  it("persists to localStorage, rehydrates, and the reset clears it", async () => {
    S().markInboxSeen("instagram:post:m9", A);
    S().setInboxTab("instagram");
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw!).state.inboxSeen).toEqual({ "instagram:post:m9": A });
    expect(JSON.parse(raw!).state.inboxTab).toBe("instagram");
    expect(JSON.parse(raw!).state.markInboxSeen).toBeUndefined();

    useStore.setState({ inboxSeen: {}, inboxTab: "all" }); // simulate a fresh page (also persists)
    localStorage.setItem(STORAGE_KEY, raw!);
    await hydrateStore();
    expect(S().inboxSeen).toEqual({ "instagram:post:m9": A });
    expect(S().inboxTab).toBe("instagram");

    await S().reset();
    expect(S().inboxSeen).toEqual({});
    expect(S().inboxTab).toBe("all");
  });

  it("exportState includes both and importState restores them", async () => {
    S().markInboxSeen("instagram:post:m9", A);
    S().setInboxTab("tiktok");
    const json = S().exportState();
    expect(JSON.parse(json).state.inboxSeen).toEqual({ "instagram:post:m9": A });
    expect(JSON.parse(json).state.inboxTab).toBe("tiktok");
    await S().reset();
    await S().importState(json);
    expect(S().inboxSeen).toEqual({ "instagram:post:m9": A });
    expect(S().inboxTab).toBe("tiktok");
  });

  it("hydrates an old localStorage save without the inbox fields", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { settings: DEFAULT_SETTINGS, completions: [] }, version: 1 }),
    );
    await hydrateStore();
    expect(S().inboxSeen).toEqual({});
    expect(S().inboxTab).toBe("all");
  });

  it("rejects an import with an unknown tab without changing state", () => {
    S().setInboxTab("instagram");
    const bad = JSON.parse(S().exportState());
    bad.state.inboxTab = "threads";
    expect(() => S().importState(JSON.stringify(bad))).toThrow();
    expect(S().inboxTab).toBe("instagram");
  });
});
