#!/usr/bin/env node
// TipuCek — model-failover verification (Myuden 20 Nov 02:46: "Ya, buat failover").
//
// Verifies the LIVE site https://tipucek.web.app end to end in a real browser.
// Primary model gemini-3.5-flash-lite, backup gemini-3.1-flash-lite.
// Failure is forced ONLY by Playwright route interception on the model
// name in the generateContent URL — no production config is touched.
//
//   F1. Primary aborted -> backup answers: full AI verdict (cloud badge),
//       receipt names the backup model, history names it, the interim
//       progress honestly shows "Mencoba model cadangan…".
//   F2. Primary delayed 40 s (real 30 s timeout path) -> backup answers;
//       wall time is the measured worst case (primary timeout + backup).
//   F3. Both models aborted -> the code-only card (third layer), no AI
//       verdict, retry button present.
//   F4. Retry from the code-only card (AI restored) -> full AI verdict
//       from the PRIMARY model, backup never called during the retry.
//   F5. Normal check (nothing blocked) -> primary answers, receipt names
//       the primary model, backup NEVER called.
//   F6. Image check with primary aborted -> backup answers (same path).
//   F7. No uncaught page errors during the whole run.
//
// Usage: node video/failover-verify.cjs
// Exit code 0 only when F1-F7 all pass.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18092", 10);
const LIVE = "https://tipucek.web.app/?lang=id";
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });
const OTP_ID =
  "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";
const SCAM_PRIZE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam.";
const SCAM_PRIZE_VARIANT =
  "SELAMAT! Anda memenangkan hadiah Rp 25.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 100.000 untuk klaim hadiah Anda sebelum 24 jam.";
const SAFE_OFFICE =
  "Hi Budi, this is Sari from the office. The team meeting is moved to Thursday 10:00 in room 3B. Please bring the Q3 report. See you there!";
