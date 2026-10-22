import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { handle, type Env } from "../scout";
import { runTick } from "./cron";
import { toMs } from "./inbox";
import { instagramSendHandler } from "./inboxSendInstagram";
import { InstagramDmCoordinator } from "./instagramDmCoordinator";
import { InstagramPublicSendCoordinator } from "./instagramPublicSendCoordinator";
import { mergeJob, type JobInput, type PublishJob } from "./publish";
import { MAX_RETRIES } from "./replyCore";
import {
  CLICK_WRITES_PER_DAY,
  emptyAutomations,
  emptyClicks,
  emptyState,
  matches,
  mergeAutomation,
  normalizeForMatch,
  parseAutomationInput,
  pollReplies,
  POLL_LOCK_MS,
  PUBLIC_REPLIES_MAX,
  REPLY_CAP,
  WATCH_MAX,
  type Automation,
  type AutomationInput,
  type AutomationsDoc,
  type AutomationView,
  type ClicksDoc,
  type PollDeps,
  type PollState,
} from "./replies";
import { keys, Store } from "./store";
import type { SocialPlatform, TokenSet } from "./types";

/* ---------- fakes (same harness as publish.test.ts) ---------- */

const TOKEN = "s3cret-token";
const APP = "https://3zmd95-glitch.github.io";
const BASE = "https://3z-scout.example.workers.dev";
const NOW = new Date("2026-09-29T09:00:00Z");
const IG = "graph.instagram.com/v21.0";
const LUT = "https://3zprod.com/lut";
const ALL_REPLY_SCOPES =
  "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish,instagram_business_manage_comments,instagram_business_manage_messages";

type FakeKV = KVNamespace & { store: Map<string, string>; writes: number; written: string[] };

function fakeKV(): FakeKV {
  const store = new Map<string, string>();
  const kv = {
    store,
    writes: 0,
    written: [] as string[],
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      kv.writes += 1;
      kv.written.push(key);
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  };
  return kv as unknown as FakeKV;
}

/** From now on the KV refuses a second write to a key within a second (real time), as Cloudflare's does (429). */
function oneWritePerSecond(kv: FakeKV): void {
  const last = new Map<string, number>();
  const put = kv.put.bind(kv);
  kv.put = async (key: string, value: string) => {
    const at = Date.now();
    if (at - (last.get(key) ?? -Infinity) < 1000) {
      throw new Error("KV PUT failed: 429 Too Many Requests");
    }
    last.set(key, at);
    return put(key, value);
  };
}

/** A KV whose writes to `key` always fail. */
function failingWrites(kv: FakeKV, key: string): void {
  const put = kv.put.bind(kv);
  kv.put = async (k: string, value: string) => {
    if (k === key) throw new Error("KV PUT failed: 429 Too Many Requests");
    return put(k, value);
  };
}

