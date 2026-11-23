#!/usr/bin/env node
// MINOR-FIXES LIVE VERIFY (audit M1/M2/M4 + kartu/PDF, 21 Nov 2026) —
// checks the LIVE site (bundle index-CWY5PMQb.js) with a fresh
// profile: M1 empty state + try button, send button, M2 toast 3 s +
// close, M4 copy-link toast, card download pixel check, PDF 1 page.
// Headless Chromium is App-Check-throttled, so the message check is
// expected to fall back to the honest code-only verdict — that still
// proves send + toast + card + PDF end to end.
// Usage: node video/verify-scripts/minor-fixes-verify.cjs
// Exit 0 only when every check passes.
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const net = require("net");
const http = require("http");
const { createRequire } = require("module");

const HOME = process.env.HOME || "";
const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(ROOT, "video", "panel-lainnya-shots");
const PLAYWRIGHT_PATH = path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright");
const requirePw = createRequire(path.join(PLAYWRIGHT_PATH, "index.js"));
const { chromium } = requirePw(PLAYWRIGHT_PATH);
const PROXY_PORT = 18100;
const LIVE = "https://tipucek.web.app";
const APK_TEXT = "Halo, ini undangan pernikahan kami! Silakan download aplikasinya di sini: https://undangan-nikah-2026.xyz/invite.apk — mohon kehadirannya ya, terima kasih!";

