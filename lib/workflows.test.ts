// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyOverlay, lightestDay } from "@/components/planner/overlay";
import { getSkill, skills } from "@/data";
import {
  WorkflowSchema,
  type Workflow,
  type WorkflowAction,
  type WorkflowInput,
} from "@/lib/domain";
import { suggestHashtags } from "@/lib/social";
import { weekKey } from "@/lib/streak";
import { buildWeekPlan } from "@/lib/weekPlan";
import {
  articleInput,
  buildOutput,
  manualInput,
  previewRun,
  renderTemplate,
  workflowIssues,
  workflowOutputId,
  type PlanContext,
} from "./workflows";

// ⚙️ Workflows (packet DT-4): pure templates, deterministic output ids, a pure dry run, planner rows the planner
// shows, and the validation matrix. Nothing here touches storage, the store or the network.

const NOW = new Date("2026-10-16T10:00:00Z"); // Friday in Riyadh
const SKILL = "smart-bins-keywords";

const input: WorkflowInput = {
  articleId: "a1",
  title: { ar: "تلوين الليل", en: "Night grading" },
  summary: { ar: "ملخص", en: "A summary" },
  slug: "night-grading",
  skillId: SKILL,
  lang: "en",
  day: "2026-10-16",
};

const ctx: PlanContext = {
  completions: [],
  planItems: [],
  settings: { gear: ["phone", "lights"], davinciEdition: "studio" },
};

type IdeaAction = Extract<WorkflowAction, { kind: "idea" }>;
const idea = (over: Partial<IdeaAction> = {}): IdeaAction => ({
  id: "i1",
  kind: "idea",
  text: { ar: "فكرة: {title}", en: "Idea: {title}" },
  ...over,
});
const post: WorkflowAction = {
  id: "p1",
  kind: "post",
  platform: "tiktok",
  title: { ar: "{title}", en: "{title} in 30s" },
  caption: { ar: "{summary}", en: "{summary} · {slug} · {date}" },
  offsetDays: 2,
};
const plan: Extract<WorkflowAction, { kind: "plan" }> = {
  id: "q1",
  kind: "plan",
  quest: "produce",
  minutes: 45,
  day: "lightest",
};

