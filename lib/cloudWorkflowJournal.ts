/**
 * ⚙️ Cloud workflow journal kernel (packet DT-7C-2A, planning/tools/38-cloud-workflows.md): PURE, unactivated.
 * The durable browser outbox of cloud occurrences and the receipts observed for them. Nothing here fetches, stores,
 * reads a clock or knows a credential: `store/index.ts` persists it under the shared `3z-prod-articles` lock.
 *
 *   entry        keyed by the canonical structured `occurrenceKey(authority, occurrenceId)` (protocol helper). Keeps
 *                its original authority, the immutable allowlisted body (the Worker's admission validator at its own
 *                executionAt) and payload digest, the captured executionAt, a local commit token and a typed local
 *                state derived from the suppression marker (`queued` / `suppressed`). Same key + digest is idempotent,
 *                a changed digest conflicts; authorities never merge or retarget.
 *   observation  the complete `Parsed.authority`, the immutable request binding (kind, ownerKey, occurrenceId, digest)
 *                and the full receipt as plain JSON. JSON loses the parser's runtime brand, so an observation is only
 *                accepted after `verifyObservation` re-parses it through the pinned `parseAnswer`, bound to the entry's
 *                own body and digest. A compact feed item is never a receipt. Observed is not delivered: nothing here
 *                marks an entry delivered or ackable, and no branded receipt ever leaves this module.
 *   suppression  monotonic `{epoch, resetAt, commitId}`: a reset advances it; an entry is suppressed when its immutable
 *                triggering executionAt is at or before resetAt. An import takes the maximum epoch and the maximum
 *                resetAt independently.
 *   capacity     600 entries; updates of existing entries are allowed at the cap, new ones refused; no eviction.
 */

