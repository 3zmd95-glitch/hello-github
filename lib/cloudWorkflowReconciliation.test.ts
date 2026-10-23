import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  sha256Hex,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import {
  authorityOf,
  isVerifiedReceipt,
  occurrenceKey,
  parseAnswer,
  type Authority,
} from "./cloudWorkflowProtocol";
import {
  candidateEntry,
  emptyJournal,
  resetJournal,
  withEntry,
  type CloudJournal,
} from "./cloudWorkflowJournal";
import {
  CLOUD_RUNS_MAX,
  PROOF_CAPACITY,
  TOMBSTONES_MAX,
  ackEligibility,
  applyDeletions,
  dropDeleted,
  emptyReconciliation,
  mergeReconciliations,
  parseReconciliation,
  planReceipt,
  readReconciliation,
  reconciliationIs,
  retireOccurrence,
  stamp,
  verifyProof,
  withCursor,
  withPending,
  type CloudReconciliation,
  type OutputLists,
  type ProofRecord,
} from "./cloudWorkflowReconciliation";

// ⚙️ DT-7C-2C pure reconciliation kernel (planning/tools/38-cloud-workflows.md): proof transitions, per-output
// dispositions, deletion evidence, import merge, retirement and ack eligibility. Synthetic receipts are verified by the
// pinned parser exactly as the Worker answers them. No store, no network, no clock.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OWNER = "wfo_" + "a".repeat(32);
const OWNER_B = "wfo_" + "b".repeat(32);
const ORIGIN = "https://scout.example";
const AUTH = authorityOf(ORIGIN, OWNER)!;
const AUTH_B = authorityOf(ORIGIN, OWNER_B)!;
const AT = "2026-10-17T09:00:00.000Z";
const SUBMITTED = "2026-10-17T09:05:00.000Z";
const FINISHED = "2026-10-17T09:06:00.000Z";
const EMPTY: OutputLists = { ideas: [], posts: [], planItems: [] };

const idea = (id: string) => ({ id, kind: "idea", text: { ar: "", en: "Idea {date}" } });
function bodyOf(id = "m1", owner = OWNER, actions = [idea("a1"), idea("a2")], at = AT) {
  return {
    occurrenceId: id,
    ownerKey: owner,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: { name: { ar: "", en: "Flow" }, trigger: { kind: "manual" }, actions },
    plannerContext: null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-17",
    },
    executionAt: at,
  } as unknown as OccurrenceBody;
}
const digestOf = (v: unknown) => sha256Hex(canonicalJson(v));
const recordOf = (occ: string, action: string, text = "Idea 2026-10-17") => ({
  id: `wf:${occ}:${action}`,
  text,
  source: "workflow",
  createdAt: AT,
});

/** A receipt as the coordinator answers it: `shape` = one letter per step (p pending, d done, f failed, s skipped). */
async function receiptOf(body: OccurrenceBody, shape: string, acked = false): Promise<A> {
  const done = shape.split("").filter((c) => c === "d").length;
  const failed = shape.split("").filter((c) => c === "f").length;
  const state = /^p+$/.test(shape)
    ? "pending"
    : shape.includes("p")
      ? "running"
      : /^s+$/.test(shape)
        ? "cancelled"
        : /^d+$/.test(shape)
          ? "done"
          : done
            ? "partial"
            : "failed";
  const version = {
    pending: 1,
    running: 1 + done + failed,
    done: done + 2,
    partial: done + 3,
    failed: 3,
    cancelled: 2,
  }[state];
  const terminal = !["pending", "running"].includes(state);
  const steps: A[] = [];
  const outputs: A[] = [];
  for (const [idx, a] of body.snapshot.actions.entries()) {
    const c = shape[idx];
    if (c === "d") {
      const record = recordOf(body.occurrenceId, a.id);
      const digest = await digestOf(record);
      const outputId = record.id;
      steps.push({
        idx,
        actionId: a.id,
        kind: a.kind,
        status: "done",
        outputId,
        outputDigest: digest,
        at: FINISHED,
      });
      outputs.push({ outputId, actionId: a.id, kind: a.kind, digest, record });
    } else if (c === "f")
      steps.push({
        idx,
        actionId: a.id,
        kind: a.kind,
        status: "failed",
        error: "invalid",
        at: FINISHED,
      });
    else
      steps.push({ idx, actionId: a.id, kind: a.kind, status: c === "s" ? "skipped" : "pending" });
  }
  const finishedMs = Date.parse(FINISHED);
  const ackAt = "2026-10-17T10:00:00.000Z";
  const purge = acked
    ? Math.min(finishedMs + 180 * 86_400_000, Date.parse(ackAt) + 90 * 86_400_000)
    : finishedMs + 180 * 86_400_000;
  return {
    occurrenceId: body.occurrenceId,
    workflowId: body.workflowId,
    kind: body.kind,
    registrationEpoch: 1,
    revision: 1,
    body: JSON.parse(JSON.stringify(body)),
    payloadDigest: await digestOf(body),
    state,
    receiptVersion: version,
    changeSeq: version + 10,
    createdAt: SUBMITTED,
    updatedAt: terminal ? FINISHED : state === "pending" ? SUBMITTED : FINISHED,
    ackedVersion: acked ? version : 0,
    ...(state !== "pending" && state !== "cancelled" ? { startedAt: SUBMITTED } : {}),
    ...(terminal ? { finishedAt: FINISHED, purgeAt: new Date(purge).toISOString() } : {}),
    ...(acked ? { firstAckAt: ackAt } : {}),
    steps,
    outputs,
  };
}
/** The receipt through the pinned parser (it must be a valid Worker answer). */
async function verified(r: A, auth: Authority = AUTH) {
  const p = await parseAnswer(
    { kind: "status", ownerKey: auth.ownerKey, occurrenceId: r.occurrenceId },
    { status: 200, body: { ownerKey: auth.ownerKey, occurrence: r } },
    { origin: auth.origin },
  );
  if (p.outcome !== "ok" || p.kind !== "status" || p.result.found !== "row")
    throw new Error("not a valid receipt: " + JSON.stringify(p));
  expect(isVerifiedReceipt(p.result.receipt)).toBe(true);
  return r;
}
async function journalWith(bodies: OccurrenceBody[], origin = ORIGIN): Promise<CloudJournal> {
  let j = emptyJournal();
  for (const b of bodies) {
    const c = await candidateEntry(origin, b);
    if (!c.ok) throw new Error(c.reason);
    j = withEntry(
      j,
      { ...c.entry, commitId: "c-" + b.occurrenceId, state: "queued", observation: null },
      "c",
    );
  }
  return j;
}
const plan = (
  recon: CloudReconciliation,
  receipt: A,
  o: { journal?: CloudJournal; lists?: OutputLists; auth?: Authority } = {},
) =>
  planReceipt({
    recon,
    journal: o.journal ?? emptyJournal(),
    lists: o.lists ?? EMPTY,
    authority: o.auth ?? AUTH,
    receipt,
    commitId: "commit-" + Math.random().toString(36).slice(2),
  });
