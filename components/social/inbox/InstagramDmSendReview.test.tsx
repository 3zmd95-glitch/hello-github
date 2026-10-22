// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxScope } from "@/lib/inbox";
import { dmBodyDigest, dmOpKey, type DmSendReadiness } from "@/lib/inboxInstagramDmSend";
import {
  inboxDraftBase,
  setArticlesLock,
  useStore,
  type ArticlesLock,
  type InboxDraft,
} from "@/store";
import DraftBox from "./DraftBox";
import { InstagramDmRecoveryList, type DmReplyTarget } from "./InstagramDmSendReview";
import { resetInbox, useInbox } from "./useInbox";
import { resetInstagramDmViews } from "./useInstagramDmSend";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 💬 The Instagram DM review sheet, its conversation editor controls and the DM recovery list (packet DT-6B-2C-5A) in
// English and Arabic. Production readiness is closed: "Send as DM reply" is disabled with the honest reason; a retained
// operation opens to Check status only (whatever the account read, row or draft), and a lost settlement shows its
// observation as uncertainty only. The enabled path is reached ONLY through a module mock of the readiness function.
// The review names the account, conversation, recipient (name only from a matching loaded row), the exact inbound
// message (preview only from the loaded row, the Worker-proven time) and the Worker's canonical text; a sent DM shows its
// message id as text, never a link. Clear draft goes through the exact revision and keeps newer typing. Fake Worker.

const gate = vi.hoisted(() => ({
  ready: { ok: false, reason: "permission_unverified" } as DmSendReadiness,
}));
vi.mock("@/lib/inboxInstagramDmSend", async (orig) => ({
  ...(await orig<typeof import("@/lib/inboxInstagramDmSend")>()),
  instagramDmSendReadiness: () => gate.ready,
}));

const WORKER = "https://scout.test";
const RG = "c".repeat(32);
const SG = "e".repeat(32);
const ME = "17841000000000001";
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const PERSON = "990000000000001";
const IN1 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjE=";
const IN2 = "aWdfZAG1faXRlbToxOklHTWVzc2FnZAUlEOjI=";
const AT = "2026-10-17T08:55:00.000Z";
const MID = "aWdfZAG1faXRlbToxOk1lc3NhZA2U=";
const SCOPE = inboxScope(WORKER, ME, "conversation", CONV);
const KEY = dmOpKey(WORKER, ME, CONV, IN1);
const TEXT = " Hi Sara! Café 🎬 ";
const CANON = "Hi Sara! Café 🎬";
const DIGEST = dmBodyDigest(PERSON, CANON);
let SAVED: InboxDraft;

const target = (over: Partial<DmReplyTarget> = {}): DmReplyTarget => ({
  account: ME,
  readerGeneration: RG,
  conversationId: CONV,
  recipientId: PERSON,
  inboundMessageId: IN1,
  inboundAt: AT,
  accountName: "3z.prod",
  ...over,
});

