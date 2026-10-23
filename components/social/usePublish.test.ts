// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AutoPostInput, Post } from "@/lib/domain";
import { sha256Hex } from "@/lib/digest";
import { PUBLISH_ID_RE, publishJobId, type WorkerJob } from "@/lib/publish";
import {
  STORAGE_KEY,
  postById,
  savesSettled,
  setArticlesLock,
  useStore,
  type ArticlesLock,
} from "@/store";
import {
  applyJobs,
  refreshPublishJobs,
  resyncKey,
  useWorkerOnlyJobs,
  usePublish,
  usePublishAutoResync,
} from "./usePublish";

const S = () => useStore.getState();

/** Web Locks stand-in (jsdom has none): the store's commitFresh allocation runs under it (DT-5-R1 R2). */
const queueLock = (): ArticlesLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => undefined);
    return run;
  };
};

beforeEach(() => {
  localStorage.clear();
  S().reset();
  setArticlesLock(queueLock());
});

it("applies a whole job read in one save and still marks a finished post posted", async () => {
  const sent = (jobId: string): AutoPostInput => ({
    platforms: ["instagram"],
    sentAt: "2026-10-06T00:00:00.000Z",
    jobId,
  });
  const done = S().addPost({ platform: "instagram", title: "Done" });
  const running = S().addPost({ platform: "instagram", title: "Running" });
  const draft = S().addPost({ platform: "instagram", title: "Never sent" });
  S().updatePost(done.id, { autoPost: sent(done.id) });
  S().updatePost(running.id, { autoPost: sent(running.id) });
  const link = "https://www.instagram.com/reel/A/";
  const jobs: WorkerJob[] = [
    {
      id: done.id,
      scheduledAt: "",
      results: { instagram: { state: "published", permalink: link } },
    },
    { id: running.id, scheduledAt: "", results: { instagram: { state: "processing" } } },
    { id: draft.id, scheduledAt: "", results: { instagram: { state: "published" } } },
  ];
  const saves = vi.spyOn(Storage.prototype, "setItem");
  const markPosted = vi.fn();
  const now = new Date("2026-10-06T01:00:00.000Z");

  applyJobs(jobs, markPosted, now);
  await savesSettled(); // DT-7C-2A-R1: the one save is queued under the shared lock

  // One save for the whole read: a burst of saves would let this tab undo another tab's typing.
  expect(saves).toHaveBeenCalledTimes(1);
  saves.mockRestore();
  expect(postById(S(), done.id)?.autoPost).toMatchObject({
    results: { instagram: { state: "published", permalink: link } },
    checkedAt: now.toISOString(),
  });
  expect(postById(S(), running.id)?.autoPost?.results.instagram?.state).toBe("processing");
  expect(postById(S(), draft.id)?.autoPost).toBeUndefined();
  expect(markPosted).toHaveBeenCalledTimes(1);
  expect(markPosted).toHaveBeenCalledWith(done.id, link);
});

it("A4: editing the first comment of a scheduled post changes the key that re-sends its job", () => {
  const p = S().addPost({ platform: "instagram", title: "Comment" });
  S().updatePost(p.id, {
    autoPost: { platforms: ["instagram"], sentAt: "2026-10-06T00:00:00.000Z" },
  });
  const before = resyncKey(postById(S(), p.id)!);
  expect(before).not.toBeNull();
  S().updatePost(p.id, {
    autoPost: { ...postById(S(), p.id)!.autoPost!, firstComment: "#match #cut" },
  });
  expect(resyncKey(postById(S(), p.id)!)).not.toBe(before);
});

/* ---------- DT-5: a workflow-generated post through the whole AutoPost lifecycle ---------- */

/**
 * A fake Worker that checks ids like the deployed one (workers/scout/src/social/publish.ts): the POST body id and the
 * raw run / cancel path segment must match its ID_RE, else 400 `id` / 404. No provider is ever called.
 */
