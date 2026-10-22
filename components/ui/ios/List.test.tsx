// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ListGroup, ListRow } from "./List";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ListRow", () => {
  it("renders li rows in a ul, iconRaw without the icon square", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    act(() =>
      root.render(
        <ListGroup listAs="ul">
          <ListRow as="li" data-platform="tiktok" iconRaw={<i data-testid="badge" />} title="t" />
        </ListGroup>,
      ),
    );
    const li = host.querySelector("ul.ios-list > li.ios-row");
    expect(li?.getAttribute("data-platform")).toBe("tiktok");
    expect(li?.getAttribute("data-sep")).toBeNull();
    expect(host.querySelector(".ios-ic")).toBeNull();
    expect(li?.querySelector('[data-testid="badge"]')).not.toBeNull();
    act(() => root.unmount());
  });
});
