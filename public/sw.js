/* 3z Prod service worker: minimal app-shell cache so the dashboard opens offline after the first visit.
 * Hand-written for Sprint 1 (Serwist replaces it with push support in Sprint 3).
 * - precache the shell pages
 * - cache-first for hashed build assets (/_next/static/)
 * - network-first for navigations and other same-origin GETs, falling back to the cache, then to the cached index
 * Everything is relative to the registration scope, so it works under a basePath (GitHub Pages).
 */
const VERSION = "v3";
const CACHE = `3z-shell-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const BASE = SCOPE.pathname.replace(/\/$/, ""); // "" locally, "/hello-github" on Pages
const INDEX = `${BASE}/`;
const SHELL = [
  INDEX,
  `${BASE}/skills/`,
  `${BASE}/map/`,
  `${BASE}/planner/`,
  `${BASE}/review/`,
  `${BASE}/rewards/`,
  `${BASE}/discover/`,
  `${BASE}/settings/`,
  `${BASE}/more/`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("3z-shell-") && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok && response.type === "basic")
      (await caches.open(CACHE)).put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    if (fallbackUrl) {
      const shell = await caches.match(fallbackUrl);
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  // Connection status and subscription responses must never come from an offline cache.
  // Leave API requests to the page so live authentication/error state remains authoritative.
  if (url.pathname.startsWith(`${BASE}/api/`)) return;

  if (url.pathname.startsWith(`${BASE}/_next/static/`)) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, INDEX));
  } else {
    event.respondWith(networkFirst(request));
  }
});
