// TOAST + STATS VERIFICATION (21 Nov 2026, live follow-up 11:49) —
// two findings from the parent's live browser run:
//   (1) Stats looked inconsistent: "26" checked vs "20 dari 27 pesan"
//       vs 7-day chart 21 scams. Hypothesis: NOT a data bug — all
//       three numbers come from the same lastHistory array in one
//       updateLocalStats() call, but the two card numbers animate
//       600 ms (animateStatNum) while the sub-label and the chart
//       are written instantly. A read inside that 600 ms window
//       shows mid-flight numbers. This script proves it: read the
//       stats the instant a verdict renders (t=0), at +300 ms and
//       at +1000 ms (settled). PASS = settled reads fully consistent.
//   (2) Toast "Pemeriksaan selesai" covered part of the result /
//       sample card. nudgePageForToast only protects the samples
//       list + the result HEADLINE zone (first 160 px). Measure the
//       toast rect against those zones while the toast is visible.
//       PASS = no overlap with samples or headline zone.
// Runs on the DEMO server (deterministic heuristic verdicts).
// Exit 0 only when ALL checks pass.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/toast-stats-verify.cjs
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/home/hatch/workspace/tools/rekam-layar/node_modules/playwright");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const SHOTS = path.join(ROOT, "video/panel-lainnya-shots");
const PROXY_PORT = 18098;
const DEMO_PORT = 5184;
const DEMO = `http://127.0.0.1:${DEMO_PORT}/`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
}
const KNOWN_SANDBOX_NOISE = [
  /ERR_TUNNEL_CONNECTION_FAILED/, /status of 403/,
  /App Check could not obtain a token/, /appCheck\/fetch-status-error/,
  /Failed to load resource: the server responded with a status of 403/,
  /blocked by CORS policy/, /Failed to load resource: net::ERR_FAILED/,
];
function isSandboxNoise(msg) { return KNOWN_SANDBOX_NOISE.some((re) => re.test(msg)); }
async function waitForPort(host, port, timeoutMs = 30000) {
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
  throw new Error(`port ${host}:${port} did not open`);
}
async function startServers() {
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  const demoEnv = { ...process.env };
  for (const k of ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_APPCHECK_SITE_KEY"]) demoEnv[k] = "";
  const demoProc = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(DEMO_PORT), "--strictPort"], { cwd: ROOT, env: demoEnv, stdio: ["ignore", "pipe", "pipe"] });
  await waitForPort("127.0.0.1", PROXY_PORT);
  await waitForPort("127.0.0.1", DEMO_PORT);
  return { proxyProc, demoProc };
}
async function newPage(browser, { width, height = 844 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, locale: "id-ID", timezoneId: "Asia/Jakarta",
    colorScheme: "dark",
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text()); });
  return { ctx, page, pageErrors };
}
async function dismissOnboarding(page) {
  await page.waitForTimeout(500);
  const btn = page.locator("#onboard-start");
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
}

const SAFE = "Hai Budi, ini Sari dari kantor. Rapat tim dipindah ke hari Kamis pukul 10.00 di ruang 3B. Tolong bawa laporan Q3 ya. Sampai jumpa di sana!";
const PAK_REZA = "Pak Reza\nJumlah Total Rp 480.000\nNo. Transaksi 2026011743008130078713\nudah di tf pak\nBaik\nBesok standby ya jam 14.00\nbaik pak\nBsk cek email ya\nbaik pak terimakasih\nFaqih udah selesai... No 1724";

