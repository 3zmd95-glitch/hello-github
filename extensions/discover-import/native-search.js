import { collectNativeDiscoverCards } from "./native-capture.js";
import {
  NATIVE_ORIGINS,
  nativeSearchUrl,
  nativePostIdentity,
  parseNativeRequest,
  sanitizeNativeResults,
  sameNativeSearchPage,
  trustedDiscoverSender,
} from "./native-protocol.js";

const STORAGE_KEY = "discoverNativeJobsV1";
const ALARM_PREFIX = "discover-native-expiry:";
const TTL_MS = 15 * 60 * 1000;
const MAX_JOBS = 3;
const RESTORE_POLL_MS = 15000;

/** API injection makes tab ownership, cancellation and permission boundaries testable. */
export function createNativeSearchService(api, options = {}) {
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const id = options.id || (() => crypto.randomUUID());
  const jobs = new Map();
  const focusRequests = new Map();
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
        Object.keys(job.platforms).some((platform) => Number.isInteger(job.tabs[platform])),
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
  function discardFocus(jobId, expected = focusRequests.get(jobId)) {
    if (!expected || focusRequests.get(jobId) !== expected) return;
    expected.allowed = false;
    clearTimeout(expected.restoreTimer);
    focusRequests.delete(jobId);
  }
  async function beginFocus(job) {
    if (!api.tabs.query || !api.tabs.update || !api.windows?.getLastFocused) return null;
    try {
      const owner = await api.tabs.get(job.ownerTabId);
      const [selected] = await api.tabs.query({ active: true, lastFocusedWindow: true });
      const window = await api.windows.getLastFocused();
      const focus = {
        windowId: owner.windowId,
        expectedTabId: job.ownerTabId,
        platform: null,
        allowed:
          live(job) &&
          window.focused &&
          window.id === owner.windowId &&
          selected?.id === job.ownerTabId,
      };
      focusRequests.set(job.id, focus);
      return focus;
    } catch {
      return null;
    }
  }
  async function canSwitchFocus(job, focus, context = null, allowCompleted = false) {
    const eligible = () =>
      live(job) ||
      (allowCompleted &&
        jobs.get(job.id) === job &&
        job.status === "complete" &&
        job.expiresAt > now() &&
        focus?.pendingUntil > now());
    if (context?.active === false || !focus?.allowed || !eligible()) return false;
    const [selected] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (context?.active === false) return false;
    const window = await api.windows.getLastFocused();
    if (context?.active === false) return false;
    if (
      !focus.allowed ||
      !eligible() ||
      !window.focused ||
      window.id !== focus.windowId ||
      selected?.windowId !== focus.windowId ||
      selected.id !== focus.expectedTabId ||
      (focus.platform &&
        !sameNativeSearchPage(
          focus.platform,
          selected.url,
          job.platforms[focus.platform].searchUrl,
        ))
    ) {
      focus.allowed = false;
      return false;
    }
    return true;
  }
  async function focusOwnedTab(job, platform, focus, context) {
    try {
      if (!context.active || !(await canSwitchFocus(job, focus, context)) || !context.active)
        return;
      const tab = await api.tabs.get(job.tabs[platform]);
      if (
        !context.active ||
        !focus.allowed ||
        !live(job) ||
        tab.windowId !== focus.windowId ||
        (!sameNativeSearchPage(platform, tab.url, job.platforms[platform].searchUrl) &&
          !sameNativeSearchPage(platform, tab.pendingUrl, job.platforms[platform].searchUrl))
      )
        return;
      focus.expectedTabId = tab.id;
      focus.platform = platform;
      await api.tabs.update(tab.id, { active: true });
    } catch {
      if (context.active && focus) focus.allowed = false;
    }
  }
  async function restoreDiscover(job, focus, ownerSender = null) {
    let pending = false;
    try {
      // A fresh browser-authenticated owner poll can verify the original
      // Discover document when Chrome withholds localhost's tabs.Tab.url.
      const authenticatedPoll =
        !!ownerSender &&
        !!job.ownerDocumentId &&
        trustedDiscoverSender(ownerSender) &&
        sameOwner(job, ownerSender) &&
        ownerSender.documentId === job.ownerDocumentId;
      if (ownerSender && !authenticatedPoll) return;
      if (
        !Object.values(job.tabs).includes(focus?.expectedTabId) ||
        !(await canSwitchFocus(job, focus, null, authenticatedPoll))
      )
        return;
      const owner = await api.tabs.get(job.ownerTabId);
      const isDiscover = (url) =>
        trustedDiscoverSender({ url, tab: { id: job.ownerTabId }, frameId: 0 });
      if (
        owner.windowId !== focus.windowId ||
        owner.status === "loading" ||
        (owner.url !== undefined && !isDiscover(owner.url)) ||
        (owner.pendingUrl && !isDiscover(owner.pendingUrl)) ||
        !(await canSwitchFocus(job, focus, null, authenticatedPoll))
      )
        return;
      if (owner.url === undefined && !authenticatedPoll) {
        if (!job.ownerDocumentId) return;
        focus.pendingUntil = now() + RESTORE_POLL_MS;
        focus.restoreTimer = setTimeout(() => discardFocus(job.id, focus), RESTORE_POLL_MS);
        pending = true;
        return;
      }
      focus.expectedTabId = job.ownerTabId;
      focus.platform = null;
      await api.tabs.update(job.ownerTabId, { active: true });
    } catch {
      /* A closed or changed owner tab is never recreated. */
    } finally {
      if (!pending) discardFocus(job.id, focus);
    }
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
    discardFocus(job.id);
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
      job.cursors ||= {};
      for (const [platform, state] of Object.entries(job.platforms)) {
        state.omittedCount =
          Number.isSafeInteger(state.omittedCount) && state.omittedCount >= 0
            ? state.omittedCount
            : 0;
        job.cursors[platform] ||= state.results.at(-1)?.url || null;
      }
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
    const seen = new Map(
      state.results.map((result) => [nativePostIdentity(platform, result.url), result.url]),
    );
    const target = 30;
    let added = 0;
    const started = now();
    let scroll = more;
    let lastGrowthAt = started;
    let lastScrollAt = started;
    let scrolls = 0;
    let collectedOnce = false;
    try {
      if (!Number.isInteger(job.tabs[platform])) {
        if (more) {
          state.status = "needs-attention";
          state.error = "source-tab-closed";
          return;
        }
        const tab = await api.tabs.create({
          url: state.searchUrl,
          active: false,
          ...(Number.isInteger(context.focus?.windowId)
            ? { windowId: context.focus.windowId }
            : {}),
        });
        if (!Number.isInteger(tab.id)) throw new Error("tab-open-failed");
        job.tabs[platform] = tab.id;
        if (!active()) {
          await closeOwnedTab(job, platform);
          return;
        }
        await persist();
      }
      await focusOwnedTab(job, platform, context.focus, context);
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
          args: [
            platform,
            state.searchUrl,
            more ? target - added : target,
            scroll,
            ...(more
              ? [{ knownUrls: [...seen.values()], lastUrl: job.cursors[platform] || null }]
              : []),
          ],
        });
        if (!active()) return;
        const wasScroll = scroll;
        if (wasScroll) {
          scrolls++;
          lastScrollAt = now();
        }
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
        context.collectedOnce = true;
        const fresh = sanitizeNativeResults(
          platform,
          collected.results,
          new Date(now()).toISOString(),
        );
        const byUrl = new Map(
          state.results.map((result) => [nativePostIdentity(platform, result.url), result]),
        );
        for (const result of fresh) {
          const key = nativePostIdentity(platform, result.url);
          if (seen.has(key)) {
            if (byUrl.has(key)) byUrl.set(key, result);
            continue;
          }
          seen.set(key, result.url);
          byUrl.set(key, result);
          job.cursors[platform] = result.url;
          added++;
          lastGrowthAt = now();
          if (added >= target) break;
        }
        const all = [...byUrl.values()];
        const dropped = Math.max(0, all.length - 300);
        state.omittedCount = Math.min(Number.MAX_SAFE_INTEGER, (state.omittedCount || 0) + dropped);
        state.results = all
          .slice(dropped)
          .map((result, position) => ({ ...result, position: position + 1 }));
        await persist();
        // Initial native grids often hydrate a small first row, then render
        // the remaining cards later. Keep reading without scrolling until the
        // grid has had eight seconds and four seconds without new cards.
        if (added >= target) break;
        if (more && !wasScroll && now() - Math.max(lastScrollAt, lastGrowthAt) >= 4000) {
          if (scrolls >= 3) break;
          scroll = true;
        }
        if (!more && added > 0 && now() - started >= 8000 && now() - lastGrowthAt >= 4000) break;
        await sleep(1000);
      }
      if (active()) {
        if (!collectedOnce) {
          state.status = "error";
          state.error = "search-timeout";
          return;
        }
        state.status = state.results.length ? "done" : "empty";
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
    const focus = await beginFocus(job);
    for (const platform of Object.keys(job.platforms)) {
      if (!live(job)) break;
      const context = { active: true, focus };
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          context.active = false;
          if (live(job)) {
            if (context.collectedOnce) {
              job.platforms[platform].status = job.platforms[platform].results.length
                ? "done"
                : "empty";
              delete job.platforms[platform].error;
            } else {
              job.platforms[platform].status = "error";
              job.platforms[platform].error = "search-timeout";
            }
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
    }
    await restoreDiscover(job, focus);
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
        cursors: {},
        tabs: {},
        platforms: Object.fromEntries(
          Object.entries(request.queries).map(([platform, query]) => [
            platform,
            {
              status: "loading",
              results: [],
              omittedCount: 0,
              searchUrl: nativeSearchUrl(platform, query),
            },
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
    if (request.type === "poll") {
      const focus = focusRequests.get(job.id);
      if (job.status === "complete" && focus?.pendingUntil)
        await restoreDiscover(job, focus, sender);
      return publicJob(job);
    }
    if (request.type === "cancel") return cancel(job);
    if (job.status === "running") return publicJob(job);
    if (job.status === "cancelled") return { ok: false, error: "job-not-found" };
    discardFocus(job.id);
    job.expiresAt = now() + TTL_MS;
    await api.alarms.create(`${ALARM_PREFIX}${job.id}`, { when: job.expiresAt });
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
  function onTabActivated(info) {
    for (const focus of focusRequests.values()) {
      if (info.windowId !== focus.windowId || info.tabId !== focus.expectedTabId)
        focus.allowed = false;
    }
  }
  function onWindowFocusChanged(windowId) {
    for (const focus of focusRequests.values())
      if (windowId !== focus.windowId) focus.allowed = false;
  }
  return { handle, onAlarm, onTabRemoved, onTabActivated, onWindowFocusChanged, ready };
}
