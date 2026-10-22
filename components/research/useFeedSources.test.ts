// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverItem } from "@/lib/discover";
import { sourceKey } from "@/lib/formatSources";
import { canonicalRefUrl } from "@/lib/research";
import { resetYoutubeEvidenceCache } from "@/lib/youtubeEvidence";
import type { InstagramSource } from "@/workers/scout/src/instagramSource";
import type { TikTokSource } from "@/workers/scout/src/tiktokSource";
import { useFeedSources } from "./useFeedSources";

const bridges = vi.hoisted(() => ({ instagram: vi.fn(), tiktok: vi.fn() }));
vi.mock("@/lib/formatSources", async (original) => ({
  ...(await original<typeof import("@/lib/formatSources")>()),
  localInstagramSource: bridges.instagram,
}));
vi.mock("@/lib/discoverSources", async (original) => ({
  ...(await original<typeof import("@/lib/discoverSources")>()),
  localTikTokSource: bridges.tiktok,
}));

const CHECKED = "2026-10-09T15:00:00Z";
type Source = InstagramSource | TikTokSource | null;
interface Read {
  platform: "ig" | "tt";
  url: string;
  signal?: AbortSignal;
  settled: boolean;
  resolve: (source: Source) => void;
}
let reads: Read[];
let inFlight: number;
let maxInFlight: number;
let host: HTMLDivElement;
let root: Root;
let latest: ReturnType<typeof useFeedSources>;
let snapshots: number;

function card(platform: DiscoverItem["platform"], id: number): DiscoverItem {
  return {
    platform,
    url:
      platform === "ig"
        ? `https://www.instagram.com/reel/IG${String(id).padStart(4, "0")}/`
        : platform === "tt"
          ? `https://www.tiktok.com/@creator${id}/video/${BigInt("7600000000000000000") + BigInt(id)}`
          : `https://www.youtube.com/watch?v=YT${id}`,
    handle: `@creator${id}`,
    title: "Indexed anime beat sync",
    snippet: "Indexed search text",
    stats: { likes: 1000000 - id },
    published: "2026-10-07T00:00:00Z",
    section: "example",
    lang: "en",
  };
}
function source(read: Read): Source {
  if (read.platform === "ig")
    return {
      status: "available",
      url: read.url,
      title: "Actual anime beat sync",
      description: `Actual anime beat sync ${read.url}`,
      author: "actualcreator",
      thumbnailUrl: "",
      observedAt: CHECKED,
      provenance: "instagram-public-embed",
      likes: 5,
    };
  return {
    status: "available",
    url: canonicalRefUrl("tt", read.url),
    caption: `Actual anime beat sync ${read.url}`,
    author: "actualcreator",
    observedAt: CHECKED,
    provenance: "tiktok-public-page",
    likes: 10,
    views: 1000,
    published: "2026-10-07T00:00:00Z",
  };
}
function request(platform: "ig" | "tt", url: string, signal?: AbortSignal): Promise<Source> {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      inFlight--;
    }
  };
  signal?.addEventListener("abort", release, { once: true });
  return new Promise((resolve) => {
    const read: Read = {
      platform,
      url,
      signal,
      settled: false,
      resolve(value) {
        if (read.settled) return;
        read.settled = true;
        release();
        resolve(value);
      },
    };
    reads.push(read);
  });
}
function Harness({
  items,
  active,
  youtubeKey,
}: {
  items: DiscoverItem[];
  active: boolean;
  youtubeKey?: string;
}) {
  const result = useFeedSources(items, active, youtubeKey);
  useEffect(() => {
    latest = result;
    snapshots++;
  }, [result]);
  return createElement(
    "output",
    { "data-checking": String(result.checking) },
    String(result.items.length),
  );
}
async function render(items: DiscoverItem[], active = true, youtubeKey = "") {
  await act(async () => {
    root.render(createElement(Harness, { items, active, youtubeKey }));
  });
}
async function resolveBatch(batch: Read[], values = batch.map(source)) {
  await act(async () => {
    batch.forEach((read, index) => read.resolve(values[index]));
  });
}
async function drain(persist = false, empty = false) {
  for (let step = 0; step < 100; step++) {
    const pending = reads.filter((read) => !read.settled && !read.signal?.aborted);
    if (!pending.length) return;
    await resolveBatch(pending, empty ? pending.map(() => null) : pending.map(source));
    if (persist) await render(latest.items.map((item) => ({ ...item })));
  }
  throw new Error("Source queue did not settle within its bounded budget");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reads = [];
  inFlight = 0;
  maxInFlight = 0;
  snapshots = 0;
  resetYoutubeEvidenceCache();
  bridges.instagram.mockReset().mockImplementation((url, signal) => request("ig", url, signal));
  bridges.tiktok.mockReset().mockImplementation((url, signal) => request("tt", url, signal));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    for (const read of reads) if (!read.settled) read.resolve(null);
  });
  host.remove();
  vi.unstubAllGlobals();
});

