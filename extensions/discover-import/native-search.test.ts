import { beforeEach, expect, it, vi } from "vitest";
import { createNativeSearchService } from "./native-search.js";
import { NATIVE_ORIGINS } from "./native-protocol.js";

const sender = {
  url: "http://localhost:3000/discover/",
  origin: "http://localhost:3000",
  tab: { id: 7 },
  frameId: 0,
  documentId: "document-1",
};
const request = { version: 1, type: "search", requestId: "test-1", queries: { ig: "anime edit" } };
/** The explicit Deep search button: guarded activation, scrolling, 60 cards, 40 s. */
const deepRequest = { ...request, deep: true };
const cards = (count = 30, start = 0) =>
  Array.from({ length: count }, (_, i) => ({
    platform: "ig",
    url: `https://www.instagram.com/reel/Post${start + i}/`,
    title: `Post ${start + i}`,
  }));
let timestamp: number;
let counter: number;
let tabCounter: number;
let stored: Record<string, unknown>;
let tabs: Map<number, { id: number; url: string; status: string; windowId?: number }>;
let api: ReturnType<typeof mockApi>;
let service: ReturnType<typeof createNativeSearchService>;
function mockApi() {
  return {
    permissions: { contains: vi.fn(async () => true) },
    storage: {
      session: {
        get: vi.fn(async () => structuredClone(stored)),
        set: vi.fn(async (value) => {
          stored = structuredClone(value);
        }),
      },
    },
    alarms: { create: vi.fn(async () => {}), clear: vi.fn(async () => true) },
    tabs: {
      create: vi.fn(async ({ url }: { url: string; active?: boolean }) => {
        const tab = { id: ++tabCounter, url, status: "complete" };
        tabs.set(tab.id, tab);
        return tab;
      }),
      get: vi.fn(async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("Closed");
        return tab;
      }),
      remove: vi.fn(async (id: number) => {
        tabs.delete(id);
      }),
      reload: vi.fn(async (id: number) => {
        if (!tabs.has(id)) throw new Error("Closed");
      }),
    },
    scripting: {
      executeScript: vi.fn(
        async (): Promise<
          {
            result?: {
              status: string;
              results: ReturnType<typeof cards>;
              error?: string;
              order?: string[];
              lastUrl?: string | null;
              noResults?: boolean;
            };
            error?: { message: string };
          }[]
        > => [{ result: { status: "done", results: cards() } }],
      ),
    },
  };
}
async function poll(jobId = "job-1", owner = sender) {
  return service.handle({ version: 1, type: "poll", jobId }, owner);
}
async function complete(jobId = "job-1") {
  await vi.waitFor(async () =>
    expect(await poll(jobId)).toMatchObject({ ok: true, status: "complete" }),
  );
  return poll(jobId);
}
beforeEach(async () => {
  timestamp = Date.parse("2026-10-11T00:00:00.000Z");
  counter = 0;
  tabCounter = 100;
  stored = {};
  tabs = new Map();
  // The originating Discover tab: every owned tab opens in its window (packet 24).
  tabs.set(7, { id: 7, url: sender.url, status: "complete", windowId: 1 });
  api = mockApi();
  service = createNativeSearchService(api, {
    now: () => timestamp,
    sleep: async (ms: number) => {
      timestamp += ms;
    },
    id: () => `job-${++counter}`,
  });
  await service.ready;
});

it("status never opens or injects a tab; permission is optional and not requested by the background", async () => {
  expect(await service.handle({ version: 1, type: "status" }, sender)).toEqual({
    ok: true,
    version: 1,
    connected: true,
  });
  expect(api.permissions.contains).toHaveBeenCalledWith({ origins: NATIVE_ORIGINS });
  expect(api.tabs.create).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  api.permissions.contains.mockResolvedValue(false);
  expect(await service.handle(request, sender)).toEqual({ ok: false, error: "not-connected" });
  expect(api.tabs.create).not.toHaveBeenCalled();
});

it("rejects invalid senders and messages before querying permissions or opening tabs", async () => {
  expect(await service.handle(request, { ...sender, frameId: 3 })).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(await service.handle({ ...request, queries: { ig: "x".repeat(121) } }, sender)).toEqual({
    ok: false,
    error: "invalid-request",
  });
  expect(api.permissions.contains).not.toHaveBeenCalled();
  expect(api.tabs.create).not.toHaveBeenCalled();
});

it("deep search: opens only owned inactive tabs, returns actual cards and keeps completed source tabs for review", async () => {
  focusControls();
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(60) } },
  ]);
  expect(await service.handle(deepRequest, sender)).toEqual({ ok: true, jobId: "job-1" });
  const result = await complete();
  expect(result).toMatchObject({
    platforms: {
      ig: {
        status: "done",
        results: cards(60).map((card, position) => ({
          ...card,
          position: position + 1,
          observedAt: "2026-10-11T00:00:00.000Z",
        })),
      },
    },
  });
  expect(api.tabs.create).toHaveBeenCalledExactlyOnceWith({
    url: "https://www.instagram.com/explore/search/keyword/?q=anime%20edit",
    active: false,
    windowId: 1,
  });
  expect(api.scripting.executeScript).toHaveBeenCalledWith({
    target: { tabId: 101 },
    func: expect.any(Function),
    args: ["ig", "https://www.instagram.com/explore/search/keyword/?q=anime%20edit", 60, false],
  });
  expect(api.tabs.remove).not.toHaveBeenCalled();
  expect(await service.handle(deepRequest, sender)).toEqual({ ok: true, jobId: "job-1" });
  expect(api.tabs.create).toHaveBeenCalledTimes(1);
});

it("authorizes poll, cancel and more to the originating tab and document only", async () => {
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(60) } },
  ]);
  await service.handle(request, sender);
  await complete();
  for (const owner of [
    { ...sender, tab: { id: 8 } },
    { ...sender, documentId: "other-document" },
  ]) {
    for (const type of ["poll", "cancel", "more"])
      expect(await service.handle({ version: 1, type, jobId: "job-1" }, owner)).toEqual({
        ok: false,
        error: "job-not-found",
      });
  }
  expect(api.tabs.remove).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
});

/** Records when each read asked the collector to scroll the owned search tab. */
function scrollTimes() {
  const at: number[] = [];
  const read = api.scripting.executeScript.getMockImplementation()!;
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
    if ((args[0] as { args: unknown[] }).args[3]) at.push(timestamp);
    return (read as (...input: unknown[]) => ReturnType<typeof read>)(...args);
  });
  return at;
}

it("deep search: scrolls a quiet initial grid only after the settle window, at most four times within forty seconds", async () => {
  focusControls();
  const started = timestamp;
  api.scripting.executeScript.mockImplementation(async () => [
    { result: { status: "done", results: cards(6) } },
  ]);
  const scrolledAt = scrollTimes();
  await service.handle(deepRequest, sender);
  expect(await complete()).toMatchObject({
    platforms: {
      ig: {
        status: "done",
        results: expect.any(Array),
        diagnostics: { added: 6, stopReason: "scroll-cap" },
      },
    },
  });
  // A quiet Instagram first row gets the full 18 s hydration window before the first scroll,
  // then each scroll/read cycle waits four quiet seconds; four cycles end the read.
  expect(scrolledAt.map((at) => at - started)).toEqual([19000, 24000, 29000, 34000]);
  expect(timestamp - started).toBe(38000);
});

