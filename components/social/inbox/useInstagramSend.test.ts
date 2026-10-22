// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxScope } from "@/lib/inbox";
import { instagramSendDigest } from "@/lib/inboxInstagramSend";
import { STORAGE_KEY, inboxDraftBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import { resetInbox, useInbox } from "./useInbox";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";
import {
  cancelInstagramReply,
  checkInstagramReply,
  confirmInstagramReply,
  finishInstagramReply,
  igOpKey,
  newInstagramCommentVisit,
  onInstagramDraftCleared,
  prepareInstagramReply,
  resetInstagramSendViews,
  useInstagramSendViews,
  type InstagramSendTarget,
} from "./useInstagramSend";

// 📤 Reviewed Instagram public comment replies, client side (packet DT-6B-2C-4). Production readiness is closed
// (`instagramSendReadiness`), so nothing below the gate runs in the app; this file reaches the future enabled path ONLY by
// injecting `{ readiness }` into the actions, never a shipped switch. The handle is persisted before every request; an
// answer applies only when its exact receipt is the durable handle after the commit; the fences (config epoch, URL and
// token, provider visit, account + READER generation, media selection, draft revision, latest action) hold after every
// await; unknown, dispatching, lost and malformed outcomes offer Check status only; recovery (status, prepared cancel)
// needs no readiness, row or account read and goes only to the handle's own Worker. Transport is a fake Worker.

const OPEN = { readiness: () => ({ ok: true }) as const };
const WORKER = "https://scout.test";
const RG = "c".repeat(32);
const RG2 = "d".repeat(32);
/** The send generation the Worker derives: never the reader's. */
const SG = "e".repeat(32);
const ME = "17841000000000001";
const MEDIA = "18000000000000001";
const COMMENT = "17900000000000001";
const REPLY = "17950000000000001";
const SCOPE = inboxScope(WORKER, ME, "comment", COMMENT);
const KEY = igOpKey(SCOPE);
const TEXT = "  Thanks so much!\r\n  🎬  ";
const CANON = TEXT.trim();
const SEND = "/social/inbox/instagram/send";

const S = () => useStore.getState();
const view = () => useInstagramSendViews.getState().views[SCOPE];
const op = () => S().inboxInstagramSendOps[KEY];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let REV = "";
const target = (over: Partial<InstagramSendTarget> = {}): InstagramSendTarget => ({
  account: ME,
  readerGeneration: RG,
  mediaId: MEDIA,
  commentId: COMMENT,
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
// The real coordinator's proof per state (DT-6B-2C-4-R1 fixture correction: dispatching carries its claim, sent its claim
// and settlement, as every genuine Worker answer does).
const PROOF: Record<string, Record<string, unknown>> = {
  dispatching: { claimedAt: "2026-10-17T09:01:00.000Z" },
  sent: {
    providerReplyId: REPLY,
    claimedAt: "2026-10-17T09:01:00.000Z",
    settledAt: "2026-10-17T09:02:00.000Z",
  },
  rejected: { failureCode: "meta_10" },
  unknown: { unknownReason: "timeout" },
  already_claimed: { failureCode: "already_claimed", failureDetail: "automatic" },
};
const intent = (operationId: string, state = "prepared", over: Record<string, unknown> = {}) => ({
  operationId,
  provider: "instagram",
  account: ME,
  generation: SG,
  mediaId: MEDIA,
  commentId: COMMENT,
  text: CANON,
  digest: instagramSendDigest(TEXT),
  draftRevision: REV,
  state,
  reviewExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:00.000Z",
  receiptVersion: VERSION[state],
  ...PROOF[state],
  ...over,
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

/** The Instagram inbox on screen: this account (reader generation) and this post open. */
function instagramOn(accountId = ME, generation = RG, mediaId: string | null = MEDIA) {
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
    mediaId,
  });
}

/** A handle as an earlier session left it (the Worker's receipt of `state`). */
async function seed(
  state: string,
  operationId = "op-ig-seeded1",
  over: Record<string, unknown> = {},
) {
  const i = intent(operationId, state) as Record<string, unknown>;
  const local = state === "preparing" || state === "confirming";
  const r = await S().setInboxInstagramSendOp(
    KEY,
    {
      operationId,
      workerOrigin: WORKER,
      account: ME,
      mediaId: MEDIA,
      commentId: COMMENT,
      draftRevision: REV,
      digest: i.digest as string,
      state: state as never,
      ...(local ? {} : { receiptVersion: i.receiptVersion as number, sendGeneration: SG }),
      ...(i.providerReplyId && state === "sent" ? { providerReplyId: REPLY } : {}),
      ...over,
    },
    null,
  );
  if (!r.ok) throw new Error(r.reason);
  return operationId;
}

/** Prepare through the fake Worker, landing in review. */
async function prepared() {
  handler = (c) => json({ intent: intent(c.body!.operationId) });
  await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
  expect(view().phase).toBe("review");
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

/** A clean device: configured Worker, Instagram on screen, the draft saved (REV is its revision). */
async function fresh() {
  localStorage.clear();
  S().reset();
  S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetInstagramSendViews();
  resetInbox();
  instagramOn();
  const d = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
  if (!d.ok || !d.draft) throw new Error("draft");
  REV = d.draft.commitId;
}

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
    await prepareInstagramReply(SCOPE, target(), TEXT, REV);
    expect(view()).toMatchObject({
      phase: "error",
      error: "unavailable",
      detail: "permission_unverified",
    });
    expect(op()).toBeUndefined();
    await confirmInstagramReply(SCOPE, target());
    expect(calls).toEqual([]);
  });

  it("a retained unknown operation is still checked (status only), once, with no row, draft, account or permission", async () => {
    const id = await seed("unknown");
    await S().discardInboxDraft(SCOPE, inboxDraftBase(S().inboxDrafts[SCOPE]));
    useInbox.setState({ account: null, accountError: "token_expired", mediaId: null });
    handler = () => json({ intent: intent(id, "unknown") });
    await checkInstagramReply(SCOPE);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${SEND}/${id}?account=${ME}`]);
    expect(calls[0].redirect).toBe("manual");
    expect(view()).toMatchObject({ phase: "unknown", intent: { operationId: id } });
    expect(op()!.state).toBe("unknown");
  });
});

describe("prepare (enabled only by injection)", () => {
  it("persists `preparing` BEFORE the request, sends the raw selectors, learns the send generation, opens the review", async () => {
    let seen: unknown;
    handler = (c) => {
      seen = stored().inboxInstagramSendOps[KEY];
      return json({ intent: intent(c.body!.operationId) });
    };
    await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    expect(seen).toMatchObject({
      state: "preparing",
      workerOrigin: WORKER,
      account: ME,
      mediaId: MEDIA,
      commentId: COMMENT,
      draftRevision: REV,
      digest: instagramSendDigest(TEXT),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: `${SEND}/prepare`,
      redirect: "manual",
      auth: "Bearer owner-token",
    });
    expect(calls[0].body).toEqual({
      operationId: op()!.operationId,
      account: ME,
      mediaId: MEDIA,
      commentId: COMMENT,
      text: TEXT,
      draftRevision: REV,
    });
    // The review shows the Worker's canonical text; one click never confirms.
    expect(view()).toMatchObject({ phase: "review", intent: { text: CANON } });
    expect(op()).toMatchObject({ state: "prepared", receiptVersion: 1, sendGeneration: SG });
    // The reader generation was never sent, stored or compared.
    expect(JSON.stringify(stored().inboxInstagramSendOps)).not.toContain(RG);
    expect(JSON.stringify(stored().inboxInstagramSendOps)).not.toContain("Thanks");
  });

  it("needs the saved exact revision: another revision makes no request", async () => {
    await prepareInstagramReply(SCOPE, target(), TEXT, "rev-not-saved", OPEN);
    expect(calls).toEqual([]);
    expect(view().phase).toBe("closed");
    expect(op()).toBeUndefined();
  });

  it("a write the browser refuses means zero requests", async () => {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    expect(calls).toEqual([]);
    expect(view()).toMatchObject({ phase: "error", error: "notPersisted" });
    expect(op()).toBeUndefined();
  });

  it("converges on another tab's operation only through a durable write", async () => {
    handler = () => json({ intent: intent("op-ig-canon01") });
    await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    expect(op()).toMatchObject({ operationId: "op-ig-canon01", state: "prepared" });
    expect(view()).toMatchObject({ phase: "review", intent: { operationId: "op-ig-canon01" } });
  });

  it("canonical convergence opens its review only when that exact receipt is still the stored one", async () => {
    handler = () => json({ intent: intent("op-ig-canon01") });
    let injected = false;
    setArticlesLock(async (fn) => {
      const r = (await fn()) as { ok: boolean; op?: { state?: string } | null };
      if (!injected && r.ok && r.op?.state === "prepared") {
        injected = true;
        setArticlesLock(queueLock());
        const w = await S().setInboxInstagramSendOp(
          KEY,
          {
            ...op()!,
            state: "already_claimed",
            receiptVersion: 2,
          },
          "op-ig-canon01",
        );
        if (!w.ok) throw new Error(w.reason);
      }
      return r as never;
    });
    await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    expect(injected).toBe(true);
    expect(op()!.state).toBe("already_claimed");
    expect(view()).toMatchObject({ phase: "error", error: "superseded", intent: null });
  });

  it("an answer about another comment, media, account or text is not trusted; the handle stays", async () => {
    for (const over of [
      { commentId: "17900000000000002" },
      { mediaId: "18000000000000002" },
      { account: "17841000000000002" },
      { text: "other", digest: instagramSendDigest("other") },
    ]) {
      await fresh();
      handler = (c) => json({ intent: intent(c.body!.operationId, "prepared", over) });
      await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
      expect(view()).toMatchObject({ phase: "uncertain", error: "mismatch" });
      expect(op()!.state).toBe("preparing");
    }
  });

  it("a refused prepare lets its handle go, keeping only allowlisted details", async () => {
    handler = () => json({ error: "target_unverified", detail: "outside-local-window" }, 409);
    await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    expect(view()).toMatchObject({
      phase: "error",
      error: "target_unverified",
      detail: "outside-local-window",
    });
    expect(op()).toBeUndefined();
  });

  it("an unresolved handle blocks a new prepare, with zero requests", async () => {
    for (const state of ["preparing", "confirming", "prepared", "dispatching", "unknown"]) {
      await fresh();
      await seed(state);
      await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
      expect(view()).toMatchObject({ phase: "error", error: "unresolved" });
      expect(op()!.state).toBe(state);
    }
    expect(calls).toEqual([]);
  });

  it("refuses with capacity when 50 unresolved handles are kept, and asks nothing", async () => {
    for (let i = 0; i < 50; i++) {
      const r = await S().setInboxInstagramSendOp(
        `instagram|https%3A%2F%2Fscout.test|${ME}|comment|${i}`,
        {
          operationId: `op-ig-unres-${String(i).padStart(4, "0")}`,
          workerOrigin: WORKER,
          account: ME,
          mediaId: MEDIA,
          commentId: String(i),
          draftRevision: "rev-x",
          digest: "a".repeat(64),
          state: "unknown",
          receiptVersion: 3,
        },
        null,
      );
      if (!r.ok) throw new Error(r.reason);
    }
    await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    expect(view()).toMatchObject({ phase: "error", error: "capacity" });
    expect(calls).toEqual([]);
  });
});

describe("fences: a move while a handle is written sends nothing; A → B → A never revives", () => {
  const moves: [string, () => void | Promise<void>][] = [
    [
      "provider away and back",
      () => {
        useProviderInbox.setState({ provider: "threads" });
        useProviderInbox.setState({ provider: "instagram" });
      },
    ],
    [
      "account B and back to A",
      () => {
        instagramOn("17841000000000002");
        instagramOn();
      },
    ],
    ["a reconnect (new reader generation)", () => instagramOn(ME, RG2)],
    [
      "another post and back",
      () => {
        useInbox.setState({ mediaId: "18000000000000002" });
        useInbox.setState({ mediaId: MEDIA });
      },
    ],
    [
      "token B and back to A",
      () => {
        S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "other-token" } });
        S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
        instagramOn();
      },
    ],
    [
      "Worker B and back to A",
      () => {
        S().setSettings({ apiKeys: { scoutUrl: "https://other.test", scoutToken: "owner-token" } });
        S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
        instagramOn();
      },
    ],
  ];
  for (const [name, move] of moves) {
    it(`${name}: prepare makes zero requests and closes`, async () => {
      const release = holdLock();
      const run = prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
      await move();
      release();
      await run;
      expect(calls).toEqual([]);
      expect(view().phase).toBe("closed");
      expect(op()).toBeUndefined();
    });

    it(`${name}: Send's pending mark rolls back and confirms nothing`, async () => {
      const id = await prepared();
      const release = holdLock();
      const run = confirmInstagramReply(SCOPE, target(), OPEN);
      await move();
      release();
      await run;
      expect(calls).toEqual([]);
      expect(view().phase).toBe("closed");
      expect(op()).toMatchObject({ operationId: id, state: "prepared" });
      await new Promise((r) => setTimeout(r, 10));
      expect(calls).toEqual([]);
    });
  }

  it("a newer draft revision saved (another tab) while the handle is written sends nothing", async () => {
    const release = holdLock();
    const run = prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    const disk = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    disk.state.inboxDrafts[SCOPE] = {
      text: "newer words",
      updatedAt: new Date().toISOString(),
      commitId: "rev-newer-0001",
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(disk));
    release();
    await run;
    expect(calls).toEqual([]);
    expect(view().phase).toBe("closed");
    expect(op()).toBeUndefined();
  });

  it("only the newest action of a scope changes the view", async () => {
    const id = await seed("unknown");
    let first!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (first = r));
    const older = checkInstagramReply(SCOPE);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    handler = () => json({ intent: intent(id, "sent", { receiptVersion: 4 }) });
    await checkInstagramReply(SCOPE);
    expect(view().phase).toBe("sent");
    first(json({ intent: intent(id, "unknown") }));
    await older;
    expect(view().phase).toBe("sent");
    expect(op()!.state).toBe("sent");
  });
});