function sqliteStorage(db: DatabaseSync) {
  return {
    sql: {
      exec(query: string, ...bindings: (string | number | null)[]) {
        const st = db.prepare(query);
        if (/^s*SELECT|RETURNING/i.test(query)) {
          const rows = st.all(...bindings);
          return { toArray: () => rows, rowsWritten: 0 };
        }
        return { toArray: () => [], rowsWritten: Number(st.run(...bindings).changes) };
      },
    },
    transactionSync<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const v = fn();
        db.exec("COMMIT");
        return v;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}

/**
 * DT-6B-2C-1: the public reply is claimed in the InstagramPublicSendCoordinator first. Every env gets the real class
 * over node:sqlite (one database per object name, a new instance per call); `failing` makes calls fail as an outage.
 * DT-6B-2C-2: the same harness serves the InstagramDmCoordinator (the DM authority) when given that class.
 */
function fakeCoordinator(
  Coordinator: new (ctx: never) => {
    fetch(r: Request): Promise<Response>;
  } = InstagramPublicSendCoordinator,
) {
  const dbs = new Map<string, DatabaseSync>();
  const ns = {
    names: [] as string[],
    ops: [] as string[],
    failing: new Set<string>(),
    idFromName: (name: string) => name,
    get: (id: string) => ({
      fetch: async (url: string, init: RequestInit) => {
        ns.names.push(id);
        const call = JSON.parse(String(init.body)) as { op: string };
        ns.ops.push(call.op);
        if (ns.failing.has(call.op) || ns.failing.has("*")) throw new Error("storage down");
        if (!dbs.has(id)) dbs.set(id, new DatabaseSync(":memory:"));
        const c = new Coordinator({
          storage: sqliteStorage(dbs.get(id)!),
        } as never);
        return c.fetch(new Request(url, init));
      },
    }),
  };
  return ns;
}

function makeEnv(kv: FakeKV = fakeKV()): Env & { SOCIAL_KV: FakeKV } {
  return {
    INSTAGRAM_PUBLIC_SEND_COORDINATOR: fakeCoordinator() as unknown as DurableObjectNamespace,
    // DT-6B-2C-2: rule/default DMs claim the durable DM authority first; without it they fail closed.
    INSTAGRAM_DM_COORDINATOR: fakeCoordinator(
      InstagramDmCoordinator,
    ) as unknown as DurableObjectNamespace,
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

async function connect(env: Env, platform: SocialPlatform, tokens: Partial<TokenSet> = {}) {
  const store = Store.from(env)!;
  await store.putTokens(platform, {
    accessToken: `${platform}-token`,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: platform === "instagram" ? "178" : undefined,
    canPublish: true,
    canReply: platform === "instagram",
    ...tokens,
  });
  await store.putStatus(platform, { connectedAt: NOW.toISOString(), handle: "3z.prod" });
}

type Handler = (url: URL, init: RequestInit | undefined) => unknown;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** Routes by method + host + path; handlers may be async; unmocked calls answer 404. */
function mockFetch(routes: Record<string, Handler>) {
  const fn = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    const key = `${init?.method ?? "GET"} ${url.host}${url.pathname}`;
    const handler = routes[key];
    if (!handler) return json({ error: { message: `unmocked ${key}` } }, 404);
    const out = await handler(url, init);
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

const input = (over: Partial<AutomationInput> = {}): AutomationInput => ({
  id: "lut",
  enabled: true,
  postId: "m1",
  keywords: ["لت"],
  match: "contains",
  trigger: "comment",
  publicReplies: ["أرسلته لك على الخاص 🎬"],
  followButton: false,
  dmText: "حمل اللت من الرابط تحت وجربه على لقطاتك",
  buttons: [{ title: "حمل اللت", url: LUT }],
  ...over,
});

/** Automations switched on `enabledAgoMs` before NOW (a day by default: the fake comments are minutes old). */
async function seed(
  env: Env,
  automations: AutomationInput[],
  state: Partial<PollState> = {},
  enabledAgoMs = 86_400_000,
) {
  const doc = emptyAutomations();
  for (const a of automations) {
    doc.automations[a.id] = mergeAutomation(undefined, a, new Date(NOW.getTime() - enabledAgoMs));
  }
  doc.origin = BASE;
  const store = Store.from(env)!;
  await store.putReplies(doc);
  if (Object.keys(state).length) await store.putRepliesState({ ...emptyState(), ...state });
}

const configOf = async (env: Env) => (await Store.from(env)!.getReplies<AutomationsDoc>())!;
const stateOf = async (env: Env) =>
  (await Store.from(env)!.getRepliesState<PollState>()) ?? emptyState();
const clicksOf = async (env: Env) =>
  (await Store.from(env)!.getReplyClicks<ClicksDoc>()) ?? emptyClicks();

const comment = (id: string, text: string, over: Record<string, unknown> = {}) => ({
  id,
  text,
  username: `fan_${id}`,
  from: { id: `u${id}`, username: `fan_${id}` },
  timestamp: new Date(NOW.getTime() - 10 * 60_000).toISOString(),
  ...over,
});

/** The Instagram mocks of a happy poll: /me, two posts, comments on m1, both send calls succeed. */
function igRoutes(over: Record<string, Handler> = {}, comments = [comment("c1", "ابغى اللت 🙏")]) {
  const counts: Record<string, number> = { m1: 3, m2: 0 };
  const routes: Record<string, Handler> = {
    [`GET ${IG}/me`]: () => ({ user_id: 17841, username: "3z.prod" }),
    [`GET ${IG}/17841/media`]: () => ({
      data: [
        { id: "m1", comments_count: counts.m1 },
        { id: "m2", comments_count: counts.m2 },
      ],
    }),
    [`GET ${IG}/m1`]: () => ({ id: "m1", comments_count: counts.m1 }),
    [`GET ${IG}/m1/comments`]: () => ({ data: comments }),
    [`GET ${IG}/m2/comments`]: () => ({ data: [] }),
    [`POST ${IG}/c1/replies`]: () => ({ id: "r1" }),
    // DT-6B-2C-2: a conversation DM counts as sent only with its own recipient_id; private replies keep "u1".
    [`POST ${IG}/17841/messages`]: (_u, init) => ({
      recipient_id:
        (JSON.parse(String(init?.body)) as { recipient: { id?: string } }).recipient.id ?? "u1",
      message_id: "mid1",
    }),
    ...over,
  };
  return { routes, counts };
}

const tick = (n: number) => new Date(NOW.getTime() + n * 300_000);

/** "Check now" (the dashboard's scan request), then the tick's poll: every watched post is read. */
async function checkThenPoll(env: Env, deps: PollDeps & { now: Date }) {
  await handle(req("/social/replies/poll", { method: "POST" }), env, undefined, {
    now: () => deps.now,
  });
  return pollReplies(env, deps);
}

/* ---------- DMs ---------- */

const msgAt = (minAgo: number) => new Date(NOW.getTime() - minAgo * 60_000).toISOString();
const ME = { id: "17841", username: "3z.prod" };
const dm = (id: string, text: string, over: Record<string, unknown> = {}) => ({
  id,
  message: text,
  created_time: msgAt(1),
  from: { id: "p1", username: "sara" },
  ...over,
});
/** A conversation as the Conversations API lists it: messages newest first. */
const convo = (id: string, messages: Record<string, unknown>[]) => ({
  id,
  updated_time: messages[0]?.created_time,
  messages: { data: messages },
});
const camRule = (over: Partial<AutomationInput> = {}) =>
  input({
    id: "cam",
    trigger: "message",
    postId: null,
    keywords: ["كاميرا"],
    publicReplies: [],
    dmText: "أصور بالآيفون",
    buttons: [{ title: "أدواتي", url: "https://3zprod.com/gear" }],
    ...over,
  });
/**
 * The mocks of a DM poll: /me, the conversations, and the Send API (which records what it got). DT-6B-2C-2: the Send
 * API answers the recipient it was sent to (a DM counts as sent only with exactly that recipient_id).
 */
function dmRoutes(conversations: unknown[], sent: unknown[] = []): Record<string, Handler> {
  return {
    [`GET ${IG}/me`]: () => ({ user_id: 17841, username: "3z.prod" }),
    [`GET ${IG}/17841/conversations`]: () => ({ data: conversations }),
    [`POST ${IG}/17841/messages`]: (_u, init) => {
      const body = JSON.parse(String(init?.body)) as { recipient: { id: string } };
      sent.push(body);
      return { recipient_id: body.recipient.id, message_id: `out${sent.length}` };
    },
  };
}
/** The DM side has run before: messages from the last hour are new. */
const SINCE = { inboxSince: new Date(NOW.getTime() - 3_600_000).toISOString() };

/* ---------- matching ---------- */

describe("normalizeForMatch / matches", () => {
  it.each([
    ["لت", "لت", "exact", true],
    ["ابغى اللت 🙏", "لت", "contains", true],
    ["اللت", "لت", "exact", false],
    ["لَت!", "لت", "exact", true],
    ["LUT please", "lut", "contains", true],
    ["لتحميل", "لت", "contains", true],
    ["أبغى", "ابغى", "exact", true],
    ["شكرا", "لت", "contains", false],
    ["", "لت", "contains", false],
  ] as const)("%j vs %j (%s) → %s", (text, keyword, match, want) => {
    expect(matches(text, { keywords: [keyword], match })).toBe(want);
  });

  it("strips diacritics, tatweel, punctuation and emoji and folds alef/yaa", () => {
    expect(normalizeForMatch("  أَهْلاً… بِكُم! 🎬 ")).toBe("اهلا بكم");
    expect(normalizeForMatch("عـلـى")).toBe("علي");
  });
});

/* ---------- validation ---------- */

describe("parseAutomationInput", () => {
  it("accepts the LUT automation with the defaults filled in", () => {
    const r = parseAutomationInput({ id: "lut", keywords: [" لت "], dmText: "x", postId: null });
    expect(r).toEqual({
      ok: true,
      automation: {
        id: "lut",
        enabled: true,
        trigger: "comment",
        postId: null,
        keywords: ["لت"],
        match: "contains",
        publicReplies: [],
        dmText: "x",
        buttons: [],
        followButton: false,
      },
    });
  });

  it.each([
    [{ ...input(), id: "bad id" }, "id"],
    [{ ...input(), id: "poll" }, "id"],
    [{ ...input(), postId: 12 }, "postId"],
    [{ ...input(), keywords: [] }, "keywords"],
    [{ ...input(), keywords: ["🙏"] }, "keywords"],
    [{ ...input(), keywords: ["x".repeat(41)] }, "keywords"],
    [{ ...input(), keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }, "keywords"],
    [{ ...input(), match: "fuzzy" }, "match"],
    [{ ...input(), dmText: "   " }, "dmText"],
    [{ ...input(), dmText: "x".repeat(1001) }, "dmText"],
    [{ ...input(), buttons: Array.from({ length: 4 }, () => ({ title: "t", url: LUT })) }, "buttons"],
    [{ ...input(), buttons: [{ title: "t", url: "http://3zprod.com/lut" }] }, "buttons.url"],
    [{ ...input(), buttons: [{ url: LUT }] }, "buttons.title"],
  ])("refuses %j → %s", (body, detail) => {
    expect(parseAutomationInput(body)).toEqual({ ok: false, detail });
  });
});

describe("mergeAutomation", () => {
  it("keeps the creation time and stamps enabledAt when switched on", () => {
    const first = mergeAutomation(undefined, input(), NOW);
    expect(first.enabledAt).toBe(NOW.toISOString());
    expect(first).not.toHaveProperty("stats");
    const later = new Date(NOW.getTime() + 60_000);
    const off = mergeAutomation(first, input({ enabled: false }), later);
    expect(off).toMatchObject({ enabled: false, createdAt: NOW.toISOString() });
    expect(off.enabledAt).toBe(NOW.toISOString());
    const on = mergeAutomation(off, input(), new Date(later.getTime() + 60_000));
    expect(on.enabledAt).toBe(new Date(later.getTime() + 60_000).toISOString());
  });
});

describe("parseAutomationInput (v2)", () => {
  const ar = (n: number) => "ل".repeat(n);
  const b = { title: "t", url: LUT };

  it("keeps the v2 fields, and a message rule keeps no post and no public replies", () => {
    const r = parseAutomationInput(
      { ...input(), trigger: "message", followButton: true, title: "x", buttons: [] },
      BASE,
    );
    expect(r).toMatchObject({
      ok: true,
      automation: { trigger: "message", postId: null, publicReplies: [], followButton: true },
    });
    expect(r.ok && r.automation).not.toHaveProperty("title");
  });

  it("reads a v1 dashboard's single publicReply as one public reply", () => {
    const v1: Record<string, unknown> = { ...input() };
    delete v1.publicReplies;
    expect(parseAutomationInput({ ...v1, publicReply: " هلا " }, BASE)).toMatchObject({
      ok: true,
      automation: { publicReplies: ["هلا"] },
    });
  });

  it("accepts 500 Arabic letters without buttons (1,000 bytes) and 640 characters with a button", () => {
    expect(parseAutomationInput({ ...input(), buttons: [], dmText: ar(500) }, BASE).ok).toBe(true);
    expect(parseAutomationInput({ ...input(), dmText: "x".repeat(640) }, BASE).ok).toBe(true);
  });

  it.each([
    [{ ...input(), trigger: "story" }, "trigger"],
    [{ ...input(), publicReplies: ["a", "b", "c", "d"] }, "publicReplies"],
    [{ ...input(), publicReplies: [7] }, "publicReplies"],
    [{ ...input(), followButton: true, buttons: [b, b, b] }, "buttons"],
    [{ ...input(), buttons: [], dmText: ar(501) }, "dmText"],
    [{ ...input(), dmText: "x".repeat(641) }, "dmText"],
    [{ ...input(), id: "settings" }, "id"],
    [{ ...input(), id: "default" }, "id"],
  ])("refuses %j → %s", (body, detail) => {
    expect(parseAutomationInput(body, BASE)).toEqual({ ok: false, detail });
  });

  it("allows three public replies and drops the blank ones", () => {
    expect(PUBLIC_REPLIES_MAX).toBe(3);
    expect(parseAutomationInput({ ...input(), publicReplies: ["أ", " ", "ب"] }, BASE)).toMatchObject({
      ok: true,
      automation: { publicReplies: ["أ", "ب"] },
    });
  });
});

describe("v1 documents", () => {
  it("read as comment rules with their one public reply and no follow button", async () => {
    const env = makeEnv();
    await Store.from(env)!.putReplies({
      v: 1,
      origin: BASE,
      automations: {
        lut: {
          id: "lut",
          enabled: true,
          postId: "m1",
          keywords: ["لت"],
          match: "contains",
          publicReply: "أرسلته لك",
          dmText: "x",
          buttons: [],
          createdAt: NOW.toISOString(),
          updatedAt: NOW.toISOString(),
          enabledAt: NOW.toISOString(),
        },
      },
    });
    const body = (await (await handle(req("/social/replies"), env)).json()) as {
      automations: Record<string, unknown>[];
      paused: boolean;
    };
    expect(body.paused).toBe(false);
    expect(body.automations[0]).toMatchObject({
      trigger: "comment",
      publicReplies: ["أرسلته لك"],
      followButton: false,
    });
    expect(body.automations[0]).not.toHaveProperty("publicReply");
  });
});

describe("/social/replies/settings", () => {
  it("saves pause and the default reply, stamping enabledAt when it is switched on", async () => {
    const env = makeEnv();
    const post = (json: unknown, at = NOW) =>
      handle(req("/social/replies/settings", { method: "POST", json }), env, undefined, {
        now: () => at,
      });
    let res = await post({ paused: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ paused: true, automations: [] });

    res = await post({ defaultReply: { enabled: true, text: " وصلت رسالتك " } });
    expect(await res.json()).toMatchObject({
      paused: true,
      defaultReply: {
        enabled: true,
        text: "وصلت رسالتك",
        enabledAt: NOW.toISOString(),
        stats: { sends: 0 },
      },
    });

    const later = new Date(NOW.getTime() + 60_000);
    await post({ defaultReply: { enabled: false, text: "وصلت رسالتك" } }, later);
    const config = await configOf(env);
    expect(config.defaultReply).toEqual({
      enabled: false,
      text: "وصلت رسالتك",
      enabledAt: NOW.toISOString(),
      updatedAt: later.toISOString(),
    });
    expect(config.paused).toBe(true);
    expect(config.origin).toBe(BASE);
  });

  it.each([
    [{ paused: "yes" }, "paused"],
    [{ defaultReply: { enabled: true, text: " " } }, "defaultReply"],
    [{ defaultReply: { enabled: true, text: "ل".repeat(501) } }, "defaultReply"],
    [{ defaultReply: { text: "x" } }, "defaultReply"],
    [{ defaultReply: { enabled: false, text: 5 } }, "defaultReply"],
    [{ defaultReply: { enabled: false } }, "defaultReply"],
  ])("refuses %j → %s", async (json, detail) => {
    const res = await handle(req("/social/replies/settings", { method: "POST", json }), makeEnv());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_request", detail });
  });
});

/* ---------- OAuth: allowing auto-replies ---------- */

describe("connect with replies: true", () => {
  async function allowReplies(env: Env, permissions: string | undefined) {
    const res = await handle(
      req("/social/connect/instagram", {
        method: "POST",
        json: { returnTo: `${APP}/settings/`, replies: true },
      }),
      env,
      undefined,
      { now: () => NOW },
    );
    const url = new URL(((await res.json()) as { url: string }).url);
    const state = url.searchParams.get("state")!;
    const fetchMock = mockFetch({
      "POST api.instagram.com/oauth/access_token": () => ({
        access_token: "ig-short",
        user_id: 178,
        ...(permissions ? { permissions } : {}),
      }),
      "GET graph.instagram.com/access_token": () => ({
        access_token: "ig-long",
        expires_in: 5_184_000,
      }),
    });
    const back = await handle(
      new Request(`${BASE}/oauth/instagram/callback?code=c&state=${state}`),
      env,
      undefined,
      { fetch: fetchMock, now: () => NOW },
    );
    return { url, back };
  }

  it("asks Instagram for the comment and message scopes on top of the posting ones", async () => {
    const env = makeEnv();
    const { url, back } = await allowReplies(env, ALL_REPLY_SCOPES);
    expect(url.searchParams.get("scope")).toBe(ALL_REPLY_SCOPES);
    // The one-time state is consumed by the callback.
    expect(env.SOCIAL_KV.store.has(keys.state(url.searchParams.get("state")!))).toBe(false);
    expect(back.headers.get("Location")).toContain("connected=instagram");
    expect(await Store.from(env)!.getTokens("instagram")).toMatchObject({
      canPublish: true,
      canReply: true,
    });
    const status = (await (await handle(req("/social/status"), env)).json()) as {
      platforms: Record<string, { canPublish: boolean; canReply: boolean }>;
    };
    expect(status.platforms.instagram).toMatchObject({ canPublish: true, canReply: true });
    expect(status.platforms.threads.canReply).toBe(false);
  });

  it("does not claim the permission when the owner unticked a reply scope in Meta's dialog", async () => {
    const env = makeEnv();
    await allowReplies(
      env,
      "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish,instagram_business_manage_comments",
    );
    expect(await Store.from(env)!.getTokens("instagram")).toMatchObject({
      canPublish: true,
      canReply: false,
    });
  });

  it("trusts the request when Instagram sends no permission list", async () => {
    const env = makeEnv();
    await allowReplies(env, undefined);
    expect((await Store.from(env)!.getTokens("instagram"))?.canReply).toBe(true);
  });

  it("is refused for a platform without reply scopes", async () => {
    const res = await handle(
      req("/social/connect/youtube", {
        method: "POST",
        json: { returnTo: `${APP}/settings/`, replies: true },
      }),
      makeEnv(),
    );
    expect(res.status).toBe(400);
  });
});

/* ---------- routes ---------- */

describe("/social/replies", () => {
  it("needs the bearer token", async () => {
    const res = await handle(
      new Request(`${BASE}/social/replies`, { headers: { Origin: APP } }),
      makeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("stores an automation with the Worker's origin, lists it with its counters, deletes it", async () => {
    const env = makeEnv();
    const saved = await handle(req("/social/replies", { method: "POST", json: input() }), env);
    expect(saved.status).toBe(200);
    const { automation } = (await saved.json()) as { automation: AutomationView };
    expect(automation).toMatchObject({ id: "lut", stats: { sends: 0, clicks: 0 } });
    const config = await configOf(env);
    expect(config.origin).toBe(BASE);
    expect(config.automations.lut).not.toHaveProperty("stats");

    // Counters live with the poller and the /go counter; the listing merges them in.
    await Store.from(env)!.putRepliesState({
      ...emptyState(),
      handled: { c9: NOW.toISOString() },
      stats: { lut: { sends: 2, publicReplies: 1, failures: 0, clicks: 0 } },
    });
    await Store.from(env)!.putReplyClicks({ ...emptyClicks(), byAutomation: { lut: 5 } });
    const listed = (await (await handle(req("/social/replies"), env)).json()) as Record<
      string,
      unknown
    >;
    expect(listed).toMatchObject({
      automations: [expect.objectContaining({ id: "lut", stats: { sends: 2, publicReplies: 1, failures: 0, clicks: 5 } })],
      log: [],
    });
    expect(listed).not.toHaveProperty("handled");

    const bad = await handle(
      req("/social/replies", { method: "POST", json: { ...input(), dmText: "" } }),
      env,
    );
    expect(await bad.json()).toEqual({ error: "bad_request", detail: "dmText" });

    expect((await handle(req("/social/replies/lut", { method: "DELETE" }), env)).status).toBe(200);
    expect((await configOf(env)).automations).toEqual({});
    expect((await handle(req("/social/replies/lut/x", { method: "DELETE" }), env)).status).toBe(404);
  });

  it("POST /social/replies/poll asks the next tick for a full scan and leaves the poll's state alone", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const fetchMock = mockFetch(igRoutes().routes);
    // m1 was read at its current count and the hourly full scan is not due: a tick reads nothing.
    await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect((await pollReplies(env, { fetch: fetchMock, now: tick(1) })).checked).toBe(0);
    const calls = fetchMock.calls().length;

    const before = env.SOCIAL_KV.written.length;
    const res = await handle(req("/social/replies/poll", { method: "POST" }), env, undefined, {
      fetch: fetchMock,
      now: () => tick(1),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      scanRequested: true,
      automations: [
        expect.objectContaining({ id: "lut", stats: expect.objectContaining({ sends: 1 }) }),
      ],
    });
    expect(body).not.toHaveProperty("result");
    // Only the dashboard's document is written; nothing is asked of Instagram.
    expect(env.SOCIAL_KV.written.slice(before)).toEqual([keys.replies]);
    expect((await configOf(env)).scanRequestedAt).toBe(tick(1).toISOString());
    expect(fetchMock.calls()).toHaveLength(calls);

    // The next tick reads every watched post although no count changed; the one after is back to normal.
    expect((await pollReplies(env, { fetch: fetchMock, now: tick(2) })).checked).toBe(1);
    expect((await pollReplies(env, { fetch: fetchMock, now: tick(3) })).checked).toBe(0);
  });
});

/* ---------- the poll ---------- */

describe("pollReplies", () => {
  it("DMs a matching comment, then replies publicly, then leaves it alone", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ postId: null })]);
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer instagram-token");
        expect(JSON.parse(String(init?.body))).toEqual({
          recipient: { comment_id: "c1" },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "generic",
                elements: [
                  {
                    title: "حمل اللت من الرابط تحت وجربه على لقطاتك",
                    default_action: { type: "web_url", url: `${BASE}/go/lut/0` },
                    buttons: [{ type: "web_url", url: `${BASE}/go/lut/0`, title: "حمل اللت" }],
                  },
                ],
              },
            },
          },
        });
        return { message_id: "mid1" };
      },
      [`POST ${IG}/c1/replies`]: (_u, init) => {
        const form = new URLSearchParams(String(init?.body));
        expect(form.get("message")).toBe("أرسلته لك على الخاص 🎬");
        expect(form.get("access_token")).toBe("instagram-token");
        return { id: "r1" };
      },
    });
    const fetchMock = mockFetch(routes);
    const before = env.SOCIAL_KV.written.length;
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r).toEqual({ checked: 2, sent: ["c1"], failed: [] });
    expect(fetchMock.calls()).toEqual([
      `GET ${IG}/me`,
      `GET ${IG}/17841/media`,
      `GET ${IG}/m1/comments`,
      `GET ${IG}/m2/comments`,
      `POST ${IG}/17841/messages`,
      `POST ${IG}/c1/replies`,
    ]);
    const state = await stateOf(env);
    expect(state).toMatchObject({
      igUserId: "17841",
      ownerUsername: "3z.prod",
      handled: { c1: NOW.toISOString() },
      watch: { m1: { count: 3 }, m2: { count: 0 } },
      lastPollAt: NOW.toISOString(),
      stats: { lut: { sends: 1, publicReplies: 1, failures: 0 } },
    });
    expect(state.lockUntil).toBeUndefined();
    expect(state.log[0]).toMatchObject({
      kind: "comment",
      automationId: "lut",
      commentId: "c1",
      username: "fan_c1",
      publicReply: "sent",
      dm: "sent",
    });
    expect(state.sent).toEqual({ mid1: { to: "uc1", at: NOW.toISOString() } });
    // The poller writes only its own document: the lock, then the result.
    expect(env.SOCIAL_KV.written.slice(before)).toEqual([keys.repliesState, keys.repliesState]);

    // Same counts a tick later: no comment read, no send, no KV write.
    const writes = env.SOCIAL_KV.writes;
    const again = await pollReplies(env, { fetch: fetchMock, now: tick(1) });
    expect(again).toEqual({ checked: 0, sent: [], failed: [] });
    expect(fetchMock.calls().slice(6)).toEqual([`GET ${IG}/17841/media`]);
    expect(env.SOCIAL_KV.writes).toBe(writes);
  });

  it("reads only the posts whose comment count changed, and everything once an hour", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ postId: null })]);
    const { routes, counts } = igRoutes();
    const fetchMock = mockFetch(routes);
    await pollReplies(env, { fetch: fetchMock, now: NOW });
    counts.m2 = 1;
    await pollReplies(env, { fetch: fetchMock, now: tick(1) });
    expect(fetchMock.calls().filter((c) => c.endsWith("/comments")).slice(2)).toEqual([
      `GET ${IG}/m2/comments`,
    ]);
    await pollReplies(env, { fetch: fetchMock, now: new Date(NOW.getTime() + 61 * 60_000) });
    expect(fetchMock.calls().filter((c) => c.endsWith("/comments")).slice(3)).toEqual([
      `GET ${IG}/m1/comments`,
      `GET ${IG}/m2/comments`,
    ]);
  });

  it("looks a specific post up when it is not among the newest ones", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ postId: "old9" })]);
    const { routes } = igRoutes({
      [`GET ${IG}/old9`]: () => ({ id: "old9", comments_count: 1 }),
      [`GET ${IG}/old9/comments`]: () => ({ data: [comment("c1", "لت")] }),
    });
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(fetchMock.calls()).toEqual([
      `GET ${IG}/me`,
      `GET ${IG}/old9`,
      `GET ${IG}/old9/comments`,
      `POST ${IG}/17841/messages`,
      `POST ${IG}/c1/replies`,
    ]);
  });

  it("reads every watched post on a full scan: the five newest plus three specific ones", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [
      input({ id: "any", postId: null, publicReplies: [] }),
      input({ id: "s1", postId: "old1", publicReplies: [] }),
      input({ id: "s2", postId: "old2", publicReplies: [] }),
      input({ id: "s3", postId: "old3", publicReplies: [] }),
    ]);
    const routes: Record<string, Handler> = {
      [`GET ${IG}/me`]: () => ({ user_id: 17841, username: "3z.prod" }),
      [`GET ${IG}/17841/media`]: () => ({
        data: ["n1", "n2", "n3", "n4", "n5"].map((id) => ({ id, comments_count: 1 })),
      }),
    };
    for (const id of ["n1", "n2", "n3", "n4", "n5", "old1", "old2", "old3"]) {
      routes[`GET ${IG}/${id}`] = () => ({ id, comments_count: 1 });
      routes[`GET ${IG}/${id}/comments`] = () => ({ data: [] });
    }
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(WATCH_MAX).toBe(8);
    expect(r.checked).toBe(8);
    expect(fetchMock.calls().filter((c) => c.endsWith("/comments"))).toHaveLength(8);
    expect((await stateOf(env)).lastFullScanAt).toBe(NOW.toISOString());
  });

  it("skips the owner's own comments, old comments, comments from before enabling, and other words", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    // Switched on a minute ago; the comments that count came in after that.
    await seed(env, [input()], {}, 60_000);
    const fresh = new Date(NOW.getTime() - 10_000).toISOString();
    const old = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    const beforeEnable = new Date(NOW.getTime() - 3 * 60_000).toISOString();
    const { routes } = igRoutes({}, [
      comment("own", "لت", {
        username: "3z.prod",
        from: { id: "17841", username: "3z.prod" },
        timestamp: fresh,
      }),
      comment("old", "لت", { timestamp: old }),
      comment("early", "لت", { timestamp: beforeEnable }),
      comment("other", "حلو 🔥", { timestamp: fresh }),
      comment("c1", "لت", { timestamp: fresh }),
    ]);
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect((await stateOf(env)).handled).toEqual({ c1: NOW.toISOString() });
  });

  it("does nothing without enabled automations, a connection, the permission, or while locked", async () => {
    const env = makeEnv();
    const fetchMock = mockFetch({});
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({ skipped: "none" });
    await seed(env, [input({ enabled: false })]);
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({ skipped: "none" });
    await seed(env, [input()]);
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({
      skipped: "not_connected",
    });
    expect((await stateOf(env)).lastError).toBe("not_connected");
    await connect(env, "instagram", { canReply: false });
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({
      skipped: "no_permission",
    });
    expect((await stateOf(env)).lastError).toBe("no_permission");
    await connect(env, "instagram");
    await seed(env, [input()], { lockUntil: new Date(NOW.getTime() + 60_000).toISOString() });
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({ skipped: "locked" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a token older than 30 days first and keeps the permissions on it", async () => {
    const env = makeEnv();
    await connect(env, "instagram", {
      issuedAt: new Date(NOW.getTime() - 31 * 86_400_000).toISOString(),
    });
    await seed(env, [input({ postId: null, publicReplies: [] })]);
    const { routes } = igRoutes({
      "GET graph.instagram.com/refresh_access_token": (u) => {
        expect(u.searchParams.get("grant_type")).toBe("ig_refresh_token");
        return { access_token: "ig-new", expires_in: 5_184_000 };
      },
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer ig-new");
        return { message_id: "mid1" };
      },
    });
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(fetchMock.calls()[0]).toBe("GET graph.instagram.com/refresh_access_token");
    expect(await Store.from(env)!.getTokens("instagram")).toMatchObject({
      accessToken: "ig-new",
      canReply: true,
      canPublish: true,
    });

    // A refused refresh means "reconnect": nothing else is tried.
    const env2 = makeEnv();
    await connect(env2, "instagram", {
      issuedAt: new Date(NOW.getTime() - 31 * 86_400_000).toISOString(),
    });
    await seed(env2, [input()]);
    const refused = mockFetch({
      "GET graph.instagram.com/refresh_access_token": () =>
        json({ error: { message: "Invalid OAuth", code: 190 } }, 400),
    });
    expect(await pollReplies(env2, { fetch: refused, now: NOW })).toMatchObject({
      skipped: "token_expired",
      error: "token_expired",
    });
    expect(refused.calls()).toHaveLength(1);
    expect((await stateOf(env2)).lastError).toBe("token_expired");
  });

  it("never posts the public reply when the DM failed, and never re-posts it on a retry", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    let dm: () => unknown = () => json({ error: { message: "boom", code: 1 } }, 500);
    const { routes } = igRoutes({ [`POST ${IG}/17841/messages`]: () => dm() }, [comment("c1", "لت")]);
    const fetchMock = mockFetch(routes);
    for (let i = 0; i < 2; i++) await checkThenPoll(env, { fetch: fetchMock, now: tick(i) });
    expect(fetchMock.calls()).not.toContain(`POST ${IG}/c1/replies`);
    let state = await stateOf(env);
    expect(state.retries.c1).toBe(2);
    expect(state.log[0]).toMatchObject({ dm: "failed", publicReply: "skipped", error: "upstream" });

    // The third try succeeds: DM, then exactly one public reply.
    dm = () => ({ message_id: "mid1" });
    await checkThenPoll(env, { fetch: fetchMock, now: tick(2) });
    expect(fetchMock.calls().filter((c) => c === `POST ${IG}/c1/replies`)).toHaveLength(1);
    state = await stateOf(env);
    expect(state.handled).toHaveProperty("c1");
    expect(state.stats.lut).toMatchObject({ sends: 1, publicReplies: 1, failures: 2 });

    // Later re-reads of the same post never touch c1 again.
    await checkThenPoll(env, { fetch: fetchMock, now: tick(3) });
    expect(fetchMock.calls().filter((c) => c === `POST ${IG}/c1/replies`)).toHaveLength(1);
    expect(fetchMock.calls().filter((c) => c === `POST ${IG}/17841/messages`)).toHaveLength(3);
  });

  it("a failed public reply after a sent DM is logged once and not retried", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const { routes } = igRoutes(
      { [`POST ${IG}/c1/replies`]: () => json({ error: { message: "nope", code: 1 } }, 500) },
      [comment("c1", "لت")],
    );
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    const state = await stateOf(env);
    expect(state.handled).toHaveProperty("c1");
    expect(state.log[0]).toMatchObject({ dm: "sent", publicReply: "failed", error: "upstream" });
    expect(state.stats.lut).toMatchObject({ sends: 1, publicReplies: 0 });
    await checkThenPoll(env, { fetch: fetchMock, now: tick(1) });
    expect(fetchMock.calls().filter((c) => c === `POST ${IG}/c1/replies`)).toHaveLength(1);
  });

  it("maps Instagram's answers: expired token and rate limit stop, refusals are final, glitches retry", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] })]);
    let dm: () => unknown = () => json({ error: { message: "Invalid OAuth", code: 190 } }, 400);
    const { routes } = igRoutes(
      { [`POST ${IG}/17841/messages`]: () => dm() },
      [comment("c1", "لت")],
    );
    const fetchMock = mockFetch(routes);

    expect((await pollReplies(env, { fetch: fetchMock, now: tick(0) })).failed).toEqual(["c1"]);
    let state = await stateOf(env);
    expect(state.lastError).toBe("token_expired");
    expect(state.handled).toEqual({});
    expect(state.log[0]).toMatchObject({
      dm: "failed",
      error: "token_expired",
      detail: "Invalid OAuth [190]",
    });

    dm = () => json({ error: { message: "slow down", code: 4 } }, 400);
    await checkThenPoll(env, { fetch: fetchMock, now: tick(1) });
    state = await stateOf(env);
    expect(state.lastError).toBe("rate_limited");
    expect(state.handled).toEqual({});

    dm = () => json({ error: { message: "User cannot be messaged", code: 100 } }, 400);
    expect((await checkThenPoll(env, { fetch: fetchMock, now: tick(2) })).failed).toEqual(["c1"]);
    state = await stateOf(env);
    expect(state.handled).toHaveProperty("c1");
    expect(state.lastError).toBeUndefined();
    expect(state.log[0]).toMatchObject({
      error: "rejected",
      detail: "User cannot be messaged [100]",
    });
    expect(state.stats.lut.failures).toBe(3);
  });

  it("tells app-level permission problems from per-comment refusals by Meta's subcodes", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] })]);
    // Factories, not Responses: a Response body can be read once, and the same refusal repeats over ticks.
    const answers: Record<string, () => unknown> = {};
    const { routes } = igRoutes(
      {
        [`POST ${IG}/17841/messages`]: (_u, init) => {
          const id = JSON.parse(String(init?.body)).recipient.comment_id as string;
          return answers[id]?.() ?? { message_id: "ok" };
        },
      },
      [
        comment("c1", "لت"),
        comment("c2", "لت", { timestamp: new Date(NOW.getTime() - 9 * 60_000).toISOString() }),
        comment("c3", "لت", { timestamp: new Date(NOW.getTime() - 8 * 60_000).toISOString() }),
      ],
    );
    // c1: the private-reply refusal; c2: outside the messaging window; c3: this recipient cannot be messaged.
    answers.c1 = () =>
      json(
        {
          error: {
            message: "The comment is invalid for a private reply",
            code: 100,
            error_subcode: 2534025,
          },
        },
        400,
      );
    answers.c2 = () =>
      json({ error: { message: "outside window", code: 10, error_subcode: 2534022 } }, 400);
    answers.c3 = () =>
      json(
        {
          error: {
            message: "They can't receive your messages right now",
            code: 10,
            error_subcode: 2018108,
          },
        },
        400,
      );
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.failed).toEqual(["c1", "c2", "c3"]);
    let state = await stateOf(env);
    expect(Object.keys(state.handled).sort()).toEqual(["c1", "c2", "c3"]);
    expect(state.lastError).toBeUndefined();
    const codes = Object.fromEntries(state.log.map((e) => [e.commentId, e.error]));
    expect(codes).toEqual({ c1: "not_eligible", c2: "not_eligible", c3: "rejected" });

    // A bare code 10 is the app's problem: the tick stops, but the same comment cannot block forever.
    routes[`GET ${IG}/m1/comments`] = () => ({ data: [comment("c4", "لت"), comment("c5", "لت", { timestamp: new Date(NOW.getTime() - 9 * 60_000).toISOString() })] });
    answers.c4 = () => json({ error: { message: "permission denied", code: 10 } }, 403);
    for (let i = 1; i <= 3; i++) {
      await checkThenPoll(env, { fetch: fetchMock, now: tick(i) });
      state = await stateOf(env);
      expect(state.lastError).toBe("no_permission");
    }
    expect(state.handled).toHaveProperty("c4");
    expect(state.retries).toEqual({});
    // c5 waited behind c4 and goes out once c4 is given up on.
    await checkThenPoll(env, { fetch: fetchMock, now: tick(4) });
    expect((await stateOf(env)).handled).toHaveProperty("c5");
  });

  it("a code 10 on the comments read is a permission problem, not an expired token", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const { routes } = igRoutes({
      [`GET ${IG}/m1/comments`]: () =>
        json({ error: { message: "(#10) Application does not have permission", code: 10 } }, 403),
    });
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.error).toBe("no_permission");
    expect(await stateOf(env)).toMatchObject({
      lastError: "no_permission",
      lastErrorDetail: "(#10) Application does not have permission [10]",
    });
  });

  it("one deleted post or one failed comments read does not stop the others", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [
      input({ id: "gone", postId: "deleted9", publicReplies: [] }),
      input({ id: "any", postId: null, publicReplies: [] }),
    ]);
    let m1 = () => ({ data: [comment("c1", "لت")] }) as unknown;
    const { routes } = igRoutes({
      [`GET ${IG}/deleted9`]: () =>
        json({ error: { message: "Unsupported get request", code: 100, error_subcode: 33 } }, 400),
      [`GET ${IG}/m1/comments`]: () => m1(),
      [`GET ${IG}/m2/comments`]: () => ({ data: [comment("c2", "لت")] }),
    });
    const fetchMock = mockFetch(routes);

    // Dead post: noted on its automation, the rest is read and answered.
    let r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent.sort()).toEqual(["c1", "c2"]);
    let state = await stateOf(env);
    expect(state.stats.gone.lastError).toBe("rejected");
    expect(state.stats.any).toMatchObject({ sends: 2 });

    // One post's comments cannot be read: the other post is still answered, the failing one is retried next tick.
    routes[`GET ${IG}/m2/comments`] = () => ({ data: [comment("c3", "لت")] });
    m1 = () => json({ error: { message: "boom", code: 1 } }, 500);
    r = await checkThenPoll(env, { fetch: fetchMock, now: tick(1) });
    expect(r).toMatchObject({ checked: 1, sent: ["c3"], error: "upstream" });
    state = await stateOf(env);
    expect(state.watch).not.toHaveProperty("m1");
    m1 = () => ({ data: [comment("c1", "لت"), comment("c4", "لت")] });
    r = await pollReplies(env, { fetch: fetchMock, now: tick(2) });
    expect(fetchMock.calls().slice(-3)).toContain(`GET ${IG}/m1/comments`);
    expect(r.sent).toEqual(["c4"]);
  });

  it("answers at most REPLY_CAP comments a tick and picks the rest up on the very next tick", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] })]);
    const many = Array.from({ length: 12 }, (_, i) =>
      comment(`c${i}`, "لت", { timestamp: new Date(NOW.getTime() - (20 - i) * 60_000).toISOString() }),
    );
    const { routes } = igRoutes({}, many);
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toHaveLength(REPLY_CAP);
    // The post is not stamped as done, so the next tick re-reads it without a count change.
    expect((await stateOf(env)).watch).not.toHaveProperty("m1");
    const rest = await pollReplies(env, { fetch: fetchMock, now: tick(1) });
    expect(rest).toMatchObject({ checked: 1 });
    expect(rest.sent).toHaveLength(12 - REPLY_CAP);
    expect((await stateOf(env)).watch.m1).toMatchObject({ count: 3 });

    const tight = mockFetch(igRoutes({}, many).routes);
    const env2 = makeEnv();
    await connect(env2, "instagram");
    await seed(env2, [input({ publicReplies: [] })]);
    await pollReplies(env2, { fetch: tight, now: NOW, budget: 3 });
    expect(tight.calls().length).toBeLessThanOrEqual(3);
  });

  it("holds a lock while answering, so a save during the poll is kept and a second poll waits", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] })]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { routes } = igRoutes(
      {
        [`POST ${IG}/17841/messages`]: async () => {
          await gate;
          return { message_id: "mid1" };
        },
      },
      [comment("c1", "لت")],
    );
    const fetchMock = mockFetch(routes);
    const running = pollReplies(env, { fetch: fetchMock, now: NOW });
    // Let the poll reach the DM (it has read the comments and taken the lock).
    for (let i = 0; i < 20 && !(await stateOf(env)).lockUntil; i++) await new Promise((r) => setTimeout(r, 1));
    const locked = await stateOf(env);
    expect(Date.parse(locked.lockUntil!)).toBe(NOW.getTime() + POLL_LOCK_MS);

    // Meanwhile the owner switches the automation off and adds another one…
    await handle(req("/social/replies", { method: "POST", json: input({ enabled: false }) }), env);
    await handle(req("/social/replies", { method: "POST", json: input({ id: "lut2", keywords: ["preset"] }) }), env);
    // …and an overlapping poll starts: it waits instead of answering the same comment.
    expect(await pollReplies(env, { fetch: mockFetch({}), now: tick(0) })).toMatchObject({ skipped: "locked" });

    release();
    expect((await running).sent).toEqual(["c1"]);
    const config = await configOf(env);
    expect(config.automations.lut.enabled).toBe(false);
    expect(config.automations.lut2).toBeDefined();
    const state = await stateOf(env);
    expect(state.lockUntil).toBeUndefined();
    expect(state.handled).toHaveProperty("c1");
    expect(fetchMock.calls().filter((c) => c === `POST ${IG}/17841/messages`)).toHaveLength(1);
  });

  it("forgets answered comments and their retry counts after seven days", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    const eightDays = new Date(NOW.getTime() - 8 * 86_400_000).toISOString();
    await seed(env, [input()], {
      handled: { gone: eightDays, kept: NOW.toISOString() },
      retries: { gone: 2 },
    });
    await pollReplies(env, { fetch: mockFetch(igRoutes({}, []).routes), now: NOW });
    const state = await stateOf(env);
    expect(Object.keys(state.handled)).toEqual(["kept"]);
    expect(state.retries).toEqual({});
  });

  it("drops the counters of automations the owner deleted", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()], {
      stats: { lut: { sends: 1, publicReplies: 1, failures: 0, clicks: 0 }, old: { sends: 9, publicReplies: 0, failures: 0, clicks: 0 } },
    });
    await pollReplies(env, { fetch: mockFetch(igRoutes({}, []).routes), now: NOW });
    expect(Object.keys((await stateOf(env)).stats)).toEqual(["lut"]);
  });

  it("picks one of the public replies at random", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: ["أ", "ب", "ج"] })]);
    let said = "";
    const { routes } = igRoutes({
      [`POST ${IG}/c1/replies`]: (_u, init) => {
        said = new URLSearchParams(String(init?.body)).get("message") ?? "";
        return { id: "r1" };
      },
    });
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW, random: () => 0.5 });
    expect(said).toBe("ب");
  });

  it("leaves comments to comment rules: a message rule with the same word does not answer them", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ id: "dm", trigger: "message", postId: null, publicReplies: [] })]);
    const fetchMock = mockFetch(igRoutes().routes);
    expect((await pollReplies(env, { fetch: fetchMock, now: NOW })).sent).toEqual([]);
    expect(fetchMock.calls()).not.toContain(`POST ${IG}/17841/messages`);
  });

  it("lists the account's username once a poll has read it", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    await pollReplies(env, { fetch: mockFetch(igRoutes().routes), now: NOW });
    const body = (await (await handle(req("/social/replies"), env)).json()) as Record<string, unknown>;
    expect(body.ownerUsername).toBe("3z.prod");
  });

  it("adds «تابعني» after the links once the account's username is known", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ followButton: true })]);
    let sent: unknown;
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return { message_id: "mid1" };
      },
    });
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(sent).toMatchObject({
      message: {
        attachment: {
          payload: {
            elements: [
              {
                buttons: [
                  { type: "web_url", url: `${BASE}/go/lut/0`, title: "حمل اللت" },
                  { type: "web_url", url: "https://www.instagram.com/3z.prod/", title: "تابعني" },
                ],
              },
            ],
          },
        },
      },
    });
  });

  it("sends plain text when the rule has no buttons", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ buttons: [] })]);
    let sent: unknown;
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return { message_id: "mid1" };
      },
    });
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(sent).toEqual({
      recipient: { comment_id: "c1" },
      message: { text: "حمل اللت من الرابط تحت وجربه على لقطاتك" },
    });
  });

  it("sends the links as lines when Instagram refuses a generic card in a private reply", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ followButton: true })]);
    const bodies: unknown[] = [];
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? json({ error: { code: 100, error_subcode: 2534015, message: "Invalid message data" } }, 400)
          : { message_id: "mid1" };
      },
    });
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      message: { attachment: { payload: { template_type: "generic" } } },
    });
    expect(bodies[1]).toEqual({
      recipient: { comment_id: "c1" },
      message: {
        text: `حمل اللت من الرابط تحت وجربه على لقطاتك\n\nحمل اللت: ${BASE}/go/lut/0\nتابعني: https://www.instagram.com/3z.prod/`,
      },
    });
  });

  it("does not retry an identical plain-text message when long text with links is refused", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    const text = "ل".repeat(81);
    await seed(env, [input({ dmText: text })]);
    const bodies: unknown[] = [];
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return json({ error: { code: 100, error_subcode: 2534015, message: "Invalid message data" } }, 400);
      },
    });
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.failed).toEqual(["c1"]);
    expect(bodies).toEqual([
      {
        recipient: { comment_id: "c1" },
        message: { text: `${text}\n\nحمل اللت: ${BASE}/go/lut/0` },
      },
    ]);
    expect(fetchMock.calls()).not.toContain(`POST ${IG}/c1/replies`);
    expect((await stateOf(env)).log[0]).toMatchObject({ dm: "failed", error: "rejected" });
  });

  it("does not resend as text when the comment already had its private reply", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const { routes } = igRoutes({
      [`POST ${IG}/17841/messages`]: () =>
        json(
          {
            error: {
              code: 100,
              error_subcode: 2534025,
              message: "The comment is invalid for a private reply",
            },
          },
          400,
        ),
    });
    const fetchMock = mockFetch(routes);
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.failed).toEqual(["c1"]);
    expect(fetchMock.calls().filter((c) => c === `POST ${IG}/17841/messages`)).toHaveLength(1);
    expect((await stateOf(env)).log[0]).toMatchObject({ dm: "failed", error: "not_eligible" });
  });

  it("forgets the ids of its own sends after a day", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    const old = new Date(NOW.getTime() - 25 * 3_600_000).toISOString();
    await seed(env, [input()], { sent: { mid0: { to: "p0", at: old } } });
    await pollReplies(env, { fetch: mockFetch(igRoutes().routes), now: NOW });
    expect((await stateOf(env)).sent).toEqual({ mid1: { to: "u1", at: NOW.toISOString() } });
  });

  it("reads a state saved before round 34 (no sent ids) and records its sends in it", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    await Store.from(env)!.putRepliesState({ v: 1, watch: {}, handled: {}, retries: {}, stats: {}, log: [] });
    await pollReplies(env, { fetch: mockFetch(igRoutes().routes), now: NOW });
    expect((await stateOf(env)).sent).toEqual({ mid1: { to: "u1", at: NOW.toISOString() } });
  });

  it("records each send under the Send API's recipient_id, else the commenter or person it went to", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] }), camRule()], SINCE);
    let n = 0;
    const { routes } = igRoutes({
      ...dmRoutes([convo("t1", [dm("d1", "كاميرا")])]),
      [`POST ${IG}/17841/messages`]: (_u, init) => {
        n += 1;
        const to = JSON.parse(String(init?.body)).recipient;
        // DT-6B-2C-2: a conversation DM is proven only by the conversation's own recipient id (p1).
        return { recipient_id: to.comment_id ? "igsid-c1" : to.id, message_id: `out${n}` };
      },
    });
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect((await stateOf(env)).sent).toEqual({
      out1: { to: "igsid-c1", at: NOW.toISOString() },
      out2: { to: "p1", at: NOW.toISOString() },
    });
  });

  it("drops expired send ids without a write of their own (an idle poll writes nothing)", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    const old = new Date(NOW.getTime() - 25 * 3_600_000).toISOString();
    // Nothing new: the account is known, the post's count is the one last seen, the hourly full scan is not due.
    await seed(env, [input()], {
      igUserId: "17841",
      ownerUsername: "3z.prod",
      watch: { m1: { count: 3, seenAt: NOW.toISOString() } },
      lastFullScanAt: NOW.toISOString(),
      sent: { mid0: { to: "p0", at: old } },
    });
    const writes = env.SOCIAL_KV.writes;
    const r = await pollReplies(env, { fetch: mockFetch(igRoutes().routes), now: NOW });
    expect(r).toEqual({ checked: 0, sent: [], failed: [] });
    expect(env.SOCIAL_KV.writes).toBe(writes);
  });
});

