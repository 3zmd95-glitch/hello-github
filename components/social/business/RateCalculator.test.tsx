// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BUSINESS_PREFS, SocialPostStatSchema, SocialSnapshotSchema } from "@/lib/domain";
import { STORAGE_KEY, useStore } from "@/store";
import RateCalculator from "./RateCalculator";

// 💰 Rate calculator (planning/tools/09 D3): the owner's own assumptions, one platform at a time, private.

let host: HTMLDivElement;
let root: Root;
let fetchSpy: ReturnType<typeof vi.spyOn>;

const S = () => useStore.getState();
const $ = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
const $$ = (testId: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`)];
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!).state;
const daysAgo = (n: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(
    new Date(Date.now() - n * 86_400_000),
  );

async function mount(lang: "ar" | "en" = "en"): Promise<void> {
  await act(async () => {
    S().setSettings({ lang });
    root.render(createElement(RateCalculator));
  });
}

async function type(testId: string, value: string): Promise<void> {
  const el = $(testId) as HTMLInputElement | HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el) as object,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

async function click(testId: string): Promise<void> {
  await act(async () => $(testId)!.click());
}

const seed = () =>
  useStore.setState({
    socialSnapshots: [
      SocialSnapshotSchema.parse({ platform: "instagram", day: daysAgo(2), followers: 12_000 }),
      SocialSnapshotSchema.parse({ platform: "tiktok", day: daysAgo(1), followers: 1_200 }),
      SocialSnapshotSchema.parse({ platform: "youtube", day: daysAgo(1), followers: 0 }),
    ],
    // Five Instagram reels of 40,000 views: the platform's average views come from the posts.
    socialPostStats: Array.from({ length: 5 }, (_, i) =>
      SocialPostStatSchema.parse({
        platform: "instagram",
        postId: `p${i}`,
        publishedAt: new Date(Date.now() - (i + 1) * 86_400_000).toISOString(),
        kind: "reel",
        views: 40_000,
        likes: 100,
      }),
    ),
  });

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
  S().setSettings({ lang: "ar" });
});

describe("RateCalculator", () => {
  it("prices one platform from its followers and average views, with the calculation shown", async () => {
    seed();
    await mount();
    expect($("rates-private")!.textContent).toContain("only you see this");
    expect($("rates-note")!.textContent).toBe(
      "Estimate from your own assumptions · not a market rate",
    );
    // The first platform in PLATFORMS order with followers (TikTok) is picked; Instagram: 12 × 15 + 40 × 20 = 980.
    await type("rates-platform", "instagram");
    expect(($("rates-platform") as HTMLSelectElement).value).toBe("instagram");
    expect($("rates-result")!.textContent).toBe("≈ 1,000 SAR");
    expect($("rates-explain")!.textContent).toContain("12,000 followers");
    expect($("rates-explain")!.textContent).toContain("= 980");
    // A reel is 1.5×: 1,470 → 1,450. The table lists every deliverable.
    await click("rates-d-reel");
    expect($("rates-result")!.textContent).toBe("≈ 1,450 SAR");
    expect($$("rates-row").map((r) => r.dataset.deliverable)).toEqual([
      "reel",
      "story",
      "post",
      "bundle",
    ]);
    expect($$("rates-row").map((r) => r.textContent)).toEqual([
      expect.stringContaining("1,450"),
      expect.stringContaining("490"),
      expect.stringContaining("1,000"),
      expect.stringContaining("2,450"),
    ]);
    // Never pooled: TikTok has followers but no post sample and no average views.
    await type("rates-platform", "tiktok");
    expect($("rates-no-views")).not.toBeNull();
    expect($("rates-result")!.textContent).toBe("≈ 30 SAR");
    expect($("rates-explain")!.textContent).toContain("1,200 followers");
    // A platform without followers is not offered.
    expect([...($("rates-platform") as HTMLSelectElement).options].map((o) => o.value)).toEqual([
      "tiktok",
      "instagram",
    ]);
  });

  it("saves the owner's edits in the store and the quote follows", async () => {
    seed();
    await mount();
    await type("rates-platform", "instagram");
    // The starting numbers say so, until one is edited.
    expect($("rates-starting")!.textContent).toContain("starting numbers");
    await type("rates-perv", "100");
    expect($("rates-starting")).toBeNull();
    await type("rates-mult-post", "2");
    // (12 × 15 + 40 × 100) × 2 = 8,360 → 8,350.
    expect($("rates-result")!.textContent).toBe("≈ 8,350 SAR");
    expect(stored().businessPrefs.rates).toMatchObject({
      sarPerThousandViews: 100,
      multiplier: { post: 2, reel: 1.5 },
    });
    // The back to defaults button.
    await click("rates-reset");
    expect(S().businessPrefs.rates).toEqual(DEFAULT_BUSINESS_PREFS.rates);
    expect($("rates-result")!.textContent).toBe("≈ 1,000 SAR");
  });

  it("says what is missing instead of inventing a number", async () => {
    await mount();
    expect($("rates-empty")!.textContent).toContain("Add your numbers in Growth");
    expect($("rates-result")).toBeNull();
  });

  it("works in Arabic and never shows anything outside the device", async () => {
    seed();
    await mount("ar");
    expect($("rates-note")!.textContent).toBe("تقدير من افتراضاتك أنت · مو سعر السوق");
    expect($("rates-result")!.textContent).toContain("ريال");
    // Starting numbers sit in the fields, editable.
    expect(($("rates-perk") as HTMLInputElement).value).toBe("15");
    expect(($("rates-mult-bundle") as HTMLInputElement).value).toBe("2.5");
  });
});
