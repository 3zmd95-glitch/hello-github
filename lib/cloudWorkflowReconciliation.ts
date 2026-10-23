/**
 * ⚙️ Cloud workflow reconciliation kernel (packet DT-7C-2C, planning/tools/38-cloud-workflows.md): PURE, unactivated.
 * The durable proof of what a verified full cloud receipt delivered into the local draft lists, and the bounded state a
 * later explicit reconciliation needs (per-authority cursor and retirement generation, pending feed items, compact
 * tombstones, the `cloudWorkflowRuns` projection). Nothing here fetches, stores, reads a clock or knows a credential:
 * `store/index.ts` persists it as the opaque `cloudReconciliation` slice under the shared `3z-prod-articles` lock.
 *
 *   proof        keyed by `occurrenceKey(authority, occurrenceId)`. Immutable binding: authority, occurrenceId,
 *                workflowId, payloadDigest, source (`journal` | `remote-initial`), firstVersion. Holds the latest
 *                accepted FULL receipt as plain JSON (re-parsed through the pinned `parseAnswer` before any use:
 *                `verifyProof`), the reset epoch and local commit token of its last commit, and, once terminal, one
 *                disposition per receipt output: adopted | retained (edited) | deleted | suppressed | collision.
 *   ownership    an output is owned by the proof that adopted it (adopted/retained/deleted) or by a tombstone's deleted
 *                list; an owned id is never adopted by another proof or authority, a deleted one never comes back.
 *   ordering     receipts compare like journal observations (`compareObservations`): higher version newer, equal
 *                version identical or ack-only addition, anything else a conflict.
 *   retirement   only a bound pruned status with the same digest: the proof becomes a compact tombstone keeping its
 *                ownership (owned + deleted ids) and its final change_seq, and the authority's retirement generation
 *                advances (held receipts captured before it are stale in the store). Never evicted: at 100 tombstones
 *                further retirement refuses `retirement-full`, keeping the full proof and all output ownership. Proofs + tombstones ≤ 600: a new proof at the cap is
 *                `proof-full`, never eviction.
 *   import       `mergeReconciliations`: union, monotonic, deletion evidence unioned, tombstones beat proofs; imported
 *                legacy watermarks refuse restore rather than infer lost ownership; the merged reset suppresses the
 *                outputs of proofs and tombstones first learned from the backup.
 */