it("deep search: retains delayed Instagram rows and waits four seconds after the latest new cards before scrolling", async () => {
  focusControls();
  const started = timestamp;
  api.scripting.executeScript.mockImplementation(async () => [
    {
      result: { status: "done", results: cards(timestamp - started < 5000 ? 6 : 26) },
    },
  ]);
  const scrolledAt = scrollTimes();
  await service.handle(deepRequest, sender);
  const result = await complete();
  expect(result).toMatchObject({
    platforms: {
      ig: {
        status: "done",
        results: expect.arrayContaining([
          expect.objectContaining({ url: "https://www.instagram.com/reel/Post25/" }),
        ]),
        diagnostics: { returned: 26, added: 26, stopReason: "scroll-cap" },
      },
    },
  });
  // Settled at 9 s (eight seconds since the first read, four since the last new cards).
  expect(scrolledAt[0] - started).toBe(10000);
  expect(scrolledAt).toHaveLength(4);
  expect(timestamp - started).toBe(29000);
});

it("deep search without focus falls back to the quiet budget (no scrolling, thirty cards, 25 s) and says why", async () => {
  const focus = focusControls();
  (api as unknown as { windows: { getLastFocused: () => unknown } }).windows.getLastFocused =
    async () => ({ id: 1, focused: false });
  const started = timestamp;
  const shown: number[] = [];
  let scrolled = 0;
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
    const [, , limit, scroll] = (args[0] as { args: [string, string, number, boolean] }).args;
    const snapshot = stored.discoverNativeJobsV1 as { platforms: { ig: { results: [] } } }[];
    shown.push(snapshot[0].platforms.ig.results.length);
    const count = [6, 24, 48, 66][Math.min(scrolled, 3)];
    if (scroll) scrolled++;
    return [{ result: { status: "done", results: cards(Math.min(count, limit)) } }];
  });
  await service.handle(deepRequest, sender);
  const result = (await complete()) as {
    diagnostics: { focus: { eligible: boolean; skipReason: string }; deepSkipped: string };
    platforms: { ig: { status: string; results: unknown[]; diagnostics: unknown } };
  };
  expect(result.platforms.ig.status).toBe("done");
  expect(result.platforms.ig.results).toHaveLength(6);
  expect(result.platforms.ig.diagnostics).toMatchObject({ added: 6, stopReason: "quiet" });
  expect(scrolled).toBe(0);
  expect(timestamp - started).toBeLessThanOrEqual(25000);
  const limits = api.scripting.executeScript.mock.calls.map(
    (call) => (call as unknown as [{ args: unknown[] }])[0].args[2],
  );
  expect(new Set(limits)).toEqual(new Set([30]));
  // Every read persisted its cards, so the app saw the grid between reads.
  expect(shown).toEqual(expect.arrayContaining([6]));
  expect(result.diagnostics.focus).toMatchObject({
    eligible: false,
    skipReason: "window-not-focused",
  });
  expect(result.diagnostics.deepSkipped).toBe("window-not-focused");
  expect(focus.update).not.toHaveBeenCalled();
});

it("deep search: stops cleanly when cancelled during an initial scroll cycle", async () => {
  focusControls();
  let finish!: (value: { result: { status: string; results: ReturnType<typeof cards> } }[]) => void;
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
    if ((args[0] as { args: unknown[] }).args[3])
      return new Promise((resolve) => {
        finish = resolve;
      });
    return [{ result: { status: "done", results: cards(6) } }];
  });
  await service.handle(deepRequest, sender);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const reads = api.scripting.executeScript.mock.calls.length;
  expect(
    await service.handle({ version: 1, type: "cancel", jobId: "job-1" }, sender),
  ).toMatchObject({ status: "cancelled" });
  expect(api.tabs.remove).toHaveBeenCalledWith(101);
  finish([{ result: { status: "done", results: cards(60) } }]);
  await vi.waitFor(async () =>
    expect(await poll()).toMatchObject({
      status: "cancelled",
      platforms: { ig: { results: expect.any(Array) } },
    }),
  );
  const snapshot = (await poll()) as { platforms: { ig: { results: unknown[] } } };
  expect(snapshot.platforms.ig.results).toHaveLength(6);
  expect(api.scripting.executeScript).toHaveBeenCalledTimes(reads);
});

it("More still adds at most thirty cards from a page that shows many more", async () => {
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(60) } },
  ]);
  await service.handle(request, sender);
  await complete();
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(90, 60) } },
  ]);
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  expect(await complete()).toMatchObject({
    platforms: { ig: { diagnostics: { added: 30, stopReason: "target" } } },
  });
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.at(-1)![0].args[2]).toBe(30);
});

/** A tab that loads for three seconds, then shows six Instagram cards until 24 hydrate 18 s after the first read. */
function hydratingInstagramPage() {
  const page = {
    started: timestamp,
    firstRead: undefined as number | undefined,
    hold: undefined as Promise<void> | undefined,
    scrolledAt: [] as number[],
  };
  api.tabs.create.mockImplementation(async ({ url }: { url: string }) => {
    const tab = { id: ++tabCounter, url, status: "loading" };
    tabs.set(tab.id, tab);
    return tab;
  });
  api.tabs.get.mockImplementation(async (id: number) => {
    const tab = tabs.get(id);
    if (!tab) throw new Error("Closed");
    if (timestamp - page.started >= 3000) tab.status = "complete";
    return tab;
  });
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
    if ((args[0] as { args: unknown[] }).args[3]) page.scrolledAt.push(timestamp);
    page.firstRead ??= timestamp;
    const count = timestamp - page.firstRead < 18000 ? 6 : 24;
    const hold = page.hold;
    page.hold = undefined;
    if (hold) await hold;
    return [{ result: { status: "done", results: cards(count) } }];
  });
  return page;
}

it("deep search: keeps reading an initial Instagram row of six until it hydrates to 24 eighteen seconds after the first read", async () => {
  focusControls();
  const page = hydratingInstagramPage();
  await service.handle(deepRequest, sender);
  const result = (await complete()) as {
    platforms: { ig: { status: string; results: unknown[] } };
  };
  expect(page.firstRead! - page.started).toBe(3000);
  expect(result.platforms.ig.status).toBe("done");
  expect(result.platforms.ig.results).toHaveLength(24);
  expect(timestamp - page.started).toBeLessThanOrEqual(40000);
  // No scroll during the hydration window; afterwards at most four bounded cycles.
  expect(page.scrolledAt.length).toBeGreaterThan(0);
  expect(page.scrolledAt.length).toBeLessThanOrEqual(4);
  expect(page.scrolledAt.every((at) => at - page.firstRead! >= 18000)).toBe(true);
});

it("deep search: reports request, focus and per-platform stop diagnostics on the polled job", async () => {
  focusControls();
  const page = hydratingInstagramPage();
  let release!: () => void;
  page.hold = new Promise((resolve) => {
    release = resolve;
  });
  await service.handle(deepRequest, sender);
  await vi.waitFor(() => expect(api.scripting.executeScript).toHaveBeenCalledTimes(1));
  expect(await poll()).toMatchObject({ status: "running", diagnostics: { request: "accepted" } });
  expect(await service.handle(deepRequest, sender)).toEqual({ ok: true, jobId: "job-1" });
  expect(await poll()).toMatchObject({
    status: "running",
    diagnostics: { request: "already-running" },
  });
  release();
  expect(await complete()).toMatchObject({
    diagnostics: {
      request: "already-running",
      focus: {
        eligible: true,
        activated: [],
        restored: "skipped",
      },
    },
    platforms: {
      ig: {
        status: "done",
        diagnostics: { returned: 24, added: 24, elapsedMs: 40000, stopReason: "time-cap" },
      },
    },
  });
  expect(await poll()).not.toHaveProperty("diagnostics.deepSkipped");
});