describe("send and recovery", () => {
  it("marks `confirming` BEFORE the one confirm request; sent records the immutable reply id", async () => {
    const id = await prepared();
    let seen: unknown;
    handler = () => {
      seen = stored().inboxInstagramSendOps[KEY]?.state;
      return json({ intent: intent(id, "sent") });
    };
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(seen).toBe("confirming");
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${SEND}/confirm`]);
    expect(calls[0].body).toEqual({
      operationId: id,
      digest: instagramSendDigest(TEXT),
      account: ME,
    });
    expect(view()).toMatchObject({ phase: "sent", intent: { providerReplyId: REPLY } });
    expect(op()).toMatchObject({ state: "sent", providerReplyId: REPLY, sendGeneration: SG });
  });

  it("the reader generation is never compared with the send generation (they differ by design)", async () => {
    expect(RG).not.toBe(SG);
    const id = await prepared();
    handler = () => json({ intent: intent(id, "sent") });
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(view().phase).toBe("sent");
  });

  it("Send while production readiness is closed asks nothing; a failed mark write asks nothing", async () => {
    const id = await prepared();
    await confirmInstagramReply(SCOPE, target());
    expect(calls).toEqual([]);
    expect(view()).toMatchObject({ phase: "review", error: "unavailable" });
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(calls).toEqual([]);
    expect(view()).toMatchObject({ phase: "review", error: "notPersisted" });
    expect(op()).toMatchObject({ operationId: id, state: "prepared" });
  });

  for (const [name, answer] of [
    ["a lost answer", () => Promise.reject(new TypeError("offline"))],
    ["a malformed answer", () => json({ intent: { state: "sent" } })],
    ["a mixed envelope", () => json({ intent: intent("op-x-000001", "sent"), error: "conflict" })],
    [
      "a redirect",
      () => new Response(null, { status: 302, headers: { Location: "https://evil.test/" } }),
    ],
    ["an unknown receipt store", () => json({ error: "receipt_unavailable" }, 503)],
    ["not_found", () => json({ error: "not_found" }, 404)],
  ] as const)
    it(`${name} after Send is local uncertainty: Check status only, nothing resent`, async () => {
      await prepared();
      handler = answer as never;
      await confirmInstagramReply(SCOPE, target(), OPEN);
      expect(view().phase).toBe("uncertain");
      expect(op()!.state).toBe("confirming");
      expect(calls).toHaveLength(1);
      // Send again is impossible from here, and nothing runs by itself.
      await confirmInstagramReply(SCOPE, target(), OPEN);
      await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
      await new Promise((r) => setTimeout(r, 10));
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    });

  it("a status not_found never clears a confirming handle (never proof of non-delivery)", async () => {
    await seed("confirming");
    await checkInstagramReply(SCOPE);
    expect(view()).toMatchObject({ phase: "uncertain", error: "not_found" });
    expect(op()!.state).toBe("confirming");
  });

  it("a refusal before any claim rolls the mark back and the review stands", async () => {
    const id = await prepared();
    handler = () => json({ error: "stale", detail: "reconnected" }, 409);
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(view()).toMatchObject({ phase: "review", error: "stale", detail: "reconnected" });
    expect(op()).toMatchObject({ operationId: id, state: "prepared" });
  });

  for (const state of ["dispatching", "unknown"])
    it(`${state} is status only: Send makes no request`, async () => {
      const id = await seed(state);
      handler = () => json({ intent: intent(id, state, state === "unknown" ? {} : {}) });
      await checkInstagramReply(SCOPE);
      expect(view().phase).toBe(state);
      calls = [];
      await confirmInstagramReply(SCOPE, target(), OPEN);
      expect(calls).toEqual([]);
    });

  it("a lost receipt (unknown, no settled time) and a later dispatching read of the same claim stay status only", async () => {
    const id = await prepared();
    handler = () =>
      json({ intent: intent(id, "unknown", { receiptVersion: 2, unknownReason: "receipt" }) });
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(view().phase).toBe("unknown");
    expect(op()).toMatchObject({ state: "unknown", receiptVersion: 2 });
    handler = () => json({ intent: intent(id, "dispatching", { receiptVersion: 2 }) });
    await checkInstagramReply(SCOPE);
    expect(view()).toMatchObject({ phase: "dispatching", error: null });
    // The stored uncertainty is never regressed.
    expect(op()).toMatchObject({ state: "unknown", receiptVersion: 2 });
    handler = () => json({ intent: intent(id, "sent", { receiptVersion: 3 }) });
    await checkInstagramReply(SCOPE);
    expect(op()).toMatchObject({ state: "sent", providerReplyId: REPLY });
  });

  it("an older or contradictory receipt never replaces newer proof: superseded with Check status", async () => {
    const id = await seed("sent");
    handler = () => json({ intent: intent(id, "dispatching") });
    await checkInstagramReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
    expect(op()).toMatchObject({ state: "sent", providerReplyId: REPLY });
    handler = () =>
      json({
        intent: intent(id, "sent", { receiptVersion: 9, providerReplyId: "17950000000000777" }),
      });
    await checkInstagramReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "mismatch" });
    expect(op()).toMatchObject({ providerReplyId: REPLY, receiptVersion: 3 });
  });

  it("Check status shows its answer only when that exact receipt is still the stored one", async () => {
    const id = await seed("unknown");
    handler = () => json({ intent: intent(id, "unknown") });
    let injected = false;
    setArticlesLock(async (fn) => {
      const r = (await fn()) as { ok: boolean; op?: { state?: string } | null };
      if (!injected && r.ok && r.op?.state === "unknown") {
        injected = true;
        setArticlesLock(queueLock());
        const w = await S().setInboxInstagramSendOp(
          KEY,
          { ...op()!, state: "sent", receiptVersion: 4, providerReplyId: REPLY },
          id,
        );
        if (!w.ok) throw new Error(w.reason);
      }
      return r as never;
    });
    await checkInstagramReply(SCOPE);
    expect(injected).toBe(true);
    expect(op()!.state).toBe("sent");
    expect(view()).toMatchObject({ phase: "error", error: "superseded", intent: null });
  });

  it("a status write the browser refuses shows unrecorded, never the unsaved answer", async () => {
    const id = await seed("unknown");
    handler = () => json({ intent: intent(id, "sent", { receiptVersion: 4 }) });
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await checkInstagramReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "unrecorded" });
    expect(op()!.state).toBe("unknown");
  });

  it("recovers by the stored account when another account is loaded", async () => {
    const id = await seed("unknown");
    instagramOn("17841000000000002", RG2, null);
    handler = () => json({ intent: intent(id, "unknown") });
    await checkInstagramReply(SCOPE);
    expect(calls.map((c) => c.path)).toEqual([`${SEND}/${id}?account=${ME}`]);
    expect(view().phase).toBe("unknown");
  });

  it("another Worker's handle (or a cleared configuration) is never asked; the current token never goes there", async () => {
    await seed("unknown", "op-ig-foreign1", { workerOrigin: "https://old.test" });
    await checkInstagramReply(SCOPE);
    await cancelInstagramReply(SCOPE);
    expect(calls).toEqual([]);
    expect(view().phase).toBe("closed");
    S().setSettings({ apiKeys: {} });
    await checkInstagramReply(SCOPE);
    expect(calls).toEqual([]);
    expect(op()).toMatchObject({ operationId: "op-ig-foreign1", state: "unknown" });
  });
});

describe("cancel and finish", () => {
  it("a proven cancel of a review ends on its validated receipt and removes the handle", async () => {
    const id = await prepared();
    handler = () => json({ intent: intent(id, "cancelled") });
    await cancelInstagramReply(SCOPE);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${SEND}/${id}/cancel`]);
    expect(calls[0].body).toEqual({ account: ME });
    expect(view()).toMatchObject({ phase: "cancelled", intent: { state: "cancelled" } });
    expect(op()).toBeUndefined();
  });

  it("cancel needs no readiness or account read; a failed cancel keeps the handle; a no-op never claims success", async () => {
    const id = await seed("prepared");
    useInbox.setState({ account: null, accountError: "upstream", mediaId: null });
    handler = () => Promise.reject(new TypeError("offline"));
    await cancelInstagramReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "cancelFailed" });
    expect(op()!.state).toBe("prepared");
    // The Worker says the operation already moved on: that is the truth shown, not "cancelled".
    handler = () => json({ intent: intent(id, "dispatching") });
    await cancelInstagramReply(SCOPE);
    expect(view().phase).toBe("dispatching");
    expect(op()!.state).toBe("dispatching");
  });

  it("an expired answer to Cancel says expired", async () => {
    const id = await prepared();
    handler = () => json({ intent: intent(id, "expired") });
    await cancelInstagramReply(SCOPE);
    expect(view().phase).toBe("expired");
    expect(op()).toBeUndefined();
  });

  it("Clear draft after sent discards only the submitted revision, announcing it; a newer draft stays", async () => {
    const heard: string[] = [];
    const off = onInstagramDraftCleared((s, d) => heard.push(`${s}:${d.commitId}`));
    const id = await prepared();
    handler = () => json({ intent: intent(id, "sent") });
    await confirmInstagramReply(SCOPE, target(), OPEN);
    // A newer revision was saved after the review: Clear keeps it.
    const newer = await S().saveInboxDraft(SCOPE, "newer", inboxDraftBase(S().inboxDrafts[SCOPE]));
    expect(await finishInstagramReply(SCOPE, true)).toBeNull();
    expect(S().inboxDrafts[SCOPE]?.text).toBe("newer");
    expect(heard).toEqual([]);
    expect(op()).toBeUndefined();
    // The exact submitted revision is discarded and announced once.
    if (!newer.ok) throw new Error("save");
    await fresh();
    const id2 = await prepared();
    handler = () => json({ intent: intent(id2, "sent") });
    await confirmInstagramReply(SCOPE, target(), OPEN);
    const cleared = await finishInstagramReply(SCOPE, true);
    expect(cleared).toMatchObject({ commitId: REV, text: TEXT });
    expect(S().inboxDrafts[SCOPE]).toBeUndefined();
    expect(heard).toEqual([`${SCOPE}:${REV}`]);
    off();
  });

  it("an unresolved operation is never finished", async () => {
    await seed("unknown");
    expect(await finishInstagramReply(SCOPE, true)).toBeNull();
    expect(op()!.state).toBe("unknown");
    expect(S().inboxDrafts[SCOPE]).toBeDefined();
  });
});

