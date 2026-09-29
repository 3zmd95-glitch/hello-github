// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/store";
import MoreScreen from "./MoreScreen";
import type { World } from "./useWorld";

// ☰ The "More" page of each world, rendered for real in jsdom. Round 31b: Social's list gets the 🔎 Discover
// shortcut (Discover is the one place for edit genres); e2e/world.spec.ts follows the link in a browser.

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
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.getState().setSettings({ lang: "ar" });
});

describe("Social More", () => {
  it("lists the Social sections, then Discover, Settings and the way back to Training", () => {
    mount("social");
    expect(ids()).toEqual([
      "more-website",
      "more-business",
      "more-automations",
      "more-discover",
      "more-settings",
      "more-training",
    ]);
  });

  it("links Discover to /discover with the name it has in Training, in both languages", () => {
    mount("social");
    const discover = entry("more-discover")!;
    expect(discover.getAttribute("href")).toMatch(/^\/discover\/?$/);
    expect(discover.textContent).toContain("🔎 اكتشف");
    // Discover is built: no "soon" chip on it (Website and Business keep theirs).
    expect(discover.querySelector(".px-chip")).toBeNull();
    expect(entry("more-website")!.querySelector(".px-chip")).not.toBeNull();

    mount("social", "en");
    expect(entry("more-discover")!.textContent).toContain("🔎 Discover");
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
  });
});
