// @vitest-environment jsdom
import { act, createElement, type FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dmControlKey, type DmControlReadiness } from "@/lib/inboxInstagramDmControl";
import {
  setArticlesLock,
  useStore,
  type ArticlesLock,
  type InboxInstagramDmControl,
} from "@/store";
import InstagramDmControl, { InstagramDmControlRecoveryList } from "./InstagramDmControlReview";
import { resetInbox, useInbox } from "./useInbox";
import { resetInstagramDmControlViews } from "./useInstagramDmControl";
import { resetProviderInbox, useProviderInbox } from "./useProviderInbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 🛟 The conversation takeover controls, their review sheet and recovery list (packet DT-6B-2C-5B) in English and
// Arabic. New registration is closed in production: "Link this conversation" is disabled with the honest reason and
// nothing is asked. A retained verified handle opens to Check status, and to an explicit review of Take over / Resume
// that names the account, conversation, person, the observed mode and the requested change, with the true in-flight
// total (rows limited when truncated) and the unknown-outcome count separately. The enabled registration is reached
// ONLY through a module mock of the readiness function. Fake Worker.

const gate = vi.hoisted(() => ({
  ready: { ok: false, reason: "permission_unverified" } as DmControlReadiness,
}));
vi.mock("@/lib/inboxInstagramDmControl", async (orig) => ({
  ...(await orig<typeof import("@/lib/inboxInstagramDmControl")>()),
  instagramDmControlReadiness: () => gate.ready,
}));

const WORKER = "https://scout.test";
const OLD = "https://old.test";
const ME = "17841000000000001";
const CONV = "aWdfZAG06MTpJR01lc3NhZA2VUaHJlYWQ6MTc4NDE=";
const PERSON = "990000000000001";
const H = "a".repeat(32);
const KEY = dmControlKey(WORKER, ME, CONV);
const T = "2026-10-17T09:00:00.000Z";
const CONTROL = "/social/inbox/instagram/dm/control";

const row = (n: number) => ({
  account: ME,
  conversationId: CONV,
  recipientId: PERSON,
  inboundMessageId: `in${n}`,
  actor: n % 2 ? "auto:cam" : "manual:op-12345678",
  payloadDigest: "d".repeat(64),
  generation: "0".repeat(32),
  state: "claimed",
  claimedAt: T,
  receiptVersion: 1,
});
const full = (
  o: {
    mode?: string;
    revision?: number;
    rows?: number;
    total?: number;
    uncertain?: number;
    changed?: boolean;
  } = {},
) => {
  const rows = Array.from({ length: o.rows ?? 0 }, (_, i) => row(i + 1));
  const total = o.total ?? rows.length;
  return {
    control: {
      handleId: H,
      account: ME,
      conversationId: CONV,
      recipientId: PERSON,
      registeredGeneration: "e".repeat(32),
      evidenceDigest: "f".repeat(64),
      createdAt: T,
      usedAt: T,
    },
    conversation: {
      account: ME,
      conversationId: CONV,
      mode: o.mode ?? "auto",
      revision: o.revision ?? 0,
    },
    inFlight: rows,
    inFlightTotal: total,
    inFlightTruncated: total > rows.length,
    uncertainTotal: o.uncertain ?? 0,
    ...(o.changed === undefined ? {} : { changed: o.changed }),
  };
};

let root: Root;
let host: HTMLDivElement;
let calls: { method: string; path: string }[];
let handler: (
  method: string,
  path: string,
  body: Record<string, unknown>,
) => { status?: number; body: unknown };

const S = () => useStore.getState();
const $ = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const $$ = (id: string) => [
  ...document.body.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
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
const click = async (id: string, scope: ParentNode = document.body) => {
  const el = scope.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`no ${id}`);
  await act(async () => el.click());
};

