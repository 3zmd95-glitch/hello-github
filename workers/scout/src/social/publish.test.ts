import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { runTick, SYNC_SLOTS, utcSlot } from "./cron";
import {
  MAX_ATTEMPTS,
  mergeJob,
  parseJobInput,
  prune,
  runDue,
  type JobInput,
  type PublishJob,
} from "./publish";
import { FRESH_CONTAINER_WAIT_MS, ttChunks, TT_CHUNK } from "./publishers";
import { keys, Store } from "./store";
import type { SocialPlatform, TokenSet } from "./types";

/* ---------- fakes ---------- */

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-09-27T17:00:00Z"); // 20:00 Riyadh
const MEDIA = "https://cdn.example/clip.mp4";
const IMAGE = "https://cdn.example/pic.jpg";

type FakeKV = KVNamespace & { store: Map<string, string> };

function fakeKV(): FakeKV {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  } as unknown as FakeKV;
}

function makeEnv(kv: FakeKV = fakeKV()): Env & { SOCIAL_KV: FakeKV } {
  return {
    SCOUT_TOKEN: TOKEN,
    ALLOWED_ORIGINS: APP,
    SOCIAL_KV: kv,
    META_APP_ID: "meta-id",
    META_APP_SECRET: "meta-secret",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    TIKTOK_CLIENT_KEY: "tt-key",
    TIKTOK_CLIENT_SECRET: "tt-secret",
  };
}

function req(path: string, init: RequestInit & { json?: unknown } = {}): Request {
  const { json: body, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Authorization", `Bearer ${TOKEN}`);
  headers.set("Origin", APP);
  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
    rest.body = JSON.stringify(body);
  }
  return new Request(`${BASE}${path}`, { ...rest, headers });
}

async function connect(
  env: Env,
  platform: SocialPlatform,
  tokens: Partial<TokenSet> = {},
  handle?: string,
) {
  const store = Store.from(env)!;
  await store.putTokens(platform, {
    accessToken: `${platform}-token`,
    refreshToken: "refresh",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: platform === "instagram" ? "178" : undefined,
    canPublish: true,
    ...tokens,
  });
  await store.putStatus(platform, {
    connectedAt: NOW.toISOString(),
    ...(handle ? { handle } : {}),
  });
}

type Handler = (url: URL, init: RequestInit | undefined) => unknown;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const video = (size = 1000, extra: Record<string, string> = {}) =>
  new Response(new Uint8Array(size), {
    status: 200,
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size), ...extra },
  });

/** Routes by host + path (+ method for the same path); unmocked calls answer 404. */
function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const key = `${init?.method ?? "GET"} ${url.host}${url.pathname}`;
    const handler = routes[key];
    if (!handler) return json({ error: { message: `unmocked ${key}` } }, 404);
    const out = handler(url, init);
    return out instanceof Response ? out : json(out);
  });
  const calls = () =>
    fn.mock.calls.map(([input, init]) => {
      const u = new URL(
        typeof input === "string" ? input : input instanceof URL ? input : input.url,
      );
      return `${init?.method ?? "GET"} ${u.host}${u.pathname}`;
    });
  return Object.assign(fn, { calls });
}

const job = (over: Partial<JobInput> = {}): JobInput => ({
  id: "post1",
  scheduledAt: NOW.toISOString(),
  media: { url: MEDIA, kind: "video" },
  targets: { instagram: { caption: "match cut ✂️" } },
  ...over,
});

async function queue(env: Env, input: JobInput) {
  const store = Store.from(env)!;
  const jobs = await store.getJobs<PublishJob>();
  jobs[input.id] = mergeJob(undefined, input, NOW);
  await store.putJobs(jobs);
}

async function jobOf(env: Env, id = "post1"): Promise<PublishJob> {
  return (await Store.from(env)!.getJobs<PublishJob>())[id];
}

const later = (ms: number) => new Date(NOW.getTime() + ms);
const formOf = (init: RequestInit | undefined) => new URLSearchParams(String(init?.body ?? ""));

/* ---------- validation ---------- */

