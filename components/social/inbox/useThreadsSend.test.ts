// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { threadsSendDigest, type ThreadsSendReadiness } from "@/lib/inboxThreadsSend";
import { STORAGE_KEY, inboxDraftBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";
import {
  cancelThreadsReply,
  checkThreadsReply,
  confirmThreadsReply,
  finishThreadsReply,
  onThreadsDraftCleared,
  prepareThreadsReply,
  resetThreadsSendViews,
  resumeThreadsPublish,
  useThreadsSendViews,
} from "./useThreadsSend";

// 📤 Reviewed Threads replies, client side (packet DT-6B-2B-2). Production readiness is closed, so nothing below the
// gate runs in the app; this file reaches the future enabled path ONLY through a module mock of the readiness
// dependency (`ready`), never a shipped switch. The handle is persisted before every request; answers apply only when
// their durable write succeeded for the same operation; the 2A-R2 fences (connection, token, provider, account,
// generation, visit, latest action) hold after every await; uncertain stages offer status only; `created` resumes
// publication only from its durable handle; nothing is ever recreated. Transport is a fake Worker.

const gate = vi.hoisted(() => ({ ready: { ok: true } as ThreadsSendReadiness }));
vi.mock("@/lib/inboxThreadsSend", async (orig) => ({
  ...(await orig<typeof import("@/lib/inboxThreadsSend")>()),
  threadsSendReadiness: () => gate.ready,
}));

const WORKER = "https://scout.test";
const G = "d".repeat(32);
const G2 = "e".repeat(32);
const ME = "25";
const SCOPE = "v2|threads|https%3A%2F%2Fscout.test|25|comment|91001";
const TARGET = {
  sendRef: "send.ref",
  account: ME,
  generation: G,
  rootPostId: "90001",
  replyToId: "91001",
};
const TEXT = "Thanks for the reply!";
const C = "17800000000000001";
const P = "18000000000000009";
const SEND = "/social/inbox/threads/send";

const S = () => useStore.getState();
const view = () => useThreadsSendViews.getState().views[SCOPE];
const op = () => S().inboxThreadsSendOps[SCOPE];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const STAGE: Record<string, Record<string, unknown>> = {
  created: { containerId: C },
  publishing: { containerId: C },
  published: { containerId: C, publishedId: P },
  rejected: { failureCode: "meta_10" },
  unknown_creation: { unknownReason: "timeout" },
  unknown_publication: { containerId: C, unknownReason: "server" },
};
const VERSION: Record<string, number> = {
  prepared: 1,
  creating: 2,
  unknown_creation: 3,
  created: 3,
  publishing: 4,
  published: 5,
  unknown_publication: 5,
  rejected: 5,
  cancelled: 2,
  expired: 2,
};
const intent = (operationId: string, state = "prepared", over: Record<string, unknown> = {}) => ({
  operationId,
  provider: "threads",
  account: ME,
  generation: G,
  rootPostId: "90001",
  replyToId: "91001",
  text: TEXT,
  digest: threadsSendDigest(TEXT),
  draftRevision: "rev-1",
  state,
  reviewExpiresAt: "2026-10-17T09:10:00.000Z",
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:00.000Z",
  receiptVersion: VERSION[state],
  ...STAGE[state],
  ...over,
});

type Call = { method: string; path: string; body: Record<string, string> | undefined };
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

function account(accountId = ME, generation = G) {
  useProviderInbox.setState({
    provider: "threads",
    threads: {
      provider: "threads",
      accountId,
      handle: "3z.prod",
      generation,
      capabilities: { replies: "ok", sendReplies: "permission_unverified" },
    },
  });
}

/** A handle as an earlier session left it (the Worker's receipt of `state`). */
async function seed(
  state: string,
  operationId = "op-th-seeded1",
  over: Record<string, unknown> = {},
) {
  const i: Record<string, unknown> = intent(operationId, state, over);
  const r = await S().setInboxThreadsSendOp(
    SCOPE,
    {
      operationId,
      account: ME,
      draftRevision: "rev-1",
      digest: i.digest as string,
      state: state as never,
      ...(state === "preparing" || state === "confirming"
        ? {}
        : { receiptVersion: i.receiptVersion as number }),
      ...(i.containerId ? { containerId: i.containerId as string } : {}),
      ...(i.publishedId ? { publishedId: i.publishedId as string } : {}),
    },
    null,
  );
  if (!r.ok) throw new Error(r.reason);
  return operationId;
}

/** Prepare through the fake Worker, landing in review. */
async function prepared() {
  handler = (c) => json({ intent: intent(c.body!.operationId) });
  await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
  expect(view().phase).toBe("review");
  calls = [];
  return op()!.operationId;
}

beforeEach(() => {
  gate.ready = { ok: true };
  localStorage.clear();
  setArticlesLock(queueLock());
  S().reset();
  S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetThreadsSendViews();
  account();
  calls = [];
  handler = () => json({ error: "not_found" }, 404);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      const c: Call = {
        method: init?.method ?? "GET",
        path: `${u.pathname}${u.search}`,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
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
});

describe("production readiness (closed)", () => {
  it("prepare, send and resume make no request and keep no handle", async () => {
    gate.ready = { ok: false, reason: "permission_unverified" };
    await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view()).toMatchObject({ phase: "error", error: "unavailable" });
    expect(op()).toBeUndefined();
    await confirmThreadsReply(SCOPE, TARGET);
    await resumeThreadsPublish(SCOPE, TARGET);
    expect(calls).toEqual([]);
  });

  it("a retained operation is still checked (status only), with no row, draft or permission", async () => {
    gate.ready = { ok: false, reason: "permission_unverified" };
    const id = await seed("unknown_publication");
    handler = () => json({ intent: intent(id, "unknown_publication") });
    await checkThreadsReply(SCOPE);
    expect(calls).toEqual([
      { method: "GET", path: `${SEND}/${id}?account=${ME}`, body: undefined },
    ]);
    expect(view()).toMatchObject({ phase: "unknown_publication", error: null });
    expect(op()).toMatchObject({ operationId: id, state: "unknown_publication" });
  });
});

describe("prepare", () => {
  it("persists the handle BEFORE the request, then shows the canonical review once it is durable", async () => {
    let atRequest: unknown;
    handler = (c) => {
      atRequest = stored().inboxThreadsSendOps[SCOPE];
      return json({ intent: intent(c.body!.operationId) });
    };
    await prepareThreadsReply(SCOPE, TARGET, `  ${TEXT}  `, "rev-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      method: "POST",
      path: `${SEND}/prepare`,
      body: {
        operationId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
        sendRef: "send.ref",
        text: `  ${TEXT}  `,
        draftRevision: "rev-1",
      },
    });
    expect(atRequest).toMatchObject({
      operationId: calls[0].body!.operationId,
      account: ME,
      digest: threadsSendDigest(TEXT),
      state: "preparing",
    });
    expect(view()).toMatchObject({ phase: "review", error: null });
    expect(stored().inboxThreadsSendOps[SCOPE]).toMatchObject({
      state: "prepared",
      receiptVersion: 1,
    });
    expect(JSON.stringify(stored().inboxThreadsSendOps)).not.toContain(TEXT);
  });

  it("converges on another tab's operation through a durable write; a refused write opens no review", async () => {
    handler = () => json({ intent: intent("op-th-othertab") });
    await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(op()!.operationId).toBe("op-th-othertab");
    expect(view().intent!.operationId).toBe("op-th-othertab");

    localStorage.clear();
    S().reset();
    S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
    account();
    const real = Storage.prototype.setItem;
    let writes = 0;
    handler = () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
        if (k === STORAGE_KEY && ++writes > 0) throw new DOMException("full", "QuotaExceededError");
        real.call(this, k, v);
      });
      return json({ intent: intent("op-th-othertab") });
    };
    await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view()).toMatchObject({ phase: "error", error: "notPersisted", intent: null });
    expect(op()!.operationId).not.toBe("op-th-othertab");
    expect(op()!.state).toBe("preparing");
  });

  it("an answer about another reply, root, account or text is not trusted; the handle stays", async () => {
    for (const over of [{ replyToId: "91002" }, { rootPostId: "90002" }, { generation: G2 }]) {
      localStorage.clear();
      S().reset();
      S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
      account();
      handler = (c) => json({ intent: intent(c.body!.operationId, "prepared", over) });
      await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
      expect(view()).toMatchObject({ phase: "uncertain", error: "mismatch" });
      expect(op()!.state).toBe("preparing");
    }
  });

  it("a refused prepare lets its handle go (nothing can be sent without Confirm)", async () => {
    handler = () => json({ error: "target_invalid" }, 400);
    await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view()).toMatchObject({ phase: "error", error: "target_invalid" });
    expect(op()).toBeUndefined();
  });

  it("refuses with capacity when 50 unresolved handles are kept, and asks nothing", async () => {
    for (let i = 0; i < 50; i++)
      await S().setInboxThreadsSendOp(
        `scope-${i}`,
        {
          operationId: `op-th-full-${String(i).padStart(4, "0")}`,
          account: ME,
          draftRevision: "r",
          digest: "a".repeat(64),
          state: "creating",
          receiptVersion: 2,
        },
        null,
      );
    await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view()).toMatchObject({ phase: "error", error: "capacity" });
    expect(calls).toEqual([]);
  });
});

