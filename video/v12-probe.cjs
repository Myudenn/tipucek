#!/usr/bin/env node
// v12 probe (headless): cek layout tab baru + satu cek OTP cloud + DOM share/history.
// DEBUG_TOKEN diambil dari env; nilainya TIDAK PERNAH dicetak.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const HOME = process.env.HOME;
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18104", 10);
const PLAYWRIGHT = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
const TOKEN = process.env.DEBUG_TOKEN || "";
const APP_URL = "https://tipucek.web.app/?lang=en";
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function waitForPort(host, port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { await new Promise((res, rej) => { const s = net.connect(port, host); s.once("connect", () => { s.end(); res(); }); s.once("error", rej); }); return; }
    catch (_) { await sleep(200); }
  }
  throw new Error("proxy port did not open");
}
async function main() {
  const proxyProc = spawn(process.execPath, [path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js")],
    { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  proxyProc.stderr.on("data", (d) => console.error("proxy:", String(d).trim()));
  try { await waitForPort("127.0.0.1", PROXY_PORT); } catch (e) { proxyProc.kill(); console.error("proxy failed"); process.exit(2); }
  const browser = await PLAYWRIGHT.chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"], proxy: { server: `http://127.0.0.1:${PROXY_PORT}` } });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: "en-US", ignoreHTTPSErrors: true });
    if (TOKEN) await ctx.addInitScript((t) => { self.FIREBASE_APPCHECK_DEBUG_TOKEN = t; }, TOKEN);
    console.log("token injected:", !!TOKEN);
    const page = await ctx.newPage();
    const bad = [];
    page.on("response", (res) => { if (res.status() >= 400) bad.push(`${res.status()} ${res.url().slice(0, 120)}`); });
    page.on("pageerror", (e) => bad.push("PAGEERROR " + String(e).slice(0, 150)));
    await page.goto(APP_URL, { waitUntil: "load", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await sleep(1500);
    // Tabs: teks + posisi
    const tabs = await page.evaluate(() => {
      const els = [...document.querySelectorAll("button")].filter((b) => /Check (message|email|number|before)/i.test(b.textContent || ""));
      return els.map((b) => { const r = b.getBoundingClientRect(); return { text: b.textContent.trim(), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 }; });
    });
    console.log("TABS:", JSON.stringify(tabs, null, 1));
    // Share/install/history hooks
    const hooks = await page.evaluate(() => ({
      shareBtn: !!document.querySelector("#share-card-btn"),
      manifest: !!document.querySelector('link[rel="manifest"]'),
      historyKey: Object.keys(localStorage).filter((k) => /history/i.test(k)),
      historyLen: (JSON.parse(localStorage.getItem("pesanaman_history_v1") || "[]")).length,
      sw: !!navigator.serviceWorker,
    }));
    console.log("HOOKS:", JSON.stringify(hooks));
    // OTP check
    await page.locator("text=Fake bank OTP warning").first().click({ timeout: 15000 });
    await sleep(700);
    const t0 = Date.now();
    await page.locator("#check-btn").click({ timeout: 15000 });
    await page.waitForSelector(".result-card.result-checking", { timeout: 10000 }).catch(() => console.log("no interim panel"));
    try {
      await page.waitForSelector(".result-card:not(.result-checking)", { timeout: 90000 });
    } catch (e) { console.log("VERDICT TIMEOUT after", ((Date.now() - t0) / 1000).toFixed(1), "s"); }
    const verdict = await page.evaluate(() => {
      const card = document.querySelector(".result-card:not(.result-checking)") || document.querySelector("#result");
      if (!card) return null;
      return card.innerText.replace(/\s+/g, " ").slice(0, 500);
    });
    console.log("ELAPSED_S:", ((Date.now() - t0) / 1000).toFixed(1));
    console.log("VERDICT:", JSON.stringify(verdict));
    const hist = await page.evaluate(() => (JSON.parse(localStorage.getItem("pesanaman_history_v1") || "[]")).map((h) => ({ score: h.score, verdict: h.verdict, kind: h.kind || h.type || "", when: h.time || h.ts || "" })));
    console.log("HISTORY_AFTER:", JSON.stringify(hist));
    console.log("BAD:", JSON.stringify(bad.slice(0, 10), null, 1));
    await page.screenshot({ path: "/tmp/v12-probe-otp.png" });
    console.log("SHOT: /tmp/v12-probe-otp.png");
  } finally { await browser.close().catch(() => {}); proxyProc.kill(); }
}
main().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
