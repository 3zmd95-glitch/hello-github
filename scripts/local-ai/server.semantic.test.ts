// @vitest-environment node
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalAiServer, type LocalAiServerOptions } from "./server";
import type { LocalAiProvider, LocalAiProviderStatus } from "./types";
import { DiscoverSemanticResponseSchema } from "../../lib/discoverSemantic";

const servers: Server[] = [];
// Match the Fetch bad-port table used by server.test.ts; valid low ephemeral ports are allowed.
const FETCH_BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465,
  512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993,
  995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668,
  6669, 6679, 6697, 10080,
]);
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
const tt = "https://www.tiktok.com/@creator/video/7677300576404770069";
const ig = "https://www.instagram.com/p/EXAMPLE/";
const second = "https://www.tiktok.com/@creator/video/7490121492424903958";
const input = {
  provider: "chatgpt",
  model: "selected-model",
  effort: "low",
  accountId: "account-1",
  genreId: "travel",
  urls: [tt],
  lang: "en",
};
const caption = "Cinematic frames from Nice #France #filmmaking";
const judgment = {
  category: "supported",
  categoryQuote: "frames from Nice #France",
  project: "described",
  projectQuote: "Cinematic frames from Nice",
  reason: "The source caption describes a creative destination film, without verifying footage.",
};
const page = (url = tt, text = caption, author = "creator") =>
  new Response(
    `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": {
          statusCode: 0,
          itemInfo: {
            itemStruct: {
              id: url.split("/").at(-1),
              desc: text,
              author: { uniqueId: author },
              stats: { diggCount: 27600, playCount: 131800 },
              createTime: 1755900000,
            },
          },
        },
      },
    })}</script>`,
    { headers: { "content-type": "text/html" } },
  );
const instagram = () =>
  new Response(
    `<html><body><div class="Embed"><a class="Username" href="https://www.instagram.com/creator/">creator</a><a class="EmbeddedMedia" href="https://www.instagram.com/reel/EXAMPLE/"><img class="EmbeddedMediaImage" src="https://scontent.cdninstagram.com/post.jpg"></a><div class="Caption">${caption}</div><a class="SocialProof" href="https://www.instagram.com/p/EXAMPLE/">27600 likes</a></div></body></html>`,
    { headers: { "content-type": "text/html" } },
  );

async function fixture(extra: Partial<LocalAiServerOptions> = {}) {
  const status: LocalAiProviderStatus = {
    connected: true,
    sharing: true,
    accountId: "account-1",
    models: [{ id: input.model, name: "Selected", efforts: ["low", "high"] }],
  };
  const provider: LocalAiProvider = {
    status: vi.fn(async () => status),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    plan: vi.fn(async (request) => ({
      model: request.model,
      text: JSON.stringify({
        assessments: JSON.parse(request.input).sources.map((_: unknown, index: number) => ({
          index,
          assessment: judgment,
        })),
      }),
    })),
  };
  const sourceFetch = vi.fn<typeof fetch>(async (url) =>
    String(url).includes("instagram.com") ? instagram() : page(String(url)),
  );
  const extractFrames = vi.fn();
  const server = createLocalAiServer({
    rootDir: process.cwd(),
    providers: { chatgpt: provider, claude: provider },
    sourceFetch,
    extractFrames,
    ...extra,
  });
  servers.push(server);
  // Windows can allocate a Fetch-blocked port. Retry those specific ports only.
  for (let attempt = 0; attempt < 8; attempt++) {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address && typeof address !== "string" && !FETCH_BLOCKED_PORTS.has(address.port)) break;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test listener");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Origin: base, "X-Local-AI": "1", "Content-Type": "application/json" };
  const ask = (value: unknown = input, signal?: AbortSignal) =>
    fetch(base + "/api/local-ai/assess-caption", {
      method: "POST",
      headers,
      body: JSON.stringify(value),
      signal,
    });
  return { ask, base, headers, provider, status, sourceFetch, extractFrames };
}

