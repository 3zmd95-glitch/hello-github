import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { Budget, type Http } from "./http";
import {
  answerInbox,
  readInbox,
  WINDOW_MS,
  type ConversationBatch,
  type InboxDeps,
  type InboxItem,
} from "./inbox";
import { InstagramDmCoordinator, type DmCall } from "./instagramDmCoordinator";
import { DM_SUBREQUESTS, instagramDm, type DmTick, type FenceResult } from "./instagramDmSend";
import {
  emptyAutomations,
  emptyState,
  emptyStats,
  mergeAutomation,
  type AutomationsDoc,
  type PollState,
  type ReplyLogEntry,
  type ReplyStats,
} from "./replies";
import { MAX_RETRIES } from "./replyCore";

// 💬 answerInbox through the durable DM authority (packet DT-6B-2C-2, planning/tools/37-inbox-send.md): the real
// InstagramDmCoordinator over node:sqlite, a fake transport, and the tick's fence as a stub. pollReplies' wiring
// (fresh /me, status capture, binding) is covered in replies.test.ts, workerd in instagramDmCoordinator.runtime.test.ts.

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

function namespace() {
  const db = new DatabaseSync(":memory:");
  const ns = {
    calls: [] as DmCall[],
    failing: false,
    /** DT-6B-2C-2-R1: only these operations fail (e.g. the receipt). */
    failOps: new Set<string>(),
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        ns.calls.push(JSON.parse(String(init.body)) as DmCall);
        if (ns.failing || ns.failOps.has((JSON.parse(String(init.body)) as DmCall).op))
          throw new Error("storage down");
        expect(id).toBe(`instagram-dm|${ACC}`);
        return new InstagramDmCoordinator({ storage: sqliteStorage(db) } as never).fetch(
          new Request(url, init),
        );
      },
    }),
    async run(call: DmCall) {
      return (
        await ns.get(`instagram-dm|${ACC}`).fetch("https://c/", {
          method: "POST",
          body: JSON.stringify(call),
        })
      ).json() as Promise<Record<string, unknown>>;
    },
  };
  return ns;
}

const NOW = new Date("2026-10-17T09:00:00Z");
const ACC = "17841";
const TOKEN = "ig-token";
const BASE = "https://scout.example";
const at = (minAgo: number) => NOW.getTime() - minAgo * 60_000;

const item = (id: string, text: string, over: Partial<InboxItem> = {}): InboxItem => ({
  id,
  ms: at(1),
  text,
  story: false,
  skip: false,
  ...over,
});
// DT-6B-2C-2-R1: the reader gives each item its own sender; here it is the conversation's person unless set.
const batch = (
  id: string,
  personId: string,
  items: InboxItem[],
  over: Partial<ConversationBatch> = {},
): ConversationBatch => ({
  id,
  personId,
  username: "sara",
  items: items.map((i) => ("sender" in i ? i : { ...i, sender: personId })),
  newestMs: items[items.length - 1].ms,
  ...over,
});

function config(withDefault = false): AutomationsDoc {
  const doc = emptyAutomations();
  doc.origin = BASE;
  doc.automations.cam = mergeAutomation(
    undefined,
    {
      id: "cam",
      enabled: true,
      trigger: "message",
      postId: null,
      keywords: ["كاميرا"],
      match: "contains",
      publicReplies: [],
      dmText: "أصور بالآيفون",
      buttons: [{ title: "أدواتي", url: "https://3zprod.com/gear" }],
      followButton: true,
    },
    new Date(NOW.getTime() - 86_400_000),
  );
  if (withDefault)
    doc.defaultReply = {
      enabled: true,
      text: "وصلت رسالتك",
      enabledAt: new Date(at(120)).toISOString(),
      updatedAt: new Date(at(120)).toISOString(),
    };
  return doc;
}

type Answer = (body: Record<string, unknown>, n: number) => Response | Promise<Response>;
const ok: Answer = (b) =>
  Response.json({
    recipient_id: (b.recipient as { id: string }).id,
    message_id: `out-${(b.recipient as { id: string }).id}`,
  });

