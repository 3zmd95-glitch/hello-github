// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxScope } from "@/lib/inbox";
import { dmBodyDigest, dmOpKey } from "@/lib/inboxInstagramDmSend";
import { STORAGE_KEY, inboxDraftBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import { resetInbox, useInbox } from "./useInbox";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";
import {
  cancelInstagramDmReply,
  checkInstagramDmReply,
  confirmInstagramDmReply,
  finishInstagramDmReply,
  instagramDmKey,
  newInstagramDmVisit,
  onInstagramDmDraftCleared,
  prepareInstagramDmReply,
  resetInstagramDmViews,
  useInstagramDmViews,
  type DmSendTarget,
} from "./useInstagramDmSend";

// 💬 Reviewed Instagram DMs, client side (packet DT-6B-2C-5A). Production readiness is closed (`instagramDmSendReadiness`),
// so nothing below the gate runs in the app; this file reaches the future enabled path ONLY by injecting `{ readiness }`
// into the actions, never a shipped switch. The handle (keyed per inbound message) is persisted before every request; an
// answer applies only when its exact receipt is the durable handle after the commit; the fences (config epoch, URL and
// token, provider visit, account + READER generation, open conversation, DM visit, draft revision, latest action) hold
// after every await; a lost settlement stays dispatching with its observation (never a rejection); recovery needs no
// readiness, row, draft or account read and goes only to the handle's own Worker. Transport is a fake Worker.

const OPEN = { readiness: () => ({ ok: true }) as const };
const WORKER = "https://scout.test";
const RG = "c".repeat(32);
const RG2 = "d".repeat(32);
/** The DM send generation the Worker derives: never the reader's. */
const SG = "e".repeat(32);
const ME = "17841000000000001";
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const CONV2 = "aWdfZAG06OTk5";
const PERSON = "990000000000001";
const IN1 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE=";
const IN2 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjI=";
const AT = "2026-10-17T08:55:00.000Z";
const MID = "aWdfZAG1faXRlbToxOk1lc3NhZA2U=";
const SCOPE = inboxScope(WORKER, ME, "conversation", CONV);
const KEY = dmOpKey(WORKER, ME, CONV, IN1);
const KEY2 = dmOpKey(WORKER, ME, CONV, IN2);
const TEXT = "  Hi Sara! Café 🎬  ";
const CANON = "Hi Sara! Café 🎬";
const DIGEST = dmBodyDigest(PERSON, CANON);
const SEND = "/social/inbox/instagram/dm/send";

const S = () => useStore.getState();
const view = (k = KEY) => useInstagramDmViews.getState().views[k];
const op = (k = KEY) => S().inboxInstagramDmSendOps[k];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let REV = "";
const target = (over: Partial<DmSendTarget> = {}): DmSendTarget => ({
  account: ME,
  readerGeneration: RG,
  conversationId: CONV,
  recipientId: PERSON,
  inboundMessageId: IN1,
  inboundAt: AT,
  ...over,
});

const VERSION: Record<string, number> = {
  prepared: 1,
  dispatching: 2,
  sent: 3,
  rejected: 3,
  unknown: 3,
  already_claimed: 2,
  cancelled: 2,
  expired: 2,
};
const T1 = "2026-10-17T09:01:00.000Z";
const T2 = "2026-10-17T09:02:00.000Z";
// The real DM coordinator's proof per state (the Worker's PROOF table).
const PROOF: Record<string, Record<string, unknown>> = {
  dispatching: { claimedAt: T1 },
  sent: { claimedAt: T1, settledAt: T2, providerMessageId: MID },
  rejected: { claimedAt: T1, settledAt: T2, failureCode: "meta_10" },
  unknown: { claimedAt: T1, settledAt: T2, unknownReason: "timeout" },
  already_claimed: { failureCode: "already_claimed", failureDetail: "automatic" },
};
const intent = (operationId: string, state = "prepared", over: Record<string, unknown> = {}) => ({
  operationId,
  account: ME,
  generation: SG,
  conversationId: CONV,
  recipientId: PERSON,
  inboundMessageId: IN1,
  inboundAt: AT,
  text: CANON,
  digest: DIGEST,
  draftRevision: REV,
  state,
  reviewExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:00.000Z",
  receiptVersion: VERSION[state],
  ...PROOF[state],
  ...over,
});
const pendingAnswer = (id: string, observed: Record<string, unknown>) => ({
  intent: intent(id, "dispatching"),
  observed,
  settlement: "pending",
});

type Call = {
  method: string;
  url: string;
  path: string;
  body: Record<string, string> | undefined;
  redirect?: string;
  auth: string | null;
};
let calls: Call[];
let handler: (c: Call) => Response | Promise<Response>;

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};