it("accepts four successive More requests and adds thirty virtualized cards per request", async () => {
  await service.handle(request, sender);
  await complete();
  const initialReads = api.scripting.executeScript.mock.calls.length;
  for (let page = 1; page <= 4; page++) {
    api.scripting.executeScript.mockResolvedValue([
      { result: { status: "done", results: cards(30, page * 30) } },
    ]);
    expect(
      await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender),
    ).toMatchObject({ status: "running" });
    expect(await complete()).toMatchObject({
      hasMore: true,
      platforms: {
        ig: {
          omittedCount: 0,
          results: expect.arrayContaining([
            expect.objectContaining({
              url: `https://www.instagram.com/reel/Post${page * 30 + 29}/`,
            }),
          ]),
        },
      },
    });
  }
  const calls = api.scripting.executeScript.mock.calls.slice(initialReads) as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.filter(([call]) => call.args[3])).toHaveLength(4);
  expect(api.tabs.create).toHaveBeenCalledTimes(1);
});

it.each([
  [
    ["PostA", "PostC"],
    ["PostA", "PostB", "PostC", "PostD"],
  ],
  // PostX was virtualized away: it stays right after its nearest shown neighbour.
  [
    ["PostA", "PostX", "PostC"],
    ["PostA", "PostX", "PostB", "PostC", "PostD"],
  ],
])(
  "merges late-hydrated cards in observed native order from %j without duplicates",
  async (initial, expected) => {
    const ig = (id: string, path = "reel") => ({
      platform: "ig",
      url: `https://www.instagram.com/${path}/${id}/`,
      title: id,
    });
    const ids = (snapshot: unknown) =>
      (snapshot as { platforms: { ig: { results: { url: string }[] } } }).platforms.ig.results.map(
        (result) => result.url.split("/").at(-2),
      );
    api.scripting.executeScript.mockResolvedValue([
      { result: { status: "done", results: initial.map((id) => ig(id)) } },
    ]);
    await service.handle(request, sender);
    await complete();
    // B hydrated late between known A and cursor C; D is beyond the cursor.
    api.scripting.executeScript.mockResolvedValue([
      {
        result: {
          status: "done",
          results: [ig("PostB"), ig("PostD")],
          order: ["PostA", "PostB", "PostC", "PostD"],
        },
      },
    ]);
    await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
    const merged = await complete();
    expect(ids(merged)).toEqual(expected);
    expect(
      (
        merged as { platforms: { ig: { results: { position: number }[] } } }
      ).platforms.ig.results.map((result) => result.position),
    ).toEqual(expected.map((_, index) => index + 1));
    // Overlapping continuation window: a known card (as an alias) repeats, new cards follow.
    api.scripting.executeScript.mockResolvedValue([
      {
        result: {
          status: "done",
          results: [ig("PostC", "p"), ig("PostE"), ig("PostF")],
          order: ["PostC", "PostD", "PostE", "PostF"],
        },
      },
    ]);
    await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
    expect(ids(await complete())).toEqual([...expected, "PostE", "PostF"]);
    const calls = api.scripting.executeScript.mock.calls as unknown as [
      { args: [string, string, number, boolean, { lastUrl: string }] },
    ][];
    expect(calls.at(-1)![0].args[4].lastUrl).toBe("https://www.instagram.com/reel/PostF/");
  },
);

it("passes trim bookkeeping to More reads and merges bounded order evidence after a long prefix", async () => {
  const ig = (id: string) => ({
    platform: "ig",
    url: `https://www.instagram.com/reel/${id}/`,
    title: id,
  });
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: [ig("PostA"), ig("PostC")] } },
  ]);
  await service.handle(request, sender);
  await complete();
  const initialReads = api.scripting.executeScript.mock.calls.length;
  // The collector's bounded order for 600 old rendered cards then [PostA,LateB,PostC,PostD].
  const old = Array.from({ length: 10 }, (_, index) => `Old${590 + index}`);
  api.scripting.executeScript.mockResolvedValue([
    {
      result: {
        status: "done",
        results: [ig("LateB"), ig("PostD")],
        order: [...old, "PostA", "LateB", "PostC", "PostD"],
      },
    },
  ]);
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  const merged = (await complete()) as {
    platforms: { ig: { results: { url: string; position: number }[] } };
  };
  expect(merged.platforms.ig.results.map((result) => result.url.split("/").at(-2))).toEqual([
    "PostA",
    "LateB",
    "PostC",
    "PostD",
  ]);
  expect(merged.platforms.ig.results.map((result) => result.position)).toEqual([1, 2, 3, 4]);
  const calls = api.scripting.executeScript.mock.calls.slice(initialReads) as unknown as [
    { args: [string, string, number, boolean, Record<string, unknown>] },
  ][];
  expect(calls.find(([call]) => call.args[3])![0].args[4]).toEqual({
    knownUrls: ["https://www.instagram.com/reel/PostA/", "https://www.instagram.com/reel/PostC/"],
    lastUrl: "https://www.instagram.com/reel/PostC/",
    knownTotal: 2,
    omitted: 0,
  });
});

it("keeps quiet native pages retryable after at most four scroll/read cycles", async () => {
  await service.handle(request, sender);
  expect(await complete()).toMatchObject({ hasMore: true });
  const initialReads = api.scripting.executeScript.mock.calls.length;
  const moreStarted = timestamp;
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  expect(await complete()).toMatchObject({
    hasMore: true,
    platforms: {
      ig: { status: "done", results: expect.any(Array), diagnostics: { stopReason: "scroll-cap" } },
    },
  });
  expect(timestamp - moreStarted).toBe(19000);
  const calls = api.scripting.executeScript.mock.calls.slice(initialReads) as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.filter(([call]) => call.args[3])).toHaveLength(4);
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(30, 30) } },
  ]);
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  expect(await complete()).toMatchObject({
    hasMore: true,
    platforms: {
      ig: {
        results: expect.arrayContaining([
          expect.objectContaining({ url: "https://www.instagram.com/reel/Post59/" }),
        ]),
      },
    },
  });
});

it("retains the latest300 cards while continuing beyond a full window and counting omitted cards", async () => {
  await service.handle(request, sender);
  await complete();
  for (let page = 1; page <= 12; page++) {
    api.scripting.executeScript.mockResolvedValue([
      { result: { status: "done", results: cards(30, page * 30) } },
    ]);
    await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
    await complete();
  }
  const snapshot = (await poll()) as {
    hasMore: boolean;
    platforms: { ig: { results: { url: string; position: number }[]; omittedCount: number } };
  };
  expect(snapshot.hasMore).toBe(true);
  expect(snapshot.platforms.ig.results).toHaveLength(300);
  expect(snapshot.platforms.ig.omittedCount).toBe(90);
  expect(snapshot.platforms.ig.results[0]).toMatchObject({
    url: "https://www.instagram.com/reel/Post90/",
    position: 1,
  });
  expect(snapshot.platforms.ig.results.at(-1)).toMatchObject({
    url: "https://www.instagram.com/reel/Post389/",
    position: 300,
  });
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    {
      args: [
        string,
        string,
        number,
        boolean,
        { knownUrls: string[]; lastUrl: string; knownTotal: number; omitted: number },
      ];
    },
  ][];
  const last = calls.at(-1)![0].args;
  expect(last[2]).toBe(30);
  expect(last[4].knownUrls).toHaveLength(300);
  expect(last[4].knownTotal).toBe(300);
  expect(last[4].omitted).toBe(60);
  expect(last[4].lastUrl).toBe("https://www.instagram.com/reel/Post359/");

  let finish!: (value: { result: { status: string; results: ReturnType<typeof cards> } }[]) => void;
  api.scripting.executeScript
    .mockResolvedValueOnce([{ result: { status: "done", results: cards(10, 390) } }])
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  const progress = (await poll()) as typeof snapshot & { status: string };
  expect(progress.status).toBe("running");
  expect(progress.platforms.ig.results).toHaveLength(300);
  expect(progress.platforms.ig.omittedCount).toBe(100);
  expect(progress.platforms.ig.results.at(-1)?.url).toBe("https://www.instagram.com/reel/Post399/");
  finish([{ result: { status: "done", results: cards(20, 400) } }]);
  const next = (await complete()) as typeof snapshot;
  expect(next.platforms.ig.results).toHaveLength(300);
  expect(next.platforms.ig.omittedCount).toBe(120);
  expect(next.platforms.ig.results.at(-1)?.url).toBe("https://www.instagram.com/reel/Post419/");
});

