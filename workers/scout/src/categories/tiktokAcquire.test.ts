import { afterEach, expect, it, vi } from "vitest";
import { encryptJson } from "../social/crypto";
import { handle, type Env } from "../scout";
import { acquireTikTok } from "./tiktokAcquire";
import { TT_TRENDING_URL, TT_VIDEOS_URL } from "./tiktok";

const owner = "native-test-owner";
const token = await encryptJson(owner, {
  access_token: "fake-native-grant",
  advertiser_ids: ["123"],
});
const makeEnv = (sealed: string | null = token) =>
  ({
    SCOUT_TOKEN: owner,
    SOCIAL_KV: { get: vi.fn(async () => sealed), put: vi.fn() },
    TAVILY_API_KEY: "must-not-use",
    BRAVE_API_KEY: "must-not-use",
    YOUTUBE_API_KEY: "must-not-use",
  }) as unknown as Env;
const req = (init: RequestInit = {}) =>
  new Request("https://worker.test/categories/anime/native/tt/acquire", {
    method: "POST",
    headers: { Authorization: `Bearer ${owner}`, Origin: "http://localhost:3000" },
    ...init,
  });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const nativeId = (i: number) => `75599999990000000${String(i).padStart(2, "0")}`;
const network = (country = "US") =>
  vi.fn<typeof fetch>(async (input) => {
    const url = new URL(String(input));
    const endpoint = url.origin + url.pathname;
    if (endpoint === TT_TRENDING_URL)
      return json({
        data: {
          list: [
            {
              hashtag_id: "1",
              hashtag_name: "animeedit",
              rank_position: 1,
              top_country_list: [country],
            },
            {
              hashtag_id: "2",
              hashtag_name: "animeedit",
              rank_position: 2,
              top_country_list: ["JP"],
            },
          ],
        },
      });
    if (endpoint === TT_VIDEOS_URL)
      return json({
        code: null,
        data: {
          list: [
            {
              hashtag_id: "1",
              top_video_list: Array.from({ length: 20 }, (_, i) => ({
                video_id: nativeId(i),
                share_url: `https://www.tiktok.com/@animecreator/video/${nativeId(i)}`,
              })),
            },
          ],
        },
      });
    if (endpoint === "https://www.tiktok.com/oembed")
      return json({ title: "Anime AMV transition edit" });
    throw new Error("unexpected provider");
  });
afterEach(() => vi.useRealTimers());

