import { describe, expect, it } from "vitest";
import { canonicalJson } from "@/workers/scout/src/social/workflowProtocol";
import { authorityOf, parseAnswer, type CloudRequest } from "./cloudWorkflowProtocol";
import {
  REGISTRATION_CAPACITY,
  createIntent,
  emptyRegistrations,
  findRecord,
  isRecoverable,
  isUnresolved,
  mergeRegistrations,
  parseRegistrations,
  prepareIntent,
  readRegistrations,
  recordOutcome,
  registrationKey,
  registrationsIs,
  reserveAttempt,
  verifyRegistrations,
  wireOf,
  type CloudRegistrations,
  type Outcome,
  type Prepared,
  type WireAnswer,
} from "./cloudWorkflowRegistration";

// ⚙️ DT-7C-2B-2 pure registration-intent state (planning/tools/38-cloud-workflows.md): the transition table, strict
// parse + revalidation through the pinned parser, and the monotonic import merge. No transport, store or clock.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OWNER = "wfo_" + "a".repeat(32);
const OWNER_B = "wfo_" + "b".repeat(32);
const ORIGIN = "https://scout.example";
const ORIGIN_B = "https://other.example";
const AUTH = authorityOf(ORIGIN, OWNER)!;
const DIG = "d".repeat(64);
const DIG2 = "e".repeat(64);
const CREATED = "2026-10-18T07:00:00.000Z";
const opened = (e: number) => `2026-10-18T0${e}:00:00.000Z`;
const closed = (e: number) => `2026-10-18T0${e}:30:00.000Z`;

/** A registration snapshot the pinned parser accepts. */
function registration(epoch: number, state: "active" | "unregistered", o: A = {}): A {
  return {
    workflowId: o.workflowId ?? "w1",
    registrationEpoch: epoch,
    revision: o.revision ?? 1,
    workflowDigest: o.digest ?? DIG,
    state,
    paused: o.paused ?? false,
    updatedAt: o.updatedAt ?? (state === "active" ? opened(epoch) : closed(epoch)),
    epochs: Array.from({ length: epoch }, (_, i) => ({
      epoch: i + 1,
      openedAt: opened(i + 1),
      ...(i < epoch - 1 || state === "unregistered" ? { closedAt: closed(i + 1) } : {}),
    })),
  };
}
const registerReq = (o: A = {}): CloudRequest => ({
  kind: "register",
  ownerKey: OWNER,
  workflowId: "w1",
  expectedEpoch: 0,
  revision: 1,
  workflowDigest: DIG,
  ...o,
});
const unregisterReq = (o: A = {}): CloudRequest => ({
  kind: "unregister",
  ownerKey: OWNER,
  workflowId: "w1",
  registrationEpoch: 1,
  expectedRevision: 1,
  ...o,
});
const okRegister = (req: A, created = true): WireAnswer => ({
  status: 200,
  body: {
    ownerKey: req.ownerKey,
    registration: registration(req.expectedEpoch + 1, "active", {
      workflowId: req.workflowId,
      revision: req.revision,
      digest: req.workflowDigest,
    }),
    created,
  },
});
const okUnregister = (req: A, changed = true, digest = DIG): WireAnswer => ({
  status: 200,
  body: {
    ownerKey: req.ownerKey,
    registration: registration(req.registrationEpoch, "unregistered", {
      workflowId: req.workflowId,
      revision: req.expectedRevision,
      digest,
    }),
    changed,
  },
});
const conflict = (reg: A | null): WireAnswer => ({
  status: 409,
  body: { error: "conflict", ownerKey: OWNER, registration: reg },
});
const capacity: WireAnswer = { status: 409, body: { error: "capacity", ownerKey: OWNER } };

async function answer(req: CloudRequest, a: WireAnswer): Promise<Outcome> {
  const parsed = await parseAnswer(req, a, { origin: ORIGIN });
  expect(parsed.outcome).not.toBe("invalid");
  return { kind: "answer", answer: a, parsed };
}
function prepared(raw: unknown = registerReq(), digest?: unknown, auth = AUTH): Prepared {
  const p = prepareIntent(raw, auth, digest);
  if (!p.ok) throw new Error(p.reason);
  return p;
}
function created(slice = emptyRegistrations(), p = prepared(), op = "op-1") {
  const r = createIntent(slice, p, op, CREATED);
  if (!r.ok) throw new Error(r.reason);
  return r.next;
}
function reserved(slice: CloudRegistrations, key = KEY) {
  const i = findRecord(slice, key)!.intent;
  const r = reserveAttempt(slice, key, {
    operationId: i.operationId,
    attempts: i.attempts,
    state: i.state,
  });
  if (!r.ok) throw new Error(r.reason);
  return { next: r.next, attempt: r.attempt };
}
function outcome(slice: CloudRegistrations, attempt: number, o: Outcome, op = "op-1", key = KEY) {
  return recordOutcome(slice, key, op, attempt, o);
}
const KEY = registrationKey(AUTH, "w1")!;
const intentOf = (s: CloudRegistrations, key = KEY) => findRecord(s, key)!.intent;
const roundTrip = (s: CloudRegistrations) => parseRegistrations(JSON.parse(JSON.stringify(s)));

