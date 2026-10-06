import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clamp01,
  easeOutCubic,
  nextMini,
  overdrag,
  prefersReducedMotion,
  pullOffset,
  rubberBand,
  settleStop,
} from "./motion";

afterEach(() => vi.unstubAllGlobals());

describe("motion helpers", () => {
  it("clamps and eases", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
  });

  it("rubber bands past the limit with log resistance", () => {
    expect(rubberBand(50, 96)).toBe(50);
    expect(rubberBand(96, 96)).toBe(96);
    expect(rubberBand(200, 96)).toBeGreaterThan(96);
    expect(rubberBand(200, 96)).toBeLessThan(130);
  });

  it("overdrag grows slower than the finger", () => {
    expect(overdrag(0)).toBe(0);
    expect(overdrag(30)).toBeCloseTo(30 * Math.log(2));
    expect(overdrag(300)).toBeLessThan(80);
  });

  it("minimizes the tab bar only after a clear scroll down past 140px, restores on scroll up or above 80px", () => {
    expect(nextMini(false, 150, 140)).toBe(true);
    expect(nextMini(false, 150, 148)).toBe(false);
    expect(nextMini(false, 100, 50)).toBe(false);
    expect(nextMini(true, 300, 310)).toBe(false);
    expect(nextMini(true, 300, 302)).toBe(true);
    expect(nextMini(true, 60, 60)).toBe(false);
  });

  it("pull offset applies resistance and a cap", () => {
    expect(pullOffset(-10)).toBe(0);
    expect(pullOffset(100)).toBeCloseTo(55);
    expect(pullOffset(1000)).toBe(130);
  });

  it("settles on the nearest stop, or one stop further in the fling direction", () => {
    const stops = [0, 200, 500]; // large, medium, closed (translateY px)
    expect(settleStop(10, 0, stops)).toBe(0);
    expect(settleStop(190, 0, stops)).toBe(1);
    expect(settleStop(420, 0, stops)).toBe(2);
    expect(settleStop(50, 1, stops)).toBe(1); // flung down from near large: medium
    expect(settleStop(250, 1, stops)).toBe(2); // flung down past medium: closed
    expect(settleStop(250, -1, stops)).toBe(1); // flung up from below medium: medium
    expect(settleStop(150, -1, stops)).toBe(0); // flung up from above medium: large
    expect(settleStop(300, 0, [0, 500])).toBe(1); // one detent: nearest wins
  });

  it("reports no reduced-motion preference where matchMedia is missing, instead of throwing", () => {
    expect(prefersReducedMotion()).toBe(false); // node: no window at all
    vi.stubGlobal("window", {}); // a window without matchMedia, like jsdom's
    expect(prefersReducedMotion()).toBe(false);
  });
});