const ok = <T extends { ok: boolean }>(r: T) => {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
};
const key = (id: string, a: Authority = AUTH) => occurrenceKey(a, id)!;
const listsWith = (
  adopted: readonly { kind: string; record: A }[],
  base: OutputLists = EMPTY,
): OutputLists =>
  ({
    ideas: [...base.ideas, ...adopted.filter((x) => x.kind === "idea").map((x) => x.record)],
    posts: [...base.posts, ...adopted.filter((x) => x.kind === "post").map((x) => x.record)],
    planItems: [
      ...base.planItems,
      ...adopted.filter((x) => x.kind === "plan").map((x) => x.record),
    ],
  }) as OutputLists;
const proofOf = (r: CloudReconciliation, id: string, a: Authority = AUTH) =>
  r.proofs.find((p) => p.key === key(id, a))!;

describe("initial proof and terminal adoption", () => {
  it("a terminal receipt for an unknown occurrence binds a remote-initial proof and adopts its exact drafts", async () => {
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const out = ok(plan(emptyReconciliation(), r));
    expect(out.change).toBe("proven");
    expect(out.delivered).toBe(true);
    expect(out.adopted.map((x) => x.record)).toEqual(r.outputs.map((o: A) => o.record));
    const p = proofOf(out.next, "m1");
    expect(p).toMatchObject({
      source: "remote-initial",
      occurrenceId: "m1",
      workflowId: "w1",
      payloadDigest: r.payloadDigest,
      firstVersion: r.receiptVersion,
      resetEpoch: 0,
    });
    expect(p.outputs.map((o) => o.disposition)).toEqual(["adopted", "adopted"]);
    expect(out.next.runs).toHaveLength(1);
    expect(out.next.runs[0]).toMatchObject({ state: "done", receiptVersion: 4 });
  });

  it("a journal entry binds as source journal; a different body/digest refuses as mismatch", async () => {
    const b = bodyOf();
    const j = await journalWith([b]);
    const r = await verified(await receiptOf(b, "dd"));
    expect(proofOf(ok(plan(emptyReconciliation(), r, { journal: j })).next, "m1").source).toBe(
      "journal",
    );
    const other = await verified(
      await receiptOf(bodyOf("m1", OWNER, [idea("a1"), idea("a3")]), "dd"),
    );
    expect(plan(emptyReconciliation(), other, { journal: j })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("nonterminal receipts are bound and projected only: no outputs, no delivery", async () => {
    const b = bodyOf();
    const pending = await verified(await receiptOf(b, "pp"));
    const running = await verified(await receiptOf(b, "dp"));
    const a = ok(plan(emptyReconciliation(), pending));
    expect(a.change).toBe("bound");
    expect(a.adopted).toEqual([]);
    expect(a.delivered).toBe(false);
    expect(proofOf(a.next, "m1").outputs).toEqual([]);
    const c = ok(plan(a.next, running));
    expect(c.change).toBe("observed");
    expect(c.adopted).toEqual([]);
    expect(proofOf(c.next, "m1").firstVersion).toBe(1);
    const done = ok(plan(c.next, await verified(await receiptOf(b, "dd"))));
    expect(done.change).toBe("proven");
    expect(done.adopted).toHaveLength(2);
    expect(proofOf(done.next, "m1").firstVersion).toBe(1); // the immutable binding survives
  });

  it("partial and failed keep done-step outputs and failed/skipped steps honestly; cancelled proves an empty set", async () => {
    const b3 = bodyOf("m3", OWNER, [idea("a1"), idea("a2"), idea("a3")]);
    const partial = ok(plan(emptyReconciliation(), await verified(await receiptOf(b3, "dfs"))));
    expect(partial.adopted.map((x) => x.record.id)).toEqual(["wf:m3:a1"]);
    expect(partial.delivered).toBe(true);
    expect(partial.next.runs[0].steps.map((s) => s.status)).toEqual(["done", "failed", "skipped"]);
    const failed = ok(plan(emptyReconciliation(), await verified(await receiptOf(b3, "fss"))));
    expect(failed.adopted).toEqual([]);
    expect(proofOf(failed.next, "m3").outputs).toEqual([]);
    expect(failed.delivered).toBe(true);
    const cancelled = ok(plan(emptyReconciliation(), await verified(await receiptOf(b3, "sss"))));
    expect(cancelled.next.runs[0].state).toBe("cancelled");
    expect(cancelled.delivered).toBe(true);
    expect(ackEligibility(cancelled.next, key("m3"), EMPTY).ok).toBe(true);
  });

  it("a pre-reset occurrence (executionAt <= resetAt) proves suppressed outputs and writes none", async () => {
    const b = bodyOf();
    const j = resetJournal(emptyJournal(), new Date("2026-10-17T09:01:00.000Z"), "reset");
    const out = ok(
      plan(emptyReconciliation(), await verified(await receiptOf(b, "dd")), { journal: j }),
    );
    expect(out.adopted).toEqual([]);
    expect(proofOf(out.next, "m1").outputs.map((o) => o.disposition)).toEqual([
      "suppressed",
      "suppressed",
    ]);
    expect(proofOf(out.next, "m1").resetEpoch).toBe(1);
    expect(out.delivered).toBe(true);
    // Positive control: after the same reset, a later occurrence adopts normally.
    const later = bodyOf("m2", OWNER, [idea("a1")], "2026-10-17T09:02:00.000Z");
    const l = ok(
      plan(emptyReconciliation(), await verified(await receiptOf(later, "d")), { journal: j }),
    );
    expect(l.adopted).toHaveLength(1);
  });
});

describe("ordering, equal versions and immutable proof", () => {
  it("same is a no-op, older never replaces newer, an ack only adds, a contradiction refuses", async () => {
    const b = bodyOf();
    const r = await verified(await receiptOf(b, "dd"));
    const first = ok(plan(emptyReconciliation(), r));
    const lists = listsWith(first.adopted);
    const same = ok(plan(first.next, r, { lists }));
    expect(same.change).toBe("same");
    expect(same.next).toBe(first.next);
    const older = ok(plan(first.next, await verified(await receiptOf(b, "dp")), { lists }));
    expect(older.change).toBe("older");
    expect(older.next).toBe(first.next);
    const acked = await verified(await receiptOf(b, "dd", true));
    const add = ok(plan(first.next, acked, { lists }));
    expect(add.change).toBe("observed");
    expect(add.adopted).toEqual([]);
    expect(proofOf(add.next, "m1").receipt.ackedVersion).toBe(4);
    // The un-acked receipt after the acked one is older (an ack is never removed).
    expect(ok(plan(add.next, r, { lists })).change).toBe("older");
    const contradiction = JSON.parse(JSON.stringify(r));
    contradiction.changeSeq += 1;
    expect(plan(first.next, await verified(contradiction), { lists })).toEqual({
      ok: false,
      reason: "conflict",
    });
  });

  it("an equal-version receipt of another body for the same key refuses (immutable binding)", async () => {
    const first = ok(plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "dd"))));
    const other = await verified(
      await receiptOf(bodyOf("m1", OWNER, [idea("a1"), idea("a9")]), "dd"),
    );
    expect(plan(first.next, other)).toEqual({ ok: false, reason: "mismatch" });
  });
});

