import { describe, expect, it } from "vitest";
import { getSkill, skills } from "@/data";
import { EMPTY_SCRIPT, PLATFORMS, POST_STAGES, PostSchema, type Post } from "./domain";
import {
  BEST_TIME,
  BROLL_CHECKLIST,
  HASHTAG_SETS,
  PLATFORM_META,
  SHOT_TEMPLATES,
  bestTime,
  hasScript,
  hookIdeas,
  ideasFromSkills,
  nextPost,
  nextStage,
  overduePosts,
  plannedAt,
  postsByDay,
  postsForMonth,
  postsForWeek,
  quotedLine,
  scriptSeconds,
  scriptWords,
  shotsFromTemplate,
  suggestHashtags,
  suggestStage,
  unplannedPosts,
  weekPlanSummary,
} from "./social";

let n = 0;
const post = (p: Partial<Post> & Pick<Post, "platform">): Post =>
  PostSchema.parse({
    id: `p${++n}`,
    title: `Post ${n}`,
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    ...p,
  });

describe("best time", () => {
  it("has HH:MM slots for every platform, evening first except X", () => {
    for (const p of PLATFORMS) {
      expect(BEST_TIME[p].length).toBeGreaterThan(0);
      for (const t of BEST_TIME[p]) expect(t).toMatch(/^\d{2}:\d{2}$/);
    }
    expect(bestTime("tiktok")).toBe("21:00");
    expect(bestTime("x")).toBe("13:00");
  });

  it("uses the later slot on Friday and Saturday", () => {
    expect(bestTime("tiktok", "2026-09-23")).toBe("21:00"); // Wednesday
    expect(bestTime("tiktok", "2026-09-25")).toBe("21:30"); // Friday
    expect(bestTime("x", "2026-09-26")).toBe("21:00"); // Saturday
  });
});