describe("pollReplies: DMs and story replies", () => {
  it("the first DM poll only notes the time; nothing older is ever answered", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()]);
    const fetchMock = mockFetch(dmRoutes([convo("t1", [dm("d1", "كاميرا؟")])]));
    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toEqual([]);
    expect(fetchMock.calls()).not.toContain(`GET ${IG}/17841/conversations`);
    expect((await stateOf(env)).inboxSince).toBe(NOW.toISOString());
  });

  it("answers a DM keyword with the rule's text, buttons and «تابعني», once", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule({ followButton: true })], SINCE);
    const sent: unknown[] = [];
    const convos = [convo("t1", [dm("d1", "إيش الكاميرا اللي تستخدمها؟")])];
    const r = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos, sent)), now: NOW });
    expect(r.sent).toEqual(["d1"]);
    expect(sent[0]).toEqual({
      recipient: { id: "p1" },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "generic",
            elements: [
              {
                title: "أصور بالآيفون",
                default_action: { type: "web_url", url: `${BASE}/go/cam/0` },
                buttons: [
                  { type: "web_url", url: `${BASE}/go/cam/0`, title: "أدواتي" },
                  { type: "web_url", url: "https://www.instagram.com/3z.prod/", title: "تابعني" },
                ],
              },
            ],
          },
        },
      },
    });
    const state = await stateOf(env);
    expect(state.convos.t1).toEqual({ seenAt: msgAt(1) });
    expect(state.stats.cam).toMatchObject({ sends: 1 });
    expect(state.sent.out1).toEqual({ to: "p1", at: NOW.toISOString() });
    expect(state.log[0]).toMatchObject({
      kind: "message",
      automationId: "cam",
      messageId: "d1",
      username: "sara",
      dm: "sent",
      publicReply: "skipped",
    });

    // The next poll finds only the account's own reply, as Instagram lists it: no send, no KV write.
    const writes = env.SOCIAL_KV.writes;
    const withReply = [
      convo("t1", [
        dm("out1", "أصور بالآيفون", { from: ME, created_time: msgAt(0) }),
        dm("d1", "إيش الكاميرا اللي تستخدمها؟"),
      ]),
    ];
    const again = await pollReplies(env, { fetch: mockFetch(dmRoutes(withReply)), now: tick(1) });
    expect(again.sent).toEqual([]);
    expect(env.SOCIAL_KV.writes).toBe(writes);
  });

  it("answers a story reply with the keyword (logged as story) and leaves story mentions alone", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const sent: unknown[] = [];
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes(
          [
            convo("t1", [dm("d1", "كاميرا", { story: { reply_to: { id: "s1", link: "https://cdn/x" } } })]),
            convo("t2", [
              dm("d2", "", { from: { id: "p2" }, story: { mention: { id: "s2", link: "https://cdn/y" } } }),
            ]),
          ],
          sent,
        ),
      ),
      now: NOW,
    });
    expect(r.sent).toEqual(["d1"]);
    expect(sent).toHaveLength(1);
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({ kind: "story", messageId: "d1" });
    expect(state.convos.t2).toEqual({ seenAt: msgAt(1) });
  });

  it("sends the default reply once per person a day, never to story replies or emoji-only messages", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [], SINCE);
    const store = Store.from(env)!;
    await store.putReplies({
      ...(await configOf(env)),
      defaultReply: {
        enabled: true,
        text: "وصلت رسالتك",
        enabledAt: SINCE.inboxSince,
        updatedAt: SINCE.inboxSince,
      },
    });
    const sent: unknown[] = [];
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes(
          [
            convo("t1", [dm("d2", "وينك"), dm("d1", "هلا عز", { created_time: msgAt(2) })]),
            convo("t2", [dm("d3", "🔥", { from: { id: "p2" } })]),
            convo("t3", [dm("d4", "حلو", { from: { id: "p3" }, story: { reply_to: { id: "s1" } } })]),
          ],
          sent,
        ),
      ),
      now: NOW,
    });
    expect(r.sent).toEqual(["d1"]);
    expect(sent).toEqual([{ recipient: { id: "p1" }, message: { text: "وصلت رسالتك" } }]);
    const state = await stateOf(env);
    expect(state.defaultSentAt).toEqual({ p1: NOW.toISOString() });
    expect(state.stats.default).toMatchObject({ sends: 1 });
    expect(state.log[0]).toMatchObject({ kind: "default", automationId: "default" });
    expect(state.convos).toEqual({
      t1: { seenAt: msgAt(1) },
      t2: { seenAt: msgAt(1) },
      t3: { seenAt: msgAt(1) },
    });
  });

  it("stays quiet where the owner wrote by hand in the last day, but not after the poll's own sends", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], {
      ...SINCE,
      sent: { out9: { to: "p2", at: msgAt(5) }, out8: { to: "p3", at: msgAt(5) } },
    });
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes([
          // The owner answered by hand an hour ago.
          convo("t1", [dm("d1", "كاميرا"), dm("h1", "هلا والله", { from: ME, created_time: msgAt(60) })]),
          // The account's message is the poll's own send, by id.
          convo("t2", [
            dm("d2", "كاميرا", { from: { id: "p2" } }),
            dm("out9", "أصور بالآيفون", { from: ME, created_time: msgAt(5) }),
          ]),
          // The same, matched by time: Instagram's id differs, a minute after the send to p3.
          convo("t3", [
            dm("d3", "كاميرا", { from: { id: "p3" } }),
            dm("x7", "أصور بالآيفون", { from: ME, created_time: msgAt(4) }),
          ]),
          // The owner by hand under an id that is not /me's user_id: the account's username gives it away.
          convo("t4", [
            dm("d4", "كاميرا", { from: { id: "p4" } }),
            dm("h4", "هلا", { from: { id: "999", username: "3z.prod" }, created_time: msgAt(30) }),
          ]),
        ]),
      ),
      now: NOW,
    });
    expect(r.sent).toEqual(["d2", "d3"]);
    expect((await stateOf(env)).convos.t1).toEqual({ seenAt: msgAt(1) });
  });

  it("leaves alone messages from before the rule was on and messages older than a day", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], { inboxSince: msgAt(48 * 60) }, 30 * 60_000);
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes([
          convo("t1", [dm("d1", "كاميرا", { created_time: msgAt(45) })]),
          convo("t2", [dm("d2", "كاميرا", { from: { id: "p2" }, created_time: msgAt(25 * 60) })]),
        ]),
      ),
      now: NOW,
    });
    expect(r.sent).toEqual([]);
    // t2's only message is older than a day: no position is kept for it.
    expect(Object.keys((await stateOf(env)).convos)).toEqual(["t1"]);
  });

  it("answers at most REPLY_CAP DMs a poll and the rest on the next one", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const convos = Array.from({ length: 10 }, (_, i) =>
      convo(`t${i}`, [dm(`d${i}`, "كاميرا", { from: { id: `p${i}` } })]),
    );
    const r = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos)), now: NOW });
    expect(r.sent).toHaveLength(REPLY_CAP);
    const next = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos)), now: tick(1) });
    expect(next.sent).toEqual(["d8", "d9"]);
  });

  it("a refusal is final for its message; a 5xx after the claim is unknown delivery, final and never re-sent", async () => {
    // DT-6B-2C-2 (deliberate change): the 5xx used to be retried; once claimed, a message is never sent again.
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    let n = 0;
    const routes = {
      ...dmRoutes([
        convo("t1", [dm("d1", "كاميرا")]),
        convo("t2", [dm("d2", "كاميرا", { from: { id: "p2" } })]),
      ]),
      [`POST ${IG}/17841/messages`]: () => {
        n += 1;
        return n === 1
          ? json(
              {
                error: {
                  code: 10,
                  error_subcode: 2534022,
                  message: "This message is sent outside of allowed window.",
                },
              },
              400,
            )
          : json({ error: { message: "boom" } }, 500);
      },
    };
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.failed).toEqual(["d1", "d2"]);
    const state = await stateOf(env);
    expect(state.convos.t1).toEqual({ seenAt: msgAt(1) });
    expect(state.convos.t2).toEqual({ seenAt: msgAt(1) });
    expect(state.retries).toEqual({});
    expect(state.log.map((e) => e.error)).toEqual(["upstream", "not_eligible"]);
    expect(state.log[0]).toMatchObject({
      messageId: "d2",
      dm: "failed",
      detail: "unknown-delivery",
    });
    expect(state.stats.cam).toMatchObject({ sends: 0, failures: 1 });
    // A later poll that sees both messages again (positions lost) sends nothing: both are claimed.
    await Store.from(env)!.putRepliesState({ ...state, convos: {}, lockUntil: undefined });
    await pollReplies(env, { fetch: mockFetch(routes), now: tick(1) });
    expect(n).toBe(2);
    expect((await stateOf(env)).log[0]).toMatchObject({ dm: "skipped", detail: "already_claimed" });
  });

  it("a conversations read that fails leaves the comments alone and is the poll's error until a read works", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input(), camRule()], SINCE);
    const { routes } = igRoutes({
      [`GET ${IG}/17841/conversations`]: () => json({ error: { message: "boom", code: 2 } }, 500),
    });
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(r).toMatchObject({ error: "upstream", detail: "boom [2]" });
    expect(await stateOf(env)).toMatchObject({
      lastError: "upstream",
      lastErrorDetail: "boom [2]",
    });
    const listed = await (await handle(req("/social/replies"), env)).json();
    expect(listed).toMatchObject({ lastError: "upstream", lastErrorDetail: "boom [2]" });

    routes[`GET ${IG}/17841/conversations`] = () => ({ data: [] });
    await pollReplies(env, { fetch: mockFetch(routes), now: tick(1) });
    const state = await stateOf(env);
    expect(state.lastError).toBeUndefined();
    expect(state.lastErrorDetail).toBeUndefined();
  });

  it("a stopper on the conversations read waits for the comments to be answered, then ends the poll", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] }), camRule()], SINCE);
    const { routes } = igRoutes({
      [`GET ${IG}/17841/conversations`]: () =>
        json({ error: { message: "slow down", code: 613 } }, 400),
    });
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r).toMatchObject({ sent: ["c1"], error: "rate_limited", detail: "slow down [613]" });
    expect(await stateOf(env)).toMatchObject({
      handled: { c1: NOW.toISOString() },
      lastError: "rate_limited",
      lastErrorDetail: "slow down [613]",
    });
  });

  it("a stop while answering is the poll's error rather than a failed conversations read", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] }), camRule()], SINCE);
    const { routes } = igRoutes({
      [`GET ${IG}/17841/conversations`]: () => json({ error: { message: "boom", code: 2 } }, 500),
      [`POST ${IG}/17841/messages`]: () => json({ error: { message: "slow down", code: 4 } }, 400),
    });
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.failed).toEqual(["c1"]);
    expect(await stateOf(env)).toMatchObject({
      lastError: "rate_limited",
      lastErrorDetail: "slow down [4]",
    });
  });

  it("fails loudly when the conversations come back without the messages' times or senders", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const words =
      "conversations: messages came without created_time/from — the field expansion was not returned";
    for (const messages of [[{ id: "d1" }, { id: "d2" }], [{ id: "d1", created_time: msgAt(1) }]]) {
      const sent: unknown[] = [];
      const r = await pollReplies(env, {
        fetch: mockFetch(dmRoutes([{ id: "t1", messages: { data: messages } }], sent)),
        now: NOW,
      });
      expect(r).toMatchObject({ error: "upstream", detail: words });
      expect(sent).toEqual([]);
      expect(await stateOf(env)).toMatchObject({ lastError: "upstream", lastErrorDetail: words });
    }
  });

  it("forgets day-old conversation positions and default replies, without a write of their own", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    // Nothing new: the account is known and no conversation moved.
    await seed(env, [camRule()], {
      ...SINCE,
      igUserId: "17841",
      ownerUsername: "3z.prod",
      convos: {
        t0: { seenAt: msgAt(8 * 24 * 60) },
        t9: { seenAt: msgAt(25 * 60) },
        t1: { seenAt: msgAt(60) },
      },
      defaultSentAt: { p0: msgAt(25 * 60), p1: msgAt(60) },
    });
    const writes = env.SOCIAL_KV.writes;
    await pollReplies(env, { fetch: mockFetch(dmRoutes([])), now: NOW });
    expect(env.SOCIAL_KV.writes).toBe(writes);
    // They leave with the next real write.
    const news = [convo("t2", [dm("d2", "كاميرا", { from: { id: "p2" } })])];
    await pollReplies(env, { fetch: mockFetch(dmRoutes(news)), now: NOW });
    const state = await stateOf(env);
    expect(Object.keys(state.convos).sort()).toEqual(["t1", "t2"]);
    expect(state.defaultSentAt).toEqual({ p1: msgAt(60) });
  });

  it("an old conversation still listed costs no write once its position is gone", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    // The DM side has run for 10 days; t1's last message, 8 days old, was handled and t1 is still listed.
    await seed(env, [camRule()], {
      inboxSince: msgAt(10 * 24 * 60),
      igUserId: "17841",
      ownerUsername: "3z.prod",
      convos: { t1: { seenAt: msgAt(8 * 24 * 60) } },
    });
    const list = [
      convo("t1", [dm("d1", "هلا", { created_time: msgAt(8 * 24 * 60) })]),
      convo("t2", [dm("d2", "كاميرا", { from: { id: "p2" } })]),
    ];
    // The answer in t2 saves the state without t1's week-old position.
    await pollReplies(env, { fetch: mockFetch(dmRoutes(list)), now: NOW });
    expect((await stateOf(env)).convos).not.toHaveProperty("t1");
    const writes = env.SOCIAL_KV.writes;
    for (let i = 1; i <= 3; i++) {
      await pollReplies(env, { fetch: mockFetch(dmRoutes(list)), now: tick(i) });
    }
    expect(env.SOCIAL_KV.writes).toBe(writes);
  });

  it("a DM refused for permission stops the poll and, once claimed, is final: never sent again", async () => {
    // DT-6B-2C-2 (deliberate change): it used to be re-sent up to MAX_RETRIES times; a claimed message is not.
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], { ...SINCE, igUserId: "17841", ownerUsername: "3z.prod" });
    let sends = 0;
    const routes = {
      ...dmRoutes([convo("t1", [dm("d1", "كاميرا")])]),
      [`POST ${IG}/17841/messages`]: () => {
        sends += 1;
        return json({ error: { code: 10, message: "Application does not have permission" } }, 403);
      },
    };
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect((await stateOf(env)).lastError).toBe("no_permission");
    for (let i = 1; i < 5; i++) await pollReplies(env, { fetch: mockFetch(routes), now: tick(i) });
    expect(sends).toBe(1);
    const state = await stateOf(env);
    expect(state.retries).toEqual({});
    expect(state.convos.t1).toEqual({ seenAt: msgAt(1) });
    expect(state.log.map((e) => e.error)).toEqual(["no_permission"]);
  });

  it("retries a DM whose claim store glitched (nothing claimed) and gives up after MAX_RETRIES tries", async () => {
    // DT-6B-2C-2: the retry rule now applies before a claim only (here: the DM authority is unreadable); no POST.
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    (env.INSTAGRAM_DM_COORDINATOR as unknown as { failing: Set<string> }).failing.add("*");
    let sends = 0;
    const routes = {
      ...dmRoutes([convo("t1", [dm("d1", "كاميرا")])]),
      [`POST ${IG}/17841/messages`]: () => {
        sends += 1;
        return json({ error: { message: "boom" } }, 500);
      },
    };
    const poll = (i: number) => pollReplies(env, { fetch: mockFetch(routes), now: tick(i) });
    await poll(0);
    expect((await stateOf(env)).retries).toEqual({ d1: 1 });
    expect((await stateOf(env)).log[0]).toMatchObject({
      dm: "failed",
      error: "not_configured",
      detail: "dm-claim-store",
    });
    await poll(1);
    await poll(2);
    const state = await stateOf(env);
    expect(state.retries).toEqual({});
    expect(state.convos.t1).toEqual({ seenAt: msgAt(1) });
    await poll(3);
    expect(state.log).toHaveLength(MAX_RETRIES);
    expect(sends).toBe(0);
  });

  it("a DM that fails for good leaves no retry count behind", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    // DT-6B-2C-2: the first failure is now a pre-claim one (an unreadable DM authority), the only kind retried.
    const store = env.INSTAGRAM_DM_COORDINATOR as unknown as { failing: Set<string> };
    store.failing.add("*");
    const answer = () =>
      json({ error: { message: "outside window", code: 10, error_subcode: 2534022 } }, 400);
    const routes = {
      ...dmRoutes([convo("t1", [dm("d1", "كاميرا")])]),
      [`POST ${IG}/17841/messages`]: () => answer(),
    };
    await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect((await stateOf(env)).retries).toEqual({ d1: 1 });
    // The retry is refused for good (outside the window): final, and its count goes with it.
    store.failing.clear();
    await pollReplies(env, { fetch: mockFetch(routes), now: tick(1) });
    const state = await stateOf(env);
    expect(state.retries).toEqual({});
    expect(state.convos.t1).toEqual({ seenAt: msgAt(1) });
  });

  it("drops a DM's retry count once it is handled without an answer", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const d1 = dm("d1", "كاميرا");
    // DT-6B-2C-2: a pre-claim failure (an unreadable DM authority) is the one that leaves a retry count.
    const store = env.INSTAGRAM_DM_COORDINATOR as unknown as { failing: Set<string> };
    store.failing.add("*");
    await pollReplies(env, {
      fetch: mockFetch({
        ...dmRoutes([convo("t1", [d1])]),
        [`POST ${IG}/17841/messages`]: () => json({ error: { message: "boom" } }, 500),
      }),
      now: NOW,
    });
    expect((await stateOf(env)).retries).toEqual({ d1: 1 });
    store.failing.clear();
    // The owner answers by hand before the next poll: d1 is left alone, and its count goes.
    const byHand = convo("t1", [dm("h1", "هلا والله", { from: ME, created_time: msgAt(0) }), d1]);
    await pollReplies(env, { fetch: mockFetch(dmRoutes([byHand])), now: tick(1) });
    const state = await stateOf(env);
    expect(state.retries).toEqual({});
    expect(state.convos.t1).toEqual({ seenAt: msgAt(0) });
  });

  it("takes no lock for DMs that nothing answers: one write, for the position", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], { ...SINCE, igUserId: "17841", ownerUsername: "3z.prod" });
    const before = env.SOCIAL_KV.written.length;
    const list = [convo("t1", [dm("d1", "هلا")])];
    const r = await pollReplies(env, { fetch: mockFetch(dmRoutes(list)), now: NOW });
    expect(r.sent).toEqual([]);
    expect(env.SOCIAL_KV.written.slice(before)).toEqual([keys.repliesState]);
    expect((await stateOf(env)).convos.t1).toEqual({ seenAt: msgAt(1) });
  });

  it("shares the answer cap with the comments: 6 comments and 2 DMs, the other DMs on the next poll", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] }), camRule()], SINCE);
    const comments = Array.from({ length: 6 }, (_, i) => comment(`c${i}`, "لت"));
    const convos = Array.from({ length: 4 }, (_, i) =>
      convo(`t${i}`, [dm(`d${i}`, "كاميرا", { from: { id: `p${i}` } })]),
    );
    const { routes } = igRoutes(
      { [`GET ${IG}/17841/conversations`]: () => ({ data: convos }) },
      comments,
    );
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(REPLY_CAP).toBe(8);
    expect(r.sent).toEqual(["c0", "c1", "c2", "c3", "c4", "c5", "d0", "d1"]);
    const next = await pollReplies(env, { fetch: mockFetch(routes), now: tick(1) });
    expect(next.sent).toEqual(["d2", "d3"]);
  });

  it("reads message times as ISO 8601 or UNIX seconds", () => {
    const ms = Date.parse("2026-09-29T08:59:00Z");
    expect(toMs("2026-09-29T08:59:00Z")).toBe(ms);
    expect(toMs(ms / 1000)).toBe(ms);
    expect(toMs(String(ms / 1000))).toBe(ms);
    expect(toMs(undefined)).toBeNaN();
  });

  it("keeps the default reply's counters when it drops a deleted rule's", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    const zero = { sends: 1, publicReplies: 0, failures: 0, clicks: 0 };
    await seed(env, [input()], { stats: { default: zero, gone: zero } });
    await pollReplies(env, { fetch: mockFetch(igRoutes().routes), now: NOW });
    const { stats } = await stateOf(env);
    expect(stats.default).toBeDefined();
    expect(stats.gone).toBeUndefined();
  });
});