describe("fences (2A-R2): a move while the handle is written sends nothing", () => {
  const moves: [string, () => void][] = [
    ["provider switch", () => useProviderInbox.setState({ provider: "youtube" })],
    [
      "away and back",
      () => {
        useProviderInbox.setState({ provider: "instagram" });
        useProviderInbox.setState({ provider: "threads" });
      },
    ],
    ["another account", () => account("26")],
    ["a new generation", () => account(ME, G2)],
    [
      "another token",
      () => S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "other-token" } }),
    ],
    [
      "another Worker",
      () =>
        S().setSettings({ apiKeys: { scoutUrl: "https://other.test", scoutToken: "owner-token" } }),
    ],
    [
      "readiness lost",
      () => {
        gate.ready = { ok: false, reason: "permission_unverified" };
      },
    ],
  ];
  for (const [name, move] of moves)
    it(`${name}: prepare makes zero requests and the review closes`, async () => {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      setArticlesLock(async (fn) => {
        await held;
        return fn();
      });
      const run = prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
      move();
      release();
      setArticlesLock(queueLock());
      await run;
      expect(calls).toEqual([]);
      expect(view().phase).toBe("closed");
      expect(op()).toBeUndefined();
    });

  it("a move during Send's mark rolls it back and confirms nothing", async () => {
    const id = await prepared();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    setArticlesLock(async (fn) => {
      await held;
      return fn();
    });
    const run = confirmThreadsReply(SCOPE, TARGET);
    useProviderInbox.setState({ provider: "instagram" });
    useProviderInbox.setState({ provider: "threads" });
    release();
    setArticlesLock(queueLock());
    await run;
    expect(calls).toEqual([]);
    expect(view().phase).toBe("closed");
    expect(op()).toMatchObject({ operationId: id, state: "prepared" });
    // Coming back never revives the abandoned Send.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([]);
  });

  it("only the newest action of a scope changes the view", async () => {
    const id = await seed("unknown_publication");
    let first!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (first = r));
    const older = checkThreadsReply(SCOPE);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    handler = () => json({ intent: intent(id, "published", { receiptVersion: 9 }) });
    await checkThreadsReply(SCOPE);
    expect(view().phase).toBe("published");
    first(json({ intent: intent(id, "unknown_publication") }));
    await older;
    expect(view().phase).toBe("published");
    expect(op()!.state).toBe("published");
  });
});

