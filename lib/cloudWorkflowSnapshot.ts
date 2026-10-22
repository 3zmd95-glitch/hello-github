/**
 * ⚙️ Cloud workflow snapshot + preflight (packet DT-7C-1, planning/tools/38-cloud-workflows.md): PURE, unactivated.
 *
 *   buildCloudSnapshot   an immutable, Worker-admissible occurrence body from explicit minimal inputs and the
 *                        caller-captured occurrence id, registration epoch/revision and executionAt. The Riyadh day
 *                        comes from that instant; the planner context is exactly the pre-target-week completions
 *                        `{skillId, quest, at}`, the target-week plan rows (zero-minute tombstones included), gear/
 *                        edition and the captured context time. Unsupported ids, bad chronology and size/count excess
 *                        are REFUSED (never truncated, never renamed); the allowlisted body is a deep, frozen copy and
 *                        is checked with the Worker's own admission validator at its own executionAt.
 *   previewCloudRun      what the Worker would build for that body: the REAL `buildOutput` (lib/workflows.ts) with
 *                        the actual occurrence id and executionAt, earlier plan outputs folded in action order exactly
 *                        as the Worker's adapter (workflowRun.ts) does, fail-fast with the successful prefix kept and
 *                        the suffix skipped. A record outside the Worker's draft allowlist (e.g. generated text over
 *                        4,000 UTF-16 units, which the local builder accepts) fails the step `invalid` with an explicit
 *                        cloud `limitation` - never truncated, never widened.
 *
 * No store, storage, publish job, provider action, random id, clock or network. Only the Worker's pure protocol/time
 * modules and the dashboard's own builders are imported (no coordinator, router, storage or Cloudflare class).
 */

