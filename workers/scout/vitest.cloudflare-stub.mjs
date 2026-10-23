/**
 * A vite plugin for the plain-Node tests (workers/scout/vitest.config.ts and the root vitest.config.mts, which also runs
 * the Worker tests). `cloudflare:workers` exists only inside workerd, yet the cron reaches the InboxStore Durable
 * Object's module (inboxReader.ts -> inboxStore.ts) and `../index` re-exports it, so a test that imports either gets an
 * empty base class instead. A .mjs file so both configs can import it with its extension (the root tsconfig refuses a
 * `.ts` extension and vite's native config loader wants one).
 */
const STUB = "\0cloudflare-workers-stub";

export const cloudflareWorkersStub = {
  name: "cloudflare-workers-stub",
  enforce: /** @type {const} */ ("pre"),
  resolveId: (/** @type {string} */ id) => (id === "cloudflare:workers" ? STUB : null),
  load: (/** @type {string} */ id) => (id === STUB ? "export class DurableObject {}" : null),
};
