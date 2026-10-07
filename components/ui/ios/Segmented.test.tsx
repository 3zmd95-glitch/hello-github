// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Segmented from "./Segmented";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver (it does have CSS.escape): a stub that keeps each callback so a test can call it.
let resized: (() => void)[] = [];
beforeEach(() => {
  resized = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(cb: () => void) {
        resized.push(cb);
      }
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
  vi.restoreAllMocks();
  document.documentElement.removeAttribute("dir");
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

  it("jumps the thumb into place when the page direction flips, and glides to a new value", async () => {
    // Fake layout: 100px segments, mirrored in RTL.
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      const btns = [...this.parentElement!.querySelectorAll("button")];
      const i = btns.indexOf(this as HTMLButtonElement);
      return 100 * (document.documentElement.dir === "ltr" ? i : btns.length - 1 - i);
    });
    document.documentElement.dir = "rtl";
    const ui = (value: "week" | "month") => (
      <Segmented options={opts} value={value} onChange={() => {}} label="العرض" />
    );
    const host = mount(ui("week"));
    const thumb = host.querySelector<HTMLElement>(".ios-seg-thumb")!;
    expect(thumb.style.getPropertyValue("--x")).toBe("200px"); // RTL: the first option is rightmost
    // Every write of --x from here on, with the transition in force at that moment.
    const writes: string[] = [];
    const setProperty = thumb.style.setProperty.bind(thumb.style);
    vi.spyOn(thumb.style, "setProperty").mockImplementation((name, value, priority) => {
      if (name === "--x") writes.push(`${value} ${thumb.style.transition || "glide"}`);
      setProperty(name, value, priority);
    });
    // The language picker flips <html dir> in a passive effect, after the thumb was placed: no glide across the row.
    await act(async () => {
      document.documentElement.dir = "ltr";
    });
    expect(writes).toEqual(["0px none"]);
    expect(thumb.style.transition).toBe("");
    // A new value still glides, and the ResizeObserver's first call (nothing moved) leaves that glide alone.
    act(() => root!.render(ui("month")));
    resized.at(-1)!();
    expect(writes).toEqual(["0px none", "100px glide"]);
  });
});
