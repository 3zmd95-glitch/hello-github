import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  checkBody,
  sha256Hex,
  type OccurrenceBody,
} from "@/workers/scout/src/social/workflowProtocol";
import {
  ackRequestFor,
  adoptionProofOf,
  authorityKey,
  authorityOf,
  canonicalOrigin,
  describeRequest,
  detachRequest,
  isManualOccurrenceId,
  isVerifiedReceipt,
  occurrenceKey,
  parseAnswer,
  readyOccurrenceId,
  submitRequestOf,
  type CloudRequest,
} from "./cloudWorkflowProtocol";

// ⚙️ DT-7C-1 browser protocol (planning/tools/38-cloud-workflows.md): origin/authority/keys, request descriptors,
// the Ready id vectors and the strict parsers on hand-built receipts. The real Worker answers (every state/outcome)
// and the tamper tables live in cloudWorkflowProtocol.wire.test.ts. Nothing here touches the network.

type A = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OWNER = "wfo_" + "a".repeat(32);
const ORIGIN = "https://scout.example";
const DIG = "e".repeat(64);
const AT = "2026-10-17T09:00:00.000Z";
const SUBMITTED = "2026-10-17T09:05:00.000Z";

afterEach(() => vi.unstubAllGlobals());

const idea = (id: string, en = "Idea {date}") => ({ id, kind: "idea", text: { ar: "", en } });
function bodyOf(o: A = {}): OccurrenceBody {
  const ready = o.ready ?? false;
  return {
    occurrenceId: o.id ?? (ready ? "ar-r1" : "m1"),
    ownerKey: o.owner ?? OWNER,
    workflowId: "w1",
    kind: ready ? "article-ready" : "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: { ar: "", en: "Flow" },
      trigger: { kind: ready ? "article-ready" : "manual" },
      actions: o.actions ?? [idea("a1")],
    },
    plannerContext: null,
    input: ready
      ? {
          articleId: "art1",
          title: o.title ?? { ar: "", en: "T" },
          summary: o.summary ?? { ar: "", en: "S" },
          slug: "s",
          lang: "en",
          day: "2026-10-17",
        }
      : {
          title: { ar: "", en: "" },
          summary: { ar: "", en: "" },
          slug: "",
          lang: "en",
          day: "2026-10-17",
        },
    executionAt: AT,
  } as unknown as OccurrenceBody;
}
const digestOf = (b: unknown) => sha256Hex(canonicalJson(b));

/** A pending receipt exactly as the Worker answers it (hand-built; the wire test uses the real coordinator). */
async function pendingReceipt(b: OccurrenceBody): Promise<A> {
  return {
    occurrenceId: b.occurrenceId,
    workflowId: b.workflowId,
    kind: b.kind,
    registrationEpoch: 1,
    revision: 1,
    body: JSON.parse(JSON.stringify(b)),
    payloadDigest: await digestOf(b),
    state: "pending",
    receiptVersion: 1,
    changeSeq: 1,
    createdAt: SUBMITTED,
    updatedAt: SUBMITTED,
    ackedVersion: 0,
    steps: b.snapshot.actions.map((a, idx) => ({
      idx,
      actionId: a.id,
      kind: a.kind,
      status: "pending",
    })),
    outputs: [],
  };
}
/** A done one-idea receipt (v3) with its output record, digest and purge time. */
async function doneReceipt(b: OccurrenceBody): Promise<A> {
  const id = `wf:${b.occurrenceId}:a1`;
  const record = { id, text: "Idea 2026-10-17", source: "workflow", createdAt: AT };
  const digest = await digestOf(record);
  const finished = "2026-10-17T09:06:00.000Z";
  return {
    ...(await pendingReceipt(b)),
    state: "done",
    receiptVersion: 3,
    changeSeq: 3,
    startedAt: SUBMITTED,
    finishedAt: finished,
    updatedAt: finished,
    purgeAt: new Date(Date.parse(finished) + 180 * 86_400_000).toISOString(),
    steps: [
      {
        idx: 0,
        actionId: "a1",
        kind: "idea",
        status: "done",
        outputId: id,
        outputDigest: digest,
        at: finished,
      },
    ],
    outputs: [{ outputId: id, actionId: "a1", kind: "idea", digest, record }],
  };
}
const ctx = { origin: ORIGIN };
const ok = async (req: CloudRequest, status: number, body: unknown) =>
  parseAnswer(req, { status, body }, ctx);
const statusReq = (id = "m1", extra: A = {}): CloudRequest =>
  ({ kind: "status", ownerKey: OWNER, occurrenceId: id, ...extra }) as CloudRequest;

