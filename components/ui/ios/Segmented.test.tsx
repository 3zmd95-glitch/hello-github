// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Segmented from "./Segmented";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver (it does have CSS.escape).
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.unstubAllGlobals();
});

function mount(ui: ReactElement, dir?: "ltr") {
  const host = document.createElement("div");
  if (dir) host.dir = dir;
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(ui));
  return host;
}

const press = (el: Element, key: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });

const opts = [
  { value: "week", label: "أسبوع" },
  { value: "month", label: "شهر" },
  { value: "stages", label: "مراحل" },
] as const;

describe("Segmented", () => {
  it("marks the value, changes on click and on arrow keys", () => {
    const seen: string[] = [];
    const host = mount(
      <Segmented options={opts} value="week" onChange={(v) => seen.push(v)} label="العرض" />,
    );
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    act(() => (tabs[1] as HTMLButtonElement).click());
    press(tabs[0], "ArrowLeft"); // RTL: ArrowLeft = forward = next option
    press(tabs[0], "ArrowRight"); // RTL: ArrowRight = back, wraps to the last
    expect(seen).toEqual(["month", "month", "stages"]);
  });

  it("is a radiogroup with test ids and flips the arrows in LTR", () => {
    const seen: string[] = [];
    const host = mount(
      <Segmented
        role="radiogroup"
        options={opts.map((o) => ({ ...o, testId: `seg-${o.value}` }))}
        value="week"
        onChange={(v) => seen.push(v)}
        label="العرض"
      />,
      "ltr",
    );
    expect(host.querySelector('[role="radiogroup"]')?.getAttribute("aria-label")).toBe("العرض");
    const radios = [...host.querySelectorAll('[role="radio"]')];
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(radios[1].getAttribute("data-testid")).toBe("seg-month");
    press(radios[0], "ArrowLeft"); // LTR: back, wraps to the last
    press(radios[0], "ArrowRight"); // LTR: forward
    expect(seen).toEqual(["stages", "month"]);
    expect(document.activeElement).toBe(radios[1]);
  });
});
