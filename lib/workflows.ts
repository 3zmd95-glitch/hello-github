import { applyOverlay, lightestDay } from "@/components/planner/overlay";
import { getSkill, skills } from "@/data";
import {
  PostSchema,
  type Article,
  type Idea,
  type Lang,
  type PlanItem,
  type Post,
  type QuestCompletion,
  type Settings,
  type Workflow,
  type WorkflowAction,
  type WorkflowInput,
  type WorkflowText,
} from "@/lib/domain";
import { suggestHashtags } from "@/lib/social";
import { addDays, dayKey, weekKey } from "@/lib/streak";
import { buildWeekPlan } from "@/lib/weekPlan";

/**
 * ⚙️ Workflows (packet DT-4, planning/tools/34-workflows.md): pure logic. Templates, deterministic output ids, the
 * output builders the store's executor uses inside its commit, the dry run and the validation list. No store import,
 * no storage, no network: `previewRun` is safe to call on every render.
 */

export const WORKFLOW_PLACEHOLDERS = ["title", "summary", "slug", "date"] as const;
/** Placeholders that need an article: a manual run has none. */
const ARTICLE_PLACEHOLDERS = new Set(["title", "summary", "slug"]);
const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** The idea, post or planner row a step creates: its id doubles as provenance and makes retries idempotent. */
export const workflowOutputId = (runId: string, actionId: string): string =>
  `wf:${runId}:${actionId}`;

const pickLang = (text: { ar: string; en: string }, lang: Lang): string =>
  text[lang].trim() ? text[lang] : text[lang === "ar" ? "en" : "ar"];

/** The template in the run's language (else the other one), placeholders filled, trimmed. Unknown ones stay. */
export function renderTemplate(text: WorkflowText, input: WorkflowInput, lang: Lang): string {
  const values: Record<string, string> = {
    title: pickLang(input.title, lang),
    summary: pickLang(input.summary, lang),
    slug: input.slug,
    date: input.day,
  };
  return pickLang(text, lang)
    .replace(PLACEHOLDER_RE, (m, name: string) => values[name] ?? m)
    .trim();
}

/** Run input from an article (Ready trigger): its text, the UI language, the Riyadh day. */
export function articleInput(
  a: Pick<Article, "id" | "title" | "summary" | "slug" | "skillId">,
  lang: Lang,
  now: Date,
): WorkflowInput {
  return {
    articleId: a.id,
    title: a.title,
    summary: a.summary,
    slug: a.slug,
    ...(a.skillId ? { skillId: a.skillId } : {}),
    lang,
    day: dayKey(now),
  };
}

/** Run input for Run now: no article. */
export function manualInput(lang: Lang, now: Date): WorkflowInput {
  return {
    title: { ar: "", en: "" },
    summary: { ar: "", en: "" },
    slug: "",
    lang,
    day: dayKey(now),
  };
}

/** What the planner row needs from the state: progress, gear and the owner's plan rows. */
export interface PlanContext {
  completions: readonly QuestCompletion[];
  planItems: readonly PlanItem[];
  settings: Pick<Settings, "gear" | "davinciEdition">;
}

export type StepError =
  "empty-text" | "no-skill" | "unknown-skill" | "invalid" | "action-duplicate-id";
export type StepOutput =
  | { ok: true; kind: "idea"; record: Idea }
  | { ok: true; kind: "post"; record: Post }
  | { ok: true; kind: "plan"; record: PlanItem }
  | { ok: false; error: StepError };

/** The least loaded day of that week as the planner shows it (derived plan + the owner's rows). */
function lightestOf(week: string, ctx: PlanContext): number {
  const derived = buildWeekPlan({
    skills,
    completions: ctx.completions,
    settings: ctx.settings,
    weekStart: week,
  });
  return lightestDay(applyOverlay(derived, ctx.planItems).items);
}

/** One step's output, built from the run's snapshot (never through addIdea/addPost: those draw random ids). */
export function buildOutput(
  runId: string,
  action: WorkflowAction,
  input: WorkflowInput,
  ctx: PlanContext,
  now: Date,
): StepOutput {
  const id = workflowOutputId(runId, action.id);
  const at = now.toISOString();
  const lang = input.lang;
  try {
    if (action.kind === "idea") {
      const text = renderTemplate(action.text, input, lang);
      if (!text) return { ok: false, error: "empty-text" };
      return {
        ok: true,
        kind: "idea",
        record: {
          id,
          text,
          source: "workflow",
          ...(input.skillId ? { skillId: input.skillId } : {}),
          ...(action.platform ? { platform: action.platform } : {}),
          createdAt: at,
        },
      };
    }
    if (action.kind === "post") {
      const title = renderTemplate(action.title, input, lang);
      if (!title) return { ok: false, error: "empty-text" };
      const skill = input.skillId ? getSkill(input.skillId) : undefined;
      return {
        ok: true,
        kind: "post",
        record: PostSchema.parse({
          id,
          platform: action.platform,
          title,
          caption: renderTemplate(action.caption, input, lang),
          stage: "idea",
          plannedDay: addDays(input.day, action.offsetDays),
          ...(input.skillId ? { skillId: input.skillId } : {}),
          hashtags: suggestHashtags(action.platform, skill),
          createdAt: at,
          updatedAt: at,
        }),
      };
    }
    const skillId = action.skillId ?? input.skillId;
    if (!skillId) return { ok: false, error: "no-skill" };
    if (!getSkill(skillId)) return { ok: false, error: "unknown-skill" };
    const week = weekKey(input.day);
    return {
      ok: true,
      kind: "plan",
      record: {
        id,
        week,
        day: action.day === "lightest" ? lightestOf(week, ctx) : action.day,
        skillId,
        quest: action.quest,
        minutes: action.minutes,
        by: "me",
      },
    };
  } catch {
    return { ok: false, error: "invalid" };
  }
}

