// @vitest-environment jsdom
import { act, createElement, Fragment, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import * as client from "@/lib/discoverCreator";
import { useStore } from "@/store";
import { useCreatorExpansion, type CreatorExpansionQueue } from "./useCreatorExpansion";
import CreatorExpansionAction, { CreatorExpansionStatus } from "./CreatorExpansionAction";

const channel = `UC${"A".repeat(22)}`;
const profile = `https://www.youtube.com/channel/${channel}`;
function item(id: number, title = "Anime speed ramp edit", views = 40_000): DiscoverItem {
  const at = new Date().toISOString();
  return {
    platform: "yt",
    url: `https://www.youtube.com/watch?v=Creator${String(id).padStart(4, "0")}`,
    title,
    snippet: title,
    handle: "Editor",
    profile,
    lang: "en",
    section: "example",
    evidence: {
      source: "youtube-api",
      observedAt: at,
      author: "Editor",
      caption: title,
      views,
      published: at,
    },
  };
}
const success = (items: DiscoverItem[], cached = false): client.YoutubeCreatorResult => ({
  ok: true,
  channel: { id: channel, profile, author: "Editor" },
  items,
  examined: 12,
  omitted: 12 - items.length,
  cached,
  checkedAt: new Date().toISOString(),
  requests: cached ? 0 : 4,
});
let host: HTMLDivElement;
let root: Root;
let queue: CreatorExpansionQueue;
let seed: DiscoverItem;
let props: Parameters<typeof useCreatorExpansion>[0];
function Harness() {
  const value = useCreatorExpansion(props);
  useLayoutEffect(() => {
    queue = value;
  });
  return createElement(
    Fragment,
    null,
    props.rows[0] && createElement(CreatorExpansionAction, { queue: value, row: props.rows[0] }),
    createElement(CreatorExpansionStatus, { queue: value }),
  );
}
const render = () => act(() => root.render(createElement(Harness)));
const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.setState({
    discoverLibraryStatus: "ready",
    discoverLibraryEpoch: "epoch",
    discoverCandidates: [],
    discoverFeedback: [],
    inspirations: [],
  });
  useStore.getState().setSettings({ lang: "en", apiKeys: { youtube: "test-key" } });
  seed = item(0);
  useStore.getState().accumulateDiscoverCandidates([seed], { genreId: "anime" });
  props = {
    rows: [{ item: seed, genreId: "anime" }],
    active: true,
    context: "browse:anime",
    mode: "inspiration",
    lang: "en",
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(client, "expandYoutubeCreator").mockResolvedValue(
    success([
      item(1),
      item(2, "Anime speed ramp edit", 5),
      item(3, "Anime masking tutorial step by step", 20),
    ]),
  );
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("explicit creator upload acquisition", () => {
  it("fetches only on click, preserves the row category, separates checked/new/qualified and creates no preferences or saves", async () => {
    render();
    expect(client.expandYoutubeCreator).not.toHaveBeenCalled();
    expect($("feed-more-creator")).not.toBeNull();
    await act(async () => {
      await queue.run(props.rows[0]);
    });
    expect(client.expandYoutubeCreator).toHaveBeenCalledTimes(1);
    expect(useStore.getState().discoverCandidates).toHaveLength(4);
    expect(useStore.getState().discoverCandidates.every((entry) => entry.genreId === "anime")).toBe(
      true,
    );
    expect($("feed-creator-status")?.textContent).toContain(
      "12 uploads checked · 3 new references kept · 1 match",
    );
    expect(useStore.getState().discoverFeedback).toEqual([]);
    expect(useStore.getState().inspirations).toEqual([]);
    vi.mocked(client.expandYoutubeCreator).mockResolvedValue(
      success([item(1), item(2), item(3)], true),
    );
    await act(async () => {
      await queue.run(props.rows[0]);
    });
    expect($("feed-creator-status")?.textContent).toContain("0 new references kept · 0 match");
    expect($("feed-creator-status")?.textContent).toContain("recent cached check");
    act(() => useStore.getState().setSettings({ lang: "ar" }));
    expect($("feed-more-creator")?.textContent).toBe("أكثر من نفس المبدع");
    expect(client.expandYoutubeCreator).toHaveBeenCalledTimes(2);
  });
  it("hides the action without a key, native source/channel identity or useful category evidence", () => {
    act(() => useStore.getState().setSettings({ apiKeys: { youtube: "" } }));
    expect($("feed-more-creator")).toBeNull();
    act(() => useStore.getState().setSettings({ apiKeys: { youtube: "test-key" } }));
    for (const next of [
      { ...seed, evidence: undefined },
      { ...seed, profile: "https://www.youtube.com/@editor" },
      item(0, "Anime speed ramp edit", 5),
      item(0, "Coffee machine repair", 100_000),
    ]) {
      props = { ...props, rows: [{ item: next, genreId: "anime" }] };
      render();
      expect($("feed-more-creator")).toBeNull();
    }
    expect(client.expandYoutubeCreator).not.toHaveBeenCalled();
  });
  it("reports a valid empty upload batch without adding anything", async () => {
    vi.mocked(client.expandYoutubeCreator).mockResolvedValue(success([]));
    await act(async () => {
      await queue.run(props.rows[0]);
    });
    expect($("feed-creator-status")?.textContent).toContain("0 new references kept · 0 match");
    expect(useStore.getState().discoverCandidates).toHaveLength(1);
  });
  it("uses For You's newer shared native source without requiring an older category copy to match", async () => {
    const newer = {
      ...seed,
      evidence: {
        ...seed.evidence!,
        caption: "Anime compositing edit",
        observedAt: new Date(Date.now() + 1).toISOString(),
      },
    };
    act(() => useStore.getState().accumulateDiscoverCandidates([newer], { genreId: "cars" }));
    props = { ...props, context: "for-you", rows: [{ item: newer, genreId: "anime" }] };
    render();
    await act(async () => {
      await queue.run(props.rows[0]);
    });
    expect(queue.outcome?.status).toBe("done");
    expect(queue.busy).toBe(false);
    expect(
      useStore.getState().discoverCandidates.filter((candidate) => candidate.genreId === "anime"),
    ).toHaveLength(4);
  });
  it("keeps the feed-level outcome when the seed leaves the visible For You slice without leaving its category library", async () => {
    let resolve!: (value: client.YoutubeCreatorResult) => void;
    vi.mocked(client.expandYoutubeCreator).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let running!: Promise<void>;
    act(() => {
      running = queue.run(props.rows[0]);
    });
    props = { ...props, rows: [] };
    render();
    expect(queue.busy).toBe(true);
    expect($("feed-creator-cancel")).not.toBeNull();
    await act(async () => {
      resolve(success([item(1)]));
      await running;
    });
    expect($("feed-creator-status")?.textContent).toContain("1 new references kept · 1 match");
    expect(queue.busy).toBe(false);
    // Retention can evict the seed after success; the completed receipt still matters.
    act(() =>
      useStore.setState({
        discoverCandidates: useStore
          .getState()
          .discoverCandidates.filter((candidate) => candidate.item.url !== seed.url),
      }),
    );
    expect($("feed-creator-status")?.textContent).toContain("1 new references kept · 1 match");
    expect(queue.outcome?.status).toBe("done");
  });
  it.each(["quota", "auth", "unavailable", "network"] as const)(
    "shows %s without retrying or replacing existing cards",
    async (error) => {
      vi.mocked(client.expandYoutubeCreator).mockResolvedValue({
        ok: false,
        error,
        stage: "uploads",
        requests: 3,
      });
      await act(async () => {
        await queue.run(props.rows[0]);
      });
      expect(queue.forItem(props.rows[0])).toMatchObject({ status: "error", error });
      expect(useStore.getState().discoverCandidates).toHaveLength(1);
      expect(client.expandYoutubeCreator).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["cancel", "navigation", "category", "mode", "epoch", "key", "seed"] as const)(
    "aborts and rejects late writes after %s changes",
    async (change) => {
      let resolve!: (value: client.YoutubeCreatorResult) => void;
      vi.mocked(client.expandYoutubeCreator).mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      let running!: Promise<void>;
      act(() => {
        running = queue.run(props.rows[0]);
      });
      const signal = vi.mocked(client.expandYoutubeCreator).mock.calls[0][2]!.signal!;
      if (change === "cancel") act(() => queue.cancel());
      else if (change === "epoch")
        act(() => useStore.setState({ discoverLibraryEpoch: "replacement" }));
      else if (change === "key")
        act(() => useStore.getState().setSettings({ apiKeys: { youtube: "different-key" } }));
      else {
        props =
          change === "navigation"
            ? { ...props, active: false }
            : change === "category"
              ? { ...props, context: "browse:coffee" }
              : change === "mode"
                ? { ...props, mode: "learning" }
                : {
                    ...props,
                    rows: [
                      {
                        genreId: "anime",
                        item: {
                          ...seed,
                          evidence: { ...seed.evidence!, caption: "changed source caption" },
                        },
                      },
                    ],
                  };
        render();
      }
      expect(signal.aborted).toBe(true);
      await act(async () => {
        resolve(success([item(1)]));
        await running;
      });
      expect(useStore.getState().discoverCandidates).toHaveLength(1);
    },
  );
});
