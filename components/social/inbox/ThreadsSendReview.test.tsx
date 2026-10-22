// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxScopeV2 } from "@/lib/inbox";
import { threadsSendDigest, type ThreadsSendReadiness } from "@/lib/inboxThreadsSend";
import {
  STORAGE_KEY,
  inboxDraftBase,
  setArticlesLock,
  useStore,
  type ArticlesLock,
  type InboxDraft,
} from "@/store";
import ThreadsSendReview, {
  ThreadsSendRecoveryList,
  type ThreadsReplyTarget,
} from "./ThreadsSendReview";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";
import DraftBox from "./DraftBox";
import { resetThreadsSendViews } from "./useThreadsSend";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 📤 The Threads review sheet (packet DT-6B-2B-2) in English and Arabic. Production readiness is closed: "Send as reply"
// is disabled with the honest reason, and a retained operation opens to Check status only. The enabled path (review,
// Send, Resume) is reached ONLY through a module mock of the readiness dependency. The review names the account, the
// owned root post (its existing validated link, labelled as the post, never as the reply), the exact receiving reply
// and the canonical text; a published reply shows its id as text, never an invented link. Transport is a fake Worker.

const gate = vi.hoisted(() => ({
  ready: { ok: false, reason: "permission_unverified" } as ThreadsSendReadiness,
}));
vi.mock("@/lib/inboxThreadsSend", async (orig) => ({
  ...(await orig<typeof import("@/lib/inboxThreadsSend")>()),
  threadsSendReadiness: () => gate.ready,
}));

const WORKER = "https://scout.test";
const G = "d".repeat(32);
const ME = "25";
const ROOT = "90001";
const REPLY = "91001";
const SCOPE = inboxScopeV2("threads", WORKER, ME, "comment", REPLY);
const TEXT = "Thanks for the reply!";
const C = "17800000000000001";
const P = "18000000000000009";
const PERMALINK = "https://www.threads.net/@3z.prod/post/90001";
const SAVED: InboxDraft = { text: TEXT, updatedAt: "2026-10-17T09:00:00.000Z", commitId: "rev-1" };

const target = (over: Partial<ThreadsReplyTarget> = {}): ThreadsReplyTarget => ({
  sendRef: "send.ref",
  account: ME,
  generation: G,
  rootPostId: ROOT,
  replyToId: REPLY,
  accountName: "3z.prod",
  capability: "permission_unverified",
  ...over,
});

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
  created: 3,
  unknown_creation: 3,
  publishing: 4,
  published: 5,
  rejected: 5,
  unknown_publication: 5,
  cancelled: 2,
  expired: 2,
};
const intent = (operationId: string, state = "prepared", over: Record<string, unknown> = {}) => ({
  operationId,
  provider: "threads",
  account: ME,
  generation: G,
  rootPostId: ROOT,
  replyToId: REPLY,
  text: TEXT,
  digest: threadsSendDigest(TEXT),
  draftRevision: "rev-1",
  state,
  reviewExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:00.000Z",
  receiptVersion: VERSION[state],
  ...STAGE[state],
  ...over,
});

function threadsOn(withRows = true) {
  const head = { fetchedAt: null, next: null, coverage: "end" as const, error: null };
  useProviderInbox.setState({
    provider: "threads",
    origin: WORKER,
    threads: {
      provider: "threads",
      accountId: ME,
      handle: "3z.prod",
      generation: G,
      capabilities: { replies: "ok", sendReplies: "permission_unverified" },
    },
    lists: withRows
      ? {
          [inboxScopeV2("threads", WORKER, ME, "posts")]: {
            ...head,
            items: [
              { id: ROOT, ref: "ref.s", text: "my thread", permalink: PERMALINK, timestamp: null },
            ],
          },
          [inboxScopeV2("threads", WORKER, ME, "replies", ROOT)]: {
            ...head,
            items: [
              {
                id: REPLY,
                text: "the fan's words",
                author: { username: "fan_one" },
                createdAt: null,
                direction: "in",
                kind: "text",
                rootId: ROOT,
                parentId: ROOT,
                sendRef: "send.ref",
              },
            ],
          },
        }
      : {},
  });
}

let root: Root;
let host: HTMLDivElement;
let calls: { method: string; path: string }[];
let lastQuery = "";
let handler: (method: string, path: string, body: Record<string, string>) => unknown;

