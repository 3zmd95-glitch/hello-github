// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DiscoverCandidate } from "@/lib/discoverFeed";
import type { EditFormat } from "@/lib/editFormats";
import { tiktokIdAt } from "@/workers/scout/src/postDate";
import feedEn from "@/messages/feed.en.json";
import inspirationEn from "@/messages/inspiration.en.json";
import TrendingEdits from "./TrendingEdits";

const DAY = 86_400_000;
const fixture = vi.hoisted(() => ({
  store: {
    discoverCandidates: [] as DiscoverCandidate[],
    followedFormats: [] as { format: EditFormat; followedAt: string }[],
    followFormat: vi.fn(),
    unfollowFormat: vi.fn(),
    settings: {
      discover: { editorScope: "all" as "mine" | "all" },
      apiKeys: { scoutUrl: "", scoutToken: "" },
    },
  },
}));
vi.mock("@/store", () => ({
  useStore: (select: (state: typeof fixture.store) => unknown) => select(fixture.store),
}));
vi.mock("@/lib/i18n", () => ({
  useT: () => ({
    lang: "en",
    t: (key: string, vars?: Record<string, string | number>) =>
      (({ ...feedEn, ...inspirationEn }) as Record<string, string>)[key]?.replace(
        /\{(\w+)\}/g,
        (match, name) => String(vars?.[name] ?? match),
      ) ?? key,
  }),
}));

const WORKER = "https://scout.example.workers.dev";
const CONFIG = { url: WORKER, token: "t" };
const now = Date.now();
let n = 0;
/** A source-read TikTok post in `genreId` that names the clone effect, with views over the feed's floor. */
function candidate(
  creator: string,
  genreId: string,
  daysAgo: number,
  views = 50_000,
): DiscoverCandidate {
  const at = new Date(now - daysAgo * DAY).toISOString();
  const caption = `${genreId === "cars" ? "car" : "anime"} clone effect edit`;
  return {
    genreId,
    obtainedAt: at,
    item: {
      platform: "tt",
      url: `https://www.tiktok.com/@${creator}/video/${tiktokIdAt(new Date(at), ++n)}`,
      handle: `@${creator}`,
      title: caption,
      snippet: "",
      lang: "en",
      section: "example",
      evidence: {
        source: "tiktok-public-page",
        caption,
        author: creator,
        observedAt: new Date(now).toISOString(),
        published: at,
        views,
      },
    },
  };
}
const corpus = () => [
  candidate("a", "cars", 1),
  candidate("b", "cars", 2),
  // A small editor (views far below the Inspiration floor) still counts: breadth over engagement.
  candidate("c", "anime", 3, 120),
];
const checked = new Date(now - DAY).toISOString();
const FORMAT = {
  key: "night-walk|clone",
  name: { en: "Night Walk — clone figures", ar: "مشية الليل" },
  visualPattern: { en: "clone figures on each beat" },
  audio: { title: "Night Walk", artist: "Fixture Artist" },
  firstSeen: checked,
  lastChecked: checked,
  evidence: {
    state: "repeated",
    creators7d: 4,
    posts7d: 5,
    latestPostAt: checked,
    scope: "indexed-public-posts",
  },
  samples: [
    {
      url: "https://www.instagram.com/reel/NW1/",
      title: "clone figures to Night Walk",
      platform: "ig",
      handle: "walker",
      published: checked,
      observedAt: checked,
      patternQuote: "clone figures on each beat",
      audioQuote: "Night Walk",
    },
  ],
};