describe("collisions and ownership across authorities and local records", () => {
  it("an unowned local record with the wf: id is a collision: kept byte-identical, no delivery", async () => {
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const local = { ...recordOf("m1", "a1"), text: "mine" };
    const out = ok(
      plan(emptyReconciliation(), r, { lists: { ...EMPTY, ideas: [local] } as OutputLists }),
    );
    expect(out.delivered).toBe(false);
    expect(out.collisions).toEqual(["wf:m1:a1"]);
    expect(out.adopted.map((x) => x.record.id)).toEqual(["wf:m1:a2"]);
    expect(proofOf(out.next, "m1").outputs.map((o) => o.disposition)).toEqual([
      "collision",
      "adopted",
    ]);
    expect(
      ackEligibility(
        out.next,
        key("m1"),
        listsWith(out.adopted, { ...EMPTY, ideas: [local] } as OutputLists),
      ),
    ).toEqual({
      ok: false,
      reason: "collision",
    });
  });

  it("the same occurrence id under another authority collides with the first authority's owned outputs", async () => {
    const a = ok(plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "dd"))));
    const lists = listsWith(a.adopted);
    const rb = await verified(await receiptOf(bodyOf("m1", OWNER_B), "dd"), AUTH_B);
    const b = ok(plan(a.next, rb, { lists, auth: AUTH_B }));
    expect(b.adopted).toEqual([]);
    expect(b.collisions).toEqual(["wf:m1:a1", "wf:m1:a2"]);
    // Even when the first authority's outputs were deleted locally (still owned): collision, never adoption.
    const del = applyDeletions(a.next, lists, EMPTY);
    const c = ok(plan(del, rb, { auth: AUTH_B }));
    expect(c.adopted).toEqual([]);
    expect(c.collisions).toEqual(["wf:m1:a1", "wf:m1:a2"]);
  });

  it("owned outputs stay owned: edited = retained (never overwritten), absent = deleted (never resurrected)", async () => {
    const b = bodyOf();
    const first = ok(plan(emptyReconciliation(), await verified(await receiptOf(b, "dd"))));
    const edited = { ...first.adopted[0].record, text: "edited" };
    const lists = { ...EMPTY, ideas: [edited] } as unknown as OutputLists; // a2 removed by an unhooked path
    const again = ok(plan(first.next, await verified(await receiptOf(b, "dd", true)), { lists }));
    expect(again.adopted).toEqual([]);
    expect(proofOf(again.next, "m1").outputs.map((o) => o.disposition)).toEqual([
      "retained",
      "deleted",
    ]);
    expect(again.delivered).toBe(true);
  });
});

