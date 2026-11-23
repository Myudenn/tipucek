#!/usr/bin/env node
// FOLD VERIFY (21 Nov 2026, Myuden: lipat baris bersihnya + 3-vs-6) —
// serves the built dist/ and drives it in headless Chromium (fresh
// profile -> App Check fails fast -> deterministic code-only verdicts).
// Asserts: clean rows folded closed by default (found rows visible),
// toggle open/close, the card gets shorter, a language switch keeps
// the open state + translates the rows, stale still works, and the
// 3-vs-6 fix (in code-only mode the top flags count equals the pills
// found count; pills/intro count RULES, not signs).
// Screenshots to video/panel-lainnya-shots/fold-*.png.
// Run: npm run build && node video/verify-scripts/fold-verify.cjs
const http = require("http");
const path = require("path");
const { existsSync, readFileSync, mkdirSync } = require("fs");
const { createRequire } = require("module");

const ROOT = path.resolve(__dirname, "..", "..");
const DIST = path.join(ROOT, "dist");
const SHOTS = path.join(ROOT, "video", "panel-lainnya-shots");
const PLAYWRIGHT_PATH = path.join(
  process.env.HOME || "",
  "workspace/tools/rekam-layar/node_modules/playwright",
);
const requirePw = createRequire(path.join(PLAYWRIGHT_PATH, "index.js"));
const { chromium } = requirePw(PLAYWRIGHT_PATH);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

const APK_SAMPLE =
  "Halo, ini undangan pernikahan kami! Silakan download aplikasinya di sini: https://undangan-nikah-2026.xyz/invite.apk — mohon kehadirannya ya, terima kasih!";