function fakeWorker() {
  const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
  const hits: string[] = [];
  const jobs = new Map<string, Record<string, unknown>>();
  /** While set, a create waits for it before committing (an auto-resync POST held in flight). */
  const ctl: {
    hold: Promise<void> | null;
    held: number;
    loseNext: boolean;
    failList: boolean;
    /** Runs at the entry of every create, before the job is committed or answered. */
    onCreate: ((id: string) => void) | null;
  } = {
    hold: null,
    held: 0,
    loseNext: false,
    failList: false,
    onCreate: null,
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const [, , id, action] = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/social/publish" && method === "GET") {
      if (ctl.failList) throw new TypeError("Failed to fetch");
      return reply({ jobs: [...jobs.values()] });
    }
    if (url.pathname === "/social/publish" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as { id: string; scheduledAt: string };
      if (!ID_RE.test(body.id)) return reply({ error: "bad_request", detail: "id" }, 400);
      hits.push(`schedule ${body.id}`);
      ctl.onCreate?.(body.id);
      if (ctl.hold) {
        ctl.held += 1;
        await ctl.hold;
      }
      const job = { ...body, targets: { instagram: { state: "queued" } } };
      jobs.set(body.id, job);
      if (ctl.loseNext) {
        // The Worker committed the job, but the reply never arrives.
        ctl.loseNext = false;
        throw new TypeError("Failed to fetch");
      }
      return reply({ job });
    }
    if (!id || !ID_RE.test(id)) return reply({ error: "not_found" }, 404);
    if (action === "run" && method === "POST") {
      hits.push(`run ${id}`);
      const job = jobs.get(id);
      return job ? reply({ job }) : reply({ error: "not_found" }, 404);
    }
    if (!action && method === "DELETE") {
      hits.push(`cancel ${id}`);
      jobs.delete(id);
      return reply({ ok: true });
    }
    return reply({ error: "bad_request" }, 400);
  });
  return { hits, jobs, ctl, impl };
}

/** What the harnesses rendered last (written in an effect, read by the tests). */
const seen: { api: ReturnType<typeof usePublish> | null; remote: WorkerJob[] } = {
  api: null,
  remote: [],
};
function Harness() {
  const api = usePublish();
  const remote = useWorkerOnlyJobs();
  useEffect(() => {
    seen.api = api;
    seen.remote = remote;
  });
  return null;
}

afterEach(() => {
  setArticlesLock(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  seen.api = null;
});

it("schedules, runs and cancels a workflow post with one Worker-safe id, never listed as another device's", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings({ apiKeys: { scoutUrl: "https://scout.test", scoutToken: "tok" } });
  // A workflow output keeps its deterministic wf:<runId>:<actionId> id (the executor writes it like this).
  const base = S().addPost({ platform: "instagram", title: "From a workflow" });
  const id = "wf:run-1:p1";
  useStore.setState({ posts: S().posts.map((p) => (p.id === base.id ? { ...p, id } : p)) });
  S().updatePost(id, {
    caption: "Made by a workflow",
    plannedDay: "2026-10-20",
    autoPost: { platforms: ["instagram"], mediaUrl: "https://cdn.example/clip.mp4" },
  });
  const mapped = publishJobId({ id });
  expect(mapped).toMatch(PUBLISH_ID_RE);

  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
  const latest = () => postById(S(), id)!;

  expect(await seen.api!.schedule(latest())).toEqual({ ok: true });
  expect(latest().autoPost?.jobId).toBe(mapped);
  expect(latest().stage).toBe("scheduled");

  // The job list read follows the post: nothing shows as a job from another device.
  await act(async () => void (await refreshPublishJobs(() => {})));
  expect(seen.remote).toEqual([]);

  expect(await seen.api!.runNow(latest())).toEqual({ ok: true });
  expect(await seen.api!.cancel(latest())).toEqual({ ok: true });
  expect(latest().autoPost?.jobId).toBeUndefined();
  expect(worker.hits).toEqual([
    `schedule ${mapped}`,
    `schedule ${mapped}`,
    `run ${mapped}`,
    `cancel ${mapped}`,
  ]);
  // The workflow output id itself never changed.
  expect(latest().id).toBe(id);
  act(() => root.unmount());
});

