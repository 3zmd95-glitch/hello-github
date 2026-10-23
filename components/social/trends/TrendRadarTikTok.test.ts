// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrendItemInput } from "@/lib/domain";
import { dayKey } from "@/lib/streak";
import { useStore } from "@/store";
import TrendRadar from "./TrendRadar";

// Scout 02, rendered for real in jsdom (no Worker: the radar shows the feed the store holds): TikTok Discovery's
// hashtags in the Arabic (SA) and English (US) tabs with their 7-day window and the proof videos under them (the
// date each video's own id carries), the Hashtags / Sounds / Topics filter, and the weekly "paste 3 Instagram
// sounds" card, which saves ideas and never reminds.

const SEEN_AT = new Date().toISOString();

const row = (over: Partial<TrendItemInput> & { id: string }): TrendItemInput => ({
  platform: "tiktok",
  region: "SA",
  lang: "ar",
  title: over.id,
  source: "TikTok Discovery",
  seenAt: SEEN_AT,
  ...over,
});

const PROOF = [
  {
    url: "https://www.tiktok.com/@alice/video/7699043269686190656",
    creator: "@alice",
    postedAt: "2026-10-21T09:00:00.000Z",
  },
  {
    url: "https://www.tiktok.com/@bob/video/7697930014163178567",
    creator: "@bob",
    postedAt: "2026-10-18T09:00:00.000Z",
  },
  { url: "https://www.tiktok.com/@carol/video/7698672184512149589", creator: "@carol" },
];

const TAGS = [
  row({
    id: "tiktok:SA:tag-velocityedit",
    title: "#velocityedit",
    url: "https://www.tiktok.com/tag/velocityedit",
    score: 100,
    kind: "hashtag",
    periodDays: 7,
    proof: PROOF,
  }),
  row({
    id: "tiktok:SA:tag-noproof",
    title: "#noproof",
    score: 90,
    kind: "hashtag",
    periodDays: 7,
  }),
  row({
    id: "tiktok:US:tag-greenscreen",
    region: "US",
    lang: "en",
    title: "#greenscreen",
    score: 100,
    kind: "hashtag",
    periodDays: 7,
    proof: PROOF.slice(0, 1),
  }),
];

const OTHERS = [
  row({ id: "topic-sa", platform: "google", source: "Google Trends", title: "موضوع", score: 80 }),
  row({
    id: "sound-sa",
    source: "kworb.net",
    title: "Artist - Song",
    score: 70,
    tags: ["sound"],
  }),
  row({
    id: "scan-tag-sa",
    platform: "instagram",
    source: "Tavily scan",
    title: "#سعودي",
    score: 60,
  }),
  row({
    id: "video-sa",
    platform: "youtube",
    source: "YouTube charts",
    title: "Video",
    score: 50,
  }),
];

let host: HTMLDivElement;
let root: Root;

const feed = (items: TrendItemInput[]) =>
  act(() => useStore.getState().setTrends({ items, fetchedAt: SEEN_AT }));
const rowIds = () =>
  [...host.querySelectorAll('[data-testid="trend-row"]')].map((r) => r.getAttribute("data-id"));
