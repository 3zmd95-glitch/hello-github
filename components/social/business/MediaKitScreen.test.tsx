// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDayShort } from "@/components/planner/weekLabel";
import { DemographicSchema, SocialPostStatSchema, SocialSnapshotSchema } from "@/lib/domain";
import { STORAGE_KEY, businessBase, setArticlesLock, useStore, type ArticlesLock } from "@/store";
import MediaKitScreen from "./MediaKitScreen";

// 📄 Media-kit page (planning/tools/09 D2): a printable page built only from what the app stores. Missing numbers
// are dashes, the rate card is never printed (only "rates on request"), blocks switch off, the language is the
// kit's own, and "Export PDF" is the browser's print.

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;

const S = () => useStore.getState();
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const $$ = (testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const text = (testId: string) => $(testId)!.textContent ?? "";
const day = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(
    new Date(Date.now() - n * 86_400_000),
  );
const iso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

/** The kit is a locked slice: tests save it through the same lock the editor uses. */
const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};

async function mount(lang: "ar" | "en" = "en"): Promise<void> {
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(MediaKitScreen));
  });
}

async function click(testId: string): Promise<void> {
  await act(async () => $(testId)!.click());
}

async function type(testId: string, value: string): Promise<void> {
  const el = $(testId) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el) as object,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const KIT = {
  tagline: { ar: "أصوّر وأمنتج", en: "I film and edit" },
  bio: { ar: "مونتير في جدة", en: "Editor in Jeddah" },
  contact: { email: "hi@3z.example", website: "https://3z.example", location: { ar: "", en: "" } },
  services: [
    { id: "s1", name: { ar: "مونتاج", en: "Editing" }, desc: { ar: "", en: "Reels and ads" } },
  ],
  rateCard: [
    { id: "r1", deliverable: { ar: "ريل", en: "Reel" }, priceSar: 1500, note: { ar: "", en: "" } },
  ],
  pastWork: [
    { id: "w1", title: { ar: "", en: "Launch ad" }, url: "https://x.example/ad" },
    { id: "w2", title: { ar: "", en: "Bad link" }, url: "javascript:alert(1)" },
  ],
};