function setup(
  o: {
    answer?: Answer;
    fence?: () => FenceResult;
    budget?: number;
    withDefault?: boolean;
    sender?: false;
    account?: string;
    state?: Partial<PollState>;
    /** DT-6B-2C-2-R1: what the conversations GET lists (readInbox). */
    conversations?: unknown[];
  } = {},
) {
  const ns = namespace();
  const posts: Record<string, unknown>[] = [];
  const doFetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
    if (init?.method !== "POST") return Response.json({ data: o.conversations ?? [] });
    const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
    posts.push(b);
    return (o.answer ?? ok)(b, posts.length);
  }) as unknown as typeof fetch;
  const http: Http = { fetch: doFetch, budget: new Budget(o.budget ?? 30) };
  const state: PollState = {
    ...emptyState(),
    ownerUsername: "3z.prod",
    // The DM side has run before: messages from the last hour are new.
    inboxSince: new Date(at(60)).toISOString(),
    ...o.state,
  };
  const stats: Record<string, ReplyStats> = {};
  const log: ReplyLogEntry[] = [];
  let fences = 0;
  const dm: DmTick = {
    account: o.account ?? ACC,
    generation: "a".repeat(32),
    fence: async () => {
      fences += 1;
      return o.fence?.() ?? { ok: true, now: NOW.getTime() + 5 };
    },
    sender:
      o.sender === false
        ? null
        : instagramDm(ns as unknown as DurableObjectNamespace, { now: () => NOW.getTime() + 9 }),
  };
  const d: InboxDeps = {
    http,
    token: TOKEN,
    igUserId: ACC,
    config: config(o.withDefault),
    state,
    now: NOW,
    statsOf: (id) => (stats[id] ??= emptyStats()),
    log: (e) => log.unshift(e),
    dm,
  };
  return { ns, posts, http, state, stats, log, d, fences: () => fences };
}

const claims = (ns: ReturnType<typeof namespace>) => ns.calls.filter((c) => c.op === "claim");

