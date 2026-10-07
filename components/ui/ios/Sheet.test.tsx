// @vitest-environment jsdom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_HISTORY_KEY } from "@/components/player/useBackToClose";
import Sheet from "./Sheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  // Phone layout, reduced motion: closing calls onClose at once.
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function mount(onClose: () => void, child: ReactNode = <button type="button">داخل</button>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Sheet onClose={onClose} title="بوست جديد" titleId="t1" testId="sheet">
        {child}
      </Sheet>,
    ),
  );
}

describe("Sheet", () => {
  it("is a labelled modal dialog in <body> that locks page scroll while mounted", () => {
    mount(() => {});
    const dlg = document.querySelector('[data-testid="sheet"]')!;
    expect(dlg.getAttribute("role")).toBe("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(dlg.getAttribute("aria-labelledby")).toBe("t1");
    expect(document.getElementById("t1")?.textContent).toBe("بوست جديد");
    expect(document.body.style.overflow).toBe("hidden");
    act(() => root!.unmount());
    root = null;
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    mount(onClose);
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The post popup's title field reverts its edit on Escape (preventDefault): that Escape is the field's, the next one
  // (focus elsewhere) closes the sheet.
  it("leaves an Escape a child already handled; a plain one closes", () => {
    const onClose = vi.fn();
    mount(
      onClose,
      <input
        data-testid="edit"
        onKeyDown={(e) => {
          if (e.key === "Escape") e.preventDefault();
        }}
      />,
    );
    const escape = () =>
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      document.querySelector('[data-testid="edit"]')!.dispatchEvent(escape());
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      document.dispatchEvent(escape());
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The skill sheet (its own dialog, z-40) can open over the post popup: an Escape pressed in it is that dialog's.
  it("leaves an Escape pressed in another dialog on top; with focus back in the sheet it closes", () => {
    const onClose = vi.fn();
    mount(onClose);
    const top = document.createElement("div");
    top.setAttribute("role", "dialog");
    top.tabIndex = -1;
    document.body.appendChild(top);
    top.focus();
    const escape = () =>
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      top.dispatchEvent(escape());
    });
    expect(onClose).not.toHaveBeenCalled();
    document.querySelector<HTMLElement>('[data-testid="sheet"]')!.focus();
    top.remove();
    act(() => {
      document.dispatchEvent(escape());
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop tap", () => {
    const onClose = vi.fn();
    mount(onClose);
    act(() => (document.querySelector('[data-testid="sheet-backdrop"]') as HTMLElement).click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes from its close button, once", () => {
    const onClose = vi.fn();
    mount(onClose);
    const close = document.querySelector(".ios-close") as HTMLButtonElement;
    act(() => close.click());
    act(() => close.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // `next dev` renders in StrictMode: effects mount, unmount and mount again. A Back entry pushed at mount was pushed,
  // popped and pushed again: in Chrome the late popstate closed the sheet as it opened; jsdom drops that queued Back
  // on the second push, so here the stray second entry gives it away.
  it("stays open in StrictMode with exactly one Back entry", async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const onClose = vi.fn();
    const entries = history.length;
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() =>
      root!.render(
        <StrictMode>
          <Sheet onClose={onClose} title="بوست جديد" titleId="t1" testId="sheet">
            <button type="button">داخل</button>
          </Sheet>
        </StrictMode>,
      ),
    );
    await act(async () => {
      while (frames.length) frames.shift()!(0); // the enter frames: phase "open"
      await new Promise((r) => setTimeout(r, 20)); // jsdom runs history traversals as queued tasks
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(history.length).toBe(entries + 1);
    expect((history.state as Record<string, unknown> | null)?.[PLAYER_HISTORY_KEY]).toBeTruthy();
  });
});

describe("Sheet with motion (phone)", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
    }));
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    HTMLElement.prototype.setPointerCapture ??= () => {}; // jsdom has no pointer capture
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  /** Mount, run the enter frames (phase "open"), and hand back the panel and a pointer driver for its grabber. */
  function open(onClose: () => void) {
    mount(onClose);
    act(() => {
      while (frames.length) frames.shift()!(0);
    });
    const sheet = document.querySelector<HTMLElement>('[data-testid="sheet"]')!;
    const grab = sheet.querySelector(".ios-grab")!;
    const fire = (type: string, y: number, t: number) =>
      act(() => {
        const e = new PointerEvent(type, { bubbles: true, clientY: y, pointerId: 1 });
        Object.defineProperty(e, "timeStamp", { value: t });
        grab.dispatchEvent(e);
      });
    return { sheet, fire };
  }
  const mediumY = () => Math.round((0.92 - 0.6) * window.innerHeight);
  const closeButton = () => document.querySelector(".ios-close") as HTMLButtonElement;

  it("settles a fast drag that stopped before the release; a quick flick closes after the exit", () => {
    const onClose = vi.fn();
    const { sheet, fire } = open(onClose);
    const medium = `translate3d(0, ${mediumY()}px, 0)`;
    expect(sheet.style.transform).toBe(medium);
    const drag = (upAt: number) => {
      fire("pointerdown", 300, 1000);
      fire("pointermove", 400, 1050); // 100px down in 50ms = 2 px/ms, a fling's speed
      fire("pointerup", 400, upAt);
    };

    drag(1200); // the finger held still for 150ms: the speed has decayed, the nearest detent wins
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe(medium);

    drag(1060); // released while moving: the fling passes the last detent and closes
    expect(onClose).not.toHaveBeenCalled(); // the exit plays first
    act(() => vi.advanceTimersByTime(300));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The body's end padding (--sheet-hidden) is what lets its last item scroll into view at the medium detent. If it
  // shrank while the sheet moves, the browser would clamp scrollTop and the content would jump.
  it("keeps the body's scroll padding at the resting detent while dragged and while closing", () => {
    const { sheet, fire } = open(() => {});
    const padding = () => sheet.style.getPropertyValue("--sheet-hidden");
    const medium = `${mediumY()}px`;
    expect(padding()).toBe(medium);
    fire("pointerdown", 300, 1000);
    expect(padding()).toBe(medium);
    fire("pointermove", 340, 1100);
    expect(padding()).toBe(medium);
    fire("pointerup", 340, 1300); // held still: back to the medium detent
    expect(padding()).toBe(medium);
    act(() => closeButton().click());
    expect(sheet.closest(".ios-sheet-root")!.getAttribute("data-phase")).toBe("exit");
    expect(padding()).toBe(medium);
  });

  it("drops its exit timer when unmounted mid-exit, so a late onClose never reaches the next sheet", () => {
    const onClose = vi.fn();
    open(onClose);
    act(() => closeButton().click()); // the 300ms exit starts
    act(() => vi.advanceTimersByTime(100));
    act(() => root!.unmount());
    root = null;
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).not.toHaveBeenCalled();
  });
});
