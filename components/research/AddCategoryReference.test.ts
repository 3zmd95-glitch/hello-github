// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rankDiscoverItems } from "@/lib/discoverRanking";
import type { DiscoverItem } from "@/lib/discover";
import { categoryCandidates, DISCOVER_CATEGORY_MAX } from "@/lib/discoverFeed";
import { useStore } from "@/store";
import AddCategoryReference from "./AddCategoryReference";

let host: HTMLDivElement;
let root: Root;
let onOpen: ReturnType<typeof vi.fn<(url: string) => void>>;
const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const type = (id: string, value: string) => {
  const input = $(id) as HTMLInputElement | HTMLTextAreaElement;
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const submit = () =>
  act(() =>
    $("feed-reference-form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
const mount = (genreId = "anime") =>
  act(() => root.render(createElement(AddCategoryReference, { key: genreId, genreId, onOpen })));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useStore.setState({
    discoverLibraryStatus: "ready",
    discoverCandidates: [],
    discoverFeedback: [],
    inspirations: [],
  });
  useStore.getState().setSettings({ lang: "en" });
  onOpen = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Adding a reference must not search"))),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mount();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("personal category references", () => {
  it.each([
    [
      "https://www.instagram.com/reel/NativeEdit/?igsh=tracking",
      "ig",
      "https://www.instagram.com/p/NativeEdit",
    ],
    [
      "https://www.tiktok.com/@editor/video/1234567890123456789?is_from_webapp=1",
      "tt",
      "https://www.tiktok.com/@editor/video/1234567890123456789",
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ?si=tracking",
      "yt",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
  ])(
    "adds the exact post %s without invented source evidence or a provider request",
    (url, platform, canonical) => {
      type("feed-reference-url", url);
      type("feed-reference-label", "My anime masterpiece with 1M likes");
      type("feed-reference-note", "Try the second transition");
      submit();
      const state = useStore.getState();
      const [item] = categoryCandidates(state.discoverCandidates, "anime");
      expect(item).toMatchObject({ platform, url: canonical, snippet: "" });
      expect(item.evidence).toBeUndefined();
      expect(item.stats).toBeUndefined();
      expect(item.published).toBeUndefined();
      expect(item.title).not.toContain("masterpiece");
      expect(state.inspirations[0]).toMatchObject({
        ref: { title: "My anime masterpiece with 1M likes" },
        note: "Try the second transition",
      });
      expect(state.discoverFeedback).toEqual([
        expect.objectContaining({ action: "more", genreId: "anime", url: canonical }),
      ]);
      expect(
        rankDiscoverItems([item], { genreId: "anime", feedback: state.discoverFeedback }).items,
      ).toHaveLength(1);
      expect(
        rankDiscoverItems([item], {
          genreId: "anime",
          feedback: state.discoverFeedback,
          mode: "popular",
        }).items,
      ).toHaveLength(0);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([
    "https://www.instagram.com/editor/",
    "https://www.tiktok.com/@editor",
    "https://www.youtube.com/@editor",
    "https://instagram.com.evil.test/reel/NativeEdit/",
    "https://evil.test/reel/NativeEdit/",
    "https://person:secret@www.instagram.com/reel/NativeEdit/",
    "https://vm.tiktok.com/short/",
  ])("rejects a non-post or untrusted link %s", (url) => {
    type("feed-reference-url", url);
    submit();
    expect($("feed-reference-error")).not.toBeNull();
    expect(useStore.getState().inspirations).toHaveLength(0);
    expect(useStore.getState().discoverCandidates).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("deduplicates canonical links while preserving existing notes, label and practice stage", () => {
    type("feed-reference-url", "https://instagram.com/reel/NativeEdit/?igsh=first");
    type("feed-reference-label", "Original personal label");
    type("feed-reference-note", "Original note");
    submit();
    act(() =>
      useStore
        .getState()
        .updateInspiration("https://www.instagram.com/p/NativeEdit", { stage: "tried" }),
    );
    const savedAt = useStore.getState().inspirations[0].savedAt;
    type("feed-reference-url", "https://instagram.com/p/NativeEdit/?igsh=second");
    type("feed-reference-label", "Do not replace my label");
    type("feed-reference-note", "Another idea");
    submit();
    expect(useStore.getState().inspirations).toHaveLength(1);
    expect(useStore.getState().inspirations[0]).toMatchObject({
      ref: { title: "Original personal label" },
      note: "Original note\n\nAnother idea",
      stage: "tried",
      savedAt,
    });
    expect(categoryCandidates(useStore.getState().discoverCandidates, "anime")).toHaveLength(1);
  });
  it("can save without a More vote and never transfers a draft into another category", () => {
    type("feed-reference-url", "https://instagram.com/reel/NativeEdit/");
    mount("coffee");
    expect(($("feed-reference-url") as HTMLInputElement).value).toBe("");
    type("feed-reference-url", "https://instagram.com/reel/CoffeeReference/");
    act(() => $("feed-reference-keep").click());
    submit();
    expect(useStore.getState().discoverFeedback).toHaveLength(0);
    expect(categoryCandidates(useStore.getState().discoverCandidates, "anime")).toHaveLength(0);
    expect(categoryCandidates(useStore.getState().discoverCandidates, "coffee")).toHaveLength(1);
  });
  it("blocks submissions while the existing library is loading", () => {
    act(() => useStore.setState({ discoverLibraryStatus: "loading" }));
    type("feed-reference-url", "https://instagram.com/reel/NativeEdit/");
    submit();
    expect(useStore.getState().inspirations).toHaveLength(0);
    expect(($("feed-reference-submit") as HTMLButtonElement).disabled).toBe(true);
  });
  it("preserves authentic source evidence when a known post is added again", () => {
    const sourceItem = {
      platform: "ig" as const,
      url: "https://www.instagram.com/p/NativeEdit",
      handle: "@real",
      title: "Actual anime edit caption",
      snippet: "Actual anime edit caption",
      lang: "en" as const,
      section: "example" as const,
      stats: { likes: 2400 },
      published: "2026-10-01T10:00:00.000Z",
      evidence: {
        source: "instagram-public-embed" as const,
        observedAt: "2026-10-09T12:00:00.000Z",
        caption: "Actual anime edit caption",
        author: "real",
        likes: 2400,
      },
    };
    act(() => useStore.getState().accumulateDiscoverCandidates([sourceItem], { genreId: "anime" }));
    type("feed-reference-url", "https://instagram.com/reel/NativeEdit/?igsh=same");
    type("feed-reference-label", "My different label");
    submit();
    expect(categoryCandidates(useStore.getState().discoverCandidates, "anime")[0]).toMatchObject(
      sourceItem,
    );
    expect(useStore.getState().inspirations[0].ref.title).toBe("My different label");
  });
  it("leaves a full existing note intact instead of truncating it", () => {
    type("feed-reference-url", "https://instagram.com/reel/NativeEdit/");
    type("feed-reference-note", "x".repeat(1200));
    submit();
    type("feed-reference-url", "https://instagram.com/p/NativeEdit/");
    type("feed-reference-note", "New note");
    submit();
    expect($("feed-reference-error")?.textContent).toContain("no room");
    expect(useStore.getState().inspirations[0].note).toBe("x".repeat(1200));
  });
  it("keeps an authentic unavailable observation above a newer inflated index copy from another category", () => {
    const native: DiscoverItem = {
      platform: "ig",
      url: "https://www.instagram.com/p/NativeEdit",
      handle: "@real",
      title: "Post unavailable",
      snippet: "",
      lang: "en",
      section: "example",
      stats: { likes: 5 },
      evidence: {
        source: "instagram-public-embed",
        observedAt: "2026-10-08T12:00:00.000Z",
        caption: "",
        likes: 5,
        availability: "unavailable",
      },
    };
    const indexed: DiscoverItem = {
      ...native,
      title: "Anime beat sync edit",
      snippet: "Anime beat sync edit",
      stats: { likes: 5000000 },
      evidence: {
        source: "indexed-excerpt",
        observedAt: "2026-10-09T12:00:00.000Z",
        likes: 5000000,
      },
    };
    act(() => {
      useStore.getState().accumulateDiscoverCandidates([native], { genreId: "coffee" });
      useStore.getState().accumulateDiscoverCandidates([indexed], { genreId: "travel" });
    });
    type("feed-reference-url", "https://instagram.com/reel/NativeEdit/?igsh=same");
    submit();
    const [item] = categoryCandidates(useStore.getState().discoverCandidates, "anime");
    expect(item).toMatchObject(native);
    expect(
      rankDiscoverItems([item], {
        genreId: "anime",
        feedback: useStore.getState().discoverFeedback,
      }).items,
    ).toHaveLength(0);
  });
  it("does not copy another category's rejection flags onto an explicit personal association", () => {
    const item: DiscoverItem = {
      platform: "ig",
      url: "https://www.instagram.com/p/NativeEdit",
      handle: "@editor",
      title: "",
      snippet: "",
      lang: "en",
      section: "example",
      outsideCategory: true,
      evidence: {
        source: "instagram-public-embed",
        observedAt: "2026-10-09T12:00:00.000Z",
        caption: "",
        likes: 5,
        availability: "available",
      },
    };
    act(() => useStore.getState().accumulateDiscoverCandidates([item], { genreId: "coffee" }));
    type("feed-reference-url", "https://instagram.com/reel/NativeEdit/");
    submit();
    const [personal] = categoryCandidates(useStore.getState().discoverCandidates, "anime");
    expect(personal.outsideCategory).toBeUndefined();
    expect(personal.evidence).toEqual(item.evidence);
    expect(
      categoryCandidates(useStore.getState().discoverCandidates, "coffee")[0].outsideCategory,
    ).toBe(true);
    expect(
      rankDiscoverItems([personal], {
        genreId: "anime",
        feedback: useStore.getState().discoverFeedback,
      }).items,
    ).toHaveLength(1);
  });
  it.each([true, false])(
    "retains a manually added reference in a full category with Keep set to %s",
    (keep) => {
      const at = new Date().toISOString();
      const strong: DiscoverItem[] = Array.from({ length: DISCOVER_CATEGORY_MAX }, (_, index) => ({
        platform: "yt",
        url: `https://www.youtube.com/watch?v=strong_${index}`,
        handle: `@editor${index}`,
        title: "Anime beat sync edit",
        snippet: "Anime beat sync edit",
        lang: "en",
        section: "example",
        published: at,
        stats: { views: 40000 },
        evidence: {
          source: "youtube-api",
          observedAt: at,
          published: at,
          caption: "Anime beat sync edit",
          views: 40000,
        },
      }));
      act(() => useStore.getState().accumulateDiscoverCandidates(strong, { genreId: "anime" }));
      expect(categoryCandidates(useStore.getState().discoverCandidates, "anime")).toHaveLength(
        DISCOVER_CATEGORY_MAX,
      );
      type("feed-reference-url", "https://instagram.com/reel/NativeEdit/");
      if (!keep) act(() => $("feed-reference-keep").click());
      submit();
      const key = "https://www.instagram.com/p/NativeEdit";
      const selected = categoryCandidates(useStore.getState().discoverCandidates, "anime").find(
        (item) => item.url === key,
      );
      expect(selected).toBeDefined();
      const native: DiscoverItem = {
        ...selected!,
        title: "#anime",
        snippet: "#anime",
        stats: { likes: 5 },
        evidence: { source: "instagram-public-embed", observedAt: at, caption: "#anime", likes: 5 },
      };
      act(() => useStore.getState().accumulateDiscoverCandidates([native], { genreId: "anime" }));
      const items = categoryCandidates(useStore.getState().discoverCandidates, "anime");
      expect(items).toHaveLength(DISCOVER_CATEGORY_MAX);
      expect(items.find((item) => item.url === key)?.evidence).toEqual(native.evidence);
      const options = { genreId: "anime", feedback: useStore.getState().discoverFeedback };
      const ranked = rankDiscoverItems(items, options);
      expect(ranked.items.some((item) => item.url === key)).toBe(keep);
      expect(
        rankDiscoverItems(items, { ...options, mode: "popular" }).items.some(
          (item) => item.url === key,
        ),
      ).toBe(false);
    },
  );
});