describe("canonical origin and authority", () => {
  it.each([
    ["https://scout.example", "https://scout.example"],
    ["https://Scout.Example/", "https://scout.example"],
    ["HTTPS://SCOUT.EXAMPLE", "https://scout.example"],
    ["https://scout.example:443", "https://scout.example"],
    ["https://scout.example:443/", "https://scout.example"],
    ["http://scout.example:80/", "http://scout.example"],
    ["http://localhost:8787", "http://localhost:8787"],
    ["https://scout.example:8443/", "https://scout.example:8443"],
    ["http://[::1]:8787/", "http://[::1]:8787"],
    ["https://bücher.example", "https://xn--bcher-kva.example"],
  ])("accepts %s as %s", (raw, canon) => {
    expect(canonicalOrigin(raw)).toBe(canon);
  });

  it.each([
    "",
    "scout.example",
    "ftp://scout.example",
    "wss://scout.example",
    "https://",
    "https://user@scout.example",
    "https://user:pass@scout.example",
    "https://scout.example/?a=1",
    "https://scout.example?a=1",
    "https://scout.example?",
    "https://scout.example/#f",
    "https://scout.example#",
    "https://scout.example/path",
    "https://scout.example//",
    "https://scout.example/a/",
    "https://scout.example\\",
    " https://scout.example",
    "https://scout.example ",
    "https://scout .example",
    "https://scout.example\n",
    "javascript:alert(1)",
  ])("rejects %j (never silently redirected)", (raw) => {
    expect(canonicalOrigin(raw)).toBeNull();
  });

  it.each([undefined, null, 1, {}, [], ["https://scout.example"]])(
    "rejects non-string %j",
    (raw) => {
      expect(canonicalOrigin(raw)).toBeNull();
    },
  );

  it("equivalent spellings give one authority and one key; ownerKey is part of it", () => {
    const a = authorityOf("https://Scout.Example:443/", OWNER)!;
    const b = authorityOf("https://scout.example", OWNER)!;
    expect(a).toEqual({ origin: "https://scout.example", ownerKey: OWNER });
    expect(authorityKey(a)).toBe(authorityKey(b));
    expect(occurrenceKey(a, "m1")).toBe(occurrenceKey(b, "m1"));
    // Same origin, another server ownerKey: another authority. Same ownerKey, another origin: another authority.
    const other = authorityOf(ORIGIN, "wfo_" + "b".repeat(32))!;
    expect(authorityKey(other)).not.toBe(authorityKey(a));
    expect(authorityKey(authorityOf("https://other.example", OWNER)!)).not.toBe(authorityKey(a));
    expect(authorityOf(ORIGIN, "wfo_short")).toBeNull();
    expect(authorityOf("https://x/path", OWNER)).toBeNull();
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("keys are an unambiguous JSON tuple: no delimiter trick, no credential, no unsupported id", () => {
    const a = authorityOf(ORIGIN, OWNER)!;
    expect(authorityKey(a)).toBe(`["${ORIGIN}","${OWNER}"]`);
    expect(occurrenceKey(a, "m1")).toBe(`["${ORIGIN}","${OWNER}","m1"]`);
    expect(JSON.parse(occurrenceKey(a, "ar-x_y-9")!)).toEqual([ORIGIN, OWNER, "ar-x_y-9"]);
    for (const bad of ["", "m:1", "a b", "x".repeat(65), "m1\u0000", "../m1", 'm1","x'])
      expect(occurrenceKey(a, bad)).toBeNull();
    // Two different tuples never collide even when their concatenations are equal.
    const k1 = canonicalJson(["https://a.example", "b", "c"]);
    const k2 = canonicalJson(["https://a.example", "bc", ""]);
    expect(k1).not.toBe(k2);
  });
});

describe("request descriptors: method, fixed route/query and allowlisted body only", () => {
  const body = bodyOf();
  const cases: [string, CloudRequest, string, string, A | undefined][] = [
    ["authority", { kind: "authority" }, "GET", "/social/workflows/authority", undefined],
    [
      "register",
      {
        kind: "register",
        ownerKey: OWNER,
        workflowId: "w1",
        expectedEpoch: 0,
        revision: 1,
        workflowDigest: DIG,
      },
      "POST",
      "/social/workflows/registrations",
      { ownerKey: OWNER, workflowId: "w1", expectedEpoch: 0, revision: 1, workflowDigest: DIG },
    ],
    [
      "update",
      {
        kind: "update",
        ownerKey: OWNER,
        workflowId: "w-1_x",
        registrationEpoch: 2,
        expectedRevision: 1,
        revision: 2,
        workflowDigest: DIG,
      },
      "POST",
      "/social/workflows/registrations/w-1_x",
      {
        ownerKey: OWNER,
        registrationEpoch: 2,
        expectedRevision: 1,
        revision: 2,
        workflowDigest: DIG,
      },
    ],
    [
      "pause",
      {
        kind: "pause",
        ownerKey: OWNER,
        workflowId: "w1",
        registrationEpoch: 1,
        expectedRevision: 3,
      },
      "POST",
      "/social/workflows/registrations/w1/pause",
      { ownerKey: OWNER, registrationEpoch: 1, expectedRevision: 3 },
    ],
    [
      "resume",
      {
        kind: "resume",
        ownerKey: OWNER,
        workflowId: "w1",
        registrationEpoch: 1,
        expectedRevision: 3,
      },
      "POST",
      "/social/workflows/registrations/w1/resume",
      { ownerKey: OWNER, registrationEpoch: 1, expectedRevision: 3 },
    ],
    [
      "unregister",
      {
        kind: "unregister",
        ownerKey: OWNER,
        workflowId: "w1",
        registrationEpoch: 1,
        expectedRevision: 0,
      },
      "POST",
      "/social/workflows/registrations/w1/unregister",
      { ownerKey: OWNER, registrationEpoch: 1, expectedRevision: 0 },
    ],
    [
      "submit",
      { kind: "submit", body, payloadDigest: DIG },
      "POST",
      "/social/workflows/occurrences",
      { body, payloadDigest: DIG },
    ],
    [
      "status",
      statusReq("ar-abc_-9"),
      "GET",
      `/social/workflows/occurrences/ar-abc_-9?ownerKey=${OWNER}`,
      undefined,
    ],
    [
      "cancel",
      { kind: "cancel", ownerKey: OWNER, occurrenceId: "m1" },
      "POST",
      "/social/workflows/occurrences/m1/cancel",
      { ownerKey: OWNER },
    ],
    [
      "run",
      { kind: "run", ownerKey: OWNER, occurrenceId: "m1" },
      "POST",
      "/social/workflows/occurrences/m1/run",
      { ownerKey: OWNER },
    ],
    [
      "ack",
      { kind: "ack", ownerKey: OWNER, occurrenceId: "m1", receiptVersion: 4 },
      "POST",
      "/social/workflows/occurrences/m1/ack",
      { ownerKey: OWNER, receiptVersion: 4 },
    ],
    [
      "changes",
      { kind: "changes", ownerKey: OWNER, after: 0 },
      "GET",
      `/social/workflows/changes?ownerKey=${OWNER}&after=0`,
      undefined,
    ],
    [
      "changes+limit",
      { kind: "changes", ownerKey: OWNER, after: 41, limit: 50 },
      "GET",
      `/social/workflows/changes?ownerKey=${OWNER}&after=41&limit=50`,
      undefined,
    ],
  ];

  it.each(cases)("%s", (_n, req, method, path, wire) => {
    const d = describeRequest(req);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.descriptor.method).toBe(method);
    expect(d.descriptor.path).toBe(path);
    expect(d.descriptor.body).toEqual(wire);
    // Exactly these keys: no header, no origin, no Authorization, no credential of any kind.
    expect(Object.keys(d.descriptor).sort()).toEqual(
      wire ? ["body", "method", "path"] : ["method", "path"],
    );
    expect(Object.isFrozen(d.descriptor)).toBe(true);
    const text = JSON.stringify(d.descriptor);
    for (const word of ["Authorization", "Bearer", "token", "fingerprint", "headers", "origin"])
      expect(text).not.toContain(word);
  });

  it("the body is a copy: mutating the request afterwards changes nothing sent", () => {
    const b = bodyOf();
    const req: CloudRequest = { kind: "submit", body: b, payloadDigest: DIG };
    const d = describeRequest(req);
    (b.snapshot.actions[0] as A).id = "evil";
    (b as A).ownerKey = "wfo_" + "9".repeat(32);
    expect(d.ok && (d.descriptor.body as A).body.snapshot.actions[0].id).toBe("a1");
    expect(d.ok && (d.descriptor.body as A).body.ownerKey).toBe(OWNER);
  });

  it.each([
    ["unknown kind", { kind: "ping" }],
    [
      "unknown key (credential canary)",
      { kind: "run", ownerKey: OWNER, occurrenceId: "m1", authorization: "Bearer CANARY" },
    ],
    ["fingerprint canary", { kind: "authority", tokenFingerprint: "CANARY" }],
    ["bad ownerKey", { kind: "run", ownerKey: "wfo_x", occurrenceId: "m1" }],
    ["colon id", { kind: "run", ownerKey: OWNER, occurrenceId: "m:1" }],
    ["too-long id", { kind: "run", ownerKey: OWNER, occurrenceId: "x".repeat(65) }],
    ["path-traversal id", { kind: "status", ownerKey: OWNER, occurrenceId: "../authority" }],
    ["ack version 0", { kind: "ack", ownerKey: OWNER, occurrenceId: "m1", receiptVersion: 0 }],
    ["ack fractional", { kind: "ack", ownerKey: OWNER, occurrenceId: "m1", receiptVersion: 1.5 }],
    ["changes negative after", { kind: "changes", ownerKey: OWNER, after: -1 }],
    ["changes limit 0", { kind: "changes", ownerKey: OWNER, after: 0, limit: 0 }],
    ["changes limit 51", { kind: "changes", ownerKey: OWNER, after: 0, limit: 51 }],
    [
      "register bad digest",
      {
        kind: "register",
        ownerKey: OWNER,
        workflowId: "w1",
        expectedEpoch: 0,
        revision: 1,
        workflowDigest: "E".repeat(64),
      },
    ],
    [
      "register negative epoch",
      {
        kind: "register",
        ownerKey: OWNER,
        workflowId: "w1",
        expectedEpoch: -1,
        revision: 1,
        workflowDigest: DIG,
      },
    ],
    [
      "update revision 0",
      {
        kind: "update",
        ownerKey: OWNER,
        workflowId: "w1",
        registrationEpoch: 1,
        expectedRevision: 0,
        revision: 0,
        workflowDigest: DIG,
      },
    ],
    [
      "submit unknown body key",
      {
        kind: "submit",
        body: { ...bodyOf(), articles: [{ body: "PRIVATE" }] },
        payloadDigest: DIG,
      },
    ],
    ["submit bad digest", { kind: "submit", body: bodyOf(), payloadDigest: "xyz" }],
    [
      "expect with unknown key",
      { kind: "status", ownerKey: OWNER, occurrenceId: "m1", expect: { token: "x" } },
    ],
    [
      "expect with bad digest",
      { kind: "status", ownerKey: OWNER, occurrenceId: "m1", expect: { payloadDigest: "x" } },
    ],
    ["not an object", null],
  ])("refuses %s", (_n, req) => {
    expect(describeRequest(req as unknown as CloudRequest)).toEqual({ ok: false });
  });

  it("submitRequestOf: digest = canonical digest of an admitted-shaped copy; other shapes refused", async () => {
    const b = bodyOf({ actions: [idea("a1", "اختبار ✓ {date}")] });
    const r = await submitRequestOf(b);
    expect(r.ok && r.request.kind === "submit" && r.request.payloadDigest).toBe(await digestOf(b));
    expect(await submitRequestOf({ ...b, extra: 1 })).toEqual({ ok: false });
    expect(await submitRequestOf(null)).toEqual({ ok: false });
  });
});

describe("Ready and manual occurrence ids", () => {
  it.each([
    [["w1", "art1", "commit-1"], "ar-GXgTQjklnh2Ftm05vG5fTL0lYoO5nShKmHBleWh5NFI"],
    [["w1", "art1", "commit-2"], "ar-h1jNtyms4TOPRBkrR-x3abvaCP6UO1ZDoBaxwAc4v_c"],
    [["w1", "art1", "تصوير-🎬"], "ar-gSvPHOFc-jcrY8nFvhuS227K5LAkszAsD_KFv1qPEhA"],
    [["w1", "a", "b"], "ar-ekMlAxxl5YjaGSQN8fVp5TRdPrhDA_AkqeBeEdYP_Fg"],
    [
      ["wf_a", "x-y_z", "0123456789abcdef0123456789abcdef"],
      "ar-wBPxSHYQPwRuiQZ_zXPuVZNkPSnaoxsg71OtxVl0G4U",
    ],
  ])("vector %j", async (tuple, expected) => {
    const id = await readyOccurrenceId(tuple[0], tuple[1], tuple[2]);
    expect(id).toBe(expected);
    expect(id).toHaveLength(46);
    // Independent computation: all 32 SHA-256 bytes of the canonical tuple, unpadded base64url.
    const bytes = createHash("sha256").update(JSON.stringify(tuple)).digest();
    expect(id).toBe(`ar-${bytes.toString("base64url")}`);
    expect(bytes.length).toBe(32);
    // Fits the Worker's id bound and an article-ready body accepts it.
    expect(id).toMatch(/^ar-[A-Za-z0-9_-]{43}$/);
    const b = bodyOf({ ready: true, id });
    expect(checkBody(b, Date.parse(AT))).toMatchObject({ ok: true });
  });

  it("deterministic; a new Ready commit, article or workflow is a new id; no delimiter ambiguity", async () => {
    const a = await readyOccurrenceId("w1", "art1", "c1");
    expect(await readyOccurrenceId("w1", "art1", "c1")).toBe(a);
    const others = await Promise.all([
      readyOccurrenceId("w1", "art1", "c2"),
      readyOccurrenceId("w1", "art2", "c1"),
      readyOccurrenceId("w2", "art1", "c1"),
      // Moving a character across the boundary changes the id.
      readyOccurrenceId("w1", "art1c", "1"),
      readyOccurrenceId("w1a", "rt1", "c1"),
    ]);
    expect(new Set([a, ...others]).size).toBe(6);
  });

  it("unsupported components are refused, never truncated or sanitized", async () => {
    expect(await readyOccurrenceId("w:1", "a", "c")).toBeNull();
    expect(await readyOccurrenceId("w1", "a b", "c")).toBeNull();
    expect(await readyOccurrenceId("w1", "", "c")).toBeNull();
    expect(await readyOccurrenceId("w1", "a", "")).toBeNull();
    expect(await readyOccurrenceId("w1", "a", "c".repeat(201))).toBeNull();
    expect(await readyOccurrenceId("w1", "a", 5)).toBeNull();
    expect(await readyOccurrenceId(undefined, "a", "c")).toBeNull();
    expect(await readyOccurrenceId("w1", "a", "c".repeat(200))).toHaveLength(46);
  });

  it("manual ids: the id alphabet, fresh from the caller, never a reserved prefix", () => {
    for (const ok of ["m1", "manual_2026-10-17", "x".repeat(64), "AR-1", "arx", "s", "sc_1"])
      expect(isManualOccurrenceId(ok)).toBe(true);
    for (const bad of ["", "ar-1", "sc-1", "m:1", "a b", "x".repeat(65), 5, null, undefined])
      expect(isManualOccurrenceId(bad)).toBe(false);
  });
});

describe("answers: strict, request-bound, never partial", () => {
  it("authority: ownerKey only; the origin is the caller's captured context", async () => {
    const r = await ok({ kind: "authority" }, 200, { ownerKey: OWNER });
    expect(r).toEqual({
      outcome: "ok",
      kind: "authority",
      authority: { origin: ORIGIN, ownerKey: OWNER },
    });
    for (const bad of [
      { ownerKey: "wfo_x" },
      { ownerKey: OWNER, origin: ORIGIN },
      {},
      [],
      null,
      "x",
    ])
      expect(await ok({ kind: "authority" }, 200, bad)).toMatchObject({ outcome: "invalid" });
    expect(await ok({ kind: "authority" }, 201, { ownerKey: OWNER })).toMatchObject({
      outcome: "invalid",
      reason: "status",
    });
    // The configured endpoint is canonicalized or rejected, not trusted: query/credentials/path fail.
    for (const origin of ["https://u:p@scout.example", "https://scout.example/x", "", undefined])
      expect(
        await parseAnswer(
          { kind: "authority" },
          { status: 200, body: { ownerKey: OWNER } },
          { origin },
        ),
      ).toEqual({
        outcome: "invalid",
        reason: "origin",
      });
    const spelled = await parseAnswer(
      { kind: "authority" },
      { status: 200, body: { ownerKey: OWNER } },
      { origin: "HTTPS://Scout.Example:443/" },
    );
    expect(spelled).toMatchObject({ authority: { origin: ORIGIN } });
  });

  it("a pending submit receipt: created 201, replay 200; identity, digest and envelope are bound", async () => {
    const b = bodyOf();
    const req: CloudRequest = { kind: "submit", body: b, payloadDigest: await digestOf(b) };
    const receipt = await pendingReceipt(b);
    const created = await ok(req, 201, { ownerKey: OWNER, occurrence: receipt, created: true });
    expect(created).toMatchObject({ outcome: "ok", kind: "submit", created: true });
    expect(
      created.outcome === "ok" && created.kind === "submit" && isVerifiedReceipt(created.receipt),
    ).toBe(true);
    expect(
      await ok(req, 200, { ownerKey: OWNER, occurrence: receipt, created: false }),
    ).toMatchObject({ outcome: "ok", created: false });
    // Wrong status for created/replay.
    expect(
      await ok(req, 200, { ownerKey: OWNER, occurrence: receipt, created: true }),
    ).toMatchObject({ outcome: "invalid", reason: "status" });
    expect(
      await ok(req, 201, { ownerKey: OWNER, occurrence: receipt, created: false }),
    ).toMatchObject({ outcome: "invalid", reason: "status" });
    const bad = (mut: (r: A) => void, wrap: (x: A) => A = (x) => x) => {
      const r = JSON.parse(JSON.stringify(receipt)) as A;
      mut(r);
      return ok(req, 201, wrap({ ownerKey: OWNER, occurrence: r, created: true }));
    };
    for (const m of [
      (r: A) => (r.occurrenceId = "m2"),
      (r: A) => (r.payloadDigest = "0".repeat(64)),
      (r: A) => (r.body.snapshot.actions[0].text.en = "other"),
      (r: A) => (r.body.ownerKey = "wfo_" + "9".repeat(32)),
      (r: A) => (r.receiptVersion = 2),
      (r: A) => (r.state = "running"),
      (r: A) => (r.extra = 1),
      (r: A) => (r.steps[0].status = "done"),
      (r: A) => (r.outputs = [{}]),
      (r: A) => (r.ackedVersion = 1),
      (r: A) => (r.updatedAt = "2026-10-17T09:06:00.000Z"),
      (r: A) => (r.revision = 2),
      (r: A) => (r.workflowId = "w2"),
      (r: A) => delete r.steps,
    ])
      expect(await bad(m)).toMatchObject({ outcome: "invalid" });
    // Envelope tampering: foreign owner, unknown key, mixed error/success, array, string.
    expect(
      await bad(
        () => {},
        (x) => ({ ...x, ownerKey: "wfo_" + "9".repeat(32) }),
      ),
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await bad(
        () => {},
        (x) => ({ ...x, extra: true }),
      ),
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await bad(
        () => {},
        (x) => ({ ...x, error: "conflict" }),
      ),
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await bad(
        () => {},
        (x) => ({ ...x, created: "yes" }),
      ),
    ).toMatchObject({ outcome: "invalid" });
    expect(await ok(req, 201, [])).toMatchObject({ outcome: "invalid" });
    expect(await ok(req, 201, "ok")).toMatchObject({ outcome: "invalid" });
    expect(await ok(req, 201, null)).toMatchObject({ outcome: "invalid" });
    // A receipt that is not the one this request submitted (same id, other asserted digest).
    const other: CloudRequest = { kind: "submit", body: b, payloadDigest: "d".repeat(64) };
    expect(
      await ok(other, 201, { ownerKey: OWNER, occurrence: receipt, created: true }),
    ).toMatchObject({ outcome: "invalid", reason: "binding" });
  });

  it("history is validated at the receipt's admitted time, not today's clock", async () => {
    const b = bodyOf();
    const r = await pendingReceipt(b);
    // Admitted 2026-10-17; read "today" is irrelevant: the parser has no clock at all.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    try {
      expect(await ok(statusReq(), 200, { ownerKey: OWNER, occurrence: r })).toMatchObject({
        outcome: "ok",
        kind: "status",
      });
    } finally {
      vi.useRealTimers();
    }
    // executionAt later than the receipt's own admission time (+ skew) is not a valid history.
    const future = JSON.parse(JSON.stringify(r)) as A;
    future.createdAt = "2026-10-17T08:50:00.000Z";
    future.updatedAt = future.createdAt;
    expect(await ok(statusReq(), 200, { ownerKey: OWNER, occurrence: future })).toMatchObject({
      outcome: "ok",
    });
    future.createdAt = "2026-10-17T08:49:59.999Z"; // executionAt 09:00 > createdAt + 10 min skew
    future.updatedAt = future.createdAt;
    expect(await ok(statusReq(), 200, { ownerKey: OWNER, occurrence: future })).toMatchObject({
      outcome: "invalid",
      reason: "receipt",
    });
  });

  it("status: row, absent and pruned stay distinct; an expected body/digest/version binds", async () => {
    const b = bodyOf();
    const r = await pendingReceipt(b);
    const row = await ok(statusReq(), 200, { ownerKey: OWNER, occurrence: r });
    expect(row).toMatchObject({ outcome: "ok", kind: "status", result: { found: "row" } });
    const absent = await ok(statusReq("zz"), 200, {
      ownerKey: OWNER,
      occurrenceId: "zz",
      state: "absent",
    });
    expect(absent).toMatchObject({ result: { found: "absent", occurrenceId: "zz" } });
    const pruned = {
      ownerKey: OWNER,
      occurrenceId: "old",
      state: "pruned",
      payloadDigest: DIG,
      prunedAt: AT,
    };
    expect(await ok(statusReq("old"), 200, pruned)).toMatchObject({
      result: { found: "pruned", payloadDigest: DIG, prunedAt: AT },
    });
    // Another id echoed, extra keys, a row mixed with a state word: failures.
    expect(
      await ok(statusReq("other"), 200, { ownerKey: OWNER, occurrenceId: "zz", state: "absent" }),
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await ok(statusReq("zz"), 200, {
        ownerKey: OWNER,
        occurrenceId: "zz",
        state: "absent",
        payloadDigest: DIG,
      }),
    ).toMatchObject({ outcome: "invalid" });
    expect(await ok(statusReq("old"), 200, { ...pruned, state: "absent" })).toMatchObject({
      outcome: "invalid",
    });
    expect(await ok(statusReq("old"), 200, { ...pruned, prunedAt: "yesterday" })).toMatchObject({
      outcome: "invalid",
    });
    expect(await ok(statusReq("old"), 200, { ...pruned, state: "gone" })).toMatchObject({
      outcome: "invalid",
    });
    // Without any expectation the receipt's own digest still binds its body (a quietly edited valid body fails).
    const edited = JSON.parse(JSON.stringify(r)) as A;
    edited.body.snapshot.actions[0].text.en = "quietly edited";
    expect(await ok(statusReq(), 200, { ownerKey: OWNER, occurrence: edited })).toEqual({
      outcome: "invalid",
      reason: "receipt",
    });
    // Expectations: exact body, digest, version; pruned tombstone of other content.
    const d = await digestOf(b);
    expect(
      await ok(
        statusReq("m1", {
          expect: { body: b, payloadDigest: d, receiptVersion: 1, outputIds: [] },
        }),
        200,
        { ownerKey: OWNER, occurrence: r },
      ),
    ).toMatchObject({ outcome: "ok" });
    const wrongBody = bodyOf({ actions: [idea("a1", "different")] });
    for (const expect_ of [
      { body: wrongBody },
      { payloadDigest: "0".repeat(64) },
      { receiptVersion: 2 },
      { outputIds: ["wf:m1:a1"] },
    ])
      expect(
        await ok(statusReq("m1", { expect: expect_ }), 200, { ownerKey: OWNER, occurrence: r }),
      ).toMatchObject({ outcome: "invalid", reason: "binding" });
    expect(
      await ok(statusReq("old", { expect: { payloadDigest: "0".repeat(64) } }), 200, pruned),
    ).toMatchObject({ outcome: "invalid", reason: "binding" });
    expect(
      await ok(statusReq("old", { expect: { payloadDigest: DIG } }), 200, pruned),
    ).toMatchObject({ outcome: "ok" });
  });

  it("returned receipts are frozen copies: mutating the source answer afterwards changes nothing", async () => {
    const b = bodyOf();
    const wire = { ownerKey: OWNER, occurrence: await pendingReceipt(b) };
    const r = await ok(statusReq(), 200, wire);
    if (r.outcome !== "ok" || r.kind !== "status" || r.result.found !== "row")
      throw new Error("setup");
    const rec = r.result.receipt;
    const before = JSON.stringify(rec);
    wire.occurrence.body.snapshot.actions[0].id = "evil";
    wire.occurrence.steps[0].status = "done";
    expect(JSON.stringify(rec)).toBe(before);
    expect(Object.isFrozen(rec)).toBe(true);
    expect(Object.isFrozen(rec.body.snapshot.actions)).toBe(true);
    expect(() => {
      (rec as A).state = "done";
    }).toThrow(TypeError);
  });

  it("non-plain data is refused, not coerced", async () => {
    const b = bodyOf();
    const wire = { ownerKey: OWNER, occurrence: await pendingReceipt(b) };
    for (const poison of [
      new Date(0),
      new Map(),
      () => 1,
      Symbol("x"),
      Number.NaN,
      Infinity,
      BigInt(10),
      undefined,
    ])
      expect(await ok(statusReq(), 200, { ...wire, poison })).toMatchObject({ outcome: "invalid" });
    const cyc: A = { ownerKey: OWNER };
    cyc.self = cyc;
    expect(await ok(statusReq(), 200, cyc)).toMatchObject({ outcome: "invalid" });
    const proto = JSON.parse('{"ownerKey":"' + OWNER + '","__proto__":{"x":1}}') as unknown;
    expect(await ok(statusReq(), 200, proto)).toMatchObject({ outcome: "invalid" });
  });

  it("typed refusals are request-bound; mixed, foreign or off-table ones are invalid", async () => {
    const run: CloudRequest = { kind: "run", ownerKey: OWNER, occurrenceId: "m1" };
    expect(
      await ok(run, 404, { error: "absent", ownerKey: OWNER, occurrenceId: "m1" }),
    ).toMatchObject({
      outcome: "refused",
      error: "absent",
      status: 404,
      authority: { origin: ORIGIN, ownerKey: OWNER },
      fields: { occurrenceId: "m1" },
    });
    expect(
      await ok(run, 410, {
        error: "pruned",
        ownerKey: OWNER,
        occurrenceId: "m1",
        payloadDigest: DIG,
        prunedAt: AT,
      }),
    ).toMatchObject({ outcome: "refused", error: "pruned", status: 410 });
    // Bare refusals carry nothing else.
    expect(await ok(run, 409, { error: "authority_mismatch" })).toMatchObject({
      outcome: "refused",
      error: "authority_mismatch",
      fields: {},
    });
    expect(await ok(run, 400, { error: "bad_request" })).toMatchObject({
      outcome: "refused",
      error: "bad_request",
    });
    expect(await ok(run, 413, { error: "too_large" })).toMatchObject({
      outcome: "refused",
      error: "too_large",
    });
    expect(await ok(run, 503, { error: "receipt_unavailable" })).toMatchObject({
      outcome: "refused",
      error: "receipt_unavailable",
    });
    expect(await ok(run, 503, { error: "not_configured", detail: "workflow-store" })).toMatchObject(
      { outcome: "refused", error: "not_configured" },
    );
    expect(await ok(run, 405, { error: "method_not_allowed" })).toMatchObject({
      outcome: "refused",
      error: "method_not_allowed",
    });
    for (const [status, body] of [
      [404, { error: "absent", ownerKey: OWNER, occurrenceId: "m2" }], // another occurrence
      [404, { error: "absent", ownerKey: "wfo_" + "9".repeat(32), occurrenceId: "m1" }], // another owner
      [404, { error: "absent", occurrenceId: "m1" }], // owner missing
      [404, { error: "absent", ownerKey: OWNER, occurrenceId: "m1", extra: 1 }],
      [200, { error: "absent", ownerKey: OWNER, occurrenceId: "m1" }], // wrong status
      [409, { error: "absent", ownerKey: OWNER, occurrenceId: "m1" }],
      [
        409,
        { error: "pruned", ownerKey: OWNER, occurrenceId: "m1", payloadDigest: DIG, prunedAt: AT },
      ], // run pruned is 410
      [409, { error: "conflict", ownerKey: OWNER }], // conflict is not a run error
      [409, { error: "running", ownerKey: OWNER, occurrenceId: "m1" }], // cancel-only
      [409, { error: "authority_mismatch", ownerKey: OWNER }],
      [400, { error: "bad_request", ownerKey: OWNER }],
      [418, { error: "teapot" }],
      [404, { error: 5 }],
      [404, { error: "absent", ownerKey: OWNER, occurrenceId: "m1", occurrence: {} }], // error mixed with proof
      [503, { error: "not_configured" }],
      [503, { error: "not_configured", detail: "elsewhere" }],
      [503, { error: "receipt_unavailable", ownerKey: OWNER }],
    ] as [number, unknown][])
      expect(await ok(run, status, body)).toMatchObject({ outcome: "invalid" });
    // not_terminal / future_version rules on ack.
    const ack: CloudRequest = {
      kind: "ack",
      ownerKey: OWNER,
      occurrenceId: "m1",
      receiptVersion: 5,
    };
    expect(
      await ok(ack, 409, {
        error: "not_terminal",
        ownerKey: OWNER,
        occurrenceId: "m1",
        state: "pending",
        receiptVersion: 1,
      }),
    ).toMatchObject({ outcome: "refused" });
    expect(
      await ok(ack, 409, {
        error: "not_terminal",
        ownerKey: OWNER,
        occurrenceId: "m1",
        state: "running",
        receiptVersion: 3,
      }),
    ).toMatchObject({ outcome: "refused" });
    expect(
      await ok(ack, 409, {
        error: "not_terminal",
        ownerKey: OWNER,
        occurrenceId: "m1",
        state: "pending",
        receiptVersion: 2,
      }),
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await ok(ack, 409, {
        error: "not_terminal",
        ownerKey: OWNER,
        occurrenceId: "m1",
        state: "done",
        receiptVersion: 3,
      }),
    ).toMatchObject({ outcome: "invalid" });
    expect(
      await ok(ack, 409, {
        error: "future_version",
        ownerKey: OWNER,
        occurrenceId: "m1",
        receiptVersion: 4,
      }),
    ).toMatchObject({ outcome: "refused" });
    expect(
      await ok(ack, 409, {
        error: "future_version",
        ownerKey: OWNER,
        occurrenceId: "m1",
        receiptVersion: 5,
      }),
    ).toMatchObject({ outcome: "invalid" });
  });

  it("registration conflicts must not be the very answer the request would have succeeded with", async () => {
    const reg = (o: A = {}): A => ({
      workflowId: "w1",
      registrationEpoch: 1,
      revision: 2,
      workflowDigest: DIG,
      state: "active",
      paused: false,
      updatedAt: AT,
      epochs: [{ epoch: 1, openedAt: AT }],
      ...o,
    });
    const up: CloudRequest = {
      kind: "update",
      ownerKey: OWNER,
      workflowId: "w1",
      registrationEpoch: 1,
      expectedRevision: 0,
      revision: 3,
      workflowDigest: DIG,
    };
    const conflict = (registration: unknown) => ({
      error: "conflict",
      ownerKey: OWNER,
      registration,
    });
    expect(await ok(up, 409, conflict(reg()))).toMatchObject({
      outcome: "refused",
      error: "conflict",
      fields: { registration: { revision: 2 } },
    });
    // The update would have applied (revision 3 with digest) -> that is a success, not a conflict.
    expect(await ok(up, 409, conflict(reg({ revision: 3 })))).toMatchObject({ outcome: "invalid" });
    expect(await ok(up, 409, conflict(reg({ workflowId: "w9" })))).toMatchObject({
      outcome: "invalid",
    });
    expect(await ok(up, 409, conflict(null))).toMatchObject({ outcome: "invalid" });
    expect(await ok(up, 409, { error: "conflict", ownerKey: OWNER })).toMatchObject({
      outcome: "invalid",
    });
    const r0: CloudRequest = {
      kind: "register",
      ownerKey: OWNER,
      workflowId: "w5",
      expectedEpoch: 1,
      revision: 1,
      workflowDigest: DIG,
    };
    expect(await ok(r0, 409, conflict(null))).toMatchObject({ outcome: "refused" });
    const r1: CloudRequest = { ...r0, expectedEpoch: 0 } as CloudRequest;
    expect(await ok(r1, 409, conflict(null))).toMatchObject({ outcome: "invalid" });
  });
});