const VERSION: Record<string, number> = { prepared: 1, dispatching: 2, sent: 3, cancelled: 2 };
const PROOF: Record<string, Record<string, unknown>> = {
  dispatching: { claimedAt: "2026-10-17T09:01:00.000Z" },
  sent: {
    claimedAt: "2026-10-17T09:01:00.000Z",
    settledAt: "2026-10-17T09:02:00.000Z",
    providerMessageId: MID,
  },
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
    tab: "messages",
    conversationId: CONV,
    lists:
      o.rows === false || !accountId
        ? {}
        : {
            [inboxScope(WORKER, accountId, "messages", CONV)]: {
              ...head,
              items: [
                {
                  id: IN1,
                  createdAt: AT,
                  direction: "in",
                  from: { id: PERSON, username: "sara" },
                  text: "is it the 16 Pro?",
                  kind: "text",
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
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const posts = () => calls.filter((c) => c.method === "POST").map((c) => c.path);

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

function render(t: DmReplyTarget | null = target()) {
  act(() =>
    root.render(
      <>
        <DraftBox key={SCOPE} scope={SCOPE} dmSend={{ target: t }} />
        <InstagramDmRecoveryList />
      </>,
    ),
  );
}

const click = async (id: string, from: ParentNode = document.body) => {
  await act(async () => from.querySelector<HTMLElement>(`[data-testid="${id}"]`)!.click());
};

async function type(value: string) {
  const el = $("ibx-draft-text") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

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
      draftRevision: SAVED.commitId,
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
  resetInstagramDmViews();
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
  it("Send as DM reply is disabled with the honest reason beside Save/Copy/Discard; nothing is asked", async () => {
    render();
    const open = $("ibx-igdm-open") as HTMLButtonElement;
    expect(open.textContent).toContain("Send as DM reply");
    expect(open.disabled).toBe(true);
    expect($("ibx-igdm-unavailable")!.textContent).toContain("aren't verified yet");
    expect($("ibx-igdm-target")!.textContent).toContain("@sara");
    expect($("ibx-igdm-target")!.textContent).toContain("is it the 16 Pro?");
    expect($("ibx-draft-save")).not.toBeNull();
    expect($("ibx-draft-copy")).not.toBeNull();
    expect($("ibx-draft-discard")).not.toBeNull();
    expect($("ibx-igdm-check")).toBeNull();
    await act(async () => open.click());
    expect($("ibx-igdm-sheet")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("in Arabic the reason is Arabic too", () => {
    S().setSettings({ lang: "ar" });
    render();
    expect($("ibx-igdm-open")!.textContent).toContain("أرسله كرسالة خاصة");
    expect($("ibx-igdm-unavailable")!.textContent).toContain("ما تأكدنا منه");
  });

  it("a retained lost settlement opens to Check status only: one GET, the observation as uncertainty, no Send or Clear", async () => {
    const id = await seed("dispatching", "op-dm-seeded1", {
      pending: { observed: "rejected", code: "meta_10" },
    });
    handler = () => ({ intent: intent(id, "dispatching") });
    render(null);
    const item = $("ibx-igdm-recovery-item")!;
    expect(
      item.querySelector<HTMLElement>('[data-testid="ibx-igdm-status"]')!.dataset.pending,
    ).toBe("rejected");
    await click("ibx-igdm-check", item);
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("dispatching"));
    expect(calls).toEqual([
      { method: "GET", path: `/social/inbox/instagram/dm/send/${id}`, redirect: "manual" },
    ]);
    expect($("ibx-igdm-pending")!.dataset.observed).toBe("rejected");
    expect($("ibx-igdm-sheet")!.textContent).toContain("seemed to refuse it (meta_10)");
    expect($("ibx-igdm-sheet")!.textContent).toContain("isn't settled");
    for (const id2 of ["ibx-igdm-confirm", "ibx-igdm-clear", "ibx-igdm-again", "ibx-igdm-cancel"])
      expect($(id2)).toBeNull();
    // Closing never cancels or erases the unresolved operation.
    await click("ibx-igdm-close");
    await until(() => expect($("ibx-igdm-sheet")).toBeNull());
    expect(posts()).toEqual([]);
    expect(S().inboxInstagramDmSendOps[KEY]).toMatchObject({ state: "dispatching" });
  });

  it("the recovery list names another Worker's operation and never asks it", async () => {
    const other = dmOpKey("https://old.test", ME, CONV, IN1);
    await seed("prepared", "op-dm-foreign1", { workerOrigin: "https://old.test" }, other);
    render(null);
    const foreign = $("ibx-igdm-recovery-foreign")!;
    expect(foreign.textContent).toContain(IN1);
    expect(foreign.textContent).toContain("https://old.test");
    expect(foreign.querySelectorAll("button")).toHaveLength(0);
    expect($("ibx-igdm-recovery")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("an explicit Cancel ends a prepared review on its validated receipt; the draft stays; a failed one keeps it", async () => {
    const id = await seed("prepared");
    handler = () => ({ error: "receipt_unavailable" });
    // From the recovery list, with the account read failing: a failure keeps the handle and says so.
    useInbox.setState({ account: null, accountError: "token_expired" });
    render(null);
    await click("ibx-igdm-cancel-row", $("ibx-igdm-recovery-item")!);
    await until(() =>
      expect($("ibx-igdm-error")?.textContent).toContain("Couldn't confirm the cancel"),
    );
    expect(S().inboxInstagramDmSendOps[KEY]?.state).toBe("prepared");
    await click("ibx-igdm-close");
    // From the conversation editor of that inbound message: the cancelled receipt ends it.
    instagramOn();
    handler = (m, path) =>
      m === "POST" && path.endsWith(`/${id}/cancel`)
        ? { intent: intent(id, "cancelled") }
        : { error: "not_found" };
    render();
    await click("ibx-igdm-cancel-row");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("cancelled"));
    expect(posts()).toEqual([
      `/social/inbox/instagram/dm/send/${id}/cancel`,
      `/social/inbox/instagram/dm/send/${id}/cancel`,
    ]);
    expect(S().inboxInstagramDmSendOps[KEY]).toBeUndefined();
    expect($("ibx-igdm-recovery")).toBeNull();
    expect(S().inboxDrafts[SCOPE]?.commitId).toBe(SAVED.commitId);
  });
});

describe("enabled only by the readiness mock", () => {
  beforeEach(() => {
    gate.ready = { ok: true };
  });

  it("the review names account, conversation, recipient, the exact inbound message and the canonical text; sent shows the id as text", async () => {
    render();
    await click("ibx-igdm-open");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-igdm-account")!.textContent).toBe("@3z.prod");
    expect($("ibx-igdm-conversation-id")!.textContent).toContain(CONV);
    expect($("ibx-igdm-recipient-name")!.textContent).toBe("@sara");
    expect($("ibx-igdm-recipient-id")!.textContent).toContain(PERSON);
    expect($("ibx-igdm-inbound-id")!.textContent).toContain(IN1);
    expect($("ibx-igdm-inbound-text")!.textContent).toBe("is it the 16 Pro?");
    expect($("ibx-igdm-text")!.textContent).toBe(CANON);
    expect($("ibx-igdm-expires")).not.toBeNull();
    expect($("ibx-igdm-sheet")!.textContent).toContain(
      "never changes whether your automatic replies",
    );
    handler = (_m, path) =>
      path.endsWith("/confirm")
        ? { intent: intent(S().inboxInstagramDmSendOps[KEY]!.operationId, "sent") }
        : {};
    await click("ibx-igdm-confirm");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("sent"));
    expect($("ibx-igdm-message-id")!.textContent).toContain(MID);
    expect($("ibx-igdm-sheet")!.querySelectorAll("a")).toHaveLength(0);
    expect(posts()).toEqual([
      "/social/inbox/instagram/dm/send/prepare",
      "/social/inbox/instagram/dm/send/confirm",
    ]);
  });

  it("without a matching loaded row the review keeps ids and says the preview is unavailable", async () => {
    instagramOn({ rows: false });
    render();
    await click("ibx-igdm-open");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-igdm-inbound-unavailable")).not.toBeNull();
    expect($("ibx-igdm-recipient-name")).toBeNull();
    expect($("ibx-igdm-inbound-id")!.textContent).toContain(IN1);
  });

  it("Clear draft after sent clears the editor through the exact revision; newer unsaved typing stays", async () => {
    for (const newer of [false, true]) {
      act(() => root.render(<></>));
      await S().discardInboxDraft(SCOPE, inboxDraftBase(S().inboxDrafts[SCOPE]));
      const d = await S().saveInboxDraft(SCOPE, TEXT, inboxDraftBase(null));
      if (!d.ok || !d.draft) throw new Error("draft");
      SAVED = d.draft;
      await S().clearInboxInstagramDmSendOp(
        KEY,
        S().inboxInstagramDmSendOps[KEY]?.operationId ?? "",
      );
      resetInstagramDmViews();
      handler = (_m, path, body) =>
        path.endsWith("/prepare")
          ? { intent: intent(body.operationId) }
          : { intent: intent(S().inboxInstagramDmSendOps[KEY]!.operationId, "sent") };
      render();
      await click("ibx-igdm-open");
      await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
      await click("ibx-igdm-confirm");
      await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("sent"));
      if (newer) await type("typed after Send");
      await click("ibx-igdm-clear");
      await until(() => expect($("ibx-igdm-sheet")).toBeNull());
      expect(S().inboxDrafts[SCOPE]).toBeUndefined();
      expect(S().inboxInstagramDmSendOps[KEY]).toBeUndefined();
      expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe(
        newer ? "typed after Send" : "",
      );
      expect($("ibx-draft-status")!.dataset.state).toBe("discarded");
    }
  });

  it("selecting another inbound message while Prepare waits for storage sends nothing (A → B → A never revives)", async () => {
    render();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    setArticlesLock(async (fn) => {
      await held;
      return fn();
    });
    await click("ibx-igdm-open");
    render(target({ inboundMessageId: IN2 }));
    render(target());
    setArticlesLock(queueLock());
    release();
    await until(() => expect(S().inboxInstagramDmSendOps[KEY]).toBeUndefined());
    await act(() => new Promise<void>((r) => setTimeout(r, 50)));
    expect(posts()).toEqual([]);
  });
});

// DT-6B-2C-5A-R1: the countdown's "time is up" belongs to the reviewed operation and its deadline (2C5A-1), and every
// borrowed preview comes only from a loaded row matching the selected id, sender and time (2C5A-2).
describe("R1: expiry belongs to the reviewed operation (enabled only by the readiness mock)", () => {
  beforeEach(() => {
    gate.ready = { ok: true };
  });
  const past = () => new Date(Date.now() - 1000).toISOString();
  const confirms = () => posts().filter((p) => p.endsWith("/confirm"));
  const confirm = () => $("ibx-igdm-confirm") as HTMLButtonElement;
  const opId = () => S().inboxInstagramDmSendOps[KEY]!.operationId;

  it("an expired review, its authoritative expired status, then a new review in the same sheet: one explicit Confirm", async () => {
    handler = (_m, path, body) =>
      path.endsWith("/prepare")
        ? { intent: intent(body.operationId, "prepared", { reviewExpiresAt: past() }) }
        : {};
    render();
    await click("ibx-igdm-open");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
    await until(() => expect(confirm().disabled).toBe(true));
    expect($("ibx-igdm-time-up")).not.toBeNull();
    const old = opId();
    handler = () => ({ intent: intent(old, "expired", { receiptVersion: 2 }) });
    await click("ibx-igdm-sheet-check");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("expired"));
    expect($("ibx-igdm-confirm")).toBeNull();
    // Prepare again in the SAME mounted sheet: a new operation with a future deadline.
    handler = (_m, path, body) =>
      path.endsWith("/prepare") ? { intent: intent(body.operationId) } : {};
    await click("ibx-igdm-again");
    await until(() => expect(opId()).not.toBe(old));
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-igdm-time-up")).toBeNull();
    expect($("ibx-igdm-expires")).not.toBeNull();
    expect(confirm().disabled).toBe(false);
    // Never automatic: nothing is confirmed until the owner clicks.
    await act(() => new Promise<void>((r) => setTimeout(r, 60)));
    expect(confirms()).toEqual([]);
    let release!: (v: unknown) => void;
    const held = new Promise((r) => (release = r));
    const fresh = opId();
    handler = (_m, path) => (path.endsWith("/confirm") ? held : {});
    await click("ibx-igdm-confirm");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("confirming"));
    // While Confirm is pending it stays disabled; a second click asks nothing.
    expect(confirm().disabled).toBe(true);
    await click("ibx-igdm-confirm");
    expect(confirms()).toEqual(["/social/inbox/instagram/dm/send/confirm"]);
    release(json({ intent: intent(fresh, "sent") }));
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("sent"));
    expect(confirms()).toHaveLength(1);
  });

  it("the same expired operation stays disabled when re-checked or rerendered; Close/reopen of a fresh deadline enables", async () => {
    const deadline = past();
    handler = (_m, path, body) =>
      path.endsWith("/prepare")
        ? { intent: intent(body.operationId, "prepared", { reviewExpiresAt: deadline }) }
        : {};
    render();
    await click("ibx-igdm-open");
    await until(() => expect(confirm().disabled).toBe(true));
    const id = opId();
    handler = () => ({ intent: intent(id, "prepared", { reviewExpiresAt: deadline }) });
    await click("ibx-igdm-sheet-check");
    await until(() => expect(calls.filter((c) => c.method === "GET")).toHaveLength(1));
    await act(() => new Promise<void>((r) => setTimeout(r, 30)));
    expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review");
    expect(confirm().disabled).toBe(true);
    render();
    await act(() => new Promise<void>((r) => setTimeout(r, 30)));
    expect(confirm().disabled).toBe(true);
    // Positive control: close, then reopen the same operation once the Worker answers a future deadline.
    await click("ibx-igdm-close");
    await until(() => expect($("ibx-igdm-sheet")).toBeNull());
    handler = () => ({ intent: intent(id) });
    await click("ibx-igdm-check");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
    await until(() => expect(confirm().disabled).toBe(false));
    expect(confirms()).toEqual([]);
  });

  it("closed production readiness never offers Confirm on a fresh retained review", async () => {
    gate.ready = { ok: false, reason: "permission_unverified" };
    const id = await seed("prepared");
    handler = () => ({ intent: intent(id) });
    render();
    await click("ibx-igdm-check");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-igdm-expires")).not.toBeNull();
    expect($("ibx-igdm-confirm")).toBeNull();
    expect($("ibx-igdm-again")).toBeNull();
    expect(posts()).toEqual([]);
  });
});

describe("R1: a borrowed preview needs a row matching id, sender and time", () => {
  const OTHER = "990000000000777";
  const rowsOf = (items: Record<string, unknown>[]) =>
    useInbox.setState({
      lists: { [inboxScope(WORKER, ME, "messages", CONV)]: { ...head, items } },
    });
  const row = (over: Record<string, unknown> = {}) => ({
    id: IN1,
    createdAt: AT,
    direction: "in",
    from: { id: PERSON, username: "sara" },
    text: "is it the 16 Pro?",
    kind: "text",
    ...over,
  });
  const cases: [string, Record<string, unknown>[] | null][] = [
    [
      "a conflicting sender",
      [row({ from: { id: OTHER, username: "intruder" }, text: "OTHER_SENDER_CANARY" })],
    ],
    [
      "a conflicting time",
      [row({ createdAt: "2026-10-17T09:30:00.000Z", text: "OTHER_TIME_CANARY" })],
    ],
    ["no loaded row", null],
  ];

  for (const [name, items] of cases)
    it(`inline target with ${name}: ids only, preview unavailable, same target, no request`, () => {
      if (items) rowsOf(items);
      else instagramOn({ rows: false });
      render();
      const ctx = $("ibx-igdm-target")!;
      expect(ctx.dataset.id).toBe(IN1);
      expect(ctx.textContent).not.toContain("CANARY");
      expect(ctx.textContent).not.toContain("intruder");
      expect(
        ctx.querySelector('[data-testid="ibx-igdm-target-unavailable"]')!.textContent,
      ).toContain("preview unavailable");
      expect(ctx.textContent).toContain(IN1);
      expect(calls).toEqual([]);
    });

  it("inline target with the matching row shows its preview", () => {
    rowsOf([row()]);
    render();
    const ctx = $("ibx-igdm-target")!;
    expect(ctx.textContent).toContain("@sara");
    expect(ctx.textContent).toContain("is it the 16 Pro?");
    expect($("ibx-igdm-target-unavailable")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("the review Details borrow nothing from a same-id row at another time (readiness mock)", async () => {
    gate.ready = { ok: true };
    rowsOf([row({ createdAt: "2026-10-17T09:30:00.000Z", text: "OTHER_TIME_CANARY" })]);
    render();
    await click("ibx-igdm-open");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-igdm-inbound-unavailable")).not.toBeNull();
    expect($("ibx-igdm-sheet")!.textContent).not.toContain("OTHER_TIME_CANARY");
    expect($("ibx-igdm-inbound-id")!.textContent).toContain(IN1);
    expect(posts()).toEqual(["/social/inbox/instagram/dm/send/prepare"]);
  });
});

// DT-6B-3C: the limit is 1000 UTF-8 bytes of the canonical text, said as bytes (Arabic letters ~2, emoji ~4), never as a
// character quota. Over it, nothing is prepared or sent even with readiness injected open; an older prepared review over
// it shows its exact text, the byte guidance and the way forward, keeps Check status and Cancel, and its Send is off.
describe("DT-6B-3C: UTF-8 byte guidance and the over-limit review", () => {
  const OLD = "ب".repeat(501);
  const OLD_DIGEST = dmBodyDigest(PERSON, OLD);
  const legacy = async () => {
    const id = await seed("prepared", "op-dm-legacy1", { digest: OLD_DIGEST });
    handler = (m, path) =>
      m === "POST" && path.endsWith(`/${id}/cancel`)
        ? { intent: intent(id, "cancelled", { text: OLD, digest: OLD_DIGEST }) }
        : { intent: intent(id, "prepared", { text: OLD, digest: OLD_DIGEST }) };
    return id;
  };
  const saveDraft = async (text: string) => {
    const d = await S().saveInboxDraft(SCOPE, text, inboxDraftBase(S().inboxDrafts[SCOPE] ?? null));
    if (!d.ok || !d.draft) throw new Error("draft");
    SAVED = d.draft;
  };

  it("with readiness injected open, a saved draft over 1000 UTF-8 bytes is never prepared; the note says bytes", async () => {
    gate.ready = { ok: true };
    await saveDraft(OLD);
    render();
    const open = $("ibx-igdm-open") as HTMLButtonElement;
    expect(open.disabled).toBe(true);
    const note = $("ibx-igdm-too-long")!.textContent!;
    expect(note).toContain("1002 UTF-8 bytes");
    expect(note).toContain("1,000");
    expect(note).toContain("about 2 bytes");
    expect(note).toContain("about 4");
    await act(async () => open.click());
    expect($("ibx-igdm-sheet")).toBeNull();
    expect(calls).toEqual([]);
    // The draft itself is kept exactly as saved.
    expect(($("ibx-draft-text") as HTMLTextAreaElement).value).toBe(OLD);
    expect(S().inboxDrafts[SCOPE]?.text).toBe(OLD);
    // At exactly 1000 bytes the opener is available again.
    act(() => root.render(<></>));
    await saveDraft("ب".repeat(500));
    render();
    expect($("ibx-igdm-too-long")).toBeNull();
    expect(($("ibx-igdm-open") as HTMLButtonElement).disabled).toBe(false);
  });

  it("with readiness injected open, an older prepared review over the bound shows its exact text, Send stays off", async () => {
    gate.ready = { ok: true };
    const id = await legacy();
    render();
    await click("ibx-igdm-check");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
    expect($("ibx-igdm-text")!.textContent).toBe(OLD);
    const over = $("ibx-igdm-over-limit")!.textContent!;
    expect(over).toContain("1002 UTF-8 bytes");
    expect(over).toContain("Cancel this review");
    expect(over).toContain("prepare a new review");
    const confirm = $("ibx-igdm-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await act(async () => confirm.click());
    expect($("ibx-igdm-sheet-check")).not.toBeNull();
    expect(($("ibx-igdm-cancel") as HTMLButtonElement).disabled).toBe(false);
    expect(posts()).toEqual([]);
    expect(S().inboxInstagramDmSendOps[KEY]?.state).toBe("prepared");
    // Nothing is cleared or recreated by itself: Cancel is the owner's explicit step.
    await click("ibx-igdm-cancel");
    await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("cancelled"));
    expect(posts()).toEqual([`/social/inbox/instagram/dm/send/${id}/cancel`]);
    expect(S().inboxDrafts[SCOPE]?.commitId).toBe(SAVED.commitId);
  });

  it("production: the recovered review over the bound says so in English and Arabic; Check and Cancel stay", async () => {
    await legacy();
    for (const lang of ["en", "ar"] as const) {
      S().setSettings({ lang });
      act(() => root.render(<></>));
      render(null);
      await click("ibx-igdm-check", $("ibx-igdm-recovery-item")!);
      await until(() => expect($("ibx-igdm-sheet")!.dataset.phase).toBe("review"));
      expect($("ibx-igdm-text")!.textContent).toBe(OLD);
      const over = $("ibx-igdm-over-limit")!.textContent!;
      expect(over).toContain(lang === "ar" ? "بايت" : "UTF-8 bytes");
      expect(over).toContain(lang === "ar" ? "ألغِ هذي المراجعة" : "Cancel this review");
      expect($("ibx-igdm-confirm")).toBeNull();
      expect($("ibx-igdm-cancel")).not.toBeNull();
      expect($("ibx-igdm-sheet-check")).not.toBeNull();
      await click("ibx-igdm-close");
      await until(() => expect($("ibx-igdm-sheet")).toBeNull());
    }
    expect(posts()).toEqual([]);
    expect(S().inboxInstagramDmSendOps[KEY]?.state).toBe("prepared");
  });
});
