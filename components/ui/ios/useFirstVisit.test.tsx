// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { useFirstVisit } from "./useFirstVisit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ k, n = 0 }: { k: string; n?: number }) {
  const first = useFirstVisit(k);
  return <i data-first={first} data-n={n} />;
}

/** Mount a screen with `key`, re-render it once, read the flag both times, then leave the screen. */
function visit(k: string): [string | undefined, string | undefined] {
  const host = document.createElement("div");
  const root = createRoot(host);
  const read = () => host.querySelector("i")?.dataset.first;
  act(() => root.render(<Probe k={k} />));
  const mounted = read();
  act(() => root.render(<Probe k={k} n={1} />));
  const rerendered = read();
  act(() => root.unmount());
  return [mounted, rerendered];
}

describe("useFirstVisit", () => {
  it("is true for the whole first visit of a screen in this page load, false on later visits", () => {
    expect(visit("studio")).toEqual(["true", "true"]);
    expect(visit("studio")).toEqual(["false", "false"]);
    expect(visit("calendar")).toEqual(["true", "true"]);
  });
});