// 📤 DT-6B-2C-4-R1: the five client repairs. Every enabled path is still reached only by injecting `{ readiness }`.
describe("DT-6B-2C-4-R1 (2C4-1): a preparing handle is let go only while it is that exact unchanged record", () => {
  /** Hold the Prepare answer after its `preparing` handle is durable; returns its operation id and the release. */
  async function heldPrepare() {
    let answer!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (answer = r));
    const run = prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    return { id: op()!.operationId, run, answer: (r: Response) => answer(r) };
  }
  /** Check status records `prepared`, then an explicit Send loses its answer: the pending mark stays. */
  async function confirmLost(id: string) {
    handler = () => json({ intent: intent(id) });
    await checkInstagramReply(SCOPE);
    expect(view().phase).toBe("review");
    handler = () => Promise.reject(new TypeError("offline"));
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(op()).toMatchObject({ operationId: id, state: "confirming" });
    expect(view().phase).toBe("uncertain");
  }
  const newer: [string, (id: string) => Promise<void>, Record<string, unknown>, string][] = [
    ["a pending Confirm", confirmLost, { state: "confirming", receiptVersion: 1 }, "uncertain"],
    [
      "an unknown outcome",
      async (id) => {
        handler = () => json({ intent: intent(id, "unknown") });
        await checkInstagramReply(SCOPE);
      },
      { state: "unknown", receiptVersion: 3 },
      "unknown",
    ],
    [
      "a sent receipt",
      async (id) => {
        handler = () => json({ intent: intent(id, "sent") });
        await checkInstagramReply(SCOPE);
      },
      { state: "sent", providerReplyId: REPLY },
      "sent",
    ],
  ];
  for (const [name, advance, kept, phase] of newer) {
    it(`a late failed Prepare keeps ${name} of its operation (memory and disk)`, async () => {
      const p = await heldPrepare();
      await advance(p.id);
      const posts = calls.filter((c) => c.method === "POST").length;
      p.answer(json({ error: "upstream" }, 502));
      await p.run;
      expect(op()).toMatchObject({ operationId: p.id, ...kept });
      expect(stored().inboxInstagramSendOps[KEY]).toMatchObject({ operationId: p.id, ...kept });
      expect(view().phase).toBe(phase);
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(posts);
    });

    it(`a stale not_found looked up while preparing keeps ${name}`, async () => {
      const id = await seed("preparing");
      let first!: (r: Response) => void;
      handler = () => new Promise<Response>((r) => (first = r));
      const older = checkInstagramReply(SCOPE);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await advance(id);
      first(json({ error: "not_found" }, 404));
      await older;
      expect(op()).toMatchObject({ operationId: id, ...kept });
      expect(stored().inboxInstagramSendOps[KEY]).toMatchObject({ operationId: id, ...kept });
      expect(view().phase).toBe(phase);
    });
  }

  it("the newest action sees its own late cleanup refused: superseded with Check status", async () => {
    const id = await seed("preparing");
    let first!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (first = r));
    const run = checkInstagramReply(SCOPE);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    // Another tab recorded the sent receipt of the same operation meanwhile.
    const w = await S().setInboxInstagramSendOp(
      KEY,
      { ...op()!, state: "sent", receiptVersion: 3, sendGeneration: SG, providerReplyId: REPLY },
      id,
    );
    if (!w.ok) throw new Error(w.reason);
    first(json({ error: "not_found" }, 404));
    await run;
    expect(op()).toMatchObject({ state: "sent", providerReplyId: REPLY });
    expect(view()).toMatchObject({ phase: "error", error: "superseded", intent: null });
  });

  it("an unchanged preparing record is still let go: failed Prepare, not_found Status, not_found Cancel", async () => {
    handler = () => json({ error: "upstream" }, 502);
    await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    expect(view()).toMatchObject({ phase: "error", error: "upstream" });
    expect(op()).toBeUndefined();
    expect(stored().inboxInstagramSendOps[KEY]).toBeUndefined();
    await seed("preparing");
    handler = () => json({ error: "not_found" }, 404);
    await checkInstagramReply(SCOPE);
    expect(view().phase).toBe("idle");
    expect(op()).toBeUndefined();
    await seed("preparing");
    await cancelInstagramReply(SCOPE);
    expect(op()).toBeUndefined();
    expect(stored().inboxInstagramSendOps[KEY]).toBeUndefined();
  });
});