describe("answerInbox: rule and default DMs claim the durable authority before the one POST", () => {
  it("a rule's DM: fence, claim (auto:<rule>), the exact card with «تابعني», receipt; then as before", async () => {
    const s = setup();
    const out = await answerInbox(s.d, [batch("t1", "p1", [item("d1", "إيش الكاميرا؟")])], 8);
    expect(out).toEqual({ sent: ["d1"], failed: [], changed: true });
    expect(s.fences()).toBe(1);
    expect(s.ns.calls.map((c) => c.op)).toEqual(["claim", "settle"]);
    expect(claims(s.ns)[0]).toMatchObject({
      account: ACC,
      conversationId: "t1",
      recipientId: "p1",
      inboundMessageId: "d1",
      actor: "auto:cam",
      generation: "a".repeat(32),
      isDefault: false,
      cooldownMs: WINDOW_MS,
      now: NOW.getTime() + 5,
    });
    expect(s.posts).toEqual([
      {
        recipient: { id: "p1" },
        message: {
          attachment: {
            type: "template",
            payload: {
              template_type: "generic",
              elements: [
                {
                  title: "أصور بالآيفون",
                  default_action: { type: "web_url", url: `${BASE}/go/cam/0` },
                  buttons: [
                    { type: "web_url", url: `${BASE}/go/cam/0`, title: "أدواتي" },
                    { type: "web_url", url: "https://www.instagram.com/3z.prod/", title: "تابعني" },
                  ],
                },
              ],
            },
          },
        },
      },
    ]);
    expect(s.stats.cam).toMatchObject({ sends: 1, failures: 0 });
    expect(s.state.sent["out-p1"]).toEqual({ to: "p1", at: NOW.toISOString() });
    expect(s.state.convos.t1).toEqual({ seenAt: new Date(at(1)).toISOString() });
    expect(s.log).toEqual([
      {
        at: NOW.toISOString(),
        kind: "message",
        automationId: "cam",
        messageId: "d1",
        username: "sara",
        text: "إيش الكاميرا؟",
        publicReply: "skipped",
        dm: "sent",
      },
    ]);
    expect(s.http.budget.left).toBe(30 - DM_SUBREQUESTS);
  });

  it("the default reply claims as auto:default with the cooldown; display time still written", async () => {
    const s = setup({ withDefault: true });
    const out = await answerInbox(s.d, [batch("t1", "p1", [item("d1", "هلا")])], 8);
    expect(out.sent).toEqual(["d1"]);
    expect(claims(s.ns)[0]).toMatchObject({ actor: "auto:default", isDefault: true });
    expect(s.posts).toEqual([{ recipient: { id: "p1" }, message: { text: "وصلت رسالتك" } }]);
    expect(s.state.defaultSentAt).toEqual({ p1: NOW.toISOString() });
    expect(s.log[0]).toMatchObject({ kind: "default", automationId: "default", dm: "sent" });
  });

  it("the coordinator's cooldown is the authority: a lost display time cannot send the default twice", async () => {
    const s = setup({ withDefault: true });
    await answerInbox(s.d, [batch("t1", "p1", [item("d1", "هلا")])], 8);
    // The KV result was lost: no display time, no position. Another conversation, another message, same person.
    s.state.defaultSentAt = {};
    const before = s.log.length;
    const out = await answerInbox(s.d, [batch("t2", "p1", [item("d9", "وينك")])], 8);
    expect(out).toEqual({ sent: [], failed: [], changed: true });
    expect(s.posts).toHaveLength(1);
    // Handled exactly as today's suppression: no log entry, no counter, the position moves on.
    expect(s.log).toHaveLength(before);
    expect(s.stats.default).toMatchObject({ sends: 1, failures: 0 });
    expect(s.state.convos.t2).toBeDefined();
  });

  it("a duplicate of the same inbound event is already_claimed: handled, logged as skipped, no POST, no counter", async () => {
    const s = setup();
    const b = batch("t1", "p1", [item("d1", "كاميرا")]);
    await answerInbox(s.d, [b], 8);
    s.state.convos = {};
    const out = await answerInbox(s.d, [b], 8);
    expect(out).toEqual({ sent: [], failed: [], changed: true });
    expect(s.posts).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ messageId: "d1", dm: "skipped", detail: "already_claimed" });
    expect(s.log[0].error).toBeUndefined();
    expect(s.stats.cam).toMatchObject({ sends: 1, failures: 0 });
  });

  it("takeover before the claim: skipped with detail takeover, handled, never retried; a later turn too", async () => {
    const s = setup();
    await s.ns.run({
      op: "takeover",
      account: ACC,
      conversationId: "t1",
      expectedRevision: 0,
      now: 1,
    });
    const b = batch("t1", "p1", [item("d1", "كاميرا", { ms: at(3) }), item("d2", "كاميرا")]);
    const out = await answerInbox(s.d, [b], 8);
    expect(out).toEqual({ sent: [], failed: [], changed: true });
    expect(s.posts).toEqual([]);
    expect(s.log.map((e) => [e.messageId, e.dm, e.detail])).toEqual([
      ["d2", "skipped", "takeover"],
      ["d1", "skipped", "takeover"],
    ]);
    expect(s.state.retries).toEqual({});
    expect(s.state.convos.t1).toEqual({ seenAt: new Date(at(1)).toISOString() });
  });

  it("takeover after a winning claim: the authorized POST completes and is recorded; the next turn is blocked", async () => {
    const s = setup({
      answer: async (b) => {
        await s.ns.run({
          op: "takeover",
          account: ACC,
          conversationId: "t1",
          expectedRevision: 0,
          now: 2,
        });
        return ok(b, 1);
      },
    });
    await answerInbox(s.d, [batch("t1", "p1", [item("d1", "كاميرا", { ms: at(3) })])], 8);
    expect(s.log[0]).toMatchObject({ messageId: "d1", dm: "sent" });
    await answerInbox(s.d, [batch("t1", "p1", [item("d2", "كاميرا")])], 8);
    expect(s.log[0]).toMatchObject({ messageId: "d2", dm: "skipped", detail: "takeover" });
    expect(s.posts).toHaveLength(1);
  });

  it("unknown delivery: failed, detail unknown-delivery, handled, never retried, not counted", async () => {
    const s = setup({
      answer: () => Response.json({ error: { message: "boom" } }, { status: 500 }),
    });
    const b = batch("t1", "p1", [item("d1", "كاميرا")]);
    const out = await answerInbox(s.d, [b], 8);
    expect(out).toEqual({ sent: [], failed: ["d1"], changed: true });
    expect(s.log[0]).toMatchObject({ dm: "failed", error: "upstream", detail: "unknown-delivery" });
    expect(s.state.retries).toEqual({});
    expect(s.state.convos.t1).toBeDefined();
    expect(s.stats.cam).toMatchObject({ sends: 0, failures: 0 });
    // Neither a retry counter nor another poll replays it.
    s.state.convos = {};
    await answerInbox(s.d, [b], 8);
    expect(s.posts).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ dm: "skipped", detail: "already_claimed" });
  });

  it("a typed refusal keeps Meta's mapping and stop policy, but once claimed it is final (no retry)", async () => {
    for (const [error, code] of [
      [{ code: 190, message: "expired" }, "token_expired"],
      [{ code: 4, message: "slow down" }, "rate_limited"],
      [{ code: 10, message: "no permission" }, "no_permission"],
      [{ code: 10, error_subcode: 2534022, message: "window" }, "not_eligible"],
    ] as const) {
      const s = setup({ answer: () => Response.json({ error }, { status: 400 }) });
      const b = batch("t1", "p1", [item("d1", "كاميرا", { ms: at(3) }), item("d2", "كاميرا")]);
      const out = await answerInbox(s.d, [b], 8);
      expect(out.failed).toContain("d1");
      expect(s.log[s.log.length - 1]).toMatchObject({ messageId: "d1", dm: "failed", error: code });
      expect(s.stats.cam.failures).toBeGreaterThanOrEqual(1);
      expect(s.state.retries).toEqual({});
      if (code === "not_eligible") expect(out.stop).toBeUndefined();
      else expect(out.stop).toMatchObject({ code });
      expect(claims(s.ns)[0]).toMatchObject({ inboundMessageId: "d1" });
    }
  });

  it("a refusal echoing the token is scrubbed in the log", async () => {
    const s = setup({
      answer: () =>
        Response.json({ error: { code: 100, message: `bad ${TOKEN} param` } }, { status: 400 }),
    });
    await answerInbox(s.d, [batch("t1", "p1", [item("d1", "كاميرا")])], 8);
    expect(JSON.stringify(s.log)).not.toContain(TOKEN);
    expect(s.log[0]).toMatchObject({ error: "rejected", detail: "bad [token] param [100]" });
  });
});

