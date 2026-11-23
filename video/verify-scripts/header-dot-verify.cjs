// Header green-dot verification (21 Nov 2026, Myuden 23:50):
// - #net-status is a 10px dot (green online, grey offline), with
//   aria-label + title; no text pill in the header.
// - Full status text lives only in the offline notice; the drawer
//   and its Settings status row are gone (deleted 21 Nov).
// - Header never clips any control at 360/390/768, dark + light,
//   ID + EN, text size medium + large (wrap is allowed, clip is not).
// - Offline simulation: dot turns grey, offline notice shows.
// Screenshots header-dot-390-dark/light.png + header-dot-360.png.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/header-dot-verify.cjs
// Exit 0 only when all pass.
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/home/hatch/workspace/tools/rekam-layar/node_modules/playwright");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const SHOTS = path.join(ROOT, "video/panel-lainnya-shots");
const PROXY_PORT = 18096;
const DEV_PORT = 5178;
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
function headerReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const dot = document.querySelector("#net-status");
    const dr = dot.getBoundingClientRect();
    const cs = getComputedStyle(dot);
    const controls = [];
    document.querySelectorAll(".topbar-inner .brand-mark, .topbar-inner h1, .topbar-inner .lang-btn, #senior-toggle, #mode-label, #net-status").forEach((el) => {
      // NB: an element inside a [hidden] ancestor has no display:none
      // of its own — its rect is 0x0 instead. Skip those too.
      const r0 = el.getBoundingClientRect();
      if (getComputedStyle(el).display === "none" || r0.width === 0) return;
      const r = r0;
      const textCut = el.scrollWidth > el.clientWidth + 1;
      controls.push({
        sel: el.id ? `#${el.id}` : el.className.split(" ")[0],
        text: (el.textContent || "").trim().slice(0, 18),
        left: Math.round(r.left), right: Math.round(r.right),
        top: Math.round(r.top), bottom: Math.round(r.bottom),
        clipped: r.left < -0.5 || r.right > vw + 0.5 || textCut,
      });
    });
    return {
      vw,
      dot: { w: Math.round(dr.width), h: Math.round(dr.height), bg: cs.backgroundColor, text: dot.textContent.trim(), aria: dot.getAttribute("aria-label"), title: dot.getAttribute("title"), cls: dot.className },
      controls,
      headerH: Math.round(document.querySelector(".topbar").getBoundingClientRect().height),
      docOverflow: document.documentElement.scrollWidth - vw,
    };
  });
}