type Entry = Omit<InboxInstagramDmControl, "updatedAt" | "commitId">;
async function seed(over: Partial<Entry> = {}, key = KEY) {
  const r = await S().setInboxInstagramDmControl(
    key,
    {
      workerOrigin: WORKER,
      account: ME,
      conversationId: CONV,
      handleId: H,
      recipientId: PERSON,
      registeredGeneration: "e".repeat(32),
      evidenceDigest: "f".repeat(64),
      mode: "auto",
      revision: 0,
      inFlightTotal: 23,
      inFlightTruncated: true,
      uncertainTotal: 2,
      ...over,
    },
    S().inboxInstagramDmControls[key]?.commitId ?? null,
  );
  if (!r.ok) throw new Error(r.reason);
}

async function render<P extends object>(
  el: FunctionComponent<P>,
  props: P,
  lang: "en" | "ar" = "en",
) {
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(el, props));
  });
}
const panel = (o: { offered?: boolean } = {}) => ({
  target: { account: ME, conversationId: CONV },
  accountName: "3z.prod",
  offered: o.offered ?? true,
});

beforeEach(() => {
  gate.ready = { ok: false, reason: "permission_unverified" };
  setArticlesLock(queueLock());
  localStorage.clear();
  S().reset();
  S().setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetInstagramDmControlViews();
  resetInbox();
  useProviderInbox.setState({ provider: "instagram" });
  useInbox.setState({
    origin: WORKER,
    account: {
      accountId: ME,
      handle: "3z.prod",
      generation: "c".repeat(32),
      capabilities: { messages: "ok", comments: "ok" },
    },
    accountError: null,
    tab: "messages",
    conversationId: CONV,
  });
  calls = [];
  handler = () => ({ status: 404, body: { error: "not_found" } });
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      calls.push({ method: init?.method ?? "GET", path: u.pathname });
      const out = handler(
        init?.method ?? "GET",
        u.pathname,
        init?.body ? JSON.parse(String(init.body)) : {},
      );
      return json(out.body, out.status ?? 200);
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  for (const c of calls) expect(c.path.startsWith(CONTROL)).toBe(true);
  vi.unstubAllGlobals();
  setArticlesLock(undefined);
  resetInbox();
  resetProviderInbox();
});