it("renews the source-tab expiry only when the user explicitly requests More", async () => {
  const originalExpiry = timestamp + 15 * 60 * 1000;
  await service.handle(request, sender);
  await complete();
  timestamp += 14 * 60 * 1000;
  await poll();
  expect(api.alarms.create).toHaveBeenLastCalledWith("discover-native-expiry:job-1", {
    when: originalExpiry,
  });
  const renewedExpiry = timestamp + 15 * 60 * 1000;
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(30, 30) } },
  ]);
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  await complete();
  expect(api.alarms.create).toHaveBeenLastCalledWith("discover-native-expiry:job-1", {
    when: renewedExpiry,
  });
  timestamp += 2 * 60 * 1000;
  await service.onAlarm({ name: "discover-native-expiry:job-1" });
  expect(await poll()).toMatchObject({ status: "complete", hasMore: true });
  expect(api.tabs.remove).not.toHaveBeenCalled();
});

it("cancellation and a new job clean owned tabs without touching the app or unrelated tabs", async () => {
  tabs.set(999, { id: 999, url: "https://www.instagram.com/direct/inbox/", status: "complete" });
  await service.handle(request, sender);
  await complete();
  await service.handle({ ...request, requestId: "test-2" }, sender);
  await complete("job-2");
  expect(await poll()).toEqual({ ok: false, error: "job-not-found" });
  expect(api.tabs.remove).toHaveBeenCalledWith(101);
  api.permissions.contains.mockResolvedValue(false);
  expect(
    await service.handle({ version: 1, type: "cancel", jobId: "job-2" }, sender),
  ).toMatchObject({ status: "cancelled" });
  expect(api.tabs.remove).toHaveBeenCalledWith(102);
  expect(tabs.has(999)).toBe(true);
  expect(api.tabs.remove).not.toHaveBeenCalledWith(7);
});

it("stops reading and preserves a source tab navigated by the user", async () => {
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(60) } },
  ]);
  await service.handle(request, sender);
  await complete();
  tabs.set(101, { id: 101, url: "https://www.instagram.com/direct/inbox/", status: "complete" });
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  expect(await complete()).toMatchObject({
    platforms: { ig: { status: "needs-attention", error: "search-page-changed" } },
  });
  expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
  await service.handle({ version: 1, type: "cancel", jobId: "job-1" }, sender);
  expect(api.tabs.remove).not.toHaveBeenCalled();
});

it("bounds empty/loading retries and reports login attention independently", async () => {
  api.scripting.executeScript.mockResolvedValue([{ result: { status: "empty", results: [] } }]);
  await service.handle(request, sender);
  // Packet 23: zero cards at the cap without the platform's No results screen is a failed read.
  expect(await complete()).toMatchObject({
    platforms: { ig: { status: "error", error: "search-timeout", results: [] } },
  });
  expect(api.scripting.executeScript.mock.calls.length).toBeLessThanOrEqual(40);
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "needs-attention", error: "login-or-challenge", results: [] } },
  ]);
  await service.handle({ ...request, requestId: "test-2" }, sender);
  expect(await complete("job-2")).toMatchObject({
    platforms: { ig: { status: "needs-attention", error: "login-or-challenge" } },
  });
});

it("cleans source tabs on owner close and durable TTL after a worker restart", async () => {
  // Sixty cards end each initial read at once; the restarted services use real sleeps.
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(60) } },
  ]);
  await service.handle(request, sender);
  await complete();
  service = createNativeSearchService(api, { now: () => timestamp });
  await service.ready;
  expect(await poll()).toMatchObject({ status: "complete" });
  timestamp += 16 * 60 * 1000;
  await service.onAlarm({ name: "discover-native-expiry:job-1" });
  expect(api.tabs.remove).toHaveBeenCalledExactlyOnceWith(101);
  expect(await poll()).toEqual({ ok: false, error: "job-not-found" });
  service = createNativeSearchService(api, { now: () => timestamp, id: () => "job-2" });
  await service.ready;
  await service.handle({ ...request, requestId: "test-2" }, sender);
  await complete("job-2");
  await service.onTabRemoved(7);
  expect(api.tabs.remove).toHaveBeenCalledWith(102);
});

it("cancels safely while the first tab is still being created", async () => {
  let finish!: (tab: { id: number; url: string; status: string }) => void;
  api.tabs.create.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await service.handle(request, sender);
  await service.handle({ version: 1, type: "cancel", jobId: "job-1" }, sender);
  const tab = {
    id: 101,
    url: "https://www.instagram.com/explore/search/keyword/?q=anime%20edit",
    status: "complete",
  };
  tabs.set(101, tab);
  finish(tab);
  await vi.waitFor(() => expect(api.tabs.remove).toHaveBeenCalledWith(101));
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("deep search: ends a stalled initial browser injection after 40 seconds and ignores its late reply", async () => {
  vi.useFakeTimers();
  try {
    focusControls();
    let finish!: (
      value: { result: { status: string; results: ReturnType<typeof cards> } }[],
    ) => void;
    api.scripting.executeScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await service.handle(deepRequest, sender);
    await vi.advanceTimersByTimeAsync(39999);
    expect(await poll()).toMatchObject({ status: "running" });
    await vi.advanceTimersByTimeAsync(2);
    expect(await poll()).toMatchObject({
      status: "complete",
      platforms: { ig: { status: "error", error: "search-timeout", results: [] } },
    });
    finish([{ result: { status: "done", results: cards() } }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await poll()).toMatchObject({ platforms: { ig: { results: [] } } });
  } finally {
    vi.useRealTimers();
  }
});

it("ends a stalled More injection after 25 seconds", async () => {
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(60) } },
  ]);
  await service.handle(request, sender);
  await complete();
  vi.useFakeTimers();
  try {
    api.scripting.executeScript.mockImplementationOnce(() => new Promise(() => {}));
    await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
    await vi.advanceTimersByTimeAsync(24999);
    expect(await poll()).toMatchObject({ status: "running" });
    await vi.advanceTimersByTimeAsync(2);
    expect(await poll()).toMatchObject({
      status: "complete",
      platforms: { ig: { diagnostics: { stopReason: "timeout" } } },
    });
  } finally {
    vi.useRealTimers();
  }
});

function focusControls() {
  let activeTabId = 7;
  let activeWindowId = 1;
  let windowFocused = true;
  tabs.set(7, { id: 7, url: sender.url, status: "complete" });
  Object.assign(tabs.get(7)!, { windowId: 1 });
  api.tabs.create.mockImplementation(async (options) => {
    const tab = { id: ++tabCounter, url: options.url, status: "complete", windowId: 1 };
    tabs.set(tab.id, tab);
    return tab;
  });
  const update = vi.fn(async (tabId: number) => {
    activeTabId = tabId;
    service.onTabActivated({ tabId, windowId: 1 });
    return tabs.get(tabId);
  });
  Object.assign(api.tabs, {
    query: vi.fn(async () => [
      { ...tabs.get(activeTabId), id: activeTabId, windowId: activeWindowId },
    ]),
    update,
  });
  Object.assign(api, {
    windows: {
      getLastFocused: vi.fn(async () => ({ id: activeWindowId, focused: windowFocused })),
    },
  });
  return {
    update,
    leave(kind: string) {
      activeTabId = 999;
      if (kind === "window") {
        activeWindowId = 2;
        service.onWindowFocusChanged(2);
      } else service.onTabActivated({ tabId: 999, windowId: 1 });
    },
    /** The user selects a tab in the owner window. */
    select(tabId: number) {
      activeTabId = tabId;
      service.onTabActivated({ tabId, windowId: 1 });
    },
    /** Another app takes OS focus; Chrome does not always send a focus event for it. */
    blur() {
      windowFocused = false;
    },
  };
}

