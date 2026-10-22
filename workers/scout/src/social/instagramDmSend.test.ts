import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Budget, type Http } from "./http";
import { InstagramDmCoordinator, type DmCall } from "./instagramDmCoordinator";
import {
  coordinateDm,
  dispatchClaimed,
  DM_SUBREQUESTS,
  DmStoreDown,
  instagramDm,
  type DmAttempt,
  type DmSender,
} from "./instagramDmSend";
import { messagePayload } from "./replyCore";

// 💬 The existing-conversation DM send (packet DT-6B-2C-2, planning/tools/37-inbox-send.md): a validated durable
// claim, then ONE POST, then a validated receipt. The coordinator is the real class over node:sqlite (a new instance
// per call, one database per object name); the transport is a fake. No provider is contacted.

function sqliteStorage(db: DatabaseSync) {
  return {
    sql: {
      exec(query: string, ...bindings: (string | number | null)[]) {
        const st = db.prepare(query);
        if (/^\s*SELECT|RETURNING/i.test(query)) {
          const rows = st.all(...bindings);
          return { toArray: () => rows };
        }
        st.run(...bindings);
        return { toArray: () => [] };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const v = fn();
        db.exec("COMMIT");
        return v;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

type Tamper = (call: DmCall, answer: Record<string, unknown>) => unknown;

/** A namespace of real coordinators; `failing` ops throw as an outage; `tamper` rewrites an answer. */
function namespace() {
  const dbs = new Map<string, DatabaseSync>();
  const ns = {
    names: [] as string[],
    ops: [] as string[],
    failing: new Set<string>(),
    tamper: undefined as Tamper | undefined,
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        const call = JSON.parse(String(init.body)) as DmCall;
        ns.names.push(id);
        ns.ops.push(call.op);
        if (ns.failing.has(call.op)) throw new Error("storage down");
        if (!dbs.has(id)) dbs.set(id, new DatabaseSync(":memory:"));
        const c = new InstagramDmCoordinator({ storage: sqliteStorage(dbs.get(id)!) } as never);
        const res = await c.fetch(new Request(url, init));
        if (!ns.tamper) return res;
        return Response.json(ns.tamper(call, (await res.json()) as Record<string, unknown>));
      },
    }),
  };
  return ns;
}

const T0 = Date.parse("2026-10-17T09:00:00Z");
const ACC = "17841000000000001";
const PERSON = "990000000000001";
const TOKEN = "IGAA-secret-token";
const SEAL = "seal-0123456789abcdef";
const MESSAGES = `https://graph.instagram.com/v21.0/${ACC}/messages`;

const attempt = (over: Partial<DmAttempt> = {}): DmAttempt => ({
  account: ACC,
  conversationId: "conv-1",
  recipientId: PERSON,
  inboundMessageId: "in-1",
  actor: "auto:cam",
  generation: "0".repeat(32),
  isDefault: false,
  cooldownMs: 86_400_000,
  token: TOKEN,
  text: "أصور بالآيفون",
  buttons: [{ title: "أدواتي", url: "https://scout.example/go/cam/0" }],
  now: T0,
  ...over,
});

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

interface Sent {
  url: string;
  init: RequestInit;
}

function setup(answer: (n: number) => Response | Promise<Response> = () => ok()) {
  const ns = namespace();
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return answer(sent.length);
  }) as unknown as typeof fetch;
  const http: Http = { fetch: fetchImpl, budget: new Budget(10) };
  const dm = instagramDm(ns as unknown as DurableObjectNamespace, {
    now: () => T0 + 500,
    secret: SEAL,
  }) as DmSender;
  const effect = async (inbound = "in-1") => {
    const stub = ns.get(`instagram-dm|${ACC}`);
    const res = await stub.fetch("https://c/", {
      method: "POST",
      body: JSON.stringify({
        op: "status",
        account: ACC,
        conversationId: "conv-1",
        inboundMessageId: inbound,
        now: T0,
      }),
    });
    return ((await res.json()) as { effect?: Record<string, unknown> }).effect;
  };
  return { ns, sent, http, dm, effect };
}

const ok = (recipient = PERSON, id = "aWdfZAG1faXRlbToxOk1lc3NhZA2U=") =>
  json({ recipient_id: recipient, message_id: id });

afterEach(() => {
  vi.useRealTimers();
});