let calls: string[] = [];
let answer: unknown = { status: "ok", items: [] };
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  sessionStorage.clear();
  calls = [];
  answer = { status: "ok", items: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${new URL(url, "http://localhost").pathname}`);
      return new Response(JSON.stringify(answer), { status: 200 });
    }),
  );
  fixture.store.discoverCandidates = [];
  fixture.store.followedFormats = [];
  fixture.store.followFormat.mockClear();
  fixture.store.unfollowFormat.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const render = async (node: ReactNode) => {
  await act(async () => root.render(node));
  // Let the cached GET resolve and render.
  await act(async () => {});
};
const q = (id: string, within: ParentNode = host) => [
  ...within.querySelectorAll(`[data-testid="${id}"]`),
];
const SPENDING = /^POST |\/effects\/run|\/categories\/[^/]+\/(run|top)|\/discover\b/;

it("shows the empty state without any run or scan button, and asks nothing without a Worker", async () => {
  const onPick = vi.fn();
  await render(createElement(TrendingEdits, { config: null, onPick }));
  expect(host.textContent).toContain(feedEn["feed.edits.title"]);
  expect(host.textContent).toContain(feedEn["feed.edits.honest"]);
  expect(q("trending-edits-empty")[0]?.textContent).toBe(feedEn["feed.edits.empty"]);
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(calls).toEqual([]);
});

it("lists a technique from the local corpus with proof, rising mark, dated examples and its actions", async () => {
  fixture.store.discoverCandidates = corpus();
  const onPick = vi.fn();
  await render(createElement(TrendingEdits, { config: null, onPick }));
  const [row] = q("trending-edit");
  expect(row.getAttribute("data-key")).toBe("clone effect");
  expect(row.getAttribute("data-tier")).toBe("trending");
  expect(q("trending-edit-proof", row)[0].textContent).toMatch(
    /^3 creators · 2 categories · .+ → .+$/,
  );
  expect(q("trending-edit-rising", row)).toHaveLength(1);
  const examples = q("trending-edit-example", row);
  expect(examples).toHaveLength(3);
  expect(examples[0].textContent).toContain("@a");
  expect(q("trending-edit-follow", row)).toHaveLength(0);
  (q("trending-edit-learn", row)[0] as HTMLButtonElement).click();
  (q("trending-edit-examples", row)[0] as HTMLButtonElement).click();
  expect(onPick.mock.calls).toEqual([
    ["clone effect edit tutorial", "tutorials", undefined],
    ["clone effect", "examples", undefined],
  ]);
  expect(calls).toEqual([]);
});

it("hides a row whose every example is another editor's", async () => {
  fixture.store.discoverCandidates = corpus().map((entry) => ({
    ...entry,
    item: { ...entry.item, title: `${entry.item.title} in after effects` },
  }));
  fixture.store.settings.discover.editorScope = "mine";
  await render(createElement(TrendingEdits, { config: null, onPick: vi.fn() }));
  expect(q("trending-edit")).toHaveLength(0);
  expect(q("trending-edits-empty")).toHaveLength(1);
  fixture.store.settings.discover.editorScope = "all";
});

it("reads the daily list once through the cached GET, merges it, and follows a format once", async () => {
  fixture.store.discoverCandidates = corpus();
  answer = {
    evidenceVersion: 1,
    formatVersion: 1,
    status: "ok",
    updatedAt: new Date(now - 3_600_000).toISOString(),
    items: [
      {
        key: "clone-effect",
        name: { en: "clone effect", ar: "تأثير الاستنساخ" },
        isNew: false,
        creators: 9,
        growth: 1.5,
        samples: [
          {
            url: `https://www.tiktok.com/@cloner/video/${tiktokIdAt(new Date(now - 5 * DAY), 1)}`,
            title: "clone",
            published: new Date(now - 5 * DAY).toISOString(),
          },
        ],
      },
    ],
    formats: [FORMAT],
  };
  const onPick = vi.fn();
  await render(createElement(TrendingEdits, { config: CONFIG, onPick }));
  const rows = q("trending-edit");
  expect(rows.map((r) => r.getAttribute("data-key"))).toEqual([
    "clone effect",
    "night walk clone figure",
  ]);
  // Both sources show: the 3 creators Discover read in 2 categories, and the scan's 9 identified accounts.
  expect(q("trending-edit-proof", rows[0])[0].textContent).toMatch(
    /^3 creators · 2 categories · .+ → .+ · scan: 9 identified accounts in 7 days$/,
  );
  // Only the daily scan counted the format: emerging, worded as its 7-day identified accounts.
  expect(rows[1].getAttribute("data-tier")).toBe("emerging");
  expect(q("trending-edit-proof", rows[1])[0].textContent).toMatch(
    /^4 identified accounts in 7 days · latest sample .+$/,
  );
  expect(q("trending-edit-learn", rows[1])[0].getAttribute("aria-label")).toBe(
    "Learn this edit: Night Walk — clone figures",
  );
  const follow = q("trending-edit-follow", rows[1])[0] as HTMLButtonElement;
  expect(follow.textContent).toBe(inspirationEn["formats.follow"]);
  follow.click();
  expect(fixture.store.followFormat).toHaveBeenCalledTimes(1);
  expect(fixture.store.followFormat.mock.calls[0][0]).toMatchObject({ key: FORMAT.key });
  (q("trending-edit-learn", rows[1])[0] as HTMLButtonElement).click();
  expect(onPick).toHaveBeenCalledTimes(1);
  const [query, intent, format] = onPick.mock.calls[0];
  expect([query.includes("Night Walk"), query.includes("tutorial"), intent]).toEqual([
    true,
    true,
    "tutorials",
  ]);
  expect(format).toMatchObject({ key: FORMAT.key });
  // A second mount within the hour reads this tab's copy: still one GET, never a spending route.
  await act(async () => root.unmount());
  root = createRoot(host);
  await render(createElement(TrendingEdits, { config: CONFIG, onPick }));
  expect(calls).toEqual(["GET /effects/trending"]);
  expect(calls.filter((call) => SPENDING.test(call))).toEqual([]);
});

