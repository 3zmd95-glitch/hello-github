import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { Budget } from "./http";
import { PAGE_BYTES_MAX } from "./inboxRead";
import {
  dispatchPublicReply,
  IG_SEND_TEXT_MAX,
  IG_VERIFY_PAGE,
  publicEffects,
  type PublicEffects,
  verifyTarget,
} from "./instagramPublicSend";

// 📤 The one Instagram public reply dispatch (shared by the manual confirm and the automatic acknowledgement) and the
// bounded ownership preflight (packet DT-6B-2C-1, planning/tools/37-inbox-send.md). Fake fetch only.

const IG = "graph.instagram.com/v21.0";
const TOKEN = "ig-live-token-abc";
const SEAL = "seal-secret-0123456789abcdef0123456789";
const ME = "17841000000000001";
const MEDIA = "18000000000000001";
const COMMENT = "17900000000000001";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Handler = (url: URL, init?: RequestInit) => unknown;

function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const handler = routes[`${init?.method ?? "GET"} ${url.host}${url.pathname}`];
    if (!handler) return json({ error: { message: `unmocked ${url.pathname}` } }, 404);
    const out = await handler(url, init);
    return out instanceof Response ? out : json(out);
  });
  const urls = () =>
    fn.mock.calls.map(([input, init]) => {
      const u = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      return { method: init?.method ?? "GET", url: u, body: init?.body ? String(init.body) : "" };
    });
  return Object.assign(fn, { urls });
}

const http = (f: typeof fetch, n = 1) => ({ fetch: f, budget: new Budget(n) });

describe("local policy limits", () => {
  it("are labelled constants, not provider limits", () => {
    expect(IG_VERIFY_PAGE).toBe(50);
    expect(IG_SEND_TEXT_MAX).toBe(1000);
  });
});

