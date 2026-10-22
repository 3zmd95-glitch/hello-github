// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxScope } from "@/lib/inbox";
import { instagramSendDigest, type InstagramSendReadiness } from "@/lib/inboxInstagramSend";
import {
  inboxDraftBase,
  setArticlesLock,
  useStore,
  type ArticlesLock,
  type InboxDraft,
} from "@/store";
import DraftBox from "./DraftBox";
import InstagramSendReview, {
  InstagramSendRecoveryList,
  type InstagramReplyTarget,
} from "./InstagramSendReview";
import { resetInbox, useInbox } from "./useInbox";
import { igOpKey, resetInstagramSendViews } from "./useInstagramSend";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 📤 The Instagram public-reply review sheet and recovery list (packet DT-6B-2C-4) in English and Arabic. Production
// readiness is closed: "Send as public reply" is disabled with the honest reason; a retained operation opens to Check
// status only, from its row or the recovery list (whatever the account read, the selected account, the row or the
// draft). The enabled path is reached ONLY through a module mock of the readiness function. The review names the
// account, the owned post (caption only from the matching row; its validated permalink labelled as the post, never the
// comment), the exact receiving comment (author/text only from the matching row, else ids + "preview unavailable") and
// the Worker's canonical text; a sent reply shows its id as text, never a link. Transport is a fake Worker.

