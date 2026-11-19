#!/usr/bin/env node
// Race diagnosis: observe every #result rewrite (badge + ring + timestamp)
// through the exact desktop flow: scam check -> outbound -> paste -> email -> call.
// Run 3x; if a DEMO render lands after the call render, the log shows when.
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18085", 10);
const PREVIEW_PORT = 4173;
const SCAM_SAMPLE = "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!";
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
    } catch (_) { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("port did not open");
}
async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;
  const proxyProc = spawn(process.execPath, [path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js")], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: "ignore" });
  const previewProc = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"], { cwd: ROOT, stdio: "ignore" });
  try { await waitForPort("127.0.0.1", PROXY_PORT); await waitForPort("127.0.0.1", PREVIEW_PORT); } catch (e) { proxyProc.kill(); previewProc.kill(); console.error(e.message); process.exit(2); }
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"], proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" } });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, permissions: ["clipboard-read", "clipboard-write"] });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PREVIEW_PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__t0 = performance.now();
      window.__rewrites = [];
      const el = document.querySelector("#result");
      new MutationObserver(() => {
        const badge = document.querySelector("#result .result-badge");
        const ring = document.querySelector("#result .ring-value strong");
        const checked = document.querySelector("#result .checked-message p");
        window.__rewrites.push({
          at: +((performance.now() - window.__t0) / 1000).toFixed(2),
          badge: badge ? badge.innerText.replace(/\n/g, " ") : null,
          ring: ring ? ring.innerText : null,
          checked: checked ? checked.textContent.slice(0, 40) : null,
        });
      }).observe(el, { childList: true, subtree: true });
    });
    const mark = async (label) => {
      const log = await page.evaluate(() => window.__rewrites);
      console.log(`--- ${label} (rewrites so far: ${log.length})`);
      for (const r of log) console.log(`  t=${r.at}s badge=${r.badge} ring=${r.ring} checked=${JSON.stringify(r.checked)}`);
    };
    // (1) scam sample
    await page.locator("#samples button").first().click();
    await page.click("#check-btn");
    await page.waitForSelector("#result .result-card", { timeout: 90000 });
    await page.waitForTimeout(1000);
    await mark("after scam check");
    // (2) outbound
    await page.click("#tab-btn-outbound");
    await page.fill("#outbound-input", "Kode OTP saya 482916, password: rahasia123. Kirim ke rekening 1234567890 ya.");
    await page.click("#outbound-btn");
    await page.waitForSelector("#outbound-result:not([hidden])", { timeout: 5000 });
    await mark("after outbound");
    // (3) paste
    await page.click("#tab-btn-message");
    await page.evaluate((text) => navigator.clipboard.writeText(text), SCAM_SAMPLE);
    await page.click("#paste-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("hadiah-telkomsel-2026");
    }, { timeout: 90000 });
    await mark("after paste");
    // (4) email
    await page.click("#tab-btn-email");
    await page.fill("#email-from-name", "BCA");
    await page.fill("#email-from-email", "bca-promo@gmail.com");
    await page.fill("#email-body", "URGENT: Your BCA account will be blocked in 24 hours! Verify now at https://bca-secure-verify.xyz/login or you lose access.");
    await page.click("#email-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("bca-secure-verify.xyz");
    }, { timeout: 15000 });
    await mark("after email");
    // (5) call
    await page.click("#tab-btn-call");
    await page.fill("#call-number", "081234567890");
    await page.fill("#call-said", "Saya dari bank BCA, akun Anda akan diblokir, kirim kode OTP sekarang.");
    await page.click("#call-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("081234567890");
    }, { timeout: 15000 });
    await mark("after call wait");
    await page.waitForTimeout(3000);
    await mark("after call +3s");
    await ctx.close();
  } finally {
    await browser.close();
    proxyProc.kill();
    previewProc.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