describe("DT-6B-2C-4-R1 (2C4-2/2C4-3): a prepared read never undoes a pending or uncertain Confirm", () => {
  const posts = () => calls.filter((c) => c.method === "POST");

  it("an old prepared status released after a lost Confirm keeps the mark: status only", async () => {
    const id = await prepared();
    let first!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (first = r));
    const older = checkInstagramReply(SCOPE);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    handler = () => Promise.reject(new TypeError("offline"));
    await confirmInstagramReply(SCOPE, target(), OPEN);
    first(json({ intent: intent(id) }));
    await older;
    expect(op()).toMatchObject({ operationId: id, state: "confirming", receiptVersion: 1 });
    expect(stored().inboxInstagramSendOps[KEY].state).toBe("confirming");
    expect(view().phase).toBe("uncertain");
    // Send cannot run again from here.
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(posts()).toHaveLength(1);
  });

  it("a fresh prepared status while Confirm is pending stays status only; that Confirm's pre-claim refusal rolls back its own mark", async () => {
    const id = await prepared();
    let pending!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (pending = r));
    const run = confirmInstagramReply(SCOPE, target(), OPEN);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    handler = () => json({ intent: intent(id) });
    await checkInstagramReply(SCOPE);
    expect(op()).toMatchObject({ state: "confirming" });
    expect(view()).toMatchObject({ phase: "uncertain", intent: { state: "prepared" } });
    // No Send while the Confirm may still land.
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(posts()).toHaveLength(1);
    pending(json({ error: "no_permission", detail: "permission_unverified" }, 403));
    await run;
    // The refusal came before any claim: the exact mark goes back (the newer Check owns the view).
    expect(op()).toMatchObject({ operationId: id, state: "prepared", receiptVersion: 1 });
    expect(posts()).toHaveLength(1);
    handler = () => json({ intent: intent(id) });
    await checkInstagramReply(SCOPE);
    expect(view().phase).toBe("review");
  });

  it("a fresh prepared status while Confirm is pending, then a lost answer: still the mark, Check status only", async () => {
    const id = await prepared();
    let pending!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (pending = r));
    const run = confirmInstagramReply(SCOPE, target(), OPEN);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    handler = () => json({ intent: intent(id) });
    await checkInstagramReply(SCOPE);
    pending(json({ error: "receipt_unavailable" }, 503));
    await run;
    expect(op()).toMatchObject({ operationId: id, state: "confirming" });
    expect(view().phase).not.toBe("review");
    await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(posts()).toHaveLength(1);
  });

  for (const [code, detail] of [
    ["no_permission", "permission_unverified"],
    ["stale", "reconnected"],
    ["account_mismatch", "identity"],
    ["target_unverified", "outside-local-window"],
    ["token_expired", undefined],
    ["text_invalid", undefined],
    ["conflict", undefined],
  ] as const)
    it(`a conclusive pre-claim refusal (${code}) rolls the exact mark back and the review stands`, async () => {
      const id = await prepared();
      handler = () => json({ error: code, ...(detail ? { detail } : {}) }, 409);
      await confirmInstagramReply(SCOPE, target(), OPEN);
      expect(view()).toMatchObject({ phase: "review", error: code, ...(detail ? { detail } : {}) });
      expect(op()).toMatchObject({ operationId: id, state: "prepared", receiptVersion: 1 });
      expect(posts()).toHaveLength(1);
    });

  for (const [code, status] of [
    ["rate_limited", 429],
    ["bad_request", 400],
    ["not_configured", 503],
    ["not_connected", 409],
  ] as const)
    it(`a refusal that is not conclusively before the claim (${code}) is status only; nothing resent`, async () => {
      await prepared();
      handler = () => json({ error: code }, status);
      await confirmInstagramReply(SCOPE, target(), OPEN);
      expect(view()).toMatchObject({ phase: "uncertain", error: code });
      expect(op()!.state).toBe("confirming");
      await confirmInstagramReply(SCOPE, target(), OPEN);
      await prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
      expect(posts()).toHaveLength(1);
    });

  for (const outcome of ["cancelled", "sent", "dispatching"] as const)
    it(`a real ${outcome} recorded while Confirm is pending lands, and the Confirm answer keeps it`, async () => {
      const id = await prepared();
      let pending!: (r: Response) => void;
      handler = () => new Promise<Response>((r) => (pending = r));
      const run = confirmInstagramReply(SCOPE, target(), OPEN);
      await vi.waitFor(() => expect(posts()).toHaveLength(1));
      handler = () => json({ intent: intent(id, outcome) });
      await checkInstagramReply(SCOPE);
      expect(op()!.state).toBe(outcome);
      expect(view().phase).toBe(outcome);
      pending(json({ intent: intent(id, outcome) }));
      await run;
      expect(op()!.state).toBe(outcome);
      expect(posts()).toHaveLength(1);
    });

  it("a refusal rollback whose read-back finds a newer receipt shows the durable truth (2C4-3)", async () => {
    const id = await prepared();
    handler = () => json({ error: "no_permission", detail: "permission_unverified" }, 403);
    let injected = false;
    setArticlesLock(async (fn) => {
      const r = (await fn()) as { ok: boolean; op?: { state?: string } | null };
      if (!injected && r.ok && r.op?.state === "prepared") {
        injected = true;
        setArticlesLock(queueLock());
        const w = await S().setInboxInstagramSendOp(
          KEY,
          { ...op()!, state: "sent", receiptVersion: 3, providerReplyId: REPLY },
          id,
        );
        if (!w.ok) throw new Error(w.reason);
      }
      return r as never;
    });
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(injected).toBe(true);
    expect(op()).toMatchObject({ state: "sent", providerReplyId: REPLY });
    expect(view()).toMatchObject({ phase: "error", error: "superseded", intent: null });
    expect(posts()).toHaveLength(1);
  });

  it("a before-request rollback whose mark another writer already moved keeps that newer proof", async () => {
    const id = await prepared();
    let injected = false;
    setArticlesLock(async (fn) => {
      const r = (await fn()) as { ok: boolean; op?: { state?: string } | null };
      if (!injected && r.ok && r.op?.state === "confirming") {
        injected = true;
        setArticlesLock(queueLock());
        // The fence fails (another post) and another tab records sent before the rollback commits.
        useInbox.setState({ mediaId: "18000000000000002" });
        const w = await S().setInboxInstagramSendOp(
          KEY,
          { ...op()!, state: "sent", receiptVersion: 3, providerReplyId: REPLY },
          id,
        );
        if (!w.ok) throw new Error(w.reason);
      }
      return r as never;
    });
    await confirmInstagramReply(SCOPE, target(), OPEN);
    expect(injected).toBe(true);
    expect(calls).toEqual([]);
    expect(op()).toMatchObject({ state: "sent", providerReplyId: REPLY });
    expect(stored().inboxInstagramSendOps[KEY].state).toBe("sent");
  });
});