describe("send (two stages) and recovery", () => {
  it("marks confirming BEFORE the one confirm request; the published receipt carries both ids", async () => {
    const id = await prepared();
    let atRequest: unknown;
    handler = () => {
      atRequest = stored().inboxThreadsSendOps[SCOPE]?.state;
      return json({ intent: intent(id, "published") });
    };
    await confirmThreadsReply(SCOPE, TARGET);
    expect(calls).toEqual([
      {
        method: "POST",
        path: `${SEND}/confirm`,
        body: { operationId: id, digest: threadsSendDigest(TEXT), account: ME },
      },
    ]);
    expect(atRequest).toBe("confirming");
    expect(view()).toMatchObject({ phase: "published", error: null });
    expect(op()).toMatchObject({
      state: "published",
      containerId: C,
      publishedId: P,
      receiptVersion: 5,
    });
  });

  it("a lost confirm answer is local uncertainty: status only, and Check status finds the durable stage", async () => {
    const id = await prepared();
    handler = () => {
      throw new TypeError("offline");
    };
    await confirmThreadsReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "uncertain", error: "network" });
    expect(op()!.state).toBe("confirming");
    // Nothing offers Send again from here.
    await confirmThreadsReply(SCOPE, TARGET);
    expect(calls).toHaveLength(1);
    handler = () => json({ intent: intent(id, "unknown_publication") });
    await checkThreadsReply(SCOPE);
    expect(view().phase).toBe("unknown_publication");
    expect(op()).toMatchObject({ state: "unknown_publication", containerId: C });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("a refusal before any claim rolls the mark back and the review stands", async () => {
    const id = await prepared();
    handler = () => json({ error: "conflict" }, 409);
    await confirmThreadsReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "review", error: "conflict" });
    expect(op()).toMatchObject({ operationId: id, state: "prepared" });
  });

  for (const state of ["creating", "publishing", "unknown_creation", "unknown_publication"])
    it(`${state} is status only: Send and Resume make no request`, async () => {
      const id = await seed(state);
      handler = () => json({ intent: intent(id, state) });
      await checkThreadsReply(SCOPE);
      expect(view().phase).toBe(state);
      calls = [];
      await confirmThreadsReply(SCOPE, TARGET);
      await resumeThreadsPublish(SCOPE, TARGET);
      await cancelThreadsReply(SCOPE);
      expect(calls).toEqual([]);
      expect(op()!.state).toBe(state);
    });

  it("resumes a durable `created` once, after the review deadline too, and never recreates", async () => {
    const id = await seed("created");
    handler = () =>
      json({ intent: intent(id, "created", { reviewExpiresAt: "2020-01-01T00:00:00.000Z" }) });
    await checkThreadsReply(SCOPE);
    expect(view().phase).toBe("created");
    calls = [];
    // Plain Send is for `prepared` only.
    await confirmThreadsReply(SCOPE, TARGET);
    expect(calls).toEqual([]);
    let atRequest: unknown;
    handler = () => {
      atRequest = stored().inboxThreadsSendOps[SCOPE];
      return json({ intent: intent(id, "published") });
    };
    await resumeThreadsPublish(SCOPE, TARGET);
    expect(calls).toEqual([
      {
        method: "POST",
        path: `${SEND}/confirm`,
        body: { operationId: id, digest: threadsSendDigest(TEXT), account: ME },
      },
    ]);
    expect(atRequest).toMatchObject({ state: "confirming", containerId: C });
    expect(view().phase).toBe("published");
    await resumeThreadsPublish(SCOPE, TARGET);
    expect(calls).toHaveLength(1);
  });

  it("resume needs the durable handle at `created` and readiness; otherwise nothing is asked", async () => {
    const id = await seed("created");
    handler = () => json({ intent: intent(id, "created") });
    await checkThreadsReply(SCOPE);
    calls = [];
    gate.ready = { ok: false, reason: "permission_unverified" };
    await resumeThreadsPublish(SCOPE, TARGET);
    expect(calls).toEqual([]);
    gate.ready = { ok: true };
    // Another tab recorded newer proof: the view's `created` is no longer what is stored.
    await S().setInboxThreadsSendOp(
      SCOPE,
      {
        operationId: id,
        account: ME,
        draftRevision: "rev-1",
        digest: threadsSendDigest(TEXT),
        state: "publishing",
        receiptVersion: 4,
        containerId: C,
      },
      id,
    );
    await resumeThreadsPublish(SCOPE, TARGET);
    expect(calls).toEqual([]);
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
  });

  it("an older or contradictory receipt never replaces newer proof: superseded with Check status", async () => {
    const id = await seed("publishing");
    handler = () => json({ intent: intent(id, "created") });
    await checkThreadsReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
    expect(op()!.state).toBe("publishing");
    handler = () => json({ intent: intent(id, "unknown_creation", { receiptVersion: 4 }) });
    await checkThreadsReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
    expect(op()).toMatchObject({ state: "publishing", receiptVersion: 4 });
  });

  it("a failed status keeps the handle and shows the last durable stage with the failure", async () => {
    const id = await seed("unknown_publication");
    handler = () => json({ error: "receipt_unavailable" }, 503);
    await checkThreadsReply(SCOPE);
    expect(view()).toMatchObject({ phase: "unknown_publication", error: "receipt_unavailable" });
    expect(op()!.operationId).toBe(id);
    // A local mark (the confirm may have left) whose lookup fails is local uncertainty, never "nothing happened".
    await S().clearInboxThreadsSendOp(SCOPE, id);
    await seed("confirming", "op-th-other01");
    handler = () => {
      throw new TypeError("offline");
    };
    await checkThreadsReply(SCOPE);
    expect(view()).toMatchObject({ phase: "uncertain", error: "network" });
    expect(op()).toMatchObject({ operationId: "op-th-other01", state: "confirming" });
  });

  it("a status write the browser refuses shows unrecorded, never the unsaved answer", async () => {
    const id = await seed("unknown_publication");
    const real = Storage.prototype.setItem;
    handler = () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
        if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
        real.call(this, k, v);
      });
      return json({ intent: intent(id, "published", { receiptVersion: 6 }) });
    };
    await checkThreadsReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "unrecorded" });
    expect(op()!.state).toBe("unknown_publication");
  });

  // DT-6B-2B-2-R1 (2B2-3) replaces the 2B-2 rule "another account on screen asks nothing": Check status is handle-only
  // recovery, so it asks the handle's own account on the handle's own Worker. A Worker other than the handle's still
  // gets nothing (below, "R1 handle-only recovery").
  it("checking while another account is on screen asks the handle's own account, once", async () => {
    const id = await seed("unknown_publication");
    account("26");
    handler = () => json({ intent: intent(id, "unknown_publication") });
    await checkThreadsReply(SCOPE);
    expect(calls).toEqual([
      { method: "GET", path: `${SEND}/${id}?account=${ME}`, body: undefined },
    ]);
    expect(view().phase).toBe("unknown_publication");
  });
});

