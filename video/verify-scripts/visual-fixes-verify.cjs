// VISUAL FIXES VERIFICATION (21 Nov 2026) — 3 temuan verifikasi live:
// A. Judul hero EN tumpang tindih (kotak "a scam?" menutupi ekor "g"
//    "message") — line-height hero gelap 0.98 -> 1.12.
// B. Label tab "Fitur lainnya" terpotong di desktop — baris tab kini
//    membungkus pada lebar >=1024px.
// C. Contoh menampilkan kode OTP lengkap — preview contoh kini
//    disamarkan (maskSensitive), isi tempel tetap asli.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/visual-fixes-verify.cjs
// Exit 0 only when all checks pass.
const fs = require("fs");
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
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
}
const KNOWN_SANDBOX_NOISE = [/ERR_TUNNEL_CONNECTION_FAILED/, /status of 403/, /App Check could not obtain a token/, /requestStorageAccess/];
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

// Geometric hero check, done right: Range rects of a whole title cover
// the font's full ascent+descent, so whole-line rects "overlap" even
// when nothing is covered. Instead, test per CHARACTER: a descender
// glyph (g j p q y , ;) on a line above the keyword whose own rect
// intersects the keyword highlight box is really being painted over.
// Non-descender letters are skipped — their ink never reaches the box.
async function heroCheck(page) {
  return page.evaluate(() => {
    const title = document.querySelector(".hero-title");
    if (!title) return { error: "no .hero-title" };
    const cs = getComputedStyle(title);
    const kw = title.querySelector(".hero-keyword");
    if (!kw) return { error: "no .hero-keyword" };
    const kwRect = kw.getBoundingClientRect();
    const hits = [];
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (kw.contains(node)) continue; // the keyword's own text is inside the box by design
      const text = node.textContent;
      for (let i = 0; i < text.length; i++) {
        if (!/[gjpqy,;]/.test(text[i])) continue;
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        for (const r of Array.from(range.getClientRects())) {
          const overlapX = r.left < kwRect.right - 0.5 && r.right > kwRect.left + 0.5;
          const overlapY = r.top < kwRect.bottom - 0.5 && r.bottom > kwRect.top + 0.5;
          if (overlapX && overlapY) {
            hits.push({ ch: text[i], x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
          }
        }
      }
    }
    return {
      lineHeight: cs.lineHeight, fontSize: cs.fontSize,
      kwRect: { top: Math.round(kwRect.top), bottom: Math.round(kwRect.bottom), left: Math.round(kwRect.left), right: Math.round(kwRect.right) },
      hits,
    };
  });
}

async function tabsCheck(page, desktop) {
  return page.evaluate((desktop) => {
    const bar = document.querySelector(".module-tabs");
    if (!bar) return { error: "no .module-tabs" };
    const br = bar.getBoundingClientRect();
    const btns = Array.from(bar.querySelectorAll(".module-tab-btn")).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        label: b.textContent.trim(),
        left: Math.round(r.left), right: Math.round(r.right),
        inside: r.left >= br.left - 1 && r.right <= br.right + 1,
        truncated: b.scrollWidth > b.clientWidth + 1,
      };
    });
    return {
      barLeft: Math.round(br.left), barRight: Math.round(br.right),
      scrollW: bar.scrollWidth, clientW: bar.clientWidth,
      noScrollNeeded: bar.scrollWidth <= bar.clientWidth + 1,
      btns,
    };
  }, desktop);
}

async function samplesCheck(page) {
  return page.evaluate(() => {
    const previews = Array.from(document.querySelectorAll(".sample-preview")).map((el) => el.textContent);
    const labels = Array.from(document.querySelectorAll(".sample-label")).map((el) => el.textContent);
    const digitRun = /\d{4,}/;
    return {
      previews, labels,
      anyDigitRun: previews.some((p) => digitRun.test(p)),
      otpMasked: previews.some((p) => p.includes("••••••")),
      has482916: previews.some((p) => p.includes("482916")),
    };
  });
}

function overflowReport(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const bad = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > vw + 1 && !["HTML", "BODY"].includes(el.tagName)) {
        bad.push(`${el.tagName} w=${Math.round(r.width)}`);
      }
    });
    return { vw, docOverflow: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 5) };
  });
}