describe("pause and the write guard", () => {
  const today = NOW.toISOString().slice(0, 10);

  it("answers nothing while paused", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    await Store.from(env)!.putReplies({ ...(await configOf(env)), paused: true });
    const fetchMock = mockFetch(igRoutes().routes);
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({ skipped: "paused" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("counts its writes per UTC day; from 300 it skips the off-grid minutes", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()], { writes: { day: today, count: 300 } });
    const fetchMock = mockFetch(igRoutes().routes);
    expect(
      await pollReplies(env, { fetch: fetchMock, now: NOW, fiveMinuteTick: false }),
    ).toMatchObject({ skipped: "guard" });
    expect(fetchMock).not.toHaveBeenCalled();

    const r = await pollReplies(env, { fetch: fetchMock, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    // The lock, then the result.
    expect((await stateOf(env)).writes).toEqual({ day: today, count: 302 });
    const listed = (await (
      await handle(req("/social/replies"), env, undefined, { now: () => NOW })
    ).json()) as Record<string, unknown>;
    expect(listed.guard).toBe("slow");
  });

  it("from 600 it answers nothing until the next UTC day", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()], { writes: { day: today, count: 600 } });
    const fetchMock = mockFetch(igRoutes().routes);
    expect(await pollReplies(env, { fetch: fetchMock, now: NOW })).toMatchObject({ skipped: "guard" });
    const tomorrow = new Date(NOW.getTime() + 86_400_000);
    expect((await pollReplies(env, { fetch: fetchMock, now: tomorrow })).sent).toEqual(["c1"]);
  });
});

