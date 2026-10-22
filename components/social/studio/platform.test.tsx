// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLATFORMS } from "@/lib/domain";
import { PLATFORM_META } from "@/lib/social";
import { PlatformPicker } from "./platform";

// The world comes from the route: "/" is Training (the skill sheet's bridge), "/social/…" is Social.
const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

function buttons(path: string): HTMLButtonElement[] {
  nav.path = path;
  act(() => root.render(<PlatformPicker idPrefix="pick" label="Post to" onPick={() => {}} />));
  return PLATFORMS.map((p) => host.querySelector<HTMLButtonElement>(`[data-testid="pick-${p}"]`)!);
}

describe("PlatformPicker", () => {
  it("keeps each platform's emoji in Training", () => {
    for (const [i, button] of buttons("/").entries()) {
      expect(button.textContent).toContain(PLATFORM_META[PLATFORMS[i]].icon);
      expect(button.querySelector("svg")).toBeNull();
    }
  });

  it("draws the brand glyph in Social, with no emoji", () => {
    for (const button of buttons("/social/ideas/")) {
      expect(button.querySelector("svg")).not.toBeNull();
      expect(button.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