const results = [];
function check(section, name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} [${section}] ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
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
async function newPage(browser, { width, height = 900 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, locale: "id-ID", timezoneId: "Asia/Jakarta",
    colorScheme: "dark", ignoreHTTPSErrors: true,
    permissions: ["clipboard-read", "clipboard-write"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
  });
  const page = await ctx.newPage();
  return { ctx, page };
}
async function gotoLive(page) {
  await page.goto(`${LIVE}?lang=id`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  const btn = page.locator("#onboard-start");
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
}
async function toastText(page) {
  return page.evaluate(() => {
    const el = document.querySelector("#toast");
    return el && !el.hidden ? el.textContent.trim() : "";
  });
}
async function toastVisible(page) {
  return page.evaluate(() => {
    const el = document.querySelector("#toast");
    return !!el && !el.hidden;
  });
}
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bytes: b.length };
}
// Tiny static server for the harness page (serves the repo so the
// harness can import the REAL planCardContent + i18n from src/).
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
function staticServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(rootDir, urlPath.replace(/^\/+/, ""));
      if (!file.startsWith(rootDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}
const HARNESS = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: "Plus Jakarta Sans"; font-style: normal; font-weight: 200 800; font-display: swap; src: url("/fonts/plus-jakarta-sans-latin.woff2") format("woff2"); }
body { margin: 0; background: #888; }
</style></head><body><script type="module">
import { planCardContent } from "/src/sharecard.js";
import { t } from "/src/i18n.js";
window.__checkCard = async (dataUrl, scoreText, verdictWord) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const mctx = document.createElement("canvas").getContext("2d");
  const measure = (text, f) => { mctx.font = f; return mctx.measureText(text).width; };
  const plan = planCardContent({
    quote: "x", summary: "x", flags: ["x"], next: "x",
    verdictWord, scoreLabel: t("cardRiskScore", "id"), scoreText, measure,
  });
  const px = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
  const near = (a, b, tol = 48) => Math.abs(a[0]-b[0]) <= tol && Math.abs(a[1]-b[1]) <= tol && Math.abs(a[2]-b[2]) <= tol;
  const rgb = [180, 35, 24]; // scam red
  const rowTop = 245, boxH = 139, boxBottom = rowTop + boxH;
  const boxX = plan.scoreBoxX, boxW = plan.scoreBoxW;
  const region = ctx.getImageData(boxX, rowTop, boxW, boxH + 13);
  const rpx = (x, y) => { const i = ((y - rowTop) * boxW + (x - boxX)) * 4; return [region.data[i], region.data[i + 1], region.data[i + 2]]; };
  let scoreInkMaxY = -1;
  for (let y = rowTop + 4; y <= boxBottom - 4; y++)
    for (let x = boxX + 20; x <= boxX + boxW - 21; x++)
      if (near(rpx(x, y), rgb) && y > scoreInkMaxY) scoreInkMaxY = y;
  let scoreInkMinX = Infinity, scoreInkMaxX = -Infinity;
  for (let y = rowTop + 40; y <= boxBottom - 16; y++) {
    let runStart = -1;
    const flush = (xEnd) => {
      if (runStart >= 0 && xEnd - runStart >= 5) {
        if (runStart < scoreInkMinX) scoreInkMinX = runStart;
        if (xEnd - 1 > scoreInkMaxX) scoreInkMaxX = xEnd - 1;
      }
      runStart = -1;
    };
    for (let x = boxX + 2; x <= boxX + boxW - 3; x++) {
      if (near(rpx(x, y), rgb)) { if (runStart < 0) runStart = x; }
      else flush(x);
    }
    flush(boxX + boxW - 2);
  }
  let scoreOverflow = false;
  for (let y = boxBottom + 3; y <= boxBottom + 12 && !scoreOverflow; y++)
    for (let x = boxX; x <= boxX + boxW; x++)
      if (near(rpx(x, y), rgb)) { scoreOverflow = true; break; }
  return { w: img.naturalWidth, h: img.naturalHeight, scoreInkMaxY, scoreOverflow,
    scoreBoxBottom: boxBottom, scoreInkMinX, scoreInkMaxX,
    scoreBoxLeft: boxX, scoreBoxRight: boxX + boxW };
};
window.__ready = true;
</script></body></html>`;

async function main() {
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForPort("127.0.0.1", PROXY_PORT);
  const server = await staticServer(ROOT);
  const harnessPort = server.address().port;
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    // ============ DESKTOP 1280 ============
    const d = await newPage(browser, { width: 1280, height: 900 });
    const page = d.page;
    await gotoLive(page);
    const bundle = await page.evaluate(() => {
      const s = [...document.querySelectorAll("script[src]")].map((e) => e.src);
      return s.find((x) => x.includes("index-")) || s.join(",");
    });
    check("live", "bundle is the new index-CWY5PMQb.js", bundle.includes("CWY5PMQb"), bundle);

    // M1 — fresh profile: stats dash + chart empty state with invitation.
    const statChecked = await page.locator("#stat-checked-num").textContent();
    check("M1", "personal stats show the honest dash on first visit", statChecked.trim() === "–", statChecked);
    const emptyVisible = await page.locator("#week-chart-empty").isVisible();
    const emptyText = await page.locator("#week-chart-empty").textContent();
    check("M1", "chart empty state is visible with an invitation to try an example",
      emptyVisible && /coba salah satu contoh/i.test(emptyText || ""), emptyText);
    check("M1", "try button is visible and labelled 'Coba contoh'",
      await page.locator("#week-chart-try-btn").isVisible() &&
      (await page.locator("#week-chart-try-btn").textContent()).trim() === "Coba contoh");
    await page.screenshot({ path: path.join(SHOTS, "minor-empty-1280.png") });
    await page.locator("#week-chart-try-btn").click();
    await page.waitForTimeout(900);
    const checkerInView = await page.evaluate(() => {
      const r = document.querySelector("#checker-heading").getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    });
    const inputFocused = await page.evaluate(() => document.activeElement && document.activeElement.id === "message-input");
    check("M1", "try button scrolls to the checker and focuses the input", checkerInView && inputFocused, `inView=${checkerInView} focused=${inputFocused}`);

    // Send button — code-only verdict expected in throttled headless.
    // #result unhides at once for the interim preview; the toast only
    // appears with the FINAL verdict (after the cloud attempt +
    // failover), so poll for it instead of reading once.
    await page.fill("#message-input", APK_TEXT);
    await page.waitForTimeout(400);
    await page.click("#check-btn");
    await page.locator("#result").waitFor({ state: "visible", timeout: 60000 });
    let toast1 = "";
    for (let i = 0; i < 120; i++) {
      toast1 = await toastText(page);
      if (/Pemeriksaan selesai/.test(toast1)) break;
      await page.waitForTimeout(500);
    }
    check("send", "check renders a final result card + completion toast",
      await page.locator("#result").isVisible() && /Pemeriksaan selesai/.test(toast1), toast1);
    const scoreMatch = toast1.match(/(\d+)\s*\/\s*100/);
    const liveScore = scoreMatch ? scoreMatch[1] : null;
    const liveWord = /Penipuan/.test(toast1) ? "PENIPUAN" : /Mencurigakan/.test(toast1) ? "MENCURIGAKAN" : "AMAN";

    // M2 — the × close hides the toast at once.
    await page.locator("#toast .toast-close").click();
    await page.waitForTimeout(500);
    check("M2", "× button hides the toast immediately", !(await toastVisible(page)));

    // M2 — auto-hide is ~3 s on a fresh check.
    await page.click("#check-btn");
    let t0 = -1;
    for (let i = 0; i < 100; i++) {
      if (await toastVisible(page)) { t0 = Date.now(); break; }
      await page.waitForTimeout(100);
    }
    check("M2", "second check shows the toast again", t0 > 0);
    let t1 = -1;
    if (t0 > 0) {
      await page.waitForTimeout(1200);
      const stillThere = await toastVisible(page);
      check("M2", "toast is still visible 1.2 s after showing (not instant)", stillThere);
      for (let i = 0; i < 60; i++) {
        if (!(await toastVisible(page))) { t1 = Date.now(); break; }
        await page.waitForTimeout(100);
      }
    }
    const elapsed = t0 > 0 && t1 > 0 ? t1 - t0 : -1;
    check("M2", "toast auto-hides in ~3 s (2–4.5 s)", elapsed >= 2000 && elapsed <= 4500, `elapsed=${elapsed}ms`);

    // M4 — copy link: a toast either way, never silent.
    await page.locator("#share-copy-btn").scrollIntoViewIfNeeded();
    await page.locator("#share-copy-btn").click();
    let copyToast = "";
    for (let i = 0; i < 30; i++) {
      copyToast = await toastText(page);
      if (/Tautan disalin|Gagal menyalin/.test(copyToast)) break;
      await page.waitForTimeout(100);
    }
    const copyLabel = await page.locator("#share-copy-btn").textContent();
    check("M4", "copy-link shows a toast (success or honest failure)",
      /Tautan disalin!|Gagal menyalin tautan/.test(copyToast), `toast=${copyToast} label=${copyLabel}`);

    // Card download — the LIVE button, real PNG, score ink inside the box.
    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await page.locator("#download-card-btn").click();
    const dl = await downloadPromise;
    const cardFile = path.join(SHOTS, "minor-live-card.png");
    await dl.saveAs(cardFile);
    const size = pngSize(cardFile);
    check("card", "card downloads as a 1080×1350 PNG", !!size && size.w === 1080 && size.h === 1350, JSON.stringify(size));
    // Pixel check via a harness page on the static server.
    const harnessFile = path.join(ROOT, "video/verify-scripts/minor-harness.html");
    fs.writeFileSync(harnessFile, HARNESS);
    const hp = await browser.newPage();
    await hp.goto(`http://127.0.0.1:${harnessPort}/video/verify-scripts/minor-harness.html`, { waitUntil: "load", timeout: 30000 });
    await hp.waitForFunction(() => window.__ready, null, { timeout: 15000 });
    const dataUrl = "data:image/png;base64," + fs.readFileSync(cardFile).toString("base64");
    const px = await hp.evaluate(([u, s, w]) => window.__checkCard(u, s, w), [dataUrl, liveScore || "75", liveWord]);
    check("card", "live card score ink is fully inside the box (vertical)",
      px.scoreInkMaxY > 0 && px.scoreInkMaxY <= px.scoreBoxBottom - 8 && !px.scoreOverflow,
      `inkMaxY=${px.scoreInkMaxY} boxBottom=${px.scoreBoxBottom} overflow=${px.scoreOverflow}`);
    check("card", "live card score ink is fully inside the box (horizontal)",
      px.scoreInkMinX >= px.scoreBoxLeft + 4 && px.scoreInkMaxX <= px.scoreBoxRight - 5,
      `inkX=${px.scoreInkMinX}..${px.scoreInkMaxX} boxX=${px.scoreBoxLeft}..${px.scoreBoxRight}`);
    await hp.close();
    fs.unlinkSync(harnessFile);

    // PDF — stub window.print (the native dialog blocks automation),
    // click the button, then print the page to PDF and count pages.
    await page.evaluate(() => { window.print = () => { window.__printCalled = true; }; });
    await page.locator("#pdf-btn").click();
    await page.waitForTimeout(600);
    const printCalled = await page.evaluate(() => !!window.__printCalled);
    check("pdf", "PDF button fills the report and calls print", printCalled);
    const pdfFile = path.join(SHOTS, "minor-live-report.pdf");
    await page.pdf({ format: "A4", preferCSSPageSize: true, path: pdfFile });
    let pages = -1;
    try { pages = parseInt(execFileSync("pdfinfo", [pdfFile]).toString().match(/Pages:\s*(\d+)/)[1], 10); } catch (_) {}
    check("pdf", "live printout is exactly 1 A4 page", pages === 1, `pages=${pages}`);
    try { execFileSync("pdftoppm", ["-png", "-r", "72", "-f", "1", "-singlefile", pdfFile, path.join(SHOTS, "minor-live-report-page-1")]); } catch (_) {}

    // ============ MOBILE 390 — smoke ============
    const m = await newPage(browser, { width: 390, height: 844 });
    const mp = m.page;
    await gotoLive(mp);
    check("M1-m", "mobile: chart empty state + try button visible",
      await mp.locator("#week-chart-empty").isVisible() && await mp.locator("#week-chart-try-btn").isVisible());
    await mp.fill("#message-input", APK_TEXT);
    await mp.waitForTimeout(400);
    await mp.click("#check-btn");
    await mp.locator("#result").waitFor({ state: "visible", timeout: 60000 });
    let mToast = "";
    for (let i = 0; i < 120; i++) {
      mToast = await toastText(mp);
      if (/Pemeriksaan selesai/.test(mToast)) break;
      await mp.waitForTimeout(500);
    }
    check("send-m", "mobile: check renders a final result + toast",
      await mp.locator("#result").isVisible() && /Pemeriksaan selesai/.test(mToast), mToast);
    await mp.locator("#toast .toast-close").click();
    await mp.waitForTimeout(500);
    check("M2-m", "mobile: × hides the toast", !(await toastVisible(mp)));
    const overflow = await mp.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const out = [];
      document.querySelectorAll("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 2 && getComputedStyle(el).position !== "fixed") out.push(el.tagName);
      });
      return out.slice(0, 5);
    });
    check("M1-m", "mobile: no horizontal overflow with the empty state", overflow.length === 0, overflow.join(","));
    await mp.screenshot({ path: path.join(SHOTS, "minor-empty-390.png") });
  } finally {
    await browser.close().catch(() => {});
    server.close();
    proxyProc.kill("SIGTERM");
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) { console.log("FAILED: " + failed.map((r) => r.name).join(", ")); process.exit(1); }
}

main().catch((err) => { console.error("VERIFY SCRIPT ERROR:", err); process.exit(1); });