describe("answerInbox: the authority fails closed", () => {
  it("no binding: not_configured, detail dm-claim-store, zero POST, no legacy send; retried up to MAX_RETRIES", async () => {
    const s = setup({ sender: false });
    const b = batch("t1", "p1", [item("d1", "كاميرا")]);
    for (let i = 1; i <= MAX_RETRIES; i++) {
      const out = await answerInbox(s.d, [b], 8);
      expect(out.failed).toEqual(["d1"]);
      expect(out.stop).toEqual({ code: "upstream", detail: "dm-claim-store" });
      expect(s.state.retries).toEqual(i < MAX_RETRIES ? { d1: i } : {});
    }
    expect(s.posts).toEqual([]);
    expect(s.log[0]).toMatchObject({
      dm: "failed",
      error: "not_configured",
      detail: "dm-claim-store",
    });
    expect(s.state.convos.t1).toBeDefined();
  });

  it("an unreadable coordinator: the same, and nothing is sent", async () => {
    const s = setup();
    s.ns.failing = true;
    const out = await answerInbox(s.d, [batch("t1", "p1", [item("d1", "كاميرا")])], 8);
    expect(out.failed).toEqual(["d1"]);
    expect(s.posts).toEqual([]);
    expect(s.log[0]).toMatchObject({ error: "not_configured", detail: "dm-claim-store" });
    expect(s.state.retries).toEqual({ d1: 1 });
    expect(s.state.convos.t1).toBeUndefined();
  });

  it("an account that is not the one the conversations were read with: fails closed, no claim", async () => {
    const s = setup({ account: "99999" });
    await answerInbox(s.d, [batch("t1", "p1", [item("d1", "كاميرا")])], 8);
    expect(s.ns.calls).toEqual([]);
    expect(s.log[0]).toMatchObject({ error: "not_configured", detail: "dm-account" });
  });

  it("a reconnect or an expired token at the final fence: no claim, nothing recorded, the tick stops", async () => {
    for (const [fence, code] of [
      [{ ok: false, code: "upstream", detail: "reconnected" }, "upstream"],
      [{ ok: false, code: "token_expired", detail: "dm: token expired" }, "token_expired"],
      [{ ok: false, code: "not_connected", detail: "dm: not connected" }, "not_connected"],
    ] as const) {
      const s = setup({ fence: () => fence });
      const b = batch("t1", "p1", [item("d1", "كاميرا")]);
      const two = batch("t2", "p2", [item("d2", "كاميرا")]);
      const out = await answerInbox(s.d, [b, two], 8);
      expect(out.stop).toMatchObject({ code });
      expect(out.failed).toEqual(["d1"]);
      expect(s.ns.calls).toEqual([]);
      expect(s.posts).toEqual([]);
      expect(s.state.retries).toEqual({});
      expect(s.state.convos).toEqual({});
      expect(s.log[0]).toMatchObject({ dm: "failed", error: code, detail: fence.detail });
    }
  });

  it("the fresh clock re-checks the local 24-hour window: an item aged out is left alone, no claim", async () => {
    const s = setup({ fence: () => ({ ok: true, now: at(1) + WINDOW_MS + 1 }) });
    const out = await answerInbox(s.d, [batch("t1", "p1", [item("d1", "كاميرا")])], 8);
    expect(out.sent).toEqual([]);
    expect(s.ns.calls).toEqual([]);
    expect(s.log).toEqual([]);
    expect(s.state.convos.t1).toBeDefined();
  });

  it("a malformed conversation, recipient or message id: skipped as unavailable, no claim", async () => {
    const s = setup();
    await answerInbox(
      s.d,
      [
        batch("t/1", "p1", [item("d1", "كاميرا")]),
        batch("t2", "", [item("d2", "كاميرا")]),
        batch("t3", "p3", [item("d|3", "كاميرا")]),
      ],
      8,
    );
    expect(s.ns.calls).toEqual([]);
    expect(s.posts).toEqual([]);
    expect(s.log.map((e) => [e.dm, e.detail])).toEqual([
      ["skipped", "unavailable"],
      ["skipped", "unavailable"],
      ["skipped", "unavailable"],
    ]);
  });
});