describe("deletion evidence, import filter and reset", () => {
  it("applyDeletions marks only owned outputs that the write removes; others and edits are untouched", async () => {
    const first = ok(plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "dd"))));
    const before = listsWith(first.adopted, {
      ...EMPTY,
      ideas: [{ id: "local-1" }],
    } as OutputLists);
    const after = {
      ...before,
      ideas: before.ideas.filter((i) => i.id !== "wf:m1:a1" && i.id !== "local-1"),
    };
    const next = applyDeletions(first.next, before, after);
    expect(proofOf(next, "m1").outputs.map((o) => o.disposition)).toEqual(["deleted", "adopted"]);
    expect(applyDeletions(first.next, before, before)).toBe(first.next); // nothing removed: same object
    // A deleted output is never re-adopted by a later receipt, and an import cannot bring it back.
    const r2 = await verified(await receiptOf(bodyOf(), "dd", true));
    const later = ok(plan(next, r2, { lists: after }));
    expect(later.adopted).toEqual([]);
    expect(dropDeleted(before, next).ideas.map((i) => i.id)).toEqual(["local-1", "wf:m1:a2"]);
    // Reset = every owned output removed.
    const reset = applyDeletions(first.next, before, EMPTY);
    expect(proofOf(reset, "m1").outputs.every((o) => o.disposition === "deleted")).toBe(true);
  });
});

describe("retirement, tombstones and capacity", () => {
  it("only a matching pruned digest retires; the tombstone blocks a held old receipt; the generation advances", async () => {
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const first = ok(plan(emptyReconciliation(), r));
    const deleted = applyDeletions(first.next, listsWith(first.adopted), EMPTY);
    expect(
      retireOccurrence(deleted, {
        authority: AUTH,
        occurrenceId: "m1",
        payloadDigest: "0".repeat(64),
        prunedAt: FINISHED,
        journalKnown: false,
      }),
    ).toEqual({ ok: false, reason: "mismatch" });
    const ret = ok(
      retireOccurrence(deleted, {
        authority: AUTH,
        occurrenceId: "m1",
        payloadDigest: r.payloadDigest,
        prunedAt: FINISHED,
        journalKnown: false,
      }),
    );
    expect(ret.retired).toBe(true);
    expect(ret.next.proofs).toEqual([]);
    expect(ret.next.tombstones[0]).toMatchObject({
      occurrenceId: "m1",
      deleted: ["wf:m1:a1", "wf:m1:a2"],
    });
    expect(ret.next.authorities[0].retired).toBe(1);
    expect(plan(ret.next, r)).toEqual({ ok: false, reason: "retired" });
    expect(dropDeleted(listsWith(first.adopted), ret.next).ideas).toEqual([]);
    // Unknown locally: nothing to retire, nothing written.
    const none = ok(
      retireOccurrence(emptyReconciliation(), {
        authority: AUTH,
        occurrenceId: "zz",
        payloadDigest: r.payloadDigest,
        prunedAt: FINISHED,
        journalKnown: false,
      }),
    );
    expect(none.retired).toBe(false);
  });

  it("proof-full at 600 refuses a new occurrence without evicting; an existing one still updates; tombstones stay <= 100", async () => {
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const p = proofOf(ok(plan(emptyReconciliation(), r)).next, "m1");
    const proofs: ProofRecord[] = Array.from({ length: PROOF_CAPACITY }, (_, i) => ({
      ...p,
      key: key(`p${String(i).padStart(4, "0")}`),
      occurrenceId: `p${String(i).padStart(4, "0")}`,
    })).sort((x, y) => (x.key < y.key ? -1 : 1));
    const full: CloudReconciliation = { ...emptyReconciliation(), proofs };
    expect(plan(full, r)).toEqual({ ok: false, reason: "proof-full" });
    // At the cap, a retirement converts a proof into a tombstone (the count is unchanged, nothing evicted).
    let rec: CloudReconciliation = {
      ...emptyReconciliation(),
      proofs: [...proofs.slice(1), proofOf(ok(plan(emptyReconciliation(), r)).next, "m1")].sort(
        (x, y) => (x.key < y.key ? -1 : 1),
      ),
    };
    expect(ok(plan(rec, await verified(await receiptOf(bodyOf(), "dd", true)))).change).toBe(
      "observed",
    );
    for (let i = 1; i <= TOMBSTONES_MAX; i++) {
      const id = `p${String(i).padStart(4, "0")}`;
      rec = ok(
        retireOccurrence(rec, {
          authority: AUTH,
          occurrenceId: id,
          payloadDigest: p.payloadDigest,
          prunedAt: FINISHED,
          journalKnown: false,
        }),
      ).next;
    }
    expect(rec.tombstones).toHaveLength(TOMBSTONES_MAX);
    expect(rec.tombstones[0].occurrenceId).toBe("p0001");
    expect(rec.proofs.length + rec.tombstones.length).toBeLessThanOrEqual(PROOF_CAPACITY);
    expect(rec.authorities[0].retired).toBe(TOMBSTONES_MAX);
    expect(retire(rec, "p0101", p.payloadDigest)).toEqual({ ok: false, reason: "retirement-full" });
    expect(rec.proofs.some((p) => p.occurrenceId === "p0101")).toBe(true);
  });
});

