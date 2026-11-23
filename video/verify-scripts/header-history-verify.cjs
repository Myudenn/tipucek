// Header Riwayat link verification (21 Nov 2026, Myuden 12:12, opsi b):
// - The "Riwayat" link in the header is visible ONLY at >=1024px
//   (desktop), hidden on mobile (<1024px) where the bottom nav opens
//   Dashboard 2. Click opens Dashboard 2; "← Beranda" returns home.
// - Label follows language via the existing navHistory key (Riwayat /
//   History). Header stays one slim line, no wrap/overflow/clip at
//   1024/1280/1919 and at 390.
// Screenshots header-desktop-1280.png + dashboard-riwayat-desktop.png.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/header-history-verify.cjs
// Exit 0 only when all pass.
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/home/hatch/workspace/tools/rekam-layar/node_modules/playwright");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const SHOTS = path.join(ROOT, "video/panel-lainnya-shots");
const PROXY_PORT = 18097;
const DEV_PORT = 5179;
const DEV = `http://127.0.0.1:${DEV_PORT}/`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 220) : ""}`);
}
const KNOWN_SANDBOX_NOISE = [/ERR_TUNNEL_CONNECTION_FAILED/, /status of 403/, /App Check could not obtain a token/];
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
function linkReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const link = document.querySelector("#header-history-link");
    const r = link.getBoundingClientRect();
    const cs = getComputedStyle(link);
    const topbar = document.querySelector(".topbar");
    const tr = topbar.getBoundingClientRect();
    const inner = document.querySelector(".topbar-inner");
    const ir = inner.getBoundingClientRect();
    return {
      vw,
      link: { visible: cs.display !== "none" && r.width > 0, display: cs.display, text: link.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) },
      headerH: Math.round(tr.height),
      innerH: Math.round(ir.height),
      innerW: Math.round(ir.width),
      docOverflow: document.documentElement.scrollWidth - vw,
      homeHidden: document.querySelector("#view-home").hidden,
      historyHidden: document.querySelector("#view-history").hidden,
    };
  });
}

(async () => {
  const { proxyProc, viteProc } = await startServers();
  let failures = 0;
  try {
    const browser = await chromium.launch({ args: [`--proxy-server=http://127.0.0.1:${PROXY_PORT}`], ignoreHTTPSErrors: true });
    try {
      // Desktop matrix: 1024 / 1280 / 1919 x ID / EN.
      for (const width of [1024, 1280, 1919]) {
        for (const lang of ["id", "en"]) {
          const ctx = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true });
          const pageErrors = [];
          const page = await ctx.newPage();
          page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(String(e).slice(0, 200)); });
          page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text().slice(0, 200)); });
          await page.goto(DEV + `?lang=${lang}`, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1100);
          await dismissOnboarding(page);
          const tag = `${width}px ${lang}`;
          const rep = await linkReport(page);
          const expectText = lang === "id" ? "Riwayat" : "History";
          check(`link visible in header (${tag})`, rep.link.visible && rep.link.display !== "none", JSON.stringify(rep.link));
          check(`link label follows language (${tag})`, rep.link.text === expectText, rep.link.text);
          check(`link inside viewport, no clip (${tag})`, rep.link.left >= 0 && rep.link.right <= rep.vw, JSON.stringify(rep.link));
          check(`header one slim line (${tag})`, rep.headerH <= 70 && rep.innerH <= 70, `headerH=${rep.headerH} innerH=${rep.innerH}`);
          check(`no doc overflow (${tag})`, rep.docOverflow <= 0, `overflow=${rep.docOverflow}`);
          // Click the link -> Dashboard 2 opens.
          await page.click("#header-history-link");
          await page.waitForTimeout(600);
          const after = await linkReport(page);
          check(`click opens Dashboard 2 (${tag})`, after.historyHidden === false && after.homeHidden === true, JSON.stringify({ homeHidden: after.homeHidden, historyHidden: after.historyHidden }));
          // "← Beranda" returns home.
          await page.click("#history-back-btn");
          await page.waitForTimeout(600);
          const back = await linkReport(page);
          check(`"← Beranda" returns home (${tag})`, back.homeHidden === false && back.historyHidden === true, JSON.stringify({ homeHidden: back.homeHidden, historyHidden: back.historyHidden }));
          check(`no page errors (${tag})`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
          if (width === 1280 && lang === "id") {
            await page.locator(".topbar").screenshot({ path: path.join(SHOTS, "header-desktop-1280.png") });
            await page.click("#header-history-link");
            await page.waitForTimeout(600);
            await page.screenshot({ path: path.join(SHOTS, "dashboard-riwayat-desktop.png") });
            await page.click("#history-back-btn");
            await page.waitForTimeout(400);
          }
          await ctx.close();
        }
      }
      // Mobile 390px ID + EN: link hidden, header stays one slim line.
      for (const lang of ["id", "en"]) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
        const pageErrors = [];
        const page = await ctx.newPage();
        page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(String(e).slice(0, 200)); });
        page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text().slice(0, 200)); });
        await page.goto(DEV + `?lang=${lang}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1100);
        await dismissOnboarding(page);
        const rep = await linkReport(page);
        check(`link hidden on mobile 390px (${lang})`, !rep.link.visible && rep.link.display === "none", JSON.stringify(rep.link));
        check(`mobile header one slim line (${lang})`, rep.headerH <= 70 && rep.innerH <= 70, `headerH=${rep.headerH} innerH=${rep.innerH}`);
        check(`mobile no doc overflow (${lang})`, rep.docOverflow <= 0, `overflow=${rep.docOverflow}`);
        check(`mobile no page errors (${lang})`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
        await ctx.close();
      }
    } finally { await browser.close(); }
  } finally { proxyProc.kill(); viteProc.kill(); }
  failures = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