import {
  DIGEST_RE,
  canonicalJson,
  checkBody,
  exactKeys,
  fits,
  isCount,
  isIso,
  isObj,
  payloadDigestOf,
  type Obj,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import {
  authorityKey,
  authorityOf,
  cloneJson,
  isVerifiedReceipt,
  occurrenceKey,
  parseAnswer,
  submitRequestOf,
  type Authority,
  type CloudRequest,
  type Parsed,
} from "./cloudWorkflowProtocol";
import { previewCloudRun, type CloudLimitation } from "./cloudWorkflowSnapshot";

export const JOURNAL_CAPACITY = 600;

export type LocalState = "queued" | "suppressed";

export interface Suppression {
  readonly epoch: number;
  readonly resetAt: string | null;
  readonly commitId: string | null;
}

/** What request the receipt answered: the binding a revalidation checks against the entry. */
export interface ObservationBinding {
  readonly kind: "submit" | "status" | "cancel" | "run";
  readonly ownerKey: string;
  readonly occurrenceId: string;
  readonly payloadDigest: string;
}

export interface Observation {
  readonly authority: Authority;
  readonly binding: ObservationBinding;
  /** The full receipt as plain JSON (untrusted until `verifyObservation` re-parses it). */
  readonly receipt: Obj & { readonly receiptVersion: number };
}

export interface JournalEntry {
  readonly key: string;
  readonly authority: Authority;
  readonly occurrenceId: string;
  readonly body: OccurrenceBody;
  readonly payloadDigest: string;
  readonly executionAt: string;
  readonly commitId: string;
  readonly state: LocalState;
  readonly observation: Observation | null;
}

export interface CloudJournal {
  readonly v: 1;
  /** Bumped by every journal commit (enqueue, observation, reset, changing import). */
  readonly generation: number;
  /** The token of the last journal commit (null before the first). */
  readonly commitId: string | null;
  readonly suppression: Suppression;
  readonly entries: readonly JournalEntry[];
}

export const emptyJournal = (): CloudJournal => ({
  v: 1,
  generation: 0,
  commitId: null,
  suppression: { epoch: 0, resetAt: null, commitId: null },
  entries: [],
});

/** True when the immutable triggering instant is at or before the last reset. */
export const isSuppressed = (executionAt: string, s: Suppression): boolean =>
  s.resetAt !== null && Date.parse(executionAt) <= Date.parse(s.resetAt);

const stateOf = (executionAt: string, s: Suppression): LocalState =>
  isSuppressed(executionAt, s) ? "suppressed" : "queued";

const isToken = (v: unknown): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= 200;
const BINDING_KINDS: readonly unknown[] = ["submit", "status", "cancel", "run"];
/** Canonical equality of plain data. */
export const sameData = (a: unknown, b: unknown): boolean => canonicalJson(a) === canonicalJson(b);
const same = sameData;

/* ---------- structural parse (sync) ---------- */

function suppressionOk(s: unknown): s is Suppression {
  if (!isObj(s) || !exactKeys(s, ["epoch", "resetAt", "commitId"]) || !isCount(s.epoch))
    return false;
  // Never reset: nothing set. Reset at least once: an instant and its commit.
  return s.epoch === 0
    ? s.resetAt === null && s.commitId === null
    : isIso(s.resetAt) && isToken(s.commitId);
}

function observationShapeOk(o: unknown, entry: Obj): boolean {
  if (o === null) return true;
  if (!isObj(o) || !exactKeys(o, ["authority", "binding", "receipt"])) return false;
  const a = o.authority;
  const b = o.binding;
  return (
    isObj(a) &&
    exactKeys(a, ["origin", "ownerKey"]) &&
    same(a, entry.authority) &&
    isObj(b) &&
    exactKeys(b, ["kind", "ownerKey", "occurrenceId", "payloadDigest"]) &&
    BINDING_KINDS.includes(b.kind) &&
    b.ownerKey === (entry.authority as Obj).ownerKey &&
    b.occurrenceId === entry.occurrenceId &&
    b.payloadDigest === entry.payloadDigest &&
    isObj(o.receipt) &&
    isCount(o.receipt.receiptVersion)
  );
}

function entryOk(e: unknown, s: Suppression): e is JournalEntry {
  if (
    !isObj(e) ||
    !exactKeys(e, [
      "key",
      "authority",
      "occurrenceId",
      "body",
      "payloadDigest",
      "executionAt",
      "commitId",
      "state",
      "observation",
    ])
  )
    return false;
  const a = isObj(e.authority) ? e.authority : null;
  if (!a || !exactKeys(a, ["origin", "ownerKey"])) return false;
  const auth = authorityOf(a.origin, a.ownerKey);
  if (!auth || !same(auth, a) || typeof e.occurrenceId !== "string") return false;
  if (e.key !== occurrenceKey(auth, e.occurrenceId)) return false;
  if (!isIso(e.executionAt) || !fits(e.payloadDigest, DIGEST_RE) || !isToken(e.commitId))
    return false;
  const chk = checkBody(e.body, Date.parse(e.executionAt));
  if (!chk.ok) return false;
  const body = chk.body;
  return (
    body.executionAt === e.executionAt &&
    body.ownerKey === auth.ownerKey &&
    body.occurrenceId === e.occurrenceId &&
    e.state === stateOf(e.executionAt, s) &&
    observationShapeOk(e.observation, e)
  );
}

/**
 * The journal a persisted/imported value holds, as a detached copy, or null when it is not exactly a journal
 * (unknown keys, a retargeted key, a foreign body owner, a duplicate, an inconsistent state, over capacity...).
 * Digests and observations are checked asynchronously by `verifyJournal`.
 */
export function parseJournal(raw: unknown): CloudJournal | null {
  let j: unknown;
  try {
    j = cloneJson(raw);
  } catch {
    return null;
  }
  if (!isObj(j) || !exactKeys(j, ["v", "generation", "commitId", "suppression", "entries"]))
    return null;
  if (j.v !== 1 || !isCount(j.generation) || !(j.commitId === null || isToken(j.commitId)))
    return null;
  if (!suppressionOk(j.suppression) || !Array.isArray(j.entries)) return null;
  if (j.entries.length > JOURNAL_CAPACITY) return null;
  const s = j.suppression;
  const keys = new Set<unknown>();
  for (const e of j.entries as unknown[]) {
    if (!entryOk(e, s) || keys.has(e.key)) return null;
    keys.add(e.key);
  }
  return j as unknown as CloudJournal;
}

/** A stored slice: absent is the empty journal (never saved); anything else must parse (null = unreadable). */
export const readJournal = (raw: unknown): CloudJournal | null =>
  raw === undefined ? emptyJournal() : parseJournal(raw);

/* ---------- candidates and observations (async, before any lock) ---------- */

export type CandidateRefusal =
  | { readonly ok: false; readonly reason: "invalid" }
  /** Over the 8 KiB context or 16 KiB body bound: never truncated, summarized or emptied to fit. */
  | { readonly ok: false; readonly reason: "too-large" }
  | {
      readonly ok: false;
      readonly reason: "limitation";
      readonly limitation: {
        readonly actionId: string;
        readonly limitation: CloudLimitation;
        readonly built: number;
        readonly skipped: readonly string[];
      };
    };
export type Candidate = Omit<JournalEntry, "commitId" | "state" | "observation">;

/**
 * A detached, validated, hashed candidate for `origin` (caller-captured; never inferred from Settings) and the body's
 * own ownerKey. Refused: an invalid origin/body, an over-limit context or body (`too-large`), and a body whose cloud preflight
 * hits a cloud-only limitation (exact action, built prefix and skipped suffix kept for the explanation). No truncation.
 */
export async function candidateEntry(
  origin: unknown,
  body: unknown,
): Promise<{ readonly ok: true; readonly entry: Candidate } | CandidateRefusal> {
  const bad = { ok: false, reason: "invalid" } as const;
  let sub: Awaited<ReturnType<typeof submitRequestOf>>;
  try {
    const raw = cloneJson(body);
    const at =
      isObj(raw) && typeof raw.executionAt === "string" ? Date.parse(raw.executionAt) : NaN;
    const chk = checkBody(raw, at);
    if (!chk.ok) return chk.error === "too_large" ? { ok: false, reason: "too-large" } : bad;
    sub = await submitRequestOf(raw);
  } catch {
    return bad;
  }
  if (!sub.ok || sub.request.kind !== "submit") return bad;
  const { body: copy, payloadDigest } = sub.request;
  const authority = authorityOf(origin, copy.ownerKey);
  const key = authority && occurrenceKey(authority, copy.occurrenceId);
  if (!authority || !key) return bad;
  const pre = await previewCloudRun(copy);
  if (!pre.ok) return bad;
  if (pre.preview.limitation) {
    const steps = pre.preview.steps;
    const failed = steps.find((x) => x.status === "failed")!;
    return {
      ok: false,
      reason: "limitation",
      limitation: {
        actionId: failed.actionId,
        limitation: pre.preview.limitation,
        built: pre.preview.built,
        skipped: steps.filter((x) => x.status === "skipped").map((x) => x.actionId),
      },
    };
  }
  return {
    ok: true,
    entry: {
      key,
      authority: { origin: authority.origin, ownerKey: authority.ownerKey },
      occurrenceId: copy.occurrenceId,
      body: copy,
      payloadDigest,
      executionAt: copy.executionAt,
    },
  };
}

/** The receipt a parsed answer carries (status rows only for `status`), or null. */
function receiptOfParsed(p: Parsed): unknown {
  if (p.outcome !== "ok") return null;
  if (p.kind === "submit" || p.kind === "cancel" || p.kind === "run") return p.receipt;
  if (p.kind === "status") return p.result.found === "row" ? p.result.receipt : null;
  return null;
}

/**
 * An observation from a live, parser-verified answer and the request that produced it: the complete authority, the
 * binding and a plain copy of the receipt. A compact feed, a look-alike (unbranded) receipt or a request that is not
 * the answered one is refused.
 */
export async function observationOf(
  parsed: Parsed,
  request: CloudRequest,
): Promise<
  | { readonly ok: true; readonly key: string; readonly observation: Observation }
  | { readonly ok: false; readonly reason: "compact-feed" | "unverified" | "invalid" }
> {
  if (parsed?.outcome === "ok" && parsed.kind === "changes")
    return { ok: false, reason: "compact-feed" };
  const receipt = parsed ? receiptOfParsed(parsed) : null;
  if (!receipt) return { ok: false, reason: "invalid" };
  if (!isVerifiedReceipt(receipt)) return { ok: false, reason: "unverified" };
  if (parsed.outcome !== "ok") return { ok: false, reason: "invalid" };
  const authority = authorityOf(parsed.authority.origin, parsed.authority.ownerKey);
  if (!authority || !isObj(request) || request.kind !== parsed.kind)
    return { ok: false, reason: "invalid" };
  const owner =
    request.kind === "submit"
      ? request.body?.ownerKey
      : (request as { ownerKey?: unknown }).ownerKey;
  const id =
    request.kind === "submit"
      ? request.body?.occurrenceId
      : (request as { occurrenceId?: unknown }).occurrenceId;
  if (owner !== authority.ownerKey || id !== receipt.occurrenceId)
    return { ok: false, reason: "invalid" };
  if (request.kind === "submit" && request.payloadDigest !== receipt.payloadDigest)
    return { ok: false, reason: "invalid" };
  const key = occurrenceKey(authority, receipt.occurrenceId);
  if (!key) return { ok: false, reason: "invalid" };
  const observation: Observation = {
    authority: { origin: authority.origin, ownerKey: authority.ownerKey },
    binding: {
      kind: request.kind as ObservationBinding["kind"],
      ownerKey: authority.ownerKey,
      occurrenceId: receipt.occurrenceId,
      payloadDigest: receipt.payloadDigest,
    },
    receipt: cloneJson(receipt) as Observation["receipt"],
  };
  return { ok: true, key, observation };
}

/**
 * Revalidate a (persisted or imported) observation for its entry through the pinned parser: its binding must name the
 * entry, and its receipt must parse as a status row for the entry's authority, bound to the entry's own body and
 * digest. No cast, no saved flag: a plain object passes only if the parser accepts it now.
 */
export async function verifyObservation(entry: JournalEntry, raw: unknown): Promise<boolean> {
  if (!observationShapeOk(raw, entry as unknown as Obj)) return false;
  const o = raw as Observation;
  const req: CloudRequest = {
    kind: "status",
    ownerKey: entry.authority.ownerKey,
    occurrenceId: entry.occurrenceId,
    expect: { body: entry.body, payloadDigest: entry.payloadDigest },
  };
  const p = await parseAnswer(
    req,
    { status: 200, body: { ownerKey: o.authority.ownerKey, occurrence: o.receipt } },
    { origin: o.authority.origin },
  );
  return (
    p.outcome === "ok" &&
    p.kind === "status" &&
    p.result.found === "row" &&
    authorityKey(p.authority) === authorityKey(entry.authority)
  );
}

/**
 * The asynchronous half of reading a journal: every body digest recomputed (a mismatch makes the whole journal
 * unreadable) and every observation revalidated (the keys of rejected ones are returned; they are never accepted).
 */
export async function verifyJournal(
  j: CloudJournal,
): Promise<{ readonly ok: true; readonly rejected: readonly string[] } | { readonly ok: false }> {
  const rejected: string[] = [];
  for (const e of j.entries) {
    if ((await payloadDigestOf(e.body)) !== e.payloadDigest) return { ok: false };
    if (e.observation && !(await verifyObservation(e, e.observation))) rejected.push(e.key);
  }
  return { ok: true, rejected };
}

/* ---------- ordering and transitions (sync, pure) ---------- */

const ACK_FIELDS = ["ackedVersion", "firstAckAt", "purgeAt"];
const withoutAck = (r: Obj) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => !ACK_FIELDS.includes(k)));

