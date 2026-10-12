// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { allGenres } from "@/lib/genres";
import { NATIVE_IMPORT_PREFIX } from "@/lib/discoverNativeImport";
import { useStore } from "@/store";
import NativeResultsImport from "./NativeResultsImport";
import { REVIEWED_FORMAT_SEEDS } from "@/lib/formatSeeds";

let host: HTMLDivElement;
let root: Root;
let onImported: ReturnType<typeof vi.fn<(genreId: string) => void>>;
const url = "https://www.tiktok.com/@editor/video/1234567890123456789";
const $ = (id: string) => host.querySelector<HTMLElement>(`[data-testid="native-import-${id}"]`)!;
const incoming = (value: unknown = { version: 1, platform: "tt", urls: [url] }) =>
  act(() => {
    history.replaceState(
      null,
      "",
      "/discover/" + NATIVE_IMPORT_PREFIX + encodeURIComponent(JSON.stringify(value)),
    );
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/discover/");
  useStore.setState({
    discoverLibraryStatus: "ready",
    discoverCandidates: [],
    discoverFeedback: [],
    inspirations: [],
    formatQueue: [],
  });
  useStore.getState().setSettings({ lang: "en" });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Import review must not fetch"))),
  );
  onImported = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(NativeResultsImport, { genres: allGenres([]), onImported })));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
it("requires review/category selection, then adds a neutral lead only once", () => {
  incoming();
  expect(location.hash).toBe("");
  expect(($("confirm") as HTMLButtonElement).disabled).toBe(true);
  expect(useStore.getState().discoverCandidates).toHaveLength(0);
  act(() => {
    ($("category") as HTMLSelectElement).value = "coffee";
    $("category").dispatchEvent(new Event("change", { bubbles: true }));
  });
  const button = $("confirm");
  act(() => {
    button.click();
    button.click();
  });
  expect(onImported).toHaveBeenCalledExactlyOnceWith("coffee");
  expect(useStore.getState().discoverCandidates).toMatchObject([
    { genreId: "coffee", origin: "manual", item: { url, snippet: "" } },
  ]);
  expect(useStore.getState().inspirations).toEqual([]);
  expect(useStore.getState().discoverFeedback).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it("cancel and malformed payloads never write or fetch", () => {
  incoming();
  act(() => $("cancel").click());
  incoming({ version: 1, platform: "tt", urls: [url], views: 1000000 });
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect($("confirm")).toBeNull();
  expect(useStore.getState().discoverCandidates).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});
it("disables importing during hydration and when all links are unchecked", () => {
  incoming();
  act(() => {
    useStore.setState({ discoverLibraryStatus: "loading" });
    ($("category") as HTMLSelectElement).value = "coffee";
    $("category").dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(($("confirm") as HTMLButtonElement).disabled).toBe(true);
  act(() => {
    useStore.setState({ discoverLibraryStatus: "ready" });
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  expect(($("confirm") as HTMLButtonElement).disabled).toBe(true);
  expect(useStore.getState().discoverCandidates).toEqual([]);
});
it("requires reducing a format import to six links and keeps it separate from category imports", () => {
  const urls = Array.from(
    { length: 7 },
    (_, i) => `https://www.instagram.com/reel/Queue00000${i}/`,
  );
  incoming({ version: 1, platform: "ig", urls });
  act(() => {
    ($("destination") as HTMLSelectElement).value = "format";
    $("destination").dispatchEvent(new Event("change", { bubbles: true }));
  });
  act(() => {
    ($("format") as HTMLSelectElement).value = REVIEWED_FORMAT_SEEDS[0].key;
    $("format").dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(($("confirm") as HTMLButtonElement).disabled).toBe(true);
  act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(($("confirm") as HTMLButtonElement).disabled).toBe(false);
  act(() => $("confirm").click());
  expect(useStore.getState().formatQueue).toHaveLength(6);
  expect(useStore.getState().discoverCandidates).toEqual([]);
  expect(onImported).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
