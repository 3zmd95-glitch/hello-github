// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DiscoverUsage } from "@/lib/discover";
import { useStore } from "@/store";
import DiscoverUsageLine from "./DiscoverUsageLine";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  useStore.getState().setSettings({ lang: "en" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const mount = (paid: { paygoUsed?: number; paygoLimit?: number | null }) => {
  const usage: DiscoverUsage = {
    tavily: { used: 1000, limit: 1000, ...paid },
    youtube: { usedToday: 1, cap: 70 },
    connector: { usedToday: 0, cap: 60 },
  };
  act(() => root.render(createElement(DiscoverUsageLine, { usage, testId: "usage" })));
  return host.querySelector('[data-testid="discover-paid-usage"]');
};

describe("reported paid-credit allowance", () => {
  it("does not invent an extra allowance for old replies or a null-only limit", () => {
    expect(mount({})).toBeNull();
    expect(mount({ paygoLimit: null })).toBeNull();
    expect(host.textContent).toContain("Last reported usage");
    expect(host.textContent).toContain("Tavily credits 1000/1000");
  });
  it("shows additional capacity even when plan credits are exhausted", () => {
    expect(mount({ paygoUsed: 0, paygoLimit: 500 })?.textContent).toBe(
      "Additional paid credits: 0/500 this month",
    );
  });
  it("preserves an explicit zero cap", () => {
    expect(mount({ paygoUsed: 0, paygoLimit: 0 })?.textContent).toBe(
      "Additional paid credits: 0/0 this month",
    );
  });
  it("does not treat missing or null limits as unlimited", () => {
    expect(mount({ paygoUsed: 12, paygoLimit: null })?.textContent).toBe(
      "Additional paid credits: 12/not reported this month",
    );
    expect(mount({ paygoLimit: 500 })?.textContent).toBe(
      "Additional paid credits: not reported/500 this month",
    );
  });
  it("shows the same reported values in Arabic", () => {
    act(() => useStore.getState().setSettings({ lang: "ar" }));
    expect(mount({ paygoUsed: 0, paygoLimit: 500 })?.textContent).toBe(
      "الرصيد الإضافي المدفوع: 0/500 هالشهر",
    );
  });
});