describe("full receipt vs compact feed: the feed can never authorize an adoption or an ack", () => {
  it("verified terminal receipts authorize exactly their ack/adoption; feed items and look-alikes never", async () => {
    const b = bodyOf();
    const done = await doneReceipt(b);
    const full = await ok(statusReq(), 200, { ownerKey: OWNER, occurrence: done });
    if (full.outcome !== "ok" || full.kind !== "status" || full.result.found !== "row")
      throw new Error("setup");
    const receipt = full.result.receipt;
    expect(receipt.state).toBe("done");
    const ack = ackRequestFor(receipt);
    expect(ack).toEqual({ kind: "ack", ownerKey: OWNER, occurrenceId: "m1", receiptVersion: 3 });
    expect(describeRequest(ack!)).toMatchObject({
      ok: true,
      descriptor: { body: { receiptVersion: 3 } },
    });
    expect(adoptionProofOf(receipt)).toMatchObject({
      occurrenceId: "m1",
      receiptVersion: 3,
      payloadDigest: done.payloadDigest,
    });
    expect(adoptionProofOf(receipt)!.outputs.map((o) => o.outputId)).toEqual(["wf:m1:a1"]);

    // The compact feed item of the same occurrence.
    const item = { ...done };
    delete item.body;
    const feedItem = {
      occurrenceId: "m1",
      workflowId: "w1",
      changeSeq: 3,
      state: "done",
      receiptVersion: 3,
      payloadDigest: done.payloadDigest,
      steps: done.steps,
      outputs: done.outputs,
    };
    const page = await ok({ kind: "changes", ownerKey: OWNER, after: 0 }, 200, {
      ownerKey: OWNER,
      items: [feedItem],
      nextAfter: 3,
      more: false,
    });
    if (page.outcome !== "ok" || page.kind !== "changes") throw new Error("setup");
    expect(page.items).toHaveLength(1);
    expect(ackRequestFor(page.items[0])).toBeNull();
    expect(adoptionProofOf(page.items[0])).toBeNull();
    expect(isVerifiedReceipt(page.items[0])).toBe(false);
    // Neither a structural look-alike of the verified receipt nor a mutable clone is a verified receipt.
    expect(ackRequestFor(JSON.parse(JSON.stringify(receipt)))).toBeNull();
    expect(ackRequestFor({ ...receipt })).toBeNull();
    expect(adoptionProofOf(done)).toBeNull();
    // Non-terminal verified receipts authorize nothing.
    const pend = await ok(statusReq(), 200, {
      ownerKey: OWNER,
      occurrence: await pendingReceipt(b),
    });
    if (pend.outcome !== "ok" || pend.kind !== "status" || pend.result.found !== "row")
      throw new Error("setup");
    expect(ackRequestFor(pend.result.receipt)).toBeNull();
    expect(adoptionProofOf(pend.result.receipt)).toBeNull();
  });

  it("feed pages: order, unique ids, bounds, cursor and `more` are validated; no cursor is advanced here", async () => {
    const b = bodyOf();
    const pend = await pendingReceipt(b);
    const item = (id: string, seq: number): A => ({
      occurrenceId: id,
      workflowId: "w1",
      changeSeq: seq,
      state: "pending",
      receiptVersion: 1,
      payloadDigest: pend.payloadDigest,
      steps: pend.steps,
    });
    const req = (after: number, limit?: number): CloudRequest => ({
      kind: "changes",
      ownerKey: OWNER,
      after,
      ...(limit ? { limit } : {}),
    });
    const page = (items: A[], nextAfter: number, more: boolean) => ({
      ownerKey: OWNER,
      items,
      nextAfter,
      more,
    });
    expect(await ok(req(0, 2), 200, page([item("a", 1), item("b", 2)], 2, true))).toMatchObject({
      outcome: "ok",
      nextAfter: 2,
      more: true,
    });
    expect(await ok(req(5), 200, page([], 5, false))).toMatchObject({
      outcome: "ok",
      items: [],
      nextAfter: 5,
      more: false,
    });
    for (const [r, p] of [
      [req(0), page([item("a", 2), item("b", 1)], 1, false)], // order
      [req(0), page([item("a", 1), item("a", 2)], 2, false)], // duplicate id
      [req(1), page([item("a", 1)], 1, false)], // at or below `after`
      [req(0, 1), page([item("a", 1), item("b", 2)], 2, false)], // over the page limit
      [req(0), page([item("a", 1)], 9, false)], // cursor beyond the last item
      [req(0), page([item("a", 1)], 0, false)],
      [req(3), page([], 3, true)], // `more` with nothing returned
      [req(3), page([], 4, false)],
      [req(0), { ...page([item("a", 1)], 1, false), ownerKey: "wfo_" + "9".repeat(32) }],
      [req(0), { ...page([item("a", 1)], 1, false), extra: 1 }],
      [req(0), page([{ ...item("a", 1), body: b }], 1, false)], // the feed carries no body
      [req(0), page([{ ...item("a", 1), outputs: [] }], 1, false)], // outputs only when terminal
      [req(0), page([{ ...item("a", 1), state: "done" }], 1, false)], // done needs outputs and version
      [req(0), page([{ ...item("a", 1), receiptVersion: 2 }], 1, false)],
      [req(0), page([{ ...item("a", 1), payloadDigest: "x" }], 1, false)],
      [req(0), page([{ ...item("a", 1), steps: [] }], 1, false)],
      [req(0), { ...page([item("a", 1)], 1, false), more: "no" }],
    ] as [CloudRequest, unknown][])
      expect(await ok(r, 200, p)).toMatchObject({ outcome: "invalid" });
  });

  it("run answers: stop reasons and commit counts are bound to the receipt", async () => {
    const b = bodyOf();
    const run: CloudRequest = { kind: "run", ownerKey: OWNER, occurrenceId: "m1" };
    const done = await doneReceipt(b);
    const pend = await pendingReceipt(b);
    const wire = (occurrence: A, committed: number, stopped: string) => ({
      ownerKey: OWNER,
      occurrence,
      committed,
      stopped,
    });
    expect(await ok(run, 200, wire(done, 1, "terminal"))).toMatchObject({
      outcome: "ok",
      kind: "run",
      committed: 1,
      stopped: "terminal",
    });
    expect(await ok(run, 200, wire(done, 0, "terminal"))).toMatchObject({
      outcome: "ok",
      committed: 0,
    });
    expect(await ok(run, 200, wire(pend, 0, "paused"))).toMatchObject({
      outcome: "ok",
      stopped: "paused",
    });
    expect(await ok(run, 200, wire(pend, 0, "contention"))).toMatchObject({
      outcome: "ok",
      stopped: "contention",
    });
    for (const w of [
      wire(done, 2, "terminal"), // more commits than resolved steps
      wire(done, -1, "terminal"),
      wire(done, 1.5, "terminal"),
      wire(done, 6, "terminal"),
      wire(done, 1, "paused"),
      wire(pend, 0, "terminal"),
      wire(pend, 1, "paused"),
      wire(pend, 0, "limit"),
      wire(pend, 0, "elsewhere"),
      { ...wire(done, 1, "terminal"), extra: 1 },
    ])
      expect(await ok(run, 200, w)).toMatchObject({ outcome: "invalid" });
  });

  it("ack answers: acknowledged/no-op and purge bounds are bound to the request", async () => {
    const ack = (v: number): CloudRequest => ({
      kind: "ack",
      ownerKey: OWNER,
      occurrenceId: "m1",
      receiptVersion: v,
    });
    const base = {
      ownerKey: OWNER,
      occurrenceId: "m1",
      acknowledged: true,
      receiptVersion: 3,
      ackedVersion: 3,
      firstAckAt: SUBMITTED,
      purgeAt: "2027-01-01T00:00:00.000Z",
    };
    expect(await ok(ack(3), 200, base)).toMatchObject({
      outcome: "ok",
      kind: "ack",
      acknowledged: true,
    });
    // A replay at a lower version is a no-op, not an acknowledgement.
    expect(await ok(ack(1), 200, { ...base, acknowledged: false })).toMatchObject({
      outcome: "ok",
      acknowledged: false,
    });
    expect(
      await ok(ack(3), 200, {
        ...base,
        acknowledged: false,
        ackedVersion: 0,
        firstAckAt: undefined,
      }),
    ).toMatchObject({ outcome: "invalid" });
    for (const w of [
      { ...base, receiptVersion: 4, ackedVersion: 4 }, // acknowledged another version than asked
      { ...base, occurrenceId: "m2" },
      { ...base, ownerKey: "wfo_" + "9".repeat(32) },
      { ...base, ackedVersion: 2 },
      Object.fromEntries(Object.entries(base).filter(([k]) => k !== "firstAckAt")),
      { ...base, purgeAt: "2030-01-01T00:00:00.000Z" }, // beyond firstAck + 90 d
      { ...base, extra: 1 },
      { ...base, acknowledged: "yes" },
    ])
      expect(await ok(ack(3), 200, w)).toMatchObject({ outcome: "invalid" });
    expect(await ok(ack(3), 201, base)).toMatchObject({ outcome: "invalid", reason: "status" });
  });
});