describe("answerInbox: caps and budget, with the coordinator calls reserved", () => {
  it("each DM needs DM_SUBREQUESTS calls left: with 7 left, two DMs go and the third waits", async () => {
    const s = setup({ budget: 7 });
    const list = [1, 2, 3].map((i) => batch(`t${i}`, `p${i}`, [item(`d${i}`, "كاميرا")]));
    const out = await answerInbox(s.d, list, 8);
    expect(out.sent).toEqual(["d1", "d2"]);
    expect(s.posts).toHaveLength(2);
    expect(s.ns.calls).toHaveLength(4);
    expect(s.state.convos.t3).toBeUndefined();
    expect(s.http.budget.left).toBe(1);
  });

  it("the answer cap counts sends only", async () => {
    const s = setup();
    const list = [1, 2, 3].map((i) => batch(`t${i}`, `p${i}`, [item(`d${i}`, "كاميرا")]));
    expect((await answerInbox(s.d, list, 2)).sent).toEqual(["d1", "d2"]);
  });

  it("skipped items (story mentions, no text, owner chatting) never reach the authority", async () => {
    const s = setup();
    await answerInbox(s.d, [batch("t1", "p1", [item("d1", "كاميرا", { skip: true })])], 8);
    expect(s.ns.calls).toEqual([]);
    expect(s.log).toEqual([]);
  });
});

/* ---------- DT-6B-2C-2-R1 ---------- */

describe("answerInbox: each answer goes only to its own message's sender (DT-6B-2C-2-R1, 2C2-3)", () => {
  it("an item from another sender, or with none, is skipped as unavailable: no claim, no POST", async () => {
    const s = setup();
    await answerInbox(
      s.d,
      [
        batch("t1", "p1", [item("d1", "كاميرا", { sender: "p2" })]),
        batch("t2", "p2", [item("d2", "كاميرا", { sender: undefined })]),
      ],
      8,
    );
    expect(s.ns.calls).toEqual([]);
    expect(s.posts).toEqual([]);
    expect(s.log.map((e) => [e.messageId, e.dm, e.detail])).toEqual([
      ["d2", "skipped", "unavailable"],
      ["d1", "skipped", "unavailable"],
    ]);
    expect(s.state.retries).toEqual({});
    expect(Object.keys(s.state.convos).sort()).toEqual(["t1", "t2"]);
  });

  const msg = (id: string, minAgo: number, text: string, from?: Record<string, string>) => ({
    id,
    created_time: new Date(at(minAgo)).toISOString(),
    message: text,
    ...(from ? { from } : {}),
  });
  const read = async (s: ReturnType<typeof setup>) => {
    const { batches } = await readInbox(s.d);
    return answerInbox(s.d, batches, 8);
  };

  it("the reader: an older message from personA and a fresh one from personB → nothing claimed or sent", async () => {
    const s = setup({
      conversations: [
        {
          id: "mixed",
          messages: {
            data: [
              msg("new", 1, "كاميرا", { id: "personB", username: "b" }),
              msg("old", 120, "hello", { id: "personA", username: "a" }),
            ],
          },
        },
      ],
    });
    await read(s);
    expect(claims(s.ns)).toEqual([]);
    expect(s.posts).toEqual([]);
    expect(s.log[0]).toMatchObject({ messageId: "new", dm: "skipped", detail: "unavailable" });
  });

  it("the reader: a fresh message without a sender is never sent to the conversation's other person", async () => {
    const s = setup({
      conversations: [
        {
          id: "nofrom",
          messages: {
            data: [
              msg("new", 1, "كاميرا"),
              msg("old", 120, "hello", { id: "personA", username: "a" }),
            ],
          },
        },
      ],
    });
    await read(s);
    expect(claims(s.ns)).toEqual([]);
    expect(s.posts).toEqual([]);
    expect(s.log[0]).toMatchObject({ messageId: "new", dm: "skipped", detail: "unavailable" });
  });

  it("the reader: one customer (and the owner) → that customer's own message is answered to them", async () => {
    const s = setup({
      conversations: [
        {
          id: "one",
          messages: {
            data: [
              msg("new", 1, "كاميرا", { id: "personA", username: "a" }),
              msg("mine", 30, "hi", { id: ACC, username: "3z.prod" }),
              msg("old", 120, "hello", { id: "personA", username: "a" }),
            ],
          },
        },
      ],
      state: { sent: { mine: { to: "personA", at: new Date(at(30)).toISOString() } } },
    });
    const out = await read(s);
    expect(out.sent).toEqual(["new"]);
    expect(claims(s.ns)[0]).toMatchObject({ recipientId: "personA", inboundMessageId: "new" });
    expect(s.posts.map((p) => p.recipient)).toEqual([{ id: "personA" }]);
  });
});

