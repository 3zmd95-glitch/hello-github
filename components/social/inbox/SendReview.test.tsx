// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendDigest } from "@/lib/inbox";
import {
  STORAGE_KEY,
  inboxDraftBase,
  setArticlesLock,
  useStore,
  type ArticlesLock,
  type InboxDraft,
} from "@/store";
import SendReview, { type ReplyTarget } from "./SendReview";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";
import { resetSendViews } from "./useSend";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 📤 The review sheet of a YouTube public reply (packet DT-6B-2A) in English and Arabic: who sends, where it goes (a
// nested row names its top-level parent), the exact captured text, the expiry, Cancel and Send; then sent with its
// link, rejected, unknown with Check status and never a Resend, expired and cancelled. Editing the draft during the
// review keeps the captured text and says so; a channel change closes the review. Transport is a fake Worker.

const WORKER = "https://scout.test";
const G = "a".repeat(32);
const SCOPE = "v2|youtube|https%3A%2F%2Fscout.test|UCa|comment|Ug1";
const TEXT = "Thanks for watching!";
const SAVED: InboxDraft = { text: TEXT, updatedAt: "2026-10-17T09:00:00.000Z", commitId: "rev-1" };

const target = (over: Partial<ReplyTarget> = {}): ReplyTarget => ({
  sendRef: "send.ref",
  account: "UCa",
  generation: G,
  accountName: "3z Prod",
  videoTitle: "My video",
  parentAuthor: "fan_one",
  nested: false,
  capability: "ok",
  ...over,
});

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
  reviewExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:00.000Z",
  ...over,
});

function pickChannel() {
  useProviderInbox.setState({
    provider: "youtube",
    youtube: {
      provider: "youtube",
      needsSelection: false,
      channels: [{ accountId: "UCa", title: "3z Prod", generation: G, uploads: "up.s" }],
      capabilities: { comments: "ok", sendComments: "ok" },
    },
    channelId: "UCa",
  });
}

let root: Root;
let host: HTMLDivElement;
let calls: { method: string; path: string }[];
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

function render(t: ReplyTarget = target(), text = TEXT, saved: InboxDraft | null = SAVED) {
  act(() =>
    root.render(
      <SendReview scope={SCOPE} target={t} draft={{ text, saved: saved ?? undefined }} />,
    ),
  );
}

const click = async (id: string) => {
  await act(async () => $(id)!.click());
};