describe("optional official YouTube evidence batch", () => {
  const id = "NgFiMUG2fkQ";
  const yt = (): DiscoverItem => ({
    ...card("yt", 1),
    url: `https://www.youtube.com/watch?v=${id}`,
  });
  const apiVideo = (videoId = id) => ({
    id: videoId,
    snippet: {
      title: "How I Film Cinematic Car Videos (Rollers + B-Roll)",
      description: "Actual video description",
      channelTitle: "TheCarVideoGuy",
      channelId: `UC${"a".repeat(22)}`,
      publishedAt: "2025-01-01T00:00:00Z",
    },
    statistics: { viewCount: "17300", likeCount: "420" },
    status: { privacyStatus: "public", uploadStatus: "processed" },
  });
  it("makes no YouTube request without a configured key or while inactive", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render([yt()]);
    await render([yt()], true, "");
    await render([yt()], false, "configured-key");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(latest.checking).toBe(false);
    expect(latest.items[0].evidence).toBeUndefined();
  });
  it("applies exact-ID API statistics once across view rerenders and persisted count corrections", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const original = yt();
    await render(
      [original, { ...original, url: `https://youtu.be/${id}?t=10` }],
      true,
      "configured-key",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, init] = fetchMock.mock.calls[0];
    const request = new URL(requestUrl);
    expect(request.origin).toBe("https://www.googleapis.com");
    expect(request.pathname).toBe("/youtube/v3/videos");
    expect(request.searchParams.get("id")).toBe(id);
    expect(request.searchParams.get("part")).toBe("snippet,statistics,status");
    expect(latest.checking).toBe(true);
    await render([original], true, "configured-key");
    expect(init?.signal?.aborted).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () =>
      finish(new Response(JSON.stringify({ items: [apiVideo(), apiVideo("dQw4w9WgXcQ")] }))),
    );
    expect(latest.items[0]).toMatchObject({
      title: "How I Film Cinematic Car Videos (Rollers + B-Roll)",
      handle: "TheCarVideoGuy",
      stats: { views: 17300, likes: 420 },
      evidence: {
        source: "youtube-api",
        views: 17300,
        likes: 420,
        published: "2025-01-01T00:00:00.000Z",
      },
    });
    expect(latest.checking).toBe(false);
    const persisted = latest.items;
    for (let i = 0; i < 8; i++)
      await render(
        persisted.map((item) => ({ ...item, stats: { views: 1 }, url: `${original.url}&t=${i}` })),
        true,
        "configured-key",
      );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bridges.instagram).not.toHaveBeenCalled();
    expect(bridges.tiktok).not.toHaveBeenCalled();
  });
  it("keeps same-key YouTube evidence for overlapping URLs while a grown batch is in flight and drops it on a key change", async () => {
    const finishers: ((response: Response) => void)[] = [];
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      () =>
        new Promise<Response>((resolve) => {
          finishers.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const first = yt();
    const added: DiscoverItem = {
      ...card("yt", 2),
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    };
    await render([first], true, "configured-key");
    await act(async () => finishers[0](new Response(JSON.stringify({ items: [apiVideo()] }))));
    const enriched = latest.items[0];
    expect(enriched.evidence?.source).toBe("youtube-api");
    await render([first, added], true, "configured-key");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get("id")).toBe("dQw4w9WgXcQ");
    expect(latest.checking).toBe(true);
    expect(latest.items[0]).toEqual(enriched);
    expect(latest.items[1]).toEqual(added);
    await act(async () =>
      finishers[1](new Response(JSON.stringify({ items: [apiVideo("dQw4w9WgXcQ")] }))),
    );
    expect(latest.items[0]).toEqual(enriched);
    expect(latest.items[1].evidence?.source).toBe("youtube-api");
    expect(latest.checking).toBe(false);
    await render([first, added], true, "other-key");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(latest.items).toEqual([first, added]);
    await render([first, added], false, "configured-key");
    expect(latest.items).toEqual([first, added]);
    await act(async () => finishers[2](new Response(JSON.stringify({ items: [] }))));
    expect(latest.items).toEqual([first, added]);
  });
  it("aborts a disabled batch and ignores its late result without hidden requests", async () => {
    let finish!: (response: Response) => void;
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const original = yt();
    await render([original], true, "configured-key");
    const signal = fetchMock.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    await render([original], false, "configured-key");
    expect(signal?.aborted).toBe(true);
    expect(latest.checking).toBe(false);
    await act(async () => finish(new Response(JSON.stringify({ items: [apiVideo()] }))));
    expect(latest.items).toEqual([original]);
    for (let i = 0; i < 3; i++) await render([original], false, "configured-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await render([original], true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("bounded public category-source queue", () => {
  it("checks eighteen of twenty-four imports, then the remaining six only on an explicit action", async () => {
    const items = Array.from({ length: 24 }, (_, i) => card("ig", i));
    await render(items);
    await act(async () => latest.checkRemaining());
    expect(reads).toHaveLength(2);
    await drain();
    expect(reads).toHaveLength(18);
    expect(latest.remaining).toBe(6);
    expect(latest.checking).toBe(false);
    const firstBatch = latest.items.filter((item) => item.evidence);
    const continueFirstBatch = latest.checkRemaining;
    await render([...items].reverse());
    expect(reads).toHaveLength(18);
    await act(async () => {
      latest.checkRemaining();
      latest.checkRemaining();
    });
    expect(reads).toHaveLength(20);
    expect(latest.checking).toBe(true);
    await act(async () => latest.checkRemaining());
    expect(reads).toHaveLength(20);
    await drain();
    expect(reads).toHaveLength(24);
    expect(new Set(reads.map((read) => read.url)).size).toBe(24);
    expect(maxInFlight).toBe(2);
    expect(latest.remaining).toBe(0);
    expect(latest.checking).toBe(false);
    expect(latest.items.every((item) => item.evidence?.likes === 5)).toBe(true);
    for (const prior of firstBatch)
      expect(latest.items.find((item) => item.url === prior.url)).toEqual(prior);
    await act(async () => {
      latest.checkRemaining();
      continueFirstBatch();
    });
    expect(reads).toHaveLength(24);
    expect(latest.checking).toBe(false);
  });
  it("bounds every continuation per platform and counts canonical aliases only once", async () => {
    const instagram = Array.from({ length: 40 }, (_, i) => card("ig", i));
    const tiktok = Array.from({ length: 21 }, (_, i) => card("tt", i));
    const youtube = [card("yt", 1)];
    await render([
      ...instagram,
      ...instagram.map((item) => ({ ...item, url: sourceKey(item.url) })),
      ...tiktok,
      ...tiktok.map((item) => ({ ...item, url: `${item.url}?lang=en` })),
      ...youtube,
    ]);
    await drain();
    expect(latest.remaining).toBe(25);
    await act(async () => latest.checkRemaining());
    expect(reads.slice(36).map((read) => read.platform)).toEqual(["ig", "tt"]);
    await drain();
    expect(bridges.instagram).toHaveBeenCalledTimes(36);
    expect(bridges.tiktok).toHaveBeenCalledTimes(21);
    expect(latest.remaining).toBe(4);
    expect(latest.checking).toBe(false);
    await act(async () => latest.checkRemaining());
    await drain();
    expect(bridges.instagram).toHaveBeenCalledTimes(40);
    expect(bridges.tiktok).toHaveBeenCalledTimes(21);
    expect(new Set(reads.map((read) => read.url)).size).toBe(61);
    expect(latest.remaining).toBe(0);
    expect(maxInFlight).toBe(2);
    expect(latest.items.filter((item) => item.platform === "yt")).toEqual(youtube);
  });
  it("does not include failed attempts in remaining or silently retry them on continuation", async () => {
    await render(Array.from({ length: 24 }, (_, i) => card("ig", i)));
    await drain(false, true);
    expect(latest.remaining).toBe(6);
    expect(latest.items.every((item) => !item.evidence)).toBe(true);
    await act(async () => latest.checkRemaining());
    await drain();
    expect(reads).toHaveLength(24);
    expect(new Set(reads.map((read) => read.url)).size).toBe(24);
    expect(latest.items.filter((item) => item.evidence)).toHaveLength(6);
    expect(latest.remaining).toBe(0);
  });
  it("cancels a continuation and rejects late results and stale actions after a membership change", async () => {
    await render(Array.from({ length: 24 }, (_, i) => card("ig", i)));
    await drain();
    const oldAction = latest.checkRemaining;
    await act(async () => oldAction());
    const abandoned = reads.slice(18);
    expect(abandoned).toHaveLength(2);
    await render([card("tt", 80), card("tt", 81)]);
    expect(abandoned.every((read) => read.signal?.aborted)).toBe(true);
    await resolveBatch(abandoned);
    await act(async () => oldAction());
    expect(reads).toHaveLength(22);
    expect(latest.items.every((item) => item.platform === "tt" && !item.evidence)).toBe(true);
    await drain();
    expect(latest.items.every((item) => item.evidence?.source === "tiktok-public-page")).toBe(true);
    expect(latest.remaining).toBe(0);
    expect(latest.checking).toBe(false);
    expect(maxInFlight).toBe(2);
  });
  it("does not continue an inactive membership or restart a cancelled continuation from a stale action", async () => {
    const items = Array.from({ length: 24 }, (_, i) => card("ig", i));
    await render(items);
    await drain();
    const oldAction = latest.checkRemaining;
    await act(async () => oldAction());
    const abandoned = reads.slice(18);
    await render(items, false);
    expect(abandoned.every((read) => read.signal?.aborted)).toBe(true);
    const inactiveSnapshots = snapshots;
    await act(async () => {
      latest.checkRemaining();
      oldAction();
    });
    expect(snapshots).toBe(inactiveSnapshots);
    await resolveBatch(abandoned);
    expect(reads).toHaveLength(20);
    expect(latest.remaining).toBe(0);
    expect(latest.checking).toBe(false);
  });
  it("reads at most eighteen per platform with only two concurrent requests, without touching YouTube", async () => {
    const items = ["ig", "tt", "yt"].flatMap((p) =>
      Array.from({ length: 30 }, (_, i) => card(p as DiscoverItem["platform"], i)),
    );
    await render(items);
    expect(reads).toHaveLength(2);
    expect(latest.checking).toBe(true);
    await drain();
    expect(bridges.instagram).toHaveBeenCalledTimes(18);
    expect(bridges.tiktok).toHaveBeenCalledTimes(18);
    expect(maxInFlight).toBe(2);
    expect(inFlight).toBe(0);
    expect(latest.checking).toBe(false);
    expect(latest.items).toHaveLength(90);
    expect(latest.items.filter((item) => item.evidence)).toHaveLength(36);
    expect(latest.items.find((item) => item.platform === "ig")?.stats).toEqual({ likes: 5 });
    expect(latest.items.filter((item) => item.platform === "yt")).toEqual(
      items.filter((item) => item.platform === "yt"),
    );
  });
  it("does not restart or abort the queue when corrected counts and persisted evidence rerender the same canonical posts", async () => {
    const items = Array.from({ length: 22 }, (_, i) => card("ig", i));
    await render(items);
    const initial = [...reads];
    await resolveBatch([initial[0]]);
    const persisted = latest.items.map((item) => ({ ...item, url: sourceKey(item.url) }));
    await render(persisted.reverse());
    expect(initial[1].signal?.aborted).toBe(false);
    expect(reads).toHaveLength(3);
    await drain(true);
    expect(bridges.instagram).toHaveBeenCalledTimes(18);
    expect(new Set(reads.map((read) => read.url)).size).toBe(18);
    const settled = latest.items;
    for (let i = 0; i < 6; i++)
      await render(
        settled
          .map((item) => ({ ...item, stats: item.evidence ? { likes: 1 } : item.stats }))
          .reverse(),
      );
    expect(bridges.instagram).toHaveBeenCalledTimes(18);
    expect(latest.checking).toBe(false);
  });
  it("prioritizes new unread candidates when the URL membership expands", async () => {
    await render(Array.from({ length: 18 }, (_, i) => card("ig", i)));
    await drain();
    const persisted = latest.items;
    const added = [card("ig", 900), card("ig", 901)];
    await render([...persisted, ...added]);
    expect(reads.slice(18, 20).map((read) => read.url)).toEqual(
      added.map((item) => sourceKey(item.url)),
    );
    await drain(true);
    expect(bridges.instagram).toHaveBeenCalledTimes(20);
    expect(
      latest.items
        .filter((item) => added.some((add) => add.url === item.url))
        .every((item) => item.evidence?.likes === 5),
    ).toBe(true);
    expect(maxInFlight).toBe(2);
  });
  it("gives newly discovered posts a turn even when earlier source checks returned unknown", async () => {
    const original = Array.from({ length: 18 }, (_, i) => card("ig", i));
    await render(original);
    await drain(false, true);
    const added = [card("ig", 900), card("ig", 901)];
    await render([...original, ...added]);
    expect(reads.slice(18, 20).map((read) => read.url)).toEqual(
      added.map((item) => sourceKey(item.url)),
    );
    await drain();
    expect(bridges.instagram).toHaveBeenCalledTimes(20);
  });
  it("reads each canonical post once despite duplicate reel/p aliases", async () => {
    const original = card("ig", 1);
    await render([original, { ...original, url: sourceKey(original.url) }, card("ig", 2)]);
    await drain();
    expect(reads).toHaveLength(2);
    expect(new Set(reads.map((read) => read.url)).size).toBe(2);
    expect(latest.items).toHaveLength(3);
    expect(latest.items.every((item) => item.evidence?.likes === 5)).toBe(true);
  });
  it("keeps TikTok tracking URL changes in the same canonical membership without restarting", async () => {
    const items = [card("tt", 1), card("tt", 2)];
    await render(items);
    const initial = [...reads];
    await render(items.map((item) => ({ ...item, url: `${item.url}?lang=en&share_app_id=1233` })));
    expect(initial.every((read) => !read.signal?.aborted)).toBe(true);
    expect(reads).toHaveLength(2);
    await drain();
    expect(latest.items.every((item) => item.evidence?.source === "tiktok-public-page")).toBe(true);
    expect(latest.checking).toBe(false);
  });
  it("aborts the previous category and ignores late results from it", async () => {
    await render([card("ig", 1), card("ig", 2), card("ig", 3)]);
    const old = [...reads];
    await render([card("tt", 80), card("tt", 81)]);
    expect(old.every((read) => read.signal?.aborted)).toBe(true);
    await resolveBatch(old);
    expect(latest.items.every((item) => item.platform === "tt" && !item.evidence)).toBe(true);
    expect(reads).toHaveLength(4);
    await drain();
    expect(latest.items.every((item) => item.evidence?.source === "tiktok-public-page")).toBe(true);
    expect(latest.checking).toBe(false);
    expect(maxInFlight).toBe(2);
  });
  it("keeps completed Instagram and TikTok evidence for unchanged canonical URLs when the membership grows", async () => {
    const first = (["ig", "tt"] as const).flatMap((p) =>
      Array.from({ length: 4 }, (_, i) => card(p, i)),
    );
    await render(first);
    await drain();
    expect(reads).toHaveLength(8);
    const enriched = latest.items;
    for (const item of enriched) {
      expect(item.evidence?.observedAt).toBe(CHECKED);
      expect(item.evidence?.caption).toBe(
        `Actual anime beat sync ${canonicalRefUrl(item.platform, item.url)}`,
      );
      expect(item.handle).toBe("actualcreator");
      expect(item.evidence?.likes).toBe(item.platform === "ig" ? 5 : 10);
    }
    const added = (["ig", "tt"] as const).flatMap((p) =>
      Array.from({ length: 40 }, (_, i) => card(p, 100 + i)),
    );
    await render([...first, ...added]);
    expect(latest.checking).toBe(true);
    expect(reads).toHaveLength(10);
    for (const prior of enriched)
      expect(latest.items.find((item) => item.url === prior.url)).toEqual(prior);
    await drain();
    const later = reads.slice(8);
    expect(later.filter((read) => read.platform === "ig")).toHaveLength(18);
    expect(later.filter((read) => read.platform === "tt")).toHaveLength(18);
    const firstUrls = first.map((item) => canonicalRefUrl(item.platform, item.url));
    expect(later.some((read) => firstUrls.includes(read.url))).toBe(false);
    for (const url of firstUrls) expect(reads.filter((read) => read.url === url)).toHaveLength(1);
    for (const prior of enriched)
      expect(latest.items.find((item) => item.url === prior.url)).toEqual(prior);
    expect(latest.items.filter((item) => item.evidence)).toHaveLength(8 + 36);
    expect(latest.remaining).toBe(80 - 36);
    expect(latest.checking).toBe(false);
    expect(maxInFlight).toBe(2);
  });
  it("retains nothing from a previous run when the membership is unrelated", async () => {
    const first = [card("ig", 1), card("ig", 2), card("tt", 3), card("tt", 4)];
    await render(first);
    await drain();
    expect(latest.items.every((item) => item.evidence)).toBe(true);
    const other = [card("ig", 501), card("ig", 502), card("tt", 503), card("tt", 504)];
    await render(other);
    expect(latest.items).toEqual(other);
    expect(latest.checking).toBe(true);
    await drain();
    expect(latest.items.every((item) => item.evidence)).toBe(true);
    await render(first);
    expect(latest.items).toEqual(first);
    await drain();
    for (const item of first)
      expect(
        reads.filter((read) => read.url === canonicalRefUrl(item.platform, item.url)),
      ).toHaveLength(2);
    expect(reads).toHaveLength(12);
  });
  it("never lands a late response from a cancelled run in the grown membership or counts it as read", async () => {
    const first = Array.from({ length: 4 }, (_, i) => card("ig", i));
    await render(first);
    const [done, late] = reads;
    await resolveBatch([done]);
    const third = reads[2];
    const kept = latest.items.find((item) => sourceKey(item.url) === done.url)!;
    expect(kept.evidence?.observedAt).toBe(CHECKED);
    await render([...first, card("ig", 900)]);
    expect(late.signal?.aborted).toBe(true);
    expect(third.signal?.aborted).toBe(true);
    expect(latest.items.find((item) => sourceKey(item.url) === done.url)).toEqual(kept);
    await resolveBatch(
      [late],
      [{ ...(source(late) as InstagramSource), description: "Late cancelled read", likes: 999 }],
    );
    expect(latest.items.find((item) => sourceKey(item.url) === late.url)?.evidence).toBeUndefined();
    expect(latest.remaining).toBe(4);
    await drain();
    expect(reads.filter((read) => read.url === done.url)).toHaveLength(1);
    expect(latest.items.every((item) => item.evidence?.likes === 5)).toBe(true);
    expect(
      latest.items.find((item) => sourceKey(item.url) === late.url)?.evidence?.caption,
    ).not.toBe("Late cancelled read");
    expect(latest.remaining).toBe(0);
    expect(maxInFlight).toBe(2);
  });
  it("retains and fetches nothing while inactive, then reads normally when active again", async () => {
    const items = [card("ig", 1), card("ig", 2), card("tt", 3), card("tt", 4)];
    await render(items);
    await drain();
    expect(latest.items.every((item) => item.evidence)).toBe(true);
    await render(items, false);
    expect(latest.items).toEqual(items);
    expect(latest.checking).toBe(false);
    expect(latest.remaining).toBe(0);
    expect(reads).toHaveLength(4);
    await render(items);
    expect(latest.items).toEqual(items);
    expect(reads).toHaveLength(6);
    await drain();
    expect(reads).toHaveLength(8);
    expect(latest.items.every((item) => item.evidence)).toBe(true);
    expect(latest.checking).toBe(false);
  });
  it("settles a 500-candidate pool while persisted corrections do not loop or saturate reads", async () => {
    const items = Array.from({ length: 500 }, (_, i) => card(i % 2 ? "ig" : "tt", i));
    await render(items);
    await drain(true);
    expect(reads).toHaveLength(36);
    expect(maxInFlight).toBe(2);
    expect(latest.items).toHaveLength(500);
    expect(latest.checking).toBe(false);
    expect(snapshots).toBeLessThan(100);
    for (let i = 0; i < 10; i++) await render([...latest.items].reverse());
    expect(reads).toHaveLength(36);
  });
  it("does not query while inactive, clears checking on cancellation, and settles unavailable bridge responses", async () => {
    const items = [card("ig", 1), card("tt", 2)];
    await render(items, false);
    expect(reads).toHaveLength(0);
    expect(latest.checking).toBe(false);
    await render(items);
    const abandoned = [...reads];
    await render(items, false);
    expect(abandoned.every((read) => read.signal?.aborted)).toBe(true);
    expect(latest.checking).toBe(false);
    await resolveBatch(abandoned);
    expect(latest.items.every((item) => !item.evidence)).toBe(true);
    await render(items);
    await drain(false, true);
    expect(latest.checking).toBe(false);
    expect(latest.items).toEqual(items);
  });
});

describe("display-order source scheduling", () => {
  const ttUrl = (item: DiscoverItem) => canonicalRefUrl("tt", item.url);
  /** An Anime-like native feed: IG/TT interleaved, 44 TikTok cards, the first one sorting last lexically. */
  function nativeFeed(stats: (index: number) => DiscoverItem["stats"] = () => ({ likes: 1000 })) {
    const tiktok = Array.from({ length: 44 }, (_, i) => ({
      ...card("tt", i + 1),
      stats: stats(i),
    }));
    tiktok[0] = {
      ...tiktok[0],
      handle: "@zzzfirst",
      url: "https://www.tiktok.com/@zzzfirst/video/7699999999999999999",
    };
    const instagram = Array.from({ length: 4 }, (_, i) => ({ ...card("ig", i), stats: stats(0) }));
    const items = tiktok.flatMap((tt, i) => (instagram[i] ? [instagram[i], tt] : [tt]));
    return { tiktok, items };
  }
  it("checks the first displayed TikTok card in the first batch even when its URL sorts last", async () => {
    const { tiktok, items } = nativeFeed();
    expect(tiktok.map(ttUrl).sort().at(-1)).toBe(ttUrl(tiktok[0]));
    await render(items);
    expect(reads).toHaveLength(2);
    await drain();
    expect(reads.filter((read) => read.platform === "tt").map((read) => read.url)).toEqual(
      tiktok.slice(0, 18).map(ttUrl),
    );
    expect(reads).toHaveLength(4 + 18);
    expect(maxInFlight).toBe(2);
    expect(latest.items).toHaveLength(items.length);
    expect(latest.items.map((item) => item.platform)).toEqual(items.map((item) => item.platform));
    expect(latest.items[1].evidence?.source).toBe("tiktok-public-page");
    expect(latest.items[1].evidence?.caption).toBe(`Actual anime beat sync ${ttUrl(tiktok[0])}`);
    expect(latest.remaining).toBe(26);
    expect(latest.checking).toBe(false);
  });
  it("orders unread cards by display position, not by indexed engagement score", async () => {
    // The first displayed card has no indexed count; every later card shows a large one.
    const { tiktok, items } = nativeFeed((index) => (index === 0 ? undefined : { likes: 900000 }));
    await render(items);
    await drain();
    expect(reads.filter((read) => read.platform === "tt").map((read) => read.url)).toEqual(
      tiktok.slice(0, 18).map(ttUrl),
    );
    expect(latest.items[1].evidence?.source).toBe("tiktok-public-page");
  });
  it("continues with the next eighteen TikTok cards in display order on an explicit action", async () => {
    const { tiktok, items } = nativeFeed();
    await render(items);
    await drain();
    const firstBatch = reads.length;
    expect(latest.remaining).toBe(26);
    await act(async () => {
      latest.checkRemaining();
      latest.checkRemaining();
    });
    await drain();
    expect(reads.slice(firstBatch).map((read) => read.url)).toEqual(
      tiktok.slice(18, 36).map(ttUrl),
    );
    expect(latest.items[2 * 4 + (36 - 4) - 1].evidence?.source).toBe("tiktok-public-page");
    expect(latest.remaining).toBe(8);
    expect(maxInFlight).toBe(2);
    expect(latest.checking).toBe(false);
  });
  it("keeps unread-first, then oldest-observation-first ordering ahead of display position", async () => {
    const observed = (item: DiscoverItem, observedAt: string): DiscoverItem => ({
      ...item,
      evidence: { source: "indexed-excerpt", observedAt },
    });
    const items = Array.from({ length: 20 }, (_, i) =>
      i < 16
        ? observed(card("tt", i), CHECKED)
        : i < 18
          ? observed(card("tt", i), "2026-09-01T00:00:00Z")
          : card("tt", i),
    );
    await render(items);
    await drain();
    expect(reads.map((read) => read.url)).toEqual(
      [18, 19, 16, 17, ...Array.from({ length: 14 }, (_, i) => i)].map((i) => ttUrl(items[i])),
    );
    expect(maxInFlight).toBe(2);
    expect(latest.remaining).toBe(2);
    await act(async () => latest.checkRemaining());
    await drain();
    expect(reads.slice(18).map((read) => read.url)).toEqual([14, 15].map((i) => ttUrl(items[i])));
  });
});
