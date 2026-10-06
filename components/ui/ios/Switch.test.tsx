// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import Switch from "./Switch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Switch", () => {
  it("is a native checkbox with role=switch and reports changes", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let on = false;
    act(() => root.render(<Switch checked={on} onChange={(v) => (on = v)} label="الأصوات" />));
    const el = host.querySelector('input[role="switch"]') as HTMLInputElement;
    expect(el.getAttribute("aria-label")).toBe("الأصوات");
    expect(el.className).toContain("ios-switch");
    act(() => el.click());
    expect(on).toBe(true);
    act(() => root.unmount());
  });
});
