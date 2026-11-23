#!/usr/bin/env node
/**
 * TipuCek demo video v5 — recorder.
 *
 * Records https://tipucek.web.app/?lang=en at 1280x720 via Playwright +
 * local CONNECT forwarder (scripts/local-proxy.js) + ignoreHTTPSErrors,
 * following the rekam-layar-browser skill. Writes:
 *   - ~/workspace/pesanaman/video/raw/tipucek-demo-v5-raw.webm
 *   - ~/workspace/pesanaman/video/raw/v5-*.png screenshots
 *   - ~/workspace/pesanaman/video/raw/v5-manifest.json
 *     { markers: [{name, t}], results: [{shot, status, score, badge, summary, flags}] }
 * Video time t is seconds since the recording context was created.
 *
 * Usage: node ~/workspace/pesanaman/video/record-v5.cjs
 */
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const RAW_DIR = path.join(HOME, "workspace/pesanaman/video/raw");
const PROXY_SCRIPT = path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js");
const PLAYWRIGHT = path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright");
const SITE = "https://tipucek.web.app/?lang=en";
const SCREENSHOT_PNG = path.join(HOME, "workspace/pesanaman/test-samples/screenshot-penipu.png");
const APK_FIXTURE = path.join(HOME, "workspace/pesanaman/video/fixtures/fake-invite.apk");

fs.mkdirSync(RAW_DIR, { recursive: true });

async function waitForPort(host, port, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect(port, host);
        s.once("connect", () => { s.end(); resolve(); });
        s.once("error", reject);
      });
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`local proxy did not start on ${host}:${port}`);
}

