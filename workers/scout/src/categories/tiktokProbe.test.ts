import { afterEach, describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { encryptJson } from "../social/crypto";
import { TT_TRENDING_URL } from "./tiktok";
import { probeTikTokAccess } from "./tiktokProbe";

const OWNER = "probe-owner-test";
const ACCESS = "private-business-test-token";
const ADVERTISER = "1234567890123456789";
const NOW = new Date("2026-10-10T08:00:00.000Z");
const PATH = "/categories/anime/native/tt/probe";
const SEALED = await encryptJson(OWNER, {
  access_token: ACCESS,
  advertiser_ids: [ADVERTISER],
  connectedAt: "2026-10-01T00:00:00.000Z",
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const accepted = (list: unknown[] = []) => json({ code: 0, data: { list } });
const tag = { hashtag_id: "12345", hashtag_name: "animeedit" };
const req = (init: RequestInit = {}, path = PATH) =>
  new Request(`https://worker.example${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${OWNER}`, Origin: "http://localhost:3000" },
    ...init,
  });
function setup(token: string | null = SEALED) {
  const get = vi.fn(async () => token);
  const put = vi.fn();
  const env: Env = {
    SCOUT_TOKEN: OWNER,
    SOCIAL_KV: { get, put } as unknown as KVNamespace,
    // All unrelated services are configured: the route must still make only its one native request.
    TAVILY_API_KEY: "unused-tavily",
    BRAVE_API_KEY: "unused-brave",
    BRAVE_DAILY: "10",
    YOUTUBE_API_KEY: "unused-youtube",
    TIKTOK_DISCOVERY_COUNTRY: "SA",
  };
  return { env, get, put };
}
afterEach(() => vi.useRealTimers());

describe("native TikTok capability probe", () => {
  it.each([{ list: [] }, { list: [tag, { ...tag, hashtag_id: "67890" }] }])(
    "accepts a real list, including empty, through the authenticated route without another provider",
    async ({ list }) => {
      const { env, get, put } = setup();
      const fetch = vi.fn<typeof globalThis.fetch>(async () => accepted(list));
      const response = await handle(req(), env, undefined, { fetch, now: () => NOW });
      const result = await response.json();
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000");
      expect(result).toEqual({
        version: 1,
        categoryId: "anime",
        country: "US",
        dateRange: "7DAY",
        discoveryType: "HASHTAG",
        stage: "trending_list",
        status: "accepted",
        checkedAt: NOW.toISOString(),
        requests: 1,
        hashtagCount: list.length,
        httpStatus: 200,
        providerCode: 0,
      });
      expect(get).toHaveBeenCalledExactlyOnceWith("tiktokads:token", "text");
      expect(put).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(1);
      const [input, init] = fetch.mock.calls[0];
      const url = new URL(String(input));
      expect(`${url.origin}${url.pathname}`).toBe(TT_TRENDING_URL);
      expect(Object.fromEntries(url.searchParams)).toEqual({
        advertiser_id: ADVERTISER,
        discovery_type: "HASHTAG",
        country_code: "US",
        date_range: "7DAY",
        category_name: "ANIMATION_AND_COMICS",
      });
      expect(init).toMatchObject({
        method: "GET",
        credentials: "omit",
        redirect: "error",
        headers: { Accept: "application/json", "Access-Token": ACCESS },
      });
      for (const secret of [OWNER, ACCESS, ADVERTISER, "animeedit"])
        expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it("returns not_connected without a provider call or fabricated provider check", async () => {
    const { env } = setup(null);
    const fetch = vi.fn<typeof globalThis.fetch>();
    expect(await probeTikTokAccess(req(), env, "anime", { fetch, now: () => NOW })).toMatchObject({
      status: "not_connected",
      stage: "grant",
      requests: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { data: { list: [] } },
    { code: null, data: { list: [tag] } },
    { data: { list: [{ ...tag, hashtag_id: 12345 }] } },
  ])(
    "accepts the documented nullable/optional response code only with a valid list: %j",
    async (body) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => json(body));
      const result = await probeTikTokAccess(req(), setup().env, "anime", { fetch });
      expect(result).toMatchObject({
        status: "accepted",
        httpStatus: 200,
        hashtagCount: body.data.list.length,
      });
      expect(result).not.toHaveProperty("providerCode");
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("does not infer Discovery entitlement from missing or unrelated stored scope metadata", async () => {
    const token = await encryptJson(OWNER, {
      access_token: ACCESS,
      advertiser_ids: [ADVERTISER],
      scope: ["unrelated.permission"],
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}, 403));
    expect(await probeTikTokAccess(req(), setup(token).env, "anime", { fetch })).toMatchObject({
      status: "permission",
      stage: "trending_list",
      requests: 1,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a grant-store failure distinct from disconnected and never echoes exceptions", async () => {
    const { env, get } = setup();
    get.mockRejectedValue(new Error(ACCESS));
    const fetch = vi.fn<typeof globalThis.fetch>();
    const result = await probeTikTokAccess(req(), env, "anime", { fetch });
    expect(result).toMatchObject({ status: "upstream", stage: "grant", requests: 0 });
    expect(JSON.stringify(result)).not.toContain(ACCESS);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429, 500, 302])(
    "reports HTTP %i without reading or echoing its body",
    async (status) => {
      const { env } = setup();
      const cancel = vi.fn();
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(new ReadableStream({ cancel }), { status }),
      );
      const result = await probeTikTokAccess(req(), env, "anime", { fetch });
      expect(result).toMatchObject({
        status:
          ({ 401: "auth", 403: "permission", 429: "quota" } as Record<number, string>)[status] ??
          "upstream",
        httpStatus: status,
        requests: 1,
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    {},
    { code: 0 },
    { code: null },
    { code: "0", data: { list: [] } },
    { code: 0, data: { list: {} } },
    { code: 0, data: { list: [null] } },
    { code: 0, data: { list: [{ hashtag_name: "anime" }] } },
    { data: { list: [{ ...tag, hashtag_id: Number.MAX_SAFE_INTEGER + 1 }] } },
    { data: { list: [{ ...tag, hashtag_id: 0 }] } },
    { data: { list: [{ ...tag, hashtag_id: "" }] } },
  ])("rejects a malformed success shape instead of saying empty: %j", async (body) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json(body));
    const result = await probeTikTokAccess(req(), setup().env, "anime", { fetch });
    expect(result).toMatchObject({ status: "malformed", requests: 1 });
    expect(result).not.toHaveProperty("hashtagCount");
  });

  it("keeps an unknown nonzero provider code without interpreting or exposing its message", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({
        code: 40105,
        message: `${ACCESS} ${ADVERTISER} revoked or permission or quota`,
        data: { list: [] },
      }),
    );
    const result = await probeTikTokAccess(req(), setup().env, "anime", { fetch });
    expect(result).toMatchObject({ status: "upstream", providerCode: 40105, requests: 1 });
    expect(result).not.toHaveProperty("hashtagCount");
    for (const value of [ACCESS, ADVERTISER, "revoked"])
      expect(JSON.stringify(result)).not.toContain(value);
  });

  it.each(["declared", "streamed"])(
    "bounds the %s response to 1 MiB and cancels its body",
    async (kind) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (kind === "streamed") controller.enqueue(new Uint8Array(1024 * 1024 + 1));
        },
        cancel,
      });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (kind === "declared") headers["Content-Length"] = String(1024 * 1024 + 1);
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body, { headers }));
      expect(await probeTikTokAccess(req(), setup().env, "anime", { fetch })).toMatchObject({
        status: "malformed",
      });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("bounds response streaming to six seconds and releases the unfinished body", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const pending = probeTikTokAccess(req(), setup().env, "anime", { fetch });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pending).toMatchObject({ status: "timeout", stage: "trending_list", requests: 1 });
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("cancels before a request or while headers are pending without retrying", async () => {
    const aborted = new AbortController();
    aborted.abort();
    const unused = vi.fn<typeof globalThis.fetch>();
    expect(
      await probeTikTokAccess(req({ signal: aborted.signal }), setup().env, "anime", {
        fetch: unused,
      }),
    ).toMatchObject({ status: "cancelled", requests: 0 });
    expect(unused).not.toHaveBeenCalled();
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
    const pending = probeTikTokAccess(req({ signal: controller.signal }), setup().env, "anime", {
      fetch,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toMatchObject({ status: "cancelled", requests: 1 });
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("does not call a provider for auth, origin, unknown category, method or invalid body", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { env, get } = setup();
    for (const [request, status] of [
      [req({ headers: { Origin: "http://localhost:3000" } }), 401],
      [
        req({ headers: { Authorization: `Bearer ${OWNER}`, Origin: "https://other.example" } }),
        403,
      ],
      [req({}, "/categories/unknown/native/tt/probe"), 404],
      [req({ method: "GET" }), 404],
      [req({ body: '{"country":"SA"}' }), 400],
      [req({ body: " ".repeat(257) }), 400],
    ] as const)
      expect((await handle(request, env, undefined, { fetch })).status).toBe(status);
    expect(fetch).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("accepts an empty options object and reports network failure without its secret-bearing error", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error(ACCESS);
    });
    const result = await probeTikTokAccess(req({ body: "{}" }), setup().env, "anime", { fetch });
    expect(result).toMatchObject({ status: "network", requests: 1 });
    expect(JSON.stringify(result)).not.toContain(ACCESS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
