#!/usr/bin/env node
// Follow-up probe for the two inconclusive items in verify-demo-mode.cjs:
//   1. image-btn: was read as disabled at page load — but the code disables
//      it when NO image is selected, not only in demo mode. Re-check with
//      a screenshot actually selected, and run the vision check.
//   2. call-voice + txt verdicts: the first script's freshness predicates
//      matched the EARLIER scam card ("hadiah" / "Rp 50.000.000" appear in
//      it too), so those reads were stale. Re-run with predicates unique
//      to each module's own checked message.
// Same fresh-context + local-proxy (:18086) pattern. Read-only.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18086", 10);
const LIVE = "https://tipucek.web.app/";
const EXPECTED_BUNDLE = "index-mJ9znPGE.js";
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });

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
    page.on("request", (req) => {
      if (/\/assets\/index-[^/]+\.js/.test(req.url())) bundleUrls.push(req.url());
    });

    await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(5000);
    const bundle = bundleUrls.map((u) => u.split("/").pop()).join(",");
    check("bundle: live serves index-mJ9znPGE.js", bundle.includes(EXPECTED_BUNDLE), `bundles=${bundle || "(none seen)"}`);

    // --- (1) image check: select screenshot, button must enable, vision verdict IN_CLOUD ---
    await page.setInputFiles("#image-input", path.join(ROOT, "test-samples/screenshot-penipu.png"));
    await page.waitForSelector("#image-preview:not([hidden])", { timeout: 15000 });
    const imgBtnEnabled = await page.locator("#image-btn").isEnabled();
    check("image-btn: enabled once an image is selected (not demo-gated)", imgBtnEnabled, `enabled=${imgBtnEnabled}`);
    await page.click("#image-btn");
    // Freshness: the image check renders .image-read-text (OCR text) — only this module does.
    await page.waitForSelector("#result .image-read-text", { timeout: 90000 });
    const ocrText = await page.locator("#result .image-read-text").innerText();
    const statusI = await page.locator("#result .result-status").innerText();
    const scoreI = await page.locator("#result .ring-value strong").innerText();
    const badgeI = await page.locator("#result .result-badge").innerText();
    check("image: vision verdict rendered", /Scam|Penipuan|Suspicious|Mencurigakan|Safe|Aman/.test(statusI), `${statusI} ${scoreI} ${badgeI} | OCR: ${ocrText.slice(0, 120)}`);
    check("image: badge IN_CLOUD (not DEMO)", /IN_CLOUD/.test(badgeI) && !/DEMO/.test(badgeI), badgeI);
    await page.screenshot({ path: path.join(RAW, "demo-verify-followup-image.png") });

    // --- (2) call voice, fresh predicate: transcript contains "Rp50 juta" (no space),
    // while the earlier scam sample uses "Rp 50.000.000" — the two cannot collide. ---
    await page.click("#tab-btn-call");
    await page.setInputFiles("#call-audio-input", path.join(ROOT, "test-samples/call-scam-id.mp3"));
    await page.waitForSelector("#call-transcript-box:not([hidden])", { timeout: 90000 });
    const transcript = await page.locator("#call-transcript").innerText();
    check("call-voice: transcript is the real spoken words", /hadiah|biaya administrasi/i.test(transcript), transcript.slice(0, 200));
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("Rp50 juta");
    }, { timeout: 90000 });
    const statusC = await page.locator("#result .result-status").innerText();
    const scoreC = await page.locator("#result .ring-value strong").innerText();
    const badgeC = await page.locator("#result .result-badge").innerText();
    const resultCText = await page.locator("#result").innerText();
    check("call-voice: transcribed scam call judged Scam", /Scam|Penipuan/i.test(statusC) && parseInt(scoreC, 10) >= 60, `${statusC} ${scoreC} ${badgeC}`);
    check("call-voice: badge IN_CLOUD (not DEMO)", /IN_CLOUD/.test(badgeC) && !/DEMO/.test(badgeC), badgeC);
    check("call-voice: receipt 'only for transcription'", /only for transcription/i.test(resultCText), resultCText.replace(/\n/g, " | ").slice(0, 500));
    check("call-voice: no demo refusal text", !/demo mode|cannot transcribe|tidak bisa mentranskrip/i.test(resultCText), "clean");
    await page.screenshot({ path: path.join(RAW, "demo-verify-followup-callvoice.png") });

    // --- (3) .txt file, fresh predicate: "PT HADIAH NUSANTARA" is unique to the file. ---
    await page.click("#tab-btn-message");
    await page.setInputFiles("#filecheck-input", path.join(ROOT, "test-samples/pesan-penipu.txt"));
    await page.click("#filecheck-btn");
    await page.waitForSelector("#filecheck-ai-btn", { timeout: 30000 });
    await page.click("#filecheck-ai-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("PT HADIAH NUSANTARA");
    }, { timeout: 90000 });
    const statusT = await page.locator("#result .result-status").innerText();
    const scoreT = await page.locator("#result .ring-value strong").innerText();
    const badgeT = await page.locator("#result .result-badge").innerText();
    check("txt: AI scores file content as Scam", /Scam|Penipuan/i.test(statusT), `${statusT} ${scoreT} ${badgeT}`);
    check("txt: badge IN_CLOUD (not DEMO)", /IN_CLOUD/.test(badgeT) && !/DEMO/.test(badgeT), badgeT);
    await page.screenshot({ path: path.join(RAW, "demo-verify-followup-txt.png") });

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
