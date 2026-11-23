// Footer rework verification (21 Nov 2026):
// - Row 1: V4 mini-tile + TipuCek, GitHub mark + repo link.
// - Row 2: hackathon + MIT license with the OSI keyhole (single
//   colour, links to opensource.org).
// - Install card above the footer with the one install button
//   (same PWA flow, no second button); footer has no tips text.
// - Divider above, dim small text; footer not covered by the
//   bottom nav; FAB never covers footer links/text (checked at
//   link level, worst-case FAB box); dark + light 390.
// Screenshots footer-final-390-dark/light.png + footer-logo-*.png.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/footer-verify.cjs
// Exit 0 only when all pass.
const fs = require("fs");
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
function overflowReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && !["HTML", "BODY"].includes(el.tagName)) {
        bad.push(`${el.tagName}.${String(el.className && el.className.baseVal !== undefined ? "" : el.className).slice(0, 40)} w=${Math.round(r.width)}`);
      }
    });
    return { vw, docOverflow: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 6) };
  });
}

(async () => {
  const { proxyProc, viteProc } = await startServers();
  let failures = 0;
  try {
    const browser = await chromium.launch({ args: [`--proxy-server=http://127.0.0.1:${PROXY_PORT}`], ignoreHTTPSErrors: true });
    try {
      for (const mode of ["dark", "light"]) {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
        const pageErrors = [];
        const page = await ctx.newPage();
        page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(String(e).slice(0, 200)); });
        page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text().slice(0, 200)); });
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1200);
        await dismissOnboarding(page);
        if (mode === "light") {
          await page.evaluate(() => localStorage.setItem("pesanaman_theme", "light"));
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1000);
          await dismissOnboarding(page);
        }
        const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
        check(`theme is ${mode}`, theme === mode, `theme=${theme}`);
        // Absolute bottom (instant: deterministic).
        await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
        await page.waitForTimeout(500);
        const f = await page.evaluate(() => {
          const footer = document.querySelector(".footer");
          const rows = [...footer.querySelectorAll(".footer-row")];
          const tileImg = footer.querySelector(".footer-tile img");
          const ghSvg = footer.querySelector('a[href*="github.com"] svg');
          const osiSvg = footer.querySelector('a[href="https://opensource.org"] svg');
          const osiPath = osiSvg?.querySelector("path")?.getAttribute("d") || "";
          const ghPath = ghSvg?.querySelector("path")?.getAttribute("d") || "";
          const cs = getComputedStyle(footer);
          const nav = document.querySelector(".bottomnav").getBoundingClientRect();
          const fr = footer.getBoundingClientRect();
          const fabEl = document.querySelector("#aman-fab");
          const fab = fabEl.getBoundingClientRect();
          // FAB vs footer CONTENT (links + text spans), not the footer
          // box: the fixed launcher may cross the footer's empty right
          // edge, but must never cover a link or a word. Worst-case
          // FAB box: float lifts it up to 10px, so top is 706 at rest.
          // (21 Nov: the launcher hides entirely while the footer is
          // on screen — a hidden button covers nothing, so the overlap
          // only counts while it is visible.)
          const fabVisible = getComputedStyle(fabEl).visibility !== "hidden";
          const fabBox = { top: 706, bottom: 764, left: fab.left, right: fab.right };
          const fabOverlap = fabVisible && [...footer.querySelectorAll("a, .footer-row > span")].some((el) => {
            const r = el.getBoundingClientRect();
            return !(r.right <= fabBox.left || r.left >= fabBox.right || r.bottom <= fabBox.top || r.top >= fabBox.bottom);
          });
          const installBtns = document.querySelectorAll("#install-btn").length;
          const installCard = document.querySelector("#install-card");
          const installAbove = installCard && footer.compareDocumentPosition(installCard) & Node.DOCUMENT_POSITION_PRECEDING;
          return {
            rows: rows.length,
            row1Text: rows[0]?.textContent.replace(/\s+/g, " ").trim() || "",
            row2Text: rows[1]?.textContent.replace(/\s+/g, " ").trim() || "",
            tileSrc: tileImg?.getAttribute("src"), tileW: Math.round(tileImg?.getBoundingClientRect().width || 0),
            gh: !!ghSvg && ghPath.startsWith("M9.356"), ghHref: footer.querySelector('a[href*="github.com"]')?.getAttribute("href"),
            osi: !!osiSvg && osiPath.startsWith("M11.959"),
            borderTop: cs.borderTopWidth, paddingTop: cs.paddingTop,
            footerBottom: Math.round(fr.bottom), navTop: Math.round(nav.top),
            fabOverlap, fabHidden: !fabVisible, installBtns, installAbove: !!installAbove,
            footerHasTips: /Tambahkan ke Layar utama/.test(footer.textContent),
          };
        });
        check(`2 footer rows (${mode})`, f.rows === 2, `rows=${f.rows}`);
        check(`row 1 identity (${mode})`, /TipuCek/.test(f.row1Text) && /github\.com\/Myudenn\/tipucek/.test(f.row1Text), f.row1Text);
        check(`row 1 V4 mini-tile 16px (${mode})`, f.tileSrc === "/logo-mark.svg" && f.tileW === 16, `${f.tileSrc} w=${f.tileW}`);
        check(`row 1 GitHub mark + link (${mode})`, f.gh && f.ghHref === "https://github.com/Myudenn/tipucek", `gh=${f.gh} href=${f.ghHref}`);
        check(`row 2 hackathon + license (${mode})`, /Dibuat untuk/.test(f.row2Text) && /#BuildHybridAI 2026/.test(f.row2Text) && /lisensi MIT/.test(f.row2Text), f.row2Text);
        check(`row 2 OSI keyhole + opensource.org link (${mode})`, f.osi, `osi=${f.osi}`);
        check(`divider + spacing (${mode})`, f.borderTop === "1px" && parseFloat(f.paddingTop) >= 16, `border=${f.borderTop} padTop=${f.paddingTop}`);
        check(`footer above bottom nav (${mode})`, f.footerBottom <= f.navTop, `bottom=${f.footerBottom} navTop=${f.navTop}`);
        check(`FAB covers no footer link/text (${mode})`, !f.fabOverlap, `overlap=${f.fabOverlap}`);
        check(`FAB hidden while footer on screen (${mode})`, f.fabHidden, `hidden=${f.fabHidden}`);
        check(`one install button, card above footer (${mode})`, f.installBtns === 1 && f.installAbove, `btns=${f.installBtns} above=${f.installAbove}`);
        check(`footer has no install-tips text (${mode})`, !f.footerHasTips, "");
        await page.click("#install-btn", { force: true });
        await page.waitForTimeout(500);
        const hint = await page.evaluate(() => {
          const el = document.querySelector("#install-hint");
          return { hidden: el?.hidden, text: (el?.textContent || "").slice(0, 80) };
        });
        check(`install button shows browser-menu hint (${mode})`, !hint.hidden && hint.text.length > 10, JSON.stringify(hint));
        const ov = await overflowReport(page);
        check(`no overflow (${mode})`, ov.docOverflow <= 0 && ov.bad.length === 0, JSON.stringify(ov));
        await page.locator(".footer").screenshot({ path: path.join(SHOTS, `footer-logo-390-${mode}.png`) });
        await page.screenshot({ path: path.join(SHOTS, `footer-final-390-${mode}.png`) });
        check(`no page errors (${mode})`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
        await ctx.close();
      }
      // EN row 2.
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      await page.goto(DEV + "?lang=en", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      await dismissOnboarding(page);
      await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
      await page.waitForTimeout(500);
      const row2en = await page.evaluate(() => document.querySelectorAll(".footer-row")[1]?.textContent.replace(/\s+/g, " ").trim() || "");
      check("EN row 2: Built for the ... MIT license", /Built for the/.test(row2en) && /MIT license/.test(row2en), row2en);
      await ctx.close();
    } finally { await browser.close(); }
  } finally { proxyProc.kill(); viteProc.kill(); }
  failures = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