describe("DT-6B-2C-4-R1 (2C4-4): a change of the comment/editor visit before dispatch sends nothing", () => {
  const moves: [string, () => void][] = [
    ["another comment's editor", () => newInstagramCommentVisit()],
    [
      "comment A → B → A",
      () => {
        newInstagramCommentVisit();
        newInstagramCommentVisit();
      },
    ],
    [
      "the Messages tab and back",
      () => {
        useInbox.setState({ tab: "messages" });
        useInbox.setState({ tab: "comments" });
      },
    ],
  ];
  for (const [name, move] of moves) {
    it(`${name} during Prepare's durability: zero requests, no handle`, async () => {
      const release = holdLock();
      const run = prepareInstagramReply(SCOPE, target(), TEXT, REV, OPEN);
      move();
      release();
      await run;
      expect(calls).toEqual([]);
      expect(op()).toBeUndefined();
      expect(view().phase).toBe("closed");
    });

    it(`${name} during Confirm's durability: zero requests, the exact mark rolls back`, async () => {
      const id = await prepared();
      const release = holdLock();
      const run = confirmInstagramReply(SCOPE, target(), OPEN);
      move();
      release();
      await run;
      await new Promise((r) => setTimeout(r, 10));
      expect(calls).toEqual([]);
      expect(op()).toMatchObject({ operationId: id, state: "prepared", receiptVersion: 1 });
      expect(view().phase).toBe("closed");
    });
  }

  it("recovery is independent of the visit: Check status and Cancel still ask the handle's Worker once", async () => {
    const id = await seed("prepared");
    handler = () => json({ intent: intent(id) });
    const release = holdLock();
    const run = checkInstagramReply(SCOPE);
    newInstagramCommentVisit();
    useInbox.setState({ tab: "messages" });
    release();
    await run;
    expect(calls).toHaveLength(1);
    expect(view().phase).toBe("review");
    handler = () => json({ intent: intent(id, "cancelled") });
    newInstagramCommentVisit();
    await cancelInstagramReply(SCOPE);
    expect(calls).toHaveLength(2);
    expect(op()).toBeUndefined();
  });
});

