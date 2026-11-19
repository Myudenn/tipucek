#!/usr/bin/env node
// Local verification of the un-deployed build (vite preview, :4173):
// (1) app loads, scam sample check works, badge recorded;
// (2) voice toggle -> cloud TTS attempt: read window.__pesanamanLastTts
//     (ok + bytes) or the failure reason; (3) Firestore write/read
//     request bodies contain ownerUid (proves the new code paths);
// (4) 0 page errors. Output: JSON on stdout.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18085", 10);

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

async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  try { await waitForPort("127.0.0.1", PROXY_PORT); }
  catch (e) { proxyProc.kill(); console.error("FAILED to start local proxy:", e.message); process.exit(2); }

  const report = { errors: [], console: [], firestoreRequests: [] };
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => report.errors.push("PAGEERROR: " + String(e && e.message || e)));
    page.on("console", (m) => {
      const txt = m.text();
      if (m.type() === "error" || /PesanAman|Cloud voice|On-device/i.test(txt)) {
        report.console.push(`[${m.type()}] ${txt.slice(0, 300)}`);
      }
    });
    page.on("requestfailed", (req) => report.errors.push(`REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
    // Capture Firestore request bodies (write + query) to prove ownerUid.
    page.on("request", (req) => {
      const url = req.url();
      if (/firestore\.googleapis\.com/.test(url) && req.method() === "POST") {
        const body = req.postData() || "";
        report.firestoreRequests.push({
          url: url.slice(0, 160),
          hasOwnerUid: body.includes("ownerUid"),
          bodySnippet: body.slice(0, 400),
        });
      }
    });

    await page.goto("http://localhost:4173/", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(6000);

    // (1) Scam sample check.
    const t0 = Date.now();
    await page.click("#samples button");
    await page.click("#check-btn");
    let badge = null;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);
      const r = await page.evaluate(() => {
        const el = document.getElementById("result");
        if (!el || el.hidden) return null;
        const b = el.querySelector(".badge-device, .badge-cloud, .badge-demo, .badge-unknown");
        return b ? { badge: b.textContent.trim(), cls: b.className } : null;
      });
      if (r) { badge = r; break; }
    }
    report.check = { ms: Date.now() - t0, badge };
    await page.waitForTimeout(3000); // let the history write finish

    // (2) Voice toggle -> cloud TTS.
    const vt0 = Date.now();
    await page.click("#voice-toggle");
    let tts = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000);
      tts = await page.evaluate(() => window.__pesanamanLastTts || null);
      if (tts) break;
    }
    report.voice = {
      ms: Date.now() - vt0,
      tts,
      toggleText: await page.evaluate(() => (document.getElementById("voice-toggle") || {}).textContent || null),
      noteText: await page.evaluate(() => (document.getElementById("assistant-note") || {}).textContent || null),
    };

    // (3) History UI shows the check (local + remote merge).
    report.historyUi = await page.evaluate(() => {
      const el = document.getElementById("history-list") || document.querySelector(".history");
      return el ? el.textContent.slice(0, 200) : "no-history-element";
    });
    await ctx.close();
  } catch (e) {
    report.errors.push("PROBE FAILED: " + e.message);
  }
  await browser.close();
  proxyProc.kill();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
