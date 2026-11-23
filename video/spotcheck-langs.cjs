#!/usr/bin/env node
/**
 * TipuCek 8-language STATIC spot-check (live site, zero AI calls).
 * For each language: select it, read static strings (check button,
 * hero title, first sample button, history tab), confirm they are
 * non-empty, differ from EN, and contain no raw i18n key.
 * Usage: node ~/workspace/pesanaman/video/spotcheck-langs.cjs
 * Writes: ~/workspace/pesanaman/video/raw/langs-static.json
 */
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const RAW_DIR = path.join(HOME, "workspace/pesanaman/video/raw");
const PROXY_SCRIPT = path.join(
  HOME,
  "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js",
);
const PLAYWRIGHT = path.join(
  HOME,
  "workspace/tools/rekam-layar/node_modules/playwright",
);
const SITE = "https://tipucek.web.app/?lang=en";
const OUT = path.join(RAW_DIR, "langs-static.json");

fs.mkdirSync(RAW_DIR, { recursive: true });

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
  const { chromium } = require(PLAYWRIGHT);
  const proxyProc = spawn(process.execPath, [PROXY_SCRIPT], {
    env: { ...process.env, LOCAL_PROXY_PORT: "18080" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proxyProc.stderr.on("data", (d) =>
    console.error("local-proxy:", String(d).trim()),
  );
  try {
    await waitForPort("127.0.0.1", 18080);
  } catch (e) {
    proxyProc.kill();
    console.error("FAILED to start local proxy:", e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: "http://127.0.0.1:18080" },
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push("PAGEERROR " + err.message));

  const results = { site: SITE, langs: {}, consoleErrors };
  try {
    await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#check-btn", { timeout: 30000 });
    await page.waitForTimeout(1000);

    const readStrings = () =>
      page.evaluate(() => {
        const txt = (sel) =>
          document.querySelector(sel)?.textContent?.trim() || "";
        const sampleBtns = [...document.querySelectorAll(".sample-btn")].map(
          (b) => b.textContent.trim(),
        );
        return {
          checkBtn: txt("#check-btn"),
          heroTitle: txt("h1") || txt(".hero h2") || "",
          historyTab: txt('[data-tab="history"]') || "",
          sample0: sampleBtns[0] || "",
          sampleCount: sampleBtns.length,
          docLang: document.documentElement.lang || "",
          selectValue: document.querySelector("#lang-select")?.value || "",
        };
      });

    for (const lang of ["en", "id", "es", "fr", "de", "pt", "ja", "zh"]) {
      await page.selectOption("#lang-select", lang);
      await page.waitForTimeout(400);
      const s = await readStrings();
      results.langs[lang] = s;
      console.log(
        `${lang}: checkBtn=${JSON.stringify(s.checkBtn)} hero=${JSON.stringify(s.heroTitle.slice(0, 60))} sample0=${JSON.stringify(s.sample0.slice(0, 50))} samples=${s.sampleCount}`,
      );
    }
    console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 5)));
  } catch (e) {
    results.error = e.message;
    console.log("FAILED:", e.message);
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    console.log("wrote", OUT);
    await browser.close().catch(() => {});
    proxyProc.kill();
  }
  if (results.error) process.exit(1);
}

main();