/* ---------- KV refuses a second write to a key within a second ---------- */

describe("KV's one write per key per second", () => {
  it("a poll that answers a comment and a DM saves its result although it wrote the lock a moment before", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] }), camRule()], SINCE);
    const { routes } = igRoutes(dmRoutes([convo("t1", [dm("d1", "كاميرا")])]));
    oneWritePerSecond(env.SOCIAL_KV);
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r).toMatchObject({ sent: ["c1", "d1"], failed: [] });
    expect(r.error).toBeUndefined();
    const state = await stateOf(env);
    expect(state.handled).toHaveProperty("c1");
    expect(Object.keys(state.sent).sort()).toEqual(["out1", "out2"]);
    expect(state.log.map((e) => e.kind)).toEqual(["message", "comment"]);
    expect(state.convos.t1).toEqual({ seenAt: msgAt(1) });
    expect(state.lockUntil).toBeUndefined();
  });

  it("a result that cannot be saved is logged and reported, never thrown", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    failingWrites(env.SOCIAL_KV, keys.repliesState);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // Nothing to answer, but the account id is new: one write, the result.
      const r = await pollReplies(env, { fetch: mockFetch(igRoutes({}, []).routes), now: NOW });
      expect(r).toMatchObject({ error: "upstream", detail: expect.stringContaining("429") });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("429"));
    } finally {
      log.mockRestore();
    }
  });
});

/* ---------- cron ---------- */

describe("cron tick", () => {
  const tickAt = (hhmm: string) => Date.parse(`2026-09-29T${hhmm}:00Z`);

  it("polls the comments on a publish tick that moved nothing", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const fetchMock = mockFetch(igRoutes().routes);
    const r = await runTick(env, tickAt("09:00"), { fetch: fetchMock, now: NOW });
    expect(r).toMatchObject({ publish: { advanced: [] }, replies: { sent: ["c1"] } });
  });

  it("leaves the comments alone while the queue is publishing, and on sync slots", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const store = Store.from(env)!;
    const job: JobInput = {
      id: "post1",
      scheduledAt: NOW.toISOString(),
      media: { url: "https://cdn.example/clip.mp4", kind: "video" },
      targets: { instagram: { caption: "hi" } },
    };
    await store.putJobs<PublishJob>({ post1: mergeJob(undefined, job, NOW) });
    const fetchMock = mockFetch({
      ...igRoutes().routes,
      [`POST ${IG}/17841/media`]: () => ({ id: "cont1" }),
    });
    const r = await runTick(env, tickAt("09:00"), { fetch: fetchMock, now: NOW });
    expect(r).toMatchObject({ publish: { advanced: ["post1:instagram"] } });
    expect(r).not.toHaveProperty("replies");
    expect(fetchMock.calls()).not.toContain(`GET ${IG}/m1/comments`);

    const sync = await runTick(env, tickAt("03:00"), { fetch: mockFetch({}), now: NOW });
    expect(sync).toHaveProperty("sync");
    expect(sync).not.toHaveProperty("replies");
  });

  it("polls only the replies on minutes off the five-minute grid", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const r = await runTick(env, tickAt("09:01"), { fetch: mockFetch(igRoutes().routes), now: NOW });
    expect(r).toMatchObject({ replies: { sent: ["c1"] } });
    expect(r).not.toHaveProperty("publish");
  });

  it("the write guard's slow mode skips the off-grid minutes only", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()], { writes: { day: "2026-09-29", count: 300 } });
    const fetchMock = mockFetch(igRoutes().routes);
    expect(await runTick(env, tickAt("09:01"), { fetch: fetchMock, now: NOW })).toMatchObject({
      replies: { skipped: "guard" },
    });
    expect(await runTick(env, tickAt("09:05"), { fetch: fetchMock, now: NOW })).toMatchObject({
      replies: { sent: ["c1"] },
    });
  });
});

/* ---------- /go ---------- */

describe("GET /go/:id/:n", () => {
  const go = (env: Env, path: string, ip = "1.2.3.4", cache: Cache | null = null, now = NOW) =>
    handle(new Request(`${BASE}${path}`, { headers: { "CF-Connecting-IP": ip } }), env, undefined, {
      now: () => now,
      cache,
    });

  it("counts the tap in its own document and redirects without a bearer token", async () => {
    const env = makeEnv();
    await seed(env, [input()]);
    const res = await go(env, "/go/lut/0");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(LUT);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await clicksOf(env)).toMatchObject({ day: "2026-09-29", today: 1, byAutomation: { lut: 1 } });
    expect(env.SOCIAL_KV.written).toEqual([keys.replies, keys.replyClicks]);
    expect((await handle(new Request(`${BASE}/go/lut/9`), env)).status).toBe(404);
    expect((await handle(new Request(`${BASE}/go/nope/0`), env)).status).toBe(404);
    const listed = (await (await handle(req("/social/replies"), env)).json()) as {
      automations: AutomationView[];
    };
    expect(listed.automations[0].stats.clicks).toBe(1);
  });

  it("stops counting after the daily cap but keeps redirecting", async () => {
    const env = makeEnv();
    await seed(env, [input()]);
    await Store.from(env)!.putReplyClicks({ ...emptyClicks(), day: "2026-09-29", today: CLICK_WRITES_PER_DAY });
    const writes = env.SOCIAL_KV.writes;
    const res = await go(env, "/go/lut/0");
    expect(res.status).toBe(302);
    expect(env.SOCIAL_KV.writes).toBe(writes);
    const tomorrow = await go(env, "/go/lut/0", "1.2.3.4", null, new Date(NOW.getTime() + 86_400_000));
    expect(tomorrow.status).toBe(302);
    expect(await clicksOf(env)).toMatchObject({ day: "2026-09-30", today: 1, byAutomation: { lut: 1 } });
  });

  it("redirects even when the tap cannot be counted", async () => {
    const env = makeEnv();
    await seed(env, [input()]);
    failingWrites(env.SOCIAL_KV, keys.replyClicks);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await go(env, "/go/lut/0");
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe(LUT);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("429"));
    } finally {
      log.mockRestore();
    }
  });

  it("counts one tap per visitor per link per minute when a cache is available", async () => {
    const env = makeEnv();
    await seed(env, [input()]);
    const seen = new Map<string, Response>();
    const cache = {
      async match(k: Request) {
        return seen.get(k.url);
      },
      async put(k: Request, r: Response) {
        seen.set(k.url, r);
      },
    } as unknown as Cache;
    await go(env, "/go/lut/0", "1.2.3.4", cache);
    await go(env, "/go/lut/0", "1.2.3.4", cache);
    await go(env, "/go/lut/0", "1.2.3.4", cache);
    expect((await clicksOf(env)).byAutomation.lut).toBe(1);
    await go(env, "/go/lut/0", "5.6.7.8", cache);
    expect((await clicksOf(env)).byAutomation.lut).toBe(2);
    expect((await go(env, "/go/lut/0", "1.2.3.4", cache)).status).toBe(302);
  });
});