/** An observation without its request provenance (which supported request happened to observe the receipt). */
const proofOf = (o: Observation) => ({ ...o, binding: { ...o.binding, kind: null } });

/**
 * `b` relative to `a`: a higher receipt version is newer; at equal versions the content must agree apart from the
 * acknowledgement fields, where an acknowledged receipt (ackedVersion > 0) only adds to an unacknowledged one; two
 * different acknowledgements, or any other difference, contradict. DT-7C-2A-R1: the request kind is provenance, not
 * proof, so the identical authority, binding identity and full receipt seen via Submit/Run/Cancel and via Status is
 * `same`; callers then keep the first stored observation, so the kept provenance is deterministic.
 */
export function compareObservations(
  a: Observation,
  b: Observation,
): "same" | "newer" | "older" | "conflict" {
  const va = a.receipt.receiptVersion;
  const vb = b.receipt.receiptVersion;
  if (vb !== va) return vb > va ? "newer" : "older";
  const pa = proofOf(a);
  const pb = proofOf(b);
  if (same(pa, pb)) return "same";
  if (
    !same(pa.authority, pb.authority) ||
    !same(pa.binding, pb.binding) ||
    !same(withoutAck(a.receipt), withoutAck(b.receipt))
  )
    return "conflict";
  const ackA = (a.receipt.ackedVersion as number) > 0;
  const ackB = (b.receipt.ackedVersion as number) > 0;
  if (ackA === ackB) return "conflict";
  return ackB ? "newer" : "older";
}

