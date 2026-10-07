// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useInView } from "./useInView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  return <div ref={ref} data-seen={useInView(ref)} />;
}

/** IntersectionObserver stand-in: the test fires its callback by hand. */
class FakeIO {
  static last: FakeIO | null = null;
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(
    public cb: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void,
    public opts?: IntersectionObserverInit,
  ) {
    FakeIO.last = this;
  }
}

const proto = HTMLElement.prototype as { getAnimations?: () => { finished: Promise<unknown> }[] };
let root: Root | null = null;
let host: HTMLElement;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  FakeIO.last = null;
  delete proto.getAnimations;
  vi.unstubAllGlobals();
});

function mount() {
  host = document.createElement("div");
  root = createRoot(host);
  act(() => root!.render(<Probe />));
}
const seen = () => host.querySelector("div")!.dataset.seen;
/** Fire the observer and let the promise chain after it settle. */
async function intersect(isIntersecting = true, intersectionRatio = isIntersecting ? 0.5 : 0) {
  await act(async () => {
    FakeIO.last!.cb([{ isIntersecting, intersectionRatio }]);
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("useInView", () => {
  it("is true at once without IntersectionObserver (jsdom) or with reduced motion", () => {
    mount();
    expect(seen()).toBe("true");
    act(() => root!.unmount());

    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    mount();
    expect(seen()).toBe("true");
    expect(FakeIO.last).toBeNull();
  });

  it("turns true on the first hit past 35% and disconnects; a miss or a smaller overlap changes nothing", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    mount();
    const io = FakeIO.last!;
    expect(io.opts).toEqual({ threshold: 0.35 });
    expect(io.observe).toHaveBeenCalledWith(host.querySelector("div"));
    expect(seen()).toBe("false");

    await intersect(false);
    expect(seen()).toBe("false");
    // Firefox: isIntersecting for any overlap, here 10%.
    await intersect(true, 0.1);
    expect(seen()).toBe("false");
    expect(io.disconnect).not.toHaveBeenCalled();

    await intersect(true);
    expect(seen()).toBe("true");
    expect(io.disconnect).toHaveBeenCalled();
  });

  it("waits for the element's own entrance animation to end; a cancelled one counts as ended", async () => {
    vi.stubGlobal("IntersectionObserver", FakeIO);
    let end = () => {};
    proto.getAnimations = () => [{ finished: new Promise<void>((r) => (end = r)) }];
    mount();
    await intersect();
    expect(seen()).toBe("false"); // on screen, still rising
    await act(async () => {
      end();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(seen()).toBe("true");
    act(() => root!.unmount());

    proto.getAnimations = () => [{ finished: Promise.reject(new DOMException("", "AbortError")) }];
    mount();
    await intersect();
    expect(seen()).toBe("true");
  });
});
