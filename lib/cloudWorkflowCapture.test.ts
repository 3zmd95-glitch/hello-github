import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorityOf,
  parseAnswer,
  readyOccurrenceId,
  type CloudRequest,
} from "./cloudWorkflowProtocol";
import {
  createIntent,
  emptyRegistrations,
  findRecord,
  prepareIntent,
  recordOutcome,
  registrationKey,
  reserveAttempt,
  type CloudRegistrations,
  type Outcome,
  type WireAnswer,
} from "./cloudWorkflowRegistration";
import { emptyJournal, withEntry, type CloudJournal } from "./cloudWorkflowJournal";
import { buildCloudSnapshot } from "./cloudWorkflowSnapshot";
import {
  admitEntries,
  bindRegistration,
  captureView,
  relatedRecords,
  resolveOwnership,
  verifyOwnershipEvidence,
  workflowDigestOf,
} from "./cloudWorkflowCapture";

// ⚙️ DT-7C-2B-3 pure ownership/capture helpers (planning/tools/38-cloud-workflows.md): the ownership decision table over
// registration records built by the accepted transitions and answers the pinned parser accepts, the workflow digest
// vectors, definition/epoch binding, all-or-nothing journal admission and the public projection.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OWNER = "wfo_" + "a".repeat(32);
const OWNER_B = "wfo_" + "b".repeat(32);
const ORIGIN = "https://scout.example";
const ORIGIN_B = "https://other.example";
const AUTH = authorityOf(ORIGIN, OWNER)!;
const AUTH_B = authorityOf(ORIGIN_B, OWNER_B)!;
const DIG = "d".repeat(64);
const CREATED = "2026-10-18T07:00:00.000Z";
const opened = (e: number) => `2026-10-18T0${e}:00:00.000Z`;
const closed = (e: number) => `2026-10-18T0${e}:30:00.000Z`;
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

function registration(epoch: number, state: "active" | "unregistered", o: A = {}): A {
  return {
    workflowId: o.workflowId ?? "w1",
    registrationEpoch: epoch,
    revision: o.revision ?? 1,
    workflowDigest: o.digest ?? DIG,
    state,
    paused: o.paused ?? false,
    updatedAt: state === "active" ? opened(epoch) : closed(epoch),
    epochs: Array.from({ length: epoch }, (_, i) => ({
      epoch: i + 1,
      openedAt: opened(i + 1),
      ...(i < epoch - 1 || state === "unregistered" ? { closedAt: closed(i + 1) } : {}),
    })),
  };
}
const registerReq = (owner = OWNER, o: A = {}): CloudRequest => ({
  kind: "register",
  ownerKey: owner,
  workflowId: "w1",
  expectedEpoch: 0,
  revision: 1,
  workflowDigest: DIG,
  ...o,
});
const unregisterReq = (owner = OWNER): CloudRequest => ({
  kind: "unregister",
  ownerKey: owner,
  workflowId: "w1",
  registrationEpoch: 1,
  expectedRevision: 1,
});
const okRegister = (req: A, o: A = {}): WireAnswer => ({
  status: 200,
  body: {
    ownerKey: req.ownerKey,
    registration: registration(req.expectedEpoch + 1, "active", {
      workflowId: req.workflowId,
      revision: req.revision,
      digest: req.workflowDigest,
      ...o,
    }),
    created: true,
  },
});
const okUnregister = (req: A): WireAnswer => ({
  status: 200,
  body: {
    ownerKey: req.ownerKey,
    registration: registration(req.registrationEpoch, "unregistered", {
      workflowId: req.workflowId,
    }),
    changed: true,
  },
});

