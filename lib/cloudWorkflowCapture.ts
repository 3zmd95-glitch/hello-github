/**
 * ⚙️ Cloud workflow trigger ownership + capture helpers (packet DT-7C-2B-3, planning/tools/38-cloud-workflows.md): PURE.
 * Which executor owns a NEW Manual/Ready trigger of one workflow, how a cloud capture is bound to its registration, and
 * how a batch of cloud occurrences enters the journal. Nothing here fetches, stores, reads a clock or knows a
 * credential: `store/index.ts` captures inputs, verifies, and commits under the shared `3z-prod-articles` lock.
 *
 *   ownership  derived from the registration records of the workflow across EVERY authority (re-verified through the
 *              pinned parser by `verifyOwnershipEvidence` first), the journal and the configured canonical origin.
 *              Conservative: anything unresolved, divergent, inconsistent, refused-after-active, unreadable,
 *              multiple, foreign, unconfigured or journal-only BLOCKS; local only with no evidence at all or with
 *              every lifecycle proven inactive (future triggers only: old journal entries stay cloud). R1: an inactive
 *              lifecycle discharges its authority's journal history only when its closed epoch history covers every
 *              entry (epoch + chronology); otherwise blocked. The full table is in the DT-7C-2B-3(-R1) handoff records.
 *   digest     `workflowDigestOf` = SHA-256 hex of canonicalJson({name, trigger, actions}) over exactly the allowlisted
 *              executable snapshot the accepted builder emits; id and revision are bound separately.
 *   admission  `admitEntries`: all-or-nothing; an identical existing key + digest is idempotent and consumes nothing,
 *              a changed digest conflicts, suppressed instants refuse, existing + new over 600 refuses (no eviction).
 */

import {
  canonicalJson,
  isObj,
  sha256Hex,
  type Obj,
} from "@/workers/scout/src/social/workflowProtocol";
import {
  authorityKey,
  authorityOf,
  type Authority,
  type Registration,
} from "./cloudWorkflowProtocol";
import {
  isUnresolved,
  sameData,
  verifyRegistrations,
  type CloudRegistrations,
  type RegistrationRecord,
  type WireAnswer,
} from "./cloudWorkflowRegistration";
import {
  JOURNAL_CAPACITY,
  isSuppressed,
  withEntry,
  type Candidate,
  type CloudJournal,
  type JournalEntry,
} from "./cloudWorkflowJournal";

/* ---------- ownership ---------- */

export type OwnershipBlock =
  | "unreadable"
  | "unresolved"
  | "divergent"
  | "inconsistent"
  | "refused-active"
  | "multiple-active"
  | "not-configured"
  | "foreign-worker"
  | "journal-only";

export type Ownership =
  | { readonly kind: "local"; readonly basis: "none" | "unregistered" }
  | { readonly kind: "cloud"; readonly authority: Authority; readonly registration: Registration }
  | { readonly kind: "blocked"; readonly cause: OwnershipBlock };

/** Every registration record of the workflow, across origins and owners. */
export const relatedRecords = (
  regs: CloudRegistrations,
  workflowId: string,
): RegistrationRecord[] => regs.records.filter((r) => r.workflowId === workflowId);

/** Exactly the related records' stored answers and observations re-parsed through the pinned parser now. */
export function verifyOwnershipEvidence(
  regs: CloudRegistrations,
  workflowIds: readonly string[],
): Promise<boolean> {
  const records = regs.records.filter((r) => workflowIds.includes(r.workflowId));
  return records.length ? verifyRegistrations({ ...regs, records }) : Promise.resolve(true);
}

const regOf = (a: WireAnswer | null | undefined): Registration | null =>
  a && isObj(a.body.registration) ? (a.body.registration as unknown as Registration) : null;

type Classified =
  | { readonly state: "active"; readonly reg: Registration }
  | { readonly state: "inactive" }
  | { readonly state: "blocked"; readonly cause: OwnershipBlock };

function classify(r: RegistrationRecord): Classified {
  const i = r.intent;
  if (isUnresolved(i)) return { state: "blocked", cause: "unresolved" };
  if (i.state === "divergent") return { state: "blocked", cause: "divergent" };
  const last = regOf(r.last?.answer);
  if (i.state === "settled") {
    const ans = regOf(i.answer);
    if (!ans || !last || !sameData(ans, last)) return { state: "blocked", cause: "inconsistent" };
    return ans.state === "active" ? { state: "active", reg: ans } : { state: "inactive" };
  }
  // A typed refusal applied nothing: the lifecycle is what was observed before it.
  return last?.state === "active"
    ? { state: "blocked", cause: "refused-active" }
    : { state: "inactive" };
}

