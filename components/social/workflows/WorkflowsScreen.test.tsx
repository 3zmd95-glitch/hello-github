// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow } from "@/lib/domain";
import {
  STORAGE_KEY,
  articleBase,
  setArticlesLock,
  setWorkflowFault,
  useStore,
  workflowBase,
  type ArticlesLock,
} from "@/store";
import { unsavedWorkflowDrafts } from "./WorkflowEditor";
import WorkflowsScreen from "./WorkflowsScreen";

// ⚙️ Workflows (packet DT-4): honest "this browser only" copy, create → editor by hash, add / reorder / remove steps
// with autosave, a dry run that writes nothing, Run now with output links, Retry on a partial run, pause, conflicts,
// and the queued runs a mount continues. No network.

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;

const S = () => useStore.getState();
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const $$ = (testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const SKILL = "smart-bins-keywords";

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};

const manual: Workflow["actions"] = [
  { id: "i1", kind: "idea", text: { ar: "فكرة {date}", en: "Idea {date}" } },
  {
    id: "p1",
    kind: "post",
    platform: "tiktok",
    title: { ar: "مقطع {date}", en: "Clip {date}" },
    caption: { ar: "", en: "" },
    offsetDays: 1,
  },
  { id: "q1", kind: "plan", quest: "produce", skillId: SKILL, minutes: 30, day: "lightest" },
];

async function create(actions = manual): Promise<Workflow> {
  const r = await S().addWorkflow({ name: { ar: "يومي", en: "Daily" }, actions });
  if (!r.ok) throw new Error(r.reason);
  return r.workflow;
}

async function mount(lang: "ar" | "en" = "ar", hash = ""): Promise<void> {
  history.replaceState(null, "", `/social/workflows/${hash}`);
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(WorkflowsScreen));
  });
}

async function type(testId: string, value: string): Promise<void> {
  const el = $(testId) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(testId: string, index = 0): Promise<void> {
  await act(async () => $$(testId)[index]!.click());
}

/** Poll with real timers; each tick renders outside a held act scope. */
async function until(fn: () => void, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout;
  for (;;) {
    await act(() => new Promise<void>((r) => setTimeout(r, 20)));
    try {
      fn();
      return;
    } catch (e) {
      if (Date.now() > end) throw e;
    }
  }
}

const kinds = () => $$("workflows-action").map((a) => a.dataset.kind);

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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setArticlesLock(undefined);
  setWorkflowFault(undefined);
  S().setSettings({ lang: "ar" });
});