describe("registration", () => {
  for (const lang of ["en", "ar"] as const)
    it(`production (${lang}): an unlinked conversation says why linking is unavailable and asks nothing`, async () => {
      await render(InstagramDmControl, panel(), lang);
      const button = $("ibx-igctl-register") as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.textContent).toContain(
        lang === "ar" ? "اربط هذي المحادثة" : "Link this conversation",
      );
      expect($("ibx-igctl-register-unavailable")!.textContent).toContain(
        lang === "ar" ? "لسه ما تأكدنا منه" : "isn't verified yet",
      );
      expect($("ibx-igctl-check")).toBeNull();
      expect($("ibx-igctl-takeover")).toBeNull();
      await act(async () => button.click());
      expect(calls).toEqual([]);
      expect(S().inboxInstagramDmControls).toEqual({});
    });

  it("with injected readiness, one explicit Link registers once and shows the learned mode without changing it", async () => {
    gate.ready = { ok: true };
    handler = () => ({ body: full() });
    await render(InstagramDmControl, panel());
    await click("ibx-igctl-register");
    await until(() => expect($("ibx-igctl-sheet")?.dataset.phase).toBe("status"));
    expect(calls).toEqual([{ method: "POST", path: `${CONTROL}/register` }]);
    expect(S().inboxInstagramDmControls[KEY]).toMatchObject({
      handleId: H,
      mode: "auto",
      revision: 0,
    });
    expect($("ibx-igctl-status")!.dataset.mode).toBe("auto");
  });

  it("a lost registration is honest uncertainty: no handle, no Check status, no change", async () => {
    const r = await S().setInboxInstagramDmControl(
      KEY,
      {
        workerOrigin: WORKER,
        account: ME,
        conversationId: CONV,
        pending: { action: "register", at: T },
        uncertain: "registration",
      },
      null,
    );
    expect(r.ok).toBe(true);
    await render(InstagramDmControl, panel());
    expect($("ibx-igctl-reg-uncertain")!.textContent).toContain("no verified link");
    for (const id of ["ibx-igctl-check", "ibx-igctl-takeover", "ibx-igctl-resume"])
      expect($(id)).toBeNull();
    expect(($("ibx-igctl-register") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("a retained verified handle", () => {
  it("shows the stored mode, revision and counts as last checked; Check status shows truthful counts, limited rows and the unknown count", async () => {
    await seed();
    handler = () => ({
      body: full({ mode: "human", revision: 4, rows: 20, total: 23, uncertain: 2 }),
    });
    await render(InstagramDmControl, panel());
    const status = $("ibx-igctl-status")!;
    expect(status.dataset.mode).toBe("auto");
    expect(status.dataset.revision).toBe("0");
    expect($("ibx-igctl-inflight")!.dataset.total).toBe("23");
    expect($("ibx-igctl-uncertain-count")!.dataset.count).toBe("2");
    await click("ibx-igctl-check");
    const sheet = () => $("ibx-igctl-sheet")!;
    await until(() => expect(sheet().dataset.phase).toBe("status"));
    expect(sheet().textContent).toContain("doesn't say who set the mode");
    const counts = sheet().querySelector<HTMLElement>('[data-testid="ibx-igctl-inflight"]')!;
    expect(counts.dataset.total).toBe("23");
    expect(sheet().querySelectorAll('[data-testid="ibx-igctl-row"]')).toHaveLength(20);
    expect(sheet().querySelector('[data-testid="ibx-igctl-rows-limited"]')!.textContent).toContain(
      "first 20 of 23",
    );
    expect(
      sheet().querySelector<HTMLElement>('[data-testid="ibx-igctl-uncertain-count"]')!.dataset
        .count,
    ).toBe("2");
    expect(calls).toEqual([{ method: "GET", path: `${CONTROL}/${H}` }]);
  });

  for (const lang of ["en", "ar"] as const)
    it(`take over (${lang}): the review names everything and says replies already authorized may still arrive; Confirm asks once`, async () => {
      await seed();
      handler = (m, path, body) => {
        expect(path).toBe(`${CONTROL}/${H}/takeover`);
        expect(body).toEqual({ account: ME, expectedRevision: 0 });
        return { body: full({ mode: "human", revision: 1, changed: true, rows: 1, total: 1 }) };
      };
      await render(InstagramDmControl, panel(), lang);
      await click("ibx-igctl-takeover");
      const sheet = () => $("ibx-igctl-sheet")!;
      await until(() => expect(sheet().dataset.phase).toBe("review"));
      expect(calls).toEqual([]);
      expect($("ibx-igctl-account")!.textContent).toContain("@3z.prod");
      expect($("ibx-igctl-conversation-id")!.textContent).toContain(CONV);
      expect($("ibx-igctl-recipient-id")!.textContent).toContain(PERSON);
      expect($("ibx-igctl-observed")!.dataset.mode).toBe("auto");
      expect($("ibx-igctl-change")!.dataset.mode).toBe("human");
      expect($("ibx-igctl-copy")!.textContent).toContain(
        lang === "ar" ? "ممكن توصل" : "may still arrive",
      );
      expect($("ibx-igctl-copy-unknown")).not.toBeNull();
      expect(
        sheet().querySelector<HTMLElement>('[data-testid="ibx-igctl-inflight"]')!.dataset.total,
      ).toBe("23");
      expect(sheet().querySelector('[data-testid="ibx-igctl-rows-not-loaded"]')).not.toBeNull();
      await click("ibx-igctl-confirm");
      await until(() => expect(sheet().dataset.phase).toBe("done"));
      expect(calls).toHaveLength(1);
      expect(S().inboxInstagramDmControls[KEY]).toMatchObject({ mode: "human", revision: 1 });
      expect($("ibx-igctl-confirm")).toBeNull();
    });

  it("resume: the review says it doesn't replay past messages and sends nothing now", async () => {
    await seed({ mode: "human", revision: 1 });
    await render(InstagramDmControl, panel());
    expect($("ibx-igctl-takeover")).toBeNull();
    await click("ibx-igctl-resume");
    await until(() => expect($("ibx-igctl-sheet")?.dataset.phase).toBe("review"));
    expect($("ibx-igctl-copy")!.textContent).toContain(
      "doesn't replay past messages and sends nothing now",
    );
    expect(calls).toEqual([]);
  });

  it("a conflict shows only the narrow answer (no counts) and asks for Check status before a new review", async () => {
    await seed();
    handler = () => ({
      status: 409,
      body: {
        error: "conflict",
        control: { handleId: H, account: ME, conversationId: CONV, recipientId: PERSON },
        conversation: { account: ME, conversationId: CONV, mode: "human", revision: 3 },
      },
    });
    await render(InstagramDmControl, panel());
    await click("ibx-igctl-takeover");
    await until(() => expect($("ibx-igctl-sheet")?.dataset.phase).toBe("review"));
    await click("ibx-igctl-confirm");
    await until(() => expect($("ibx-igctl-sheet")?.dataset.phase).toBe("conflict"));
    const sheet = $("ibx-igctl-sheet")!;
    expect($("ibx-igctl-conflict")!.textContent).toContain("revision 3");
    expect(sheet.querySelector('[data-testid="ibx-igctl-inflight"]')).toBeNull();
    expect(sheet.querySelector('[data-testid="ibx-igctl-sheet-check"]')).not.toBeNull();
    expect($("ibx-igctl-counts-unknown")).not.toBeNull();
  });

  it("an unsettled change offers Check status only: Take over / Resume are disabled with the reason", async () => {
    await seed({
      pending: { action: "takeover", expectedRevision: 0, requestedMode: "human", at: T },
      uncertain: "mutation",
    });
    await render(InstagramDmControl, panel({ offered: false }));
    expect(($("ibx-igctl-takeover") as HTMLButtonElement).disabled).toBe(true);
    expect($("ibx-igctl-blocked")!.textContent).toContain("isn't settled yet");
    expect($("ibx-igctl-check")).not.toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("recovery list", () => {
  it("lists this Worker's handles with their stored account, and names another Worker's without a button or request", async () => {
    await seed();
    await seed({ workerOrigin: OLD, conversationId: "c-old" }, dmControlKey(OLD, ME, "c-old"));
    useInbox.setState({ account: null, accountError: "token_expired" });
    await render(InstagramDmControlRecoveryList, {});
    const mine = $("ibx-igctl-recovery")!;
    expect($$("ibx-igctl-recovery-item")).toHaveLength(1);
    expect(mine.textContent).toContain(ME);
    expect(mine.querySelector('[data-testid="ibx-igctl-check"]')).not.toBeNull();
    expect(mine.querySelector('[data-testid="ibx-igctl-register"]')).toBeNull();
    const foreign = $("ibx-igctl-recovery-foreign")!;
    expect(foreign.textContent).toContain("c-old");
    expect(foreign.textContent).toContain(OLD);
    expect(foreign.querySelectorAll("button")).toHaveLength(0);
    S().setSettings({ apiKeys: {} });
    await until(() => expect($("ibx-igctl-recovery")).toBeNull());
    expect($("ibx-igctl-recovery-foreign")!.textContent).toContain("No Worker is connected");
    expect(calls).toEqual([]);
  });
});

// 🛟 DT-6B-2C-5B-R1: a review's rows belong to the exact durable record they were recorded as (another tab's newer check
// of the same revision means the stored totals, rows not loaded); a Status that cannot settle a pending change says so.
describe("DT-6B-2C-5B-R1 review counts and unsettled status", () => {
  it("a review opened after another tab's newer check of the same revision shows those totals, not this tab's old rows", async () => {
    await seed();
    handler = () => ({ body: full({ rows: 1, total: 1, uncertain: 1 }) });
    await render(InstagramDmControl, panel());
    await click("ibx-igctl-check");
    const sheet = () => $("ibx-igctl-sheet")!;
    await until(() => expect(sheet().dataset.phase).toBe("status"));
    expect(sheet().querySelectorAll('[data-testid="ibx-igctl-row"]')).toHaveLength(1);
    await click("ibx-igctl-close");
    await act(async () => {
      await seed({ inFlightTotal: 7, inFlightTruncated: true, uncertainTotal: 5 });
    });
    await click("ibx-igctl-takeover");
    await until(() => expect(sheet().dataset.phase).toBe("review"));
    expect(
      sheet().querySelector<HTMLElement>('[data-testid="ibx-igctl-inflight"]')!.dataset.total,
    ).toBe("7");
    expect(
      sheet().querySelector<HTMLElement>('[data-testid="ibx-igctl-uncertain-count"]')!.dataset
        .count,
    ).toBe("5");
    expect(sheet().querySelectorAll('[data-testid="ibx-igctl-row"]')).toHaveLength(0);
    expect(sheet().querySelector('[data-testid="ibx-igctl-rows-not-loaded"]')).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("an open review whose stored counts change underneath drops its rows for the stored totals", async () => {
    await seed();
    handler = () => ({ body: full({ rows: 1, total: 1, uncertain: 1 }) });
    await render(InstagramDmControl, panel());
    await click("ibx-igctl-check");
    const sheet = () => $("ibx-igctl-sheet")!;
    await until(() => expect(sheet().dataset.phase).toBe("status"));
    await click("ibx-igctl-sheet-takeover");
    await until(() => expect(sheet().dataset.phase).toBe("review"));
    expect(sheet().querySelectorAll('[data-testid="ibx-igctl-row"]')).toHaveLength(1);
    await act(async () => {
      await seed({ inFlightTotal: 7, inFlightTruncated: true, uncertainTotal: 5 });
    });
    await until(() =>
      expect(
        sheet().querySelector<HTMLElement>('[data-testid="ibx-igctl-inflight"]')!.dataset.total,
      ).toBe("7"),
    );
    expect(sheet().querySelectorAll('[data-testid="ibx-igctl-row"]')).toHaveLength(0);
    expect(sheet().querySelector('[data-testid="ibx-igctl-rows-not-loaded"]')).not.toBeNull();
  });

  it("a Status that cannot settle the pending change says it is still unsettled and offers no new change", async () => {
    await seed({
      pending: { action: "takeover", expectedRevision: 0, requestedMode: "human", at: T },
    });
    // Another tab's Status began before this pending change was written: modelled by a read at the expected revision
    // in the other mode, which can never settle it.
    handler = () => ({ body: full({ mode: "auto", revision: 0, total: 2 }) });
    await render(InstagramDmControl, panel({ offered: false }));
    await click("ibx-igctl-check");
    const sheet = () => $("ibx-igctl-sheet")!;
    await until(() => expect(sheet().dataset.phase).toBe("status"));
    expect(sheet().querySelector('[data-testid="ibx-igctl-sheet-blocked"]')!.textContent).toContain(
      "isn't settled yet",
    );
    expect(sheet().querySelector('[data-testid="ibx-igctl-resolved"]')).toBeNull();
    expect(sheet().querySelector('[data-testid="ibx-igctl-sheet-takeover"]')).toBeNull();
    expect(S().inboxInstagramDmControls[KEY].pending).toMatchObject({ action: "takeover" });
    expect(calls).toEqual([{ method: "GET", path: `${CONTROL}/${H}` }]);
  });
});
