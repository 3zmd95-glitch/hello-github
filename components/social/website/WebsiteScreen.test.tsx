// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@/lib/domain";
import { articleBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import { toDraft, unsavedDrafts } from "./ArticleEditor";
import WebsiteScreen from "./WebsiteScreen";

// 🌐 Website CMS list (packet DT-3): honest "on this device" copy, create → editor by hash, status filters, search in
// both languages, a storage warning, and a content-only export. No network.

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;
let blobs: Blob[];

const S = () => useStore.getState();
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const rowIds = () =>
  [...host.querySelectorAll<HTMLElement>('[data-testid="website-row"]')].map((r) => r.dataset.id);

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
  const u = await S().updateArticle(r.article.id, over, articleBase(r.article));
  if (!u.ok) throw new Error(u.reason);
  return u.article;
}

async function mount(lang: "ar" | "en" = "ar"): Promise<void> {
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(WebsiteScreen));
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
  history.replaceState(null, "", "/social/website/");
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
  S().setSettings({ lang: "ar" });
});

describe("WebsiteScreen", () => {
  it("says articles stay on this device, in Arabic and English, with an empty state", async () => {
    await mount();
    expect($("website-local-only")!.textContent).toContain("ولا شي منها منشور");
    expect($("website-empty")).not.toBeNull();
    await mount("en");
    expect($("website-local-only")!.textContent).toBe(
      "Articles live on this device until the website is connected; nothing is public.",
    );
    expect($("website-storage-blocked")).toBeNull();
    expect(host.textContent).not.toMatch(/published|publish now/i);
  });

  it("creates an article and opens its editor through the #a= hash", async () => {
    await mount("en");
    await act(async () => $("website-new")!.click());
    await until(() => expect($("article-editor")).not.toBeNull());
    const id = S().articles[0].id;
    expect(location.hash).toBe(`#a=${id}`);
    expect($("article-editor")!.dataset.id).toBe(id);
    await act(async () => $("website-back")!.click());
    await until(() => expect($("article-editor")).toBeNull());
    expect(rowIds()).toEqual([id]);
  });

  it("filters by status and searches in Arabic and English", async () => {
    const a = await create({ title: { ar: "تلوين الليل", en: "Night grading" }, tags: ["color"] });
    const b = await create({ title: { ar: "إضاءة", en: "Lighting" } });
    await S().setArticleStatus(b.id, "archived");
    await mount("en");
    expect(rowIds()).toEqual([a.id]);
    expect($("website-row")!.textContent).toContain("Night grading");
    await act(async () => $("website-filter-archived")!.click());
    expect(rowIds()).toEqual([b.id]);
    await act(async () => $("website-filter-draft")!.click());
    await type("website-search", "تلوين");
    expect(rowIds()).toEqual([a.id]);
    await type("website-search", "COLOR");
    expect(rowIds()).toEqual([a.id]);
    await type("website-search", "zzqx");
    expect(rowIds()).toEqual([]);
    expect($("website-no-results")).not.toBeNull();
  });

  it("falls back to the other language's title, then to Untitled", async () => {
    await create({ title: { ar: "عربي فقط", en: "" } });
    await create({});
    await mount("en");
    const titles = [...host.querySelectorAll('[data-testid="website-row"] b')].map(
      (b) => b.textContent,
    );
    expect(titles.sort()).toEqual(["Untitled article", "عربي فقط"].sort());
  });

  it("warns when the browser does not keep data", async () => {
    // Only the durability probe fails, as in a full or blocked storage.
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
      if (k === "3z-prod-storage-probe") throw new Error("QuotaExceededError");
      real.call(this, k, v);
    });
    await mount("en");
    expect($("website-storage-blocked")!.textContent).toMatch(/not keeping data/);
  });

  it("exports every article as content-only JSON", async () => {
    S().setSettings({ apiKeys: { youtube: "secret-key" } });
    const a = await create({ title: { ar: "ع", en: "E" } });
    await mount("en");
    await act(async () => $("website-export-all")!.click());
    expect(blobs).toHaveLength(1);
    const json = JSON.parse(await blobs[0].text());
    expect(json.app).toBe("3z-prod-articles");
    expect(json.articles.map((x: Article) => x.id)).toEqual([a.id]);
    expect(JSON.stringify(json)).not.toMatch(/secret-key|apiKeys|settings/);
    S().setSettings({ apiKeys: {} });
  });

  it("marks articles with a stashed unsaved draft in the list (Amendment E)", async () => {
    const a = await create({ title: { ar: "ع", en: "Stashed one" } });
    unsavedDrafts.setState({
      drafts: {
        [a.id]: {
          fields: toDraft(a),
          base: articleBase(a),
          reason: "conflict",
          at: "2026-10-16T12:00:00.000Z",
          token: 0,
        },
      },
    });
    await mount("en");
    expect($("website-row")!.querySelector('[data-testid="website-unsaved-chip"]')).not.toBeNull();
    unsavedDrafts.setState({ drafts: {} });
  });

  it("keeps the unload guard after leaving the CMS while a draft is stashed, and drops it once cleared (repair 1)", async () => {
    const a = await create({ title: { ar: "ع", en: "Guarded" } });
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    await mount("en");
    expect(unload()).toBe(false);
    unsavedDrafts.setState({
      drafts: {
        [a.id]: {
          fields: toDraft(a),
          base: articleBase(a),
          reason: "notPersisted",
          at: "2026-10-16T12:00:00.000Z",
          token: 0,
        },
      },
    });
    await act(async () => root.render(createElement("div")));
    expect(unload()).toBe(true);
    unsavedDrafts.setState({ drafts: {} });
    expect(unload()).toBe(false);
  });

  it("keeps the editor open for a same-page anchor hash (Amendment E)", async () => {
    const a = await create({ title: { ar: "ع", en: "Anchors" } });
    history.replaceState(null, "", `/social/website/#a=${a.id}`);
    await mount("en");
    await until(() => expect($("article-editor")).not.toBeNull());
    await act(async () => {
      location.hash = "#user-content-fn-1";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect($("article-editor")).not.toBeNull();
  });

  it("opens an existing article from a deep link", async () => {
    const a = await create({ title: { ar: "ع", en: "Deep" } });
    history.replaceState(null, "", `/social/website/#a=${a.id}`);
    await mount("en");
    await until(() => expect($("article-editor")?.dataset.id).toBe(a.id));
  });
});