(async () => {
  const { proxyProc, viteProc } = await startServers();
  const browser = await chromium.launch({
    // Same as final-verify.cjs: proxy via launch arg, NOT Playwright's
    // `proxy` option — the latter routes localhost dev-server traffic
    // through the forwarder (ERR_EMPTY_RESPONSE), the flag lets
    // Chromium reach 127.0.0.1 directly.
    args: [`--proxy-server=http://127.0.0.1:${PROXY_PORT}`],
    ignoreHTTPSErrors: true,
  });
  const pageErrors = [];
  try {
    const widths = [390, 768, 1280, 1919];
    for (const theme of ["dark", "light"]) {
      for (const lang of ["en", "id"]) {
        for (const w of widths) {
          const ctx = await browser.newContext({
            viewport: { width: w, height: 900 },
            deviceScaleFactor: 1,
            locale: lang === "id" ? "id-ID" : "en-US",
          });
          await ctx.addInitScript(({ lang, theme }) => {
            try {
              localStorage.setItem("pesanaman_lang", lang);
              localStorage.setItem("pesanaman_theme", theme);
              localStorage.setItem("tipucek_onboarding_seen", "1");
            } catch (_) {}
          }, { lang, theme });
          const page = await ctx.newPage();
          page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(`${theme}/${lang}/${w}: ${String(e).slice(0, 160)}`); });
          page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(`${theme}/${lang}/${w} console: ${m.text().slice(0, 160)}`); });
          await page.goto(DEV, { waitUntil: "networkidle", timeout: 30000 });
          await dismissOnboarding(page);
          await page.waitForTimeout(400);

          const hero = await heroCheck(page);
          const heroOk = !hero.error && hero.hits.length === 0;
          check(`A hero no-overlap ${theme}/${lang}/${w}`, heroOk,
            hero.error || `lh=${hero.lineHeight} kw=${JSON.stringify(hero.kwRect)} covered=${JSON.stringify(hero.hits)}`);

          const ov = await overflowReport(page);
          check(`overflow ${theme}/${lang}/${w}`, ov.docOverflow <= 1 && ov.bad.length === 0,
            `docOverflow=${ov.docOverflow} bad=${ov.bad.join(",")}`);

          // Screenshots (required set + extras)
          if (theme === "dark" && lang === "en" && w === 390) {
            await page.screenshot({ path: path.join(SHOTS, "hero-en-fix-390.png") });
          }
          if (theme === "dark" && lang === "en" && w === 1280) {
            const title = page.locator(".hero-title");
            await title.screenshot({ path: path.join(SHOTS, "hero-en-fix-1280.png") });
          }
          await ctx.close();
        }
      }
    }

    // B. Module tabs — desktop must show every label without scrolling.
    for (const w of [1280, 1919]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: "id-ID" });
      await ctx.addInitScript(() => {
        try { localStorage.setItem("pesanaman_lang", "id"); localStorage.setItem("pesanaman_theme", "dark"); localStorage.setItem("tipucek_onboarding_seen", "1"); } catch (_) {}
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(`tabs/${w}: ${String(e).slice(0, 160)}`); });
      await page.goto(DEV, { waitUntil: "networkidle", timeout: 30000 });
      await dismissOnboarding(page);
      await page.waitForTimeout(300);
      const t = await tabsCheck(page, true);
      const allInside = t.btns.every((b) => b.inside) && !t.btns.some((b) => b.truncated);
      check(`B tabs all visible, no scroll ${w}`, !t.error && t.noScrollNeeded && allInside,
        t.error || `scrollW=${t.scrollW} clientW=${t.clientW} labels=[${t.btns.map((b) => b.label + (b.inside ? "" : "!OUT") + (b.truncated ? "!TRUNC" : "")).join(" | ")}]`);
      if (w === 1280) {
        const bar = page.locator(".module-tabs");
        await bar.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(SHOTS, "tabs-desktop-fix-1280.png") });
      }
      await ctx.close();
    }
    // B (mobile): labels must not be internally truncated (scroll row is allowed).
    for (const w of [390, 768]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, locale: "id-ID" });
      await ctx.addInitScript(() => {
        try { localStorage.setItem("pesanaman_lang", "id"); localStorage.setItem("pesanaman_theme", "dark"); localStorage.setItem("tipucek_onboarding_seen", "1"); } catch (_) {}
      });
      const page = await ctx.newPage();
      await page.goto(DEV, { waitUntil: "networkidle", timeout: 30000 });
      await dismissOnboarding(page);
      const t = await tabsCheck(page, false);
      check(`B tabs not truncated (mobile scroll ok) ${w}`, !t.error && !t.btns.some((b) => b.truncated),
        t.error || `labels=[${t.btns.map((b) => b.label).join(" | ")}]`);
      await ctx.close();
    }

    // C. Samples masked in display, original text still pasted.
    for (const lang of ["en", "id"]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, locale: lang === "id" ? "id-ID" : "en-US" });
      await ctx.addInitScript(({ lang }) => {
        try { localStorage.setItem("pesanaman_lang", lang); localStorage.setItem("pesanaman_theme", "dark"); localStorage.setItem("tipucek_onboarding_seen", "1"); } catch (_) {}
      }, { lang });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(`samples/${lang}: ${String(e).slice(0, 160)}`); });
      await page.goto(DEV, { waitUntil: "networkidle", timeout: 30000 });
      await dismissOnboarding(page);
      await page.waitForTimeout(300);
      const s = await samplesCheck(page);
      check(`C samples masked in list ${lang}`, !s.anyDigitRun && !s.has482916 && s.otpMasked,
        `previews=[${s.previews.join(" ‖ ").slice(0, 200)}]`);
      // Click the OTP sample: the pasted input must still hold the original.
      const otpLabel = lang === "id" ? "Peringatan OTP bank palsu" : "Fake bank OTP warning";
      const btn = page.locator(".sample-btn", { hasText: otpLabel }).first();
      await btn.scrollIntoViewIfNeeded();
      await btn.click();
      await page.waitForTimeout(300);
      const pasted = await page.locator("#message-input").inputValue();
      check(`C OTP click pastes original text ${lang}`, pasted.includes("482916") && /0812[- ]?9876[- ]?5432/.test(pasted),
        `pasted=${pasted.slice(0, 80)}`);
      if (lang === "id") {
        const samples = page.locator("#samples");
        await samples.scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(SHOTS, "contoh-samar-390.png") });
      }
      await ctx.close();
    }

    check("0 page errors (non-sandbox)", pageErrors.length === 0, pageErrors.slice(0, 3).join(" ;; "));
  } finally {
    await browser.close().catch(() => {});
    try { proxyProc.kill("SIGKILL"); } catch (_) {}
    try { viteProc.kill("SIGKILL"); } catch (_) {}
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${failed.length} failed`);
  if (failed.length) failed.forEach((r) => console.log(`FAILED: ${r.name}`));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("VERIFY CRASH:", e); process.exit(2); });
