#!/usr/bin/env node
// Demo-mode verification for TipuCek live (https://tipucek.web.app).
// READ-ONLY vs the product: no deploy, no push, no video recording.
// Fresh Chromium context via the local proxy (:18086), same pattern as
// video/verify-live-fresh.cjs. Asserts:
//   1. live bundle is index-Dne9n-lV.js
//   2. demo banner hidden + mode label is AI (not "Demo mode")
//   3. no "demo" string anywhere in the visible UI text
//   4. scam message -> Scam + IN_CLOUD badge + cloud receipt (not demo)
//   5. Aman chat -> real AI answer, no assistantDemo text
//   6. call voice MP3 -> real transcript + Scam + "only for transcription"
//   7. .txt file -> AI verdict + IN_CLOUD badge
//   8. link tracker -> result, no demo trace
//   9. phone number alone -> verdict, no demo trace
// Output: JSON summary on stdout + screenshots in video/raw/.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18086", 10);
const LIVE = "https://tipucek.web.app/";
const EXPECTED_BUNDLE = "index-Dne9n-lV.js";
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });

const SCAM_SAMPLE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail || "").slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
}

async function waitForPort(host, port, timeoutMs = 20000) {
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
  throw new Error(`port ${host}:${port} did not open in ${timeoutMs}ms`);
}

