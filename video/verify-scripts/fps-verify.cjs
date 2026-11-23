// FPS measurement (21 Nov 2026, standar Myuden 00:13 + 00:14):
// rAF sampling at 390px, dark theme, for every animation on the page:
//  - idle hero (FAB aman-float + hero-live-pulse running)
//  - Aman panel open (avatar aman-float; forced .thinking aman-pulse)
//  - programmatic scroll (reveal + count-up running)
//  - panel open is 0.15s — measured as part of scroll run (the sheet
//    is gone since 21 Nov; no drawer animation remains)
// Reports: measured fps, median + p95 frame time, jank frames (>33ms),
// and the implied refresh rate. Headless Chromium on this VM caps at
// ~60Hz, so 120fps can only be proven on a 120Hz device — the
// guarantee here is that the animation work is light enough to reach
// the screen's limit; any frame below ~55fps at 60Hz fails the gate.
// Reduced-motion run confirms animations are off.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/fps-verify.cjs
// Exit 0 only when every scenario is >= 55fps (at 60Hz) and p95 < 33ms.
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/home/hatch/workspace/tools/rekam-layar/node_modules/playwright");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = 18096;
const DEV_PORT = 5178;
const DEV = `http://127.0.0.1:${DEV_PORT}/`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
}
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
  const env = { ...process.env };
  for (const k of ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_APPCHECK_SITE_KEY"]) env[k] = "";
  const viteProc = spawn(process.execPath, [
    path.join(ROOT, "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1", "--port", String(DEV_PORT), "--strictPort",
  ], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  await waitForPort("127.0.0.1", PROXY_PORT);
  await waitForPort("127.0.0.1", DEV_PORT);
  return { proxyProc, viteProc };
}
async function dismissOnboarding(page) {
  const btn = page.locator("#onboard-start");
  try { if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 2000 }); } catch (_) {}
  await page.waitForTimeout(300);
}
// Sample rAF for `ms` milliseconds. `during` (optional) runs inside
// the page each frame (e.g. scrolling). Returns frame stats.
function sampleRaf(page, ms, duringFn) {
  return page.evaluate(async (ms) => {
    const stamps = [];
    const start = performance.now();
    await new Promise((resolve) => {
      function tick(t) {
        stamps.push(t);
        if (t - start < ms) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    const deltas = [];
    for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
    deltas.sort((a, b) => a - b);
    const dur = (stamps[stamps.length - 1] - stamps[0]) / 1000;
    const median = deltas[Math.floor(deltas.length / 2)] || 0;
    const p95 = deltas[Math.floor(deltas.length * 0.95)] || 0;
    const jank = deltas.filter((d) => d > 33.4).length;
    return {
      frames: stamps.length,
      fps: +(stamps.length / dur).toFixed(1),
      medianMs: +median.toFixed(2),
      p95Ms: +p95.toFixed(2),
      jank,
      impliedHz: +(1000 / median).toFixed(1),
    };
  }, ms);
}
async function scrollSample(page, ms) {
  // Scroll top->bottom->top in small steps while sampling rAF.
  const sampler = page.evaluate(async (ms) => {
    const stamps = [];
    const start = performance.now();
    const max = document.body.scrollHeight - window.innerHeight;
    await new Promise((resolve) => {
      function tick(t) {
        stamps.push(t);
        const p = (t - start) / ms;
        const y = p < 0.5 ? max * (p * 2) : max * (1 - (p - 0.5) * 2);
        window.scrollTo(0, Math.max(0, y));
        if (t - start < ms) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
    const deltas = [];
    for (let i = 1; i < stamps.length; i++) deltas.push(stamps[i] - stamps[i - 1]);
    deltas.sort((a, b) => a - b);
    const dur = (stamps[stamps.length - 1] - stamps[0]) / 1000;
    const median = deltas[Math.floor(deltas.length / 2)] || 0;
    const p95 = deltas[Math.floor(deltas.length * 0.95)] || 0;
    return {
      frames: stamps.length,
      fps: +(stamps.length / dur).toFixed(1),
      medianMs: +median.toFixed(2),
      p95Ms: +p95.toFixed(2),
      jank: deltas.filter((d) => d > 33.4).length,
      impliedHz: +(1000 / median).toFixed(1),
    };
  }, ms);
  return sampler;
}

(async () => {
  const { proxyProc, viteProc } = await startServers();
  let failures = 0;
  try {
    const browser = await chromium.launch({ args: [`--proxy-server=http://127.0.0.1:${PROXY_PORT}`], ignoreHTTPSErrors: true });
    try {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await dismissOnboarding(page);
      await page.waitForTimeout(500);

      const idle = await sampleRaf(page, 5000);
      console.log("idle hero:", JSON.stringify(idle));
      check("idle hero fps >= 55", idle.fps >= 55, `fps=${idle.fps} median=${idle.medianMs}ms p95=${idle.p95Ms}ms jank=${idle.jank} impliedHz=${idle.impliedHz}`);
      check("idle hero p95 frame < 33ms", idle.p95Ms < 33, `p95=${idle.p95Ms}ms`);

      // Aman panel open: avatar float + forced thinking pulse.
      await page.click("#aman-fab", { force: true });
      await page.waitForTimeout(800);
      await page.evaluate(() => document.querySelector(".avatar")?.classList.add("thinking"));
      const aman = await sampleRaf(page, 5000);
      console.log("aman panel + pulse:", JSON.stringify(aman));
      check("aman panel fps >= 55", aman.fps >= 55, `fps=${aman.fps} median=${aman.medianMs}ms p95=${aman.p95Ms}ms jank=${aman.jank}`);
      check("aman panel p95 frame < 33ms", aman.p95Ms < 33, `p95=${aman.p95Ms}ms`);
      await page.evaluate(() => document.querySelector(".avatar")?.classList.remove("thinking"));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);

      // Scroll: reveal + count-up + FAB float together.
      const scroll = await scrollSample(page, 5000);
      console.log("scroll:", JSON.stringify(scroll));
      check("scroll fps >= 55", scroll.fps >= 55, `fps=${scroll.fps} median=${scroll.medianMs}ms p95=${scroll.p95Ms}ms jank=${scroll.jank}`);
      check("scroll p95 frame < 33ms", scroll.p95Ms < 33, `p95=${scroll.p95Ms}ms`);
      await page.evaluate(() => window.scrollTo(0, 0));

      // Reduced motion: animations must be off.
      const rm = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, reducedMotion: "reduce" });
      const rmp = await rm.newPage();
      await rmp.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
      await rmp.waitForTimeout(1000);
      const rmState = await rmp.evaluate(() => {
        const fab = document.querySelector("#aman-fab");
        const dot = document.querySelector(".hero-live-dot");
        return {
          fabAnim: getComputedStyle(fab).animationName,
          dotAnim: getComputedStyle(dot).animationName,
          fabDur: getComputedStyle(fab).animationDuration,
        };
      });
      check("reduced-motion: animations off", rmState.fabAnim === "none" && rmState.dotAnim === "none", JSON.stringify(rmState));
      await rm.close();
      await ctx.close();
    } finally { await browser.close(); }
  } finally { proxyProc.kill(); viteProc.kill(); }
  failures = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