import {
  DIGEST_RE,
  WF_ID_RE,
  canonicalJson,
  exactKeys,
  fits,
  isCount,
  isIso,
  isObj,
  isVersion,
  type Obj,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import { IdeaSchema, PlanItemSchema, PostSchema } from "./domain";
import {
  authorityKey,
  authorityOf,
  cloneJson,
  occurrenceKey,
  parseAnswer,
  type Authority,
  type FullReceipt,
} from "./cloudWorkflowProtocol";
import {
  compareObservations,
  isSuppressed,
  sameData,
  type CloudJournal,
  type Observation,
  type Suppression,
} from "./cloudWorkflowJournal";

export const PROOF_CAPACITY = 600;
export const TOMBSTONES_MAX = 100;
export const CLOUD_RUNS_MAX = 200;

export type Disposition = "adopted" | "retained" | "deleted" | "suppressed" | "collision";
type Kind = "idea" | "post" | "plan";

export interface ProofOutput {
  readonly outputId: string;
  readonly actionId: string;
  readonly kind: Kind;
  readonly digest: string;
  readonly disposition: Disposition;
}
export interface ProofRecord {
  readonly key: string;
  readonly authority: Authority;
  readonly occurrenceId: string;
  readonly workflowId: string;
  readonly source: "journal" | "remote-initial";
  readonly payloadDigest: string;
  readonly firstVersion: number;
  readonly resetEpoch: number;
  readonly commitId: string;
  /** The latest accepted full receipt, plain JSON (untrusted until `verifyProof`). */
  readonly receipt: Obj;
  /** [] until the receipt is terminal; then exactly the receipt's outputs, in order. */
  readonly outputs: readonly ProofOutput[];
}
export interface Tombstone {
  readonly key: string;
  readonly authority: Authority;
  readonly occurrenceId: string;
  readonly payloadDigest: string;
  readonly prunedAt: string;
  readonly deleted: readonly string[];
  /** DT-7C-2C-R1: ids still owned and present at retirement (absent in the C2C format: none recorded). */
  readonly owned?: readonly string[];
  /** DT-7C-2C-R1: the retired terminal receipt's change_seq (final: a terminal row never changes); null/absent = unknown. */
  readonly changeSeq?: number | null;
  /** Verified occurrence execution time; older markers omit it and cannot establish post-reset work. */
  readonly executionAt?: string;
}
export interface AuthorityRecord {
  readonly key: string;
  readonly authority: Authority;
  readonly cursor: number;
  readonly retired: number;
  /** DT-7C-2C-R1: the highest final change_seq folded out of the tombstone list (absent = 0). */
  readonly watermark?: number;
}
export interface PendingRecord {
  readonly key: string;
  readonly authority: Authority;
  readonly occurrenceId: string;
  readonly changeSeq: number;
  readonly receiptVersion: number;
  readonly payloadDigest: string;
  readonly reason: string;
}
export interface CloudRunStep {
  readonly idx: number;
  readonly actionId: string;
  readonly kind: Kind;
  readonly status: "pending" | "done" | "failed" | "skipped";
  readonly outputId?: string;
  readonly error?: string;
}
/** The `cloudWorkflowRuns` projection: its own schema (cloud states), never the local WorkflowRun. */
export interface CloudRun {
  readonly key: string;
  readonly authority: Authority;
  readonly occurrenceId: string;
  readonly workflowId: string;
  readonly kind: "manual" | "article-ready";
  readonly state: "pending" | "running" | "done" | "partial" | "failed" | "cancelled";
  readonly receiptVersion: number;
  readonly changeSeq: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly finishedAt?: string;
  readonly steps: readonly CloudRunStep[];
}
export interface CloudReconciliation {
  readonly v: 1;
  readonly generation: number;
  readonly commitId: string | null;
  readonly authorities: readonly AuthorityRecord[];
  readonly proofs: readonly ProofRecord[];
  readonly tombstones: readonly Tombstone[];
  readonly pending: readonly PendingRecord[];
  readonly runs: readonly CloudRun[];
}
type Row = { readonly id: string };
export interface OutputLists {
  readonly ideas: readonly Row[];
  readonly posts: readonly Row[];
  readonly planItems: readonly Row[];
}

export const emptyReconciliation = (): CloudReconciliation => ({
  v: 1,
  generation: 0,
  commitId: null,
  authorities: [],
  proofs: [],
  tombstones: [],
  pending: [],
  runs: [],
});

const TERMINAL = new Set(["done", "partial", "failed", "cancelled"]);
const KINDS: readonly unknown[] = ["idea", "post", "plan"];
const DISPOSITIONS: readonly unknown[] = [
  "adopted",
  "retained",
  "deleted",
  "suppressed",
  "collision",
];
const OWNED = new Set<Disposition>(["adopted", "retained", "deleted"]);
const PRESENT = new Set<Disposition>(["adopted", "retained"]);
const RANK: Record<Disposition, number> = {
  adopted: 0,
  retained: 1,
  suppressed: 2,
  collision: 3,
  deleted: 4,
};
const SCHEMA = { idea: IdeaSchema, post: PostSchema, plan: PlanItemSchema };
const same = sameData;
const byKey = <T extends { key: string }>(a: T, b: T) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
const isToken = (v: unknown): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= 200;
const plainAuth = (a: Authority): Authority => ({ origin: a.origin, ownerKey: a.ownerKey });

/* ---------- structural parse (sync) ---------- */

function authOk(a: unknown): a is Authority {
  if (!isObj(a) || !exactKeys(a, ["origin", "ownerKey"])) return false;
  const auth = authorityOf(a.origin, a.ownerKey);
  return !!auth && same(auth, a);
}
const outputIdOk = (o: Obj, occurrenceId: string) =>
  o.outputId === `wf:${occurrenceId}:${o.actionId}`;
const identity = (o: Obj) => [o.outputId, o.actionId, o.kind, o.digest];

function proofOk(p: unknown): p is ProofRecord {
  if (
    !isObj(p) ||
    !exactKeys(p, [
      "key",
      "authority",
      "occurrenceId",
      "workflowId",
      "source",
      "payloadDigest",
      "firstVersion",
      "resetEpoch",
      "commitId",
      "receipt",
      "outputs",
    ]) ||
    !authOk(p.authority) ||
    typeof p.occurrenceId !== "string" ||
    p.key !== occurrenceKey(p.authority, p.occurrenceId) ||
    !fits(p.workflowId, WF_ID_RE) ||
    (p.source !== "journal" && p.source !== "remote-initial") ||
    !fits(p.payloadDigest, DIGEST_RE) ||
    !isVersion(p.firstVersion) ||
    !isCount(p.resetEpoch) ||
    !isToken(p.commitId) ||
    !isObj(p.receipt) ||
    !Array.isArray(p.outputs)
  )
    return false;
  const r = p.receipt;
  if (
    r.occurrenceId !== p.occurrenceId ||
    r.workflowId !== p.workflowId ||
    r.payloadDigest !== p.payloadDigest ||
    !isVersion(r.receiptVersion) ||
    (r.receiptVersion as number) < p.firstVersion ||
    !Array.isArray(r.outputs)
  )
    return false;
  const outs = p.outputs as unknown[];
  if (
    !outs.every(
      (o) =>
        isObj(o) &&
        exactKeys(o, ["outputId", "actionId", "kind", "digest", "disposition"]) &&
        fits(o.actionId, WF_ID_RE) &&
        KINDS.includes(o.kind) &&
        fits(o.digest, DIGEST_RE) &&
        DISPOSITIONS.includes(o.disposition) &&
        outputIdOk(o, p.occurrenceId as string),
    )
  )
    return false;
  // Terminal: exactly the receipt's output identities; nonterminal: none.
  return TERMINAL.has(r.state as string)
    ? same(
        outs.map((o) => identity(o as Obj)),
        (r.outputs as Obj[]).map((o) => identity(o)),
      )
    : outs.length === 0;
}

function tombstoneOk(t: unknown): t is Tombstone {
  if (
    !isObj(t) ||
    !exactKeys(
      t,
      ["key", "authority", "occurrenceId", "payloadDigest", "prunedAt", "deleted"],
      ["owned", "changeSeq", "executionAt"],
    ) ||
    !authOk(t.authority) ||
    typeof t.occurrenceId !== "string" ||
    t.key !== occurrenceKey(t.authority, t.occurrenceId) ||
    !fits(t.payloadDigest, DIGEST_RE) ||
    !isIso(t.prunedAt) ||
    !(t.executionAt === undefined || isIso(t.executionAt)) ||
    !(t.changeSeq === undefined || t.changeSeq === null || isVersion(t.changeSeq)) ||
    !Array.isArray(t.deleted) ||
    !(t.owned === undefined || Array.isArray(t.owned))
  )
    return false;
  const ids: unknown[] = [...t.deleted, ...((t.owned as unknown[] | undefined) ?? [])];
  return (
    ids.length <= 5 &&
    new Set(ids).size === ids.length &&
    ids.every((d) => typeof d === "string" && d.startsWith(`wf:${t.occurrenceId}:`))
  );
}

function authorityRecordOk(a: unknown): a is AuthorityRecord {
  return (
    isObj(a) &&
    exactKeys(a, ["key", "authority", "cursor", "retired"], ["watermark"]) &&
    authOk(a.authority) &&
    a.key === authorityKey(a.authority) &&
    isCount(a.cursor) &&
    isCount(a.retired) &&
    (a.watermark === undefined || isCount(a.watermark))
  );
}

function pendingOk(x: unknown): x is PendingRecord {
  return (
    isObj(x) &&
    exactKeys(x, [
      "key",
      "authority",
      "occurrenceId",
      "changeSeq",
      "receiptVersion",
      "payloadDigest",
      "reason",
    ]) &&
    authOk(x.authority) &&
    typeof x.occurrenceId === "string" &&
    x.key === occurrenceKey(x.authority, x.occurrenceId) &&
    isVersion(x.changeSeq) &&
    isVersion(x.receiptVersion) &&
    fits(x.payloadDigest, DIGEST_RE) &&
    isToken(x.reason)
  );
}

function runOk(x: unknown): x is CloudRun {
  return (
    isObj(x) &&
    exactKeys(
      x,
      [
        "key",
        "authority",
        "occurrenceId",
        "workflowId",
        "kind",
        "state",
        "receiptVersion",
        "changeSeq",
        "createdAt",
        "updatedAt",
        "steps",
      ],
      ["finishedAt"],
    ) &&
    authOk(x.authority) &&
    typeof x.occurrenceId === "string" &&
    x.key === occurrenceKey(x.authority, x.occurrenceId) &&
    fits(x.workflowId, WF_ID_RE) &&
    (x.kind === "manual" || x.kind === "article-ready") &&
    typeof x.state === "string" &&
    ["pending", "running", "done", "partial", "failed", "cancelled"].includes(x.state) &&
    isVersion(x.receiptVersion) &&
    isVersion(x.changeSeq) &&
    isIso(x.createdAt) &&
    isIso(x.updatedAt) &&
    (x.finishedAt === undefined || isIso(x.finishedAt)) &&
    Array.isArray(x.steps) &&
    x.steps.every(
      (s) =>
        isObj(s) &&
        exactKeys(s, ["idx", "actionId", "kind", "status"], ["outputId", "error"]) &&
        isCount(s.idx) &&
        fits(s.actionId, WF_ID_RE) &&
        KINDS.includes(s.kind) &&
        ["pending", "done", "failed", "skipped"].includes(s.status as string) &&
        (s.outputId === undefined || typeof s.outputId === "string") &&
        (s.error === undefined || typeof s.error === "string"),
    )
  );
}

/** Strictly increasing keys (sorted, unique). */
const sorted = (list: readonly { key: string }[]) =>
  list.every((x, i) => i === 0 || list[i - 1].key < x.key);

/**
 * The reconciliation a persisted/imported value holds, as a detached copy, or null when it is not exactly one (unknown
 * keys, a retargeted key, inconsistent outputs, duplicates, over capacity...). Receipts are re-verified by `verifyProof`.
 */
export function parseReconciliation(raw: unknown): CloudReconciliation | null {
  let j: unknown;
  try {
    j = cloneJson(raw);
  } catch {
    return null;
  }
  if (
    !isObj(j) ||
    !exactKeys(j, [
      "v",
      "generation",
      "commitId",
      "authorities",
      "proofs",
      "tombstones",
      "pending",
      "runs",
    ]) ||
    j.v !== 1 ||
    !isCount(j.generation) ||
    !(j.commitId === null || isToken(j.commitId))
  )
    return null;
  const { authorities, proofs, tombstones, pending, runs } = j;
  if (
    !Array.isArray(authorities) ||
    !authorities.every(authorityRecordOk) ||
    !sorted(authorities) ||
    !Array.isArray(proofs) ||
    !proofs.every(proofOk) ||
    !sorted(proofs) ||
    !Array.isArray(tombstones) ||
    tombstones.length > TOMBSTONES_MAX ||
    !tombstones.every(tombstoneOk) ||
    new Set(tombstones.map((t) => t.key)).size !== tombstones.length ||
    tombstones.some((t) => proofs.some((p) => p.key === t.key)) ||
    proofs.length + tombstones.length > PROOF_CAPACITY ||
    !Array.isArray(pending) ||
    pending.length > PROOF_CAPACITY ||
    !pending.every(pendingOk) ||
    !sorted(pending) ||
    !Array.isArray(runs) ||
    runs.length > PROOF_CAPACITY ||
    !runs.every(runOk) ||
    new Set(runs.map((r) => r.key)).size !== runs.length
  )
    return null;
  return j as unknown as CloudReconciliation;
}

/** A stored slice: absent is the empty reconciliation (never saved); anything else must parse (null = unreadable). */
export const readReconciliation = (raw: unknown): CloudReconciliation | null =>
  raw === undefined ? emptyReconciliation() : parseReconciliation(raw);

/** Exact read-back: the stored slice is, canonically, the reconciliation a commit wrote. */
export const reconciliationIs = (stored: unknown, expected: CloudReconciliation): boolean => {
  try {
    return stored !== undefined && canonicalJson(stored) === canonicalJson(expected);
  } catch {
    return false;
  }
};

/** `next` as the commit `commitId` (generation + 1), or `prev` itself when nothing changed. */
export function stamp(
  prev: CloudReconciliation,
  next: CloudReconciliation,
  commitId: string,
): CloudReconciliation {
  return same(prev, next) ? prev : { ...next, generation: prev.generation + 1, commitId };
}

/**
 * A persisted or imported proof re-verified now: its structure, then its receipt through the pinned parser as a status
 * row for its own authority, bound to its own payload digest. Returns the parser-branded receipt, or null. No saved flag.
 */
export async function verifyProof(raw: unknown): Promise<FullReceipt | null> {
  if (!proofOk(raw)) return null;
  const p = raw;
  const parsed = await parseAnswer(
    {
      kind: "status",
      ownerKey: p.authority.ownerKey,
      occurrenceId: p.occurrenceId,
      expect: { payloadDigest: p.payloadDigest },
    },
    { status: 200, body: { ownerKey: p.authority.ownerKey, occurrence: p.receipt } },
    { origin: p.authority.origin },
  );
  return parsed.outcome === "ok" &&
    parsed.kind === "status" &&
    parsed.result.found === "row" &&
    authorityKey(parsed.authority) === authorityKey(p.authority)
    ? parsed.result.receipt
    : null;
}

/* ---------- transitions (sync, pure) ---------- */

const obs = (auth: Authority, r: Obj): Observation => ({
  authority: plainAuth(auth),
  binding: {
    kind: "status",
    ownerKey: auth.ownerKey,
    occurrenceId: r.occurrenceId as string,
    payloadDigest: r.payloadDigest as string,
  },
  receipt: r as Observation["receipt"],
});

const findRow = (lists: OutputLists, id: string): Row | undefined =>
  lists.ideas.find((x) => x.id === id) ??
  lists.posts.find((x) => x.id === id) ??
  lists.planItems.find((x) => x.id === id);

/** Ids owned by any proof but `except`, and by every tombstone. */
function ownedIds(recon: CloudReconciliation, except?: string): Set<string> {
  const ids = new Set<string>();
  for (const p of recon.proofs)
    if (p.key !== except)
      for (const o of p.outputs) if (OWNED.has(o.disposition)) ids.add(o.outputId);
  for (const t of recon.tombstones) for (const d of [...t.deleted, ...(t.owned ?? [])]) ids.add(d);
  return ids;
}

function runOf(auth: Authority, key: string, r: Obj): CloudRun {
  return {
    key,
    authority: plainAuth(auth),
    occurrenceId: r.occurrenceId as string,
    workflowId: r.workflowId as string,
    kind: r.kind as CloudRun["kind"],
    state: r.state as CloudRun["state"],
    receiptVersion: r.receiptVersion as number,
    changeSeq: r.changeSeq as number,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
    ...(typeof r.finishedAt === "string" ? { finishedAt: r.finishedAt } : {}),
    steps: (r.steps as Obj[]).map((s) => ({
      idx: s.idx as number,
      actionId: s.actionId as string,
      kind: s.kind as Kind,
      status: s.status as CloudRunStep["status"],
      ...(typeof s.outputId === "string" ? { outputId: s.outputId } : {}),
      ...(typeof s.error === "string" ? { error: s.error } : {}),
    })),
  };
}

/** Upsert a run (an existing one keeps its place) and trim the oldest terminal runs beyond CLOUD_RUNS_MAX. */
function withRun(runs: readonly CloudRun[], run: CloudRun): CloudRun[] {
  const i = runs.findIndex((x) => x.key === run.key);
  const next = i < 0 ? [...runs, run] : runs.map((x, n) => (n === i ? run : x));
  while (next.length > CLOUD_RUNS_MAX) {
    const old = next.findIndex((x) => TERMINAL.has(x.state));
    if (old < 0) break; // ponytail: nonterminal runs are bounded by the proof capacity
    next.splice(old, 1);
  }
  return next;
}

const deliveredOf = (p: ProofRecord | undefined) =>
  !!p &&
  TERMINAL.has(p.receipt.state as string) &&
  p.outputs.every((o) => o.disposition !== "collision");

export type ReceiptPlan =
  | {
      readonly ok: true;
      readonly next: CloudReconciliation;
      readonly change: "bound" | "observed" | "proven" | "same" | "older";
      /** Exactly the receipt's records this commit writes, by kind. */
      readonly adopted: readonly { readonly kind: Kind; readonly record: Obj }[];
      /** Terminal and every output accounted for (no collision): ack-eligible once read back. */
      readonly delivered: boolean;
      readonly collisions: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: "retired" | "mismatch" | "conflict" | "proof-full" | "invalid";
    };

/**
 * The proof transition for ONE verified full receipt (the caller verified it through the parser and bound it to
 * `authority`), against the fresh durable reconciliation, journal and draft lists. Outputs are adopted only from a
 * terminal receipt, byte-exact, never over an existing record, an owned id or a deleted one. Generation is not stamped.
 */
export function planReceipt(input: {
  readonly recon: CloudReconciliation;
  readonly journal: CloudJournal;
  readonly lists: OutputLists;
  readonly authority: Authority;
  readonly receipt: Obj;
  readonly commitId: string;
}): ReceiptPlan {
  const { recon, journal, lists, authority: auth, commitId } = input;
  const r = input.receipt;
  const key = occurrenceKey(auth, r.occurrenceId as string);
  if (!key) return { ok: false, reason: "invalid" };
  if (recon.tombstones.some((t) => t.key === key)) return { ok: false, reason: "retired" };
  const entry = journal.entries.find((e) => e.key === key);
  if (entry && (entry.payloadDigest !== r.payloadDigest || !same(entry.body, r.body)))
    return { ok: false, reason: "mismatch" };
  const cur = recon.proofs.find((p) => p.key === key);
  // Legacy folded state has lost per-output history. A live server row cannot restore that history.
  if (!cur && (r.changeSeq as number) <= watermarkOf(recon.authorities, auth))
    return { ok: false, reason: "retired" };
  if (cur && (cur.payloadDigest !== r.payloadDigest || cur.workflowId !== r.workflowId))
    return { ok: false, reason: "mismatch" };
  const order = cur ? compareObservations(obs(auth, cur.receipt), obs(auth, r)) : "newer";
  if (order === "conflict") return { ok: false, reason: "conflict" };
  if (!cur && recon.proofs.length + recon.tombstones.length >= PROOF_CAPACITY)
    return { ok: false, reason: "proof-full" };

  const receipt = order === "newer" ? r : cur!.receipt;
  const terminal = TERMINAL.has(receipt.state as string);
  const records = new Map((receipt.outputs as Obj[]).map((o) => [o.outputId as string, o]));
  const adopted: { kind: Kind; record: Obj }[] = [];
  let outputs: ProofOutput[];
  if (cur && cur.outputs.length) {
    // Identities are fixed at the first terminal receipt; owned outputs follow the local list (edited/removed).
    outputs = cur.outputs.map((o) => {
      if (!PRESENT.has(o.disposition)) return o;
      const row = findRow(lists, o.outputId);
      const disposition: Disposition = !row
        ? "deleted"
        : same(row, records.get(o.outputId)?.record)
          ? "adopted"
          : "retained";
      return disposition === o.disposition ? o : { ...o, disposition };
    });
  } else if (terminal) {
    const suppressed = entry
      ? entry.state === "suppressed"
      : isSuppressed((receipt.body as OccurrenceBody).executionAt, journal.suppression);
    const foreign = ownedIds(recon, key);
    outputs = [];
    for (const o of receipt.outputs as Obj[]) {
      const id = o.outputId as string;
      const kind = o.kind as Kind;
      let disposition: Disposition;
      if (suppressed) disposition = "suppressed";
      else if (foreign.has(id) || findRow(lists, id)) disposition = "collision";
      else {
        const parsed = SCHEMA[kind].safeParse(o.record);
        if (!parsed.success || !same(parsed.data, o.record))
          return { ok: false, reason: "invalid" };
        adopted.push({ kind, record: cloneJson(o.record) as Obj });
        disposition = "adopted";
      }
      outputs.push({
        outputId: id,
        actionId: o.actionId as string,
        kind,
        digest: o.digest as string,
        disposition,
      });
    }
  } else outputs = [];

  const unchanged = !!cur && order !== "newer" && same(outputs, cur.outputs);
  if (unchanged)
    return {
      ok: true,
      next: recon,
      change: order === "same" ? "same" : "older",
      adopted: [],
      delivered: deliveredOf(cur),
      collisions: cur!.outputs.filter((o) => o.disposition === "collision").map((o) => o.outputId),
    };
  const proof: ProofRecord = {
    key,
    authority: plainAuth(auth),
    occurrenceId: r.occurrenceId as string,
    workflowId: r.workflowId as string,
    source: cur?.source ?? (entry ? "journal" : "remote-initial"),
    payloadDigest: r.payloadDigest as string,
    firstVersion: cur?.firstVersion ?? (r.receiptVersion as number),
    resetEpoch: journal.suppression.epoch,
    commitId,
    receipt: cloneJson(receipt) as Obj,
    outputs,
  };
  const next: CloudReconciliation = {
    ...recon,
    proofs: [...recon.proofs.filter((p) => p.key !== key), proof].sort(byKey),
    pending: recon.pending.filter((x) => x.key !== key),
    runs: order === "newer" ? withRun(recon.runs, runOf(auth, key, receipt)) : recon.runs,
  };
  return {
    ok: true,
    next,
    change: !cur
      ? terminal
        ? "proven"
        : "bound"
      : order === "newer" && terminal && !cur.outputs.length
        ? "proven"
        : "observed",
    adopted,
    delivered: deliveredOf(proof),
    collisions: outputs.filter((o) => o.disposition === "collision").map((o) => o.outputId),
  };
}

const idsOf = (l: OutputLists) =>
  new Set([...l.ideas, ...l.posts, ...l.planItems].map((x) => x.id));

/**
 * Deletion evidence for one write: every owned output (of a proof or, DT-7C-2C-R1, of a retired proof's tombstone)
 * present in `before` (what storage held) and absent from `after` (what is written) becomes `deleted`. The same object
 * when nothing owned was removed.
 */
export function applyDeletions(
  recon: CloudReconciliation,
  before: OutputLists,
  after: OutputLists,
): CloudReconciliation {
  const had = idsOf(before);
  const has = idsOf(after);
  const removed = (id: string) => had.has(id) && !has.has(id);
  let changed = false;
  const tombstones = recon.tombstones.map((t) => {
    const gone = (t.owned ?? []).filter(removed);
    if (!gone.length) return t;
    changed = true;
    return {
      ...t,
      deleted: [...t.deleted, ...gone],
      owned: (t.owned ?? []).filter((id) => !gone.includes(id)),
    };
  });
  const proofs = recon.proofs.map((p) => {
    if (!p.outputs.some((o) => PRESENT.has(o.disposition) && removed(o.outputId))) return p;
    changed = true;
    return {
      ...p,
      outputs: p.outputs.map((o) =>
        PRESENT.has(o.disposition) && removed(o.outputId)
          ? { ...o, disposition: "deleted" as const }
          : o,
      ),
    };
  });
  return changed ? { ...recon, proofs, tombstones } : recon;
}

/**
 * The draft lists without any record whose id is owned-and-deleted (an import never resurrects one), nor any id in
 * `extra` (DT-7C-2C-R1: a merge's `drop`).
 */
export function dropDeleted<T extends OutputLists>(
  lists: T,
  recon: CloudReconciliation,
  extra: Iterable<string> = [],
): T {
  const gone = new Set<string>(extra);
  for (const p of recon.proofs)
    for (const o of p.outputs) if (o.disposition === "deleted") gone.add(o.outputId);
  for (const t of recon.tombstones) for (const d of t.deleted) gone.add(d);
  if (!gone.size) return lists;
  const keep = <R extends Row>(l: readonly R[]) => l.filter((x) => !gone.has(x.id));
  return {
    ...lists,
    ideas: keep(lists.ideas),
    posts: keep(lists.posts),
    planItems: keep(lists.planItems),
  };
}

function withAuthority(
  authorities: readonly AuthorityRecord[],
  auth: Authority,
  edit: (a: AuthorityRecord) => AuthorityRecord,
): AuthorityRecord[] {
  const key = authorityKey(auth);
  const cur = authorities.find((a) => a.key === key) ?? {
    key,
    authority: plainAuth(auth),
    cursor: 0,
    retired: 0,
  };
  return [...authorities.filter((a) => a.key !== key), edit(cur)].sort(byKey);
}

const watermarkOf = (authorities: readonly AuthorityRecord[], auth: Authority) =>
  authorities.find((a) => a.key === authorityKey(auth))?.watermark ?? 0;

/** The authority's cursor advanced to `seq` (a monotonic max; the same object when not higher). */
export function withCursor(
  recon: CloudReconciliation,
  auth: Authority,
  seq: number,
): CloudReconciliation {
  const cur = recon.authorities.find((a) => a.key === authorityKey(auth));
  if (cur && cur.cursor >= seq) return recon;
  return {
    ...recon,
    authorities: withAuthority(recon.authorities, auth, (a) => ({ ...a, cursor: seq })),
  };
}

/** A recoverable pending feed item (replaces the key's record); a new one at the cap is `proof-full`. */
export function withPending(
  recon: CloudReconciliation,
  rec: PendingRecord,
):
  | { readonly ok: true; readonly next: CloudReconciliation }
  | { readonly ok: false; readonly reason: "proof-full" } {
  const exists = recon.pending.some((x) => x.key === rec.key);
  if (!exists && recon.pending.length >= PROOF_CAPACITY) return { ok: false, reason: "proof-full" };
  const pending = [
    ...recon.pending.filter((x) => x.key !== rec.key),
    { ...rec, authority: plainAuth(rec.authority) },
  ];
  return { ok: true, next: { ...recon, pending: pending.sort(byKey) } };
}

/**
 * Retirement by a bound fresh `pruned` status: only the same digest retires. The proof (or the known journal entry /
 * pending item) becomes a compact tombstone carrying its owned and deleted output ids and, for a terminal proof, its final
 * change_seq and execution time; the authority's retirement generation advances. At TOMBSTONES_MAX the next
 * retirement refuses `retirement-full` without losing the live proof or any ownership/deletion evidence. Nothing
 * known locally: `retired: false`, same object.
 */
export function retireOccurrence(
  recon: CloudReconciliation,
  p: {
    readonly authority: Authority;
    readonly occurrenceId: string;
    readonly payloadDigest: string;
    readonly prunedAt: string;
    readonly journalKnown: boolean;
  },
):
  | { readonly ok: true; readonly next: CloudReconciliation; readonly retired: boolean }
  | { readonly ok: false; readonly reason: "mismatch" | "invalid" | "retirement-full" } {
  const key = occurrenceKey(p.authority, p.occurrenceId);
  if (!key) return { ok: false, reason: "invalid" };
  const tomb = recon.tombstones.find((t) => t.key === key);
  if (tomb)
    return tomb.payloadDigest === p.payloadDigest
      ? { ok: true, next: recon, retired: false }
      : { ok: false, reason: "mismatch" };
  const cur = recon.proofs.find((x) => x.key === key);
  const pend = recon.pending.find((x) => x.key === key);
  if (
    (cur && cur.payloadDigest !== p.payloadDigest) ||
    (pend && pend.payloadDigest !== p.payloadDigest)
  )
    return { ok: false, reason: "mismatch" };
  if (!cur && !pend && !p.journalKnown) return { ok: true, next: recon, retired: false };
  const outs = cur?.outputs ?? [];
  const added: Tombstone = {
    key,
    authority: plainAuth(p.authority),
    occurrenceId: p.occurrenceId,
    payloadDigest: p.payloadDigest,
    prunedAt: p.prunedAt,
    deleted: outs.filter((o) => o.disposition === "deleted").map((o) => o.outputId),
    owned: outs.filter((o) => PRESENT.has(o.disposition)).map((o) => o.outputId),
    changeSeq:
      cur && TERMINAL.has(cur.receipt.state as string) ? (cur.receipt.changeSeq as number) : null,
    ...(cur ? { executionAt: (cur.receipt.body as OccurrenceBody).executionAt } : {}),
  };
  if (recon.tombstones.length >= TOMBSTONES_MAX) return { ok: false, reason: "retirement-full" };
  return {
    ok: true,
    retired: true,
    next: {
      ...recon,
      authorities: withAuthority(recon.authorities, p.authority, (a) => ({
        ...a,
        retired: a.retired + 1,
      })),
      proofs: recon.proofs.filter((x) => x.key !== key),
      pending: recon.pending.filter((x) => x.key !== key),
      tombstones: [...recon.tombstones, added],
    },
  };
}

export type AckEligibility =
  | { readonly ok: true; readonly proof: ProofRecord }
  | {
      readonly ok: false;
      readonly reason: "missing" | "retired" | "not-terminal" | "collision" | "inconsistent";
    };

/** Whether a proof may be acknowledged now: terminal, no collision, every owned present output still present. */
export function ackEligibility(
  recon: CloudReconciliation,
  key: string,
  lists: OutputLists,
): AckEligibility {
  if (recon.tombstones.some((t) => t.key === key)) return { ok: false, reason: "retired" };
  const p = recon.proofs.find((x) => x.key === key);
  if (!p) return { ok: false, reason: "missing" };
  if (!TERMINAL.has(p.receipt.state as string)) return { ok: false, reason: "not-terminal" };
  if (p.outputs.some((o) => o.disposition === "collision"))
    return { ok: false, reason: "collision" };
  if (p.outputs.some((o) => PRESENT.has(o.disposition) && !findRow(lists, o.outputId)))
    return { ok: false, reason: "inconsistent" };
  return { ok: true, proof: p };
}

/* ---------- import merge ---------- */

function mergeProof(a: ProofRecord, b: ProofRecord): ProofRecord | null {
  if (
    !same(a.authority, b.authority) ||
    a.occurrenceId !== b.occurrenceId ||
    a.workflowId !== b.workflowId ||
    a.payloadDigest !== b.payloadDigest
  )
    return null;
  const order = compareObservations(obs(a.authority, a.receipt), obs(b.authority, b.receipt));
  if (order === "conflict") return null;
  const top = order === "newer" ? b : a;
  let outputs = top.outputs;
  if (a.outputs.length && b.outputs.length) {
    if (
      !same(
        a.outputs.map((o) => identity(o as unknown as Obj)),
        b.outputs.map((o) => identity(o as unknown as Obj)),
      )
    )
      return null;
    outputs = a.outputs.map((o, i) =>
      RANK[b.outputs[i].disposition] > RANK[o.disposition] ? b.outputs[i] : o,
    );
  }
  return {
    ...top,
    source: a.source === "journal" || b.source === "journal" ? "journal" : "remote-initial",
    firstVersion: Math.min(a.firstVersion, b.firstVersion),
    resetEpoch: Math.max(a.resetEpoch, b.resetEpoch),
    outputs,
  };
}

/** Two tombstones of one key: deletion evidence unioned; owned = union minus deleted (absent fields stay absent). */
function mergeTomb(a: Tombstone, b: Tombstone): Tombstone {
  const deleted = [...new Set([...a.deleted, ...b.deleted])];
  return {
    ...a,
    deleted,
    ...(a.owned || b.owned
      ? {
          owned: [...new Set([...(a.owned ?? []), ...(b.owned ?? [])])].filter(
            (id) => !deleted.includes(id),
          ),
        }
      : {}),
    ...(a.changeSeq !== undefined || b.changeSeq !== undefined
      ? { changeSeq: a.changeSeq ?? b.changeSeq ?? null }
      : {}),
    ...(a.executionAt || b.executionAt ? { executionAt: a.executionAt ?? b.executionAt } : {}),
  };
}

export interface MergeOptions {
  /** DT-7C-2C-R1: the merged journal's suppression; outputs of a proof first learned from the backup obey it. */
  readonly suppression?: Suppression;
  /** Current durable drafts, retained for caller compatibility. Ownership is never discarded at capacity. */
  readonly present?: OutputLists;
}

/**
 * An imported reconciliation merged into the fresh durable one: union by key, cursor, retirement generation and
 * proofs merge monotonically (`compareObservations`; disposition rank deleted > collision >
 * suppressed > retained > adopted), tombstones union and beat proofs, pending keeps the higher sequence, runs the higher
 * version. A changed binding, digest or equal-version contradiction refuses the whole merge with its keys.
 * Legacy nonzero watermarks refuse import: discarded ownership cannot be reconstructed. A tombstone union over
 * TOMBSTONES_MAX refuses capacity without eviction. Imported first-learned proofs and tombstones obey the merged
 * reset; suppressed backup outputs are returned in `drop`. Unknown legacy tombstone times fail conservatively.
 * Generation is not stamped (`stamp`).
 */
export function mergeReconciliations(
  fresh: CloudReconciliation,
  imported: CloudReconciliation,
  opts: MergeOptions = {},
):
  | {
      readonly ok: true;
      readonly next: CloudReconciliation;
      readonly changed: boolean;
      readonly drop: readonly string[];
      readonly retired: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: "conflict" | "capacity";
      readonly keys: readonly string[];
    } {
  const conflicts = new Set<string>();
  // No new folds are produced. Existing watermarks cannot reconstruct discarded output ownership:
  // do not let an import silently become a migration that drops or recreates those drafts.
  const legacy = [...fresh.authorities, ...imported.authorities].filter(
    (a) => (a.watermark ?? 0) > 0,
  );
  if (legacy.length)
    return { ok: false, reason: "conflict", keys: [...new Set(legacy.map((a) => a.key))].sort() };
  const drop = new Set<string>(); // never restored
  const auths = new Map(fresh.authorities.map((a) => [a.key, a]));
  for (const a of imported.authorities) {
    const cur = auths.get(a.key);
    auths.set(
      a.key,
      cur
        ? {
            ...cur,
            cursor: Math.max(cur.cursor, a.cursor),
            retired: Math.max(cur.retired, a.retired),
          }
        : a,
    );
  }
  const authorities = [...auths.values()].sort(byKey);
  const tombs = new Map(fresh.tombstones.map((t) => [t.key, t]));
  for (const t of imported.tombstones) {
    const cur = tombs.get(t.key);
    if (cur) {
      if (cur.payloadDigest !== t.payloadDigest) conflicts.add(t.key);
      else if (cur.executionAt && t.executionAt && cur.executionAt !== t.executionAt)
        conflicts.add(t.key);
      else tombs.set(t.key, mergeTomb(cur, t));
    } else tombs.set(t.key, t);
  }
  if (opts.suppression?.resetAt) {
    for (const [key, t] of tombs) {
      if (!imported.tombstones.some((x) => x.key === key)) continue;
      if (fresh.tombstones.some((x) => x.key === key)) continue;
      if (t.executionAt && !isSuppressed(t.executionAt, opts.suppression)) continue;
      // Without either execution time or ownership the old format cannot safely identify its backup drafts.
      if (t.owned === undefined) {
        conflicts.add(key);
        continue;
      }
      for (const id of t.owned) drop.add(id);
      tombs.set(key, { ...t, deleted: [...new Set([...t.deleted, ...t.owned])], owned: [] });
    }
  }
  const proofs = new Map(fresh.proofs.map((p) => [p.key, p]));
  for (const p of imported.proofs) {
    const cur = proofs.get(p.key);
    if (!cur) proofs.set(p.key, p);
    else {
      const m = mergeProof(cur, p);
      if (m) proofs.set(p.key, m);
      else conflicts.add(p.key);
    }
  }
  for (const [k, t] of tombs) {
    const p = proofs.get(k);
    if (!p) continue;
    if (p.payloadDigest !== t.payloadDigest) conflicts.add(k);
    proofs.delete(k);
  }
  if (conflicts.size) return { ok: false, reason: "conflict", keys: [...conflicts].sort() };
  if (tombs.size > TOMBSTONES_MAX) return { ok: false, reason: "capacity", keys: [] };
  const tombstones = [...tombs.values()];
  if (opts.suppression)
    for (const [k, p] of proofs) {
      if (!p.outputs.length || fresh.proofs.find((x) => x.key === k)?.outputs.length) continue;
      if (!isSuppressed((p.receipt.body as OccurrenceBody).executionAt, opts.suppression)) continue;
      proofs.set(k, {
        ...p,
        outputs: p.outputs.map((o) =>
          PRESENT.has(o.disposition) ? { ...o, disposition: "suppressed" as const } : o,
        ),
      });
    }
  for (const ip of imported.proofs) {
    const m = proofs.get(ip.key);
    if (!m || m.outputs.length !== ip.outputs.length) continue;
    ip.outputs.forEach((o, i) => {
      if (PRESENT.has(o.disposition) && m.outputs[i].disposition === "suppressed")
        drop.add(o.outputId);
    });
  }
  if (proofs.size + tombstones.length > PROOF_CAPACITY)
    return { ok: false, reason: "capacity", keys: [] };
  const pend = new Map(fresh.pending.map((x) => [x.key, x]));
  for (const x of imported.pending) {
    const cur = pend.get(x.key);
    if (!cur || x.changeSeq > cur.changeSeq) pend.set(x.key, x);
  }
  const pending = [...pend.values()].filter((x) => {
    if (tombs.has(x.key)) return false;
    const p = proofs.get(x.key);
    return !(
      p &&
      TERMINAL.has(p.receipt.state as string) &&
      (p.receipt.receiptVersion as number) >= x.receiptVersion
    );
  });
  if (pending.length > PROOF_CAPACITY) return { ok: false, reason: "capacity", keys: [] };
  let runs: CloudRun[] = [...fresh.runs];
  for (const run of imported.runs) {
    const cur = runs.find((x) => x.key === run.key);
    if (!cur || run.receiptVersion > cur.receiptVersion) runs = withRun(runs, run);
  }
  const out = { drop: [...drop], retired: [] as string[] };
  const next: CloudReconciliation = {
    ...fresh,
    authorities,
    proofs: [...proofs.values()].sort(byKey),
    tombstones,
    pending: pending.sort(byKey),
    runs,
  };
  return same(next, fresh)
    ? { ok: true, next: fresh, changed: false, ...out }
    : { ok: true, next, changed: true, ...out };
}