describe("answerInbox: the cap counts every DM that reached the provider (2C2-4)", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      batch(`t${i + 1}`, `p${i + 1}`, [item(`d${i + 1}`, "كاميرا")]),
    );

  it("lost receipts after provider success: 8 POSTs at most, none counted sent; the rest wait for the next tick", async () => {
    const s = setup();
    s.ns.failOps.add("settle");
    const list = many(12);
    const out = await answerInbox(s.d, list, 8);
    expect(s.posts).toHaveLength(8);
    expect(out.sent).toEqual([]);
    expect(out.failed).toHaveLength(8);
    expect(s.log.every((e) => e.detail === "unknown-delivery")).toBe(true);
    expect(s.stats.cam).toMatchObject({ sends: 0, failures: 0 });
    expect(s.state.convos.t8).toBeDefined();
    expect(s.state.convos.t9).toBeUndefined();
    expect(s.http.budget.left).toBe(30 - 8 * DM_SUBREQUESTS);
    // The next tick answers the four that waited, once each; the uncertain ones are never replayed.
    s.ns.failOps.clear();
    s.http.budget = new Budget(30);
    const next = await answerInbox(s.d, list, 8);
    expect(next.sent).toEqual(["d9", "d10", "d11", "d12"]);
    expect(s.posts).toHaveLength(12);
  });

  it("a comment's private DM already used one slot: 7 conversation DMs with lost receipts", async () => {
    const s = setup();
    s.ns.failOps.add("settle");
    await answerInbox(s.d, many(12), 8 - 1);
    expect(s.posts).toHaveLength(7);
  });

  it("sent, refused and unknown each use a slot", async () => {
    const s = setup({
      answer: (b, n) =>
        n % 3 === 1
          ? ok(b, n)
          : n % 3 === 2
            ? Response.json({ error: { code: 100, message: "bad" } }, { status: 400 })
            : Response.json({ error: { message: "boom" } }, { status: 500 }),
    });
    const out = await answerInbox(s.d, many(6), 4);
    expect(s.posts).toHaveLength(4);
    expect(out.sent).toEqual(["d1", "d4"]);
    expect(s.state.convos.t5).toBeUndefined();
  });

  it("claims that never reach the provider (takeover, already claimed, cooldown) use no slot", async () => {
    const s = setup({ withDefault: true });
    await s.ns.run({
      op: "takeover",
      account: ACC,
      conversationId: "t1",
      expectedRevision: 0,
      now: 1,
    });
    await answerInbox(s.d, [batch("t2", "p2", [item("d2", "كاميرا")])], 8);
    await answerInbox(s.d, [batch("t3", "p3", [item("d3", "هلا")])], 8);
    s.state.defaultSentAt = {};
    s.state.convos = {};
    const before = s.posts.length;
    const out = await answerInbox(
      s.d,
      [
        batch("t1", "p1", [item("d1", "كاميرا")]),
        batch("t2", "p2", [item("d2", "كاميرا")]),
        batch("t4", "p3", [item("d4", "وينك")]),
        batch("t5", "p5", [item("d5", "كاميرا")]),
        batch("t6", "p6", [item("d6", "كاميرا")]),
      ],
      2,
    );
    expect(out.sent).toEqual(["d5", "d6"]);
    expect(s.posts.length - before).toBe(2);
  });
});

