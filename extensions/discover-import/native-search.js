import { collectNativeDiscoverCards } from "./native-capture.js";
import {
  NATIVE_ORIGINS,
  nativeSearchUrl,
  parseNativeRequest,
  sanitizeNativeResults,
  sameNativeSearchPage,
  trustedDiscoverSender,
} from "./native-protocol.js";

const STORAGE_KEY = "discoverNativeJobsV1";
const ALARM_PREFIX = "discover-native-expiry:";
const TTL_MS = 15 * 60 * 1000;
const MAX_JOBS = 3;

/** API injection makes tab ownership, cancellation and permission boundaries testable. */
export function createNativeSearchService(api, options = {}) {
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const id = options.id || (() => crypto.randomUUID());
  const jobs = new Map();
  let mutationQueue = Promise.resolve();
  let persistenceQueue = Promise.resolve();

  function persist() {
    const snapshot = structuredClone([...jobs.values()]);
    persistenceQueue = persistenceQueue
      .catch(() => {})
      .then(() => api.storage.session.set({ [STORAGE_KEY]: snapshot }));
    return persistenceQueue;
  }
  function publicJob(job) {
    return structuredClone({
      ok: true,
      jobId: job.id,
      status: job.status,
      platforms: job.platforms,
      hasMore:
        job.status === "complete" &&
        job.moreCount < 2 &&
        Object.entries(job.platforms).some(
          ([platform, state]) =>
            Number.isInteger(job.tabs[platform]) &&
            state.results.length < 90 &&
            !job.exhausted?.[platform],
        ),
    });
  }
  function sameOwner(job, sender) {
    return (
      job.ownerTabId === sender.tab.id &&
      (!job.ownerDocumentId || job.ownerDocumentId === sender.documentId)
    );
  }
  function live(job) {
    return jobs.get(job.id) === job && job.status === "running" && job.expiresAt > now();
  }
  async function closeOwnedTab(job, platform) {
    const tabId = job.tabs[platform];
    delete job.tabs[platform];
    if (!Number.isInteger(tabId)) return;
    try {
      const tab = await api.tabs.get(tabId);
      // If the user navigated this tab elsewhere, leave it alone.
      if (
        sameNativeSearchPage(platform, tab.url, job.platforms[platform].searchUrl) ||
        sameNativeSearchPage(platform, tab.pendingUrl, job.platforms[platform].searchUrl)
      )
        await api.tabs.remove(tabId);
    } catch {
      /* Already closed. */
    }
  }
  async function cancel(job) {
    job.status = "cancelled";
    await Promise.all(Object.keys(job.tabs).map((platform) => closeOwnedTab(job, platform)));
    await persist();
    return publicJob(job);
  }
  async function removeExpired() {
    for (const job of jobs.values()) {
      if (job.expiresAt <= now()) {
        await cancel(job);
        jobs.delete(job.id);
        await api.alarms.clear(`${ALARM_PREFIX}${job.id}`);
      }
    }
    await persist();
  }
  const ready = (async () => {
    const stored = await api.storage.session.get(STORAGE_KEY);
    for (const job of Array.isArray(stored[STORAGE_KEY])
      ? stored[STORAGE_KEY].slice(0, MAX_JOBS)
      : []) {
      if (
        !job ||
        typeof job.id !== "string" ||
        !Number.isInteger(job.ownerTabId) ||
        !job.tabs ||
        !job.platforms
      )
        continue;
      jobs.set(job.id, job);
      job.exhausted ||= {};
      // A suspended/restarted worker cannot resume an unbounded background task.
      // Preserve collected cards and let a later explicit More request retry.
      if (job.status === "running") {
        job.status = "complete";
        for (const state of Object.values(job.platforms)) {
          if (state.status === "loading") {
            state.status = "error";
            state.error = "search-interrupted";
          }
        }
      }
      await api.alarms.create(`${ALARM_PREFIX}${job.id}`, { when: job.expiresAt });
    }
    await removeExpired();
  })();

  async function collectPlatform(job, platform, more, context) {
    const active = () => context.active && live(job);
    const state = job.platforms[platform];
    const previous = state.results;
    const target = Math.min(90, 30 * (job.moreCount + 1));
    const started = now();
    let scroll = more;
    let lastCount = previous.length;
    let lastGrowthAt = started;
    let collectedOnce = false;
    try {
      if (!Number.isInteger(job.tabs[platform])) {
        if (more) {
          state.status = "needs-attention";
          state.error = "source-tab-closed";
          return;
        }
        const tab = await api.tabs.create({ url: state.searchUrl, active: false });
        if (!Number.isInteger(tab.id)) throw new Error("tab-open-failed");
        job.tabs[platform] = tab.id;
        if (!active()) {
          await closeOwnedTab(job, platform);
          return;
        }
        await persist();
      }
      for (let attempt = 0; attempt < 25 && now() - started < 25000 && active(); attempt++) {
        const tab = await api.tabs.get(job.tabs[platform]);
        if (!active()) return;
        if (tab.status === "loading" || (!tab.url && tab.pendingUrl === state.searchUrl)) {
          await sleep(1000);
          continue;
        }
        if (!sameNativeSearchPage(platform, tab.url, state.searchUrl)) {
          state.status = "needs-attention";
          state.error = "search-page-changed";
          return;
        }
        const [injection] = await api.scripting.executeScript({
          target: { tabId: job.tabs[platform] },
          func: collectNativeDiscoverCards,
          args: [platform, state.searchUrl, target, scroll],
        });
        if (!active()) return;
        const wasScroll = scroll;
        scroll = false;
        const collected = injection?.result;
        if (collected?.status === "needs-attention" || collected?.status === "error") {
          state.status = collected.status;
          state.error = ["login-or-challenge", "search-page-changed", "unsupported-page"].includes(
            collected.error,
          )
            ? collected.error
            : "read-failed";
          return;
        }
        if (!collected || !Array.isArray(collected.results)) throw new Error("read-failed");
        collectedOnce = true;
        const fresh = sanitizeNativeResults(
          platform,
          collected.results,
          new Date(now()).toISOString(),
        );
        const byUrl = new Map(previous.map((result) => [result.url, result]));
        // Keep earlier pages even when a site virtualizes/removes those DOM cards.
        for (const result of state.results) byUrl.set(result.url, result);
        for (const result of fresh) byUrl.set(result.url, result);
        state.results = [...byUrl.values()]
          .slice(0, target)
          .map((result, position) => ({ ...result, position: position + 1 }));
        if (state.results.length > lastCount) lastGrowthAt = now();
        lastCount = state.results.length;
        await persist();
        // Initial native grids often hydrate a small first row, then render
        // the remaining cards later. Keep reading without scrolling until the
        // grid has had eight seconds and four seconds without new cards.
        const settled = more
          ? now() - started >= 4000 && now() - lastGrowthAt >= 4000
          : now() - started >= 8000 && now() - lastGrowthAt >= 4000;
        if (
          !wasScroll &&
          (state.results.length >= target ||
            ((more || state.results.length > previous.length) && settled))
        )
          break;
        await sleep(1000);
      }
      if (active()) {
        if (!collectedOnce) {
          state.status = "error";
          state.error = "search-timeout";
          return;
        }
        state.status = state.results.length ? "done" : "empty";
        if (more && state.results.length <= previous.length) job.exhausted[platform] = true;
        if (!more && !state.results.length) job.exhausted[platform] = true;
        delete state.error;
      }
    } catch {
      if (active()) {
        state.status = "error";
        state.error = "read-failed";
      }
    }
  }
  async function run(job, more) {
    await Promise.all(
      Object.keys(job.platforms).map(async (platform) => {
        const context = { active: true };
        let timer;
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
            context.active = false;
            if (live(job)) {
              job.platforms[platform].status = "error";
              job.platforms[platform].error = "search-timeout";
            }
            resolve();
          }, 25000);
        });
        try {
          await Promise.race([collectPlatform(job, platform, more, context), timeout]);
        } finally {
          context.active = false;
          clearTimeout(timer);
        }
      }),
    );
    if (live(job)) job.status = "complete";
    await persist();
  }
  async function execute(message, sender) {
    if (!trustedDiscoverSender(sender)) return { ok: false, error: "forbidden" };
    const request = parseNativeRequest(message);
    if (!request) return { ok: false, error: "invalid-request" };
    await ready;
    await removeExpired();
    const connected = await api.permissions.contains({ origins: NATIVE_ORIGINS });
    if (request.type === "status") return { ok: true, version: 1, connected };
    // Cancelling or viewing an owned job remains possible after permissions are revoked.
    if (["search", "more"].includes(request.type) && !connected)
      return { ok: false, error: "not-connected" };
    if (request.type === "search") {
      const previous = [...jobs.values()].filter((job) => job.ownerTabId === sender.tab.id);
      const duplicate = previous.find(
        (job) =>
          sameOwner(job, sender) &&
          job.requestId === request.requestId &&
          job.status !== "cancelled",
      );
      if (duplicate) return { ok: true, jobId: duplicate.id };
      for (const job of previous) {
        await cancel(job);
        jobs.delete(job.id);
        await api.alarms.clear(`${ALARM_PREFIX}${job.id}`);
      }
      if (jobs.size >= MAX_JOBS) return { ok: false, error: "busy" };
      const job = {
        id: id(),
        requestId: request.requestId,
        ownerTabId: sender.tab.id,
        ownerDocumentId: sender.documentId || null,
        expiresAt: now() + TTL_MS,
        status: "running",
        moreCount: 0,
        exhausted: {},
        tabs: {},
        platforms: Object.fromEntries(
          Object.entries(request.queries).map(([platform, query]) => [
            platform,
            { status: "loading", results: [], searchUrl: nativeSearchUrl(platform, query) },
          ]),
        ),
      };
      jobs.set(job.id, job);
      await api.alarms.create(`${ALARM_PREFIX}${job.id}`, { when: job.expiresAt });
      await persist();
      void run(job, false).catch(async () => {
        await cancel(job).catch(() => {});
      });
      return { ok: true, jobId: job.id };
    }
    const job = jobs.get(request.jobId);
    if (!job || !sameOwner(job, sender)) return { ok: false, error: "job-not-found" };
    if (request.type === "poll") return publicJob(job);
    if (request.type === "cancel") return cancel(job);
    if (job.status === "running") return publicJob(job);
    if (job.status === "cancelled") return { ok: false, error: "job-not-found" };
    if (job.moreCount >= 2) return { ok: false, error: "limit-reached" };
    job.moreCount++;
    job.status = "running";
    for (const state of Object.values(job.platforms)) {
      state.status = "loading";
      delete state.error;
    }
    await persist();
    void run(job, true).catch(async () => {
      await cancel(job).catch(() => {});
    });
    return publicJob(job);
  }
  function handle(message, sender) {
    const result = mutationQueue.catch(() => {}).then(() => execute(message, sender));
    mutationQueue = result;
    return result.catch(() => ({ ok: false, error: "internal-error" }));
  }
  async function onAlarm(alarm) {
    if (!alarm?.name?.startsWith(ALARM_PREFIX)) return;
    await ready;
    await removeExpired();
  }
  async function onTabRemoved(tabId) {
    await ready;
    for (const job of jobs.values()) {
      if (job.ownerTabId === tabId) {
        await cancel(job);
        jobs.delete(job.id);
        await api.alarms.clear(`${ALARM_PREFIX}${job.id}`);
      } else
        for (const [platform, ownedId] of Object.entries(job.tabs)) {
          if (ownedId === tabId) {
            delete job.tabs[platform];
            job.platforms[platform].status = "needs-attention";
            job.platforms[platform].error = "source-tab-closed";
          }
        }
    }
    await persist();
  }
  return { handle, onAlarm, onTabRemoved, ready };
}
