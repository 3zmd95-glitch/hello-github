// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@/lib/domain";
import { STORAGE_KEY, articleBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import ArticleEditor, { toDraft, unsavedDrafts } from "./ArticleEditor";

// 🌐 Website CMS editor (packet DT-3 + Amendments A–C), rendered for real in jsdom: autosave with a read-back "saved",
// honest failure states that keep the text, conflicts instead of overwrites, pending text flushed before actions,
// a safe preview and portable downloads. Nothing reaches the network.

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let blobs: Blob[];
let lastDownloadName = "";
const onBack = vi.fn();

const S = () => useStore.getState();
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const article = (id: string) => S().articles.find((a) => a.id === id)!;
const saveState = () => $("website-save-status")?.dataset.state;

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};

async function create(over: Partial<Article> = {}): Promise<Article> {
  const r = await S().addArticle();
  if (!r.ok) throw new Error(r.reason);
  if (Object.keys(over).length === 0) return r.article;
  const u = await S().updateArticle(r.article.id, over, articleBase(r.article));
  if (!u.ok) throw new Error(u.reason);
  return u.article;
}

const COMPLETE = {
  title: { ar: "تلوين الليل", en: "Night grading" },
  summary: { ar: "ملخص", en: "Summary" },
  body: { ar: "## مقدمة\n\nنص عربي", en: "## Intro\n\nEnglish text" },
  slug: "night-grading",
};

async function mount(id: string, lang: "ar" | "en" = "ar"): Promise<void> {
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(ArticleEditor, { id, onBack }));
  });
}

async function type(testId: string, value: string): Promise<void> {
  const el = $(testId) as HTMLInputElement | HTMLTextAreaElement;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(testId: string): Promise<void> {
  const el = $(testId);
  if (!el) throw new Error(`no ${testId}`);
  await act(async () => el.click());
}

/** Wait (real timers) until the autosave or an action settles; each tick renders outside a held act scope. */
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

/** Another tab's commit, written to storage only (its storage event not delivered yet). */
function otherTab(id: string, patch: Partial<Article>): void {
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  raw.state.articles = raw.state.articles.map((a: Article) =>
    a.id === id ? { ...a, ...patch, commitId: "tab-2", revision: a.revision + 1 } : a,
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
}

/** Hold the injected article lock (as another page would); count the saves that queue behind it. */
function holdLock(): { release: () => Promise<void>; waiting: () => number } {
  let open!: () => void;
  const held = new Promise<void>((r) => (open = r));
  const queue = queueLock();
  let waiting = 0;
  setArticlesLock((fn) => {
    waiting += 1;
    return queue(async () => {
      await held;
      return fn();
    });
  });
  return { release: () => act(async () => open()), waiting: () => waiting };
}

const unloadBlocked = () => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
};

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
  blobs = [];
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: (b: Blob) => {
        blobs.push(b);
        return "blob:test";
      },
      revokeObjectURL: () => {},
    }),
  );
  localStorage.clear();
  S().reset();
  setArticlesLock(queueLock());
  onBack.mockClear();
  unsavedDrafts.setState({ drafts: {} });
  lastDownloadName = "";
  const click = HTMLAnchorElement.prototype.click;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    if (this.download) lastDownloadName = this.download;
    else click.call(this);
  });
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
  S().setSettings({ lang: "ar" });
});