describe("answerInbox: the payload is prepared before the final fence (2C2-2)", () => {
  it("digest, then fence, then claim with the fence's time; a reconnect during the digest is caught", async () => {
    const events: string[] = [];
    let reconnected = false;
    const s = setup({
      fence: () => {
        events.push("fence");
        return reconnected
          ? { ok: false, code: "upstream", detail: "reconnected" }
          : { ok: true, now: NOW.getTime() + 7 };
      },
    });
    const original = crypto.subtle.digest.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "digest").mockImplementation(async (alg, data) => {
      if (new TextDecoder().decode(data as ArrayBuffer).startsWith('{"recipient"')) {
        events.push("digest");
        if (events.filter((e) => e === "digest").length === 2) reconnected = true;
      }
      return original(alg, data as ArrayBuffer);
    });
    try {
      await answerInbox(s.d, [batch("t1", "p1", [item("d1", "كاميرا")])], 8);
      expect(events).toEqual(["digest", "fence"]);
      expect(claims(s.ns)[0]).toMatchObject({ now: NOW.getTime() + 7 });
      // The second message's digest sees a reconnect: the fence after it stops, nothing claimed.
      const out = await answerInbox(s.d, [batch("t2", "p2", [item("d2", "كاميرا")])], 8);
      expect(events).toEqual(["digest", "fence", "digest", "fence"]);
      expect(out.stop).toMatchObject({ code: "upstream" });
      expect(claims(s.ns)).toHaveLength(1);
      expect(s.posts).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});

/* ---------- DT-6B-2C-2-R2 ---------- */

describe("answerInbox: a partly handled conversation keeps its unhandled messages (DT-6B-2C-2-R2)", () => {
  const T = at(1);
  const iso = (ms: number) => new Date(ms).toISOString();
  const msg = (id: string, from: string, ms = T) => ({
    id,
    created_time: iso(ms),
    message: "كاميرا",
    from: { id: from },
  });
  /** Five one-message conversations, then one with five messages (the same time, or one second apart). */
  const page = (sameTime = true) => [
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      messages: { data: [msg(`d${i}`, `p${i}`)] },
    })),
    {
      id: "five",
      messages: {
        data: Array.from({ length: 5 }, (_, i) =>
          msg(`s${i}`, "pS", sameTime ? T : T - (5 - i) * 1000),
        ),
      },
    },
  ];
  const group = (n: number) => [
    { id: "five", messages: { data: Array.from({ length: n }, (_, i) => msg(`s${i}`, "pS")) } },
  ];
  const poll = async (s: ReturnType<typeof setup>, cap = 8, budget = 30) => {
    s.http.budget = new Budget(budget);
    const { batches } = await readInbox(s.d);
    return answerInbox(s.d, batches, cap);
  };
  const claimed = (s: ReturnType<typeof setup>) => claims(s.ns).map((c) => c.inboundMessageId);

  it("the cap splits five same-time messages: uncertain or proven, the last two follow once, never a third time", async () => {
    for (const lost of [true, false]) {
      const s = setup({ conversations: page() });
      if (lost) s.ns.failOps.add("settle");
      const first = await poll(s);
      expect(s.posts).toHaveLength(8);
      expect(first.sent).toEqual(lost ? [] : ["d0", "d1", "d2", "d3", "d4", "s0", "s1", "s2"]);
      expect(claimed(s)).toEqual(["d0", "d1", "d2", "d3", "d4", "s0", "s1", "s2"]);
      // Strictly before the shared time: the two unsent messages are read again.
      expect(s.state.convos.five).toEqual({ seenAt: iso(T - 1) });
      expect(s.state.convos.t4).toEqual({ seenAt: iso(T) });
      s.ns.failOps.clear();
      // Two slots: the three already claimed come back as already_claimed and take none of them.
      const second = await poll(s, 2);
      expect(second.sent).toEqual(["s3", "s4"]);
      expect(s.posts).toHaveLength(10);
      expect(s.log.slice(0, 5).map((e) => [e.messageId, e.dm, e.detail])).toEqual([
        ["s4", "sent", undefined],
        ["s3", "sent", undefined],
        ["s2", "skipped", "already_claimed"],
        ["s1", "skipped", "already_claimed"],
        ["s0", "skipped", "already_claimed"],
      ]);
      expect(new Set(claimed(s)).size).toBe(10);
      expect(s.state.convos.five).toEqual({ seenAt: iso(T) });
      const calls = s.ns.calls.length;
      const third = await poll(s);
      expect(third).toMatchObject({ sent: [], failed: [] });
      expect(s.posts).toHaveLength(10);
      expect(s.ns.calls).toHaveLength(calls);
    }
  });

  it("a budget stop inside the group: the reread fits the same budget and every message is sent once", async () => {
    const s = setup({ conversations: group(5) });
    // The conversations GET, then three DMs of DM_SUBREQUESTS each.
    expect((await poll(s, 8, 1 + 3 * DM_SUBREQUESTS)).sent).toEqual(["s0", "s1", "s2"]);
    expect(s.state.convos.five).toEqual({ seenAt: iso(T - 1) });
    // 7: the GET, three rereads (one claim each), one DM; s4 waits and the position stays.
    expect((await poll(s, 8, 7)).sent).toEqual(["s3"]);
    expect(s.http.budget.left).toBe(0);
    expect(s.state.convos.five).toEqual({ seenAt: iso(T - 1) });
    expect((await poll(s)).sent).toEqual(["s4"]);
    expect(s.state.convos.five).toEqual({ seenAt: iso(T) });
    expect((await poll(s)).sent).toEqual([]);
    expect(s.posts).toHaveLength(5);
    expect(new Set(claimed(s)).size).toBe(5);
  });

  it("a pre-claim retry or a fence stop inside the group: the rest follows on the next poll, once", async () => {
    for (const how of ["claim-store", "fence"] as const) {
      let fences = 0;
      const box = {} as { s: ReturnType<typeof setup> };
      box.s = setup({
        conversations: group(3),
        answer: (b, n) => {
          // After the first DM's claim: the next claim cannot be read (nothing claimed, retried).
          if (how === "claim-store" && n === 1) box.s.ns.failOps.add("claim");
          return ok(b, n);
        },
        fence: () =>
          how === "fence" && ++fences === 2
            ? { ok: false, code: "upstream", detail: "reconnected" }
            : { ok: true, now: NOW.getTime() + 5 },
      });
      const s = box.s;
      const first = await poll(s);
      expect(first.sent).toEqual(["s0"]);
      expect(first.failed).toEqual(["s1"]);
      expect(first.stop).toBeDefined();
      expect(s.state.retries).toEqual(how === "claim-store" ? { s1: 1 } : {});
      expect(s.state.convos.five).toEqual({ seenAt: iso(T - 1) });
      s.ns.failOps.clear();
      const second = await poll(s);
      expect(second.sent).toEqual(["s1", "s2"]);
      expect(s.state.retries).toEqual({});
      expect(s.state.convos.five).toEqual({ seenAt: iso(T) });
      expect((await poll(s)).sent).toEqual([]);
      expect(s.posts).toHaveLength(3);
    }
  });

  it("the first poll and a fully handled group never replay history", async () => {
    const s = setup({ conversations: group(5), state: { inboxSince: undefined } });
    expect(await readInbox(s.d)).toEqual({ batches: [], changed: true });
    expect((await poll(s)).sent).toEqual([]);
    expect(s.ns.calls).toEqual([]);
    const done = setup({ conversations: group(5) });
    expect((await poll(done)).sent).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(done.state.convos.five).toEqual({ seenAt: iso(T) });
    const calls = done.ns.calls.length;
    expect((await poll(done)).sent).toEqual([]);
    expect(done.ns.calls).toHaveLength(calls);
    expect(done.posts).toHaveLength(5);
  });

  it("distinct times: the position is the last handled message, as before, and nothing is read again", async () => {
    const s = setup({ conversations: page(false) });
    s.ns.failOps.add("settle");
    await poll(s);
    expect(s.state.convos.five).toEqual({ seenAt: iso(T - 3000) });
    s.ns.failOps.clear();
    expect((await poll(s)).sent).toEqual(["s3", "s4"]);
    expect(claimed(s)).toEqual(["d0", "d1", "d2", "d3", "d4", "s0", "s1", "s2", "s3", "s4"]);
    expect(s.posts).toHaveLength(10);
  });
});

