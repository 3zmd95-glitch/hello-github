import { createStore, get, update, type UseStore } from "idb-keyval";
import {
  DiscoverCandidatesSchema,
  mergeDiscoverCandidates,
  type DiscoverCandidate,
} from "./discoverFeed";

export type DiscoverLibraryStatus = "loading" | "ready" | "unavailable";
export interface DiscoverLibrarySnapshot {
  version: 1;
  epoch: string;
  candidates: DiscoverCandidate[];
}
export interface DiscoverLibraryAdapter {
  available(): boolean;
  read(): Promise<unknown>;
  write(snapshot: DiscoverLibrarySnapshot, replace: boolean): Promise<DiscoverLibrarySnapshot>;
}
const READ_TIMEOUT_MS = 5000;
let database: UseStore | undefined;
const db = () => (database ??= createStore("3z-prod-discover", "candidates"));
function parsedSnapshot(value: unknown): DiscoverLibrarySnapshot {
  if (!value || typeof value !== "object") return { version: 1, epoch: "", candidates: [] };
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1 || typeof raw.epoch !== "string" || raw.epoch.length > 200)
    return { version: 1, epoch: "", candidates: [] };
  const parsed = DiscoverCandidatesSchema.safeParse(raw.candidates);
  return { version: 1, epoch: raw.epoch, candidates: parsed.success ? parsed.data : [] };
}

/** The already-installed keyval adapter uses one atomic update. Another tab's newer observations
 * are merged, and the last validated revision avoids sanitizing an unchanged corpus on every write. */
export function indexedDiscoverLibrary(): DiscoverLibraryAdapter {
  let lastRevision: string | undefined;
  let last: DiscoverLibrarySnapshot | undefined;
  return {
    available: () => typeof indexedDB !== "undefined",
    read: () => get("corpus", db()),
    async write(snapshot, replace) {
      let next = snapshot;
      const revision = crypto.randomUUID();
      let transaction: IDBTransaction | undefined;
      let timedOut = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const boundedStore: UseStore = (mode, callback) =>
        db()(mode, (store) => {
          if (timedOut) throw new Error("library write timed out");
          transaction = store.transaction;
          return callback(store);
        });
      try {
        await Promise.race([
          update<Record<string, unknown>>(
            "corpus",
            (old) => {
              const previous = old?.revision === lastRevision && last ? last : parsedSnapshot(old);
              // Only an explicit reset/import may change epochs. A stale tab adopts the newer corpus.
              next =
                !replace && previous.epoch && previous.epoch !== snapshot.epoch
                  ? previous
                  : {
                      ...snapshot,
                      candidates: replace
                        ? snapshot.candidates
                        : mergeDiscoverCandidates(previous.candidates, snapshot.candidates),
                    };
              return { ...next, revision };
            },
            boundedStore,
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              try {
                transaction?.abort();
              } catch {
                /* already closed */
              }
              reject(new Error("library write timed out"));
            }, READ_TIMEOUT_MS);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      lastRevision = revision;
      last = next;
      return next;
    },
  };
}

/** Serial persistence coordinator. Hydration merges mutations made while reading; import/reset
 * fence old reads and queued writes. Callbacks contain only candidate data and an opaque reset epoch. */
export function createDiscoverLibrary(
  adapter: DiscoverLibraryAdapter,
  callbacks: {
    current(): DiscoverCandidate[];
    epoch(): string;
    pendingReplacement(): boolean;
    apply(candidates: DiscoverCandidate[], epoch?: string): void;
    status(status: DiscoverLibraryStatus): void;
  },
  readTimeoutMs = READ_TIMEOUT_MS,
) {
  let generation = 0;
  let revision = 0;
  let phase: "idle" | "loading" | "settled" = "idle";
  let durable = false;
  let pendingReplacement = callbacks.pendingReplacement();
  let observedEpoch = callbacks.epoch();
  let hydration: Promise<void> | undefined;
  let writes = Promise.resolve();
  const unavailable = () => {
    durable = false;
    callbacks.status("unavailable");
  };

  const persist = (): Promise<void> => {
    const currentGeneration = generation;
    const currentRevision = revision;
    const snapshot: DiscoverLibrarySnapshot = {
      version: 1,
      epoch: callbacks.epoch(),
      candidates: callbacks.current(),
    };
    if (!adapter.available()) {
      unavailable();
      return Promise.resolve();
    }
    writes = writes.then(async () => {
      // Discard superseded queued snapshots before touching durable storage.
      if (currentGeneration !== generation || currentRevision !== revision) return;
      try {
        const saved = await adapter.write(snapshot, pendingReplacement);
        if (currentGeneration !== generation || currentRevision !== revision) return;
        durable = true;
        pendingReplacement = false;
        observedEpoch = saved.epoch;
        callbacks.apply(saved.candidates, saved.epoch);
        callbacks.status("ready"); // Also rewrites localStorage after confirmed migration.
      } catch {
        if (currentGeneration === generation && currentRevision === revision) unavailable();
      }
    });
    return writes;
  };

  const hydrate = (): Promise<void> => {
    if (phase === "settled") return writes;
    if (hydration) return hydration;
    if (!adapter.available()) {
      phase = "settled";
      unavailable();
      return Promise.resolve();
    }
    phase = "loading";
    callbacks.status("loading");
    const currentGeneration = generation;
    const epoch = callbacks.epoch();
    hydration = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const value = await Promise.race([
          adapter.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("library read timed out")), readTimeoutMs);
          }),
        ]);
        if (currentGeneration !== generation || epoch !== callbacks.epoch()) return;
        const saved = parsedSnapshot(value);
        const replace = pendingReplacement && saved.epoch !== epoch;
        if (saved.epoch === epoch) pendingReplacement = false;
        const stale = !!saved.epoch && saved.epoch !== epoch && !pendingReplacement;
        callbacks.apply(
          stale
            ? saved.candidates
            : mergeDiscoverCandidates(replace ? [] : saved.candidates, callbacks.current()),
          stale ? saved.epoch : undefined,
        );
        phase = "settled";
        await persist();
      } catch {
        if (currentGeneration === generation) {
          phase = "settled";
          unavailable();
        }
      } finally {
        clearTimeout(timer);
      }
    })();
    return hydration;
  };

  return {
    hydrate,
    rehydrate() {
      if (observedEpoch !== callbacks.epoch()) {
        generation++;
        revision++;
        phase = "idle";
        hydration = undefined;
        durable = false;
        pendingReplacement = callbacks.pendingReplacement();
        observedEpoch = callbacks.epoch();
      }
      return hydrate();
    },
    durable: () => durable,
    changed() {
      revision++;
      if (phase !== "settled") void hydrate();
      else void persist();
    },
    replace() {
      generation++;
      revision++;
      phase = "settled";
      durable = false;
      pendingReplacement = true;
      observedEpoch = callbacks.epoch();
      callbacks.status(adapter.available() ? "loading" : "unavailable");
      void persist();
    },
    /** Await all work currently queued, including work appended while an earlier write completes. */
    async flush() {
      await hydrate();
      let pending: Promise<void>;
      do {
        pending = writes;
        await pending;
      } while (pending !== writes);
    },
  };
}
