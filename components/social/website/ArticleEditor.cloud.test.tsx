// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Workflow } from "@/lib/domain";
import { articleBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import ArticleEditor from "./ArticleEditor";

// ⚙️ DT-7C-3B: Mark ready routes to captureArticleReady ONLY when a registered (active proof) article-ready workflow
// has an authority on the configured Worker; otherwise the legacy setArticleStatus path is untouched. Fake hub.

const AUTH = { origin: "https://cloud.test", ownerKey: "wfo_" + "a".repeat(32) };
const fake = vi.hoisted(() => {
  const s = { regs: [] as Record<string, unknown>[], capture: null as unknown };
  const hub = {
    registrations: () => s.regs,
    captureAuthority: vi.fn(() => s.capture),
  };
  return { s, hub, cloudHub: vi.fn(() => hub) };
});
vi.mock("@/lib/cloudWorkflowHub", () => ({ cloudHub: fake.cloudHub }));

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let saved: Record<string, unknown>;
const S = () => useStore.getState();
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};
async function until(f: () => void, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    await act(() => new Promise<void>((r) => setTimeout(r, 20)));
    try {
      f();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
  }
}
async function article(): Promise<Article> {
  const r = await S().addArticle();
  if (!r.ok) throw new Error(r.reason);
  const u = await S().updateArticle(
    r.article.id,
    {
      title: { ar: "تلوين الليل", en: "Night grading" },
      summary: { ar: "ملخص", en: "Summary" },
      body: { ar: "نص", en: "Text" },
      slug: "night-grading",
    },
    articleBase(r.article),
  );
  if (!u.ok) throw new Error(u.reason);
  return u.article;
}
async function workflow(kind: Workflow["trigger"]["kind"]): Promise<Workflow> {
  const r = await S().addWorkflow({
    name: { ar: "", en: "W" },
    trigger: { kind },
    actions: [{ id: "i1", kind: "idea", text: { ar: "فكرة", en: "Idea" } }],
  });
  if (!r.ok) throw new Error(r.reason);
  return r.workflow;
}
const active = (workflowId: string) => ({ workflowId, proof: "active", state: "settled" });

async function markReady(id: string): Promise<void> {
  await act(async () => {
    S().setSettings({ lang: "en" });
    root.render(createElement(ArticleEditor, { id, onBack: () => undefined }));
  });
  await until(() => expect(($("website-ready") as HTMLButtonElement).disabled).toBe(false));
  await act(async () => $("website-ready")!.click());
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  fetchSpy = vi.spyOn(globalThis, "fetch");
  localStorage.clear();
  S().reset();
  setArticlesLock(queueLock());
  saved = { captureArticleReady: S().captureArticleReady, setArticleStatus: S().setArticleStatus };
  fake.s.regs = [];
  fake.s.capture = null;
  fake.hub.captureAuthority.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(fetchSpy).not.toHaveBeenCalled();
  useStore.setState(saved);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setArticlesLock(undefined);
  S().setSettings({ lang: "ar" });
});

