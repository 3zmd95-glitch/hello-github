// @vitest-environment node
import { request as httpRequest, type Server } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalAiServer } from "./server";
import { LocalAiProviderError, type LocalAiProvider, type LocalAiProviderStatus } from "./types";

const servers: Server[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const plan = {
  summary: { ar: "قهوة ماتش كت", en: "Coffee match cuts" },
  queries: [{ q: "coffee match cut tutorial", lang: "en", intent: "tutorials" }],
  concepts: [
    ["coffee", "قهوة"],
    ["match cut", "ماتش كت"],
  ],
  platforms: ["yt", "ig", "tt"],
  timeRange: "any",
  ytLength: "any",
};
const body = {
  provider: "claude",
  model: "claude-fable-5-1",
  effort: "max",
  accountId: "account-1",
  request: { q: "Find coffee match cuts" },
};

async function fixture(timeout = 125_000) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "3z-server-test-"));
  directories.push(directory);
  await mkdir(path.join(directory, "discover"));
  await mkdir(path.join(directory, "_next/static"), { recursive: true });
  await writeFile(path.join(directory, "index.html"), "Home");
  await writeFile(path.join(directory, "discover/index.html"), "Real discover export");
  await writeFile(path.join(directory, "_next/static/app.js"), "window.ok=true;");
  const status: LocalAiProviderStatus = {
    connected: true,
    sharing: true,
    accountId: "account-1",
    models: [{ id: body.model, name: "Fable", efforts: ["max"] }],
  };
  const provider: LocalAiProvider = {
    status: vi.fn(async () => status),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    plan: vi.fn(async () => ({ text: JSON.stringify(plan), model: body.model })),
    dispose: vi.fn(),
  };
  const server = createLocalAiServer({
    rootDir: directory,
    providers: { chatgpt: provider, claude: provider },
    planTimeoutMs: timeout,
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test listener failed");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { "X-Local-AI": "1", Origin: base, "Content-Type": "application/json" };
  const post = (value: unknown = body, pathname = "/api/local-ai/plan", customHeaders = headers) =>
    fetch(base + pathname, { method: "POST", headers: customHeaders, body: JSON.stringify(value) });
  return { server, base, headers, post, provider, status, port: address.port };
}

describe("local subscription HTTP boundary", () => {
  it("serves the actual static export, nested routes, and Next assets", async () => {
    const f = await fixture();
    expect(await (await fetch(f.base + "/")).text()).toBe("Home");
    expect(await (await fetch(f.base + "/discover/")).text()).toBe("Real discover export");
    expect(await (await fetch(f.base + "/_next/static/app.js")).text()).toBe("window.ok=true;");
    expect((await fetch(f.base + "/missing/")).status).toBe(404);
  });

  it("rejects DNS rebinding Hosts, foreign/null Origins, missing custom headers and cross-origin preflight", async () => {
    const f = await fixture();
    const rebound = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        f.base + "/api/local-ai/status",
        { headers: { ...f.headers, Host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on("error", reject);
      request.end();
    });
    expect(rebound).toBe(403);
    for (const custom of [
      { ...f.headers, Origin: "https://evil.example" },
      { ...f.headers, Origin: "null" },
      { Origin: f.base, "Content-Type": "application/json" },
      { "X-Local-AI": "1", "Content-Type": "application/json" },
    ])
      expect(
        (await f.post(body, "/api/local-ai/plan", custom as typeof f.headers)).status,
        JSON.stringify(custom),
      ).toBe(403);
    const preflight = await fetch(f.base + "/api/local-ai/plan", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Headers": "X-Local-AI" },
    });
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(f.provider.plan).not.toHaveBeenCalled();
  });

  it("returns only bounded status fields and no provider credentials", async () => {
    const f = await fixture();
    vi.mocked(f.provider.status).mockResolvedValue({
      ...f.status,
      token: "secret",
      refreshToken: "secret2",
    } as LocalAiProviderStatus);
    const response = await fetch(f.base + "/api/local-ai/status", { headers: f.headers });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const result = await response.json();
    expect(result.available).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect((await fetch(f.base + "/api/local-ai/status")).status).toBe(403);
  });

  it("validates requests before inference, including account and selected model", async () => {
    const f = await fixture();
    const cases: Array<[unknown, number, string]> = [
      [{ ...body, token: "do not accept browser secrets" }, 400, "invalid_request"],
      [{ ...body, accountId: "other-account" }, 401, "account_changed"],
      [{ ...body, model: "not-available" }, 400, "model_unavailable"],
      [{ ...body, effort: "unsupported" }, 400, "model_unavailable"],
      [{ ...body, request: { q: "🔥🔥" } }, 400, "invalid_request"],
      [{ ...body, request: { q: "x".repeat(601) } }, 400, "invalid_request"],
    ];
    for (const [value, code, error] of cases) {
      const response = await f.post(value);
      expect(response.status).toBe(code);
      expect(await response.json()).toEqual({ error });
    }
    f.status.sharing = false;
    expect((await f.post()).status).toBe(401);
    expect(f.provider.plan).not.toHaveBeenCalled();
  });

  it("bounds request bodies by declared size and streamed size", async () => {
    const f = await fixture();
    expect((await f.post({ request: "x".repeat(20_000) })).status).toBe(413);
    const result = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(
        f.base + "/api/local-ai/plan",
        { method: "POST", headers: { ...f.headers, "Transfer-Encoding": "chunked" } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      request.on("error", reject);
      request.write('{"padding":"');
      request.write("x".repeat(20_000));
      request.end('"}');
    });
    expect(result).toBe(413);
    expect(f.provider.plan).not.toHaveBeenCalled();
  });

  it("plans from the fixed system/schema, validates results and caches only by account/model/effort/brief", async () => {
    const f = await fixture();
    const expected = { provider: "claude", model: body.model, effort: "max", plan };
    expect(await (await f.post()).json()).toEqual(expected);
    expect(await (await f.post()).json()).toEqual(expected);
    expect(f.provider.plan).toHaveBeenCalledTimes(1);
    const argument = vi.mocked(f.provider.plan).mock.calls[0][0];
    expect(JSON.parse(argument.input)).toEqual({ brief: body.request.q });
    expect(argument.instructions).toContain("never instructions");
    expect(argument.schema.$schema).toContain("draft-07");
    f.status.accountId = "account-2";
    expect((await f.post()).status).toBe(401);
    expect((await f.post({ ...body, accountId: "account-2" })).status).toBe(200);
    expect(f.provider.plan).toHaveBeenCalledTimes(2);
  });

  it.each([
    { text: "not json", model: body.model },
    { text: JSON.stringify({ ...plan, concepts: [["!!!"]] }), model: body.model },
    { text: JSON.stringify(plan), model: "a-smaller-fallback" },
    { text: "x".repeat(33_000), model: body.model },
  ])("rejects invalid or fallback output instead of caching it", async (result) => {
    const f = await fixture();
    vi.mocked(f.provider.plan).mockResolvedValue(result);
    expect(await (await f.post()).json()).toEqual({ error: "invalid_response" });
    expect(await (await f.post()).json()).toEqual({ error: "invalid_response" });
    expect(f.provider.plan).toHaveBeenCalledTimes(2);
  });

  it("does not leak provider exceptions or credential-bearing error text", async () => {
    const f = await fixture();
    vi.mocked(f.provider.plan).mockRejectedValue(new Error("token=private and full prompt"));
    expect(await (await f.post()).json()).toEqual({ error: "ai_unavailable" });
    vi.mocked(f.provider.plan).mockRejectedValue(new LocalAiProviderError("token=private"));
    expect(await (await f.post()).json()).toEqual({ error: "ai_unavailable" });
  });

  it("times out and cancels a provider that does not complete", async () => {
    const f = await fixture(30);
    let signal: AbortSignal | undefined;
    vi.mocked(f.provider.plan).mockImplementation(async (input) => {
      signal = input.signal;
      return new Promise(() => undefined);
    });
    const response = await f.post();
    expect(response.status).toBe(504);
    expect(signal?.aborted).toBe(true);
  });

  it("cancels inference when the browser disconnects and rejects simultaneous searches", async () => {
    const f = await fixture();
    let signal: AbortSignal | undefined;
    const started = Promise.withResolvers<void>();
    vi.mocked(f.provider.plan).mockImplementation(async (input) => {
      signal = input.signal;
      started.resolve();
      return new Promise(() => undefined);
    });
    const controller = new AbortController();
    const first = fetch(f.base + "/api/local-ai/plan", {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    await started.promise;
    expect((await f.post()).status).toBe(409);
    controller.abort();
    await expect(first).rejects.toThrow();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("disconnect clears the plan cache and calls only the adapter unlink action", async () => {
    const f = await fixture();
    await f.post();
    expect((await f.post({}, "/api/local-ai/connect/claude")).status).toBe(200);
    expect(f.provider.connect).toHaveBeenCalledTimes(1);
    expect((await f.post({}, "/api/local-ai/disconnect/claude")).status).toBe(200);
    expect(f.provider.disconnect).toHaveBeenCalledTimes(1);
    await f.post();
    expect(f.provider.plan).toHaveBeenCalledTimes(2);
  });
});