/* ---------- DT-5 Amendment B: lifecycle fences and durable id allocation ---------- */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A ready-to-send Instagram post with the given id (workflow outputs keep their wf: id). */
function seedPost(id: string, over: Partial<Post> = {}): void {
  const base = S().addPost({ platform: "instagram", title: id });
  useStore.setState({
    posts: S().posts.map((p) => (p.id === base.id ? { ...p, id, ...over } : p)),
  });
  S().updatePost(id, {
    caption: "Made by a workflow",
    plannedDay: "2026-10-20",
    autoPost: {
      platforms: ["instagram"],
      mediaUrl: "https://cdn.example/clip.mp4",
      ...over.autoPost,
    },
  });
}

let resyncPostId = "";
function ResyncHarness() {
  const api = usePublish();
  useEffect(() => {
    seen.api = api;
  });
  const post = useStore((s) => s.posts.find((p) => p.id === resyncPostId));
  return post ? createElement(Resync, { post }) : null;
}
function Resync({ post }: { post: Post }) {
  usePublishAutoResync(post);
  return null;
}

async function mountWith(component: () => null | ReturnType<typeof createElement>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(createElement(component)));
  return () => act(() => root.unmount());
}

it("a cancel during an in-flight auto-resync ends cancelled: one DELETE after the POST settles, no re-schedule", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings({ apiKeys: { scoutUrl: "https://scout.test", scoutToken: "tok" } });
  const id = "wf:run-2:p1";
  seedPost(id);
  resyncPostId = id;
  const unmount = await mountWith(ResyncHarness);
  const latest = () => postById(S(), id)!;
  expect(await seen.api!.schedule(latest())).toEqual({ ok: true });
  const jobId = latest().autoPost!.jobId!;

  // An edit re-sends the job by itself; the Worker holds that POST before committing it.
  let release!: () => void;
  worker.ctl.hold = new Promise<void>((r) => (release = r));
  await act(async () => void S().updatePost(id, { caption: "Edited after sending" }));
  await act(() => sleep(1_700));
  expect(worker.ctl.held).toBe(1);

  // Cancel while that POST is out: the DELETE waits for it, then removes what it committed.
  let cancelled: Promise<unknown> | undefined;
  await act(async () => void (cancelled = seen.api!.cancel(latest())));
  await act(() => sleep(50));
  expect(worker.hits.filter((h) => h.startsWith("cancel"))).toEqual([]);
  worker.ctl.hold = null;
  release();
  await act(async () => void (await cancelled));

  expect(worker.hits).toEqual([`schedule ${jobId}`, `schedule ${jobId}`, `cancel ${jobId}`]);
  expect(worker.jobs.size).toBe(0);
  expect(latest().autoPost?.sentAt).toBeUndefined();
  expect(latest().autoPost?.jobId).toBeUndefined();
  // Nothing re-sends a cancelled job, even after another edit.
  await act(async () => void S().updatePost(id, { caption: "Edited after cancel" }));
  await act(() => sleep(1_700));
  expect(worker.hits.filter((h) => h.startsWith("schedule"))).toHaveLength(2);
  unmount();
}, 10_000);

