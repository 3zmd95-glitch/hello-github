import { describe, expect, it, vi } from "vitest";
import { parseThreadsAccount, parseThreadsRepliesPage } from "./inbox";

// 🔌 Worker → dashboard wire contract for the Threads Inbox (DT-6B-2B-1-R1, 2B1-2). Real `scout.handle` answers (fake
// KV, fake Threads transport, nothing leaves the process) go straight into the dashboard's real strict parsers. The
// Worker's additive fields (`capabilities.sendReplies`, a direct reply's `sendRef`) must parse; a wrong value or any
// unrelated unknown key must still be rejected; an older Worker's answer without them must still parse.

const TOKEN = "s3cret-token";
const SEAL = "inbox-seal-test-0123456789abcdef0123456789abcdef";
const APP = "https://3zmd95-glitch.github.io";
const NOW = new Date("2026-10-17T09:00:00Z");
const TH = "graph.threads.net/v1.0";
const ME = "25000000000000001";
const ROOT = "90001";

/**
 * The real Worker modules, loaded at run time by a computed path: the app's tsc has no Workers types and the Worker's
 * tsc has no DOM, so neither program may follow a static import across the boundary. The shapes below are the parts
 * this test uses (workers/scout/src/scout.ts `handle`, social/store.ts `Store`).
 */
type Env = Record<string, unknown>;
type Handle = (
  req: Request,
  env: Env,
  ctx: undefined,
  deps: { fetch: typeof fetch; now: () => Date },
) => Promise<Response>;
interface WorkerStore {
  putTokens(p: "threads", t: Record<string, unknown>): Promise<void>;
  putStatus(p: "threads", s: Record<string, unknown>): Promise<void>;
}
const WORKER = "../workers/scout/src";
const load = async () => {
  const [{ handle }, { Store }] = await Promise.all([
    import(/* @vite-ignore */ `${WORKER}/scout`) as Promise<{ handle: Handle }>,
    import(/* @vite-ignore */ `${WORKER}/social/store`) as Promise<{
      Store: { from(env: Env): WorkerStore | null };
    }>,
  ]);
  return { handle, Store };
};

function fakeKV() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
  };
}

async function env(): Promise<Env> {
  const { Store } = await load();
  const e: Env = {
    SCOUT_TOKEN: TOKEN,
    INBOX_SEAL_SECRET: SEAL,
    ALLOWED_ORIGINS: APP,
    SOCIAL_KV: fakeKV(),
  };
  const store = Store.from(e)!;
  await store.putTokens("threads", {
    accessToken: "th-live-token",
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + 30 * 86_400_000).toISOString(),
    userId: ME,
    scope: "threads_basic,threads_manage_insights,threads_read_replies",
  });
  await store.putStatus("threads", { connectedAt: "2026-10-01T08:00:00.000Z", handle: "3z.prod" });
  return e;
}

/** The fake Threads Graph API: the owner, one owned post, a direct reply and a nested one. */
const provider = vi.fn<typeof fetch>(async (input) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
  const routes: Record<string, unknown> = {
    [`${TH}/me`]: { id: ME, username: "3z.prod" },
    [`${TH}/me/threads`]: {
      data: [{ id: ROOT, text: "post", timestamp: "2026-10-16T08:00:00+0000" }],
    },
    [`${TH}/${ROOT}/replies`]: {
      data: [
        {
          id: "91001",
          text: "A direct reply",
          timestamp: "2026-10-17T01:00:00+0000",
          username: "fan",
          root_post: { id: ROOT },
          replied_to: { id: ROOT },
        },
        {
          id: "91002",
          text: "nested",
          timestamp: "2026-10-17T01:05:00+0000",
          username: "fan2",
          root_post: { id: ROOT },
          replied_to: { id: "91001" },
        },
      ],
    },
  };
  const body = routes[`${url.host}${url.pathname}`];
  return new Response(JSON.stringify(body ?? { error: { message: "unmocked" } }), {
    status: body ? 200 : 404,
    headers: { "Content-Type": "application/json" },
  });
});

async function get(e: Env, path: string) {
  const { handle } = await load();
  const res = await handle(
    new Request(`https://3z-scout.example.workers.dev${path}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Origin: APP },
    }),
    e,
    undefined,
    { fetch: provider, now: () => NOW },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown> & { items: Record<string, unknown>[] };
}

async function worker() {
  const e = await env();
  const account = await get(e, "/social/inbox/threads/account");
  const q = `?account=${account.accountId}&generation=${account.generation}`;
  const posts = await get(e, `/social/inbox/threads/posts${q}`);
  const ref = posts.items[0].ref as string;
  const replies = await get(e, `/social/inbox/threads/posts/${ref}/replies${q}`);
  return { account, replies };
}

describe("Threads Inbox wire contract (real Worker answers → dashboard parsers)", () => {
  it("the account answer parses with its readiness capability; a wrong value or an unknown key rejects", async () => {
    const { account } = await worker();
    expect(account.capabilities).toEqual({ replies: "ok", sendReplies: "permission_unverified" });
    expect(parseThreadsAccount(account)?.capabilities).toEqual({
      replies: "ok",
      sendReplies: "permission_unverified",
    });
    const caps = account.capabilities as Record<string, unknown>;
    // An older Worker without the field still parses.
    const older = { ...caps };
    delete older.sendReplies;
    expect(parseThreadsAccount({ ...account, capabilities: older })).not.toBeNull();
    // Only the one intended readiness value is accepted, never "ok" or anything else.
    for (const sendReplies of ["ok", "no_permission", "", true, null, 1])
      expect(
        parseThreadsAccount({ ...account, capabilities: { ...caps, sendReplies } }),
      ).toBeNull();
    // The objects stay strict.
    expect(parseThreadsAccount({ ...account, capabilities: { ...caps, other: "ok" } })).toBeNull();
    expect(parseThreadsAccount({ ...account, extra: 1 })).toBeNull();
  });

  it("the direct-reply page parses with its bounded sendRef; malformed refs and unknown keys reject", async () => {
    const { replies } = await worker();
    const [direct, nested] = replies.items;
    expect(direct.sendRef).toEqual(expect.any(String));
    expect(nested.sendRef).toBeUndefined();
    const page = parseThreadsRepliesPage(replies);
    expect(page?.items.map((r) => r.sendRef)).toEqual([direct.sendRef, undefined]);
    // An older Worker without the field still parses.
    const older = { ...direct };
    delete older.sendRef;
    expect(parseThreadsRepliesPage({ ...replies, items: [older, nested] })).not.toBeNull();
    const row = (over: Record<string, unknown>) => ({
      ...replies,
      items: [{ ...direct, ...over }],
    });
    for (const sendRef of ["", "ab", "x".repeat(1501), 5, null])
      expect(parseThreadsRepliesPage(row({ sendRef }))).toBeNull();
    expect(parseThreadsRepliesPage(row({ sendRef: "x".repeat(1500) }))).not.toBeNull();
    expect(parseThreadsRepliesPage(row({ other: "x" }))).toBeNull();
    expect(parseThreadsRepliesPage({ ...replies, extra: 1 })).toBeNull();
  });
});
