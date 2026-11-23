// Tests for the 19 Nov 2026 stale-cache ("Demo mode") fix, as revised
// 19 Nov 20:25 (Myuden: the header badge must read clearly at once).
//   (i) Static HTML must never claim a demo mode: the #mode-label
//       fallback is the PRODUCTION value ("Mode AI", the Indonesian
//       static fallback language) — true in production with or without
//       JS, so there is no flicker and no "…" placeholder. JS still
//       overwrites it after load in every case (demo builds show
//       "Mode demo" once JS runs). "Mode demo"/"Demo mode" may appear
//       in index.html ONLY inside the hidden #demo-banner (JS reveals
//       it) — never as visible static text. The same holds for the
//       built dist/index.html.
//   (ii) The service worker must be network-first for documents,
//        cache-first for hashed /assets/**, install per-asset
//        (allSettled, never addAll), and carry the v7 cache name.
// Run: node --test tests/cache-stale.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");

const MODE_CLAIM = /demo mode|mode demo/i;

// The hidden #demo-banner is the ONLY place a "Mode demo" string may
// appear in static HTML: it is hidden by default and only JS may
// reveal it (and only JS may fill it via i18n). Strip it before
// asserting on the visible static text.
function withoutHiddenDemoBanner(html) {
  const m = html.match(
    /<div id="demo-banner"[^>]*hidden[^>]*>[\s\S]*?<\/div>/,
  );
  assert.ok(m, "demo-banner block with hidden attribute not found");
  return html.replace(m[0], "");
}

function modeLabelText(html) {
  const m = html.match(
    /<span id="mode-label"[^>]*>([\s\S]*?)<\/span>/,
  );
  assert.ok(m, "#mode-label span not found");
  return m[1].trim();
}

describe("static HTML: no visible mode claim", () => {
  for (const file of ["index.html", "dist/index.html"]) {
    it(`${file}: 0 "Demo mode"/"Mode demo" in visible static text`, (t) => {
      if (!existsSync(path.join(ROOT, file))) {
        t.skip(`${file} not present (run npm run build first)`);
        return;
      }
      const visible = withoutHiddenDemoBanner(read(file));
      assert.doesNotMatch(
        visible,
        MODE_CLAIM,
        `${file} still claims a mode in visible static text`,
      );
    });

    it(`${file}: #mode-label fallback is the production value "Mode AI"`, (t) => {
      if (!existsSync(path.join(ROOT, file))) {
        t.skip(`${file} not present (run npm run build first)`);
        return;
      }
      const label = modeLabelText(read(file));
      assert.equal(
        label,
        "Mode AI",
        `#mode-label fallback must be the production value "Mode AI", got ${JSON.stringify(label)}`,
      );
      assert.doesNotMatch(label, MODE_CLAIM);
    });

    it(`${file}: hero stays Indonesian by default`, (t) => {
      if (!existsSync(path.join(ROOT, file))) {
        t.skip(`${file} not present (run npm run build first)`);
        return;
      }
      const html = read(file);
      assert.match(html, /Apakah pesan ini penipuan\?/);
      assert.match(html, /<html lang="id">/);
    });
  }

  it("index.html: demo-banner stays hidden by default", () => {
    const html = read("index.html");
    assert.match(html, /<div id="demo-banner"[^>]*hidden/);
  });
});

describe("service worker: network-first documents, v12", () => {
  for (const file of ["public/sw.js", "dist/sw.js"]) {
    it(`${file}: cache is tipucek-v12`, (t) => {
      if (!existsSync(path.join(ROOT, file))) {
        t.skip(`${file} not present (run npm run build first)`);
        return;
      }
      const sw = read(file);
      assert.match(sw, /const CACHE = "tipucek-v12"/);
      assert.doesNotMatch(sw, /tipucek-v11/);
    });

    it(`${file}: document fetch bypasses the HTTP cache (refresh-biasa, Myuden 22 Nov 21:25)`, (t) => {
      if (!existsSync(path.join(ROOT, file))) {
        t.skip(`${file} not present (run npm run build first)`);
        return;
      }
      const sw = read(file);
      // A plain fetch() can return a stale index.html the browser
      // cached with max-age=3600 — cache:"reload" forces a real
      // network fetch, so a normal refresh always gets the new bundle.
      assert.match(sw, /fetch\(new Request\(event\.request, \{ cache: "reload" \}\)\)/);
    });

    it(`${file}: install is per-asset, never all-or-nothing`, (t) => {
      if (!existsSync(path.join(ROOT, file))) {
        t.skip(`${file} not present (run npm run build first)`);
        return;
      }
      const sw = read(file);
      assert.match(sw, /Promise\.allSettled/);
      // "addAll" must not appear in CODE (it may appear in comments
      // explaining why the old all-or-nothing call was removed).
      const code = sw.replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(code, /addAll/);
    });

    it(`${file}: keeps skipWaiting + clients.claim + old-cache purge`, (t) => {
      if (!existsSync(path.join(ROOT, file))) {
        t.skip(`${file} not present (run npm run build first)`);
        return;
      }
      const sw = read(file);
      assert.match(sw, /skipWaiting\(\)/);
      assert.match(sw, /clients\.claim\(\)/);
      assert.match(sw, /caches\.delete\(k\)/);
    });

    it(`${file}: documents are network-first, assets cache-first`, (t) => {
      if (!existsSync(path.join(ROOT, file))) {
        t.skip(`${file} not present (run npm run build first)`);
        return;
      }
      const sw = read(file);
      const fetchHandler = sw
        .slice(sw.indexOf('addEventListener("fetch"'))
        .replace(/\s*\.\s*/g, ".")
        .replace(/\s+/g, " ");
      assert.ok(fetchHandler.length > 0, "fetch handler not found");
      // Documents: the fetch handler routes navigations (or "/" /
      // "/index.html") through isDocumentRequest, whose definition
      // checks request.mode === "navigate" and both document paths —
      // and inside that branch the network fetch comes before the
      // cache fallback.
      assert.match(fetchHandler, /isDocumentRequest\(event\.request/);
      assert.match(sw, /mode === "navigate"/);
      assert.match(sw, /url\.pathname === "\/"/);
      assert.match(sw, /url\.pathname === "\/index\.html"/);
      const docBranch = fetchHandler.slice(
        0,
        fetchHandler.indexOf('startsWith("/assets/")'),
      );
      assert.ok(
        docBranch.indexOf('fetch(new Request(event.request, { cache: "reload" }))') >= 0 &&
          docBranch.indexOf('fetch(new Request(event.request, { cache: "reload" }))') <
            docBranch.indexOf("caches.match(event.request)"),
        "document branch must fetch from the network (cache:reload) before falling back to cache",
      );
      // Hashed assets: cache-first (caches.match before fetch).
      assert.match(fetchHandler, /startsWith\("\/assets\/"\)/);
      const assetBranch = fetchHandler.slice(
        fetchHandler.indexOf('startsWith("/assets/")'),
      );
      assert.ok(
        assetBranch.indexOf("caches.match(event.request)") <
          assetBranch.indexOf("fetch(event.request)"),
        "asset branch must check the cache before the network",
      );
    });
  }
});
