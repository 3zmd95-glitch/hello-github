import { describe, expect, it, vi } from "vitest";
import { CREATOR_DAILY_LIMIT, generateCreatorDraft, type CreatorEnv } from "./ai";
import { handleCreator } from "./routes";
import { CreatorRequestSchema, type CreatorRequest } from "./schema";

const now = new Date("2026-10-04T10:00:00Z");
const request: CreatorRequest = {
  brief: "Show how I light a coffee scene with a window.",
  title: "Window light",
  platform: "tiktok",
  language: "en",
  tone: "educational",
  durationSeconds: 30,
  script: { hook: "", beats: ["", "", ""], cta: "" },
};
const draft = {
  hook: "Try window light for your next coffee shot.",
  beats: ["Position the cup.", "Adjust your angle.", "Show the result."],
  cta: "Try it on your next shoot.",
  caption: "A window-light coffee setup.",
  hashtags: ["#coffee", "#تصوير"],
  shots: [
    { type: "hook", text: "Finished shot" },
    { type: "wide", text: "Window setup" },
    { type: "closeup", text: "Cup details" },
  ],
};
function env() {
  const store = new Map<string, string>();
  return {
    store,
    AI: { run: vi.fn(async () => ({ response: draft })) },
    SOCIAL_KV: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    } as unknown as KVNamespace,
  };
}

