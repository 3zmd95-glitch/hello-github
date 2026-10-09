import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { savePicks } from "./picks";
import { parseDiscoverBody } from "./routes";
import { usageKeys } from "./usage";

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const ENV: Env = { SCOUT_TOKEN: TOKEN, ALLOWED_ORIGINS: APP, TAVILY_API_KEY: "k" };

const req = (path: string, init: RequestInit & { token?: string | null } = {}) => {
  const { token = TOKEN, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Origin", APP);
  return new Request(`${BASE}${path}`, { ...rest, headers });
};
const post = (body: unknown, token: string | null = TOKEN) =>
  req("/discover", {
    method: "POST",
    token,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("parseDiscoverBody", () => {
  it("normalizes a good request", () => {
    expect(
      parseDiscoverBody({
        q: " flash ",
        term: "camera-flash",
        genreQuery: { en: "car edit" },
        platforms: ["tt", "tt", "yt"],
      }),
    ).toEqual({
      q: "flash",
      term: "camera-flash",
      genreQuery: { en: "car edit" },
      platforms: ["tt", "yt"],
    });
  });

  it("measures text once trimmed, and drops a genre without words", () => {
    const program = "p".repeat(60);
    expect(parseDiscoverBody({ q: "flash", program: `  ${program}  ` })).toEqual({
      q: "flash",
      program,
    });
    expect(parseDiscoverBody({ q: "flash", genreQuery: {} })).toEqual({ q: "flash" });
  });

  it("refuses bad fields", () => {
    for (const bad of [
      null,
      {},
      { q: "" },
      { q: "x".repeat(201) },
      // Nothing left to search once symbols and emoji are dropped.
      { q: "🔥🔥" },
      { q: "!!!" },
      { q: "x", exact: "yes" },
      { q: "x", term: "Bad Id" },
      { q: "x", timeRange: "day" },
      { q: "x", ytLength: "medium" },
      { q: "x", platforms: [] },
      { q: "x", platforms: ["fb"] },
      { q: "x", genreQuery: "car" },
      { q: "x", genreQuery: { ar: " " } },
    ]) {
      expect(parseDiscoverBody(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("takes the search's language and a trend chip's editing flag", () => {
    expect(parseDiscoverBody({ q: "Glow Effect", lang: "en", editing: true })).toEqual({
      q: "Glow Effect",
      lang: "en",
      editing: true,
    });
    expect(parseDiscoverBody({ q: "flash", lang: "ar", editing: false })).toEqual({
      q: "flash",
      lang: "ar",
    });
    for (const bad of [
      { q: "x", lang: "fr" },
      { q: "x", editing: "yes" },
      // A trend chip's search is a keyword search.
      { q: "x", mode: "ai", editing: true },
    ])
      expect(parseDiscoverBody(bad), JSON.stringify(bad)).toBeNull();
  });

  it("never takes Claude's own queries from an HTTP body (the connector only)", () => {
    expect(
      parseDiscoverBody({
        q: "flash",
        queries: [{ q: "flash velocity", platform: "tt", lang: "en", intent: "examples" }],
      }),
    ).toStrictEqual({ q: "flash" });
  });
});

describe("/discover routes", () => {
  it("needs the token", async () => {
    const res = await handle(post({ q: "flash" }, null), ENV, undefined, { fetch: vi.fn() });
    expect(res.status).toBe(401);
  });

  it("answers 400 to a bad body without spending anything", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const notJson = req("/discover", {
      method: "POST",
      body: "{q:",
      headers: { "Content-Type": "application/json" },
    });
    for (const bad of [post({ q: "" }), notJson]) {
      const res = await handle(bad, ENV, undefined, { fetch: fetchMock });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a search with CORS for the dashboard", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ results: [], usage: { credits: 1 } }));
    const res = await handle(post({ q: "flash", platforms: ["tt"] }), ENV, undefined, {
      fetch: fetchMock,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(APP);
    const body = (await res.json()) as { topicKey: string; platforms: unknown };
    expect(body.topicKey).toBe("flash-transition");
    // Every TikTok query came back empty, so two of them were asked again (retries) — still an answer.
    expect(body.platforms).toEqual({ tt: { ok: true, retried: true } });
    // The two English queries and the two retries a search may spend, no more.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("serves the usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ account: { plan_usage: 5, plan_limit: 1000 } }),
    );
    const res = await handle(req("/discover/usage"), ENV, undefined, { fetch: fetchMock });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tavily: unknown }).tavily).toEqual({
      used: 5,
      limit: 1000,
      observedAt: expect.any(String),
      cached: false,
    });
  });

  it("refreshes real provider usage after an attempt without making a search or raising limits", async () => {
    const store = new Map<string, string>([
      [usageKeys.tavily, JSON.stringify({ used: 947, limit: 1000 })],
    ]);
    const SOCIAL_KV = {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    } as unknown as KVNamespace;
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ account: { plan_usage: 996, plan_limit: 1000 } }),
    );
    const env = { ...ENV, SOCIAL_KV };
    const passive = await handle(req("/discover/usage"), env, undefined, { fetch: fetchMock });
    expect(((await passive.json()) as { tavily: unknown }).tavily).toEqual({
      used: 947,
      limit: 1000,
      cached: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    const refreshed = await handle(req("/discover/usage?refresh=1"), env, undefined, {
      fetch: fetchMock,
    });
    const usage = ((await refreshed.json()) as { tavily: unknown }).tavily;
    expect(usage).toEqual({
      used: 996,
      limit: 1000,
      observedAt: expect.any(String),
      cached: false,
    });
    expect(refreshed.headers.get("Cache-Control")).toBe("no-store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.tavily.com/usage");
    expect(fetchMock.mock.calls[0][1]?.method ?? "GET").toBe("GET");
    const after = await handle(req("/discover/usage"), env, undefined, { fetch: fetchMock });
    expect(((await after.json()) as { tavily: unknown }).tavily).toEqual({
      ...(usage as object),
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const denied = await handle(req("/discover/usage?refresh=1", { token: null }), env, undefined, {
      fetch: fetchMock,
    });
    expect(denied.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves Claude's picks for the topic asked", async () => {
    const store = new Map<string, string>();
    const SOCIAL_KV = {
      async get(key: string) {
        return store.get(key) ?? null;
      },
      async put(key: string, value: string) {
        store.set(key, value);
      },
    } as unknown as KVNamespace;
    const at = new Date("2026-10-03T09:00:00Z");
    const pick = (n: number) => [
      { url: `https://www.tiktok.com/@a/video/${n}`, title: `t${n}`, label: "example" as const },
    ];
    await savePicks({ SOCIAL_KV }, "flash", pick(1), false, at);
    await savePicks({ SOCIAL_KV }, "speed ramp", pick(2), false, at);
    const res = await handle(req("/discover/picks?topic=flash"), { ...ENV, SOCIAL_KV }, undefined, {
      fetch: vi.fn(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { picks: { topicKey: string }[] };
    expect(body.picks.map((t) => t.topicKey)).toEqual(["flash-transition"]);
  });

  it("tells the dashboard it can search the new way", async () => {
    const res = await handle(req("/health"), ENV, undefined, { fetch: vi.fn() });
    expect(await res.json()).toMatchObject({ discover: true, discoverSubscriptions: true });
  });

  it("only advertises subscription planning to authenticated enabled dashboards", async () => {
    const open = await handle(req("/health", { token: null }), ENV);
    expect(await open.json()).toEqual({ ok: true });
    const disabled = await handle(req("/health"), { ...ENV, DISCOVER_V2: "off" });
    expect(await disabled.json()).toMatchObject({ discover: false, discoverSubscriptions: false });
  });

  it("leaves unknown /discover paths and methods to the 404", async () => {
    for (const r of [req("/discover/nope"), req("/discover")]) {
      const res = await handle(r, ENV, undefined, { fetch: vi.fn() });
      expect(res.status, `${r.method} ${new URL(r.url).pathname}`).toBe(404);
    }
  });
});