function nativeBatch(platform: string) {
  return cards(60).map((card, index) => ({
    ...card,
    platform,
    url:
      platform === "ig"
        ? card.url
        : platform === "tt"
          ? `https://www.tiktok.com/@editor/video/${BigInt("1234567890123456000") + BigInt(index)}`
          : `https://www.youtube.com/watch?v=${String(index).padStart(11, "0")}`,
  }));
}

it("activates each owned native search once within the owner window, then restores Discover", async () => {
  const focus = focusControls();
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => [
    { result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) } },
  ]);
  await service.handle(
    { ...deepRequest, queries: { ig: "anime", tt: "anime", yt: "anime" } },
    sender,
  );
  expect(await complete()).toMatchObject({
    diagnostics: {
      focus: { eligible: true, activated: ["ig", "tt", "yt"], restored: true },
    },
    platforms: { ig: { diagnostics: { stopReason: "target" } } },
  });
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 102, 103, 7]);
  expect(api.tabs.create).toHaveBeenCalledWith(
    expect.objectContaining({ active: false, windowId: 1 }),
  );
});

it.each(["tab", "window"])(
  "stops all remaining automatic activation and restoration when the user chooses another %s",
  async (kind) => {
    const focus = focusControls();
    let reads = 0;
    api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
      if (++reads === 1) focus.leave(kind);
      return [
        {
          result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) },
        },
      ];
    });
    await service.handle(
      { ...deepRequest, queries: { ig: "anime", tt: "anime", yt: "anime" } },
      sender,
    );
    await complete();
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  },
);

it.each([
  ["tab", "tab-activated"],
  ["window", "window-focus-changed"],
  ["app", "window-not-focused"],
])(
  "records why automatic focus handling stopped when the user chooses another %s",
  async (kind, reason) => {
    const focus = focusControls();
    let reads = 0;
    api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
      if (++reads === 1) {
        if (kind === "app") focus.blur();
        else focus.leave(kind);
      }
      return [
        {
          result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) },
        },
      ];
    });
    await service.handle(
      { ...deepRequest, queries: { ig: "anime", tt: "anime", yt: "anime" } },
      sender,
    );
    expect(await complete()).toMatchObject({
      diagnostics: { focus: { activated: ["ig"], restored: "skipped", stopped: reason } },
    });
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  },
);

it.each([
  ["Discover", 7],
  ["an owned tab of this job", 101],
])(
  "keeps showing the remaining tabs and restores Discover when the user selects %s",
  async (_label, tabId) => {
    const focus = focusControls();
    let reads = 0;
    api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
      // While TikTok (102) is in front, the user picks Discover or the Instagram tab.
      if (++reads === 2) focus.select(tabId);
      return [
        {
          result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) },
        },
      ];
    });
    await service.handle(
      { ...deepRequest, queries: { ig: "anime", tt: "anime", yt: "anime" } },
      sender,
    );
    const result = await complete();
    expect(result).toMatchObject({
      diagnostics: { focus: { activated: ["ig", "tt", "yt"], restored: true } },
    });
    expect(result).not.toHaveProperty("diagnostics.focus.stopped");
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 102, 103, 7]);
  },
);

it("stops when the user navigates a selected owned tab away from its search", async () => {
  const focus = focusControls();
  let reads = 0;
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
    if (++reads === 2) {
      Object.assign(tabs.get(101)!, { url: "https://www.instagram.com/reel/Other/" });
      focus.select(101);
    }
    return [
      {
        result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) },
      },
    ];
  });
  await service.handle(
    { ...deepRequest, queries: { ig: "anime", tt: "anime", yt: "anime" } },
    sender,
  );
  expect(await complete()).toMatchObject({
    diagnostics: {
      focus: { activated: ["ig", "tt"], restored: "skipped", stopped: "tab-navigated" },
    },
  });
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 102]);
});

it("a second deep search from the same Discover tab starts eligible after the first restored Discover", async () => {
  const focus = focusControls();
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => [
    { result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) } },
  ]);
  const queries = { ig: "anime", tt: "anime", yt: "anime" };
  await service.handle({ ...deepRequest, queries }, sender);
  expect(await complete()).toMatchObject({
    diagnostics: { focus: { eligible: true, activated: ["ig", "tt", "yt"], restored: true } },
  });
  await service.handle({ ...deepRequest, requestId: "test-2", queries }, sender);
  const second = await complete("job-2");
  expect(second).toMatchObject({
    diagnostics: { focus: { eligible: true, activated: ["ig", "tt", "yt"], restored: true } },
  });
  expect(second).not.toHaveProperty("diagnostics.deepSkipped");
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 102, 103, 7, 104, 105, 106, 7]);
});

it("never restores or activates remaining tabs after cancellation during focused collection", async () => {
  const focus = focusControls();
  let finish!: (value: { result: { status: string; results: ReturnType<typeof cards> } }[]) => void;
  api.scripting.executeScript.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await service.handle({ ...deepRequest, queries: { ig: "anime", yt: "anime" } }, sender);
  await vi.waitFor(() => expect(api.scripting.executeScript).toHaveBeenCalledTimes(1));
  await service.handle({ version: 1, type: "cancel", jobId: "job-1" }, sender);
  finish([{ result: { status: "done", results: cards() } }]);
  await poll();
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  expect(api.tabs.create).toHaveBeenCalledTimes(1);
});

it.each(["http://localhost:3000/settings/", "https://example.com/"])(
  "does not restore the owner tab when its known current URL has changed (%s)",
  async (url) => {
    const focus = focusControls();
    api.scripting.executeScript.mockImplementationOnce(async () => {
      Object.assign(tabs.get(7)!, { url });
      return [{ result: { status: "done", results: cards() } }];
    });
    await service.handle(deepRequest, sender);
    await complete();
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  },
);

async function completedWithWithheldOwnerUrl() {
  const focus = focusControls();
  api.scripting.executeScript.mockImplementationOnce(async () => {
    Object.assign(tabs.get(7)!, { url: undefined });
    return [{ result: { status: "done", results: cards() } }];
  });
  await service.handle(deepRequest, sender);
  // Observe storage completion without sending the authenticated owner poll.
  await vi.waitFor(() =>
    expect(stored.discoverNativeJobsV1).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "job-1", status: "complete" })]),
    ),
  );
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  return focus;
}

it("restores a URL-withheld owner only on a fresh poll from its original Discover document", async () => {
  const focus = await completedWithWithheldOwnerUrl();
  expect(await poll()).toMatchObject({ status: "complete" });
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 7]);
  await poll();
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 7]);
});

it("rejects a new document, other tab and wrong URL before a pending restoration", async () => {
  const focus = await completedWithWithheldOwnerUrl();
  expect(await poll("job-1", { ...sender, documentId: "replacement-document" })).toEqual({
    ok: false,
    error: "job-not-found",
  });
  expect(await poll("job-1", { ...sender, tab: { id: 8 } })).toEqual({
    ok: false,
    error: "job-not-found",
  });
  expect(await poll("job-1", { ...sender, url: "http://localhost:3000/settings/" })).toEqual({
    ok: false,
    error: "forbidden",
  });
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  await poll();
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 7]);
});

