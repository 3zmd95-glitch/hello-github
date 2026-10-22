// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDigest } from "@/lib/inbox";
import { STORAGE_KEY, inboxDraftBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";
import {
  cancelReply,
  checkReply,
  confirmReply,
  finishReply,
  prepareReply,
  resetSendViews,
  useSendViews,
} from "./useSend";

// 📤 Reviewed YouTube replies, client side (packet DT-6B-2A): the handle is persisted before the prepare request and
// says "dispatching" before the confirm request; answers that land after the account, generation or connection moved
// close the review view and never retarget the stored operation; Check status reads the same operation back and nothing
// ever resends; a newer draft is never cleared. Transport is a fake Worker.

const WORKER = "https://scout.test";
const G = "a".repeat(32);
const G2 = "b".repeat(32);
const SCOPE = "v2|youtube|https%3A%2F%2Fscout.test|UCa|comment|Ug1";
const TARGET = { sendRef: "send.ref", account: "UCa", generation: G };
const TEXT = "Thanks for watching!";

const S = () => useStore.getState();
const view = () => useSendViews.getState().views[SCOPE];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const intent = (operationId: string, state = "prepared", over: Record<string, unknown> = {}) => ({
  operationId,
  provider: "youtube",
  account: "UCa",
  generation: G,
  threadId: "UgThreadX",
  videoId: "vid1",
  parentCommentId: "Ug1",
  text: TEXT,
  digest: sendDigest(TEXT),
  draftRevision: "rev-1",
  state,
  reviewExpiresAt: "2026-10-17T09:10:00.000Z",
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:00.000Z",
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

function channel(generation = G) {
  useProviderInbox.setState({
    provider: "youtube",
    youtube: {
      provider: "youtube",
      needsSelection: false,
      channels: [{ accountId: "UCa", title: "3z", generation, uploads: "up.s" }],
      capabilities: { comments: "ok", sendComments: "ok" },
    },
    channelId: "UCa",
  });
}

beforeEach(() => {
  localStorage.clear();
  setArticlesLock(queueLock());
  S().reset();
  S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetSendViews();
  channel();
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

const PREPARE = "/social/inbox/youtube/send/prepare";
const CONFIRM = "/social/inbox/youtube/send/confirm";

describe("prepare", () => {
  it("persists the handle BEFORE the prepare request, then shows the Worker's canonical review", async () => {
    let seenAtRequest: unknown;
    handler = (c) => {
      seenAtRequest = stored().inboxSendOps[SCOPE];
      return json({ intent: intent(c.body!.operationId) });
    };
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(calls).toHaveLength(1);
    const body = calls[0].body!;
    expect(calls[0].path).toBe(PREPARE);
    expect(body).toEqual({
      operationId: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
      sendRef: "send.ref",
      text: TEXT,
      draftRevision: "rev-1",
    });
    expect(seenAtRequest).toMatchObject({
      operationId: body.operationId,
      account: "UCa",
      draftRevision: "rev-1",
      digest: sendDigest(TEXT),
      state: "preparing",
    });
    expect(view()).toMatchObject({ phase: "review", intent: { text: TEXT, state: "prepared" } });
    expect(S().inboxSendOps[SCOPE]).toMatchObject({
      operationId: body.operationId,
      state: "prepared",
    });
  });

  it("a handle the browser cannot keep stops before any request", async () => {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(calls).toEqual([]);
    expect(view()).toMatchObject({ phase: "error", error: "notPersisted" });
  });

  it("follows the operation another tab prepared first for the same saved draft", async () => {
    handler = () => json({ intent: intent("op-other-tab-1") });
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(S().inboxSendOps[SCOPE].operationId).toBe("op-other-tab-1");
    expect(view().intent?.operationId).toBe("op-other-tab-1");
  });

  it("a refused prepare lets go of its handle and names the reason", async () => {
    for (const code of ["not_public", "not_replyable", "target_invalid", "no_permission"]) {
      handler = () => json({ error: code }, 403);
      await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
      expect(view()).toMatchObject({ phase: "error", error: code });
      expect(S().inboxSendOps[SCOPE]).toBeUndefined();
    }
    handler = () => json({ error: "not_configured", detail: "receipt-store" }, 503);
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view()).toMatchObject({ error: "not_configured", detail: "receipt-store" });
    expect(calls.every((c) => c.path === PREPARE)).toBe(true);
  });

  it("an answer after a channel or generation change closes the review and keeps the original target", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    handler = async (c) => {
      await hold;
      return json({ intent: intent(c.body!.operationId) });
    };
    const pending = prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    channel(G2); // reconnected: a new generation
    release();
    await pending;
    expect(view().phase).toBe("closed");
    expect(S().inboxSendOps[SCOPE]).toMatchObject({ account: "UCa", state: "prepared" });
  });
});

describe("confirm", () => {
  async function review(operationId = "op-review-01") {
    handler = () => json({ intent: intent(operationId) });
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    calls = [];
    return operationId;
  }

  it("marks the handle dispatching BEFORE the one confirm request; a sent answer is recorded", async () => {
    const op = await review();
    let atRequest: unknown;
    handler = () => {
      atRequest = stored().inboxSendOps[SCOPE]?.state;
      return json({ intent: intent(op, "sent", { providerCommentId: "Ug1.r9" }) });
    };
    await confirmReply(SCOPE, TARGET);
    expect(atRequest).toBe("dispatching");
    expect(calls).toEqual([
      {
        method: "POST",
        path: CONFIRM,
        body: { operationId: op, digest: sendDigest(TEXT), account: "UCa" },
      },
    ]);
    expect(view()).toMatchObject({ phase: "sent", intent: { providerCommentId: "Ug1.r9" } });
    expect(S().inboxSendOps[SCOPE].state).toBe("sent");
    // A second press does nothing: the view is no longer a review.
    await confirmReply(SCOPE, TARGET);
    expect(calls).toHaveLength(1);
  });

  it("a lost answer is unknown; Check status reads the same operation and never confirms again", async () => {
    const op = await review();
    handler = () => {
      throw new TypeError("offline");
    };
    await confirmReply(SCOPE, TARGET);
    expect(view().phase).toBe("unknown");
    expect(S().inboxSendOps[SCOPE].state).toBe("dispatching");
    handler = () => json({ intent: intent(op, "sent", { providerCommentId: "Ug1.r9" }) });
    await checkReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "sent" });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `POST ${CONFIRM}`,
      `GET /social/inbox/youtube/send/${op}?account=UCa`,
    ]);
  });

  it("an unknown or dispatching answer stays unknown with Check status as the only way on", async () => {
    const op = await review();
    handler = () => json({ intent: intent(op, "unknown", { unknownReason: "timeout" }) });
    await confirmReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "unknown", intent: { unknownReason: "timeout" } });
    // Prepare on the same scope never starts a new operation while one is uncertain: it checks the old one.
    calls = [];
    handler = () => json({ intent: intent(op, "unknown", { unknownReason: "timeout" }) });
    await prepareReply(SCOPE, TARGET, "a different text", "rev-2");
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
    await finishReply(SCOPE);
    expect(S().inboxSendOps[SCOPE].operationId).toBe(op);
  });

  it("a refusal before the claim keeps the review and the handle prepared", async () => {
    await review();
    handler = () => json({ error: "stale" }, 409);
    await confirmReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "review", error: "stale" });
    expect(S().inboxSendOps[SCOPE].state).toBe("prepared");
  });

  it("a connection change during Send closes the view; the handle still records the outcome", async () => {
    const op = await review();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    handler = async () => {
      await hold;
      return json({ intent: intent(op, "sent", { providerCommentId: "Ug1.r9" }) });
    };
    const pending = confirmReply(SCOPE, TARGET);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "another-token" } });
    channel();
    release();
    await pending;
    expect(view().phase).toBe("closed");
    expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "sent" });
  });
});