it("keeps the allocated suffix through a lost reply, a changed taken set and a reload; run/cancel never re-allocate", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings({ apiKeys: { scoutUrl: "https://scout.test", scoutToken: "tok" } });
  const id = "wf:run-3:p1";
  const mapped = publishJobId({ id });
  // Another local post's safe id equals the generated candidate: this post must take `-2`.
  seedPost(mapped);
  seedPost(id);
  const unmount = await mountWith(Harness);
  const latest = () => postById(S(), id)!;

  worker.ctl.loseNext = true;
  expect(await seen.api!.schedule(latest())).toMatchObject({ ok: false });
  // The allocation was saved before the create request: remembered, not claimed as sent.
  expect(latest().autoPost).toMatchObject({ jobId: `${mapped}-2` });
  expect(latest().autoPost?.sentAt).toBeUndefined();

  // The other post goes away and the page reloads: the retry still uses the same allocation.
  useStore.setState({ posts: S().posts.filter((p) => p.id !== mapped) });
  await act(async () => void (await useStore.persist.rehydrate()));
  expect(latest().autoPost?.jobId).toBe(`${mapped}-2`);
  expect(await seen.api!.schedule(latest())).toEqual({ ok: true });
  expect(worker.hits).toEqual([`schedule ${mapped}-2`, `schedule ${mapped}-2`]);
  expect([...worker.jobs.keys()]).toEqual([`${mapped}-2`]);

  // An imported post now also claims that job id: run and cancel block instead of acting on it.
  seedPost("other-post", {
    autoPost: { platforms: ["instagram"], jobId: `${mapped}-2` } as Post["autoPost"],
  });
  expect(await seen.api!.cancel(latest())).toEqual({
    ok: false,
    error: "publish.err.ambiguousOwner",
  });
  expect(await seen.api!.runNow(latest())).toEqual({
    ok: false,
    error: "publish.err.ambiguousOwner",
  });
  expect(worker.hits.filter((h) => !h.startsWith("schedule"))).toEqual([]);
  useStore.setState({ posts: S().posts.filter((p) => p.id !== "other-post") });
  expect(await seen.api!.cancel(latest())).toEqual({ ok: true });
  expect(worker.hits.at(-1)).toBe(`cancel ${mapped}-2`);
  unmount();
});

it("a safe-id alias listed first never takes a job another post remembers", () => {
  const mapped = publishJobId({ id: "wf:run-4:p1" });
  const sentAt = "2026-10-06T00:00:00.000Z";
  seedPost(mapped, { autoPost: { platforms: ["instagram"], sentAt } as Post["autoPost"] });
  seedPost("wf:run-4:p1", {
    autoPost: { platforms: ["instagram"], sentAt, jobId: mapped } as Post["autoPost"],
  });
  applyJobs(
    [{ id: mapped, scheduledAt: "", results: { instagram: { state: "processing" } } }],
    vi.fn(),
    new Date("2026-10-06T01:00:00.000Z"),
  );
  expect(postById(S(), "wf:run-4:p1")?.autoPost?.results.instagram?.state).toBe("processing");
  expect(postById(S(), mapped)?.autoPost?.results.instagram).toBeUndefined();
});

/* ---------- DT-5-R1: one ownership decision, durable allocation, one owner per receipt, visible allocations ---------- */

const CFG = { apiKeys: { scoutUrl: "https://scout.test", scoutToken: "tok" } };
const SENT_AT = "2026-10-06T00:00:00.000Z";
const storedPost = (id: string) =>
  JSON.parse(localStorage.getItem(STORAGE_KEY)!).state.posts.find(
    (p: { id: string }) => p.id === id,
  ) as Post | undefined;
const claim = (jobId: string, sent = true) =>
  ({
    platforms: ["instagram"],
    mediaUrl: "https://cdn.example/clip.mp4",
    jobId,
    ...(sent ? { sentAt: SENT_AT } : {}),
  }) as Post["autoPost"];

it("R1: Update schedule and the auto-resync never send a job another post also remembers", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("post-a", { autoPost: claim("shared-job") });
  seedPost("post-b", { autoPost: claim("shared-job") });
  worker.jobs.set("shared-job", { id: "shared-job", caption: "Foreign content" });
  resyncPostId = "post-a";
  const unmount = await mountWith(ResyncHarness);
  const latest = () => postById(S(), "post-a")!;

  expect(await seen.api!.schedule(latest())).toEqual({
    ok: false,
    error: "publish.err.ambiguousOwner",
  });
  await act(async () => {}); // let the hook render its error
  expect(seen.api!.error).toBe("publish.err.ambiguousOwner");
  // An edit of the sent post: the debounced resync makes the same decision.
  await act(async () => void S().updatePost("post-a", { caption: "Edited" }));
  await act(() => sleep(1_700));
  expect(worker.hits).toEqual([]);
  expect(worker.jobs.get("shared-job")).toEqual({ id: "shared-job", caption: "Foreign content" });
  // Run and cancel too: nothing is sent or deleted, neither claimant is cleared.
  expect(await seen.api!.runNow(latest())).toMatchObject({ ok: false });
  expect(await seen.api!.cancel(latest())).toMatchObject({ ok: false });
  expect(worker.hits).toEqual([]);
  expect(postById(S(), "post-b")?.autoPost?.jobId).toBe("shared-job");
  expect(latest().autoPost?.jobId).toBe("shared-job");
  unmount();
}, 10_000);

