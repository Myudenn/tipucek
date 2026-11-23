#!/usr/bin/env node
// Capture fresh stills for TipuCek demo v6-v6 from the LIVE app.
// - hero: top of https://tipucek.web.app/?lang=en (OJK source link check)
// - s5b: screenshot-check verdict card + privacy receipt (dup-line check)
// No video recording here (stills only), so plain Playwright clicks are
// used — the 60fps smooth-cursor rules apply to video takes, not stills.
// DEBUG_TOKEN (env): if set, injected via addInitScript as
// self.FIREBASE_APPCHECK_DEBUG_TOKEN before any page script runs.
// The token value is NEVER printed or written to disk by this script.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman/video");
const RAW = path.join(ROOT, "raw");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18102", 10);
const PLAYWRIGHT = require(path.join(
  HOME,
  "workspace/tools/rekam-layar/node_modules/playwright",
));
const TOKEN = process.env.DEBUG_TOKEN || "";
const SHOT = process.argv.includes("--s5b") ? "s5b" : "hero";
const APP_URL = "https://tipucek.web.app/?lang=en";
const SAMPLE = path.join(HOME, "workspace/pesanaman/test-samples/screenshot-penipu.png");

function waitForPort(host, port, timeoutMs = 20000) {
  const start = Date.now();
  const attempt = () =>
    new Promise((resolve, reject) => {
      const s = net.connect(port, host);
      s.once("connect", () => {
        s.end();
        resolve();
      });
      s.once("error", reject);
    });
  return (async () => {
    while (Date.now() - start < timeoutMs) {
      try {
        await attempt();
        return;
      } catch (_) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    throw new Error("proxy port did not open");
  })();
}

async function main() {
  const proxyProc = spawn(
    process.execPath,
    [
      path.join(
        HOME,
        "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js",
      ),
    ],
    {
      env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  proxyProc.stderr.on("data", (d) => console.error("proxy:", String(d).trim()));
  try {
    await waitForPort("127.0.0.1", PROXY_PORT);
  } catch (e) {
    proxyProc.kill();
    console.error("proxy failed to start");
    process.exit(2);
  }

  const browser = await PLAYWRIGHT.chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
  });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      ignoreHTTPSErrors: true,
    });
    if (TOKEN) {
      await ctx.addInitScript(
        (t) => {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = t;
        },
        TOKEN,
      );
      console.log("debug token injected (value not shown)");
    } else {
      console.log("no debug token — running without App Check debug");
    }
    const page = await ctx.newPage();
    page.on("console", (m) => {
      const t = m.text();
      if (/App Check|appcheck|401|403/i.test(t)) console.log("CONSOLE:", t.slice(0, 200));
    });
    page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 200)));

    await page.goto(APP_URL, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2000);
    await page.evaluate(() => document.fonts.ready).catch(() => {});
    await page.waitForTimeout(800);

    // --- HERO ---
    const ojk = await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find((x) =>
        x.href.includes("iasc.ojk.go.id"),
      );
      return a ? a.textContent.trim() : null;
    });
    console.log("HERO_OJK_LINK:", ojk === null ? "NOT FOUND" : JSON.stringify(ojk));
    const heroPath = path.join(RAW, "v6-hero-v6.png");
    await page.screenshot({ path: heroPath });
    console.log("HERO_SAVED:", heroPath, fs.statSync(heroPath).size, "bytes");

    if (SHOT === "s5b") {
      // --- SCREENSHOT CHECK (s5b) ---
      await page.evaluate(() => {
        const el = [...document.querySelectorAll("*")].find((x) =>
          x.children.length === 0 && /Or check a screenshot/i.test(x.textContent || ""),
        );
        if (el) el.scrollIntoView({ block: "center" });
      });
      await page.waitForTimeout(800);
      await page.setInputFiles("#image-input", SAMPLE);
      await page.waitForTimeout(800);
      await page.click("#image-btn");
      console.log("clicked #image-btn, waiting for toast (up to 120s)...");
      await page.waitForSelector("#toast:not([hidden])", { timeout: 120000 });
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const r = document.querySelector("#result");
        if (r) r.scrollIntoView({ block: "start" });
      });
      await page.waitForTimeout(800);
      const resultText = await page.evaluate(() => {
        const r = document.querySelector("#result");
        return r ? r.innerText : "";
      });
      const dupCount = (resultText.match(/Community counts and link tracing/g) || []).length;
      const score = (resultText.match(/(\d+)\s*\/\s*100/) || [])[1] || "?";
      const cloud = /Answered in the cloud/i.test(resultText);
      const onDevice = /Answered on-device/i.test(resultText);
      console.log("RESULT_SCORE:", score, "| CLOUD_BADGE:", cloud, "| ONDEVICE_BADGE:", onDevice);
      console.log("RESULT_DUP_LINE_COUNT:", dupCount);
      console.log("RESULT_TEXT_HEAD:", JSON.stringify(resultText.slice(0, 400)));
      const shotPath = path.join(RAW, "v6-verdict-screenshot-v6.png");
      await page.screenshot({ path: shotPath });
      console.log("S5B_SAVED:", shotPath, fs.statSync(shotPath).size, "bytes");
    }
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
    proxyProc.kill();
  }
}
main().catch((e) => {
  console.error("FATAL:", e.message);
  process.exit(2);
});