describe("answerInbox: a message whose pre-claim retries ran out stays given up (DT-6B-2C-2-C1)", () => {
  const T = at(1);
  const iso = (ms: number) => new Date(ms).toISOString();
  const pair = () => batch("two", "p1", [item("first", "كاميرا"), item("second", "كاميرا")]);

  it("the third pre-claim failure is terminal: marked with its time, logged three times, never attempted again", async () => {
    const s = setup({ sender: false });
    for (let i = 1; i <= MAX_RETRIES; i++) {
      const out = await answerInbox(s.d, [pair()], 8);
      expect(out.failed).toEqual(["first"]);
      expect(s.state.retries).toEqual(i < MAX_RETRIES ? { first: i } : {});
    }
    expect(s.state.givenUp).toEqual({ first: iso(T) });
    // The successor shares the time: the position stays strictly before it.
    expect(s.state.convos.two).toEqual({ seenAt: iso(T - 1) });
    // The fourth read: the given-up message is handled without a claim, a log row or a count; the next one is tried.
    const fourth = await answerInbox(s.d, [pair()], 8);
    expect(fourth.failed).toEqual(["second"]);
    expect(s.state.retries).toEqual({ second: 1 });
    expect(s.log.filter((e) => e.messageId === "first")).toHaveLength(MAX_RETRIES);
    expect(s.state.givenUp).toEqual({ first: iso(T) });
    expect(s.posts).toEqual([]);
  });

  it("a given-up message never blocks its same-time successor, which is sent once; the mark leaves with the position", async () => {
    const s = setup({ state: { givenUp: { first: iso(T) } } });
    const out = await answerInbox(s.d, [pair()], 8);
    expect(out).toMatchObject({ sent: ["second"], failed: [] });
    expect(claims(s.ns).map((c) => c.inboundMessageId)).toEqual(["second"]);
    expect(s.log.map((e) => e.messageId)).toEqual(["second"]);
    expect(s.state.convos.two).toEqual({ seenAt: iso(T) });
    expect(s.state.givenUp).toEqual({});
    expect(s.posts).toHaveLength(1);
  });

  it("the cap or the budget right after a given-up message: it is passed, the successor waits, the mark stays", async () => {
    for (const how of ["cap", "budget"] as const) {
      const s = setup({ state: { givenUp: { first: iso(T) } }, budget: how === "budget" ? 2 : 30 });
      const out = await answerInbox(s.d, [pair()], how === "cap" ? 0 : 8);
      expect(out).toMatchObject({ sent: [], failed: [] });
      expect(s.ns.calls).toEqual([]);
      expect(s.state.convos.two).toEqual({ seenAt: iso(T - 1) });
      expect(s.state.givenUp).toEqual({ first: iso(T) });
      s.http.budget = new Budget(30);
      expect((await answerInbox(s.d, [pair()], 8)).sent).toEqual(["second"]);
      expect(s.state.givenUp).toEqual({});
      expect(s.posts).toHaveLength(1);
    }
  });

  it("distinct times: the mark leaves on the same poll, as soon as the position passes the given-up message", async () => {
    const s = setup({ sender: false });
    const b = batch("two", "p1", [
      item("first", "كاميرا", { ms: T - 1000 }),
      item("second", "كاميرا"),
    ]);
    for (let i = 1; i <= MAX_RETRIES; i++) await answerInbox(s.d, [b], 8);
    expect(s.state.convos.two).toEqual({ seenAt: iso(T - 1000) });
    expect(s.state.givenUp).toEqual({});
  });
});
