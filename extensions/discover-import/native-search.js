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
// Instagram often renders a first row, then hydrates the grid many seconds later.
const IG_HYDRATION_MS = 18000;
// Per-platform bounds. A deep job's (explicit Deep search) initial read reads up
// to 60 cards and may scroll its own search tab; a quiet job's (normal Search)
// initial read reads up to 30 without scrolling. A Deep search whose Discover tab
// is not in front runs the quiet budget. A More request adds up to 30 and allows
// four scroll cycles in both modes.
const INITIAL_CAP_MS = 40000;
const MORE_CAP_MS = 25000;
const QUIET_CAP_MS = 25000;
const SCROLL_CYCLES = 4;
const capFor = (deep, more) => (more ? MORE_CAP_MS : deep ? INITIAL_CAP_MS : QUIET_CAP_MS);

/** The observed native order is authoritative for cards it shows. A retained
 * card it no longer shows stays right after its nearest preceding shown card
 * (or first). Keys absent from `order` keep the map's insertion order. */
function observedOrder(byKey, order) {
  const rank = new Map();
  for (const key of order) if (!rank.has(key)) rank.set(key, rank.size);
  const trailing = new Map([[null, []]]);
  let anchor = null;
  for (const key of byKey.keys()) {
    if (rank.has(key)) trailing.set((anchor = key), []);
    else trailing.get(anchor).push(key);
  }
  const shown = [...trailing.keys()].filter((key) => key !== null);
  shown.sort((a, b) => rank.get(a) - rank.get(b));
  return [null, ...shown]
    .flatMap((key) => (key === null ? [] : [key]).concat(trailing.get(key)))
    .map((key) => byKey.get(key));
}

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
      ...(job.diagnostics ? { diagnostics: job.diagnostics } : {}),
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
  /** Ends automatic focus handling for this job for good and records the first reason. */
  function stopFocus(focus, reason) {
    if (focus?.allowed && focus.diagnostics) focus.diagnostics.stopped ||= reason;
    if (focus) focus.allowed = false;
  }
  async function beginFocus(job) {
    const diagnostics = (job.diagnostics.focus = {
      eligible: false,
      skipReason: "focus-api-unavailable",
      activated: [],
      restored: false,
    });
    if (!api.tabs.query || !api.tabs.update || !api.windows?.getLastFocused) return null;
    try {
      const owner = await api.tabs.get(job.ownerTabId);
      const [selected] = await api.tabs.query({ active: true, lastFocusedWindow: true });
      const window = await api.windows.getLastFocused();
      const skipReason = !live(job)
        ? "job-not-live"
        : !window.focused
          ? "window-not-focused"
          : window.id !== owner.windowId
            ? "other-window"
            : selected?.id !== job.ownerTabId
              ? "owner-not-selected"
              : undefined;
      const focus = {
        windowId: owner.windowId,
        ownerTabId: job.ownerTabId,
        // The job's own tabs object: the user may select Discover or any of these.
        tabs: job.tabs,
        expectedTabId: job.ownerTabId,
        allowed: !skipReason,
        diagnostics,
      };
      diagnostics.eligible = !skipReason;
      if (skipReason) diagnostics.skipReason = skipReason;
      else delete diagnostics.skipReason;
      focusRequests.set(job.id, focus);
      return focus;
    } catch {
      diagnostics.skipReason = "owner-lookup-failed";
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
    // Discover or one of this job's own tabs (still on its search) may be selected.
    const platform = Object.keys(job.tabs).find((key) => job.tabs[key] === selected?.id);
    const searchUrl = platform && job.platforms[platform].searchUrl;
    const reason =
      !focus.allowed || !eligible()
        ? "job-ended"
        : !window.focused
          ? "window-not-focused"
          : window.id !== focus.windowId || selected?.windowId !== focus.windowId
            ? "other-window"
            : selected.id !== job.ownerTabId && !platform
              ? "other-tab"
              : platform &&
                  !sameNativeSearchPage(platform, selected.url, searchUrl) &&
                  !sameNativeSearchPage(platform, selected.pendingUrl, searchUrl)
                ? "tab-navigated"
                : null;
    if (reason) stopFocus(focus, reason);
    return !reason;
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
      await api.tabs.update(tab.id, { active: true });
      job.diagnostics?.focus?.activated.push(platform);
    } catch {
      if (context.active) stopFocus(focus, "activate-failed");
    }
  }
  async function restoreDiscover(job, focus, ownerSender = null) {
    let pending = false;
    let restored = "skipped";
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
        focus.restoreTimer = setTimeout(() => {
          discardFocus(job.id, focus);
          if (job.diagnostics?.focus?.restored === "pending")
            job.diagnostics.focus.restored = "skipped";
        }, RESTORE_POLL_MS);
        pending = true;
        restored = "pending";
        return;
      }
      focus.expectedTabId = job.ownerTabId;
      await api.tabs.update(job.ownerTabId, { active: true });
      restored = true;
    } catch {
      /* A closed or changed owner tab is never recreated. */
    } finally {
      if (!pending) discardFocus(job.id, focus);
      if (job.diagnostics?.focus) job.diagnostics.focus.restored = restored;
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
  async function drop(job) {
    await cancel(job);
    jobs.delete(job.id);
    await api.alarms.clear(`${ALARM_PREFIX}${job.id}`);
  }
  async function removeExpired() {
    for (const job of jobs.values()) if (job.expiresAt <= now()) await drop(job);
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
    const deep = context.deep;
    const target = more || !deep ? 30 : 60;
    const timeCap = capFor(deep, more);
    let added = 0;
    const started = now();
    let scroll = more;
    let lastGrowthAt = started;
    let lastScrollAt = started;
    let scrolls = 0;
    let collectedOnce = false;
    // The initial settle window starts at the first successful read, not at tab creation.
    let collectedAt = null;
    let firstRow = 0;
    let stopReason = "cancelled";
    let tabMisses = 0;
    const diagnostics = (state.diagnostics = {
      returned: 0,
      added: 0,
      elapsedMs: 0,
      stopReason: "running",
      transientErrors: 0,
      serviceErrorReloads: 0,
    });
    let serviceErrorSeen = false;
    try {
      if (!Number.isInteger(job.tabs[platform])) {
        if (more) {
          stopReason = "needs-attention";
          state.status = "needs-attention";
          state.error = "source-tab-closed";
          return;
        }
        // Always the originating Discover tab's own window, never a new or other one.
        const tab = await api.tabs.create({
          url: state.searchUrl,
          active: false,
          windowId: job.ownerWindowId,
        });
        if (!Number.isInteger(tab.id)) throw new Error("tab-open-failed");
        job.tabs[platform] = tab.id;
        if (!active()) {
          await closeOwnedTab(job, platform);
          return;
        }
        await persist();
      }
      if (deep) await focusOwnedTab(job, platform, context.focus, context);
      for (
        let attempt = 0;
        attempt < timeCap / 1000 && now() - started < timeCap && active();
        attempt++
      ) {
        let tab;
        try {
          tab = await api.tabs.get(job.tabs[platform]);
          tabMisses = 0;
        } catch (error) {
          // One failed lookup can race a navigation; a second in a row means the tab is gone.
          if (++tabMisses > 1) throw error;
          if (!active()) return;
          diagnostics.transientErrors++;
          await sleep(1000);
          continue;
        }
        if (!active()) return;
        if (tab.status === "loading" || (!tab.url && tab.pendingUrl === state.searchUrl)) {
          await sleep(1000);
          continue;
        }
        if (!sameNativeSearchPage(platform, tab.url, state.searchUrl)) {
          stopReason = "page-changed";
          state.status = "needs-attention";
          state.error = "search-page-changed";
          return;
        }
        let injection;
        try {
          [injection] = await api.scripting.executeScript({
            target: { tabId: job.tabs[platform] },
            func: collectNativeDiscoverCards,
            args: [
              platform,
              state.searchUrl,
              more ? target - added : target,
              scroll,
              // knownTotal/omitted tell the collector whether knownUrls holds every
              // card this job ever read (nothing trimmed), so it may recover a
              // late-hydrated card before the first known one.
              ...(more
                ? [
                    {
                      knownUrls: [...seen.values()],
                      lastUrl: job.cursors[platform] || null,
                      knownTotal: seen.size,
                      omitted: state.omittedCount,
                    },
                  ]
                : []),
            ],
          });
        } catch {
          // A page still loading or redirecting can drop its frame mid-injection
          // ("Frame with ID 0 was removed"): retry until the platform's cap.
          if (!active()) return;
          diagnostics.transientErrors++;
          await sleep(1000);
          continue;
        }
        if (!active()) return;
        const read = injection?.result;
        if (
          !Array.isArray(read?.results) &&
          read?.status !== "error" &&
          read?.status !== "needs-attention"
        ) {
          // Resolved without a card list (frame replaced, or the injected function threw
          // in a background tab): a transient miss like a rejection. Keep only the message.
          diagnostics.lastInjectionError = String(
            injection?.error?.message ?? injection?.error ?? "no-result",
          ).slice(0, 200);
          diagnostics.transientErrors++;
          await sleep(1000);
          continue;
        }
        const wasScroll = scroll;
        if (wasScroll) {
          scrolls++;
          lastScrollAt = now();
        }
        scroll = false;
        const collected = injection?.result;
        if (collected?.status === "error" && collected.error === "search-service-error") {
          // The platform's own "Something went wrong / Try again" screen: reload our own
          // tab once per platform per job, then keep reading until the cap.
          serviceErrorSeen = true;
          if (!diagnostics.serviceErrorReloads) {
            diagnostics.serviceErrorReloads = 1;
            await api.tabs.reload(job.tabs[platform]);
            if (!active()) return;
          }
          await sleep(1000);
          continue;
        }
        if (collected?.status === "needs-attention" || collected?.status === "error") {
          stopReason = collected.status === "error" ? "read-failed" : "needs-attention";
          state.status = collected.status;
          state.error = ["login-or-challenge", "search-page-changed", "unsupported-page"].includes(
            collected.error,
          )
            ? collected.error
            : "read-failed";
          return;
        }
        if (collected?.noResults === true && !state.results.length) {
          // The platform's own "No results" screen for this exact query: genuinely
          // empty, so end now instead of waiting out the cap.
          stopReason = "no-results";
          state.status = "empty";
          state.noResults = true;
          delete state.error;
          return;
        }
        collectedOnce = true;
        context.collectedOnce = true;
        collectedAt ??= now();
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
        firstRow ||= added;
        diagnostics.returned = fresh.length;
        diagnostics.added = added;
        // Older collectors return no order; then the insertion order is kept.
        const order = Array.isArray(collected.order)
          ? collected.order.slice(0, 600).map((key) => `${platform}:${key}`)
          : [];
        const all = observedOrder(byUrl, order);
        const dropped = Math.max(0, all.length - 300);
        state.omittedCount = Math.min(Number.MAX_SAFE_INTEGER, (state.omittedCount || 0) + dropped);
        state.results = all
          .slice(dropped)
          .map((result, position) => ({ ...result, position: position + 1 }));
        await persist();
        // Initial native grids often hydrate a small first row, then render
        // the remaining cards later. Keep reading without scrolling until the
        // grid has had eight seconds since the first read and four seconds
        // without new cards. An Instagram first row may keep hydrating until
        // IG_HYDRATION_MS after the first read. Once settled (More: at once),
        // scroll the owned tab after four quiet seconds, at most SCROLL_CYCLES times.
        if (added >= target) {
          stopReason = "target";
          break;
        }
        const hydrating =
          platform === "ig" && added <= firstRow && now() - collectedAt < IG_HYDRATION_MS;
        const settled = more || (added > 0 && !hydrating && now() - collectedAt >= 8000);
        if (settled && !wasScroll && now() - Math.max(lastScrollAt, lastGrowthAt) >= 4000) {
          // A quiet initial read never scrolls: it ends once the grid has settled.
          if (!more && !deep) {
            stopReason = platform === "ig" && added > firstRow ? "hydrated-quiet" : "quiet";
            break;
          }
          if (scrolls >= SCROLL_CYCLES) {
            stopReason = "scroll-cap";
            break;
          }
          scroll = true;
        }
        await sleep(1000);
      }
      if (active()) {
        // Ran out of time or attempts without a settled stop.
        // Zero cards without the platform's "No results" screen is a failed read, not empty.
        const failedReads = diagnostics.transientErrors > 0 || serviceErrorSeen;
        const received = collectedOnce && state.results.length > 0;
        if (stopReason === "cancelled")
          stopReason = received ? "time-cap" : failedReads ? "read-failed" : "timeout";
        if (!received) {
          state.status = "error";
          state.error = failedReads ? "read-failed" : "search-timeout";
          return;
        }
        state.status = "done";
        delete state.error;
      }
    } catch {
      stopReason = "read-failed";
      if (active()) {
        state.status = "error";
        state.error = "read-failed";
      }
    } finally {
      // A timed-out run already reported "timeout"; a late reply must not overwrite it.
      if (!context.timedOut)
        Object.assign(diagnostics, { added, elapsedMs: now() - started, stopReason });
    }
  }
  async function run(job, more) {
    job.diagnostics ||= { request: "accepted" };
    // Owned tabs open in the background of the owner's window, read once per job.
    if (!Number.isInteger(job.ownerWindowId)) {
      try {
        job.ownerWindowId = (await api.tabs.get(job.ownerTabId)).windowId;
      } catch {
        /* Checked below. */
      }
      // A closed owner tab ends the job like onTabRemoved: no tab opens anywhere else.
      if (!Number.isInteger(job.ownerWindowId)) return drop(job);
    }
    // A quiet job (normal Search) never checks focus, activates or restores tabs or windows.
    const focus = job.deep === true ? await beginFocus(job) : null;
    if (!focus)
      job.diagnostics.focus ||= {
        eligible: false,
        skipReason: "quiet",
        activated: [],
        restored: "skipped",
      };
    // A Deep search without Discover in front cannot load more: quiet budget, and say why.
    const deep = job.deep === true && focus?.allowed === true;
    if (job.deep === true && !deep)
      job.diagnostics.deepSkipped = job.diagnostics.focus?.skipReason || "not-eligible";
    const timeCap = capFor(deep, more);
    for (const platform of Object.keys(job.platforms)) {
      if (!live(job)) break;
      const context = { active: true, focus, deep };
      const startedAt = now();
      let timer;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          context.timedOut = true;
          context.active = false;
          Object.assign(job.platforms[platform].diagnostics, {
            elapsedMs: now() - startedAt,
            stopReason: "timeout",
          });
          if (live(job)) {
            if (context.collectedOnce && job.platforms[platform].results.length) {
              job.platforms[platform].status = "done";
              delete job.platforms[platform].error;
            } else {
              // Nothing read in time (zero cards, no "No results" screen), or every read
              // was rejected by the browser: a failed read.
              const failedReads = job.platforms[platform].diagnostics.transientErrors > 0;
              if (failedReads) job.platforms[platform].diagnostics.stopReason = "read-failed";
              job.platforms[platform].status = "error";
              job.platforms[platform].error = failedReads ? "read-failed" : "search-timeout";
            }
          }
          resolve();
        }, timeCap);
      });
      try {
        await Promise.race([collectPlatform(job, platform, more, context), timeout]);
      } finally {
        context.active = false;
        clearTimeout(timer);
      }
    }
    if (focus) await restoreDiscover(job, focus);
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
      if (duplicate) {
        if (duplicate.status === "running")
          (duplicate.diagnostics ||= {}).request = "already-running";
        return { ok: true, jobId: duplicate.id };
      }
      for (const job of previous) await drop(job);
      if (jobs.size >= MAX_JOBS) return { ok: false, error: "busy" };
      const job = {
        id: id(),
        requestId: request.requestId,
        ownerTabId: sender.tab.id,
        ownerDocumentId: sender.documentId || null,
        expiresAt: now() + TTL_MS,
        status: "running",
        // Quiet unless the app's Deep search asked; More inherits it. Older saved jobs lack it: quiet.
        deep: request.deep === true,
        diagnostics: { request: "accepted" },
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
    if (job.status === "running") {
      (job.diagnostics ||= {}).request = "already-running";
      return publicJob(job);
    }
    if (job.status === "cancelled") return { ok: false, error: "job-not-found" };
    discardFocus(job.id);
    job.diagnostics = { request: "accepted" };
    job.expiresAt = now() + TTL_MS;
    await api.alarms.create(`${ALARM_PREFIX}${job.id}`, { when: job.expiresAt });
    job.status = "running";
    for (const state of Object.values(job.platforms)) {
      state.status = "loading";
      delete state.error;
      delete state.noResults;
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
      if (job.ownerTabId === tabId) await drop(job);
      else
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
      if (
        info.windowId !== focus.windowId ||
        (info.tabId !== focus.ownerTabId && !Object.values(focus.tabs).includes(info.tabId))
      )
        stopFocus(focus, "tab-activated");
    }
  }
  function onWindowFocusChanged(windowId) {
    for (const focus of focusRequests.values())
      if (windowId !== focus.windowId) stopFocus(focus, "window-focus-changed");
  }
  return { handle, onAlarm, onTabRemoved, onTabActivated, onWindowFocusChanged, ready };
}