it("R2: the allocation is in storage before the create leaves; a refused write sends nothing and keeps nothing", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  const id = "wf:run-r2:p1";
  const candidate = publishJobId({ id });
  seedPost(candidate); // occupies the generated candidate: this post must take `-2`
  seedPost(id);
  const unmount = await mountWith(Harness);
  const latest = () => postById(S(), id)!;
  const atEntry: (string | undefined)[] = [];
  worker.ctl.onCreate = () => atEntry.push(storedPost(id)?.autoPost?.jobId);

  // The storage write fails: no request, no memory-only allocation, a visible error.
  const real = Storage.prototype.setItem;
  const quota = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    k,
    v,
  ) {
    if (k === STORAGE_KEY) throw new DOMException("full", "QuotaExceededError");
    real.call(this, k, v);
  });
  expect(await seen.api!.schedule(latest())).toEqual({
    ok: false,
    error: "publish.err.allocation",
  });
  quota.mockRestore();
  expect(worker.hits).toEqual([]);
  expect(latest().autoPost?.jobId).toBeUndefined();
  await act(async () => {});
  expect(seen.api!.busy).toBe(false);

  // Storage works again: the retry commits on the Worker but its reply is lost.
  worker.ctl.loseNext = true;
  expect(await seen.api!.schedule(latest())).toMatchObject({ ok: false });
  expect(atEntry).toEqual([`${candidate}-2`]);
  expect(storedPost(id)?.autoPost?.jobId).toBe(`${candidate}-2`);

  // Reload with the competing alias gone: the retry still sends the same id; one job on the Worker.
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  raw.state.posts = raw.state.posts.filter((p: { id: string }) => p.id !== candidate);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  await act(async () => void (await useStore.persist.rehydrate()));
  expect(await seen.api!.schedule(latest())).toEqual({ ok: true });
  expect(atEntry).toEqual([`${candidate}-2`, `${candidate}-2`]);
  expect([...worker.jobs.keys()]).toEqual([`${candidate}-2`]);
  unmount();
});

it("R2: a memory-only allocation (storage never kept it) is made durable before it is sent", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("p-mem");
  const unmount = await mountWith(Harness);
  // Memory claims an allocation the stored state does not have.
  useStore.setState({
    posts: S().posts.map((p) =>
      p.id === "p-mem" ? { ...p, autoPost: { ...p.autoPost!, jobId: "p-mem" } } : p,
    ),
  });
  const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
  raw.state.posts.find((p: Post) => p.id === "p-mem").autoPost.jobId = undefined;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  const atEntry: (string | undefined)[] = [];
  worker.ctl.onCreate = () => atEntry.push(storedPost("p-mem")?.autoPost?.jobId);
  expect(await seen.api!.schedule(postById(S(), "p-mem")!)).toEqual({ ok: true });
  expect(atEntry).toEqual(["p-mem"]);
  unmount();
});