const PRIZE_SAMPLE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!";

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " — " + extra}`);
  if (!ok) failures++;
}

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const file =
        urlPath === "/" ? path.join(DIST, "index.html") : path.join(DIST, urlPath);
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

async function openPage(browser, url, viewport, colorScheme = "dark") {
  const ctx = await browser.newContext({ viewport, locale: "id-ID", colorScheme, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  const onboard = page.locator("#onboard-start");
  if (await onboard.isVisible().catch(() => false)) await onboard.click();
  await page.waitForTimeout(500);
  return { ctx, page };
}

async function waitIdle(page, maxMs = 60000) {
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

async function checkMessage(page, text) {
  await page.fill("#message-input", text);
  await page.click("#check-btn");
  const idle = await waitIdle(page);
  await page.waitForSelector("#result:not([hidden]) .result-card", { timeout: 30000 });
  await page.waitForTimeout(3400); // toast (3 s) gone, ring settled
  return idle;
}

async function visibleCount(page, selector) {
  return page.evaluate((sel) => {
    return [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length > 0).length;
  }, selector);
}

async function cardHeight(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".result-card");
    return el ? el.getBoundingClientRect().height : 0;
  });
}

// Closed <details> content still gets layout boxes in this Chromium
// (probe: rows have rects below the collapsed details box) but is
// NOT painted — so visibility is measured on the details element's
// own height instead: closed ≈ summary height (~58px), open ≈
// summary + all clean rows. The screenshots are the real proof.
async function detailsHeight(page) {
  return page.evaluate(() => {
    const el = document.querySelector("details.clean-checks");
    return el ? el.getBoundingClientRect().height : 0;
  });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const server = await serveDist();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    // ---- Desktop 1280px, dark, ID: APK sample -------------------
    {
      const { ctx, page } = await openPage(browser, url, { width: 1280, height: 900 });
      check("desk check finishes (APK)", await checkMessage(page, APK_SAMPLE));
      check("desk verdict Penipuan 75 (code-only APK)", ((await page.locator(".result-status").textContent()) || "").includes("Penipuan") && ((await page.locator(".ring-value strong").textContent()) || "").trim() === "75");
      const pills = await page.locator(".check-pills").textContent();
      check("desk pills count RULES: 17 aturan / 3 terpicu / 14 bersih", /17 aturan diperiksa/.test(pills) && /3 terpicu/.test(pills) && /14 bersih/.test(pills), pills);
      // The intro sentence only renders for cloud verdicts (code-only
      // mode omits it by design — the code-only note already says
      // there is no AI verdict). Its wording is pinned by unit tests.
      const introCount = await page.locator(".local-signal > p").count();
      if (introCount > 0) {
        const intro = await page.locator(".local-signal > p").textContent();
        check("desk intro counts rules: '3 aturan terpicu'", /3 aturan terpicu/.test(intro), intro);
      } else {
        console.log("SKIP desk intro (code-only mode omits the intro line by design)");
      }
      const flagsHeading = await page.locator(".result-card > h3").first().textContent();
      check("desk top flags heading is plain 'Tanda bahaya' (code-only, not AI)", (flagsHeading || "").trim() === "Tanda bahaya", flagsHeading);
      check("desk top flags list has 3 items == pills found 3 (3-vs-6 fix, code-only)", (await page.locator(".result-card .flags li").count()) === 3);
      check("desk disclosure exists, closed by default, titled '14 aturan bersih'", (await page.locator("details.clean-checks").count()) === 1 && (await page.locator("details.clean-checks").getAttribute("open")) === null && ((await page.locator("details.clean-checks summary").textContent()) || "").includes("14 aturan bersih"));
      check("desk found rows visible: 3", (await visibleCount(page, "#result .local-checks li.found")) === 3);
      check("desk clean rows hidden while closed (details ≈ summary height)", (await detailsHeight(page)) < 100, `h=${Math.round(await detailsHeight(page))}`);
      check("desk all 17 rows still in the DOM (folded, not deleted)", (await page.locator("#result .local-checks li").count()) === 17);
      const hClosed = await cardHeight(page);
      check("desk closed card is much shorter than the old 3112px", hClosed < 2200, `h=${Math.round(hClosed)}`);
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "fold-closed-1280.png") });

      // Open: all 14 clean rows appear, card grows.
      await page.locator("details.clean-checks summary").click();
      await page.waitForTimeout(400);
      check("desk toggle opens the disclosure", (await page.locator("details.clean-checks").getAttribute("open")) !== null && (await detailsHeight(page)) > 500);
      check("desk clean rows visible when open: 14", (await visibleCount(page, "#result .clean-checks li.clear")) === 14);
      const hOpen = await cardHeight(page);
      check("desk open card is taller than closed", hOpen > hClosed + 400, `closed=${Math.round(hClosed)} open=${Math.round(hOpen)}`);
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "fold-open-1280.png") });

      // Close again.
      await page.locator("details.clean-checks summary").click();
      await page.waitForTimeout(400);
      check("desk toggle closes again", (await page.locator("details.clean-checks").getAttribute("open")) === null && (await detailsHeight(page)) < 100);

      // Open, then switch language: state survives + rows translate.
      await page.locator("details.clean-checks summary").click();
      await page.waitForTimeout(400);
      await page.click("#lang-en-btn");
      await page.waitForTimeout(800);
      check("desk EN: re-check finishes", await waitIdle(page));
      await page.waitForTimeout(3400);
      check("desk EN: disclosure stays open across the language switch", (await page.locator("details.clean-checks").getAttribute("open")) !== null);
      const summaryEn = await page.locator("details.clean-checks summary").textContent();
      check("desk EN: summary is '14 rules clear'", (summaryEn || "").includes("14 rules clear"), summaryEn);
      const pillsEn = await page.locator(".check-pills").textContent();
      check("desk EN: pills '17 rules checked · 3 triggered · 14 clean'", /17 rules checked/.test(pillsEn) && /3 triggered/.test(pillsEn) && /14 clean/.test(pillsEn), pillsEn);
      check("desk EN: clean rows still visible: 14", (await visibleCount(page, "#result .clean-checks li.clear")) === 14);
      check("desk EN: top heading is plain 'Red flags' (code-only)", ((await page.locator(".result-card > h3").first().textContent()) || "").trim() === "Red flags");
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "fold-en-open-1280.png") });

      // Stale still works with the disclosure in place.
      await page.click("#lang-id-btn");
      await page.waitForTimeout(800);
      await waitIdle(page);
      const filled = await page.inputValue("#message-input");
      await page.fill("#message-input", filled + "X");
      await page.waitForTimeout(400);
      check("desk edit marks the card stale (dim + bar)", (await page.locator(".result-card.stale").count()) === 1 && (await page.locator(".result-stale-bar").isVisible()));
      await page.click("#check-btn");
      check("desk re-check finishes and clears stale", await waitIdle(page) && (await page.locator(".result-card.stale").count()) === 0);

      // Prize sample: the '6' Myuden saw — top list 6 == pills 6.
      // (The disclosure stays open from before by design — close it
      // explicitly so the fresh card is asserted in its default state.)
      check("desk check finishes (prize)", await checkMessage(page, PRIZE_SAMPLE));
      await page.locator("details.clean-checks summary").click();
      await page.waitForTimeout(400);
      check("desk prize verdict Penipuan 100 (code-only)", ((await page.locator(".ring-value strong").textContent()) || "").trim() === "100");
      const pillsPrize = await page.locator(".check-pills").textContent();
      check("desk prize pills: 17 aturan / 6 terpicu / 11 bersih", /17 aturan diperiksa/.test(pillsPrize) && /6 terpicu/.test(pillsPrize) && /11 bersih/.test(pillsPrize), pillsPrize);
      check("desk prize top flags list has 6 items == pills found 6", (await page.locator(".result-card .flags li").count()) === 6);
      check("desk prize disclosure titled '11 aturan bersih', closed", ((await page.locator("details.clean-checks summary").textContent()) || "").includes("11 aturan bersih") && (await page.locator("details.clean-checks").getAttribute("open")) === null && (await detailsHeight(page)) < 100);
      check("desk prize found rows visible: 6", (await visibleCount(page, "#result .local-checks li.found")) === 6);
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "fold-prize-1280.png") });
      await ctx.close();
    }

    // ---- Mobile 390px, light: APK sample ------------------------
    {
      const { ctx, page } = await openPage(browser, url, { width: 390, height: 844 }, "light");
      check("m390 check finishes (APK)", await checkMessage(page, APK_SAMPLE));
      check("m390 no horizontal overflow, closed", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      check("m390 disclosure closed, found 3 visible", (await page.locator("details.clean-checks").getAttribute("open")) === null && (await visibleCount(page, "#result .local-checks li.found")) === 3 && (await detailsHeight(page)) < 100);
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "fold-closed-390.png") });
      await page.locator("details.clean-checks summary").click();
      await page.waitForTimeout(400);
      check("m390 toggle opens, 14 clean rows visible", (await page.locator("details.clean-checks").getAttribute("open")) !== null && (await visibleCount(page, "#result .clean-checks li.clear")) === 14);
      check("m390 no horizontal overflow, open", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "fold-open-390.png") });
      await ctx.close();
    }
    // ---- Mobile 390px, LIGHT theme (forced via saved preference):
    // the app defaults to dark, so colorScheme alone cannot prove the
    // light theme — set the saved theme before load instead. --------
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "id-ID", colorScheme: "light", ignoreHTTPSErrors: true });
      await ctx.addInitScript(() => localStorage.setItem("pesanaman_theme", "light"));
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(1500);
      const onboard = page.locator("#onboard-start");
      if (await onboard.isVisible().catch(() => false)) await onboard.click();
      await page.waitForTimeout(500);
      check("m390-light effective theme is light", (await page.evaluate(() => document.documentElement.dataset.theme)) === "light");
      check("m390-light check finishes (APK)", await checkMessage(page, APK_SAMPLE));
      check("m390-light no horizontal overflow, closed", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      check("m390-light disclosure closed, found 3 visible", (await page.locator("details.clean-checks").getAttribute("open")) === null && (await visibleCount(page, "#result .local-checks li.found")) === 3 && (await detailsHeight(page)) < 100);
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "fold-light-closed-390.png") });
      await page.locator("details.clean-checks summary").click();
      await page.waitForTimeout(400);
      check("m390-light toggle opens, 14 clean rows visible", (await page.locator("details.clean-checks").getAttribute("open")) !== null && (await visibleCount(page, "#result .clean-checks li.clear")) === 14);
      check("m390-light no horizontal overflow, open", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "fold-light-open-390.png") });
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROOF SCRIPT ERROR:", err);
  process.exit(1);
});