describe("R1 (DT-6B-2B-2-R1): immutable publication proof and exact commits", () => {
  it("a published id never changes, at the same or a later version; the stored proof stays", async () => {
    const id = await seed("published");
    for (const receiptVersion of [5, 6]) {
      handler = () =>
        json({
          intent: intent(id, "published", { publishedId: "18000000000000777", receiptVersion }),
        });
      await checkThreadsReply(SCOPE);
      expect(op()).toMatchObject({ state: "published", publishedId: P, receiptVersion: 5 });
      expect(view()).toMatchObject({ phase: "error", error: "mismatch", intent: null });
    }
  });

  const raceAfterCommit = (state: string, receipt: Record<string, unknown>, id: string) => {
    let injected = false;
    setArticlesLock(async (fn) => {
      const r = (await fn()) as { ok: boolean; op?: { state?: string } | null };
      if (!injected && r.ok && r.op?.state === state) {
        injected = true;
        setArticlesLock(queueLock());
        const w = await S().setInboxThreadsSendOp(SCOPE, receipt as never, id);
        if (!w.ok) throw new Error(w.reason);
      }
      return r as never;
    });
    return () => injected;
  };

  it("Check status shows its answer only when that exact receipt is still the stored one", async () => {
    const id = await seed("created");
    handler = () => json({ intent: intent(id, "created") });
    const injected = raceAfterCommit(
      "created",
      {
        operationId: id,
        account: ME,
        draftRevision: "rev-1",
        digest: threadsSendDigest(TEXT),
        state: "published",
        receiptVersion: 5,
        containerId: C,
        publishedId: P,
      },
      id,
    );
    await checkThreadsReply(SCOPE);
    expect(injected()).toBe(true);
    expect(op()!.state).toBe("published");
    expect(view()).toMatchObject({ phase: "error", error: "superseded", intent: null });
  });

  it("canonical Prepare opens its review only when that exact receipt is still the stored one", async () => {
    handler = () => json({ intent: intent("op-th-canon01") });
    const injected = raceAfterCommit(
      "prepared",
      {
        operationId: "op-th-canon01",
        account: ME,
        draftRevision: "rev-1",
        digest: threadsSendDigest(TEXT),
        state: "unknown_creation",
        receiptVersion: 3,
      },
      "op-th-canon01",
    );
    await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(injected()).toBe(true);
    expect(op()!.state).toBe("unknown_creation");
    expect(view()).toMatchObject({ phase: "error", error: "superseded", intent: null });
  });
});

