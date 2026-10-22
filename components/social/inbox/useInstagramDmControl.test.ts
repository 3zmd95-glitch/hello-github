// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dmControlKey } from "@/lib/inboxInstagramDmControl";
import {
  STORAGE_KEY,
  setArticlesLock,
  useStore,
  type ArticlesLock,
  type InboxInstagramDmControl,
} from "@/store";
import { resetInbox, useInbox } from "./useInbox";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";
import {
  checkInstagramDmControl,
  confirmInstagramDmControl,
  openInstagramDmControlReview,
  registerInstagramDmControl,
  resetInstagramDmControlViews,
  useInstagramDmControlViews,
} from "./useInstagramDmControl";

// 🛟 Verified-handle Instagram conversation takeover/resume, client side (packet DT-6B-2C-5B). New registration is
// closed in production (`instagramDmControlReadiness`); this file reaches it ONLY by injecting `{ readiness }`. Status,
// takeover and resume of an existing verified handle need no readiness, account read, row or provider: the matching
// Worker's bearer, the stored account and the durable handle. The pending action is persisted before every mutation
// (failed durability = no request); an answer applies only after its exact durable read-back; fences (connection,
// visit, latest action) hold after every await and right before the request; ambiguity is Check status only; nothing
// is retried or sent. Transport is a fake Worker.

const OPEN = { readiness: () => ({ ok: true }) as const };
const WORKER = "https://scout.test";
const OLD = "https://old.test";
const RG = "c".repeat(32);
const ME = "17841000000000001";
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const PERSON = "990000000000001";
const OTHER = "990000000000002";
const H = "a".repeat(32);
const GEN = "e".repeat(32);
const EVI = "f".repeat(64);
const KEY = dmControlKey(WORKER, ME, CONV);
const T = "2026-10-17T09:00:00.000Z";
const CONTROL = "/social/inbox/instagram/dm/control";

const S = () => useStore.getState();
const view = (k = KEY) => useInstagramDmControlViews.getState().views[k];
const entry = (k = KEY) => S().inboxInstagramDmControls[k];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const row = (n: number) => ({
  account: ME,
  conversationId: CONV,
  recipientId: PERSON,
  inboundMessageId: `in${n}`,
  actor: "auto:cam",
  payloadDigest: "d".repeat(64),
  generation: "0".repeat(32),
  state: "claimed",
  claimedAt: T,
  receiptVersion: 1,
});
/** A complete Worker control view (what the real handler answers, see lib/inboxInstagramDmControl.test.ts). */
const full = (
  over: {
    mode?: "auto" | "human";
    revision?: number;
    rows?: number;
    total?: number;
    uncertain?: number;
    changed?: boolean;
    recipientId?: string;
    handleId?: string;
  } = {},
) => {
  const rows = Array.from({ length: over.rows ?? 1 }, (_, i) => row(i + 1));
  const total = over.total ?? rows.length;
  return {
    control: {
      handleId: over.handleId ?? H,
      account: ME,
      conversationId: CONV,
      recipientId: over.recipientId ?? PERSON,
      registeredGeneration: GEN,
      evidenceDigest: EVI,
      createdAt: T,
      usedAt: T,
    },
    conversation: {
      account: ME,
      conversationId: CONV,
      mode: over.mode ?? "auto",
      revision: over.revision ?? 0,
    },
    inFlight: rows.map((r) => ({ ...r, recipientId: over.recipientId ?? PERSON })),
    inFlightTotal: total,
    inFlightTruncated: total > rows.length,
    uncertainTotal: over.uncertain ?? 0,
    ...(over.changed === undefined ? {} : { changed: over.changed }),
  };
};
const conflict = (mode: "auto" | "human", revision: number) => ({
  error: "conflict",
  control: { handleId: H, account: ME, conversationId: CONV, recipientId: PERSON },
  conversation: { account: ME, conversationId: CONV, mode, revision },
});