it.each(["tab", "window"])(
  "never restores after the user switches %s while awaiting the owner poll",
  async (kind) => {
    const focus = await completedWithWithheldOwnerUrl();
    focus.leave(kind);
    await poll();
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  },
);

it.each(["cancel", "new-search"])("discards pending restoration on %s", async (action) => {
  const focus = await completedWithWithheldOwnerUrl();
  if (action === "cancel")
    await service.handle({ version: 1, type: "cancel", jobId: "job-1" }, sender);
  else {
    await service.handle({ ...request, requestId: "new-request" }, sender);
    await complete("job-2");
  }
  await poll();
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
});

it("expires pending restoration after fifteen seconds", async () => {
  vi.useFakeTimers();
  try {
    const focus = focusControls();
    api.scripting.executeScript.mockImplementationOnce(async () => {
      Object.assign(tabs.get(7)!, { url: undefined });
      return [{ result: { status: "done", results: cards(60) } }];
    });
    await service.handle(deepRequest, sender);
    await vi.advanceTimersByTimeAsync(1);
    timestamp += 15001;
    await vi.advanceTimersByTimeAsync(15001);
    expect(await poll()).toMatchObject({ status: "complete" });
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  } finally {
    vi.useRealTimers();
  }
});

it("ignores a late focus lookup from a timed-out platform while the next platform is running", async () => {
  vi.useFakeTimers();
  try {
    const focus = focusControls();
    let finishOldLookup!: (tab: { id: number; url: string; status: string }) => void;
    let finishNextRead!: (
      value: { result: { status: string; results: ReturnType<typeof cards> } }[],
    ) => void;
    api.tabs.get.mockImplementation(async (tabId) => {
      if (tabId === 101)
        return new Promise((resolve) => {
          finishOldLookup = resolve;
        });
      return tabs.get(tabId)!;
    });
    api.scripting.executeScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishNextRead = resolve;
        }),
    );
    await service.handle({ ...deepRequest, queries: { ig: "anime", yt: "anime" } }, sender);
    await vi.advanceTimersByTimeAsync(40001);
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([102]);
    finishOldLookup(tabs.get(101)!);
    await vi.advanceTimersByTimeAsync(1);
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([102]);
    finishNextRead([{ result: { status: "done", results: nativeBatch("yt") } }]);
    await vi.advanceTimersByTimeAsync(1);
    expect(await poll()).toMatchObject({ status: "complete" });
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([102, 7]);
  } finally {
    vi.useRealTimers();
  }
});

it("maps a persistent source-error screen to a failed TikTok read, not empty, after one reload", async () => {
  const reads: string[] = [];
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => {
    const platform = (args[0] as { args: string[] }).args[0];
    reads.push(platform);
    return [
      platform === "tt"
        ? { result: { status: "error", results: [], error: "search-service-error" } }
        : { result: { status: "done", results: nativeBatch(platform) } },
    ];
  });
  await service.handle({ ...request, queries: { ig: "anime", tt: "anime" } }, sender);
  const finished = await complete();
  expect(finished).toMatchObject({
    status: "complete",
    platforms: {
      tt: { status: "error", error: "read-failed", results: [] },
      ig: { status: "done" },
    },
  });
  expect(finished).not.toMatchObject({ platforms: { tt: { status: "empty" } } });
  expect(finished).toMatchObject({
    platforms: {
      ig: { results: expect.arrayContaining([expect.objectContaining({ platform: "ig" })]) },
    },
  });
  // Exactly one reload of the failed platform's own tab, never more.
  expect(api.tabs.reload).toHaveBeenCalledTimes(1);
  expect(reads.filter((platform) => platform === "tt").length).toBeGreaterThan(1);
});

// Packet 22: the normal Search button runs a quiet job; only the explicit Deep search activates tabs.

it("a quiet search never checks focus, activates or restores tabs or windows and reads thirty cards without scrolling", async () => {
  const focus = focusControls();
  const windowUpdate = vi.fn();
  Object.assign((api as unknown as { windows: object }).windows, { update: windowUpdate });
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => [
    { result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) } },
  ]);
  const started = timestamp;
  await service.handle({ ...request, queries: { ig: "anime", tt: "anime", yt: "anime" } }, sender);
  const result = (await complete()) as {
    diagnostics: unknown;
    platforms: Record<string, { status: string; results: unknown[]; diagnostics: unknown }>;
  };
  expect(result.diagnostics).toEqual({
    request: "accepted",
    focus: { eligible: false, skipReason: "quiet", activated: [], restored: "skipped" },
  });
  for (const platform of ["ig", "tt", "yt"]) {
    expect(result.platforms[platform].status).toBe("done");
    expect(result.platforms[platform].results).toHaveLength(30);
    expect(result.platforms[platform].diagnostics).toMatchObject({ stopReason: "target" });
  }
  expect(focus.update).not.toHaveBeenCalled();
  expect(windowUpdate).not.toHaveBeenCalled();
  expect((api.tabs as unknown as { query: ReturnType<typeof vi.fn> }).query).not.toHaveBeenCalled();
  expect(
    (api as unknown as { windows: { getLastFocused: ReturnType<typeof vi.fn> } }).windows
      .getLastFocused,
  ).not.toHaveBeenCalled();
  // Owned tabs still open in the background of the owner's window.
  for (const [options] of api.tabs.create.mock.calls)
    expect(options).toMatchObject({ active: false, windowId: 1 });
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.map(([call]) => [call.args[2], call.args[3]])).toEqual([
    [30, false],
    [30, false],
    [30, false],
  ]);
  expect(timestamp - started).toBeLessThanOrEqual(25000);
  expect((stored.discoverNativeJobsV1 as { deep: boolean }[])[0].deep).toBe(false);
});

it("a quiet initial grid stops after the settle window without scrolling, inside 25 seconds", async () => {
  const started = timestamp;
  api.scripting.executeScript.mockImplementation(async () => [
    { result: { status: "done", results: cards(6) } },
  ]);
  const scrolledAt = scrollTimes();
  await service.handle(request, sender);
  expect(await complete()).toMatchObject({
    platforms: { ig: { status: "done", diagnostics: { added: 6, stopReason: "quiet" } } },
  });
  // A quiet Instagram first row gets the 18 s hydration window, then the job ends.
  expect(scrolledAt).toEqual([]);
  expect(timestamp - started).toBe(18000);
});

it("a quiet search keeps delayed Instagram rows and stops four quiet seconds later without scrolling", async () => {
  const started = timestamp;
  api.scripting.executeScript.mockImplementation(async () => [
    { result: { status: "done", results: cards(timestamp - started < 5000 ? 6 : 26) } },
  ]);
  const scrolledAt = scrollTimes();
  await service.handle(request, sender);
  expect(await complete()).toMatchObject({
    platforms: {
      ig: { status: "done", diagnostics: { added: 26, stopReason: "hydrated-quiet" } },
    },
  });
  expect(scrolledAt).toEqual([]);
  expect(timestamp - started).toBe(9000);
});

it("a quiet search still waits for an Instagram row that hydrates eighteen seconds after the first read, within 25 seconds", async () => {
  const page = hydratingInstagramPage();
  await service.handle(request, sender);
  const result = (await complete()) as {
    platforms: { ig: { status: string; results: unknown[] } };
  };
  expect(result.platforms.ig.status).toBe("done");
  expect(result.platforms.ig.results).toHaveLength(24);
  expect(page.scrolledAt).toEqual([]);
  expect(timestamp - page.started).toBeLessThanOrEqual(25000);
});

it("ends a stalled quiet initial injection after 25 seconds", async () => {
  vi.useFakeTimers();
  try {
    api.scripting.executeScript.mockImplementationOnce(() => new Promise(() => {}));
    await service.handle(request, sender);
    await vi.advanceTimersByTimeAsync(24999);
    expect(await poll()).toMatchObject({ status: "running" });
    await vi.advanceTimersByTimeAsync(2);
    expect(await poll()).toMatchObject({
      status: "complete",
      platforms: { ig: { status: "error", error: "search-timeout", results: [] } },
    });
  } finally {
    vi.useRealTimers();
  }
});

