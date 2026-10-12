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
let tabs: Map<number, { id: number; url: string; status: string }>;
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
    },
    scripting: {
      executeScript: vi.fn(
        async (): Promise<
          { result: { status: string; results: ReturnType<typeof cards>; error?: string } }[]
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

it("opens only owned inactive tabs, returns actual cards and keeps completed source tabs for review", async () => {
  expect(await service.handle(request, sender)).toEqual({ ok: true, jobId: "job-1" });
  const result = await complete();
  expect(result).toMatchObject({
    platforms: {
      ig: {
        status: "done",
        results: cards().map((card, position) => ({
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
  });
  expect(api.scripting.executeScript).toHaveBeenCalledWith({
    target: { tabId: 101 },
    func: expect.any(Function),
    args: ["ig", "https://www.instagram.com/explore/search/keyword/?q=anime%20edit", 30, false],
  });
  expect(api.tabs.remove).not.toHaveBeenCalled();
  expect(await service.handle(request, sender)).toEqual({ ok: true, jobId: "job-1" });
  expect(api.tabs.create).toHaveBeenCalledTimes(1);
});

it("authorizes poll, cancel and more to the originating tab and document only", async () => {
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

it("waits at least eight seconds before completing a small initial native grid without scrolling", async () => {
  const started = timestamp;
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(6) } },
  ]);
  await service.handle(request, sender);
  expect(await complete()).toMatchObject({
    platforms: { ig: { status: "done", results: expect.any(Array) } },
  });
  expect(timestamp - started).toBe(8000);
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.every(([call]) => call.args[3] === false)).toBe(true);
});

it("retains delayed Instagram rows and waits four seconds after the latest new cards", async () => {
  const started = timestamp;
  api.scripting.executeScript.mockImplementation(async () => [
    {
      result: { status: "done", results: cards(timestamp - started < 5000 ? 6 : 26) },
    },
  ]);
  await service.handle(request, sender);
  const result = await complete();
  expect(result).toMatchObject({
    platforms: {
      ig: {
        status: "done",
        results: expect.arrayContaining([
          expect.objectContaining({ url: "https://www.instagram.com/reel/Post25/" }),
        ]),
      },
    },
  });
  expect(timestamp - started).toBe(9000);
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.every(([call]) => call.args[3] === false)).toBe(true);
});

it("accepts four successive More requests and adds thirty virtualized cards per request", async () => {
  await service.handle(request, sender);
  await complete();
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
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.filter(([call]) => call.args[3])).toHaveLength(4);
  expect(api.tabs.create).toHaveBeenCalledTimes(1);
});

it("keeps quiet native pages retryable after at most three scroll/read cycles", async () => {
  await service.handle(request, sender);
  expect(await complete()).toMatchObject({ hasMore: true });
  const moreStarted = timestamp;
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  expect(await complete()).toMatchObject({
    hasMore: true,
    platforms: { ig: { status: "done", results: expect.any(Array) } },
  });
  expect(timestamp - moreStarted).toBe(14000);
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.filter(([call]) => call.args[3])).toHaveLength(3);
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
    { args: [string, string, number, boolean, { knownUrls: string[]; lastUrl: string }] },
  ][];
  const last = calls.at(-1)![0].args;
  expect(last[2]).toBe(30);
  expect(last[4].knownUrls).toHaveLength(300);
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
  expect(await complete()).toMatchObject({ platforms: { ig: { status: "empty", results: [] } } });
  expect(api.scripting.executeScript.mock.calls.length).toBeLessThanOrEqual(25);
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "needs-attention", error: "login-or-challenge", results: [] } },
  ]);
  await service.handle({ ...request, requestId: "test-2" }, sender);
  expect(await complete("job-2")).toMatchObject({
    platforms: { ig: { status: "needs-attention", error: "login-or-challenge" } },
  });
});

it("cleans source tabs on owner close and durable TTL after a worker restart", async () => {
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

it("ends a stalled browser injection after25 seconds and ignores its late reply", async () => {
  vi.useFakeTimers();
  try {
    let finish!: (
      value: { result: { status: string; results: ReturnType<typeof cards> } }[],
    ) => void;
    api.scripting.executeScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await service.handle(request, sender);
    await vi.advanceTimersByTimeAsync(25001);
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

function focusControls() {
  let activeTabId = 7;
  let activeWindowId = 1;
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
    windows: { getLastFocused: vi.fn(async () => ({ id: activeWindowId, focused: true })) },
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
  };
}

function nativeBatch(platform: string) {
  return cards().map((card, index) => ({
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
  await service.handle({ ...request, queries: { ig: "anime", tt: "anime", yt: "anime" } }, sender);
  await complete();
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
      { ...request, queries: { ig: "anime", tt: "anime", yt: "anime" } },
      sender,
    );
    await complete();
    expect(focus.update.mock.calls.map(([id]) => id)).toEqual([101]);
  },
);

it("never restores or activates remaining tabs after cancellation during focused collection", async () => {
  const focus = focusControls();
  let finish!: (value: { result: { status: string; results: ReturnType<typeof cards> } }[]) => void;
  api.scripting.executeScript.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await service.handle({ ...request, queries: { ig: "anime", yt: "anime" } }, sender);
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
    await service.handle(request, sender);
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
  await service.handle(request, sender);
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
      return [{ result: { status: "done", results: cards() } }];
    });
    await service.handle(request, sender);
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
    await service.handle({ ...request, queries: { ig: "anime", yt: "anime" } }, sender);
    await vi.advanceTimersByTimeAsync(25001);
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
