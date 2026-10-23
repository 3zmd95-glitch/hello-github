// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/store";
import MoreScreen from "./MoreScreen";
import type { World } from "./useWorld";

// ☰ The "More" page of each world, rendered for real in jsdom. Since tools/20 every Social row is a Social route
// (Settings is /social/settings, no Discover shortcut); e2e/world.spec.ts follows the links in a browser.
// Round 35 (iOS look): Social's language and sound controls live in More's quick settings, not the top bar, and
// Social's More is grouped lists whose rows use the tab bar's words (tools/18 §6).

let host: HTMLDivElement;
let root: Root;

const ids = () =>
  [...host.querySelectorAll<HTMLElement>("a[data-testid]")].map((a) =>
    a.getAttribute("data-testid"),
  );
const entry = (testId: string) => host.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

function mount(world: World, lang: "ar" | "en" = "ar"): void {
  act(() => {
    useStore.getState().setSettings({ lang });
    root.render(createElement(MoreScreen, { world }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no ResizeObserver (the language Segmented uses one).
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.getState().setSettings({ lang: "ar", sound: true, appearance: "light" });
  vi.unstubAllGlobals();
});

describe("Social More", () => {
  it("lists the Social sections, then Settings and the way back to Training", () => {
    mount("social");
    expect(ids()).toEqual([
      "more-website",
      "more-business",
      "more-automations",
      "more-replies",
      "more-inbox",
      "more-settings",
      "more-training",
    ]);
  });

  it("links Settings to Social's own page and has no Discover row (tools/20)", () => {
    mount("social");
    expect(entry("more-settings")!.getAttribute("href")).toMatch(/^[/]social[/]settings[/]?$/);
    expect(entry("more-discover")).toBeNull();
    // Every row but the way back stays in Social.
    for (const a of host.querySelectorAll<HTMLAnchorElement>("a[data-testid]")) {
      if (a.dataset.testid === "more-training") continue;
      expect(a.getAttribute("href"), a.dataset.testid).toMatch(/^[/]social([/]|$)/);
    }
    expect(entry("more-website")!.querySelector(".ios-chip")!.textContent).toBe("قريب");
  });

  it("names its rows with the tab bar's words, without emoji, and says what Training is", () => {
    mount("social");
    expect(entry("more-replies")!.textContent).toBe("الردود التلقائية");
    expect(entry("more-inbox")!.textContent).toBe("الرسائل");
    expect(entry("more-inbox")!.getAttribute("href")).toMatch(/^\/social\/inbox\/?$/);
    expect(entry("more-automations")!.textContent).toBe("النشر التلقائي");
    expect(entry("more-settings")!.textContent).toBe("الإعدادات");
    const training = entry("more-training")!;
    expect(training.getAttribute("href")).toBe("/");
    expect(training.querySelector("b")!.textContent).toBe("ارجع للتدريب");
    expect(training.querySelector("small")!.textContent).toBe("عالمك البكسلي كما هو");
    expect(host.textContent).not.toMatch(/\p{Extended_Pictographic}/u);

    mount("social", "en");
    expect(entry("more-training")!.querySelector("small")!.textContent).toBe(
      "Your pixel world, as it is",
    );
  });

  it("has quick settings after the sections, before the way back: language, sound, all settings", () => {
    mount("social");
    const quick = [...host.querySelectorAll("section")].find((s) => s.querySelector("h2"))!;
    expect(quick.querySelector("h2")!.textContent).toBe("الإعدادات السريعة");
    // After the section links (their order is checked above), before the way back to Training.
    const follows = (a: Node, b: Node) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(entry("more-replies")!, quick)).toBeTruthy();
    expect(follows(quick, entry("more-training")!)).toBeTruthy();
    expect(quick.contains(entry("more-settings"))).toBe(true);

    // Appearance (tools/18 §12): light by default; a tap on Dark saves it.
    expect(entry("appearance-light")!.getAttribute("aria-checked")).toBe("true");
    expect(entry("appearance-dark")!.getAttribute("role")).toBe("radio");
    act(() => entry("appearance-dark")!.click());
    expect(useStore.getState().settings.appearance).toBe("dark");
    expect(entry("appearance-dark")!.getAttribute("aria-checked")).toBe("true");
    act(() => entry("appearance-light")!.click());
    expect(useStore.getState().settings.appearance).toBe("light");

    const en = entry("lang-en")!;
    expect(en.getAttribute("role")).toBe("radio");
    expect(entry("lang-ar")!.getAttribute("aria-checked")).toBe("true");
    // The switch is named by its row title (WCAG 2.5.3); its state is the checkbox's own.
    expect(entry("sound-toggle")!.getAttribute("aria-label")).toBe("الأصوات");
    act(() => en.click());
    expect(useStore.getState().settings.lang).toBe("en");
    expect(entry("lang-en")!.getAttribute("aria-checked")).toBe("true");
    expect(quick.querySelector("h2")!.textContent).toBe("Quick settings");

    const sound = entry("sound-toggle") as HTMLInputElement;
    expect(sound.getAttribute("role")).toBe("switch");
    expect(sound.checked).toBe(true);
    expect(sound.getAttribute("aria-label")).toBe("Sounds");
    act(() => sound.click());
    expect(useStore.getState().settings.sound).toBe(false);
    expect(sound.checked).toBe(false);
    expect(sound.getAttribute("aria-label")).toBe("Sounds");
  });
});

describe("Training More", () => {
  it("keeps its own list, with Discover once", () => {
    mount("training");
    expect(ids()).toEqual([
      "more-map",
      "more-notes",
      "more-planner",
      "more-review",
      "more-rewards",
      "more-discover",
      "more-settings",
    ]);
    expect(entry("more-discover")!.getAttribute("href")).toMatch(/^\/discover\/?$/);
    // Training keeps language and sound in its top bar.
    expect(host.querySelector("section")).toBeNull();
    expect(entry("lang-en")).toBeNull();
    expect(entry("sound-toggle")).toBeNull();
  });
});