const S = () => useStore.getState();
const $ = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function until(fn: () => void, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    await act(() => new Promise<void>((r) => setTimeout(r, 15)));
    try {
      fn();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
  }
}

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};

function render(
  t: ThreadsReplyTarget = target(),
  text = TEXT,
  saved: InboxDraft | null = SAVED,
  onCleared?: (d: InboxDraft) => void,
) {
  act(() =>
    root.render(
      <ThreadsSendReview
        scope={SCOPE}
        target={t}
        draft={{ text, saved: saved ?? undefined }}
        onCleared={onCleared}
      />,
    ),
  );
}

const click = async (id: string) => {
  await act(async () => $(id)!.click());
};

async function seed(state: string, operationId = "op-th-seeded1") {
  const i: Record<string, unknown> = intent(operationId, state);
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

beforeEach(() => {
  gate.ready = { ok: false, reason: "permission_unverified" };
  localStorage.clear();
  setArticlesLock(queueLock());
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  S().reset();
  S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetThreadsSendViews();
  threadsOn();
  calls = [];
  handler = (_m, path, body) =>
    path.endsWith("/prepare") ? { intent: intent(body.operationId) } : { error: "not_found" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      const method = init?.method ?? "GET";
      calls.push({ method, path: u.pathname });
      lastQuery = u.search.slice(1);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const out = await handler(method, u.pathname, body);
      return out instanceof Response
        ? out
        : json(out, (out as { error?: string }).error ? 409 : 200);
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  setArticlesLock(undefined);
  resetProviderInbox();
});

describe("production (readiness closed)", () => {
  it("Send as reply is disabled with the honest reason; nothing is asked", async () => {
    render();
    const open = $("ibx-ths-open") as HTMLButtonElement;
    expect(open.textContent).toContain("Send as reply");
    expect(open.disabled).toBe(true);
    expect($("ibx-ths-unavailable")!.textContent).toContain("isn't verified yet");
    expect($("ibx-ths-check")).toBeNull();
    await act(async () => open.click());
    expect($("ibx-ths-sheet")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("in Arabic the reason is Arabic too", () => {
    S().setSettings({ lang: "ar" });
    render();
    expect($("ibx-ths-open")!.textContent).toContain("أرسله كرد");
    expect($("ibx-ths-unavailable")!.textContent).toContain("ما تأكدنا منه");
  });

  it("rows without a send target, and older Workers, show nothing", () => {
    render(target({ sendRef: undefined }));
    expect(host.textContent).toBe("");
    render(target({ capability: undefined }));
    expect(host.textContent).toBe("");
    expect(calls).toEqual([]);
  });

  it("a retained operation opens to Check status only: one GET, its state, no Send or Resume", async () => {
    const id = await seed("unknown_publication");
    handler = () => ({ intent: intent(id, "unknown_publication") });
    render(target({ sendRef: undefined }), "", null);
    expect($("ibx-ths-status")!.dataset.state).toBe("unknown_publication");
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("unknown_publication"));
    expect(calls).toEqual([{ method: "GET", path: `/social/inbox/threads/send/${id}` }]);
    expect($("ibx-ths-sheet")!.textContent).toContain("may have been published");
    expect($("ibx-ths-why")!.textContent).toContain("doesn't say whether it worked");
    expect($("ibx-ths-sheet-check")).not.toBeNull();
    expect($("ibx-ths-confirm")).toBeNull();
    expect($("ibx-ths-resume")).toBeNull();
    expect($("ibx-ths-again")).toBeNull();
  });

  it("a durable `created` shows Resume disabled with the reason", async () => {
    const id = await seed("created");
    handler = () => ({ intent: intent(id, "created") });
    render();
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("created"));
    expect(($("ibx-ths-resume") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-ths-resume-note")!.textContent).toContain(
      "waits until Threads sending is verified",
    );
    await click("ibx-ths-resume");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });
});

describe("states, each with its own copy and Check status", () => {
  const cases: [string, string][] = [
    ["creating", "Threads is making the reply"],
    ["publishing", "Threads is publishing the reply"],
    ["unknown_creation", "may exist unpublished"],
    ["unknown_publication", "may have been published"],
    ["rejected", "Threads refused this reply (meta_10)"],
    ["expired", "expired before Send"],
    ["cancelled", "Cancelled. Nothing was sent."],
  ];
  for (const [state, copy] of cases)
    it(state, async () => {
      const id = await seed(state);
      handler = () => ({ intent: intent(id, state) });
      render();
      await click("ibx-ths-check");
      await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe(state));
      expect($("ibx-ths-sheet")!.textContent).toContain(copy);
      expect($("ibx-ths-sheet-check")).not.toBeNull();
      expect($("ibx-ths-confirm")).toBeNull();
    });

  it("superseded and save-failed answers say so and keep Check status", async () => {
    const id = await seed("publishing");
    handler = () => ({ intent: intent(id, "created") });
    render();
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-error")!.textContent).toContain("Another tab updated"));
    expect($("ibx-ths-sheet-check")).not.toBeNull();
    const real = Storage.prototype.setItem;
    handler = () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
        if (k === "3z-prod-v1") throw new DOMException("full", "QuotaExceededError");
        real.call(this, k, v);
      });
      return { intent: intent(id, "published", { receiptVersion: 6 }) };
    };
    await click("ibx-ths-sheet-check");
    await until(() =>
      expect($("ibx-ths-error")!.textContent).toContain("couldn't save the latest answer"),
    );
    vi.restoreAllMocks();
    expect(S().inboxThreadsSendOps[SCOPE].state).toBe("publishing");
  });

  it("a local uncertainty (Send may have left) is distinct from a durable unknown", async () => {
    await seed("confirming");
    handler = () => json({ error: "receipt_unavailable" }, 503);
    render();
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("uncertain"));
    expect($("ibx-ths-sheet")!.textContent).toContain("don't know whether Send reached Threads");
    expect($("ibx-ths-sheet")!.textContent).not.toContain("may have been published");
  });

  it("in Arabic", async () => {
    S().setSettings({ lang: "ar" });
    const id = await seed("unknown_creation");
    handler = () => ({ intent: intent(id, "unknown_creation") });
    render();
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("unknown_creation"));
    expect($("ibx-ths-sheet")!.textContent).toContain("يمكن يكون موجود بدون نشر");
    expect($("ibx-ths-sheet-check")!.textContent).toBe("شيّك على الحالة");
  });
});