const PRIMARY = "gemini-3.5-flash-lite";
const BACKUP = "gemini-3.1-flash-lite";
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail || "").slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
}
function waitForPort(host, port, timeoutMs = 20000) {
  const start = Date.now();
  const attempt = () =>
    new Promise((resolve, reject) => {
      const s = net.connect(port, host);
      s.once("connect", () => { s.end(); resolve(); });
      s.once("error", reject);
    });
  return (async () => {
    while (Date.now() - start < timeoutMs) {
      try { await attempt(); return; } catch (_) { await new Promise((r) => setTimeout(r, 200)); }
    }
    throw new Error("port did not open");
  })();
}
async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;
  const proxyProc = spawn(process.execPath, [path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js")], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  try { await waitForPort("127.0.0.1", PROXY_PORT); } catch (e) { proxyProc.kill(); console.error("proxy fail", e.message); process.exit(2); }
  const errors = [];
  const pageErrors = [];
  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox", "--disable-setuid-sandbox"], proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" } });
  let code = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "id-ID", ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { const m = "PAGEERROR: " + String((e && e.message) || e); errors.push(m); pageErrors.push(m); });
    page.on("console", (m) => { if (m.type() === "error") errors.push(`CONSOLE-ERROR: ${m.text().slice(0, 250)}`); });
    // Count generateContent calls per model (the model name is in the URL).
    let primaryReqs = 0;
    let backupReqs = 0;
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes(PRIMARY)) primaryReqs++;
      if (u.includes(BACKUP)) backupReqs++;
    });
    const resetCounters = () => { primaryReqs = 0; backupReqs = 0; };
    await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(5000);
    const resultText = () => page.evaluate(() => document.querySelector("#result")?.innerText || "");
    const receiptText = () => page.evaluate(() => document.querySelector("#result .privacy-receipt")?.innerText || "");
    const historyText = () => page.evaluate(() => document.querySelector("#history-list")?.innerText || "");
    const badgeText = () => page.evaluate(() => document.querySelector("#result .badge")?.innerText || "");
    const statusText = () => page.evaluate(() => document.querySelector("#result .result-status")?.innerText || "");
    const scoreText = () => page.evaluate(() => document.querySelector("#result .ring-value strong")?.innerText || "");
    const waitCloudBadge = (timeout = 120000) =>
      page.waitForFunction(
        () => { const b = document.querySelector("#result .badge"); return b && /cloud/i.test(b.className); },
        undefined, { timeout },
      );
    const waitIdle = async (maxMs = 120000) => {
      try {
        await page.waitForFunction(
          () => { const b = document.querySelector("#check-btn"); const p = document.querySelector("#progress"); return b && !b.disabled && (!p || p.hidden); },
          undefined, { timeout: maxMs },
        );
        return true;
      } catch { return false; }
    };
    // Sample a progress element's visible text while a check runs.
    // isIdle reports when that check's own button/progress are done.
    const watchProgressText = async (sel, isIdle, maxMs = 120000) => {
      const seen = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < maxMs) {
        const txt = await page.evaluate((s) => {
          const el = document.querySelector(s);
          return el && !el.hidden ? el.innerText : "";
        }, sel).catch(() => "");
        if (txt) seen.add(txt);
        const idle = await page.evaluate(isIdle).catch(() => false);
        if (idle && seen.size > 0) break;
        await page.waitForTimeout(200);
      }
      return [...seen];
    };
    const messageIdle = () => {
      const b = document.querySelector("#check-btn");
      const p = document.querySelector("#progress");
      return b && !b.disabled && (!p || p.hidden);
    };
    const imageIdle = () => {
      const b = document.querySelector("#image-btn");
      const p = document.querySelector("#image-progress");
      return b && !b.disabled && (!p || p.hidden);
    };
    const clearResult = () => page.evaluate(() => { document.querySelector("#result").innerHTML = ""; });
    const primaryUrl = (url) => url.href.includes(PRIMARY);
    const backupUrl = (url) => url.href.includes(BACKUP);

    // --- F1. Primary aborted -> backup answers (OTP, ID) ---
    resetCounters();
    await page.route(primaryUrl, (route) => route.abort());
    const watchF1 = watchProgressText("#progress", messageIdle);
    const tF1 = Date.now();
    await page.fill("#message-input", OTP_ID);
    await page.click("#check-btn");
    let f1Badge = false;
    try { await waitCloudBadge(90000); f1Badge = true; } catch { /* fall through */ }
    const seenF1 = await watchF1;
    const secsF1 = ((Date.now() - tF1) / 1000).toFixed(1);
    const receiptF1 = await receiptText();
    const histF1 = await historyText();
    check("F1 backup answers when primary is aborted (cloud badge)", f1Badge, `badge=${await badgeText()} after ${secsF1}s`);
    check("F1 receipt names the backup model", /Model: gemini-3\.1-flash-lite \(cadangan\)/.test(receiptF1), receiptF1.slice(0, 200));
    check("F1 history names the backup model", histF1.includes(BACKUP), "history list");
    check("F1 backup was actually called, primary was attempted", backupReqs >= 1 && primaryReqs >= 1, `primary=${primaryReqs} backup=${backupReqs}`);
    check("F1 interim panel honestly showed the backup switch", seenF1.some((s) => s.includes("mencoba model cadangan")), seenF1.join(" | ").slice(0, 300));
    const f1Status = (await statusText()).trim();
    const f1Score = parseInt((await scoreText()).trim(), 10);
    check("F1 backup verdict flags the OTP message", (f1Status === "Penipuan" || f1Status === "Mencurigakan") && f1Score >= 30, `${f1Status} ${f1Score}/100`);
    check("F1 completion badge on the backup card", (await page.evaluate(() => document.querySelector("#result .check-complete")?.innerText || "")).includes("Pemeriksaan selesai"), await page.evaluate(() => document.querySelector("#result .check-complete")?.innerText || ""));
    check("F1 completion toast shows the backup verdict", await page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden && /Mencurigakan|Penipuan/.test(t.innerText); }), await page.evaluate(() => document.querySelector("#toast")?.innerText || ""));
    await page.unrouteAll({ behavior: "wait" });

    // --- F2. Primary delayed 40 s (real timeout path) -> backup answers ---
    resetCounters();
    await page.route(primaryUrl, (route) => { setTimeout(() => route.continue().catch(() => {}), 40000); });
    const tF2 = Date.now();
    await page.fill("#message-input", SCAM_PRIZE);
    await page.click("#check-btn");
    let f2Badge = false;
    try { await waitCloudBadge(120000); f2Badge = true; } catch { /* fall through */ }
    const secsF2 = ((Date.now() - tF2) / 1000).toFixed(1);
    const receiptF2 = await receiptText();
    check("F2 backup answers after the primary times out (cloud badge)", f2Badge, `badge=${await badgeText()} after ${secsF2}s`);
    check("F2 wall time proves the real 30 s timeout path was taken", parseFloat(secsF2) >= 28 && parseFloat(secsF2) <= 90, `${secsF2}s (worst case)`);
    check("F2 receipt names the backup model", /Model: gemini-3\.1-flash-lite \(cadangan\)/.test(receiptF2), receiptF2.slice(0, 200));
    check("F2 backup was called after the primary timed out", backupReqs >= 1 && primaryReqs >= 1, `primary=${primaryReqs} backup=${backupReqs}`);
    await page.unrouteAll({ behavior: "wait" });

    // --- F3. Both models aborted -> code-only card (third layer) ---
    resetCounters();
    await page.route(primaryUrl, (route) => route.abort());
    await page.route(backupUrl, (route) => route.abort());
    const tF3 = Date.now();
    await page.fill("#message-input", SCAM_PRIZE_VARIANT);
    await page.click("#check-btn");
    let f3Card = false;
    try { await page.waitForSelector("#retry-ai-btn", { state: "visible", timeout: 90000 }); f3Card = true; } catch { /* fall through */ }
    const secsF3 = ((Date.now() - tF3) / 1000).toFixed(1);
    const receiptF3 = await receiptText();
    check("F3 both models down -> code-only card appears", f3Card, `retry button after ${secsF3}s`);
    check("F3 badge is the honest code-only label", (await badgeText()).trim() === "Hasil pemeriksaan kode — tanpa vonis AI", await badgeText());
    check("F3 receipt has no model line (code verdict, not AI)", !/Model: gemini/.test(receiptF3), receiptF3.slice(0, 200));
    check("F3 history marks the entry code-only", /Hasil pemeriksaan kode/.test(await historyText()), "history list");

    // Cooldown: the project returns HTTP 429 on the primary after ~8
    // AI calls back-to-back (F1-F3). F4/F5 must measure the APP (does
    // the primary answer a normal check?), not the quota — pause so
    // the per-minute quota resets before the retry.
    await page.waitForTimeout(90000);
    // --- F4. Retry from the code-only card (AI restored) -> PRIMARY answers ---
    await page.unrouteAll({ behavior: "wait" });
    resetCounters();
    await page.click("#retry-ai-btn");
    let f4Badge = false;
    try { await waitCloudBadge(90000); f4Badge = true; } catch { /* fall through */ }
    const receiptF4 = await receiptText();
    check("F4 retry yields a full AI verdict", f4Badge, `badge=${await badgeText()}`);
    check("F4 retry restarts from the PRIMARY model (receipt)", /Model: gemini-3\.5-flash-lite \(utama\)/.test(receiptF4), receiptF4.slice(0, 200));
    check("F4 backup was NOT called during the retry", backupReqs === 0 && primaryReqs >= 1, `primary=${primaryReqs} backup=${backupReqs}`);

    // Same cooldown before the normal check (see F4).
    await page.waitForTimeout(90000);
    // --- F5. Normal check (nothing blocked) -> primary answers, backup never called ---
    resetCounters();
    await page.fill("#message-input", SAFE_OFFICE);
    await page.click("#check-btn");
    let f5Badge = false;
    try { await waitCloudBadge(90000); f5Badge = true; } catch { /* fall through */ }
    const receiptF5 = await receiptText();
    check("F5 normal check gets an AI verdict", f5Badge, `badge=${await badgeText()} status=${await statusText()}`);
    check("F5 receipt names the PRIMARY model", /Model: gemini-3\.5-flash-lite \(utama\)/.test(receiptF5), receiptF5.slice(0, 200));
    check("F5 backup was NEVER called when the primary succeeds", backupReqs === 0, `primary=${primaryReqs} backup=${backupReqs}`);
    check("F5 completion badge on the primary card", (await page.evaluate(() => document.querySelector("#result .check-complete")?.innerText || "")).includes("Pemeriksaan selesai"), await page.evaluate(() => document.querySelector("#result .check-complete")?.innerText || ""));

    // --- F6. Image check with primary aborted -> backup answers ---
    // NOTE: unlike the message check, the image check does not replace
    // the old result card while it runs, so clear it first — otherwise
    // the badge wait below would pass instantly on the stale F5 card.
    await clearResult();
    resetCounters();
    await page.route(primaryUrl, (route) => route.abort());
    await page.setInputFiles("#image-input", path.join(ROOT, "test-samples/screenshot-penipu.png"));
    try { await page.waitForFunction(() => !document.querySelector("#image-btn").disabled, undefined, { timeout: 15000 }); } catch { /* fall through */ }
    const watchF6 = watchProgressText("#image-progress", imageIdle);
    const tF6 = Date.now();
    await page.click("#image-btn");
    let f6Badge = false;
    try {
      await page.waitForFunction(imageIdle, undefined, { timeout: 120000 });
      f6Badge = /cloud/i.test((await page.evaluate(() => document.querySelector("#result .badge")?.className || "")));
    } catch { /* fall through */ }
    const seenF6 = await watchF6.catch(() => []);
    const secsF6 = ((Date.now() - tF6) / 1000).toFixed(1);
    const receiptF6 = await receiptText();
    check("F6 image check: backup answers when primary is aborted", f6Badge, `badge=${await badgeText()} after ${secsF6}s status=${await statusText()}`);
    check("F6 image receipt names the backup model", /Model: gemini-3\.1-flash-lite \(cadangan\)/.test(receiptF6), receiptF6.slice(0, 200));
    check("F6 image backup was called", backupReqs >= 1, `primary=${primaryReqs} backup=${backupReqs}`);
    check("F6 image progress honestly showed the backup switch", seenF6.some((s) => s.includes("mencoba model cadangan")), seenF6.join(" | ").slice(0, 300));
    await page.unrouteAll({ behavior: "wait" });

    // --- F7. No uncaught page errors ---
    check("F7 no uncaught page errors during the whole run", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || `console noise only (${errors.length} entries)`);

    code = results.every((r) => r.ok) ? 0 : 1;
    fs.writeFileSync(path.join(RAW, "failover-verify.json"), JSON.stringify({ label: "failover-live", results, errors }, null, 2));
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  } finally {
    await browser.close().catch(() => {});
    proxyProc.kill();
  }
  process.exit(code);
}
main().catch((e) => { console.error("FATAL", e); process.exit(2); });