describe("platform meta and templates", () => {
  it("covers every platform with a brand color, an aspect and limits", () => {
    for (const p of PLATFORMS) {
      const m = PLATFORM_META[p];
      expect(m.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(["9:16", "16:9"]).toContain(m.aspect);
      expect(m.captionLimit).toBeGreaterThan(0);
      expect(m.hashtagMax).toBeGreaterThan(0);
      expect(m.name.ar.length).toBeGreaterThan(0);
    }
    expect(PLATFORM_META.x.captionLimit).toBe(280);
  });

  it("gives vertical platforms a reel template, YouTube a long-form one and X one clip", () => {
    expect(SHOT_TEMPLATES.tiktok[0].type).toBe("hook");
    expect(SHOT_TEMPLATES.tiktok.filter((s) => s.type === "broll")).toHaveLength(3);
    expect(SHOT_TEMPLATES.instagram).toBe(SHOT_TEMPLATES.tiktok);
    expect(SHOT_TEMPLATES.youtube.length).toBe(7);
    expect(SHOT_TEMPLATES.x).toHaveLength(1);
    expect(BROLL_CHECKLIST.length).toBeGreaterThanOrEqual(8);
  });

  it("instantiates shots with fresh ids in the chosen language", () => {
    let i = 0;
    const shots = shotsFromTemplate("tiktok", "en", () => `s${++i}`);
    expect(shots.map((s) => s.id)).toEqual(SHOT_TEMPLATES.tiktok.map((_, k) => `s${k + 1}`));
    expect(shots[0]).toMatchObject({
      type: "hook",
      done: false,
      text: SHOT_TEMPLATES.tiktok[0].text.en,
    });
    expect(shotsFromTemplate("tiktok", "ar")[0].text).toBe(SHOT_TEMPLATES.tiktok[0].text.ar);
    const a = shotsFromTemplate("x", "ar");
    const b = shotsFromTemplate("x", "ar");
    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe("script length", () => {
  it("counts Arabic and English words and converts to seconds at 2.4 w/s", () => {
    expect(scriptWords(EMPTY_SCRIPT)).toBe(0);
    expect(scriptSeconds(EMPTY_SCRIPT)).toBe(0);
    expect(hasScript(EMPTY_SCRIPT)).toBe(false);
    const script = {
      hook: "وقّف! لا تكمّل تمرير",
      beats: ["one two three", "  spaced   words  ", ""] as [string, string, string],
      cta: "Save it 👇",
    };
    expect(scriptWords(script)).toBe(4 + 3 + 2 + 3);
    expect(scriptSeconds(script)).toBe(Math.round(12 / 2.4));
    expect(hasScript(script)).toBe(true);
    const long = { ...EMPTY_SCRIPT, hook: Array(72).fill("word").join(" ") };
    expect(scriptSeconds(long)).toBe(30);
  });
});

describe("pipeline", () => {
  it("nextStage walks the stages and stops at posted", () => {
    expect(nextStage({ stage: "idea" })).toBe("script");
    expect(nextStage({ stage: "scheduled" })).toBe("posted");
    expect(nextStage({ stage: "posted" })).toBeNull();
    expect(POST_STAGES).toEqual(["idea", "script", "filmed", "edited", "scheduled", "posted"]);
  });

  it("suggestStage never lowers the stage and follows the content", () => {
    const idea = post({ platform: "tiktok" });
    expect(suggestStage(idea)).toBe("idea");
    const written = { ...idea, script: { ...EMPTY_SCRIPT, hook: "hi" } };
    expect(suggestStage(written)).toBe("script");
    const shots = [
      { id: "a", type: "hook" as const, text: "", done: true },
      { id: "b", type: "broll" as const, text: "", done: false },
    ];
    expect(suggestStage({ ...written, shots })).toBe("script");
    expect(suggestStage({ ...written, shots: shots.map((s) => ({ ...s, done: true })) })).toBe(
      "filmed",
    );
    expect(suggestStage({ ...idea, stage: "edited" })).toBe("edited");
    expect(suggestStage({ ...idea, stage: "edited", plannedDay: "2026-10-01" })).toBe("scheduled");
    expect(suggestStage({ ...idea, stage: "scheduled" })).toBe("scheduled");
    expect(suggestStage({ ...idea, stage: "posted", shots })).toBe("posted");
  });
});

describe("calendar queries", () => {
  // Week of Saturday 2026-09-26 … Friday 2026-10-02.
  const list = [
    post({ platform: "tiktok", plannedDay: "2026-09-27", plannedTime: "21:00" }),
    post({ platform: "instagram", plannedDay: "2026-09-27", plannedTime: "20:30" }),
    post({ platform: "youtube", plannedDay: "2026-10-02", plannedTime: null }),
    post({ platform: "x", plannedDay: "2026-10-03", plannedTime: "13:00" }),
    post({ platform: "snapchat", plannedDay: null }),
    post({ platform: "tiktok", plannedDay: "2026-09-26", plannedTime: "21:00", stage: "posted" }),
  ];

  it("postsForWeek keeps the Sat–Fri window in day/time order", () => {
    const week = postsForWeek(list, "2026-09-26");
    expect(week.map((p) => p.plannedDay)).toEqual([
      "2026-09-26",
      "2026-09-27",
      "2026-09-27",
      "2026-10-02",
    ]);
    expect(week[1].platform).toBe("instagram"); // 20:30 before 21:00
    expect(postsForWeek(list, "2026-10-03")).toHaveLength(1);
  });

  it("postsForMonth and postsByDay group planned posts", () => {
    expect(postsForMonth(list, "2026-10").map((p) => p.platform)).toEqual(["youtube", "x"]);
    const byDay = postsByDay(list);
    expect(Object.keys(byDay).sort()).toEqual([
      "2026-09-26",
      "2026-09-27",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(byDay["2026-09-27"].map((p) => p.platform)).toEqual(["instagram", "tiktok"]);
    expect(unplannedPosts(list).map((p) => p.platform)).toEqual(["snapchat"]);
  });

  it("nextPost finds the earliest upcoming unposted post with a countdown", () => {
    const now = Date.parse("2026-09-27T20:00:00+03:00");
    const next = nextPost(list, now);
    expect(next?.post.platform).toBe("instagram");
    expect(next?.countdownMs).toBe(30 * 60_000);
    expect(next?.at).toBe(new Date(Date.parse("2026-09-27T20:30:00+03:00")).toISOString());
    // The posted one on the 26th is skipped even when "now" is before it.
    expect(nextPost(list, Date.parse("2026-09-26T10:00:00+03:00"))?.post.platform).toBe(
      "instagram",
    );
    expect(nextPost(list, Date.parse("2026-10-10T00:00:00+03:00"))).toBeNull();
    expect(plannedAt(list[2])).toBe(Date.parse("2026-10-02T23:59:00+03:00"));
    expect(plannedAt(list[4])).toBeNull();
  });

  it("overduePosts lists planned posts whose time passed unposted", () => {
    const now = Date.parse("2026-09-27T21:30:00+03:00");
    expect(overduePosts(list, now).map((p) => p.platform)).toEqual(["instagram", "tiktok"]);
  });

  it("weekPlanSummary counts per platform, posted and per day", () => {
    const sum = weekPlanSummary(list, "2026-09-26");
    expect(sum.total).toBe(4);
    expect(sum.posted).toBe(1);
    expect(sum.byPlatform.tiktok).toEqual({ planned: 2, posted: 1 });
    expect(sum.byPlatform.x).toEqual({ planned: 0, posted: 0 });
    expect(sum.perDay).toHaveLength(7);
    expect(sum.perDay[0]).toEqual({ day: "2026-09-26", count: 1 });
    expect(sum.perDay[1].count).toBe(2);
  });
});

describe("hashtags and hooks", () => {
  it("suggests the platform set, capped, with the skill's program tags first", () => {
    for (const p of PLATFORMS) {
      expect(HASHTAG_SETS[p].length).toBeGreaterThan(0);
      expect(suggestHashtags(p).length).toBeLessThanOrEqual(PLATFORM_META[p].hashtagMax);
    }
    expect(suggestHashtags("x")).toEqual(HASHTAG_SETS.x);
    const withSkill = suggestHashtags("tiktok", { programId: "capcut" });
    expect(withSkill[0]).toBe("#capcut");
    expect(withSkill).toHaveLength(PLATFORM_META.tiktok.hashtagMax);
    // Duplicates are folded (davinci's tag is already in the set).
    const dv = suggestHashtags("youtube", { programId: "davinci" });
    expect(new Set(dv.map((t) => t.toLowerCase())).size).toBe(dv.length);
  });

  it("pulls the quoted line out of a produce quest", () => {
    expect(quotedLine('30 s reel: open with "Spent an hour hunting one clip?" then…')).toBe(
      "Spent an hour hunting one clip?",
    );
    expect(quotedLine("جملة «وقّف» هنا")).toBe("وقّف");
    expect(quotedLine("no quotes")).toBeNull();
  });

  it("gives 3 bilingual hooks, from the skill's produce quest when linked", () => {
    const generic = hookIdeas();
    expect(generic).toHaveLength(3);
    for (const h of generic) expect(h.ar && h.en).toBeTruthy();
    const skill = getSkill("smart-bins-keywords")!;
    const hooks = hookIdeas(skill);
    expect(hooks).toHaveLength(3);
    expect(hooks[0].en).toBe("Spent an hour hunting one clip?");
    expect(hooks[0].ar).toBe("دورت على لقطة ساعة كاملة؟");
    expect(hooks[1].en).toContain(skill.name.en);
    expect(hooks[2].ar).toContain(skill.name.ar);
  });
});

describe("ideasFromSkills", () => {
  it("offers skills without a produce completion, a post or a stored idea", () => {
    const [a, b, c] = skills;
    const completions = [
      { skillId: a.id, quest: "produce" as const, at: "2026-09-01T10:00:00.000Z" },
    ];
    const posts = [post({ platform: "tiktok", skillId: b.id })];
    const ideas = [
      {
        id: "i1",
        text: "x",
        source: "skill" as const,
        skillId: c.id,
        createdAt: "2026-09-01T10:00:00.000Z",
      },
    ];
    const out = ideasFromSkills(skills, completions, posts, ideas);
    const ids = out.map((o) => o.skillId);
    expect(ids).not.toContain(a.id);
    expect(ids).not.toContain(b.id);
    expect(ids).not.toContain(c.id);
    expect(out).toHaveLength(skills.length - 3);
    expect(out[0]).toMatchObject({
      source: "skill",
      text: skills[3].name,
      brief: skills[3].quests.produce,
    });
    expect(ideasFromSkills(skills, [], [])).toHaveLength(skills.length);
  });
});
