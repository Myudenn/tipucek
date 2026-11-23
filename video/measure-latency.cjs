#!/usr/bin/env node
/**
 * TipuCek latency measurement v2 — live site, after optimization.
 * Real result card = .result-card:not(.result-checking); the interim
 * code-check panel (.result-checking) does NOT count as a verdict.
 * Measures:
 *   1. first check (scam sample, EN) — includes one-time init
 *   2. second check, same message (EN) — expect cache hit (~instant)
 *   3. switch EN -> ID: t_labels (static strings in ID) + t_verdict
 *      (new-language AI verdict)
 *   4. switch ID -> EN: t_labels + t_verdict (expect cache hit)
 *   5. safe sample check (EN) + interim-panel probe @0.6s
 * Usage: node ~/workspace/pesanaman/video/measure-latency.cjs <label>
 * Writes: ~/workspace/pesanaman/video/raw/latency-<label>.json
 */
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const LABEL = process.argv[2] || "after";
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
const OUT = path.join(RAW_DIR, `latency-${LABEL}.json`);

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

const results = { label: LABEL, site: SITE, steps: {}, notes: [] };
function log(...a) { console.log(...a); }

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const localProxyPort = 18080;
  const proxyProc = spawn(process.execPath, [PROXY_SCRIPT], {
    env: { ...process.env, LOCAL_PROXY_PORT: String(localProxyPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proxyProc.stderr.on("data", (d) =>
    console.error("local-proxy:", String(d).trim()),
  );
  try {
    await waitForPort("127.0.0.1", localProxyPort);
  } catch (e) {
    proxyProc.kill();
    console.error("FAILED to start local proxy:", e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${localProxyPort}` },
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") log(`CONSOLE-ERROR ${msg.text()}`);
  });
  page.on("pageerror", (err) => log(`PAGEERROR ${err.message}`));

  // Real verdict card only — the interim code-check panel
  // (.result-checking) is not a verdict.
  const cardInfo = () =>
    page.evaluate(() => {
      const card = document.querySelector(".result-card:not(.result-checking)");
      if (!card) return null;
      return {
        status: card.querySelector(".result-status")?.textContent?.trim() || "",
        score: card.querySelector(".ring-value strong")?.textContent?.trim() || "",
        badge: card.querySelector(".result-badge")?.textContent?.trim() || "",
        elapsed: card.querySelector(".result-meta")?.textContent?.trim() || "",
        summary: card.querySelector(".result-summary")?.textContent?.trim() || "",
        hasLocalSignal: !!card.querySelector(".local-signal"),
      };
    });

  const panelState = () =>
    page.evaluate(() => ({
      checkingPanel: !!document.querySelector(".result-card.result-checking"),
      realCard: !!document.querySelector(".result-card:not(.result-checking)"),
      progressVisible:
        !!document.querySelector("#progress") &&
        !document.querySelector("#progress").hidden,
      progressText: document.querySelector("#progress")?.textContent?.trim() || "",
    }));

  const errorVisible = () =>
    page.evaluate(() => {
      const el = document.querySelector("#error");
      return !!el && !el.hidden && el.textContent.trim().length > 0;
    });

  // Wait until isFresh() is true, retrying through the app's own
  // "Try again" button when a check fails. Gentle by design: 15s
  // backoff between retries and a 5-attempt cap, so the measurement
  // itself never storms the Gemini free tier (15 req/min/project).
  // Returns wall seconds.
  async function waitFresh(t0, isFresh, label) {
    let attempts = 1;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      if (await errorVisible()) {
        if (attempts >= 5) {
          throw new Error(`${label}: still failing after ${attempts} attempts`);
        }
        log(`  ${label}: attempt ${attempts} failed (error shown), retrying in 15s`);
        attempts++;
        await page.click("#error .retry-btn", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(15000);
        continue;
      }
      if (await isFresh()) {
        return { seconds: +((Date.now() - t0) / 1000).toFixed(1), attempts };
      }
      await page.waitForTimeout(250);
    }
    throw new Error(`${label}: no fresh result within 240s`);
  }

  // Wait until the check button is enabled again and progress is
  // hidden (a check — cached or fresh — has finished).
  async function waitButtonDone(t0, label) {
    let attempts = 1;
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      if (await errorVisible()) {
        if (attempts >= 5) {
          throw new Error(`${label}: still failing after ${attempts} attempts`);
        }
        log(`  ${label}: attempt ${attempts} failed (error shown), retrying in 15s`);
        attempts++;
        await page.click("#error .retry-btn", { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(15000);
        continue;
      }
      const done = await page.evaluate(() => {
        const btn = document.querySelector("#check-btn");
        const p = document.querySelector("#progress");
        return btn && !btn.disabled && (!p || p.hidden);
      });
      if (done) {
        return { seconds: +((Date.now() - t0) / 1000).toFixed(1), attempts };
      }
      await page.waitForTimeout(100);
    }
    throw new Error(`${label}: button never re-enabled within 240s`);
  }

  function savePartial() {
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  }

  try {
    await page.goto(SITE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("#check-btn", { timeout: 30000 });
    await page.waitForTimeout(1000);

    const lm = await page
      .evaluate(async () => {
        const LM = window.LanguageModel;
        if (!LM) return { hasLM: false };
        try {
          const a = await Promise.race([
            LM.availability(),
            new Promise((r) => setTimeout(() => r("probe-timeout"), 5000)),
          ]);
          return { hasLM: true, availability: String(a) };
        } catch (e) {
          return { hasLM: true, availability: "error:" + (e?.message || e) };
        }
      })
      .catch((e) => ({ probeError: e.message }));
    results.steps.onDeviceProbe = lm;
    log("on-device probe:", JSON.stringify(lm));

    // --- Step 1: first check (scam sample, EN) ---
    await page.click("text=Scam example", { timeout: 15000 });
    await page.waitForTimeout(800);
    let t0 = Date.now();
    await page.click("#check-btn", { timeout: 15000 });
    await page.waitForTimeout(600);
    const interim1 = await panelState();
    results.steps.interimProbeDuringFirstCheck = interim1;
    log(`  interim probe @0.6s (first check): ${JSON.stringify(interim1)}`);
    const s1 = await waitFresh(t0, async () => (await cardInfo()) !== null, "first-check");
    const c1 = await cardInfo();
    results.steps.firstCheckScamEN = { ...s1, ...c1 };
    savePartial();
    log(`1 first-check scam EN: ${s1.seconds}s attempts=${s1.attempts} score=${c1.score} status=${c1.status} badge=${c1.badge} appElapsed=${c1.elapsed}`);

    // --- Step 2: second check, same message (EN) — expect cache hit ---
    t0 = Date.now();
    await page.click("#check-btn", { timeout: 15000 });
    const s2 = await waitButtonDone(t0, "second-check");
    const c2 = await cardInfo();
    results.steps.secondCheckSameEN = { ...s2, ...c2 };
    savePartial();
    log(`2 second-check same EN: ${s2.seconds}s attempts=${s2.attempts} score=${c2.score} appElapsed=${c2.elapsed}`);

    // --- Step 3: switch EN -> ID (labels instant, verdict re-checked) ---
    const summaryEN = c2.summary;
    await page.waitForTimeout(20000);
    t0 = Date.now();
    await page.selectOption("#lang-select", "id");
    const s3labels = await waitFresh(
      t0,
      async () => {
        const c = await cardInfo();
        return c !== null && c.status === "Penipuan";
      },
      "switch-EN-ID-labels",
    );
    results.steps.switchENtoID = { labelsSeconds: s3labels.seconds };
    savePartial();
    log(`3a switch EN->ID labels: ${s3labels.seconds}s`);
    const s3verdict = await waitFresh(
      t0,
      async () => {
        const c = await cardInfo();
        const p = await panelState();
        return c !== null && c.summary !== summaryEN && !p.progressVisible;
      },
      "switch-EN-ID-verdict",
    );
    const c3 = await cardInfo();
    results.steps.switchENtoID = {
      labelsSeconds: s3labels.seconds,
      verdictSeconds: s3verdict.seconds,
      attempts: s3verdict.attempts,
      ...c3,
    };
    savePartial();
    log(`3 switch EN->ID: labels ${s3labels.seconds}s, full verdict ${s3verdict.seconds}s attempts=${s3verdict.attempts} status=${c3.status} appElapsed=${c3.elapsed}`);

    // --- Step 4: switch ID -> EN (expect cache hit for EN) ---
    const summaryID = c3.summary;
    t0 = Date.now();
    await page.selectOption("#lang-select", "en");
    const s4labels = await waitFresh(
      t0,
      async () => {
        const c = await cardInfo();
        return c !== null && c.status === "Scam";
      },
      "switch-ID-EN-labels",
    );
    results.steps.switchIDtoEN = { labelsSeconds: s4labels.seconds };
    savePartial();
    log(`4a switch ID->EN labels: ${s4labels.seconds}s`);
    const s4verdict = await waitFresh(
      t0,
      async () => {
        const c = await cardInfo();
        const p = await panelState();
        return c !== null && c.summary !== summaryID && !p.progressVisible;
      },
      "switch-ID-EN-verdict",
    );
    const c4 = await cardInfo();
    results.steps.switchIDtoEN = {
      labelsSeconds: s4labels.seconds,
      verdictSeconds: s4verdict.seconds,
      attempts: s4verdict.attempts,
      ...c4,
    };
    savePartial();
    log(`4 switch ID->EN: labels ${s4labels.seconds}s, full verdict ${s4verdict.seconds}s attempts=${s4verdict.attempts} status=${c4.status} appElapsed=${c4.elapsed}`);

    // --- Step 5: safe sample check (EN) + interim probe ---
    await page.click("text=Safe example", { timeout: 15000 });
    await page.waitForTimeout(800);
    await page.waitForTimeout(20000);
    t0 = Date.now();
    await page.click("#check-btn", { timeout: 15000 });
    await page.waitForTimeout(600);
    const interim5 = await panelState();
    results.steps.interimProbeDuringSafeCheck = interim5;
    savePartial();
    log(`  interim probe @0.6s (safe check): ${JSON.stringify(interim5)}`);
    const s5 = await waitFresh(
      t0,
      async () => {
        const c = await cardInfo();
        return c !== null && c.status === "Safe";
      },
      "safe-check",
    );
    const c5 = await cardInfo();
    results.steps.safeCheckEN = { ...s5, ...c5 };
    savePartial();
    log(`5 safe-check EN: ${s5.seconds}s attempts=${s5.attempts} score=${c5.score} appElapsed=${c5.elapsed}`);

    log("DONE");
  } catch (e) {
    results.error = e.message;
    log("FAILED:", e.message);
  } finally {
    fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
    log(`wrote ${OUT}`);
    await browser.close().catch(() => {});
    proxyProc.kill();
  }
  if (results.error) process.exit(1);
}

main();