type Call = {
  method: string;
  path: string;
  query: string;
  body: Record<string, unknown> | undefined;
  redirect?: string;
  auth: string | null;
  origin: string;
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

function instagramOn(accountId: string | null = ME, conversationId: string | null = CONV) {
  useProviderInbox.setState({ provider: "instagram" });
  useInbox.setState({
    origin: WORKER,
    account: accountId
      ? {
          accountId,
          handle: "3z.prod",
          generation: RG,
          capabilities: { messages: "ok", comments: "ok" },
        }
      : null,
    accountError: accountId ? null : "token_expired",
    tab: "messages",
    conversationId,
  });
}

type Entry = Omit<InboxInstagramDmControl, "updatedAt" | "commitId">;
/** A verified handle as an earlier session left it. */
async function seed(over: Partial<Entry> = {}, key = KEY) {
  const r = await S().setInboxInstagramDmControl(
    key,
    {
      workerOrigin: WORKER,
      account: ME,
      conversationId: CONV,
      handleId: H,
      recipientId: PERSON,
      registeredGeneration: GEN,
      evidenceDigest: EVI,
      mode: "auto",
      revision: 0,
      inFlightTotal: 1,
      inFlightTruncated: false,
      uncertainTotal: 0,
      ...over,
    },
    S().inboxInstagramDmControls[key]?.commitId ?? null,
  );
  if (!r.ok) throw new Error(r.reason);
  return r.entry!;
}
const takeoverPending = (expectedRevision = 0) => ({
  action: "takeover" as const,
  expectedRevision,
  requestedMode: "human" as const,
  at: T,
});

const target = (over: { recipientId?: string } = {}) => ({
  account: ME,
  conversationId: CONV,
  ...over,
});
const posts = () => calls.filter((c) => c.method === "POST").map((c) => c.path);

beforeEach(() => {
  setArticlesLock(queueLock());
  localStorage.clear();
  S().reset();
  S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetInstagramDmControlViews();
  resetInbox();
  instagramOn();
  calls = [];
  handler = () => json({ error: "not_found" }, 404);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      const c: Call = {
        method: init?.method ?? "GET",
        path: u.pathname,
        query: u.search,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
        redirect: init?.redirect,
        auth: new Headers(init?.headers).get("Authorization"),
        origin: u.origin,
      };
      calls.push(c);
      return handler(c);
    }),
  );
});

afterEach(() => {
  // Control actions reach only the control routes of the configured Worker, never a DM send route.
  for (const c of calls) {
    expect(c.path.startsWith(CONTROL)).toBe(true);
    expect(c.origin).toBe(WORKER);
    expect(c.redirect).toBe("manual");
    expect(c.auth).toBe("Bearer owner-token");
  }
  vi.unstubAllGlobals();
  setArticlesLock(undefined);
  resetProviderInbox();
});