/**
 * DT-7C-2B-3-R1: an inactive record's journal history is discharged only by its own lifecycle proof: the newest bound
 * observation (`last`) must be an unregistered registration whose closed epoch history names each entry's epoch, with
 * the entry's executionAt inside that closed interval (both ends inclusive). No lifecycle at all (a refused first
 * registration) is `journal-only`; anything else uncovered (a newer epoch, outside its interval) is `inconsistent`.
 */
function uncovered(
  rec: RegistrationRecord,
  entries: readonly JournalEntry[],
): OwnershipBlock | null {
  if (!entries.length) return null;
  const proof = regOf(rec.last?.answer);
  if (!proof) return "journal-only";
  const covered = (e: JournalEntry) => {
    const ep = proof.epochs.find((x) => x.epoch === e.body.registrationEpoch);
    const t = Date.parse(e.executionAt);
    return (
      proof.state === "unregistered" &&
      !!ep &&
      ep.closedAt !== undefined &&
      Date.parse(ep.openedAt) <= t &&
      t <= Date.parse(ep.closedAt)
    );
  };
  return entries.every(covered) ? null : "inconsistent";
}

/**
 * Who owns a new trigger of `workflowId`. `registrations` must already be verified (`verifyOwnershipEvidence`); null
 * (unreadable or failed verification) or a null journal blocks. Never throws.
 */
export function resolveOwnership(input: {
  readonly workflowId: string;
  readonly registrations: CloudRegistrations | null;
  readonly journal: CloudJournal | null;
  readonly configuredOrigin: string | null;
}): Ownership {
  const blocked = (cause: OwnershipBlock): Ownership => ({ kind: "blocked", cause });
  const { workflowId, registrations, journal, configuredOrigin } = input;
  if (!registrations || !journal) return blocked("unreadable");
  const related = relatedRecords(registrations, workflowId);
  const history = journal.entries.filter((e) => e.body.workflowId === workflowId);
  const known = new Set(related.map((r) => canonicalJson([r.origin, r.ownerKey])));
  if (history.some((e) => !known.has(authorityKey(e.authority)))) return blocked("journal-only");
  const actives: { rec: RegistrationRecord; reg: Registration }[] = [];
  for (const rec of related) {
    const c = classify(rec);
    if (c.state === "blocked") return blocked(c.cause);
    if (c.state === "active") actives.push({ rec, reg: c.reg });
    else {
      const key = canonicalJson([rec.origin, rec.ownerKey]);
      const gap = uncovered(
        rec,
        history.filter((e) => authorityKey(e.authority) === key),
      );
      if (gap) return blocked(gap);
    }
  }
  if (actives.length > 1) return blocked("multiple-active");
  if (actives.length === 1) {
    const { rec, reg } = actives[0];
    if (configuredOrigin === null) return blocked("not-configured");
    if (rec.origin !== configuredOrigin) return blocked("foreign-worker");
    const authority = authorityOf(rec.origin, rec.ownerKey);
    return authority ? { kind: "cloud", authority, registration: reg } : blocked("unreadable");
  }
  return { kind: "local", basis: related.length ? "unregistered" : "none" };
}

/* ---------- definition digest and binding ---------- */

const text = (t: unknown) => (isObj(t) ? { ar: t.ar, en: t.en } : t);

/** The allowlisted copy of one action: the snapshot builder's fields, nothing else. */
function actionOf(a: unknown): Obj {
  if (!isObj(a)) return { kind: undefined };
  if (a.kind === "idea")
    return { id: a.id, kind: a.kind, text: text(a.text), platform: a.platform };
  if (a.kind === "post")
    return {
      id: a.id,
      kind: a.kind,
      platform: a.platform,
      title: text(a.title),
      caption: text(a.caption),
      offsetDays: a.offsetDays,
    };
  if (a.kind === "plan")
    return {
      id: a.id,
      kind: a.kind,
      quest: a.quest,
      skillId: a.skillId,
      minutes: a.minutes,
      day: a.day,
    };
  return { id: a.id, kind: a.kind };
}