describe("bounded caption semantic route", () => {
  it("uses authentic TT/IG captions in one text-only call and returns source-bound records", async () => {
    const f = await fixture();
    const result = await (await f.ask({ ...input, urls: [tt, ig, second], lang: "ar" })).json();
    expect(DiscoverSemanticResponseSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({
      status: "assessed",
      cached: false,
      modelCalls: 1,
      selection: { provider: "chatgpt", model: input.model, effort: "low", accountId: "account-1" },
    });
    expect(result.semantics.map((record: { url: string }) => record.url)).toEqual([tt, ig, second]);
    expect(result.semantics[0]).toMatchObject({
      version: 1,
      genreId: "travel",
      model: input.model,
      source: { caption, author: "creator", provenance: "tiktok-public-page" },
      assessment: judgment,
    });
    expect(result.semantics[1].source.provenance).toBe("instagram-public-embed");
    expect(f.provider.plan).toHaveBeenCalledOnce();
    const request = vi.mocked(f.provider.plan).mock.calls[0][0];
    expect(request.images).toBeUndefined();
    expect(request.schemaName).toBe("discover_caption_semantics");
    expect(JSON.parse(request.input)).toMatchObject({
      outputLanguage: "Arabic",
      sources: [0, 1, 2].map((index) => ({ index, caption, author: "creator" })),
    });
    expect(request.input).not.toContain("27600");
    expect(request.input).not.toContain("createTime");
    expect(f.extractFrames).not.toHaveBeenCalled();
  });

  it("rejects untrusted request fields, noncanonical URLs, unknown categories and over-budget batches before I/O", async () => {
    const f = await fixture();
    for (const patch of [
      { caption: "claimed caption" },
      { source: { caption } },
      { urls: [] },
      { urls: [tt, tt] },
      { urls: [tt, ig, second, tt] },
      { urls: ["https://attacker.test/"] },
      { urls: [tt + "?x=1"] },
      { genreId: "unknown" },
      { provider: "claude" },
    ])
      expect((await f.ask({ ...input, ...patch })).status).toBe(400);
    expect(f.sourceFetch).not.toHaveBeenCalled();
    expect(f.provider.plan).not.toHaveBeenCalled();
  });

  it("requires current sharing, account, model and effort authorization", async () => {
    const f = await fixture();
    for (const [patch, error] of [
      [{ accountId: "other" }, "account_changed"],
      [{ model: "other" }, "model_unavailable"],
      [{ effort: "max" }, "model_unavailable"],
    ] as const)
      expect(await (await f.ask({ ...input, ...patch })).json()).toEqual({ error });
    f.status.sharing = false;
    expect(await (await f.ask()).json()).toEqual({ error: "not_connected" });
    expect(f.sourceFetch).not.toHaveBeenCalled();
    expect(f.provider.plan).not.toHaveBeenCalled();
  });

  it("reuses exact cached records without renewing checkedAt and only assesses missing batch members", async () => {
    const f = await fixture();
    const first = await (await f.ask()).json();
    const cached = await (await f.ask({ ...input, allowModel: false })).json();
    expect(cached).toEqual({ ...first, cached: true, modelCalls: 0 });
    expect(f.provider.plan).toHaveBeenCalledOnce();
    const mixed = await (await f.ask({ ...input, urls: [tt, second] })).json();
    expect(mixed).toMatchObject({ status: "assessed", cached: false, modelCalls: 1 });
    expect(mixed.semantics[0]).toEqual(first.semantics[0]);
    expect(JSON.parse(vi.mocked(f.provider.plan).mock.calls[1][0].input).sources).toHaveLength(1);
    expect(f.provider.plan).toHaveBeenCalledTimes(2);
    for (const patch of [{ genreId: "cars" }, { lang: "ar" }, { effort: "high" }])
      expect(await (await f.ask({ ...input, ...patch, allowModel: false })).json()).toMatchObject({
        status: "unavailable",
        error: "model_budget",
        modelCalls: 0,
      });
  });

  it("invalidates cached semantics when the authoritative source caption changes", async () => {
    let clock = Date.now();
    const f = await fixture({ now: () => clock });
    await f.ask();
    clock += 900001;
    f.sourceFetch.mockImplementation(async () => page(tt, caption + " Updated."));
    expect(await (await f.ask({ ...input, allowModel: false })).json()).toMatchObject({
      status: "unavailable",
      error: "model_budget",
      modelCalls: 0,
    });
    expect(f.provider.plan).toHaveBeenCalledOnce();
    expect(f.sourceFetch).toHaveBeenCalledTimes(2);
  });

  it("omits unavailable individual sources and avoids inference when no authentic caption is available", async () => {
    const unavailable = () => new Response("Unavailable", { status: 404 });
    const f = await fixture();
    f.sourceFetch.mockImplementation(async (url) => (String(url) === tt ? page() : unavailable()));
    const partial = await (await f.ask({ ...input, urls: [tt, second] })).json();
    expect(partial.status).toBe("assessed");
    expect(partial.semantics).toHaveLength(1);
    expect(await (await f.ask({ ...input, urls: [second] })).json()).toMatchObject({
      status: "unavailable",
      error: "source_unavailable",
      modelCalls: 0,
    });
    expect(f.provider.plan).toHaveBeenCalledOnce();
  });

  it("rejects partial, duplicated, wrong-model, fabricated-quote and malformed model output atomically", async () => {
    const f = await fixture();
    const one = { index: 0, assessment: judgment },
      two = { index: 1, assessment: judgment };
    const bad = [
      { assessments: [one] },
      { assessments: [one, one] },
      { assessments: [one, { ...two, index: 2 }] },
      {
        assessments: [one, { ...two, assessment: { ...judgment, projectQuote: "I filmed this" } }],
      },
      { assessments: [one, { ...two, assessment: { ...judgment, categoryQuote: "" } }] },
      { assessments: [one, { ...two, assessment: { ...judgment, views: 200000 } }] },
      { assessments: [one, two], extra: "unexpected" },
      "not json",
    ];
    for (const raw of bad) {
      vi.mocked(f.provider.plan).mockResolvedValueOnce({
        model: input.model,
        text: typeof raw === "string" ? raw : JSON.stringify(raw),
      });
      expect(await (await f.ask({ ...input, urls: [tt, second] })).json()).toMatchObject({
        status: "unavailable",
        error: "invalid_response",
        modelCalls: 1,
      });
      expect(await (await f.ask({ ...input, allowModel: false })).json()).toMatchObject({
        status: "unavailable",
        error: "model_budget",
        modelCalls: 0,
      });
    }
    vi.mocked(f.provider.plan).mockResolvedValueOnce({ model: "wrong-model", text: "{}" });
    expect(await (await f.ask()).json()).toMatchObject({
      error: "invalid_response",
      modelCalls: 1,
    });
  });

  it("rechecks account/sharing after source read and after inference; failures are not cached", async () => {
    const f = await fixture();
    f.sourceFetch.mockImplementationOnce(async () => {
      f.status.accountId = "changed";
      return page();
    });
    expect(await (await f.ask()).json()).toMatchObject({ error: "account_changed", modelCalls: 0 });
    expect(f.provider.plan).not.toHaveBeenCalled();
    f.status.accountId = "account-1";
    vi.mocked(f.provider.plan).mockImplementationOnce(async () => {
      f.status.sharing = false;
      return {
        model: input.model,
        text: JSON.stringify({ assessments: [{ index: 0, assessment: judgment }] }),
      };
    });
    expect(await (await f.ask()).json()).toMatchObject({ error: "not_connected", modelCalls: 1 });
    f.status.sharing = true;
    expect(await (await f.ask({ ...input, allowModel: false })).json()).toMatchObject({
      error: "model_budget",
      modelCalls: 0,
    });
  });

  it("shares the active-provider lock, times out cleanly and clears it for later requests", async () => {
    const f = await fixture({ planTimeoutMs: 100 });
    vi.mocked(f.provider.plan).mockImplementationOnce(async () => new Promise(() => {}));
    const pending = f.ask();
    await vi.waitFor(() => expect(f.provider.plan).toHaveBeenCalledOnce());
    const busy = await f.ask();
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: "ai_busy" });
    expect(await (await pending).json()).toMatchObject({
      status: "unavailable",
      error: "ai_timeout",
      modelCalls: 1,
    });
    expect(vi.mocked(f.provider.plan).mock.calls[0][0].signal.aborted).toBe(true);
    expect(await (await f.ask({ ...input, allowModel: false })).json()).toMatchObject({
      error: "model_budget",
    });
  });

  it("aborts inference when the HTTP client leaves and never caches its unfinished result", async () => {
    const f = await fixture();
    vi.mocked(f.provider.plan).mockImplementationOnce(async () => new Promise(() => {}));
    const controller = new AbortController();
    const pending = f.ask(input, controller.signal).catch(() => undefined);
    await vi.waitFor(() => expect(f.provider.plan).toHaveBeenCalledOnce());
    controller.abort();
    await pending;
    await vi.waitFor(() =>
      expect(vi.mocked(f.provider.plan).mock.calls[0][0].signal.aborted).toBe(true),
    );
    expect(await (await f.ask({ ...input, allowModel: false })).json()).toMatchObject({
      error: "model_budget",
      modelCalls: 0,
    });
  });

  it("clears semantic cache on disconnect", async () => {
    const f = await fixture();
    await f.ask();
    expect(
      (
        await fetch(f.base + "/api/local-ai/disconnect/chatgpt", {
          method: "POST",
          headers: f.headers,
          body: "{}",
        })
      ).status,
    ).toBe(200);
    expect(await (await f.ask({ ...input, allowModel: false })).json()).toMatchObject({
      error: "model_budget",
      modelCalls: 0,
    });
  });
});