/** One lifecycle step through the accepted transitions: create, reserve, then the outcome. */
async function step(
  s: CloudRegistrations,
  req: CloudRequest,
  auth: typeof AUTH,
  outcome: "ok" | "lost" | "refused" | "conflict" | "pending",
  o: A = {},
): Promise<CloudRegistrations> {
  const p = prepareIntent(req, auth, req.kind === "unregister" ? DIG : undefined);
  if (!p.ok) throw new Error(p.reason);
  const c = createIntent(s, p, `op-${Math.random()}`, CREATED);
  if (!c.ok) throw new Error(c.reason);
  if (outcome === "pending") return c.next;
  const i = findRecord(c.next, p.key)!.intent;
  const r = reserveAttempt(c.next, p.key, i);
  if (!r.ok) throw new Error(r.reason);
  let out: Outcome;
  if (outcome === "lost") out = { kind: "uncertain" };
  else {
    const answer: WireAnswer =
      outcome === "ok"
        ? req.kind === "register"
          ? okRegister(req, o)
          : okUnregister(req)
        : outcome === "conflict"
          ? {
              status: 409,
              body: {
                error: "conflict",
                ownerKey: auth.ownerKey,
                registration: registration(1, "active", { revision: 2 }),
              },
            }
          : req.kind === "register"
            ? { status: 409, body: { error: "capacity", ownerKey: auth.ownerKey } }
            : {
                status: 409,
                body: { error: "not_registered", ownerKey: auth.ownerKey, workflowId: "w1" },
              };
    const parsed = await parseAnswer(req, answer, { origin: auth.origin });
    expect(parsed.outcome).not.toBe("invalid");
    out = { kind: "answer", answer, parsed };
  }
  const rec = recordOutcome(r.next, p.key, i.operationId, r.attempt, out);
  if (!rec.changed) throw new Error(rec.reason);
  return rec.next;
}
const active = (auth = AUTH, o: A = {}) =>
  step(emptyRegistrations(), registerReq(auth.ownerKey), auth, "ok", o);

const body = (o: A = {}): A => ({
  occurrenceId: "m1",
  ownerKey: OWNER,
  workflowId: "w1",
  kind: "manual",
  registrationEpoch: 1,
  revision: 1,
  snapshot: {
    name: { ar: "", en: "Flow" },
    trigger: { kind: "manual" },
    actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea {date}" } }],
  },
  plannerContext: null,
  input: {
    title: { ar: "", en: "" },
    summary: { ar: "", en: "" },
    slug: "",
    lang: "en",
    day: "2026-10-18",
  },
  executionAt: "2026-10-18T09:00:00.000Z",
  ...o,
});
const journalWith = (
  auth = AUTH,
  occurrenceId = "m1",
  executionAt = "2026-10-18T09:00:00.000Z",
  registrationEpoch = 1,
  base: CloudJournal = emptyJournal(),
  workflowId = "w1",
): CloudJournal =>
  withEntry(
    base,
    {
      key: JSON.stringify([auth.origin, auth.ownerKey, occurrenceId]),
      authority: { origin: auth.origin, ownerKey: auth.ownerKey },
      occurrenceId,
      body: body({
        occurrenceId,
        ownerKey: auth.ownerKey,
        executionAt,
        registrationEpoch,
        workflowId,
      }) as never,
      payloadDigest: DIG,
      executionAt,
      commitId: "c1",
      state: "queued",
      observation: null,
    },
    "c1",
  );
/** An entry inside epoch 1's closed interval (01:00–01:30 in these fixtures). */
const IN_EPOCH_1 = "2026-10-18T01:15:00.000Z";

const own = (registrations: CloudRegistrations | null, o: A = {}) =>
  resolveOwnership({
    workflowId: "w1",
    registrations,
    journal: o.journal === undefined ? emptyJournal() : o.journal,
    configuredOrigin: o.origin === undefined ? ORIGIN : o.origin,
  });

