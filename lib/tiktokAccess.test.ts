import { afterEach, describe, expect, it, vi } from "vitest";
import { probeTikTokAccess, readTikTokStoredStatus } from "./tiktokAccess";

const config = { url: "https://scout.test", token: "private-test-token" };
const NOW = Date.parse("2026-10-10T01:00:00Z");
const result = {
  version: 1,
  categoryId: "anime",
  country: "US",
  dateRange: "7DAY",
  discoveryType: "HASHTAG",
  stage: "trending_list",
  status: "accepted",
  requests: 1,
  checkedAt: new Date(NOW).toISOString(),
  hashtagCount: 0,
  httpStatus: 200,
  providerCode: 0,
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => vi.useRealTimers());

describe("TikTok stored access and one-request probe clients", () => {
  it("uses the existing Scout auth only for explicit fixed routes without retry or redirects", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ connected: true, advertisers: 1 }))
      .mockResolvedValueOnce(json(result));
    expect(await readTikTokStoredStatus(config, { fetchImpl })).toEqual({
      ok: true,
      value: { connected: true, advertisers: 1 },
    });
    expect(await probeTikTokAccess(config, "anime", { fetchImpl, now: () => NOW })).toEqual({
      ok: true,
      value: result,
    });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://scout.test/tiktokads/status",
      "https://scout.test/categories/anime/native/tt/probe",
    ]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: "GET",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: { Authorization: "Bearer private-test-token" },
    });
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: "POST", body: "{}" });
  });
  it.each([
    null,
    [],
    { connected: "yes", advertisers: 1 },
    { connected: false, advertisers: 1 },
    { connected: true, advertisers: -1 },
    { connected: true, advertisers: 1.5 },
    { connected: true, advertisers: 1, access_token: "never surface this" },
  ])("rejects malformed stored status without converting it to disconnected: %j", async (body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json(body));
    expect(await readTikTokStoredStatus(config, { fetchImpl })).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([
    { categoryId: "cars" },
    { country: "SA" },
    { dateRange: "30DAY" },
    { discoveryType: "TRACK" },
    { hashtagCount: undefined },
    { hashtagCount: -1 },
    { requests: 0 },
    { stage: "grant" },
    { message: "secret upstream data" },
    { status: "permission", hashtagCount: 0 },
    { httpStatus: 403 },
    { httpStatus: undefined },
    { providerCode: 40002 },
    { checkedAt: new Date(NOW + 301000).toISOString() },
    { checkedAt: new Date(NOW - 301000).toISOString() },
  ])("rejects inconsistent or unbound probe envelopes: %j", async (overrides) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ ...result, ...overrides }));
    expect(await probeTikTokAccess(config, "anime", { fetchImpl, now: () => NOW })).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("preserves denied access as a provider outcome distinct from an unavailable Worker", async () => {
    const denied = {
      ...result,
      status: "permission",
      hashtagCount: undefined,
      httpStatus: 403,
      providerCode: 40001,
    };
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(denied))
      .mockResolvedValueOnce(json({ error: "not_found" }, 404))
      .mockResolvedValueOnce(json({ error: "auth" }, 401));
    expect(await probeTikTokAccess(config, "anime", { fetchImpl, now: () => NOW })).toEqual({
      ok: true,
      value: { ...denied, hashtagCount: undefined },
    });
    expect(await probeTikTokAccess(config, "anime", { fetchImpl })).toEqual({
      ok: false,
      error: "worker_unavailable",
    });
    expect(await readTikTokStoredStatus(config, { fetchImpl })).toEqual({
      ok: false,
      error: "worker_auth",
    });
  });
  it("makes no call with missing configuration, an aborted action, or invalid category path", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(await readTikTokStoredStatus(null, { fetchImpl })).toEqual({
      ok: false,
      error: "unconfigured",
    });
    expect(
      await readTikTokStoredStatus(config, { fetchImpl, signal: AbortSignal.abort() }),
    ).toEqual({ ok: false, error: "cancelled" });
    expect(await probeTikTokAccess(config, "../run", { fetchImpl })).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("bounds streamed replies before parsing them", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("x".repeat(17000)));
    expect(await readTikTokStoredStatus(config, { fetchImpl })).toEqual({
      ok: false,
      error: "malformed",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([
    [404, "worker_unavailable"],
    [405, "worker_unavailable"],
    [401, "worker_auth"],
  ] as const)("maps bodyless HTTP %s without depending on error JSON", async (status, error) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status }));
    expect(await readTikTokStoredStatus(config, { fetchImpl })).toEqual({ ok: false, error });
  });
  it.each(["timeout", "cancelled"] as const)(
    "settles a stalled response body on %s and cancels its reader",
    async (error) => {
      vi.useFakeTimers();
      const cancelBody = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel: cancelBody });
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
      const controller = new AbortController();
      const pending = readTikTokStoredStatus(config, { fetchImpl, signal: controller.signal });
      await Promise.resolve();
      await Promise.resolve();
      if (error === "timeout") await vi.advanceTimersByTimeAsync(10000);
      else controller.abort();
      expect(await pending).toEqual({ ok: false, error });
      expect(cancelBody).toHaveBeenCalledOnce();
      expect(fetchImpl).toHaveBeenCalledOnce();
    },
  );
  it("enforces the deadline even when injected fetch ignores abort completely", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(() => undefined));
    const pending = readTikTokStoredStatus(config, { fetchImpl });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toEqual({ ok: false, error: "timeout" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it("times out a stalled request once without retry", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const pending = readTikTokStoredStatus(config, { fetchImpl });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toEqual({ ok: false, error: "timeout" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
