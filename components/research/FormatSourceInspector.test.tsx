// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEWED_FORMAT_SEEDS } from "@/lib/formatSeeds";
import { inspectFormatPreview, localInstagramSource } from "@/lib/formatSources";
import { summarizeFormatObservations } from "@/lib/formatObservations";
import type { AiChoice } from "@/lib/localAi";
import { useStore } from "@/store";
import { formatVerificationTarget, type InstagramSource } from "@/lib/formatVerification";
import FormatSourceInspector from "./FormatSourceInspector";

vi.mock("@/lib/formatSources", async (original) => ({
  ...(await original<typeof import("@/lib/formatSources")>()),
  localInstagramSource: vi.fn(),
  inspectFormatPreview: vi.fn(),
}));
vi.mock("./AiConnectionControls", () => ({
  default: ({ onChange }: { onChange: (choice: AiChoice) => void }) =>
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "choose-test-model",
        onClick: () => onChange({ provider: "chatgpt", model: "chosen", effort: "max" }),
      },
      "Choose model",
    ),
}));

const format = REVIEWED_FORMAT_SEEDS[0];
let host: HTMLDivElement;
let root: Root;
const readSource = vi.mocked(localInstagramSource);
const inspect = vi.mocked(inspectFormatPreview);
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
const inspectSaved = async () => {
  act(() => {
    const panel = Array.from(host.querySelectorAll("details")).at(-1)!;
    panel.open = true;
    panel.dispatchEvent(new Event("toggle"));
  });
  act(() => host.querySelector<HTMLButtonElement>('[data-testid="choose-test-model"]')!.click());
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[data-testid="format-inspect-preview"]')!.click(),
  );
};
function saveMatch() {
  const original = source();
  useStore.getState().recordFormatObservation({
    target: formatVerificationTarget(format),
    source: original,
    inspection: {
      provider: "chatgpt",
      model: "chosen",
      effort: "max",
      verification: {
        version: 1,
        formatKey: format.key,
        url: original.url,
        checkedAt: new Date(Date.now() - 500).toISOString(),
        visual: "match",
        audio: "match",
        teaching: "unknown",
        observations: ["Repeated cutouts in the sampled frames"],
        limitations: ["sampled_frames", "motion_partial", "synchronization_unverified"],
        basis: "source-frames-and-metadata",
        frames: [
          { timestampSeconds: 0, sha256: "a".repeat(64) },
          { timestampSeconds: 1, sha256: "b".repeat(64) },
        ],
        durationSeconds: 2,
        videoSha256: "c".repeat(64),
        framesObservedAt: original.observedAt!,
        frameCount: 2,
        source: original,
      },
    },
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.getState().reset();
  useStore.getState().setSettings({ lang: "en" });
  readSource.mockReset();
  inspect.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("saved explicit format checks", () => {
  it("records an AI check's actual unavailable receipt and removes the previous positive after reload", async () => {
    saveMatch();
    render();
    expect(host.querySelector('[data-testid="format-visual-result"]')).not.toBeNull();
    expect(
      summarizeFormatObservations(
        useStore.getState().formatObservations,
        formatVerificationTarget(format),
      ).sampledMatches,
    ).toBe(1);
    const unavailable: InstagramSource = {
      status: "unavailable",
      url: source().url,
      title: "",
      description: "",
      thumbnailUrl: "",
      author: "",
      observedAt: null,
      provenance: "instagram-public-embed",
    };
    inspect.mockResolvedValue({ ok: false, error: "source_unavailable", source: unavailable });
    await inspectSaved();
    expect(host.querySelector('[data-testid="format-visual-result"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(useStore.getState().formatObservations[0]).toMatchObject({
      source: { status: "unavailable", observedAt: null },
    });
    expect(useStore.getState().formatObservations[0].inspection).toBeUndefined();
    expect(
      summarizeFormatObservations(
        useStore.getState().formatObservations,
        formatVerificationTarget(format),
      ),
    ).toEqual({ checkedPosts: 1, audioMatches: 0, sampledMatches: 0, recentCreators: 0 });
    act(() => root.unmount());
    root = createRoot(host);
    render();
    expect(host.querySelector('[data-testid="format-visual-result"]')).toBeNull();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(readSource).not.toHaveBeenCalled();
  });

  it.each(["source_frames_unavailable", "ai_timeout", "source_unavailable"])(
    "keeps prior evidence for %s without an unavailable source receipt",
    async (error) => {
      saveMatch();
      const original = useStore.getState().formatObservations;
      render();
      inspect.mockResolvedValue({ ok: false, error });
      await inspectSaved();
      expect(host.querySelector('[data-testid="format-visual-result"]')).not.toBeNull();
      expect(host.querySelector('[role="alert"]')).not.toBeNull();
      expect(useStore.getState().formatObservations).toBe(original);
      expect(
        summarizeFormatObservations(original, formatVerificationTarget(format)).sampledMatches,
      ).toBe(1);
      expect(readSource).not.toHaveBeenCalled();
    },
  );

  it("opens the original imported target after a same-key format changes or disappears", async () => {
    const target = formatVerificationTarget(format);
    useStore.getState().addFormatCandidates(target, [source().url]);
    const changed = { ...format, name: { en: "A changed live description" } };
    act(() =>
      root.render(
        createElement(FormatSourceInspector, {
          formats: [changed],
          requestedTarget: target,
        }),
      ),
    );
    expect((host.querySelector("select") as HTMLSelectElement).value).toBe(JSON.stringify(target));
    expect(host.querySelectorAll('[data-testid="format-queued-post"]')).toHaveLength(1);
    expect(readSource).not.toHaveBeenCalled();
    readSource.mockResolvedValue(source());
    await act(async () => {
      submit();
    });
    expect(useStore.getState().formatObservations[0].target).toEqual(target);
    act(() =>
      root.render(
        createElement(FormatSourceInspector, {
          formats: [],
          requestedTarget: target,
        }),
      ),
    );
    expect(host.querySelector('[data-testid="format-source-result"]')?.textContent).toContain(
      "A real source caption",
    );
    expect(readSource).toHaveBeenCalledTimes(1);
    act(() =>
      host.querySelector<HTMLButtonElement>('[data-testid="format-remove-candidate"]')!.click(),
    );
    expect(host.querySelector('[data-testid="format-source-result"]')).toBeNull();
    expect(useStore.getState().formatObservations).toHaveLength(1);
  });
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