describe("keys, empty and strict structure", () => {
  it("keys by canonical origin + server ownerKey + workflow id, unambiguously", () => {
    expect(KEY).toBe(canonicalJson([ORIGIN, OWNER, "w1"]));
    expect(registrationKey(authorityOf(ORIGIN_B, OWNER)!, "w1")).not.toBe(KEY);
    expect(registrationKey(authorityOf(ORIGIN, OWNER_B)!, "w1")).not.toBe(KEY);
    expect(registrationKey(AUTH, "bad id")).toBeNull();
    expect(readRegistrations(undefined)).toEqual(emptyRegistrations());
    expect(readRegistrations(null)).toBeNull();
    expect(readRegistrations({ v: 1, generation: 0, records: [], extra: 1 })).toBeNull();
  });

  it("captures an immutable detached request before anything else (caller edits afterwards change nothing)", () => {
    const raw = registerReq() as A;
    const p = prepared(raw);
    raw.revision = 9;
    raw.workflowDigest = DIG2;
    expect(p.request).toEqual(registerReq());
    expect(Object.isFrozen(p.request)).toBe(true);
    expect(p.body).toEqual({
      ownerKey: OWNER,
      workflowId: "w1",
      expectedEpoch: 0,
      revision: 1,
      workflowDigest: DIG,
    });
    expect(p.path).toBe("/social/workflows/registrations");
    expect([p.revision, p.workflowDigest]).toEqual([1, DIG]);
  });

  it("refuses other kinds, extra fields, non-plain data, a foreign owner and a missing/mismatched digest", () => {
    const bad = (raw: unknown, digest?: unknown) => prepareIntent(raw, AUTH, digest);
    expect(bad({ ...unregisterReq(), kind: "pause" }, DIG)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(bad({ ...registerReq(), token: "CANARY" })).toEqual({ ok: false, reason: "invalid" });
    expect(bad({ ...registerReq(), revision: new Date() })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(bad(registerReq({ ownerKey: OWNER_B }))).toEqual({ ok: false, reason: "foreign_owner" });
    expect(bad(unregisterReq())).toEqual({ ok: false, reason: "invalid" });
    expect(bad(registerReq(), DIG2)).toEqual({ ok: false, reason: "invalid" });
    const u = prepared(unregisterReq(), DIG);
    expect([u.revision, u.workflowDigest, u.path]).toEqual([
      1,
      DIG,
      "/social/workflows/registrations/w1/unregister",
    ]);
  });
});

describe("create: one unresolved intent per key, capacity without eviction", () => {
  it("creates a pending intent with seq 1 and refuses a second while it is unresolved", () => {
    const s = created();
    expect(intentOf(s)).toMatchObject({
      seq: 1,
      operationId: "op-1",
      state: "pending",
      attempts: 0,
      maybeApplied: false,
      reservedFrom: null,
      answer: null,
    });
    expect(s.generation).toBe(1);
    expect(isUnresolved(intentOf(s))).toBe(true);
    expect(createIntent(s, prepared(), "op-2", CREATED)).toEqual({
      ok: false,
      reason: "unresolved",
    });
  });

  it("refuses a 101st key but still allows a new intent for an existing resolved key at the cap", async () => {
    let s = emptyRegistrations();
    for (let i = 0; i < REGISTRATION_CAPACITY; i++)
      s = created(s, prepared(registerReq({ workflowId: `w${i}` })), `op-${i}`);
    expect(s.records).toHaveLength(REGISTRATION_CAPACITY);
    expect(createIntent(s, prepared(registerReq({ workflowId: "extra" })), "x", CREATED)).toEqual({
      ok: false,
      reason: "capacity",
    });
    const k0 = registrationKey(AUTH, "w0")!;
    const r = reserved(s, k0);
    const done = outcome(
      r.next,
      r.attempt,
      await answer(
        registerReq({ workflowId: "w0" }),
        okRegister(registerReq({ workflowId: "w0" })),
      ),
      "op-0",
      k0,
    );
    if (!done.changed) throw new Error("not settled");
    const again = createIntent(
      done.next,
      prepared(unregisterReq({ workflowId: "w0" }), DIG),
      "u0",
      CREATED,
    );
    expect(again.ok).toBe(true);
    if (again.ok)
      expect(findRecord(again.next, k0)!.intent).toMatchObject({ seq: 2, state: "pending" });
  });
});

describe("the transition table", () => {
  it("pending -> dispatching -> settled on a bound ok answer; history recorded; ok again changes nothing", async () => {
    const r = reserved(created());
    expect(intentOf(r.next)).toMatchObject({
      state: "dispatching",
      attempts: 1,
      reservedFrom: "pending",
    });
    const ok = await answer(registerReq(), okRegister(registerReq()));
    const done = outcome(r.next, 1, ok);
    expect(done.changed && done.state).toBe("settled");
    if (!done.changed) return;
    const rec = findRecord(done.next, KEY)!;
    expect(rec.intent).toMatchObject({ state: "settled", reservedFrom: null, maybeApplied: false });
    expect(rec.last?.answer).toEqual(ok.kind === "answer" && ok.answer);
    expect(outcome(done.next, 1, ok)).toEqual({ changed: false, state: "settled", reason: "same" });
    expect(isUnresolved(rec.intent) || isRecoverable(rec.intent)).toBe(false);
  });

  it("a lost answer (uncertain) stays unresolved and recoverable; a recovery reservation is a new attempt", async () => {
    const r = reserved(created());
    const u = outcome(r.next, 1, { kind: "uncertain" });
    if (!u.changed) throw new Error("x");
    expect(intentOf(u.next)).toMatchObject({ state: "uncertain", maybeApplied: true, attempts: 1 });
    expect(isRecoverable(intentOf(u.next))).toBe(true);
    const again = reserved(u.next);
    expect(again.attempt).toBe(2);
    const replay = await answer(registerReq(), okRegister(registerReq(), false));
    const done = outcome(again.next, 2, replay);
    expect(done.changed && done.state).toBe("settled");
  });

  it("a typed refusal is clean only without earlier uncertainty; after uncertainty it stays uncertain", async () => {
    const r = reserved(created());
    const clean = outcome(r.next, 1, await answer(registerReq(), capacity));
    expect(clean.changed && intentOf(clean.next)).toMatchObject({
      state: "refused",
      answer: capacity,
    });
    if (!clean.changed) return;
    expect(isUnresolved(intentOf(clean.next))).toBe(false);
    expect(
      reserveAttempt(clean.next, KEY, { operationId: "op-1", attempts: 1, state: "refused" }),
    ).toEqual({
      ok: false,
      reason: "not_recoverable",
    });

    const u = outcome(r.next, 1, { kind: "uncertain" });
    if (!u.changed) throw new Error("x");
    const r2 = reserved(u.next);
    const after = outcome(r2.next, 2, await answer(registerReq(), capacity));
    expect(after.changed && intentOf(after.next)).toMatchObject({
      state: "uncertain",
      maybeApplied: true,
      answer: capacity,
    });
  });

  it("a conflict is divergent: resolved without earlier uncertainty, unresolved (recoverable) with it", async () => {
    const theirs = registration(1, "active", { revision: 2, digest: DIG2 });
    const r = reserved(created());
    const c = outcome(r.next, 1, await answer(registerReq(), conflict(theirs)));
    if (!c.changed) throw new Error("x");
    const rec = findRecord(c.next, KEY)!;
    expect(rec.intent.state).toBe("divergent");
    expect(rec.last?.answer.body.registration).toEqual(theirs);
    expect(isUnresolved(rec.intent)).toBe(false);
    expect(isRecoverable(rec.intent)).toBe(false);

    const u = outcome(r.next, 1, { kind: "uncertain" });
    if (!u.changed) throw new Error("x");
    const r2 = reserved(u.next);
    const c2 = outcome(r2.next, 2, await answer(registerReq(), conflict(theirs)));
    if (!c2.changed) throw new Error("x");
    expect(intentOf(c2.next)).toMatchObject({ state: "divergent", maybeApplied: true });
    expect(isUnresolved(intentOf(c2.next)) && isRecoverable(intentOf(c2.next))).toBe(true);
    // A later uncertain recovery keeps the divergence visible.
    const r3 = reserved(c2.next);
    const u3 = outcome(r3.next, 3, { kind: "uncertain" });
    expect(u3.changed && intentOf(u3.next).state).toBe("divergent");
  });

  it("a reservation that never went out reverts; from a crashed dispatch it becomes uncertain", () => {
    const r = reserved(created());
    const back = outcome(r.next, 1, { kind: "not_dispatched" });
    expect(back.changed && intentOf(back.next)).toMatchObject({
      state: "pending",
      attempts: 1,
      reservedFrom: null,
      maybeApplied: false,
    });
    // dispatching after a reload (the attempt's fate unknown): recovery marks it maybe-applied.
    const again = reserved(r.next);
    expect(intentOf(again.next)).toMatchObject({
      state: "dispatching",
      attempts: 2,
      reservedFrom: "dispatching",
      maybeApplied: true,
    });
    const revert = outcome(again.next, 2, { kind: "not_dispatched" });
    expect(revert.changed && intentOf(revert.next).state).toBe("uncertain");
  });

  it("non-ok outcomes of an older attempt, other operations and resolved intents change nothing", async () => {
    const r = reserved(created());
    const u = outcome(r.next, 1, { kind: "uncertain" });
    if (!u.changed) throw new Error("x");
    const r2 = reserved(u.next); // attempt 2 in flight
    expect(outcome(r2.next, 1, { kind: "uncertain" })).toEqual({
      changed: false,
      state: "dispatching",
      reason: "stale",
    });
    expect(outcome(r2.next, 1, await answer(registerReq(), capacity)).changed).toBe(false);
    expect(outcome(r2.next, 2, { kind: "uncertain" }, "other-op")).toEqual({
      changed: false,
      state: null,
      reason: "stale",
    });
    // An ok answer of the OLDER attempt is still definitive proof for the identical request.
    const ok = outcome(r2.next, 1, await answer(registerReq(), okRegister(registerReq())));
    expect(ok.changed && ok.state).toBe("settled");
    if (!ok.changed) return;
    // A late failure after settlement changes nothing.
    expect(outcome(ok.next, 2, { kind: "uncertain" }).changed).toBe(false);
  });

  it("CAS: a reservation needs the exact operation, attempt count and state", () => {
    const s = created();
    expect(reserveAttempt(s, KEY, { operationId: "x", attempts: 0, state: "pending" })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(reserveAttempt(s, KEY, { operationId: "op-1", attempts: 1, state: "pending" })).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(
      reserveAttempt(s, registrationKey(AUTH, "w9")!, {
        operationId: "op-1",
        attempts: 0,
        state: "pending",
      }),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("unregister: settles on the exact epoch/revision; a different digest for that revision is divergent", async () => {
    const req = unregisterReq();
    const r = reserved(created(emptyRegistrations(), prepared(req, DIG)));
    expect(outcome(r.next, 1, await answer(req, okUnregister(req))).state).toBe("settled");
    const other = outcome(r.next, 1, await answer(req, okUnregister(req, true, DIG2)));
    expect(other.changed && intentOf(other.next)).toMatchObject({
      state: "divergent",
      maybeApplied: false,
    });
  });

  it("history never regresses and an equal-order contradiction is divergent", async () => {
    // A newer observation first (epoch 1 unregistered), then a late register ok for epoch 1 active.
    const later = registration(1, "unregistered");
    const r = reserved(created());
    const u = outcome(r.next, 1, { kind: "uncertain" });
    if (!u.changed) throw new Error("x");
    const r2 = reserved(u.next);
    const c = outcome(r2.next, 2, await answer(registerReq(), conflict(later)));
    if (!c.changed) throw new Error("x");
    const r3 = reserved(c.next);
    const late = outcome(r3.next, 1, await answer(registerReq(), okRegister(registerReq())));
    if (!late.changed) throw new Error("x");
    expect(intentOf(late.next).state).toBe("settled");
    expect(findRecord(late.next, KEY)!.last?.answer.body.registration).toEqual(later);

    // Same epoch/state/revision/updatedAt but another digest than the stored observation: a contradiction.
    const r4 = reserved(created());
    const seen = outcome(
      r4.next,
      1,
      await answer(
        registerReq(),
        conflict(registration(1, "active", { digest: DIG2, revision: 1 })),
      ),
    );
    if (!seen.changed) throw new Error("x");
    const fresh = createIntent(
      seen.next,
      prepared(registerReq({ expectedEpoch: 0 })),
      "op-2",
      CREATED,
    );
    if (!fresh.ok) throw new Error(fresh.reason);
    const r5 = reserved(fresh.next);
    const contradicted = outcome(
      r5.next,
      1,
      await answer(registerReq(), okRegister(registerReq())),
      "op-2",
    );
    expect(contradicted.changed && intentOf(contradicted.next).state).toBe("divergent");
  });
});

describe("strict parse and revalidation through the pinned parser (no trusted brands)", () => {
  async function settledSlice() {
    const r = reserved(created());
    const done = outcome(r.next, 1, await answer(registerReq(), okRegister(registerReq())));
    if (!done.changed) throw new Error("x");
    return done.next;
  }

  it("round-trips through JSON and revalidates; the exact read-back is canonical", async () => {
    const s = await settledSlice();
    const back = roundTrip(s);
    expect(back).toEqual(s);
    expect(await verifyRegistrations(back!)).toBe(true);
    expect(registrationsIs(JSON.parse(JSON.stringify(s)), s)).toBe(true);
    expect(registrationsIs(undefined, s)).toBe(false);
    expect(registrationsIs({ ...s, generation: 9 }, s)).toBe(false);
  });

  it("rejects tampered structure: key, body/path, extra keys (a token canary), owner, state invariants", async () => {
    const s = JSON.parse(JSON.stringify(await settledSlice())) as A;
    const bad = (edit: (x: A) => void) => {
      const x = JSON.parse(JSON.stringify(s));
      edit(x);
      return parseRegistrations(x);
    };
    expect(bad((x) => (x.records[0].key = canonicalJson([ORIGIN_B, OWNER, "w1"])))).toBeNull();
    expect(bad((x) => (x.records[0].intent.body.revision = 2))).toBeNull();
    expect(bad((x) => (x.records[0].intent.path = "/elsewhere"))).toBeNull();
    expect(bad((x) => (x.records[0].intent.token = "CANARY"))).toBeNull();
    expect(bad((x) => (x.records[0].fingerprint = "CANARY"))).toBeNull();
    expect(bad((x) => (x.records[0].intent.request.ownerKey = OWNER_B))).toBeNull();
    expect(bad((x) => (x.records[0].intent.state = "refused"))).not.toBeNull(); // shape ok, parser decides
    expect(bad((x) => (x.records[0].intent.maybeApplied = true))).toBeNull(); // settled is never maybe
    expect(
      bad(
        (x) => ((x.records[0].intent.state = "refused"), (x.records[0].intent.maybeApplied = true)),
      ),
    ).toBeNull();
    expect(bad((x) => (x.records[0].intent.answer = null))).toBeNull(); // settled needs its answer
    expect(bad((x) => (x.records[0].intent.state = "dispatching"))).toBeNull(); // no reservedFrom
    expect(bad((x) => x.records.push(x.records[0]))).toBeNull(); // duplicate key
  });

  it("a forged or mismatched answer fails revalidation even with a perfect shape", async () => {
    const s = JSON.parse(JSON.stringify(await settledSlice())) as A;
    const check = async (edit: (x: A) => void) => {
      const x = JSON.parse(JSON.stringify(s));
      edit(x);
      const p = parseRegistrations(x);
      return p ? verifyRegistrations(p) : "unparsed";
    };
    expect(await check(() => {})).toBe(true);
    expect(await check((x) => (x.records[0].intent.answer.body.registration.revision = 2))).toBe(
      false,
    );
    expect(await check((x) => (x.records[0].intent.answer.body.ownerKey = OWNER_B))).toBe(false);
    expect(await check((x) => (x.records[0].last.answer.body.registration.epochs = []))).toBe(
      false,
    );
    expect(
      await check((x) => {
        x.records[0].intent.state = "refused";
      }),
    ).toBe(false); // an ok answer cannot be a refusal
  });
});

describe("wire answers rebuilt from the parser's result re-parse identically", () => {
  it("ok, conflict and bare/typed refusals", async () => {
    for (const [req, a] of [
      [registerReq(), okRegister(registerReq())],
      [unregisterReq(), okUnregister(unregisterReq(), false)],
      [registerReq(), conflict(null)],
      [registerReq({ expectedEpoch: 1 }), conflict(null)],
      [registerReq(), capacity],
      [registerReq(), { status: 409, body: { error: "authority_mismatch" } }],
      [
        unregisterReq(),
        { status: 409, body: { error: "not_registered", ownerKey: OWNER, workflowId: "w1" } },
      ],
      [registerReq(), { status: 503, body: { error: "not_configured", detail: "workflow-store" } }],
    ] as [CloudRequest, WireAnswer][]) {
      const p = await parseAnswer(req, a, { origin: ORIGIN });
      if (p.outcome === "invalid") continue; // e.g. a conflict(null) the parser refuses for expectedEpoch 0
      expect(wireOf(p)).toEqual(a);
    }
  });
});

describe("monotonic import merge", () => {
  async function at(state: "pending" | "uncertain" | "settled" | "refused") {
    let s = created();
    if (state === "pending") return s;
    const r = reserved(s);
    const o: Outcome =
      state === "uncertain"
        ? { kind: "uncertain" }
        : await answer(registerReq(), state === "settled" ? okRegister(registerReq()) : capacity);
    const x = outcome(r.next, 1, o);
    if (!x.changed) throw new Error("x");
    s = x.next;
    return s;
  }

  it("identical: unchanged; legacy/empty import: unchanged; disjoint keys: union", async () => {
    const s = await at("settled");
    expect(mergeRegistrations(s, s)).toEqual({ ok: true, next: s, changed: false });
    expect(mergeRegistrations(s, emptyRegistrations())).toEqual({
      ok: true,
      next: s,
      changed: false,
    });
    const other = created(
      emptyRegistrations(),
      prepared(registerReq({ workflowId: "w2" })),
      "op-w2",
    );
    const m = mergeRegistrations(s, other);
    expect(m.ok && m.changed && m.next.records.map((r) => r.workflowId)).toEqual(["w1", "w2"]);
  });

  it("equal seq: identity must match; progress merges monotonically", async () => {
    const pending = await at("pending");
    const settled = await at("settled");
    const m = mergeRegistrations(pending, settled);
    expect(m.ok && intentOf(m.next).state).toBe("settled");
    const back = mergeRegistrations(settled, pending);
    expect(back).toEqual({ ok: true, next: settled, changed: false });
    const other = created(emptyRegistrations(), prepared(), "different-op");
    expect(mergeRegistrations(pending, other)).toEqual({
      ok: false,
      reason: "conflict",
      keys: [KEY],
    });
    // A clean refusal meets the other copy's uncertainty: no longer clean.
    const refused = await at("refused");
    const uncertain = await at("uncertain");
    const r = mergeRegistrations(refused, uncertain);
    expect(r.ok && intentOf(r.next)).toMatchObject({ state: "uncertain", maybeApplied: true });
  });

  it("an older backup never resurrects a settled decision; a newer one replaces only resolved local work", async () => {
    const settled = await at("settled");
    const next = createIntent(settled, prepared(unregisterReq(), DIG), "op-2", CREATED);
    if (!next.ok) throw new Error(next.reason);
    // local seq 2 (pending unregister) vs backup seq 1 settled register: local kept.
    expect(mergeRegistrations(next.next, settled)).toEqual({
      ok: true,
      next: next.next,
      changed: false,
    });
    // local seq 1 settled vs backup seq 2: adopted.
    const m = mergeRegistrations(settled, next.next);
    expect(m.ok && intentOf(m.next)).toMatchObject({ seq: 2, operationId: "op-2" });
    // local unresolved seq 1 vs backup seq 2: refused (local unresolved work preserved).
    const uncertain = await at("uncertain");
    expect(mergeRegistrations(uncertain, next.next)).toEqual({
      ok: false,
      reason: "conflict",
      keys: [KEY],
    });
  });

  it("history merges monotonically; an equal-order contradiction refuses; the union is capped", async () => {
    const settled = await at("settled");
    const tampered = JSON.parse(JSON.stringify(settled)) as A;
    tampered.records[0].last.answer.body.registration.paused = true;
    expect(mergeRegistrations(settled, parseRegistrations(tampered)!)).toEqual({
      ok: false,
      reason: "conflict",
      keys: [KEY],
    });
    let big = emptyRegistrations();
    for (let i = 0; i < REGISTRATION_CAPACITY; i++)
      big = created(big, prepared(registerReq({ workflowId: `w${i}x` })), `op-${i}`);
    const extra = created(
      emptyRegistrations(),
      prepared(registerReq({ workflowId: "zz" })),
      "op-z",
    );
    expect(mergeRegistrations(big, extra)).toEqual({ ok: false, reason: "capacity", keys: [] });
  });
});