const rowEl = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="trend-row"][data-id="${id}"]`)!;
const byId = (el: ParentNode, id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
function click(testId: string, within: ParentNode = host): void {
  act(() => byId(within, testId)!.click());
}
function type(testId: string, value: string): void {
  const input = byId(host, testId) as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const s = useStore.getState();
  s.clearTrends();
  for (const i of s.ideas) s.removeIdea(i.id);
  s.setSettings({ lang: "ar", apiKeys: { ...s.settings.apiKeys, scoutUrl: "", scoutToken: "" } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(TrendRadar)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("TikTok Discovery hashtags in the radar", () => {
  it("SA is the Arabic tab and US the English one, each row a hashtag with its source, window and tag page", () => {
    feed(TAGS);
    expect(rowIds()).toEqual(["tiktok:SA:tag-velocityedit", "tiktok:SA:tag-noproof"]);
    const first = rowEl("tiktok:SA:tag-velocityedit");
    expect(first.getAttribute("data-source")).toBe("TikTok Discovery");
    expect(byId(first, "trend-source")!.textContent).toBe("اكتشاف TikTok");
    expect(byId(first, "trend-kind")!.textContent).toBe("هاشتاق");
    expect(byId(first, "trend-period")!.textContent).toBe("آخر 7 أيام");
    const link = byId(first, "trend-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://www.tiktok.com/tag/velocityedit");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(byId(first, "trend-volume")).toBeNull();

    click("trends-tab-en");
    expect(rowIds()).toEqual(["tiktok:US:tag-greenscreen"]);
    act(() => useStore.getState().setSettings({ lang: "en" }));
    const us = rowEl("tiktok:US:tag-greenscreen");
    expect(byId(us, "trend-source")!.textContent).toBe("TikTok Discovery");
    expect(byId(us, "trend-kind")!.textContent).toBe("Hashtag");
    expect(byId(us, "trend-period")!.textContent).toBe("Last 7 days");
  });

  it("shows the top videos with the date each id carries, the newest one named, as links out", () => {
    feed(TAGS);
    const proof = byId(rowEl("tiktok:SA:tag-velocityedit"), "trend-proof")!;
    expect(proof.getAttribute("data-count")).toBe("3");
    const links = [
      ...proof.querySelectorAll<HTMLAnchorElement>('[data-testid="trend-proof-link"]'),
    ];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(PROOF.map((p) => p.url));
    for (const a of links) {
      expect(a.getAttribute("target")).toBe("_blank");
      expect(a.getAttribute("rel")).toContain("noopener");
    }
    // Each link is a 44px tap target (tools/18 §3.3) around the chip, which keeps its look.
    for (const a of links) {
      expect(a.className).toContain("min-h-11");
      expect(a.querySelector(".px-chip")).not.toBeNull();
    }
    expect(links[0].textContent).toContain("@alice");
    expect(links[0].textContent).toContain("21");
    expect(links[0].textContent).toContain("2026");
    expect(links[0].getAttribute("data-posted-at")).toBe("2026-10-21T09:00:00.000Z");
    // Without a date from the id, no date is made up.
    expect(links[2].textContent).toContain("@carol");
    expect(links[2].hasAttribute("data-posted-at")).toBe(false);
    expect(byId(proof, "trend-proof-newest")!.textContent).toMatch(/الأحدث/);
    act(() => useStore.getState().setSettings({ lang: "en" }));
    expect(links[0].textContent).toContain("21 Oct 2026");
  });

  it("a hashtag without proof shows no proof strip", () => {
    feed(TAGS);
    expect(byId(rowEl("tiktok:SA:tag-noproof"), "trend-proof")).toBeNull();
  });
});

describe("the kind filter", () => {
  it("Hashtags, Sounds and Topics narrow the list; All brings everything back; it combines with the platform chip", () => {
    feed([...TAGS, ...OTHERS]);
    expect(rowIds()).toEqual([
      "tiktok:SA:tag-velocityedit",
      "tiktok:SA:tag-noproof",
      "topic-sa",
      "sound-sa",
      "scan-tag-sa",
      "video-sa",
    ]);
    click("trends-kind-hashtag");
    expect(rowIds()).toEqual([
      "tiktok:SA:tag-velocityedit",
      "tiktok:SA:tag-noproof",
      "scan-tag-sa",
    ]);
    click("trends-kind-sound");
    expect(rowIds()).toEqual(["sound-sa"]);
    click("trends-kind-topic");
    expect(rowIds()).toEqual(["topic-sa"]);
    click("trends-kind-hashtag");
    click("trends-platform-tiktok");
    expect(rowIds()).toEqual(["tiktok:SA:tag-velocityedit", "tiktok:SA:tag-noproof"]);
    click("trends-platform-all");
    click("trends-kind-all");
    expect(rowIds()).toHaveLength(6);
    expect(byId(host, "trends-kind-all")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("names the chips in the UI language", () => {
    feed(TAGS);
    expect(byId(host, "trends-kind-hashtag")!.textContent).toBe("هاشتاقات");
    act(() => useStore.getState().setSettings({ lang: "en" }));
    expect(byId(host, "trends-kind-hashtag")!.textContent).toBe("Hashtags");
    expect(byId(host, "trends-kind-sound")!.textContent).toBe("Sounds");
    expect(byId(host, "trends-kind-topic")!.textContent).toBe("Topics");
  });
});

describe("the weekly Instagram sounds card", () => {
  const ritual = () => byId(host, "trends-ritual")!;
  const ideas = () => useStore.getState().ideas;

  it("is there without a Worker, empty at first, with the save button off", () => {
    expect(ritual()).not.toBeNull();
    expect(byId(ritual(), "ritual-last")).toBeNull();
    expect(byId(ritual(), "ritual-none")).not.toBeNull();
    expect((byId(ritual(), "ritual-save") as HTMLButtonElement).disabled).toBe(true);
    expect(ritual().querySelectorAll("input")).toHaveLength(4);
  });

  it("saves the pasted sounds and the format as Instagram trend ideas dated today, then lists them", () => {
    type("ritual-sound-0", "  Dua Lipa - Houdini ");
    type("ritual-sound-1", "Sound two");
    type("ritual-format", "POV");
    expect((byId(ritual(), "ritual-save") as HTMLButtonElement).disabled).toBe(false);
    click("ritual-save");

    const today = dayKey();
    expect(ideas().map((i) => [i.source, i.platform, i.text])).toEqual([
      ["trend", "instagram", `🎵 صوت انستقرام · ${today}: Dua Lipa - Houdini`],
      ["trend", "instagram", `🎵 صوت انستقرام · ${today}: Sound two`],
      ["trend", "instagram", `🎞️ فورمات انستقرام · ${today}: POV`],
    ]);
    expect(byId(ritual(), "ritual-saved")!.textContent).toContain("3");
    expect(byId(ritual(), "ritual-last")!.getAttribute("data-day")).toBe(today);
    expect(byId(ritual(), "ritual-last")!.getAttribute("data-stale")).toBe("false");
    expect(ritual().querySelectorAll('[data-testid="ritual-last-sound"]')).toHaveLength(2);
    expect(byId(ritual(), "ritual-last-format")!.textContent).toBe("POV");
    // The form is empty again.
    expect((byId(ritual(), "ritual-sound-0") as HTMLInputElement).value).toBe("");
    expect(byId(ritual(), "ritual-duplicate")).toBeNull();
  });

  it("pasting only what is already saved keeps the inputs and says so, never a silent clear", () => {
    type("ritual-sound-0", "Sound two");
    click("ritual-save");
    expect(ideas()).toHaveLength(1);
    type("ritual-sound-0", "  sound TWO ");
    type("ritual-sound-1", "Sound two");
    click("ritual-save");
    expect(ideas()).toHaveLength(1);
    expect((byId(ritual(), "ritual-sound-0") as HTMLInputElement).value).toBe("  sound TWO ");
    expect((byId(ritual(), "ritual-sound-1") as HTMLInputElement).value).toBe("Sound two");
    expect(byId(ritual(), "ritual-duplicate")!.textContent).toBe("كلها محفوظة من قبل");
    expect(byId(ritual(), "ritual-saved")).toBeNull();
    act(() => useStore.getState().setSettings({ lang: "en" }));
    expect(byId(ritual(), "ritual-duplicate")!.textContent).toBe("Already saved");
    // Typing again clears the notice; a mix of old and new saves only the new one and clears the form.
    type("ritual-sound-2", "Sound three");
    expect(byId(ritual(), "ritual-duplicate")).toBeNull();
    click("ritual-save");
    expect(ideas()).toHaveLength(2);
    expect((byId(ritual(), "ritual-sound-0") as HTMLInputElement).value).toBe("");
    expect(byId(ritual(), "ritual-saved")!.textContent).toContain("1");
  });

  it("calls a paste older than a week old, and never offers a reminder", () => {
    act(() => {
      useStore.getState().addIdea(
        {
          text: "🎵 Instagram sound · 2026-01-02: Old sound",
          source: "trend",
          platform: "instagram",
        },
        new Date("2026-01-02T09:00:00Z"),
      );
    });
    const last = byId(ritual(), "ritual-last")!;
    expect(last.getAttribute("data-stale")).toBe("true");
    expect(byId(last, "ritual-old")).not.toBeNull();
    expect(ritual().textContent).not.toMatch(/تذكير|تنبيه|إشعار|remind|notif/i);
    expect(ritual().querySelector('input[type="checkbox"], [role="switch"]')).toBeNull();
  });
});