describe("Mark ready routing", () => {
  it("a registered article-ready workflow → one captureArticleReady(id, {authority}); no setArticleStatus", async () => {
    const a = await article();
    const w = await workflow("article-ready");
    fake.s.regs = [active(w.id)];
    fake.s.capture = AUTH;
    const legacy = vi.fn();
    const capture = vi.fn(async () => ({
      kind: "ready",
      article: { ...a, status: "ready" },
      runs: [],
      entries: [{ key: "e1" }],
    }));
    useStore.setState({ captureArticleReady: capture as never, setArticleStatus: legacy as never });
    await markReady(a.id);
    await until(() => expect(capture).toHaveBeenCalledTimes(1));
    expect(capture).toHaveBeenCalledWith(a.id, { authority: AUTH });
    expect(legacy).not.toHaveBeenCalled();
    expect(fake.hub.captureAuthority).toHaveBeenCalledWith(w.id);
    await until(() =>
      expect($("website-ready-cloud-captured")!.textContent).toBe(
        "Marked ready, and 1 cloud run(s) were saved. Send them from Workflows.",
      ),
    );
  });

  it("refusals render their copy, call the capture once with the authority and never the legacy path", async () => {
    const a = await article();
    const w = await workflow("article-ready");
    fake.s.regs = [active(w.id)];
    fake.s.capture = AUTH;
    for (const [reason, copy] of [
      ["blocked", "we can't prove who runs one of the workflows"],
      ["authority-mismatch", "registered with another worker"],
      ["too-large", "bigger than the cloud limits"],
      ["stale", "something changed meanwhile"],
      ["issues", "the article has notes to fix first"],
    ] as const) {
      const capture = vi.fn(async () => ({ kind: "refused", reason }));
      const legacy = vi.fn();
      useStore.setState({
        captureArticleReady: capture as never,
        setArticleStatus: legacy as never,
      });
      await markReady(a.id);
      await until(() =>
        expect($("website-ready-cloud-refused")!.textContent!.toLowerCase()).toContain(copy),
      );
      expect(capture.mock.calls).toEqual([[a.id, { authority: AUTH }]]);
      expect(legacy).not.toHaveBeenCalled();
      expect(S().articles.find((x) => x.id === a.id)!.status).toBe("draft");
    }
  });

  it("a cloud 'missing' marks the article gone like the legacy path; the cloud note clears on the next edit", async () => {
    const a = await article();
    const w = await workflow("article-ready");
    fake.s.regs = [active(w.id)];
    fake.s.capture = AUTH;
    useStore.setState({
      captureArticleReady: (async () => ({ kind: "refused", reason: "stale" })) as never,
    });
    await markReady(a.id);
    await until(() => expect($("website-ready-cloud-refused")).not.toBeNull());
    const el = $("website-title") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(el, "New title");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect($("website-ready-cloud-refused")).toBeNull();
    await until(() => expect($("website-save-status")!.dataset.state).toBe("saved"));
    await until(() => expect(($("website-ready") as HTMLButtonElement).disabled).toBe(false));
    // A reset removed the article while the capture prepared: the store refuses "missing".
    useStore.setState({
      captureArticleReady: (async () => {
        await S().reset();
        return { kind: "refused", reason: "missing" };
      }) as never,
    });
    await act(async () => $("website-ready")!.click());
    await until(() => expect($("website-gone")).not.toBeNull());
    expect($("website-ready-cloud-refused")).toBeNull();
  });

  it("no registration, a manual registered workflow, or no authority → the legacy path", async () => {
    const a = await article();
    const manual = await workflow("manual");
    const ready = await workflow("article-ready");
    const capture = vi.fn();
    useStore.setState({ captureArticleReady: capture as never });
    // A manual workflow on the cloud does not route Mark ready.
    fake.s.regs = [active(manual.id), { ...active(ready.id), proof: "unregistered" }];
    fake.s.capture = AUTH;
    await markReady(a.id);
    await until(() => expect(S().articles.find((x) => x.id === a.id)!.status).toBe("ready"));
    expect(capture).not.toHaveBeenCalled();
  });

  it("an active article-ready registration without an authority here keeps the legacy path", async () => {
    const a = await article();
    const w = await workflow("article-ready");
    fake.s.regs = [active(w.id)];
    fake.s.capture = null;
    const capture = vi.fn();
    const legacy = vi.fn(async () => ({ ok: false, reason: "workflow-not-local" }));
    useStore.setState({ captureArticleReady: capture as never, setArticleStatus: legacy as never });
    await markReady(a.id);
    await until(() => expect(legacy).toHaveBeenCalledWith(a.id, "ready"));
    expect(capture).not.toHaveBeenCalled();
    await until(() => expect($("website-ready-blocked")).not.toBeNull());
  });
});