/** The Instagram inbox on screen: this account (reader generation) and this conversation open. */
function instagramOn(accountId = ME, generation = RG, conversationId: string | null = CONV) {
  useProviderInbox.setState({ provider: "instagram" });
  useInbox.setState({
    origin: WORKER,
    account: {
      accountId,
      handle: "3z.prod",
      generation,
      capabilities: { messages: "ok", comments: "ok" },
    },
    accountError: null,
    tab: "messages",
    conversationId,
  });
}

/** A handle as an earlier session left it (the Worker's receipt of `state`). */
async function seed(
  state: string,
  operationId = "op-dm-seeded1",
  over: Record<string, unknown> = {},
  key = KEY,
) {
  const local = state === "preparing" || state === "confirming";
  const r = await S().setInboxInstagramDmSendOp(
    key,
    {
      operationId,
      workerOrigin: WORKER,
      account: ME,
      conversationId: CONV,
      recipientId: PERSON,
      inboundMessageId: IN1,
      draftRevision: REV,
      digest: DIGEST,
      state: state as never,
      ...(local ? {} : { receiptVersion: VERSION[state], sendGeneration: SG, inboundAt: AT }),
      ...(state === "sent" ? { providerMessageId: MID } : {}),
      ...over,
    },
    null,
  );
  if (!r.ok) throw new Error(r.reason);
  return operationId;
}

/** Prepare through the fake Worker, landing in review. */
async function prepared() {
  handler = (c) =>
    json({ intent: intent(c.body!.operationId), verification: { window: "first-page" } });
  await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
  expect(view()?.phase).toBe("review");
  calls = [];
  return op()!.operationId;
}

/** Hold every store commit until `release()`. */
function holdLock() {
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  setArticlesLock(async (fn) => {
    await held;
    return fn();
  });
  return () => {
    release();
    setArticlesLock(queueLock());
  };
}

/** A clean device: configured Worker, Instagram on screen, the conversation draft saved (REV is its revision). */
async function fresh() {
  localStorage.clear();
  S().reset();
  S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetInstagramDmViews();
  resetInbox();
  instagramOn();
  const d = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
  if (!d.ok || !d.draft) throw new Error("draft");
  REV = d.draft.commitId;
}

const posts = () => calls.filter((c) => c.method === "POST").map((c) => c.path);

beforeEach(async () => {
  setArticlesLock(queueLock());
  await fresh();
  calls = [];
  handler = () => json({ error: "not_found" }, 404);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      const c: Call = {
        method: init?.method ?? "GET",
        url: input,
        path: `${u.pathname}${u.search}`,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
        redirect: init?.redirect,
        auth: new Headers(init?.headers).get("Authorization"),
      };
      calls.push(c);
      return handler(c);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setArticlesLock(undefined);
  resetProviderInbox();
  resetInbox();
});

