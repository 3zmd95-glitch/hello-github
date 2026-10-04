import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import {
  AiPlanSchema,
  ExternalAiPlanSchema,
  searchPlanFromAi,
  type ExternalAiPlan,
} from "./ai-plan";
import { labelCards } from "./label";
import { parseDiscoverBody } from "./routes";
import { requestHash, runDiscover } from "./run";
import type { DiscoverRequest } from "./types";

const NOW = new Date("2026-10-04T09:00:00Z");
const PLAN = AiPlanSchema.parse({
  summary: { en: "Coffee match cut tutorials", ar: "شروحات ماتش كت للقهوة" },
  queries: [{ q: "coffee match cut tutorial CapCut", lang: "en", intent: "tutorials" }],
  concepts: [
    ["coffee", "قهوة"],
    ["match cut", "ماتش كت"],
  ],
  platforms: ["ig"],
  timeRange: "month",
  ytLength: "long",
});
const ENVELOPE: ExternalAiPlan = {
  provider: "chatgpt",
  model: "test-model",
  effort: "high",
  plan: PLAN,
};
const REQUEST: DiscoverRequest = { q: "Coffee match cuts", mode: "ai", aiPlan: ENVELOPE };
const APP = "https://3zmd95-glitch.github.io";
function environment() {
  const stored = new Map<string, string>();
  const get = vi.fn(async (key: string) => stored.get(key) ?? null);
  const put = vi.fn(async (key: string, value: string) => {
    stored.set(key, value);
  });
  const ai = vi.fn(async () => {
    throw new Error("The local plan must not call Cloudflare AI");
  });
  const env: Env = {
    SCOUT_TOKEN: "test-owner",
    ALLOWED_ORIGINS: APP,
    TAVILY_API_KEY: "test-tavily",
    SOCIAL_KV: { get, put } as unknown as KVNamespace,
    AI: { run: ai },
  };
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              url: "https://www.instagram.com/reel/coffee123/",
              title: "Coffee match cut tutorial",
              content: "Coffee match cut filmmaking tutorial",
            },
          ],
          usage: { credits: 1 },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
  );
  return { env, stored, get, put, ai, fetch };
}
function post(body: unknown) {
  return new Request("https://scout.example/discover", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-owner",
      Origin: APP,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("subscription AI plans", () => {
  it.each(["chatgpt", "claude"] as const)(
    "accepts a bounded %s plan and still ignores raw queries",
    (provider) => {
      const aiPlan = { ...ENVELOPE, provider };
      expect(
        parseDiscoverBody({ ...REQUEST, aiPlan, queries: [{ q: "untrusted arbitrary query" }] }),
      ).toEqual({ ...REQUEST, aiPlan });
    },
  );

  const invalidPlans: unknown[] = [
    null,
    { ...ENVELOPE, provider: "unknown" },
    { ...ENVELOPE, model: "" },
    { ...ENVELOPE, model: "m".repeat(121) },
    { ...ENVELOPE, model: "model\nsecond line" },
    { ...ENVELOPE, effort: "e".repeat(25) },
    { ...ENVELOPE, effort: "high;do-more" },
    { ...ENVELOPE, token: "must never accept account credentials" },
    { ...ENVELOPE, plan: { ...PLAN, queries: [] } },
    { ...ENVELOPE, plan: { ...PLAN, queries: Array(4).fill(PLAN.queries[0]) } },
    { ...ENVELOPE, plan: { ...PLAN, platforms: ["facebook"] } },
    { ...ENVELOPE, plan: { ...PLAN, concepts: [["!!!"]] } },
    { ...ENVELOPE, plan: { ...PLAN, concepts: [["edit", "video", "مونتاج"]] } },
    { ...ENVELOPE, plan: { ...PLAN, concepts: [["coffee"], []] } },
  ];

  it.each(invalidPlans)(
    "refuses malformed plans before model, quota or search access: %j",
    async (aiPlan) => {
      const e = environment();
      const res = await handle(post({ ...REQUEST, aiPlan }), e.env, undefined, { fetch: e.fetch });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
      expect(e.fetch).not.toHaveBeenCalled();
      expect(e.ai).not.toHaveBeenCalled();
      expect(e.get).not.toHaveBeenCalled();
      expect(e.put).not.toHaveBeenCalled();
    },
  );

  it("requires AI mode and validates internal callers before looking in cache", async () => {
    const e = environment();
    expect(parseDiscoverBody({ q: REQUEST.q, aiPlan: ENVELOPE })).toBeNull();
    await expect(
      runDiscover(e.env, { q: REQUEST.q, aiPlan: ENVELOPE }, { fetch: e.fetch, now: NOW }),
    ).rejects.toThrow("requires AI mode");
    await expect(
      runDiscover(
        e.env,
        { ...REQUEST, aiPlan: invalidPlans[1] as ExternalAiPlan },
        { fetch: e.fetch, now: NOW },
      ),
    ).rejects.toThrow();
    expect(e.get).not.toHaveBeenCalled();
    expect(e.fetch).not.toHaveBeenCalled();
  });

  it("uses the supplied plan without consuming Cloudflare AI and reports its provider and model", async () => {
    const e = environment();
    e.stored.set("discover:ai:2026-10-04", "20");
    const res = await handle(post(REQUEST), e.env, undefined, { fetch: e.fetch, now: () => NOW });
    expect(res.status).toBe(200);
    const answer = await res.json();
    expect(answer).toMatchObject({
      understood: {
        ai: true,
        provider: "chatgpt",
        model: "test-model",
        effort: "high",
        label: PLAN.summary,
      },
      platforms: { ig: { ok: true } },
      cost: { tavily: 1, youtubeSearch: 0 },
      complete: true,
    });
    expect(e.ai).not.toHaveBeenCalled();
    expect(e.stored.get("discover:ai:2026-10-04")).toBe("20");
    expect(e.fetch).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(e.fetch.mock.calls[0][1]?.body));
    expect(sent).toMatchObject({ query: PLAN.queries[0].q, time_range: "month" });
  });

  it("does not share results between providers/models/efforts/plans but repeats cost nothing", async () => {
    const e = environment();
    const first = await runDiscover(e.env, REQUEST, { fetch: e.fetch, now: NOW });
    const again = await runDiscover(e.env, REQUEST, { fetch: e.fetch, now: NOW });
    expect(first.cached).toBe(false);
    expect(again).toMatchObject({ cached: true, cost: { tavily: 0, youtubeSearch: 0 } });
    expect(e.fetch).toHaveBeenCalledTimes(1);
    const alternatives: DiscoverRequest[] = [
      { ...REQUEST, aiPlan: { ...ENVELOPE, provider: "claude" } },
      { ...REQUEST, aiPlan: { ...ENVELOPE, model: "another-model" } },
      { ...REQUEST, aiPlan: { ...ENVELOPE, effort: "medium" } },
      { ...REQUEST, aiPlan: { ...ENVELOPE, plan: { ...PLAN, concepts: [["espresso"]] } } },
      {
        ...REQUEST,
        aiPlan: {
          ...ENVELOPE,
          plan: { ...PLAN, queries: [{ ...PLAN.queries[0], q: "new query" }] },
        },
      },
      { ...REQUEST, aiPlan: undefined },
    ];
    const hashes = await Promise.all([REQUEST, ...alternatives].map(requestHash));
    expect(new Set(hashes).size).toBe(hashes.length);
    const next = await runDiscover(e.env, alternatives[0], { fetch: e.fetch, now: NOW });
    expect(next.cached).toBe(false);
    expect(next.understood.provider).toBe("claude");
    expect(e.fetch).toHaveBeenCalledTimes(2);
  });

  it("enforces selected platforms, date, duration, genre and program regardless of model choices", () => {
    const req: DiscoverRequest = {
      ...REQUEST,
      platforms: ["yt"],
      timeRange: "week",
      ytLength: "short",
      genreQuery: { en: "car edit", ar: "مونتاج سيارات" },
      program: "DaVinci Resolve",
    };
    const plan = searchPlanFromAi(req, PLAN);
    expect(plan).toMatchObject({ timeRange: "week", ytLength: "short" });
    expect(plan.queries).toHaveLength(1);
    expect(plan.queries[0]).toMatchObject({ platform: "yt", intent: "tutorials" });
    expect(plan.queries[0].q).toContain("car edit");
    expect(plan.queries[0].q).toContain("DaVinci Resolve");
    expect(plan.queries[0].q.toLowerCase()).not.toContain("capcut");
    const items = labelCards(
      ["Coffee match cut tutorial", "Car coffee match cut tutorial"].map((title, n) => ({
        card: {
          title,
          snippet: "",
          url: `https://www.youtube.com/watch?v=${n}`,
          platform: "yt" as const,
          handle: "creator",
        },
        query: plan.queries[0],
      })),
      plan,
    );
    expect(items.map((i) => !!i.offTopic)).toEqual([true, false]);
  });

  it("validates concept meaning in pure conversion and reusable schema, including cached model output", () => {
    const malformed = { ...PLAN, concepts: [["edit", "video"]] };
    expect(AiPlanSchema.safeParse(malformed).success).toBe(false);
    expect(ExternalAiPlanSchema.safeParse({ ...ENVELOPE, plan: malformed }).success).toBe(false);
    expect(() => searchPlanFromAi(REQUEST, malformed)).toThrow();
  });
});
