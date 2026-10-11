// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import type { DiscoverSemanticRequest, DiscoverSemanticResponse } from "@/lib/discoverSemantic";
import * as client from "@/lib/discoverSemanticClient";
import { useStore } from "@/store";
import { useCategorySemantic, type CategorySemanticQueue } from "./useCategorySemantic";

const selection = {
  provider: "chatgpt" as const,
  model: "chosen-model",
  effort: "high",
  accountId: "account",
};
const caption = "We brought this little story to life. #anime";
const item = (id: number, tt = false): DiscoverItem => ({
  platform: tt ? "tt" : "ig",
  url: tt
    ? `https://www.tiktok.com/@editor${id}/video/769000000000000000${id}`
    : `https://www.instagram.com/p/Post${id}/`,
  title: "unrelated indexed title",
  snippet: "",
  handle: `editor${id}`,
  lang: "en",
  section: "example",
  offTopic: true,
  outsideCategory: true,
  evidence: {
    source: tt ? "tiktok-public-page" : "instagram-public-embed",
    availability: "available",
    caption,
    author: `editor${id}`,
    observedAt: new Date().toISOString(),
    likes: 3000 - id,
  },
});
function response(request: DiscoverSemanticRequest): DiscoverSemanticResponse {
  return {
    status: "assessed",
    selection: { ...selection, model: request.model, effort: request.effort },
    cached: false,
    modelCalls: 1,
    semantics: request.urls.map((url) => {
      const source = allItems.find((item) => item.url === url)!.evidence!;
      return {
        version: 1,
        url,
        genreId: request.genreId,
        checkedAt: new Date().toISOString(),
        model: request.model,
        effort: request.effort,
        source: {
          provenance: source.source as "instagram-public-embed" | "tiktok-public-page",
          caption: source.caption!,
          author: source.author!,
          observedAt: source.observedAt,
        },
        assessment: {
          category: "supported",
          categoryQuote: "#anime",
          project: "described",
          projectQuote: "We brought this little story to life.",
          reason: "Describes the project in the caption.",
        },
      };
    }),
  };
}
let queue: CategorySemanticQueue;
let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
let allItems: DiscoverItem[];
let items: DiscoverItem[];
let props: { genreId: string; active: boolean; lang: "en" | "ar"; platform: string; now: number };
function Harness() {
  const value = useCategorySemantic({ ...props, items });
  useLayoutEffect(() => {
    queue = value;
  });
  return null;
}
const render = () => act(() => root.render(createElement(Harness)));
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.setState({
    discoverLibraryStatus: "ready",
    discoverLibraryEpoch: "epoch",
    discoverCandidates: [],
    discoverFeedback: [],
  });
  allItems = Array.from({ length: 6 }, (_, id) => item(id, id > 2));
  items = allItems.slice(0, 1);
  useStore.getState().accumulateDiscoverCandidates(allItems, { genreId: "anime" });
  props = { genreId: "anime", active: true, lang: "en", platform: "all", now: Date.now() };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  vi.spyOn(client, "assessCategorySemantic").mockImplementation(async (request) => ({
    ok: true,
    data: response(request),
  }));
  render();
  act(() => {
    queue.setChoice(selection);
    queue.setOpen(true);
  });
});
afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("explicit caption batch", () => {
  it("does no work from renders or feedback; one click batches at most three source-ready store/current candidates", async () => {
    render();
    act(() =>
      useStore
        .getState()
        .setDiscoverFeedback({
          url: allItems[5].url,
          platform: "tt",
          creator: allItems[5].handle,
          genreId: "anime",
          action: "more",
        }),
    );
    expect(client.assessCategorySemantic).not.toHaveBeenCalled();
    await act(async () => {
      await queue.assess();
    });
    expect(client.assessCategorySemantic).toHaveBeenCalledTimes(1);
    const request = vi.mocked(client.assessCategorySemantic).mock.calls[0][0];
    expect(request).toMatchObject({
      ...selection,
      genreId: "anime",
      lang: "en",
      urls: allItems.slice(0, 3).map((item) => item.url),
    });
    expect(
      useStore.getState().discoverCandidates.filter((candidate) => candidate.semantic),
    ).toHaveLength(3);
    expect(queue.eligibleCount).toBe(3);
    expect(queue.progress).toMatchObject({ status: "done", assessed: 3, total: 3 });
    render();
    expect(client.assessCategorySemantic).toHaveBeenCalledTimes(1);
  });
  it("honors the current platform and skips equivalent fresh records even on another explicit click", async () => {
    props = { ...props, platform: "tt" };
    render();
    await act(async () => {
      await queue.assess();
    });
    expect(vi.mocked(client.assessCategorySemantic).mock.calls[0][0].urls).toEqual(
      allItems.slice(3).map((item) => item.url),
    );
    await act(async () => {
      await queue.assess();
    });
    expect(client.assessCategorySemantic).toHaveBeenCalledTimes(1);
    expect(queue.eligibleCount).toBe(0);
  });
  it.each(["source_unavailable", "account_changed", "budget", "busy"])(
    "stops after one unavailable %s batch",
    async (error) => {
      vi.mocked(client.assessCategorySemantic).mockResolvedValue({
        ok: true,
        data: { status: "unavailable", selection, error, modelCalls: 0 },
      });
      await act(async () => {
        await queue.assess();
      });
      expect(client.assessCategorySemantic).toHaveBeenCalledTimes(1);
      expect(queue.progress).toMatchObject({ status: "error", error, assessed: 0 });
    },
  );
  it.each([
    "cancel",
    "close",
    "category",
    "language",
    "platform",
    "navigation",
    "model",
    "account",
    "epoch",
    "loading",
    "unmount",
  ])("aborts and rejects a late response after %s", async (reason) => {
    let resolve!: (result: client.CategorySemanticResult) => void;
    vi.mocked(client.assessCategorySemantic).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = queue.assess();
    });
    const [request, signal] = vi.mocked(client.assessCategorySemantic).mock.calls[0];
    act(() => {
      if (reason === "cancel") queue.cancel();
      if (reason === "close") queue.setOpen(false);
      if (reason === "model") queue.setChoice({ ...selection, model: "other" });
      if (reason === "account") queue.setChoice({ ...selection, accountId: "other" });
      if (reason === "epoch") useStore.setState({ discoverLibraryEpoch: "new" });
      if (reason === "loading") useStore.setState({ discoverLibraryStatus: "loading" });
      if (reason === "category") props = { ...props, genreId: "cars" };
      if (reason === "language") props = { ...props, lang: "ar" };
      if (reason === "platform") props = { ...props, platform: "tt" };
      if (reason === "navigation") props = { ...props, active: false };
      if (reason === "unmount") {
        root.unmount();
        mounted = false;
      } else root.render(createElement(Harness));
    });
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve({ ok: true, data: response(request) });
      await pending;
    });
    expect(useStore.getState().discoverCandidates.some((candidate) => candidate.semantic)).toBe(
      false,
    );
    expect(client.assessCategorySemantic).toHaveBeenCalledTimes(1);
  });
  it("allows another explicit check after expiry or a changed source caption, without running automatically", async () => {
    props = { ...props, platform: "ig" };
    render();
    await act(async () => {
      await queue.assess();
    });
    expect(queue.eligibleCount).toBe(0);
    items = [
      {
        ...allItems[0],
        evidence: { ...allItems[0].evidence!, caption: `${caption} A new chapter.` },
      },
    ];
    render();
    expect(queue.eligibleCount).toBe(1);
    props = { ...props, now: Date.now() + 86400001 };
    render();
    expect(queue.eligibleCount).toBe(3);
    expect(client.assessCategorySemantic).toHaveBeenCalledTimes(1);
  });
});