describe("private-field canaries and zero external calls", () => {
  it("no bearer, fingerprint or header leaks into keys, descriptors or parsed results; zero fetches", async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("network is forbidden");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const b = bodyOf();
    const sub = await submitRequestOf(b);
    if (!sub.ok) throw new Error("setup");
    const parts: string[] = [];
    for (const req of [sub.request, statusReq(), { kind: "authority" } as CloudRequest]) {
      const d = describeRequest(req);
      parts.push(JSON.stringify(d));
    }
    const a = authorityOf("https://Scout.Example:443", OWNER)!;
    parts.push(authorityKey(a), occurrenceKey(a, "m1")!);
    const parsed = await ok(statusReq(), 200, {
      ownerKey: OWNER,
      occurrence: await pendingReceipt(b),
    });
    parts.push(JSON.stringify(parsed));
    const text = parts.join("\n");
    for (const word of [
      "Authorization",
      "Bearer",
      "bearer",
      "fingerprint",
      "SCOUT_TOKEN",
      "token",
      "password",
    ])
      expect(text).not.toContain(word);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a canary smuggled into any answer position is a failure, not an echo", async () => {
    const b = bodyOf();
    const base = await pendingReceipt(b);
    const wires: [string, A][] = [
      ["envelope", { ownerKey: OWNER, occurrence: base, CANARY: "x" }],
      ["receipt", { ownerKey: OWNER, occurrence: { ...base, CANARY: "x" } }],
      ["body", { ownerKey: OWNER, occurrence: { ...base, body: { ...base.body, CANARY: "x" } } }],
      [
        "step",
        { ownerKey: OWNER, occurrence: { ...base, steps: [{ ...base.steps[0], CANARY: "x" }] } },
      ],
      [
        "action",
        {
          ownerKey: OWNER,
          occurrence: {
            ...base,
            body: {
              ...base.body,
              snapshot: {
                ...base.body.snapshot,
                actions: [{ ...base.body.snapshot.actions[0], CANARY: "x" }],
              },
            },
          },
        },
      ],
    ];
    for (const [, wire] of wires) {
      const r = await ok(statusReq(), 200, wire);
      expect(r.outcome).toBe("invalid");
      expect(JSON.stringify(r)).not.toContain("CANARY");
    }
  });
});

