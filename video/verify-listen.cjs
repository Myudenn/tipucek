#!/usr/bin/env node
// Focused re-check: the Listen button on a REAL Aman answer (not the
// typing indicator). Desktop only. Prints the answer text, whether
// the Listen button exists, and the note after clicking it.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18083", 10);

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
  try { await waitForPort("127.0.0.1", PROXY_PORT); }
  catch (e) { proxyProc.kill(); console.error("FAILED to start local proxy:", e.message); process.exit(2); }

  const errors = [];
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + String(e && e.message || e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE-ERROR: " + m.text()); });
    await page.goto("https://pesanaman-80d63.web.app/?v=revert2", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(6000);
    await page.fill("#assistant-input", "halo, apa itu penipuan OTP?");
    await page.click("#assistant-send");
    // Wait for a REAL answer bubble (typing indicator excluded).
    let answer = null;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000);
      answer = await page.evaluate(() => {
        const els = [...document.querySelectorAll("#assistant-log .assistant-msg.aman:not(.typing)")];
        if (!els.length) return null;
        const last = els[els.length - 1];
        return {
          text: last.textContent.slice(0, 160),
          hasListen: !!last.querySelector(".assistant-speak-btn"),
          listenText: (last.querySelector(".assistant-speak-btn") || {}).textContent || null,
        };
      });
      if (answer) break;
    }
    console.log("ANSWER:", JSON.stringify(answer, null, 2));
    if (answer && answer.hasListen) {
      await page.click("#assistant-log .assistant-msg.aman:not(.typing) .assistant-speak-btn");
      await page.waitForTimeout(4000);
      const after = await page.evaluate(() => ({
        note: (document.getElementById("assistant-note") || {}).textContent,
        toggle: (document.getElementById("voice-toggle") || {}).textContent,
        speaking: window.speechSynthesis ? window.speechSynthesis.speaking : null,
      }));
      console.log("AFTER LISTEN CLICK:", JSON.stringify(after, null, 2));
    }
    await ctx.close();
  } catch (e) {
    errors.push("FAILED: " + e.message);
  }
  await browser.close();
  proxyProc.kill();
  console.log("ERRORS:", JSON.stringify(errors, null, 2));
}

main().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
