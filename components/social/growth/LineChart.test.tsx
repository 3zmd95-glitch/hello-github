// @vitest-environment jsdom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays } from "@/lib/streak";
import LineChart, { clampTip, nearestIndex, smoothPath } from "./LineChart";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("chart helpers", () => {
  it("smoothPath runs through every point and stays inside each segment (no overshoot)", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([[0, 10]])).toBe("M0.0 10.0");
    expect(
      smoothPath([
        [0, 10],
        [100, 0],
      ]),
    ).toBe("M0.0 10.0 L100.0 0.0");
    const pts: [number, number][] = [
      [0, 60],
      [100, 10],
      [200, 30],
      [300, 30],
    ];
    const d = smoothPath(pts);
    expect(d.startsWith("M0.0 60.0 C")).toBe(true);
    const segs = d
      .split(" C")
      .slice(1)
      .map((c) => c.split(" ").map(Number));
    expect(segs).toHaveLength(3);
    segs.forEach(([, c1y, , c2y, ex, ey], i) => {
      const [y0, y1] = [pts[i][1], pts[i + 1][1]];
      expect([ex, ey]).toEqual(pts[i + 1]);
      for (const cy of [c1y, c2y]) {
        expect(cy).toBeGreaterThanOrEqual(Math.min(y0, y1));
        expect(cy).toBeLessThanOrEqual(Math.max(y0, y1));
      }
    });
  });

  it("nearestIndex picks the closest x (the first on a tie); clampTip keeps the tooltip off the sides", () => {
    expect(nearestIndex([0, 10, 30], 18)).toBe(1);
    expect(nearestIndex([0, 10, 30], 21)).toBe(2);
    expect(nearestIndex([0, 10, 30], 5)).toBe(0);
    expect(nearestIndex([], 5)).toBe(-1);
    expect(clampTip(10, 300)).toBe(44);
    expect(clampTip(290, 300)).toBe(256);
    expect(clampTip(150, 300)).toBe(150);
  });
});