describe("parseJobInput", () => {
  it("accepts a job and normalizes the time", () => {
    const r = parseJobInput({ ...job(), scheduledAt: "2026-09-27T20:30:00+03:00" });
    expect(r).toEqual({ ok: true, job: { ...job(), scheduledAt: "2026-09-27T17:30:00.000Z" } });
  });

  it.each([
    [{ id: "has space" }, "id"],
    [{ scheduledAt: "tomorrow" }, "scheduledAt"],
    [{ media: { url: "http://cdn.example/a.mp4", kind: "video" } }, "media.url"],
    [{ media: { url: MEDIA, kind: "gif" } }, "media.kind"],
    [{ targets: {} }, "targets"],
    [{ targets: { x: { caption: "hi" } } }, "targets.x"],
    [{ media: undefined }, "instagram.media"],
    [
      { media: { url: IMAGE, kind: "image" }, targets: { youtube: { caption: "" } } },
      "youtube.media",
    ],
    [{ targets: { threads: { caption: "a".repeat(501) } } }, "threads.caption"],
    [{ media: undefined, targets: { threads: { caption: "  " } } }, "threads.caption"],
  ])("refuses %j (%s)", (patch, detail) => {
    expect(parseJobInput({ ...job(), ...patch })).toEqual({ ok: false, detail });
  });

  it("keeps only the options each platform knows", () => {
    const r = parseJobInput(
      job({
        targets: {
          youtube: { caption: "d", title: " My title ", privacy: "unlisted", tiktokMode: "inbox" },
          tiktok: { caption: "t", privacy: "SELF_ONLY", tiktokMode: "inbox", title: "x" },
          threads: { caption: "c", privacy: "public" },
        },
      }),
    );
    expect(r.ok && r.job.targets).toEqual({
      youtube: { caption: "d", title: "My title", privacy: "unlisted" },
      tiktok: { caption: "t", privacy: "SELF_ONLY", tiktokMode: "inbox" },
      threads: { caption: "c" },
    });
  });

  it("text alone is fine for Threads", () => {
    expect(
      parseJobInput(job({ media: undefined, targets: { threads: { caption: "hi" } } })).ok,
    ).toBe(true);
  });
});

describe("mergeJob and prune", () => {
  it("a replaced job keeps the platforms already published or processing", () => {
    const first = mergeJob(
      undefined,
      job({ targets: { instagram: { caption: "a" }, threads: { caption: "b" } } }),
      NOW,
    );
    first.targets.instagram = { ...first.targets.instagram!, state: "published", postId: "m9" };
    const next = mergeJob(
      first,
      job({ targets: { threads: { caption: "new" }, youtube: { caption: "y" } } }),
      later(1000),
    );
    expect(next.targets.instagram).toMatchObject({ state: "published", postId: "m9" });
    expect(next.targets.threads).toEqual({ caption: "new", state: "queued", attempts: 0 });
    expect(next.targets.youtube).toEqual({ caption: "y", state: "queued", attempts: 0 });
    expect(next.createdAt).toBe(first.createdAt);
    // A running job's lock survives a replace.
    const locked = mergeJob({ ...first, lockUntil: "2026-09-27T17:10:00.000Z" }, job(), NOW);
    expect(locked.lockUntil).toBe("2026-09-27T17:10:00.000Z");
  });

  it("forgets finished jobs after 30 days but never active ones", () => {
    const old = { ...mergeJob(undefined, job({ id: "old" }), new Date("2026-08-01T00:00:00Z")) };
    const done = {
      ...old,
      id: "done",
      targets: { instagram: { ...old.targets.instagram!, state: "published" as const } },
    };
    const kept = prune({ old, done }, NOW);
    expect(Object.keys(kept)).toEqual(["old"]);
  });
});

/* ---------- OAuth: allowing auto-posting ---------- */

