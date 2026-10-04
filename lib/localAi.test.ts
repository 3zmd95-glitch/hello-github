import { afterEach, describe, expect, it, vi } from "vitest";
import {
  highestEffort,
  isLocalAiHost,
  localAiConnection,
  localAiStatus,
  subscriptionError,
  subscriptionPlan,
  type AiSelection,
} from "./localAi";

const selection: AiSelection = {
  provider: "chatgpt",
  model: "test-model",
  effort: "high",
  accountId: "account-a",
};
const request = {
  q: "Coffee match cut tutorials",
  genreQuery: { ar: "قهوة", en: "coffee" },
  program: "DaVinci Resolve",
};
const plan = {
  provider: selection.provider,
  model: selection.model,
  effort: selection.effort,
  plan: { summary: { ar: "قهوة", en: "Coffee" } },
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const host = (hostname: string) => vi.stubGlobal("window", { location: { hostname } });
afterEach(() => vi.unstubAllGlobals());

describe("local AI connection", () => {
  it.each(["localhost", "127.0.0.1"])("allows loopback hostname %s", (hostname) => {
    host(hostname);
    expect(isLocalAiHost()).toBe(true);
  });

  it.each(["3zmd95-glitch.github.io", "localhost.attacker.example", "192.168.1.2"])(
    "does not call local login/status endpoints from %s",
    async (hostname) => {
      host(hostname);
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect(isLocalAiHost()).toBe(false);
      expect(await localAiStatus()).toBeNull();
      expect(await localAiConnection("connect", "chatgpt")).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("is unavailable during server rendering", () => {
    vi.stubGlobal("window", undefined);
    expect(isLocalAiHost()).toBe(false);
  });

  it("reads safe status and sends the anti-CSRF header without secrets", async () => {
    host("localhost");
    const status = {
      available: true,
      providers: {
        chatgpt: {
          connected: true,
          sharing: true,
          accountId: "account-a",
          models: [{ id: "model-a", name: "Model A", efforts: ["high", "max"] }],
        },
        claude: { connected: false, models: [] },
      },
    };
    const fetch = vi.fn(async () => json(status));
    vi.stubGlobal("fetch", fetch);
    expect(await localAiStatus()).toEqual(status);
    expect(fetch).toHaveBeenCalledWith(
      "/api/local-ai/status",
      expect.objectContaining({ cache: "no-store", headers: { "X-Local-AI": "1" } }),
    );
  });

  it.each([
    null,
    { available: true, providers: { chatgpt: {}, claude: {} } },
    {
      available: true,
      providers: {
        chatgpt: { connected: true, models: null },
        claude: { connected: false, models: [] },
      },
    },
    {
      available: true,
      providers: {
        chatgpt: { connected: "yes", models: [] },
        claude: { connected: false, models: [] },
      },
    },
    {
      available: true,
      providers: {
        chatgpt: { connected: true, models: [{ id: "model", name: "Model", efforts: [5] }] },
        claude: { connected: false, models: [] },
      },
    },
    {
      available: true,
      providers: {
        chatgpt: { connected: true, accountId: {}, models: [] },
        claude: { connected: false, models: [] },
      },
    },
  ])("does not pass malformed local status to UI: %j", async (body) => {
    host("localhost");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(body)),
    );
    expect(await localAiStatus()).toBeNull();
  });

  it("handles a missing bridge and explicit connection failures without throwing", async () => {
    host("localhost");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    expect(await localAiStatus()).toBeNull();
    expect(await localAiConnection("connect", "chatgpt")).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "login_failed" }, 503)),
    );
    expect(await localAiConnection("disconnect", "claude")).toBe(false);
  });

  it("posts explicit connection actions with an empty body and CSRF marker", async () => {
    host("localhost");
    const fetch = vi.fn(async () => json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    expect(await localAiConnection("connect", "claude")).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "/api/local-ai/connect/claude",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: { "X-Local-AI": "1", "Content-Type": "application/json" },
      }),
    );
  });
});

describe("subscription planning", () => {
  it("sends only the brief, selected constraints and nonsecret model/account selection", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(plan));
    const input = {
      ...request,
      token: "must-not-leave",
      scoutToken: "must-not-leave",
      platforms: ["ig"],
    };
    expect(await subscriptionPlan(selection, input, fetch)).toEqual({ ok: true, data: plan });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/local-ai/plan");
    expect(JSON.parse(String(init?.body))).toEqual({ ...selection, request });
    expect(new Headers(init?.headers).has("Authorization")).toBe(false);
    expect(String(init?.body)).not.toContain("must-not-leave");
  });

  it.each([
    { ...plan, provider: "claude" },
    { ...plan, model: "lower-model" },
    { ...plan, effort: "low" },
    { ...plan, effort: undefined },
    { ...plan, plan: null },
    { ...plan, plan: [] },
    { ...plan, plan: "not an object" },
  ])("refuses a mismatched or malformed plan with no fallback: %j", async (body) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(body));
    expect(await subscriptionPlan(selection, request, fetch)).toEqual({
      ok: false,
      error: { type: "subscription_failed" },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("handles static-host HTML without pretending a local runtime exists", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response("<!doctype html><html></html>", { headers: { "Content-Type": "text/html" } }),
    );
    expect(await subscriptionPlan(selection, request, fetch)).toEqual({
      ok: false,
      error: { type: "local_ai_unavailable" },
    });
  });

  it("forwards cancellation to local inference", async () => {
    const controller = new AbortController();
    let received: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      received = init?.signal;
      controller.abort();
      throw new Error("cancelled");
    });
    expect(await subscriptionPlan(selection, request, fetch, controller.signal)).toEqual({
      ok: false,
      error: { type: "local_ai_unavailable" },
    });
    expect(received?.aborted).toBe(true);
  });

  it.each([
    ["usage_limit", "subscription_limit"],
    ["quota_exceeded", "subscription_limit"],
    ["usage_unavailable", "subscription_limit"],
    ["login_required", "subscription_auth"],
    ["sharing_disabled", "subscription_auth"],
    ["invalid_token", "subscription_auth"],
    ["account_changed", "subscription_auth"],
    ["model_unavailable", "subscription_model"],
    ["invalid_effort", "subscription_model"],
    ["upstream", "subscription_failed"],
  ])("maps %s to actionable %s without downgrade", async (code, type) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ error: code }, 503));
    expect(subscriptionError(code)).toBe(type);
    expect(await subscriptionPlan(selection, request, fetch)).toEqual({
      ok: false,
      error: { type },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("uses only an available effort and picks the highest one", () => {
    expect(highestEffort(["medium", "high", "max"])).toBe("max");
    expect(highestEffort(["high", "xhigh"])).toBe("xhigh");
    expect(highestEffort(["ultra", "max"])).toBe("ultra");
    expect(highestEffort([])).toBeUndefined();
    expect(highestEffort(["unknown"])).toBeUndefined();
  });
});