describe("pending records and the cursor", () => {
  it("the cursor is a monotonic max per authority; pending is keyed and cleared by a proof", async () => {
    let rec = withCursor(emptyReconciliation(), AUTH, 7);
    rec = withCursor(rec, AUTH, 3);
    expect(rec.authorities[0].cursor).toBe(7);
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const pend = ok(
      withPending(rec, {
        key: key("m1"),
        authority: AUTH,
        occurrenceId: "m1",
        changeSeq: 14,
        receiptVersion: 4,
        payloadDigest: r.payloadDigest,
        reason: "unconfirmed",
      }),
    );
    expect(pend.next.pending).toHaveLength(1);
    expect(ok(plan(pend.next, r)).next.pending).toEqual([]);
  });
});

describe("import merge", () => {
  it("unions proofs monotonically, takes max cursor/retired, unions deletion evidence and tombstones", async () => {
    const b = bodyOf();
    const r = await verified(await receiptOf(b, "dd"));
    const base = ok(plan(emptyReconciliation(), r));
    const lists = listsWith(base.adopted);
    const mine = withCursor(
      applyDeletions(base.next, lists, { ...lists, ideas: lists.ideas.slice(1) }),
      AUTH,
      5,
    );
    const theirs = withCursor(
      ok(plan(base.next, await verified(await receiptOf(b, "dd", true)), { lists })).next,
      AUTH,
      9,
    );
    const m = ok(mergeReconciliations(mine, theirs));
    expect(m.changed).toBe(true);
    const p = proofOf(m.next, "m1");
    expect(p.receipt.ackedVersion).toBe(4);
    expect(p.outputs.map((o) => o.disposition)).toEqual(["deleted", "adopted"]);
    expect(m.next.authorities[0].cursor).toBe(9);
    expect(ok(mergeReconciliations(m.next, m.next)).changed).toBe(false);
    // A tombstone on either side beats the proof.
    const retired = ok(
      retireOccurrence(theirs, {
        authority: AUTH,
        occurrenceId: "m1",
        payloadDigest: r.payloadDigest,
        prunedAt: FINISHED,
        journalKnown: false,
      }),
    ).next;
    const t = ok(mergeReconciliations(mine, retired));
    expect(t.next.proofs).toEqual([]);
    expect(t.next.tombstones).toHaveLength(1);
    expect(t.next.authorities[0].retired).toBe(1);
  });

  it("refuses an equal-version contradiction or a changed binding with the keys; refuses over capacity", async () => {
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const a = ok(plan(emptyReconciliation(), r)).next;
    const c = JSON.parse(JSON.stringify(r));
    c.changeSeq += 1;
    const b = ok(plan(emptyReconciliation(), await verified(c))).next;
    expect(mergeReconciliations(a, b)).toEqual({
      ok: false,
      reason: "conflict",
      keys: [key("m1")],
    });
    const p = proofOf(a, "m1");
    const many = Array.from({ length: PROOF_CAPACITY }, (_, i) => ({
      ...p,
      key: key(`q${String(i).padStart(4, "0")}`),
      occurrenceId: `q${String(i).padStart(4, "0")}`,
    })).sort((x, y) => (x.key < y.key ? -1 : 1));
    expect(mergeReconciliations(a, { ...emptyReconciliation(), proofs: many })).toMatchObject({
      ok: false,
      reason: "capacity",
    });
  });
});

