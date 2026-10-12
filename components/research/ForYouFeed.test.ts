// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import { GENRES } from "@/lib/genres";
import { useStore } from "@/store";
import ForYouFeed from "./ForYouFeed";

let host: HTMLDivElement;
let root: Root;
let onCategory: ReturnType<typeof vi.fn<(id: string) => void>>;
const $ = (id: string, within: ParentNode = host) =>
  within.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
function post(id: string, title: string): DiscoverItem {
  const at = new Date().toISOString();
  return {
    platform: "yt",
    url: `https://www.youtube.com/watch?v=${id}`,
    title,
    snippet: title,
    handle: `@${id}`,
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    lang: "en",
    section: "example",
    published: at,
    stats: { views: 40_000 },
    evidence: {
      source: "youtube-api",
      observedAt: at,
      published: at,
      author: `@${id}`,
      caption: title,
      views: 40_000,
    },
  };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.setState({ discoverCandidates: [], discoverFeedback: [], inspirations: [] });
  useStore.getState().setSettings({ lang: "en" });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("For You must not request data"))),
  );
  onCategory = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
function mount() {
  act(() =>
    root.render(
      createElement(ForYouFeed, {
        genres: GENRES,
        onCategory,
        categoryPicker: createElement("button", null, "Categories"),
        renderAction: () => null,
      }),
    ),
  );
}
describe("local For You feed", () => {
  it("prompts for a category when empty without searching or opening format content", () => {
    mount();
    expect($("for-you-feed")?.textContent).toContain("For You");
    expect($("browse-categories")?.hasAttribute("open")).toBe(true);
    expect($("feed-find-more")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("mixes category references, retains feedback context and undo, and offers real lessons without a request", () => {
    useStore
      .getState()
      .accumulateDiscoverCandidates(
        [
          post("animeEdit", "Anime beat sync edit"),
          post("animeLearn", "Anime masking tutorial step by step"),
        ],
        { genreId: "anime" },
      );
    useStore
      .getState()
      .accumulateDiscoverCandidates([post("carEdit", "Car speed ramp edit")], { genreId: "cars" });
    mount();
    expect(all("result-title").map((node) => node.textContent)).toEqual(
      expect.arrayContaining(["Anime beat sync edit", "Car speed ramp edit"]),
    );
    expect(all("feed-card")).toHaveLength(2);
    const anime = all("feed-card").find((node) =>
      node.textContent?.includes("Anime beat sync edit"),
    )!;
    act(() => $("feed-more-like", anime)?.click());
    expect(useStore.getState().discoverFeedback[0]).toMatchObject({
      action: "more",
      genreId: "anime",
    });
    act(() => $("feed-not-useful", anime)?.click());
    expect(all("feed-card")).toHaveLength(1);
    act(() => $("feed-undo")?.click());
    expect(all("feed-card")).toHaveLength(2);
    const restored = all("feed-card").find((node) =>
      node.textContent?.includes("Anime beat sync edit"),
    )!;
    act(() => $("feed-category", restored)?.click());
    expect(onCategory).toHaveBeenCalledWith("anime");
    act(() => $("feed-mode-learning")?.click());
    expect(all("result-title").map((node) => node.textContent)).toEqual([
      "Anime masking tutorial step by step",
    ]);
    act(() => useStore.getState().setSettings({ lang: "ar" }));
    expect($("for-you-feed")?.textContent).toContain("لك");
    expect($("feed-mode-learning")?.textContent).toBe("تعلّم");
    expect(fetch).not.toHaveBeenCalled();
  });
});