describe("instagramDm: one validated claim, then one POST of the exact payload, then a validated receipt", () => {
  it("no binding, no sender (the caller fails closed)", () => {
    expect(instagramDm(undefined, { now: () => T0 })).toBeNull();
  });

  it("claims in the account's object, POSTs once with the existing payload shape, and records sent", async () => {
    const s = setup();
    const out = await s.dm.claimAndSend(s.http, attempt());
    expect(out).toEqual({
      state: "sent",
      providerMessageId: "aWdfZAG1faXRlbToxOk1lc3NhZA2U=",
      recipientId: PERSON,
    });
    expect(s.ns.ops).toEqual(["claim", "settle"]);
    expect(new Set(s.ns.names)).toEqual(new Set([`instagram-dm|${ACC}`]));
    expect(s.sent).toHaveLength(1);
    const { url, init } = s.sent[0];
    expect(url).toBe(MESSAGES);
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    // Exactly what replyCore.sendReply sends to an `{ id }` recipient: a generic card for short text with links.
    expect(JSON.parse(String(init.body))).toEqual({
      recipient: { id: PERSON },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [
              {
                title: "أصور بالآيفون",
                default_action: { type: "web_url", url: "https://scout.example/go/cam/0" },
                buttons: [
                  { type: "web_url", url: "https://scout.example/go/cam/0", title: "أدواتي" },
                ],
              },
            ],
          },
        },
      },
    });
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(init.body))),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    expect(await s.effect()).toMatchObject({
      state: "sent",
      actor: "auto:cam",
      recipientId: PERSON,
      payloadDigest: digest,
      providerMessageId: "aWdfZAG1faXRlbToxOk1lc3NhZA2U=",
      settledAt: new Date(T0 + 500).toISOString(),
      receiptVersion: 2,
    });
    // The token never reaches the coordinator.
    expect(JSON.stringify(await s.effect())).not.toContain(TOKEN);
  });

  it("plain text without buttons; spends exactly one provider call and two coordinator calls", async () => {
    const s = setup();
    await s.dm.claimAndSend(s.http, attempt({ buttons: [], text: "وصلت رسالتك" }));
    expect(JSON.parse(String(s.sent[0].init.body))).toEqual({
      recipient: { id: PERSON },
      message: { text: "وصلت رسالتك" },
    });
    expect(DM_SUBREQUESTS).toBe(3);
    expect(s.http.budget.left).toBe(10 - DM_SUBREQUESTS);
  });

  it("the same inbound event is never sent twice: a second attempt is already_claimed, no POST", async () => {
    const s = setup(() => json({ error: { message: "boom" } }, 500));
    expect(await s.dm.claimAndSend(s.http, attempt())).toEqual({
      state: "unknown",
      reason: "server",
    });
    const again = await s.dm.claimAndSend(
      s.http,
      attempt({ actor: "manual:op-aaaaaaaa", generation: "1".repeat(32) }),
    );
    expect(again).toEqual({ state: "already_claimed" });
    expect(s.sent).toHaveLength(1);
    expect(await s.effect()).toMatchObject({ state: "unknown", unknownReason: "server" });
  });

  it("blocked_by_takeover and cooldown make no POST", async () => {
    const s = setup();
    const stub = s.ns.get(`instagram-dm|${ACC}`);
    await stub.fetch("https://c/", {
      method: "POST",
      body: JSON.stringify({
        op: "takeover",
        account: ACC,
        conversationId: "conv-1",
        expectedRevision: 0,
        now: T0,
      }),
    });
    expect(await s.dm.claimAndSend(s.http, attempt())).toEqual({ state: "blocked_by_takeover" });
    const def = { actor: "auto:default", isDefault: true, conversationId: "conv-2" };
    expect(
      await s.dm.claimAndSend(s.http, attempt({ ...def, inboundMessageId: "a" })),
    ).toMatchObject({ state: "sent" });
    expect(await s.dm.claimAndSend(s.http, attempt({ ...def, inboundMessageId: "b" }))).toEqual({
      state: "cooldown",
    });
    expect(s.sent).toHaveLength(1);
  });
});

