#!/usr/bin/env node
// TipuCek — timeout-fallback verification (Myuden 19 Nov 23:45: "Ya, buat fallback itu").
//
// Verifies the LIVE site https://tipucek.web.app end to end in a real browser:
//   A. AI endpoint aborted -> the check must NOT show a dead error box:
//      it renders a code-only verdict card (badge "Hasil pemeriksaan kode —
//      tanpa vonis AI", Mencurigakan 40/100 for the OTP sample) with the
//      honest note + a "Coba lagi" retry button, and the error box stays hidden.
//   B. Language switch on that code-only card (AI still aborted) -> the card
//      re-renders in English (badge "Code-check result — no AI verdict yet")
//      with NO duplicate error box.
//   C. Retry with the AI route restored -> the full AI verdict replaces the
//      code-only card (Scam, cloud/device badge, no retry button).
//   D. Genuine 30 s timeout: AI endpoint delayed 40 s -> the fallback card
//      appears via the real timeout path (wall time ~60-95 s: the primary
//      AND the backup each hang for their own 30 s timeout when the
//      on-device init fails fast — see the ~95 s worst case in src/ai.js),
//      scores Scam 98/100 from the code check.
//   E. Normal check unchanged: a safe message gets a full AI verdict
//      (or, if the free tier fails again, the fallback card — either is a
//      correct outcome; a stuck "still loading" panel or a page error is not).
//
// Usage: node video/fallback-verify.cjs
// Exit code 0 only when A-D all pass.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18091", 10);
const LIVE = "https://tipucek.web.app/?lang=id";
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });
const OTP_ID =
  "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";
