#!/usr/bin/env node
// Avatar verification: robot-simple avatar (public/aman.png) renders in
// the Ask Aman panel on desktop 1280 + mobile 390, light + dark schemes.
// Checks the served file is the robot (sha256 prefix), the <img> loads,
// and screenshots the 88px avatar at real size for legibility.
// Usage: node video/verify-avatar.cjs
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18085", 10);
const PREVIEW_PORT = 4173;
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });
const ROBOT_SHA_PREFIX = "1e575bc271e30f38"; // sha256 of public/aman.png (shield+star robot)
const ANIME_SHA_PREFIX = "3bcfc9f0ab4e80e3"; // sha256 of public/aman-anime.png

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
  throw new Error(`port ${host}:${port} did not open in ${timeoutMs}ms`);
}

async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  const previewProc = spawn(process.execPath, [
    path.join(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort",
  ], { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  try { await waitForPort("127.0.0.1", PROXY_PORT); await waitForPort("127.0.0.1", PREVIEW_PORT); }
  catch (e) { proxyProc.kill(); previewProc.kill(); console.error("FAILED to start servers:", e.message); process.exit(2); }
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });
  let pass = 0, fail = 0;
  const check = (name, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 160) : ""}`);
    ok ? pass++ : fail++;
  };
  try {
    for (const [label, width, height, scheme] of [
      ["desktop-light", 1280, 800, "light"],
      ["desktop-dark", 1280, 800, "dark"],
      ["mobile-light", 390, 844, "light"],
      ["mobile-dark", 390, 844, "dark"],
    ]) {
      const ctx = await browser.newContext({
        viewport: { width, height }, ignoreHTTPSErrors: true,
        colorScheme: scheme,
      });
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${PREVIEW_PORT}/`, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(2500);
      const served = await page.evaluate(async () => {
        const buf = await (await fetch("/aman.png")).arrayBuffer();
        const hash = await crypto.subtle.digest("SHA-256", buf);
        const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
        const img = document.querySelector("#aman-avatar img");
        return { hex: hex.slice(0, 16), imgOk: !!img && img.complete && img.naturalWidth > 0, src: img ? img.getAttribute("src") : null };
      });
      check(`${label}: served /aman.png is the robot file`, served.hex === ROBOT_SHA_PREFIX, `sha=${served.hex}`);
      check(`${label}: served /aman.png is NOT the anime backup`, served.hex !== ANIME_SHA_PREFIX);
      check(`${label}: #aman-avatar img loads`, served.imgOk, `src=${served.src}`);
      await page.locator(".assistant").scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(RAW, `avatar-${label}.png`) });
      // Real-size legibility: clip-screenshot of the 88px avatar at 3x.
      // (Element screenshot is unusable: the float animation never stabilises.)
      const box = await page.locator("#aman-avatar").boundingBox();
      if (box) {
        await page.screenshot({
          path: path.join(RAW, `avatar-${label}-88px.png`),
          clip: { x: box.x - 6, y: box.y - 6, width: box.width + 12, height: box.height + 12 },
          scale: "css",
        });
      }
      check(`${label}: avatar bounding box found for legibility shot`, !!box);
      await ctx.close();
    }
    console.log(`\nAVATAR: passed ${pass}/${pass + fail}`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    await browser.close();
    proxyProc.kill();
    previewProc.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
