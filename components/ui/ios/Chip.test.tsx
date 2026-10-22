// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import Chip from "./Chip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Chip", () => {
  it("passes data attributes through to its span", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() =>
      root.render(
        <Chip tone="tint" data-testid="idea-source-chip" data-source="tiktok">
          تيك توك
        </Chip>,
      ),
    );
    const el = host.querySelector('[data-testid="idea-source-chip"]');
    expect(el?.tagName).toBe("SPAN");
    expect(el?.getAttribute("data-source")).toBe("tiktok");
    expect(el?.className).toContain("ios-chip");
    act(() => root.unmount());
  });
});