const t0 = { v: 0 };
const markers = [];
const results = [];
function elapsed() { return (Date.now() - t0.v) / 1000; }
function mark(name) {
  const t = +elapsed().toFixed(2);
  markers.push({ name, t });
  console.log(`MARK ${name} @ ${t}s`);
}

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const localProxyPort = 18080;
  const proxyProc = spawn(process.execPath, [PROXY_SCRIPT], {
    env: { ...process.env, LOCAL_PROXY_PORT: String(localProxyPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proxyProc.stdout.on("data", (d) => console.log(String(d).trim()));
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  try {
    await waitForPort("127.0.0.1", localProxyPort);
  } catch (e) {
    proxyProc.kill();
    console.error("FAILED to start local proxy:", e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${localProxyPort}` },
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 720 } },
    ignoreHTTPSErrors: true,
  });
  t0.v = Date.now();
  const page = await context.newPage();
  page.on("requestfailed", (req) => console.log(`REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
  page.on("response", (res) => { if (res.status() >= 400) console.log(`HTTP ${res.status()} ${res.url()}`); });
  page.on("console", (msg) => { if (msg.type() === "error") console.log(`CONSOLE-ERROR ${msg.text()}`); });

  const shot = (f) => path.join(RAW_DIR, f);

  async function dumpResult(shotName) {
    const info = await page.evaluate(() => {
      const card = document.querySelector(".result-card");
      if (!card) return null;
      const scoreEl = card.querySelector(".ring-value strong");
      const badgeEl = card.querySelector(".result-badge");
      const summaryEl = card.querySelector(".result-summary");
      const flags = [...card.querySelectorAll(".flags li")].map((li) => li.textContent.trim());
      const status = [...card.classList].find((c) => c.startsWith("status-")) || "";
      return {
        status: status.replace("status-", ""),
        score: scoreEl ? scoreEl.textContent.trim() : null,
        badge: badgeEl ? badgeEl.textContent.trim() : null,
        summary: summaryEl ? summaryEl.textContent.trim() : null,
        flags,
      };
    });
    const rec = { shot: shotName, ...info };
    results.push(rec);
    console.log(`RESULT ${shotName}: ${JSON.stringify(rec)}`);
    return info;
  }

  // Fingerprint of the current result card (null when no card yet).
  // A timed-out check leaves the PREVIOUS card on screen, so a new
  // verdict must differ from the fingerprint — otherwise it is stale.
  async function cardFingerprint() {
    return await page.evaluate(() => {
      const card = document.querySelector(".result-card");
      if (!card) return null;
      const score = card.querySelector(".ring-value strong")?.textContent?.trim() || "";
      const summary = card.querySelector(".result-summary")?.textContent?.trim() || "";
      const status = [...card.classList].find((c) => c.startsWith("status-")) || "";
      return `${status}|${score}|${summary}`;
    });
  }

  async function errorVisible(selector) {
    return await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return !!el && !el.hidden && el.textContent.trim().length > 0;
    }, selector);
  }

  // One message check with retries through the app's own "Try again"
  // button (the app shows it when a check times out after 30s — AI
  // latency in this VM is 15-32s, so a first attempt can time out and
  // the retry usually passes). Fails loudly if no fresh verdict
  // appears after 3 attempts — never record a stale card.
  async function doCheck(sampleLabel, shotName) {
    const before = await cardFingerprint();
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt === 1) {
        await page.click(`text=${sampleLabel}`, { timeout: 15000 });
        await page.waitForTimeout(800);
        await page.click("#check-btn", { timeout: 15000 });
      } else {
        console.log(`RETRY ${shotName}: attempt ${attempt} via Try again`);
        await page.click("#error .retry-btn", { timeout: 15000 });
      }
      await page.waitForTimeout(500);
      await page.waitForSelector("#check-btn:not([disabled])", { timeout: 60000 });
      const fresh = await cardFingerprint();
      const failed = await errorVisible("#error");
      if (fresh && fresh !== before && !failed) {
        await page.locator("#result").scrollIntoViewIfNeeded({ timeout: 15000 });
        await page.waitForTimeout(3000); // mouse still, card readable
        await page.screenshot({ path: shot(`v5-verdict-${shotName}.png`) });
        await dumpResult(shotName);
        return;
      }
      console.log(`ATTEMPT ${attempt} ${shotName}: no fresh verdict (fresh=${fresh !== before}, error=${failed})`);
      if (attempt === 3) throw new Error(`No fresh verdict for ${shotName} after 3 attempts`);
      await page.waitForTimeout(1000);
    }
  }

  try {
    // ---- Shot 1: homepage ----
    await page.goto(SITE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2500);
    mark("shot1-start");
    await page.screenshot({ path: shot("v5-hero.png") });
    await page.waitForTimeout(2000);
    mark("shot1-end");

    // ---- Shot 2: Ask Aman ----
    await page.click("#module-tab-assistant", { timeout: 15000 });
    await page.waitForTimeout(1200);
    mark("shot2-start");
    await page.click("text=What is OTP fraud?", { timeout: 15000 });
    await page.waitForSelector(".assistant-msg.aman:not(.typing)", { timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: shot("v5-aman.png") });
    mark("shot2-end");

    // ---- Shot 3: scam sample on screen ----
    await page.click("#tab-btn-message", { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.click("text=Scam example", { timeout: 15000 });
    await page.waitForTimeout(800);
    mark("shot3-start");
    await page.screenshot({ path: shot("v5-scam-input.png") });
    await page.waitForTimeout(1500);
    mark("shot3-end");

    // ---- Shot 4: scam check ----
    mark("shot4-start");
    await doCheck("Scam example", "scam");
    mark("shot4-end");

    // ---- Shot 5: fake APK ----
    mark("shot5-start");
    await doCheck("Wedding invite APK", "apk");
    // Scroll a little so the suspicious-file box + report lines show.
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot("v5-verdict-apk-file.png") });
    mark("shot5-end");

    // ---- Shot 6: screenshot check ----
    await page.locator(".image-check").scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(800);
    mark("shot6-start");
    await page.setInputFiles("#image-input", SCREENSHOT_PNG, { timeout: 15000 });
    await page.waitForTimeout(800);
    const beforeImg = await cardFingerprint();
    let imgOk = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt === 1) {
        await page.click("#image-btn", { timeout: 15000 });
      } else {
        console.log(`RETRY screenshot: attempt ${attempt} via Try again`);
        await page.click("#image-error .retry-btn", { timeout: 15000 });
      }
      await page.waitForTimeout(500);
      await page.waitForSelector("#image-btn:not([disabled])", { timeout: 60000 });
      const fresh = await cardFingerprint();
      const failed = await errorVisible("#image-error");
      if (fresh && fresh !== beforeImg && !failed) { imgOk = true; break; }
      console.log(`ATTEMPT ${attempt} screenshot: no fresh verdict (fresh=${fresh !== beforeImg}, error=${failed})`);
      await page.waitForTimeout(1000);
    }
    if (!imgOk) throw new Error("No fresh verdict for screenshot after 3 attempts");
    await page.locator("#result").scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: shot("v5-verdict-screenshot.png") });
    await dumpResult("screenshot");
    mark("shot6-end");

    // ---- Shot 7: safe message ----
    await page.click("#tab-btn-message", { timeout: 15000 });
    await page.waitForTimeout(500);
    mark("shot7-start");
    await doCheck("Safe example", "safe");
    mark("shot7-end");

    // ---- Shot 8: montage (email / call / outbound / file / quiz) ----
    mark("shot8-start");
    // Email (local heuristic, fast)
    await page.click("#tab-btn-email", { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.fill("#email-from-name", "BCA Security Team", { timeout: 15000 });
    await page.fill("#email-from-email", "security@bca-secure-verify.xyz", { timeout: 15000 });
    await page.fill("#email-body", "Dear customer, your account will be blocked within 24 hours due to suspicious activity. Verify now at https://bca-secure-verify.xyz/login or you will lose access.", { timeout: 15000 });
    await page.click("#email-btn", { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.locator("#result").scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: shot("v5-montage-email.png") });
    await dumpResult("email");
    mark("shot8-email");
    // Call (async, up to 60s)
    await page.click("#tab-btn-call", { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.fill("#call-number", "0812-3456-7890", { timeout: 15000 });
    await page.fill("#call-said", "Hello, this is BCA customer service on WhatsApp. Please send your OTP code 482916 now, otherwise your account will be blocked.", { timeout: 15000 });
    await page.click("#call-btn", { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.waitForSelector("#call-btn:not([disabled])", { timeout: 60000 });
    await page.locator("#result").scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot("v5-montage-call.png") });
    await dumpResult("call");
    mark("shot8-call");
    // Outbound guard (local, fast)
    await page.click("#tab-btn-outbound", { timeout: 15000 });
    await page.waitForTimeout(600);
    await page.fill("#outbound-input", "Hi, my OTP code is 482916, please verify my account", { timeout: 15000 });
    await page.click("#outbound-btn", { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot("v5-montage-outbound.png") });
    mark("shot8-outbound");
    // File checker (local magic bytes, fast)
    await page.click("#module-tab-file", { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.setInputFiles("#filecheck-input", APK_FIXTURE, { timeout: 15000 });
    await page.waitForTimeout(500);
    await page.click("#filecheck-btn", { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot("v5-montage-file.png") });
    mark("shot8-file");
    // Quiz (local, fast) — first question is the Telkomsel prize scam.
    await page.click("#module-tab-quiz", { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.click("#quiz-start-btn", { timeout: 15000 });
    await page.waitForTimeout(1000);
    const qText = await page.evaluate(() => document.querySelector("#quiz-question")?.textContent || "");
    console.log(`QUIZ Q1: ${qText.slice(0, 80)}`);
    const scamQ = /CONGRATULATIONS|won|prize/i.test(qText);
    await page.click(scamQ ? "#quiz-scam-btn" : "#quiz-safe-btn", { timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot("v5-montage-quiz.png") });
    mark("shot8-quiz");
    mark("shot8-end");

    // ---- Shot 9: history + closing ----
    await page.click("#module-tab-history", { timeout: 15000 });
    await page.waitForTimeout(1200);
    mark("shot9-start");
    await page.screenshot({ path: shot("v5-history.png") });
    await page.waitForTimeout(1200);
    await page.locator(".footer").scrollIntoViewIfNeeded({ timeout: 15000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot("v5-closing.png") });
    await page.waitForTimeout(1000);
    mark("shot9-end");
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
    try {
      await page.screenshot({ path: shot("v5-FAILED.png") });
    } catch (_) { /* ignore */ }
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    proxyProc.kill();
    fs.writeFileSync(path.join(RAW_DIR, "v5-manifest.json"), JSON.stringify({ markers, results, error: e.message }, null, 2));
    process.exit(1);
  }

  await context.close();
  await browser.close();
  proxyProc.kill();
  const video = page.video();
  const tmpPath = video ? await video.path() : null;
  const outPath = path.join(RAW_DIR, "tipucek-demo-v5-raw.webm");
  if (tmpPath && fs.existsSync(tmpPath)) {
    fs.renameSync(tmpPath, outPath);
    console.log(`VIDEO ${outPath}`);
  } else {
    console.error("No video file was produced by Playwright.");
    process.exit(1);
  }
  fs.writeFileSync(path.join(RAW_DIR, "v5-manifest.json"), JSON.stringify({ markers, results }, null, 2));
  console.log("MANIFEST written");
  console.log(JSON.stringify({ markers, results }, null, 2));
}

main().catch((e) => {
  console.error(`FATAL ${e && e.stack || e}`);
  process.exit(1);
});
