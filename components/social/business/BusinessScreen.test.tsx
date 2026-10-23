// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialSnapshotSchema } from "@/lib/domain";
import { STORAGE_KEY, businessBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import BusinessScreen from "./BusinessScreen";
import { unsavedKitDraft } from "./KitEditor";

// 💼 Business Kit (packet DT-5): honest "this device only" copy, autosave with read-back, conflicts, the unsaved-draft
// stash with the app-lifetime unload guard, metrics with provenance, preview (never a price) / export
// from the current draft, and the brand-deal board. No network.

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;

const S = () => useStore.getState();
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const $$ = (testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
const daysAgo = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(
    new Date(Date.now() - n * 86_400_000),
  );

const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};

async function mount(lang: "ar" | "en" = "ar"): Promise<void> {
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(BusinessScreen));
  });
}

async function type(testId: string, value: string): Promise<void> {
  const el = $(testId) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
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

const saved = () => until(() => expect($("business-save-status")!.dataset.state).toBe("saved"));
const value = (testId: string) => ($(testId) as HTMLInputElement).value;

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
  unsavedKitDraft.setState({ draft: undefined }, true);
  S().setSettings({ lang: "ar" });
});

describe("BusinessScreen", () => {
  it("says the kit stays on this device, in Arabic and English, with Kit and Deals tabs", async () => {
    await mount();
    expect($("business-local-only")!.textContent).toContain("هذا الجهاز");
    expect($("business-tab-kit")!.getAttribute("aria-selected")).toBe("true");
    await mount("en");
    expect(host.querySelector("h1")!.textContent).toBe("Business");
    expect($("business-local-only")!.textContent).toBe(
      "Lives on this device; nothing is public until the website is connected.",
    );
    expect($("business-tab-deals")!.textContent).toBe("Brand deals");
  });

  it("links to the media-kit page and has a private Rates tab between the kit and the deals", async () => {
    await mount("en");
    expect($("business-open-page")!.getAttribute("href")).toMatch(
      /^\/social\/business\/media-kit\/?$/,
    );
    await click("business-tab-rates");
    expect($("business-tab-rates")!.getAttribute("aria-selected")).toBe("true");
    expect($("rates-screen")).not.toBeNull();
    expect($("kit-editor")).toBeNull();
    await click("business-tab-deals");
    expect($("rates-screen")).toBeNull();
  });

  it("saves edits after a pause, only once the store read the commit back", async () => {
    await mount("en");
    await type("business-tagline-en", "I film and edit");
    await type("business-bio-ar", "أصوّر وأمنتج");
    await type("business-email", "hi@3z.example");
    await saved();
    expect(stored().businessKit).toMatchObject({
      tagline: { ar: "", en: "I film and edit" },
      bio: { ar: "أصوّر وأمنتج", en: "" },
      contact: { email: "hi@3z.example" },
    });
    // Rows: a service and a rate with the owner's own price.
    await click("business-service-add");
    await type("business-service-name-en", "Editing");
    await click("business-rate-add");
    await type("business-rate-deliverable-en", "Reel");
    await type("business-rate-price", "1500");
    await saved();
    expect(stored().businessKit.services[0].name.en).toBe("Editing");
    expect(stored().businessKit.rateCard[0]).toMatchObject({
      deliverable: { en: "Reel" },
      priceSar: 1500,
    });
    // Advisory checks: the website must be https.
    await type("business-website", "http://3z.example");
    await until(() => expect($("business-issues")!.textContent).toContain("https://"));
  });

  it("shows a conflict when another tab saves while an edit is pending, and keeps the text", async () => {
    await mount("en");
    await type("business-tagline-en", "First");
    await saved();
    await type("business-tagline-en", "Mine, not saved");
    // Another tab commits before this edit's save runs.
    const kit = S().businessKit!;
    expect(
      (await S().saveBusinessKit({ bio: { ar: "", en: "Theirs" } }, businessBase(kit))).ok,
    ).toBe(true);
    await until(() => expect($("business-conflict")).not.toBeNull());
    expect(value("business-tagline-en")).toBe("Mine, not saved");
    expect(stored().businessKit.tagline.en).toBe("First");
    await click("business-reload");
    expect(value("business-tagline-en")).toBe("First");
    expect(value("business-bio-en")).toBe("Theirs");
    expect($("business-conflict")).toBeNull();
  });

  it("stashes an unsaved edit on unmount (lock held), guards unload, and offers it on return", async () => {
    await mount("en");
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const queue = queueLock();
    setArticlesLock((fn) => queue(async () => (await held, fn())));
    await type("business-tagline-en", "Stashed text");
    await act(async () => root.render(createElement("div")));
    expect(unsavedKitDraft.getState().draft?.fields.tagline.en).toBe("Stashed text");
    const unload = () => {
      const e = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(unload()).toBe(true);
    await mount("en");
    await until(() => expect($("business-unsaved-prompt")).not.toBeNull());
    await click("business-unsaved-restore");
    expect(value("business-tagline-en")).toBe("Stashed text");
    release();
    await until(() => expect(stored().businessKit?.tagline.en).toBe("Stashed text"));
    await until(() => expect(unsavedKitDraft.getState().draft).toBeUndefined());
    expect(unload()).toBe(false);
  });

  it("shows each platform's numbers with their source: snapshot day, stale, missing", async () => {
    useStore.setState({
      socialSnapshots: [
        SocialSnapshotSchema.parse({
          platform: "instagram",
          day: daysAgo(2),
          followers: 12_400,
          views30d: 777_777,
          engagementRate: 5,
        }),
        SocialSnapshotSchema.parse({ platform: "youtube", day: daysAgo(45), followers: 300 }),
      ],
      socialAccounts: [{ platform: "threads", handle: "3z.threads" }],
    });
    await mount("en");
    const ig = $("business-metric-instagram")!;
    expect(ig.textContent).toContain("12.4K");
    expect(ig.textContent).toContain(`Saved Growth snapshot · observed ${daysAgo(2)}`);
    expect(ig.textContent).not.toContain("777");
    expect($("business-metric-youtube")!.textContent).toContain("Older than 30 days");
    expect($("business-metric-threads")!.textContent).toContain("No number yet");
    expect($("business-metric-threads")!.textContent).toContain("@3z.threads");
    expect($("business-growth-link")!.getAttribute("href")).toMatch(/^\/social\/growth\/?$/);
    // The price calculator moved to its own Rates tab; the kit tab no longer carries one.
    expect($("business-estimator")).toBeNull();
  });

  it("exports the current draft as the allowlisted projection, marked unsaved until it is saved", async () => {
    let blob: Blob | null = null;
    let fileName = "";
    vi.stubGlobal(
      "URL",
      Object.assign(Object.create(URL), {
        createObjectURL: (b: Blob) => ((blob = b), "blob:kit"),
        revokeObjectURL: () => {},
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      fileName = this.download;
    });
    await S().addBrandDeal({ brand: "Private Brand", notes: "secret note" });
    await mount("en");
    // Hold the save so the draft is not saved when exported.
    setArticlesLock((fn) => new Promise(() => void fn));
    await type("business-tagline-en", "Draft tagline");
    expect($("business-unsaved-export")).not.toBeNull();
    await click("business-export");
    expect(fileName).toBe(`3z-prod-media-kit-${TODAY}-unsaved.json`);
    const json = JSON.parse(await blob!.text());
    expect(json.app).toBe("3z-prod-media-kit");
    expect(json.tagline.en).toBe("Draft tagline");
    const text = JSON.stringify(json);
    for (const secret of ["Private Brand", "secret note", "estimator", "apiKeys", "brandDeals"])
      expect(text).not.toContain(secret);
  });

  it("previews the current draft from the print root, never with a price, and sends printing to the page", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await mount("en");
    await type("business-tagline-en", "Printed tagline");
    await click("business-rate-add");
    await type("business-rate-deliverable-en", "Reel");
    await type("business-rate-price", "1500");
    await saved();
    const rootEl = host.querySelector<HTMLElement>("[data-print-root]")!;
    expect(rootEl.textContent).toContain("Printed tagline");
    expect(rootEl.textContent).not.toMatch(/1500|SAR|Reel|Ask me/);
    await click("business-preview");
    expect($("kit-preview")!.className).not.toContain("hidden");
    // The rate card says it is private; the print button is a link to the media-kit page, not a second print.
    expect($("business-rate-private")!.textContent).toContain("Private");
    expect($("business-to-page")!.getAttribute("href")).toMatch(
      /^\/social\/business\/media-kit\/?$/,
    );
    expect($("business-print")).toBeNull();
    expect(print).not.toHaveBeenCalled();
    expect($("business-unsaved-export")).toBeNull();
  });
});

describe("deals board", () => {
  it("adds a deal, moves its stage, edits it and keeps lost deals as history", async () => {
    await mount("en");
    await click("business-tab-deals");
    expect($("deals-empty")).not.toBeNull();
    await click("deal-new");
    await type("deal-brand", "Brand A");
    await type("deal-value", "1200");
    await click("deal-save");
    await until(() => expect($$("deal-row")).toHaveLength(1));
    expect(stored().brandDeals[0]).toMatchObject({
      brand: "Brand A",
      valueSar: 1200,
      stage: "lead",
    });
    expect($("deal-row")!.textContent).toContain("1200");

    await type("deal-stage", "agreed");
    await until(() => expect(stored().brandDeals[0].stage).toBe("agreed"));

    await click("deal-edit");
    await type("deal-edit-deliverable", "2 reels");
    await type("deal-edit-notes", "Due Friday");
    await click("deal-edit-save");
    await until(() => expect(stored().brandDeals[0]).toMatchObject({ deliverable: "2 reels" }));
    expect($("deal-row")!.textContent).toContain("2 reels");

    await type("deal-stage", "lost");
    await until(() => expect(stored().brandDeals[0].stage).toBe("lost"));
    await type("deal-filter", "lost");
    expect($$("deal-row")).toHaveLength(1);
    await type("deal-filter", "paid");
    expect($$("deal-row")).toHaveLength(0);
    // An empty brand is refused with a message, nothing is written.
    await type("deal-filter", "all");
    await click("deal-new");
    await click("deal-save");
    expect($("deal-error")!.textContent).toContain("brand");
    expect(stored().brandDeals).toHaveLength(1);
  });

  it("renders the board in Arabic", async () => {
    await S().addBrandDeal({ brand: "براند" });
    await mount("ar");
    await click("business-tab-deals");
    expect($("deal-row")!.textContent).toContain("فرصة");
  });
});

describe("deals board R1 repair", () => {
  it("R5: a form opened before the same backup is restored keeps its draft and refuses the stale save", async () => {
    await S().addBrandDeal({ brand: "Audit Brand", contact: "private-brand@example.invalid" });
    await mount("en");
    await click("business-tab-deals");
    await click("deal-edit");
    await type("deal-edit-contact", "Stale draft typed before the restore");
    // Restore a backup holding the very same deal (same commit id): a new generation all the same.
    await act(async () => S().importState(S().exportState()));
    await click("deal-edit-save");
    await until(() => expect($("deal-error")).not.toBeNull());
    expect($("deal-error")!.textContent).toMatch(/changed/i);
    expect(stored().brandDeals[0].contact).toBe("private-brand@example.invalid");
    expect(value("deal-edit-contact")).toBe("Stale draft typed before the restore");
  });
});

describe("deal reply draft (DT-5-R1 coverage gap)", () => {
  it("drafts from the deal and the kit, edits, saves through the deal's commit and copies; nothing is sent", async () => {
    await S().saveBusinessKit(
      {
        services: [
          { id: "s1", name: { ar: "مونتاج", en: "Video editing" }, desc: { ar: "", en: "" } },
        ],
        rateCard: [
          {
            id: "r1",
            deliverable: { ar: "ريل", en: "Reel" },
            priceSar: 1500,
            note: { ar: "", en: "" },
          },
        ],
      },
      businessBase(null),
    );
    await S().addBrandDeal({ brand: "Brand A", deliverable: "1 reel", valueSar: 1200 });
    const writeText = vi.fn((text: string) => Promise.resolve(void text));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount("en");
    await click("business-tab-deals");
    await click("deal-reply");
    expect($("deal-reply-label")!.textContent).toContain("nothing is sent");
    const draft = value("deal-reply-text");
    for (const part of ["Brand A", "1 reel", "1,200", "1,500", "Video editing", "مرحبا"])
      expect(draft).toContain(part);

    await type("deal-reply-text", "Hi Brand A");
    await click("deal-reply-save");
    await until(() => expect(stored().brandDeals[0].replyDraft).toBe("Hi Brand A"));
    expect($("deal-reply-status")!.textContent).toContain("saved");
    await click("deal-reply-copy");
    expect(writeText).toHaveBeenCalledWith("Hi Brand A");
    await until(() => expect($("deal-reply-status")!.textContent).toContain("Copied"));
    await click("deal-reply-rebuild");
    expect(value("deal-reply-text")).toContain("1,500");

    // A restore between opening and saving: refused, the typed text stays.
    await type("deal-reply-text", "Typed before the restore");
    await act(async () => S().importState(S().exportState()));
    await click("deal-reply-save");
    await until(() => expect($("deal-error")).not.toBeNull());
    expect(value("deal-reply-text")).toBe("Typed before the restore");
    expect(stored().brandDeals[0].replyDraft).toBe("Hi Brand A");
  });
});

describe("deal reply acknowledgements (DT-5-R2 R1-E)", () => {
  /** The store lock held until released (a real queue behind it), like another tab's commit in progress. */
  const holdLock = () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const queue = queueLock();
    setArticlesLock((fn) => queue(async () => (await held, fn())));
    return release;
  };
  const status = () => $("deal-reply-status")?.textContent ?? "";

  it("Save A then type B while the save waits: B stays dirty and saveable, no false 'saved'", async () => {
    await S().addBrandDeal({ brand: "Brand A" });
    await mount("en");
    await click("business-tab-deals");
    await click("deal-reply");
    await type("deal-reply-text", "Version A");
    const release = holdLock();
    await click("deal-reply-save");
    await type("deal-reply-text", "Version B");
    release();
    await until(() => expect(stored().brandDeals[0].replyDraft).toBe("Version A"));
    await until(() => expect(status()).toMatch(/earlier version/i));
    expect(status()).not.toContain("Draft saved");
    expect(value("deal-reply-text")).toBe("Version B");
    // B saves against the refreshed base (no stale-form conflict).
    setArticlesLock(queueLock());
    await click("deal-reply-save");
    await until(() => expect(stored().brandDeals[0].replyDraft).toBe("Version B"));
    await until(() => expect(status()).toContain("Draft saved"));
    expect($("deal-error")).toBeNull();
  });

  it("Copy A then open B while the clipboard waits: B never says 'Copied'", async () => {
    await S().addBrandDeal({ brand: "Brand A" });
    await S().addBrandDeal({ brand: "Brand B" });
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>((r) => (finish = r)));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount("en");
    await click("business-tab-deals");
    const rowIndex = (brand: string) =>
      $$("deal-row").findIndex((r) => r.textContent?.includes(brand));
    await click("deal-reply", rowIndex("Brand A"));
    await click("deal-reply-copy");
    expect(writeText).toHaveBeenCalledTimes(1);
    await click("deal-reply", rowIndex("Brand B"));
    expect(value("deal-reply-text")).toContain("Brand B");
    await act(async () => finish());
    await act(() => new Promise<void>((r) => setTimeout(r, 50)));
    expect(status()).not.toContain("Copied");
  });

  it("close and reopen the same deal: acknowledgements from the earlier session never show", async () => {
    await S().addBrandDeal({ brand: "Brand A" });
    let finish!: () => void;
    const writeText = vi.fn(() => new Promise<void>((r) => (finish = r)));
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    await mount("en");
    await click("business-tab-deals");
    await click("deal-reply");
    await type("deal-reply-text", "Session one");
    const release = holdLock();
    await click("deal-reply-save");
    await click("deal-reply-copy");
    await click("deal-reply-close");
    await click("deal-reply");
    release();
    await act(async () => finish());
    await until(() => expect(stored().brandDeals[0].replyDraft).toBe("Session one"));
    await act(() => new Promise<void>((r) => setTimeout(r, 50)));
    expect(status()).toBe("");
    // The draft was not discarded to hide the race: the reopened panel holds the saved text.
    expect(value("deal-reply-text")).toBeTruthy();
  });
});