describe("R1 (DT-6B-2B-2-R1): handle-only recovery on the handle's own Worker", () => {
  it("recovers by the stored account when the account read failed or another account is loaded", async () => {
    gate.ready = { ok: false, reason: "permission_unverified" };
    const id = await seed("unknown_publication");
    for (const move of [
      () => useProviderInbox.setState({ provider: "threads", threads: null }),
      () => account("26", G2),
    ]) {
      move();
      calls = [];
      handler = () => json({ intent: intent(id, "unknown_publication") });
      await checkThreadsReply(SCOPE);
      expect(calls).toEqual([
        { method: "GET", path: `${SEND}/${id}?account=${ME}`, body: undefined },
      ]);
      expect(view().phase).toBe("unknown_publication");
      expect(op()).toMatchObject({ operationId: id, state: "unknown_publication" });
    }
    // Recovery grants nothing else: Prepare/Send/Resume stay closed.
    calls = [];
    await confirmThreadsReply(SCOPE, TARGET);
    await resumeThreadsPublish(SCOPE, TARGET);
    expect(calls).toEqual([]);
  });

  it("a handle of another Worker is never asked, and the current token never goes there", async () => {
    const unknown = (operationId: string, over: Record<string, unknown> = {}) => ({
      operationId,
      account: ME,
      draftRevision: "rev-1",
      digest: threadsSendDigest(TEXT),
      state: "unknown_publication" as const,
      receiptVersion: 5,
      containerId: C,
      ...over,
    });
    // The recorded origin wins over the scope key's.
    const recorded = "v2|threads|https%3A%2F%2Fscout.test|25|comment|91002";
    await S().setInboxThreadsSendOp(
      recorded,
      unknown("op-th-recorded", { workerOrigin: "https://old.test" }),
      null,
    );
    // A 2B-2 handle without one uses its scope key's origin.
    const legacy = "v2|threads|https%3A%2F%2Fold.test|25|comment|91003";
    await S().setInboxThreadsSendOp(legacy, unknown("op-th-legacy01"), null);
    for (const scope of [recorded, legacy]) {
      await checkThreadsReply(scope);
      expect(useThreadsSendViews.getState().views[scope].phase).toBe("closed");
    }
    expect(calls).toEqual([]);
    // The Worker URL moves after the request left: the view closes (the receipt came from the handle's own Worker, so
    // it may still be recorded) and nothing more is asked of anyone.
    const id = await seed("unknown_publication");
    let release!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (release = r));
    const run = checkThreadsReply(SCOPE);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    S().setSettings({ apiKeys: { scoutUrl: "https://other.test", scoutToken: "owner-token" } });
    release(json({ intent: intent(id, "published", { receiptVersion: 6 }) }));
    await run;
    expect(view().phase).toBe("closed");
    expect(calls).toHaveLength(1);
  });

  it("a status write records the Worker origin on a 2B-2 handle; Prepare records it from the start", async () => {
    const id = await seed("unknown_publication");
    expect(op()!.workerOrigin).toBeUndefined();
    handler = () => json({ intent: intent(id, "unknown_publication") });
    await checkThreadsReply(SCOPE);
    expect(op()!.workerOrigin).toBe(WORKER);
    await S().clearInboxThreadsSendOp(SCOPE, id);
    let atRequest: unknown;
    handler = (c) => {
      atRequest = stored().inboxThreadsSendOps[SCOPE]?.workerOrigin;
      return json({ intent: intent(c.body!.operationId) });
    };
    await prepareThreadsReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(atRequest).toBe(WORKER);
    expect(op()!.workerOrigin).toBe(WORKER);
  });

  it("leaving Threads while a status read is out drops its answer (visit fence kept)", async () => {
    const id = await seed("unknown_publication");
    useProviderInbox.setState({ provider: "threads", threads: null });
    let release!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (release = r));
    const run = checkThreadsReply(SCOPE);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    useProviderInbox.setState({ provider: "instagram" });
    useProviderInbox.setState({ provider: "threads" });
    release(json({ intent: intent(id, "published", { receiptVersion: 6 }) }));
    await run;
    expect(view().phase).toBe("closed");
  });
});

