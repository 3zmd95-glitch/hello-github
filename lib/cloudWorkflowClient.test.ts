import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { payloadDigestOf, REQUEST_BYTES_MAX } from "@/workers/scout/src/social/workflowProtocol";
import {
  authorityOf,
  parseAnswer,
  submitRequestOf,
  type Authority,
  type CloudRequest,
  type OccurrenceBody,
} from "./cloudWorkflowProtocol";
import {
  createCloudWorkflowSession,
  DEADLINE_MS,
  RESPONSE_BYTES_MAX,
  type ClientRequestInit,
  type ClientResponse,
  type ExecuteResult,
  type SupportedRequest,
  transportOrigin,
} from "./cloudWorkflowClient";
import { createRegistrationController } from "./cloudWorkflowRegistrationClient";

// ⚙️ DT-7C-2B-1 browser transport/session boundaries (planning/tools/38-cloud-workflows.md). Fake transport only: the
// injected fetch is a spy, the global fetch throws, nothing here opens a socket. The real router/SQLite receipts
// (full receipts, the maximal-receipt size proof, mid-parse fences) live in cloudWorkflowClient.wire.test.ts.

const ORIGIN = "https://scout.test";
const OTHER = "https://other.test";
const TOKEN = "unit-secret-token-1";
const TOKEN_B = "unit-secret-token-2";
const OWNER = "wfo_" + "1".repeat(32);
const OWNER_B = "wfo_" + "2".repeat(32);
const DIG = "e".repeat(64);
const T0 = "2026-10-17T09:00:00.000Z";
const BASE = "/social/workflows";

type Call = { url: string; init: ClientRequestInit };
type Handler = (url: string, init: ClientRequestInit, n: number) => Promise<ClientResponse>;

const enc = new TextEncoder();
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const tick = async (n = 12) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function kind<K extends ExecuteResult["kind"]>(
  r: ExecuteResult,
  k: K,
): Extract<ExecuteResult, { kind: K }> {
  expect(r.kind).toBe(k);
  return r as Extract<ExecuteResult, { kind: K }>;
}

const A: Authority = authorityOf(ORIGIN, OWNER)!;
const registration = (o: Record<string, unknown> = {}) => ({
  workflowId: "w1",
  registrationEpoch: 1,
  revision: 1,
  workflowDigest: DIG,
  state: "active",
  paused: false,
  updatedAt: T0,
  epochs: [{ epoch: 1, openedAt: T0 }],
  ...o,
});
const REGISTER: SupportedRequest = {
  kind: "register",
  ownerKey: OWNER,
  workflowId: "w1",
  expectedEpoch: 0,
  revision: 1,
  workflowDigest: DIG,
};
const registerAnswer = () =>
  json(200, { ownerKey: OWNER, registration: registration(), created: true });
const pauseReq: SupportedRequest = {
  kind: "pause",
  ownerKey: OWNER,
  workflowId: "w1",
  registrationEpoch: 1,
  expectedRevision: 1,
};
const pauseAnswer = () =>
  json(200, { ownerKey: OWNER, registration: registration({ paused: true }), changed: true });