describe("instagramDm: anything but exact proof is unknown delivery, never repeated", () => {
  const cases: [string, () => Response | Promise<Response>, string][] = [
    ["a recipient that is not the expected one", () => ok("990000000000009"), "recipient"],
    ["no recipient_id", () => json({ message_id: "mid.1" }), "recipient"],
    ["an empty message id", () => json({ recipient_id: PERSON, message_id: "" }), "malformed"],
    ["a numeric message id", () => json({ recipient_id: PERSON, message_id: 5 }), "malformed"],
    [
      "success beside an error",
      () => json({ recipient_id: PERSON, message_id: "mid.1", error: { code: 1 } }),
      "malformed",
    ],
    ["not JSON", () => new Response("<html>", { status: 200 }), "malformed"],
    ["a 5xx", () => json({ error: { message: "boom", code: 2 } }, 503), "server"],
    [
      "a redirect (never followed)",
      () => new Response(null, { status: 307, headers: { Location: "https://evil.example/" } }),
      "redirect",
    ],
    [
      "an untyped 4xx error body",
      () => json({ error: { message: "nope", code: "10" } }, 400),
      "malformed",
    ],
    ["an oversize answer", () => new Response("x".repeat(256 * 1024 + 1)), "oversize"],
    [
      "a broken connection",
      () => {
        throw new TypeError("network");
      },
      "network",
    ],
  ];
  for (const [name, answer, reason] of cases)
    it(`${name} → unknown (${reason}), one POST, settled unknown`, async () => {
      const s = setup(answer);
      expect(await s.dm.claimAndSend(s.http, attempt())).toEqual({ state: "unknown", reason });
      expect(s.sent).toHaveLength(1);
      expect(await s.effect()).toMatchObject({ state: "unknown", unknownReason: reason });
    });

  it("a timeout aborts after 15 seconds → unknown (timeout)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const s = setup(
      () =>
        new Promise<Response>((_, reject) => {
          const signal = s.sent[0].init.signal!;
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const running = s.dm.claimAndSend(s.http, attempt());
    // The claim first (real I/O), then the POST and its 15-second timer.
    while (!s.sent.length) await new Promise((r) => setImmediate(r));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(await s.effect()).toMatchObject({ state: "claimed" });
    await vi.advanceTimersByTimeAsync(1);
    expect(await running).toEqual({ state: "unknown", reason: "timeout" });
    expect(await s.effect()).toMatchObject({ state: "unknown", unknownReason: "timeout" });
  });
});

describe("instagramDm: a typed refusal is rejected with scrubbed words", () => {
  it("Meta's typed error → rejected (meta_<code>); token and seal never reach the words or the receipt", async () => {
    const s = setup(() =>
      json(
        {
          error: {
            code: 10,
            error_subcode: 2534022,
            message: `outside window ${TOKEN} ${SEAL} https://x.example/a?access_token=${TOKEN}`,
            fbtrace_id: "trace",
          },
        },
        400,
      ),
    );
    const out = await s.dm.claimAndSend(s.http, attempt());
    expect(out).toMatchObject({ state: "rejected", code: "meta_10" });
    const words = JSON.stringify(out);
    expect(words).not.toContain(TOKEN);
    expect(words).not.toContain(SEAL);
    expect(words).not.toContain("fbtrace");
    expect((out as { reply: unknown }).reply).toEqual({
      status: 400,
      ok: false,
      body: {
        error: {
          code: 10,
          error_subcode: 2534022,
          message: "outside window [token] [secret] [link]",
        },
      },
    });
    expect(await s.effect()).toMatchObject({ state: "rejected", failureCode: "meta_10" });
    expect(JSON.stringify(await s.effect())).not.toContain("outside");
  });
});

describe("instagramDm: coordinator answers are proof only when bound to the request", () => {
  const before: [string, Tamper][] = [
    ["a pure error", () => ({ error: "bad_request" })],
    ["an error beside a matching claimed effect", (_c, a) => ({ ...a, error: "conflict" })],
    [
      "a claimed effect of another actor",
      (_c, a) => ({ ...a, effect: { ...(a.effect as object), actor: "auto:other" } }),
    ],
    [
      "a claimed effect with another payload digest",
      (_c, a) => ({ ...a, effect: { ...(a.effect as object), payloadDigest: "f".repeat(64) } }),
    ],
    [
      "a claimed effect for another recipient",
      (_c, a) => ({ ...a, effect: { ...(a.effect as object), recipientId: "1" } }),
    ],
    [
      "a fractional receipt version",
      (_c, a) => ({ ...a, effect: { ...(a.effect as object), receiptVersion: 1.5 } }),
    ],
    [
      "claimed while the conversation is held by a person",
      (_c, a) => ({ ...a, conversation: { ...(a.conversation as object), mode: "human" } }),
    ],
    ["another conversation", (_c, a) => ({ ...a, conversation: { mode: "auto", revision: 0 } })],
    ["an unknown result", (_c, a) => ({ ...a, result: "maybe" })],
    ["cooldown for a rule's answer", (_c, a) => ({ ...a, result: "cooldown" })],
    ["an array", () => []],
  ];
  for (const [name, tamper] of before)
    it(`${name} at the claim → DmStoreDown, no POST`, async () => {
      const s = setup();
      s.ns.tamper = (call, a) => (call.op === "claim" ? tamper(call, a) : a);
      await expect(s.dm.claimAndSend(s.http, attempt())).rejects.toBeInstanceOf(DmStoreDown);
      expect(s.sent).toEqual([]);
    });

  it("an unreachable coordinator at the claim → DmStoreDown, no POST", async () => {
    const s = setup();
    s.ns.failing.add("claim");
    await expect(s.dm.claimAndSend(s.http, attempt())).rejects.toBeInstanceOf(DmStoreDown);
    expect(s.sent).toEqual([]);
  });

  const after: [string, Tamper | "down"][] = [
    ["an error beside a matching sent effect", (_c, a) => ({ ...a, error: "conflict" })],
    [
      "a receipt for another message id",
      (_c, a) => ({ ...a, effect: { ...(a.effect as object), providerMessageId: "other" } }),
    ],
    [
      "a receipt still claimed",
      (_c, a) => ({ ...a, effect: { ...(a.effect as object), state: "claimed" } }),
    ],
    ["no settled flag", (_c, a) => ({ effect: a.effect })],
    ["an unreachable coordinator", "down"],
  ];
  for (const [name, tamper] of after)
    it(`${name} at the receipt → unknown (receipt), not counted as sent`, async () => {
      const s = setup();
      if (tamper === "down") s.ns.failing.add("settle");
      else s.ns.tamper = (call, a) => (call.op === "settle" ? tamper(call, a) : a);
      expect(await s.dm.claimAndSend(s.http, attempt())).toEqual({
        state: "unknown",
        reason: "receipt",
      });
      expect(s.sent).toHaveLength(1);
    });

  it("a lost receipt after a typed refusal is still that refusal (nothing was sent)", async () => {
    const s = setup(() => json({ error: { code: 10, message: "no" } }, 403));
    s.ns.failing.add("settle");
    expect(await s.dm.claimAndSend(s.http, attempt())).toMatchObject({
      state: "rejected",
      code: "meta_10",
    });
    expect(await s.effect()).toMatchObject({ state: "claimed" });
  });
});

/* ---------- DT-6B-2C-2-R1 ---------- */

const sha256 = async (text: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");

describe("instagramDm: the receipt binds the complete claimed attempt (DT-6B-2C-2-R1, 2C2-5)", () => {
  type Row = Record<string, unknown>;
  const settleAs =
    (f: (e: Row, a: Row) => unknown): Tamper =>
    (c, a) =>
      c.op === "settle" ? f(a.effect as Row, a) : a;
  const cases: [string, Tamper][] = [
    [
      "another recipient",
      settleAs((e, a) => ({ ...a, effect: { ...e, recipientId: "990000000000009" } })),
    ],
    [
      "another payload digest",
      settleAs((e, a) => ({ ...a, effect: { ...e, payloadDigest: "f".repeat(64) } })),
    ],
    [
      "another generation",
      settleAs((e, a) => ({ ...a, effect: { ...e, generation: "e".repeat(32) } })),
    ],
    [
      "a minimal sent effect (no recipient, digest, generation or times)",
      settleAs((e) => ({
        settled: true,
        effect: {
          account: e.account,
          conversationId: e.conversationId,
          inboundMessageId: e.inboundMessageId,
          actor: e.actor,
          state: "sent",
          providerMessageId: e.providerMessageId,
          receiptVersion: 2,
        },
      })),
    ],
    [
      "an unparseable settledAt",
      settleAs((e, a) => ({ ...a, effect: { ...e, settledAt: "soon" } })),
    ],
    [
      "no settledAt",
      settleAs((e, a) => {
        const rest = { ...e };
        delete rest.settledAt;
        return { ...a, effect: rest };
      }),
    ],
    [
      "an unparseable claimedAt",
      settleAs((e, a) => ({ ...a, effect: { ...e, claimedAt: "not-a-date" } })),
    ],
    [
      "a fractional receipt version",
      settleAs((e, a) => ({ ...a, effect: { ...e, receiptVersion: 2.5 } })),
    ],
  ];
  for (const [name, tamper] of cases)
    it(`a sent receipt with ${name} → unknown (receipt), never replayed`, async () => {
      const s = setup();
      s.ns.tamper = tamper;
      expect(await s.dm.claimAndSend(s.http, attempt())).toEqual({
        state: "unknown",
        reason: "receipt",
      });
      s.ns.tamper = undefined;
      expect(await s.dm.claimAndSend(s.http, attempt())).toEqual({ state: "already_claimed" });
      expect(s.sent).toHaveLength(1);
    });

  it("a repeated settlement of the same outcome (settled: false over the same row) still proves sent", async () => {
    const s = setup();
    s.ns.tamper = (c, a) => (c.op === "settle" ? { ...a, settled: false } : a);
    expect(await s.dm.claimAndSend(s.http, attempt())).toMatchObject({ state: "sent" });
  });

  const claims: [string, Tamper][] = [
    [
      "an unparseable claimedAt",
      (c, a) =>
        c.op === "claim" ? { ...a, effect: { ...(a.effect as Row), claimedAt: "not-a-date" } } : a,
    ],
    [
      "a provider message id already",
      (c, a) =>
        c.op === "claim" ? { ...a, effect: { ...(a.effect as Row), providerMessageId: "m" } } : a,
    ],
    [
      "a settledAt already",
      (c, a) =>
        c.op === "claim"
          ? { ...a, effect: { ...(a.effect as Row), settledAt: new Date(T0).toISOString() } }
          : a,
    ],
  ];
  for (const [name, tamper] of claims)
    it(`a claimed effect with ${name} → DmStoreDown before the POST`, async () => {
      const s = setup();
      s.ns.tamper = tamper;
      await expect(s.dm.claimAndSend(s.http, attempt())).rejects.toBeInstanceOf(DmStoreDown);
      expect(s.sent).toEqual([]);
    });
});

describe("instagramDm: success proof beside a typed error is unknown, the cooldown stays (2C2-6)", () => {
  const def = { actor: "auto:default", isDefault: true };
  const bodies: [string, Record<string, unknown>][] = [
    [
      "message_id and recipient_id",
      { message_id: "might-have-sent", recipient_id: PERSON, error: { code: 190, message: "x" } },
    ],
    ["message_id", { message_id: "might-have-sent", error: { code: 10 } }],
    ["recipient_id", { recipient_id: PERSON, error: { code: 10 } }],
  ];
  for (const [name, body] of bodies)
    it(`a 400 with ${name} and error.code → unknown; the next default for that person stays in cooldown`, async () => {
      const s = setup(() => json(body, 400));
      expect(await s.dm.claimAndSend(s.http, attempt(def))).toEqual({
        state: "unknown",
        reason: "malformed",
      });
      expect(await s.effect()).toMatchObject({ state: "unknown", unknownReason: "malformed" });
      const next = attempt({ ...def, inboundMessageId: "in-2", now: T0 + 1000 });
      expect(await s.dm.claimAndSend(s.http, next)).toEqual({ state: "cooldown" });
      expect(await s.dm.claimAndSend(s.http, attempt(def))).toEqual({ state: "already_claimed" });
      expect(s.sent).toHaveLength(1);
    });

  it("a genuine typed refusal still gives the cooldown back, never its own inbound message", async () => {
    const s = setup((n) => (n === 1 ? json({ error: { code: 10, message: "no" } }, 403) : ok()));
    expect(await s.dm.claimAndSend(s.http, attempt(def))).toMatchObject({
      state: "rejected",
      code: "meta_10",
    });
    expect(await s.dm.claimAndSend(s.http, attempt(def))).toEqual({ state: "already_claimed" });
    const next = attempt({ ...def, inboundMessageId: "in-2", now: T0 + 1000 });
    expect(await s.dm.claimAndSend(s.http, next)).toMatchObject({ state: "sent" });
    expect(s.sent).toHaveLength(2);
  });
});

describe("instagramDm: every asynchronous preparation happens before the caller's final fence (2C2-2)", () => {
  it("prepare: the exact body and its SHA-256; claimAndSend with it starts the claim at once, no digest", async () => {
    const s = setup();
    const a = attempt();
    const p = await s.dm.prepare(a);
    expect(JSON.parse(p.body)).toEqual({
      recipient: { id: PERSON },
      message: messagePayload(a.text, a.buttons),
    });
    expect(p.payloadDigest).toBe(await sha256(p.body));
    const digest = vi.spyOn(crypto.subtle, "digest");
    try {
      const pending = s.dm.claimAndSend(s.http, a, p);
      // No await precedes the claim: it is already on its way before any microtask runs.
      expect(s.ns.ops).toEqual(["claim"]);
      expect(await pending).toMatchObject({ state: "sent" });
      expect(digest).not.toHaveBeenCalled();
    } finally {
      digest.mockRestore();
    }
    expect(await s.effect()).toMatchObject({
      payloadDigest: p.payloadDigest,
      claimedAt: new Date(T0).toISOString(),
    });
  });

  it("a prepared body of another attempt is refused before the claim", async () => {
    const s = setup();
    const p = await s.dm.prepare(attempt({ text: "غير" }));
    await expect(s.dm.claimAndSend(s.http, attempt(), p)).rejects.toBeInstanceOf(DmStoreDown);
    expect(s.ns.ops).toEqual([]);
    expect(s.sent).toEqual([]);
  });
});

/* ---------- DT-6B-2C-3: the dispatch-after-claim seam the manual route uses ---------- */

describe("dispatchClaimed (DT-6B-2C-3): the one bounded POST of the exact given bytes, no claim of its own", () => {
  const target = { account: ACC, recipientId: PERSON, token: TOKEN };
  // Leading/trailing spaces, CRLF and a supplementary character: posted exactly, never re-serialized or trimmed.
  const exact = JSON.stringify({ recipient: { id: PERSON }, message: { text: " a\r\nb 𝒜 " } });

  it("POSTs exactly the given body once (manual redirects, bearer), spends one call, claims nothing", async () => {
    const { ns, sent, http } = setup();
    const out = await dispatchClaimed(http, target, exact, SEAL);
    expect(out).toEqual({
      state: "sent",
      providerMessageId: "aWdfZAG1faXRlbToxOk1lc3NhZA2U=",
      recipientId: PERSON,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(MESSAGES);
    expect(sent[0].init.body).toBe(exact);
    expect(sent[0].init.method).toBe("POST");
    expect(sent[0].init.redirect).toBe("manual");
    expect((sent[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(http.budget.left).toBe(9);
    expect(ns.ops).toEqual([]);
  });

  it("no budget left: throws before any fetch", async () => {
    const { sent } = setup();
    const http: Http = { fetch: vi.fn() as unknown as typeof fetch, budget: new Budget(0) };
    await expect(dispatchClaimed(http, target, exact, SEAL)).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  for (const [name, answer, want] of [
    ["another recipient", () => ok("990000000000009"), { state: "unknown", reason: "recipient" }],
    [
      "a redirect",
      () => new Response(null, { status: 302, headers: { Location: "https://x" } }),
      { state: "unknown", reason: "redirect" },
    ],
    [
      "success beside an error",
      () => json({ message_id: "m", recipient_id: PERSON, error: {} }),
      { state: "unknown", reason: "malformed" },
    ],
    [
      "a typed error with delivery proof",
      () => json({ error: { code: 10 }, message_id: "m" }, 400),
      { state: "unknown", reason: "malformed" },
    ],
    ["a 5xx", () => json({ error: { code: 2 } }, 500), { state: "unknown", reason: "server" }],
  ] as [string, () => Response, unknown][])
    it(`${name} → ${JSON.stringify(want)}`, async () => {
      const { http } = setup(answer);
      expect(await dispatchClaimed(http, target, exact, SEAL)).toEqual(want);
    });

  it("a typed refusal is rejected with the token and the seal scrubbed", async () => {
    const { http } = setup(() =>
      json({ error: { code: 10, message: `nope ${TOKEN} ${SEAL}` } }, 400),
    );
    const out = await dispatchClaimed(http, target, exact, SEAL);
    expect(out).toMatchObject({ state: "rejected", code: "meta_10" });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(JSON.stringify(out)).not.toContain(SEAL);
  });

  it("the coordinator client is shared: an unreachable store is DmStoreDown", async () => {
    const ns = namespace();
    ns.failing.add("getIntent");
    await expect(
      coordinateDm(ns as unknown as DurableObjectNamespace, ACC, {
        op: "getIntent",
        account: ACC,
        operationId: "op-dm-00000001",
        now: T0,
      }),
    ).rejects.toBeInstanceOf(DmStoreDown);
  });

  it("the automatic serialization is unchanged: claimAndSend still trims its text", async () => {
    const { sent, http, dm } = setup();
    await dm.claimAndSend(http, attempt({ text: "  hi  ", buttons: [] }));
    expect(sent[0].init.body).toBe(
      JSON.stringify({ recipient: { id: PERSON }, message: { text: "hi" } }),
    );
  });
});