describe("detachRequest: the exported capture helper (DT-7C-2B-1) is the one parseAnswer uses", () => {
  const status = (o: A = {}): CloudRequest =>
    ({ kind: "status", ownerKey: OWNER, occurrenceId: "o1", ...o }) as CloudRequest;

  it("returns a detached plain-JSON copy: later edits of the original cannot reach it, and it is not frozen", () => {
    const expectBody = bodyOf();
    const req = status({
      expect: { body: expectBody, payloadDigest: DIG, receiptVersion: 2, outputIds: ["wf:o1:a1"] },
    });
    const copy = detachRequest(req) as A;
    (req as A).ownerKey = "x";
    (req as A).expect.payloadDigest = "y";
    (req as A).expect.outputIds.push("z");
    (req as A).expect.body.snapshot.actions[0].id = "zzz";
    expect(copy.ownerKey).toBe(OWNER);
    expect(copy.expect.payloadDigest).toBe(DIG);
    expect(copy.expect.outputIds).toEqual(["wf:o1:a1"]);
    expect(copy.expect.body.snapshot.actions[0].id).toBe("a1");
    expect(Object.isFrozen(copy)).toBe(false);
    expect(Object.isFrozen(req)).toBe(false);
    expect(copy).not.toBe(req);
  });

  it("keeps the accepted optional-undefined behaviour: an undefined optional key means absent, at both levels", () => {
    const copy = detachRequest(
      status({
        expect: { body: undefined, payloadDigest: undefined, receiptVersion: undefined },
      }),
    ) as A;
    expect(Object.keys(copy.expect)).toEqual([]);
    expect(Object.keys(detachRequest(status({ expect: undefined })))).toEqual([
      "kind",
      "ownerKey",
      "occurrenceId",
    ]);
    expect(describeRequest(detachRequest(status({ expect: undefined }))).ok).toBe(true);
  });

  it("throws (never returns a lookalike) for anything that is not plain data", () => {
    class Evil {
      n = 1;
    }
    const cyclic: A = { kind: "authority" };
    cyclic.self = cyclic;
    const bad: unknown[] = [
      null,
      undefined,
      "authority",
      { kind: "authority", nested: new Evil() },
      { kind: "authority", f() {} },
      { kind: "status", ownerKey: OWNER, occurrenceId: "o1", n: Number.NaN },
      { kind: "status", ownerKey: OWNER, occurrenceId: "o1", n: Number.POSITIVE_INFINITY },
      { kind: "status", ownerKey: OWNER, occurrenceId: "o1", d: new Date() },
      cyclic,
    ];
    for (const b of bad) {
      let why: unknown;
      try {
        detachRequest(b as CloudRequest);
      } catch (e) {
        why = (e as { why?: unknown }).why;
      }
      expect(why, String(b)).toBe("request");
    }
  });

  it("flattens a top-level class instance to its own plain data (the accepted behaviour), never keeping its prototype", () => {
    class Own {
      kind = "authority";
    }
    const copy = detachRequest(new Own() as unknown as CloudRequest);
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(copy).toEqual({ kind: "authority" });
  });

  it("is exactly what parseAnswer binds: a request edited after the call cannot move the verdict", async () => {
    const req = { kind: "authority" } as CloudRequest;
    const copy = detachRequest(req);
    (req as A).kind = "status";
    expect(copy.kind).toBe("authority");
    const r = await parseAnswer(
      copy,
      { status: 200, body: { ownerKey: OWNER } },
      { origin: ORIGIN },
    );
    expect(r).toMatchObject({ outcome: "ok", kind: "authority" });
  });
});
