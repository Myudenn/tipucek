#!/usr/bin/env node
// PesanAman revert verification (desktop 1280x800 + mobile 390x844).
// Checks: (1) NO <video> avatar anywhere, avatar + roamer are <img>
// anime /aman.png, roamer 64px desktop / 48px mobile and moves;
// (2) ask Aman -> answer arrives; (3) scam sample still
// scores; (4) old video files 404 + SW cache is pesanaman-v4.
// (Voice output was removed 19 Nov — Myuden: it never sounded on the
// user's phone — so the old voice-output checks are
// gone. The Aman chat check above only asserts an answer arrives.)
// Screenshots: 1 per viewport, to video/raw/.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18082", 10);
const OUT = path.join(HOME, "workspace/pesanaman/video/raw");
fs.mkdirSync(OUT, { recursive: true });

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
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function amanState(page) {
  return await page.evaluate(async () => {
    const imgInfo = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { exists: false };
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        exists: true, src: el.currentSrc || el.src,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        borderRadius: cs.borderRadius,
      };
    };
    const roam = document.getElementById("aman-roam");
    const rr = roam ? roam.getBoundingClientRect() : null;
    let cacheNames = [];
    try { cacheNames = await caches.keys(); } catch (_) {}
    const idle404 = await fetch("/aman-idle.mp4").then((r) => r.status).catch(() => "fetch-error");
    const talking404 = await fetch("/aman-talking.mp4").then((r) => r.status).catch(() => "fetch-error");
    const fullbody404 = await fetch("/aman-fullbody.jpg").then((r) => r.status).catch(() => "fetch-error");
    return {
      videos: document.querySelectorAll("video").length,
      avatarImg: imgInfo("#aman-avatar img"),
      avatarBox: (() => { const el = document.getElementById("aman-avatar"); if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { w: Math.round(r.width), h: Math.round(r.height), borderRadius: cs.borderRadius }; })(),
      roamImg: imgInfo("#aman-roam img"),
      roamBtn: roam ? { hidden: roam.hidden, rect: rr ? { x: Math.round(rr.x), y: Math.round(rr.y), w: Math.round(rr.width), h: Math.round(rr.height) } : null } : null,
      swCaches: cacheNames,
      gone: { idle: idle404, talking: talking404, fullbody: fullbody404 },
    };
  });
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

  const report = { errors: [], desktop: {}, mobile: {} };
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
  });

  // ---------- DESKTOP ----------
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => report.errors.push("DESKTOP PAGEERROR: " + String(e && e.message || e)));
    page.on("console", (m) => { if (m.type() === "error") report.errors.push("DESKTOP CONSOLE-ERROR: " + m.text()); });
    page.on("requestfailed", (req) => report.errors.push(`DESKTOP REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
    await page.goto("https://pesanaman-80d63.web.app/?v=revert", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(12000);
    report.desktop.at12s = await amanState(page);
    await page.waitForTimeout(8000);
    report.desktop.at20s = await amanState(page);

    // Chat with Aman (answer arrives).
    await page.fill("#assistant-input", "halo, apa itu penipuan OTP?");
    await page.click("#assistant-send");
    let answered = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const n = await page.evaluate(() => document.querySelectorAll("#assistant-log .assistant-msg.aman").length);
      if (n > 0) { answered = true; break; }
    }
    report.desktop.chatAnswered = answered;

    // Scam sample check still scores.
    await page.fill("#message-input", "Selamat! Nomor Anda terpilih memenangkan Rp 50.000.000 dari undian berhadiah. Segera klaim dengan klik bit.ly/hadiah123 dan kirim kode OTP Anda sekarang juga.");
    await page.click("#check-btn");
    let scored = false;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000);
      const txt = await page.evaluate(() => (document.getElementById("result") || {}).textContent || "");
      if (/\/ ?100|Penipuan|Scam/i.test(txt)) { scored = txt.slice(0, 200); break; }
    }
    report.desktop.scamCheck = scored || false;
    const shotD = path.join(OUT, `revert-desktop-${stamp()}.png`);
    await page.screenshot({ path: shotD });
    report.desktop.shot = shotD;
    await ctx.close();
  } catch (e) {
    report.errors.push("DESKTOP FAILED: " + e.message);
  }

  // ---------- MOBILE ----------
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
      deviceScaleFactor: 2, ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => report.errors.push("MOBILE PAGEERROR: " + String(e && e.message || e)));
    page.on("console", (m) => { if (m.type() === "error") report.errors.push("MOBILE CONSOLE-ERROR: " + m.text()); });
    page.on("requestfailed", (req) => report.errors.push(`MOBILE REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
    await page.goto("https://pesanaman-80d63.web.app/?v=revert", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(12000);
    report.mobile.at12s = await amanState(page);
    await page.waitForTimeout(8000);
    report.mobile.at20s = await amanState(page);
    const shotM = path.join(OUT, `revert-mobile-${stamp()}.png`);
    await page.screenshot({ path: shotM });
    report.mobile.shot = shotM;
    await ctx.close();
  } catch (e) {
    report.errors.push("MOBILE FAILED: " + e.message);
  }

  await browser.close();
  proxyProc.kill();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