const gate = vi.hoisted(() => ({
  ready: { ok: false, reason: "permission_unverified" } as InstagramSendReadiness,
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
const COMMENT = "17900000000000001";
const REPLY = "17950000000000001";
const SCOPE = inboxScope(WORKER, ME, "comment", COMMENT);
const KEY = igOpKey(SCOPE);
const TEXT = " Thanks so much!\r\nSee you 🎬 ";
const CANON = TEXT.trim();
const PERMALINK = "https://www.instagram.com/p/ABC123/";
let SAVED: InboxDraft;

const target = (over: Partial<InstagramReplyTarget> = {}): InstagramReplyTarget => ({
  account: ME,
  readerGeneration: RG,
  mediaId: MEDIA,
  commentId: COMMENT,
  accountName: "3z.prod",
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
  draftRevision: SAVED.commitId,
  state,
  reviewExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  createdAt: "2026-10-17T09:00:00.000Z",
  updatedAt: "2026-10-17T09:00:00.000Z",
  receiptVersion: VERSION[state],
  ...PROOF[state],
  ...over,
});

const head = { fetchedAt: null, next: null, coverage: "end" as const, error: null };
function instagramOn(o: { rows?: boolean; account?: string | null } = {}) {
  const accountId = o.account === undefined ? ME : o.account;
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
    mediaId: MEDIA,
    lists:
      o.rows === false || !accountId
        ? {}
        : {
            [inboxScope(WORKER, accountId, "media")]: {
              ...head,
              items: [
                {
                  id: MEDIA,
                  caption: "LUT reel caption",
                  permalink: PERMALINK,
                  timestamp: null,
                  commentsCount: 1,
                },
              ],
            },
            [inboxScope(WORKER, accountId, "comments", MEDIA)]: {
              ...head,
              items: [
                {
                  id: COMMENT,
                  text: "the fan's exact words",
                  author: { id: "u1", username: "fan_one" },
                  createdAt: null,
                  direction: "in",
                },
              ],
            },
          },
  });
}

let root: Root;
let host: HTMLDivElement;
let calls: { method: string; path: string; redirect?: string }[];
let handler: (method: string, path: string, body: Record<string, string>) => unknown;

const S = () => useStore.getState();
const $ = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const $$ = (id: string) => [
  ...document.body.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
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

function render(t: InstagramReplyTarget = target(), text = TEXT, saved: InboxDraft | null = SAVED) {
  act(() =>
    root.render(
      <InstagramSendReview scope={SCOPE} target={t} draft={{ text, saved: saved ?? undefined }} />,
    ),
  );
}

const click = async (id: string, from: ParentNode = document.body) => {
  await act(async () => from.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click());
};

async function seed(
  state: string,
  operationId = "op-ig-seeded1",
  over: Record<string, unknown> = {},
) {
  const local = state === "preparing" || state === "confirming";
  const r = await S().setInboxInstagramSendOp(
    KEY,
    {
      operationId,
      workerOrigin: WORKER,
      account: ME,
      mediaId: MEDIA,
      commentId: COMMENT,
      draftRevision: SAVED.commitId,
      digest: instagramSendDigest(TEXT),
      state: state as never,
      ...(local ? {} : { receiptVersion: VERSION[state], sendGeneration: SG }),
      ...(state === "sent" ? { providerReplyId: REPLY } : {}),
      ...over,
    },
    null,
  );
  if (!r.ok) throw new Error(r.reason);
  return operationId;
}

beforeEach(async () => {
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
  resetInstagramSendViews();
  resetInbox();
  instagramOn();
  const d = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
  if (!d.ok || !d.draft) throw new Error("draft");
  SAVED = d.draft;
  calls = [];
  handler = (_m, path, body) =>
    path.endsWith("/prepare") ? { intent: intent(body.operationId) } : { error: "not_found" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      const method = init?.method ?? "GET";
      calls.push({ method, path: u.pathname, redirect: init?.redirect });
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
  resetInbox();
});

describe("production (readiness closed)", () => {
  it("Send as public reply is disabled with the honest reason; nothing is asked", async () => {
    render();
    const open = $("ibx-igs-open") as HTMLButtonElement;
    expect(open.textContent).toContain("Send as public reply");
    expect(open.disabled).toBe(true);
    expect($("ibx-igs-unavailable")!.textContent).toContain("aren't verified yet");
    expect($("ibx-igs-check")).toBeNull();
    await act(async () => open.click());
    expect($("ibx-igs-sheet")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("in Arabic the reason is Arabic too", () => {
    S().setSettings({ lang: "ar" });
    render();
    expect($("ibx-igs-open")!.textContent).toContain("أرسله كرد علني");
    expect($("ibx-igs-unavailable")!.textContent).toContain("ما تأكدنا منها");
  });

  it("a retained unknown operation opens to Check status only: one GET, its state, no Send", async () => {
    const id = await seed("unknown");
    handler = () => ({ intent: intent(id, "unknown") });
    render(target(), "", null);
    expect($("ibx-igs-status")!.dataset.state).toBe("unknown");
    expect(($("ibx-igs-open") as HTMLButtonElement).disabled).toBe(true);
    await click("ibx-igs-check");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("unknown"));
    expect(calls).toEqual([
      { method: "GET", path: `/social/inbox/instagram/send/${id}`, redirect: "manual" },
    ]);
    expect($("ibx-igs-sheet")!.textContent).toContain("may have been posted");
    expect($("ibx-igs-why")!.textContent).toContain("took too long");
    expect($("ibx-igs-sheet-check")).not.toBeNull();
    expect($("ibx-igs-confirm")).toBeNull();
    expect($("ibx-igs-again")).toBeNull();
  });
});

describe("states, each with its own copy and Check status", () => {
  const cases: [string, string, Record<string, unknown>?][] = [
    ["dispatching", "being sent to Instagram"],
    ["unknown", "may have been posted"],
    ["rejected", "Instagram refused this reply (meta_10)"],
    ["already_claimed", "Your automatic reply already holds this comment"],
    ["already_claimed", "Another reviewed reply already holds", { failureDetail: "manual" }],
    ["already_claimed", "used and retired", { failureDetail: "retired" }],
    ["expired", "expired before Send"],
    ["sent", "Posted on Instagram."],
  ];
  for (const [state, copy, over] of cases)
    it(`${state}${over ? ` (${over.failureDetail})` : ""}: "${copy}"`, async () => {
      gate.ready = { ok: true };
      const id = await seed(state, "op-ig-seeded1", over?.failureDetail ? {} : {});
      handler = () => ({ intent: intent(id, state, over ?? {}) });
      render();
      await click("ibx-igs-check");
      await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe(state));
      expect($("ibx-igs-sheet")!.textContent).toContain(copy);
      // Nothing outside review ever offers Send.
      expect($("ibx-igs-confirm")).toBeNull();
      if (state === "sent") {
        expect($("ibx-igs-reply-id")!.textContent).toContain(REPLY);
        // No link is ever built from a reply id.
        for (const a of document.body.querySelectorAll("a"))
          expect(a.getAttribute("href") ?? "").not.toContain(REPLY);
      }
    });
});

describe("enabled path (module mock only)", () => {
  beforeEach(() => {
    gate.ready = { ok: true };
  });

  it("prepare → review names account, post (as the post) and the exact comment; a distinct Send posts once", async () => {
    render();
    await click("ibx-igs-open");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    // One click prepared and did not confirm.
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /social/inbox/instagram/send/prepare",
    ]);
    expect($("ibx-igs-account")!.textContent).toBe("@3z.prod");
    expect($("ibx-igs-post-text")!.textContent).toContain("LUT reel caption");
    const link = $("ibx-igs-post-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(PERMALINK);
    expect(link.textContent).toContain("the post itself, not the comment");
    expect($("ibx-igs-comment-author")!.textContent).toContain("@fan_one");
    expect($("ibx-igs-comment-text")!.textContent).toBe("the fan's exact words");
    expect($("ibx-igs-comment-id")!.textContent).toContain(COMMENT);
    // The Worker's canonical text, CRLF and emoji preserved; the outer spaces trimmed.
    expect($("ibx-igs-text")!.textContent).toBe(CANON);
    expect($("ibx-igs-expires")!.textContent).toMatch(/closes in \d+:\d\d/);
    const id = S().inboxInstagramSendOps[KEY]!.operationId;
    handler = () => ({ intent: intent(id, "sent") });
    await click("ibx-igs-confirm");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("sent"));
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/social/inbox/instagram/send/prepare",
      "/social/inbox/instagram/send/confirm",
    ]);
    expect($("ibx-igs-reply-id")!.textContent).toContain(REPLY);
  });

  it("unsaved changes need Save first; an over-long text says so; an unresolved handle blocks the opener", async () => {
    render(target(), `${TEXT} more`);
    expect(($("ibx-igs-open") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-igs-note")!.textContent).toContain("Save the draft first");
    const long = "x".repeat(1001);
    render(target(), long, { ...SAVED, text: long });
    expect(($("ibx-igs-open") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-igs-too-long")!.textContent).toContain("1,000");
    await seed("dispatching");
    render();
    expect(($("ibx-igs-open") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-igs-unresolved")!.textContent).toContain("isn't settled yet");
    expect(calls).toEqual([]);
  });

  it("without matching rows: ids and 'preview unavailable', no post link; another account's rows never lend", async () => {
    instagramOn({ rows: false });
    render();
    await click("ibx-igs-open");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-igs-post-unavailable")!.textContent).toContain("preview unavailable");
    expect($("ibx-igs-post-id")!.textContent).toContain(MEDIA);
    expect($("ibx-igs-post-link")).toBeNull();
    expect($("ibx-igs-comment-unavailable")!.textContent).toContain("preview unavailable");
    expect($("ibx-igs-comment-id")!.textContent).toContain(COMMENT);
    // Rows of the same ids under another account are not this operation's.
    useInbox.setState((s) => ({
      lists: {
        ...s.lists,
        [inboxScope(WORKER, "17841000000000002", "media")]: {
          ...head,
          items: [{ id: MEDIA, caption: "NOT MINE", timestamp: null, commentsCount: 0 }],
        },
      },
    }));
    await until(() => expect($("ibx-igs-sheet")!.textContent).not.toContain("NOT MINE"));
  });

  it("closing a review never cancels; Cancel is its own button and ends on a terminal screen with Close", async () => {
    render();
    await click("ibx-igs-open");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    const id = S().inboxInstagramSendOps[KEY]!.operationId;
    await click("ibx-igs-close");
    await until(() => expect($("ibx-igs-sheet")).toBeNull());
    expect(S().inboxInstagramSendOps[KEY]!.state).toBe("prepared");
    expect(calls.filter((c) => c.path.endsWith("/cancel"))).toEqual([]);
    handler = () => ({ intent: intent(id, "prepared") });
    await click("ibx-igs-check");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    handler = () => ({ intent: intent(id, "cancelled") });
    await click("ibx-igs-cancel");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("cancelled"));
    expect($("ibx-igs-sheet")!.textContent).toContain("Cancelled. Nothing was sent.");
    expect(S().inboxInstagramSendOps[KEY]).toBeUndefined();
    await click("ibx-igs-close");
    await until(() => expect($("ibx-igs-sheet")).toBeNull());
  });

  it("a review whose local time is up turns Send off and asks nothing by itself", async () => {
    handler = (_m, path, body) =>
      path.endsWith("/prepare")
        ? {
            intent: intent(body.operationId, "prepared", {
              reviewExpiresAt: new Date(Date.now() - 1000).toISOString(),
            }),
          }
        : { error: "not_found" };
    render();
    await click("ibx-igs-open");
    await until(() => expect($("ibx-igs-time-up")).not.toBeNull());
    expect(($("ibx-igs-confirm") as HTMLButtonElement).disabled).toBe(true);
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(calls).toHaveLength(1);
  });

  it("Clear draft after sent keeps newer typing in the editor (exact-revision acknowledgement)", async () => {
    act(() => root.render(<DraftBox scope={SCOPE} igSend={target()} />));
    await click("ibx-igs-open");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    const id = S().inboxInstagramSendOps[KEY]!.operationId;
    handler = () => ({ intent: intent(id, "sent") });
    await click("ibx-igs-confirm");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("sent"));
    // Newer words typed in the editor after the review (not saved).
    const area = $("ibx-draft-text") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(area, "newer typing");
      area.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("ibx-igs-clear");
    await until(() => expect($("ibx-igs-sheet")).toBeNull());
    expect(S().inboxDrafts[SCOPE]).toBeUndefined();
    expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe("newer typing");
    // The editor builds on "no draft" now: the newer words save.
    await click("ibx-draft-save");
    await until(() => expect(S().inboxDrafts[SCOPE]?.text).toBe("newer typing"));
  });

  it("Clear draft with the same text still empties the editor", async () => {
    act(() => root.render(<DraftBox scope={SCOPE} igSend={target()} />));
    await click("ibx-igs-open");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    const id = S().inboxInstagramSendOps[KEY]!.operationId;
    handler = () => ({ intent: intent(id, "sent") });
    await click("ibx-igs-confirm");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("sent"));
    await click("ibx-igs-clear");
    await until(() => expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe(""));
    expect($("ibx-draft-status")!.dataset.state).toBe("discarded");
  });
});

describe("recovery list", () => {
  it("lists every retained operation with Check status (and Cancel on prepared), with no account read", async () => {
    await seed("unknown");
    const other = inboxScope(WORKER, ME, "comment", "17900000000000002");
    await S().setInboxInstagramSendOp(
      igOpKey(other),
      {
        operationId: "op-ig-prepared2",
        workerOrigin: WORKER,
        account: ME,
        mediaId: MEDIA,
        commentId: "17900000000000002",
        draftRevision: "rev-x",
        digest: instagramSendDigest("x"),
        state: "prepared",
        receiptVersion: 1,
        sendGeneration: SG,
      },
      null,
    );
    instagramOn({ account: null });
    act(() => root.render(<InstagramSendRecoveryList />));
    const items = $$("ibx-igs-recovery-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain(COMMENT);
    expect(items[0].querySelector('[data-testid="ibx-igs-check"]')).not.toBeNull();
    expect(items[1].querySelector('[data-testid="ibx-igs-cancel-row"]')).not.toBeNull();
    // Recovery never offers a new reply.
    expect($("ibx-igs-open")).toBeNull();
    handler = () => ({
      intent: intent("op-ig-prepared2", "cancelled", {
        commentId: "17900000000000002",
        draftRevision: "rev-x",
        digest: instagramSendDigest("x"),
        text: "x",
      }),
    });
    await click("ibx-igs-cancel-row", items[1]);
    await until(() =>
      expect(calls.map((c) => c.path)).toEqual([
        "/social/inbox/instagram/send/op-ig-prepared2/cancel",
      ]),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("POST");
    await until(() => expect(S().inboxInstagramSendOps[igOpKey(other)]).toBeUndefined());
    expect(S().inboxInstagramSendOps[KEY]!.state).toBe("unknown");
  });

  it("another Worker's operation is named with zero buttons and zero requests; no Worker lists everything as kept", async () => {
    await seed("unknown", "op-ig-foreign1", { workerOrigin: "https://old.test" });
    act(() => root.render(<InstagramSendRecoveryList />));
    const foreign = $("ibx-igs-recovery-foreign")!;
    expect(foreign.textContent).toContain(COMMENT);
    expect(foreign.textContent).toContain("https://old.test");
    expect(foreign.querySelectorAll("button")).toHaveLength(0);
    expect($("ibx-igs-recovery")).toBeNull();
    act(() => S().setSettings({ apiKeys: {} }));
    expect($("ibx-igs-recovery-foreign")!.textContent).toContain("No Worker is connected");
    expect(calls).toEqual([]);
  });

  it("in Arabic the list and its foreign note are Arabic", async () => {
    S().setSettings({ lang: "ar" });
    await seed("unknown");
    act(() => root.render(<InstagramSendRecoveryList />));
    expect($("ibx-igs-recovery")!.textContent).toContain("ردود إنستقرام العلنية تحتاج تشييك");
  });
});

// 📤 DT-6B-2C-4-R1 through the real component (readiness only by the module mock).
describe("DT-6B-2C-4-R1: comment/editor visit, pending Confirm and contradictory proof", () => {
  beforeEach(() => {
    gate.ready = { ok: true };
  });
  const OTHER = "17900000000000002";
  const otherScope = inboxScope(WORKER, ME, "comment", OTHER);
  const editor = (comment: string) =>
    comment === COMMENT ? (
      <InstagramSendReview
        key={SCOPE}
        scope={SCOPE}
        target={target()}
        draft={{ text: TEXT, saved: SAVED }}
      />
    ) : (
      <InstagramSendReview
        key={otherScope}
        scope={otherScope}
        target={target({ commentId: OTHER })}
        draft={{ text: "", saved: undefined }}
      />
    );
  /** Opens the row's review, then clicks Send while every store commit waits; returns the release. */
  async function sendHeld() {
    act(() => root.render(editor(COMMENT)));
    await click("ibx-igs-open");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    calls = [];
    handler = () => ({ intent: intent(S().inboxInstagramSendOps[KEY]!.operationId, "sent") });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    setArticlesLock(async (fn) => {
      await held;
      return fn();
    });
    await click("ibx-igs-confirm");
    expect(calls).toEqual([]);
    return () => {
      release();
      setArticlesLock(queueLock());
    };
  }
  const moves: [string, () => void][] = [
    ["the editor closes (unmount)", () => act(() => root.render(<></>))],
    ["another comment of the same post is selected", () => act(() => root.render(editor(OTHER)))],
    [
      "comment A → B → A",
      () => {
        act(() => root.render(editor(OTHER)));
        act(() => root.render(editor(COMMENT)));
      },
    ],
  ];
  for (const [name, move] of moves)
    it(`${name} while Send waits for storage: no hidden Confirm, the review is kept`, async () => {
      const release = await sendHeld();
      move();
      release();
      await act(() => new Promise((r) => setTimeout(r, 40)));
      expect(calls).toEqual([]);
      expect(S().inboxInstagramSendOps[KEY]).toMatchObject({ state: "prepared" });
    });

  it("plain Close of a review cancels nothing and keeps Check status; the review still sends on an explicit Send", async () => {
    act(() => root.render(editor(COMMENT)));
    await click("ibx-igs-open");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    const id = S().inboxInstagramSendOps[KEY]!.operationId;
    await click("ibx-igs-close");
    await until(() => expect($("ibx-igs-sheet")).toBeNull());
    expect(calls.filter((c) => c.method === "POST" && !c.path.endsWith("/prepare"))).toEqual([]);
    expect(S().inboxInstagramSendOps[KEY]!.state).toBe("prepared");
    handler = () => ({ intent: intent(id) });
    await click("ibx-igs-check");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("review"));
    handler = () => ({ intent: intent(id, "sent") });
    await click("ibx-igs-confirm");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("sent"));
    expect(calls.filter((c) => c.path.endsWith("/confirm"))).toHaveLength(1);
  });

  it("a prepared status of a pending Confirm shows status only: no Send, Check status", async () => {
    const id = await seed("confirming");
    handler = () => ({ intent: intent(id) });
    act(() => root.render(editor(COMMENT)));
    await click("ibx-igs-check");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("uncertain"));
    expect($("ibx-igs-confirm")).toBeNull();
    expect($("ibx-igs-sheet-check")).not.toBeNull();
    expect(S().inboxInstagramSendOps[KEY]!.state).toBe("confirming");
  });

  it("contradictory proof from Cancel or Check status removes nothing and shows no success", async () => {
    gate.ready = { ok: false, reason: "permission_unverified" };
    const T = "2026-10-17T09:05:00.000Z";
    const id = await seed("prepared");
    act(() => root.render(<InstagramSendRecoveryList />));
    handler = () => ({ intent: intent(id, "cancelled", { claimedAt: T }) });
    await click("ibx-igs-cancel-row");
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("error"));
    expect($("ibx-igs-sheet")!.textContent).not.toContain("Cancelled. Nothing was sent.");
    expect(S().inboxInstagramSendOps[KEY]).toMatchObject({ operationId: id, state: "prepared" });
    const x: Record<string, unknown> = { ...intent(id, "sent") };
    delete x.settledAt;
    handler = () => ({ intent: x });
    await click("ibx-igs-sheet-check");
    await until(() => expect(calls).toHaveLength(2));
    await until(() => expect($("ibx-igs-sheet")!.dataset.phase).toBe("error"));
    expect($("ibx-igs-sheet")!.textContent).not.toContain("Posted on Instagram.");
    expect($("ibx-igs-reply-id")).toBeNull();
    expect(S().inboxInstagramSendOps[KEY]).toMatchObject({ operationId: id, state: "prepared" });
  });
});
