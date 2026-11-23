// Render proof for the form-flow + result-card polish (Myuden 21 Nov
// 18:08 demo reference + 18:15 "harus RAPI"). Serves the built dist/
// and drives it in headless Chromium (fresh profile -> App Check fails
// fast -> deterministic code-only verdicts, same as toast-complete).
// Asserts the flow (chip fills only, send renders the card, stale on
// edit) + neatness (no horizontal overflow at 390px or desktop) and
// saves screenshots to video/panel-lainnya-shots/.
// Run: npm run build && node video/verify-scripts/polish-render-proof.cjs
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

async function openPage(browser, url, viewport) {
  const ctx = await browser.newContext({ viewport, locale: "id-ID", ignoreHTTPSErrors: true });
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

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const server = await serveDist();
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    // ---- Mobile 390px: form flow -------------------------------
    {
      const { ctx, page } = await openPage(browser, url, { width: 390, height: 844 });
      check("m390 no chat thread anywhere", (await page.locator("#chat-thread").count()) === 0);
      check("m390 three steps, step 1 active", (await page.locator(".check-steps li").count()) === 3 && (await page.locator("#step-1.active").count()) === 1);
      check("m390 empty state visible, result hidden", await page.locator("#result-empty").isVisible() && (await page.locator("#result").isHidden()));
      check("m390 send disabled while empty, count 0 karakter", (await page.locator("#check-btn").isDisabled()) && (await page.locator("#char-count").textContent()) === "0 karakter");
      check("m390 no horizontal overflow on load", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

      // Chip fills only: no check runs, no card, chip selected.
      await page.locator(".sample-btn", { hasText: "Undangan nikah APK" }).click();
      await page.waitForTimeout(400);
      const filled = await page.inputValue("#message-input");
      check("m390 chip fills the textarea (APK sample)", filled.length > 50 && filled.includes("invite.apk"));
      check("m390 chip tap runs NO check (result still hidden)", await page.locator("#result").isHidden());
      check("m390 fill note shows + chip looks selected", await page.locator("#fill-note.show").isVisible() && (await page.locator(".sample-btn.selected").count()) === 1);
      check("m390 step 2 active after fill, send enabled", (await page.locator("#step-2.active").count()) === 1 && (await page.locator("#check-btn").isEnabled()));
      check("m390 char count follows the filled text", (await page.locator("#char-count").textContent()).startsWith(String(filled.length)));
      await page.locator("#tab-message").screenshot({ path: path.join(SHOTS, "polish-form-filled-390.png") });

      // Send: loading state, then the card below — no thread.
      // (Flake guard, 21 Nov: the headless check can fail fast, so a
      // fixed 300 ms sleep sometimes lands after the button is idle
      // again — poll for the spinner instead of assuming it is there.)
      await page.click("#check-btn");
      let sawSpinner = false;
      for (let i = 0; i < 20; i++) {
        const label = await page.locator("#check-btn .send-label").textContent().catch(() => "");
        if ((await page.locator("#check-btn .send-spinner").count()) === 1 && label.includes("Memeriksa")) { sawSpinner = true; break; }
        await page.waitForTimeout(50);
      }
      check("m390 send shows spinner + Memeriksa… while running", sawSpinner);
      check("m390 check finishes (button idle again)", await waitIdle(page));
      await page.waitForSelector("#result:not([hidden]) .result-card", { timeout: 30000 });
      await page.waitForTimeout(1200); // ring animation settles
      check("m390 result card visible, empty state gone, step 3", await page.locator("#result .result-card").isVisible() && (await page.locator("#result-empty").isHidden()) && (await page.locator("#step-3.active").count()) === 1);
      check("m390 verdict is Penipuan 75 (code-only APK sample)", ((await page.locator(".result-status").textContent()) || "").includes("Penipuan") && ((await page.locator(".ring-value strong").textContent()) || "").trim() === "75");
      check("m390 flags checklist + main sign + actions present", (await page.locator(".flags li").count()) >= 1 && (await page.locator(".main-sign").count()) === 1 && (await page.locator(".actions-checklist li").count()) === 1);
      check("m390 local checklist has 17 rows + 3 pills", (await page.locator(".local-checks li").count()) === 17 && (await page.locator(".check-pills .meta-pill").count()) === 3);
      const pills = await page.locator(".check-pills").textContent();
      check("m390 pills count 17 aturan / 3 terpicu / 14 bersih", /17 aturan diperiksa/.test(pills) && /3 terpicu/.test(pills) && /14 bersih/.test(pills));
      check("m390 no horizontal overflow with the card open", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "polish-result-390.png") });

      // Stale: edit the text -> card dims + bar shows; send again -> clear.
      await page.fill("#message-input", filled + "X");
      await page.waitForTimeout(400);
      check("m390 edit marks the card stale (dim + bar)", (await page.locator(".result-card.stale").count()) === 1 && await page.locator(".result-stale-bar").isVisible());
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "polish-stale-390.png") });
      await page.click("#check-btn");
      check("m390 re-check finishes and clears stale", await waitIdle(page) && (await page.locator(".result-card.stale").count()) === 0);
      await ctx.close();
    }

    // ---- Desktop 1280px: card + EN switch ----------------------
    {
      const { ctx, page } = await openPage(browser, url, { width: 1280, height: 900 });
      await page.fill("#message-input", APK_SAMPLE);
      await page.click("#check-btn");
      check("desk check finishes", await waitIdle(page));
      await page.waitForSelector("#result:not([hidden]) .result-card", { timeout: 30000 });
      await page.waitForTimeout(1200);
      check("desk no horizontal overflow with the card open", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      check("desk steps row fits on one line", await page.evaluate(() => {
        const el = document.querySelector(".check-steps");
        const r = el.getBoundingClientRect();
        return r.height < 60;
      }));
      await page.locator("#result").screenshot({ path: path.join(SHOTS, "polish-result-desktop.png") });
      // Language switch: labels follow, card re-renders in EN.
      await page.click("#lang-en-btn");
      await page.waitForTimeout(800);
      check("desk EN: send label + step 1 in English", ((await page.locator("#check-btn .send-label").textContent()) || "") === "Send for checking" && ((await page.locator("#step-1").textContent()) || "").includes("Fill in the message"));
      check("desk EN: char count in English", ((await page.locator("#char-count").textContent()) || "").includes("characters"));
      check("desk EN: check finishes again (re-check)", await waitIdle(page));
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