describe("WorkflowsScreen", () => {
  it("says runs stay in this browser, in Arabic and English, with an empty state", async () => {
    await mount();
    expect($("workflows-local-only")!.textContent).toContain("المتصفح مفتوح");
    expect($("workflows-empty")).not.toBeNull();
    await mount("en");
    expect($("workflows-local-only")!.textContent).toBe(
      "Runs only while this browser is open on this device. Nothing is scheduled in the cloud; nothing is posted and no one is replied to.",
    );
    expect(host.querySelector("h1")!.textContent).toBe("Workflows");
  });

  it("creates a workflow and opens its editor through the #w= hash, then lists it", async () => {
    await mount("en");
    await click("workflows-new");
    await until(() => expect($("workflow-editor")).not.toBeNull());
    const id = S().workflows[0].id;
    expect(location.hash).toBe(`#w=${id}`);
    await click("workflows-back");
    await until(() => expect($("workflow-editor")).toBeNull());
    expect($$("workflows-row").map((r) => r.dataset.id)).toEqual([id]);
    expect($("workflows-row")!.textContent).toContain("Manual");
    expect($("workflows-row")!.textContent).toContain("Never run");
  });

  it("adds, reorders and removes steps, and autosaves them", async () => {
    const w = await create([manual[0]]);
    await mount("ar", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await click("workflows-add-post");
    expect(kinds()).toEqual(["idea", "post"]);
    // The visible steps label shows the count (never the raw placeholder).
    expect(host.textContent).toContain("الخطوات (2 من ٥)");
    expect(host.textContent).not.toContain("{count}");
    await click("workflows-action-up", 1);
    expect(kinds()).toEqual(["post", "idea"]);
    await click("workflows-action-remove", 0);
    expect(kinds()).toEqual(["idea"]);
    await click("workflows-add-plan");
    await type("workflows-name-en", "Daily chain");
    await until(() => expect($("workflows-save-status")!.dataset.state).toBe("saved"));
    const saved = S().workflows[0];
    expect(saved.name.en).toBe("Daily chain");
    expect(saved.actions.map((a) => a.kind)).toEqual(["idea", "plan"]);
    expect(new Set(saved.actions.map((a) => a.id)).size).toBe(2);
    // Five steps at most.
    for (let n = 0; n < 3; n++) await click("workflows-add-idea");
    expect(kinds()).toHaveLength(5);
    expect(($("workflows-add-idea") as HTMLButtonElement).disabled).toBe(true);
  });

  it("previews three outputs and writes nothing", async () => {
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await S().drainWorkflowRuns(); // the mount's own drain has finished
    const set = vi.spyOn(Storage.prototype, "setItem");
    const get = vi.spyOn(Storage.prototype, "getItem");
    await click("workflows-preview");
    const items = $$("workflows-preview-item");
    expect(items.map((i) => i.dataset.kind)).toEqual(["idea", "post", "plan"]);
    expect(items[0].textContent).toMatch(/Idea \d{4}-\d{2}-\d{2}/);
    expect($("workflows-preview-panel")!.textContent).toContain("nothing was saved or sent");
    expect(set).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(S().ideas).toEqual([]);
  });

  it("runs now and lists the run with links to the idea, the post and the planner", async () => {
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await click("workflows-run");
    await until(() => expect($("workflows-run-row")?.dataset.status).toBe("done"));
    const links = $$("workflows-output-link");
    expect(links.map((l) => l.dataset.kind)).toEqual(["idea", "post", "plan"]);
    const post = S().posts[0];
    expect(links[0].getAttribute("href")).toMatch(/^\/social\/ideas\/?$/);
    // Next drops the trailing slash in jsdom; the static export keeps it (the e2e checks the real URL).
    expect(links[1].getAttribute("href")!.replace("/social/calendar/#", "/social/calendar#")).toBe(
      `/social/calendar#post=${encodeURIComponent(post.id)}`,
    );
    // Amendment E: the planner opens the run's own week.
    const week = S().planItems[0].week;
    expect(links[2].getAttribute("href")).toMatch(new RegExp(`^/planner/?#week=${week}$`));
    expect($("workflows-retry")).toBeNull();
  });

  it("offers Retry on a partial run, and the retry completes it once", async () => {
    setWorkflowFault((r, action) => (action.id === "p1" && r.attempt === 1 ? "boom" : undefined));
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await click("workflows-run");
    await until(() => expect($("workflows-run-row")?.dataset.status).toBe("partial"));
    expect($("workflows-run-row")!.textContent).toContain("Failed: boom");
    await click("workflows-retry");
    await until(() => expect($("workflows-run-row")?.dataset.status).toBe("done"));
    expect($("workflows-run-row")!.textContent).toContain("Attempt 2");
    expect(S().posts).toHaveLength(1);
    expect(S().ideas).toHaveLength(1);
  });

  it("refuses Run now honestly for a workflow that is not provably local (DT-7C-2B-3); nothing runs", async () => {
    const w = await create();
    // Cloud registration evidence this device cannot read: never treated as "local".
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.cloudRegistrations = { v: 1, broken: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await click("workflows-run");
    await until(() => expect($("workflows-run-error")).not.toBeNull());
    expect($("workflows-run-error")!.textContent).toContain("won't run on this device");
    expect(S().workflowRuns).toEqual([]);
    expect(S().ideas).toEqual([]);
  });

  it("disables Run now while paused and says why", async () => {
    const w = await create();
    await mount("ar", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    expect(($("workflows-run") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => ($("workflows-enabled") as HTMLInputElement).click());
    await until(() => expect(S().workflows[0].enabled).toBe(false));
    expect(($("workflows-run") as HTMLButtonElement).disabled).toBe(true);
    expect($("workflows-paused-note")!.textContent).toContain("موقّفة");
  });

  it("disables Run now while the workflow has issues and lists them", async () => {
    const w = await create([
      { id: "q1", kind: "plan", quest: "produce", minutes: 30, day: "lightest" },
    ]);
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    expect(($("workflows-run") as HTMLButtonElement).disabled).toBe(true);
    expect($("workflows-issues")!.textContent).toContain("Pick a skill");
  });

  it("keeps the owner's text and shows a conflict when another tab saved first", async () => {
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await type("workflows-name-en", "Mine");
    // Another tab commits before this editor's autosave.
    await act(async () => {
      await S().updateWorkflow(w.id, { name: { ar: "ثاني", en: "Theirs" } }, workflowBase(w));
    });
    await until(() => expect($("workflows-conflict")).not.toBeNull());
    expect(($("workflows-name-en") as HTMLInputElement).value).toBe("Mine");
    await act(() => new Promise<void>((r) => setTimeout(r, 500)));
    expect(S().workflows[0].name.en).toBe("Theirs");
    await click("workflows-reload");
    expect(($("workflows-name-en") as HTMLInputElement).value).toBe("Theirs");
    expect($("workflows-conflict")).toBeNull();
  });

  it("continues queued runs when the screen opens", async () => {
    const w = await create();
    const r = await S().runWorkflowNow(w.id, {});
    if (!r.ok) throw new Error(r.reason);
    expect(S().workflowRuns[0].status).toBe("queued");
    await mount("en");
    await until(() => expect(S().workflowRuns[0].status).toBe("done"));
    await until(() => expect($("workflows-row")!.textContent).toContain("Last run: Done"));
  });

  it("runs an article-ready workflow now on a chosen article, and says when there is none (Amendment C)", async () => {
    const r = await S().addWorkflow({
      name: { ar: "بعد المقال", en: "After" },
      trigger: { kind: "article-ready" },
      actions: [
        {
          id: "p1",
          kind: "post",
          platform: "tiktok",
          title: { ar: "{title}", en: "Post: {title}" },
          caption: { ar: "", en: "" },
          offsetDays: 1,
        },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    await mount("en", `#w=${r.workflow.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    expect(($("workflows-run") as HTMLButtonElement).disabled).toBe(true);
    expect($("workflows-needs-article")).not.toBeNull();

    const a = await S().addArticle();
    if (!a.ok) throw new Error(a.reason);
    const u = await S().updateArticle(
      a.article.id,
      {
        title: { ar: "تلوين", en: "Grading" },
        body: { ar: "نص", en: "Text" },
        slug: "grading",
      },
      articleBase(a.article),
    );
    if (!u.ok) throw new Error(u.reason);
    await until(() =>
      expect(($("workflows-run-article") as HTMLSelectElement).value).toBe(a.article.id),
    );
    expect($("workflows-needs-article")).toBeNull();
    await click("workflows-run");
    await until(() => expect($("workflows-run-row")?.dataset.status).toBe("done"));
    expect(S().posts[0].title).toBe("Post: Grading");
  });

  it("shows Resume for a run a storage failure stopped, and resumes it once (Amendment C)", async () => {
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    await S().drainWorkflowRuns();
    const real = Storage.prototype.setItem;
    let writes = 0;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      // Run now and step one land; step two hits a full storage.
      if (k === STORAGE_KEY && ++writes === 3) throw new DOMException("full", "QuotaExceededError");
      real.call(this, k, v);
    });
    await click("workflows-run");
    await until(() => expect($("workflows-resume")).not.toBeNull());
    expect($("workflows-run-row")!.dataset.status).toBe("running");
    expect($("workflows-retry")).toBeNull();
    vi.restoreAllMocks();
    fetchSpy = vi.spyOn(globalThis, "fetch");
    await click("workflows-resume");
    await until(() => expect($("workflows-run-row")?.dataset.status).toBe("done"));
    expect(S().workflowRuns).toHaveLength(1);
    expect(S().ideas).toHaveLength(1);
    expect(S().posts).toHaveLength(1);
    expect($("workflows-resume")).toBeNull();
  });
});

describe("unsaved workflow drafts (Amendment D)", () => {
  /** A lock that waits for `release()` before each holder runs. */
  function holdLock() {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const queue = queueLock();
    setArticlesLock((fn) => queue(async () => (await held, fn())));
    return () => release();
  }
  const leave = () => act(async () => root.render(createElement("div")));
  const name = () => ($("workflows-name-en") as HTMLInputElement).value;

  afterEach(() => unsavedWorkflowDrafts.setState({ drafts: {} }, true));

  it("stashes the latest draft synchronously on unmount and offers it on an immediate reopen", async () => {
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    const release = holdLock();
    await type("workflows-name-en", "Text B");
    await leave();
    expect(unsavedWorkflowDrafts.getState().drafts[w.id]?.fields.name.en).toBe("Text B");
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflows-unsaved-prompt")).not.toBeNull());
    expect(name()).toBe("Daily");
    await click("workflows-unsaved-restore");
    expect(name()).toBe("Text B");
    release();
    await until(() => expect(S().workflows[0].name.en).toBe("Text B"));
    await until(() => expect($("workflows-save-status")!.dataset.state).not.toBe("saving"));
    expect($("workflows-conflict")).toBeNull();
    expect(unsavedWorkflowDrafts.getState().drafts[w.id]).toBeUndefined();
  });

  it("clears the stash and the prompt when the closed editor's save lands", async () => {
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    const release = holdLock();
    await type("workflows-name-en", "Landed");
    await leave();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflows-unsaved-prompt")).not.toBeNull());
    release();
    await until(() => expect($("workflows-unsaved-prompt")).toBeNull());
    expect(name()).toBe("Landed");
    expect(unsavedWorkflowDrafts.getState().drafts[w.id]).toBeUndefined();
  });

  it("never lets an older pending save remove a newer stash", async () => {
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    const release = holdLock();
    await type("workflows-name-en", "Older A");
    await leave();
    const first = unsavedWorkflowDrafts.getState().drafts[w.id]!.token;
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflows-unsaved-prompt")).not.toBeNull());
    await click("workflows-unsaved-restore");
    await type("workflows-name-en", "Newer B");
    await leave();
    const second = unsavedWorkflowDrafts.getState().drafts[w.id]!;
    expect(second.token).toBeGreaterThan(first);
    release();
    await until(() => expect(S().workflows[0].name.en).toBe("Older A"));
    await act(() => new Promise<void>((r) => setTimeout(r, 100)));
    const kept = unsavedWorkflowDrafts.getState().drafts[w.id]!;
    expect(kept.token).toBe(second.token);
    expect(kept.fields.name.en).toBe("Newer B");
    // The list marks it.
    await mount("en");
    await until(() => expect($("workflows-unsaved-chip")).not.toBeNull());
  });

  it("keeps the unload guard after the screen unmounts while a stash exists", async () => {
    const w = await create();
    await mount("en", `#w=${w.id}`);
    await until(() => expect($("workflow-editor")).not.toBeNull());
    holdLock();
    await type("workflows-name-en", "Guarded");
    await leave();
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(true);
    unsavedWorkflowDrafts.setState({ drafts: {} }, true);
    expect(unload()).toBe(false);
  });
});
