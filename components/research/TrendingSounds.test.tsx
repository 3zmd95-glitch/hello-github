// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import type { SoundObservation } from "@/lib/trendingSounds";
import { instagramShortcodeAt, tiktokIdAt } from "@/workers/scout/src/postDate";
import feedEn from "@/messages/feed.en.json";
import TrendingSounds, { useRecordSounds } from "./TrendingSounds";

const fixture = vi.hoisted(() => ({
  rows: [] as SoundObservation[],
  recorded: [] as SoundObservation[][],
  store: { settings: { discover: { editorScope: "mine" as "mine" | "all" } } },
}));
vi.mock("@/lib/trendingSounds", async (original) => ({
  ...(await original<typeof import("@/lib/trendingSounds")>()),
  readSoundObservations: async () => fixture.rows,
  recordSoundObservations: async (rows: SoundObservation[]) => {
    fixture.recorded.push(rows);
  },
}));
const helper = vi.hoisted(() => ({
  started: [] as unknown[][],
  urls: {} as Record<string, string>,
  fail: false,
}));
vi.mock("@/lib/discoverNativeSearch", async (original) => ({
  ...(await original<typeof import("@/lib/discoverNativeSearch")>()),
  startNativeSearch: async (...args: unknown[]) => {
    helper.started.push(args);
    if (helper.fail) throw new Error("busy");
    return `job-${helper.started.length}`;
  },
  // Each search finds one TikTok post by its own creator, already finished.
  pollNativeSearch: async (jobId: string) => ({
    jobId,
    status: "complete",
    hasMore: false,
    platforms: {
      tt: {
        status: "done",
        searchUrl: "https://www.tiktok.com/search?q=edit",
        results: [
          {
            platform: "tt",
            url: helper.urls[jobId],
            title: "edit",
            handle: jobId,
            position: 0,
            observedAt: new Date().toISOString(),
          },
        ],
      },
      ig: { status: "empty", searchUrl: "https://www.instagram.com/", results: [] },
    },
  }),
}));
vi.mock("@/lib/discoverSources", async (original) => ({
  ...(await original<typeof import("@/lib/discoverSources")>()),
  localTikTokSource: async (url: string) => ({ url }),
  applyTikTokEvidence: (target: DiscoverItem, source: { url: string } | null) =>
    source
      ? {
          ...target,
          evidence: {
            source: "tiktok-public-page",
            observedAt: new Date().toISOString(),
            author: target.handle,
            sound: { title: "Espresso", platform: "tt" },
          },
        }
      : target,
}));
vi.mock("@/store", () => ({
  useStore: (select: (state: typeof fixture.store) => unknown) => select(fixture.store),
}));
vi.mock("@/lib/i18n", () => ({
  useT: () => ({
    lang: "en",
    t: (key: string, vars?: Record<string, string | number>) =>
      ((feedEn as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (match, name) =>
        String(vars?.[name] ?? match),
      ),
  }),
}));
vi.mock("./ResultCard", async (original) => ({
  ...(await original<typeof import("./ResultCard")>()),
  default: ({ item, testId, action }: { item: DiscoverItem; testId: string; action: ReactNode }) =>
    createElement("li", { "data-testid": testId, "data-url": item.url }, item.title, action),
}));

const { soundObservations, TRENDING_SOUNDS_EVENT } = await import("@/lib/trendingSounds");
const DAY = 86_400_000;
let n = 0;
function item(platform: "ig" | "tt", creator: string, caption: string, url?: string): DiscoverItem {
  const at = new Date(Date.now() - DAY);
  return {
    platform,
    url:
      platform === "tt"
        ? `https://www.tiktok.com/@${creator}/video/${tiktokIdAt(at, ++n)}`
        : `https://www.instagram.com/reel/${instagramShortcodeAt(at, ++n)}/`,
    handle: creator,
    title: caption,
    snippet: caption,
    lang: "en",
    section: "example",
    evidence: {
      source: platform === "tt" ? "tiktok-public-page" : "instagram-public-embed",
      observedAt: new Date().toISOString(),
      author: creator,
      sound: { title: "Espresso", artist: "Sabrina Carpenter", platform, ...(url ? { url } : {}) },
    },
  };
}
const IG_SOUND = "https://www.instagram.com/reels/audio/123/";
const TT_SOUND = "https://www.tiktok.com/music/Espresso-6800000000000000001";
const trending = () => [
  ...soundObservations(
    [item("ig", "a", "car edit", IG_SOUND), item("tt", "b", "car edit davinci", TT_SOUND)],
    "cars",
  ),
  ...soundObservations([item("ig", "c", "anime edit in after effects")], "anime"),
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fixture.rows = [];
  fixture.recorded = [];
  fixture.store.settings.discover.editorScope = "mine";
  helper.started = [];
  helper.fail = false;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = async (node: ReactNode) => {
  await act(async () => root.render(node));
};
const q = (id: string) => [...host.querySelectorAll(`[data-testid="${id}"]`)];

it("explains how the block fills, and that counts are not an official chart", async () => {
  await render(createElement(TrendingSounds));
  expect(host.textContent).toContain(feedEn["feed.soundsTitle"]);
  expect(q("trending-sounds-empty")[0]?.textContent).toBe(feedEn["feed.soundsEmpty"]);
  expect(host.textContent).toContain(feedEn["feed.soundsHonest"]);
});

it("lists a trending sound with platform counts, stats, sound links and playable examples, filtering other editors", async () => {
  fixture.rows = trending();
  await render(
    createElement(TrendingSounds, {
      renderAction: () => createElement("span", { "data-testid": "save" }),
    }),
  );
  const [sound] = q("trending-sound");
  expect(sound.getAttribute("data-label")).toBe("trending");
  expect(sound.textContent).toContain("Espresso");
  expect(sound.textContent).toContain("Sabrina Carpenter");
  expect(sound.textContent).toContain(feedEn["feed.soundsTrending"]);
  expect(sound.textContent).toContain("Instagram 2");
  expect(sound.textContent).toContain("TikTok 1");
  expect(sound.textContent).toContain("3 posts · 2 categories");
  const links = [...sound.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.target]);
  expect(links).toEqual([
    [IG_SOUND, "_blank"],
    [TT_SOUND, "_blank"],
  ]);
  // The After Effects post counts toward the sound but is not shown as an example under "mine".
  expect(q("trending-sound-example").map((card) => card.textContent)).toEqual([
    "car edit",
    "car edit davinci",
  ]);
  expect(q("save")).toHaveLength(2);
  fixture.store.settings.discover.editorScope = "all";
  await render(createElement(TrendingSounds));
  expect(q("trending-sound-example")).toHaveLength(3);
});

it("refreshes when Discover records new sounds", async () => {
  await render(createElement(TrendingSounds));
  expect(q("trending-sound")).toHaveLength(0);
  fixture.rows = trending();
  await act(async () => {
    window.dispatchEvent(new Event(TRENDING_SOUNDS_EVENT));
  });
  expect(q("trending-sound")).toHaveLength(1);
});

it("records a feed's sounds under its category once per changed set", async () => {
  const items = [
    item("ig", "a", "car edit", IG_SOUND),
    { ...item("tt", "b", "x"), evidence: undefined },
  ];
  function Probe({ list, active }: { list: DiscoverItem[]; active: boolean }) {
    useRecordSounds(list, "cars", active);
    return null;
  }
  await render(createElement(Probe, { list: items, active: false }));
  expect(fixture.recorded).toEqual([]);
  await render(createElement(Probe, { list: items, active: true }));
  await render(createElement(Probe, { list: [...items], active: true }));
  expect(fixture.recorded).toHaveLength(1);
  expect(fixture.recorded[0]).toMatchObject([{ category: "cars", creator: "a", platform: "ig" }]);
});

it("labels a sound only seen in the last 30 days as seen in edits", async () => {
  const at = (days: number, creator: string) => ({
    ...item("tt", creator, `${creator} edit`),
    url: `https://www.tiktok.com/@${creator}/video/${tiktokIdAt(new Date(Date.now() - days * DAY), ++n)}`,
  });
  fixture.rows = soundObservations([at(20, "a"), at(25, "b")], "cars");
  await render(createElement(TrendingSounds));
  const [sound] = q("trending-sound");
  expect(sound.getAttribute("data-label")).toBe("seen");
  expect(sound.textContent).toContain(feedEn["feed.soundsSeen"]);
  expect(sound.textContent).toContain("2 posts · 1 category");
});

it("refreshes sounds with quiet TikTok and Instagram searches for the edit queries, one after another", async () => {
  helper.urls = Object.fromEntries(
    Array.from({ length: 7 }, (_, index) => [
      `job-${index + 1}`,
      `https://www.tiktok.com/@job-${index + 1}/video/${tiktokIdAt(new Date(Date.now() - DAY), ++n)}`,
    ]),
  );
  await render(createElement(TrendingSounds));
  const button = q("trending-sounds-refresh")[0] as HTMLButtonElement;
  expect(button.textContent).toBe(feedEn["feed.soundsRefresh"]);
  await act(async () => button.click());
  const queries = [
    "edit",
    "capcut edit",
    "davinci resolve edit",
    "transition edit",
    "car edit",
    "anime edit",
    "football edit",
  ];
  // Quiet: no deep option; TikTok and Instagram only (no YouTube).
  expect(helper.started.map(([queriesArg, , options]) => [queriesArg, options])).toEqual(
    queries.map((query) => [{ ig: query, tt: query }, undefined]),
  );
  expect(fixture.recorded.map((rows) => rows.map((row) => row.category))).toEqual([
    ["search:edit"],
    ["search:edit"],
    ["search:edit"],
    ["search:transition edit"],
    ["search:car edit"],
    ["search:anime edit"],
    ["search:football edit"],
  ]);
  expect(q("trending-sounds-refresh-status")[0]?.textContent).toBe(
    feedEn["feed.soundsRefreshDone"].replace("{count}", "7"),
  );
  expect(button.disabled).toBe(false);
});

it("says when a sounds refresh cannot run", async () => {
  helper.fail = true;
  await render(createElement(TrendingSounds));
  await act(async () => (q("trending-sounds-refresh")[0] as HTMLButtonElement).click());
  expect(helper.started).toHaveLength(1);
  expect(q("trending-sounds-refresh-status")[0]?.textContent).toBe(
    feedEn["feed.soundsRefreshError"],
  );
});