it("More keeps the job's mode: a deep job activates again, a quiet job never does", async () => {
  const focus = focusControls();
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => [
    { result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) } },
  ]);
  await service.handle(deepRequest, sender);
  await complete();
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 7]);
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  expect(await complete()).toMatchObject({
    diagnostics: { focus: { eligible: true, activated: ["ig"], restored: true } },
  });
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 7, 101, 7]);

  await service.handle({ ...request, requestId: "test-2" }, sender);
  await complete("job-2");
  await service.handle({ version: 1, type: "more", jobId: "job-2" }, sender);
  expect(await complete("job-2")).toMatchObject({
    diagnostics: { focus: { eligible: false, skipReason: "quiet", restored: "skipped" } },
  });
  expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101, 7, 101, 7]);
});

it("a restored job saved without a mode continues quietly", async () => {
  const focus = focusControls();
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => [
    { result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) } },
  ]);
  await service.handle(deepRequest, sender);
  await complete();
  const saved = stored.discoverNativeJobsV1 as { deep?: boolean }[];
  expect(saved[0].deep).toBe(true);
  delete saved[0].deep;
  service = createNativeSearchService(api, {
    now: () => timestamp,
    sleep: async (ms: number) => {
      timestamp += ms;
    },
  });
  await service.ready;
  focus.update.mockClear();
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  expect(await complete()).toMatchObject({
    diagnostics: { focus: { skipReason: "quiet" } },
  });
  expect(focus.update).not.toHaveBeenCalled();
});

// F12: a rejected injection while a native page is still navigating is a transient miss.

it("retries a rejected injection and keeps the cards it reads next", async () => {
  api.scripting.executeScript
    .mockRejectedValueOnce(new Error("Frame with ID 0 was removed."))
    .mockResolvedValue([{ result: { status: "done", results: cards(30) } }]);
  await service.handle(request, sender);
  const result = (await complete()) as {
    platforms: { ig: { status: string; results: unknown[]; diagnostics: unknown } };
  };
  expect(result.platforms.ig.status).toBe("done");
  expect(result.platforms.ig.results).toHaveLength(30);
  expect(result.platforms.ig.diagnostics).toMatchObject({
    transientErrors: 1,
    stopReason: "target",
  });
});

it.each([false, true])(
  "reports read-failed only at the cap when every injection rejects (deep %s)",
  async (deep) => {
    // Packet 24: the deep budget needs Discover in front.
    if (deep) focusControls();
    api.scripting.executeScript.mockRejectedValue(new Error("Frame with ID 0 was removed."));
    await service.handle({ ...request, deep }, sender);
    const result = (await complete()) as {
      platforms: {
        ig: { status: string; error: string; diagnostics: Record<string, number | string> };
      };
    };
    expect(result.platforms.ig).toMatchObject({ status: "error", error: "read-failed" });
    expect(result.platforms.ig.diagnostics).toMatchObject({
      stopReason: "read-failed",
      elapsedMs: deep ? 40000 : 25000,
    });
    expect(result.platforms.ig.diagnostics.transientErrors).toBeGreaterThan(10);
  },
);

// Packet 22c: an injection that resolves without a card list (frame replaced or the
// injected function threw) is a transient miss, like a rejected one.

it("retries an injection that resolves without a result and records why", async () => {
  api.scripting.executeScript
    .mockResolvedValueOnce([{ result: undefined, error: { message: "boom" } }])
    .mockResolvedValue([{ result: { status: "done", results: cards(30) } }]);
  await service.handle(request, sender);
  const result = (await complete()) as {
    platforms: { ig: { status: string; results: unknown[]; diagnostics: unknown } };
  };
  expect(result.platforms.ig.status).toBe("done");
  expect(result.platforms.ig.results).toHaveLength(30);
  expect(result.platforms.ig.diagnostics).toMatchObject({
    transientErrors: 1,
    lastInjectionError: "boom",
    stopReason: "target",
  });
});

it("reports read-failed at the cap when every injection resolves without a result", async () => {
  api.scripting.executeScript.mockResolvedValue([{}]);
  await service.handle(request, sender);
  const result = (await complete()) as {
    platforms: {
      ig: { status: string; error: string; diagnostics: Record<string, number | string> };
    };
  };
  expect(result.platforms.ig).toMatchObject({ status: "error", error: "read-failed" });
  expect(result.platforms.ig.diagnostics).toMatchObject({
    stopReason: "read-failed",
    elapsedMs: 25000,
    lastInjectionError: "no-result",
  });
  expect(result.platforms.ig.diagnostics.transientErrors).toBeGreaterThan(10);
});

it("reports read-failed at the platform timer when injections keep rejecting slowly", async () => {
  vi.useFakeTimers();
  try {
    api.scripting.executeScript.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("Frame removed")), 1000)),
    );
    await service.handle(request, sender);
    await vi.advanceTimersByTimeAsync(25001);
    expect(await poll()).toMatchObject({
      status: "complete",
      platforms: {
        ig: { status: "error", error: "read-failed", diagnostics: { stopReason: "read-failed" } },
      },
    });
  } finally {
    vi.useRealTimers();
  }
});

it("fails promptly when the owned tab no longer exists", async () => {
  api.tabs.create.mockImplementationOnce(async ({ url }: { url: string }) => ({
    id: ++tabCounter,
    url,
    status: "complete",
  }));
  await service.handle(request, sender);
  const result = (await complete()) as {
    platforms: { ig: { status: string; error: string; diagnostics: { elapsedMs: number } } };
  };
  expect(result.platforms.ig).toMatchObject({ status: "error", error: "read-failed" });
  expect(result.platforms.ig.diagnostics.elapsedMs).toBeLessThanOrEqual(1000);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

// Packet 22b: TikTok's own "Something went wrong / Try again" screen gets one reload.

const serviceError = { result: { status: "error", results: [], error: "search-service-error" } };

it("reloads the owned tab once on a source-error screen and keeps the cards read next", async () => {
  api.scripting.executeScript
    .mockResolvedValueOnce([serviceError])
    .mockResolvedValue([{ result: { status: "done", results: cards(30) } }]);
  await service.handle(request, sender);
  const result = (await complete()) as {
    platforms: { ig: { status: string; results: unknown[]; diagnostics: unknown } };
  };
  expect(result.platforms.ig.status).toBe("done");
  expect(result.platforms.ig.results).toHaveLength(30);
  expect(api.tabs.reload).toHaveBeenCalledTimes(1);
  expect(api.tabs.reload).toHaveBeenCalledWith(101);
  expect(result.platforms.ig.diagnostics).toMatchObject({ serviceErrorReloads: 1 });
});

it.each([false, true])(
  "ends read-failed within the cap after exactly one reload when the error screen persists (deep %s)",
  async (deep) => {
    api.scripting.executeScript.mockResolvedValue([serviceError]);
    await service.handle({ ...request, deep }, sender);
    const result = (await complete()) as {
      platforms: { ig: { status: string; error: string; diagnostics: Record<string, unknown> } };
    };
    expect(result.platforms.ig).toMatchObject({ status: "error", error: "read-failed" });
    expect(result.platforms.ig.diagnostics).toMatchObject({
      serviceErrorReloads: 1,
      stopReason: "read-failed",
    });
    expect(result.platforms.ig.diagnostics.elapsedMs).toBeLessThanOrEqual(deep ? 40000 : 25000);
    expect(api.tabs.reload).toHaveBeenCalledTimes(1);
  },
);

it("stops cleanly when the job is cancelled during the reload", async () => {
  api.scripting.executeScript.mockResolvedValue([serviceError]);
  api.tabs.reload.mockImplementationOnce(async () => {
    await service.handle({ version: 1, type: "cancel", jobId: "job-1" }, sender);
  });
  await service.handle(request, sender);
  await vi.waitFor(() => expect(api.tabs.reload).toHaveBeenCalledTimes(1));
  await vi.waitFor(async () => expect(await poll()).toMatchObject({ status: "cancelled" }));
  expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
  expect(api.tabs.reload).toHaveBeenCalledTimes(1);
});

it("reports read-failed when the reload itself is rejected", async () => {
  api.scripting.executeScript.mockResolvedValue([serviceError]);
  api.tabs.reload.mockRejectedValueOnce(new Error("No tab with id"));
  await service.handle(request, sender);
  const result = await complete();
  expect(result).toMatchObject({
    platforms: { ig: { status: "error", error: "read-failed" } },
  });
  expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
});

it("does not reload for needs-attention or other collector errors", async () => {
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "needs-attention", error: "login-or-challenge", results: [] } },
  ]);
  await service.handle(request, sender);
  expect(await complete()).toMatchObject({
    platforms: { ig: { status: "needs-attention", error: "login-or-challenge" } },
  });
  expect(api.tabs.reload).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
});