describe("ArticleEditor", () => {
  it("autosaves and says saved only after reading the commit back from storage", async () => {
    const a = await create();
    await mount(a.id);
    await type("website-title", "عنوان جديد");
    expect(saveState()).toBe("saving");
    await until(() => expect(saveState()).toBe("saved"));
    expect($("website-save-status")!.textContent).toContain("✓");
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.articles[0];
    expect(stored.title.ar).toBe("عنوان جديد");
    expect(stored.commitId).toBe(article(a.id).commitId);
  });

  it("says not saved when the browser drops the write, and keeps the text", async () => {
    const a = await create();
    await mount(a.id, "en");
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k !== STORAGE_KEY) real.call(this, k, v);
    });
    await type("website-body", "Kept on screen");
    await until(() => expect(saveState()).toBe("notPersisted"));
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Kept on screen");
    expect($("website-save-error")!.textContent).toMatch(/Not kept/);
  });

  it("keeps its base after a quota failure, so a plain retry lands once space is free (Amendment D)", async () => {
    const a = await create();
    await mount(a.id, "en");
    const real = Storage.prototype.setItem;
    let fail = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === STORAGE_KEY && fail) {
        fail = false;
        throw new DOMException("full", "QuotaExceededError");
      }
      real.call(this, k, v);
    });
    await type("website-body", "First try");
    await until(() => expect(saveState()).toBe("notPersisted"));
    expect(article(a.id)).toEqual(a); // memory rolled back to what storage holds
    await type("website-body", "First try, again");
    await until(() => expect(saveState()).toBe("saved"));
    expect(article(a.id).body.en).toBe("First try, again");
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.articles[0].body.en).toBe(
      "First try, again",
    );
  });

  it("shows a recoverable state without Web Locks and keeps the text (Amendment C.1)", async () => {
    const a = await create();
    await mount(a.id, "en");
    setArticlesLock(null);
    await type("website-body", "No lock here");
    await until(() => expect(saveState()).toBe("unsupported"));
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("No lock here");
    expect(article(a.id).body.en).toBe("");
  });

  it("rejects a write when another tab committed first, then offers Load latest / Keep mine (Amendment B)", async () => {
    const a = await create();
    await mount(a.id, "en");
    otherTab(a.id, { body: { ar: "", en: "From the other tab" } });
    await type("website-body", "Mine");
    await until(() => expect(saveState()).toBe("conflict"));
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Mine");
    // The store rehydrated what the other tab wrote; nothing of mine was written.
    await until(() => expect(article(a.id).body.en).toBe("From the other tab"));
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY }));
    expect($("website-load-latest")).not.toBeNull();
    await click("website-keep-mine");
    await until(() => expect(saveState()).toBe("saved"));
    expect(article(a.id).body.en).toBe("Mine");
  });

  it("loads the latest version on request", async () => {
    const a = await create();
    await mount(a.id, "en");
    await type("website-body", "Mine");
    otherTab(a.id, { body: { ar: "", en: "Theirs" } });
    await act(() => useStore.persist.rehydrate());
    await until(() => expect(saveState()).toBe("conflict"));
    await click("website-load-latest");
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Theirs");
    expect(saveState()).toBe("idle");
  });

  it("invalidates pending text after an import of the same file (ABA) and keeps it on screen", async () => {
    const a = await create();
    await mount(a.id, "en");
    const json = S().exportState();
    await type("website-body", "Pending");
    await act(async () => S().importState(json));
    await until(() => expect(saveState()).toBe("conflict"));
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Pending");
    expect(article(a.id).body.en).toBe("");
  });

  it("keeps Mark ready disabled while issues exist and enables it once fixed", async () => {
    const a = await create();
    await mount(a.id, "en");
    const ready = $("website-ready") as HTMLButtonElement;
    expect(ready.disabled).toBe(true);
    expect(ready.title).toBe("The Arabic title is missing");
    const codes = () =>
      [...host.querySelectorAll<HTMLElement>('[data-testid="website-issue"]')].map(
        (i) => i.dataset.code,
      );
    expect(codes()).toEqual(["title-ar", "title-en", "body-ar", "body-en", "slug-empty"]);
    await click("website-lang-ar");
    await type("website-title", COMPLETE.title.ar);
    await type("website-body", COMPLETE.body.ar);
    await click("website-lang-en");
    await type("website-title", COMPLETE.title.en);
    await type("website-body", COMPLETE.body.en);
    await click("website-slug-suggest");
    expect(($("website-slug") as HTMLInputElement).value).toBe("night-grading");
    expect(codes()).toEqual([]);
    await click("website-ready");
    await until(() => expect(article(a.id).status).toBe("ready"));
    expect($("website-status")!.textContent).toBe("Ready");
    expect($("website-ready-note")!.textContent).toMatch(/not published/);
    expect($("website-local-only")!.textContent).toMatch(/nothing is public/);
  });

  it("refuses Ready honestly when a Ready workflow is not provably local (DT-7C-2B-3): no conflict, still a draft", async () => {
    const w = await S().addWorkflow({
      name: { ar: "", en: "On ready" },
      trigger: { kind: "article-ready" },
      actions: [{ id: "i1", kind: "idea", text: { ar: "", en: "Read {title}" } }],
    });
    if (!w.ok) throw new Error(w.reason);
    const a = await create(COMPLETE);
    // Cloud registration evidence this device cannot read: never treated as "local".
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.state.cloudRegistrations = { v: 1, broken: true };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
    await mount(a.id, "ar");
    await click("website-ready");
    await until(() => expect($("website-ready-blocked")).not.toBeNull());
    expect($("website-ready-blocked")!.textContent).toContain("ما تعلّمت جاهزة");
    expect($("website-conflict")).toBeNull();
    expect(article(a.id).status).toBe("draft");
    expect(S().workflowRuns).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("blocks ready for a body with device-only media (Amendment A)", async () => {
    const a = await create({ ...COMPLETE, body: { ar: "![x](img:abc)", en: "ok" } });
    await mount(a.id, "en");
    const issue = host.querySelector<HTMLElement>('[data-code="body-device-media"]')!;
    expect(issue.textContent).toMatch(/Arabic text has a picture from this device/);
    expect(($("website-ready") as HTMLButtonElement).disabled).toBe(true);
  });

  it("flushes the last sentence before archiving, and restore shows it (Amendment A)", async () => {
    const a = await create(COMPLETE);
    await mount(a.id, "en");
    await type("website-body", "## Intro\n\nEnglish text. The last sentence.");
    await click("website-archive"); // before the autosave timer
    await until(() => expect(article(a.id).status).toBe("archived"));
    expect(article(a.id).body.en).toContain("The last sentence.");
    expect($("website-body")!.matches(":disabled")).toBe(true);
    await click("website-restore");
    await until(() => expect(article(a.id).status).toBe("draft"));
    expect(($("website-body") as HTMLTextAreaElement).value).toContain("The last sentence.");
  });

  it("stops archiving on a conflict and keeps the text (Amendment A)", async () => {
    const a = await create(COMPLETE);
    await mount(a.id, "en");
    await type("website-body", "Unsaved words");
    otherTab(a.id, { body: { ar: "x", en: "elsewhere" } });
    await click("website-archive");
    await until(() => expect(saveState()).toBe("conflict"));
    expect(article(a.id).status).toBe("draft");
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Unsaved words");
  });

  it("names the clashing article on restore and restores with a new slug (Amendment C)", async () => {
    const a = await create(COMPLETE);
    await S().setArticleStatus(a.id, "archived");
    await create({ ...COMPLETE, title: { ar: "ثاني", en: "Second" } });
    await mount(a.id, "en");
    await click("website-restore");
    await until(() => expect($("website-restore-conflict")).not.toBeNull());
    expect($("website-restore-conflict")!.textContent).toContain("Second");
    expect(article(a.id).status).toBe("archived");
    await click("website-restore-newslug");
    await until(() => expect(article(a.id).status).toBe("draft"));
    expect(article(a.id).slug).toBe("night-grading-2");
    expect(($("website-slug") as HTMLInputElement).value).toBe("night-grading-2");
  });

  it("previews headings and lists but no raw HTML, device images or javascript links", async () => {
    const a = await create({
      body: {
        ar: "",
        en: "## Heading\n\n- one\n- two\n\n<b>raw</b><script>alert(1)</script>\n\n![dev](img:abc) ![ok](https://x.test/a.png)\n\n[bad](javascript:alert(1)) [good](https://x.test)",
      },
    });
    await mount(a.id, "en");
    await click("website-preview");
    const pane = $("article-preview")!;
    expect(pane.querySelector("h2")!.textContent).toBe("Heading");
    expect(pane.querySelectorAll("li")).toHaveLength(2);
    expect(pane.querySelector("b, script")).toBeNull();
    const imgs = [...pane.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(imgs).toEqual(["https://x.test/a.png"]);
    const links = [...pane.querySelectorAll("a")];
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["https://x.test"]);
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(pane.textContent).toContain("bad");
  });

  it("downloads each language as Markdown with front matter and the source body", async () => {
    const a = await create(COMPLETE);
    await mount(a.id, "en");
    await type("website-body", "## Intro\n\nFresh text");
    await click("website-download-en");
    await until(() => expect(blobs).toHaveLength(1));
    const md = await blobs[0].text();
    expect(md).toContain('slug: "night-grading"');
    expect(md).toContain('lang: "en"');
    expect(md).toContain("Fresh text");
    await click("website-download-ar");
    await until(() => expect(blobs).toHaveLength(2));
    expect(await blobs[1].text()).toContain("نص عربي");
  });

  it("keeps the text when the storage probe fails, and does not advance its base (Amendment E)", async () => {
    const a = await create();
    await mount(a.id, "en");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await type("website-body", "Probe failed");
    await until(() => expect(saveState()).toBe("notPersisted"));
    expect(article(a.id)).toEqual(a);
    await act(() => useStore.persist.rehydrate());
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Probe failed");
    await click("website-back");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("locks the fields while an action is pending, so no later text is overwritten (Amendment E)", async () => {
    const a = await create(COMPLETE);
    await mount(a.id, "en");
    await type("website-body", "Text A");
    await until(() => expect(saveState()).toBe("saved"));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const queue = queueLock();
    setArticlesLock((fn) =>
      queue(async () => {
        await held;
        return fn();
      }),
    );
    await click("website-archive");
    const body = $("website-body") as HTMLTextAreaElement;
    expect(body.readOnly).toBe(true);
    expect($("article-editor")!.getAttribute("aria-busy")).toBe("true");
    expect(($("website-archive") as HTMLButtonElement).disabled).toBe(true);
    await type("website-body", "Text B typed during the action");
    expect(body.value).toBe("Text A");
    release();
    await until(() => expect(article(a.id).status).toBe("archived"));
    expect(article(a.id).body.en).toBe("Text A");
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Text A");
    expect($("article-editor")!.getAttribute("aria-busy")).toBe("false");
  });

  it("stashes a draft that could not be saved on unmount and offers it on reopening (Amendment E)", async () => {
    const a = await create();
    await mount(a.id, "en");
    otherTab(a.id, { body: { ar: "", en: "Theirs" } });
    await type("website-body", "The lost sentence.");
    await until(() => expect(saveState()).toBe("conflict"));
    await act(async () => root.render(createElement("div")));
    await until(() => expect(unsavedDrafts.getState().drafts[a.id]).toBeDefined());
    expect(unsavedDrafts.getState().drafts[a.id].reason).toBe("conflict");
    await mount(a.id, "en");
    expect($("website-unsaved-prompt")).not.toBeNull();
    await click("website-unsaved-restore");
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("The lost sentence.");
    expect(unsavedDrafts.getState().drafts[a.id]).toBeUndefined();
  });

  it("stashes the latest text synchronously on unmount while a save waits for the lock (repair 1)", async () => {
    const a = await create();
    await mount(a.id, "en");
    const lock = holdLock();
    await type("website-body", "Text A");
    await until(() => expect(lock.waiting()).toBe(1));
    await type("website-body", "Text B");
    await act(async () => root.render(createElement("div")));
    expect(unsavedDrafts.getState().drafts[a.id]?.fields.body.en).toBe("Text B");
    expect(unloadBlocked()).toBe(true);
    await mount(a.id, "en");
    expect($("website-unsaved-prompt")).not.toBeNull();
    await click("website-unsaved-restore");
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Text B");
    await lock.release();
    await until(() => expect(article(a.id).body.en).toBe("Text B"));
    await until(() => expect(saveState()).not.toBe("saving"));
    expect(saveState()).not.toBe("conflict");
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Text B");
    expect(unsavedDrafts.getState().drafts[a.id]).toBeUndefined();
  });

  it("clears the stash and the prompt when the closed editor's save lands, and shows the stored text (repair 1)", async () => {
    const a = await create();
    await mount(a.id, "en");
    const lock = holdLock();
    await type("website-body", "Saved after leaving");
    await until(() => expect(lock.waiting()).toBe(1));
    await act(async () => root.render(createElement("div")));
    await mount(a.id, "en");
    expect($("website-unsaved-prompt")).not.toBeNull();
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("");
    await lock.release();
    await until(() => expect($("website-unsaved-prompt")).toBeNull());
    expect(unsavedDrafts.getState().drafts[a.id]).toBeUndefined();
    expect(article(a.id).body.en).toBe("Saved after leaving");
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Saved after leaving");
    expect(unloadBlocked()).toBe(false);
  });

  it("never lets an older pending save remove a newer stash (repair 1)", async () => {
    const a = await create();
    await mount(a.id, "en");
    const lock = holdLock();
    await type("website-body", "Older A");
    await until(() => expect(lock.waiting()).toBe(1));
    await act(async () => root.render(createElement("div")));
    const older = unsavedDrafts.getState().drafts[a.id];
    await mount(a.id, "en");
    await click("website-unsaved-restore");
    await type("website-body", "Newer B");
    await act(async () => root.render(createElement("div")));
    const newer = unsavedDrafts.getState().drafts[a.id];
    expect(newer.fields.body.en).toBe("Newer B");
    expect(newer.token).toBeGreaterThan(older.token);
    await lock.release();
    await until(() => expect(article(a.id).body.en).toBe("Older A"));
    await until(() => expect(unsavedDrafts.getState().drafts[a.id]?.reason).toBe("conflict"));
    expect(unsavedDrafts.getState().drafts[a.id].fields.body.en).toBe("Newer B");
    expect(unsavedDrafts.getState().drafts[a.id].token).toBe(newer.token);
  });

  it("discards a stashed draft on request", async () => {
    const a = await create();
    unsavedDrafts.setState({
      drafts: {
        [a.id]: {
          fields: { ...toDraft(a), body: { ar: "", en: "Stashed" } },
          base: articleBase(a),
          reason: "conflict",
          at: "2026-10-16T12:00:00.000Z",
          token: 0,
        },
      },
    });
    await mount(a.id, "en");
    await click("website-unsaved-discard");
    expect($("website-unsaved-prompt")).toBeNull();
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("");
    expect(unsavedDrafts.getState().drafts[a.id]).toBeUndefined();
  });

  it("guards unload only while there is unsaved text (Amendment E)", async () => {
    const a = await create();
    await mount(a.id, "en");
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await type("website-body", "Typing");
    expect(unload()).toBe(true);
    await until(() => expect(saveState()).toBe("saved"));
    expect(unload()).toBe(false);
  });

  it("downloads the current text with an -unsaved name when the save fails (Amendment E)", async () => {
    const a = await create(COMPLETE);
    await mount(a.id, "en");
    setArticlesLock(null);
    await type("website-body", "Rescued words");
    await click("website-download-en");
    await until(() => expect(blobs).toHaveLength(1));
    expect(await blobs[0].text()).toContain("Rescued words");
    expect($("website-download-note")!.textContent).toMatch(/unsaved changes/);
    expect(lastDownloadName).toBe("night-grading.en-unsaved.md");
    expect(saveState()).not.toBe("saved");
  });

  it("scrolls to footnotes inside the preview without touching the hash (Amendment E)", async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const a = await create({ body: { ar: "", en: "Text with a note[^1].\n\n[^1]: The note." } });
    history.replaceState(null, "", `/social/website/#a=${a.id}`);
    await mount(a.id, "en");
    await click("website-preview");
    const ref = $("article-preview")!.querySelector<HTMLAnchorElement>(
      'a[href^="#user-content-fn-"]',
    )!;
    const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
    await act(async () => ref.dispatchEvent(ev));
    expect(ev.defaultPrevented).toBe(true);
    expect(location.hash).toBe(`#a=${a.id}`);
    expect(scrolled).toHaveBeenCalled();
    expect($("article-editor")).not.toBeNull();
  });

  it("sets the body direction from the language tab", async () => {
    const a = await create();
    await mount(a.id, "en");
    expect($("website-body")!.getAttribute("dir")).toBe("ltr");
    await click("website-lang-ar");
    expect($("website-body")!.getAttribute("dir")).toBe("rtl");
  });

  it("goes back only after the pending text is saved", async () => {
    const a = await create();
    await mount(a.id, "en");
    await type("website-body", "Before leaving");
    await click("website-back");
    await until(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(article(a.id).body.en).toBe("Before leaving");
  });

  it("keeps the text on screen when the article is removed (reset)", async () => {
    const a = await create();
    await mount(a.id, "en");
    await type("website-body", "Copy me");
    await act(async () => S().reset());
    await until(() => expect($("website-gone")).not.toBeNull());
    expect(($("website-body") as HTMLTextAreaElement).value).toBe("Copy me");
  });
});