describe("structure, validation and read-back", () => {
  it("parses exactly; absent is empty, malformed is null (never coerced to empty)", async () => {
    const out = ok(plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "dd"))));
    const next = stamp(emptyReconciliation(), out.next, "c1");
    expect(next.generation).toBe(1);
    expect(parseReconciliation(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(readReconciliation(undefined)).toEqual(emptyReconciliation());
    expect(readReconciliation({ ...next, extra: 1 })).toBeNull();
    expect(readReconciliation({ ...next, v: 2 })).toBeNull();
    expect(readReconciliation(null)).toBeNull();
    const dup = { ...next, proofs: [next.proofs[0], next.proofs[0]] };
    expect(readReconciliation(dup)).toBeNull();
    const badKey = { ...next, proofs: [{ ...next.proofs[0], key: key("other") }] };
    expect(readReconciliation(badKey)).toBeNull();
    expect(reconciliationIs(JSON.parse(JSON.stringify(next)), next)).toBe(true);
    expect(reconciliationIs(undefined, next)).toBe(false);
  });

  it("a persisted proof is accepted only when the pinned parser re-verifies its receipt and binding now", async () => {
    const out = ok(plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "dd"))));
    const p = proofOf(out.next, "m1");
    const v = await verifyProof(JSON.parse(JSON.stringify(p)));
    expect(v && isVerifiedReceipt(v)).toBe(true);
    const tampered = JSON.parse(JSON.stringify(p));
    tampered.receipt.outputs[0].record.text = "tampered";
    expect(await verifyProof(tampered)).toBeNull();
    const wrongDigest = { ...JSON.parse(JSON.stringify(p)), payloadDigest: "1".repeat(64) };
    expect(await verifyProof(wrongDigest)).toBeNull();
    const wrongOutputs = JSON.parse(JSON.stringify(p));
    wrongOutputs.outputs[0].digest = "2".repeat(64);
    expect(await verifyProof(wrongOutputs)).toBeNull();
    const foreign = { ...JSON.parse(JSON.stringify(p)), authority: { ...AUTH_B } };
    expect(await verifyProof(foreign)).toBeNull();
  });

  it("the runs projection is its own schema and trims only the oldest terminal runs", async () => {
    let rec = emptyReconciliation();
    for (let i = 0; i < CLOUD_RUNS_MAX + 3; i++) {
      const b = bodyOf(`r${String(i).padStart(4, "0")}`, OWNER, [idea("a1")]);
      rec = ok(plan(rec, await verified(await receiptOf(b, "d")))).next;
    }
    expect(rec.runs).toHaveLength(CLOUD_RUNS_MAX);
    expect(rec.proofs).toHaveLength(CLOUD_RUNS_MAX + 3); // proof survives projection trimming
    expect(rec.runs.some((x) => x.occurrenceId === "r0000")).toBe(false);
  });
});

/* ---------- DT-7C-2C-R1: ownership after retirement, bounded fold, reset on imported proof ---------- */

const retire = (rec: CloudReconciliation, id: string, digest: string, journalKnown = false) =>
  retireOccurrence(rec, {
    authority: AUTH,
    occurrenceId: id,
    payloadDigest: digest,
    prunedAt: FINISHED,
    journalKnown,
  });
/** `n` journal-only retirements (no proof: final change_seq unknown, never foldable). */
function unknownTombstones(rec: CloudReconciliation, n: number, prefix = "j") {
  for (let i = 0; i < n; i++) rec = ok(retire(rec, `${prefix}${i}`, "a".repeat(64), true)).next;
  return rec;
}
/** A terminal "dd" receipt for `id` with an explicit change_seq. */
async function seqReceipt(id: string, seq: number, at = AT) {
  const r = await receiptOf(bodyOf(id, OWNER, [idea("a1"), idea("a2")], at), "dd");
  r.changeSeq = seq;
  return verified(r);
}