beforeEach(() => {
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
  resetSendViews();
  pickChannel();
  calls = [];
  handler = (method, path, body) =>
    path.endsWith("/prepare") ? { intent: intent(body.operationId) } : { error: "not_found" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      const method = init?.method ?? "GET";
      calls.push({ method, path: u.pathname });
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

describe("before the review", () => {
  it("without the comment permission or a send target there is only an honest note and no request", () => {
    render(target({ capability: "no_permission" }));
    expect($("ibx-send-open")).toBeNull();
    expect($("ibx-send-note")!.textContent).toContain("youtube.force-ssl");
    render(target({ sendRef: undefined }));
    expect($("ibx-send-open")).toBeNull();
    expect($("ibx-send-note")!.textContent).toContain("can't be answered from here");
    expect(calls).toEqual([]);
  });

  it("only the saved draft can be sent", () => {
    render(target(), "edited after saving");
    expect(($("ibx-send-open") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-send-note")!.textContent).toContain("Save the draft first");
    render(target(), TEXT, null);
    expect(($("ibx-send-open") as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("the review sheet", () => {
  it("shows the account, the public destination, the exact text and the expiry; Cancel sends nothing", async () => {
    render();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-send-account")!.textContent).toContain("3z Prod");
    expect($("ibx-send-where")!.textContent).toBe(
      "A public reply under fan_one's comment on “My video”.",
    );
    expect($("ibx-send-text")!.textContent).toBe(TEXT);
    expect($("ibx-send-expires")!.textContent).toMatch(/closes in \d+:\d\d/);
    expect($("ibx-send-resend")).toBeNull();
    handler = (_m, path, body) => ({
      intent: intent(path.split("/")[5] || body.operationId, "cancelled"),
    });
    await click("ibx-send-cancel");
    await until(() => expect(S().inboxSendOps[SCOPE]).toBeUndefined());
    expect(calls.map((c) => `${c.method} ${c.path.split("/").pop()}`)).toEqual([
      "POST prepare",
      "POST cancel",
    ]);
  });

  it("a nested row says the reply goes under its top-level parent", async () => {
    render(target({ nested: true }));
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-where")).not.toBeNull());
    expect($("ibx-send-where")!.textContent).toContain("top-level comment");
    expect($("ibx-send-where")!.textContent).toContain("not under this reply");
  });

  it("Send posts once and shows the receipt with an exact YouTube link and the draft choices", async () => {
    render();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-confirm")).not.toBeNull());
    handler = (_m, _p, body) => ({
      intent: intent(body.operationId, "sent", { providerCommentId: "Ug1.r9" }),
    });
    await click("ibx-send-confirm");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("sent"));
    expect($("ibx-send-link")!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=vid1&lc=Ug1.r9",
    );
    expect($("ibx-send-keep")).not.toBeNull();
    expect($("ibx-send-clear")).not.toBeNull();
    expect(calls.filter((c) => c.path.endsWith("/confirm"))).toHaveLength(1);
  });

  it("an unknown outcome offers Check status and never a Send or Resend", async () => {
    render();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-confirm")).not.toBeNull());
    handler = (_m, _p, body) => ({
      intent: intent(body.operationId, "unknown", { unknownReason: "timeout" }),
    });
    await click("ibx-send-confirm");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("unknown"));
    expect($("ibx-send-sheet")!.textContent).toContain("it may still have posted");
    expect($("ibx-send-sheet")!.textContent).toContain("longer than 15 seconds");
    expect($("ibx-send-check")).not.toBeNull();
    expect($("ibx-send-confirm")).toBeNull();
    expect($("ibx-send-again")).toBeNull();
    expect($("ibx-send-resend")).toBeNull();
  });

  it("rejected and expired offer Prepare again, never Send", async () => {
    for (const [state, over, words] of [
      ["rejected", { failureCode: "forbidden" }, "refused this reply (forbidden)"],
      ["expired", {}, "expired before Send"],
    ] as const) {
      resetSendViews();
      localStorage.clear();
      S().reset();
      S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
      pickChannel();
      handler = (_m, path, body) =>
        path.endsWith("/prepare")
          ? { intent: intent(body.operationId) }
          : { intent: intent(S().inboxSendOps[SCOPE].operationId, state, over) };
      render();
      await click("ibx-send-open");
      await until(() => expect($("ibx-send-confirm")).not.toBeNull());
      await click("ibx-send-confirm");
      await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe(state));
      expect($("ibx-send-sheet")!.textContent).toContain(words);
      expect($("ibx-send-again")).not.toBeNull();
      expect($("ibx-send-confirm")).toBeNull();
      act(() => root.render(<></>));
    }
  });

  it("editing the draft during the review keeps the captured text and says it differs", async () => {
    render();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-text")).not.toBeNull());
    render(target(), "A newer draft");
    expect($("ibx-send-text")!.textContent).toBe(TEXT);
    expect($("ibx-send-differs")).not.toBeNull();
  });

  it("a channel change during the review closes it at Send, with no confirm request", async () => {
    render();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-confirm")).not.toBeNull());
    act(() => useProviderInbox.setState({ channelId: null }));
    await click("ibx-send-confirm");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("closed"));
    expect($("ibx-send-sheet")!.textContent).toContain("this review closed");
    expect(calls.filter((c) => c.path.endsWith("/confirm"))).toEqual([]);
  });

  it("Arabic: the same review in Hijazi Arabic", async () => {
    S().setSettings({ lang: "ar" });
    render(target({ nested: true }));
    expect($("ibx-send-open")!.textContent).toBe("أرسله رد عام");
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-text")).not.toBeNull());
    expect($("ibx-send-sheet")!.textContent).toContain("راجع ردك العام");
    expect($("ibx-send-where")!.textContent).toContain("التعليق الرئيسي");
    expect($("ibx-send-text")!.getAttribute("dir")).toBe("auto");
    expect($("ibx-send-confirm")!.textContent).toBe("إرسال");
  });
});

// DT-6B-2A-R1: recovery from the stored handle alone (2A-7), the exact destination (2A-8), an acknowledged Clear
// (2A-9) and actionable capacity / cancel failures, each reproduced first against the frozen DT-6B-2A sheet.
describe("DT-6B-2A-R1", () => {
  afterEach(() => vi.restoreAllMocks());
  const seedOp = async (state: "prepared" | "unknown" | "sent", draftRevision = "rev-1") => {
    const r = await S().setInboxSendOp(
      SCOPE,
      {
        operationId: "op-seeded-1",
        account: "UCa",
        draftRevision,
        digest: sendDigest(TEXT),
        state,
      },
      null,
    );
    expect(r.ok).toBe(true);
  };

  it("2A-7: an uncertain send recovers with no saved draft: one GET, Check status, no prepare", async () => {
    await seedOp("unknown");
    handler = (_m, path) =>
      path.endsWith("/op-seeded-1")
        ? { intent: intent("op-seeded-1", "unknown", { unknownReason: "timeout" }) }
        : { error: "not_found" };
    render(target(), "", null);
    expect(($("ibx-send-open") as HTMLButtonElement).disabled).toBe(false);
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("unknown"));
    expect($("ibx-send-check")).not.toBeNull();
    expect(calls).toEqual([{ method: "GET", path: "/social/inbox/youtube/send/op-seeded-1" }]);
  });

  it("2A-7: a failed lookup after a reload says the result is unknown and keeps an enabled Check status", async () => {
    await seedOp("unknown");
    handler = () => json({ error: "receipt_unavailable" }, 503);
    render();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("unknown"));
    expect($("ibx-send-sheet")!.textContent).toContain("it may still have posted");
    expect($("ibx-send-why")!.textContent).toContain("Couldn't reach the Worker to check");
    expect($("ibx-send-sheet")!.textContent).not.toContain("Checking the comment");
    const check = $("ibx-send-check") as HTMLButtonElement;
    expect(check.disabled).toBe(false);
    await click("ibx-send-check");
    await until(() => expect(calls).toHaveLength(2));
    expect(calls.every((c) => c.method === "GET" && c.path.endsWith("/op-seeded-1"))).toBe(true);
    expect($("ibx-send-confirm")).toBeNull();
    expect($("ibx-send-again")).toBeNull();
  });

  it("2A-8: the review shows the exact parent comment: its text, id and YouTube link", async () => {
    render(target({ parentId: "Ug1", parentText: "Which lens did you use?" }));
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-parent")).not.toBeNull());
    expect($("ibx-send-parent-text")!.textContent).toBe("Which lens did you use?");
    expect($("ibx-send-parent-id")!.textContent).toContain("Ug1");
    expect($("ibx-send-parent-link")!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=vid1&lc=Ug1",
    );
    // A long parent is bounded.
    act(() => root.render(<></>));
    resetSendViews();
    localStorage.clear();
    S().reset();
    S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
    pickChannel();
    render(target({ parentId: "Ug1", parentText: "x".repeat(900) }));
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-parent-text")).not.toBeNull());
    expect($("ibx-send-parent-text")!.textContent!.length).toBeLessThanOrEqual(281);
  });

  it("2A-8: a loaded row that is not the intent's parent never lends its text; id and link still show", async () => {
    render(target({ parentId: "UgSomeoneElse", parentText: "NOT-THE-PARENT", nested: true }));
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-parent")).not.toBeNull());
    expect($("ibx-send-sheet")!.textContent).not.toContain("NOT-THE-PARENT");
    expect($("ibx-send-parent")!.textContent).toContain("isn't loaded here");
    expect($("ibx-send-parent-id")!.textContent).toContain("Ug1");
    expect($("ibx-send-parent-link")!.getAttribute("href")).toBe(
      "https://www.youtube.com/watch?v=vid1&lc=Ug1",
    );
    expect($("ibx-send-where")!.textContent).toContain("top-level comment");
  });

  it("2A-9: Clear draft tells the editor which draft was cleared; a failed clear keeps the sheet and says so", async () => {
    const saved = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
    if (!saved.ok || !saved.draft) throw new Error("save");
    const cleared = vi.fn();
    handler = (_m, path, body) =>
      path.endsWith("/prepare")
        ? { intent: intent(body.operationId, "prepared", { draftRevision: saved.draft!.commitId }) }
        : {
            intent: intent(body.operationId, "sent", {
              providerCommentId: "Ug1.r9",
              draftRevision: saved.draft!.commitId,
            }),
          };
    const renderSaved = () =>
      act(() =>
        root.render(
          <SendReview
            scope={SCOPE}
            target={target()}
            draft={{ text: TEXT, saved: S().inboxDrafts[SCOPE] }}
            onCleared={cleared}
          />,
        ),
      );
    renderSaved();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-confirm")).not.toBeNull());
    await click("ibx-send-confirm");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("sent"));
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      k,
      v,
    ) {
      if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await click("ibx-send-clear");
    await until(() =>
      expect($("ibx-send-sheet")!.textContent).toContain("Couldn't clear the draft"),
    );
    expect(cleared).not.toHaveBeenCalled();
    expect($("ibx-send-sheet")).not.toBeNull();
    spy.mockRestore();
    await click("ibx-send-clear");
    await until(() => expect($("ibx-send-sheet")).toBeNull());
    expect(cleared).toHaveBeenCalledWith(expect.objectContaining({ text: TEXT }));
    expect(S().inboxDrafts[SCOPE]).toBeUndefined();
  });

  it("a full device and an unconfirmed cancel are explained, with Check status when a handle stays", async () => {
    for (let i = 0; i < 50; i++)
      await S().setInboxSendOp(
        `scope-${i}`,
        {
          operationId: `op-full-${String(i).padStart(4, "0")}`,
          account: "UCa",
          draftRevision: "rev-1",
          digest: sendDigest(TEXT),
          state: "unknown",
        },
        null,
      );
    render();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-error")).not.toBeNull());
    expect($("ibx-send-error")!.textContent).toContain("already tracking 50 replies");
    expect(calls).toEqual([]);

    act(() => root.render(<></>));
    resetSendViews();
    localStorage.clear();
    S().reset();
    S().setSettings({ lang: "ar", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
    pickChannel();
    await seedOp("prepared");
    handler = (_m, path) =>
      path.endsWith("/cancel")
        ? json({ error: "upstream" }, 502)
        : { intent: intent("op-seeded-1", "prepared") };
    render();
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("review"));
    await click("ibx-send-cancel");
    await until(() => expect(calls.some((c) => c.path.endsWith("/cancel"))).toBe(true));
    expect(S().inboxSendOps[SCOPE]).toMatchObject({ operationId: "op-seeded-1" });
    await until(() =>
      expect($("ibx-send-cancel-failed")!.textContent).toContain("ما قدرنا نتأكد من الإلغاء"),
    );
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("review"));
    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/confirm"))).toEqual([]);
  });
});

// DT-6B-2A-R2 (2A-R1-D): an operation already stored stays recoverable when sending itself is unavailable (no comment
// permission, no send target, or a Worker that says nothing about sending). Recovery is status only: no prepare, no Send.
describe("DT-6B-2A-R2", () => {
  const seedOp = async (state: "prepared" | "unknown" | "sent" | "rejected") => {
    const r = await S().setInboxSendOp(
      SCOPE,
      {
        operationId: "op-seeded-1",
        account: "UCa",
        draftRevision: "rev-1",
        digest: sendDigest(TEXT),
        state,
      },
      null,
    );
    expect(r.ok).toBe(true);
  };
  const posts = () => calls.filter((c) => c.method === "POST");

  it("2A-R1-D: without send permission or target, a stored operation still opens to Check status only", async () => {
    for (const t of [
      target({ capability: "no_permission" }),
      target({ sendRef: undefined }),
      target({ capability: undefined }),
    ]) {
      act(() => root.render(<></>));
      resetSendViews();
      localStorage.clear();
      S().reset();
      S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
      pickChannel();
      calls = [];
      await seedOp("unknown");
      handler = (_m, path) =>
        path.endsWith("/op-seeded-1")
          ? { intent: intent("op-seeded-1", "unknown", { unknownReason: "timeout" }) }
          : { error: "not_found" };
      // A saved draft is present: recovery must still never prepare a new send.
      render(t);
      expect($("ibx-send-recover-note")!.textContent).toContain("check the reply you sent earlier");
      const open = $("ibx-send-open") as HTMLButtonElement;
      expect(open.disabled).toBe(false);
      expect(open.textContent).toBe("Check status");
      await click("ibx-send-open");
      await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("unknown"));
      expect(($("ibx-send-check") as HTMLButtonElement).disabled).toBe(false);
      await click("ibx-send-check");
      await until(() => expect(calls).toHaveLength(2));
      expect(calls.every((c) => c.method === "GET" && c.path.endsWith("/op-seeded-1"))).toBe(true);
    }
  });

  it("2A-R1-D: recovery never offers Send or Prepare again, even when the stored operation is a review", async () => {
    await seedOp("prepared");
    handler = (_m, path) =>
      path.endsWith("/op-seeded-1")
        ? { intent: intent("op-seeded-1", "prepared") }
        : path.endsWith("/cancel")
          ? { intent: intent("op-seeded-1", "cancelled") }
          : { error: "not_found" };
    render(target({ capability: "no_permission" }));
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-send-text")!.textContent).toBe(TEXT);
    expect($("ibx-send-confirm")).toBeNull();
    expect($("ibx-send-cancel")).not.toBeNull();
    expect(posts()).toEqual([]);

    act(() => root.render(<></>));
    resetSendViews();
    localStorage.clear();
    S().reset();
    S().setSettings({ lang: "ar", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
    pickChannel();
    calls = [];
    await seedOp("rejected");
    handler = () => ({
      intent: intent("op-seeded-1", "rejected", { failureCode: "forbidden" }),
    });
    render(target({ capability: "no_permission" }));
    expect($("ibx-send-recover-note")!.textContent).toContain("الرد اللي أرسلته قبل");
    await click("ibx-send-open");
    await until(() => expect($("ibx-send-sheet")!.dataset.phase).toBe("rejected"));
    expect($("ibx-send-again")).toBeNull();
    expect(posts()).toEqual([]);
  });

  it("2A-R1-B: an answer another tab superseded explains itself and keeps Check status", async () => {
    await seedOp("unknown");
    let release!: (r: Response) => void;
    handler = () => new Promise<Response>((r) => (release = r));
    render();
    await click("ibx-send-open");
    await until(() => expect(calls).toHaveLength(1));
    await S().setInboxSendOp(
      SCOPE,
      {
        operationId: "op-seeded-1",
        account: "UCa",
        draftRevision: "rev-1",
        digest: sendDigest(TEXT),
        state: "sent",
        receiptVersion: Date.now() + 60_000,
      },
      "op-seeded-1",
    );
    release(json({ intent: intent("op-seeded-1", "unknown", { unknownReason: "timeout" }) }));
    await until(() => expect($("ibx-send-error")!.textContent).toContain("Another tab"));
    expect($("ibx-send-sheet")!.dataset.phase).toBe("error");
    expect($("ibx-send-sheet")!.textContent).toContain("Reply posted on YouTube.");
    expect(($("ibx-send-check") as HTMLButtonElement).disabled).toBe(false);
  });
});