describe("dispatchPublicReply", () => {
  it("POSTs exactly once to /{comment}/replies with message + token in the form body; a string id is sent", async () => {
    const f = mockFetch({ [`POST ${IG}/${COMMENT}/replies`]: () => ({ id: "17950000000000001" }) });
    const h = http(f);
    expect(await dispatchPublicReply(h, TOKEN, COMMENT, "شكرًا @fan {username}")).toEqual({
      state: "sent",
      providerReplyId: "17950000000000001",
    });
    expect(h.budget.left).toBe(0);
    const [c] = f.urls();
    expect(c.method).toBe("POST");
    expect(c.url.search).toBe("");
    // No template substitution and nothing else in the body.
    expect(Object.fromEntries(new URLSearchParams(c.body))).toEqual({
      message: "شكرًا @fan {username}",
      access_token: TOKEN,
    });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a known Meta refusal is rejected (code and scrubbed words), with the reply for the caller's mapping", async () => {
    const f = mockFetch({
      [`POST ${IG}/${COMMENT}/replies`]: () =>
        json(
          {
            error: { message: `bad ${TOKEN} ${SEAL} https://x.y/z`, code: 100, error_subcode: 33 },
          },
          400,
        ),
    });
    const out = await dispatchPublicReply(http(f), TOKEN, COMMENT, "hi", SEAL);
    expect(out).toMatchObject({ state: "rejected", code: "meta_100", reply: { status: 400 } });
    const detail = (out as { detail?: string }).detail ?? "";
    expect(detail).not.toContain(TOKEN);
    expect(detail).not.toContain(SEAL);
    expect(detail).not.toContain("https://");
  });

  const unknowns: [string, Handler, string][] = [
    ["a 5xx", () => json({ error: { message: "boom", code: 1 } }, 500), "server"],
    ["a 2xx without an id", () => ({ success: true }), "malformed"],
    ["a 2xx whose id is not a plain string", () => ({ id: 17950000000000001 }), "malformed"],
    ["a 2xx that also carries an error", () => ({ id: "1", error: { code: 1 } }), "malformed"],
    ["a 2xx that is not JSON", () => new Response("ok", { status: 200 }), "malformed"],
    ["a 4xx without Meta's error body", () => new Response("no", { status: 403 }), "server"],
    [
      "an answer over the byte budget",
      () => new Response("x".repeat(PAGE_BYTES_MAX + 1), { status: 200 }),
      "oversize",
    ],
    [
      "a broken connection",
      () => {
        throw new TypeError("network");
      },
      "network",
    ],
  ];
  for (const [name, handler, reason] of unknowns)
    it(`${name} is unknown (${reason}), never retried`, async () => {
      const f = mockFetch({ [`POST ${IG}/${COMMENT}/replies`]: handler });
      expect(await dispatchPublicReply(http(f), TOKEN, COMMENT, "hi")).toEqual({
        state: "unknown",
        reason,
      });
      expect(f).toHaveBeenCalledTimes(1);
    });

  it("a timeout aborts after 15 s and is unknown", async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn<typeof fetch>(
        (_u, init) =>
          new Promise((_r, reject) =>
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      );
      const p = dispatchPublicReply(http(f), TOKEN, COMMENT, "hi");
      await vi.advanceTimersByTimeAsync(15_000);
      expect(await p).toEqual({ state: "unknown", reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("an exhausted budget throws before any fetch", async () => {
    const f = mockFetch({});
    await expect(dispatchPublicReply(http(f, 0), TOKEN, COMMENT, "hi")).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});

describe("verifyTarget: at most three bounded GETs, first pages only", () => {
  const owned = (extra: Record<string, Handler> = {}) =>
    mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: ME, username: "3z.prod" }),
      [`GET ${IG}/${ME}/media`]: () => ({
        data: [{ id: "18000000000000009" }, { id: MEDIA }],
        paging: { next: `https://${IG}/${ME}/media?after=x&access_token=${TOKEN}` },
      }),
      [`GET ${IG}/${MEDIA}/comments`]: () => ({
        data: [{ id: COMMENT }],
        paging: { next: `https://${IG}/next` },
      }),
      ...extra,
    });

  it("proves the target with /me user_id, the owned-media page and the comment page; never follows paging", async () => {
    const f = owned();
    expect(await verifyTarget(f, TOKEN, { mediaId: MEDIA, commentId: COMMENT })).toEqual({
      ok: true,
      userId: ME,
    });
    const urls = f.urls();
    expect(urls.map((u) => `${u.method} ${u.url.host}${u.url.pathname}`)).toEqual([
      `GET ${IG}/me`,
      `GET ${IG}/${ME}/media`,
      `GET ${IG}/${MEDIA}/comments`,
    ]);
    expect(urls[0].url.searchParams.get("fields")).toBe("user_id,username");
    expect(urls[1].url.searchParams.get("limit")).toBe(String(IG_VERIFY_PAGE));
    expect(urls[2].url.searchParams.get("limit")).toBe(String(IG_VERIFY_PAGE));
    expect(urls.every((u) => !u.url.searchParams.has("after"))).toBe(true);
  });

  it("an expected account that is not /me's user_id is account_mismatch after ONE GET", async () => {
    const f = owned();
    expect(
      await verifyTarget(f, TOKEN, {
        account: "26000000000000009",
        mediaId: MEDIA,
        commentId: COMMENT,
      }),
    ).toEqual({ ok: false, error: "account_mismatch", detail: "identity" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(
      await verifyTarget(owned(), TOKEN, { account: ME, mediaId: MEDIA, commentId: COMMENT }),
    ).toEqual({ ok: true, userId: ME });
  });

  it("a numeric user_id is the identity as its decimal string", async () => {
    const f = owned({
      [`GET ${IG}/me`]: () => ({ user_id: 17841, username: "3z.prod" }),
      [`GET ${IG}/17841/media`]: () => ({ data: [{ id: MEDIA }] }),
    });
    expect(await verifyTarget(f, TOKEN, { mediaId: MEDIA, commentId: COMMENT })).toEqual({
      ok: true,
      userId: "17841",
    });
  });

  it("media outside the first owned page is target_unverified (outside the local window), comments never read", async () => {
    const f = owned({ [`GET ${IG}/${ME}/media`]: () => ({ data: [{ id: "18000000000000009" }] }) });
    expect(await verifyTarget(f, TOKEN, { mediaId: MEDIA, commentId: COMMENT })).toEqual({
      ok: false,
      error: "target_unverified",
      detail: "outside-local-window",
    });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("a comment outside the first comment page is target_unverified", async () => {
    const f = owned({ [`GET ${IG}/${MEDIA}/comments`]: () => ({ data: [{ id: "179000" }] }) });
    expect(await verifyTarget(f, TOKEN, { mediaId: MEDIA, commentId: COMMENT })).toEqual({
      ok: false,
      error: "target_unverified",
      detail: "outside-local-window",
    });
  });

  it("a malformed page (no list, a row without an id) is upstream, never absence", async () => {
    for (const bad of [{}, { data: [{ text: "x" }] }, { data: "nope" }, { data: [{ id: 1.5 }] }]) {
      const f = owned({ [`GET ${IG}/${ME}/media`]: () => bad });
      expect(await verifyTarget(f, TOKEN, { mediaId: MEDIA, commentId: COMMENT })).toMatchObject({
        ok: false,
        error: "upstream",
      });
    }
    const noId = owned({ [`GET ${IG}/me`]: () => ({ username: "3z.prod" }) });
    expect(await verifyTarget(noId, TOKEN, { mediaId: MEDIA, commentId: COMMENT })).toMatchObject({
      ok: false,
      error: "upstream",
    });
  });

  it("maps refusals and keeps the token and seal out of the words", async () => {
    const cases: [Handler, string][] = [
      [() => json({ error: { message: `dead ${TOKEN}`, code: 190 } }, 401), "token_expired"],
      [() => json({ error: { message: "slow", code: 4 } }, 400), "rate_limited"],
      [() => json({ error: { message: "perm", code: 10 } }, 403), "no_permission"],
      [() => json({ error: { message: `x ${SEAL}`, code: 1 } }, 500), "upstream"],
    ];
    for (const [handler, error] of cases) {
      const f = owned({ [`GET ${IG}/me`]: handler });
      const out = await verifyTarget(f, TOKEN, { mediaId: MEDIA, commentId: COMMENT }, SEAL);
      expect(out).toMatchObject({ ok: false, error });
      expect(JSON.stringify(out)).not.toContain(TOKEN);
      expect(JSON.stringify(out)).not.toContain(SEAL);
    }
  });

  it("an oversize page is upstream", async () => {
    const f = owned({
      [`GET ${IG}/${ME}/media`]: () => new Response("x".repeat(PAGE_BYTES_MAX + 1)),
    });
    expect(await verifyTarget(f, TOKEN, { mediaId: MEDIA, commentId: COMMENT })).toMatchObject({
      ok: false,
      error: "upstream",
    });
  });
});

describe("publicEffects", () => {
  it("is null without a binding (the caller fails closed)", () => {
    expect(publicEffects(undefined)).toBeNull();
  });

  it("throws when the coordinator cannot be reached or answers an error", async () => {
    const down = {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async () => {
          throw new Error("storage down");
        },
      }),
    } as unknown as DurableObjectNamespace;
    await expect(publicEffects(down)!.claimAuto(ME, COMMENT, "lut", 0)).rejects.toThrow();
    const bad = {
      idFromName: (n: string) => n,
      get: () => ({ fetch: async () => json({ error: "bad_request" }) }),
    } as unknown as DurableObjectNamespace;
    await expect(publicEffects(bad)!.claimAuto(ME, COMMENT, "lut", 0)).rejects.toThrow();
  });
});

/* ---------- DT-6B-2C-1-R1 ---------- */

describe("2C1-3: dispatch never follows a redirect", () => {
  it("asks the transport not to follow redirects", async () => {
    const f = mockFetch({ [`POST ${IG}/${COMMENT}/replies`]: () => ({ id: "17950000000000001" }) });
    await dispatchPublicReply(http(f), TOKEN, COMMENT, "hi");
    expect(f.mock.calls[0][1]?.redirect).toBe("manual");
  });

  for (const status of [301, 302, 303, 307, 308])
    it(`a ${status} answer is unknown (redirect), one attempt`, async () => {
      const f = mockFetch({
        [`POST ${IG}/${COMMENT}/replies`]: () =>
          new Response(null, { status, headers: { Location: "https://elsewhere.invalid/x" } }),
      });
      expect(await dispatchPublicReply(http(f), TOKEN, COMMENT, "hi")).toEqual({
        state: "unknown",
        reason: "redirect",
      });
      expect(f).toHaveBeenCalledTimes(1);
    });

  // Native fetch across two real loopback origins: the credential-bearing POST reaches exactly one of them.
  for (const status of [307, 308])
    it(`a native ${status} to another loopback origin makes exactly one HTTP POST`, async () => {
      const seen: string[] = [];
      const receive = async (req: IncomingMessage, label: string) => {
        for await (const chunk of req) void chunk;
        seen.push(label);
      };
      const listen = (s: Server) =>
        new Promise<number>((resolve) =>
          s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)),
        );
      const close = (s: Server) =>
        new Promise<void>((resolve) => {
          s.closeAllConnections();
          s.close(() => resolve());
        });
      const target = createServer(async (req, res) => {
        await receive(req, "target");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "17950000000000001" }));
      });
      const targetPort = await listen(target);
      const origin = createServer(async (req, res) => {
        await receive(req, "origin");
        res.writeHead(status, { location: `http://127.0.0.1:${targetPort}/capture` });
        res.end();
      });
      const originPort = await listen(origin);
      try {
        const transport = vi.fn<typeof fetch>((_url, init) =>
          fetch(`http://127.0.0.1:${originPort}/replies`, init),
        );
        const out = await dispatchPublicReply(http(transport), TOKEN, COMMENT, "exact", SEAL);
        expect(out).toEqual({ state: "unknown", reason: "redirect" });
        expect(transport).toHaveBeenCalledTimes(1);
        expect(seen).toEqual(["origin"]);
      } finally {
        await close(origin);
        await close(target);
      }
    });
});