describe("R1 (DT-6B-2B-2-R1): a successful Clear draft reaches every editor of its scope", () => {
  it("announces the discarded revision once; a failed or skipped discard announces nothing", async () => {
    const heard: [string, string][] = [];
    const stop = onThreadsDraftCleared((s, d) => heard.push([s, d.commitId]));
    const publish = async (operationId: string, draftRevision: string) => {
      const w = await S().setInboxThreadsSendOp(
        SCOPE,
        {
          operationId,
          account: ME,
          draftRevision,
          digest: threadsSendDigest(TEXT),
          state: "published",
          receiptVersion: 5,
          containerId: C,
          publishedId: P,
        },
        op()?.operationId ?? null,
      );
      if (!w.ok) throw new Error(w.reason);
    };
    const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    if (!saved.ok) throw new Error("save");
    const rev = saved.draft!.commitId;
    await publish("op-th-clear01", rev);
    // The browser refuses the discard: nothing is announced, the draft and the handle stay.
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(await finishThreadsReply(SCOPE, true)).toBe("failed");
    spy.mockRestore();
    expect(heard).toEqual([]);
    expect(S().inboxDrafts[SCOPE]?.commitId).toBe(rev);
    // The discard lands: announced once, with its scope and revision.
    expect(await finishThreadsReply(SCOPE, true)).toMatchObject({ commitId: rev });
    expect(heard).toEqual([[SCOPE, rev]]);
    // The published revision is no longer the saved one: nothing is discarded or announced.
    await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    await publish("op-th-clear02", "rev-unrelated");
    expect(await finishThreadsReply(SCOPE, true)).toBeNull();
    expect(heard).toEqual([[SCOPE, rev]]);
    stop();
  });
});