/* ---------- typing aid ---------- */

// The stored automation never carries counters; the view does.
const _typeCheck: (a: Automation) => AutomationView = (a) => ({ ...a, stats: { sends: 0, publicReplies: 0, failures: 0, clicks: 0 } });
void _typeCheck;

/* ---------- DT-6B-2C-1: the shared public-reply effect ---------- */

describe("pollReplies: the public reply claims the shared (account, comment) effect first", () => {
  type Coord = ReturnType<typeof fakeCoordinator>;
  const coordOf = (env: Env) => env.INSTAGRAM_PUBLIC_SEND_COORDINATOR as unknown as Coord;
  const coordinate = async (env: Env, call: Record<string, unknown>) => {
    const ns = env.INSTAGRAM_PUBLIC_SEND_COORDINATOR!;
    const res = await ns.get(ns.idFromName("instagram|17841")).fetch("https://c/", {
      method: "POST",
      body: JSON.stringify({ now: NOW.getTime(), ...call }),
    });
    return (await res.json()) as Record<string, unknown>;
  };
  const effectOf = (env: Env, commentId = "c1") =>
    coordinate(env, { op: "getEffect", account: "17841", commentId });
  const publicPosts = (f: ReturnType<typeof mockFetch>) =>
    f.calls().filter((c) => c === `POST ${IG}/c1/replies`);
  /** The manual route with an injected eligibility (production stays closed). */
  const manual = (env: Env, f: typeof fetch, path: string, b: unknown) =>
    instagramSendHandler({ fetch: f, now: () => NOW, eligibility: () => ({ ok: true }) })(
      new Request(`${BASE}/social/inbox/instagram/send${path}`, {
        method: "POST",
        body: JSON.stringify(b),
      }),
      path.split("/").filter(Boolean),
      { store: Store.from(env), coordinator: env.INSTAGRAM_PUBLIC_SEND_COORDINATOR },
      { json: (body, status) => json(body, status) },
    ).then(
      async (r) => (await r!.json()) as { intent?: Record<string, unknown> & { digest: string } },
    );
  const prepareManual = (env: Env, f: typeof fetch, operationId = "op-manual-01") =>
    manual(env, f, "/prepare", {
      operationId,
      account: "17841",
      mediaId: "m1",
      commentId: "c1",
      text: "Thanks!",
      draftRevision: "rev-1",
    });

  it("claims as auto:<rule> before the one POST and records the provider reply id; the DM went first", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const f = mockFetch(igRoutes({}, [comment("c1", "لت")]).routes);
    const r = await pollReplies(env, { fetch: f, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(f.calls().slice(-2)).toEqual([`POST ${IG}/17841/messages`, `POST ${IG}/c1/replies`]);
    expect(coordOf(env).ops).toEqual(["claimAuto", "settle"]);
    expect(coordOf(env).names).toEqual(["instagram|17841", "instagram|17841"]);
    expect(await effectOf(env)).toMatchObject({
      effect: { actor: "auto:lut", state: "sent", providerReplyId: "r1" },
    });
  });

  it("manual first: the poll still sends its DM, skips the public reply as already_claimed, posts nothing public", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const f = mockFetch(igRoutes({}, [comment("c1", "لت")]).routes);
    const prepared = await prepareManual(env, f);
    const confirmed = await manual(env, f, "/confirm", {
      operationId: "op-manual-01",
      digest: prepared.intent!.digest,
      account: "17841",
    });
    expect(confirmed.intent!.state).toBe("sent");
    expect(publicPosts(f)).toHaveLength(1);
    const r = await pollReplies(env, { fetch: f, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(publicPosts(f)).toHaveLength(1);
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({
      dm: "sent",
      publicReply: "skipped",
      detail: "already_claimed",
    });
    expect(state.log[0].error).toBeUndefined();
    expect(state.handled).toHaveProperty("c1");
    expect(state.stats.lut).toMatchObject({ sends: 1, publicReplies: 0 });
    expect(await effectOf(env)).toMatchObject({
      effect: { actor: "manual:op-manual-01", state: "sent" },
    });
  });

  it("poll first: a manual confirm on the same comment is already_claimed and posts nothing", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const f = mockFetch(igRoutes({}, [comment("c1", "لت")]).routes);
    const prepared = await prepareManual(env, f);
    await pollReplies(env, { fetch: f, now: NOW });
    expect(publicPosts(f)).toHaveLength(1);
    const confirmed = await manual(env, f, "/confirm", {
      operationId: "op-manual-01",
      digest: prepared.intent!.digest,
      account: "17841",
    });
    expect(confirmed.intent).toMatchObject({
      state: "already_claimed",
      failureDetail: "automatic",
    });
    expect(publicPosts(f)).toHaveLength(1);
  });

  it("duplicate poll ticks (a lost result re-answers the comment) claim the public reply once", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const f = mockFetch(igRoutes({}, [comment("c1", "لت")]).routes);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // The first tick's result is never saved, so the next tick does not know c1 was answered.
      const put = env.SOCIAL_KV.put.bind(env.SOCIAL_KV);
      let lockWritten = false;
      env.SOCIAL_KV.put = async (k: string, v: string) => {
        if (k === keys.repliesState) {
          if (lockWritten) throw new Error("KV PUT failed: 429 Too Many Requests");
          lockWritten = true;
        }
        return put(k, v);
      };
      await pollReplies(env, { fetch: f, now: NOW });
      env.SOCIAL_KV.put = put;
      await env.SOCIAL_KV.delete(keys.repliesState);
      await pollReplies(env, { fetch: f, now: tick(1) });
    } finally {
      log.mockRestore();
    }
    // This slice does not deduplicate the DM (that is C2 work); the public reply went out once.
    expect(f.calls().filter((c) => c === `POST ${IG}/17841/messages`)).toHaveLength(2);
    expect(publicPosts(f)).toHaveLength(1);
    expect((await stateOf(env)).log[0]).toMatchObject({
      publicReply: "skipped",
      detail: "already_claimed",
    });
    expect(coordOf(env).ops.filter((o) => o === "claimAuto")).toHaveLength(2);
  });

  it("a missing coordinator fails the public reply closed: explicit log, zero public POST, no fallback", async () => {
    const env = { ...makeEnv(), INSTAGRAM_PUBLIC_SEND_COORDINATOR: undefined };
    await connect(env, "instagram");
    await seed(env, [input()]);
    const f = mockFetch(igRoutes({}, [comment("c1", "لت")]).routes);
    const r = await pollReplies(env, { fetch: f, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(publicPosts(f)).toEqual([]);
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({
      dm: "sent",
      publicReply: "failed",
      error: "not_configured",
      detail: "public-claim-store",
    });
    expect(state.handled).toHaveProperty("c1");
    expect(state.stats.lut).toMatchObject({ sends: 1, publicReplies: 0 });
    // Not retried on a later read either.
    await checkThenPoll(env, { fetch: f, now: tick(1) });
    expect(publicPosts(f)).toEqual([]);
  });

  it("an unreadable coordinator (or an injected claim that throws) fails closed the same way", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    coordOf(env).failing.add("claimAuto");
    const f = mockFetch(igRoutes({}, [comment("c1", "لت")]).routes);
    await pollReplies(env, { fetch: f, now: NOW });
    expect(publicPosts(f)).toEqual([]);
    expect((await stateOf(env)).log[0]).toMatchObject({
      publicReply: "failed",
      error: "not_configured",
      detail: "public-claim-store",
    });

    const env2 = makeEnv();
    await connect(env2, "instagram");
    await seed(env2, [input()]);
    const f2 = mockFetch(igRoutes({}, [comment("c1", "لت")]).routes);
    const publicClaim = {
      claimAuto: async () => {
        throw new Error("down");
      },
      settle: async () => undefined,
    };
    await pollReplies(env2, { fetch: f2, now: NOW, publicClaim });
    expect(publicPosts(f2)).toEqual([]);
    expect((await stateOf(env2)).log[0]).toMatchObject({ detail: "public-claim-store" });
    expect(coordOf(env2).ops).toEqual([]);
  });

  it("uncertain delivery (5xx, malformed) settles unknown, is logged as unknown-delivery and never retried", async () => {
    for (const answer of [
      () => json({ error: { message: "nope", code: 1 } }, 500),
      () => ({ success: true }),
    ]) {
      const env = makeEnv();
      await connect(env, "instagram");
      await seed(env, [input()]);
      const f = mockFetch(
        igRoutes({ [`POST ${IG}/c1/replies`]: answer }, [comment("c1", "لت")]).routes,
      );
      await pollReplies(env, { fetch: f, now: NOW });
      const state = await stateOf(env);
      expect(state.log[0]).toMatchObject({
        dm: "sent",
        publicReply: "failed",
        error: "upstream",
        detail: "unknown-delivery",
      });
      expect(state.stats.lut.publicReplies).toBe(0);
      expect(await effectOf(env)).toMatchObject({ effect: { state: "unknown" } });
      await checkThenPoll(env, { fetch: f, now: tick(1) });
      expect(publicPosts(f)).toHaveLength(1);
    }
  });

  it("a known refusal keeps Meta's mapping (an expired token stops the tick) and settles rejected", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    const f = mockFetch(
      igRoutes(
        {
          [`POST ${IG}/c1/replies`]: () =>
            json({ error: { message: "Invalid OAuth", code: 190 } }, 400),
        },
        [comment("c1", "لت")],
      ).routes,
    );
    await pollReplies(env, { fetch: f, now: NOW });
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({
      dm: "sent",
      publicReply: "failed",
      error: "token_expired",
      detail: "Invalid OAuth [190]",
    });
    expect(state.lastError).toBe("token_expired");
    expect(await effectOf(env)).toMatchObject({
      effect: { state: "rejected", failureCode: "meta_190" },
    });
  });

  it("a sent reply whose receipt cannot be written is not counted as sent, and is never posted again", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    coordOf(env).failing.add("settle");
    const f = mockFetch(igRoutes({}, [comment("c1", "لت")]).routes);
    await pollReplies(env, { fetch: f, now: NOW });
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({ publicReply: "failed", detail: "unknown-delivery" });
    expect(state.stats.lut.publicReplies).toBe(0);
    coordOf(env).failing.clear();
    expect(await effectOf(env)).toMatchObject({ effect: { state: "claimed" } });
    expect(publicPosts(f)).toHaveLength(1);
  });

  it("the exact filled text is posted: {username} becomes @handle, nothing else changes", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: ["تم {username} ✅"] })]);
    let said = "";
    const f = mockFetch(
      igRoutes(
        {
          [`POST ${IG}/c1/replies`]: (_u, init) => {
            said = new URLSearchParams(String(init?.body)).get("message") ?? "";
            return { id: "r1" };
          },
        },
        [comment("c1", "لت")],
      ).routes,
    );
    await pollReplies(env, { fetch: f, now: NOW });
    expect(said).toBe("تم @fan_c1 ✅");
  });

  it("rules without a public reply and a failed DM never touch the coordinator", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] })]);
    await pollReplies(env, {
      fetch: mockFetch(igRoutes({}, [comment("c1", "لت")]).routes),
      now: NOW,
    });
    const env2 = makeEnv();
    await connect(env2, "instagram");
    await seed(env2, [input()]);
    const dmFails = igRoutes(
      { [`POST ${IG}/17841/messages`]: () => json({ error: { message: "x", code: 1 } }, 500) },
      [comment("c1", "لت")],
    );
    await pollReplies(env2, { fetch: mockFetch(dmFails.routes), now: NOW });
    expect([...coordOf(env).ops, ...coordOf(env2).ops]).toEqual([]);
  });
});
/* ---------- DT-6B-2C-1-R1: proof binding, one destination, typed refusals, scrubbing ---------- */

describe("pollReplies: the public branch trusts only bound coordinator proof and scrubbed words", () => {
  type Coord = ReturnType<typeof fakeCoordinator>;
  const coordOf = (env: Env) => env.INSTAGRAM_PUBLIC_SEND_COORDINATOR as unknown as Coord;
  const publicPosts = (f: ReturnType<typeof mockFetch>) =>
    f.calls().filter((c) => c === `POST ${IG}/c1/replies`);
  const effectOf = async (env: Env) => {
    const ns = env.INSTAGRAM_PUBLIC_SEND_COORDINATOR!;
    const res = await ns.get(ns.idFromName("instagram|17841")).fetch("https://c/", {
      method: "POST",
      body: JSON.stringify({
        now: NOW.getTime(),
        op: "getEffect",
        account: "17841",
        commentId: "c1",
      }),
    });
    return (await res.json()) as Record<string, unknown>;
  };
  /** Replaces the coordinator's answer to one `op`; every call body is kept in `calls`. */
  const intercept = (env: Env, op: string, answer?: unknown) => {
    const ns = coordOf(env);
    const get = ns.get;
    const calls: Record<string, unknown>[] = [];
    ns.get = (id: string) => {
      const stub = get(id);
      return {
        fetch: async (url: string, init: RequestInit) => {
          const call = JSON.parse(String(init.body)) as Record<string, unknown>;
          if (call.op !== op) return stub.fetch(url, init);
          calls.push(call);
          return answer === undefined ? stub.fetch(url, init) : json(answer);
        },
      };
    };
    return calls;
  };
  const setup = async (over: Record<string, Handler> = {}, tokens: Partial<TokenSet> = {}) => {
    const env = makeEnv();
    await connect(env, "instagram", tokens);
    await seed(env, [input()]);
    const f = mockFetch(igRoutes(over, [comment("c1", "لت")]).routes);
    return { env, f };
  };

  for (const [name, claim] of [
    ["claimed without proof", { claimed: true }],
    [
      "another account's claim",
      {
        claimed: true,
        effect: {
          account: "foreign",
          commentId: "elsewhere",
          actor: "auto:other",
          state: "claimed",
          claimedAt: NOW.toISOString(),
          receiptVersion: 1,
        },
      },
    ],
  ] as const)
    it(`${name} never authorizes the public POST`, async () => {
      const { env, f } = await setup();
      intercept(env, "claimAuto", claim);
      await pollReplies(env, { fetch: f, now: NOW });
      expect(publicPosts(f)).toEqual([]);
      expect(coordOf(env).ops).not.toContain("settle");
      expect((await stateOf(env)).log[0]).toMatchObject({
        dm: "sent",
        publicReply: "failed",
        error: "not_configured",
        detail: "public-claim-store",
      });
    });

  for (const [name, settle] of [
    ["an empty object", {}],
    ["an array", []],
    [
      "a still-claimed effect",
      {
        settled: false,
        effect: {
          account: "17841",
          commentId: "c1",
          actor: "auto:lut",
          state: "claimed",
          claimedAt: NOW.toISOString(),
          receiptVersion: 1,
        },
      },
    ],
    [
      "another target's sent effect",
      {
        settled: true,
        effect: {
          account: "foreign",
          commentId: "elsewhere",
          actor: "manual:other",
          state: "sent",
          providerReplyId: "wrong",
          claimedAt: NOW.toISOString(),
          settledAt: NOW.toISOString(),
          receiptVersion: 2,
        },
      },
    ],
  ] as const)
    it(`${name} as the receipt keeps the delivery unknown and is not counted`, async () => {
      const { env, f } = await setup();
      intercept(env, "settle", settle);
      await pollReplies(env, { fetch: f, now: NOW });
      const state = await stateOf(env);
      expect(publicPosts(f)).toHaveLength(1);
      expect(state.handled).toHaveProperty("c1");
      expect(state.stats.lut.publicReplies).toBe(0);
      expect(state.log[0]).toMatchObject({ publicReply: "failed", detail: "unknown-delivery" });
    });

  it("a 307 from the public POST is unknown delivery: one POST, nothing followed, not counted", async () => {
    const { env, f } = await setup({
      [`POST ${IG}/c1/replies`]: () =>
        new Response(null, { status: 307, headers: { Location: "https://elsewhere.invalid/" } }),
    });
    await pollReplies(env, { fetch: f, now: NOW });
    const state = await stateOf(env);
    expect(publicPosts(f)).toHaveLength(1);
    expect(state.log[0]).toMatchObject({ publicReply: "failed", detail: "unknown-delivery" });
    expect(await effectOf(env)).toMatchObject({
      effect: { state: "unknown", unknownReason: "redirect" },
    });
  });

  it("a 400 with an untyped error body is unknown delivery, never a mapped refusal", async () => {
    const { env, f } = await setup({ [`POST ${IG}/c1/replies`]: () => json({ error: {} }, 400) });
    await pollReplies(env, { fetch: f, now: NOW });
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({
      publicReply: "failed",
      error: "upstream",
      detail: "unknown-delivery",
    });
    expect(await effectOf(env)).toMatchObject({
      effect: { state: "unknown", unknownReason: "malformed" },
    });
  });

  it("a refusal echoing the token and the seal stays scrubbed in the log, the tick error and the receipt", async () => {
    const token = "fixture-provider-token-123";
    const secret = "fixture-seal-secret-456-0123456789abcdef";
    const { env, f } = await setup(
      {
        [`POST ${IG}/c1/replies`]: () =>
          json({ error: { code: 190, message: `refused ${token} and ${secret}` } }, 400),
      },
      { accessToken: token },
    );
    (env as Env & { INBOX_SEAL_SECRET?: string }).INBOX_SEAL_SECRET = secret;
    const settles = intercept(env, "settle");
    await pollReplies(env, { fetch: f, now: NOW });
    const state = await stateOf(env);
    // Meta's mapping and stop policy are unchanged.
    expect(state.log[0]).toMatchObject({ publicReply: "failed", error: "token_expired" });
    expect(state.lastError).toBe("token_expired");
    for (const said of [JSON.stringify(state), JSON.stringify(settles)]) {
      expect(said).not.toContain(token);
      expect(said).not.toContain(secret);
    }
    expect(state.log[0].detail).toBe("refused [token] and [secret] [190]");
    expect(await effectOf(env)).toMatchObject({
      effect: { state: "rejected", failureCode: "meta_190" },
    });
  });
});