describe("connect with publish: true", () => {
  it.each([
    [
      "instagram",
      "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish",
    ],
    ["threads", "threads_basic,threads_manage_insights,threads_content_publish"],
    [
      "youtube",
      "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.upload",
    ],
    [
      "tiktok",
      "user.info.basic,user.info.profile,user.info.stats,video.list,video.publish,video.upload",
    ],
  ])("%s asks for the publishing scopes too", async (platform, scope) => {
    const env = makeEnv();
    const res = await handle(
      req(`/social/connect/${platform}`, {
        method: "POST",
        json: { returnTo: `${APP}/settings/`, publish: true },
      }),
      env,
    );
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).searchParams.get("scope")).toBe(scope);
  });

  it("the callback stores canPublish and the status reports it", async () => {
    const env = makeEnv();
    const res = await handle(
      req("/social/connect/threads", {
        method: "POST",
        json: { returnTo: `${APP}/settings/`, publish: true },
      }),
      env,
    );
    const state = new URL(((await res.json()) as { url: string }).url).searchParams.get("state")!;
    const fetchMock = mockFetch({
      "POST graph.threads.net/oauth/access_token": () => ({ access_token: "short", user_id: 5 }),
      "GET graph.threads.net/access_token": () => ({ access_token: "long", expires_in: 5_184_000 }),
    });
    const back = await handle(
      new Request(`${BASE}/oauth/threads/callback?code=c&state=${state}`),
      env,
      undefined,
      { fetch: fetchMock, now: () => NOW },
    );
    expect(back.headers.get("Location")).toContain("connected=threads");
    expect((await Store.from(env)!.getTokens("threads"))?.canPublish).toBe(true);
    const status = (await (await handle(req("/social/status"), env)).json()) as {
      platforms: Record<string, { canPublish: boolean }>;
    };
    expect(status.platforms.threads.canPublish).toBe(true);
    expect(status.platforms.instagram.canPublish).toBe(false);
  });

  it("a plain connect does not ask for publishing", async () => {
    const res = await handle(
      req("/social/connect/instagram", { method: "POST", json: { returnTo: `${APP}/settings/` } }),
      makeEnv(),
    );
    const { url } = (await res.json()) as { url: string };
    expect(new URL(url).searchParams.get("scope")).not.toContain("content_publish");
  });
});

/* ---------- routes ---------- */