describe("registration (closed in production; injected only here)", () => {
  it("production says unavailable, stores nothing and asks nothing", async () => {
    await registerInstagramDmControl(KEY, target());
    expect(view()).toMatchObject({ phase: "error", error: "unavailable" });
    expect(entry()).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("persists the pending registration first, learns the server-proven handle and never changes the mode", async () => {
    let atRequest: unknown;
    handler = (c) => {
      atRequest = stored().inboxInstagramDmControls[KEY];
      expect(c.body).toEqual({ account: ME, conversationId: CONV });
      return json(full({ rows: 0 }));
    };
    await registerInstagramDmControl(KEY, target(), OPEN);
    expect(atRequest).toMatchObject({ pending: { action: "register" } });
    expect((atRequest as Entry).handleId).toBeUndefined();
    expect(entry()).toMatchObject({
      handleId: H,
      recipientId: PERSON,
      registeredGeneration: GEN,
      mode: "auto",
      revision: 0,
      inFlightTotal: 0,
    });
    expect(entry()?.pending).toBeUndefined();
    expect(posts()).toEqual([`${CONTROL}/register`]);
    expect(view()).toMatchObject({ phase: "status" });
  });

  it("checks an already-known selected recipient: another one is mismatch and nothing is learned", async () => {
    handler = () => json(full({ recipientId: PERSON }));
    await registerInstagramDmControl(KEY, target({ recipientId: OTHER }), OPEN);
    expect(view()).toMatchObject({ phase: "uncertain", error: "mismatch" });
    expect(entry()?.handleId).toBeUndefined();
    expect(entry()).toMatchObject({ uncertain: "registration" });
  });

  it("a lost registration keeps honest uncertainty: no invented handle, no mutation, no retry", async () => {
    handler = () => {
      throw new TypeError("connection reset");
    };
    await registerInstagramDmControl(KEY, target(), OPEN);
    expect(entry()).toMatchObject({ pending: { action: "register" }, uncertain: "registration" });
    expect(entry()?.handleId).toBeUndefined();
    await openInstagramDmControlReview(KEY, "takeover");
    expect(view()?.phase).not.toBe("review");
    await checkInstagramDmControl(KEY);
    expect(calls).toHaveLength(1);
    // Only a new explicit registration (readiness + fresh proof) may converge on the handle.
    handler = () => json(full());
    await registerInstagramDmControl(KEY, target(), OPEN);
    expect(entry()).toMatchObject({ handleId: H });
    expect(entry()?.uncertain).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it("a conclusively refused registration lets its entry go; no handle is invented", async () => {
    handler = () => json({ error: "target_invalid", detail: "no-customer" }, 409);
    await registerInstagramDmControl(KEY, target(), OPEN);
    expect(view()).toMatchObject({
      phase: "error",
      error: "target_invalid",
      detail: "no-customer",
    });
    expect(entry()).toBeUndefined();
    expect(stored().inboxInstagramDmControls[KEY]).toBeUndefined();
  });

  it("failed durability or no room means zero requests; capacity is explicit", async () => {
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await registerInstagramDmControl(KEY, target(), OPEN);
    expect(view()).toMatchObject({ phase: "error", error: "notPersisted" });
    spy.mockRestore();
    for (let i = 0; i < 50; i++)
      await seed(
        {
          conversationId: `c${i}`,
          handleId: i.toString(16).padStart(32, "0"),
          pending: takeoverPending(),
        },
        dmControlKey(WORKER, ME, `c${i}`),
      );
    await registerInstagramDmControl(KEY, target(), OPEN);
    expect(view()).toMatchObject({ phase: "error", error: "capacity" });
    expect(calls).toEqual([]);
  });
});

describe("existing verified handles: status, takeover, resume", () => {
  it("Check status needs no account read, row or readiness; another Worker's handle is never asked", async () => {
    await seed();
    instagramOn(null, null);
    useProviderInbox.setState({ provider: "threads" });
    handler = (c) => {
      expect(c.query).toBe(`?account=${ME}`);
      return json(full({ mode: "human", revision: 4, rows: 2, total: 23, uncertain: 3 }));
    };
    await checkInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "status" });
    expect(view()?.view?.inFlightTotal).toBe(23);
    expect(entry()).toMatchObject({
      mode: "human",
      revision: 4,
      inFlightTotal: 23,
      inFlightTruncated: true,
      uncertainTotal: 3,
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET ${CONTROL}/${H}`]);
    const OLD_KEY = dmControlKey(OLD, ME, CONV);
    await seed({ workerOrigin: OLD }, OLD_KEY);
    await checkInstagramDmControl(OLD_KEY);
    await openInstagramDmControlReview(OLD_KEY, "takeover");
    expect(view(OLD_KEY)).toMatchObject({ error: "foreign" });
    expect(calls).toHaveLength(1);
  });

  it("takeover: explicit review, the pending action persisted before the request, applied after exact read-back", async () => {
    await seed();
    await confirmInstagramDmControl(KEY);
    expect(calls).toEqual([]);
    await openInstagramDmControlReview(KEY, "takeover");
    expect(view()).toMatchObject({
      phase: "review",
      review: { action: "takeover", expectedRevision: 0, mode: "human" },
    });
    expect(calls).toEqual([]);
    let atRequest: InboxInstagramDmControl | undefined;
    handler = (c) => {
      atRequest = stored().inboxInstagramDmControls[KEY];
      expect(c.body).toEqual({ account: ME, expectedRevision: 0 });
      return json(full({ mode: "human", revision: 1, changed: true }));
    };
    await confirmInstagramDmControl(KEY);
    expect(atRequest?.pending).toMatchObject({
      action: "takeover",
      expectedRevision: 0,
      requestedMode: "human",
    });
    expect(posts()).toEqual([`${CONTROL}/${H}/takeover`]);
    expect(view()).toMatchObject({ phase: "done", changed: true });
    expect(entry()).toMatchObject({ mode: "human", revision: 1 });
    expect(entry()?.pending).toBeUndefined();
    // The review is used up: another Confirm asks nothing.
    await confirmInstagramDmControl(KEY);
    expect(calls).toHaveLength(1);
    // Resume is its own explicit review; a genuine no-op says nothing changed.
    await openInstagramDmControlReview(KEY, "resume");
    handler = () => json(full({ mode: "auto", revision: 2, changed: true }));
    await confirmInstagramDmControl(KEY);
    expect(entry()).toMatchObject({ mode: "auto", revision: 2 });
    await openInstagramDmControlReview(KEY, "resume");
    handler = () => json(full({ mode: "auto", revision: 2, changed: false }));
    await confirmInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "done", changed: false });
    expect(posts()).toHaveLength(3);
  });

  it("a lost mutation stays pending and uncertain: no retry, no new review; Check status resolves without attribution", async () => {
    await seed();
    await openInstagramDmControlReview(KEY, "takeover");
    handler = () => {
      throw new TypeError("connection reset");
    };
    await confirmInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "uncertain", error: "network" });
    expect(entry()).toMatchObject({
      pending: { action: "takeover", expectedRevision: 0, requestedMode: "human" },
      uncertain: "mutation",
    });
    expect(entry()?.pending?.at).toBeDefined();
    await openInstagramDmControlReview(KEY, "takeover");
    expect(view()).toMatchObject({ error: "unresolved" });
    await confirmInstagramDmControl(KEY);
    expect(calls).toHaveLength(1);
    handler = () => json(full({ mode: "human", revision: 1 }));
    await checkInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "status", resolved: true });
    expect(entry()).toMatchObject({ mode: "human", revision: 1 });
    expect(entry()?.pending).toBeUndefined();
    expect(entry()?.uncertain).toBeUndefined();
    expect(posts()).toHaveLength(1);
  });

  it("a conflict is narrow: pending cleared, counts dropped (never manufactured), a new change needs Check status and a fresh review", async () => {
    await seed({ inFlightTotal: 4, uncertainTotal: 2 });
    await openInstagramDmControlReview(KEY, "takeover");
    handler = () => json(conflict("human", 3), 409);
    await confirmInstagramDmControl(KEY);
    expect(view()).toMatchObject({
      phase: "conflict",
      conflict: { conversation: { mode: "human", revision: 3 } },
    });
    expect(view()?.view).toBeUndefined();
    expect(entry()).toMatchObject({ mode: "human", revision: 3 });
    expect(entry()?.inFlightTotal).toBeUndefined();
    expect(entry()?.uncertainTotal).toBeUndefined();
    expect(entry()?.pending).toBeUndefined();
    await openInstagramDmControlReview(KEY, "resume");
    expect(view()).toMatchObject({ error: "checkFirst" });
    handler = () => json(full({ mode: "human", revision: 3 }));
    await checkInstagramDmControl(KEY);
    await openInstagramDmControlReview(KEY, "resume");
    expect(view()).toMatchObject({ phase: "review", review: { expectedRevision: 3 } });
    expect(posts()).toHaveLength(1);
  });

  it("a late Status never regresses a newer revision or a newer pending action", async () => {
    await seed();
    let answer!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (answer = r));
    const late = checkInstagramDmControl(KEY);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await seed({
      mode: "human",
      revision: 5,
      pending: { ...takeoverPending(5), action: "resume", requestedMode: "auto" },
    });
    answer(json(full({ mode: "human", revision: 2 })));
    await late;
    expect(entry()).toMatchObject({ mode: "human", revision: 5, pending: { action: "resume" } });
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
  });

  it("a visit change while the pending action is written sends nothing and lets the pending action go", async () => {
    await seed();
    await openInstagramDmControlReview(KEY, "takeover");
    const release = holdLock();
    const run = confirmInstagramDmControl(KEY);
    useInbox.setState({ conversationId: "other" });
    release();
    await run;
    expect(calls).toEqual([]);
    expect(view()?.phase).toBe("closed");
    expect(entry()?.pending).toBeUndefined();
  });

  it("another tab's newer record between review and Confirm means no request", async () => {
    await seed();
    await openInstagramDmControlReview(KEY, "takeover");
    await seed({ mode: "human", revision: 1 });
    await confirmInstagramDmControl(KEY);
    expect(calls).toEqual([]);
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
    expect(entry()).toMatchObject({ mode: "human", revision: 1 });
  });

  it("failed durability before a mutation means zero requests", async () => {
    await seed();
    await openInstagramDmControlReview(KEY, "takeover");
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await confirmInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "error", error: "notPersisted" });
    expect(calls).toEqual([]);
    vi.restoreAllMocks();
  });

  it("not_found is unavailable (possibly retired): not auto mode, not a resolution of the pending action", async () => {
    await seed({ mode: "human", revision: 2, pending: takeoverPending(2), uncertain: "mutation" });
    handler = () => json({ error: "not_found" }, 404);
    await checkInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "unavailable" });
    expect(entry()).toMatchObject({ mode: "human", revision: 2, uncertain: "mutation" });
  });

  it("a mismatched answer is never recorded and leaves the mutation uncertain", async () => {
    await seed();
    await openInstagramDmControlReview(KEY, "takeover");
    handler = () =>
      json(full({ mode: "human", revision: 1, changed: true, handleId: "b".repeat(32) }));
    await confirmInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "uncertain", error: "mismatch" });
    expect(entry()).toMatchObject({ handleId: H, revision: 0, uncertain: "mutation" });
  });
});

// 🛟 DT-6B-2C-5B-R1: a Status lets go of a pending action only when it observed that exact action and proves it can no
// longer apply; a conflict is painted only as what storage committed; a review's rows belong to the exact durable record
// they were recorded as.
describe("DT-6B-2C-5B-R1 control persistence and recovery", () => {
  const held = () => {
    let answer!: (r: Response) => void;
    let fail!: (e: unknown) => void;
    const promise = new Promise<Response>((r, j) => {
      answer = r;
      fail = j;
    });
    return { promise, answer, fail };
  };

  it("5B-1: a Status begun before Confirm keeps the newer pending action; the lost answer still marks it uncertain", async () => {
    await seed();
    const get = held();
    const post = held();
    handler = (c) => (c.method === "GET" ? get.promise : post.promise);
    const checking = checkInstagramDmControl(KEY);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    await openInstagramDmControlReview(KEY, "takeover");
    const sending = confirmInstagramDmControl(KEY);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    const marked = entry()?.pending;
    expect(marked).toMatchObject({ action: "takeover", expectedRevision: 0 });
    get.answer(json(full({ total: 3, uncertain: 1 })));
    await checking;
    expect(entry()?.pending).toEqual(marked);
    expect(entry()).toMatchObject({
      mode: "auto",
      revision: 0,
      inFlightTotal: 3,
      uncertainTotal: 1,
    });
    post.fail(new TypeError("connection reset"));
    await sending;
    expect(entry()?.pending).toEqual(marked);
    expect(entry()?.uncertain).toBe("mutation");
    await openInstagramDmControlReview(KEY, "takeover");
    expect(view()).toMatchObject({ error: "unresolved" });
    expect(posts()).toHaveLength(1);
  });

  it("5B-1: a Status at the expected revision in the other mode while the request is held keeps it pending; its answer settles it", async () => {
    await seed();
    const post = held();
    handler = (c) => (c.method === "POST" ? post.promise : json(full()));
    await openInstagramDmControlReview(KEY, "takeover");
    const sending = confirmInstagramDmControl(KEY);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    await checkInstagramDmControl(KEY);
    expect(entry()?.pending).toMatchObject({ action: "takeover", expectedRevision: 0 });
    expect(view()).toMatchObject({ phase: "status" });
    expect(view()?.resolved).toBeFalsy();
    await openInstagramDmControlReview(KEY, "takeover");
    expect(view()).toMatchObject({ error: "unresolved" });
    post.answer(json(full({ mode: "human", revision: 1, changed: true })));
    await sending;
    expect(entry()).toMatchObject({ mode: "human", revision: 1 });
    expect(entry()?.pending).toBeUndefined();
    expect(posts()).toHaveLength(1);
  });

  it("5B-1 control: a Status at the expected revision already in the requested mode settles the action it observed", async () => {
    await seed({ mode: "human", revision: 2, pending: takeoverPending(2), uncertain: "mutation" });
    handler = () => json(full({ mode: "human", revision: 2 }));
    await checkInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "status", resolved: true });
    expect(entry()?.pending).toBeUndefined();
    expect(entry()?.uncertain).toBeUndefined();
    expect(posts()).toHaveLength(0);
  });

  it("5B-1 control: a newer-revision Status settles the observed pending action without any repeat", async () => {
    await seed({ pending: takeoverPending(0), uncertain: "mutation" });
    handler = () => json(full({ mode: "human", revision: 1 }));
    await checkInstagramDmControl(KEY);
    expect(view()).toMatchObject({ phase: "status", resolved: true });
    expect(entry()).toMatchObject({ mode: "human", revision: 1 });
    expect(entry()?.pending).toBeUndefined();
    await openInstagramDmControlReview(KEY, "resume");
    expect(view()).toMatchObject({ phase: "review", review: { expectedRevision: 1 } });
    expect(posts()).toHaveLength(0);
  });

  it("5B-2: a conflict older than stored proof is never painted; the sheet reconciles to the stored state", async () => {
    await seed();
    const post = held();
    handler = () => post.promise;
    await openInstagramDmControlReview(KEY, "takeover");
    const sending = confirmInstagramDmControl(KEY);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    // Another tab stored newer proof meanwhile (through the real setter).
    await seed({ mode: "auto", revision: 2 });
    post.answer(json(conflict("human", 1), 409));
    await sending;
    expect(entry()).toMatchObject({ mode: "auto", revision: 2 });
    expect(view()?.phase).not.toBe("conflict");
    expect(view()?.conflict).toBeUndefined();
    expect(view()).toMatchObject({ phase: "error", error: "superseded" });
  });

  it("5B-2: a conflict that could not be saved is disclosed, keeps the pending action and leaves Check status", async () => {
    await seed();
    const post = held();
    handler = () => post.promise;
    await openInstagramDmControlReview(KEY, "takeover");
    const sending = confirmInstagramDmControl(KEY);
    await vi.waitFor(() => expect(posts()).toHaveLength(1));
    const marked = entry()?.pending;
    const setter = S().setInboxInstagramDmControl;
    useStore.setState({
      setInboxInstagramDmControl: async () => ({ ok: false, reason: "not-persisted" }) as const,
    });
    try {
      post.answer(json(conflict("human", 1), 409));
      await sending;
    } finally {
      useStore.setState({ setInboxInstagramDmControl: setter });
    }
    expect(view()).toMatchObject({ phase: "error", error: "unrecorded" });
    expect(view()?.conflict).toBeUndefined();
    expect(entry()?.pending).toEqual(marked);
    expect(entry()).toMatchObject({ mode: "auto", revision: 0 });
    await openInstagramDmControlReview(KEY, "takeover");
    expect(view()).toMatchObject({ error: "unresolved" });
  });

  it("5B-5: a review never shows rows older than the stored counts; it shows the stored totals instead", async () => {
    await seed();
    handler = () => json(full({ total: 1, uncertain: 1 }));
    await checkInstagramDmControl(KEY);
    // Another tab checked the same revision and saved newer counts.
    await seed({ inFlightTotal: 7, inFlightTruncated: true, uncertainTotal: 5 });
    await openInstagramDmControlReview(KEY, "takeover");
    expect(view()).toMatchObject({ phase: "review", review: { expectedRevision: 0 } });
    expect(view()?.view).toBeUndefined();
    expect(posts()).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });

  it("5B-5 control: right after this tab's Status the review keeps that exact view and its rows", async () => {
    await seed();
    handler = () => json(full({ rows: 2, total: 7, uncertain: 5 }));
    await checkInstagramDmControl(KEY);
    await openInstagramDmControlReview(KEY, "takeover");
    expect(view()?.view?.inFlight).toHaveLength(2);
    expect(view()?.commit).toBe(entry()?.commitId);
  });
});
