#!/usr/bin/env node
// Fresh-session live verification for TipuCek (https://tipucek.web.app).
// Purpose: prove in a BROWSER WITH EMPTY CACHE/STORAGE whether the
// deployed fixes actually run — a stale service-worker cache in a
// reused browser profile can serve the old shell even when the server
// already serves the new bundle (seen 19 Nov 15:13: live test failed
// 4 checks while curl proved the new bundle was live).
//
// Starts a local proxy (:18086) and opens the LIVE site in a fresh
// Chromium context (no cookies, no cache, no service worker from any
// earlier run). Asserts the exact bundle loaded, then tests:
//   0. new layout (polish round, asserts only after deploy): hero
//      stat with the OJK figures + input/Cek button above the fold
//   1. link-tracker module is visible
//   2. scam message -> verdict
//   3. .txt file -> read + scored (not "not recognized")
//   4. phone number alone -> verdict, no "paste a message first" error
//   5. QRIS is GONE (removed 19 Nov, Myuden's order): pasting a QRIS
//      payload produces NO QRIS box and NO QRIS wording anywhere
//   6. call voice (live, real cloud AI): upload an MP3 of a scam call
//      -> transcript appears, transcript scored like a message
//      (Scam), privacy receipt says the audio went to the cloud only
//      for transcription
//      (Voice output was removed 19 Nov — Myuden: it never sounded on the
// user's phone — so there is no voice-output check
// here anymore. Call voice above is INPUT: record/upload -> transcribe
// -> score, and it stays.)
//   7. crowd report form present (guarded: only after the polish
//      deploy) — form fields exist; NEVER submits anything live.
// Output: JSON summary on stdout + screenshots in video/raw/.
// Usage: node video/verify-live-fresh.cjs
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18086", 10);
const LIVE = "https://tipucek.web.app/";
// Bundle live saat ini (terverifikasi curl 19 Nov); override lewat env
// bila deploy baru sudah jalan: EXPECTED_BUNDLE=index-XXXX.js node ...
const EXPECTED_BUNDLE = process.env.EXPECTED_BUNDLE || "index-Dne9n-lV.js";
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });

const SCAM_SAMPLE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!";
const QRIS_GONE_SAMPLE =
  "00020101021126180014ID.CO.QRIS.WWW5204541153033605405500005802ID5911TOKO BERKAH6007JAKARTA6304909F";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail || "").slice(0, 300) });
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
    // Fresh context: no storage, no cache, no service worker from any
    // earlier run — exactly what a first-time visitor gets.
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    // Module tabs exist only in the new (polish) layout; older live
    // bundles have no #module-tab-*. Click only when present so this
    // script keeps working pre-deploy.
    async function openModuleTab(tab) {
      const btn = page.locator(`#module-tab-${tab}`);
      if ((await btn.count()) === 1) {
        await btn.click();
        await page.waitForTimeout(300);
      }
    }
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
    check("bundle: live serves the new bundle", bundle.includes(EXPECTED_BUNDLE), `bundles=${bundle || "(none seen)"}`);
    check("shell: title contains TipuCek", (await page.title()).includes("TipuCek"), await page.title());
    const bodyText = await page.evaluate(() => document.body.innerText);
    check("shell: 0 PesanAman in UI text", !bodyText.includes("PesanAman"), bodyText.includes("PesanAman") ? "FOUND" : "clean");

    // --- (0) new layout (polish round): hero stat + first screen ---
    // Hard checks: they assert the deployed layout, so run this script
    // only after the polish deploy.
    const heroStat = await page.locator(".hero-stat").innerText();
    check("layout: hero stat shows OJK figures", /9\.1/.test(heroStat) && /411,000\+/.test(heroStat) && /OJK \(IASC\)/.test(heroStat), heroStat.slice(0, 150));
    const firstScreen = await page.evaluate(() => {
      const input = document.querySelector("#message-input").getBoundingClientRect();
      const btn = document.querySelector("#check-btn").getBoundingClientRect();
      return { inputBottom: Math.round(input.bottom), btnBottom: Math.round(btn.bottom) };
    });
    check("layout: first screen holds input + Cek button (1280x800)", firstScreen.inputBottom <= 800 && firstScreen.btnBottom <= 800, JSON.stringify(firstScreen));
    // --- (7) crowd report form present (guarded, never submitted) ---
    if ((await page.locator("#module-tab-report").count()) === 1) {
      await openModuleTab("report");
      check("crowd: report form fields present", (await page.locator("#crowd-type").count()) === 1
        && (await page.locator("#crowd-value").count()) === 1
        && (await page.locator("#crowd-details").count()) === 1
        && (await page.locator("#crowd-submit-btn").count()) === 1);
    }

    // --- (1) link-tracker module visible ---
    await openModuleTab("link");
    check("linktrack: module heading present", (await page.locator("#linktrack-heading").count()) === 1);
    check("linktrack: input visible", await page.locator("#linktrack-input").isVisible());
    check("linktrack: heading reads Track/Lacak a link", await page.locator("#linktrack-heading").innerText().then((t) => /Lacak|Track/i.test(t)), await page.locator("#linktrack-heading").innerText());

    // --- (2) scam message -> verdict ---
    await page.fill("#message-input", SCAM_SAMPLE);
    await page.click("#check-btn");
    await page.waitForSelector("#result .result-card", { timeout: 90000 });
    const status1 = await page.locator("#result .result-status").innerText();
    const score1 = await page.locator("#result .ring-value strong").innerText();
    const badge1 = await page.locator("#result .result-badge").innerText();
    check("scam: verdict is Scam with high score", /Scam|Penipuan/i.test(status1) && parseInt(score1, 10) >= 80, `${status1} ${score1} ${badge1}`);
    await page.screenshot({ path: path.join(RAW, "live-fresh-scam.png") });

    // --- (3) .txt file -> read + scored ---
    await openModuleTab("file");
    await page.setInputFiles("#filecheck-input", path.join(ROOT, "test-samples/pesan-penipu.txt"));
    await page.click("#filecheck-btn");
    // inspectFile is async (file fingerprint + content read): wait for the AI
    // button, not just the visible box (it first shows "Checking…").
    await page.waitForSelector("#filecheck-ai-btn", { timeout: 30000 });
    const fileText = await page.locator("#filecheck-result").innerText();
    check("txt: file is recognized (not 'not recognized')", !/not recognized|tidak dikenali/i.test(fileText), fileText.slice(0, 200));
    check("txt: file content shown / AI check offered", /Check this content with AI|Periksa isi ini dengan AI|content was read|isinya dibaca/i.test(fileText), fileText.slice(0, 200));
    const aiBtn = await page.locator("#filecheck-ai-btn").count();
    if (aiBtn === 1) {
      await page.click("#filecheck-ai-btn");
      await page.waitForFunction(
        () => /Scam|Penipuan|Suspicious|Mencurigakan|Safe|Aman/.test(document.querySelector("#filecheck-result")?.innerText || ""),
        { timeout: 90000 },
      );
      const fileVerdict = await page.locator("#filecheck-result").innerText();
      check("txt: AI scores the file content", /Scam|Penipuan|Suspicious|Mencurigakan/.test(fileVerdict), fileVerdict.replace(/\n/g, " | ").slice(0, 200));
    } else {
      check("txt: AI scores the file content", false, "no #filecheck-ai-btn");
    }
    await page.screenshot({ path: path.join(RAW, "live-fresh-txt.png") });

    // --- (4) phone number alone -> verdict, no error ---
    await page.click("#tab-btn-call");
    await page.fill("#call-number", "081234567890");
    await page.fill("#call-said", "");
    await page.click("#call-btn");
    // Freshness: wait for THIS check's render (the checked message must
    // contain this number), not the stale card from the scam check.
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("081234567890");
    }, { timeout: 30000 });
    const status5 = await page.locator("#result .result-status").innerText();
    const score5 = await page.locator("#result .ring-value strong").innerText();
    const callErrHidden = await page.locator("#call-error").isHidden();
    check("call-number-only: verdict without 'paste a message first' error", callErrHidden && /Suspicious|Mencurigakan/.test(status5) && parseInt(score5, 10) === 30, `${status5} ${score5} errHidden=${callErrHidden}`);
    await page.screenshot({ path: path.join(RAW, "live-fresh-call.png") });

    // --- (5) QRIS is GONE (removed 19 Nov, Myuden's order) ---
    // A pasted QRIS payload is ordinary text now: no QRIS box, no
    // QRIS wording anywhere in the result or on the page.
    await page.click("#tab-btn-message");
    await page.fill("#message-input", QRIS_GONE_SAMPLE);
    await page.click("#check-btn");
    // Freshness: wait for THIS check's render (the checked message must
    // contain the payload), not the stale card from the call check.
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("000201");
    }, { timeout: 90000 });
    check("qris-gone: no .qris-box in the result", (await page.locator("#result .qris-box").count()) === 0);
    // The AI may still NAME the string "QRIS" in its free-text summary
    // ("a raw QRIS payment string…") — that is the model describing
    // the pasted text, not a QRIS feature — and the history echoes the
    // user's own pasted payload (which literally contains "QRIS" in
    // "ID.CO.QRIS.WWW"). What must be gone is the APP's own QRIS
    // wording, so check only the static UI chrome (headings, hints,
    // tabs, labels, buttons) — never the verdict or the history.
    const chromeText = await page.evaluate(() =>
      [...document.querySelectorAll("h1, h2, h3, .hint, .checker-tab-btn, .checks-list li, .field-label, .call-audio p, button")]
        .map((el) => el.innerText)
        .join(" | "),
    );
    check("qris-gone: no QRIS wording in the app UI chrome", !/QRIS/i.test(chromeText), chromeText.replace(/\n/g, " | ").slice(0, 200));

    // --- (6) call voice, live (real cloud AI) ---
    // Upload an MP3 of a scam call (Indonesian, fake): the cloud must
    // transcribe real speech — never a made-up transcript — and the
    // transcript is scored like a message (Scam), with the audio
    // privacy line in the receipt.
    await page.click("#tab-btn-call");
    await page.setInputFiles("#call-audio-input", path.join(ROOT, "test-samples/call-scam-id.mp3"));
    await page.waitForSelector("#call-transcript-box:not([hidden])", { timeout: 90000 });
    const transcript = await page.locator("#call-transcript").innerText();
    check("call-voice: transcript is the real spoken words", /lima puluh juta|hadiah|biaya administrasi/i.test(transcript), transcript.slice(0, 200));
    // Freshness: wait for THIS check's render (the checked message must
    // contain the transcript), not the stale card from the QRIS check.
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && /lima puluh juta|hadiah/i.test(el.textContent);
    }, { timeout: 90000 });
    const status7 = await page.locator("#result .result-status").innerText();
    const score7 = await page.locator("#result .ring-value strong").innerText();
    const badge7 = await page.locator("#result .result-badge").innerText();
    check("call-voice: transcribed scam call judged Scam", /Scam|Penipuan/i.test(status7) && parseInt(score7, 10) >= 60, `${status7} ${score7} ${badge7}`);
    const result7Text = await page.locator("#result").innerText();
    check("call-voice: privacy receipt says audio went to cloud only for transcription", /only for transcription/i.test(result7Text), result7Text.replace(/\n/g, " | ").slice(0, 300));
    await page.screenshot({ path: path.join(RAW, "live-fresh-callvoice.png") });

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