(async () => {
  const { proxyProc, viteProc } = await startServers();
  let failures = 0;
  try {
    const browser = await chromium.launch({ args: [`--proxy-server=http://127.0.0.1:${PROXY_PORT}`], ignoreHTTPSErrors: true });
    try {
      // Matrix: width x theme x lang (text size medium, then large at 360).
      for (const width of [360, 390, 768]) {
        for (const mode of ["dark", "light"]) {
          for (const lang of ["id", "en"]) {
            const ctx = await browser.newContext({ viewport: { width, height: 844 }, ignoreHTTPSErrors: true });
            const pageErrors = [];
            const page = await ctx.newPage();
            page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(String(e).slice(0, 200)); });
            page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text().slice(0, 200)); });
            await page.goto(DEV + `?lang=${lang}`, { waitUntil: "domcontentloaded" });
            await page.waitForTimeout(1100);
            await dismissOnboarding(page);
            if (mode === "light") {
              await page.evaluate(() => localStorage.setItem("pesanaman_theme", "light"));
              await page.reload({ waitUntil: "domcontentloaded" });
              await page.waitForTimeout(900);
              await dismissOnboarding(page);
            }
            const rep = await headerReport(page);
            const tag = `${width}px ${mode} ${lang}`;
            check(`dot is 10px green, no text (${tag})`, rep.dot.w === 10 && rep.dot.h === 10 && rep.dot.bg === "rgb(34, 197, 94)" && rep.dot.text === "" && rep.dot.aria === (lang === "id" ? "Daring" : "Online"), JSON.stringify(rep.dot));
            const clipped = rep.controls.filter((c) => c.clipped);
            check(`no header control clipped (${tag})`, clipped.length === 0, JSON.stringify(clipped));
            const senior = rep.controls.find((c) => c.sel === "#senior-toggle");
            check(`Senior toggle not in header (${tag})`, !senior, JSON.stringify(senior));
            check(`no doc overflow (${tag})`, rep.docOverflow <= 0, `overflow=${rep.docOverflow}`);
            check(`no page errors (${tag})`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
            if (width === 390 && lang === "id") {
              await page.locator(".topbar").screenshot({ path: path.join(SHOTS, `header-dot-390-${mode}.png`) });
            }
            if (width === 360 && lang === "id" && mode === "dark") {
              await page.locator(".topbar").screenshot({ path: path.join(SHOTS, "header-dot-360.png") });
            }
            await ctx.close();
          }
        }
      }
      // Large text size at 360 (ID, dark): header may wrap, never clip.
      {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 844 }, ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1000);
        await dismissOnboarding(page);
        await page.evaluate(() => localStorage.setItem("pesanaman_text_size", "large"));
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
        await dismissOnboarding(page);
        const rep = await headerReport(page);
        const clipped = rep.controls.filter((c) => c.clipped);
        check("360 large text: no header control clipped", clipped.length === 0, JSON.stringify(clipped));
        // Senior toggle lives in Dashboard 2 Pengaturan now — whole at 360 large text.
        await page.click("#nav-history");
        await page.waitForTimeout(600);
        const seniorBox = await page.evaluate(() => {
          const el = document.querySelector("#senior-toggle");
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right), vw: document.documentElement.clientWidth, visible: r.width > 0 };
        });
        check("360 large text: senior toggle whole (Dashboard 2)", seniorBox.visible && seniorBox.left >= 0 && seniorBox.right <= seniorBox.vw, JSON.stringify(seniorBox));
        await ctx.close();
      }
      // Header dot status (ID + EN) + offline simulation. The drawer
      // Settings status row is gone (21 Nov) — the header dot alone
      // carries the status now, plus the offline notice.
      for (const lang of ["id", "en"]) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        await page.goto(DEV + `?lang=${lang}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1000);
        await dismissOnboarding(page);
        const dot = await page.evaluate(() => {
          const el = document.querySelector("#net-status");
          const r = el.getBoundingClientRect();
          return { bg: getComputedStyle(el).backgroundColor, aria: el.getAttribute("aria-label"), visible: r.width > 0 };
        });
        check(`header dot online (${lang})`, dot.visible && dot.bg === "rgb(34, 197, 94)" && dot.aria === (lang === "id" ? "Daring" : "Online"), JSON.stringify(dot));
        // Offline: dot grey, aria-label offline, notice visible.
        await ctx.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        await page.waitForTimeout(600);
        const off = await page.evaluate(() => {
          const dot = document.querySelector("#net-status");
          return {
            bg: getComputedStyle(dot).backgroundColor,
            aria: dot.getAttribute("aria-label"),
            noteVisible: !document.querySelector("#offline-note").hidden,
            noteText: document.querySelector("#offline-note").textContent.slice(0, 60),
          };
        });
        const expectOff = lang === "id" ? "Offline — mode pesawat" : "Offline — airplane mode";
        check(`offline: dot grey + aria (${lang})`, off.bg === "rgb(148, 163, 184)" && off.aria === expectOff, JSON.stringify(off));
        check(`offline: notice visible, honest text (${lang})`, off.noteVisible && /membutuhkan internet|need the internet/.test(off.noteText), off.noteText);
        // Back online: dot green again.
        await ctx.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await page.waitForTimeout(600);
        const back = await page.evaluate(() => getComputedStyle(document.querySelector("#net-status")).backgroundColor);
        check(`back online: dot green (${lang})`, back === "rgb(34, 197, 94)", back);
        await ctx.close();
      }
    } finally { await browser.close(); }
  } finally { proxyProc.kill(); viteProc.kill(); }
  failures = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
