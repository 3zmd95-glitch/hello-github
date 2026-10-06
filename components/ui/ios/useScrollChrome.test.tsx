// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScrollChrome } from "./useScrollChrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ on, path }: { on: boolean; path: string }) {
  useScrollChrome(on, path);
  return null;
}

const html = document.documentElement;
let y = 0;
let root: Root | null = null;

beforeEach(() => {
  y = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  // One frame per scroll event, run at once.
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => (f(0), 1));
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

function mount(on = true, path = "/social") {
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<Probe on={on} path={path} />));
}

/** Scroll to `to` one pixel per frame, like a slow finger on a 120 Hz screen. */
function slowScroll(to: number) {
  const step = to > y ? 1 : -1;
  while (y !== to) {
    y += step;
    window.dispatchEvent(new Event("scroll"));
  }
}

describe("useScrollChrome", () => {
  it("writes the title progress and shows the compact slab past 44px", () => {
    mount();
    expect(html.style.getPropertyValue("--scroll-p")).toBe("0.000");
    expect(html.dataset.compact).toBeUndefined();
    slowScroll(28);
    expect(html.style.getPropertyValue("--scroll-p")).toBe("0.500");
    slowScroll(45);
    expect(html.dataset.compact).toBe("true");
    slowScroll(44);
    expect(html.dataset.compact).toBeUndefined();
  });

  it("minimizes the tab bar on a slow scroll down past 140px and restores it on a slow scroll up", () => {
    mount();
    slowScroll(139);
    expect(html.dataset.tabbar).toBeUndefined();
    slowScroll(300);
    expect(html.dataset.tabbar).toBe("mini");
    slowScroll(295);
    expect(html.dataset.tabbar).toBe("mini");
    slowScroll(280);
    expect(html.dataset.tabbar).toBeUndefined();
  });

  it("clears everything when disabled or unmounted", () => {
    mount();
    slowScroll(300);
    expect(html.dataset.tabbar).toBe("mini");
    act(() => root!.render(<Probe on={false} path="/" />));
    expect(html.style.getPropertyValue("--scroll-p")).toBe("");
    expect(html.dataset.compact).toBeUndefined();
    expect(html.dataset.tabbar).toBeUndefined();
    act(() => root!.render(<Probe on path="/social" />));
    expect(html.dataset.compact).toBe("true");
    act(() => root!.unmount());
    root = null;
    expect(html.dataset.compact).toBeUndefined();
    window.dispatchEvent(new Event("scroll"));
    expect(html.dataset.compact).toBeUndefined();
  });
});
