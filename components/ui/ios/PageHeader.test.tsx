// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import PageHeader from "./PageHeader";
import { useChrome } from "./chrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PageHeader", () => {
  it("renders the large title and registers it for the compact bar", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<PageHeader title="الاستوديو" sub="مساحتك" eyebrow="الثلاثاء" />));
    expect(host.querySelector("h1")?.textContent).toBe("الاستوديو");
    expect(host.querySelector(".ios-eyebrow")?.textContent).toBe("الثلاثاء");
    expect(useChrome.getState().title).toBe("الاستوديو");
    act(() => root.unmount());
    expect(useChrome.getState().title).toBe("");
  });
});
