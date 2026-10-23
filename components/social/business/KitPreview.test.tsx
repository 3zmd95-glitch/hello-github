// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KitProjection } from "@/lib/businessKit";
import { useStore } from "@/store";
import KitPreview from "./KitPreview";

// The printable kit: both languages side by side with their own direction, every number with its provenance line,
// "ask me" prices, https links only, and a draft line while the edits are not saved.

let host: HTMLDivElement;
let root: Root;

const projection: KitProjection = {
  app: "3z-prod-media-kit",
  version: 1,
  generatedAt: "2026-10-16T09:00:00.000Z",
  lang: ["ar", "en"],
  tagline: { ar: "أصوّر وأمنتج", en: "I film and edit" },
  bio: { ar: "", en: "Editor in Jeddah" },
  contact: { email: "hi@3z.example", website: "https://3z.example", location: { ar: "", en: "" } },
  services: [{ name: { ar: "مونتاج", en: "Editing" }, desc: { ar: "", en: "" } }],
  rateCard: [
    {
      deliverable: { ar: "ريل", en: "Reel" },
      platform: "instagram",
      priceSar: 1500,
      note: { ar: "", en: "" },
    },
    { deliverable: { ar: "ستوري", en: "Story" }, priceSar: null, note: { ar: "", en: "" } },
  ],
  pastWork: [
    { title: { ar: "", en: "Launch ad" }, url: "https://x.example/ad" },
    { title: { ar: "", en: "Old one" }, url: "javascript:alert(1)" },
  ],
  metrics: [
    {
      platform: "instagram",
      handle: "3z.prod",
      followers: { source: "snapshot", value: 12_400, observedDay: "2026-10-14" },
      engagement: {
        source: "posts",
        value: 6,
        sample: 3,
        range: { from: "2026-10-01", to: "2026-10-12" },
      },
      avgViews: { source: "none" },
      avgLikes: { source: "none" },
      stale: false,
    },
  ],
};

async function render(unsaved = false) {
  await act(async () =>
    root.render(createElement(KitPreview, { projection, unsaved, open: true })),
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.getState().setSettings({ lang: "ar" });
});

describe("KitPreview", () => {
  it("prints both languages with their own direction and every number's source", async () => {
    await render();
    const el = host.querySelector<HTMLElement>("[data-print-root]")!;
    const ar = el.querySelector<HTMLElement>('[data-lang="ar"]')!;
    const en = el.querySelector<HTMLElement>('[data-lang="en"]')!;
    expect(ar.dir).toBe("rtl");
    expect(en.dir).toBe("ltr");
    expect(ar.textContent).toContain("أصوّر وأمنتج");
    expect(ar.textContent).toContain("لقطة محفوظة من النمو · بتاريخ 2026-10-14");
    expect(en.textContent).toContain("Saved Growth snapshot · observed 2026-10-14");
    expect(en.textContent).toContain("From 3 posts · 2026-10-01–2026-10-12");
    expect(en.textContent).toContain("12.4K");
    expect(en.textContent).toContain("@3z.prod");
    expect(en.textContent).toContain("1500 SAR");
    expect(en.textContent).toContain("Ask me");
    expect(ar.textContent).toContain("اسألني");
    // Only https links become links.
    const hrefs = [...en.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://x.example/ad");
    expect(hrefs).not.toContain("javascript:alert(1)");
    expect(en.textContent).toContain("Old one");
    expect(el.textContent).not.toContain("Draft, not saved yet");
  });

  it("says so when it shows a draft that is not saved yet", async () => {
    await render(true);
    expect(host.querySelector("[data-print-root]")!.textContent).toContain("Draft, not saved yet");
  });
});
