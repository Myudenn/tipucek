#!/usr/bin/env node
// Decisive on-device experiment: can this headless Chrome 159 actually
// download Gemini Nano and answer a prompt via the raw Prompt API?
// Steps in the page: LanguageModel.availability() (plain + with
// expectedInputs), then LanguageModel.create({ monitor }) with a
// download-progress log, then session.prompt("Say hello in one short
// sentence."). Times out after 180s. Output: JSON on stdout.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18084", 10);

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
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  try { await waitForPort("127.0.0.1", PROXY_PORT); }
  catch (e) { proxyProc.kill(); console.error("FAILED to start local proxy:", e.message); process.exit(2); }

  const report = { errors: [] };
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}` },
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => report.errors.push("PAGEERROR: " + String(e && e.message || e)));
    await page.goto("https://pesanaman-80d63.web.app/?v=ondevice-direct", { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(3000);

    // Expose a progress sink the page can push download events into.
    await page.exposeFunction("pushProgress", (ev) => {
      (report.downloadEvents = report.downloadEvents || []).push({ t: Date.now(), ...ev });
    });

    report.experiment = await page.evaluate(async () => {
      const out = {};
      out.availabilityPlain = await window.LanguageModel.availability();
      try {
        out.availabilityWithInputs = await window.LanguageModel.availability({
          expectedInputs: [{ type: "text", languages: ["en", "id"] }],
          expectedOutputs: [{ type: "text", languages: ["en", "id"] }],
        });
      } catch (e) { out.availabilityWithInputs = "threw: " + (e && e.message); }

      // Try to create a session (this triggers the model download).
      const t0 = Date.now();
      try {
        const session = await window.LanguageModel.create({
          monitor(m) {
            m.addEventListener("downloadprogress", (e) => {
              window.pushProgress({ kind: "downloadprogress", loaded: e.loaded, total: e.total });
            });
          },
        });
        out.createMs = Date.now() - t0;
        out.created = true;
        const p0 = Date.now();
        const answer = await session.prompt("Say hello in one short sentence.");
        out.promptMs = Date.now() - p0;
        out.promptAnswer = String(answer).slice(0, 200);
        // Also try a JSON-constrained prompt like the SDK uses.
        try {
          const session2 = await window.LanguageModel.create({
            responseConstraint: {
              type: "object",
              properties: {
                status: { type: "string", enum: ["safe", "suspicious", "scam"] },
                riskScore: { type: "integer" },
              },
              required: ["status", "riskScore"],
            },
          });
          const a2 = await session2.prompt("Classify this message: 'You won a prize, click bit.ly/x and pay a fee.' Return JSON.");
          out.constrainedAnswer = String(a2).slice(0, 300);
        } catch (e2) {
          out.constrainedError = (e2 && e2.name ? e2.name + ": " : "") + (e2 && e2.message);
        }
        session.destroy();
      } catch (e) {
        out.createMs = Date.now() - t0;
        out.created = false;
        out.createError = (e && e.name ? e.name + ": " : "") + (e && e.message);
      }
      return out;
    });
    await ctx.close();
  } catch (e) {
    report.errors.push("PROBE FAILED: " + e.message);
  }
  await browser.close();
  proxyProc.kill();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => { console.error("PROBE FAILED:", e.message); process.exit(1); });