it("R3: an ambiguous receipt marks nothing posted, copies no results and stays visible, in either order", () => {
  const link = "https://www.instagram.com/reel/X/";
  const jobs: WorkerJob[] = [
    {
      id: "receipt-job",
      scheduledAt: SENT_AT,
      results: { instagram: { state: "published", permalink: link } },
    },
  ];
  for (const order of [
    ["claim-a", "claim-b"],
    ["claim-b", "claim-a"],
  ]) {
    S().reset();
    for (const id of order) seedPost(id, { autoPost: claim("receipt-job") });
    const markPosted = vi.fn();
    applyJobs(jobs, markPosted, new Date("2026-10-06T01:00:00.000Z"));
    expect(markPosted).not.toHaveBeenCalled();
    for (const id of order) {
      expect(postById(S(), id)?.autoPost?.results).toEqual({});
      expect(postById(S(), id)?.stage).not.toBe("posted");
    }
  }
});

it("R3/R4: the hub read keeps an ambiguous job listed and confirms a lost-reply allocation", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("claim-a", { autoPost: claim("both-job") });
  seedPost("claim-b", { autoPost: claim("both-job") });
  worker.jobs.set("both-job", {
    id: "both-job",
    scheduledAt: SENT_AT,
    targets: { instagram: { state: "queued" } },
  });
  seedPost("lost");
  const unmount = await mountWith(Harness);
  worker.ctl.loseNext = true;
  expect(await seen.api!.schedule(postById(S(), "lost")!)).toMatchObject({ ok: false });
  expect(postById(S(), "lost")?.autoPost).toMatchObject({ jobId: "lost" });
  expect(postById(S(), "lost")?.autoPost?.sentAt).toBeUndefined();

  await act(async () => void (await refreshPublishJobs(() => {})));
  expect(seen.remote.map((j) => j.id)).toEqual(["both-job"]);
  // The Worker holds the allocated id: the read confirms it (sent, scheduled, followed).
  expect(postById(S(), "lost")?.autoPost?.sentAt).toBeTruthy();
  expect(postById(S(), "lost")?.stage).toBe("scheduled");
  expect(storedPost("lost")?.autoPost?.sentAt).toBeTruthy();
  unmount();
});

it("R4: Discard releases an allocation only after a successful read without it", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("disc");
  const unmount = await mountWith(Harness);
  const latest = () => postById(S(), "disc")!;
  worker.ctl.loseNext = true;
  expect(await seen.api!.schedule(latest())).toMatchObject({ ok: false });
  expect(latest().autoPost?.jobId).toBe("disc");

  // Offline: unknown, never absent. The allocation stays.
  worker.ctl.failList = true;
  expect(await seen.api!.checkAllocation(latest())).toBe("unknown");
  expect(await seen.api!.discardAllocation(latest())).toEqual({
    ok: false,
    error: "publish.unconfirmed.unknown",
  });
  expect(storedPost("disc")?.autoPost?.jobId).toBe("disc");
  worker.ctl.failList = false;

  // The Worker holds it: Discard refuses and the read confirms the job instead (Cancel is the way out).
  expect(await seen.api!.discardAllocation(latest())).toEqual({
    ok: false,
    error: "publish.unconfirmed.found",
  });
  expect(latest().autoPost?.sentAt).toBeTruthy();
  expect(worker.hits.filter((h) => h.startsWith("cancel"))).toEqual([]);
  expect(await seen.api!.cancel(latest())).toEqual({ ok: true });
  expect(worker.jobs.size).toBe(0);

  // A fresh lost reply, then the Worker drops the job: a read without it lets Discard release the id.
  worker.ctl.loseNext = true;
  expect(await seen.api!.schedule(latest())).toMatchObject({ ok: false });
  worker.jobs.clear();
  expect(await seen.api!.checkAllocation(latest())).toBe("absent");
  expect(await seen.api!.discardAllocation(latest())).toEqual({ ok: true });
  expect(latest().autoPost?.jobId).toBeUndefined();
  expect(storedPost("disc")?.autoPost?.jobId).toBeUndefined();
  unmount();
});

/* ---------- DT-5-R2: ownership and payload re-read after the allocation await; strict absence proof ---------- */

/** The real allocation action; tests that wrap it to inject a race get it back after each test. */
const realAllocate = S().allocatePublishJobId;
afterEach(() => useStore.setState({ allocatePublishJobId: realAllocate }));