describe("R1 7C2C-1: a retired proof keeps compact ownership of its outputs", () => {
  it("retirement records owned + deleted ids and the final change_seq; a later removal becomes deleted", async () => {
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const first = ok(plan(emptyReconciliation(), r));
    const lists = listsWith(first.adopted);
    const ret = ok(retire(first.next, "m1", r.payloadDigest));
    expect(ret.next.tombstones[0]).toMatchObject({
      deleted: [],
      owned: ["wf:m1:a1", "wf:m1:a2"],
      changeSeq: r.changeSeq,
    });
    // Positive control: nothing removed = same object; still-present outputs are untouched.
    expect(applyDeletions(ret.next, lists, lists)).toBe(ret.next);
    const after = { ...lists, ideas: lists.ideas.filter((x) => x.id !== "wf:m1:a1") };
    const del = applyDeletions(ret.next, lists, after);
    expect(del.tombstones[0]).toMatchObject({ deleted: ["wf:m1:a1"], owned: ["wf:m1:a2"] });
    expect(parseReconciliation(JSON.parse(JSON.stringify(del)))).toEqual(del);
    // The genuine pre-retirement proof from an old backup: the tombstone beats it, the deleted draft is filtered.
    const m = ok(mergeReconciliations(del, first.next));
    expect(m.next.proofs).toEqual([]);
    expect(dropDeleted(lists, m.next).ideas.map((x) => x.id)).toEqual(["wf:m1:a2"]);
    // Reset after retirement: every owned id cleared is deleted.
    const reset = applyDeletions(ret.next, lists, EMPTY);
    expect(reset.tombstones[0]).toMatchObject({ deleted: ["wf:m1:a1", "wf:m1:a2"], owned: [] });
  });

  it("a nonterminal proof / journal-only retirement owns nothing and has no known final change_seq", async () => {
    const bound = ok(plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "pp"))));
    const ret = ok(retire(bound.next, "m1", bound.next.proofs[0].payloadDigest));
    expect(ret.next.tombstones[0]).toMatchObject({ deleted: [], owned: [], changeSeq: null });
    expect(unknownTombstones(emptyReconciliation(), 1).tombstones[0]).toMatchObject({
      owned: [],
      changeSeq: null,
    });
  });

  it("a tombstone-owned id still collides for another authority; another occurrence adopts", async () => {
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const first = ok(plan(emptyReconciliation(), r));
    const ret = ok(retire(first.next, "m1", r.payloadDigest)).next;
    const rb = await verified(await receiptOf(bodyOf("m1", OWNER_B), "dd"), AUTH_B);
    const b = ok(plan(ret, rb, { auth: AUTH_B }));
    expect(b.adopted).toEqual([]);
    expect(b.collisions).toEqual(["wf:m1:a1", "wf:m1:a2"]);
    const other = await verified(await receiptOf(bodyOf("m7", OWNER_B), "dd"), AUTH_B);
    expect(ok(plan(ret, other, { auth: AUTH_B })).adopted).toHaveLength(2);
  });
});

describe("C1 retirement capacity preserves all ownership and deletion evidence", () => {
  it("the 101st retirement refuses without folding; retained markers still defeat old backups", async () => {
    const r = await seqReceipt("m1", 30);
    const first = ok(plan(emptyReconciliation(), r));
    let rec = ok(retire(first.next, "m1", r.payloadDigest)).next;
    rec = unknownTombstones(rec, TOMBSTONES_MAX - 1);
    const before = JSON.stringify(rec);
    expect(retire(rec, "j-extra", "a".repeat(64), true)).toEqual({
      ok: false,
      reason: "retirement-full",
    });
    expect(JSON.stringify(rec)).toBe(before);
    expect(rec.tombstones).toHaveLength(TOMBSTONES_MAX);
    expect(rec.tombstones[0].owned).toEqual(["wf:m1:a1", "wf:m1:a2"]);
    expect(rec.authorities[0].watermark).toBeUndefined();
    expect(parseReconciliation(JSON.parse(before))).toEqual(rec);
    const lists = listsWith(first.adopted);
    const deleted = applyDeletions(rec, lists, { ...lists, ideas: lists.ideas.slice(1) });
    const m = ok(mergeReconciliations(deleted, first.next));
    expect(m.next.proofs).toEqual([]);
    expect(dropDeleted(lists, m.next, m.drop).ideas.map((x) => x.id)).toEqual(["wf:m1:a2"]);
    const newer = ok(plan(emptyReconciliation(), await seqReceipt("m9", 31))).next;
    expect(ok(mergeReconciliations(rec, newer)).next.proofs.map((p) => p.key)).toEqual([key("m9")]);
  });

  it("neither resolved nor still-owned markers are discarded at capacity", async () => {
    const a = await seqReceipt("ma", 10);
    const b = await seqReceipt("mb", 50);
    const pa = ok(plan(emptyReconciliation(), a));
    let rec = ok(retire(pa.next, "ma", a.payloadDigest)).next;
    const pb = ok(plan(rec, b));
    const del = applyDeletions(pb.next, listsWith(pb.adopted), EMPTY);
    rec = ok(retire(del, "mb", b.payloadDigest)).next;
    rec = unknownTombstones(rec, TOMBSTONES_MAX - 2);
    expect(retire(rec, "j-last", "a".repeat(64), true)).toEqual({
      ok: false,
      reason: "retirement-full",
    });
    expect(rec.tombstones.find((t) => t.key === key("ma"))?.owned).toHaveLength(2);
    expect(rec.tombstones.find((t) => t.key === key("mb"))?.deleted).toHaveLength(2);
    expect(ok(retire(rec, "ma", a.payloadDigest)).retired).toBe(false);
  });

  it("an over-capacity import refuses even with known sequences; a legacy watermark refuses in either operand", async () => {
    const r = await seqReceipt("m1", 30);
    const first = ok(plan(emptyReconciliation(), r));
    const retired = ok(retire(first.next, "m1", r.payloadDigest)).next;
    const full = unknownTombstones(emptyReconciliation(), TOMBSTONES_MAX);
    for (const extra of [retired, unknownTombstones(emptyReconciliation(), 1, "k")])
      expect(mergeReconciliations(full, extra)).toEqual({
        ok: false,
        reason: "capacity",
        keys: [],
      });
    expect(
      ok(mergeReconciliations(unknownTombstones(emptyReconciliation(), 99), retired)).next
        .tombstones,
    ).toHaveLength(100);
    const legacy = {
      ...retired,
      tombstones: [],
      authorities: retired.authorities.map((a) => ({ ...a, watermark: 30 })),
    };
    for (const [fresh, imported] of [
      [legacy, first.next],
      [first.next, legacy],
    ])
      expect(mergeReconciliations(fresh, imported)).toEqual({
        ok: false,
        reason: "conflict",
        keys: [legacy.authorities[0].key],
      });
    expect(plan(legacy, r)).toEqual({ ok: false, reason: "retired" });
    expect(ok(plan({ ...legacy, proofs: first.next.proofs }, r)).next.proofs).toHaveLength(1);
  });

  it("old (C2C) and new slice formats parse; malformed ownership is refused", async () => {
    const r = await verified(await receiptOf(bodyOf(), "dd"));
    const p = ok(plan(emptyReconciliation(), r)).next;
    const ret = ok(retire(p, "m1", r.payloadDigest)).next;
    const old = JSON.parse(JSON.stringify(ret));
    delete old.tombstones[0].owned;
    delete old.tombstones[0].changeSeq;
    expect(parseReconciliation(old)).toEqual(old); // the C2C format stays readable
    const t = ret.tombstones[0] as A;
    const bad = (edit: A) => ({ ...ret, tombstones: [{ ...t, ...edit }] });
    expect(parseReconciliation(bad({ deleted: ["wf:m1:a1"] }))).toBeNull(); // owned and deleted overlap
    expect(parseReconciliation(bad({ owned: ["wf:zz:a1"] }))).toBeNull(); // another occurrence's id
    expect(parseReconciliation(bad({ changeSeq: 0 }))).toBeNull();
    expect(parseReconciliation(bad({ executionAt: "not-a-date" }))).toBeNull();
    expect(parseReconciliation(bad({ executionAt: 1 }))).toBeNull();
    const contradictoryTime = {
      ...ret,
      tombstones: [{ ...ret.tombstones[0], executionAt: "2026-10-17T09:03:00.000Z" }],
    };
    expect(mergeReconciliations(ret, contradictoryTime)).toMatchObject({
      ok: false,
      reason: "conflict",
    });
    const auth = { ...ret, authorities: [{ ...ret.authorities[0], watermark: -1 }] };
    expect(parseReconciliation(auth)).toBeNull();
    // The old-format tombstone still beats the old proof on import.
    expect(ok(mergeReconciliations(parseReconciliation(old)!, p)).next.proofs).toEqual([]);
  });
});