async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;

  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  try {
    await waitForPort("127.0.0.1", PROXY_PORT);
  } catch (e) {
    proxyProc.kill();
    console.error("FAILED to start proxy:", e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });

  const errors = [];
  const bundleUrls = [];
  let exitCode = 0;
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + String((e && e.message) || e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`CONSOLE-ERROR: ${m.text().slice(0, 200)}`);
    });
    page.on("requestfailed", (req) => errors.push(`REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
    page.on("request", (req) => {
      if (/\/assets\/index-[^/]+\.js/.test(req.url())) bundleUrls.push(req.url());
    });

    await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(5000);

    const bundle = bundleUrls.map((u) => u.split("/").pop()).join(",");
    check("bundle: live serves index-Dne9n-lV.js", bundle.includes(EXPECTED_BUNDLE), `bundles=${bundle || "(none seen)"}`);

    // --- demo chrome: banner + mode label ---
    const bannerHidden = await page.locator("#demo-banner").isHidden();
    check("demo-banner: hidden in production", bannerHidden, `hidden=${bannerHidden}`);
    const modeLabel = await page.locator("#mode-label").innerText();
    check("mode-label: AI mode, not demo", !/demo/i.test(modeLabel), `label="${modeLabel}"`);
    const imageBtnDisabled = await page.locator("#image-btn").isDisabled();
    check("image-btn: enabled (demo disables it)", !imageBtnDisabled, `disabled=${imageBtnDisabled}`);

    // --- full visible-text scan for "demo" ---
    const bodyText = await page.evaluate(() => document.body.innerText);
    const demoHits = bodyText.split("\n").filter((l) => /demo/i.test(l));
    check("ui-text: no 'demo' string anywhere in visible UI", demoHits.length === 0,
      demoHits.length ? demoHits.slice(0, 5).join(" || ") : "clean");

    // --- (a) scam message -> Scam + IN_CLOUD ---
    await page.fill("#message-input", SCAM_SAMPLE);
    await page.click("#check-btn");
    await page.waitForSelector("#result .result-card", { timeout: 90000 });
    const status1 = await page.locator("#result .result-status").innerText();
    const score1 = await page.locator("#result .ring-value strong").innerText();
    const badge1 = await page.locator("#result .result-badge").innerText();
    const result1Text = await page.locator("#result").innerText();
    check("scam: verdict Scam, high score", /Scam|Penipuan/i.test(status1) && parseInt(score1, 10) >= 80, `${status1} ${score1} ${badge1}`);
    check("scam: badge IN_CLOUD (not DEMO)", /IN_CLOUD/.test(badge1) && !/DEMO/.test(badge1), badge1);
    check("scam: receipt is cloud, not demo", !/Demo mode|Mode demo|nothing was sent anywhere|tidak ada yang dikirim/i.test(result1Text), result1Text.replace(/\n/g, " | ").slice(0, 300));
    await page.screenshot({ path: path.join(RAW, "demo-verify-scam.png") });

    // --- (b) Aman chat ---
    await page.fill("#assistant-input", "Apa ciri-ciri pesan penipuan hadiah?");
    await page.click("#assistant-send");
    await page.waitForFunction(() => {
      const msgs = [...document.querySelectorAll("#assistant-log .assistant-msg.aman:not(.typing)")];
      return msgs.length > 0 && msgs[msgs.length - 1].textContent.trim().length > 20;
    }, { timeout: 90000 });
    const amanAnswer = await page.evaluate(() => {
      const msgs = [...document.querySelectorAll("#assistant-log .assistant-msg.aman:not(.typing)")];
      return msgs.length ? msgs[msgs.length - 1].textContent : "";
    });
    check("aman: real AI answer, no demo message",
      !/demo mode|mode demo|Firebase AI Logic/i.test(amanAnswer) && amanAnswer.length > 20,
      amanAnswer.slice(0, 200));
    await page.screenshot({ path: path.join(RAW, "demo-verify-aman.png") });

    // --- (c) call voice: MP3 upload -> transcript + Scam ---
    await page.click("#tab-btn-call");
    await page.setInputFiles("#call-audio-input", path.join(ROOT, "test-samples/call-scam-id.mp3"));
    await page.waitForSelector("#call-transcript-box:not([hidden])", { timeout: 90000 });
    const transcript = await page.locator("#call-transcript").innerText();
    check("call-voice: transcript is the real spoken words", /lima puluh juta|hadiah|biaya administrasi/i.test(transcript), transcript.slice(0, 200));
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && /lima puluh juta|hadiah/i.test(el.textContent);
    }, { timeout: 90000 });
    const statusC = await page.locator("#result .result-status").innerText();
    const scoreC = await page.locator("#result .ring-value strong").innerText();
    const badgeC = await page.locator("#result .result-badge").innerText();
    const resultCText = await page.locator("#result").innerText();
    check("call-voice: transcribed scam call judged Scam", /Scam|Penipuan/i.test(statusC) && parseInt(scoreC, 10) >= 60, `${statusC} ${scoreC} ${badgeC}`);
    check("call-voice: badge IN_CLOUD (not DEMO)", /IN_CLOUD/.test(badgeC) && !/DEMO/.test(badgeC), badgeC);
    check("call-voice: receipt 'only for transcription'", /only for transcription/i.test(resultCText), resultCText.replace(/\n/g, " | ").slice(0, 300));
    check("call-voice: no demo refusal text", !/demo mode|cannot transcribe|tidak bisa mentranskrip/i.test(resultCText), "clean");
    await page.screenshot({ path: path.join(RAW, "demo-verify-callvoice.png") });

    // --- (d1) .txt file -> AI verdict ---
    await page.click("#tab-btn-message");
    await page.setInputFiles("#filecheck-input", path.join(ROOT, "test-samples/pesan-penipu.txt"));
    await page.click("#filecheck-btn");
    await page.waitForSelector("#filecheck-ai-btn", { timeout: 30000 });
    await page.click("#filecheck-ai-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && /memenangkan hadiah|Rp 50.000.000/i.test(el.textContent);
    }, { timeout: 90000 });
    const statusT = await page.locator("#result .result-status").innerText();
    const scoreT = await page.locator("#result .ring-value strong").innerText();
    const badgeT = await page.locator("#result .result-badge").innerText();
    check("txt: AI scores file content as Scam", /Scam|Penipuan/i.test(statusT), `${statusT} ${scoreT} ${badgeT}`);
    check("txt: badge IN_CLOUD (not DEMO)", /IN_CLOUD/.test(badgeT) && !/DEMO/.test(badgeT), badgeT);
    await page.screenshot({ path: path.join(RAW, "demo-verify-txt.png") });

    // --- (d2) link tracker ---
    await page.fill("#linktrack-input", "http://bit.ly/hadiah-telkomsel-2026");
    await page.click("#linktrack-btn");
    await page.waitForFunction(() => {
      const box = document.querySelector("#linktrack-result");
      return box && !box.hidden && box.innerText.trim().length > 10;
    }, { timeout: 60000 });
    const linkText = await page.locator("#linktrack-result").innerText();
    check("linktrack: result shown, no demo trace", !/demo/i.test(linkText), linkText.replace(/\n/g, " | ").slice(0, 200));
    await page.screenshot({ path: path.join(RAW, "demo-verify-linktrack.png") });

    // --- (d3) phone number alone ---
    await page.click("#tab-btn-call");
    await page.fill("#call-number", "081234567890");
    await page.fill("#call-said", "");
    await page.click("#call-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("081234567890");
    }, { timeout: 90000 });
    const statusP = await page.locator("#result .result-status").innerText();
    const badgeP = await page.locator("#result .result-badge").innerText();
    check("phone: verdict without demo trace", !/DEMO/i.test(badgeP), `${statusP} ${badgeP}`);
    await page.screenshot({ path: path.join(RAW, "demo-verify-phone.png") });

    // --- final full-page demo scan (after all modules ran) ---
    const bodyText2 = await page.evaluate(() => document.body.innerText);
    const demoHits2 = bodyText2.split("\n").filter((l) => /demo/i.test(l));
    check("ui-text-final: still no 'demo' string after all modules", demoHits2.length === 0,
      demoHits2.length ? demoHits2.slice(0, 5).join(" || ") : "clean");

    await ctx.close();
  } catch (e) {
    check("script completed without exception", false, e.message);
    console.error(e);
  } finally {
    await browser.close().catch(() => {});
    proxyProc.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(JSON.stringify({ total: results.length, passed: results.length - failed.length, failed: failed.length, errors }, null, 2));
  if (failed.length > 0 || errors.length > 0) {
    console.log("ERRORS:", JSON.stringify(errors.slice(0, 10), null, 2));
    exitCode = 1;
  }
  process.exit(exitCode);
}

main();