/** The store's lock held until released: the allocation waits inside it, as behind another tab's commit. */
function heldLock() {
  let entered!: () => void;
  let release!: () => void;
  const enteredP = new Promise<void>((r) => (entered = r));
  const releaseP = new Promise<void>((r) => (release = r));
  const inner = queueLock();
  setArticlesLock((fn) => {
    entered();
    return releaseP.then(() => inner(fn));
  });
  return { entered: enteredP, release };
}

it("R1-A: a claimant imported while the allocation waits blocks the create; the foreign job is untouched", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("own-a", { autoPost: claim("held-job", false) });
  const foreign = { id: "held-job", scheduledAt: SENT_AT, caption: "Keep this queue content" };
  worker.jobs.set("held-job", foreign);
  const unmount = await mountWith(Harness);
  const held = heldLock();
  let pending!: Promise<unknown>;
  await act(async () => void (pending = seen.api!.schedule(postById(S(), "own-a")!)));
  await held.entered;
  // A same-tab import adds a second post remembering the same job while the lock is held.
  await act(async () => seedPost("imported-b", { autoPost: claim("held-job", false) }));
  held.release();
  let result: unknown;
  await act(async () => void (result = await pending));
  expect(result).toEqual({ ok: false, error: "publish.err.ambiguousOwner" });
  expect(worker.hits).toEqual([]);
  expect(worker.jobs.get("held-job")).toBe(foreign);
  expect(postById(S(), "own-a")?.autoPost?.jobId).toBe("held-job");
  expect(postById(S(), "imported-b")?.autoPost?.jobId).toBe("held-job");
  unmount();
});

it("R1-A: the ownership is rechecked after an allocation that went through", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("own-c");
  const unmount = await mountWith(Harness);
  // The claimant lands right after the commit returns (between the allocation and the create).
  useStore.setState({
    allocatePublishJobId: async (postId: string, jobId: string) => {
      const r = await realAllocate(postId, jobId);
      seedPost("late-claimant", { autoPost: claim(jobId, false) });
      return r;
    },
  });
  expect(await seen.api!.schedule(postById(S(), "own-c")!)).toEqual({
    ok: false,
    error: "publish.err.ambiguousOwner",
  });
  expect(worker.hits).toEqual([]);
  unmount();
});

it("R1-B: a caption edited while the allocation waits is what the Worker receives and what is confirmed", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("edit-a");
  resyncPostId = "edit-a";
  const unmount = await mountWith(ResyncHarness);
  const bodies: string[] = [];
  const impl = worker.impl.getMockImplementation()!;
  worker.impl.mockImplementation(async (input, init) => {
    if (init?.method === "POST" && String(input).endsWith("/social/publish"))
      bodies.push(String(init.body));
    return impl(input, init);
  });
  const held = heldLock();
  let pending!: Promise<unknown>;
  await act(async () => void (pending = seen.api!.schedule(postById(S(), "edit-a")!)));
  await held.entered;
  await act(async () => void S().updatePost("edit-a", { caption: "New caption while save waits" }));
  held.release();
  let result: unknown;
  await act(async () => void (result = await pending));
  expect(result).toEqual({ ok: true });
  expect(bodies).toHaveLength(1);
  const sent = JSON.parse(bodies[0]) as { targets: { instagram: { caption: string } } };
  expect(sent.targets.instagram.caption).toContain("New caption while save waits");
  const latest = postById(S(), "edit-a")!;
  expect(latest.autoPost?.sentAt).toBeTruthy();
  expect(latest.autoPost?.sentHash).toBe(sha256Hex(bodies[0]));
  // Nothing stale is left for the resync to fix: no second create after the debounce.
  await act(() => sleep(1_700));
  expect(bodies).toHaveLength(1);
  unmount();
}, 10_000);