describe("2C1-4: only a typed Meta refusal is rejected", () => {
  const malformed: [string, unknown][] = [
    ["an empty error object", { error: {} }],
    ["an error array", { error: [] }],
    ["a string code", { error: { code: "100", message: "not typed" } }],
    ["a fractional code", { error: { code: 1.5 } }],
    ["no code", { error: { message: "no code" } }],
    ["a non-string message", { error: { code: 100, message: 7 } }],
    ["a non-numeric subcode", { error: { code: 100, error_subcode: "33" } }],
    ["a null error", { error: null }],
  ];
  for (const [name, body] of malformed)
    it(`${name} on a 4xx is unknown (malformed), never a proved rejection`, async () => {
      const f = mockFetch({ [`POST ${IG}/${COMMENT}/replies`]: () => json(body, 400) });
      expect(await dispatchPublicReply(http(f), TOKEN, COMMENT, "hi")).toEqual({
        state: "unknown",
        reason: "malformed",
      });
      expect(f).toHaveBeenCalledTimes(1);
    });

  it("a typed numeric code is rejected with its mapping kept; the reply carries only scrubbed words", async () => {
    const f = mockFetch({
      [`POST ${IG}/${COMMENT}/replies`]: () =>
        json({ error: { code: 190, message: `expired ${TOKEN} ${SEAL}`, type: "OAuth" } }, 400),
    });
    const out = await dispatchPublicReply(http(f), TOKEN, COMMENT, "hi", SEAL);
    expect(out).toMatchObject({ state: "rejected", code: "meta_190" });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(JSON.stringify(out)).not.toContain(SEAL);
    expect((out as { reply: { body: { error: { code: number } } } }).reply.body.error.code).toBe(
      190,
    );
  });
});