describe("DT-6B-2C-4-R1 (2C4-5): contradictory state proof never removes recovery or shows success", () => {
  const T = "2026-10-17T09:05:00.000Z";
  it("Cancel answered `cancelled` with a claim: the handle stays, no cancelled screen", async () => {
    const id = await seed("prepared");
    handler = () => json({ intent: intent(id, "cancelled", { claimedAt: T, settledAt: T }) });
    await cancelInstagramReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "cancelFailed" });
    expect(op()).toMatchObject({ operationId: id, state: "prepared" });
    expect(stored().inboxInstagramSendOps[KEY].state).toBe("prepared");
  });

  for (const [name, state, over, drop] of [
    ["prepared with a claim", "prepared", { claimedAt: T }, []],
    ["cancelled with a claim", "cancelled", { claimedAt: T }, []],
    ["sent without its settlement", "sent", {}, ["settledAt"]],
    ["dispatching without its claim", "dispatching", {}, ["claimedAt"]],
  ] as const)
    it(`Check status answered ${name}: nothing recorded, no review or success, Check status stays`, async () => {
      const id = await seed("confirming");
      const x: Record<string, unknown> = { ...intent(id, state), ...over };
      for (const k of drop) delete x[k];
      handler = () => json({ intent: x });
      await checkInstagramReply(SCOPE);
      expect(view()).toMatchObject({ phase: "uncertain", error: "upstream" });
      expect(op()).toMatchObject({ operationId: id, state: "confirming" });
      calls = [];
      await confirmInstagramReply(SCOPE, target(), OPEN);
      expect(calls).toEqual([]);
    });
});