describe("recovery, cancel and finish", () => {
  const seed = async (
    state: "preparing" | "prepared" | "dispatching" | "sent",
    operationId = "op-seeded-1",
  ) => {
    const r = await S().setInboxSendOp(
      SCOPE,
      { operationId, account: "UCa", draftRevision: "rev-1", digest: sendDigest(TEXT), state },
      null,
    );
    expect(r.ok).toBe(true);
    return operationId;
  };

  it("after a reload the stored handle is read back with one GET of the same operation", async () => {
    const op = await seed("dispatching");
    handler = () => json({ intent: intent(op, "dispatching") });
    await checkReply(SCOPE, TARGET);
    expect(calls).toEqual([
      { method: "GET", path: `/social/inbox/youtube/send/${op}?account=UCa`, body: undefined },
    ]);
    expect(view().phase).toBe("unknown");
    handler = () => json({ error: "network" }, 502);
    await checkReply(SCOPE, TARGET);
    expect(view().phase).toBe("unknown");
  });

  it("a preparing handle the Worker never stored is let go", async () => {
    await seed("preparing");
    await checkReply(SCOPE, TARGET);
    expect(S().inboxSendOps[SCOPE]).toBeUndefined();
    expect(view().phase).toBe("idle");
  });

  it("cancel ends the prepared intent with one POST and drops the handle", async () => {
    const op = await seed("prepared");
    handler = () => json({ intent: intent(op, "cancelled") });
    await cancelReply(SCOPE);
    expect(calls).toEqual([
      { method: "POST", path: `/social/inbox/youtube/send/${op}/cancel`, body: { account: "UCa" } },
    ]);
    expect(S().inboxSendOps[SCOPE]).toBeUndefined();
  });

  it("Clear draft after a send removes only the revision that was sent; a newer draft stays", async () => {
    const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    if (!saved.ok || !saved.draft) throw new Error("save");
    // The sent operation names an older revision: the newer draft is kept.
    await seed("sent");
    await finishReply(SCOPE, true);
    expect(S().inboxDrafts[SCOPE].text).toBe(TEXT);
    expect(S().inboxSendOps[SCOPE]).toBeUndefined();
    await S().setInboxSendOp(
      SCOPE,
      {
        operationId: "op-seeded-2",
        account: "UCa",
        draftRevision: saved.draft.commitId,
        digest: sendDigest(TEXT),
        state: "sent",
      },
      null,
    );
    await finishReply(SCOPE, true);
    expect(S().inboxDrafts[SCOPE]).toBeUndefined();
    expect(calls).toEqual([]);
  });
});