it("lists a daily-scan row that carries no samples, dated by the scan, with its buttons and no example grid", async () => {
  answer = {
    status: "ok",
    ranOn: "2026-10-23",
    updatedAt: new Date(now - 3_600_000).toISOString(),
    items: [
      {
        key: "freeze-frame",
        name: { en: "freeze frame", ar: "تجميد اللقطة" },
        isNew: false,
        creators: 21,
        growth: 1,
        samples: [],
      },
    ],
  };
  const onPick = vi.fn();
  await render(createElement(TrendingEdits, { config: CONFIG, onPick }));
  const [row] = q("trending-edit");
  expect(row.getAttribute("data-key")).toBe("freeze frame");
  expect(row.getAttribute("data-tier")).toBe("trending");
  expect(q("trending-edit-proof", row)[0].textContent).toMatch(
    /^21 identified accounts in the last 7 days · daily scan \d+ \w+$/,
  );
  expect(q("trending-edit-example", row)).toHaveLength(0);
  (q("trending-edit-learn", row)[0] as HTMLButtonElement).click();
  (q("trending-edit-examples", row)[0] as HTMLButtonElement).click();
  expect(onPick.mock.calls).toEqual([
    ["freeze frame edit tutorial", "tutorials", undefined],
    ["freeze frame", "examples", undefined],
  ]);
  expect(calls).toEqual(["GET /effects/trending"]);
});

it("states what was counted: the posts read, the recent ones and, with a Worker, the scan day", async () => {
  fixture.store.discoverCandidates = [...corpus(), candidate("z", "cars", 20)];
  await render(createElement(TrendingEdits, { config: null, onPick: vi.fn() }));
  expect(q("trending-edits-stats")[0].textContent).toBe(
    "Counted from 4 posts Discover has read (3 in the last 14 days)",
  );
  answer = {
    status: "ok",
    updatedAt: new Date(now - 3_600_000).toISOString(),
    items: [{ key: "a", name: { en: "a" }, isNew: false, creators: 3, growth: 1 }],
  };
  await act(async () => root.unmount());
  root = createRoot(host);
  await render(createElement(TrendingEdits, { config: CONFIG, onPick: vi.fn() }));
  expect(q("trending-edits-stats")[0].textContent).toMatch(
    /^Counted from 4 posts Discover has read \(3 in the last 14 days\) and the daily scan of \d+ \w+$/,
  );
});

it("renders its examples, Instagram included, with no preview lookup of any kind", async () => {
  fixture.store.discoverCandidates = [];
  answer = {
    evidenceVersion: 1,
    formatVersion: 1,
    status: "ok",
    updatedAt: new Date(now - 3_600_000).toISOString(),
    items: [],
    formats: [FORMAT],
  };
  const xhr = vi.spyOn(XMLHttpRequest.prototype, "open");
  await render(createElement(TrendingEdits, { config: CONFIG, onPick: vi.fn() }));
  const ig = q("trending-edit-example").filter((el) => el.getAttribute("data-platform") === "ig");
  expect(ig.length).toBeGreaterThan(0);
  expect(q("trending-edit-preview")).toHaveLength(q("trending-edit-example").length);
  expect(xhr).not.toHaveBeenCalled();
  // The only request is the cached daily list; no /api/local-ai/instagram-preview, no oEmbed.
  expect(calls).toEqual(["GET /effects/trending"]);
  xhr.mockRestore();
});
