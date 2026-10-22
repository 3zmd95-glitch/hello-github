// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGE_FILES } from "@/lib/i18n";
import { inboxScope, type ConversationItem, type InboxList } from "@/lib/inbox";
import { useStore } from "@/store";
import ConversationList from "./ConversationList";
import { resetInbox, useInbox } from "./useInbox";
import { resetProviderInbox } from "./useProviderInbox";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// DT-WIO-1: searching the LOADED Instagram conversations in the real ConversationList, against synthetic data only.
// Search is local memory: no request, no storage, no draft. The footer keeps the original list's coverage.

const WORKER = "https://scout.test";
const ME = "17841000000000001";
const GEN = "a".repeat(32);
const GEN_B = "b".repeat(32);

const conv = (id: string, ...people: { id?: string; username?: string }[]): ConversationItem => ({
  id,
  updatedAt: "2026-10-17T08:00:00.000Z",
  participants: [{ id: ME, username: "3z.prod" }, ...people],
});
const ROWS: ConversationItem[] = [
  conv("c1", { id: "p1", username: "Fan_One" }),
  conv("c2", { id: "p2", username: "أحمد_العتيبي" }),
  conv("c3", { id: "99887766" }),
  { id: "c4", updatedAt: null, participants: [{ id: ME, username: "3z.prod" }] },
  conv("c5", { id: "p5", username: "a.b" }),
  conv("c6", { id: "p6", username: "axb" }),
  conv("c7", { id: "p7", username: "fan_two" }),
];

const key = (origin = WORKER, acc = ME) => inboxScope(origin, acc, "conversations");
const list = (over: Partial<InboxList<ConversationItem>> = {}): InboxList<ConversationItem> => ({
  items: ROWS,
  next: null,
  coverage: "end",
  error: null,
  fetchedAt: null,
  ...over,
});
const account = (gen = GEN, acc = ME) => ({
  accountId: acc,
  handle: "3z.prod",
  generation: gen,
  capabilities: { messages: "ok" as const, comments: "ok" as const },
});
const seed = (l: InboxList<ConversationItem>, gen = GEN) =>
  useInbox.setState({
    origin: WORKER,
    account: account(gen),
    accountError: null,
    tab: "messages",
    conversationId: null,
    lists: { [key()]: l },
    busy: {},
  });

let root: Root;
let host: HTMLDivElement;
let calls: string[];

const $ = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const rows = () =>
  [...document.body.querySelectorAll<HTMLElement>('[data-testid="ibx-conv"]')].map(
    (b) => b.dataset.id,
  );
const input = () => $("ibx-search") as HTMLInputElement;
const type = async (value: string) => {
  await act(async () => {
    const el = input();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (el: HTMLElement | null) => {
  await act(async () => el!.click());
};
const render = () => act(() => root.render(<ConversationList />));
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
  useStore.getState().reset();
  useStore
    .getState()
    .setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "owner-token" } });
  resetProviderInbox();
  resetInbox();
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const u = new URL(input);
      calls.push(`${init?.method ?? "GET"} ${u.pathname}${u.search}`);
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
  vi.restoreAllMocks();
  resetProviderInbox();
  resetInbox();
});