function setup(handler?: Handler) {
  const calls: Call[] = [];
  let next: Handler = handler ?? (async () => json(200, { ownerKey: OWNER }));
  const fetchFn = vi.fn(async (url: string, init: ClientRequestInit) => {
    calls.push({ url, init });
    return next(url, init, calls.length);
  });
  const session = createCloudWorkflowSession({ fetch: fetchFn });
  return {
    session,
    fetchFn,
    calls,
    answer: (h: Handler) => {
      next = h;
    },
  };
}
/** Configured + handshaken session; later calls answer with `answer(...)`. */
async function ready(handler?: Handler) {
  const s = setup();
  expect(s.session.configure({ origin: ORIGIN, token: TOKEN }).ok).toBe(true);
  const h = kind(await s.session.handshake(), "answer");
  expect(h.meta.installed).toBe(true);
  s.calls.length = 0;
  s.fetchFn.mockClear();
  if (handler) s.answer(handler);
  return s;
}

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("the real network is forbidden in this suite");
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("construction, import and invalidation make no request", () => {
  it("creates, configures, invalidates and disposes with zero fetch", () => {
    const { session, fetchFn } = setup();
    session.configure({ origin: ORIGIN, token: TOKEN });
    session.configure({ origin: ORIGIN, token: TOKEN });
    session.configure({ origin: OTHER, token: TOKEN_B });
    session.invalidateVisit();
    session.dispose();
    session.dispose();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("configure canonicalizes the origin and refuses an unusable origin or token without a request", () => {
    const { session, fetchFn } = setup();
    expect(session.configure({ origin: "HTTPS://Scout.TEST:443/", token: TOKEN })).toEqual({
      ok: true,
      origin: ORIGIN,
    });
    for (const [origin, token, reason] of [
      ["https://scout.test/path", TOKEN, "origin"],
      ["https://user:pw@scout.test", TOKEN, "origin"],
      ["https://scout.test?q=1", TOKEN, "origin"],
      ["ftp://scout.test", TOKEN, "origin"],
      [ORIGIN, "", "token"],
      [ORIGIN, "has space", "token"],
      [ORIGIN, "line\nbreak", "token"],
      [ORIGIN, "ünicode", "token"],
      [ORIGIN, 42, "token"],
    ] as const) {
      expect(session.configure({ origin, token } as never)).toEqual({ ok: false, reason });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("pre-dispatch refusals make zero requests", () => {
  it("handshake and execute refuse before configuration and after dispose", async () => {
    const { session, fetchFn } = setup();
    expect(kind(await session.handshake(), "refused").reason).toBe("not_configured");
    expect(kind(await session.execute(REGISTER, A), "refused").reason).toBe("not_configured");
    session.configure({ origin: ORIGIN, token: TOKEN });
    session.dispose();
    expect(kind(await session.handshake(), "refused").reason).toBe("disposed");
    expect(kind(await session.execute(REGISTER, A), "refused").reason).toBe("disposed");
    expect(session.configure({ origin: ORIGIN, token: TOKEN })).toEqual({
      ok: false,
      reason: "disposed",
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses execute without a handshake, even for an intended authority the caller made up", async () => {
    const { session, fetchFn } = setup();
    session.configure({ origin: ORIGIN, token: TOKEN });
    const r = kind(await session.execute(REGISTER, A), "refused");
    expect(r.reason).toBe("no_authority");
    expect(r.dispatched).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // DT-7C-2C (authorized capability change): ack and changes now go through this same fenced, bounded session. The
  // former "refuses ack and changes at runtime (and in the type)" entries and their two @ts-expect-error lines are
  // replaced by the positive assertions below; every other refusal of this test is kept unchanged.
  it("admits ack and changes (exact route, one fetch each); refuses unknown kinds and extra fields", async () => {
    const s = await ready();
    const bad: unknown[] = [
      { kind: "delete", ownerKey: OWNER },
      { kind: "nothing" },
      {},
      null,
      "register",
      42,
    ];
    for (const b of bad) {
      const r = kind(await s.session.execute(b as never, A), "refused");
      expect(["unsupported_kind", "invalid_request"]).toContain(r.reason);
    }
    expect(
      kind(await s.session.execute({ ...REGISTER, extra: 1 } as never, A), "refused").reason,
    ).toBe("invalid_request");
    expect(
      kind(await s.session.execute({ ...REGISTER, workflowId: "bad id!" }, A), "refused").reason,
    ).toBe("invalid_request");
    expect(
      kind(
        await s.session.execute({ kind: "changes", ownerKey: OWNER, after: 0, limit: 51 }, A),
        "refused",
      ).reason,
    ).toBe("invalid_request");
    expect(s.fetchFn).not.toHaveBeenCalled();
    const ackRequest: SupportedRequest = {
      kind: "ack",
      ownerKey: OWNER,
      occurrenceId: "o1",
      receiptVersion: 2,
    };
    const changesRequest: SupportedRequest = {
      kind: "changes",
      ownerKey: OWNER,
      after: 7,
      limit: 50,
    };
    s.answer(async () => json(200, { ownerKey: OWNER, items: [], nextAfter: 7, more: false }));
    const ch = kind(await s.session.execute(changesRequest, A), "answer");
    expect(ch.parsed).toMatchObject({ outcome: "ok", kind: "changes", nextAfter: 7, more: false });
    expect(s.calls[0].url).toBe(`${ORIGIN}${BASE}/changes?ownerKey=${OWNER}&after=7&limit=50`);
    expect(s.calls[0].init.method).toBe("GET");
    expect(s.calls[0].init.body).toBeUndefined();
    s.answer(async () =>
      json(409, {
        error: "not_terminal",
        ownerKey: OWNER,
        occurrenceId: "o1",
        state: "pending",
        receiptVersion: 1,
      }),
    );
    const ack = kind(await s.session.execute(ackRequest, A), "answer");
    expect(ack.parsed).toMatchObject({ outcome: "refused", error: "not_terminal" });
    expect(ack.meta).toMatchObject({ dispatched: true, mutating: true });
    expect(s.calls[1].url).toBe(`${ORIGIN}${BASE}/occurrences/o1/ack`);
    expect(s.calls[1].init.method).toBe("POST");
    expect(JSON.parse(s.calls[1].init.body!)).toEqual({ ownerKey: OWNER, receiptVersion: 2 });
    expect(s.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("refuses a request that is not plain data (class instance, function, NaN, cycle) with zero fetch", async () => {
    const s = await ready();
    class Evil {
      kind = "pause";
    }
    const cyclic: Record<string, unknown> = { ...pauseReq };
    cyclic.self = cyclic;
    for (const b of [
      new Evil(),
      { ...pauseReq, expectedRevision: Number.NaN },
      { ...pauseReq, f() {} },
      cyclic,
    ]) {
      expect(kind(await s.session.execute(b as never, A), "refused").reason).toMatch(
        /invalid_request|unsupported_kind/,
      );
    }
    expect(s.fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a foreign or imported authority and never retargets it to the current origin", async () => {
    const s = await ready();
    const foreignOrigin = authorityOf(OTHER, OWNER)!;
    const foreignOwner = authorityOf(ORIGIN, OWNER_B)!;
    expect(kind(await s.session.execute(REGISTER, foreignOrigin), "refused").reason).toBe(
      "foreign_origin",
    );
    expect(kind(await s.session.execute(REGISTER, foreignOwner), "refused").reason).toBe(
      "foreign_owner",
    );
    for (const junk of [
      null,
      undefined,
      {},
      { origin: ORIGIN },
      { origin: "nope", ownerKey: OWNER },
      "x",
    ]) {
      expect(kind(await s.session.execute(REGISTER, junk as never), "refused").reason).toBe(
        "invalid_authority",
      );
    }
    // an owner id typed by the caller cannot create authority: no handshake, no ownership
    const fresh = setup();
    fresh.session.configure({ origin: ORIGIN, token: TOKEN });
    expect(kind(await fresh.session.execute(REGISTER, A), "refused").reason).toBe("no_authority");
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(fresh.fetchFn).not.toHaveBeenCalled();
  });

  it("requires the request ownerKey (and a submit body's ownerKey) to match the handshake authority", async () => {
    const s = await ready();
    expect(
      kind(await s.session.execute({ ...REGISTER, ownerKey: OWNER_B }, A), "refused").reason,
    ).toBe("owner_mismatch");
    const sub = await submitRequestOf(manualBody({ ownerKey: OWNER_B }));
    expect(sub.ok).toBe(true);
    if (sub.ok)
      expect(
        kind(await s.session.execute(sub.request as SupportedRequest, A), "refused").reason,
      ).toBe("owner_mismatch");
    expect(s.fetchFn).not.toHaveBeenCalled();
  });

  it("refuses an oversized submit request before any fetch", async () => {
    const s = await ready();
    const big = manualBody();
    big.snapshot.actions[0] = { id: "a1", kind: "idea", text: { ar: "", en: "x".repeat(501) } };
    const sub = {
      kind: "submit",
      body: big,
      payloadDigest: await payloadDigestOf(big),
    } as SupportedRequest;
    expect(kind(await s.session.execute(sub, A), "refused").dispatched).toBe(false);
    const huge = {
      kind: "submit",
      body: { ...manualBody(), junk: "y".repeat(40_000) },
      payloadDigest: DIG,
    };
    expect(kind(await s.session.execute(huge as never, A), "refused").reason).toMatch(
      /too_large|invalid_request/,
    );
    expect(s.fetchFn).not.toHaveBeenCalled();
  });
});

function manualBody(o: Record<string, unknown> = {}): OccurrenceBody {
  return {
    occurrenceId: "occ-1",
    ownerKey: OWNER,
    workflowId: "w1",
    kind: "manual",
    registrationEpoch: 1,
    revision: 1,
    snapshot: {
      name: { ar: "سير", en: "Flow" },
      trigger: { kind: "manual" },
      actions: [{ id: "a1", kind: "idea", text: { ar: "", en: "Idea {date}" } }],
    },
    plannerContext: null,
    input: {
      title: { ar: "", en: "" },
      summary: { ar: "", en: "" },
      slug: "",
      lang: "en",
      day: "2026-10-17",
    },
    executionAt: T0,
    ...o,
  } as OccurrenceBody;
}

describe("handshake and exact HTTP options", () => {
  it("one GET to the fixed authority path with the bearer header and the pinned fetch options", async () => {
    const s = setup();
    s.session.configure({ origin: "HTTPS://Scout.TEST", token: TOKEN });
    const r = kind(await s.session.handshake(), "answer");
    expect(s.calls).toHaveLength(1);
    const { url, init } = s.calls[0];
    expect(url).toBe(`${ORIGIN}${BASE}/authority`);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}` });
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("manual");
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(Object.keys(init).sort()).toEqual([
      "cache",
      "credentials",
      "headers",
      "method",
      "redirect",
      "signal",
    ]);
    // the complete parser result, the originating authority, nonsecret dispatch metadata
    expect(r.parsed).toEqual({ outcome: "ok", kind: "authority", authority: A });
    expect(r.binding).toEqual({
      request: { kind: "authority" },
      method: "GET",
      path: `${BASE}/authority`,
    });
    expect(r.meta).toEqual({ dispatched: true, mutating: false, status: 200, installed: true });
  });

  it("only a valid handshake answer establishes the ownerKey, and only the one it returned", async () => {
    const s = setup(async () => json(200, { ownerKey: OWNER_B }));
    s.session.configure({ origin: ORIGIN, token: TOKEN });
    // not yet: nothing the caller says counts
    expect(kind(await s.session.execute(REGISTER, A), "refused").reason).toBe("no_authority");
    const h = kind(await s.session.handshake(), "answer");
    expect(h.parsed).toMatchObject({
      outcome: "ok",
      kind: "authority",
      authority: { origin: ORIGIN, ownerKey: OWNER_B },
    });
    // the returned authority works; the one the caller guessed does not
    s.calls.length = 0;
    s.answer(async () => json(200, { unparsable: true }));
    const sent = kind(
      await s.session.execute({ ...REGISTER, ownerKey: OWNER_B }, authorityOf(ORIGIN, OWNER_B)!),
      "uncertain",
    );
    expect(sent.meta.dispatched).toBe(true);
    expect(s.calls).toHaveLength(1);
    expect(kind(await s.session.execute(REGISTER, A), "refused").reason).toBe("foreign_owner");
  });

  it("a refused, malformed or mixed handshake answer establishes nothing", async () => {
    for (const reply of [
      () => json(503, { error: "not_configured", detail: "workflow-store" }),
      () => json(200, { ownerKey: "not-an-owner" }),
      () => json(200, { ownerKey: OWNER, error: "bad_request" }),
      () => new Response("not json", { status: 200 }),
    ]) {
      const s = setup(async () => reply());
      s.session.configure({ origin: ORIGIN, token: TOKEN });
      const r = await s.session.handshake();
      expect(["answer", "uncertain"]).toContain(r.kind);
      if (r.kind === "answer") expect(r.meta.installed).toBe(false);
      s.calls.length = 0;
      expect(kind(await s.session.execute(REGISTER, A), "refused").reason).toBe("no_authority");
      expect(s.calls).toHaveLength(0);
    }
  });
});

describe("exact method, path and body of every supported request", () => {
  const O = "occ-1";
  const SUB = (async () => {
    const r = await submitRequestOf(manualBody());
    if (!r.ok) throw new Error("submit");
    return r.request as SupportedRequest;
  })();
  const table = async (): Promise<
    [SupportedRequest, "GET" | "POST", string, string | undefined][]
  > => {
    const sub = await SUB;
    const submit = sub as Extract<SupportedRequest, { kind: "submit" }>;
    const subBody = JSON.stringify({ body: submit.body, payloadDigest: submit.payloadDigest });
    return [
      [{ kind: "authority" }, "GET", `${BASE}/authority`, undefined],
      [
        REGISTER,
        "POST",
        `${BASE}/registrations`,
        `{"ownerKey":"${OWNER}","workflowId":"w1","expectedEpoch":0,"revision":1,"workflowDigest":"${DIG}"}`,
      ],
      [
        {
          kind: "update",
          ownerKey: OWNER,
          workflowId: "w1",
          registrationEpoch: 1,
          expectedRevision: 1,
          revision: 2,
          workflowDigest: DIG,
        },
        "POST",
        `${BASE}/registrations/w1`,
        `{"ownerKey":"${OWNER}","registrationEpoch":1,"expectedRevision":1,"revision":2,"workflowDigest":"${DIG}"}`,
      ],
      ...(["pause", "resume", "unregister"] as const).map(
        (k) =>
          [
            { ...pauseReq, kind: k },
            "POST",
            `${BASE}/registrations/w1/${k}`,
            `{"ownerKey":"${OWNER}","registrationEpoch":1,"expectedRevision":1}`,
          ] as [SupportedRequest, "POST", string, string],
      ),
      [sub, "POST", `${BASE}/occurrences`, subBody],
      [
        { kind: "status", ownerKey: OWNER, occurrenceId: O },
        "GET",
        `${BASE}/occurrences/${O}?ownerKey=${OWNER}`,
        undefined,
      ],
      [
        { kind: "run", ownerKey: OWNER, occurrenceId: O },
        "POST",
        `${BASE}/occurrences/${O}/run`,
        `{"ownerKey":"${OWNER}"}`,
      ],
      [
        { kind: "cancel", ownerKey: OWNER, occurrenceId: O },
        "POST",
        `${BASE}/occurrences/${O}/cancel`,
        `{"ownerKey":"${OWNER}"}`,
      ],
    ];
  };

  it("sends exactly the descriptor on the captured origin, one fetch each, with only the allowed options", async () => {
    for (const [req, method, path, body] of await table()) {
      const s = await ready(async () => json(200, { unparsable: true }));
      const r = await s.session.execute(req, A);
      expect(r.kind).toBe("uncertain"); // the stub answer is not a valid answer of any kind: reported, never accepted
      expect(s.calls).toHaveLength(1);
      const { url, init } = s.calls[0];
      expect(url).toBe(`${ORIGIN}${path}`);
      expect(init.method).toBe(method);
      expect(init.body).toBe(body);
      expect(init.headers).toEqual(
        method === "POST"
          ? { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }
          : { Authorization: `Bearer ${TOKEN}` },
      );
      expect([init.credentials, init.cache, init.redirect]).toEqual(["omit", "no-store", "manual"]);
      if (body !== undefined)
        expect(enc.encode(body).length).toBeLessThanOrEqual(REQUEST_BYTES_MAX);
    }
  });

  it("returns the complete parser result, request binding and originating authority for an accepted answer", async () => {
    const s = await ready(async () => registerAnswer());
    const r = kind(await s.session.execute(REGISTER, A), "answer");
    expect(r.parsed.outcome).toBe("ok");
    if (r.parsed.outcome === "ok" && r.parsed.kind === "register") {
      expect(r.parsed.authority).toEqual(A);
      expect(r.parsed.created).toBe(true);
      expect(r.parsed.registration.workflowId).toBe("w1");
    }
    expect(r.binding).toMatchObject({ method: "POST", path: `${BASE}/registrations` });
    expect(r.binding.request).toEqual(REGISTER);
    expect(Object.isFrozen(r.binding.request)).toBe(true);
    expect(r.meta).toMatchObject({ dispatched: true, mutating: true, status: 200 });
    expect(r.meta.installed).toBeUndefined();
    // the same parser answer a direct parseAnswer gives (the client adds nothing to it)
    expect(r.parsed).toEqual(
      await parseAnswer(
        REGISTER,
        { status: 200, body: { ownerKey: OWNER, registration: registration(), created: true } },
        { origin: ORIGIN },
      ),
    );
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe("redirects and unexpected destinations", () => {
  const cases: [string, () => ClientResponse][] = [
    [
      "302 with a Location",
      () => new Response(null, { status: 302, headers: { location: "https://evil.test/" } }),
    ],
    [
      "307",
      () =>
        new Response(null, { status: 307, headers: { location: `${ORIGIN}${BASE}/authority` } }),
    ],
    ["opaque redirect", () => ({ status: 0, type: "opaqueredirect", body: null })],
    [
      "redirected flag",
      () => ({ status: 200, redirected: true, url: `${ORIGIN}${BASE}/registrations`, body: null }),
    ],
    [
      "foreign final URL",
      () => registerResponseLike("https://evil.test/social/workflows/registrations"),
    ],
    ["same host other path", () => registerResponseLike(`${ORIGIN}/elsewhere`)],
  ];
  function registerResponseLike(url?: string): ClientResponse {
    const r = json(200, { ownerKey: OWNER, registration: registration(), created: true });
    return { status: r.status, body: r.body, ...(url === undefined ? {} : { url }) };
  }

  it.each(cases)(
    "a POST that meets %s is uncertain, is never followed and is never retried",
    async (_n, make) => {
      const s = await ready(async () => make());
      const r = kind(await s.session.execute(REGISTER, A), "uncertain");
      expect(["redirect", "unexpected_url"]).toContain(r.category);
      expect(r.meta).toMatchObject({ dispatched: true, mutating: true });
      expect(r.authority).toEqual(A);
      expect(r.binding.request).toEqual(REGISTER);
      expect(s.fetchFn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(r)).not.toContain(TOKEN);
    },
  );

  it("accepts an empty or the exact final URL", async () => {
    const exact = await ready(async () => registerResponseLike(`${ORIGIN}${BASE}/registrations`));
    expect(kind(await exact.session.execute(REGISTER, A), "answer").parsed.outcome).toBe("ok");
    const empty = await ready(async () => registerResponseLike(""));
    expect(kind(await empty.session.execute(REGISTER, A), "answer").parsed.outcome).toBe("ok");
  });
});

describe("A -> B -> A: origin, token and visit sequences never revive old work", () => {
  type Mut = (s: ReturnType<typeof setup>["session"]) => void;
  const flips: [string, Mut][] = [
    [
      "origin",
      (s) => {
        s.configure({ origin: OTHER, token: TOKEN });
        s.configure({ origin: ORIGIN, token: TOKEN });
      },
    ],
    [
      "token",
      (s) => {
        s.configure({ origin: ORIGIN, token: TOKEN_B });
        s.configure({ origin: ORIGIN, token: TOKEN });
      },
    ],
    [
      "visit",
      (s) => {
        s.invalidateVisit();
        s.invalidateVisit();
      },
    ],
    ["single visit invalidation", (s) => s.invalidateVisit()],
    ["dispose", (s) => s.dispose()],
  ];

  it.each(flips)("%s: a held handshake completes stale and installs nothing", async (_n, flip) => {
    const held = deferred<ClientResponse>();
    const s = setup(() => held.promise);
    s.session.configure({ origin: ORIGIN, token: TOKEN });
    const p = s.session.handshake();
    await tick();
    expect(s.calls).toHaveLength(1);
    flip(s.session);
    held.resolve(json(200, { ownerKey: OWNER }));
    const r = kind(await p, "stale");
    expect(r.meta.dispatched).toBe(true);
    expect(r.authority).toBeNull();
    s.calls.length = 0;
    expect(["no_authority", "disposed"]).toContain(
      kind(await s.session.execute(REGISTER, A), "refused").reason,
    );
    expect(s.calls).toHaveLength(0);
  });

  it.each(flips)(
    "%s: a held POST completes stale, stays dispatched/mutating and is not retried",
    async (_n, flip) => {
      const s = await ready();
      const held = deferred<ClientResponse>();
      s.answer(() => held.promise);
      const p = s.session.execute(REGISTER, A);
      await tick();
      expect(s.calls).toHaveLength(1);
      flip(s.session);
      held.resolve(registerAnswer());
      const r = kind(await p, "stale");
      expect(r.dispatched).toBe(true);
      expect(r.meta).toMatchObject({ dispatched: true, mutating: true });
      expect(r.authority).toEqual(A); // the originating authority survives for the durable caller
      expect(r.binding?.request).toEqual(REGISTER);
      expect(s.fetchFn).toHaveBeenCalledTimes(1);
    },
  );

  it("an established authority does not survive any actual connection, token, visit or dispose change", async () => {
    for (const [name, flip] of flips) {
      const s = await ready();
      flip(s.session);
      const r = kind(await s.session.execute(REGISTER, A), "refused");
      expect(["no_authority", "disposed"], name).toContain(r.reason);
      expect(s.fetchFn).not.toHaveBeenCalled();
    }
  });

  it("an identical configure is a no-op: it keeps authority and does not stale the action", async () => {
    const s = await ready(async () => registerAnswer());
    s.session.configure({ origin: ORIGIN, token: TOKEN });
    s.session.configure({ origin: "https://SCOUT.test:443", token: TOKEN });
    expect(kind(await s.session.execute(REGISTER, A), "answer").parsed.outcome).toBe("ok");
  });

  it("a held response body is stale after the change, the reader is cancelled and reading stops", async () => {
    for (const [name, flip] of flips) {
      const s = await ready();
      const st = { pulls: 0, cancelled: false };
      s.answer(
        async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                c.enqueue(enc.encode('{"ownerKey":'));
              },
              pull() {
                st.pulls++;
                return new Promise(() => {});
              },
              cancel() {
                st.cancelled = true;
              },
            }),
            { status: 200 },
          ),
      );
      const p = s.session.execute(REGISTER, A);
      await tick(30);
      flip(s.session);
      const r = kind(await p, "stale");
      expect(r.dispatched, name).toBe(true);
      await tick();
      expect(st.cancelled, name).toBe(true);
    }
  });

  it("a chunk delivered after the change is not consumed (fence rechecked after the read)", async () => {
    const s = await ready();
    const gate = deferred<void>();
    const st = { cancelled: false };
    s.answer(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            async pull(c) {
              await gate.promise;
              c.enqueue(
                enc.encode(
                  JSON.stringify({ ownerKey: OWNER, registration: registration(), created: true }),
                ),
              );
              c.close();
            },
            cancel() {
              st.cancelled = true;
            },
          }),
          { status: 200 },
        ),
    );
    const p = s.session.execute(REGISTER, A);
    await tick(30);
    s.session.invalidateVisit();
    gate.resolve();
    expect(kind(await p, "stale").dispatched).toBe(true);
  });
});

describe("overlapping actions: the latest action wins and nothing releases the wrong state", () => {
  it("a superseding handshake makes the earlier one stale; only the latest installs authority", async () => {
    const first = deferred<ClientResponse>();
    const second = deferred<ClientResponse>();
    let n = 0;
    const s = setup(() => (++n === 1 ? first.promise : second.promise));
    s.session.configure({ origin: ORIGIN, token: TOKEN });
    const p1 = s.session.handshake();
    await tick();
    const p2 = s.session.handshake();
    await tick();
    second.resolve(json(200, { ownerKey: OWNER_B }));
    const r2 = kind(await p2, "answer");
    expect(r2.meta.installed).toBe(true);
    // the older reply now arrives late (success or failure): it can neither install nor clear anything
    first.resolve(json(200, { ownerKey: OWNER }));
    expect(kind(await p1, "stale").authority).toBeNull();
    s.calls.length = 0;
    s.answer(async () => json(200, { unparsable: true }));
    const r = await s.session.execute(
      { ...REGISTER, ownerKey: OWNER_B },
      authorityOf(ORIGIN, OWNER_B)!,
    );
    expect(r.kind).toBe("uncertain");
    expect(s.calls).toHaveLength(1);
  });

  it("a late failure of an older action cannot clear or fail the newer one", async () => {
    const s = await ready();
    const old = deferred<ClientResponse>();
    s.answer(() => old.promise);
    const p1 = s.session.execute(REGISTER, A);
    await tick();
    s.answer(async () => pauseAnswer());
    const p2 = s.session.execute(pauseReq, A);
    old.reject(new Error(`network down ${TOKEN}`));
    const r1 = kind(await p1, "stale");
    const r2 = kind(await p2, "answer");
    expect(r1.dispatched).toBe(true);
    expect(r2.parsed.outcome).toBe("ok");
    expect(JSON.stringify([r1, r2])).not.toContain(TOKEN);
    // authority is still usable afterwards
    s.answer(async () => registerAnswer());
    expect(kind(await s.session.execute(REGISTER, A), "answer").parsed.outcome).toBe("ok");
  });

  it("a newer action, a change or dispose aborts the older request's signal and releases it without waiting for the held fetch", async () => {
    const s = await ready();
    s.answer(() => new Promise(() => {})); // never answers
    const older = s.session.execute(REGISTER, A);
    await tick();
    const signal = s.calls[0].init.signal;
    expect(signal.aborted).toBe(false);
    s.answer(async () => pauseAnswer());
    expect(kind(await s.session.execute(pauseReq, A), "answer").parsed.outcome).toBe("ok");
    expect(signal.aborted).toBe(true);
    expect(kind(await older, "stale").dispatched).toBe(true);
    for (const flip of [
      (x: typeof s.session) => x.invalidateVisit(),
      (x: typeof s.session) => x.dispose(),
      (x: typeof s.session) => x.configure({ origin: OTHER, token: TOKEN }),
    ]) {
      const t = await ready();
      t.answer(() => new Promise(() => {}));
      const p = t.session.execute(REGISTER, A);
      await tick();
      flip(t.session);
      expect(t.calls[0].init.signal.aborted).toBe(true);
      expect(kind(await p, "stale").dispatched).toBe(true);
    }
  });

  it("a refused call does not supersede the action in flight", async () => {
    const s = await ready();
    const held = deferred<ClientResponse>();
    s.answer(() => held.promise);
    const p = s.session.execute(REGISTER, A);
    await tick();
    expect(kind(await s.session.execute({ kind: "ack" } as never, A), "refused").dispatched).toBe(
      false,
    );
    held.resolve(registerAnswer());
    expect(kind(await p, "answer").parsed.outcome).toBe("ok");
  });
});

describe("caller objects are captured before the first await", () => {
  it("editing the request while the fetch is held cannot change the body, the binding or the verdict", async () => {
    const s = await ready();
    const held = deferred<ClientResponse>();
    s.answer(() => held.promise);
    const req = { ...REGISTER } as Extract<SupportedRequest, { kind: "register" }>;
    const intended = { origin: A.origin, ownerKey: A.ownerKey };
    const p = s.session.execute(req, intended);
    await tick();
    const sent = s.calls[0].init.body;
    req.workflowDigest = "f".repeat(64);
    req.ownerKey = OWNER_B;
    req.workflowId = "w9";
    intended.ownerKey = OWNER_B;
    intended.origin = OTHER;
    held.resolve(registerAnswer());
    const r = kind(await p, "answer");
    expect(r.parsed.outcome).toBe("ok");
    expect(sent).toBe(
      `{"ownerKey":"${OWNER}","workflowId":"w1","expectedEpoch":0,"revision":1,"workflowDigest":"${DIG}"}`,
    );
    expect(r.binding.request).toEqual(REGISTER);
    expect(r.parsed).toMatchObject({ authority: A });
    expect(Object.isFrozen(req)).toBe(false); // the caller's object is neither frozen nor retained
  });

  it("an optional field explicitly set to undefined still works and is not sent", async () => {
    const s = await ready(async () => json(200, { unparsable: true }));
    const req = {
      kind: "status",
      ownerKey: OWNER,
      occurrenceId: "occ-1",
      expect: undefined,
    } as SupportedRequest;
    await s.session.execute(req, A);
    const req2 = {
      kind: "status",
      ownerKey: OWNER,
      occurrenceId: "occ-2",
      expect: {
        body: undefined,
        payloadDigest: undefined,
        receiptVersion: undefined,
        outputIds: undefined,
      },
    } as SupportedRequest;
    await s.session.execute(req2, A);
    expect(s.calls.map((c) => c.url)).toEqual([
      `${ORIGIN}${BASE}/occurrences/occ-1?ownerKey=${OWNER}`,
      `${ORIGIN}${BASE}/occurrences/occ-2?ownerKey=${OWNER}`,
    ]);
  });

  it("a submit body edited during the hold cannot alter the verified binding", async () => {
    const s = await ready();
    const sub = await submitRequestOf(manualBody());
    if (!sub.ok) throw new Error("submit");
    const held = deferred<ClientResponse>();
    s.answer(() => held.promise);
    const request = sub.request as Extract<SupportedRequest, { kind: "submit" }>;
    const p = s.session.execute(request, A);
    await tick();
    const sent = s.calls[0].init.body!;
    (request.body.snapshot.actions[0] as { id: string }).id = "zzz";
    request.body.ownerKey = OWNER_B;
    held.resolve(json(200, { unparsable: true }));
    const r = kind(await p, "uncertain");
    expect(JSON.parse(sent).body.snapshot.actions[0].id).toBe("a1");
    expect((r.binding.request as { body: OccurrenceBody }).body.snapshot.actions[0]).toMatchObject({
      id: "a1",
    });
    expect((r.binding.request as { body: OccurrenceBody }).body.ownerKey).toBe(OWNER);
  });
});

describe("bounded body, deadline and abort", () => {
  const bytes = (n: number) => new Uint8Array(n).fill(0x20);
  function chunked(total: number, size: number, st: { pulls: number; cancelled: boolean }) {
    let sent = 0;
    return new ReadableStream<Uint8Array>({
      pull(c) {
        st.pulls++;
        const n = Math.min(size, total - sent);
        if (n <= 0) return c.close();
        sent += n;
        c.enqueue(bytes(n));
      },
      cancel() {
        st.cancelled = true;
      },
    });
  }

  it("RESPONSE_BYTES_MAX is 1 MiB and DEADLINE_MS is 15 seconds", () => {
    expect(RESPONSE_BYTES_MAX).toBe(1_048_576);
    expect(DEADLINE_MS).toBe(15_000);
  });

  it("an endless stream is cut at the cap (Content-Length is not proof), the reader is cancelled", async () => {
    const st = { pulls: 0, cancelled: false };
    const s = await ready(
      async () =>
        new Response(chunked(Number.MAX_SAFE_INTEGER, 65_536, st), {
          status: 200,
          headers: { "content-length": "5" },
        }),
    );
    const r = kind(await s.session.execute(REGISTER, A), "uncertain");
    expect(r.category).toBe("oversized");
    expect(r.meta).toMatchObject({ dispatched: true, mutating: true });
    await tick();
    expect(st.cancelled).toBe(true);
    expect(st.pulls).toBeLessThanOrEqual(RESPONSE_BYTES_MAX / 65_536 + 4);
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("exactly the cap is read (then fails as malformed JSON), one byte over is oversized, a big Content-Length is ignored", async () => {
    const st = { pulls: 0, cancelled: false };
    const atCap = await ready(
      async () => new Response(chunked(RESPONSE_BYTES_MAX, 65_536, st), { status: 200 }),
    );
    expect(kind(await atCap.session.execute(REGISTER, A), "uncertain").category).toBe(
      "malformed_json",
    );
    const over = await ready(
      async () =>
        new Response(chunked(RESPONSE_BYTES_MAX + 1, 65_536, { pulls: 0, cancelled: false }), {
          status: 200,
        }),
    );
    expect(kind(await over.session.execute(REGISTER, A), "uncertain").category).toBe("oversized");
    const lie = await ready(
      async () =>
        new Response(
          JSON.stringify({ ownerKey: OWNER, registration: registration(), created: true }),
          {
            status: 200,
            headers: { "content-length": String(RESPONSE_BYTES_MAX * 10) },
          },
        ),
    );
    expect(kind(await lie.session.execute(REGISTER, A), "answer").parsed.outcome).toBe("ok");
  });

  it("a single oversized chunk is refused without being decoded", async () => {
    const s = await ready(
      async () => new Response(bytes(RESPONSE_BYTES_MAX + 10), { status: 200 }),
    );
    expect(kind(await s.session.execute(REGISTER, A), "uncertain").category).toBe("oversized");
  });

  it("a fetch that never answers times out after 15 s as uncertain and aborts the signal", async () => {
    vi.useFakeTimers();
    const s = await ready(() => new Promise(() => {}));
    const p = s.session.execute(REGISTER, A);
    await vi.advanceTimersByTimeAsync(DEADLINE_MS - 1);
    expect(s.calls[0].init.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = kind(await p, "uncertain");
    expect(r.category).toBe("timeout");
    expect(r.meta).toMatchObject({ dispatched: true, mutating: true });
    expect(s.calls[0].init.signal.aborted).toBe(true);
    expect(s.fetchFn).toHaveBeenCalledTimes(1); // never retried
  });

  it("the 15 s deadline spans the body: a stalled stream times out and its reader is cancelled", async () => {
    vi.useFakeTimers();
    const st = { cancelled: false };
    const s = await ready(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(enc.encode('{"owner'));
            },
            pull: () => new Promise(() => {}),
            cancel() {
              st.cancelled = true;
            },
          }),
          { status: 200 },
        ),
    );
    const p = s.session.execute(pauseReq, A);
    await vi.advanceTimersByTimeAsync(5_000); // time spent before the body does not reset the clock
    await vi.advanceTimersByTimeAsync(DEADLINE_MS);
    const r = kind(await p, "uncertain");
    expect(r.category).toBe("timeout");
    await vi.advanceTimersByTimeAsync(1);
    expect(st.cancelled).toBe(true);
  });

  it("no timer is left behind after success or failure", async () => {
    vi.useFakeTimers();
    const s = await ready(async () => registerAnswer());
    await s.session.execute(REGISTER, A);
    s.answer(async () => {
      throw new Error("down");
    });
    await s.session.execute(REGISTER, A);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a fetch that throws or rejects is reported by category only, never by its message", async () => {
    for (const err of [
      new Error(`socket reset ${TOKEN}`),
      Object.assign(new Error(`x ${TOKEN}`), { name: "AbortError" }),
      "plain string " + TOKEN,
    ]) {
      const s = await ready(async () => {
        throw err;
      });
      const r = kind(await s.session.execute(REGISTER, A), "uncertain");
      expect(["network", "aborted"]).toContain(r.category);
      expect(JSON.stringify(r)).not.toContain(TOKEN);
    }
    const sync = await ready();
    sync.fetchFn.mockImplementationOnce(() => {
      throw new Error(`sync ${TOKEN}`);
    });
    const r = kind(await sync.session.execute(REGISTER, A), "uncertain");
    expect(r.category).toBe("network");
    expect(r.meta.dispatched).toBe(true);
  });
});

describe("honest outcomes: typed answer, typed refusal, uncertainty", () => {
  it("malformed JSON, invalid UTF-8, empty and non-object bodies are uncertain", async () => {
    for (const body of [
      "{",
      "",
      "null",
      "[]",
      "<html>502</html>",
      new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
    ]) {
      const s = await ready(async () => new Response(body, { status: 200 }));
      const r = kind(await s.session.execute(REGISTER, A), "uncertain");
      expect(["malformed_json", "invalid_answer"]).toContain(r.category);
      expect(r.meta.dispatched).toBe(true);
    }
    const nobody = await ready(async () => ({ status: 200, body: null }));
    expect(kind(await nobody.session.execute(REGISTER, A), "uncertain").category).toMatch(
      /malformed_json|invalid_answer/,
    );
  });

  it("a 2xx alone is never success: mixed, unknown-key, foreign-owner and wrong-status answers are uncertain", async () => {
    const good = { ownerKey: OWNER, registration: registration(), created: true };
    const replies: [number, unknown][] = [
      [200, { ...good, error: "conflict" }],
      [200, { ...good, extra: 1 }],
      [200, { ...good, ownerKey: OWNER_B }],
      [201, good],
      [200, { ...good, registration: registration({ workflowId: "other" }) }],
      [500, good],
      [200, { error: "conflict", ownerKey: OWNER, registration: null }],
    ];
    for (const [status, body] of replies) {
      const s = await ready(async () => json(status, body));
      const r = kind(await s.session.execute(REGISTER, A), "uncertain");
      expect(r.category).toBe("invalid_answer");
      expect(r.meta.invalid).toBeDefined();
      expect(r.meta.status).toBe(status);
    }
  });

  it("a typed Parsed.refused is returned unchanged with dispatch metadata and no safety claim", async () => {
    const wire = {
      error: "conflict",
      ownerKey: OWNER,
      registration: registration({ revision: 7, workflowDigest: "d".repeat(64) }),
    };
    const req = { ...REGISTER, expectedEpoch: 0 } as SupportedRequest;
    const s = await ready(async () => json(409, wire));
    const r = kind(await s.session.execute(req, A), "answer");
    const direct = await parseAnswer(req, { status: 409, body: wire }, { origin: ORIGIN });
    expect(direct.outcome).toBe("refused");
    expect(r.parsed).toEqual(direct);
    expect(r.meta).toMatchObject({ dispatched: true, mutating: true, status: 409 });
    expect(JSON.stringify(r)).not.toMatch(/retry|safe|neverApplied|noEffect/i);
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });

  it("receipt_unavailable after a POST is uncertain (typed refusal kept); on a GET it is the typed answer", async () => {
    const post = await ready(async () => json(503, { error: "receipt_unavailable" }));
    const u = kind(await post.session.execute(REGISTER, A), "uncertain");
    expect(u.category).toBe("receipt_unavailable");
    expect(u.parsed).toMatchObject({
      outcome: "refused",
      error: "receipt_unavailable",
      status: 503,
    });
    expect(u.meta).toMatchObject({ dispatched: true, mutating: true });
    const get = await ready(async () => json(503, { error: "receipt_unavailable" }));
    const a = kind(
      await get.session.execute({ kind: "status", ownerKey: OWNER, occurrenceId: "occ-1" }, A),
      "answer",
    );
    expect(a.parsed).toMatchObject({ outcome: "refused", error: "receipt_unavailable" });
    expect(a.meta.mutating).toBe(false);
  });
});

describe("secrecy and idempotence", () => {
  it("no result, thrown error or log ever carries the bearer token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const out: unknown[] = [];
    const s = setup(async () => {
      throw new Error(`Authorization: Bearer ${TOKEN}`);
    });
    s.session.configure({ origin: ORIGIN, token: TOKEN });
    out.push(await s.session.handshake());
    s.answer(async () => json(200, { ownerKey: OWNER }));
    out.push(await s.session.handshake());
    s.answer(async () => new Response(`echo ${TOKEN}`, { status: 200 }));
    out.push(await s.session.execute(REGISTER, A));
    s.answer(async () =>
      json(409, { error: "conflict", ownerKey: OWNER, registration: null, echo: TOKEN }),
    );
    out.push(await s.session.execute({ ...REGISTER, expectedEpoch: 1 }, A));
    s.answer(async () =>
      json(200, { ownerKey: OWNER, registration: registration(), created: true, token: TOKEN }),
    );
    out.push(await s.session.execute(REGISTER, A));
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    for (const sp of spies) expect(JSON.stringify(sp.mock.calls)).not.toContain(TOKEN);
  });

  it("makes exactly one request per action: no retry, no replay, no implicit handshake, no fallback host", async () => {
    const s = await ready(async () => {
      throw new Error("down");
    });
    for (let i = 0; i < 3; i++) await s.session.execute(REGISTER, A);
    expect(s.fetchFn).toHaveBeenCalledTimes(3); // one per explicit caller action, never more
    expect(new Set(s.calls.map((c) => new URL(c.url).origin))).toEqual(new Set([ORIGIN]));
    expect(s.calls.every((c) => !c.url.endsWith("/authority"))).toBe(true);
  });

  it("the global fetch is never used", async () => {
    const globalFetch = vi.fn(() => {
      throw new Error("global fetch used");
    });
    vi.stubGlobal("fetch", globalFetch);
    const s = await ready(async () => registerAnswer());
    await s.session.execute(REGISTER, A);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});

// ⚙️ DT-7C-2B-1-R1 repairs (7C2B1-2/3/4). Reentrant request getters model an accepted-but-hostile caller shape; the
// pinned protocol's detachRequest evaluates enumerable accessors, so the session must fence BEFORE it runs them.
function withGetter(base: SupportedRequest, field: string, onRead: () => void): SupportedRequest {
  const req: Record<string, unknown> = { ...base };
  const value = req[field];
  Object.defineProperty(req, field, {
    enumerable: true,
    configurable: true,
    get() {
      onRead();
      return value;
    },
  });
  return req as unknown as SupportedRequest;
}

describe("the session identity is captured before caller data is evaluated (7C2B1-2)", () => {
  type S = Awaited<ReturnType<typeof ready>>;
  it.each<[string, (s: S) => void]>([
    ["origin switch", (s) => void s.session.configure({ origin: OTHER, token: TOKEN_B })],
    ["token change", (s) => void s.session.configure({ origin: ORIGIN, token: TOKEN_B })],
    [
      "origin A -> B -> A",
      (s) => {
        s.session.configure({ origin: OTHER, token: TOKEN_B });
        s.session.configure({ origin: ORIGIN, token: TOKEN });
      },
    ],
    ["visit invalidation", (s) => s.session.invalidateVisit()],
  ])(
    "a getter doing %s during capture dispatches nothing and resolves refused",
    async (_n, flip) => {
      const s = await ready(async () => registerAnswer());
      const out = await s.session.execute(
        withGetter(REGISTER, "workflowId", () => flip(s)),
        A,
      );
      expect(kind(out, "refused").dispatched).toBe(false);
      expect(s.fetchFn).not.toHaveBeenCalled();
    },
  );

  it("a getter disposing the session resolves refused (never a raw TypeError) with zero fetch", async () => {
    const s = await ready(async () => registerAnswer());
    const out = await s.session
      .execute(
        withGetter(REGISTER, "workflowId", () => s.session.dispose()),
        A,
      )
      .then(
        (v) => ({ ok: true as const, v }),
        (e: unknown) => ({ ok: false as const, e }),
      );
    expect(out.ok).toBe(true);
    if (out.ok) expect(kind(out.v, "refused").reason).toBe("disposed");
    expect(s.fetchFn).not.toHaveBeenCalled();
  });

  it("after an origin switch in a getter the old Authority is never retargeted to the new connection", async () => {
    const s = await ready(async () => registerAnswer());
    const out = await s.session.execute(
      withGetter(REGISTER, "workflowId", () => {
        s.session.configure({ origin: OTHER, token: TOKEN_B });
      }),
      A,
    );
    expect(out.kind).toBe("refused");
    expect(kind(await s.session.execute(REGISTER, A), "refused").reason).toBe("no_authority");
    expect(s.fetchFn).not.toHaveBeenCalled();
  });

  it("benign controls: a harmless getter is read once and dispatches; an identical configure is a no-op", async () => {
    const s = await ready(async () => registerAnswer());
    let reads = 0;
    const out = await s.session.execute(
      withGetter(REGISTER, "workflowId", () => {
        reads++;
      }),
      A,
    );
    expect(kind(out, "answer").parsed.outcome).toBe("ok");
    expect(reads).toBe(1);
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
    const same = await s.session.execute(
      withGetter(REGISTER, "workflowId", () => {
        s.session.configure({ origin: ORIGIN, token: TOKEN });
      }),
      A,
    );
    expect(kind(same, "answer").parsed.outcome).toBe("ok");
    expect(s.fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a getter that throws is a refusal, not a rejection; after a dispose it is still resolved", async () => {
    const s = await ready(async () => registerAnswer());
    const out = await s.session.execute(
      withGetter(REGISTER, "workflowId", () => {
        throw new Error("boom");
      }),
      A,
    );
    expect(kind(out, "refused").reason).toBe("invalid_request");
    const t = await ready(async () => registerAnswer());
    const out2 = await t.session.execute(
      withGetter(REGISTER, "workflowId", () => {
        t.session.dispose();
        throw new Error("boom");
      }),
      A,
    );
    expect(kind(out2, "refused").reason).toBe("disposed");
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it("a newer action started during capture is never aborted or overwritten by the older call finishing", async () => {
    const s = await ready();
    const held = deferred<ClientResponse>();
    s.answer(() => held.promise);
    let newer!: Promise<ExecuteResult>;
    const older = await s.session.execute(
      withGetter(REGISTER, "workflowId", () => {
        newer = s.session.execute(pauseReq, A);
      }),
      A,
    );
    expect(kind(older, "refused").dispatched).toBe(false);
    await tick();
    expect(s.fetchFn).toHaveBeenCalledTimes(1); // only the newer action
    expect(s.calls[0].url).toBe(`${ORIGIN}${BASE}/registrations/w1/pause`);
    expect(s.calls[0].init.signal.aborted).toBe(false);
    held.resolve(pauseAnswer());
    expect(kind(await newer, "answer").parsed.outcome).toBe("ok");
  });

  it("a refused call made during capture does not supersede the capturing call", async () => {
    const s = await ready(async () => registerAnswer());
    let inner: ExecuteResult | undefined;
    const out = await s.session.execute(
      withGetter(REGISTER, "workflowId", () => {
        void s.session.execute({ kind: "ack" } as never, A).then((r) => (inner = r));
      }),
      A,
    );
    expect(kind(out, "answer").parsed.outcome).toBe("ok");
    await tick();
    expect(kind(inner!, "refused").dispatched).toBe(false);
  });

  it("an authority getter changing the session while the claim is read is refused with zero fetch", async () => {
    const s = await ready(async () => registerAnswer());
    const claim: Record<string, unknown> = { ownerKey: OWNER };
    Object.defineProperty(claim, "origin", {
      enumerable: true,
      get() {
        s.session.configure({ origin: OTHER, token: TOKEN_B });
        return ORIGIN;
      },
    });
    const out = await s.session.execute(REGISTER, claim as unknown as Authority);
    expect(out.kind).toBe("refused");
    expect(s.fetchFn).not.toHaveBeenCalled();
  });
});

describe("the final bounded read completion is fenced (7C2B1-3)", () => {
  /** A real stream whose reader reports completion, then runs `after` a few microtasks later (before run resumes). */
  function completing(text: string, after: () => void): ReadableStream<Uint8Array> {
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(text));
        c.close();
      },
    });
    const reader = body.getReader();
    const schedule = (n: number) => {
      if (n === 0) after();
      else queueMicrotask(() => schedule(n - 1));
    };
    Object.defineProperty(body, "getReader", {
      value: () => ({
        read: () =>
          reader.read().then((r) => {
            if (r.done) schedule(3);
            return r;
          }),
        cancel: () => reader.cancel(),
      }),
    });
    return body;
  }

  it("a visit invalidated between the last read and the continuation is stale (malformed bytes never decoded)", async () => {
    const s = await ready();
    s.answer(async () => ({
      status: 200,
      body: completing("{bad", () => s.session.invalidateVisit()),
    }));
    const out = kind(await s.session.execute(REGISTER, A), "stale");
    expect(out.dispatched).toBe(true);
    expect(out.meta).toMatchObject({ dispatched: true, mutating: true });
    expect(out.authority).toEqual(A);
    expect(out.binding.request).toMatchObject({ kind: "register" });
    expect(s.fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each<[string, (s: Awaited<ReturnType<typeof ready>>) => void]>([
    ["dispose", (s) => s.session.dispose()],
    ["config", (s) => void s.session.configure({ origin: OTHER, token: TOKEN_B })],
  ])("%s at the same boundary is stale too, even for a valid full answer", async (_n, flip) => {
    const s = await ready();
    const text = JSON.stringify({ ownerKey: OWNER, registration: registration(), created: true });
    s.answer(async () => ({ status: 200, body: completing(text, () => flip(s)) }));
    expect(kind(await s.session.execute(REGISTER, A), "stale").dispatched).toBe(true);
  });

  it("control: while the session is still current the same malformed bytes stay uncertain/malformed_json", async () => {
    const s = await ready();
    s.answer(async () => ({ status: 200, body: completing("{bad", () => {}) }));
    const out = kind(await s.session.execute(REGISTER, A), "uncertain");
    expect(out.category).toBe("malformed_json");
    expect(out.meta.dispatched).toBe(true);
  });
});

describe("an already-aborted guard still observes the eventual fetch outcome (7C2B1-4)", () => {
  const countingBody = (cancel?: () => Promise<void> | void) => {
    const c = { n: 0 };
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        c.n++;
        return cancel?.();
      },
    });
    return { c, body };
  };
  /** A fetch that disposes the session synchronously and hands back a deferred response. */
  async function disposingFetch() {
    const s = await ready();
    const late = deferred<ClientResponse>();
    s.answer(() => {
      s.session.dispose();
      return late.promise;
    });
    return { s, late };
  }

  it("a fetch that disposes the session synchronously and resolves later has its late body cancelled", async () => {
    const { s, late } = await disposingFetch();
    expect(kind(await s.session.execute(REGISTER, A), "stale").dispatched).toBe(true);
    const { c, body } = countingBody();
    late.resolve({ status: 200, body });
    await tick();
    expect(c.n).toBe(1);
  });

  it("the late body's cancellation is fire-and-forget: a never-settling cancel holds nothing", async () => {
    const { s, late } = await disposingFetch();
    expect(kind(await s.session.execute(REGISTER, A), "stale").dispatched).toBe(true);
    const { c, body } = countingBody(() => new Promise<void>(() => {}));
    late.resolve({ status: 200, body });
    await tick();
    expect(c.n).toBe(1);
  });

  it("a late rejection on that branch is observed (no unhandled rejection) and carries no secret", async () => {
    const seen: unknown[] = [];
    const on = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", on);
    try {
      const { s, late } = await disposingFetch();
      const out = kind(await s.session.execute(REGISTER, A), "stale");
      late.reject(new Error(TOKEN + " late"));
      await tick();
      await new Promise((r) => setTimeout(r, 0));
      expect(seen).toEqual([]);
      expect(JSON.stringify(out)).not.toContain(TOKEN);
    } finally {
      process.off("unhandledRejection", on);
    }
  });

  it("control: the ordinary asynchronous abort still cancels a late body and leaves no timer", async () => {
    vi.useFakeTimers();
    const s = await ready();
    const late = deferred<ClientResponse>();
    s.answer(() => late.promise);
    const p = s.session.execute(REGISTER, A);
    await tick();
    s.session.invalidateVisit();
    expect(kind(await p, "stale").dispatched).toBe(true);
    const { c, body } = countingBody();
    late.resolve({ status: 200, body });
    await tick();
    expect(c.n).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ⚙️ DT-7C-2B-4: HTTPS except explicit loopback HTTP, enforced at the shared session configuration (before any bearer
// request: handshake, registration or occurrence). The protocol's canonical-origin rule itself is unchanged.
describe("DT-7C-2B-4 transport origin policy: HTTPS, or HTTP only on canonical loopback", () => {
  it("accepts HTTPS (mixed case, default port) and exactly localhost / 127.0.0.1 / [::1] over HTTP", () => {
    const { session, fetchFn } = setup();
    for (const [raw, origin] of [
      ["HTTPS://Scout.TEST:443/", ORIGIN],
      ["https://scout.test:8443", "https://scout.test:8443"],
      ["http://localhost:8787", "http://localhost:8787"],
      ["HTTP://LocalHost:80/", "http://localhost"],
      ["http://127.0.0.1", "http://127.0.0.1"],
      ["http://127.0.0.1:8787/", "http://127.0.0.1:8787"],
      ["http://[::1]:8787", "http://[::1]:8787"],
      ["HTTP://[::1]", "http://[::1]"],
    ] as const) {
      expect(transportOrigin(raw)).toEqual({ ok: true, origin });
      expect(session.configure({ origin: raw, token: TOKEN })).toEqual({ ok: true, origin });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses insecure non-loopback hosts, lookalikes and non-canonical loopback spellings", () => {
    const { session, fetchFn } = setup();
    for (const raw of [
      "http://scout.test",
      "HTTP://SCOUT.TEST:80",
      "http://localhost.evil.test",
      "http://evil-localhost",
      "http://localhost.",
      "http://127.0.0.1.nip.io",
      "http://127.1",
      "http://0x7f.0.0.1",
      "http://127.000.000.001",
      "http://[0:0::1]",
      "http://[::ffff:127.0.0.1]",
      "http://192.168.1.10:8787",
    ]) {
      expect(transportOrigin(raw)).toEqual({ ok: false, reason: "insecure" });
      expect(session.configure({ origin: raw, token: TOKEN })).toEqual({
        ok: false,
        reason: "insecure",
      });
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses user-info and other non-origin inputs exactly as the canonical-origin rule does", () => {
    for (const raw of [
      "http://user@localhost",
      "http://user:pw@127.0.0.1",
      "https://user@scout.test",
      "http://localhost/path",
      "http://localhost?x=1",
      "http://localhost#f",
      "localhost:8787",
      "//localhost",
      "ws://localhost",
      "file:///etc",
      " http://localhost",
      "",
      42,
      null,
    ]) {
      expect(transportOrigin(raw)).toEqual({ ok: false, reason: "origin" });
    }
  });

  it("an insecure origin drops the previous configuration: handshake and execute send nothing", async () => {
    const s = await ready();
    expect(s.session.configure({ origin: "http://scout.test", token: TOKEN })).toEqual({
      ok: false,
      reason: "insecure",
    });
    expect(kind(await s.session.handshake(), "refused").reason).toBe("not_configured");
    expect(kind(await s.session.execute(REGISTER, A), "refused").reason).toBe("not_configured");
    expect(s.fetchFn).not.toHaveBeenCalled();
  });

  it("an in-flight action is superseded when the configuration turns insecure", async () => {
    const s = await ready();
    const late = deferred<ClientResponse>();
    s.answer(() => late.promise);
    const p = s.session.execute(REGISTER, A);
    await tick();
    s.session.configure({ origin: "http://scout.test", token: TOKEN });
    expect(kind(await p, "stale").dispatched).toBe(true);
    late.resolve(registerAnswer());
  });

  it("the registration controller inherits the policy: no handshake or register request", async () => {
    const calls: string[] = [];
    const ctl = createRegistrationController({
      fetch: async (url) => {
        calls.push(url);
        return json(200, { ownerKey: OWNER });
      },
      persistence: {
        read: async () => null,
        commit: async () => ({ ok: false, reason: "not-persisted" }),
      } as never,
    });
    expect(ctl.configure({ origin: "http://scout.test", token: TOKEN })).toEqual({
      ok: false,
      reason: "insecure",
    });
    expect(await ctl.handshake()).toEqual({ ok: false, reason: "not_configured" });
    expect(await ctl.register(REGISTER)).toMatchObject({
      kind: "refused",
      reason: "not_configured",
    });
    expect(calls).toEqual([]);
  });

  it("historical authorities are not rewritten: an http authority still parses, it just cannot be configured", () => {
    expect(authorityOf("http://scout.test", OWNER)).toEqual({
      origin: "http://scout.test",
      ownerKey: OWNER,
    });
  });
});

// A pre-built request type check: DT-7C-2C made SupportedRequest exactly CloudRequest (ack and changes admitted).
const _widen = (r: SupportedRequest): CloudRequest => r;
const _narrow = (r: CloudRequest): SupportedRequest => r;
void _narrow;
void _widen;