const SCAM_PRIZE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam.";
const SAFE_OFFICE =
  "Hi Budi, this is Sari from the office. The team meeting is moved to Thursday 10:00 in room 3B. Please bring the Q3 report. See you there!";
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
const AI_HOSTS = ["**/generativelanguage.googleapis.com/**", "**/firebasevertexai.googleapis.com/**"];
async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;
  const proxyProc = spawn(process.execPath, [path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js")], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  try { await waitForPort("127.0.0.1", PROXY_PORT); } catch (e) { proxyProc.kill(); console.error("proxy fail", e.message); process.exit(2); }
  const errors = [];
  const pageErrors = [];
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"], proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" } });
  let code = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "id-ID", ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { const m = "PAGEERROR: " + String((e && e.message) || e); errors.push(m); pageErrors.push(m); });
    page.on("console", (m) => { if (m.type() === "error") errors.push(`CONSOLE-ERROR: ${m.text().slice(0, 250)}`); });
    await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(5000);
    const resultText = () => page.evaluate(() => document.querySelector("#result")?.innerText || "");
    const errorHidden = () => page.evaluate(() => !!document.querySelector("#error")?.hidden);
    const badgeText = () => page.evaluate(() => document.querySelector("#result .badge")?.innerText || "");
    const statusText = () => page.evaluate(() => document.querySelector("#result .result-status")?.innerText || "");
    const scoreText = () => page.evaluate(() => document.querySelector("#result .ring-value strong")?.innerText || "");
    const waitIdle = async (maxMs = 60000) => {
      try {
        await page.waitForFunction(
          () => { const b = document.querySelector("#check-btn"); const p = document.querySelector("#progress"); return b && !b.disabled && (!p || p.hidden); },
          undefined, { timeout: maxMs },
        );
        return true;
      } catch { return false; }
    };

    // --- A. AI aborted -> code-only fallback card (ID) ---
    for (const pat of AI_HOSTS) await page.route(pat, (route) => route.abort());
    await page.fill("#message-input", OTP_ID);
    const tA = Date.now();
    await page.click("#check-btn");
    let aOk = false;
    try { await page.waitForSelector("#retry-ai-btn", { state: "visible", timeout: 60000 }); aOk = true; } catch { /* fall through to checks */ }
    const secsA = ((Date.now() - tA) / 1000).toFixed(1);
    const txtA = await resultText();
    check("A1 fallback card appears on AI abort", aOk, `retry button visible after ${secsA}s`);
    check("A1 completion badge on the code-only card", (await page.evaluate(() => document.querySelector("#result .check-complete")?.innerText || "")).includes("Pemeriksaan selesai"), await page.evaluate(() => document.querySelector("#result .check-complete")?.innerText || ""));
    check("A1 completion toast shows the code-only verdict", await page.evaluate(() => { const t = document.querySelector("#toast"); return t && !t.hidden && /Mencurigakan|Penipuan/.test(t.innerText); }), await page.evaluate(() => document.querySelector("#toast")?.innerText || ""));
    check("A2 badge is the honest code-only label (ID)", (await badgeText()).trim() === "Hasil pemeriksaan kode — tanpa vonis AI", await badgeText());
    check("A3 status Mencurigakan, score 40 (real code verdict)", (await statusText()).trim() === "Mencurigakan" && (await scoreText()).trim() === "40", `${await statusText()} ${await scoreText()}/100`);
    check("A4 note says no AI verdict + names the retry", /tanpa vonis AI/.test(txtA) && /Coba lagi/.test(txtA), txtA.slice(0, 200));
    check("A5 error box stays hidden (no dead error)", await errorHidden(), "error hidden=" + (await errorHidden()));
    check("A6 no 'still loading' panel left", !/masih dimuat|still loading/i.test(txtA), "interim panel replaced");
    check("A7 history marks the entry code-only", /Hasil pemeriksaan kode/.test(await page.evaluate(() => document.querySelector("#history-list")?.innerText || "")), "history list");

    // --- B. Language switch on the code-only card (AI still aborted) ---
    await page.selectOption("#lang-select", "en");
    await waitIdle(30000);
    const txtB = await resultText();
    check("B1 card follows to English, badge code-only", (await badgeText()).trim() === "Code-check result — no AI verdict yet", await badgeText());
    check("B2 status Suspicious, score 40 in EN", (await statusText()).trim() === "Suspicious" && (await scoreText()).trim() === "40", `${await statusText()} ${await scoreText()}/100`);
    check("B3 no duplicate error box on failed re-check", await errorHidden(), "error hidden=" + (await errorHidden()));

    // --- C. Retry with AI restored -> full AI verdict replaces the card ---
    await page.unrouteAll({ behavior: "wait" });
    let cOk = false;
    let cDetail = "";
    for (let attempt = 1; attempt <= 2 && !cOk; attempt++) {
      await page.click("#retry-ai-btn");
      try {
        await page.waitForFunction(
          () => { const b = document.querySelector("#result .badge"); return b && /cloud|device/i.test(b.className); },
          undefined, { timeout: 90000 },
        );
        cOk = true;
        cDetail = `attempt ${attempt}`;
      } catch { cDetail = `attempt ${attempt} timed out (venue?)`; }
    }
    const txtC = await resultText();
    check("C1 retry yields a full AI verdict (cloud/device badge)", cOk, cDetail + " | badge=" + (await badgeText()));
    // The AI score is non-deterministic: the OTP warning text can come
    // back Scam (~95 on Myuden's phone) or Suspicious (75 here). What
    // matters is that the retry returns a GENUINE AI verdict that
    // flags the message (not Safe) and replaces the code-only card.
    const cStatus = (await statusText()).trim();
    const cScore = parseInt((await scoreText()).trim(), 10);
    check("C2 retry verdict flags the message + code-only card gone", cOk && (cStatus === "Scam" || cStatus === "Suspicious") && cScore >= 30 && !(await page.$("#retry-ai-btn")), `${cStatus} ${cScore}/100`);
    check("C3 history now holds code-only + AI entries", /Code-check result/.test(await page.evaluate(() => document.querySelector("#history-list")?.innerText || "")) && /Answered in the cloud|Answered on this device/.test(await page.evaluate(() => document.querySelector("#history-list")?.innerText || "")), "history list");

    // --- D. Genuine 30 s timeout: AI delayed 40 s, fresh message (no cache) ---
    for (const pat of AI_HOSTS) {
      await page.route(pat, (route) => { setTimeout(() => route.continue().catch(() => {}), 40000); });
    }
    await page.fill("#message-input", SCAM_PRIZE);
    const tD = Date.now();
    await page.click("#check-btn");
    let dOk = false;
    try { await page.waitForSelector("#retry-ai-btn", { state: "visible", timeout: 120000 }); dOk = true; } catch { /* fall through */ }
    const secsD = ((Date.now() - tD) / 1000).toFixed(1);
    check("D1 fallback appears via the real timeout path", dOk, `retry button after ${secsD}s (expect ~60-95s)`);
    check("D2 timeout wall time proves the real timeout path (not a fast abort)", parseFloat(secsD) >= 28 && parseFloat(secsD) <= 100, `${secsD}s`);
    check("D3 prize sample scores Scam 98 from the code check", (await statusText()).trim() === "Scam" && (await scoreText()).trim() === "98", `${await statusText()} ${await scoreText()}/100`);
    check("D4 badge code-only in EN", (await badgeText()).trim() === "Code-check result — no AI verdict yet", await badgeText());
    await page.unrouteAll({ behavior: "wait" });

    // --- E. Normal check unchanged (safe message, AI live) ---
    await page.fill("#message-input", SAFE_OFFICE);
    await page.click("#check-btn");
    let eCard = false;
    try {
      await page.waitForFunction(
        () => { const b = document.querySelector("#result .badge"); return b && (/cloud|device/i.test(b.className) || /badge-code/.test(b.className)); },
        undefined, { timeout: 90000 },
      );
      eCard = true;
    } catch { /* fall through */ }
    const txtE = await resultText();
    check("E1 safe message yields a verdict card (AI Safe, or code-only if venue fails)", eCard && /Safe|Aman/.test(txtE), `${await statusText()} ${await scoreText()}/100 | badge=${await badgeText()}`);
    // Console errors from the VM proxy/headless shell (SSL fetch,
    // storage access) are environment noise, not app bugs: the
    // decisive signal is zero uncaught page errors.
    check("E2 no uncaught page errors during the whole run", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || `console noise only (${errors.length} entries)`);

    // --- F. Too-long message: honest error, NO fallback, NO panel left ---
    // Set programmatically: the textarea's maxlength=4000 would trim a
    // typed/pasted input, but analyzeMessage must still reject >4000.
    await page.evaluate(() => { document.querySelector("#message-input").value = "x".repeat(4200); });
    await page.click("#check-btn");
    await page.waitForTimeout(1500);
    const errVisible = await page.evaluate(() => { const e = document.querySelector("#error"); return e && !e.hidden && e.innerText; });
    const resultHiddenF = await page.evaluate(() => !!document.querySelector("#result")?.hidden);
    // What the user sees is what matters: innerText still returns text
    // for a display:none node in this headless Chromium, so assert on
    // actual visibility instead of the text content.
    const resultVisibleF = await page.locator("#result").isVisible();
    check("F1 too-long shows the length error, not a verdict", /terlalu panjang|too long/i.test(errVisible || ""), String(errVisible).slice(0, 120));
    check("F2 no fallback card for a rejected input", !(await page.$("#retry-ai-btn")), "no retry-ai button");
    check("F3 interim panel hidden after the error (no 'still loading')", resultHiddenF && !resultVisibleF, `result hidden=${resultHiddenF} visible=${resultVisibleF}`);

    code = results.every((r) => r.ok) ? 0 : 1;
    fs.writeFileSync(path.join(RAW, "fallback-verify.json"), JSON.stringify({ label: "fallback-live", results, errors }, null, 2));
    console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  } finally {
    await browser.close().catch(() => {});
    proxyProc.kill();
  }
  process.exit(code);
}
main().catch((e) => { console.error("FATAL", e); process.exit(2); });