const sortEntries = (entries: JournalEntry[]) =>
  entries.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

/** The journal with one new entry (the caller checked key, digest, suppression and capacity). */
export function withEntry(j: CloudJournal, entry: JournalEntry, commitId: string): CloudJournal {
  return {
    ...j,
    generation: j.generation + 1,
    commitId,
    entries: sortEntries([
      ...j.entries,
      { ...entry, state: stateOf(entry.executionAt, j.suppression) },
    ]),
  };
}

/** The journal with the observation of one entry replaced (the caller checked the ordering). */
export function withObservation(
  j: CloudJournal,
  key: string,
  observation: Observation,
  commitId: string,
): CloudJournal {
  return {
    ...j,
    generation: j.generation + 1,
    commitId,
    entries: j.entries.map((e) => (e.key === key ? { ...e, observation } : e)),
  };
}

/**
 * DT-7C-2C retirement only: the journal without one entry (the caller proved a bound fresh `pruned` status with the
 * same digest and that ownership resolution is unchanged without it). An unknown key: the same journal.
 */
export function withoutEntry(j: CloudJournal, key: string, commitId: string): CloudJournal {
  if (!j.entries.some((e) => e.key === key)) return j;
  return {
    ...j,
    generation: j.generation + 1,
    commitId,
    entries: j.entries.filter((e) => e.key !== key),
  };
}