const seed = async () => {
  setArticlesLock(queueLock());
  const r = await S().saveBusinessKit(KIT, businessBase(null));
  if (!r.ok) throw new Error(r.reason);
  useStore.setState({
    socialSnapshots: [
      SocialSnapshotSchema.parse({
        platform: "instagram",
        day: day(2),
        followers: 272,
        engagementRate: 7.8,
      }),
      SocialSnapshotSchema.parse({ platform: "tiktok", day: day(1), followers: 1_200 }),
    ],
    socialAccounts: [{ platform: "threads", handle: "3z.threads" }],
    socialPostStats: [
      SocialPostStatSchema.parse({
        platform: "instagram",
        postId: "new",
        publishedAt: iso(1),
        kind: "reel",
        title: "My newest reel",
        views: 5_400,
        likes: 321,
      }),
      SocialPostStatSchema.parse({
        platform: "instagram",
        postId: "future",
        publishedAt: iso(-5),
        kind: "reel",
        title: "Not yet published",
        views: 1,
      }),
    ],
    demographics: [
      DemographicSchema.parse({
        platform: "instagram",
        day: day(3),
        dimension: "gender",
        key: "male",
        pct: 60,
      }),
      DemographicSchema.parse({
        platform: "instagram",
        day: day(3),
        dimension: "gender",
        key: "female",
        pct: 40,
      }),
      DemographicSchema.parse({
        platform: "instagram",
        day: day(3),
        dimension: "age",
        key: "25-34",
        pct: 55,
      }),
      DemographicSchema.parse({
        platform: "instagram",
        day: day(3),
        dimension: "country",
        key: "SA",
        pct: 31.5,
      }),
    ],
  });
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
  localStorage.clear();
  S().reset();
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

describe("MediaKitScreen", () => {
  it("is the print root: the hero has the name, the tagline, the total and each platform's saved count", async () => {
    await seed();
    S().setBusinessPrefs({ ...S().businessPrefs, name: "3z Prod" });
    await mount();
    expect($("kit-page")!.hasAttribute("data-print-root")).toBe(true);
    expect(text("kit-name")).toBe("3z Prod");
    expect(text("kit-tagline")).toBe("I film and edit");
    // 272 + 1,200 = 1,472 → 1.5K, over the two platforms that have a saved count (threads has only a handle).
    expect(text("kit-total")).toContain("1.5K");
    expect(text("kit-total-note")).toBe("Platforms counted: 2 of 3");
    expect(text("kit-chip-tiktok")).toContain("1.2K");
    expect(text("kit-chip-instagram")).toContain("272");
    expect(text("kit-chip-threads")).toContain("—");
  });

  it("falls back to the first saved handle for the name, and to dashes when there is nothing", async () => {
    useStore.setState({ socialAccounts: [{ platform: "instagram", handle: "3z.prod" }] });
    await mount();
    expect(text("kit-name")).toBe("@3z.prod");
    expect(text("kit-total")).toBe("—");
    act(() => root.unmount());
    root = createRoot(host);
    S().reset();
    await mount();
    expect(text("kit-name")).toBe("—");
    expect(text("kit-total")).toBe("—");
    expect($("kit-total-note")).toBeNull();
    // Nothing to show: only the always-there rates block, and the controls say so.
    expect($("kit-about")).toBeNull();
    expect($("kit-platforms")).toBeNull();
    expect($("kit-rates")).not.toBeNull();
    expect(text("kitpage-block-hint-about")).toBe("nothing to show yet");
  });

  it("shows per-platform tiles with their source and a dash wherever a number is missing", async () => {
    await seed();
    await mount();
    expect(text("kit-tile-instagram-followers")).toContain("272");
    expect(text("kit-tile-instagram-followers")).toContain(
      `Snapshot · ${formatDayShort(day(2), "en")}`,
    );
    expect(text("kit-tile-instagram-engagement")).toContain("7.8%");
    // The one imported (not future) post is the whole sample, and the tile says so.
    expect(text("kit-tile-instagram-avgViews")).toContain("5.4K");
    expect(text("kit-tile-instagram-avgViews")).toContain("Posts sampled: 1");
    expect(text("kit-tile-threads-followers")).toBe("Followers—");
    expect(text("kit-platform-threads")).toContain("@3z.threads");
    // Nothing the app does not store: no invented engagement or views for TikTok.
    expect(text("kit-tile-tiktok-engagement")).toBe("Engagement—");
    expect(text("kit-tile-tiktok-avgViews")).toBe("Avg. views—");
  });

  it("shows the audience, the recent posts (none from the future), services, past work and an email link", async () => {
    await seed();
    await mount();
    expect(text("kit-audience-instagram")).toContain("60%");
    expect(text("kit-audience-instagram")).toContain("25-34");
    expect(text("kit-audience-instagram")).toContain("Saudi Arabia");
    expect(text("kit-audience-instagram")).toContain("31.5%");
    expect($$("kit-post").map((p) => p.textContent)).toEqual([
      expect.stringContaining("My newest reel"),
    ]);
    expect(text("kit-post")).toContain("5.4K views");
    expect(text("kit-services")).toContain("Editing");
    expect(text("kit-services")).toContain("Reels and ads");
    // https links only.
    const links = [...$("kit-work")!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toEqual(["https://x.example/ad"]);
    expect(text("kit-work")).toContain("Bad link");
    expect($("kit-work-with-me")!.querySelector('a[href="mailto:hi@3z.example"]')).not.toBeNull();
    expect(text("kit-about")).toContain("Editor in Jeddah");
  });

  it("says rates are on request and never prints the rate card or the calculator's numbers", async () => {
    await seed();
    S().setBusinessPrefs({
      ...S().businessPrefs,
      rates: { ...S().businessPrefs.rates, sarPerThousandViews: 987 },
    });
    await mount();
    expect(text("kit-rates")).toContain("Rates on request");
    const paper = text("kit-page");
    for (const secret of ["1500", "1,500", "987", "SAR", "ريال"])
      expect(paper).not.toContain(secret);
    await mount("ar");
    expect(text("kit-rates")).toContain("الأسعار عند الطلب");
  });

  it("has its own language: switching it changes the page and its direction, not the app", async () => {
    await seed();
    await mount("en");
    expect($("kit-page")!.getAttribute("dir")).toBe("ltr");
    await click("kitpage-lang-ar");
    expect($("kit-page")!.getAttribute("dir")).toBe("rtl");
    expect($("kit-page")!.getAttribute("lang")).toBe("ar");
    expect(text("kit-tagline")).toBe("أصوّر وأمنتج");
    expect(text("kit-about")).toContain("نبذة عني");
    expect(text("kit-about")).toContain("مونتير في جدة");
    expect(S().settings.lang).toBe("en");
    // The controls stay in the app's language.
    expect(text("kitpage-export")).toContain("Export PDF");
  });

  it("switches blocks off and remembers it; the name is typed in and saved", async () => {
    await seed();
    await mount();
    expect($("kit-posts")).not.toBeNull();
    await click("kitpage-block-posts");
    expect($("kit-posts")).toBeNull();
    expect(stored().businessPrefs.blocks.posts).toBe(false);
    expect(stored().businessPrefs.blocks.about).toBe(true);
    await click("kitpage-block-posts");
    expect($("kit-posts")).not.toBeNull();
    await type("kitpage-name", "Saved Name");
    expect(text("kit-name")).toBe("Saved Name");
    expect(stored().businessPrefs.name).toBe("Saved Name");
  });

  it("Export PDF is the browser's print, and no email gets a hint outside the page", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    await mount();
    await click("kitpage-export");
    expect(print).toHaveBeenCalledTimes(1);
    expect($("kitpage-no-email")).not.toBeNull();
    expect($("kit-page")!.contains($("kitpage-no-email"))).toBe(false);
    expect($("kit-work-with-me")).toBeNull();
  });
});