describe("pollReplies: an answer carrying an error is never claim or receipt proof (DT-6B-2C-1-R2)", () => {
  type Coord = ReturnType<typeof fakeCoordinator>;
  const coordOf = (env: Env) => env.INSTAGRAM_PUBLIC_SEND_COORDINATOR as unknown as Coord;
  const publicPosts = (f: ReturnType<typeof mockFetch>) =>
    f.calls().filter((c) => c === `POST ${IG}/c1/replies`);
  const row = {
    account: "17841",
    commentId: "c1",
    actor: "auto:lut",
    claimedAt: NOW.toISOString(),
  };
  /** Answers one `op` with `answer` instead of the coordinator (nothing is written for that call). */
  const intercept = (env: Env, op: string, answer: unknown) => {
    const ns = coordOf(env);
    const get = ns.get;
    ns.get = (id: string) => {
      const stub = get(id);
      return {
        fetch: async (url: string, init: RequestInit) =>
          (JSON.parse(String(init.body)) as { op: string }).op === op
            ? json(answer)
            : stub.fetch(url, init),
      };
    };
  };
  const setup = async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input()]);
    return { env, f: mockFetch(igRoutes({}, [comment("c1", "لت")]).routes) };
  };

  it("an error beside a matching claimed effect stops before the public POST", async () => {
    const { env, f } = await setup();
    intercept(env, "claimAuto", {
      error: "conflict",
      claimed: true,
      effect: { ...row, state: "claimed", receiptVersion: 1 },
    });
    await pollReplies(env, { fetch: f, now: NOW });
    expect(publicPosts(f)).toEqual([]);
    expect(coordOf(env).ops).not.toContain("settle");
    expect((await stateOf(env)).log[0]).toMatchObject({
      dm: "sent",
      publicReply: "failed",
      error: "not_configured",
      detail: "public-claim-store",
    });
  });

  it("an error beside a matching sent effect keeps the delivery unknown and uncounted", async () => {
    const { env, f } = await setup();
    intercept(env, "settle", {
      error: "conflict",
      settled: true,
      effect: {
        ...row,
        state: "sent",
        providerReplyId: "r1",
        settledAt: NOW.toISOString(),
        receiptVersion: 2,
      },
    });
    await pollReplies(env, { fetch: f, now: NOW });
    const state = await stateOf(env);
    expect(publicPosts(f)).toHaveLength(1);
    expect(state.stats.lut.publicReplies).toBe(0);
    expect(state.log[0]).toMatchObject({ publicReply: "failed", detail: "unknown-delivery" });
  });
});

/* ---------- DT-6B-2C-2: rule/default DMs claim the durable DM authority ---------- */

describe("pollReplies: rule and default DMs go through the InstagramDmCoordinator (DT-6B-2C-2)", () => {
  type DmNs = { names: string[]; ops: string[]; failing: Set<string> };
  const dmNs = (env: Env) => env.INSTAGRAM_DM_COORDINATOR as unknown as DmNs;
  const dmPosts = (f: ReturnType<typeof mockFetch>, path = `${IG}/17841/messages`) =>
    f.calls().filter((c) => c === `POST ${path}`);

  it("a fresh /me every tick the DMs run (cached account or not), one GET when the poll fetched it already", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const first = mockFetch(dmRoutes([convo("t1", [dm("d1", "كاميرا")])]));
    await pollReplies(env, { fetch: first, now: NOW });
    expect(first.calls().filter((c) => c === `GET ${IG}/me`)).toHaveLength(1);
    expect((await stateOf(env)).igUserId).toBe("17841");
    const next = mockFetch(dmRoutes([convo("t2", [dm("d2", "كاميرا", { from: { id: "p2" } })])]));
    await pollReplies(env, { fetch: next, now: tick(1) });
    expect(next.calls().slice(0, 2)).toEqual([`GET ${IG}/me`, `GET ${IG}/17841/conversations`]);
    // The coordinator object is the fresh account's; the OAuth user id ("178") is never used.
    expect(new Set(dmNs(env).names)).toEqual(new Set(["instagram-dm|17841"]));
    expect(dmNs(env).ops).toEqual(["claim", "settle", "claim", "settle"]);
  });

  it("the account comes from /me, not the cached poll state: a reconnect to another account reads and sends as it", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], { ...SINCE, igUserId: "17841", ownerUsername: "3z.prod" });
    const f = mockFetch({
      [`GET ${IG}/me`]: () => ({ user_id: 99999, username: "3z.prod" }),
      [`GET ${IG}/99999/conversations`]: () => ({ data: [convo("t1", [dm("d1", "كاميرا")])] }),
      [`POST ${IG}/99999/messages`]: (_u, init) => {
        const body = JSON.parse(String(init?.body)) as { recipient: { id: string } };
        return { recipient_id: body.recipient.id, message_id: "m9" };
      },
    });
    const r = await pollReplies(env, { fetch: f, now: NOW });
    expect(r.sent).toEqual(["d1"]);
    expect(f.calls()).not.toContain(`GET ${IG}/17841/conversations`);
    expect(new Set(dmNs(env).names)).toEqual(new Set(["instagram-dm|99999"]));
  });

  it("a /me that fails or has no user_id is a failed conversations read: comments still answered, no DM claimed", async () => {
    for (const me of [
      () => json({ error: { message: "boom", code: 2 } }, 500),
      () => ({ username: "3z.prod" }),
    ]) {
      const env = makeEnv();
      await connect(env, "instagram");
      await seed(env, [input({ publicReplies: [] }), camRule()], {
        ...SINCE,
        igUserId: "17841",
        ownerUsername: "3z.prod",
      });
      const { routes } = igRoutes({
        [`GET ${IG}/me`]: me,
        [`GET ${IG}/17841/conversations`]: () => ({ data: [convo("t1", [dm("d1", "كاميرا")])] }),
      });
      const f = mockFetch(routes);
      const r = await pollReplies(env, { fetch: f, now: NOW });
      expect(r.sent).toEqual(["c1"]);
      expect(r.error).toBe("upstream");
      expect(f.calls()).not.toContain(`GET ${IG}/17841/conversations`);
      expect(dmNs(env).ops).toEqual([]);
    }
  });

  it("no binding: the rule DM fails closed (not_configured, dm-claim-store), zero DM POST; comment private replies unchanged", async () => {
    const env = makeEnv();
    delete (env as { INSTAGRAM_DM_COORDINATOR?: unknown }).INSTAGRAM_DM_COORDINATOR;
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] }), camRule()], SINCE);
    const { routes } = igRoutes({
      [`GET ${IG}/17841/conversations`]: () => ({ data: [convo("t1", [dm("d1", "كاميرا")])] }),
    });
    const sentBodies: { recipient: Record<string, string> }[] = [];
    const base = routes[`POST ${IG}/17841/messages`];
    routes[`POST ${IG}/17841/messages`] = (u, init) => {
      sentBodies.push(JSON.parse(String(init?.body)));
      return base(u, init);
    };
    const r = await pollReplies(env, { fetch: mockFetch(routes), now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(r.failed).toEqual(["d1"]);
    // The only DM POST is the comment's private reply (comment_id, replyCore).
    expect(sentBodies.map((b) => Object.keys(b.recipient))).toEqual([["comment_id"]]);
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({
      kind: "message",
      dm: "failed",
      error: "not_configured",
      detail: "dm-claim-store",
    });
    expect(state.retries).toEqual({ d1: 1 });
    expect(state).toMatchObject({ lastError: "upstream", lastErrorDetail: "dm-claim-store" });
  });

  it("a duplicate poll (a lost result re-reads the message) is already_claimed: one POST, no second count", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const before = await stateOf(env);
    const f = mockFetch(dmRoutes([convo("t1", [dm("d1", "كاميرا")])]));
    await pollReplies(env, { fetch: f, now: NOW });
    // The first poll's result never reached KV: the next tick starts from the old state.
    await Store.from(env)!.putRepliesState(before);
    const again = await pollReplies(env, { fetch: f, now: tick(1) });
    expect(again.sent).toEqual([]);
    expect(dmPosts(f)).toHaveLength(1);
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({
      messageId: "d1",
      dm: "skipped",
      detail: "already_claimed",
    });
    expect(state.stats.cam).toMatchObject({ sends: 0, failures: 0 });
  });

  it("the default reply's day is held by the coordinator: a lost display time never sends it twice", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [], SINCE);
    const store = Store.from(env)!;
    await store.putReplies({
      ...(await configOf(env)),
      defaultReply: {
        enabled: true,
        text: "وصلت رسالتك",
        enabledAt: SINCE.inboxSince,
        updatedAt: SINCE.inboxSince,
      },
    });
    const sent: unknown[] = [];
    await pollReplies(env, {
      fetch: mockFetch(dmRoutes([convo("t1", [dm("d1", "هلا")])], sent)),
      now: NOW,
    });
    expect(sent).toHaveLength(1);
    const lost = await stateOf(env);
    await store.putRepliesState({ ...lost, defaultSentAt: {} });
    const r = await pollReplies(env, {
      fetch: mockFetch(
        dmRoutes(
          [convo("t1", [dm("d2", "وينك", { created_time: msgAt(0) }), dm("d1", "هلا")])],
          sent,
        ),
      ),
      now: tick(1),
    });
    expect(r.sent).toEqual([]);
    expect(sent).toHaveLength(1);
    expect((await stateOf(env)).log).toHaveLength(1);
  });

  it("a reconnect between the poll's capture and the claim: no claim, no POST, the next poll sends", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const store = Store.from(env)!;
    const routes = dmRoutes([convo("t1", [dm("d1", "كاميرا")])]);
    const read = routes[`GET ${IG}/17841/conversations`];
    routes[`GET ${IG}/17841/conversations`] = async (u, init) => {
      // The owner reconnects while the poll runs (a new connection stamp).
      await store.putStatus("instagram", { connectedAt: tick(1).toISOString(), handle: "3z.prod" });
      return read(u, init);
    };
    const f = mockFetch(routes);
    const r = await pollReplies(env, { fetch: f, now: NOW });
    expect(r.sent).toEqual([]);
    expect(dmPosts(f)).toEqual([]);
    expect(dmNs(env).ops).toEqual([]);
    const state = await stateOf(env);
    expect(state.log[0]).toMatchObject({ dm: "failed", error: "upstream", detail: "reconnected" });
    expect(state.retries).toEqual({});
    expect(state.convos.t1).toBeUndefined();
    routes[`GET ${IG}/17841/conversations`] = read;
    expect((await pollReplies(env, { fetch: mockFetch(routes), now: tick(1) })).sent).toEqual([
      "d1",
    ]);
  });

  it("the fresh clock decides: a token that expires before the claim stops the DMs with nothing claimed", async () => {
    const env = makeEnv();
    await connect(env, "instagram", {
      expiresAt: new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    });
    await seed(env, [camRule()], SINCE);
    const f = mockFetch(dmRoutes([convo("t1", [dm("d1", "كاميرا")])]));
    const r = await pollReplies(env, {
      fetch: f,
      now: NOW,
      clock: () => new Date(NOW.getTime() + 10 * 60_000),
    });
    expect(r.sent).toEqual([]);
    expect(await stateOf(env)).toMatchObject({ lastError: "token_expired", retries: {} });
    expect(dmPosts(f)).toEqual([]);
    expect(dmNs(env).ops).toEqual([]);
  });

  it("budget: each DM reserves its claim, POST and receipt; what does not fit waits for the next tick", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], { ...SINCE, igUserId: "17841", ownerUsername: "3z.prod" });
    const convos = [0, 1].map((i) =>
      convo(`t${i}`, [dm(`d${i}`, "كاميرا", { from: { id: `p${i}` } })]),
    );
    // /me + conversations = 2, then one DM = 3; the second DM would need 3 more.
    const r = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos)), now: NOW, budget: 7 });
    expect(r.sent).toEqual(["d0"]);
    expect(dmNs(env).ops).toEqual(["claim", "settle"]);
    expect((await stateOf(env)).convos.t1).toBeUndefined();
    const next = await pollReplies(env, { fetch: mockFetch(dmRoutes(convos)), now: tick(1) });
    expect(next.sent).toEqual(["d1"]);
  });

  it("paused: nothing is read, claimed or sent", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const store = Store.from(env)!;
    await store.putReplies({ ...(await configOf(env)), paused: true });
    const f = mockFetch(dmRoutes([convo("t1", [dm("d1", "كاميرا")])]));
    expect(await pollReplies(env, { fetch: f, now: NOW })).toMatchObject({ skipped: "paused" });
    expect(f.calls()).toEqual([]);
    expect(dmNs(env).ops).toEqual([]);
  });

  it("comments first (private reply, then the claimed public reply), then the DMs; only DMs touch the DM authority", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input(), camRule()], SINCE);
    const { routes } = igRoutes({
      [`GET ${IG}/17841/conversations`]: () => ({ data: [convo("t1", [dm("d1", "كاميرا")])] }),
    });
    const f = mockFetch(routes);
    const r = await pollReplies(env, { fetch: f, now: NOW });
    expect(r.sent).toEqual(["c1", "d1"]);
    expect(f.calls().filter((c) => c.startsWith("POST"))).toEqual([
      `POST ${IG}/17841/messages`,
      `POST ${IG}/c1/replies`,
      `POST ${IG}/17841/messages`,
    ]);
    expect(dmNs(env).ops).toEqual(["claim", "settle"]);
  });
});

/* ---------- DT-6B-2C-2-R1 ---------- */

