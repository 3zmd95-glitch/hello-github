// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePullToRefresh } from "./usePullToRefresh";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type OnRefresh = (held: Promise<void>) => Promise<unknown> | void;

function Probe({ onRefresh }: { onRefresh: OnRefresh }) {
  const { pull, refreshing } = usePullToRefresh(onRefresh);
  return <i data-pull={pull} data-refreshing={refreshing} />;
}

const html = document.documentElement;
let y = 0;
let main: HTMLElement;
let host: HTMLElement;
let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  y = 0;
  Object.defineProperty(window, "scrollY", { configurable: true, get: () => y });
  main = document.createElement("main");
  main.id = "main";
  host = document.createElement("div");
  main.appendChild(host);
  document.body.appendChild(main);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  main.remove();
  vi.useRealTimers();
});

function mount(onRefresh: OnRefresh = () => {}) {
  root = createRoot(host);
  act(() => root!.render(<Probe onRefresh={onRefresh} />));
}

/** A one-finger touch event at `clientY`, dispatched on `target` (bubbles to the window listeners). */
function touch(type: string, clientY: number, target: EventTarget = host): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "touches", { value: type === "touchend" ? [] : [{ clientY }] });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

/** #main's translateY in px (0 when it has no transform). */
const ty = () => Number(/translateY\(([\d.]+)px\)/.exec(main.style.transform)?.[1] ?? 0);

const state = () => {
  const i = host.querySelector("i")!;
  return { pull: Number(i.dataset.pull), refreshing: i.dataset.refreshing === "true" };
};

describe("usePullToRefresh", () => {
  it("turns the page's own bounce off while mounted and restores it after", () => {
    html.style.overscrollBehaviorY = "contain";
    mount();
    expect(html.style.overscrollBehaviorY).toBe("none");
    act(() => root!.unmount());
    root = null;
    expect(html.style.overscrollBehaviorY).toBe("contain");
    html.style.overscrollBehaviorY = "";
  });

  it("follows the finger with resistance and springs back without refreshing below 70px", () => {
    const onRefresh = vi.fn();
    mount(onRefresh);
    touch("touchstart", 100);
    const move = touch("touchmove", 200); // 100px raw → 55px
    expect(move.defaultPrevented).toBe(true);
    expect(ty()).toBeCloseTo(55);
    expect(state().pull).toBeCloseTo(55);
    expect(state().refreshing).toBe(false);
    touch("touchend", 0);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(main.style.transform).toBe("");
    expect(state()).toEqual({ pull: 0, refreshing: false });
  });

  it("lets the finger scroll the page again once it goes back above where it started", () => {
    mount();
    touch("touchstart", 100);
    touch("touchmove", 160);
    expect(ty()).toBeCloseTo(33);
    const up = touch("touchmove", 80);
    expect(up.defaultPrevented).toBe(false);
    expect(main.style.transform).toBe("");
    expect(state().pull).toBe(0);
  });

  it("refreshes past 70px: holds at 56px for at least 1.1s, then springs back", async () => {
    let toasted = false;
    const onRefresh = vi.fn(async (held: Promise<void>) => {
      await held;
      toasted = true;
    });
    mount(onRefresh);
    touch("touchstart", 0);
    touch("touchmove", 200); // 110px
    touch("touchend", 0);
    await act(async () => {
      await Promise.resolve();
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(state().refreshing).toBe(true);
    expect(main.style.transform).toBe("translateY(56px)");
    // A second pull while refreshing does nothing.
    touch("touchstart", 0);
    touch("touchmove", 200);
    expect(main.style.transform).toBe("translateY(56px)");
    touch("touchend", 0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1099);
    });
    expect(state().refreshing).toBe(true);
    expect(toasted).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    // `held` resolves with the minimum time: a toast that awaits it lands as the content springs back.
    expect(toasted).toBe(true);
    expect(state()).toEqual({ pull: 0, refreshing: false });
    expect(main.style.transform).toBe("");
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(main.style.transition).toBe("");
  });

  it("springs back after a pull that drifted down and came back above its start", async () => {
    mount();
    touch("touchstart", 100);
    touch("touchmove", 160);
    touch("touchmove", 80); // back above the start: transform cleared, transition still "none"
    expect(main.style.transform).toBe("");
    touch("touchend", 0);
    expect(main.style.transition).not.toBe("none");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(main.style.transition).toBe("");
    expect(main.style.transform).toBe("");
  });

  it("springs back after 8s while the refresh still runs; its toast lands when it settles", async () => {
    let toasted = false;
    mount(async (held) => {
      await new Promise((r) => setTimeout(r, 10_000));
      await held;
      toasted = true;
    });
    touch("touchstart", 0);
    touch("touchmove", 200);
    touch("touchend", 0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7999);
    });
    expect(state().refreshing).toBe(true);
    expect(main.style.transform).toBe("translateY(56px)");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(state()).toEqual({ pull: 0, refreshing: false });
    expect(main.style.transform).toBe("");
    expect(toasted).toBe(false);
    // The sync still runs: a new pull waits.
    touch("touchstart", 0);
    expect(touch("touchmove", 200).defaultPrevented).toBe(false);
    touch("touchend", 0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(toasted).toBe(true);
    touch("touchstart", 0);
    expect(touch("touchmove", 200).defaultPrevented).toBe(true);
  });

  it("springs back after a rejected refresh without an unhandled rejection", async () => {
    const onRefresh = vi.fn(async () => {
      throw new Error("offline");
    });
    mount(onRefresh);
    touch("touchstart", 0);
    touch("touchmove", 200);
    touch("touchend", 0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ pull: 0, refreshing: false });
    expect(main.style.transform).toBe("");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(main.style.transition).toBe("");
  });

  it("writes nothing to #main after it unmounts mid-refresh", async () => {
    mount(() => new Promise((r) => setTimeout(r, 2000)));
    touch("touchstart", 0);
    touch("touchmove", 200);
    touch("touchend", 0);
    expect(main.style.transform).toBe("translateY(56px)");
    act(() => root!.unmount());
    root = null;
    expect(main.style.transform).toBe("");
    expect(main.style.transition).toBe("");
    let writes = 0;
    const mo = new MutationObserver((records) => (writes += records.length));
    mo.observe(main, { attributes: true });
    await vi.advanceTimersByTimeAsync(10_000);
    writes += mo.takeRecords().length;
    mo.disconnect();
    expect(writes).toBe(0);
  });

  it("leaves #main alone on a plain tap at the top", () => {
    mount();
    touch("touchstart", 300);
    touch("touchend", 0);
    expect(main.getAttribute("style")).toBeNull();
  });

  it("ignores touches when the page is scrolled or the finger starts outside #main", () => {
    mount();
    y = 10;
    touch("touchstart", 0);
    expect(touch("touchmove", 200).defaultPrevented).toBe(false);
    touch("touchend", 0);
    y = 0;
    const bar = document.createElement("nav");
    document.body.appendChild(bar);
    touch("touchstart", 0, bar);
    expect(touch("touchmove", 200, bar).defaultPrevented).toBe(false);
    touch("touchend", 0, bar);
    bar.remove();
    expect(main.style.transform).toBe("");
    expect(state().pull).toBe(0);
  });

  it("leaves no inline transform or transition on #main when it unmounts mid-pull", () => {
    mount();
    touch("touchstart", 0);
    touch("touchmove", 100);
    expect(main.style.transition).toBe("none");
    act(() => root!.unmount());
    root = null;
    expect(main.style.transform).toBe("");
    expect(main.style.transition).toBe("");
  });
});
