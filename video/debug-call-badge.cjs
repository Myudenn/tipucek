#!/usr/bin/env node
// Debug probe: reproduce the call-badge race (email -> call) and log the
// #result DOM at each step.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18085", 10);
const PREVIEW_PORT = 4173;
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
  const dump = async (page, label) => {
    const d = await page.evaluate(() => {
      const p = document.querySelector("#result .checked-message p");
      const badge = document.querySelector("#result .result-badge");
      const status = document.querySelector("#result .result-status");
      const ring = document.querySelector("#result .ring-value strong");
      return { checked: p ? p.textContent.slice(0, 80) : null, badge: badge ? badge.innerText.replace(/\n/g, " ") : null, status: status ? status.innerText : null, ring: ring ? ring.innerText : null };
    });
    console.log(label, JSON.stringify(d));
  };
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${PREVIEW_PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(1500);
    // Email check (same fixture as verify-rombak).
    await page.click("#tab-btn-email");
    await page.fill("#email-from-name", "BCA");
    await page.fill("#email-from-email", "bca-promo@gmail.com");
    await page.fill("#email-body", "URGENT: Your BCA account will be blocked in 24 hours! Verify now at https://bca-secure-verify.xyz/login or you lose access.");
    await page.click("#email-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("bca-secure-verify.xyz");
    }, { timeout: 15000 });
    await dump(page, "after email:");
    // Call check.
    await page.click("#tab-btn-call");
    await page.fill("#call-number", "081234567890");
    await page.fill("#call-said", "Saya dari bank BCA, akun Anda akan diblokir, kirim kode OTP sekarang.");
    await page.click("#call-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("081234567890");
    }, { timeout: 15000 });
    await dump(page, "after call wait:");
    await page.waitForTimeout(2000);
    await dump(page, "after call +2s:");
    await ctx.close();
  } finally {
    await browser.close();
    proxyProc.kill();
    previewProc.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