describe("2C1-5: the coordinator client binds every answer to its request", () => {
  const EFFECT = {
    account: ME,
    commentId: COMMENT,
    actor: "auto:lut",
    state: "claimed",
    claimedAt: "2026-10-17T09:00:00.000Z",
    receiptVersion: 1,
  };
  const answering = (body: unknown) =>
    ({
      idFromName: (n: string) => n,
      get: () => ({ fetch: async () => json(body) }),
    }) as unknown as DurableObjectNamespace;
  const claim = (body: unknown) => publicEffects(answering(body))!.claimAuto(ME, COMMENT, "lut", 0);
  const SENT = { state: "sent", providerReplyId: "17950000000000001" } as const;
  const settle = (body: unknown, outcome: Parameters<PublicEffects["settle"]>[3] = SENT) =>
    publicEffects(answering(body))!.settle(ME, COMMENT, "auto:lut", outcome, 0);

  it("a claim proving this account, comment and actor is won", async () => {
    expect(await claim({ claimed: true, effect: EFFECT })).toEqual({ claimed: true });
  });

  it("a lost claim (another holder of this comment, or a retired one) is lost", async () => {
    expect(
      await claim({ claimed: false, effect: { ...EFFECT, actor: "manual:op-1234567" } }),
    ).toEqual({ claimed: false });
    expect(await claim({ claimed: false })).toEqual({ claimed: false });
  });

  const badClaims: [string, unknown][] = [
    ["claimed without proof", { claimed: true }],
    ["another account", { claimed: true, effect: { ...EFFECT, account: "17841000000000999" } }],
    ["another comment", { claimed: true, effect: { ...EFFECT, commentId: "17900000000000999" } }],
    ["another actor", { claimed: true, effect: { ...EFFECT, actor: "auto:other" } }],
    ["a settled effect", { claimed: true, effect: { ...EFFECT, state: "sent" } }],
    ["a fractional version", { claimed: true, effect: { ...EFFECT, receiptVersion: 1.5 } }],
    ["a string version", { claimed: true, effect: { ...EFFECT, receiptVersion: "1" } }],
    ["a lost claim on another comment", { claimed: false, effect: { ...EFFECT, commentId: "x1" } }],
    ["an array", []],
    ["an empty object", {}],
  ];
  for (const [name, body] of badClaims)
    it(`${name} is not claim proof (throws: no POST)`, async () => {
      await expect(claim(body)).rejects.toThrow();
    });

  const SETTLED = {
    ...EFFECT,
    state: "sent",
    providerReplyId: SENT.providerReplyId,
    settledAt: "2026-10-17T09:00:01.000Z",
    receiptVersion: 2,
  };

  it("a settlement proving this outcome is a receipt, first time or repeated over the same durable row", async () => {
    await expect(settle({ settled: true, effect: SETTLED })).resolves.toBeUndefined();
    await expect(settle({ settled: false, effect: SETTLED })).resolves.toBeUndefined();
    await expect(
      settle(
        { settled: true, effect: { ...SETTLED, state: "rejected", failureCode: "meta_100" } },
        { state: "rejected", code: "meta_100" },
      ),
    ).resolves.toBeUndefined();
    await expect(
      settle(
        { settled: true, effect: { ...SETTLED, state: "unknown", unknownReason: "timeout" } },
        { state: "unknown", reason: "timeout" },
      ),
    ).resolves.toBeUndefined();
  });

  const badSettles: [string, unknown][] = [
    ["an empty object", {}],
    ["an array", []],
    ["a still-claimed effect", { settled: false, effect: EFFECT }],
    ["another account", { settled: true, effect: { ...SETTLED, account: "17841000000000999" } }],
    ["another actor", { settled: true, effect: { ...SETTLED, actor: "manual:op-1234567" } }],
    ["another reply id", { settled: true, effect: { ...SETTLED, providerReplyId: "999" } }],
    ["another outcome", { settled: false, effect: { ...SETTLED, state: "unknown" } }],
    ["no settled flag", { effect: SETTLED }],
    ["a fractional version", { settled: true, effect: { ...SETTLED, receiptVersion: 2.5 } }],
  ];
  for (const [name, body] of badSettles)
    it(`${name} is not a receipt (throws: uncertainty kept)`, async () => {
      await expect(settle(body)).rejects.toThrow();
    });
});