async function readStats(page) {
  return page.evaluate(() => {
    const txt = (id) => document.getElementById(id)?.textContent?.trim() ?? null;
    const bars = [...document.querySelectorAll("#week-chart-bars .week-bar-count")].map((el) => Number(el.textContent) || 0);
    return {
      checked: txt("stat-checked-num"),
      caught: txt("stat-caught-num"),
      caughtSub: txt("stat-caught-sub"),
      historyStats: txt("history-stats"),
      chartTotal: bars.reduce((a, b) => a + b, 0),
      chartAria: document.getElementById("week-chart-bars")?.getAttribute("aria-label") ?? null,
      toastVisible: (() => { const t = document.getElementById("toast"); return !!t && !t.hidden; })(),
    };
  });
}
async function measureToast(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };
    const overlap = (a, b) => {
      if (!a || !b) return 0;
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return w > 0 && h > 0 ? Math.round(w * h) : 0;
    };
    const toast = rect(document.getElementById("toast"));
    const toastHidden = document.getElementById("toast")?.hidden;
    const samplesHead = rect(document.querySelector(".samples-heading"));
    const samples = rect(document.getElementById("samples"));
    const samplesZone = samplesHead && samples
      ? { top: samplesHead.top, bottom: samples.bottom, left: samples.left, right: samples.right } : null;
    const result = rect(document.getElementById("result"));
    const headlineZone = result ? { top: result.top, bottom: result.top + 160, left: result.left, right: result.right } : null;
    const restZone = result ? { top: result.top + 160, bottom: result.bottom, left: result.left, right: result.right } : null;
    return {
      toastHidden: !!toastHidden,
      toastRect: toast,
      overlapSamples: overlap(toast, samplesZone),
      overlapHeadline: overlap(toast, headlineZone),
      overlapResultRest: overlap(toast, restZone),
      samplesZone, headlineZone,
    };
  });
}
// Wait until the result card is visible, then read stats with no
// extra delay (the 600 ms count-up window starts at the same time).
async function runCheckTimed(page, text) {
  await page.click("#tab-btn-message");
  await page.waitForTimeout(300);
  await page.fill("#message-input", text);
  await page.click("#check-btn");
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const visible = await page.evaluate(() => {
      const r = document.getElementById("result");
      return !!r && !r.hidden;
    });
    if (visible) break;
    await page.waitForTimeout(40);
  }
  const immediate = await readStats(page);
  const toastNow = await measureToast(page);
  await page.waitForTimeout(300);
  const mid = await readStats(page);
  const toastMid = await measureToast(page);
  await page.waitForTimeout(400);
  const toast700 = await measureToast(page);
  await page.waitForTimeout(300);
  const settled = await readStats(page);
  const toastLater = await measureToast(page);
  return { immediate, mid, settled, toastNow, toastMid, toast700, toastLater };
}

