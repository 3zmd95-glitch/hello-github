import { describe, expect, it } from "vitest";
import { skills } from "@/data";
import { buildOutput, previewRun, workflowOutputId, type PlanContext } from "@/lib/workflows";
import { dayKey, weekKey } from "@/lib/streak";
import { buildWeekPlan } from "@/lib/weekPlan";
import type { Workflow, WorkflowAction, WorkflowInput } from "@/lib/domain";
import type { WorkflowOutput } from "./workflowCoordinator";
import { canonicalJson, checkBody, type OccurrenceBody } from "./workflowProtocol";
import { runStep } from "./workflowRun";

// ⚙️ DT-7B-2 adapter parity (planning/tools/38-cloud-workflows.md): `runStep` — the fixed server builder — against
// the REAL shared builders of lib/workflows.ts (`previewRun`, `buildOutput`), imported through the Worker's resolver
// (tsconfig paths + vitest alias). Every expected record is computed here by the app's own code; the comparison is
// the canonical JSON bytes the coordinator stores. Parity holds only for identical builder/catalog pins
// (planning/collaboration/dt7b-candidate/7b2-builder-pins.sha256): no cross-version equivalence is claimed.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Step = { actionId: string; error?: string; skipped?: true; record?: A };

const OWNER = "wfo_" + "a".repeat(32);
const SKILL = "iphone-log-prores";
const AT = "2026-10-17T09:00:00.000Z"; // Saturday 12:00 Riyadh, the first day of week 2026-10-17

const t = (en: string, ar = "") => ({ ar, en });
const idea = (id: string, text = t("Idea: {title} ({date})", "فكرة: {title}"), platform?: string) =>
  ({ id, kind: "idea", text, ...(platform ? { platform } : {}) }) as A;
const post = (id: string, platform = "tiktok", offsetDays = 1) =>
  ({
    id,
    kind: "post",
    platform,
    title: t("{title}", "{title} بالعربي"),
    caption: t("{summary} /{slug}", "{summary} — {slug}"),
    offsetDays,
  }) as A;
const plan = (id: string, o: A = {}) =>
  ({ id, kind: "plan", quest: "produce", minutes: 30, day: "lightest", skillId: SKILL, ...o }) as A;
const noSkill = (a: A) => {
  delete a.skillId;
  return a;
};

interface Opts {
  id?: string;
  article?: boolean;
  lang?: "ar" | "en";
  at?: string;
  ctx?: A;
  skillId?: string | null;
}
/** A body in the shape the coordinator stores (admission is checked by `admitted`). */
function occ(actions: A[], o: Opts = {}): OccurrenceBody {
  const at = o.at ?? AT;
  const day = dayKey(new Date(at));
  const article = o.article ?? true;
  const id = o.id ?? (article ? "ar-o1" : "m1");
  const hasPlan = actions.some((a) => a.kind === "plan");
  const b = {
    occurrenceId: id,
    ownerKey: OWNER,
    workflowId: "w1",
    kind: article ? "article-ready" : "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: t("Flow"),
      trigger: { kind: article ? "article-ready" : "manual" },
      actions,
    },
    plannerContext: hasPlan
      ? {
          targetWeek: weekKey(day),
          completions: [],
          planItems: [],
          settings: { gear: ["phone"], davinciEdition: "free" },
          contextAt: at,
          ...o.ctx,
        }
      : null,
    input: article
      ? {
          articleId: "art1",
          title: t("Log footage", "تصوير لوق"),
          summary: t("Shoot flat, grade later", "صوّر مسطح ولوّن بعدين"),
          slug: "log-footage",
          ...(o.skillId === null ? {} : { skillId: o.skillId ?? SKILL }),
          lang: o.lang ?? "en",
          day,
        }
      : { title: t(""), summary: t(""), slug: "", lang: o.lang ?? "en", day },
    executionAt: at,
  };
  return b as unknown as OccurrenceBody;
}
const admitted = (b: OccurrenceBody) => {
  expect(checkBody(b, Date.parse(b.executionAt))).toMatchObject({ ok: true });
  return b;
};
const codes = (steps: Step[]) => steps.map((s) => s.error ?? (s.skipped ? "skipped" : "done"));

