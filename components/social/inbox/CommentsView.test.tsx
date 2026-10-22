// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxScope } from "@/lib/inbox";
import { instagramSendDigest, type InstagramSendReadiness } from "@/lib/inboxInstagramSend";
import { inboxDraftBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import CommentsView from "./CommentsView";
import { resetInbox, useInbox } from "./useInbox";
import { igOpKey, resetInstagramSendViews } from "./useInstagramSend";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 📤 DT-6B-2C-4-R1 (2C4-4): the comment selection in the real CommentsView is part of an Instagram public-reply action's
// visit. Selecting another comment of the same post (or coming back, A → B → A) while Send waits for storage sends
// nothing: the review stays, recoverable. The enabled path is reached ONLY through a module mock of readiness.

const gate = vi.hoisted(() => ({
  ready: { ok: true } as InstagramSendReadiness,
}));
vi.mock("@/lib/inboxInstagramSend", async (orig) => ({
  ...(await orig<typeof import("@/lib/inboxInstagramSend")>()),
  instagramSendReadiness: () => gate.ready,
}));

const WORKER = "https://scout.test";
const RG = "c".repeat(32);
const SG = "e".repeat(32);
const ME = "17841000000000001";
const MEDIA = "18000000000000001";
const A = "17900000000000001";
const B = "17900000000000002";
const SCOPE_A = inboxScope(WORKER, ME, "comment", A);
const TEXT = "Thanks so much!";
const head = { fetchedAt: null, next: null, coverage: "end" as const, error: null };

let root: Root;
let host: HTMLDivElement;
let calls: { method: string; path: string }[];
let REV = "";

const S = () => useStore.getState();
const $ = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const comment = (id: string) =>
  document.body.querySelector<HTMLElement>(`[data-testid="ibx-comment"][data-id="${id}"]`)!;
const click = async (el: HTMLElement | null | undefined) => {
  await act(async () => el!.click());
};
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const intent = (operationId: string, state = "prepared") => ({
  operationId,
  provider: "instagram",
  account: ME,
  generation: SG,
  mediaId: MEDIA,
  commentId: A,
  text: TEXT,
  digest: instagramSendDigest(TEXT),
  draftRevision: REV,
  state,
  reviewExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:00.000Z",
  receiptVersion: state === "prepared" ? 1 : 3,
  ...(state === "sent"
    ? {
        providerReplyId: "17950000000000001",
        claimedAt: "2026-10-17T09:01:00.000Z",
        settledAt: "2026-10-17T09:02:00.000Z",
      }
    : {}),
});

beforeEach(async () => {
  gate.ready = { ok: true };
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
  resetInstagramSendViews();
  resetInbox();
  useProviderInbox.setState({ provider: "instagram" });
  const row = (id: string) => ({
    id,
    text: `comment ${id}`,
    author: { id: `u-${id}`, username: `fan_${id.slice(-1)}` },
    createdAt: null,
    direction: "in",
  });
  useInbox.setState({
    origin: WORKER,
    account: {
      accountId: ME,
      handle: "3z.prod",
      generation: RG,
      capabilities: { messages: "ok", comments: "ok" },
    },
    accountError: null,
    tab: "comments",
    mediaId: MEDIA,
    lists: {
      [inboxScope(WORKER, ME, "media")]: {
        ...head,
        items: [{ id: MEDIA, caption: "LUT reel", timestamp: null, commentsCount: 2 }],
      },
      [inboxScope(WORKER, ME, "comments", MEDIA)]: { ...head, items: [row(A), row(B)] },
    },
  });
  const d = await S().saveInboxDraft(SCOPE_A, TEXT, inboxDraftBase(null));
  if (!d.ok || !d.draft) throw new Error("draft");
  REV = d.draft.commitId;
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      calls.push({ method: init?.method ?? "GET", path: u.pathname });
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.pathname.endsWith("/prepare")) return json({ intent: intent(body.operationId) });
      if (u.pathname.endsWith("/confirm"))
        return json({ intent: intent(body.operationId, "sent") });
      return json({ error: "not_found" }, 404);
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
  resetInbox();
});

/** Comment A's editor: open its review, then press Send while every store commit waits; returns the release. */
async function sendHeldOnA() {
  act(() => root.render(<CommentsView />));
  await click(comment(A).querySelector<HTMLElement>('[data-testid="ibx-comment-draft"]'));
  await click($("ibx-igs-open"));
  await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
  calls = [];
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  setArticlesLock(async (fn) => {
    await held;
    return fn();
  });
  await click($("ibx-igs-confirm"));
  expect(calls).toEqual([]);
  return () => {
    release();
    setArticlesLock(queueLock());
  };
}

describe("CommentsView: the selected comment fences an Instagram public reply (DT-6B-2C-4-R1)", () => {
  const selections: [string, () => Promise<void>][] = [
    [
      "selecting comment B of the same post",
      () => click(comment(B).querySelector<HTMLElement>('[data-testid="ibx-comment-draft"]')),
    ],
    [
      "comment A → B → A",
      async () => {
        await click(comment(B).querySelector<HTMLElement>('[data-testid="ibx-comment-draft"]'));
        await click(comment(A).querySelector<HTMLElement>('[data-testid="ibx-comment-draft"]'));
      },
    ],
    [
      "closing comment A's editor",
      () => click(comment(A).querySelector<HTMLElement>('[data-testid="ibx-comment-draft"]')),
    ],
  ];
  for (const [name, select] of selections)
    it(`${name} while Send waits for storage sends nothing; the review stays recoverable`, async () => {
      const release = await sendHeldOnA();
      await select();
      release();
      await act(() => new Promise((r) => setTimeout(r, 40)));
      expect(calls).toEqual([]);
      expect(S().inboxInstagramSendOps[igOpKey(SCOPE_A)]).toMatchObject({ state: "prepared" });
    });

  it("without a selection change the explicit Send goes out once", async () => {
    const release = await sendHeldOnA();
    release();
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("sent"));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /social/inbox/instagram/send/confirm",
    ]);
  });
});