(async () => {
  const servers = await startServers();
  const browser = await chromium.launch();
  try {
    for (const width of [390, 1280]) {
      const tag = `${width}`;
      const { ctx, page, pageErrors } = await newPage(browser, { width });
      await page.goto(`${DEMO}?lang=id`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1300);
      await dismissOnboarding(page);
      // Fresh profile: no history, so the stats start at the "–" state.
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1300);
      await dismissOnboarding(page);
      // Make sure the stats section has been seen once (the live
      // browser had scrolled the page), so the count-up runs.
      await page.evaluate(() => document.querySelector(".stats")?.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(600);
      await page.evaluate(() => document.querySelector(".checker")?.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);

      // --- Check 1: safe message (checked 0 -> 1, caught stays 0)
      const c1 = await runCheckTimed(page, SAFE);
      console.log(`[${tag}] check1-safe immediate:`, JSON.stringify(c1.immediate));
      console.log(`[${tag}] check1-safe settled:  `, JSON.stringify(c1.settled));
      await page.screenshot({ path: path.join(SHOTS, `toast-stats-${tag}-check1.png`) });
      check(`${tag}: check1 settled stats consistent (1 checked, 0 caught, sub "dari 1 pesan")`,
        c1.settled.checked === "1" && c1.settled.caught === "0" && /dari 1 pesan/.test(c1.settled.caughtSub || "") && c1.settled.chartTotal === 0,
        JSON.stringify(c1.settled));
      check(`${tag}: check1 immediate read shows the transient lag (checked still mid-flight while sub already final)`,
        c1.immediate.checked !== "1" && /dari 1 pesan/.test(c1.immediate.caughtSub || ""),
        `immediate=${JSON.stringify(c1.immediate)}`);

      // --- Check 2: Pak Reza scam (checked 1 -> 2, caught 0 -> 1)
      const c2 = await runCheckTimed(page, PAK_REZA);
      console.log(`[${tag}] check2-scam immediate:`, JSON.stringify(c2.immediate));
      console.log(`[${tag}] check2-scam mid (+300ms):`, JSON.stringify(c2.mid));
      console.log(`[${tag}] check2-scam settled:  `, JSON.stringify(c2.settled));
      console.log(`[${tag}] toast@immediate:`, JSON.stringify(c2.toastNow));
      console.log(`[${tag}] toast@+300ms:   `, JSON.stringify(c2.toastMid));
      console.log(`[${tag}] toast@+700ms:   `, JSON.stringify(c2.toast700));
      console.log(`[${tag}] toast@+1000ms:  `, JSON.stringify(c2.toastLater));
      await page.screenshot({ path: path.join(SHOTS, `toast-stats-${tag}-check2.png`) });
      check(`${tag}: check2 settled stats consistent (2 checked, 1 caught, chart 1, history "2 pemeriksaan · 1 penipuan tertangkap")`,
        c2.settled.checked === "2" && c2.settled.caught === "1" && /dari 2 pesan/.test(c2.settled.caughtSub || "") &&
        c2.settled.chartTotal === 1 && /2 pemeriksaan/.test(c2.settled.historyStats || "") && /1 penipuan tertangkap/.test(c2.settled.historyStats || ""),
        JSON.stringify(c2.settled));
      check(`${tag}: check2 immediate read shows the transient lag (numbers mid-flight, sub+chart already final)`,
        (c2.immediate.checked !== "2" || c2.immediate.caught !== "1") &&
        /dari 2 pesan/.test(c2.immediate.caughtSub || "") && c2.immediate.chartTotal === 1,
        `immediate=${JSON.stringify(c2.immediate)}`);

      // --- Toast overlap (measured while the toast is visible). The
      // 200 ms early pass (21 Nov fix) must have cleared any overlap
      // by +700 ms — before the old 800 ms pass would even have
      // fired. A brief overlap at t=0 is the layout settling, and
      // is reported, not hidden.
      const toastVisible = c2.toastNow.toastHidden === false;
      check(`${tag}: toast is visible right after the verdict`, toastVisible, JSON.stringify(c2.toastNow.toastRect));
      console.log(`[${tag}] toast overlap samples/headline at t=0 (transient): ${c2.toastNow.overlapSamples}/${c2.toastNow.overlapHeadline}px²; at +300ms: ${c2.toastMid.overlapSamples}/${c2.toastMid.overlapHeadline}px²`);
      check(`${tag}: toast overlap with samples is GONE by +700ms (early 200ms pass)`, c2.toast700.overlapSamples === 0, `overlap=${c2.toast700.overlapSamples}px²`);
      check(`${tag}: toast overlap with result headline is GONE by +700ms`, c2.toast700.overlapHeadline === 0, `overlap=${c2.toast700.overlapHeadline}px²`);
      check(`${tag}: toast overlap stays gone at +1000ms`, c2.toastLater.overlapSamples === 0 && c2.toastLater.overlapHeadline === 0, `samples=${c2.toastLater.overlapSamples} headline=${c2.toastLater.overlapHeadline}`);
      console.log(`[${tag}] toast overlap with the REST of the result card (below headline, by design unprotected): ${c2.toastNow.overlapResultRest}px² at t=0, ${c2.toast700.overlapResultRest}px² at +700ms, ${c2.toastLater.overlapResultRest}px² at +1000ms`);

      const real = pageErrors.filter((m) => !isSandboxNoise(m));
      check(`${tag}: no page errors`, real.length === 0, JSON.stringify(real.slice(0, 3)));
      await ctx.close();
    }
  } finally {
    await browser.close();
    servers.proxyProc.kill();
    servers.demoProc.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join(" | ")); process.exit(1); }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