describe("production readiness (closed)", () => {
  it("prepare and send make no request and keep no handle", async () => {
    await prepareInstagramDmReply(KEY, target(), TEXT, REV);
    expect(view()).toMatchObject({
      phase: "error",
      error: "unavailable",
      detail: "permission_unverified",
    });
    expect(op()).toBeUndefined();
    await confirmInstagramDmReply(KEY, target());
    expect(calls).toEqual([]);
  });

  it("a retained lost-settlement operation is still checked (status only), once, with no row, draft, account or permission", async () => {
    const id = await seed("dispatching", "op-dm-seeded1", {
      pending: { observed: "rejected", code: "meta_10" },
    });
    await S().discardInboxDraft(SCOPE, inboxDraftBase(S().inboxDrafts[SCOPE]));
    useInbox.setState({ account: null, accountError: "token_expired", conversationId: null });
    handler = () => json({ intent: intent(id, "dispatching") });
    await checkInstagramDmReply(KEY);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${SEND}/${id}?account=${ME}`]);
    expect(calls[0].redirect).toBe("manual");
    // The observation stays beside the durable dispatching: uncertainty only, never a rejection.
    expect(view()).toMatchObject({
      phase: "dispatching",
      intent: { operationId: id },
      pending: { observed: "rejected", code: "meta_10" },
    });
    expect(op()).toMatchObject({ state: "dispatching", pending: { observed: "rejected" } });
    expect(await finishInstagramDmReply(KEY, true)).toBeNull();
    expect(op()).toBeDefined();
  });
});

describe("prepare (enabled only by injection)", () => {
  it("persists `preparing` BEFORE the request, sends the raw text and ids, learns generation and inbound time, opens the review", async () => {
    let atRequest: unknown;
    handler = (c) => {
      atRequest = stored().inboxInstagramDmSendOps[KEY];
      return json({ intent: intent(c.body!.operationId) });
    };
    await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    expect(atRequest).toMatchObject({ state: "preparing", digest: DIGEST, draftRevision: REV });
    expect(JSON.stringify(atRequest)).not.toContain("Sara");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: `${SEND}/prepare`,
      redirect: "manual",
      auth: "Bearer owner-token",
      body: {
        account: ME,
        conversationId: CONV,
        recipientId: PERSON,
        inboundMessageId: IN1,
        text: TEXT,
        draftRevision: REV,
      },
    });
    expect(view()).toMatchObject({ phase: "review", intent: { text: CANON } });
    expect(op()).toMatchObject({
      state: "prepared",
      receiptVersion: 1,
      sendGeneration: SG,
      inboundAt: AT,
      digest: DIGEST,
    });
    expect(JSON.stringify(stored().inboxInstagramDmSendOps)).not.toContain(CANON);
  });

  it("needs the saved exact revision and a usable canonical text; otherwise zero requests", async () => {
    await prepareInstagramDmReply(KEY, target(), TEXT, "other-rev", OPEN);
    expect(view()?.phase).toBe("closed");
    await prepareInstagramDmReply(KEY, target(), "  \t  ", REV, OPEN);
    expect(calls).toEqual([]);
    expect(op()).toBeUndefined();
    // A key that is not exactly this target's (another inbound) is refused too.
    await prepareInstagramDmReply(KEY2, target(), TEXT, REV, OPEN);
    expect(calls).toEqual([]);
  });

  it("a write the browser refuses means zero requests", async () => {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    expect(view()).toMatchObject({ phase: "error", error: "notPersisted" });
    expect(calls).toEqual([]);
  });

  it("converges on the identical submission's operation only through a durable write", async () => {
    handler = () => json({ intent: intent("op-dm-canonical1") });
    await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    expect(op()?.operationId).toBe("op-dm-canonical1");
    expect(view()).toMatchObject({ phase: "review", intent: { operationId: "op-dm-canonical1" } });
  });

  it("an answer about another recipient, inbound message, time, conversation or text is not trusted; the handle stays", async () => {
    for (const over of [
      { recipientId: "990000000000002" },
      { inboundMessageId: IN2 },
      { inboundAt: "2026-10-17T08:00:00.000Z" },
      { conversationId: CONV2 },
      { text: "other", digest: dmBodyDigest(PERSON, "other") },
    ]) {
      await fresh();
      calls = [];
      handler = (c) => json({ intent: intent(c.body!.operationId, "prepared", over) });
      await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
      expect(view(), JSON.stringify(over)).toMatchObject({ phase: "uncertain", error: "mismatch" });
      expect(op()?.state).toBe("preparing");
    }
  });

  it("a refused prepare lets its handle go, keeping only allowlisted details", async () => {
    handler = () => json({ error: "target_invalid", detail: "window-closed" }, 409);
    await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    expect(view()).toMatchObject({
      phase: "error",
      error: "target_invalid",
      detail: "window-closed",
    });
    expect(op()).toBeUndefined();
    handler = () => json({ error: "upstream", detail: "Meta said: token abc" }, 502);
    await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    expect(view()).toEqual({ phase: "error", intent: null, error: "upstream" });
  });

  it("an unresolved handle blocks a new prepare for that inbound message only, with zero requests", async () => {
    await seed("dispatching");
    await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    expect(view()).toMatchObject({ phase: "error", error: "unresolved" });
    expect(calls).toEqual([]);
    // A later inbound message is another key: its own review may start, and the earlier handle is kept.
    handler = (c) =>
      json({ intent: intent(c.body!.operationId, "prepared", { inboundMessageId: IN2 }) });
    await prepareInstagramDmReply(KEY2, target({ inboundMessageId: IN2 }), TEXT, REV, OPEN);
    expect(view(KEY2)?.phase).toBe("review");
    expect(op()?.state).toBe("dispatching");
  });

  it("refuses with capacity when 50 unresolved handles are kept, and asks nothing", async () => {
    for (let i = 0; i < 50; i++) {
      const inbound = `aWdfZAG1fa${i}`;
      await seed(
        "dispatching",
        `op-dm-full-${String(i).padStart(4, "0")}`,
        { inboundMessageId: inbound },
        dmOpKey(WORKER, ME, CONV, inbound),
      );
    }
    await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    expect(view()).toMatchObject({ phase: "error", error: "capacity" });
    expect(calls).toEqual([]);
  });
});

describe("fences: a move while a handle is written sends nothing; A → B → A never revives", () => {
  const moves: [string, () => void, () => void][] = [
    ["another account", () => instagramOn("17841000000000002"), () => instagramOn()],
    ["a reader-generation change", () => instagramOn(ME, RG2), () => instagramOn()],
    [
      "another provider",
      () => useProviderInbox.setState({ provider: "threads" }),
      () => useProviderInbox.setState({ provider: "instagram" }),
    ],
    [
      "another conversation",
      () => useInbox.setState({ conversationId: CONV2 }),
      () => useInbox.setState({ conversationId: CONV }),
    ],
    ["another inbound message selected", () => newInstagramDmVisit(), () => newInstagramDmVisit()],
    [
      "another tab",
      () => useInbox.setState({ tab: "comments" }),
      () => useInbox.setState({ tab: "messages" }),
    ],
    [
      "another Worker token",
      () => S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "other" } }),
      () => S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } }),
    ],
  ];
  for (const [name, away, back] of moves)
    it(`Prepare: ${name}`, async () => {
      const release = holdLock();
      handler = (c) => json({ intent: intent(c.body!.operationId) });
      const run = prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
      away();
      back();
      release();
      await run;
      expect(posts()).toEqual([]);
      expect(view()?.phase ?? "closed").toMatch(/closed|idle/);
      expect(op()).toBeUndefined();
    });

  for (const [name, away, back] of moves)
    it(`Send: ${name} before the confirm request rolls the mark back and sends nothing`, async () => {
      const id = await prepared();
      const release = holdLock();
      const run = confirmInstagramDmReply(KEY, target(), OPEN);
      away();
      back();
      release();
      await run;
      expect(posts()).toEqual([]);
      expect(op()).toMatchObject({ operationId: id, state: "prepared" });
    });

  it("a newer draft revision saved (another tab) while the handle is written sends nothing", async () => {
    const release = holdLock();
    const run = prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    const save = S().saveInboxDraft(SCOPE, "newer", inboxDraftBase(S().inboxDrafts[SCOPE]));
    release();
    await Promise.all([run, save]);
    expect(posts()).toEqual([]);
  });

  it("only the newest action of a key changes the view", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    handler = async (c) => {
      await held;
      return json({ intent: intent(c.body!.operationId) });
    };
    const id = await seed("prepared");
    const first = checkInstagramDmReply(KEY);
    handler = () => json({ intent: intent(id, "expired") });
    await checkInstagramDmReply(KEY);
    release();
    await first;
    expect(view()?.phase).toBe("expired");
  });
});

describe("send and recovery", () => {
  it("marks `confirming` BEFORE the one confirm request; sent records the immutable message id", async () => {
    const id = await prepared();
    let atRequest: unknown;
    handler = () => {
      atRequest = stored().inboxInstagramDmSendOps[KEY];
      return json({ intent: intent(id, "sent") });
    };
    await confirmInstagramDmReply(KEY, target(), OPEN);
    expect(atRequest).toMatchObject({ state: "confirming", receiptVersion: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: `${SEND}/confirm`,
      body: { operationId: id, digest: DIGEST, account: ME },
      redirect: "manual",
    });
    expect(view()).toMatchObject({ phase: "sent", intent: { providerMessageId: MID } });
    expect(op()).toMatchObject({ state: "sent", providerMessageId: MID, inboundAt: AT });
  });

  it("the pending envelope stays dispatching with its observation: no Send, no Clear, no freed handle; reload keeps it", async () => {
    for (const observed of [
      { state: "unknown", reason: "receipt" },
      { state: "rejected", code: "meta_10", detail: "Meta words" },
    ]) {
      await fresh();
      const id = await prepared();
      handler = () => json(pendingAnswer(id, observed));
      await confirmInstagramDmReply(KEY, target(), OPEN);
      const pending =
        observed.state === "unknown"
          ? { observed: "unknown", code: "receipt" }
          : { observed: "rejected", code: "meta_10" };
      expect(view()).toMatchObject({ phase: "dispatching", pending });
      expect(op()).toMatchObject({ state: "dispatching", receiptVersion: 2, pending });
      expect(JSON.stringify(stored())).not.toContain("Meta words");
      // Never finished, never a new operation, never confirmed again.
      expect(await finishInstagramDmReply(KEY, true)).toBeNull();
      calls = [];
      await prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
      await confirmInstagramDmReply(KEY, target(), OPEN);
      expect(posts()).toEqual([]);
      expect(S().inboxDrafts[SCOPE]?.commitId).toBe(REV);
      // After a reload the observation is still there beside the durable dispatching.
      await useStore.persist.rehydrate();
      resetInstagramDmViews();
      handler = () => json({ intent: intent(id, "dispatching") });
      await checkInstagramDmReply(KEY);
      expect(view()).toMatchObject({ phase: "dispatching", pending });
      // A later durable outcome replaces the uncertainty.
      handler = () => json({ intent: intent(id, "sent") });
      await checkInstagramDmReply(KEY);
      expect(op()).toMatchObject({ state: "sent", providerMessageId: MID });
      expect(op()?.pending).toBeUndefined();
    }
  });

  it("the reader generation is never compared with the send generation (they differ by design)", async () => {
    const id = await prepared();
    expect(op()?.sendGeneration).toBe(SG);
    expect(useInbox.getState().account?.generation).toBe(RG);
    handler = () => json({ intent: intent(id, "sent") });
    await confirmInstagramDmReply(KEY, target(), OPEN);
    expect(view()?.phase).toBe("sent");
  });

  it("Send while production readiness is closed asks nothing; a failed mark write asks nothing", async () => {
    await prepared();
    await confirmInstagramDmReply(KEY, target());
    expect(view()).toMatchObject({ phase: "review", error: "unavailable" });
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await confirmInstagramDmReply(KEY, target(), OPEN);
    expect(view()).toMatchObject({ phase: "review", error: "notPersisted" });
    expect(calls).toEqual([]);
  });

  it("a confirm for another inbound message, recipient or conversation than the review sends nothing", async () => {
    await prepared();
    for (const over of [{ inboundMessageId: IN2 }, { recipientId: "990000000000002" }])
      await confirmInstagramDmReply(KEY, target(over), OPEN);
    expect(calls).toEqual([]);
    expect(op()?.state).toBe("prepared");
  });

  it("a refusal the DM route gives only before any claim rolls the mark back and the review stands", async () => {
    for (const error of ["conflict", "no_permission", "stale", "target_invalid"]) {
      await fresh();
      const id = await prepared();
      handler = () => json({ error, ...(error === "stale" ? { detail: "reconnected" } : {}) }, 409);
      await confirmInstagramDmReply(KEY, target(), OPEN);
      expect(view(), error).toMatchObject({ phase: "review", error, intent: { operationId: id } });
      expect(op()).toMatchObject({ state: "prepared", receiptVersion: 1 });
    }
  });

  it("any other failure after the mark is status only: the mark stays, nothing is retried", async () => {
    for (const [status, body] of [
      [503, { error: "receipt_unavailable" }],
      [502, { error: "upstream" }],
      [429, { error: "rate_limited" }],
      [404, { error: "not_found" }],
      [200, { intent: { state: "sent" } }],
    ] as const) {
      await fresh();
      await prepared();
      handler = () => json(body, status);
      await confirmInstagramDmReply(KEY, target(), OPEN);
      expect(view()?.phase, JSON.stringify(body)).toBe("uncertain");
      expect(op()?.state).toBe("confirming");
      expect(calls).toHaveLength(1);
    }
  });

  it("a status not_found never clears a confirming handle (never proof of non-delivery)", async () => {
    await seed("confirming");
    await checkInstagramDmReply(KEY);
    expect(view()).toMatchObject({ phase: "uncertain", error: "not_found" });
    expect(op()?.state).toBe("confirming");
  });

  it("a prepared status while Confirm is pending stays status only; the mark is kept", async () => {
    const id = await prepared();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    handler = async (c) => {
      if (c.method === "POST") {
        await held;
        return json({ error: "receipt_unavailable" }, 503);
      }
      return json({ intent: intent(id, "prepared") });
    };
    const send = confirmInstagramDmReply(KEY, target(), OPEN);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    await checkInstagramDmReply(KEY);
    expect(view()).toMatchObject({ phase: "uncertain" });
    expect(op()?.state).toBe("confirming");
    release();
    await send;
    expect(op()?.state).toBe("confirming");
  });

  it("an older or contradictory receipt never replaces newer proof: superseded with Check status", async () => {
    const id = await seed("sent");
    handler = () => json({ intent: intent(id, "dispatching") });
    await checkInstagramDmReply(KEY);
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
    expect(op()).toMatchObject({ state: "sent", providerMessageId: MID });
    // Another message id for the same operation is never trusted.
    handler = () => json({ intent: intent(id, "sent", { providerMessageId: "other-mid" }) });
    await checkInstagramDmReply(KEY);
    expect(view()).toMatchObject({ error: "mismatch" });
    expect(op()?.providerMessageId).toBe(MID);
  });

  it("recovers by the stored account and Worker when another account is loaded", async () => {
    const id = await seed("unknown");
    instagramOn("17841000000000002", RG2, null);
    handler = () => json({ intent: intent(id, "unknown") });
    await checkInstagramDmReply(KEY);
    expect(calls.map((c) => c.path)).toEqual([`${SEND}/${id}?account=${ME}`]);
    expect(view()?.phase).toBe("unknown");
  });

  it("another Worker's handle (or a cleared configuration) is never asked; the current token never goes there", async () => {
    const other = dmOpKey("https://old.test", ME, CONV, IN1);
    const r = await S().setInboxInstagramDmSendOp(
      other,
      {
        operationId: "op-dm-foreign1",
        workerOrigin: "https://old.test",
        account: ME,
        conversationId: CONV,
        recipientId: PERSON,
        inboundMessageId: IN1,
        draftRevision: REV,
        digest: DIGEST,
        state: "prepared",
        receiptVersion: 1,
      },
      null,
    );
    expect(r.ok).toBe(true);
    await checkInstagramDmReply(other);
    await cancelInstagramDmReply(other);
    expect(view(other)?.phase).toBe("closed");
    await seed("unknown");
    S().setSettings({ apiKeys: { scoutUrl: "", scoutToken: "" } });
    await checkInstagramDmReply(KEY);
    expect(calls).toEqual([]);
    expect(op()).toBeDefined();
    expect(instagramDmKey(target())).toBeNull();
  });
});

describe("cancel and finish", () => {
  it("a proven cancel of a review ends on its validated receipt and removes the handle", async () => {
    const id = await prepared();
    handler = () => json({ intent: intent(id, "cancelled") });
    await cancelInstagramDmReply(KEY);
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        path: `${SEND}/${id}/cancel`,
        body: { account: ME },
      }),
    ]);
    expect(view()).toMatchObject({ phase: "cancelled", intent: { state: "cancelled" } });
    expect(op()).toBeUndefined();
  });

  it("cancel needs no readiness or account read; a failed cancel keeps the handle; a no-op never claims success", async () => {
    const id = await seed("prepared");
    useInbox.setState({ account: null, accountError: "token_expired", conversationId: null });
    handler = () => json({ error: "receipt_unavailable" }, 503);
    await cancelInstagramDmReply(KEY);
    expect(view()).toMatchObject({ phase: "error", error: "cancelFailed" });
    expect(op()?.state).toBe("prepared");
    // A contradictory cancelled answer (with a claim) is malformed: the handle stays.
    handler = () => json({ intent: intent(id, "cancelled", { claimedAt: T1 }) });
    await cancelInstagramDmReply(KEY);
    expect(op()?.state).toBe("prepared");
    // The Worker answers dispatching (another tab sent it meanwhile): that is recorded, never "cancelled".
    handler = () => json({ intent: intent(id, "dispatching") });
    await cancelInstagramDmReply(KEY);
    expect(view()?.phase).toBe("dispatching");
    expect(op()?.state).toBe("dispatching");
    calls = [];
    await cancelInstagramDmReply(KEY);
    expect(calls).toEqual([]);
  });

  it("Clear draft after sent discards only the submitted revision, announcing it; a newer draft stays", async () => {
    const heard: string[] = [];
    const off = onInstagramDmDraftCleared((scope, d) => heard.push(`${scope}:${d.commitId}`));
    const id = await prepared();
    handler = () => json({ intent: intent(id, "sent") });
    await confirmInstagramDmReply(KEY, target(), OPEN);
    expect(await finishInstagramDmReply(KEY, true)).toMatchObject({ commitId: REV });
    expect(S().inboxDrafts[SCOPE]).toBeUndefined();
    expect(heard).toEqual([`${SCOPE}:${REV}`]);
    expect(op()).toBeUndefined();
    // A newer revision saved after Send is never touched.
    await fresh();
    const id2 = await prepared();
    handler = () => json({ intent: intent(id2, "sent") });
    await confirmInstagramDmReply(KEY, target(), OPEN);
    await S().saveInboxDraft(SCOPE, "typed after", inboxDraftBase(S().inboxDrafts[SCOPE]));
    expect(await finishInstagramDmReply(KEY, true)).toBeNull();
    expect(S().inboxDrafts[SCOPE]?.text).toBe("typed after");
    expect(heard).toHaveLength(1);
    off();
  });

  it("a failed discard keeps the draft and the sent handle", async () => {
    const id = await seed("sent");
    void id;
    vi.spyOn(S(), "discardInboxDraft").mockResolvedValue({ ok: false, reason: "not-persisted" });
    useInstagramDmViews.setState({
      views: { [KEY]: { phase: "sent", intent: null, error: null } },
    });
    expect(await finishInstagramDmReply(KEY, true)).toBe("failed");
    expect(view()).toMatchObject({ error: "clearFailed" });
    expect(op()?.state).toBe("sent");
  });

  it("an unresolved operation is never finished", async () => {
    for (const state of ["preparing", "confirming", "prepared", "dispatching", "unknown"]) {
      await fresh();
      await seed(state);
      expect(await finishInstagramDmReply(KEY)).toBeNull();
      expect(op()?.state).toBe(state);
    }
  });
});

describe("C4-R1 carried: a preparing handle is let go only while it is that exact unchanged record", () => {
  it("a late failed Prepare never erases a newer same-operation proof; the view follows what is stored", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    handler = async () => {
      await held;
      return json({ error: "receipt_unavailable" }, 503);
    };
    const run = prepareInstagramDmReply(KEY, target(), TEXT, REV, OPEN);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    const id = op()!.operationId;
    // Another tab recovered the operation and recorded it as sent meanwhile.
    const w = await S().setInboxInstagramDmSendOp(
      KEY,
      {
        ...op()!,
        state: "sent",
        receiptVersion: 3,
        sendGeneration: SG,
        inboundAt: AT,
        providerMessageId: MID,
      },
      id,
    );
    expect(w.ok).toBe(true);
    release();
    await run;
    expect(op()).toMatchObject({ operationId: id, state: "sent", providerMessageId: MID });
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
  });

  it("an unchanged preparing record is still let go: not_found Status and not_found Cancel", async () => {
    await seed("preparing");
    await checkInstagramDmReply(KEY);
    expect(op()).toBeUndefined();
    await seed("preparing", "op-dm-seeded2");
    await cancelInstagramDmReply(KEY);
    expect(op()).toBeUndefined();
  });

  it("a pre-claim refusal rollback whose read-back finds a newer receipt shows the durable truth", async () => {
    const id = await prepared();
    handler = async () => {
      // Another tab records the sent receipt right after this refusal arrives, before the rollback commits.
      setArticlesLock(async (fn) => {
        const r = await fn();
        setArticlesLock(queueLock());
        await S().setInboxInstagramDmSendOp(
          KEY,
          { ...op()!, state: "sent", receiptVersion: 3, providerMessageId: MID },
          id,
        );
        return r;
      });
      return json({ error: "no_permission" }, 403);
    };
    await confirmInstagramDmReply(KEY, target(), OPEN);
    expect(op()).toMatchObject({ state: "sent" });
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
  });
});

// DT-6B-3C: a NEW send needs at most 1000 UTF-8 bytes of the canonical text; an older prepared review over that bound
// stays readable (Check status, Cancel) but its Send creates no `confirming` mark and makes no request; the Worker's
// guaranteed pre-claim `text_invalid` on a prepared Confirm rolls the mark back like the other named pre-claim refusals.
describe("DT-6B-3C: UTF-8 byte eligibility for Prepare and Send", () => {
  const OLD = "ب".repeat(501);
  const OLD_DIGEST = dmBodyDigest(PERSON, OLD);

  it("Prepare refuses canonical text over 1000 UTF-8 bytes: zero requests, no handle; 1000 bytes is asked", async () => {
    for (const text of [OLD, "😀".repeat(251), ` ${"a".repeat(1001)} `]) {
      await prepareInstagramDmReply(KEY, target(), text, REV, OPEN);
      expect(view(), text.slice(0, 3)).toMatchObject({ phase: "error", error: "text_invalid" });
    }
    expect(calls).toEqual([]);
    expect(op()).toBeUndefined();
    const ok = "ب".repeat(500);
    handler = (c) =>
      json({
        intent: intent(c.body!.operationId, "prepared", {
          text: ok,
          digest: dmBodyDigest(PERSON, ok),
        }),
      });
    await prepareInstagramDmReply(KEY, target(), ` ${ok} `, REV, OPEN);
    expect(posts()).toEqual([`${SEND}/prepare`]);
    expect(view()).toMatchObject({ phase: "review", intent: { text: ok } });
  });

  it("a direct Send of an older prepared review over the bound: no confirming mark, no request, the review stays", async () => {
    const id = await seed("prepared", "op-dm-legacy1", { digest: OLD_DIGEST });
    handler = () => json({ intent: intent(id, "prepared", { text: OLD, digest: OLD_DIGEST }) });
    await checkInstagramDmReply(KEY);
    expect(view()).toMatchObject({ phase: "review", intent: { text: OLD, digest: OLD_DIGEST } });
    const before = op();
    calls = [];
    const marks = vi.spyOn(S(), "setInboxInstagramDmSendOp");
    await confirmInstagramDmReply(KEY, target(), OPEN);
    expect(calls).toEqual([]);
    expect(marks).not.toHaveBeenCalled();
    expect(op()).toEqual(before);
    expect(view()).toMatchObject({ phase: "review", error: "text_invalid", intent: { text: OLD } });
    // Recovery still works on it: Check status and Cancel, with the exact unchanged text and digest.
    handler = (c) =>
      json({
        intent: intent(id, c.method === "POST" ? "cancelled" : "prepared", {
          text: OLD,
          digest: OLD_DIGEST,
        }),
      });
    await checkInstagramDmReply(KEY);
    expect(view()).toMatchObject({ phase: "review", intent: { text: OLD } });
    await cancelInstagramDmReply(KEY);
    expect(view()).toMatchObject({ phase: "cancelled", intent: { text: OLD } });
    expect(op()).toBeUndefined();
    expect(posts()).toEqual([`${SEND}/${id}/cancel`]);
    // The private draft is never touched by any of this.
    expect(S().inboxDrafts[SCOPE]?.commitId).toBe(REV);
  });

  it("the Worker's text_invalid on a prepared Confirm is a precise pre-claim refusal: the mark rolls back", async () => {
    const id = await prepared();
    handler = () => json({ error: "text_invalid" }, 400);
    await confirmInstagramDmReply(KEY, target(), OPEN);
    expect(calls).toHaveLength(1);
    expect(view()).toMatchObject({
      phase: "review",
      error: "text_invalid",
      intent: { operationId: id },
    });
    expect(op()).toMatchObject({ state: "prepared", receiptVersion: 1 });
  });
});