describe("cancel and finish", () => {
  it("cancel is prepared-only; a failed cancel keeps the handle; a proven cancel removes it", async () => {
    const id = await prepared();
    handler = () => json({ error: "upstream" }, 502);
    await cancelThreadsReply(SCOPE);
    expect(view()).toMatchObject({ error: "cancelFailed" });
    expect(op()!.operationId).toBe(id);
    handler = () => json({ intent: intent(id, "cancelled") });
    await cancelThreadsReply(SCOPE);
    expect(op()).toBeUndefined();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${SEND}/${id}/cancel`,
      `POST ${SEND}/${id}/cancel`,
    ]);
    expect(calls[0].body).toEqual({ account: ME });
  });

  it("DT-6B-2B-2-R2: a proven cancel or expiry of a review keeps its validated receipt on the view", async () => {
    for (const state of ["cancelled", "expired"] as const) {
      const id = await prepared();
      handler = () => json({ intent: intent(id, state) });
      await cancelThreadsReply(SCOPE);
      expect(op()).toBeUndefined();
      expect(view()).toMatchObject({
        phase: state,
        error: null,
        intent: { operationId: id, state },
      });
      expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`POST ${SEND}/${id}/cancel`]);
      calls = [];
      await finishThreadsReply(SCOPE);
      expect(view().phase).toBe("idle");
      expect(calls).toEqual([]);
    }
  });

  it("Clear draft after publication discards only the submitted revision; a newer draft stays", async () => {
    const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    if (!saved.ok) throw new Error("save");
    const rev = saved.draft!.commitId;
    handler = (c) =>
      json({ intent: intent(c.body!.operationId, "prepared", { draftRevision: rev }) });
    await prepareThreadsReply(SCOPE, TARGET, TEXT, rev);
    const id = op()!.operationId;
    handler = () => json({ intent: intent(id, "published", { draftRevision: rev }) });
    await confirmThreadsReply(SCOPE, TARGET);
    // A newer edit was saved meanwhile: it survives Clear draft.
    await S().saveInboxDraft(SCOPE, "newer words", inboxDraftBase(S().inboxDrafts[SCOPE]));
    expect(await finishThreadsReply(SCOPE, true)).toBeNull();
    expect(S().inboxDrafts[SCOPE].text).toBe("newer words");
    expect(op()).toBeUndefined();

    // The same revision is discarded.
    const again = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(S().inboxDrafts[SCOPE]));
    if (!again.ok) throw new Error("save");
    const rev2 = again.draft!.commitId;
    handler = (c) =>
      json({ intent: intent(c.body!.operationId, "prepared", { draftRevision: rev2 }) });
    await prepareThreadsReply(SCOPE, TARGET, TEXT, rev2);
    const id2 = op()!.operationId;
    handler = () => json({ intent: intent(id2, "published", { draftRevision: rev2 }) });
    await confirmThreadsReply(SCOPE, TARGET);
    expect(await finishThreadsReply(SCOPE, true)).toMatchObject({ commitId: rev2, text: TEXT });
    expect(S().inboxDrafts[SCOPE]).toBeUndefined();
  });

  it("an unresolved operation is never finished", async () => {
    await seed("unknown_creation");
    expect(await finishThreadsReply(SCOPE, true)).toBeNull();
    expect(op()!.state).toBe("unknown_creation");
  });
});
