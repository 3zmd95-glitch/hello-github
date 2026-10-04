import { describe, expect, it, vi } from "vitest";
import { AI_MODEL, planWithAi } from "./ai";
import type { FetchEnv } from "./fetchers";
import { labelCards } from "./label";
import { parseDiscoverBody } from "./routes";
import { requestHash, runDiscover } from "./run";

const NOW = new Date("2026-10-04T09:00:00Z");
const brief = { q: "Show coffee match cut examples", mode: "ai" as const };
const response = {
  summary: { en: "Coffee match cut examples", ar: "أمثلة ماتش كت للقهوة" },
  queries: [
    { q: "coffee match cut commercial", lang: "en", intent: "examples" },
    { q: "قهوة ماتش كت", lang: "ar", intent: "examples" },
  ],
  concepts: [
    ["coffee", "espresso", "قهوة"],
    ["match cut", "matchcut", "ماتش كت"],
  ],
  platforms: ["tt", "ig", "yt"],
  timeRange: "any",
  ytLength: "any",
};
function env() {
  const store = new Map<string, string>();
  return {
    store,
    AI: { run: vi.fn(async () => ({ response })) },
    SOCIAL_KV: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    } as unknown as KVNamespace,
  };
}

describe("AI content search", () => {
  it("plans real-provider queries and requires every core concept", async () => {
    const e = env();
    const plan = await planWithAi(e, brief, "coffee", NOW);
    expect(e.AI.run).toHaveBeenCalledWith(AI_MODEL, expect.objectContaining({ max_tokens: 900 }));
    expect(plan.understood).toMatchObject({ ai: true, label: response.summary });
    expect(plan.queries).toHaveLength(6);
    expect(plan.queries.every((q) => q.intent === "examples")).toBe(true);
    const items = labelCards(
      ["Coffee match cut", "Football match cut", "Espresso b-roll", "قهوة ماتش كت"].map(
        (title, i) => ({
          card: {
            title,
            snippet: "",
            url: `https://www.instagram.com/reel/test${i}/`,
            platform: "ig" as const,
            handle: "@test",
          },
          query: plan.queries[0],
        }),
      ),
      plan,
    );
    expect(items.map((i) => !!i.offTopic)).toEqual([false, true, true, false]);
  });

  it("reuses a validated plan without spending another AI call", async () => {
    const e = env();
    await planWithAi(e, brief, "cache", NOW);
    await planWithAi(e, brief, "cache", NOW);
    expect(e.AI.run).toHaveBeenCalledTimes(1);
    expect(e.store.get("discover:ai:2026-10-04")).toBe("1");
  });

  it("deduplicates simultaneous requests in one instance", async () => {
    const e = env();
    await Promise.all([
      planWithAi(e, brief, "concurrent", NOW),
      planWithAi(e, brief, "concurrent", NOW),
    ]);
    expect(e.AI.run).toHaveBeenCalledTimes(1);
  });

  it("stops at the daily cap before calling AI or search providers", async () => {
    const e = env();
    e.store.set("discover:ai:2026-10-04", "20");
    const fetch = vi.fn();
    await expect(runDiscover(e, brief, { fetch, now: NOW })).rejects.toMatchObject({
      code: "ai_limit",
    });
    expect(e.AI.run).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails clearly without a binding; never silently runs keyword search", async () => {
    await expect(planWithAi({}, brief, "none", NOW)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
  });

  it.each([
    null,
    {},
    { response: "not JSON" },
    { response: { ...response, concepts: [["!!!"]] } },
    { response: { ...response, concepts: [["edit", "video", "مونتاج"]] } },
    { response: { ...response, queries: [] } },
  ])("rejects invalid model output %j", async (value) => {
    const e: FetchEnv = { ...env(), AI: { run: async () => value } };
    await expect(planWithAi(e, brief, `bad-${JSON.stringify(value)}`, NOW)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
  });

  it("times out slow inference without calling providers", async () => {
    const e: FetchEnv = { ...env(), AI: { run: () => new Promise(() => {}) } };
    await expect(planWithAi(e, brief, "timeout", NOW, 5)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
  });

  it("preserves explicit filters over inferred ones", async () => {
    const e = env();
    const plan = await planWithAi(
      e,
      { ...brief, platforms: ["yt"], timeRange: "week", ytLength: "short" },
      "filters",
      NOW,
    );
    expect(plan.queries.every((q) => q.platform === "yt")).toBe(true);
    expect(plan).toMatchObject({ timeRange: "week", ytLength: "short" });
  });

  it("validates mode and brief length without exposing connector queries", () => {
    expect(
      parseDiscoverBody({ q: "coffee ".repeat(60), mode: "ai", queries: [{ q: "injected" }] }),
    ).toEqual({ q: "coffee ".repeat(60).trim(), mode: "ai" });
    expect(parseDiscoverBody({ q: "coffee ".repeat(90), mode: "ai" })).toBeNull();
    expect(parseDiscoverBody({ ...brief, mode: "anything" })).toBeNull();
    expect(parseDiscoverBody({ ...brief, exact: true })).toBeNull();
    expect(parseDiscoverBody({ ...brief, term: "flash" })).toBeNull();
  });

  it("keeps AI and keyword answers in separate cache entries", async () => {
    expect(await requestHash(brief)).not.toBe(await requestHash({ q: brief.q }));
  });
});
