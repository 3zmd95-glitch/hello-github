"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Genre } from "@/lib/domain";
import {
  NATIVE_HELPER_EVENT,
  NATIVE_HELPER_STORAGE_KEY,
  NativeSearchError,
  appendNativeSearchSnapshot,
  cancelNativeSearch,
  initializeNativeHelper,
  moreNativeSearch,
  nativeHelperStatus,
  pollNativeSearch,
  readNativeSearchCache,
  retainFailedNativePlatforms,
  startNativeSearch,
  validateNativeQueries,
  writeNativeSearchCache,
  type NativeConnection,
  type NativeQueries,
  type NativeSearchErrorCode,
  type NativeSearchSnapshot,
} from "@/lib/discoverNativeSearch";

export interface NativeSearchState {
  /** The category's bounded cache read has settled. */
  ready: boolean;
  connection: NativeConnection;
  snapshot: NativeSearchSnapshot | null;
  busy: boolean;
  error?: NativeSearchErrorCode;
  /** Quiet by default; `deep` is the explicit Deep search (the helper may show its tabs). */
  search(queries: NativeQueries, options?: { deep?: boolean }): void;
  more(options?: { automatic?: boolean }): void;
  cancel(): void;
  reconnect(): void;
  canMore: boolean;
  /** Only a live quiet job can continue without opening or focusing source tabs. */
  canAutoMore: boolean;
}
interface Run {
  scope: string;
  genreId: string;
  queries: NativeQueries;
  /** The helper job mode; its More requests inherit it. */
  deep: boolean;
  previous: NativeSearchSnapshot | null;
  append?: boolean;
  resumeMore?: boolean;
  canResume?: boolean;
  cancelled: boolean;
  busy: boolean;
  jobId?: string;
  timer?: ReturnType<typeof setTimeout>;
}
interface View {
  scope: string;
  snapshot: NativeSearchSnapshot | null;
  busy: boolean;
  ready: boolean;
  error?: NativeSearchErrorCode;
}
const codeOf = (error: unknown): NativeSearchErrorCode =>
  error instanceof NativeSearchError ? error.code : "unavailable";

/** Only explicit search/more actions open native searches. Reads, polling and cancellation are scoped
 * to the current category; a delayed job acknowledgement is cancelled after a category switch. */
