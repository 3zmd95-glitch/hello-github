/**
 * ⚙️ The fixed server step builder (packet DT-7B-2, planning/tools/38-cloud-workflows.md): one occurrence step built
 * by the dashboard's REAL shared draft builder, `buildOutput` from lib/workflows.ts (imported through the Worker's
 * `@/*` resolver; no copied or forked logic). The coordinator's `run` op imports it statically; nothing selects it
 * per request.
 *
 *   inputs        the stored immutable body only: the action snapshot, the input, `new Date(executionAt)` as the
 *                 builder clock, and the captured planner context projected exactly — pre-week completions,
 *                 target-week planner rows (manual rows and zero-minute tombstones), gear and DaVinci edition —
 *                 plus the plan outputs of THIS occurrence's earlier steps folded in action order (as `previewRun`).
 *   ids           the builder's own `wf:<occurrenceId>:<actionId>` (`workflowOutputId`).
 *   errors        the builder's codes unchanged (`empty-text`, `no-skill`, `unknown-skill`, `invalid`); a plan step
 *                 whose captured context is missing or of another week than the input day fails `context-stale`
 *                 (fail-fast in the coordinator: earlier outputs kept, later steps skipped).
 *   records       the builder's record as is; one outside the draft allowlist (e.g. a template that expands past
 *                 the output text bound) fails the step `invalid` — never truncated, never widened.
 *
 * Pure: no storage, no network, no wall clock. Parity holds only for identical builder/catalog pins (release gate:
 * planning/collaboration/dt7b-candidate/7b2-builder-pins.sha256); no cross-version equivalence is claimed.
 */

import { buildOutput, type PlanContext } from "@/lib/workflows";
import { weekKey } from "@/lib/streak";
import type { WorkflowAction, WorkflowInput } from "@/lib/domain";
import type { StepBuilder } from "./workflowCoordinator";
import { outputIdOf, validOutput } from "./workflowProtocol";

export const runStep: StepBuilder = ({ body, idx, action, prior }) => {
  const pc = body.plannerContext;
  if (action.kind === "plan" && (!pc || pc.targetWeek !== weekKey(body.input.day)))
    return { error: "context-stale" };
  // Earlier plan outputs of this occurrence only, in action order (the builder's planner sees the rows before it).
  const folded = body.snapshot.actions.slice(0, idx).flatMap((a) => {
    const o = prior.find(
      (p) =>
        p.actionId === a.id &&
        p.kind === "plan" &&
        p.outputId === outputIdOf(body.occurrenceId, a.id),
    );
    return a.kind === "plan" && o ? [o.record] : [];
  });
  // Idea and post steps never read the planner (a body without a plan step carries no context).
  const ctx = {
    completions: pc ? pc.completions : [],
    planItems: [...(pc ? pc.planItems : []), ...folded],
    settings: pc ? { gear: pc.settings.gear, davinciEdition: pc.settings.davinciEdition } : {},
  } as unknown as PlanContext;
  const out = buildOutput(
    body.occurrenceId,
    action as unknown as WorkflowAction,
    body.input as unknown as WorkflowInput,
    ctx,
    new Date(body.executionAt),
  );
  if (!out.ok) return { error: out.error };
  return validOutput(out.record, body, idx) ? { record: out.record } : { error: "invalid" };
};