it("R1-B: an edit while the create is out is re-sent by the auto-resync (the sent digest no longer matches)", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("edit-b");
  resyncPostId = "edit-b";
  const unmount = await mountWith(ResyncHarness);
  let release!: () => void;
  worker.ctl.hold = new Promise<void>((r) => (release = r));
  let pending!: Promise<unknown>;
  await act(async () => void (pending = seen.api!.schedule(postById(S(), "edit-b")!)));
  await act(() => sleep(20));
  expect(worker.ctl.held).toBe(1);
  await act(
    async () => void S().updatePost("edit-b", { caption: "Edited while the create is out" }),
  );
  worker.ctl.hold = null;
  release();
  await act(async () => void (await pending));
  await act(() => sleep(1_700));
  expect(worker.hits).toEqual(["schedule edit-b", "schedule edit-b"]);
  const job = worker.jobs.get("edit-b") as { targets: { instagram: { caption?: string } } };
  expect(job.targets.instagram).toBeTruthy();
  expect(postById(S(), "edit-b")?.autoPost?.sentHash).toBeTruthy();
  unmount();
}, 10_000);

it("R1-B: a post removed while the allocation waits is never sent", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("gone-a");
  const unmount = await mountWith(Harness);
  useStore.setState({
    allocatePublishJobId: async (postId: string, jobId: string) => {
      const r = await realAllocate(postId, jobId);
      S().removePost(postId);
      return r;
    },
  });
  expect(await seen.api!.schedule(postById(S(), "gone-a")!)).toEqual({
    ok: false,
    error: "publish.superseded",
  });
  expect(worker.hits).toEqual([]);
  unmount();
});

it("R1-C: a failed release write with a denied read-back reports failure and keeps the id", async () => {
  const worker = fakeWorker();
  vi.stubGlobal("fetch", worker.impl);
  S().setSettings(CFG);
  seedPost("rel-a", { autoPost: claim("release-needs-proof", false) });
  const unmount = await mountWith(Harness);
  const realSet = Storage.prototype.setItem;
  const realGet = Storage.prototype.getItem;
  let attempted = false;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k, v) {
    if (k === STORAGE_KEY) {
      attempted = true;
      throw new DOMException("quota during release", "QuotaExceededError");
    }
    realSet.call(this, k, v);
  });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k) {
    if (k === STORAGE_KEY && attempted) throw new DOMException("denied", "SecurityError");
    return realGet.call(this, k);
  });
  let result: unknown;
  try {
    result = await seen.api!.discardAllocation(postById(S(), "rel-a")!);
  } finally {
    vi.restoreAllMocks();
  }
  expect(result).toEqual({ ok: false, error: "publish.err.allocation" });
  expect(storedPost("rel-a")?.autoPost?.jobId).toBe("release-needs-proof");
  expect(postById(S(), "rel-a")?.autoPost?.jobId).toBe("release-needs-proof");
  unmount();
});

for (const shape of ["missing jobs", "incomplete row"] as const) {
  it(`R1-D: a malformed list (${shape}) is unknown: Discard refused, the id kept`, async () => {
    const worker = fakeWorker();
    S().setSettings(CFG);
    const jobId = "live-job-needs-proof";
    seedPost("mal-a", { autoPost: claim(jobId, false) });
    worker.jobs.set(jobId, {
      id: jobId,
      scheduledAt: SENT_AT,
      targets: { instagram: { state: "queued" } },
    });
    const body = shape === "missing jobs" ? {} : { jobs: [{ id: jobId }] };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (new URL(String(input)).pathname === "/social/publish" && !init?.method)
          return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        return worker.impl(input, init);
      }),
    );
    const unmount = await mountWith(Harness);
    expect(await seen.api!.checkAllocation(postById(S(), "mal-a")!)).toBe("unknown");
    expect(await seen.api!.discardAllocation(postById(S(), "mal-a")!)).toEqual({
      ok: false,
      error: "publish.unconfirmed.unknown",
    });
    expect(storedPost("mal-a")?.autoPost?.jobId).toBe(jobId);
    expect(worker.jobs.has(jobId)).toBe(true);
    unmount();
  });
}