import type { Lang, PlanItem, WorkflowAction, WorkflowInput, WorkflowText } from "@/lib/domain";
import { weekKey } from "@/lib/streak";
import { articleInput, buildOutput, manualInput, type PlanContext } from "@/lib/workflows";
import { riyadhDay } from "@/workers/scout/src/social/time";
import {
  byteLength,
  canonicalJson,
  checkBody,
  isIso,
  isObj,
  payloadDigestOf,
  sha256Hex,
  validOutput,
  weekOf,
  type Obj,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import { cloneJson, deepFreeze } from "./cloudWorkflowProtocol";

/** The Worker's no-workflow-before-this bound (workflowProtocol.ts EPOCH_MIN_MS), pinned by the tests. */
const EPOCH_MIN_MS = Date.parse("2020-01-01T00:00:00.000Z");
/** The Worker's context caps (workflowProtocol.ts COMPLETIONS_MAX / PLAN_ITEMS_MAX), pinned by the tests. */
const COMPLETIONS_MAX = 200;
const PLAN_ITEMS_MAX = 100;
/** The Worker's draft text bound (workflowProtocol.ts OUTPUT_TEXT_MAX), in UTF-16 code units. */
const OUTPUT_TEXT_MAX = 4_000;

export interface CloudSnapshotParams {
  readonly ownerKey: string;
  /** Caller-captured: a fresh manual id, or the Ready id (`readyOccurrenceId`). */
  readonly occurrenceId: string;
  readonly registrationEpoch: number;
  readonly revision: number;
  /** The captured instant (ISO string or Date); the Riyadh day of the run is derived from it. */
  readonly executionAt: string | Date;
  readonly workflow: {
    readonly id: string;
    readonly name: WorkflowText;
    readonly trigger: { readonly kind: "manual" | "article-ready" };
    readonly actions: readonly WorkflowAction[];
  };
  readonly lang: Lang;
  /** Required for a Ready trigger, absent for a manual run (a manual run captures no article). */
  readonly article?: {
    readonly id: string;
    readonly title: WorkflowText;
    readonly summary: WorkflowText;
    readonly slug: string;
    readonly skillId?: string;
  };
  /** Required when any action is a plan step; ignored (no context is carried) otherwise. */
  readonly planner?: {
    readonly completions: readonly { skillId: string; quest: string; at: string | Date }[];
    readonly planItems: readonly PlanItem[];
    readonly settings: { readonly gear: readonly string[]; readonly davinciEdition: string };
    readonly contextAt: string | Date;
  };
}

export type SnapshotRefusal =
  | "invalid"
  | "unsupported_id"
  | "too_large"
  | "chronology"
  | "count_exceeded"
  | "planner_required"
  | "article_mismatch";

export interface CloudSnapshot {
  /** Deeply frozen, exactly the Worker's admission shape. */
  readonly body: OccurrenceBody;
  /** sha256 hex of the canonical JSON of the body (the digest is not part of the body). */
  readonly payloadDigest: string;
  readonly bodyBytes: number;
  readonly contextBytes: number;
  /** The Riyadh day of executionAt. */
  readonly day: string;
  /** The planner week (Saturday) of that day, or null when no plan step carries a context. */
  readonly week: string | null;
}

export type SnapshotResult =
  | { readonly ok: true; readonly snapshot: CloudSnapshot }
  | { readonly ok: false; readonly reason: SnapshotRefusal; readonly detail?: string };

class Refuse extends Error {
  constructor(
    readonly reason: SnapshotRefusal,
    readonly detail?: string,
  ) {
    super(reason);
  }
}
function need(ok: boolean, reason: SnapshotRefusal = "invalid", detail?: string): asserts ok {
  if (!ok) throw new Refuse(reason, detail);
}

/** A canonical ISO instant from an ISO string or a valid Date; anything else is a chronology refusal. */
function instant(v: unknown, what: string): string {
  const iso = v instanceof Date ? (Number.isNaN(v.getTime()) ? null : v.toISOString()) : v;
  need(typeof iso === "string" && isIso(iso), "chronology", what);
  return iso;
}

/** A completion's instant: the dashboard stores offset ISO times (`+03:00`); the same instant as canonical UTC. */
const OFFSET_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
function completionInstant(v: unknown): string {
  need(
    typeof v === "string" && OFFSET_ISO_RE.test(v) && Number.isFinite(Date.parse(v)),
    "chronology",
    "completion",
  );
  return new Date(v).toISOString();
}

/** The allowlisted copy of one action (anything unknown is left for the Worker's validator to refuse). */
function actionOf(a: unknown): Obj {
  if (!isObj(a)) return { kind: undefined };
  const lt = (t: unknown) => (isObj(t) ? { ...t } : t);
  if (a.kind === "idea")
    return {
      id: a.id,
      kind: a.kind,
      text: lt(a.text),
      ...(a.platform !== undefined ? { platform: a.platform } : {}),
    };
  if (a.kind === "post")
    return {
      id: a.id,
      kind: a.kind,
      platform: a.platform,
      title: lt(a.title),
      caption: lt(a.caption),
      offsetDays: a.offsetDays,
    };
  if (a.kind === "plan")
    return {
      id: a.id,
      kind: a.kind,
      quest: a.quest,
      ...(a.skillId !== undefined ? { skillId: a.skillId } : {}),
      minutes: a.minutes,
      day: a.day,
    };
  return { id: a.id, kind: a.kind };
}

/** The planner context of a target week: exactly the slices the Worker's builders read. */
function plannerContextOf(pl: unknown, week: string, executionAt: string): Obj {
  need(
    isObj(pl) && Array.isArray(pl.completions) && Array.isArray(pl.planItems) && isObj(pl.settings),
  );
  const contextAt = instant(pl.contextAt, "contextAt");
  need(Date.parse(contextAt) <= Date.parse(executionAt), "chronology", "contextAt");
  const completions = (pl.completions as unknown[]).flatMap((c) => {
    need(isObj(c));
    const at = completionInstant(c.at instanceof Date ? c.at.toISOString() : c.at);
    // Only the history before the target week (what buildWeekPlan reads); the rest is not context.
    return riyadhDay(at) < week ? [{ skillId: c.skillId, quest: c.quest, at }] : [];
  });
  const planItems = (pl.planItems as unknown[]).flatMap((p) => {
    need(isObj(p));
    // Only rows of the target week, zero-minute tombstones included.
    return p.week === week
      ? [
          {
            id: p.id,
            week: p.week,
            day: p.day,
            skillId: p.skillId,
            quest: p.quest,
            minutes: p.minutes,
            by: p.by,
          },
        ]
      : [];
  });
  need(completions.length <= COMPLETIONS_MAX, "count_exceeded", "completions");
  need(planItems.length <= PLAN_ITEMS_MAX, "count_exceeded", "planItems");
  const s = pl.settings;
  return {
    targetWeek: week,
    completions,
    planItems,
    settings: {
      gear: Array.isArray(s.gear) ? [...s.gear] : s.gear,
      davinciEdition: s.davinciEdition,
    },
    contextAt,
  };
}

/** A Worker-admissible, immutable occurrence snapshot, or the reason it cannot be one. */
export async function buildCloudSnapshot(p: CloudSnapshotParams): Promise<SnapshotResult> {
  try {
    need(isObj(p) && isObj(p.workflow));
    const executionAt = instant(p.executionAt, "executionAt");
    need(Date.parse(executionAt) >= EPOCH_MIN_MS, "chronology", "executionAt");
    const kind = p.workflow.trigger?.kind;
    need(kind === "manual" || kind === "article-ready");
    // `ar-` marks a Ready id; `ar-`/`sc-` are reserved from manual ids (workflowProtocol.ts checkBody).
    if (typeof p.occurrenceId === "string")
      need(
        kind === "article-ready"
          ? p.occurrenceId.startsWith("ar-")
          : !/^(ar|sc)-/.test(p.occurrenceId),
        "unsupported_id",
        "occurrenceId",
      );
    need((kind === "article-ready") === (p.article !== undefined), "article_mismatch");
    const day = riyadhDay(executionAt);
    const date = new Date(executionAt);
    const input: WorkflowInput =
      kind === "manual" ? manualInput(p.lang, date) : articleInput(p.article!, p.lang, date);
    const actions = Array.isArray(p.workflow.actions) ? p.workflow.actions.map(actionOf) : [];
    const hasPlan = actions.some((a) => a.kind === "plan");
    need(!hasPlan || p.planner !== undefined, "planner_required");
    const body = cloneJson({
      occurrenceId: p.occurrenceId,
      ownerKey: p.ownerKey,
      workflowId: p.workflow.id,
      kind,
      registrationEpoch: p.registrationEpoch,
      revision: p.revision,
      snapshot: {
        name: isObj(p.workflow.name) ? { ...p.workflow.name } : p.workflow.name,
        trigger: { kind },
        actions,
      },
      plannerContext: hasPlan ? plannerContextOf(p.planner, weekOf(day), executionAt) : null,
      input,
      executionAt,
    });
    // The Worker's own admission validator at the snapshot's own instant (its skew check is the Worker's clock).
    const chk = checkBody(body, Date.parse(executionAt));
    if (!chk.ok) throw new Refuse(chk.error === "bad_request" ? "invalid" : chk.error);
    const frozen = deepFreeze(chk.body);
    return {
      ok: true,
      snapshot: Object.freeze({
        body: frozen,
        payloadDigest: await payloadDigestOf(frozen),
        bodyBytes: byteLength(canonicalJson(frozen)),
        contextBytes: frozen.plannerContext ? byteLength(canonicalJson(frozen.plannerContext)) : 0,
        day,
        week: frozen.plannerContext ? frozen.plannerContext.targetWeek : null,
      }),
    };
  } catch (e) {
    return e instanceof Refuse
      ? { ok: false, reason: e.reason, ...(e.detail ? { detail: e.detail } : {}) }
      : { ok: false, reason: "invalid" };
  }
}

/* ---------- cloud preflight ---------- */

export type CloudLimitation = "output-too-large" | "output-invalid";

export type PreviewStep =
  | {
      readonly status: "built";
      readonly actionId: string;
      readonly kind: "idea" | "post" | "plan";
      /** `wf:<occurrenceId>:<actionId>` - the actual occurrence id, never a preview id. */
      readonly outputId: string;
      /** The record exactly as the Worker would store it (canonical-JSON round trip). */
      readonly record: Obj;
      /** sha256 hex of the canonical JSON of that record. */
      readonly digest: string;
    }
  | {
      readonly status: "failed";
      readonly actionId: string;
      readonly kind: "idea" | "post" | "plan";
      readonly error: string;
      readonly limitation?: CloudLimitation;
    }
  | {
      readonly status: "skipped";
      readonly actionId: string;
      readonly kind: "idea" | "post" | "plan";
    };

export interface CloudPreview {
  readonly occurrenceId: string;
  readonly executionAt: string;
  readonly steps: readonly PreviewStep[];
  readonly built: number;
  /** The terminal state the Worker would reach: all built = done, a built prefix then a failure = partial. */
  readonly outcome: "done" | "partial" | "failed";
  /** Set when the first failure is a cloud limit the local builder does not have. */
  readonly limitation: CloudLimitation | null;
}

export type PreviewResult =
  | { readonly ok: true; readonly preview: CloudPreview }
  | { readonly ok: false; readonly reason: "invalid" };

const textsOf = (r: Obj): unknown[] => [r.text, r.title, r.caption];

/** What the cloud Worker would build for an admitted body (see the header). */
export async function previewCloudRun(body: OccurrenceBody): Promise<PreviewResult> {
  try {
    // DT-7C-1-R1: validate and build from ONE detached copy taken before the first await. `checkBody` returns the
    // object it was given, so checking the caller's body would let later edits (appended actions, other dates or
    // text) mix into the steps and metadata. The caller's object is never frozen or modified.
    const copy = cloneJson(body);
    need(isObj(copy) && typeof copy.executionAt === "string");
    const chk = checkBody(copy, Date.parse(copy.executionAt));
    need(chk.ok);
    const b = chk.body;
    const pc = b.plannerContext;
    const steps: PreviewStep[] = [];
    // The plan rows the planner sees: the captured rows, then this occurrence's earlier plan outputs in order.
    let planItems: PlanItem[] = pc ? (pc.planItems as unknown as PlanItem[]) : [];
    let failure: { limitation?: CloudLimitation } | null = null;
    for (const [idx, action] of b.snapshot.actions.entries()) {
      const head = { actionId: action.id, kind: action.kind };
      if (failure) {
        steps.push({ status: "skipped", ...head });
        continue;
      }
      const fail = (error: string, limitation?: CloudLimitation) => {
        failure = limitation ? { limitation } : {};
        steps.push({ status: "failed", ...head, error, ...(limitation ? { limitation } : {}) });
      };
      if (action.kind === "plan" && (!pc || pc.targetWeek !== weekKey(b.input.day))) {
        fail("context-stale");
        continue;
      }
      const ctx = {
        completions: pc ? pc.completions : [],
        planItems,
        settings: pc ? { gear: pc.settings.gear, davinciEdition: pc.settings.davinciEdition } : {},
      } as unknown as PlanContext;
      const out = buildOutput(
        b.occurrenceId,
        action as unknown as WorkflowAction,
        b.input as unknown as WorkflowInput,
        ctx,
        new Date(b.executionAt),
      );
      if (!out.ok) {
        fail(out.error);
        continue;
      }
      if (!validOutput(out.record, b, idx)) {
        const long = textsOf(out.record as unknown as Obj).some(
          (t) => typeof t === "string" && t.length > OUTPUT_TEXT_MAX,
        );
        fail("invalid", long ? "output-too-large" : "output-invalid");
        continue;
      }
      // The Worker stores (and folds) the canonical-JSON form of the record.
      const record = JSON.parse(canonicalJson(out.record)) as Obj;
      if (out.kind === "plan") planItems = [...planItems, record as unknown as PlanItem];
      steps.push({
        status: "built",
        ...head,
        outputId: record.id as string,
        record,
        digest: await sha256Hex(canonicalJson(record)),
      });
    }
    const built = steps.filter((s) => s.status === "built").length;
    const failedStep = steps.find((s) => s.status === "failed");
    return {
      ok: true,
      preview: deepFreeze({
        occurrenceId: b.occurrenceId,
        executionAt: b.executionAt,
        steps,
        built,
        outcome: failure ? (built > 0 ? "partial" : "failed") : "done",
        limitation:
          failedStep && failedStep.status === "failed" ? (failedStep.limitation ?? null) : null,
      }),
    };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