const wf = (over: Partial<Workflow> = {}): Workflow => ({
  id: "w1",
  name: { ar: "بعد المقال", en: "After the article" },
  trigger: { kind: "article-ready" },
  actions: [idea(), post, plan],
  enabled: true,
  revision: 1,
  commitId: "c1",
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("renderTemplate", () => {
  it("fills {title} {summary} {slug} {date} in the run's language", () => {
    const text = { ar: "{title} — {summary}", en: "{title} — {summary} ({slug}, {date})" };
    expect(renderTemplate(text, input, "en")).toBe(
      "Night grading — A summary (night-grading, 2026-10-16)",
    );
    expect(renderTemplate(text, input, "ar")).toBe("تلوين الليل — ملخص");
  });

  it("falls back to the other language when the run's language is empty", () => {
    expect(renderTemplate({ ar: "", en: "Only {title}" }, input, "ar")).toBe("Only تلوين الليل");
    expect(
      renderTemplate({ ar: "{title}", en: "" }, { ...input, title: { ar: "", en: "EN" } }, "ar"),
    ).toBe("EN");
  });

  it("leaves an unknown placeholder as typed (the issues list flags it)", () => {
    expect(renderTemplate({ ar: "", en: "{nope} {title}" }, input, "en")).toBe(
      "{nope} Night grading",
    );
  });
});

describe("workflowOutputId", () => {
  it("is deterministic per run and action", () => {
    expect(workflowOutputId("r1", "i1")).toBe("wf:r1:i1");
    expect(workflowOutputId("r1", "i1")).toBe(workflowOutputId("r1", "i1"));
    expect(workflowOutputId("r2", "i1")).not.toBe(workflowOutputId("r1", "i1"));
  });
});

describe("buildOutput", () => {
  it("builds an idea with source workflow and the deterministic id", () => {
    const out = buildOutput("r1", idea({ platform: "instagram" }), input, ctx, NOW);
    expect(out).toEqual({
      ok: true,
      kind: "idea",
      record: {
        id: "wf:r1:i1",
        text: "Idea: Night grading",
        source: "workflow",
        skillId: SKILL,
        platform: "instagram",
        createdAt: NOW.toISOString(),
      },
    });
  });

  it("builds a calendar post in the idea stage, offset days after the run day, with suggested hashtags", () => {
    const out = buildOutput("r1", post, input, ctx, NOW);
    expect(out.ok && out.kind).toBe("post");
    if (!out.ok || out.kind !== "post") return;
    expect(out.record).toMatchObject({
      id: "wf:r1:p1",
      platform: "tiktok",
      title: "Night grading in 30s",
      caption: "A summary · night-grading · 2026-10-16",
      stage: "idea",
      plannedDay: "2026-10-18",
      skillId: SKILL,
      hashtags: suggestHashtags("tiktok", getSkill(SKILL)),
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });
  });

  it("builds a planner row the planner shows: by me, minutes > 0, on the lightest day of the overlaid week", () => {
    const week = weekKey(input.day);
    const derived = buildWeekPlan({
      skills,
      completions: [],
      settings: ctx.settings,
      weekStart: week,
    });
    const expectedDay = lightestDay(applyOverlay(derived, []).items);
    const out = buildOutput("r1", plan, input, ctx, NOW);
    expect(out).toEqual({
      ok: true,
      kind: "plan",
      record: {
        id: "wf:r1:q1",
        week,
        day: expectedDay,
        skillId: SKILL,
        quest: "produce",
        minutes: 45,
        by: "me",
      },
    });
    if (!out.ok || out.kind !== "plan") return;
    const overlaid = applyOverlay(derived, [out.record]);
    expect(overlaid.items.find((i) => i.id === "wf:r1:q1")).toMatchObject({
      manual: true,
      minutes: 45,
    });
  });

  it("uses a fixed day and the action's own skill when given", () => {
    const out = buildOutput(
      "r1",
      { ...plan, day: 3, skillId: SKILL },
      { ...input, skillId: undefined },
      ctx,
      NOW,
    );
    expect(out.ok && out.kind === "plan" && out.record.day).toBe(3);
  });

  it("fails honestly: empty text, no skill, unknown skill", () => {
    const noSummary = { ...input, summary: { ar: "", en: "" } };
    expect(
      buildOutput("r1", idea({ text: { ar: "", en: "{summary}" } }), noSummary, ctx, NOW),
    ).toEqual({ ok: false, error: "empty-text" });
    expect(buildOutput("r1", plan, { ...input, skillId: undefined }, ctx, NOW)).toEqual({
      ok: false,
      error: "no-skill",
    });
    expect(buildOutput("r1", { ...plan, skillId: "nope" }, input, ctx, NOW)).toEqual({
      ok: false,
      error: "unknown-skill",
    });
  });
});

describe("previewRun", () => {
  it("returns the would-be outputs and touches no storage, store or network", () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const remove = vi.spyOn(Storage.prototype, "removeItem");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const out = previewRun(wf(), input, ctx, NOW);
    expect(out.issues).toEqual([]);
    expect(out.outputs.map((o) => [o.actionId, o.ok && o.kind])).toEqual([
      ["i1", "idea"],
      ["p1", "post"],
      ["q1", "plan"],
    ]);
    for (const spy of [get, set, remove, fetchSpy]) expect(spy).not.toHaveBeenCalled();
  });

  it("places two plan actions on the week as the run would (the second sees the first)", () => {
    const out = previewRun(wf({ actions: [plan, { ...plan, id: "q2" }] }), input, ctx, NOW);
    const rows = out.outputs.flatMap((o) => (o.ok && o.kind === "plan" ? [o.record] : []));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(["wf:preview:q1", "wf:preview:q2"]);
  });

  it("mirrors execution: after the first failed step every later step is skipped, with no output (Amendment B)", () => {
    const noSummary = { ...input, summary: { ar: "", en: "" } };
    const out = previewRun(
      wf({ actions: [idea({ text: { ar: "", en: "{summary}" } }), post, plan] }),
      noSummary,
      ctx,
      NOW,
    );
    expect(out.outputs).toEqual([
      { actionId: "i1", ok: false, error: "empty-text" },
      { actionId: "p1", ok: false, skipped: true },
      { actionId: "q1", ok: false, skipped: true },
    ]);
  });

  it("fails the first step and skips the rest when two actions share an id (Amendment B)", () => {
    const out = previewRun(
      wf({ actions: [idea({ id: "a1" }), { ...plan, id: "a1" }] }),
      input,
      ctx,
      NOW,
    );
    expect(out.outputs).toEqual([
      { actionId: "a1", ok: false, error: "action-duplicate-id" },
      { actionId: "a1", ok: false, skipped: true },
    ]);
  });
});

describe("duplicate action ids (Amendment B)", () => {
  it("are refused by the schema and reported by workflowIssues", () => {
    const dup = wf({ actions: [idea({ id: "a1" }), { ...plan, id: "a1" }] });
    expect(WorkflowSchema.safeParse(dup).success).toBe(false);
    expect(WorkflowSchema.safeParse(wf()).success).toBe(true);
    expect(workflowIssues(dup)).toContainEqual({ code: "action-duplicate-id", actionId: "a1" });
  });
});

describe("inputs", () => {
  it("captures the article, the UI language and the Riyadh day", () => {
    const a = {
      id: "a9",
      title: { ar: "ع", en: "E" },
      summary: { ar: "س", en: "S" },
      slug: "e",
      skillId: SKILL,
    };
    expect(articleInput(a, "ar", new Date("2026-10-16T22:30:00Z"))).toEqual({
      articleId: "a9",
      title: a.title,
      summary: a.summary,
      slug: "e",
      skillId: SKILL,
      lang: "ar",
      day: "2026-10-17",
    });
    expect(manualInput("en", NOW)).toEqual({
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-16",
    });
  });
});

describe("workflowIssues", () => {
  const codes = (w: Workflow) => workflowIssues(w).map((i) => i.code);

  it("accepts a complete workflow", () => {
    expect(workflowIssues(wf())).toEqual([]);
  });

  it("flags an empty name in both languages, but not in one", () => {
    expect(codes(wf({ name: { ar: " ", en: "" } }))).toEqual(["name-empty"]);
    expect(codes(wf({ name: { ar: "", en: "x" } }))).toEqual([]);
  });

  it("flags no actions and more than five", () => {
    expect(codes(wf({ actions: [] }))).toEqual(["actions-count"]);
    const six = Array.from({ length: 6 }, (_, n) => idea({ id: `i${n}` }));
    expect(codes(wf({ actions: six }))).toEqual(["actions-count"]);
  });

  it("flags empty idea text and empty post title, per action", () => {
    expect(workflowIssues(wf({ actions: [idea({ text: { ar: "", en: " " } })] }))).toEqual([
      { code: "idea-text-empty", actionId: "i1" },
    ]);
    expect(workflowIssues(wf({ actions: [{ ...post, title: { ar: "", en: "" } }] }))).toEqual([
      { code: "post-title-empty", actionId: "p1" },
    ]);
  });

  it("flags a plan action without a skill in a manual workflow (no article), and an unknown skill", () => {
    expect(workflowIssues(wf({ trigger: { kind: "manual" }, actions: [plan] }))).toEqual([
      { code: "skill-needs-article", actionId: "q1" },
    ]);
    expect(
      codes(wf({ trigger: { kind: "manual" }, actions: [{ ...plan, skillId: SKILL }] })),
    ).toEqual([]);
    expect(codes(wf({ actions: [{ ...plan, skillId: "nope" }] }))).toEqual(["plan-skill"]);
  });

  it("flags unknown placeholders, and article placeholders in a manual workflow", () => {
    expect(workflowIssues(wf({ actions: [idea({ text: { ar: "{nope}", en: "x" } })] }))).toEqual([
      { code: "placeholder-unknown", actionId: "i1" },
    ]);
    expect(workflowIssues(wf({ trigger: { kind: "manual" }, actions: [idea()] }))).toEqual([
      { code: "placeholder-needs-article", actionId: "i1" },
    ]);
    expect(
      codes(
        wf({ trigger: { kind: "manual" }, actions: [idea({ text: { ar: "{date}", en: "" } })] }),
      ),
    ).toEqual([]);
  });
});
