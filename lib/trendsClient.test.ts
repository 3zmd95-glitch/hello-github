import { describe, expect, it, vi } from "vitest";
import { fetchTrends, runTrends, trendsErrorMessageKey } from "./trendsClient";

const CONFIG = { url: "https://scout.test", token: "tok" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const replying = (body: unknown, status = 200) =>
  vi.fn<typeof fetch>(async () => jsonResponse(body, status));

const FEED = {
  items: [
    {
      id: "google:SA:حساب-المواطن",
      platform: "google",
      region: "SA",
      lang: "ar",
      title: "حساب المواطن",
      score: 100,
      growthPct: 400,
      volume: 500,
      source: "Google Trends",
      why: "صرف دفعة حساب المواطن",
      seenAt: "2026-09-28T06:00:00.000Z",
    },
    {
      id: "youtube:US:mrbeast",
      platform: "youtube",
      region: "US",
      lang: "en",
      title: "MrBeast",
      source: "YouTube charts",
      seenAt: "2026-09-28T06:00:00.000Z",
      tags: ["music"],
    },
  ],
  fetchedAt: "2026-09-28T06:00:00.000Z",
  degraded: false,
  sources: [{ name: "google", ok: true, at: "2026-09-28T06:00:00.000Z" }],
};

describe("fetchTrends", () => {
  it("reads GET /trends with the bearer token and fills the schema defaults", async () => {
    const fetchImpl = replying(FEED);
    const r = await fetchTrends(CONFIG, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/trends");
    const init = fetchImpl.mock.calls[0][1];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init?.method).toBeUndefined();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.feed.items).toHaveLength(2);
    expect(r.feed.items[0].tags).toEqual([]);
    expect(r.feed.items[1].tags).toEqual(["music"]);
    expect(r.feed.degraded).toBe(false);
    expect(r.feed.sources[0]).toEqual({ name: "google", ok: true, at: "2026-09-28T06:00:00.000Z" });
  });

  it("accepts the empty feed the Worker sends before its first run", async () => {
    const r = await fetchTrends(CONFIG, {
      fetchImpl: replying({ items: [], fetchedAt: null, degraded: true, sources: [] }),
    });
    expect(r).toEqual({
      ok: true,
      feed: { items: [], fetchedAt: null, degraded: true, sources: [] },
    });
  });

  it("treats a body that is not a feed as an upstream failure", async () => {
    const r = await fetchTrends(CONFIG, {
      fetchImpl: replying({ items: [{ id: "x", platform: "myspace" }] }),
    });
    expect(r).toEqual({ ok: false, error: { type: "upstream" } });
  });

  it.each([
    [401, { error: "unauthorized" }, "auth"],
    [429, "slow down", "rate_limited"],
    [500, "oops", "upstream"],
  ])("maps HTTP %i %j to %s", async (status, body, type) => {
    const r = await fetchTrends(CONFIG, { fetchImpl: replying(body, status) });
    expect(r).toEqual({ ok: false, error: { type, status } });
  });

  it("maps a thrown fetch to network and a missing config to unconfigured", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchTrends(CONFIG, { fetchImpl })).toEqual({
      ok: false,
      error: { type: "network" },
    });
    expect(await fetchTrends(null, { fetchImpl })).toEqual({
      ok: false,
      error: { type: "unconfigured" },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("runTrends", () => {
  it("POSTs /trends/run for the fast sources only and returns the fresh feed", async () => {
    const fetchImpl = replying(FEED);
    const r = await runTrends(CONFIG, { fetchImpl });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://scout.test/trends/run");
    expect(fetchImpl.mock.calls[0][1]?.method).toBe("POST");
    // Never the weekly Tavily scan: a dashboard refresh must not spend credits.
    expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))).toEqual({ kinds: ["fast"] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.feed.fetchedAt).toBe("2026-09-28T06:00:00.000Z");
  });

  it("refuses without a config and passes Worker errors through", async () => {
    expect(await runTrends(null)).toEqual({ ok: false, error: { type: "unconfigured" } });
    expect(await runTrends(CONFIG, { fetchImpl: replying({ error: "auth" }, 403) })).toEqual({
      ok: false,
      error: { type: "auth", status: 403 },
    });
  });
});

describe("trendsErrorMessageKey", () => {
  it("has a radar message for every error family", () => {
    expect(trendsErrorMessageKey({ type: "unconfigured" })).toBe("trends.err.unconfigured");
    expect(trendsErrorMessageKey({ type: "auth" })).toBe("trends.err.auth");
    expect(trendsErrorMessageKey({ type: "network" })).toBe("trends.err.network");
    expect(trendsErrorMessageKey({ type: "rate_limited" })).toBe("trends.err.rateLimited");
    expect(trendsErrorMessageKey({ type: "bad_request" })).toBe("trends.err.upstream");
    expect(trendsErrorMessageKey({ type: "token_expired" })).toBe("trends.err.upstream");
  });
});