describe("ConversationList search (DT-WIO-1)", () => {
  it("shows a labelled input, the scope note and loaded counts; blank keeps every row in order", async () => {
    seed(list());
    await render();
    expect(rows()).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
    const el = input();
    const label = document.body.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`);
    expect(label?.textContent).toBe("Find a conversation");
    expect(el.getAttribute("aria-describedby")).toBe($("ibx-search-note")!.id);
    expect($("ibx-search-note")!.textContent).toMatch(/only the conversations loaded here/i);
    expect($("ibx-search-note")!.textContent).toMatch(/message text or older history/i);
    expect($("ibx-search-count")!.getAttribute("role")).toBe("status");
    expect($("ibx-search-count")!.textContent).toBe("Loaded conversations: 7");
    expect($("ibx-search-clear")).toBeNull();
    await type("   ");
    expect(rows()).toEqual(["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
    expect($("ibx-search-nomatch")).toBeNull();
  });

  it("matches Latin names case-insensitively and counts matching of loaded, in provider order", async () => {
    seed(list());
    await render();
    await type("FAN_");
    expect(rows()).toEqual(["c1", "c7"]);
    expect($("ibx-search-count")!.textContent).toBe("Matching: 2 of 7 loaded");
  });

  it("matches Arabic names literally without folding letters, and ids", async () => {
    seed(list());
    await render();
    await type("العتيبي");
    expect(rows()).toEqual(["c2"]);
    await type("احمد");
    expect(rows()).toEqual([]);
    expect($("ibx-search-nomatch")).not.toBeNull();
    await type("9988");
    expect(rows()).toEqual(["c3"]);
  });

  it("never matches the owner, the conversation id or a row with nobody else", async () => {
    seed(list());
    await render();
    for (const q of ["3z.prod", ME, "c1"]) {
      await type(q);
      expect(rows()).toEqual([]);
    }
    await type("");
    expect(rows()).toContain("c4"); // shown as "Conversation" when blank
    expect(document.body.querySelector('[data-id="c4"]')!.textContent).toContain("Conversation");
  });

  it("compares after Unicode NFC", async () => {
    seed(
      list({
        items: [
          conv("n1", { id: "x", username: "café" }),
          conv("n2", { id: "y", username: "café" }),
        ],
      }),
    );
    await render();
    await type("café");
    expect(rows()).toEqual(["n1", "n2"]);
    await type("café");
    expect(rows()).toEqual(["n1", "n2"]);
  });

  it("is literal: regex characters and dots mean themselves", async () => {
    seed(list());
    await render();
    await type("a.b");
    expect(rows()).toEqual(["c5"]);
    for (const q of [".*", "(", "[", "\\", "^fan", "a|b"]) {
      await type(q);
      expect(rows()).toEqual([]);
      expect($("ibx-search-nomatch")).not.toBeNull();
    }
  });

  it("bounds the query to 200 characters and keeps it as text", async () => {
    seed(list());
    await render();
    expect(input().maxLength).toBe(200);
    await type("<b>x</b>".repeat(60));
    expect(input().value.length).toBe(200);
    expect(document.body.querySelector("b")).toBeNull();
  });

  it("Clear is explicit, restores every row and returns focus to the input", async () => {
    seed(list());
    await render();
    await type("fan_one");
    expect(rows()).toEqual(["c1"]);
    await click($("ibx-search-clear"));
    expect(input().value).toBe("");
    expect(rows()).toHaveLength(7);
    expect($("ibx-search-clear")).toBeNull();
    expect(document.activeElement).toBe(input());
  });

  it("a no-match is distinct from an empty inbox and keeps the footer's original coverage and Load more", async () => {
    seed(list({ coverage: "partial", next: "cur.2" }));
    await render();
    await type("nobody-like-this");
    expect(rows()).toEqual([]);
    expect($("ibx-search-nomatch")!.textContent).toMatch(/no loaded conversation matches/i);
    expect($("ibx-empty")).toBeNull();
    expect($("ibx-footer")!.dataset.coverage).toBe("partial");
    expect($("ibx-footer")!.textContent).toContain("partial");
    expect($("ibx-more")).not.toBeNull();
  });

  it.each([["cap"], ["history_unavailable"], ["end"]] as const)(
    "keeps the %s coverage line while a search matches nothing",
    async (coverage) => {
      seed(list({ coverage }));
      await render();
      await type("zzzz");
      expect($("ibx-footer")!.dataset.coverage).toBe(coverage);
      expect($("ibx-footer")!.querySelector("p")).not.toBeNull();
    },
  );

  it("shows no search and no no-match for a real empty inbox, an error or loading", async () => {
    seed(list({ items: [], coverage: "end" }));
    await render();
    expect($("ibx-search")).toBeNull();
    expect($("ibx-search-nomatch")).toBeNull();
    expect($("ibx-empty")).not.toBeNull();

    await act(async () => seed(list({ items: [], coverage: "unavailable", error: "upstream" })));
    expect($("ibx-search")).toBeNull();
    expect($("ibx-search-nomatch")).toBeNull();
    expect($("ibx-state")!.dataset.code).toBe("upstream");
    expect($("ibx-empty")).toBeNull();
  });

  it("never hides a partial-failure error line behind the filter", async () => {
    seed(list({ coverage: "partial", error: "upstream", next: "cur.2" }));
    await render();
    await type("nothing");
    expect($("ibx-footer")!.dataset.coverage).toBe("partial");
    expect($("ibx-more")).not.toBeNull();
    expect($("ibx-search-nomatch")).not.toBeNull();
  });

  it("makes zero requests for typing, no-match and Clear; Load more is one explicit read, its rows join the filter and nothing auto-loads", async () => {
    seed(list({ coverage: "more", next: "cur.2" }));
    await render();
    await type("fan");
    await type("zzz");
    await click($("ibx-search-clear"));
    await type("fan");
    expect(calls).toEqual([]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        const u = new URL(input);
        calls.push(`${init?.method ?? "GET"} ${u.pathname}${u.search}`);
        return json({
          accountId: ME,
          generation: GEN,
          fetchedAt: "2026-10-17T09:00:00.000Z",
          items: [
            {
              id: "c8",
              updatedAt: null,
              participants: [{ id: ME }, { id: "p8", username: "fan_three" }],
            },
            {
              id: "c9",
              updatedAt: null,
              participants: [{ id: ME }, { id: "p9", username: "someone" }],
            },
          ],
          next: null,
          coverage: "end",
        });
      }),
    );
    await click($("ibx-more"));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^GET \/social\/inbox\/conversations\?.*cursor=cur\.2/);
    expect(input().value).toBe("fan");
    expect(rows()).toEqual(["c1", "c7", "c8"]);
    expect($("ibx-search-count")!.textContent).toBe("Matching: 3 of 9 loaded");
    await act(() => new Promise((r) => setTimeout(r, 60)));
    expect(calls).toHaveLength(1);
  });

  it("resets the query when the reader identity changes: generation, account or Worker", async () => {
    seed(list());
    await render();
    const OTHER = "17841000000000009";
    const moves: [string, () => void][] = [
      ["generation", () => useInbox.setState({ account: account(GEN_B) })],
      [
        "account",
        () =>
          useInbox.setState({
            account: account(GEN, OTHER),
            lists: { [key(WORKER, OTHER)]: list() },
          }),
      ],
      [
        "worker",
        () =>
          useInbox.setState({
            origin: "https://other.test",
            lists: { [key("https://other.test")]: list() },
          }),
      ],
    ];
    for (const [name, move] of moves) {
      await act(async () => seed(list()));
      await type("fan_one");
      expect(rows(), name).toEqual(["c1"]);
      await act(async () => move());
      expect(input().value, name).toBe("");
      expect(rows(), name).toHaveLength(7);
    }
    expect(calls).toEqual([]);
  });

  it("does not bring an old query back when the identity returns (A to B to A)", async () => {
    seed(list());
    await render();
    await type("fan_one");
    await act(async () => useInbox.setState({ account: account(GEN_B) }));
    await act(async () => useInbox.setState({ account: account(GEN) }));
    expect(input().value).toBe("");
    expect(rows()).toHaveLength(7);
  });

  it("selection stays exact: opening a result selects that conversation id only", async () => {
    seed(list());
    await render();
    await type("fan_two");
    const before = JSON.stringify({ ...useInbox.getState(), lists: undefined });
    expect(useInbox.getState().conversationId).toBeNull();
    expect(JSON.stringify({ ...useInbox.getState(), lists: undefined })).toBe(before);
    await click(document.body.querySelector<HTMLElement>('[data-testid="ibx-conv"]'));
    expect(useInbox.getState().conversationId).toBe("c7");
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(calls.every((c) => c.startsWith("GET /social/inbox/conversations/c7/messages"))).toBe(
      true,
    );
  });

  it("keeps the query in memory only: not in storage, the app store, or the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    seed(list());
    await render();
    const secret = "zz-never-saved-9f3";
    await type(secret);
    expect(JSON.stringify({ ...localStorage })).not.toContain(secret);
    expect(JSON.stringify(useStore.getState())).not.toContain(secret);
    expect(JSON.stringify(useInbox.getState())).not.toContain(secret);
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain(secret);
    expect(calls).toEqual([]);
  });

  it("claims no unread, new, open or resolved state", async () => {
    seed(list());
    await render();
    await type("fan");
    expect(document.body.textContent).not.toMatch(/unread|\bnew\b|resolved|\bopen\b/i);
  });

  it("speaks Arabic with an auto-direction input and the Arabic labels", async () => {
    useStore.getState().setSettings({ lang: "ar" });
    seed(list());
    await render();
    expect(input().getAttribute("dir")).toBe("auto");
    const label = document.body.querySelector<HTMLLabelElement>(`label[for="${input().id}"]`);
    expect(label!.textContent).toBe(MESSAGE_FILES.inbox.ar["inbox.search.label"]);
    await type("العتيبي");
    expect(rows()).toEqual(["c2"]);
    expect($("ibx-search-count")!.textContent).toContain("1");
    expect($("ibx-search-clear")!.textContent).toBe(MESSAGE_FILES.inbox.ar["inbox.search.clear"]);
  });
});

describe("inbox search messages", () => {
  const { en, ar } = MESSAGE_FILES.inbox as {
    en: Record<string, string>;
    ar: Record<string, string>;
  };
  const keys = Object.keys(en).filter((k) => k.startsWith("inbox.search."));
  it("exist in English and Arabic with the same keys and placeholders", () => {
    expect(keys.length).toBeGreaterThanOrEqual(7);
    expect(
      Object.keys(ar)
        .filter((k) => k.startsWith("inbox.search."))
        .sort(),
    ).toEqual(keys.slice().sort());
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const k of keys) {
      expect(en[k], k).not.toBe("");
      expect(ar[k], k).not.toBe("");
      expect(vars(en[k]), k).toEqual(vars(ar[k]));
    }
  });
});