describe("R1 7C2C-3: the merged reset applies to a proof first learned from a backup", () => {
  it("pre-reset outputs become suppressed and are dropped; post-reset and owned local proofs are unaffected", async () => {
    const j = resetJournal(emptyJournal(), new Date("2026-10-17T09:01:00.000Z"), "reset");
    const reset = j.suppression;
    const pre = ok(plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "dd"))));
    const opts = { suppression: reset, present: EMPTY };
    const m = ok(mergeReconciliations(emptyReconciliation(), pre.next, opts));
    expect(proofOf(m.next, "m1").outputs.map((o) => o.disposition)).toEqual([
      "suppressed",
      "suppressed",
    ]);
    expect(m.drop).toEqual(["wf:m1:a1", "wf:m1:a2"]);
    // A local nonterminal proof (no outputs yet): the backup's terminal outputs are suppressed too.
    const bound = ok(plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "pp"))));
    const mb = ok(mergeReconciliations(bound.next, pre.next, opts));
    expect(proofOf(mb.next, "m1").outputs.map((o) => o.disposition)).toEqual([
      "suppressed",
      "suppressed",
    ]);
    // Local suppressed vs backup adopted (rank): the backup's drafts are dropped.
    const local = ok(
      plan(emptyReconciliation(), await verified(await receiptOf(bodyOf(), "dd")), { journal: j }),
    );
    expect(ok(mergeReconciliations(local.next, pre.next, opts)).drop).toEqual([
      "wf:m1:a1",
      "wf:m1:a2",
    ]);
    // Positive controls: post-reset work and a local proof that already owns outputs keep their dispositions.
    const later = bodyOf("m2", OWNER, [idea("a1")], "2026-10-17T09:02:00.000Z");
    const post = ok(plan(emptyReconciliation(), await verified(await receiptOf(later, "d"))));
    const mp = ok(mergeReconciliations(emptyReconciliation(), post.next, opts));
    expect(proofOf(mp.next, "m2").outputs.map((o) => o.disposition)).toEqual(["adopted"]);
    expect(mp.drop).toEqual([]);
    const lists = listsWith(pre.adopted);
    const edited = {
      ...lists,
      ideas: [{ ...lists.ideas[0], text: "edited" }, lists.ideas[1]],
    } as OutputLists;
    const acked = await verified(await receiptOf(bodyOf(), "dd", true));
    const owned = ok(plan(pre.next, acked, { lists: edited }));
    const mo = ok(mergeReconciliations(owned.next, pre.next, { ...opts, present: edited }));
    expect(proofOf(mo.next, "m1").outputs.map((o) => o.disposition)).toEqual([
      "retained",
      "adopted",
    ]);
    expect(mo.drop).toEqual([]);
  });
});