const noResultsRead = {
  status: "empty",
  results: [],
  order: [],
  lastUrl: null,
  noResults: true,
};

it("ends a platform at once when its own No results screen shows, without waiting or reloading", async () => {
  api.scripting.executeScript.mockResolvedValue([{ result: noResultsRead }]);
  const started = timestamp;
  await service.handle(request, sender);
  const finished = await complete();
  expect(finished).toMatchObject({
    platforms: {
      ig: {
        status: "empty",
        noResults: true,
        results: [],
        diagnostics: { stopReason: "no-results" },
      },
    },
  });
  expect(finished).not.toHaveProperty("platforms.ig.error");
  expect(api.scripting.executeScript).toHaveBeenCalledTimes(1);
  expect(api.tabs.reload).not.toHaveBeenCalled();
  expect(timestamp - started).toBeLessThan(2000);
  // A later More that finds cards drops the marker.
  api.scripting.executeScript.mockResolvedValue([{ result: { status: "done", results: cards() } }]);
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  const more = await complete();
  expect(more).toMatchObject({ platforms: { ig: { status: "done" } } });
  expect(more).not.toHaveProperty("platforms.ig.noResults");
});

it("quiet search: 25 s of empty reads without a No results screen ends as a failed read", async () => {
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "empty", results: [], order: [], lastUrl: null } },
  ]);
  const started = timestamp;
  await service.handle(request, sender);
  expect(await complete()).toMatchObject({
    platforms: {
      ig: {
        status: "error",
        error: "search-timeout",
        results: [],
        diagnostics: { stopReason: "timeout" },
      },
    },
  });
  expect(timestamp - started).toBeGreaterThanOrEqual(25000);
});

it("the platform timer: zero cards read ends as a failed read; one card read stays received", async () => {
  vi.useFakeTimers();
  try {
    // Every read resolves empty, then one read stalls until the 25 s timer fires.
    api.scripting.executeScript
      .mockResolvedValueOnce([{ result: { status: "empty", results: [] } }])
      .mockImplementation(() => new Promise(() => {}));
    await service.handle(request, sender);
    await vi.advanceTimersByTimeAsync(25001);
    expect(await poll()).toMatchObject({
      status: "complete",
      platforms: {
        ig: { status: "error", error: "search-timeout", diagnostics: { stopReason: "timeout" } },
      },
    });
    api.scripting.executeScript
      .mockReset()
      .mockResolvedValueOnce([{ result: { status: "done", results: cards(1) } }])
      .mockImplementation(() => new Promise(() => {}));
    await service.handle({ ...request, requestId: "test-2" }, sender);
    await vi.advanceTimersByTimeAsync(25001);
    expect(await poll("job-2")).toMatchObject({
      status: "complete",
      platforms: { ig: { status: "done", results: [{ url: cards(1)[0].url }] } },
    });
  } finally {
    vi.useRealTimers();
  }
});

/** Packet 24: owned tabs always open in the originating Discover tab's own window. */
const allThree = { ig: "anime", tt: "anime", yt: "anime" };
function readAllThree() {
  api.scripting.executeScript.mockImplementation(async (...args: unknown[]) => [
    { result: { status: "done", results: nativeBatch((args[0] as { args: string[] }).args[0]) } },
  ]);
}
/** Focus APIs that make a Deep search ineligible for the given reason (owner in window 5). */
function unfocused(kind: string) {
  Object.assign(tabs.get(7)!, { windowId: 5 });
  const update = vi.fn(async () => undefined);
  if (kind === "focus-api-unavailable") return update;
  const otherWindow = kind === "other-window";
  Object.assign(api.tabs, {
    query: vi.fn(async () => [{ id: otherWindow ? 50 : 7, windowId: otherWindow ? 9 : 5 }]),
    update,
  });
  Object.assign(api, {
    windows: {
      getLastFocused: vi.fn(async () => ({ id: otherWindow ? 9 : 5, focused: otherWindow })),
    },
  });
  return update;
}

it("a quiet job opens all three owned tabs in the owner's window without ever checking focus", async () => {
  Object.assign(tabs.get(7)!, { windowId: 5 });
  const getLastFocused = vi.fn(async () => ({ id: 9, focused: true }));
  Object.assign(api, { windows: { getLastFocused } });
  readAllThree();
  await service.handle({ ...request, queries: allThree }, sender);
  const result = await complete();
  expect(api.tabs.create).toHaveBeenCalledTimes(3);
  for (const [options] of api.tabs.create.mock.calls)
    expect(options).toMatchObject({ active: false, windowId: 5 });
  expect(getLastFocused).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty("diagnostics.deepSkipped");
});

it.each(["focus-api-unavailable", "window-not-focused", "other-window"])(
  "a deep job without focus (%s) opens all three tabs in the owner's window with the quiet budget",
  async (kind) => {
    const update = unfocused(kind);
    readAllThree();
    await service.handle({ ...deepRequest, queries: allThree }, sender);
    const result = (await complete()) as {
      diagnostics: { deepSkipped?: string };
      platforms: Record<string, { results: unknown[]; diagnostics: { stopReason: string } }>;
    };
    expect(api.tabs.create).toHaveBeenCalledTimes(3);
    for (const [options] of api.tabs.create.mock.calls)
      expect(options).toMatchObject({ active: false, windowId: 5 });
    expect(update).not.toHaveBeenCalled();
    expect(result.diagnostics.deepSkipped).toBe(kind);
    for (const platform of ["ig", "tt", "yt"]) {
      expect(result.platforms[platform].results).toHaveLength(30);
      expect(result.platforms[platform].diagnostics.stopReason).toBe("target");
    }
    for (const call of api.scripting.executeScript.mock.calls as unknown as [{ args: unknown[] }][])
      expect(call[0].args.slice(2, 4)).toEqual([30, false]);
  },
);

it.each([
  ["quiet", request],
  ["deep", deepRequest],
])("a %s job whose Discover tab is gone opens no tab in any window and stops", async (_, req) => {
  tabs.delete(7);
  expect(await service.handle({ ...req, queries: allThree }, sender)).toEqual({
    ok: true,
    jobId: "job-1",
  });
  await vi.waitFor(async () => expect(await poll()).toEqual({ ok: false, error: "job-not-found" }));
  expect(api.tabs.create).not.toHaveBeenCalled();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
  expect(api.alarms.clear).toHaveBeenCalledWith("discover-native-expiry:job-1");
});
