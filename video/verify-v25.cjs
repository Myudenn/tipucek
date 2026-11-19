#!/usr/bin/env node
// PesanAman v2.5 live verification (desktop 1280x800 + mobile 390x844).
// Checks: full-body video roamer + card avatar playing (currentTime
// advances), idle->talking clip switch on an Aman answer, voice toggle,
// scam sample still scores, 0 JS errors. Screenshots to video/raw/.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18081", 10);
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
  return await page.evaluate(() => {
    const info = (id) => {
      const v = document.getElementById(id);
      if (!v) return { exists: false };
      const r = v.getBoundingClientRect();
      return {
        exists: true, hidden: v.hidden, src: v.currentSrc || v.src,
        currentTime: +v.currentTime.toFixed(2), paused: v.paused,
        readyState: v.readyState, videoWidth: v.videoWidth,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      };
    };
    const fb = (id) => {
      const el = document.getElementById(id);
      return el ? { hidden: el.hidden, src: el.currentSrc || el.src } : { exists: false };
    };
    const roam = document.getElementById("aman-roam");
    const rr = roam ? roam.getBoundingClientRect() : null;
    return {
      avatarVideo: info("aman-avatar-video"),
      roamVideo: info("aman-roam-video"),
      avatarFallback: fb("aman-avatar-fallback"),
      roamFallback: fb("aman-roam-fallback"),
      roamBtn: roam ? { hidden: roam.hidden, rect: rr ? { x: Math.round(rr.x), y: Math.round(rr.y), w: Math.round(rr.width), h: Math.round(rr.height) } : null } : null,
      voiceToggle: (document.getElementById("voice-toggle") || {}).textContent || null,
      voices: ("speechSynthesis" in window) ? window.speechSynthesis.getVoices().length : -1,
      speaking: ("speechSynthesis" in window) ? window.speechSynthesis.speaking : null,
      swCache: null,
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
    await page.goto("https://pesanaman-80d63.web.app/?v=25", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(12000);
    report.desktop.at12s = await amanState(page);
    await page.waitForTimeout(3000);
    report.desktop.at15s = await amanState(page);
    const shotD1 = path.join(OUT, `v25-desktop-${stamp()}.png`);
    await page.screenshot({ path: shotD1 });
    report.desktop.shot1 = shotD1;

    // Chat with Aman (voice OFF): answer arrives -> talkBriefly should
    // switch both videos to the talking clip for ~2.6s.
    await page.fill("#assistant-input", "halo, apa itu penipuan OTP?");
    await page.click("#assistant-send");
    let answered = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(1000);
      const n = await page.evaluate(() => document.querySelectorAll("#assistant-log .assistant-msg.aman").length);
      if (n > 0) { answered = true; break; }
    }
    report.desktop.chatAnswered = answered;
    await page.waitForTimeout(500);
    report.desktop.duringAnswer = await amanState(page);
    const shotD2 = path.join(OUT, `v25-desktop-talking-${stamp()}.png`);
    await page.screenshot({ path: shotD2 });
    report.desktop.shotTalking = shotD2;
    await page.waitForTimeout(4000);
    report.desktop.afterAnswer = await amanState(page);

    // Voice toggle ON: greeting utterance should switch to talking clip.
    await page.click("#voice-toggle");
    await page.waitForTimeout(3000);
    report.desktop.voiceOn = await amanState(page);
    await page.click("#voice-toggle"); // back off
    await page.waitForTimeout(1500);

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
    const shotD3 = path.join(OUT, `v25-desktop-verdict-${stamp()}.png`);
    await page.screenshot({ path: shotD3 });
    report.desktop.shotVerdict = shotD3;
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
    await page.goto("https://pesanaman-80d63.web.app/?v=25", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(12000);
    report.mobile.at12s = await amanState(page);
    await page.waitForTimeout(3000);
    report.mobile.at15s = await amanState(page);
    const shotM1 = path.join(OUT, `v25-mobile-${stamp()}.png`);
    await page.screenshot({ path: shotM1 });
    report.mobile.shot1 = shotM1;
    await page.waitForTimeout(8000);
    report.mobile.at23s = await amanState(page);
    const shotM2 = path.join(OUT, `v25-mobile2-${stamp()}.png`);
    await page.screenshot({ path: shotM2 });
    report.mobile.shot2 = shotM2;
    await ctx.close();
  } catch (e) {
    report.errors.push("MOBILE FAILED: " + e.message);
  }

  await browser.close();
  proxyProc.kill();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
