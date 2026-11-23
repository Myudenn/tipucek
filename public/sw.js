// TipuCek service worker — app-shell cache (installable PWA).
// Same-origin GET only; Firebase / Firestore / AI calls are cross-origin
// and are never intercepted or cached.
//
// v12 (22 Nov 2026) — refresh-biasa fix (Myuden 21:25): a normal
// refresh must show the new bundle at once. The document fetch below
// used plain fetch(event.request), which can return a STALE copy from
// the browser HTTP cache (an index.html cached with max-age=3600 from
// before the no-cache header was deployed stays "fresh" for an hour,
// and the SW would serve it even though the server has a new one —
// this is what kept the auditor on the old bundle for 30+ minutes).
// The fetch now uses cache:"reload" (same as the precache install):
// it always hits the network and ignores the HTTP cache, so a normal
// refresh can never serve a stale shell. v11 (23 Nov 2026) — design
// G + font G2: precache the bundled Plus Jakarta Sans woff2 so the
// font renders offline from the first install (it is same-origin
// static, so it would also land in the runtime cache — precache makes
// it guaranteed, not eventual).
// v9 (20 Nov 2026) — dashboard redesign (mockup + IASC hero).
// v8 (20 Nov 2026) — logo-cache fix. skipWaiting + clients.claim
// were already here, but the old logo still showed after the F logo
// went live: the previous worker's cache held the old /aman.png, and
// both the precache install and the stale-while-revalidate refresh
// fetched through the browser HTTP cache (Firebase serves /aman.png
// with the default max-age=3600), so the old file kept coming back.
// v8 bumps the cache name (a byte-different worker installs, the old
// cache is purged on activate) AND fetches the shell with
// cache:"reload", so the new /aman.png is pulled straight from the
// network on install — the next visit shows the new logo.

const CACHE = "tipucek-v12";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/logo-mark.svg",
  "/aman.png",
  "/fonts/plus-jakarta-sans-latin.woff2",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/og-image.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // Per-asset install: one missing file must not fail the whole
      // install (cache.addAll is all-or-nothing — that failure mode
      // pinned the stale v6 shell in place). cache:"reload" bypasses
      // the browser HTTP cache, so a changed shell file (like a new
      // /aman.png) is really fetched fresh on install.
      Promise.allSettled(
        SHELL.map((url) => cache.add(new Request(url, { cache: "reload" }))),
      ),
    ).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

function isDocumentRequest(request, url) {
  return (
    request.mode === "navigate" ||
    url.pathname === "/" ||
    url.pathname === "/index.html"
  );
}

function cachePut(request, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches
      .open(CACHE)
      .then((cache) => cache.put(request, copy))
      .catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (isDocumentRequest(event.request, url)) {
    // NETWORK-FIRST for documents: a fresh HTML must win whenever the
    // network is reachable; the cache is only an offline fallback.
    // (This is the fix: a stale cached shell must never outrank live HTML.)
    // v12 (22 Nov 2026, refresh-biasa): cache:"reload" forces a real
    // network fetch and ignores the browser HTTP cache — a plain
    // fetch() could return a stale index.html the browser cached with
    // max-age=3600 before the no-cache header was deployed, and the
    // auditor stayed on the old bundle for 30+ minutes because of it.
    event.respondWith(
      fetch(new Request(event.request, { cache: "reload" }))
        .then((res) => cachePut(event.request, res))
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    // Cache-first for hashed /assets/**: the hash changes whenever the
    // content does, so a cached copy can never be stale.
    event.respondWith(
      caches
        .match(event.request)
        .then(
          (cached) =>
            cached ||
            fetch(event.request).then((res) => cachePut(event.request, res)),
        ),
    );
    return;
  }

  // Other same-origin static files (icons, manifest, images):
  // stale-while-revalidate — serve the cache at once, refresh behind it.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => cachePut(event.request, res))
        .catch(() => cached);
      return cached || network;
    }),
  );
});
