// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSwipeAction } from "./useSwipeAction";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ onTrigger, enabled }: { onTrigger: () => void; enabled?: boolean }) {
  const { handlers, x, armed, dragging } = useSwipeAction(onTrigger, { enabled });
  return <i data-x={x} data-armed={armed} data-dragging={dragging} {...handlers} />;
}

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture ??= () => {}; // jsdom has no pointer capture
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(dir: "rtl" | "ltr", onTrigger = vi.fn(), enabled?: boolean) {
  host.dir = dir;
  act(() => root.render(<Probe onTrigger={onTrigger} enabled={enabled} />));
  return onTrigger;
}

const row = () => host.querySelector("i")!;
const state = () => ({
  x: Number(row().dataset.x),
  armed: row().dataset.armed === "true",
  dragging: row().dataset.dragging === "true",
});
const fire = (type: string, clientX: number, clientY = 100) =>
  act(() => {
    row().dispatchEvent(new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: 1 }));
  });
/** Press at x = 200, move by `dx` (with a first small step, as a finger does), and hold there. */
const drag = (dx: number, dy = 0) => {
  fire("pointerdown", 200);
  fire("pointermove", 200 + Math.sign(dx) * 10, 100 + dy / 4);
  fire("pointermove", 200 + dx, 100 + dy);
};

describe("useSwipeAction", () => {
  it("follows the finger toward the end edge (left in RTL) and fires once it was armed past 64px", () => {
    const onTrigger = mount("rtl");
    drag(-70);
    expect(state()).toEqual({ x: -70, armed: true, dragging: true });
    expect(onTrigger).not.toHaveBeenCalled();
    fire("pointerup", 130);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ x: 0, armed: false, dragging: false });
  });

  it("springs back without firing when released before the arm point", () => {
    const onTrigger = mount("rtl");
    drag(-50);
    expect(state()).toEqual({ x: -50, armed: false, dragging: true });
    fire("pointerup", 150);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(state().x).toBe(0);
  });

  it("goes right in LTR and never toward the start edge", () => {
    const onTrigger = mount("ltr");
    drag(-80); // toward the start in LTR: the row stays put
    expect(state()).toEqual({ x: 0, armed: false, dragging: true });
    fire("pointerup", 120);
    expect(onTrigger).not.toHaveBeenCalled();

    drag(80);
    expect(state()).toEqual({ x: 80, armed: true, dragging: true });
    fire("pointerup", 280);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("hands a vertical start back to scrolling: later sideways moves are ignored", () => {
    const onTrigger = mount("rtl");
    fire("pointerdown", 200, 100);
    fire("pointermove", 197, 120); // mostly down: the page scrolls
    fire("pointermove", 100, 120);
    expect(state()).toEqual({ x: 0, armed: false, dragging: false });
    fire("pointerup", 100, 120);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("ignores moves under 8px, then rubber-bands past 96px", () => {
    mount("rtl");
    fire("pointerdown", 200);
    fire("pointermove", 195);
    expect(state()).toEqual({ x: 0, armed: false, dragging: false });
    fire("pointermove", 0); // 200px pulled
    expect(state().x).toBeLessThan(-96);
    expect(state().x).toBeGreaterThan(-140);
  });

  it("only springs back when the browser cancels the gesture", () => {
    const onTrigger = mount("rtl");
    drag(-90);
    fire("pointercancel", 110);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(state()).toEqual({ x: 0, armed: false, dragging: false });
  });

  it("does nothing while disabled", () => {
    const onTrigger = mount("rtl", vi.fn(), false);
    drag(-90);
    fire("pointerup", 110);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(state().x).toBe(0);
  });
});