// DT-6B-2A-R1: Codex findings 2A-1…2A-7 and 2A-9 (client part), each reproduced first against the frozen DT-6B-2A hook.
describe("DT-6B-2A-R1 repairs", () => {
  const OTHER = "https://replacement.test";
  const holdLock = () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setArticlesLock(async (fn) => {
      await gate;
      return fn();
    });
    return release;
  };
  const fresh = () => {
    localStorage.clear();
    setArticlesLock(queueLock());
    S().reset();
    S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
    channel();
    calls = [];
  };
  const seed = async (
    state: "preparing" | "prepared" | "dispatching" | "unknown" | "sent",
    operationId = "op-seeded-1",
    scope = SCOPE,
  ) => {
    const r = await S().setInboxSendOp(
      scope,
      { operationId, account: "UCa", draftRevision: "rev-1", digest: sendDigest(TEXT), state },
      null,
    );
    expect(r.ok).toBe(true);
    return operationId;
  };
  async function review(operationId = "op-review-01") {
    handler = () => json({ intent: intent(operationId) });
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view().phase).toBe("review");
    calls = [];
    return operationId;
  }

  it("2A-1: a Worker, token or channel change while Prepare writes its handle makes zero requests", async () => {
    for (const move of [
      () => S().setSettings({ apiKeys: { scoutUrl: OTHER, scoutToken: "owner-token" } }),
      () => S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "replacement-token" } }),
      () => channel(G2),
    ]) {
      fresh();
      const release = holdLock();
      const pending = prepareReply(SCOPE, TARGET, TEXT, "rev-1");
      move();
      release();
      await pending;
      expect(calls).toEqual([]);
      expect(view().phase).toBe("closed");
      // Nothing went out, so the handle written for it is let go.
      expect(S().inboxSendOps[SCOPE]).toBeUndefined();
    }
  });

  it("2A-1: a connection change while Confirm marks dispatching sends no POST and rolls the mark back", async () => {
    const op = await review();
    const release = holdLock();
    const pending = confirmReply(SCOPE, TARGET);
    S().setSettings({ apiKeys: { scoutUrl: OTHER, scoutToken: "replacement-token" } });
    channel();
    release();
    await pending;
    expect(calls).toEqual([]);
    expect(view().phase).toBe("closed");
    expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "prepared" });
  });

  it("2A-2: an older Check status answer never replaces a newer view nor regresses the handle", async () => {
    const op = await seed("dispatching");
    let release!: (r: Response) => void;
    const first = new Promise<Response>((r) => (release = r));
    let n = 0;
    handler = () =>
      ++n === 1 ? first : json({ intent: intent(op, "sent", { providerCommentId: "Ug1.r9" }) });
    const old = checkReply(SCOPE, TARGET);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await checkReply(SCOPE, TARGET);
    expect(view().phase).toBe("sent");
    release(json({ intent: intent(op, "dispatching") }));
    await old;
    expect(view().phase).toBe("sent");
    expect(S().inboxSendOps[SCOPE].state).toBe("sent");
    expect(stored().inboxSendOps[SCOPE].state).toBe("sent");
  });

  it("2A-2: an old answer for a finished operation never closes the newer operation's review", async () => {
    const old = await seed("sent");
    let release!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (release = r));
    const pending = checkReply(SCOPE, TARGET);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await finishReply(SCOPE);
    handler = (c) =>
      json({ intent: intent(c.body!.operationId, "prepared", { draftRevision: "rev-2" }) });
    await prepareReply(SCOPE, TARGET, TEXT, "rev-2");
    const newer = view().intent!.operationId;
    release(json({ intent: intent(old, "sent", { providerCommentId: "Ug1.r1" }) }));
    await pending;
    expect(view()).toMatchObject({ phase: "review", intent: { operationId: newer } });
    expect(S().inboxSendOps[SCOPE].operationId).toBe(newer);
  });

  it("2A-3: a device holding 50 unresolved sends refuses another with capacity and makes no request", async () => {
    for (let i = 0; i < 50; i++)
      await seed("unknown", `op-full-${String(i).padStart(4, "0")}`, `scope-${i}`);
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view()).toMatchObject({ phase: "error", error: "capacity" });
    expect(calls).toEqual([]);
    expect(Object.keys(S().inboxSendOps)).toHaveLength(50);
  });

  it("2A-4: a Prepare answer about another account, generation, revision or text is never a review", async () => {
    for (const over of [
      { account: "UCforeign" },
      { generation: G2 },
      { draftRevision: "rev-9" },
      { text: "Changed text", digest: sendDigest("Changed text") },
    ]) {
      fresh();
      handler = (c) => json({ intent: intent(c.body!.operationId, "prepared", over) });
      await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
      expect(view()).toMatchObject({ phase: "unknown", intent: null, error: "mismatch" });
      // The original handle stays for Check status; nothing is recorded from the answer.
      expect(S().inboxSendOps[SCOPE]).toMatchObject({
        operationId: calls[0].body!.operationId,
        state: "preparing",
      });
    }
  });

  it("2A-4: a Confirm answer naming another operation, or a sent without its comment id, stays unknown", async () => {
    for (const answer of [
      intent("op-foreign-01", "sent", { providerCommentId: "Ug1.r9" }),
      intent("op-review-01", "sent"),
    ]) {
      fresh();
      const op = await review();
      handler = () => json({ intent: answer });
      await confirmReply(SCOPE, TARGET);
      expect(view().phase).toBe("unknown");
      expect(view().intent?.operationId).toBe(op);
      expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "dispatching" });
    }
  });

  it("2A-4: a Check status answer about another revision is unknown and the handle is untouched", async () => {
    const op = await seed("dispatching");
    handler = () =>
      json({ intent: intent(op, "sent", { providerCommentId: "x1", draftRevision: "rev-9" }) });
    await checkReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "unknown", error: "mismatch" });
    expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "dispatching" });
  });

  it("2A-5: a cancel that does not land keeps the handle; a claimed answer is recorded", async () => {
    const lost = () => {
      throw new TypeError("lost");
    };
    for (const reply of [lost, () => json({ error: "upstream" }, 502)]) {
      fresh();
      const op = await seed("prepared");
      handler = reply;
      await cancelReply(SCOPE);
      expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "prepared" });
      expect(view()).toMatchObject({ phase: "error", error: "cancelFailed" });
    }
    const op = S().inboxSendOps[SCOPE].operationId;
    handler = () => json({ intent: intent(op, "dispatching") });
    await cancelReply(SCOPE);
    expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "dispatching" });
    expect(view().phase).toBe("unknown");
  });

  it("2A-6: another tab's operation opens its review only once its handle is durable here", async () => {
    const real = Storage.prototype.setItem;
    handler = () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
        if (k === STORAGE_KEY && String(v).includes("op-other-tab-1")) return;
        real.call(this, k, v);
      });
      return json({ intent: intent("op-other-tab-1") });
    };
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view()).toMatchObject({ phase: "error", error: "notPersisted" });
    expect(S().inboxSendOps[SCOPE].operationId).toBe(calls[0].body!.operationId);
  });

  it("2A-7: after a reload a failed lookup of an uncertain send is unknown (not preparing) with no intent", async () => {
    const op = await seed("unknown");
    resetSendViews();
    handler = () => json({ error: "receipt_unavailable" }, 503);
    await checkReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "unknown", intent: null, error: "receipt_unavailable" });
    expect(calls).toEqual([
      { method: "GET", path: `/social/inbox/youtube/send/${op}?account=UCa`, body: undefined },
    ]);
  });

  it("2A-9: Clear draft returns the discarded draft; a discard that fails keeps everything and says so", async () => {
    const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    if (!saved.ok || !saved.draft) throw new Error("save");
    await S().setInboxSendOp(
      SCOPE,
      {
        operationId: "op-sent-0001",
        account: "UCa",
        draftRevision: saved.draft.commitId,
        digest: sendDigest(TEXT),
        state: "sent",
      },
      null,
    );
    useSendViews.setState({ views: { [SCOPE]: { phase: "sent", intent: null, error: null } } });
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    expect(await finishReply(SCOPE, true)).toBe("failed");
    expect(view()).toMatchObject({ phase: "sent", error: "clearFailed" });
    expect(S().inboxSendOps[SCOPE].state).toBe("sent");
    expect(S().inboxDrafts[SCOPE].text).toBe(TEXT);
    spy.mockRestore();
    expect(await finishReply(SCOPE, true)).toMatchObject({
      text: TEXT,
      commitId: saved.draft.commitId,
    });
    expect(S().inboxDrafts[SCOPE]).toBeUndefined();
    expect(S().inboxSendOps[SCOPE]).toBeUndefined();
  });
});

