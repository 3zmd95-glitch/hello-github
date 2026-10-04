import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createChatGptProvider } from "./chatgpt";
import type { LocalAiProvider } from "./types";

const ISSUER = "https://auth.openai.com";
const API = "https://api.openai.com/v1";
const CLIENT = "oaiapp_3z_test";
const SHARING = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const directories: string[] = [];
const providers: LocalAiProvider[] = [];
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  pair = await generateKeyPair("RS256");
  jwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
});
afterEach(async () => {
  for (const provider of providers.splice(0)) await provider.dispose?.();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function stream(events: unknown[], separator = "\n\n") {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}${separator}`).join(""),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
const defaultEvents = () => [
  { type: "response.output_text.delta", delta: '{"queries":["match cut"]}' },
  { type: "response.completed", response: { status: "completed" } },
];

async function harness(
  config: {
    scope?: string;
    nonce?: string;
    subject?: string;
    audience?: string;
    expiry?: number;
    issuer?: string;
    expired?: boolean;
    realProtection?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "3z-chatgpt-test-"));
  directories.push(directory);
  let time = Date.now();
  let authorization: URL | undefined;
  let refreshCount = 0;
  let refreshError: string | undefined;
  let modelError = false;
  let revokeError = false;
  let responseError: Record<string, string> | undefined;
  let events = defaultEvents();
  let catalog: unknown[] = [
    {
      slug: "account-premium",
      display_name: "Premium model",
      visibility: "list",
      supported_reasoning_levels: [{ effort: "high" }, { effort: "max" }, { effort: "ultra" }],
    },
    { slug: "hidden", display_name: "Hidden model", visibility: "hide" },
    { slug: "account-fast", display_name: "Fast model", visibility: "list" },
  ];
  const bodies: Array<{
    url: string;
    body: Record<string, unknown>;
    authorization: string | null;
  }> = [];
  async function idToken(refresh = false) {
    return new SignJWT({
      email: "tester@example.com",
      nonce: config.nonce ?? authorization?.searchParams.get("nonce"),
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(config.issuer ?? ISSUER)
      .setAudience(config.audience ?? CLIENT)
      .setSubject(config.subject ?? "account-user")
      .setIssuedAt(Math.floor(time / 1000))
      .setExpirationTime(Math.floor(time / 1000) + (config.expired && !refresh ? -1 : 3600))
      .sign(pair.privateKey);
  }
  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${ISSUER}/.well-known/openid-configuration`)
      return Response.json({
        issuer: ISSUER,
        jwks_uri: `${ISSUER}/.well-known/jwks.json`,
        revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke`,
      });
    if (url === `${ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    if (url === `${ISSUER}/api/accounts/oauth/token`) {
      const params = new URLSearchParams(String(init?.body));
      const refresh = params.get("grant_type") === "refresh_token";
      if (refresh) {
        refreshCount++;
        if (refreshError) return Response.json({ error: refreshError }, { status: 400 });
      } else {
        expect(params.get("client_id")).toBe(CLIENT);
        expect(params.get("redirect_uri")).toBe(authorization?.searchParams.get("redirect_uri"));
        expect(createHash("sha256").update(params.get("code_verifier")!).digest("base64url")).toBe(
          authorization?.searchParams.get("code_challenge"),
        );
      }
      return Response.json({
        access_token: `access-${refreshCount}`,
        refresh_token: `refresh-${refreshCount}`,
        id_token: await idToken(refresh),
        token_type: "Bearer",
        expires_in: refresh ? 3600 : (config.expiry ?? 3600),
        scope: config.scope ?? SHARING,
      });
    }
    if (url === `${API}/models`) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer access-${refreshCount}`);
      if (modelError)
        return Response.json({ detail: "Temporary routing failure" }, { status: 503 });
      return Response.json({ models: catalog });
    }
    if (url === `${API}/responses`) {
      bodies.push({
        url,
        body: JSON.parse(String(init?.body)),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (responseError) return Response.json({ error: responseError }, { status: 400 });
      return stream(events);
    }
    if (url === `${ISSUER}/api/accounts/oauth/revoke`)
      return new Response(null, { status: revokeError ? 503 : 200 });
    throw new Error("Unexpected test endpoint");
  }) as unknown as typeof fetch;
  // Test encryption deliberately opaque on disk; no real OS/user tokens used.
  const protection = {
    encrypt: async (value: string) => Buffer.from(Buffer.from(value).toString("base64")),
    decrypt: async (value: Buffer) => Buffer.from(value.toString(), "base64").toString(),
  };
  const openBrowser = vi.fn(async (url: string) => {
    authorization = new URL(url);
  });
  const options = {
    fetcher,
    ...(config.realProtection ? {} : { protection }),
    openBrowser,
    now: () => time,
  };
  const provider = createChatGptProvider(directory, options);
  providers.push(provider);
  async function callback(extra: Record<string, string> = {}) {
    if (!authorization) throw new Error("Sign-in did not start");
    const url = new URL(authorization.searchParams.get("redirect_uri")!);
    url.search = new URLSearchParams({
      state: authorization.searchParams.get("state")!,
      code: "test-code",
      client_id: CLIENT,
      ...extra,
    }).toString();
    return fetch(url);
  }
  async function signedIn() {
    await provider.connect();
    await callback();
    const deadline = Date.now() + 20_000;
    for (;;) {
      const status = await provider.status();
      if (!status.connecting) return status;
      if (Date.now() > deadline) throw new Error("Synthetic OAuth did not finish");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return {
    provider,
    directory,
    options,
    fetcher,
    openBrowser,
    callback,
    signedIn,
    bodies,
    authorization: () => authorization!,
    refreshCount: () => refreshCount,
    advance: (milliseconds: number) => {
      time += milliseconds;
    },
    setEvents: (value: typeof events) => {
      events = value;
    },
    setCatalog: (value: unknown[]) => {
      catalog = value;
    },
    setRefreshError: (value: string) => {
      refreshError = value;
    },
    setModelError: () => {
      modelError = true;
    },
    setRevokeError: () => {
      revokeError = true;
    },
    setResponseError: (value: Record<string, string>) => {
      responseError = value;
    },
    plan: (model = "account-premium", effort?: string) =>
      provider.plan({
        model,
        effort,
        instructions: "Return JSON only",
        input: "Find match cut videos",
        schema: { type: "object", properties: {}, additionalProperties: false },
        signal: new AbortController().signal,
      }),
  };
}

describe("ChatGPT plan connection", { timeout: 15_000 }, () => {
  it("starts only on explicit connect and keeps credentials out of status", async () => {
    const h = await harness();
    expect(await h.provider.status()).toMatchObject({
      connected: false,
      sharing: false,
      models: [],
    });
    expect(h.openBrowser).not.toHaveBeenCalled();
    const status = await h.signedIn();
    expect(status).toMatchObject({
      connected: true,
      sharing: true,
      account: "tester@example.com",
      accountId: CLIENT,
    });
    expect(status.models.map((model) => model.id)).toEqual(["account-premium", "account-fast"]);
    expect(status.models[0].efforts).toEqual(["high", "max"]);
    expect(JSON.stringify(status)).not.toMatch(/access-0|refresh-0|idToken/);
    expect(h.authorization().searchParams.get("agent_name_hint")).toBe("3z Prod");
    expect(h.authorization().searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(h.authorization().searchParams.get("scope")).toBe(SHARING);
    expect(await readFile(join(h.directory, "chatgpt", "connection.dat"), "utf8")).not.toContain(
      "access-0",
    );
  });

  it("rejects a forged or multibyte callback state before code exchange", async () => {
    const h = await harness();
    await h.provider.connect();
    expect((await h.callback({ state: "wrong" })).status).toBe(400);
    expect(
      (await h.callback({ state: "é".repeat(h.authorization().searchParams.get("state")!.length) }))
        .status,
    ).toBe(400);
    expect(
      vi.mocked(h.fetcher).mock.calls.some(([url]) => String(url).endsWith("/oauth/token")),
    ).toBe(false);
    expect((await h.provider.status()).connecting).toBe(true);
    await h.callback();
    await vi.waitFor(async () => expect((await h.provider.status()).connected).toBe(true), {
      timeout: 10_000,
    });
  });

  it("coalesces simultaneous Connect clicks into one authorization", async () => {
    const h = await harness();
    await Promise.all([h.provider.connect(), h.provider.connect()]);
    expect(h.openBrowser).toHaveBeenCalledTimes(1);
  });

  it.each([
    { nonce: "wrong-nonce" },
    { audience: "other-client" },
    { issuer: "https://attacker.invalid" },
    { expired: true },
  ])("never connects an invalid ID token (%j)", async (config) => {
    const h = await harness(config);
    const status = await h.signedIn();
    expect(status.connected).toBe(false);
    expect(status.models).toEqual([]);
    expect(status.error).toMatch(/^chatgpt_(invalid_identity|identity_unavailable)$/);
  });

  it("separates identity from plan consent and requests consent when explicitly reconnecting", async () => {
    const h = await harness({ scope: "openid profile email offline_access" });
    expect(await h.signedIn()).toMatchObject({ connected: true, sharing: false, models: [] });
    await expect(h.plan()).rejects.toMatchObject({ code: "chatgpt_sharing_disabled" });
    await h.provider.connect();
    expect(h.authorization().searchParams.get("prompt")).toBe("consent");
    expect(h.authorization().searchParams.get("client_id")).toBe(CLIENT);
  });

  it("retains the host/client registration across disconnect and reconnect", async () => {
    const h = await harness();
    await h.signedIn();
    const host = h.authorization().searchParams.get("ext_agent_host_id");
    const state = h.authorization().searchParams.get("state");
    await h.provider.disconnect();
    expect(await h.provider.status()).toMatchObject({ connected: false, sharing: false });
    await h.provider.connect();
    expect(h.authorization().searchParams.get("client_id")).toBe(CLIENT);
    expect(h.authorization().searchParams.get("ext_agent_host_id")).toBe(host);
    expect(h.authorization().searchParams.get("state")).not.toBe(state);
    expect(h.authorization().searchParams.has("id_token_hint")).toBe(false);
    expect(h.authorization().searchParams.has("agent_name_hint")).toBe(false);
  });

  it("clears local tokens even when remote revocation is unavailable", async () => {
    const h = await harness();
    await h.signedIn();
    h.setRevokeError();
    await h.provider.disconnect();
    expect(await h.provider.status()).toMatchObject({
      connected: false,
      error: "chatgpt_revocation_unconfirmed",
    });
    await expect(h.plan()).rejects.toMatchObject({ code: "chatgpt_sign_in_required" });
  });

  it("rotates once for simultaneous requests and uses the replacement after restart", async () => {
    const h = await harness();
    await h.signedIn();
    h.advance(3_570_000);
    await Promise.all([h.plan(), h.plan()]);
    expect(h.refreshCount()).toBe(1);
    expect(h.bodies.map((entry) => entry.authorization)).toEqual([
      "Bearer access-1",
      "Bearer access-1",
    ]);
    const restarted = createChatGptProvider(h.directory, h.options);
    providers.push(restarted);
    expect(await restarted.status()).toMatchObject({ connected: true, sharing: true });
    expect(h.refreshCount()).toBe(1);
  });

  it.skipIf(process.platform !== "win32")(
    "round-trips synthetic credentials through Windows DPAPI",
    async () => {
      const h = await harness({ realProtection: true });
      expect(await h.signedIn()).toMatchObject({ connected: true, sharing: true });
      const encrypted = await readFile(join(h.directory, "chatgpt", "connection.dat"));
      expect(encrypted.toString()).not.toMatch(/access-0|refresh-0|tester@example/);
      const restarted = createChatGptProvider(h.directory, h.options);
      providers.push(restarted);
      expect(await restarted.status()).toMatchObject({
        connected: true,
        account: "tester@example.com",
      });
    },
    30_000,
  );

  it("clears an unusable refresh token but preserves the client for sign-in", async () => {
    const h = await harness();
    await h.signedIn();
    h.advance(3_570_000);
    h.setRefreshError("invalid_grant");
    await expect(h.plan()).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await h.provider.status()).toMatchObject({ connected: false });
    await h.provider.connect();
    expect(h.authorization().searchParams.get("client_id")).toBe(CLIENT);
  });

  it("keeps credentials during temporary model routing errors", async () => {
    const h = await harness();
    await h.signedIn();
    h.advance(61_000);
    h.setModelError();
    expect(await h.provider.status()).toMatchObject({
      connected: true,
      sharing: true,
      models: [],
      error: "chatgpt_request_failed",
    });
  });
});

describe("ChatGPT structured search plans", { timeout: 15_000 }, () => {
  it("uses only account-listed models and supported efforts with subscription-safe fields", async () => {
    const h = await harness();
    await h.signedIn();
    await expect(h.plan("invented-best-model")).rejects.toMatchObject({
      code: "chatgpt_model_unavailable",
    });
    await expect(h.plan("account-fast", "ultra")).rejects.toMatchObject({
      code: "chatgpt_effort_unavailable",
    });
    expect(await h.plan("account-premium", "max")).toEqual({
      model: "account-premium",
      text: '{"queries":["match cut"]}',
    });
    expect(h.bodies[0].body).toMatchObject({
      model: "account-premium",
      store: false,
      stream: true,
      input: [{ role: "user", content: "Find match cut videos" }],
      reasoning: { effort: "max" },
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(h.bodies[0].body).not.toHaveProperty("max_output_tokens");
    expect(h.bodies[0].body).not.toHaveProperty("temperature");
    expect(h.bodies[0].url).toBe(`${API}/responses`);
  });

  it.each(["supported_reasoning_levels", "supported_reasoning_efforts"])(
    "filters catalog-only efforts from %s and rejects them before inference",
    async (field) => {
      const h = await harness();
      const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
      h.setCatalog([
        {
          slug: "gpt-6-astra",
          display_name: "GPT-6 Astra",
          visibility: "list",
          [field]:
            field === "supported_reasoning_levels"
              ? efforts.map((effort) => ({ effort }))
              : efforts,
        },
      ]);
      const status = await h.signedIn();
      expect(status.models[0].efforts).toEqual(efforts.slice(0, -1));
      await expect(h.plan("gpt-6-astra", "ultra")).rejects.toMatchObject({
        code: "chatgpt_effort_unavailable",
      });
      expect(h.bodies).toHaveLength(0);
      await h.plan("gpt-6-astra", "max");
      expect(h.bodies).toHaveLength(1);
      expect(h.bodies[0].body).toMatchObject({
        model: "gpt-6-astra",
        reasoning: { effort: "max" },
      });
    },
  );

  it.each([
    ["reasoning.effort", "chatgpt_effort_unavailable"],
    ["text.format", "chatgpt_request_failed"],
  ])(
    "classifies invalid_value for %s without leaking error text or retrying",
    async (param, code) => {
      const h = await harness();
      await h.signedIn();
      h.setResponseError({
        type: "invalid_request_error",
        code: "invalid_value",
        param,
        message: "Sensitive diagnostic text must not reach the browser",
      });
      await expect(h.plan("account-premium", "max")).rejects.toMatchObject({ code, message: code });
      expect(h.bodies).toHaveLength(1);
    },
  );

  it.each([
    [{ type: "response.output_text.delta", delta: '{"ok":true}' }],
    [{ type: "response.output_text.delta", delta: '{"ok":true}' }, { type: "response.incomplete" }],
    [
      { type: "response.output_text.delta", delta: "not json" },
      { type: "response.completed", response: { status: "completed" } },
    ],
  ])("rejects partial, incomplete, or invalid JSON output", async (...events) => {
    const h = await harness();
    await h.signedIn();
    h.setEvents(events as ReturnType<typeof defaultEvents>);
    await expect(h.plan()).rejects.toMatchObject({
      code: expect.stringMatching(/^chatgpt_(incomplete|invalid)_response$/),
    });
  });

  it("does not accept partial text when a usage-limit failure arrives later", async () => {
    const h = await harness();
    await h.signedIn();
    h.setEvents([
      { type: "response.output_text.delta", delta: '{"ok":true}' },
      {
        type: "response.failed",
        response: { error: { code: "subscription_sharing_usage_limit_exceeded" } },
      },
    ] as unknown as ReturnType<typeof defaultEvents>);
    await expect(h.plan()).rejects.toMatchObject({
      code: "subscription_sharing_usage_limit_exceeded",
    });
    expect(h.bodies).toHaveLength(1);
  });

  it("rejects a different model reported in the completed response", async () => {
    const h = await harness();
    await h.signedIn();
    h.setEvents([
      { type: "response.output_text.delta", delta: '{"ok":true}' },
      {
        type: "response.completed",
        response: { status: "completed", model: "unexpected-fallback" },
      },
    ] as unknown as ReturnType<typeof defaultEvents>);
    await expect(h.plan()).rejects.toMatchObject({ code: "chatgpt_model_mismatch" });
  });
});