export function useNativeSearch({
  genre,
  active,
}: {
  genre: Genre;
  active: boolean;
}): NativeSearchState {
  const scope = JSON.stringify([genre.id, active]);
  const current = useRef({ scope, active });
  const pending = useRef<Run | null>(null);
  const revision = useRef(0);
  const connectionRevision = useRef(0);
  const mounted = useRef(false);
  const [connection, setConnection] = useState<NativeConnection>("checking");
  const [view, setView] = useState<View>({ scope, snapshot: null, busy: false, ready: false });

  const invalidate = useCallback(() => {
    revision.current++;
    const run = pending.current;
    pending.current = null;
    if (!run) return;
    run.cancelled = true;
    clearTimeout(run.timer);
    if (run.jobId) void cancelNativeSearch(run.jobId).catch(() => {});
  }, []);

  useLayoutEffect(() => {
    current.current = { scope, active };
    invalidate();
    return invalidate;
  }, [scope, active, invalidate]);

  const checkConnection = useCallback(() => {
    const request = ++connectionRevision.current;
    void nativeHelperStatus().then((value) => {
      if (mounted.current && request === connectionRevision.current) setConnection(value);
    });
  }, []);
  const reconnect = useCallback(() => {
    setConnection("checking");
    initializeNativeHelper();
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    mounted.current = true;
    // Consume the popup's fragment before subscribing, since attaching dispatches a change event.
    initializeNativeHelper();
    const changed = () => {
      invalidate();
      setView((previous) => ({
        ...previous,
        busy: false,
        snapshot: previous.snapshot ? { ...previous.snapshot, cached: true } : null,
      }));
      reconnect();
    };
    const stored = (event: StorageEvent) => {
      if (event.key === NATIVE_HELPER_STORAGE_KEY) changed();
    };
    window.addEventListener(NATIVE_HELPER_EVENT, changed);
    window.addEventListener("storage", stored);
    checkConnection();
    return () => {
      mounted.current = false;
      window.removeEventListener(NATIVE_HELPER_EVENT, changed);
      window.removeEventListener("storage", stored);
      invalidate();
    };
  }, [invalidate, reconnect, checkConnection]);

  useEffect(() => {
    if (!active) return;
    const expected = revision.current;
    let stopped = false;
    void readNativeSearchCache(genre.id).then((snapshot) => {
      if (
        !stopped &&
        mounted.current &&
        current.current.scope === scope &&
        revision.current === expected
      ) {
        setView({ scope, snapshot, busy: false, ready: true });
      }
    });
    return () => {
      stopped = true;
    };
  }, [active, genre.id, scope]);

  const valid = (run: Run) =>
    mounted.current &&
    !run.cancelled &&
    pending.current === run &&
    current.current.active &&
    current.current.scope === run.scope;

  const failed = (run: Run, error: unknown) => {
    if (!valid(run)) return;
    const code = codeOf(error);
    invalidate();
    setView((previous) => ({ ...previous, scope: run.scope, busy: false, error: code }));
    if (code === "missing" || code === "permission") setConnection(code);
  };

  const poll = async (run: Run): Promise<void> => {
    if (!valid(run) || !run.jobId) return;
    try {
      const job = await pollNativeSearch(run.jobId);
      if (!valid(run)) return;
      const snapshot = (run.append ? appendNativeSearchSnapshot : retainFailedNativePlatforms)(
        run.previous,
        {
          ...job,
          genreId: run.genreId,
          queries: run.queries,
          cached: false,
          asOf: new Date().toISOString(),
          ...(run.deep ? { deep: true as const } : {}),
        },
      );
      const continueResume =
        !!run.resumeMore &&
        job.status === "complete" &&
        job.hasMore &&
        Object.values(job.platforms).some((platform) =>
          ["done", "empty"].includes(platform.status),
        );
      run.busy = job.status === "running" || continueResume;
      setView({ scope: run.scope, snapshot, busy: run.busy, ready: true });
      if (Object.values(snapshot.platforms).some((platform) => platform.results.length > 0)) {
        void writeNativeSearchCache(snapshot);
      }
      if (continueResume) {
        // One saved-search continuation may get past the duplicate initial batch, never loop.
        run.resumeMore = false;
        await moreNativeSearch(run.jobId);
        if (valid(run)) void poll(run);
      } else if (job.status === "running")
        run.timer = setTimeout(() => {
          void poll(run);
        }, 1000);
    } catch (error) {
      failedContinuation(run, error);
    }
  };

  const startRun = (run: Run) => {
    void startNativeSearch(run.queries, crypto.randomUUID(), { deep: run.deep })
      .then((jobId) => {
        run.jobId = jobId;
        if (!valid(run)) {
          void cancelNativeSearch(jobId).catch(() => {});
          return;
        }
        void poll(run);
      })
      .catch((error) => failed(run, error));
  };

  const resume = (previous: NativeSearchSnapshot) => {
    invalidate();
    const run: Run = {
      scope,
      genreId: genre.id,
      queries: previous.queries,
      // A saved search continues in its own mode; one saved without a mode is quiet.
      deep: previous.deep === true,
      previous,
      append: true,
      resumeMore: true,
      canResume: false,
      cancelled: false,
      busy: true,
    };
    pending.current = run;
    setView({ scope, snapshot: previous, busy: true, ready: true });
    startRun(run);
  };

  const failedContinuation = (run: Run, error: unknown) => {
    if (!valid(run)) return;
    if (codeOf(error) === "expired" && run.canResume && run.previous) resume(run.previous);
    else failed(run, error);
  };

  const search = (queries: NativeQueries, { deep = false }: { deep?: boolean } = {}): void => {
    if (!active || connection !== "connected" || current.current.scope !== scope) return;
    const parsed = validateNativeQueries(queries);
    if (!parsed) {
      setView((previous) => ({ ...previous, scope, error: "invalid-query" }));
      return;
    }
    invalidate();
    const previous =
      view.scope === scope && view.snapshot?.genreId === genre.id ? view.snapshot : null;
    const sameQueries =
      previous &&
      Object.keys(parsed).length === Object.keys(previous.queries).length &&
      Object.entries(parsed).every(
        ([platform, query]) => previous.queries[platform as keyof NativeQueries] === query,
      );
    const run: Run = {
      scope,
      genreId: genre.id,
      queries: parsed,
      deep,
      previous,
      cancelled: false,
      busy: true,
    };
    pending.current = run;
    setView({
      scope,
      snapshot: sameQueries ? previous : null,
      busy: true,
      ready: true,
    });
    startRun(run);
  };

  const snapshot = active && view.scope === scope ? view.snapshot : null;
  const busy = active && view.scope === scope && view.busy;
  const canMore =
    connection === "connected" &&
    !busy &&
    !!snapshot &&
    snapshot.status !== "cancelled" &&
    // A rejected new query is not a failed load; it must not reopen a finished search.
    (snapshot.cached ||
      (!!view.error && view.error !== "invalid-query") ||
      (snapshot.hasMore && snapshot.status === "complete"));
  const canAutoMore = canMore && !snapshot?.cached && !snapshot?.deep && !view.error;
  const more = ({ automatic = false }: { automatic?: boolean } = {}): void => {
    const run = pending.current;
    if (automatic && (!canAutoMore || !run?.jobId || run.deep || !valid(run))) return;
    if (!canMore || !snapshot || run?.busy) return;
    if (snapshot.cached || !run?.jobId || !valid(run)) {
      resume(snapshot);
      return;
    }
    run.previous = snapshot;
    // An expired automatic continuation must stop, never silently open replacement tabs.
    run.canResume = !automatic;
    run.busy = true;
    setView((previous) => ({ ...previous, busy: true, error: undefined }));
    void moreNativeSearch(run.jobId)
      .then(() => {
        if (valid(run)) void poll(run);
      })
      .catch((error) => failedContinuation(run, error));
  };
  const cancel = (): void => {
    invalidate();
    setView((previous) => ({
      ...previous,
      busy: false,
      snapshot: previous.snapshot
        ? { ...previous.snapshot, status: "cancelled" }
        : previous.snapshot,
    }));
  };
  return {
    ready: active && view.scope === scope && view.ready,
    connection,
    snapshot,
    busy,
    error: view.scope === scope ? view.error : undefined,
    search,
    more,
    cancel,
    reconnect,
    canMore,
    canAutoMore,
  };
}
