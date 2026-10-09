// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/store";
import { REVIEWED_FORMAT_SEEDS } from "@/lib/formatSeeds";
import type { EditFormat } from "@/lib/editFormats";
import type { TrendingEffects } from "@/lib/effects";
import EditFormats from "./EditFormats";

const CHECKED = new Date(Date.now() - 60_000).toISOString();
const FORMAT: EditFormat = {
  key: "test-trip-cutouts",
  name: { en: "TRIP BABY cutout montage", ar: "مونتاج تكرار الشخص" },
  visualPattern: { en: "Repeated cutout figures", ar: "تكرار الشخص في اللقطة" },
  audio: { title: "TRIP BABY", artist: "A$AP Rocky" },
  firstSeen: CHECKED,
  lastChecked: CHECKED,
  source: "indexed-public-posts",
  evidence: {
    state: "repeated",
    creators7d: 3,
    posts7d: 4,
    latestPostAt: CHECKED,
    scope: "indexed-public-posts",
  },
  samples: [
    {
      url: "https://www.instagram.com/reel/TEST/",
      title: "Cutout example",
      platform: "ig",
      handle: "editor",
      published: CHECKED,
      observedAt: CHECKED,
      patternQuote: "Repeated cutout figures",
      audioQuote: "TRIP BABY",
      basis: "caption",
    },
  ],
};
const DATA: TrendingEffects = { status: "ok", items: [], formatVersion: 1, formats: [FORMAT] };
let host: HTMLDivElement;
let root: Root;
const picked = vi.fn();
const card = () =>
  host.querySelector<HTMLElement>(`[data-testid="edit-format"][data-key="${FORMAT.key}"]`)!;
const button = (id: string, container: ParentNode = host) =>
  container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
function render(data: TrendingEffects | null = DATA) {
  act(() => root.render(createElement(EditFormats, { data, onPick: picked })));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  useStore.getState().reset();
  useStore.getState().setSettings({ lang: "en" });
  picked.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("edit format discovery cards", () => {
  it("pairs a source preview and audio with explicit metadata evidence, never a popularity badge", () => {
    render();
    expect(card().textContent).toContain("Repeated in recent sample");
    expect(card().textContent).toContain("3 identified accounts · 4 indexed posts");
    expect(card().textContent).toContain("actual caption, audio and video have not been verified");
    expect(card().querySelector('[data-testid="format-preview"]')).not.toBeNull();
    expect(
      card().querySelector('[data-testid="format-preview"] [data-testid="result-play"]'),
    ).not.toBeNull();
    expect(card().querySelector('[data-testid="result-open"]')).toBeNull();
    const link = card().querySelector<HTMLAnchorElement>('[data-testid="format-example"]')!;
    expect(link.href).toBe(FORMAT.samples[0].url);
    expect(link.rel).toBe("noopener noreferrer");
    act(() => button("format-find-examples", card()).click());
    expect(picked).toHaveBeenLastCalledWith(
      expect.stringContaining("TRIP BABY"),
      "examples",
      FORMAT,
    );
    expect(picked.mock.lastCall![0]).toMatch(/cutout|figures/i);
    act(() => button("format-find-tutorials", card()).click());
    expect(picked).toHaveBeenLastCalledWith(
      expect.stringContaining("TRIP BABY"),
      "tutorials",
      FORMAT,
    );
    expect(picked.mock.lastCall![0]).toMatch(/tutorial/i);
  });

  it("follows a returned format, retains it without the backend and removes it explicitly", () => {
    render();
    act(() => button("format-follow", card()).click());
    expect(button("format-follow", card()).getAttribute("aria-pressed")).toBe("true");
    render({ status: "ok", items: [] });
    act(() => button("formats-following").click());
    expect(host.querySelectorAll('[data-testid="edit-format"]')).toHaveLength(1);
    expect(card()).not.toBeNull();
    act(() => button("format-follow", card()).click());
    expect(host.textContent).toContain("Follow a format to keep");
  });

  it("keeps reviewed references honest when the Worker has no format support", () => {
    render({ status: "ok", items: [] });
    expect(host.querySelector('[data-testid="formats-awaiting-scan"]')).not.toBeNull();
    expect(host.textContent).toContain("Reviewed reference");
    expect(host.textContent).toContain("current momentum unconfirmed");
    expect(host.textContent).not.toContain("0 identified accounts");
    expect(host.textContent).toContain(REVIEWED_FORMAT_SEEDS[0].audio!.title);
  });

  it("renders Arabic RTL with readable audio text and translated follow controls", () => {
    useStore.getState().setSettings({ lang: "ar" });
    render();
    expect(host.querySelector('[data-testid="edit-formats"]')!.getAttribute("dir")).toBe("rtl");
    expect(card().textContent).toContain("مونتاج تكرار الشخص");
    expect(card().textContent).toContain("TRIP BABY");
    expect(button("format-follow", card()).textContent).toBe("تابع الفكرة");
    expect(button("format-find-examples", card()).textContent).toBe("شوف أمثلة");
  });

  it("keeps three clear browse actions and honest caveats visible while evidence and save controls start closed", () => {
    render();
    const details = card().querySelector<HTMLDetailsElement>('[data-testid="format-sources"]')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain("3 identified accounts · 4 indexed posts");
    expect(button("inspiration-save", card()).closest("details")).toBe(details);
    expect(
      card().querySelector('[data-testid="format-evidence-state"]')!.closest("details"),
    ).toBeNull();
    const caveat = card().querySelector('[data-testid="format-evidence-caveat"]')!;
    expect(caveat.textContent).toContain("has not been visually verified");
    expect(caveat.closest("details")).toBeNull();
    const actions = [...card().querySelectorAll("button")].filter(
      (element) => !element.closest("details") && element.dataset.testid !== "result-play",
    );
    expect(actions.map((element) => element.textContent)).toEqual([
      "Find examples",
      "Learn this edit",
      "Follow format",
    ]);
    expect(card().querySelectorAll("h3")).toHaveLength(1);
    expect(host.querySelector('[data-testid="format-inspector"]')).toBeNull();
    act(() => details.querySelector("summary")!.click());
    expect(details.open).toBe(true);
    act(() => button("inspiration-save", details).click());
    expect(
      useStore
        .getState()
        .inspirations.some((entry) => entry.ref.url === "https://www.instagram.com/p/TEST"),
    ).toBe(true);
  });

  it("leaves freshness warnings visible even when evidence details are collapsed", () => {
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    render({
      ...DATA,
      formats: [
        { ...FORMAT, lastChecked: old, evidence: { ...FORMAT.evidence, latestPostAt: old } },
      ],
    });
    const warning = card().querySelector('[data-testid="format-freshness"]')!;
    expect(warning.textContent).toContain("Older evidence");
    expect(warning.closest("details")).toBeNull();
    expect(card().querySelector('[data-testid="format-evidence-state"]')!.textContent).toBe(
      "Candidate format",
    );
  });

  it("judges a new manual scan at its check time after the panel has been open for a while", () => {
    render();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    render({
      ...DATA,
      updatedAt: later,
      formats: [
        { ...FORMAT, lastChecked: later, evidence: { ...FORMAT.evidence, latestPostAt: later } },
      ],
    });
    expect(card().querySelector('[data-testid="format-evidence-state"]')!.textContent).toBe(
      "Repeated in recent sample",
    );
    expect(card().querySelector('[data-testid="format-freshness"]')).toBeNull();
  });
});
