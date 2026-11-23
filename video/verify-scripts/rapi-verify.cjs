// RAPI VERIFICATION (21 Nov 2026) — "profesional, simpel, rapi, diam
// seperti make.fun" (Myuden):
//   R1 header is STICKY, pinned at top (Myuden 21 Nov 13:03 —
//      membatalkan "STATIC, never sticky"): it stays visible while
//      scrolling down, same height, one line.
//   R2 the floating Aman button hides while the footer is on screen
//      (IntersectionObserver) and fades back in once the footer leaves.
//   R3 the Aman button never covers the bottom nav.
//   R4 bottom nav still works (Beranda switches back to Dashboard 1,
//      Riwayat opens Dashboard 2 — both full pages, no panel).
//   R5 the tools grid is 4x2, 8 cards, none clipped, no h-scroll.
// (The drawer is gone — deleted 21 Nov, Myuden "Hapus hamburger".)
// Usage: node ~/workspace/pesanaman/video/verify-scripts/rapi-verify.cjs
// Exit 0 only when all checks pass.
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/home/hatch/workspace/tools/rekam-layar/node_modules/playwright");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const SHOTS = path.join(ROOT, "video/panel-lainnya-shots");
const PROXY_PORT = 18100;
const DEV_PORT = 5182;
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
async function newPage(browser, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text()); });
  return { ctx, page, pageErrors };
}
function noErrors(pageErrors, label) {
  check(`${label}: 0 page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
}
async function dismissOnboarding(page) {
  const btn = page.locator("#onboard-start");
  try { if (await btn.isVisible({ timeout: 1500 })) await btn.click({ timeout: 2000 }); } catch (_) {}
  await page.waitForTimeout(300);
}

(async () => {
  const { proxyProc, viteProc } = await startServers();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    // ---- R1: header sticky — stays pinned at the top while scrolling ----
    {
      const { ctx, page, pageErrors } = await newPage(browser, 390);
      await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await dismissOnboarding(page);
      const top = await page.evaluate(() => {
        const tb = document.querySelector(".topbar");
        const cs = getComputedStyle(tb);
        const r = tb.getBoundingClientRect();
        return { position: cs.position, rectTop: Math.round(r.top), rectBottom: Math.round(r.bottom) };
      });
      check("R1 header computed position is sticky", top.position === "sticky", JSON.stringify(top));
      check("R1 header visible at page top", top.rectTop === 0 && top.rectBottom > 0, JSON.stringify(top));
      await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
      await page.waitForTimeout(400);
      const scrolled = await page.evaluate(() => {
        const r = document.querySelector(".topbar").getBoundingClientRect();
        return { scrollY: Math.round(window.scrollY), rectTop: Math.round(r.top), rectBottom: Math.round(r.bottom) };
      });
      check("R1 header still pinned after scrolling down 1500px", scrolled.scrollY >= 1400 && scrolled.rectTop === 0 && scrolled.rectBottom > 0, JSON.stringify(scrolled));
      await page.screenshot({ path: path.join(SHOTS, "header-scroll-rapi-390.png") });
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(400);
      const back = await page.evaluate(() => {
        const r = document.querySelector(".topbar").getBoundingClientRect();
        return { rectTop: Math.round(r.top), rectBottom: Math.round(r.bottom) };
      });
      check("R1 header back in view at page top", back.rectTop === 0 && back.rectBottom > 0, JSON.stringify(back));
      noErrors(pageErrors, "R1 header sticky");
      await ctx.close();
    }

    // ---- R2: Aman button hides at the footer, returns above it ----
    {
      const { ctx, page, pageErrors } = await newPage(browser, 390);
      await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await dismissOnboarding(page);
      // Mid-page: footer out of view, button must be visible.
      await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
      await page.waitForTimeout(500);
      const mid = await page.evaluate(() => {
        const fab = document.querySelector("#aman-fab");
        const cs = getComputedStyle(fab);
        return { hidden: fab.classList.contains("aman-fab-hidden"), visibility: cs.visibility, opacity: parseFloat(cs.opacity) };
      });
      check("R2 FAB visible mid-page (footer out of view)", !mid.hidden && mid.visibility === "visible" && mid.opacity === 1, JSON.stringify(mid));
      // Bottom: footer on screen, button must hide; footer fully readable.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
      await page.waitForTimeout(500);
      const bottom = await page.evaluate(() => {
        const fab = document.querySelector("#aman-fab");
        const fcs = getComputedStyle(fab);
        const foot = document.querySelector(".footer");
        const fr = foot.getBoundingClientRect();
        const fabR = fab.getBoundingClientRect();
        const rows = [...foot.querySelectorAll(".footer-row")].map((el) => {
          const r = el.getBoundingClientRect();
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= innerHeight };
        });
        const overlap = [...foot.querySelectorAll("a, .footer-row > span")].some((el) => {
          if (fcs.visibility === "hidden") return false;
          const r = el.getBoundingClientRect();
          return !(r.right <= fabR.left || r.left >= fabR.right || r.bottom <= fabR.top || r.top >= fabR.bottom);
        });
        return {
          scrollY: Math.round(window.scrollY),
          hidden: fab.classList.contains("aman-fab-hidden"), visibility: fcs.visibility,
          footerTop: Math.round(fr.top), footerBottom: Math.round(fr.bottom),
          rows, overlap,
        };
      });
      check("R2 FAB hidden at page bottom (footer on screen)", bottom.hidden && bottom.visibility === "hidden", JSON.stringify(bottom));
      check("R2 footer fully in view at bottom", bottom.footerTop >= 0 && bottom.footerBottom <= 844, JSON.stringify(bottom));
      check("R2 every footer row fully readable, nothing covered", bottom.rows.every((r) => r.inView) && !bottom.overlap, JSON.stringify(bottom));
      await page.screenshot({ path: path.join(SHOTS, "footer-aman-rapi-390.png") });
      // Scroll back up: footer out of view, button returns. NB the
      // scroll position must be maxScroll - 500, NOT scrollHeight -
      // 500 — the latter clamps to maxScroll and the footer stays
      // visible, so the FAB would (correctly) stay hidden.
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight - innerHeight - 500, behavior: "instant" }));
      await page.waitForTimeout(500);
      const up = await page.evaluate(() => {
        const fab = document.querySelector("#aman-fab");
        const cs = getComputedStyle(fab);
        const fr = document.querySelector(".footer").getBoundingClientRect();
        return { hidden: fab.classList.contains("aman-fab-hidden"), visibility: cs.visibility, opacity: parseFloat(cs.opacity), footerTop: Math.round(fr.top) };
      });
      check("R2 FAB back once footer leaves the viewport", !up.hidden && up.visibility === "visible" && up.opacity === 1 && up.footerTop > 844, JSON.stringify(up));
      noErrors(pageErrors, "R2 FAB hides at footer");
      await ctx.close();
    }

    // ---- R3: FAB clears the bottom nav; R4: nav still works ----
    {
      const { ctx, page, pageErrors } = await newPage(browser, 390);
      await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await dismissOnboarding(page);
      await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
      await page.waitForTimeout(400);
      const nav = await page.evaluate(() => {
        const fab = document.querySelector("#aman-fab").getBoundingClientRect();
        const navEl = document.querySelector(".bottomnav").getBoundingClientRect();
        return { fabBottom: Math.round(fab.bottom), navTop: Math.round(navEl.top), navH: Math.round(navEl.height) };
      });
      check("R3 FAB sits above the bottom nav (never covers it)", nav.fabBottom <= nav.navTop, JSON.stringify(nav));
      await page.click("#nav-history");
      await page.waitForTimeout(600);
      const hist = await page.evaluate(() => ({ homeHidden: document.querySelector("#view-home").hidden, histHidden: document.querySelector("#view-history").hidden, scrollY: Math.round(window.scrollY) }));
      check("R4 nav Riwayat opens Dashboard 2 (full page)", hist.histHidden === false && hist.homeHidden === true && hist.scrollY === 0, JSON.stringify(hist));
      await page.click("#nav-home");
      // NB: showView scrolls to the top — wait for it, don't guess a
      // fixed timeout (smooth scroll-behavior can take ~600ms).
      await page.waitForFunction(() => window.scrollY === 0, { timeout: 5000 });
      const home = await page.evaluate(() => ({ homeHidden: document.querySelector("#view-home").hidden, histHidden: document.querySelector("#view-history").hidden, scrollY: Math.round(window.scrollY) }));
      check("R4 nav Beranda switches back to Dashboard 1 at top", home.homeHidden === false && home.histHidden === true && home.scrollY === 0, JSON.stringify(home));
      noErrors(pageErrors, "R3+R4 nav");
      await ctx.close();
    }

    // ---- R5: tools grid 4x2, 8 cards, none clipped ----
    {
      const { ctx, page, pageErrors } = await newPage(browser, 390);
      await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
      await dismissOnboarding(page);
      await page.evaluate(() => document.querySelector(".modules").scrollIntoView());
      await page.waitForTimeout(400);
      const grid = await page.evaluate(() => {
        const g = document.querySelector(".module-tabs");
        const cards = [...document.querySelectorAll(".module-tab-btn")].map((b) => {
          const r = b.getBoundingClientRect();
          const name = b.querySelector(".module-tab-name");
          return { id: b.id.replace("module-tab-", ""), left: Math.round(r.left), right: Math.round(r.right), clipped: name.scrollWidth > name.clientWidth + 1 };
        });
        return { cols: getComputedStyle(g).gridTemplateColumns.split(" ").length, cards, hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      });
      check("R5 grid is 4 columns with 8 tools in order", grid.cols === 4 && JSON.stringify(grid.cards.map((c) => c.id)) === JSON.stringify(["link", "file", "chatlog", "report", "contacts", "aid", "quiz", "how"]), JSON.stringify(grid));
      check("R5 all 8 cards fully visible, no title clipped, no h-scroll", grid.cards.every((c) => c.left >= 0 && c.right <= 390 && !c.clipped) && !grid.hScroll, JSON.stringify(grid));
      noErrors(pageErrors, "R5 grid");
      await ctx.close();
    }
  } finally {
    await browser.close();
    proxyProc.kill();
    viteProc.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILING: ${failed.map((r) => r.name).join("; ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
})();
