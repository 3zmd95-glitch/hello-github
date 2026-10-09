// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearDiscoverCache,
  DISCOVER_QUALITY_VERSION,
  type DiscoverAnswer,
  type DiscoverItem,
} from "@/lib/discover";
import { useStore } from "@/store";
import ResearchPanel from "./ResearchPanel";
import DiscoverScreen from "../discover/DiscoverScreen";
import { clearScoutCaps } from "./useDiscover";
import { discoverVisualFixture } from "@/lib/discoverVisual.fixture";

const WORKER = "https://feed.scout.test";
let requests: Record<string, unknown>[];
let usageRequests: number;
let fixtures: DiscoverItem[];
let platformStatuses: DiscoverAnswer["platforms"];
let searchFailure: boolean;
let host: HTMLDivElement;
let root: Root;
const $ = (id: string, within: ParentNode = host) =>
  within.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (id: string, within: ParentNode = host) => [
  ...within.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const titles = () => all("result-title", $("category-feed")!).map((node) => node.textContent);
const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const settle = async () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const click = async (node: HTMLElement | null) => {
  if (!node) throw new Error("Missing control");
  act(() => node.click());
  await settle();
};

function video(id: string, title: string, views: number, creator = "@editor"): DiscoverItem {
  const at = new Date().toISOString();
  return {
    platform: "yt",
    handle: creator,
    title,
    snippet: title,
    url: `https://www.youtube.com/watch?v=${id}`,
    thumb: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    lang: "en",
    section: "example",
    published: at,
    stats: { views },
    evidence: {
      source: "youtube-api",
      observedAt: at,
      caption: title,
      author: creator,
      views,
      published: at,
    },
  };
}

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  requests = [];
  usageRequests = 0;
  platformStatuses = { yt: { ok: true }, ig: { ok: true }, tt: { ok: true } };
  searchFailure = false;
  fixtures = [
    video("animeStrongA", "Anime beat sync edit", 40_000, "@first"),
    video("animeStrongB", "Anime split screen edit", 35_000, "@second"),
    video("animeLessonA", "Anime masking tutorial step by step", 80, "@teacher"),
    video("animeTeaserA", "Anime masking tutorial coming soon", 100, "@teaser"),
    {
      ...video("low", "Anime beat sync edit with five likes", 0, "@small"),
      platform: "ig",
      url: "https://www.instagram.com/p/AnimeLow5/",
      stats: { likes: 5 },
      evidence: undefined,
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/health")
        return json({ ok: true, auth: true, tavily: true, discover: true });
      if (url.pathname === "/discover" && init?.method === "POST") {
        requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        if (searchFailure) return new Response("{}", { status: 503 });
        return json({
          qualityVersion: DISCOVER_QUALITY_VERSION,
          topicKey: "anime",
          understood: { label: { en: "Anime", ar: "أنمي" }, exact: false },
          alternatives: [],
          items: fixtures,
          creators: [],
          platforms: platformStatuses,
          cost: { tavily: 1, youtubeSearch: 1 },
          cached: false,
          complete: true,
        });
      }
      if (url.pathname === "/discover/usage") {
        usageRequests++;
        return json({
          tavily: { used: 930 + requests.length, limit: 1000 },
          youtube: { usedToday: 0, cap: 70 },
          connector: { usedToday: 0, cap: 60 },
        });
      }
      return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
    }),
  );
  localStorage.clear();
  clearDiscoverCache();
  clearScoutCaps();
  useStore.setState({
    discoverLibraryStatus: "ready",
    discoverCandidates: [],
    discoverFeedback: [],
    recentTopics: [],
    customGenres: [],
    savedRefs: {},
    inspirations: [],
  });
  useStore
    .getState()
    .setSettings({ lang: "en", apiKeys: { scoutUrl: WORKER, scoutToken: "test", youtube: "" } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function mount() {
  act(() => root.render(createElement(ResearchPanel, { openGenre: "anime" })));
  await settle();
}

describe("category editor feed", () => {
  it("uses canonical sampled-frame evidence in Browse and keeps its limits separate from caption claims", async () => {
    const at = new Date().toISOString();
    const item: DiscoverItem = {
      platform: "ig",
      url: "https://www.instagram.com/reel/VisualCaptionSparse/?igsh=test",
      title: "#anime",
      snippet: "#anime",
      handle: "visual_editor",
      lang: "en",
      section: "example",
      evidence: {
        source: "instagram-public-embed",
        author: "visual_editor",
        caption: "#anime",
        observedAt: at,
        likes: 4000,
      },
    };
    useStore.getState().accumulateDiscoverCandidates([item], { genreId: "anime" });
    act(() => root.render(createElement(DiscoverScreen)));
    await settle();
    await click($("genre-anime"));
    expect(titles()).toHaveLength(0);
    expect(requests).toHaveLength(0);
    expect($("category-visual")?.hasAttribute("open")).toBe(false);
    expect($("ai-connections", $("category-visual")!)).toBeNull();
    act(() =>
      useStore.setState({
        discoverCandidates: useStore.getState().discoverCandidates.map((candidate) => ({
          ...candidate,
          visual: discoverVisualFixture(candidate.item, "anime", Date.now()),
        })),
      }),
    );
    await settle();
    expect(titles()).toEqual(["#anime"]);
    expect($("feed-source-note")?.textContent).toContain("AI checked sampled frames");
    expect($("feed-source-note")?.textContent).not.toContain("footage has not been reviewed");
    expect($("feed-visual-evidence")?.textContent).toContain("test-vision · high");
    expect($("feed-visual-evidence")?.textContent).toContain("Large layered title treatment");
    expect($("feed-visual-evidence")?.textContent).toContain("11.0s");
    expect($("feed-visual-evidence")?.textContent).toContain("do not establish full motion");
    act(() => useStore.getState().setSettings({ lang: "ar" }));
    await settle();
    expect($("feed-source-note")?.textContent).not.toContain("AI checked");
    expect($("feed-visual-evidence")?.textContent).toContain("test-vision · high");
    expect(requests).toHaveLength(0);
  });
  it.each(["search", "browse"] as const)(
    "waits for durable category hydration in %s before deciding whether a lookup is needed",
    async (workspace) => {
      act(() => useStore.setState({ discoverLibraryStatus: "loading" }));
      if (workspace === "browse") {
        act(() => root.render(createElement(DiscoverScreen)));
        await settle();
        await click($("genre-anime"));
      } else await mount();
      expect(requests).toHaveLength(0);
      expect($("feed-checking")).not.toBeNull();
      act(() => {
        useStore.getState().accumulateDiscoverCandidates(fixtures, { genreId: "anime" });
        useStore.setState({ discoverLibraryStatus: "ready" });
      });
      await settle();
      expect(titles()).toHaveLength(2);
      expect(requests).toHaveLength(0);
    },
  );
  it.each(["search", "browse"] as const)(
    "shows platform failures and empty responses in %s without losing successful posts",
    async (workspace) => {
      platformStatuses = {
        yt: { ok: true },
        ig: { ok: false, error: "auth" },
        tt: { ok: true, partial: "upstream" },
      };
      if (workspace === "browse") {
        act(() => root.render(createElement(DiscoverScreen)));
        await settle();
        await click($("genre-anime"));
      } else await mount();
      expect(titles()).toHaveLength(2);
      expect($("feed-search-ig")?.dataset.error).toBe("auth");
      expect($("feed-search-tt")?.dataset.state).toBe("partial");
      expect($("feed-search-status")?.textContent).toContain("before feed filters");

      platformStatuses = { ig: { ok: false, error: "quota" } };
      await click($("feed-find-more"));
      expect($("feed-search-ig")?.textContent).toContain("Search allowance reached");
      expect($("feed-search-yt")?.dataset.state).toBe("unknown");
      expect(titles()).toHaveLength(2);
      expect(($("feed-find-more") as HTMLButtonElement).disabled).toBe(true);

      await click($(workspace === "browse" ? "browse-tab-ig" : "tab-ig"));
      expect(($("feed-refill") as HTMLButtonElement).disabled).toBe(false);
      fixtures = [];
      platformStatuses = { ig: { ok: true } };
      await click($("feed-refill"));
      expect($("feed-search-ig")?.dataset.state).toBe("empty");
      expect($("feed-search-ig")?.textContent).toContain("returned no posts");

      searchFailure = true;
      await click($("feed-refill"));
      expect($("feed-search-status")).toBeNull();
      await click($(workspace === "browse" ? "browse-tab-all" : "tab-all"));
      expect(titles()).toHaveLength(2);
      expect(requests).toHaveLength(4);
    },
  );
  it.each(["search", "browse"] as const)(
    "explicitly restores evergreen references from cache in %s without spending another search",
    async (workspace) => {
      if (workspace === "browse") {
        act(() => root.render(createElement(DiscoverScreen)));
        await settle();
        await click($("genre-anime"));
      } else await mount();
      expect(titles()).toHaveLength(2);
      expect($(workspace === "browse" ? "browse-usage" : "discover-usage")?.textContent).toContain(
        "Last reported usage",
      );
      const low = useStore
        .getState()
        .discoverCandidates.filter((entry) => entry.item.platform === "ig");
      act(() => useStore.setState({ discoverCandidates: low }));
      await settle();
      expect(titles()).toHaveLength(0);
      expect(requests).toHaveLength(1);
      expect($("feed-refill-options")?.hasAttribute("open")).toBe(false);
      await click($("feed-refill-options")!.querySelector("summary"));
      expect(requests).toHaveLength(1);
      expect($("feed-refill-options")?.textContent).toContain("6 web lookups + 2 YouTube searches");
      await click($("feed-refill"));
      expect(titles()).toHaveLength(2);
      expect(requests).toHaveLength(1);
      expect($("feed-search-status")?.textContent).toContain("Cached response");
    },
  );
  it("keeps a repeated source-caption excerpt behind More without losing the full caption", async () => {
    const caption = `${fixtures[0].title}. This finished sequence combines several moments from the film into one carefully timed showcase, with each visual aligned to the music.`;
    fixtures[0] = {
      ...fixtures[0],
      snippet: caption,
      evidence: { ...fixtures[0].evidence!, caption },
    };
    await mount();
    const card = all("feed-card").find((node) => node.textContent?.includes(fixtures[0].title))!;
    expect($("result-snippet", card)).toBeNull();
    await click($("result-more", card));
    expect($("result-snippet", card)?.textContent).toBe(caption);
  });
  it("keeps category browsing in Browse, preserves the Search draft and returns from Saved without another query", async () => {
    window.history.replaceState(null, "", "/discover/");
    act(() => root.render(createElement(DiscoverScreen)));
    await settle();
    await click($("inspiration-search"));
    const input = $("discover-topic") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "my unsubmitted search",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click($("inspiration-explore"));
    await click($("genre-anime"));
    expect($("browse-category-panel")).not.toBeNull();
    expect($("inspiration-explore")?.getAttribute("aria-pressed")).toBe("true");
    expect($("research-bar")?.closest("[hidden]")).not.toBeNull();
    expect(requests).toHaveLength(1);
    await click($("inspiration-library-open"));
    expect($("browse-category-panel")).toBeNull();
    await click($("inspiration-explore"));
    expect($("browse-category-panel")).not.toBeNull();
    expect(requests).toHaveLength(1);
    await click($("inspiration-search"));
    expect(input.value).toBe("my unsubmitted search");
    expect($("browse-category-panel")).toBeNull();
    await click($("inspiration-explore"));
    await click($("browse-back"));
    expect($("for-you-feed")).not.toBeNull();
    expect(requests).toHaveLength(1);
  });
  it.each(["search", "browse"] as const)(
    "recovers qualified posts from the original query cache in %s when only a small saved pool remains",
    async (workspace) => {
      await mount();
      expect(titles()).toHaveLength(2);
      act(() => root.unmount());
      root = createRoot(host);
      const low = useStore
        .getState()
        .discoverCandidates.filter((candidate) => candidate.item.platform === "ig");
      useStore.setState({ discoverCandidates: low });
      if (workspace === "browse") {
        act(() => root.render(createElement(DiscoverScreen)));
        await settle();
        await click($("genre-anime"));
      } else await mount();
      expect(titles()).toHaveLength(2);
      expect(requests).toHaveLength(1);
      // A later retention/source correction must not reimport the old indexed answer.
      act(() => useStore.setState({ discoverCandidates: low }));
      await settle();
      expect(titles()).toHaveLength(0);
      act(() => useStore.setState({ discoverCandidates: [...low] }));
      await settle();
      expect(titles()).toHaveLength(0);
      expect(requests).toHaveLength(1);
    },
  );
  it("keeps hidden Search idle when its last category is evicted and the query cache expires", async () => {
    await mount();
    expect(requests).toHaveLength(1);
    act(() => root.render(createElement(ResearchPanel, { openGenre: "anime", active: false })));
    await settle();
    clearDiscoverCache();
    act(() => {
      useStore.setState({ discoverCandidates: [] });
      useStore.getState().setSettings({ apiKeys: { scoutUrl: "https://changed.scout.test" } });
    });
    await settle();
    expect(requests).toHaveLength(1);
    expect(useStore.getState().discoverCandidates).toHaveLength(0);
  });
  it("shares expansion coverage between All and individual platforms and refreshes visible usage without searching", async () => {
    await mount();
    expect($("discover-usage")?.closest("[hidden]")).toBeNull();
    expect($("discover-usage")?.textContent).toContain("931");
    const beforeUsage = usageRequests;
    await click($("feed-find-more"));
    expect(requests).toHaveLength(2);
    const firstQuery = requests.at(-1)?.q;
    expect($("discover-usage")?.textContent).toContain("932");
    expect(usageRequests).toBeGreaterThan(beforeUsage);
    await click($("tab-ig"));
    expect(requests).toHaveLength(2);
    await click($("feed-find-more"));
    expect(requests).toHaveLength(3);
    expect(requests.at(-1)?.q).not.toBe(firstQuery);
    expect(requests.at(-1)?.platforms).toEqual(["ig"]);
    const secondQuery = requests.at(-1)?.q;
    await click($("tab-all"));
    await click($("feed-find-more"));
    expect(requests).toHaveLength(4);
    expect(requests.at(-1)?.q).not.toBe(firstQuery);
    expect(requests.at(-1)?.q).not.toBe(secondQuery);
    expect($("feed-find-more")?.hasAttribute("disabled")).toBe(true);
    await click($("tab-tt"));
    expect($("feed-find-more")?.hasAttribute("disabled")).toBe(true);
    expect(requests).toHaveLength(4);
  });
  it("accepts feedback after a long session without advancing the search or making a request", async () => {
    await mount();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 10 * 60_000);
    await click($("feed-not-useful", all("feed-card")[0]));
    expect(titles()).toEqual(["Anime split screen edit"]);
    expect(requests).toHaveLength(1);
  });
  it("keeps five-like examples out of the default/popular lanes, separates lessons, and makes mode/platform changes free", async () => {
    await mount();
    expect(titles()).toEqual(["Anime beat sync edit", "Anime split screen edit"]);
    expect($("tab-all")?.getAttribute("data-count")).toBe("2");
    expect($("tab-ig")?.getAttribute("data-count")).toBe("0");
    expect(requests).toHaveLength(1);
    await click($("feed-mode-popular"));
    expect(titles()).toHaveLength(2);
    await click($("tab-ig"));
    expect(titles()).toEqual([]);
    expect($("feed-shortage")?.textContent).toContain("No recent examples");
    await click($("tab-all"));
    await click($("feed-mode-learning"));
    expect(titles()).toEqual(["Anime masking tutorial step by step"]);
    await click($("feed-mode-explore"));
    expect(titles()).toContain("Anime beat sync edit with five likes");
    expect(requests).toHaveLength(1);
    expect($("discover-popular")).toBeNull();
    expect($("discover-section-example")).toBeNull();
  });

  it("persists local feedback, undoes removal and creator hiding, and reopens a cached category without another search", async () => {
    await mount();
    await click($("feed-more-like", all("feed-card")[0]));
    expect(useStore.getState().discoverFeedback[0].action).toBe("more");
    await click($("feed-not-useful", all("feed-card")[0]));
    expect(titles()).toEqual(["Anime split screen edit"]);
    await click($("feed-undo"));
    expect(titles()).toHaveLength(2);
    expect(useStore.getState().discoverFeedback[0].action).toBe("more");
    await click($("feed-hide-creator", all("feed-card")[0]));
    expect(titles()).toEqual(["Anime split screen edit"]);
    await click($("feed-undo"));
    expect(titles()).toHaveLength(2);
    act(() => root.unmount());
    root = createRoot(host);
    await mount();
    expect(requests).toHaveLength(1);
    expect(titles()).toHaveLength(2);
    expect($("feed-more-like")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("fetches another bounded batch only on Find more and reports source uncertainty in Arabic too", async () => {
    await mount();
    fixtures = [video("animeNewEdit", "Anime rotoscoping edit", 50_000, "@new")];
    await click($("feed-find-more"));
    expect(requests).toHaveLength(2);
    expect(titles()).toContain("Anime rotoscoping edit");
    expect(titles()).toContain("Anime beat sync edit");
    expect($("feed-source-note")?.textContent).toContain("footage has not been reviewed");
    act(() => useStore.getState().setSettings({ lang: "ar" }));
    await settle();
    expect($("feed-mode-inspiration")?.textContent).toBe("إلهام");
    expect($("feed-source-note")?.textContent).toContain("ما راجعنا الفيديو نفسه");
    expect(requests).toHaveLength(2);
  });
});