/** The coordinator's fold over the adapter: outputs round-trip through the stored canonical JSON; fail-fast. */
async function adapterRun(b: OccurrenceBody, prior: WorkflowOutput[] = []): Promise<Step[]> {
  const out: Step[] = [];
  let failed = false;
  for (const [idx, action] of b.snapshot.actions.entries()) {
    if (failed) {
      out.push({ actionId: action.id, skipped: true });
      continue;
    }
    const r = await runStep({ body: b, idx, action, prior });
    if ("error" in r) {
      failed = true;
      out.push({ actionId: action.id, error: r.error });
      continue;
    }
    const stored = JSON.parse(canonicalJson(r.record)) as A;
    prior = [
      ...prior,
      { outputId: stored.id, actionId: action.id, kind: action.kind, digest: "", record: stored },
    ];
    out.push({ actionId: action.id, record: r.record as A });
  }
  return out;
}

/** The app's own dry run over the same snapshot, input, context and clock, ids mapped to this occurrence. */
function appRun(b: OccurrenceBody): Step[] {
  const pc = b.plannerContext;
  const ctx = {
    completions: pc?.completions ?? [],
    planItems: pc?.planItems ?? [],
    settings: pc?.settings ?? { gear: [], davinciEdition: "free" },
  } as unknown as PlanContext;
  const workflow = { ...b.snapshot } as unknown as Workflow;
  const { outputs } = previewRun(workflow, b.input as WorkflowInput, ctx, new Date(b.executionAt));
  return outputs.map((s): Step => {
    if ("skipped" in s) return { actionId: s.actionId, skipped: true };
    if (!s.ok) return { actionId: s.actionId, error: s.error };
    return {
      actionId: s.actionId,
      record: { ...s.record, id: workflowOutputId(b.occurrenceId, s.actionId) },
    };
  });
}

const bytes = (steps: Step[]) =>
  steps.map((s) => (s.record ? { ...s, record: canonicalJson(s.record) } : s));

async function parity(b: OccurrenceBody) {
  const got = await adapterRun(b);
  expect(bytes(got)).toEqual(bytes(appRun(b)));
  return got;
}

const direct = (b: OccurrenceBody, idx: number, ctx: A) =>
  buildOutput(
    b.occurrenceId,
    b.snapshot.actions[idx] as unknown as WorkflowAction,
    b.input as WorkflowInput,
    ctx as PlanContext,
    new Date(b.executionAt),
  );