it("acquires bounded native leads without spending/searching, copying hashtag evidence, or storing grants", async () => {
  const env = makeEnv();
  const fetch = network();
  const response = await handle(req(), env, undefined, { fetch });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = (await response.json()) as {
    status: string;
    items: Record<string, unknown>[];
    captioned: number;
    supply: Record<string, number>;
  };
  expect(body.status).toBe("accepted");
  expect(body.items).toHaveLength(12);
  expect(body.captioned).toBe(12);
  expect(body.supply).toEqual({ matchedHashtags: 1, videoCandidates: 12 });
  expect(fetch).toHaveBeenCalledTimes(16);
  for (const [input, init] of fetch.mock.calls) {
    const url = new URL(String(input));
    expect(init).toMatchObject({ redirect: "manual", credentials: "omit" });
    expect(new Headers(init?.headers).get("Access-Token")).toBe(
      url.hostname === "business-api.tiktok.com" ? "fake-native-grant" : null,
    );
    if (url.pathname.endsWith("/video_list/"))
      expect(url.searchParams.get("hashtag_ids")).toBe('["1"]');
  }
  for (const item of body.items) {
    expect(item.evidence).toBeUndefined();
    expect(item.stats).toBeUndefined();
  }
  expect(env.SOCIAL_KV!.put).not.toHaveBeenCalled();
  expect(JSON.stringify(body)).not.toContain("fake-native-grant");
});
it.each(["[]", '{"force":true}', '{"country":"JP"}', '{"country":null}', "x".repeat(257)])(
  "rejects unexpected body %s before retrieval",
  async (body) => {
    const fetch = network();
    const env = makeEnv();
    expect(await acquireTikTok(req({ body }), env, "anime", { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV!.get).not.toHaveBeenCalled();
  },
);

it("traverses twelve then eight unseen leads within the same request and caption budgets", async () => {
  const fetch = network();
  const first = await acquireTikTok(req({ body: '{"excludeVideoIds":[]}' }), makeEnv(), "anime", {
    fetch,
  });
  expect(first).toMatchObject({
    captioned: 12,
    supply: { matchedHashtags: 1, videoCandidates: 12, unseenRemaining: 8, skippedKnown: 0 },
  });
  expect(fetch).toHaveBeenCalledTimes(16);
  const excluded = first!.items.map((item) => item.url.split("/").at(-1)!);
  expect(excluded).toEqual(Array.from({ length: 12 }, (_, i) => nativeId(i)));
  fetch.mockClear();
  const next = await acquireTikTok(
    req({ body: JSON.stringify({ excludeVideoIds: excluded }) }),
    makeEnv(),
    "anime",
    { fetch },
  );
  expect(next).toMatchObject({
    captioned: 8,
    supply: { matchedHashtags: 1, videoCandidates: 8, unseenRemaining: 0, skippedKnown: 12 },
  });
  expect(next!.items.map((item) => item.url.split("/").at(-1))).toEqual(
    Array.from({ length: 8 }, (_, i) => nativeId(i + 12)),
  );
  expect(fetch).toHaveBeenCalledTimes(12);
  const captionUrls = fetch.mock.calls
    .filter(([input]) => String(input).includes("/oembed"))
    .map(([input]) => new URL(String(input)).searchParams.get("url"));
  expect(captionUrls).toHaveLength(8);
  expect(captionUrls.every((url) => !excluded.some((id) => url!.endsWith(`/${id}`)))).toBe(true);

  fetch.mockClear();
  const exhausted = await acquireTikTok(
    req({
      body: JSON.stringify({
        excludeVideoIds: Array.from({ length: 20 }, (_, i) => nativeId(i)),
      }),
    }),
    makeEnv(),
    "anime",
    { fetch },
  );
  expect(exhausted).toMatchObject({
    items: [],
    captioned: 0,
    supply: { matchedHashtags: 1, videoCandidates: 0, unseenRemaining: 0, skippedKnown: 20 },
  });
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(fetch.mock.calls.some(([input]) => String(input).includes("/oembed"))).toBe(false);
});

it.each([
  null,
  "123456789012345",
  [123456789012345],
  [null],
  ["1".repeat(14)],
  ["1".repeat(26)],
  ["１２３４５６７８９０１２３４５"],
  [" 123456789012345"],
  ["123456789012345x"],
  [nativeId(1), nativeId(1)],
  Array.from({ length: 201 }, (_, i) => String(7559999999000000000n + BigInt(i))),
])("rejects invalid exclusions before token or provider access: %j", async (excludeVideoIds) => {
  const env = makeEnv();
  const fetch = network();
  expect(
    await acquireTikTok(req({ body: JSON.stringify({ excludeVideoIds }) }), env, "anime", {
      fetch,
    }),
  ).toBeNull();
  expect(env.SOCIAL_KV!.get).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("accepts the 200-ID limit and enforces the request byte limit before token access", async () => {
  const env = makeEnv();
  const fetch = network();
  const body = JSON.stringify({
    excludeVideoIds: Array.from({ length: 200 }, (_, i) =>
      String(7559999999000000000n + BigInt(i)),
    ),
  });
  expect(body.length).toBeLessThan(8192);
  const accepted = await acquireTikTok(req({ body: body.padEnd(8192, " ") }), env, "anime", {
    fetch,
  });
  expect(accepted).toMatchObject({
    status: "accepted",
    supply: { skippedKnown: 20, unseenRemaining: 0 },
  });
  expect(fetch).toHaveBeenCalledTimes(4);
  fetch.mockClear();
  vi.mocked(env.SOCIAL_KV!.get).mockClear();
  expect(
    await acquireTikTok(req({ body: body.padEnd(8193, " ") }), env, "anime", { fetch }),
  ).toBeNull();
  expect(env.SOCIAL_KV!.get).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("uses the requested Saudi chart and only hashtags supporting that country", async () => {
  const fetch = network("SA");
  const result = await acquireTikTok(req({ body: '{"country":"SA"}' }), makeEnv(), "anime", {
    fetch,
  });
  expect(result).toMatchObject({
    country: "SA",
    status: "accepted",
    supply: { matchedHashtags: 1, videoCandidates: 12 },
  });
  const native = fetch.mock.calls.filter(([input]) =>
    String(input).startsWith("https://business-api.tiktok.com/"),
  );
  expect(native).toHaveLength(4);
  for (const [input] of native)
    expect(new URL(String(input)).searchParams.get("country_code")).toBe("SA");
});

it("reports an empty regional chart without falling back to another country's tags", async () => {
  const fetch = network("US");
  const result = await acquireTikTok(req({ body: '{"country":"SA"}' }), makeEnv(), "anime", {
    fetch,
  });
  expect(result).toMatchObject({
    country: "SA",
    status: "accepted",
    items: [],
    supply: { matchedHashtags: 0, videoCandidates: 0 },
  });
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("stops without a grant and uses the existing route authentication", async () => {
  const fetch = network();
  expect(await acquireTikTok(req(), makeEnv(null), "anime", { fetch })).toMatchObject({
    status: "not_connected",
    items: [],
  });
  expect(fetch).not.toHaveBeenCalled();
  expect((await handle(req({ headers: {} }), makeEnv(), undefined, { fetch })).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
it("rejects redirects without forwarding a grant to another host", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 302, headers: { Location: "https://evil.test/" } }),
  );
  expect(await acquireTikTok(req(), makeEnv(), "anime", { fetch })).toMatchObject({
    status: "upstream",
    items: [],
  });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(fetch.mock.calls.every(([url]) => String(url).startsWith(TT_TRENDING_URL))).toBe(true);
});
it("bounds a hanging grant read with an overall deadline", async () => {
  vi.useFakeTimers();
  const env = makeEnv();
  env.SOCIAL_KV!.get = vi.fn(() => new Promise(() => undefined)) as KVNamespace["get"];
  const fetch = network();
  const pending = acquireTikTok(req(), env, "anime", { fetch });
  await vi.advanceTimersByTimeAsync(28_001);
  expect(await pending).toMatchObject({ status: "timeout", items: [] });
  expect(fetch).not.toHaveBeenCalled();
});
it("cancels in-flight requests and does not proceed to the video call", async () => {
  const controller = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => undefined));
  const pending = acquireTikTok(req({ signal: controller.signal }), makeEnv(), "anime", { fetch });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  controller.abort();
  expect(await pending).toMatchObject({ status: "cancelled", items: [] });
  expect(fetch.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
});
