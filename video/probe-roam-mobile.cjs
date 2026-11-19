#!/usr/bin/env node
// Probe: is #aman-roam visible on a mobile viewport on the LIVE site?
// Reuses the local-proxy pattern from rekam-layar-browser/scripts/record.js
// (Chromium cannot tunnel through the VM egress proxy directly).
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

async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  try { await waitForPort("127.0.0.1", PROXY_PORT); }
  catch (e) { proxyProc.kill(); console.error("FAILED to start local proxy:", e.message); process.exit(2); }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e && e.message || e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE-ERROR: " + m.text()); });
  page.on("requestfailed", (req) => errors.push(`REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));

  await page.goto("https://pesanaman-80d63.web.app/?v=24", { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(12000);
  const info = await page.evaluate(() => {
    const el = document.getElementById("aman-roam");
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      exists: true,
      hiddenAttr: el.hidden,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      inViewport: r.x >= 0 && r.y >= 0 && r.x + r.width <= window.innerWidth && r.y + r.height <= window.innerHeight,
      innerW: window.innerWidth, innerH: window.innerHeight,
      voiceToggle: (document.getElementById("voice-toggle") || {}).textContent || null,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      hasSpeechSynthesis: "speechSynthesis" in window,
    };
  });
  const shot = path.join(OUT, `roam-mobile-${stamp()}.png`);
  await page.screenshot({ path: shot });
  // Second shot after 8 more seconds to see if he moved.
  await page.waitForTimeout(8000);
  const info2 = await page.evaluate(() => {
    const el = document.getElementById("aman-roam");
    if (!el) return { exists: false };
    const r = el.getBoundingClientRect();
    return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  });
  const shot2 = path.join(OUT, `roam-mobile2-${stamp()}.png`);
  await page.screenshot({ path: shot2 });
  await context.close();
  await browser.close();
  proxyProc.kill();
  console.log(JSON.stringify({ at12s: info, at20s: info2, errors, shots: [shot, shot2] }, null, 2));
}

main().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
