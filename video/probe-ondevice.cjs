#!/usr/bin/env node
// PesanAman on-device probe (Phase 1): can this Chromium prove the
// answer came from the device (badge class .badge-device)?
// Checks: (1) Prompt API presence (window.LanguageModel / window.ai /
// navigator.ml) in the VM's headless Chromium; (2) run the scam sample
// check twice (2nd run after a wait, so a background model download
// could finish) and record the badge (plain words now — "Answered on
// this device" vs "Answered in the cloud" — read via its CSS class),
// the elapsed time, and the console lines about the on-device path.
// Output: JSON report on stdout + 1 screenshot to video/raw/.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18083", 10);
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

async function runCheck(page) {
  const t0 = Date.now();
  await page.click("#samples button");
  await page.click("#check-btn");
  let badge = null;
  let scoreText = "";
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => {
      const el = document.getElementById("result");
      if (!el || el.hidden) return null;
      const dev = el.querySelector(".badge-device");
      const cloud = el.querySelector(".badge-cloud");
      const demo = el.querySelector(".badge-demo");
      const unk = el.querySelector(".badge-unknown");
      const b = dev || cloud || demo || unk;
      return b ? { badge: b.textContent.trim(), cls: b.className, full: el.textContent.slice(0, 300) } : null;
    });
    if (r) { badge = r; scoreText = r.full; break; }
  }
  return { ms: Date.now() - t0, badge, scoreText };
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

  const report = { errors: [], console: [] };
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => report.errors.push("PAGEERROR: " + String(e && e.message || e)));
    page.on("console", (m) => {
      const txt = m.text();
      report.console.push(`[${m.type()}] ${txt.slice(0, 300)}`);
    });
    page.on("requestfailed", (req) => report.errors.push(`REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
    await page.goto("https://pesanaman-80d63.web.app/?v=ondevice-probe", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(8000);

    report.env = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      languageModel: typeof window.LanguageModel,
      ai: typeof window.ai,
      aiLanguageModel: typeof (window.ai && window.ai.languageModel),
      navigatorMl: typeof navigator.ml,
      chrome: typeof window.chrome,
    }));
    report.env.languageModelAvailability = await page.evaluate(async () => {
      try {
        if (window.LanguageModel && typeof window.LanguageModel.availability === "function") {
          return await window.LanguageModel.availability();
        }
        return "no-availability-fn";
      } catch (e) { return "availability-threw: " + (e && e.message); }
    });

    report.check1 = await runCheck(page);
    // Wait for any background model download to progress, then check again.
    await page.waitForTimeout(30000);
    report.check2 = await runCheck(page);

    const shot = path.join(OUT, `ondevice-probe-${stamp()}.png`);
    await page.screenshot({ path: shot });
    report.shot = shot;
    await ctx.close();
  } catch (e) {
    report.errors.push("PROBE FAILED: " + e.message);
  }
  await browser.close();
  proxyProc.kill();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
