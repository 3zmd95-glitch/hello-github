// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getSkill, pillars, programsByPillar } from "@/data";
import { CHEST_EVERY, lootFor } from "@/lib/chests";
import { FREEZE_REWARD_ID, GEM_RULES, defaultRewards } from "@/lib/gems";
import { FREEZE_TOTAL_CAP } from "@/lib/streak";
import { DRILL_XP, MASTERY_BONUS, REVIEW_XP, questXp } from "@/lib/xp";
import { DEFAULT_AVATAR } from "@/lib/domain";
import {
  DEFAULT_SETTINGS,
  STORAGE_KEY,
  activeDays,
  boss,
  chestProgress,
  currentWeek,
  dueDrills,
  earnedBadges,
  focusActive,
  gems,
  getApiKey,
  hydrateStore,
  isPlanItemDone,
  isQuestDone,
  masteredSkillIds,
  pillarXp,
  planItemsForWeek,
  programXp,
  reviewForWeek,
  season,
  skillProgress,
  streak,
  totalXp,
  useStore,
} from "./index";

const S = () => useStore.getState();
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