describe("the enabled path (readiness mocked open; never shipped)", () => {
  beforeEach(() => {
    gate.ready = { ok: true };
  });

  it("only a saved draft can be prepared", () => {
    render(target(), "edited after saving");
    expect(($("ibx-ths-open") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-ths-note")!.textContent).toContain("Save the draft first");
    expect($("ibx-ths-unavailable")).toBeNull();
  });

  it("the review names account, root post (labelled as the post), the exact reply and text; Cancel sends nothing", async () => {
    render();
    await click("ibx-ths-open");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-ths-account")!.textContent).toContain("3z.prod");
    expect($("ibx-ths-root-text")!.textContent).toBe("my thread");
    const link = $("ibx-ths-root-link") as HTMLAnchorElement;
    expect(link.href).toBe(PERMALINK);
    expect(link.textContent).toContain(
      "Open your post on Threads (the post itself, not the reply)",
    );
    expect($("ibx-ths-reply-text")!.textContent).toBe("the fan's words");
    expect($("ibx-ths-reply-id")!.textContent).toContain(REPLY);
    expect($("ibx-ths-text")!.textContent).toBe(TEXT);
    expect($("ibx-ths-expires")!.textContent).toMatch(/closes in \d+:\d\d/);
    handler = (_m, path) => ({ intent: intent(path.split("/")[5], "cancelled") });
    await click("ibx-ths-cancel");
    await until(() => expect(S().inboxThreadsSendOps[SCOPE]).toBeUndefined());
    expect(calls.map((c) => `${c.method} ${c.path.split("/").pop()}`)).toEqual([
      "POST prepare",
      "POST cancel",
    ]);
  });

  it("without loaded rows the review still shows the ids, never a borrowed excerpt", async () => {
    threadsOn(false);
    render();
    await click("ibx-ths-open");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-ths-root-text")).toBeNull();
    expect($("ibx-ths-root-link")).toBeNull();
    expect($("ibx-ths-reply-text")).toBeNull();
    expect($("ibx-ths-root-id")!.textContent).toContain(ROOT);
    expect($("ibx-ths-reply-id")!.textContent).toContain(REPLY);
  });

  it("Send publishes once; the published id is text, never a made-up link; Clear draft keeps newer edits", async () => {
    const cleared = vi.fn();
    const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    if (!saved.ok) throw new Error("save");
    const rev = saved.draft!.commitId;
    handler = (_m, path, body) =>
      path.endsWith("/prepare")
        ? { intent: intent(body.operationId, "prepared", { draftRevision: rev }) }
        : { intent: intent(body.operationId, "published", { draftRevision: rev }) };
    render(target(), TEXT, saved.draft!, cleared);
    await click("ibx-ths-open");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("review"));
    await click("ibx-ths-confirm");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("published"));
    expect($("ibx-ths-published-id")!.textContent).toContain(P);
    const hrefs = [...document.body.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([PERMALINK]);
    expect(hrefs.join()).not.toContain(P);
    // A newer revision was saved meanwhile: Clear draft leaves it alone.
    await S().saveInboxDraft(SCOPE, "newer words", inboxDraftBase(S().inboxDrafts[SCOPE]));
    await click("ibx-ths-clear");
    await until(() => expect($("ibx-ths-sheet")).toBeNull());
    expect(cleared).not.toHaveBeenCalled();
    expect(S().inboxDrafts[SCOPE].text).toBe("newer words");
    expect(calls.map((c) => `${c.method} ${c.path.split("/").pop()}`)).toEqual([
      "POST prepare",
      "POST confirm",
    ]);
  });

  it("Resume publishes a durable `created` with one confirm", async () => {
    const id = await seed("created");
    handler = (m) =>
      m === "GET" ? { intent: intent(id, "created") } : { intent: intent(id, "published") };
    render();
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("created"));
    expect(($("ibx-ths-resume") as HTMLButtonElement).disabled).toBe(false);
    await click("ibx-ths-resume");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("published"));
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  });
});