describe("/social/publish routes", () => {
  it("adds, lists, replaces and deletes a job", async () => {
    const env = makeEnv();
    const add = await handle(
      req("/social/publish", { method: "POST", json: job() }),
      env,
      undefined,
      {
        now: () => NOW,
      },
    );
    expect(add.status).toBe(200);
    expect(((await add.json()) as { job: PublishJob }).job.targets.instagram).toEqual({
      caption: "match cut ✂️",
      state: "queued",
      attempts: 0,
    });
    await handle(req("/social/publish", { method: "POST", json: job({ id: "post2" }) }), env);
    const list = (await (await handle(req("/social/publish"), env)).json()) as {
      jobs: PublishJob[];
    };
    expect(list.jobs.map((j) => j.id).sort()).toEqual(["post1", "post2"]);

    const del = await handle(req("/social/publish/post1", { method: "DELETE" }), env);
    expect(await del.json()).toEqual({ ok: true });
    expect(Object.keys(await Store.from(env)!.getJobs())).toEqual(["post2"]);
  });

  it("answers 400 with the reason for a bad job", async () => {
    const res = await handle(
      req("/social/publish", { method: "POST", json: job({ media: undefined }) }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", detail: "instagram.media" });
  });

  it("needs the bearer token", async () => {
    const res = await handle(
      new Request(`${BASE}/social/publish`, { headers: { Origin: APP } }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("run publishes a future job now", async () => {
    const env = makeEnv();
    await connect(env, "threads");
    await queue(
      env,
      job({
        scheduledAt: later(86_400_000).toISOString(),
        media: undefined,
        targets: { threads: { caption: "hi" } },
      }),
    );
    const fetchMock = mockFetch({
      "POST graph.threads.net/v1.0/me/threads": () => ({ id: "c1" }),
      "GET graph.threads.net/v1.0/c1": () => ({ status: "FINISHED" }),
      "POST graph.threads.net/v1.0/me/threads_publish": () => ({ id: "t1" }),
      "GET graph.threads.net/v1.0/t1": () => ({
        permalink: "https://www.threads.net/@3z.prod/post/t1",
      }),
    });
    const res = await handle(req("/social/publish/post1/run", { method: "POST" }), env, undefined, {
      fetch: fetchMock,
      now: () => NOW,
    });
    const { job: after } = (await res.json()) as { job: PublishJob };
    expect(after.targets.threads).toMatchObject({ state: "published", postId: "t1" });
    expect(after.scheduledAt).toBe(NOW.toISOString());
    expect(after.lockUntil).toBeUndefined();
  });

  it("run on an unknown job is a 404", async () => {
    const res = await handle(req("/social/publish/nope/run", { method: "POST" }), makeEnv());
    expect(res.status).toBe(404);
  });
});

/* ---------- the runner, per platform ---------- */

describe("runDue", () => {
  it("does nothing before the time and without a KV write", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await queue(env, job({ scheduledAt: later(60_000).toISOString() }));
    const before = env.SOCIAL_KV.store.get(keys.publishJobs);
    const fetchMock = mockFetch({});
    expect(await runDue(env, { fetch: fetchMock, now: NOW })).toEqual({
      advanced: [],
      published: [],
      failed: [],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(env.SOCIAL_KV.store.get(keys.publishJobs)).toBe(before);
  });

  it("Instagram reel: container on the first tick, published on the next", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await queue(env, job());
    let ready = false;
    const fetchMock = mockFetch({
      "POST graph.instagram.com/v21.0/178/media": (_u, init) => {
        expect(Object.fromEntries(formOf(init))).toEqual({
          media_type: "REELS",
          video_url: MEDIA,
          caption: "match cut ✂️",
          share_to_feed: "true",
          access_token: "instagram-token",
        });
        return { id: "cont1" };
      },
      "GET graph.instagram.com/v21.0/cont1": () => ({
        status_code: ready ? "FINISHED" : "IN_PROGRESS",
      }),
      "POST graph.instagram.com/v21.0/178/media_publish": (_u, init) => {
        expect(formOf(init).get("creation_id")).toBe("cont1");
        return { id: "m42" };
      },
      "GET graph.instagram.com/v21.0/m42": () => ({
        permalink: "https://www.instagram.com/reel/XYZ/",
      }),
    });

    await runDue(env, { fetch: fetchMock, now: NOW });
    expect((await jobOf(env)).targets.instagram).toMatchObject({
      state: "processing",
      containerId: "cont1",
      startedAt: NOW.toISOString(),
    });
    // Video containers are not checked in the same run.
    expect(fetchMock.calls()).toEqual(["POST graph.instagram.com/v21.0/178/media"]);

    // Still processing a tick later.
    await runDue(env, { fetch: fetchMock, now: later(5 * 60_000) });
    expect((await jobOf(env)).targets.instagram?.state).toBe("processing");

    ready = true;
    const r = await runDue(env, { fetch: fetchMock, now: later(10 * 60_000) });
    expect(r.published).toEqual(["post1:instagram"]);
    expect((await jobOf(env)).targets.instagram).toMatchObject({
      state: "published",
      postId: "m42",
      permalink: "https://www.instagram.com/reel/XYZ/",
    });
  });

  it("Instagram image publishes in one run", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await queue(env, job({ media: { url: IMAGE, kind: "image" } }));
    const fetchMock = mockFetch({
      "POST graph.instagram.com/v21.0/178/media": (_u, init) => {
        expect(formOf(init).get("image_url")).toBe(IMAGE);
        return { id: "c" };
      },
      "GET graph.instagram.com/v21.0/c": () => ({ status_code: "FINISHED" }),
      "POST graph.instagram.com/v21.0/178/media_publish": () => ({ id: "m" }),
      "GET graph.instagram.com/v21.0/m": () => ({ permalink: "https://www.instagram.com/p/P/" }),
    });
    expect((await runDue(env, { fetch: fetchMock, now: NOW })).published).toEqual([
      "post1:instagram",
    ]);
  });

  it("a fresh Threads text container still IN_PROGRESS is checked once more after a pause", async () => {
    const env = makeEnv();
    await connect(env, "threads");
    await queue(env, job({ media: undefined, targets: { threads: { caption: "hi" } } }));
    let reads = 0;
    const fetchMock = mockFetch({
      "POST graph.threads.net/v1.0/me/threads": () => ({ id: "c1" }),
      "GET graph.threads.net/v1.0/c1": () => ({ status: reads++ === 0 ? "IN_PROGRESS" : "FINISHED" }),
      "POST graph.threads.net/v1.0/me/threads_publish": () => ({ id: "t1" }),
      "GET graph.threads.net/v1.0/t1": () => ({ permalink: "https://www.threads.com/@3z.prod/post/t1" }),
    });
    const sleep = vi.fn(async () => undefined);
    expect((await runDue(env, { fetch: fetchMock, now: NOW, sleep })).published).toEqual([
      "post1:threads",
    ]);
    expect(sleep).toHaveBeenCalledWith(FRESH_CONTAINER_WAIT_MS);
    expect(reads).toBe(2);
    expect((await jobOf(env)).targets.threads).toMatchObject({ state: "published", postId: "t1" });
  });

  it("a fresh container still IN_PROGRESS after the pause waits for the next tick", async () => {
    const env = makeEnv();
    await connect(env, "threads");
    await queue(env, job({ media: undefined, targets: { threads: { caption: "hi" } } }));
    const fetchMock = mockFetch({
      "POST graph.threads.net/v1.0/me/threads": () => ({ id: "c1" }),
      "GET graph.threads.net/v1.0/c1": () => ({ status: "IN_PROGRESS" }),
    });
    const sleep = vi.fn(async () => undefined);
    await runDue(env, { fetch: fetchMock, now: NOW, sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((await jobOf(env)).targets.threads).toMatchObject({ state: "processing", containerId: "c1" });
  });

  it("a refused container fails with Meta's words", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await queue(env, job({ media: { url: IMAGE, kind: "image" } }));
    const fetchMock = mockFetch({
      "POST graph.instagram.com/v21.0/178/media": () =>
        json({ error: { message: "The aspect ratio is not supported.", code: 36003 } }, 400),
    });
    const r = await runDue(env, { fetch: fetchMock, now: NOW });
    expect(r.failed).toEqual(["post1:instagram"]);
    expect((await jobOf(env)).targets.instagram).toMatchObject({
      state: "failed",
      error: "rejected",
      detail: "The aspect ratio is not supported.",
    });
  });

  it("fails without the publishing permission or a connection, with no platform call", async () => {
    const env = makeEnv();
    await connect(env, "instagram", { canPublish: false });
    await queue(env, job({ targets: { instagram: { caption: "a" }, youtube: { caption: "b" } } }));
    const fetchMock = mockFetch({});
    await runDue(env, { fetch: fetchMock, now: NOW });
    const t = (await jobOf(env)).targets;
    expect(t.instagram).toMatchObject({ state: "failed", error: "no_permission" });
    expect(t.youtube).toMatchObject({ state: "failed", error: "not_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("YouTube streams the video into a resumable upload", async () => {
    const env = makeEnv();
    await connect(env, "youtube", { expiresAt: later(3600_000).toISOString() });
    await queue(
      env,
      job({
        targets: {
          youtube: { caption: "desc #shorts", title: "Match cut in 30 s", privacy: "unlisted" },
        },
      }),
    );
    const fetchMock = mockFetch({
      "GET cdn.example/clip.mp4": () => video(2048),
      "POST www.googleapis.com/upload/youtube/v3/videos": (url, init) => {
        expect(url.searchParams.get("uploadType")).toBe("resumable");
        const h = new Headers(init?.headers);
        expect(h.get("Authorization")).toBe("Bearer youtube-token");
        expect(h.get("X-Upload-Content-Length")).toBe("2048");
        expect(h.get("X-Upload-Content-Type")).toBe("video/mp4");
        expect(JSON.parse(String(init?.body))).toEqual({
          snippet: { title: "Match cut in 30 s", description: "desc #shorts", categoryId: "22" },
          status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
        });
        return json({}, 200, { Location: "https://upload.example/session/1" });
      },
      "PUT upload.example/session/1": (_u, init) => {
        expect(new Headers(init?.headers).get("Content-Length")).toBe("2048");
        expect(init?.body).toBeInstanceOf(ReadableStream);
        return { id: "vid123", status: { uploadStatus: "uploaded" } };
      },
    });
    const r = await runDue(env, { fetch: fetchMock, now: NOW });
    expect(r.published).toEqual(["post1:youtube"]);
    expect((await jobOf(env)).targets.youtube).toMatchObject({
      state: "published",
      postId: "vid123",
      permalink: "https://www.youtube.com/watch?v=vid123",
    });
  });

  it("an HTML page instead of the file fails as media_unreachable", async () => {
    const env = makeEnv();
    await connect(env, "youtube", { expiresAt: later(3600_000).toISOString() });
    await queue(env, job({ targets: { youtube: { caption: "d" } } }));
    const fetchMock = mockFetch({
      "GET cdn.example/clip.mp4": () =>
        new Response("<html>virus scan</html>", { headers: { "Content-Type": "text/html" } }),
    });
    await runDue(env, { fetch: fetchMock, now: NOW });
    expect((await jobOf(env)).targets.youtube).toMatchObject({
      state: "failed",
      error: "media_unreachable",
    });
  });

  it("TikTok Direct Post: privacy from creator_info, one-chunk upload, then the status", async () => {
    const env = makeEnv();
    // A day-old token: refreshed before use (24 h tokens).
    await connect(env, "tiktok", { issuedAt: later(-86_400_000).toISOString() }, "3z.prod");
    await queue(
      env,
      job({ targets: { tiktok: { caption: "match cut #capcut", privacy: "PUBLIC_TO_EVERYONE" } } }),
    );
    let status = "PROCESSING_UPLOAD";
    const fetchMock = mockFetch({
      "POST open.tiktokapis.com/v2/oauth/token/": () => ({
        access_token: "tt-fresh",
        expires_in: 86_400,
      }),
      "POST open.tiktokapis.com/v2/post/publish/creator_info/query/": () => ({
        data: { privacy_level_options: ["SELF_ONLY"] },
        error: { code: "ok" },
      }),
      "GET cdn.example/clip.mp4": () => video(4096),
      "POST open.tiktokapis.com/v2/post/publish/video/init/": (_u, init) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer tt-fresh");
        expect(JSON.parse(String(init?.body))).toEqual({
          post_info: {
            title: "match cut #capcut",
            privacy_level: "SELF_ONLY",
            disable_comment: false,
            disable_duet: false,
            disable_stitch: false,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: 4096,
            chunk_size: 4096,
            total_chunk_count: 1,
          },
        });
        return {
          data: { publish_id: "pub1", upload_url: "https://upload.tiktok.example/u1" },
          error: { code: "ok" },
        };
      },
      "PUT upload.tiktok.example/u1": (_u, init) => {
        expect(new Headers(init?.headers).get("Content-Range")).toBe("bytes 0-4095/4096");
        return json({}, 201);
      },
      "POST open.tiktokapis.com/v2/post/publish/status/fetch/": (_u, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({ publish_id: "pub1" });
        return {
          data: {
            status,
            publicaly_available_post_id: status === "PUBLISH_COMPLETE" ? [7301] : [],
          },
          error: { code: "ok" },
        };
      },
    });
    await runDue(env, { fetch: fetchMock, now: NOW });
    expect((await jobOf(env)).targets.tiktok).toMatchObject({
      state: "processing",
      containerId: "pub1",
      privacy: "SELF_ONLY",
    });
    await runDue(env, { fetch: fetchMock, now: later(5 * 60_000) });
    expect((await jobOf(env)).targets.tiktok?.state).toBe("processing");
    status = "PUBLISH_COMPLETE";
    await runDue(env, { fetch: fetchMock, now: later(10 * 60_000) });
    expect((await jobOf(env)).targets.tiktok).toMatchObject({
      state: "published",
      postId: "7301",
      permalink: "https://www.tiktok.com/@3z.prod/video/7301",
    });
  });

  it("TikTok inbox mode skips creator_info and ends in the inbox", async () => {
    const env = makeEnv();
    await connect(env, "tiktok");
    await queue(env, job({ targets: { tiktok: { caption: "c", tiktokMode: "inbox" } } }));
    const fetchMock = mockFetch({
      "POST open.tiktokapis.com/v2/oauth/token/": () => ({
        access_token: "tt-fresh",
        expires_in: 86_400,
      }),
      "GET cdn.example/clip.mp4": () => video(10),
      "POST open.tiktokapis.com/v2/post/publish/inbox/video/init/": (_u, init) => {
        expect(JSON.parse(String(init?.body))).toEqual({
          source_info: {
            source: "FILE_UPLOAD",
            video_size: 10,
            chunk_size: 10,
            total_chunk_count: 1,
          },
        });
        return { data: { publish_id: "p", upload_url: "https://upload.tiktok.example/u" } };
      },
      "PUT upload.tiktok.example/u": () => json({}, 201),
      "POST open.tiktokapis.com/v2/post/publish/status/fetch/": () => ({
        data: { status: "SEND_TO_USER_INBOX" },
      }),
    });
    await runDue(env, { fetch: fetchMock, now: NOW });
    await runDue(env, { fetch: fetchMock, now: later(5 * 60_000) });
    expect((await jobOf(env)).targets.tiktok).toMatchObject({ state: "published", inbox: true });
    expect(fetchMock.calls()).not.toContain(
      "POST open.tiktokapis.com/v2/post/publish/creator_info/query/",
    );
  });

  it("TikTok cuts videos over 64 MB into chunks the way TikTok wants", () => {
    expect(ttChunks(1000)).toEqual({ chunkSize: 1000, count: 1 });
    expect(ttChunks(TT_CHUNK)).toEqual({ chunkSize: TT_CHUNK, count: 1 });
    expect(ttChunks(TT_CHUNK * 2 + 5)).toEqual({ chunkSize: TT_CHUNK, count: 2 });
    expect(ttChunks(TT_CHUNK * 3 - 1)).toEqual({ chunkSize: TT_CHUNK, count: 2 });
  });

  it("retries a transient failure with back-off, then gives up", async () => {
    const env = makeEnv();
    await connect(env, "threads");
    await queue(env, job({ media: undefined, targets: { threads: { caption: "hi" } } }));
    const fetchMock = mockFetch({
      "POST graph.threads.net/v1.0/me/threads": () =>
        json({ error: { message: "try later", code: 2 } }, 500),
    });
    let t = NOW;
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await runDue(env, { fetch: fetchMock, now: t });
      const target = (await jobOf(env)).targets.threads!;
      expect(target).toMatchObject({ state: "queued", attempts: i, error: "upstream" });
      // Not before nextAt.
      const calls = fetchMock.mock.calls.length;
      await runDue(env, { fetch: fetchMock, now: new Date(Date.parse(target.nextAt!) - 1000) });
      expect(fetchMock.mock.calls.length).toBe(calls);
      t = new Date(target.nextAt!);
    }
    await runDue(env, { fetch: fetchMock, now: t });
    expect((await jobOf(env)).targets.threads).toMatchObject({
      state: "failed",
      attempts: MAX_ATTEMPTS,
    });
  });

  it("an expired token fails the platform for the owner to reconnect", async () => {
    const env = makeEnv();
    await connect(env, "threads", { expiresAt: later(-1000).toISOString() });
    await queue(env, job({ media: undefined, targets: { threads: { caption: "hi" } } }));
    await runDue(env, { fetch: mockFetch({}), now: NOW });
    expect((await jobOf(env)).targets.threads).toMatchObject({
      state: "failed",
      error: "token_expired",
    });
  });

  it("gives up on a container still processing after two hours", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await queue(env, job());
    const fetchMock = mockFetch({
      "POST graph.instagram.com/v21.0/178/media": () => ({ id: "c" }),
      "GET graph.instagram.com/v21.0/c": () => ({ status_code: "IN_PROGRESS" }),
    });
    await runDue(env, { fetch: fetchMock, now: NOW });
    await runDue(env, { fetch: fetchMock, now: later(2 * 3600_000 + 60_000) });
    expect((await jobOf(env)).targets.instagram).toMatchObject({
      state: "failed",
      error: "timeout",
    });
  });

  it("skips a job another run has locked", async () => {
    const env = makeEnv();
    await connect(env, "threads");
    await queue(env, job({ media: undefined, targets: { threads: { caption: "hi" } } }));
    const store = Store.from(env)!;
    const jobs = await store.getJobs<PublishJob>();
    jobs.post1.lockUntil = later(60_000).toISOString();
    await store.putJobs(jobs);
    const fetchMock = mockFetch({});
    await runDue(env, { fetch: fetchMock, now: NOW });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes one job to several platforms in one run", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await connect(env, "threads");
    await queue(
      env,
      job({
        media: { url: IMAGE, kind: "image" },
        targets: { instagram: { caption: "ig" }, threads: { caption: "th" } },
      }),
    );
    const fetchMock = mockFetch({
      "POST graph.instagram.com/v21.0/178/media": () => ({ id: "ic" }),
      "GET graph.instagram.com/v21.0/ic": () => ({ status_code: "FINISHED" }),
      "POST graph.instagram.com/v21.0/178/media_publish": () => ({ id: "im" }),
      "GET graph.instagram.com/v21.0/im": () => ({ permalink: "https://www.instagram.com/p/I/" }),
      "POST graph.threads.net/v1.0/me/threads": (_u, init) => {
        expect(Object.fromEntries(formOf(init))).toMatchObject({
          media_type: "IMAGE",
          image_url: IMAGE,
          text: "th",
        });
        return { id: "tc" };
      },
      "GET graph.threads.net/v1.0/tc": () => ({ status: "FINISHED" }),
      "POST graph.threads.net/v1.0/me/threads_publish": () => ({ id: "tm" }),
      "GET graph.threads.net/v1.0/tm": () => ({ permalink: "https://www.threads.net/t/tm" }),
    });
    const r = await runDue(env, { fetch: fetchMock, now: NOW });
    expect(r.published.sort()).toEqual(["post1:instagram", "post1:threads"]);
    expect((await jobOf(env)).lockUntil).toBeUndefined();
  });
});

/* ---------- cron ---------- */

describe("runTick", () => {
  it("syncs on the 06:00–06:30 Riyadh ticks and publishes on the others", async () => {
    expect(SYNC_SLOTS).toEqual({
      "03:00": "instagram",
      "03:10": "threads",
      "03:20": "youtube",
      "03:30": "tiktok",
    });
    expect(utcSlot(Date.parse("2026-09-27T03:10:00Z"))).toBe("03:10");

    const env = makeEnv();
    // Nothing connected: the sync tick is a no-op, the publish tick finds nothing due.
    expect(
      await runTick(env, Date.parse("2026-09-27T03:00:00Z"), { fetch: mockFetch({}) }),
    ).toEqual({
      sync: { synced: [], errors: {} },
    });
    await connect(env, "threads");
    await queue(env, job({ media: undefined, targets: { threads: { caption: "hi" } } }));
    const fetchMock = mockFetch({
      "POST graph.threads.net/v1.0/me/threads": () => ({ id: "c" }),
      "GET graph.threads.net/v1.0/c": () => ({ status: "FINISHED" }),
      "POST graph.threads.net/v1.0/me/threads_publish": () => ({ id: "t" }),
      "GET graph.threads.net/v1.0/t": () => ({}),
    });
    expect(await runTick(env, NOW.getTime(), { fetch: fetchMock })).toEqual({
      publish: { advanced: ["post1:threads"], published: ["post1:threads"], failed: [] },
    });
  });
});