describe("runStep: byte parity with the real shared builders", () => {
  it("idea, post and plan in English: records byte-equal to previewRun and buildOutput, ids wf:<occ>:<action>", async () => {
    const b = admitted(occ([idea("i1", undefined, "instagram"), post("p1"), plan("q1")]));
    const got = await parity(b);
    expect(got.map((s) => s.record?.id)).toEqual(["wf:ar-o1:i1", "wf:ar-o1:p1", "wf:ar-o1:q1"]);
    // The direct builder call with this occurrence's id and the fixed executionAt clock.
    const ctx = { completions: [], planItems: [], settings: b.plannerContext!.settings };
    for (const idx of [0, 1, 2]) {
      const d = direct(b, idx, ctx);
      expect(d.ok && canonicalJson(d.record)).toBe(canonicalJson(got[idx].record));
    }
    expect(got[0].record).toMatchObject({ text: "Idea: Log footage (2026-10-17)", createdAt: AT });
    expect(got[1].record).toMatchObject({ plannedDay: "2026-10-18", createdAt: AT, updatedAt: AT });
    expect(got[2].record).toMatchObject({ week: "2026-10-17", by: "me", skillId: SKILL });
    // Matrix row 29: lib/publish `publishJobId` is a pure function of the post id, and the id is the local
    // executor's own `workflowOutputId`, so today's mapping is unchanged (lib/publish is not imported here: it pulls
    // the app store into the Worker type graph).
    expect(got[1].record!.id).toBe(workflowOutputId("ar-o1", "p1"));
  });

  it("Arabic input: Arabic templates, English fallback for an empty Arabic template", async () => {
    const b = admitted(
      occ([idea("i1"), idea("i2", t("Only English {slug}")), post("p1", "youtube", 3)], {
        lang: "ar",
      }),
    );
    const got = await parity(b);
    expect(got[0].record!.text).toBe("فكرة: تصوير لوق");
    expect(got[1].record!.text).toBe("Only English log-footage");
    expect(got[2].record!.title).toBe("تصوير لوق بالعربي");
  });

  it("Riyadh date rollover: Friday 23:59:59.999 and Saturday 00:00 build in their own day and week", async () => {
    const actions = () => [idea("i1"), post("p1", "x", 1), plan("q1")];
    const fri = admitted(occ(actions(), { at: "2026-10-16T20:59:59.999Z" }));
    const sat = admitted(occ(actions(), { at: "2026-10-16T21:00:00.000Z" }));
    expect([fri.input.day, sat.input.day]).toEqual(["2026-10-16", "2026-10-17"]);
    const [f, s] = [await parity(fri), await parity(sat)];
    expect(f[0].record!.text).toContain("(2026-10-16)");
    expect(s[0].record!.text).toContain("(2026-10-17)");
    expect([f[1].record!.plannedDay, s[1].record!.plannedDay]).toEqual([
      "2026-10-17",
      "2026-10-18",
    ]);
    expect([f[2].record!.week, s[2].record!.week]).toEqual(["2026-10-10", "2026-10-17"]);
  });

  it("ordered lightest-day plans: each step folds the earlier plan outputs of this occurrence, in action order", async () => {
    const actions = [1, 2, 3, 4, 5].map((n) => plan(`q${n}`, { minutes: 120 }));
    const b = admitted(occ(actions));
    const got = await parity(b);
    const days = got.map((s) => s.record!.day as number);
    // Without the fold step 2 would pick step 1's day again; with it the load moves.
    const unfolded = direct(b, 1, {
      completions: [],
      planItems: [],
      settings: b.plannerContext!.settings,
    });
    expect(unfolded.ok && unfolded.kind === "plan" && unfolded.record.day).toBe(days[0]);
    expect(days[1]).not.toBe(days[0]);
    expect(new Set(days).size).toBeGreaterThan(2);
    // Plan outputs of another occurrence (or of a later action) are never folded.
    const alone = admitted(occ([plan("q1", { minutes: 120 })]));
    const foreign: WorkflowOutput[] = [
      {
        outputId: "wf:other:q1",
        actionId: "q1",
        kind: "plan",
        digest: "",
        record: { ...got[0].record!, id: "wf:other:q1" },
      },
      {
        outputId: "wf:ar-o1:q2",
        actionId: "q2",
        kind: "plan",
        digest: "",
        record: { ...got[1].record! },
      },
    ];
    expect(bytes(await adapterRun(alone, foreign))).toEqual(bytes(appRun(alone)));
  });

  it("overlays and history: pre-week completions, target-week manual rows, zero-minute tombstones, gear and edition", async () => {
    const week = "2026-10-17";
    const settings = { gear: ["phone", "mic"], davinciEdition: "studio" };
    const derived = buildWeekPlan({
      skills,
      completions: [],
      settings: settings as never,
      weekStart: week,
    }).items;
    expect(derived.length).toBeGreaterThan(1);
    const row = (
      id: string,
      day: number,
      skillId: string,
      quest: string,
      minutes: number,
      by: string,
    ) => ({
      id,
      week,
      day,
      skillId,
      quest,
      minutes,
      by,
    });
    const ctx = {
      completions: [
        { skillId: SKILL, quest: "research", at: "2026-10-03T08:00:00.000Z" },
        { skillId: "handheld-no-gimbal", quest: "train", at: "2026-10-16T20:00:00.000Z" },
      ],
      planItems: [
        // A zero-minute tombstone hiding a derived row, and two of the owner's own rows.
        row(derived[0].id, derived[0].day, derived[0].skillId, derived[0].quest, 0, "rules"),
        row(`${week}:me:${SKILL}:train`, 3, SKILL, "train", 90, "me"),
        row(`${week}:me:phone-180-shutter:produce`, 4, "phone-180-shutter", "produce", 60, "me"),
      ],
      settings,
    };
    const actions = () => [
      plan("q1", { minutes: 60 }),
      plan("q2", { day: 2 }),
      plan("q3", { minutes: 90 }),
    ];
    const got = await parity(admitted(occ(actions(), { ctx })));
    expect(got[1].record!.day).toBe(2);
    // The context matters: the same actions without history/overlays build other rows.
    expect(bytes(await adapterRun(admitted(occ(actions()))))).not.toEqual(bytes(got));
    // The other edition and no gear: still byte-equal to the app.
    await parity(
      admitted(occ(actions(), { ctx: { ...ctx, settings: { gear: [], davinciEdition: "free" } } })),
    );
  });

  it("missing and unknown skills keep the builder's codes; fail-fast keeps earlier outputs and skips the rest", async () => {
    const missing = admitted(occ([idea("i1"), noSkill(plan("q1")), post("p1")], { skillId: null }));
    expect(codes(await parity(missing))).toEqual(["done", "no-skill", "skipped"]);
    const unknown = admitted(occ([plan("q1", { skillId: "no-such-skill" }), idea("i1")]));
    expect(codes(await parity(unknown))).toEqual(["unknown-skill", "skipped"]);
    // A manual run captures no article, so an implicit plan skill is missing; empty text keeps its code too.
    const manual = admitted(occ([noSkill(plan("q1"))], { article: false }));
    expect(codes(await parity(manual))).toEqual(["no-skill"]);
    const empty = admitted(occ([idea("i1", t("")), idea("i2")], { article: false }));
    expect(codes(await parity(empty))).toEqual(["empty-text", "skipped"]);
  });

  it("stale plan context fails fast with the protocol's context-stale: earlier outputs survive, later steps skip", async () => {
    // Admission refuses such a body today (targetWeek = weekOf(day)); the adapter still never builds an old week.
    const stale = occ([idea("i1"), plan("q1"), post("p1")], { ctx: { targetWeek: "2026-10-10" } });
    expect(checkBody(stale, Date.parse(AT))).toEqual({ ok: false, error: "bad_request" });
    const got = await adapterRun(stale);
    expect(codes(got)).toEqual(["done", "context-stale", "skipped"]);
    expect(canonicalJson(got[0].record)).toBe(canonicalJson(appRun(stale)[0].record));
    const first = await adapterRun(
      occ([plan("q1"), idea("i1")], { ctx: { targetWeek: "2026-10-24" } }),
    );
    expect(first).toEqual([
      { actionId: "q1", error: "context-stale" },
      { actionId: "i1", skipped: true },
    ]);
    // A plan step without any captured context is stale too (never an empty planner).
    const none = { ...occ([plan("q1")]), plannerContext: null } as OccurrenceBody;
    expect(await adapterRun(none)).toEqual([{ actionId: "q1", error: "context-stale" }]);
  });

  it("a builder record outside the draft allowlist is never stored or truncated: the step fails invalid", async () => {
    const b = occ([idea("i1", t("{summary}{summary}{summary}")), idea("i2")]);
    b.input.summary = t("x".repeat(2_000));
    admitted(b);
    expect((appRun(b)[0].record!.text as string).length).toBe(6_000);
    expect(await adapterRun(b)).toEqual([
      { actionId: "i1", error: "invalid" },
      { actionId: "i2", skipped: true },
    ]);
  });

  it("the builder clock is the immutable executionAt, never the wall clock", async () => {
    const b = admitted(occ([idea("i1"), post("p1")]));
    const [x, y] = [await adapterRun(b), await adapterRun(b)];
    expect(bytes(x)).toEqual(bytes(y));
    expect([x[0].record!.createdAt, x[1].record!.updatedAt]).toEqual([AT, AT]);
  });
});