describe("LineChart", () => {
  const today = "2026-09-21";
  const series = [
    {
      id: "followers",
      label: "Followers",
      short: "F",
      color: "var(--pc-tiktok)",
      points: [
        { day: addDays(today, -60), value: 1000 },
        { day: addDays(today, -30), value: 1250 },
        { day: today, value: 1478 },
      ],
    },
  ];
  const svgProto = SVGElement.prototype as { getTotalLength?: () => number };
  let reduce = false;
  let root: Root | null = null;
  let host: HTMLElement;

  beforeEach(() => {
    svgProto.getTotalLength = () => 300; // jsdom has no SVG geometry
    reduce = false;
    vi.stubGlobal("matchMedia", () => ({ matches: reduce }));
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    delete svgProto.getTotalLength;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function render(props: Partial<ComponentProps<typeof LineChart>>) {
    if (!root) {
      host = document.createElement("div");
      root = createRoot(host);
    }
    act(() =>
      root!.render(createElement(LineChart, { series, today, title: "Followers", ...props })),
    );
    const svg = host.querySelector("svg")!;
    return { svg, line: svg.querySelector<SVGPathElement>(".an-chart-ln")! };
  }

  it("mini: a 70px decorative sparkline over its own days, without grid, ticks or table", () => {
    const { svg, line } = render({ mini: true, title: undefined, animate: false });
    expect(svg.getAttribute("height")).toBe("70");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelectorAll("text, .an-chart-grid")).toHaveLength(0);
    expect(host.querySelector("details")).toBeNull();
    // First point on the left pad, the end dot on the right one (8px).
    const width = Number(svg.getAttribute("width"));
    expect(line.getAttribute("d")!.startsWith("M8.0 ")).toBe(true);
    expect(Number(svg.querySelector(".an-chart-dot")!.getAttribute("cx"))).toBe(width - 8);
  });

  it("waits hidden for its start, shows the line again when reduced motion turns on meanwhile", () => {
    const { svg, line } = render({ mini: true, start: false });
    const state = () => [
      line.style.strokeDasharray,
      line.style.strokeDashoffset,
      svg.dataset.drawn,
    ];
    expect(state()).toEqual(["300", "300", "false"]);
    reduce = true;
    render({ mini: true, start: false });
    expect(state()).toEqual(["", "", undefined]);
  });

  /** rAF that runs only when the test calls `frame()`; cancelled callbacks are dropped. */
  function frames() {
    const queue = new Map<number, FrameRequestCallback>();
    let next = 1;
    vi.stubGlobal(
      "requestAnimationFrame",
      (f: FrameRequestCallback) => (queue.set(next, f), next++),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
    return () =>
      act(() => {
        const [id, f] = [...queue][0];
        queue.delete(id);
        f(0);
      });
  }
  const ended = (line: SVGPathElement) => {
    const end = new Event("transitionend") as Event & { propertyName: string };
    end.propertyName = "stroke-dashoffset";
    act(() => line.dispatchEvent(end));
  };

  it("draws in two frames after the start, then drops the dash when the transition ends", () => {
    const frame = frames();
    const { svg, line } = render({ start: true });
    expect(svg.dataset.drawn).toBe("false");
    frame();
    frame();
    expect(svg.dataset.drawn).toBe("true");
    expect(line.style.strokeDashoffset).toBe("0");
    expect(line.style.transition).toContain("stroke-dashoffset 1.3s");
    ended(line);
    expect([line.style.strokeDasharray, line.style.strokeDashoffset]).toEqual(["", ""]);
    // Same numbers again (a re-render): no second draw.
    render({ start: true });
    expect(svg.dataset.drawn).toBe("true");
    expect(line.style.strokeDasharray).toBe("");
  });

  it("draws again when the series change (new numbers), not on a plain re-render", () => {
    const frame = frames();
    const { svg, line } = render({ start: true });
    frame();
    frame();
    ended(line);
    const more = [
      { ...series[0], points: [...series[0].points, { day: addDays(today, 1), value: 1500 }] },
    ];
    render({ start: true, series: more, today: addDays(today, 1) });
    expect([line.style.strokeDasharray, line.style.strokeDashoffset, svg.dataset.drawn]).toEqual([
      "300",
      "300",
      "false",
    ]);
    frame();
    frame();
    expect(svg.dataset.drawn).toBe("true");
    expect(line.style.strokeDashoffset).toBe("0");
  });

  it("never sticks hidden: reduced motion switched on between the two frames or mid-draw shows it drawn", () => {
    const frame = frames();
    let { svg, line } = render({ start: true });
    frame(); // the first of the two frames: not begun yet
    reduce = true;
    render({ start: true });
    expect([line.style.strokeDasharray, line.style.strokeDashoffset, svg.dataset.drawn]).toEqual([
      "",
      "",
      undefined,
    ]);

    act(() => root!.unmount());
    root = null;
    reduce = false;
    ({ svg, line } = render({ start: true }));
    frame();
    frame(); // drawing: the 1.3s transition runs
    reduce = true;
    render({ start: true });
    expect([line.style.strokeDasharray, line.style.transition, svg.dataset.drawn]).toEqual([
      "",
      "",
      undefined,
    ]);
  });

  /** A scrub chart with its tooltip, and a pointer helper (jsdom puts the svg at 0,0: clientX is the x in the chart). */
  function scrubChart() {
    vi.useFakeTimers();
    const { svg } = render({ scrub: true, animate: false });
    const tip = host.querySelector<HTMLElement>(".an-tip")!;
    const width = Number(svg.getAttribute("width"));
    const pointer = (type: string, x: number, y: number, pointerType = "mouse") =>
      act(() => {
        svg.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX: x,
            clientY: y,
            pointerType,
            pointerId: pointerType === "mouse" ? 1 : 7,
            isPrimary: true, // a first finger, as browsers send it
            buttons: 1,
          }),
        );
      });
    return { svg, tip, width, pointer, value: () => tip.querySelector("b")!.textContent };
  }

  it("scrub: the marker, ring and tooltip follow the pointer to the nearest day and hide 900ms after release", () => {
    const { svg, tip, width, pointer, value } = scrubChart();
    // The tooltip has its own 50px band above the plot (170 + 50).
    expect(svg.getAttribute("height")).toBe("220");
    const ring = svg.querySelector(".an-mkd")!;
    pointer("pointerdown", width / 2, 100); // the middle point sits nearest the center
    expect(tip.dataset.on).toBe("true");
    expect(svg.dataset.scrubbing).toBe("true");
    expect(value()).toBe("1,250");
    expect(tip.querySelector("small")!.textContent).not.toBe("");
    expect(tip.style.getPropertyValue("--tip-x")).toBe(
      `${clampTip(Number(ring.getAttribute("cx")), width)}px`,
    );
    expect(tip.style.left).toBe("");
    pointer("pointermove", width, 100);
    expect(value()).toBe("1,478");
    expect(tip.querySelector("small")!.textContent).toBe("اليوم");
    pointer("pointerup", width, 100);
    act(() => vi.advanceTimersByTime(899));
    expect(tip.dataset.on).toBe("true");
    act(() => vi.advanceTimersByTime(1));
    expect(tip.dataset.on).toBeUndefined();
    expect(svg.dataset.scrubbing).toBeUndefined();
  });

  it("touch: a finger scrubs only once it moves sideways past the slop", () => {
    const { tip, width, pointer, value } = scrubChart();
    pointer("pointerdown", width / 2, 100, "touch");
    expect(tip.dataset.on).toBeUndefined(); // a finger going down does not scrub
    pointer("pointermove", width / 2 + 4, 101, "touch");
    expect(tip.dataset.on).toBeUndefined(); // no direction yet
    pointer("pointermove", width / 2 + 10, 102, "touch");
    expect(tip.dataset.on).toBe("true"); // sideways: scrubbing
    expect(value()).toBe("1,250");
    pointer("pointermove", width, 120, "touch"); // once sideways, it follows the finger
    expect(value()).toBe("1,478");
  });

  it("touch: a vertical swipe never shows the tooltip (the page scrolls)", () => {
    const { tip, width, pointer } = scrubChart();
    pointer("pointerdown", width / 2, 100, "touch");
    pointer("pointermove", width / 2 + 2, 112, "touch");
    pointer("pointermove", width / 2 + 40, 150, "touch"); // still the same vertical gesture
    expect(tip.dataset.on).toBeUndefined();
    pointer("pointercancel", width / 2 + 40, 150, "touch"); // the browser took the pan
    act(() => vi.advanceTimersByTime(1000));
    expect(tip.dataset.on).toBeUndefined();
  });

  it("touch: a tap shows the day under the finger, then hides", () => {
    const { tip, width, pointer, value } = scrubChart();
    pointer("pointerdown", width, 100, "touch");
    pointer("pointerup", width, 100, "touch");
    expect(tip.dataset.on).toBe("true");
    expect(value()).toBe("1,478");
    act(() => vi.advanceTimersByTime(900));
    expect(tip.dataset.on).toBeUndefined();
  });
});