export type WorkflowIssueCode =
  | "name-empty"
  | "actions-count"
  | "idea-text-empty"
  | "post-title-empty"
  | "plan-skill"
  | "skill-needs-article"
  | "placeholder-unknown"
  | "placeholder-needs-article"
  | "action-duplicate-id";

export interface WorkflowIssue {
  code: WorkflowIssueCode;
  actionId?: string;
}

const blank = (t: { ar: string; en: string }) => !t.ar.trim() && !t.en.trim();
const templatesOf = (a: WorkflowAction): WorkflowText[] =>
  a.kind === "idea" ? [a.text] : a.kind === "post" ? [a.title, a.caption] : [];

/** What stops Run now and the Ready trigger, in display order. A draft may still be saved with issues. */
export function workflowIssues(w: Pick<Workflow, "name" | "trigger" | "actions">): WorkflowIssue[] {
  const out: WorkflowIssue[] = [];
  if (blank(w.name)) out.push({ code: "name-empty" });
  if (w.actions.length < 1 || w.actions.length > 5) out.push({ code: "actions-count" });
  for (const actionId of duplicateActionIds(w.actions))
    out.push({ code: "action-duplicate-id", actionId });
  const manual = w.trigger.kind === "manual";
  for (const a of w.actions) {
    const actionId = a.id;
    if (a.kind === "idea" && blank(a.text)) out.push({ code: "idea-text-empty", actionId });
    if (a.kind === "post" && blank(a.title)) out.push({ code: "post-title-empty", actionId });
    if (a.kind === "plan" && a.skillId && !getSkill(a.skillId))
      out.push({ code: "plan-skill", actionId });
    // A manual run captures no article: its implicit skill would be empty (Amendment C).
    if (a.kind === "plan" && !a.skillId && manual)
      out.push({ code: "skill-needs-article", actionId });
    const names = templatesOf(a).flatMap((t) =>
      [...`${t.ar} ${t.en}`.matchAll(PLACEHOLDER_RE)].map((m) => m[1]),
    );
    if (names.some((n) => !(WORKFLOW_PLACEHOLDERS as readonly string[]).includes(n)))
      out.push({ code: "placeholder-unknown", actionId });
    if (manual && names.some((n) => ARTICLE_PLACEHOLDERS.has(n)))
      out.push({ code: "placeholder-needs-article", actionId });
  }
  return out;
}

/** Action ids used more than once (each listed once): their outputs would collide at `wf:<runId>:<id>`. */
export function duplicateActionIds(actions: readonly Pick<WorkflowAction, "id">[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const { id } of actions) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/** A dry-run step: built (or failed) like the executor's, or skipped after an earlier failure. */
export type PreviewStep =
  (StepOutput & { actionId: string }) | { actionId: string; ok: false; skipped: true };

export interface PreviewResult {
  issues: WorkflowIssue[];
  outputs: PreviewStep[];
}

/**
 * Dry run: what a run would create, in order, with the same builders (a planner row sees the rows before it). Pure:
 * no store, no storage probe, no network.
 */
export function previewRun(
  workflow: Workflow,
  input: WorkflowInput,
  ctx: PlanContext,
  now: Date = new Date(),
): PreviewResult {
  let planItems = ctx.planItems;
  // Same rule as drainWorkflowRuns: duplicate ids fail the run before any output; after a failure the rest is skipped.
  let failed = duplicateActionIds(workflow.actions).length > 0;
  const outputs = workflow.actions.map((action, i): PreviewStep => {
    const actionId = action.id;
    if (failed)
      return i === 0
        ? { actionId, ok: false, error: "action-duplicate-id" }
        : { actionId, ok: false, skipped: true };
    const out = buildOutput("preview", action, input, { ...ctx, planItems }, now);
    if (!out.ok) failed = true;
    else if (out.kind === "plan") planItems = [...planItems, out.record];
    return { ...out, actionId };
  });
  return { issues: workflowIssues(workflow), outputs };
}

/** A new action with empty templates (the editor's "Add"). */
export function newAction(kind: WorkflowAction["kind"], id: string): WorkflowAction {
  const empty = { ar: "", en: "" };
  if (kind === "idea") return { id, kind, text: empty };
  if (kind === "post")
    return { id, kind, platform: "tiktok", title: empty, caption: empty, offsetDays: 1 };
  return { id, kind, quest: "produce", minutes: 30, day: "lightest" };
}