describe("recovery without a row", () => {
  // DT-6B-2B-2-R1 (2B2-3) widens this from "the account on screen" to every retained operation of this Worker: each one
  // is checked by its own stored account.
  it("lists every retained Threads operation of this Worker, each checked by its own account", async () => {
    const id = await seed("unknown_publication");
    await S().setInboxThreadsSendOp(
      inboxScopeV2("threads", WORKER, "26", "comment", "99999"),
      {
        operationId: "op-th-otheracc",
        account: "26",
        draftRevision: "r",
        digest: "a".repeat(64),
        state: "creating",
        receiptVersion: 2,
      },
      null,
    );
    threadsOn(false);
    handler = () => ({ intent: intent(id, "unknown_publication") });
    act(() => root.render(<ThreadsSendRecoveryList />));
    const items = document.body.querySelectorAll('[data-testid="ibx-ths-recovery-item"]');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(`Reply to ${REPLY}`);
    expect(items[1].textContent).toContain("Reply to 99999");
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("unknown_publication"));
    expect(calls).toEqual([{ method: "GET", path: `/social/inbox/threads/send/${id}` }]);
    expect(lastQuery).toBe("account=25");
  });

  it("shows nothing when no operation is retained", () => {
    act(() => root.render(<ThreadsSendRecoveryList />));
    expect(host.textContent).toBe("");
  });
});

