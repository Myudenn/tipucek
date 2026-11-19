#!/usr/bin/env node
// Design verification: vAPI-inspired clean boxes (thin border, big numbers,
// blue #1a56db accent) on desktop 1280 + mobile 390, light + dark.
// Runs a scam sample check, then screenshots the result card + How section.
// Usage: node video/verify-design.cjs
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
    for (const [label, width, height, scheme, isTouch] of [
      ["desktop-light", 1280, 800, "light", false],
      ["desktop-dark", 1280, 800, "dark", false],
      ["mobile-light", 390, 844, "light", true],
      ["mobile-dark", 390, 844, "dark", true],
    ]) {
      const ctx = await browser.newContext({
        viewport: { width, height }, ignoreHTTPSErrors: true,
        colorScheme: scheme, hasTouch: isTouch, isMobile: isTouch,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      await page.goto(`http://localhost:${PREVIEW_PORT}/`, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      check(`${label}: no horizontal overflow`, overflow <= 0, `overflow=${overflow}px`);
      const how = await page.evaluate(() => ({
        heading: !!document.querySelector("#how-heading"),
        headingIds: document.querySelectorAll("#how-heading").length,
        steps: document.querySelectorAll(".how-card").length,
        nums: [...document.querySelectorAll(".how-num")].map((n) => n.textContent.trim()).join(","),
      }));
      check(`${label}: How section + 3 step cards, single heading id`, how.heading && how.steps === 3 && how.headingIds === 1, `steps=${how.steps} nums=${how.nums} ids=${how.headingIds}`);
      // Run a scam sample check to render the result card with the big score.
      await page.click("#tab-btn-message");
      await page.click("#samples button");
      await page.click("#check-btn");
      await page.waitForSelector("#result .result-card", { timeout: 60000 });
      await page.waitForTimeout(800);
      const sizes = await page.evaluate(() => {
        const strong = document.querySelector(".ring-value strong");
        const status = document.querySelector(".result-status");
        const num = document.querySelector(".how-num");
        const cs = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
        return {
          ringStrong: cs(strong, "fontSize"),
          resultStatus: cs(status, "fontSize"),
          howNum: cs(num, "fontSize"),
          howNumColor: cs(num, "color"),
        };
      });
      check(`${label}: score ring number is big (2.1rem)`, sizes.ringStrong === "33.6px", sizes.ringStrong);
      check(`${label}: result status is big (2.4rem)`, sizes.resultStatus === "38.4px", sizes.resultStatus);
      check(`${label}: How step number is big (1.9rem)`, sizes.howNum === "30.4px", sizes.howNum);
      check(`${label}: How number uses blue accent (not orange)`, sizes.howNumColor === "rgb(26, 86, 219)" || sizes.howNumColor === "rgb(107, 155, 255)", sizes.howNumColor);
      check(`${label}: 0 page errors`, errors.length === 0, errors.join(" | "));
      await page.locator("#result").scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(RAW, `design-${label}-result.png`) });
      await page.locator(".how").scrollIntoViewIfNeeded();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(RAW, `design-${label}-how.png`) });
      await ctx.close();
    }
    console.log(`\nDESIGN: passed ${pass}/${pass + fail}`);
    process.exitCode = fail ? 1 : 0;
  } finally {
    await browser.close();
    proxyProc.kill();
    previewProc.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