/**
 * SHA-256 hex of canonicalJson({name, trigger, actions}) over the allowlisted executable definition (id, revision,
 * enabled, commitId, timestamps and unknown fields excluded), or null when it is not canonical JSON.
 */
export async function workflowDigestOf(def: {
  readonly name: unknown;
  readonly trigger: unknown;
  readonly actions: unknown;
}): Promise<string | null> {
  let canonical: string;
  try {
    if (!isObj(def) || !Array.isArray(def.actions)) return null;
    const trigger = isObj(def.trigger) ? { kind: def.trigger.kind } : def.trigger;
    canonical = canonicalJson({
      name: text(def.name),
      trigger,
      actions: def.actions.map(actionOf),
    });
  } catch {
    return null;
  }
  return sha256Hex(canonical);
}

export type BindingRefusal = "registration-paused" | "definition-mismatch" | "chronology";

/**
 * A cloud capture bound to its active registration: not paused, the same revision and digest, and `executionAt` inside
 * the named open epoch (at or after it opened; no skew correction). Null = bound.
 */
export function bindRegistration(input: {
  readonly workflow: { readonly revision: number };
  readonly registration: Registration;
  readonly digest: string | null;
  readonly executionAt: string;
}): BindingRefusal | null {
  const { workflow, registration: reg, digest, executionAt } = input;
  if (reg.paused) return "registration-paused";
  if (workflow.revision !== reg.revision || digest === null || digest !== reg.workflowDigest)
    return "definition-mismatch";
  const epoch = reg.epochs.find((e) => e.epoch === reg.registrationEpoch);
  if (
    reg.state !== "active" ||
    !epoch ||
    epoch.closedAt !== undefined ||
    !(Date.parse(epoch.openedAt) <= Date.parse(executionAt))
  )
    return "chronology";
  return null;
}

/* ---------- journal admission ---------- */

export type Admission =
  | {
      readonly ok: true;
      /** The journal to write (the input itself when every candidate was already there). */
      readonly next: CloudJournal;
      /** One entry per candidate, in order: the existing identical one or the new one. */
      readonly entries: readonly JournalEntry[];
      readonly created: readonly string[];
    }
  | { readonly ok: false; readonly reason: "capacity" | "suppressed" }
  | { readonly ok: false; readonly reason: "conflict"; readonly key: string };

/** A batch of validated candidates admitted together, or refused together (see the header). */
export function admitEntries(
  journal: CloudJournal,
  candidates: readonly Candidate[],
  commitId: string,
): Admission {
  const fresh: Candidate[] = [];
  for (const c of candidates) {
    const cur = journal.entries.find((e) => e.key === c.key);
    if (cur) {
      if (cur.payloadDigest !== c.payloadDigest)
        return { ok: false, reason: "conflict", key: c.key };
      continue;
    }
    if (fresh.some((f) => f.key === c.key)) return { ok: false, reason: "conflict", key: c.key };
    if (isSuppressed(c.executionAt, journal.suppression))
      return { ok: false, reason: "suppressed" };
    fresh.push(c);
  }
  if (journal.entries.length + fresh.length > JOURNAL_CAPACITY)
    return { ok: false, reason: "capacity" };
  let next = journal;
  for (const c of fresh)
    next = withEntry(next, { ...c, commitId, state: "queued", observation: null }, commitId);
  if (fresh.length) next = { ...next, generation: journal.generation + 1 };
  const entries = candidates.map((c) => next.entries.find((e) => e.key === c.key)!);
  return { ok: true, next, entries, created: fresh.map((c) => c.key) };
}

/* ---------- public projection ---------- */

/** What a capture reports about a cloud entry: identity only (no body, context, input, receipt or credential). */
export interface CloudCaptureView {
  readonly key: string;
  readonly origin: string;
  readonly ownerKey: string;
  readonly occurrenceId: string;
  readonly workflowId: string;
  readonly kind: "manual" | "article-ready";
  readonly executionAt: string;
  readonly payloadDigest: string;
  readonly commitId: string;
  readonly state: JournalEntry["state"];
}

export const captureView = (e: JournalEntry): CloudCaptureView => ({
  key: e.key,
  origin: e.authority.origin,
  ownerKey: e.authority.ownerKey,
  occurrenceId: e.occurrenceId,
  workflowId: e.body.workflowId,
  kind: e.body.kind as CloudCaptureView["kind"],
  executionAt: e.executionAt,
  payloadDigest: e.payloadDigest,
  commitId: e.commitId,
  state: e.state,
});
