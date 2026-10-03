import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { parseDiscoverBody } from "./routes";

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
});

describe("/discover routes", () => {
  it("needs the token", async () => {
    const res = await handle(post({ q: "flash" }, null), ENV, undefined, { fetch: vi.fn() });
    expect(res.status).toBe(401);
  });

  it("answers 400 to a bad body without spending anything", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const res = await handle(post({ q: "" }), ENV, undefined, { fetch: fetchMock });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request" });
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
  });

  it("serves the usage", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ account: { plan_usage: 5, plan_limit: 1000 } }),
    );
    const res = await handle(req("/discover/usage"), ENV, undefined, { fetch: fetchMock });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tavily: unknown }).tavily).toEqual({ used: 5, limit: 1000 });
  });

  it("tells the dashboard it can search the new way", async () => {
    const res = await handle(req("/health"), ENV, undefined, { fetch: vi.fn() });
    expect(((await res.json()) as { discover?: boolean }).discover).toBe(true);
  });

  it("leaves unknown /discover paths to the 404", async () => {
    const res = await handle(req("/discover/nope"), ENV, undefined, { fetch: vi.fn() });
    expect(res.status).toBe(404);
  });
});
