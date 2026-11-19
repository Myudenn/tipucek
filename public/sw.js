// TipuCek service worker — app-shell cache (installable PWA).
// Same-origin GET only; Firebase / Firestore / AI calls are cross-origin
// and are never intercepted or cached.
//
// v7 (19 Nov 2026) — stale-cache ("Demo mode") fix. The v6 worker was
// cache-first for EVERYTHING, including "/" and "/index.html", so a
// stale shell kept serving the pre-polish page (static "Demo mode"
// label) forever — and its hashed JS/CSS were long gone from the
// server (the Firebase SPA rewrite answers a missing asset with
// index.html, so the stale page's scripts never ran and its styles
// never parsed). v7 is NETWORK-FIRST for documents (network wins
// whenever reachable; cache is only an offline fallback) and stays
// cache-first for hashed /assets/** (immutable). Install is now
// per-asset (allSettled) so one missing shell file cannot fail the
// whole install and pin the old worker forever.

const CACHE = "tipucek-v7";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/aman.png",
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
      // pinned the stale v6 shell in place).
      Promise.allSettled(SHELL.map((url) => cache.add(url))),
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
    event.respondWith(
      fetch(event.request)
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