// 📤 DT-6B-2B-2-R1: the automatic expiry lookup runs once per operation and deadline (clock skew never polls); every
// retained-operation view has a status-only Check status; closing the sheet never cancels; recovery lists this Worker's
// operations whatever account is on screen (another Worker's are named, never asked); a successful Clear draft from the
// recovery list reaches the open editor of that scope by exact revision.
describe("R1 (DT-6B-2B-2-R1)", () => {
  async function type(value: string): Promise<void> {
    const el = $("ibx-draft-text") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const within = (section: string, id: string) =>
    document.body.querySelector<HTMLElement>(`[data-testid="${section}"] [data-testid="${id}"]`);
  const oldWorkerHandle = () =>
    S().setInboxThreadsSendOp(
      inboxScopeV2("threads", "https://old.test", ME, "comment", "92002"),
      {
        operationId: "op-th-oldworker",
        account: ME,
        draftRevision: "r",
        digest: "a".repeat(64),
        state: "unknown_creation",
        receiptVersion: 3,
      },
      null,
    );

  it("a device clock past the deadline triggers one automatic lookup, then only the owner's", async () => {
    const id = await seed("prepared");
    const late = intent(id, "prepared", {
      reviewExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    handler = () => ({ intent: late });
    render(target({ sendRef: undefined }), "", null);
    await click("ibx-ths-check");
    await until(() => expect(calls).toHaveLength(2));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(calls).toHaveLength(2);
    expect($("ibx-ths-sheet")!.dataset.phase).toBe("review");
    await click("ibx-ths-sheet-check");
    await until(() => expect(calls).toHaveLength(3));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET", "GET"]);
  });

  it("a Worker naming another past deadline in every answer still gets one automatic lookup", async () => {
    // (Its own operation: automatic lookups are remembered per operation for the page's life.)
    const id = await seed("prepared", "op-th-movingdeadline");
    let n = 0;
    handler = () => ({
      intent: intent(id, "prepared", {
        reviewExpiresAt: new Date(Date.now() - 60_000 - ++n * 1000).toISOString(),
      }),
    });
    render(target({ sendRef: undefined }), "", null);
    await click("ibx-ths-check");
    await until(() => expect(calls).toHaveLength(2));
    await act(() => new Promise((r) => setTimeout(r, 300)));
    expect(calls).toHaveLength(2);
  });

  it("a retained prepared review has a status-only Check status, and closing keeps the operation", async () => {
    const id = await seed("prepared");
    handler = () => ({ intent: intent(id, "prepared") });
    render(target({ sendRef: undefined }), "", null);
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-ths-confirm")).toBeNull();
    expect($("ibx-ths-cancel")).not.toBeNull();
    await click("ibx-ths-sheet-check");
    await until(() => expect(calls).toHaveLength(2));
    await click("ibx-ths-close");
    await until(() => expect($("ibx-ths-sheet")).toBeNull());
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    expect(S().inboxThreadsSendOps[SCOPE]).toMatchObject({ operationId: id, state: "prepared" });
  });

  it("Check status is on every retained durable stage view", async () => {
    for (const state of ["creating", "created", "publishing", "unknown_creation"]) {
      act(() => root.render(<></>));
      localStorage.clear();
      S().reset();
      S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
      resetThreadsSendViews();
      threadsOn();
      const id = await seed(state, `op-th-every-${state.slice(0, 6)}`);
      handler = () => ({ intent: intent(id, state) });
      render(target({ sendRef: undefined }), "", null);
      await click("ibx-ths-check");
      await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe(state));
      expect($("ibx-ths-sheet-check")).not.toBeNull();
    }
  });

  it("recovers when the account read failed or another account is loaded; another Worker's handle is named, never asked", async () => {
    const id = await seed("unknown_publication");
    await oldWorkerHandle();
    handler = () => ({ intent: intent(id, "unknown_publication") });
    for (const move of [
      () => useProviderInbox.setState({ provider: "threads", threads: null, lists: {} }),
      () =>
        useProviderInbox.setState({
          provider: "threads",
          threads: {
            provider: "threads",
            accountId: "26",
            handle: "other",
            generation: "e".repeat(32),
            capabilities: { replies: "ok", sendReplies: "permission_unverified" },
          },
        }),
    ]) {
      act(() => root.render(<></>));
      resetThreadsSendViews();
      move();
      calls = [];
      act(() => root.render(<ThreadsSendRecoveryList />));
      expect(document.body.querySelectorAll('[data-testid="ibx-ths-recovery-item"]')).toHaveLength(
        1,
      );
      const foreign = $("ibx-ths-recovery-foreign")!;
      expect(foreign.textContent).toContain("92002");
      expect(foreign.textContent).toContain("https://old.test");
      expect(foreign.querySelector("button")).toBeNull();
      await click("ibx-ths-check");
      await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("unknown_publication"));
      expect(calls).toEqual([{ method: "GET", path: `/social/inbox/threads/send/${id}` }]);
      expect(lastQuery).toBe("account=25");
    }
  });

  it("in Arabic, another Worker's handle is named in Arabic and nothing is asked", async () => {
    S().setSettings({ lang: "ar" });
    await oldWorkerHandle();
    act(() => root.render(<ThreadsSendRecoveryList />));
    expect($("ibx-ths-recovery")).toBeNull();
    expect($("ibx-ths-recovery-foreign")!.textContent).toMatch(/[؀-ۿ]/);
    expect(calls).toEqual([]);
  });

  for (const newer of [false, true])
    it(`Clear draft from the recovery list resets the open editor by revision (${newer ? "newer typing kept" : "same text cleared"}); it saves again`, async () => {
      const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
      if (!saved.ok) throw new Error("save");
      const rev = saved.draft!.commitId;
      const id = "op-th-listclear";
      await S().setInboxThreadsSendOp(
        SCOPE,
        {
          operationId: id,
          account: ME,
          draftRevision: rev,
          digest: threadsSendDigest(TEXT),
          state: "unknown_publication",
          receiptVersion: 5,
          containerId: C,
        },
        null,
      );
      handler = () => ({
        intent: intent(id, "published", { draftRevision: rev, receiptVersion: 6 }),
      });
      await S().saveInboxDraft("instagram-other", "Instagram words", inboxDraftBase(null));
      act(() =>
        root.render(
          <>
            <ThreadsSendRecoveryList />
            <DraftBox scope={SCOPE} provider="threads" threadsSend={target()} />
            <DraftBox scope="instagram-other" />
          </>,
        ),
      );
      if (newer) await type("Newer unsaved reply");
      const other = document.body.querySelectorAll<HTMLTextAreaElement>(
        '[data-testid="ibx-draft-text"]',
      )[1];
      await act(async () => within("ibx-ths-recovery", "ibx-ths-check")!.click());
      await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("published"));
      await click("ibx-ths-clear");
      await until(() => expect($("ibx-ths-sheet")).toBeNull());
      expect(S().inboxDrafts[SCOPE]).toBeUndefined();
      expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe(
        newer ? "Newer unsaved reply" : "",
      );
      // Another editor (here Instagram) never hears a Threads clear.
      expect(other.value).toBe("Instagram words");
      expect(S().inboxDrafts["instagram-other"].text).toBe("Instagram words");
      await type("Next locally saved reply");
      await click("ibx-draft-save");
      await until(() => expect($("ibx-draft-status")!.dataset.state).toBe("saved"));
      expect(S().inboxDrafts[SCOPE].text).toBe("Next locally saved reply");
    });

  it("a failed Clear draft leaves the open editor on its revision", async () => {
    const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    if (!saved.ok) throw new Error("save");
    const rev = saved.draft!.commitId;
    await S().setInboxThreadsSendOp(
      SCOPE,
      {
        operationId: "op-th-failclear",
        account: ME,
        draftRevision: rev,
        digest: threadsSendDigest(TEXT),
        state: "published",
        receiptVersion: 5,
        containerId: C,
        publishedId: P,
      },
      null,
    );
    handler = () => ({ intent: intent("op-th-failclear", "published", { draftRevision: rev }) });
    act(() =>
      root.render(
        <>
          <ThreadsSendRecoveryList />
          <DraftBox scope={SCOPE} provider="threads" threadsSend={target()} />
        </>,
      ),
    );
    await act(async () => within("ibx-ths-recovery", "ibx-ths-check")!.click());
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("published"));
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await click("ibx-ths-clear");
    await until(() => expect($("ibx-ths-error")).not.toBeNull());
    vi.restoreAllMocks();
    expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe(TEXT);
    expect($("ibx-draft-status")!.dataset.state).toBe("idle");
    expect(S().inboxDrafts[SCOPE].commitId).toBe(rev);
  });
});

