#!/usr/bin/env node
// YAXIS-REMOVE VERIFY (21 Nov 2026, Myuden: "Hilangkan saja yang di
// bulatin" — angka sumbu Y grafik 7 hari) — live proof against
// https://tipucek.web.app: seeds 10 scam checks today (like Myuden's
// screenshot: Sab = 10), then asserts the Y-axis numbers are gone
// while the bars still show their own counts on top.
// Run: node video/verify-scripts/yaxis-remove-verify.cjs
const path = require("path");
const { spawn } = require("child_process");
const { createRequire } = require("module");

const HOME = process.env.HOME || "";
const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(ROOT, "video", "panel-lainnya-shots");
const LIVE = "https://tipucek.web.app";
const PROXY_PORT = 18097;
const PROXY_SCRIPT = path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js");
const PLAYWRIGHT_PATH = path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright");
const requirePw = createRequire(path.join(PLAYWRIGHT_PATH, "index.js"));
const { chromium } = requirePw(PLAYWRIGHT_PATH);

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " — " + extra}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proxy = spawn(process.execPath, [PROXY_SCRIPT], {
    env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) },
    stdio: "ignore",
  });
  await sleep(1500);
  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", `--proxy-server=http://127.0.0.1:${PROXY_PORT}`],
    });
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "id-ID",
      colorScheme: "dark",
      ignoreHTTPSErrors: true,
      proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    });
    // Seed history: 10 scam checks today (Saturday, like Myuden's shot).
    await ctx.addInitScript(() => {
      const now = new Date().toISOString();
      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `seed-${i}`,
        createdAt: now,
        status: "scam",
        riskScore: 95,
        message: "pesan penipuan tes",
        source: "message",
      }));
      localStorage.setItem("pesanaman_history_v1", JSON.stringify(entries));
      localStorage.setItem("pesanaman_theme", "dark");
    });
    const page = await ctx.newPage();
    await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2500);
    const onboard = page.locator("#onboard-start");
    if (await onboard.isVisible().catch(() => false)) await onboard.click();
    await page.waitForTimeout(800);

    const bundle = await page.evaluate(() =>
      [...document.querySelectorAll("script[src]")].map((s) => s.src).join(" "),
    );
    check("live serves the new bundle", /index-BDdSt5rK\.js/.test(bundle), bundle.slice(0, 160));
    check("no #week-chart-yaxis element", (await page.locator("#week-chart-yaxis").count()) === 0);
    check("no .week-chart-yaxis-tick elements", (await page.locator(".week-chart-yaxis-tick").count()) === 0);
    check("7 bars render", (await page.locator(".week-bar").count()) === 7);
    const counts = await page.locator(".week-bar-count").allTextContents();
    check("Saturday bar shows 10 on top", counts[counts.length - 1] === "10", counts.join(","));
    check("other days show 0", counts.slice(0, 6).every((c) => c === "0"), counts.join(","));
    const chart = page.locator("#week-chart");
    await chart.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await chart.screenshot({ path: path.join(SHOTS, "yaxis-removed-390.png") });
    console.log("shot: video/panel-lainnya-shots/yaxis-removed-390.png");
  } finally {
    if (browser) await browser.close();
    proxy.kill("SIGKILL");
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
