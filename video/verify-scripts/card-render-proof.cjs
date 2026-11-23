#!/usr/bin/env node
// CARD-RENDER PROOF (Variant A "Resmi", 21 Nov 2026) — renders the REAL
// buildWarningCard() from src/sharecard.js in Chromium (Playwright) and
// the REAL fillPrintReport() through the built app UI (code-only verdict,
// AI endpoints blocked), then saves the artifacts for human inspection.
// No deploy, no network AI, no edits to the app.
// Usage: node video/verify-scripts/card-render-proof.cjs
// Exit 0 only when every check passes.
//
// Part 2 serves the app from a FRESH build (npm run build first) via
// `vite preview` on port 5199. It does NOT use `vite dev`: the dev
// server spawn proved unreliable here — a vite from a killed run held
// port 5199 without responding, and `npx vite` spawns a child vite
// that survives SIGTERM to npx, orphaning it. Preview is spawned
// directly as a node process, any stale vite on the port is cleared
// first, and the script waits until the server really answers (HTTP
// 200) before any page.goto — on failure it prints the server log
// and stops instead of navigating at a dead server.
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.join(process.env.HOME, "workspace/pesanaman");
const SHOTS = path.join(ROOT, "video/panel-lainnya-shots");
const PLAYWRIGHT = path.join(process.env.HOME, "workspace/tools/rekam-layar/node_modules/playwright");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
}

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function staticServer(rootDir, aliases = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      let rel = aliases[urlPath] || urlPath.replace(/^\/+/, "");
      const file = path.join(rootDir, rel);
      if (!file.startsWith(rootDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404);
        res.end("not found");
        return;
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
import { buildWarningCard, planCardContent } from "/src/sharecard.js";
import { t } from "/src/i18n.js";
const stringsFor = (lang, status) => ({
  subtitle: t("tagline", lang),
  statusLabel: t({ safe: "statusSafe", suspicious: "statusSuspicious", scam: "statusScam" }[status], lang),
  resultHeading: t("cardResultHeading", lang),
  riskScoreLabel: t("cardRiskScore", lang),
  checkedMessageLabel: t("headingCheckedMessage", lang),
  summaryLabel: t("headingSummary", lang),
  actionsLabel: t("headingActions", lang),
  riskLine: t({ scam: "riskScam", suspicious: "riskSuspicious", safe: "riskSafe" }[status], lang),
  next: t({ scam: "nextScam", suspicious: "nextSuspicious", safe: "nextSafe" }[status], lang),
  flagsTitle: t("redFlags", lang),
  footerNote: t("cardFooterNote", lang),
});
const SCAM = {
  status: "scam", riskScore: 95,
  redFlags: ["Hadiah undian palsu", "Impersonasi Telkomsel", "Batas waktu mendesak"],
  summary: "Pesan ini adalah penipuan klasik yang menjanjikan hadiah besar dari Telkomsel dengan batas waktu mendesak untuk menipu korban.",
  message: "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klaim hadiah Anda sebelum 24 jam.",
  dateStr: "21 November 2026",
};
const SAFE = {
  status: "safe", riskScore: 0, redFlags: [],
  summary: "Pesan ini adalah komunikasi internal kantor yang wajar mengenai penjadwalan ulang rapat dan tidak mengindikasikan adanya penipuan.",
  message: "Hai Budi, ini Sari dari kantor. Rapat tim dipindah ke hari Kamis pukul 10.00 di ruang 3B. Tolong bawa laporan Q3 ya. Sampai jumpa di sana!",
  dateStr: "21 November 2026",
};
const HUNDRED = {
  status: "scam", riskScore: 100,
  redFlags: ["Hadiah undian palsu", "Impersonasi Telkomsel", "Batas waktu mendesak"],
  summary: "Pesan ini adalah penipuan klasik yang menjanjikan hadiah besar dari Telkomsel dengan batas waktu mendesak untuk menipu korban.",
  message: "SELAMAT! Anda memenangkan hadiah Rp 100.000.000 dari undian Telkomsel. Segera klaim hadiah Anda sebelum 24 jam.",
  dateStr: "21 November 2026",
};
const STATUS_RGB = { scam: [180, 35, 24], safe: [6, 118, 71] };
async function toDataUrl(blob) {
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}
async function samplePixels(dataUrl, plan, rgb) {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const px = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]]; };
  const near = (a, b, tol = 12) => Math.abs(a[0]-b[0]) <= tol && Math.abs(a[1]-b[1]) <= tol && Math.abs(a[2]-b[2]) <= tol;
  // Logo tile: any near-white pixel inside the 96x96 tile (the T).
  let logoWhite = false;
  for (let x = 70; x < 155; x += 4) for (let y = 42; y < 126; y += 4) {
    if (near(px(x, y), [255, 255, 255], 30)) logoWhite = true;
  }
  // Score-box ink scan (21 Nov 19:06): the 84px number used to cross
  // the box's bottom edge. The box is at rowTop 245 (body top 204 +
  // eyebrow 23 + gap 18), 139px tall. Scan the box interior (one
  // getImageData for the region) for status-colour ink: the lowest
  // ink row must sit at least 8px above the box bottom edge, and no
  // status-colour ink may appear below the edge at all (the 2px
  // border stroke ends at boxBottom+1, so the band starts at +3).
  // Only the CENTRAL band of the box is scanned (20px inset each
  // side): the 2px border stroke — including its rounded corners,
  // which reach y=380 at the edges — is status-coloured too and
  // would otherwise set the "lowest ink row" by itself. The digits
  // and the /100 are centred, so their lowest row is still caught;
  // the "SKOR RISIKO" label at the top of the box is also in the
  // band, but its bottom (~274) sits above the digits' bottom.
  const rowTop = 245, boxH = 139, boxBottom = rowTop + boxH;
  const boxX = plan.scoreBoxX, boxW = plan.scoreBoxW;
  const region = ctx.getImageData(boxX, rowTop, boxW, boxH + 13);
  const rpx = (x, y) => { const i = ((y - rowTop) * boxW + (x - boxX)) * 4; return [region.data[i], region.data[i + 1], region.data[i + 2]]; };
  let scoreInkMaxY = -1;
  for (let y = rowTop + 4; y <= boxBottom - 4; y++) {
    for (let x = boxX + 20; x <= boxX + boxW - 21; x++) {
      if (near(rpx(x, y), rgb, 48) && y > scoreInkMaxY) scoreInkMaxY = y;
    }
  }
  // Horizontal fit (21 Nov 19:06): the number was drawn with the
  // label's textAlign "center" still on, so "100" stuck ~50px out
  // of the box's left edge. In the digit band (below the label,
  // above the bottom corners) find the leftmost/rightmost digit
  // ink: runs of >= 5px exclude the 2px border strokes, and the
  // x-range is the box interior, so the red verdict word / risk
  // line on the left of the card cannot leak in. The muted "/100"
  // is grey, so only the digits count here.
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
      if (near(rpx(x, y), rgb, 48)) { if (runStart < 0) runStart = x; }
      else flush(x);
    }
    flush(boxX + boxW - 2);
  }
  let scoreOverflow = false;
  for (let y = boxBottom + 3; y <= boxBottom + 12 && !scoreOverflow; y++) {
    for (let x = boxX; x <= boxX + boxW; x++) {
      if (near(rpx(x, y), rgb, 48)) { scoreOverflow = true; break; }
    }
  }
  return {
    w: img.naturalWidth, h: img.naturalHeight,
    headerNavy: near(px(540, 80), [15, 42, 77]),
    goldRule: near(px(540, 167), [201, 162, 39]),
    bodyWhite: near(px(540, 600), [255, 255, 255]),
    logoWhite,
    scoreInkMaxY,
    scoreOverflow,
    scoreBoxBottom: boxBottom,
    scoreInkMinX,
    scoreInkMaxX,
    scoreBoxLeft: boxX,
    scoreBoxRight: boxX + boxW,
  };
}
try {
  await document.fonts.ready;
  const mctx = document.createElement("canvas").getContext("2d");
  const measure = (text, f) => { mctx.font = f; return mctx.measureText(text).width; };
  const out = {};
  for (const [key, verdict] of [["scam", SCAM], ["safe", SAFE], ["hundred", HUNDRED]]) {
    const strings = stringsFor("id", verdict.status);
    const blob = await buildWarningCard({ ...verdict, strings });
    const dataUrl = await toDataUrl(blob);
    const plan = planCardContent({
      quote: verdict.message, summary: verdict.summary, flags: verdict.redFlags,
      next: strings.next, verdictWord: strings.statusLabel.toUpperCase(),
      scoreLabel: strings.riskScoreLabel, scoreText: String(verdict.riskScore), measure,
    });
    out[key] = { dataUrl, ...(await samplePixels(dataUrl, plan, STATUS_RGB[verdict.status])) };
  }
  window.__cards = out;
  window.__done = true;
} catch (err) {
  window.__error = String(err && err.message || err);
  window.__done = true;
}
</script></body></html>`;

async function main() {
  const { chromium } = require(PLAYWRIGHT);
  const { spawn, execFileSync } = require("child_process");

  // Build first so dist/ matches the current src/ (builds work again
  // since the EPERM wave lifted 21 Nov 18:32). Fail fast with the
  // build log instead of proving a stale dist/.
  try {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, stdio: "pipe" });
    console.log("build OK (dist/ fresh)");
  } catch (err) {
    console.log("BUILD FAILED:\n" + String(err.stdout || "") + String(err.stderr || ""));
    throw new Error("npm run build failed — dist/ is not fresh, cannot prove the app");
  }

  // Server A: repo root (harness + /src + /public aliases).
  const serverA = await staticServer(ROOT, {
    "/logo-mark.svg": "public/logo-mark.svg",
    "/fonts/plus-jakarta-sans-latin.woff2": "public/fonts/plus-jakarta-sans-latin.woff2",
  });
  // The harness is served from a route, not a file: patch it in.
  const harnessHandler = serverA.listeners("request")[0];
  serverA.removeAllListeners("request");
  serverA.on("request", (req, res) => {
    if (req.url.split("?")[0] === "/__harness.html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(HARNESS);
      return;
    }
    harnessHandler(req, res);
  });
  const portA = serverA.address().port;

  // App server: `vite preview` from the fresh dist/ on port 5199.
  // Clear any stale vite on that port first: the 19:05 run left a
  // vite behind that holds the port without answering, and a new
  // --strictPort server would fail to bind. The [v]ite trick keeps
  // pkill from matching its own command line. The preview is spawned
  // directly as a node process (no npx wrapper) so killing it kills
  // the real server, and its stdio goes to a log file (an unconsumed
  // pipe can block the child) for diagnosis on failure.
  const PREVIEW_PORT = 5199;
  const PREVIEW_LOG = "/tmp/card-proof-preview.log";
  try {
    execFileSync("pkill", ["-f", "[v]ite --port 5199"], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 1000));
  } catch {
    /* nothing stale to kill */
  }
  const previewLogFd = fs.openSync(PREVIEW_LOG, "w");
  const preview = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    { cwd: ROOT, stdio: ["ignore", previewLogFd, previewLogFd] },
  );
  const waitPreview = async () => {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const ok = await new Promise((resolve) => {
        http
          .get(`http://127.0.0.1:${PREVIEW_PORT}/`, (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode === 200));
          })
          .on("error", () => resolve(false));
      });
      if (ok) return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  };
  const previewUp = await waitPreview();
  check("p5 vite preview server is up (built dist/)", previewUp);
  if (!previewUp) {
    preview.kill("SIGTERM");
    fs.closeSync(previewLogFd);
    let log = "";
    try {
      log = fs.readFileSync(PREVIEW_LOG, "utf8").slice(-2000);
    } catch {
      /* no log */
    }
    throw new Error("vite preview never answered on 5199. Log tail:\n" + log);
  }

  // VM Chromium crashes with SIGTRAP on launch intermittently
  // (known since 21 Nov 12:36 WIB, recovered 15:47, flaky since) —
  // retry the launch a few times before giving up.
  let browser = null;
  for (let attempt = 1; attempt <= 3 && !browser; attempt++) {
    try {
      browser = await chromium.launch({ args: ["--no-sandbox"] });
    } catch (err) {
      console.log(`chromium launch attempt ${attempt} failed: ${String(err.message || err).slice(0, 120)}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (!browser) throw new Error("Chromium would not launch after 3 attempts (SIGTRAP)");
  try {
    // ---- Part 1: real card renders -------------------------------
    const page = await browser.newPage({ viewport: { width: 1200, height: 1500 } });
    await page.goto(`http://127.0.0.1:${portA}/__harness.html`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 30000 });
    const err = await page.evaluate(() => window.__error || null);
    check("p0 harness rendered all three cards without error", !err, err || "");
    if (!err) {
      const cards = await page.evaluate(() => {
        const out = {};
        for (const [k, v] of Object.entries(window.__cards)) {
          out[k] = { ...v, dataUrl: undefined };
          out[k + "Url"] = v.dataUrl;
        }
        return out;
      });
      const CARD_FILES = { scam: "card-scam-95.png", safe: "card-safe-0.png", hundred: "card-scam-100.png" };
      for (const key of ["scam", "safe", "hundred"]) {
        const c = cards[key];
        const file = path.join(SHOTS, CARD_FILES[key]);
        fs.writeFileSync(file, Buffer.from(cards[key + "Url"].split(",")[1], "base64"));
        check(`p1 ${key} card is 1080x1350`, c.w === 1080 && c.h === 1350, `${c.w}x${c.h}`);
        check(`p1b ${key} score number ink is fully inside the box (lowest ink row >= 8px above the bottom edge, no ink below the edge)`, c.scoreInkMaxY > 0 && c.scoreInkMaxY <= c.scoreBoxBottom - 8 && !c.scoreOverflow, `inkMaxY=${c.scoreInkMaxY} boxBottom=${c.scoreBoxBottom} overflow=${c.scoreOverflow}`);
        check(`p1c ${key} score number ink is fully inside the box horizontally (no ink past the side edges)`, c.scoreInkMinX >= c.scoreBoxLeft + 4 && c.scoreInkMaxX <= c.scoreBoxRight - 5, `inkX=${c.scoreInkMinX}..${c.scoreInkMaxX} boxX=${c.scoreBoxLeft}..${c.scoreBoxRight}`);
        check(`p2 ${key} card header is navy + gold rule`, c.headerNavy && c.goldRule);
        check(`p3 ${key} card body is white`, c.bodyWhite);
        check(`p4 ${key} card logo tile shows the white T`, c.logoWhite);
      }
    }
    await page.close();

    // ---- Part 2: real PDF report through the app -----------------
    // (The preview server was already proven up in p5 above — the
    // page.goto here never runs against a dead server.)
    const app = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // A fresh browser profile defaults to navigator.language (en-US
    // here), but the proof asserts the Indonesian strings — force ID
    // via the app's own language key before the app loads.
    await app.addInitScript(() => localStorage.setItem("pesanaman_lang", "id"));
    // AI endpoints blocked: the check must fall back to the
    // code-only verdict (a designed offline path), never hang.
    await app.route("**/*generativelanguage.googleapis.com/**", (route) => route.abort());
    await app.route("**/*vertexai.googleapis.com/**", (route) => route.abort());
    await app.route("**/*firebasevertexai.googleapis.com/**", (route) => route.abort());
    await app.goto(`http://127.0.0.1:${PREVIEW_PORT}/`, { waitUntil: "domcontentloaded" });
    await app.waitForSelector("#message-input", { timeout: 20000 });
    // First visit shows the 3-step onboarding overlay over the
    // composer — dismiss it like a real user before checking.
    const onboardShown = await app.evaluate(() => {
      const el = document.querySelector("#onboard");
      return Boolean(el && !el.hidden);
    });
    if (onboardShown) await app.click("#onboard-start");
    await app.fill(
      "#message-input",
      "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klaim hadiah Anda sebelum 24 jam.",
    );
    await app.click("#check-btn");
    await app.waitForSelector("#result:not([hidden])", { timeout: 60000 });
    // The first visible card is the on-device preliminary check
    // ("Cek awal di perangkat … Vonis AI masih dimuat"); the final
    // verdict card — the one with the PDF button — replaces it once
    // the code-only fallback resolves. Wait for that button, not
    // the prelim, and read the verdict off the final card.
    let pdfBtn = null;
    try {
      pdfBtn = await app.waitForSelector("#pdf-btn", { timeout: 60000 });
    } catch {
      pdfBtn = null;
    }
    // The code-only verdict for this short message is Mencurigakan
    // ~40/100 (no link/fee in it) — read the real verdict off the
    // card and expect the PDF to match it, whatever it is.
    const shown = await app.evaluate(() => {
      const el = document.querySelector("#result");
      const text = el ? el.innerText : "";
      const score = text.match(/(\d{1,3})\s*\/\s*100/);
      // Bilingual + case-insensitive: the verdict word depends on
      // the app locale (ID "Mencurigakan" / EN "Suspicious").
      const m = text.match(/penipuan|mencurigakan|aman|scam|suspicious|safe/i);
      return { text, score: score ? score[1] : "", status: m ? m[0] : "" };
    });
    check("p6 result card renders with a PDF button (code-only path)", !!pdfBtn && shown.status !== "", `status=${shown.status} score=${shown.score}`);
    if (pdfBtn) {
      await pdfBtn.click();
      await app.waitForTimeout(500);
      const printText = await app.evaluate(() => {
        const el = document.querySelector("#print-report");
        return el ? el.innerText : "";
      });
      check("p7 print report has the Variant A header + meta", printText.includes("Laporan Pemeriksaan Pesan") && printText.includes("Skor risiko") && printText.includes("Sumber vonis"));
      check("p8 print report matches the shown verdict", printText.toLowerCase().includes(shown.status.toLowerCase()) && shown.score !== "" && printText.includes(shown.score));
      // "resmi" alone is fine in advice ("verifikasi pengirim lewat
      // jalur resmi" — the SENDER's official channel, not TipuCek).
      // What is banned is presenting TipuCek or this report as an
      // official document/body ("DOKUMEN RESMI" and the like).
      check("p9 print report has no 'DOKUMEN RESMI' claim (TipuCek/report never presented as official)", !/DOKUMEN RESMI/i.test(printText) && !/dokumen resmi/i.test(printText) && !/laporan resmi/i.test(printText) && !/TipuCek[^.]{0,50}resmi/i.test(printText));
      check("p10 print report shows the checked message + footer note", printText.includes("SELAMAT!") && printText.includes("Dokumen ini dibuat otomatis oleh TipuCek"));
      await app.emulateMedia({ media: "print" });
      await app.waitForTimeout(300);
      // One-A4 check (21 Nov 19:06): the report must fit exactly one
      // A4 page. Two signals: the report's own height in print media
      // (printable height of A4 with 1cm margins is 1046px) and the
      // real page count of the generated PDF (pdfinfo).
      const reportH = await app.evaluate(() => {
        const el = document.querySelector("#print-report");
        return el ? el.getBoundingClientRect().height : 0;
      });
      check("p12 print report height fits one A4 page (<= 1046px printable)", reportH > 0 && reportH <= 1046, `height=${Math.round(reportH)}px`);
      await app.screenshot({ path: path.join(SHOTS, "pdf-report-print.png"), fullPage: true });
      const pdfPath = path.join(SHOTS, "pdf-report.pdf");
      await app.pdf({ path: pdfPath, format: "A4", printBackground: true });
      check("p11 print screenshot + real PDF saved", fs.existsSync(path.join(SHOTS, "pdf-report-print.png")) && fs.existsSync(pdfPath));
      let pdfPages = 0;
      try {
        const info = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" });
        pdfPages = Number((info.match(/Pages:\s*(\d+)/) || [])[1] || 0);
      } catch {
        /* pdfinfo missing — fall back to counting page objects */
        const buf = fs.readFileSync(pdfPath, "utf8");
        pdfPages = (buf.match(/\/Type\s*\/Page(?!s)/g) || []).length;
      }
      check("p13 PDF is exactly 1 A4 page (pdfinfo)", pdfPages === 1, `pages=${pdfPages}`);
      try {
        execFileSync("pdftoppm", ["-png", "-r", "100", "-f", "1", "-l", "1", pdfPath, path.join(SHOTS, "pdf-report-page")], { stdio: "pipe" });
      } catch {
        /* pdftoppm missing — the print screenshot is the visual check */
      }
      check("p14 PDF page 1 rendered to PNG for visual inspection", fs.existsSync(path.join(SHOTS, "pdf-report-page-1.png")));
    }
    await app.close();
  } finally {
    await browser.close();
    serverA.close();
    preview.kill("SIGTERM");
    fs.closeSync(previewLogFd);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("FAILED: " + failed.map((r) => r.name).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("RENDER PROOF ERROR:", err);
  process.exit(1);
});