describe("DT-6B-2C-1-R2 2C1-R1-B: an answer carrying an error is never proof", () => {
  const CLAIMED = {
    account: ME,
    commentId: COMMENT,
    actor: "auto:lut",
    state: "claimed",
    claimedAt: "2026-10-17T09:00:00.000Z",
    receiptVersion: 1,
  };
  const SENT_ROW = {
    ...CLAIMED,
    state: "sent",
    providerReplyId: "17950000000000001",
    settledAt: "2026-10-17T09:00:01.000Z",
    receiptVersion: 2,
  };
  const answering = (body: unknown) =>
    ({
      idFromName: (n: string) => n,
      get: () => ({ fetch: async () => json(body) }),
    }) as unknown as DurableObjectNamespace;
  const claim = (body: unknown) => publicEffects(answering(body))!.claimAuto(ME, COMMENT, "lut", 0);
  const settle = (body: unknown) =>
    publicEffects(answering(body))!.settle(
      ME,
      COMMENT,
      "auto:lut",
      { state: "sent", providerReplyId: SENT_ROW.providerReplyId },
      0,
    );

  for (const error of ["conflict", "not_found", "bad_request", "", null])
    it(`a claim with error ${JSON.stringify(error)} and otherwise matching proof throws (no POST)`, async () => {
      await expect(claim({ error, claimed: true, effect: CLAIMED })).rejects.toThrow();
      await expect(claim({ error, claimed: false })).rejects.toThrow();
    });

  for (const error of ["conflict", "not_found", "", null])
    it(`a settlement with error ${JSON.stringify(error)} and otherwise matching proof throws (uncertain)`, async () => {
      await expect(settle({ error, settled: true, effect: SENT_ROW })).rejects.toThrow();
      await expect(settle({ error, settled: false, effect: SENT_ROW })).rejects.toThrow();
    });

  it("a pure error envelope still throws; the clean answers stay proof (controls)", async () => {
    await expect(claim({ error: "conflict" })).rejects.toThrow();
    await expect(settle({ error: "not_found" })).rejects.toThrow();
    expect(await claim({ claimed: true, effect: CLAIMED })).toEqual({ claimed: true });
    await expect(settle({ settled: true, effect: SENT_ROW })).resolves.toBeUndefined();
    await expect(settle({ settled: false, effect: SENT_ROW })).resolves.toBeUndefined();
  });
});