describe("workflowDigestOf: SHA-256 of the canonical allowlisted executable snapshot (published vectors)", () => {
  const v1 = {
    name: { ar: "تجربة", en: "Flow" },
    trigger: { kind: "manual" },
    actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea {date}" } }],
  };
  const v2 = {
    name: { ar: "", en: "Ready flow" },
    trigger: { kind: "article-ready" },
    actions: [
      {
        id: "p1",
        kind: "post",
        platform: "instagram",
        title: { ar: "", en: "{title}" },
        caption: { ar: "", en: "{summary}" },
        offsetDays: 1,
      },
      { id: "q1", kind: "plan", quest: "train", minutes: 30, day: "lightest" },
    ],
  };

  it("matches the independently computed vectors", async () => {
    expect(await workflowDigestOf(v1)).toBe(
      "a3f21b155ecb1fdf1a69e9000ef7caa2fc417c9819a826ec34f95adc122df346",
    );
    expect(await workflowDigestOf(v1)).toBe(
      sha(
        '{"actions":[{"id":"a1","kind":"idea","text":{"ar":"","en":"Idea {date}"}}],"name":{"ar":"تجربة","en":"Flow"},"trigger":{"kind":"manual"}}',
      ),
    );
    expect(await workflowDigestOf(v2)).toBe(
      "5000f6ffcfb13d803f418338693fc14d4f79f4ac1e5e287f2f38681375d66aed",
    );
  });

  it("excludes id, revision, enabled, commitId, timestamps and unknown fields; binds every executable field", async () => {
    const base = await workflowDigestOf(v1);
    const noisy = {
      ...v1,
      id: "w9",
      revision: 7,
      enabled: false,
      commitId: "c-9",
      createdAt: CREATED,
      updatedAt: CREATED,
      token: "secret",
      name: { ...v1.name, extra: "x" },
      trigger: { kind: "manual", extra: 1 },
      actions: [{ ...v1.actions[0], note: "x" }],
    };
    expect(await workflowDigestOf(noisy)).toBe(base);
    expect(await workflowDigestOf({ ...v1, name: { ar: "تجربة", en: "Flow!" } })).not.toBe(base);
    expect(await workflowDigestOf({ ...v1, trigger: { kind: "article-ready" } })).not.toBe(base);
    expect(
      await workflowDigestOf({ ...v1, actions: [{ ...v1.actions[0], platform: "x" }] }),
    ).not.toBe(base);
    expect(await workflowDigestOf({ ...v1, actions: [{ ...v1.actions[0], id: "a2" }] })).not.toBe(
      base,
    );
    // Not canonical-JSON-able: no digest (never a guess).
    expect(
      await workflowDigestOf({ ...v2, actions: [{ ...v2.actions[1], minutes: 1.5 }] }),
    ).toBeNull();
    expect(await workflowDigestOf(null as never)).toBeNull();
  });

  it("equals the digest of the accepted builder's body.snapshot", async () => {
    const built = await buildCloudSnapshot({
      ownerKey: OWNER,
      occurrenceId: "m1",
      registrationEpoch: 1,
      revision: 1,
      executionAt: "2026-10-18T09:00:00.000Z",
      workflow: { id: "w1", ...v1 } as never,
      lang: "en",
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(await workflowDigestOf(built.snapshot.body.snapshot as never)).toBe(
      await workflowDigestOf(v1),
    );
  });
});

describe("resolveOwnership: the conservative decision table", () => {
  it("no records and no journal evidence: local (legacy)", () => {
    expect(own(emptyRegistrations())).toEqual({ kind: "local", basis: "none" });
    expect(own(emptyRegistrations(), { origin: null })).toEqual({ kind: "local", basis: "none" });
  });

  it("one settled active registration at the configured origin: cloud at its authority/epoch/revision", async () => {
    const o = own(await active());
    expect(o.kind).toBe("cloud");
    if (o.kind !== "cloud") return;
    expect(o.authority).toEqual({ origin: ORIGIN, ownerKey: OWNER });
    expect(o.registration).toMatchObject({
      registrationEpoch: 1,
      revision: 1,
      workflowDigest: DIG,
    });
  });

  it("pending, dispatching and uncertain intents block (never local)", async () => {
    const pending = await step(emptyRegistrations(), registerReq(), AUTH, "pending");
    expect(own(pending)).toEqual({ kind: "blocked", cause: "unresolved" });
    const lost = await step(emptyRegistrations(), registerReq(), AUTH, "lost");
    expect(own(lost)).toEqual({ kind: "blocked", cause: "unresolved" });
    const p = prepareIntent(registerReq(), AUTH);
    if (!p.ok) throw new Error();
    const c = createIntent(emptyRegistrations(), p, "op-d", CREATED);
    if (!c.ok) throw new Error();
    const r = reserveAttempt(c.next, p.key, findRecord(c.next, p.key)!.intent);
    if (!r.ok) throw new Error();
    expect(own(r.next)).toEqual({ kind: "blocked", cause: "unresolved" });
  });

  it("a divergent intent blocks", async () => {
    const d = await step(await active(), unregisterReq(), AUTH, "conflict");
    expect(findRecord(d, registrationKey(AUTH, "w1")!)!.intent.state).toBe("divergent");
    expect(own(d).kind).toBe("blocked");
  });

  it("a proven unregister: local for future triggers, even with old journal entries at that authority", async () => {
    const u = await step(await active(), unregisterReq(), AUTH, "ok");
    expect(own(u)).toEqual({ kind: "local", basis: "unregistered" });
    // DT-7C-2B-3-R1 fixture adjustment: the old entry lies inside the closed epoch it names (it was 09:00, after
    // epoch 1 closed at 01:30, which is now an uncovered chronology: see the next case). Assertion unchanged.
    const j = journalWith(AUTH, "m1", IN_EPOCH_1);
    expect(own(u, { journal: j })).toEqual({ kind: "local", basis: "unregistered" });
    // Future triggers only: the old entry itself is untouched and stays cloud.
    expect(j.entries[0]).toMatchObject({ state: "queued", authority: AUTH });
    // Both ends of the closed interval are inclusive.
    for (const at of ["2026-10-18T01:00:00.000Z", "2026-10-18T01:30:00.000Z"])
      expect(own(u, { journal: journalWith(AUTH, "m1", at) })).toEqual({
        kind: "local",
        basis: "unregistered",
      });
  });

  it("DT-7C-2B-3-R1: inactive proof discharges journal history only when its closed epoch history covers it", async () => {
    const u = await step(await active(), unregisterReq(), AUTH, "ok");
    // An older closed epoch cannot discharge a newer journal epoch.
    expect(own(u, { journal: journalWith(AUTH, "m1", IN_EPOCH_1, 2) })).toEqual({
      kind: "blocked",
      cause: "inconsistent",
    });
    // The named epoch, but outside its closed interval (after close, before open): blocked, never rewritten.
    for (const at of ["2026-10-18T09:00:00.000Z", "2026-10-18T00:59:59.999Z"])
      expect(own(u, { journal: journalWith(AUTH, "m1", at) })).toEqual({
        kind: "blocked",
        cause: "inconsistent",
      });
    // One uncovered entry among covered ones blocks.
    const mixed = journalWith(AUTH, "m2", IN_EPOCH_1, 2, journalWith(AUTH, "m1", IN_EPOCH_1));
    expect(own(u, { journal: mixed })).toEqual({ kind: "blocked", cause: "inconsistent" });
  });

  it("DT-7C-2B-3-R1: a refused first registration (no lifecycle) cannot explain same-authority cloud history", async () => {
    const r = await step(emptyRegistrations(), registerReq(), AUTH, "refused");
    expect(findRecord(r, registrationKey(AUTH, "w1")!)!.last).toBeNull();
    for (const at of [IN_EPOCH_1, "2026-10-18T09:00:00.000Z"])
      expect(own(r, { journal: journalWith(AUTH, "m1", at) })).toEqual({
        kind: "blocked",
        cause: "journal-only",
      });
    // Its history at ANOTHER workflow is unrelated: this workflow stays local.
    expect(
      own(r, { journal: journalWith(AUTH, "m1", IN_EPOCH_1, 1, emptyJournal(), "w2") }),
    ).toEqual({ kind: "local", basis: "unregistered" });
  });

  it("DT-7C-2B-3-R1: an active current registration with genuine earlier-epoch entries stays cloud", async () => {
    const u = await step(await active(), unregisterReq(), AUTH, "ok");
    const again = await step(u, registerReq(OWNER, { expectedEpoch: 1 }), AUTH, "ok");
    const j = journalWith(
      AUTH,
      "m2",
      "2026-10-18T02:10:00.000Z",
      2,
      journalWith(AUTH, "m1", IN_EPOCH_1),
    );
    const o = own(again, { journal: j });
    expect(o.kind).toBe("cloud");
    if (o.kind === "cloud") expect(o.registration.registrationEpoch).toBe(2);
  });

  it("DT-7C-2B-3-R1: workflows resolve independently (another workflow's uncovered history does not leak)", async () => {
    const u = await step(await active(), unregisterReq(), AUTH, "ok");
    const j = journalWith(AUTH, "m1", "2026-10-18T09:00:00.000Z");
    expect(own(u, { journal: j }).kind).toBe("blocked");
    expect(
      resolveOwnership({
        workflowId: "w2",
        registrations: u,
        journal: j,
        configuredOrigin: ORIGIN,
      }),
    ).toEqual({ kind: "local", basis: "none" });
  });

  it("a failed unregister after active proof blocks (prior proof is not erased)", async () => {
    const f = await step(await active(), unregisterReq(), AUTH, "refused");
    expect(findRecord(f, registrationKey(AUTH, "w1")!)!.intent.state).toBe("refused");
    expect(own(f)).toEqual({ kind: "blocked", cause: "refused-active" });
  });

  it("a refused first register (nothing applied, no observation) is inactive: local", async () => {
    const r = await step(emptyRegistrations(), registerReq(), AUTH, "refused");
    expect(own(r)).toEqual({ kind: "local", basis: "unregistered" });
  });

  it("foreign worker, missing configuration and multiple active authorities block", async () => {
    expect(own(await active(), { origin: ORIGIN_B })).toEqual({
      kind: "blocked",
      cause: "foreign-worker",
    });
    expect(own(await active(), { origin: null })).toEqual({
      kind: "blocked",
      cause: "not-configured",
    });
    const both = await step(await active(), registerReq(OWNER_B), AUTH_B, "ok");
    expect(relatedRecords(both, "w1")).toHaveLength(2);
    expect(own(both)).toEqual({ kind: "blocked", cause: "multiple-active" });
  });

  it("unreadable evidence and journal-only evidence block", async () => {
    expect(own(null)).toEqual({ kind: "blocked", cause: "unreadable" });
    expect(own(emptyRegistrations(), { journal: null })).toEqual({
      kind: "blocked",
      cause: "unreadable",
    });
    expect(own(emptyRegistrations(), { journal: journalWith() })).toEqual({
      kind: "blocked",
      cause: "journal-only",
    });
    // Entries at an authority with no record for the workflow block even beside an unregistered record elsewhere.
    const u = await step(await active(), unregisterReq(), AUTH, "ok");
    expect(own(u, { journal: journalWith(AUTH_B) })).toEqual({
      kind: "blocked",
      cause: "journal-only",
    });
  });

  it("a settled record whose answer disagrees with its latest observation blocks", async () => {
    const a = await active();
    const key = registrationKey(AUTH, "w1")!;
    const rec = findRecord(a, key)!;
    const other = { ...rec.last!, answer: okRegister(registerReq(OWNER, { revision: 2 })) };
    const tampered = { ...a, records: [{ ...rec, last: other }] } as CloudRegistrations;
    expect(own(tampered)).toEqual({ kind: "blocked", cause: "inconsistent" });
  });

  it("other workflows' records are not related; verification covers exactly the related records", async () => {
    const a = await active();
    expect(relatedRecords(a, "w2")).toEqual([]);
    expect(await verifyOwnershipEvidence(a, ["w1"])).toBe(true);
    const key = registrationKey(AUTH, "w1")!;
    const rec = findRecord(a, key)!;
    const forged = {
      ...a,
      records: [{ ...rec, intent: { ...rec.intent, answer: { status: 200, body: { x: 1 } } } }],
    } as CloudRegistrations;
    expect(await verifyOwnershipEvidence(forged, ["w1"])).toBe(false);
    expect(await verifyOwnershipEvidence(forged, ["w2"])).toBe(true);
  });
});

describe("bindRegistration: definition, pause and epoch chronology", () => {
  const reg = registration(1, "active") as never;
  const wf = { revision: 1 };
  it("binds exactly; refuses pause, revision/digest mismatch and an executionAt outside the open epoch", () => {
    const at = "2026-10-18T09:00:00.000Z";
    expect(
      bindRegistration({ workflow: wf, registration: reg, digest: DIG, executionAt: at }),
    ).toBe(null);
    expect(
      bindRegistration({
        workflow: wf,
        registration: { ...(reg as A), paused: true } as never,
        digest: DIG,
        executionAt: at,
      }),
    ).toBe("registration-paused");
    expect(
      bindRegistration({
        workflow: { revision: 2 },
        registration: reg,
        digest: DIG,
        executionAt: at,
      }),
    ).toBe("definition-mismatch");
    expect(
      bindRegistration({
        workflow: wf,
        registration: reg,
        digest: "e".repeat(64),
        executionAt: at,
      }),
    ).toBe("definition-mismatch");
    expect(
      bindRegistration({ workflow: wf, registration: reg, digest: null, executionAt: at }),
    ).toBe("definition-mismatch");
    // Before the epoch opened (no skew correction), or a closed epoch.
    expect(
      bindRegistration({
        workflow: wf,
        registration: reg,
        digest: DIG,
        executionAt: "2026-10-18T00:59:59.999Z",
      }),
    ).toBe("chronology");
    expect(
      bindRegistration({
        workflow: wf,
        registration: registration(1, "unregistered") as never,
        digest: DIG,
        executionAt: at,
      }),
    ).toBe("chronology");
  });
});

describe("admitEntries: all-or-nothing, idempotent identical keys, no eviction", () => {
  const cand = (id: string, digest = DIG) => ({
    key: JSON.stringify([ORIGIN, OWNER, id]),
    authority: { origin: ORIGIN, ownerKey: OWNER },
    occurrenceId: id,
    body: body({ occurrenceId: id }) as never,
    payloadDigest: digest,
    executionAt: "2026-10-18T09:00:00.000Z",
  });
  it("admits new keys, keeps identical ones without consuming capacity, refuses changed digests", () => {
    const j = journalWith();
    const r = admitEntries(j, [cand("m1"), cand("m2")], "c2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.created).toEqual([cand("m2").key]);
    expect(r.next.entries).toHaveLength(2);
    expect(r.next.generation).toBe(j.generation + 1);
    expect(r.entries.map((e) => e.occurrenceId)).toEqual(["m1", "m2"]);
    // Everything already there: nothing to write.
    const same = admitEntries(j, [cand("m1")], "c3");
    expect(same).toMatchObject({ ok: true, created: [] });
    if (same.ok) expect(same.next).toBe(j);
    expect(admitEntries(j, [cand("m1", "e".repeat(64)), cand("m3")], "c4")).toMatchObject({
      ok: false,
      reason: "conflict",
    });
  });

  it("over capacity or suppressed: the whole batch is refused", () => {
    let j = emptyJournal();
    for (let n = 0; n < 599; n++)
      j = withEntry(
        j,
        { ...cand(`f${n}`), commitId: "c", state: "queued", observation: null },
        "c",
      );
    expect(admitEntries(j, [cand("x1")], "c")).toMatchObject({ ok: true });
    expect(admitEntries(j, [cand("x1"), cand("x2")], "c")).toEqual({
      ok: false,
      reason: "capacity",
    });
    expect(admitEntries(j, [cand("f1"), cand("x2")], "c")).toMatchObject({ ok: true });
    const reset = {
      ...emptyJournal(),
      suppression: { epoch: 1, resetAt: "2026-10-18T09:00:00.000Z", commitId: "r" },
    };
    expect(admitEntries(reset, [cand("y1")], "c")).toEqual({ ok: false, reason: "suppressed" });
  });
});

describe("captureView: the public projection carries no body, context, input or receipt", () => {
  it("projects identity only", async () => {
    const j = journalWith();
    const v = captureView(j.entries[0]);
    expect(Object.keys(v).sort()).toEqual(
      [
        "commitId",
        "executionAt",
        "key",
        "kind",
        "occurrenceId",
        "origin",
        "ownerKey",
        "payloadDigest",
        "state",
        "workflowId",
      ].sort(),
    );
    expect(JSON.stringify(v)).not.toMatch(/Idea|snapshot|plannerContext|input/);
  });

  it("Ready ids are the accepted vector (protocol helper, unchanged)", async () => {
    const id = await readyOccurrenceId("w1", "art1", "commit-1");
    const raw = createHash("sha256").update('["w1","art1","commit-1"]', "utf8").digest();
    expect(id).toBe(`ar-${raw.toString("base64url")}`);
    expect(id).toHaveLength(46);
  });
});