// 📤 DT-6B-2B-2-R2 (2B2-R1-A): a successful explicit Cancel from the row's sheet ends on a truthful terminal view (the
// handle is gone, so there is no Check status) with its own Close, never a lasting "Checking…"; the supported expired
// answer says expired; a failed cancel keeps the handle and its recovery. Readiness stays closed (production).
describe("R2 (DT-6B-2B-2-R2): explicit Cancel from the row", () => {
  const CANCEL_PATH = (id: string) => `/social/inbox/threads/send/${id}/cancel`;
  async function openRetainedReview(operationId: string, lang: "en" | "ar" = "en") {
    S().setSettings({ lang });
    const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    if (!saved.ok) throw new Error("save");
    await seed("prepared", operationId);
    render(target(), TEXT, saved.draft!);
    handler = () => ({ intent: intent(operationId, "prepared") });
    await click("ibx-ths-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("review"));
    calls = [];
    return saved.draft!;
  }

  for (const lang of ["en", "ar"] as const)
    it(`a cancelled answer shows the cancelled outcome and an in-body Close (${lang})`, async () => {
      const id = "op-th-r2cancel-" + lang;
      const draft = await openRetainedReview(id, lang);
      handler = (method, path) =>
        method === "POST" && path === CANCEL_PATH(id)
          ? { intent: intent(id, "cancelled") }
          : { error: "not_found" };
      await click("ibx-ths-cancel");
      await until(() => expect(S().inboxThreadsSendOps[SCOPE]).toBeUndefined());
      await until(() => expect($("ibx-ths-close")).not.toBeNull());
      const sheet = $("ibx-ths-sheet")!;
      expect(sheet.dataset.phase).toBe("cancelled");
      expect(sheet.textContent).toContain(
        lang === "en"
          ? "Cancelled. Nothing was sent. The Worker ended this review and your draft wasn't touched."
          : "انلغى. ما انرسل شي. الـWorker قفّل المراجعة ومسودتك زي ما هي.",
      );
      expect(sheet.textContent).not.toContain(
        lang === "en" ? "Checking the reply on Threads" : "نشيّك على الرد في ثريدز",
      );
      // The receipt kept on the view still names the exact reply; the handle is gone, so no Check status.
      expect($("ibx-ths-reply-id")!.textContent).toContain(REPLY);
      expect($("ibx-ths-sheet-check")).toBeNull();
      expect($("ibx-ths-again")).toBeNull();
      expect(calls).toEqual([{ method: "POST", path: CANCEL_PATH(id) }]);
      expect(S().inboxDrafts[SCOPE]).toEqual(draft);
      await click("ibx-ths-close");
      await until(() => expect($("ibx-ths-sheet")).toBeNull());
      await act(() => new Promise((r) => setTimeout(r, 50)));
      expect(calls).toHaveLength(1);
      expect(S().inboxDrafts[SCOPE]).toEqual(draft);
      // The row is back to its production state: Send as reply unavailable, no retained operation.
      expect($("ibx-ths-unavailable")).not.toBeNull();
      expect($("ibx-ths-check")).toBeNull();
    });

  it("an expired cancel answer says the review expired, with Close", async () => {
    const id = "op-th-r2expired";
    const draft = await openRetainedReview(id);
    handler = () => ({ intent: intent(id, "expired") });
    await click("ibx-ths-cancel");
    await until(() => expect($("ibx-ths-close")).not.toBeNull());
    expect($("ibx-ths-sheet")!.dataset.phase).toBe("expired");
    expect($("ibx-ths-sheet")!.textContent).toContain("expired before Send");
    expect($("ibx-ths-sheet")!.textContent).not.toContain("Checking the reply on Threads");
    expect(S().inboxThreadsSendOps[SCOPE]).toBeUndefined();
    expect(S().inboxDrafts[SCOPE]).toEqual(draft);
    expect(calls.map((c) => c.method)).toEqual(["POST"]);
    await click("ibx-ths-close");
    await until(() => expect($("ibx-ths-sheet")).toBeNull());
  });

  it("a failed cancel keeps the handle, says so and offers Check status", async () => {
    const id = "op-th-r2failed";
    await openRetainedReview(id);
    handler = () => json({ error: "upstream" }, 502);
    await click("ibx-ths-cancel");
    await until(() => expect($("ibx-ths-error")).not.toBeNull());
    expect($("ibx-ths-error")!.textContent).toContain("Couldn't confirm the cancel");
    expect(S().inboxThreadsSendOps[SCOPE]).toMatchObject({ operationId: id, state: "prepared" });
    expect($("ibx-ths-sheet-check")).not.toBeNull();
    handler = () => ({ intent: intent(id, "prepared") });
    await click("ibx-ths-sheet-check");
    await until(() => expect($("ibx-ths-sheet")!.dataset.phase).toBe("review"));
    expect(calls.map((c) => c.method)).toEqual(["POST", "GET"]);
    expect(S().inboxThreadsSendOps[SCOPE]).toMatchObject({ operationId: id, state: "prepared" });
  });
});
