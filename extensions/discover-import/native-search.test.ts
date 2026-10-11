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

it("explicit more scrolls only once each time, merges virtualized cards and stops at90", async () => {
  await service.handle(request, sender);
  await complete();
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(30, 30) } },
  ]);
  expect(await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender)).toMatchObject({
    status: "running",
  });
  expect(await complete()).toMatchObject({
    platforms: {
      ig: {
        results: expect.arrayContaining([
          expect.objectContaining({ url: "https://www.instagram.com/reel/Post59/" }),
        ]),
      },
    },
  });
  api.scripting.executeScript.mockResolvedValue([
    { result: { status: "done", results: cards(30, 60) } },
  ]);
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  await complete();
  expect(await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender)).toEqual({
    ok: false,
    error: "limit-reached",
  });
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.filter(([call]) => call.args[3])).toHaveLength(2);
  expect(api.tabs.create).toHaveBeenCalledTimes(1);
});

it("reports hasMore false when an explicit more request finds no new cards", async () => {
  await service.handle(request, sender);
  expect(await complete()).toMatchObject({ hasMore: true });
  const moreStarted = timestamp;
  await service.handle({ version: 1, type: "more", jobId: "job-1" }, sender);
  expect(await complete()).toMatchObject({
    hasMore: false,
    platforms: { ig: { status: "done", results: expect.any(Array) } },
  });
  expect(timestamp - moreStarted).toBe(4000);
  const calls = api.scripting.executeScript.mock.calls as unknown as [
    { args: [string, string, number, boolean] },
  ][];
  expect(calls.filter(([call]) => call.args[3])).toHaveLength(1);
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