describe("pollReplies: the DM repairs through the real poll (DT-6B-2C-2-R1)", () => {
  type DmNs = { ops: string[]; failing: Set<string> };
  const dmNs = (env: Env) => env.INSTAGRAM_DM_COORDINATOR as unknown as DmNs;
  const convos = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      convo(`t${i}`, [dm(`d${i}`, "كاميرا", { from: { id: `p${i}` } })]),
    );
  const posts = (f: ReturnType<typeof mockFetch>) =>
    f.calls().filter((c) => c === `POST ${IG}/17841/messages`).length;

  it("2C2-4: lost receipts after provider success never pass the shared cap; the rest wait, none replayed", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    dmNs(env).failing.add("settle");
    const f = mockFetch(dmRoutes(convos(12)));
    const r = await pollReplies(env, { fetch: f, now: NOW });
    expect(posts(f)).toBe(REPLY_CAP);
    expect(r.sent).toEqual([]);
    const state = await stateOf(env);
    expect(state.log.filter((e) => e.detail === "unknown-delivery")).toHaveLength(REPLY_CAP);
    expect(state.convos.t8).toBeUndefined();
    dmNs(env).failing.clear();
    const g = mockFetch(dmRoutes(convos(12)));
    const next = await pollReplies(env, { fetch: g, now: tick(1) });
    expect(next.sent).toEqual(["d8", "d9", "d10", "d11"]);
    expect(posts(g)).toBe(4);
  });

  it("2C2-4: a comment's private DM plus conversation DMs with lost receipts stay within the cap", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [input({ publicReplies: [] }), camRule()], SINCE);
    dmNs(env).failing.add("settle");
    const { routes } = igRoutes({
      [`GET ${IG}/17841/conversations`]: () => ({ data: convos(12) }),
    });
    const f = mockFetch(routes);
    const r = await pollReplies(env, { fetch: f, now: NOW });
    expect(r.sent).toEqual(["c1"]);
    expect(posts(f)).toBe(REPLY_CAP);
  });

  it("2C2-3: a fresh message from another sender (or none) in a conversation is never answered to its first person", async () => {
    for (const from of [{ id: "personB" }, undefined]) {
      const env = makeEnv();
      await connect(env, "instagram");
      await seed(env, [camRule()], SINCE);
      const older = dm("old", "hello", { created_time: msgAt(120), from: { id: "personA" } });
      const fresh = dm("new", "كاميرا", { from });
      const f = mockFetch(dmRoutes([convo("mixed", [fresh, older])]));
      const r = await pollReplies(env, { fetch: f, now: NOW });
      expect(r.sent).toEqual([]);
      expect(posts(f)).toBe(0);
      expect(dmNs(env).ops).toEqual([]);
      expect((await stateOf(env)).log[0]).toMatchObject({
        messageId: "new",
        dm: "skipped",
        detail: "unavailable",
      });
    }
  });

  it("2C2-1: the skipped outcome reaches the dashboard document as it is", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const before = await stateOf(env);
    const f = mockFetch(dmRoutes([convo("t1", [dm("d1", "كاميرا")])]));
    await pollReplies(env, { fetch: f, now: NOW });
    await Store.from(env)!.putRepliesState(before);
    await pollReplies(env, { fetch: f, now: tick(1) });
    const res = await handle(req("/social/replies"), env, undefined, { now: () => tick(1) });
    const body = (await res.json()) as { log: Record<string, unknown>[] };
    expect(body.log[0]).toMatchObject({
      messageId: "d1",
      dm: "skipped",
      detail: "already_claimed",
    });
  });
});

describe("pollReplies: a partly handled conversation keeps its unhandled messages (DT-6B-2C-2-R2)", () => {
  type DmNs = { ops: string[]; failing: Set<string> };
  const dmNs = (env: Env) => env.INSTAGRAM_DM_COORDINATOR as unknown as DmNs;
  const T = msgAt(1);
  const beforeT = new Date(Date.parse(T) - 1).toISOString();
  const singles = Array.from({ length: 5 }, (_, i) =>
    convo(`t${i}`, [dm(`d${i}`, "كاميرا", { from: { id: `p${i}` } })]),
  );
  /** One conversation whose messages all share the time T (or come one second apart). */
  const group = (n: number, sameTime = true) =>
    convo(
      "five",
      Array.from({ length: n }, (_, i) =>
        dm(`s${i}`, "كاميرا", {
          from: { id: "pS" },
          ...(sameTime ? {} : { created_time: msgAt(1 + (n - i) / 60) }),
        }),
      ),
    );
  const posts = (f: ReturnType<typeof mockFetch>) =>
    f.calls().filter((c) => c === `POST ${IG}/17841/messages`).length;
  const claims = (env: Env) => dmNs(env).ops.filter((o) => o === "claim").length;
  const ready = async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    return env;
  };

  it("the cap splits five same-time messages (uncertain or proven): two new POSTs next poll, none on the third", async () => {
    for (const lost of [true, false]) {
      const env = await ready();
      if (lost) dmNs(env).failing.add("settle");
      const f = mockFetch(dmRoutes([...singles, group(5)]));
      const first = await pollReplies(env, { fetch: f, now: NOW });
      expect(posts(f)).toBe(REPLY_CAP);
      expect(first.sent).toEqual(lost ? [] : ["d0", "d1", "d2", "d3", "d4", "s0", "s1", "s2"]);
      expect((await stateOf(env)).convos.five).toEqual({ seenAt: beforeT });
      dmNs(env).failing.clear();
      const second = await pollReplies(env, { fetch: f, now: tick(1) });
      expect(second.sent).toEqual(["s3", "s4"]);
      expect(posts(f)).toBe(REPLY_CAP + 2);
      const state = await stateOf(env);
      expect(state.convos.five).toEqual({ seenAt: T });
      expect(
        state.log.filter((e) => e.detail === "already_claimed").map((e) => e.messageId),
      ).toEqual(["s2", "s1", "s0"]);
      const claimed = claims(env);
      const third = await pollReplies(env, { fetch: f, now: tick(2) });
      expect(third.sent).toEqual([]);
      expect(posts(f)).toBe(REPLY_CAP + 2);
      expect(claims(env)).toBe(claimed);
    }
  });

  it("a budget stop inside the group: the rest follows next poll, each message posted once", async () => {
    const env = await ready();
    const f = mockFetch(dmRoutes([group(5)]));
    // /me + conversations = 2, then three DMs of three calls each.
    const first = await pollReplies(env, { fetch: f, now: NOW, budget: 2 + 9 });
    expect(first.sent).toEqual(["s0", "s1", "s2"]);
    expect((await stateOf(env)).convos.five).toEqual({ seenAt: beforeT });
    const second = await pollReplies(env, { fetch: f, now: tick(1) });
    expect(second.sent).toEqual(["s3", "s4"]);
    expect(await pollReplies(env, { fetch: f, now: tick(2) })).toMatchObject({ sent: [] });
    expect(posts(f)).toBe(5);
  });

  it("a pre-claim retry inside the group: the retried message and the rest follow next poll, once", async () => {
    const env = await ready();
    const routes = dmRoutes([group(3)]);
    const send = routes[`POST ${IG}/17841/messages`];
    // After the first DM's claim the DM authority cannot be read: nothing more is claimed this tick.
    routes[`POST ${IG}/17841/messages`] = (u, init) => {
      dmNs(env).failing.add("claim");
      return send(u, init);
    };
    const f = mockFetch(routes);
    const first = await pollReplies(env, { fetch: f, now: NOW });
    expect(first.sent).toEqual(["s0"]);
    let state = await stateOf(env);
    expect(state.retries).toEqual({ s1: 1 });
    expect(state.convos.five).toEqual({ seenAt: beforeT });
    routes[`POST ${IG}/17841/messages`] = send;
    dmNs(env).failing.clear();
    const second = await pollReplies(env, { fetch: f, now: tick(1) });
    expect(second.sent).toEqual(["s1", "s2"]);
    state = await stateOf(env);
    expect(state.retries).toEqual({});
    expect(state.convos.five).toEqual({ seenAt: T });
    expect(await pollReplies(env, { fetch: f, now: tick(2) })).toMatchObject({ sent: [] });
    expect(posts(f)).toBe(3);
  });

  it("the first poll answers nothing and the next never replays the history it stamped", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()]);
    const f = mockFetch(dmRoutes([group(5)]));
    expect((await pollReplies(env, { fetch: f, now: NOW })).sent).toEqual([]);
    expect((await pollReplies(env, { fetch: f, now: tick(1) })).sent).toEqual([]);
    expect(posts(f)).toBe(0);
    expect(claims(env)).toBe(0);
  });

  it("distinct times: the capped conversation resumes its last two without reading the others again", async () => {
    const env = await ready();
    dmNs(env).failing.add("settle");
    const f = mockFetch(dmRoutes([...singles, group(5, false)]));
    await pollReplies(env, { fetch: f, now: NOW });
    expect((await stateOf(env)).convos.five).toEqual({ seenAt: msgAt(1 + 3 / 60) });
    dmNs(env).failing.clear();
    expect((await pollReplies(env, { fetch: f, now: tick(1) })).sent).toEqual(["s3", "s4"]);
    expect(posts(f)).toBe(REPLY_CAP + 2);
    expect(claims(env)).toBe(REPLY_CAP + 2);
  });
});

describe("pollReplies: an exhausted pre-claim retry stays given up (DT-6B-2C-2-C1)", () => {
  type DmNs = {
    ops: string[];
    failing: Set<string>;
    get: (id: string) => { fetch: (url: string, init: RequestInit) => Promise<Response> };
  };
  const dmNs = (env: Env) => env.INSTAGRAM_DM_COORDINATOR as unknown as DmNs;
  const T = msgAt(1);
  const beforeT = new Date(Date.parse(T) - 1).toISOString();
  const posts = (f: ReturnType<typeof mockFetch>) =>
    f.calls().filter((c) => c === `POST ${IG}/17841/messages`).length;
  /**
   * Only the claims of `first` cannot reach the DM authority while `fault.on`; every other key works. `ids` lists the
   * conversation's messages in order (`first` included), all at the time T or, with `distinct`, `first` a minute older.
   */
  const outage = async (ids = ["first", "second"], distinct = false) => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()], SINCE);
    const ns = dmNs(env);
    const attempts: string[] = [];
    const fault = { on: true };
    const get = ns.get;
    ns.get = (id) => {
      const stub = get(id);
      return {
        fetch: async (url, init) => {
          const call = JSON.parse(String(init.body)) as { op: string; inboundMessageId?: string };
          if (call.op === "claim") {
            attempts.push(call.inboundMessageId ?? "");
            if (fault.on && call.inboundMessageId === "first") throw new Error("first key down");
          }
          return stub.fetch(url, init);
        },
      };
    };
    const messages = ids.map((id) =>
      dm(id, "كاميرا", {
        from: { id: "pS" },
        created_time: distinct && id === "first" ? msgAt(2) : T,
      }),
    );
    const f = mockFetch(dmRoutes([convo("two", messages)]));
    return { env, f, attempts, fault };
  };
  const tries = (attempts: string[], id: string) => attempts.filter((a) => a === id).length;

  it("equal times, a persistent first-key outage: three attempts, then the successor is sent once and never again", async () => {
    const o = await outage();
    const seen: { retries: unknown; givenUp: unknown; convo: unknown; sent: string[] }[] = [];
    for (let n = 0; n < 6; n++) {
      const r = await pollReplies(o.env, { fetch: o.f, now: tick(n) });
      const s = await stateOf(o.env);
      seen.push({ retries: s.retries, givenUp: s.givenUp, convo: s.convos.two, sent: r.sent });
    }
    expect(seen).toEqual([
      { retries: { first: 1 }, givenUp: {}, convo: undefined, sent: [] },
      { retries: { first: 2 }, givenUp: {}, convo: undefined, sent: [] },
      { retries: {}, givenUp: { first: T }, convo: { seenAt: beforeT }, sent: [] },
      // The fourth poll: the given-up message is passed without a claim; the successor goes; the mark leaves.
      { retries: {}, givenUp: {}, convo: { seenAt: T }, sent: ["second"] },
      { retries: {}, givenUp: {}, convo: { seenAt: T }, sent: [] },
      { retries: {}, givenUp: {}, convo: { seenAt: T }, sent: [] },
    ]);
    expect(tries(o.attempts, "first")).toBe(MAX_RETRIES);
    expect(tries(o.attempts, "second")).toBe(1);
    expect(posts(o.f)).toBe(1);
    const log = (await stateOf(o.env)).log;
    expect(log.filter((e) => e.messageId === "first").map((e) => e.detail)).toEqual([
      "dm-claim-store",
      "dm-claim-store",
      "dm-claim-store",
    ]);
    expect(log.filter((e) => e.messageId === "second").map((e) => e.dm)).toEqual(["sent"]);
  });

  it("distinct times: three attempts, the mark leaves at once, the successor is sent once", async () => {
    const o = await outage(["first", "second"], true);
    for (let n = 0; n < 5; n++) await pollReplies(o.env, { fetch: o.f, now: tick(n) });
    expect(tries(o.attempts, "first")).toBe(MAX_RETRIES);
    expect(tries(o.attempts, "second")).toBe(1);
    expect(posts(o.f)).toBe(1);
    const s = await stateOf(o.env);
    expect(s.givenUp).toEqual({});
    expect(s.convos.two).toEqual({ seenAt: T });
  });

  it("restored before the third failure: both same-time messages are sent once, nothing is given up or replayed", async () => {
    const o = await outage();
    await pollReplies(o.env, { fetch: o.f, now: tick(0) });
    await pollReplies(o.env, { fetch: o.f, now: tick(1) });
    o.fault.on = false;
    const third = await pollReplies(o.env, { fetch: o.f, now: tick(2) });
    expect(third.sent).toEqual(["first", "second"]);
    const s = await stateOf(o.env);
    expect(s.retries).toEqual({});
    expect(s.givenUp).toEqual({});
    const attempts = o.attempts.length;
    expect((await pollReplies(o.env, { fetch: o.f, now: tick(3) })).sent).toEqual([]);
    expect(o.attempts).toHaveLength(attempts);
    expect(posts(o.f)).toBe(2);
  });

  it("a budget stop right after the given-up message: the next valid one waits, then each follows once", async () => {
    const o = await outage(["first", "s1", "s2"]);
    for (let n = 0; n < MAX_RETRIES; n++) await pollReplies(o.env, { fetch: o.f, now: tick(n) });
    expect((await stateOf(o.env)).givenUp).toEqual({ first: T });
    // /me + conversations = 2, then one DM of three calls: s1 goes, s2 waits, the position stays before T.
    const fourth = await pollReplies(o.env, { fetch: o.f, now: tick(3), budget: 2 + 3 });
    expect(fourth.sent).toEqual(["s1"]);
    let s = await stateOf(o.env);
    expect(s.givenUp).toEqual({ first: T });
    expect(s.convos.two).toEqual({ seenAt: beforeT });
    expect((await pollReplies(o.env, { fetch: o.f, now: tick(4) })).sent).toEqual(["s2"]);
    s = await stateOf(o.env);
    expect(s.givenUp).toEqual({});
    expect(s.convos.two).toEqual({ seenAt: T });
    expect((await pollReplies(o.env, { fetch: o.f, now: tick(5) })).sent).toEqual([]);
    expect(tries(o.attempts, "first")).toBe(MAX_RETRIES);
    expect(posts(o.f)).toBe(2);
  });

  it("marks older than the window leave at the poll's start; a saved state from before the mark loads", async () => {
    const env = makeEnv();
    await connect(env, "instagram");
    await seed(env, [camRule()]);
    const legacy: Partial<PollState> = { ...emptyState(), ...SINCE };
    delete legacy.givenUp;
    await Store.from(env)!.putRepliesState(legacy);
    const f = mockFetch(dmRoutes([convo("t1", [dm("d1", "كاميرا")])]));
    expect((await pollReplies(env, { fetch: f, now: NOW })).sent).toEqual(["d1"]);
    expect((await stateOf(env)).givenUp).toEqual({});
    const old = new Date(NOW.getTime() - 25 * 3_600_000).toISOString();
    const recent = new Date(NOW.getTime() - 3_600_000).toISOString();
    const state = await stateOf(env);
    await Store.from(env)!.putRepliesState({ ...state, givenUp: { old, recent } });
    const g = mockFetch(dmRoutes([convo("t2", [dm("d2", "كاميرا", { from: { id: "p2" } })])]));
    expect((await pollReplies(env, { fetch: g, now: tick(1) })).sent).toEqual(["d2"]);
    expect((await stateOf(env)).givenUp).toEqual({ recent });
  });
});
