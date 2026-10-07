// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCountUp } from "./useCountUp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ v, dec, start }: { v: number; dec?: number; start?: boolean }) {
  return createElement("b", null, useCountUp(v, { decimals: dec, start }));
}

let root: Root | null = null;
let host: HTMLElement;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

function render(v: number, dec?: number, start?: boolean) {
  if (!root) {
    host = document.createElement("div");
    root = createRoot(host);
  }
  act(() => root!.render(createElement(Probe, { v, dec, start })));
  return host;
}

const motion = (reduced: boolean) =>
  vi.stubGlobal("matchMedia", () => ({
    matches: reduced,
    addEventListener() {},
    removeEventListener() {},
  }));

/** rAF that runs only when the test calls `frame(ms after now)`. */
function frames() {
  let tick: FrameRequestCallback | null = null;
  const raf = vi.fn((f: FrameRequestCallback) => ((tick = f), 1));
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const frame = (ms: number) => act(() => tick!(performance.now() + ms));
  return { raf, frame };
}

describe("useCountUp", () => {
  it("shows the final value at once when motion is reduced", () => {
    motion(true);
    expect(render(12430).textContent).toBe("12,430");
  });

  it("keeps the decimals and starts from zero when animating", () => {
    motion(false);
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    expect(render(184.2, 1).textContent).toBe("0.0");
  });

  it("lands on the exact target once the duration has passed", () => {
    motion(false);
    const { frame } = frames();
    const host = render(184.2, 1);
    frame(1000);
    expect(host.textContent).toBe("184.2");
  });

  it("holds at 0 without scheduling frames until `start`, then counts", () => {
    motion(false);
    const { raf, frame } = frames();
    expect(render(500, 0, false).textContent).toBe("0");
    expect(raf).not.toHaveBeenCalled();
    render(500, 0, true);
    expect(raf).toHaveBeenCalled();
    frame(500);
    expect(Number(host.textContent!.replace(",", ""))).toBeGreaterThan(0);
    frame(1000);
    expect(host.textContent).toBe("500");
  });

  it("counts from the value on screen when the target changes later", () => {
    motion(false);
    const { frame } = frames();
    render(100);
    frame(1000);
    expect(host.textContent).toBe("100");
    render(200);
    frame(0);
    expect(host.textContent).toBe("100");
    frame(500);
    expect(Number(host.textContent)).toBeGreaterThan(100);
    frame(1000);
    expect(host.textContent).toBe("200");
  });
});
