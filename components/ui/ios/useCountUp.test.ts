// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCountUp } from "./useCountUp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ v, dec }: { v: number; dec?: number }) {
  return createElement("b", null, useCountUp(v, { decimals: dec }));
}

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

function render(v: number, dec?: number) {
  const host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(createElement(Probe, { v, dec })));
  return host;
}

describe("useCountUp", () => {
  it("shows the final value at once when motion is reduced", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    expect(render(12430).textContent).toBe("12,430");
  });

  it("keeps the decimals and starts from zero when animating", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    expect(render(184.2, 1).textContent).toBe("0.0");
  });

  it("lands on the exact target once the duration has passed", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    let tick: FrameRequestCallback = () => {};
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => ((tick = f), 1));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const host = render(184.2, 1);
    act(() => tick(performance.now() + 1000));
    expect(host.textContent).toBe("184.2");
  });
});