/** A reset: the next epoch, resetAt never lowered, every entry kept with its state re-derived. */
export function resetJournal(j: CloudJournal, now: Date, commitId: string): CloudJournal {
  const at = now.toISOString();
  const prev = j.suppression.resetAt;
  const suppression: Suppression = {
    epoch: j.suppression.epoch + 1,
    resetAt: prev !== null && Date.parse(prev) > Date.parse(at) ? prev : at,
    commitId,
  };
  return {
    ...j,
    generation: j.generation + 1,
    commitId,
    suppression,
    entries: j.entries.map((e) => ({ ...e, state: stateOf(e.executionAt, suppression) })),
  };
}

const laterIso = (a: string | null, b: string | null) =>
  a === null ? b : b === null ? a : Date.parse(b) > Date.parse(a) ? b : a;

/**
 * An imported journal merged into the fresh durable one: every entry of both is kept at its original authority and
 * commit token; same key + digest merges observations monotonically; a changed digest or an equal-version
 * contradiction refuses the whole merge (`conflict`, with the keys); a union over capacity refuses it (`capacity`).
 * Suppression takes the maximum epoch and the maximum resetAt independently. Unchanged: `changed: false`, the fresh
 * journal itself.
 */
export function mergeJournals(
  fresh: CloudJournal,
  imported: CloudJournal,
  commitId: string,
):
  | { readonly ok: true; readonly journal: CloudJournal; readonly changed: boolean }
  | {
      readonly ok: false;
      readonly reason: "conflict" | "capacity";
      readonly keys: readonly string[];
    } {
  const f = fresh.suppression;
  const i = imported.suppression;
  const epoch = Math.max(f.epoch, i.epoch);
  const resetAt = laterIso(f.resetAt, i.resetAt);
  const suppression: Suppression =
    epoch === f.epoch && resetAt === f.resetAt
      ? f
      : epoch === i.epoch && resetAt === i.resetAt
        ? i
        : { epoch, resetAt, commitId };
  const byKey = new Map(fresh.entries.map((e) => [e.key, e]));
  const contradicted: string[] = [];
  for (const e of imported.entries) {
    const cur = byKey.get(e.key);
    if (!cur) {
      byKey.set(e.key, e);
      continue;
    }
    if (cur.payloadDigest !== e.payloadDigest || !same(cur.authority, e.authority)) {
      contradicted.push(e.key);
      continue;
    }
    if (!e.observation) continue;
    const order = cur.observation ? compareObservations(cur.observation, e.observation) : "newer";
    if (order === "conflict") contradicted.push(e.key);
    else if (order === "newer") byKey.set(e.key, { ...cur, observation: e.observation });
  }
  if (contradicted.length) return { ok: false, reason: "conflict", keys: contradicted.sort() };
  if (byKey.size > JOURNAL_CAPACITY) return { ok: false, reason: "capacity", keys: [] };
  const entries = sortEntries(
    [...byKey.values()].map((e) => ({ ...e, state: stateOf(e.executionAt, suppression) })),
  );
  const next: CloudJournal = { ...fresh, suppression, entries };
  if (same(next, fresh)) return { ok: true, journal: fresh, changed: false };
  return {
    ok: true,
    journal: { ...next, generation: fresh.generation + 1, commitId },
    changed: true,
  };
}

/** Exact read-back: the stored slice is, canonically, the journal this commit wrote. */
export const journalIs = (stored: unknown, expected: CloudJournal): boolean => {
  try {
    return stored !== undefined && canonicalJson(stored) === canonicalJson(expected);
  } catch {
    return false;
  }
};
