// Completion badge + toast tests (round 6).
// Serves the built dist/ over a local static server and opens it in
// Chromium (headless). No Firebase debug token is registered for this
// fresh profile, so App Check fails fast and every check lands on the
// honest code-only card — which is exactly the deterministic path for
// asserting the badge + toast on a final card. (Primary/backup cards
// render the same badge via the same renderResult code path; they are
// covered live by video/failover-verify-local.cjs.)
// Run: npm run build && node --test tests/toast-complete.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PLAYWRIGHT_PATH = path.join(
  process.env.HOME || "",
  "workspace/tools/rekam-layar/node_modules/playwright",
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const file =
        urlPath === "/"
          ? path.join(DIST, "index.html")
          : path.join(DIST, urlPath);
      if (!file.startsWith(DIST) || !existsSync(file)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
      });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const OTP =
  "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";
const PRIZE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam.";

async function openPage(browser, url, viewport) {
  const ctx = await browser.newContext({ viewport, locale: "id-ID", ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

async function waitIdle(page, maxMs = 120000) {
  try {
    await page.waitForFunction(() => {
      const b = document.querySelector("#check-btn");
      const p = document.querySelector("#progress");
      return b && !b.disabled && (!p || p.hidden);
    }, undefined, { timeout: maxMs });
    return true;
  } catch {
    return false;
  }
}

async function runCheck(page, message) {
  await page.fill("#message-input", message);
  await page.click("#check-btn");
  assert.ok(await waitIdle(page), "check did not finish");
}

describe("completion badge + toast", () => {
  it("code-only card shows the badge and the toast with the verdict summary", async () => {
    const require = createRequire(import.meta.url);
    let playwright;
    try {
      playwright = require(PLAYWRIGHT_PATH);
    } catch {
      console.log("Playwright not found, skipping");
      return;
    }
    const server = await serveDist();
    const port = server.address().port;
    const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 1280, height: 800 });
      try {
        await runCheck(page, OTP);
        // Badge on the card: green check + "Pemeriksaan selesai".
        const badge = await page.evaluate(() => document.querySelector("#result .check-complete")?.innerText || "");
        assert.match(badge, /Pemeriksaan selesai/, `card badge: ${badge}`);
        // Toast: same label + translated status + score.
        const toastVisible = await page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden; });
        assert.ok(toastVisible, "toast should be visible after the check");
        const toastText = await page.evaluate(() => document.querySelector("#toast")?.innerText || "");
        assert.match(toastText, /Pemeriksaan selesai/, `toast label: ${toastText}`);
        assert.match(toastText, /Mencurigakan 40\/100/, `toast summary: ${toastText}`);
        // Honesty: the label never claims the message is safe/verified.
        assert.doesNotMatch(toastText, /Terverifikasi/, "toast must not say Terverifikasi");
        assert.doesNotMatch(badge, /Terverifikasi/, "badge must not say Terverifikasi");
        // The badge is on a code-only card (honest label, retry present).
        const cardBadge = await page.evaluate(() => document.querySelector("#result .badge")?.innerText || "");
        assert.match(cardBadge, /tanpa vonis AI/, `code-only badge: ${cardBadge}`);
        assert.ok(await page.evaluate(() => !!document.querySelector("#retry-ai-btn")), "retry button present on code-only card");
      } finally {
        await ctx.close();
      }
    } finally {
      await browser.close();
      server.close();
    }
  });

  it("toast × closes it at once, and it auto-hides after ~5 s", async () => {
    const require = createRequire(import.meta.url);
    let playwright;
    try {
      playwright = require(PLAYWRIGHT_PATH);
    } catch {
      console.log("Playwright not found, skipping");
      return;
    }
    const server = await serveDist();
    const port = server.address().port;
    const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 1280, height: 800 });
      try {
        await runCheck(page, OTP);
        assert.ok(await page.evaluate(() => !document.querySelector("#toast").hidden), "toast visible");
        await page.click("#toast .toast-close");
        assert.ok(await page.evaluate(() => document.querySelector("#toast").hidden), "toast hidden after ×");
        // Fresh check (different message, no cache) -> toast again, then auto-hide.
        await runCheck(page, PRIZE);
        assert.ok(await page.evaluate(() => !document.querySelector("#toast").hidden), "toast visible again");
        await page.waitForTimeout(6500);
        assert.ok(await page.evaluate(() => document.querySelector("#toast").hidden), "toast auto-hidden after ~5 s");
      } finally {
        await ctx.close();
      }
    } finally {
      await browser.close();
      server.close();
    }
  });

  it("badge + toast follow the language, and the toast never blocks the main buttons (phone viewport)", async () => {
    const require = createRequire(import.meta.url);
    let playwright;
    try {
      playwright = require(PLAYWRIGHT_PATH);
    } catch {
      console.log("Playwright not found, skipping");
      return;
    }
    const server = await serveDist();
    const port = server.address().port;
    const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
    try {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 390, height: 844 });
      try {
        await runCheck(page, OTP);
        assert.ok(await page.evaluate(() => !document.querySelector("#toast").hidden), "toast visible (phone)");
        // While the toast shows, the retry button must still be tappable:
        // a covered button makes Playwright's click fail with
        // "element intercepts pointer events".
        await page.click("#retry-ai-btn", { timeout: 10000 });
        assert.ok(await waitIdle(page), "retry check finished");
        assert.ok(await page.evaluate(() => !document.querySelector("#toast").hidden), "toast shows again after retry");
        // And the main Check button must be tappable while the toast shows.
        await page.click("#check-btn", { timeout: 10000 });
        assert.ok(await waitIdle(page), "check-button check finished");
        // Switch to English: the card re-labels in EN. The re-check
        // cannot produce a new verdict here (no AI in this env), so no
        // new toast appears — but the old toast must be hidden, never
        // left showing stale Indonesian text.
        await page.selectOption("#lang-select", "en");
        assert.ok(await waitIdle(page, 120000), "EN re-check finished");
        const badgeEn = await page.evaluate(() => document.querySelector("#result .check-complete")?.innerText || "");
        assert.match(badgeEn, /Check complete/, `EN card badge: ${badgeEn}`);
        assert.ok(await page.evaluate(() => document.querySelector("#toast").hidden), "toast hidden after language switch (no stale toast)");
        // Fresh check in EN: a new toast appears, in EN.
        await runCheck(page, OTP);
        assert.ok(await page.evaluate(() => !document.querySelector("#toast").hidden), "EN toast visible after fresh EN check");
        const toastEn = await page.evaluate(() => document.querySelector("#toast")?.innerText || "");
        assert.match(toastEn, /Check complete/, `EN toast: ${toastEn}`);
        assert.match(toastEn, /Suspicious 40\/100/, `EN toast summary: ${toastEn}`);
      } finally {
        await ctx.close();
      }
    } finally {
      await browser.close();
      server.close();
    }
  });
});