describe("creator generation", () => {
  it("validates input, output and cached drafts, without storing the raw brief", async () => {
    const e = env();
    expect(await generateCreatorDraft(e, request, now)).toEqual(draft);
    expect(await generateCreatorDraft(e, request, now)).toEqual(draft);
    expect(e.AI.run).toHaveBeenCalledTimes(1);
    expect(e.store.get("creator:budget:2026-10-04")).toBe("1");
    expect([...e.store.keys()].some((key) => key.includes(request.brief))).toBe(false);
    expect([...e.store.values()].some((value) => value.includes(request.brief))).toBe(false);
    expect(e.AI.run.mock.calls[0]).toBeDefined();
  });
  it("deduplicates simultaneous identical briefs and reserves distinct requests in sequence", async () => {
    const e = env();
    e.store.set("creator:budget:2026-10-04", String(CREATOR_DAILY_LIMIT - 1));
    const results = await Promise.allSettled([
      generateCreatorDraft(e, request, now),
      generateCreatorDraft(e, request, now),
      generateCreatorDraft(e, { ...request, brief: "A different scene" }, now),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "fulfilled", "rejected"]);
    expect(e.AI.run).toHaveBeenCalledTimes(1);
  });
  it("counts failed inference and fails closed for unavailable quota storage", async () => {
    const e = env();
    e.AI.run.mockRejectedValue(new Error("private provider diagnostic"));
    await expect(generateCreatorDraft(e, request, now)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    expect(e.store.get("creator:budget:2026-10-04")).toBe("1");
    const unavailable = env();
    vi.mocked(unavailable.SOCIAL_KV.get).mockRejectedValue(new Error("KV failed"));
    await expect(generateCreatorDraft(unavailable, request, now)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    expect(unavailable.AI.run).not.toHaveBeenCalled();
  });
  it.each(["invalid", "-1", "1.5"])("rejects malformed daily counters %s", async (value) => {
    const e = env();
    e.store.set("creator:budget:2026-10-04", value);
    await expect(generateCreatorDraft(e, request, now)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it.each([
    { ...draft, beats: ["Only one"] },
    { ...draft, hashtags: ["#fake tag"] },
    { ...draft, caption: "Get it from https://invented.example/download" },
    { ...draft, extra: "unexpected" },
  ])("rejects invalid or invented model output %#", async (value) => {
    const e: CreatorEnv = { ...env(), AI: { run: async () => ({ response: value }) } };
    await expect(generateCreatorDraft(e, request, now)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
  });
  it("times out without storing an unvalidated result", async () => {
    const e = env();
    const hanging: CreatorEnv = { ...e, AI: { run: () => new Promise(() => {}) } };
    await expect(generateCreatorDraft(hanging, request, now, 5)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    expect([...e.store.keys()].some((key) => key.startsWith("creator:draft"))).toBe(false);
  });
  it("keeps inference shared after caller timeouts and caches a late validated success", async () => {
    const e = env();
    let complete!: (result: { response: typeof draft }) => void;
    const inference = new Promise<{ response: typeof draft }>((resolve) => {
      complete = resolve;
    });
    e.AI.run.mockImplementationOnce(() => inference);
    const background: Promise<unknown>[] = [];
    const waitUntil = (task: Promise<unknown>) => {
      background.push(task);
    };
    await expect(generateCreatorDraft(e, request, now, 5, waitUntil)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    await expect(generateCreatorDraft(e, request, now, 5, waitUntil)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    expect(e.AI.run).toHaveBeenCalledTimes(1);
    expect(e.store.get("creator:budget:2026-10-04")).toBe("1");
    expect([...e.store.keys()].some((key) => key.startsWith("creator:draft"))).toBe(false);
    complete({ response: draft });
    await Promise.all(background);
    expect(await generateCreatorDraft(e, request, now)).toEqual(draft);
    expect(e.AI.run).toHaveBeenCalledTimes(1);
    expect(e.store.get("creator:budget:2026-10-04")).toBe("1");
  });
  it("releases a timed-out inference only after failure, allowing a later fresh request", async () => {
    const e = env();
    let fail!: (reason: unknown) => void;
    const inference = new Promise<{ response: typeof draft }>((_, reject) => {
      fail = reject;
    });
    e.AI.run.mockImplementationOnce(() => inference);
    const background: Promise<unknown>[] = [];
    await expect(
      generateCreatorDraft(e, request, now, 5, (task) => {
        background.push(task);
      }),
    ).rejects.toMatchObject({ code: "ai_unavailable" });
    fail(new Error("late upstream failure"));
    await Promise.all(background);
    expect(await generateCreatorDraft(e, request, now)).toEqual(draft);
    expect(e.AI.run).toHaveBeenCalledTimes(2);
    expect(e.store.get("creator:budget:2026-10-04")).toBe("2");
  });
  it("keeps language, style and existing script in the cache identity", async () => {
    const e = env();
    await generateCreatorDraft(e, request, now);
    await generateCreatorDraft(e, { ...request, language: "ar" }, now);
    await generateCreatorDraft(e, { ...request, tone: "cinematic" }, now);
    await generateCreatorDraft(
      e,
      { ...request, script: { ...request.script, hook: "Existing hook" } },
      now,
    );
    expect(e.AI.run).toHaveBeenCalledTimes(4);
  });
});

describe("creator route", () => {
  const req = (body: unknown) =>
    new Request("https://worker.test/creator/draft", {
      method: "POST",
      body: JSON.stringify(body),
    });
  it.each([
    { ...request, brief: " " },
    { ...request, durationSeconds: 0 },
    { ...request, durationSeconds: 30.5 },
    { ...request, brief: "x".repeat(1201) },
    { ...request, token: "must-not-reach-AI" },
    { ...request, language: "xx" },
  ])("rejects invalid input before inference %#", async (body) => {
    expect(CreatorRequestSchema.safeParse(body).success).toBe(false);
    const e = env();
    const response = await handleCreator(req(body), e, new Headers());
    expect(response?.status).toBe(400);
    expect(e.AI.run).not.toHaveBeenCalled();
  });
  it("bounds streamed JSON and returns stable errors without provider diagnostics", async () => {
    const e = env();
    const tooLarge = await handleCreator(req({ brief: "x".repeat(40_000) }), e, new Headers());
    expect(tooLarge?.status).toBe(400);
    e.AI.run.mockRejectedValue(new Error("secret-token-diagnostic"));
    const failed = await handleCreator(req(request), e, new Headers(), { now: () => now });
    expect(failed?.status).toBe(503);
    expect(await failed?.json()).toEqual({ error: "ai_unavailable" });
  });
  it("returns no-store JSON and preserves router CORS", async () => {
    const waitUntil = vi.fn();
    const response = await handleCreator(
      req(request),
      env(),
      new Headers({ "Access-Control-Allow-Origin": "https://studio.test" }),
      { now: () => now, waitUntil },
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe("https://studio.test");
    expect(await response?.json()).toEqual({ draft });
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
  });
});