// DT-6B-2A-R2: the provider visit is part of an action's context (2A-R1-A), a durable record decides what a tab may show
// (2A-R1-B), and the known immutable target is bound (2A-R1-C). Each case was run RED against the R1 hook first.
describe("DT-6B-2A-R2 repairs", () => {
  const sendCalls = () => calls.filter((c) => c.path.includes("/send"));
  const holdLock = () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setArticlesLock(async (fn) => {
      await gate;
      return fn();
    });
    return release;
  };
  const fresh = () => {
    localStorage.clear();
    setArticlesLock(queueLock());
    S().reset();
    S().setSettings({ apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
    resetSendViews();
    channel();
    calls = [];
  };
  const seed = async (
    state: "prepared" | "dispatching" | "unknown" | "sent",
    operationId = "op-seeded-1",
    receiptVersion?: number,
  ) => {
    const r = await S().setInboxSendOp(
      SCOPE,
      {
        operationId,
        account: "UCa",
        draftRevision: "rev-1",
        digest: sendDigest(TEXT),
        state,
        ...(receiptVersion === undefined ? {} : { receiptVersion }),
      },
      S().inboxSendOps[SCOPE]?.operationId ?? null,
    );
    expect(r.ok).toBe(true);
    return operationId;
  };
  async function review(operationId = "op-review-01") {
    handler = () => json({ intent: intent(operationId) });
    await prepareReply(SCOPE, TARGET, TEXT, "rev-1");
    expect(view().phase).toBe("review");
    calls = [];
    return operationId;
  }
  const away = () => useProviderInbox.setState({ provider: "instagram" });
  const awayAndBack = () => {
    away();
    useProviderInbox.setState({ provider: "youtube" });
  };
  const channelAwayAndBack = () => {
    useProviderInbox.setState({ channelId: null });
    useProviderInbox.setState({ channelId: "UCa" });
  };
  const LATER = Date.parse("2026-10-17T09:05:00.000Z");

  it("2A-R1-A: leaving the provider (or leaving and coming back) while Prepare writes its handle sends nothing", async () => {
    for (const move of [away, awayAndBack, channelAwayAndBack]) {
      fresh();
      const release = holdLock();
      const pending = prepareReply(SCOPE, TARGET, TEXT, "rev-1");
      move();
      release();
      await pending;
      expect(sendCalls()).toEqual([]);
      expect(view().phase).toBe("closed");
      expect(S().inboxSendOps[SCOPE]).toBeUndefined();
    }
  });

  it("2A-R1-A: leaving the provider while Confirm marks dispatching sends no POST; the mark rolls back", async () => {
    for (const move of [away, awayAndBack, channelAwayAndBack]) {
      fresh();
      const op = await review();
      const release = holdLock();
      const pending = confirmReply(SCOPE, TARGET);
      move();
      release();
      await pending;
      expect(sendCalls()).toEqual([]);
      expect(view().phase).toBe("closed");
      expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "prepared" });
    }
  });

  it("2A-R1-A: a send already on its way when the owner leaves still records its outcome for Check status", async () => {
    const op = await review();
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    handler = async () => {
      await hold;
      return json({ intent: intent(op, "sent", { providerCommentId: "Ug1.r9" }) });
    };
    const pending = confirmReply(SCOPE, TARGET);
    await vi.waitFor(() => expect(sendCalls()).toHaveLength(1));
    awayAndBack();
    release();
    await pending;
    expect(view().phase).toBe("closed");
    expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "sent" });
  });

  it("2A-R1-B: an older status answer refused by the store never shows; newer durable proof stays", async () => {
    // [handle state before, newer state another tab records, older answer released]
    for (const [before, newer, answer] of [
      ["dispatching", "sent", "dispatching"],
      ["prepared", "unknown", "prepared"],
    ] as const) {
      fresh();
      const op = await seed(before);
      let release!: (r: Response) => void;
      handler = () => new Promise<Response>((r) => (release = r));
      const pending = checkReply(SCOPE, TARGET);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      await seed(newer, op, LATER);
      release(json({ intent: intent(op, answer, { providerCommentId: "Ug1.r9" }) }));
      await pending;
      expect(S().inboxSendOps[SCOPE].state).toBe(newer);
      expect(view()).toMatchObject({ phase: "error", error: "superseded", intent: null });
    }
  });

  it("2A-R1-B: an answer about an operation another tab replaced never shows its success", async () => {
    const old = await seed("sent");
    let release!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (release = r));
    const pending = checkReply(SCOPE, TARGET);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await S().clearInboxSendOp(SCOPE, old);
    await seed("unknown", "op-next-0001");
    release(json({ intent: intent(old, "sent", { providerCommentId: "Ug1.old" }) }));
    await pending;
    expect(S().inboxSendOps[SCOPE]).toMatchObject({
      operationId: "op-next-0001",
      state: "unknown",
    });
    expect(view()).toMatchObject({ phase: "error", error: "superseded", intent: null });
    // Check status now reads the operation that is actually stored.
    handler = () =>
      json({ intent: intent("op-next-0001", "unknown", { unknownReason: "timeout" }) });
    calls = [];
    await checkReply(SCOPE, TARGET);
    expect(calls.map((c) => c.path)).toEqual([
      "/social/inbox/youtube/send/op-next-0001?account=UCa",
    ]);
    expect(view()).toMatchObject({ phase: "unknown", intent: { operationId: "op-next-0001" } });
  });

  it("2A-R1-B: a Confirm or Cancel answer that cannot be recorded is not shown", async () => {
    const op = await review();
    handler = async () => {
      // Another tab replaces this scope's operation while the confirm is on its way.
      await S().clearInboxSendOp(SCOPE, op);
      await seed("unknown", "op-other-tab-9");
      return json({ intent: intent(op, "sent", { providerCommentId: "Ug1.r9" }) });
    };
    await confirmReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
    expect(S().inboxSendOps[SCOPE].operationId).toBe("op-other-tab-9");

    fresh();
    const op2 = await seed("prepared");
    handler = async () => {
      await seed("sent", op2, LATER);
      return json({ intent: intent(op2, "dispatching") });
    };
    await cancelReply(SCOPE);
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
    expect(S().inboxSendOps[SCOPE].state).toBe("sent");
  });

  it("2A-R1-B: a refusal before the claim never reopens Send over a newer record", async () => {
    const op = await review();
    handler = async () => {
      await seed("unknown", op, LATER);
      return json({ error: "stale" }, 409);
    };
    await confirmReply(SCOPE, TARGET);
    expect(S().inboxSendOps[SCOPE].state).toBe("unknown");
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
  });

  it("2A-R1-C: a Confirm answer with another parent, video or thread stays unknown", async () => {
    for (const over of [
      { parentCommentId: "UgForeign" },
      { videoId: "vidForeign" },
      { threadId: "UgThreadForeign" },
    ]) {
      fresh();
      const op = await review();
      handler = () =>
        json({ intent: intent(op, "sent", { ...over, providerCommentId: "Ug1.r9" }) });
      await confirmReply(SCOPE, TARGET);
      expect(view()).toMatchObject({
        phase: "unknown",
        error: "mismatch",
        intent: { videoId: "vid1" },
      });
      expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "dispatching" });
    }
  });

  it("2A-R1-C: Check status and Cancel from a known review bind its target; handle-only recovery does not invent it", async () => {
    for (const over of [
      { parentCommentId: "UgForeign" },
      { videoId: "vidForeign" },
      { threadId: "UgThreadForeign" },
    ]) {
      fresh();
      const op = await review();
      handler = () => json({ intent: intent(op, "prepared", over) });
      await checkReply(SCOPE, TARGET);
      expect(view()).toMatchObject({ phase: "unknown", error: "mismatch" });
      expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op, state: "prepared" });

      fresh();
      const op2 = await review();
      handler = () => json({ intent: intent(op2, "cancelled", over) });
      await cancelReply(SCOPE);
      expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: op2, state: "prepared" });
      expect(view()).toMatchObject({ phase: "error", error: "cancelFailed" });
    }
    // After a reload (no intent known) the handle's own identity is all that is compared: the canonical answer lands.
    fresh();
    const op = await seed("dispatching");
    handler = () =>
      json({
        intent: intent(op, "sent", { parentCommentId: "UgOther", providerCommentId: "Ug1.r9" }),
      });
    await checkReply(SCOPE, TARGET);
    expect(view()).toMatchObject({ phase: "sent", intent: { parentCommentId: "UgOther" } });
    // And a matching answer from a known review still converges.
    fresh();
    const op3 = await review();
    handler = () => json({ intent: intent(op3, "sent", { providerCommentId: "Ug1.r9" }) });
    await checkReply(SCOPE, TARGET);
    expect(view().phase).toBe("sent");
  });
});
