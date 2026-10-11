// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEWED_FORMAT_SEEDS } from "@/lib/formatSeeds";
import { localInstagramSource } from "@/lib/formatSources";
import { useStore } from "@/store";
import type { InstagramSource } from "@/lib/formatVerification";
import FormatSourceInspector from "./FormatSourceInspector";

vi.mock("@/lib/formatSources", async (original) => ({
  ...(await original<typeof import("@/lib/formatSources")>()),
  localInstagramSource: vi.fn(),
}));

const format = REVIEWED_FORMAT_SEEDS[0];
let host: HTMLDivElement;
let root: Root;
const readSource = vi.mocked(localInstagramSource);
const source = (): InstagramSource => ({
  status: "available",
  url: format.samples.find((sample) => sample.platform === "ig")!.url,
  title: "Repeated figures",
  description: "A real source caption",
  author: "editor.one",
  thumbnailUrl: "https://scontent.cdninstagram.com/image.jpg",
  observedAt: new Date(Date.now() - 1000).toISOString(),
  provenance: "instagram-public-embed",
  audio: format.audio,
});
const render = () =>
  act(() => root.render(createElement(FormatSourceInspector, { formats: [format] })));
const submit = () =>
  host
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.getState().reset();
  useStore.getState().setSettings({ lang: "en" });
  readSource.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("saved explicit format checks", () => {
  it("restores a source check without fetching again, then removes the displayed saved result", async () => {
    readSource.mockResolvedValue(source());
    render();
    await act(async () => {
      submit();
    });
    expect(useStore.getState().formatObservations).toHaveLength(1);
    expect(host.querySelector('[data-testid="format-source-result"]')?.textContent).toContain(
      "A real source caption",
    );
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(host.querySelector('[data-testid="format-check-reused"]')?.textContent).toContain(
      "No new check was run",
    );
    expect(readSource).toHaveBeenCalledTimes(1);
    act(() =>
      host.querySelector<HTMLButtonElement>('[data-testid="format-remove-check"]')!.click(),
    );
    expect(useStore.getState().formatObservations).toHaveLength(0);
    expect(host.querySelector('[data-testid="format-source-result"]')).toBeNull();
  });

  it("ignores a source response arriving after a library reset", async () => {
    let resolve!: (result: InstagramSource) => void;
    readSource.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render();
    await act(async () => {
      submit();
    });
    const signal = readSource.mock.calls[0][1];
    act(() => useStore.getState().reset());
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      resolve(source());
    });
    expect(useStore.getState().formatObservations).toHaveLength(0);
    expect(host.querySelector('[data-testid="format-source-result"]')).toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
