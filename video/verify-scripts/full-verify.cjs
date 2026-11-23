// FULL VERIFICATION (21 Nov 2026) — 0-findings sweep after the
// hamburger-removal restructure: 2 dashboards, 4x2 grid of 8 tools,
// one-line sticky header, Senior Mode in Riwayat Pengaturan.
// Covers: header (sticky + one line), grid 4x2, check (4 tabs, sample,
// paste, verdict), history dashboard (list/search/clear/badges/privacy/
// settings/Senior), theme, language ID/EN, Aman, share WA/TG, install
// card, FAQ, stats + 7-day chart, demo mode — at 390px + desktop,
// ID + EN, dark + light. Exit 0 only when ALL checks pass.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/full-verify.cjs
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/home/hatch/workspace/tools/rekam-layar/node_modules/playwright");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const SHOTS = path.join(ROOT, "video/panel-lainnya-shots");
const PROXY_PORT = 18098;
const DEMO_PORT = 5180;
const REAL_PORT = 5181;
const DEMO = `http://127.0.0.1:${DEMO_PORT}/`;
const REAL = `http://127.0.0.1:${REAL_PORT}/`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
}
const KNOWN_SANDBOX_NOISE = [
  /ERR_TUNNEL_CONNECTION_FAILED/, /status of 403/,
  /App Check could not obtain a token/, /appCheck\/fetch-status-error/,
  /Failed to load resource: the server responded with a status of 403/,
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
  const realProc = spawn(process.execPath, [path.join(ROOT, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(REAL_PORT), "--strictPort"], { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForPort("127.0.0.1", PROXY_PORT);
  await waitForPort("127.0.0.1", DEMO_PORT);
  await waitForPort("127.0.0.1", REAL_PORT);
  return { proxyProc, demoProc, realProc };
}

// Two seeded history entries (1 scam + 1 safe), dated today, so
// stats (2 checked, 1 caught) and the 7-day chart have real numbers.
// The scam entry uses the REAL first-sample text with the score the
// on-device heuristic actually derives for it (100) — CODE verdicts
// are re-derived from the message on every render (language fix
// 21 Nov 01:20), so an invented score would be overwritten on
// re-show and the test would lie.
const NOW = Date.now();
const SEED = [
  { id: "seed-1", message: "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!", status: "scam", riskScore: 100, redFlags: ["Hadiah palsu"], summary: "Penipuan hadiah.", source: "CODE", model: "", createdAt: new Date(NOW - 3600e3).toISOString() },
  { id: "seed-2", message: "Halo, rapat besok jam 9 di kantor ya.", status: "safe", riskScore: 5, redFlags: [], summary: "Pesan biasa.", source: "CODE", model: "", createdAt: new Date(NOW - 7200e3).toISOString() },
];
async function newPage(browser, { width, height = 844, seed = false, colorScheme = "dark", permissions = [] } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, locale: "id-ID", timezoneId: "Asia/Jakarta",
    colorScheme,
    permissions,
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    ignoreHTTPSErrors: true,
  });
  if (seed) {
    await ctx.addInitScript((entries) => {
      localStorage.setItem("pesanaman_history_v1", JSON.stringify(entries));
    }, SEED);
  }
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
  await page.waitForTimeout(500);
  const btn = page.locator("#onboard-start");
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
}
async function gotoLang(page, base, lang) {
  await page.goto(`${base}?lang=${lang}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1300);
  await dismissOnboarding(page);
}
// No horizontal overflow anywhere on the page, at the current viewport.
// Two intentional exceptions: the a11y skip-link (deliberately parked
// off-screen until focused) and elements inside a horizontally
// scrollable row (the checker tabs — reachable by swiping the row;
// the PAGE itself must never scroll sideways: docOverflow must be 0).
async function overflowCheck(page, label) {
  const ov = await page.evaluate(() => {
    const doc = document.documentElement;
    const bad = [];
    document.querySelectorAll("*").forEach((el) => {
      if (el.classList && el.classList.contains("skip-link")) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)) {
        let p = el.parentElement, contained = false;
        while (p && p !== document.body) {
          const ox = getComputedStyle(p).overflowX;
          if (ox === "auto" || ox === "scroll") { contained = true; break; }
          p = p.parentElement;
        }
        if (contained) return;
        const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").toString().slice(0, 60);
        bad.push(`${el.tagName}.${cls} L${Math.round(r.left)} R${Math.round(r.right)}`);
      }
    });
    return { docOverflow: doc.scrollWidth - window.innerWidth, bad: bad.slice(0, 5) };
  });
  check(`${label}: no horizontal overflow`, ov.docOverflow <= 0 && ov.bad.length === 0, JSON.stringify(ov));
}
// Header: sticky, one line, only logo + lang + theme + dot at 390px.
// (maxH: 64 at 390px, 72 on desktop — the desktop brand mark is 44px
// + padding, still a single row.)
async function headerCheck(page, label, maxH = 64) {
  const h = await page.evaluate(() => {
    const top = document.querySelector(".topbar");
    const inner = document.querySelector(".topbar-inner");
    const cs = getComputedStyle(top);
    const r = top.getBoundingClientRect();
    const innerR = inner.getBoundingClientRect();
    // An element counts as "in the header" only if it is actually
    // rendered there — a hidden element reports a 0x0 rect at 0,0,
    // which would pass a naive bounds check (caught 21 Nov: the
    // Senior button, moved to Dashboard 2, still "passed").
    const inHeader = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
    };
    const brand = document.querySelector(".brand").getBoundingClientRect();
    const status = document.querySelector(".topbar-status").getBoundingClientRect();
    return {
      position: cs.position, height: Math.round(r.height), innerHeight: Math.round(innerR.height),
      hasMenuBtn: !!document.querySelector("#menu-btn"),
      hasDrawer: !!document.querySelector("#sheet-more"),
      seniorInHeader: inHeader("#senior-toggle"),
      brandInHeader: inHeader(".brand"), langInHeader: inHeader(".lang-toggle"),
      themeInHeader: inHeader("#theme-btn"), dotInHeader: inHeader("#net-status"),
      topRow: Math.round(r.top),
      singleRow: Math.abs(Math.round(brand.top) - Math.round(status.top)) <= 8,
    };
  });
  check(`${label}: header position sticky`, h.position === "sticky", JSON.stringify(h));
  check(`${label}: no hamburger/drawer in DOM`, !h.hasMenuBtn && !h.hasDrawer, JSON.stringify(h));
  check(`${label}: header one line (height<=${maxH}px, single row)`, h.height <= maxH && h.singleRow, `height=${h.height} singleRow=${h.singleRow}`);
  check(`${label}: header holds brand+lang+theme+dot, no Senior btn`, h.brandInHeader && h.langInHeader && h.themeInHeader && h.dotInHeader && !h.seniorInHeader, JSON.stringify(h));
  return h;
}

// ---- A. Boot + header + sticky scroll (390, ID, dark, demo) ----
async function groupA(browser) {
  const { ctx, page, pageErrors } = await newPage(browser, { width: 390 });
  await gotoLang(page, DEMO, "id");
  await headerCheck(page, "A header 390 ID dark");
  // Header stays pinned at the top after scrolling down (Myuden 21 Nov
  // 13:03 — sticky, membatalkan static): rectTop 0, rectBottom > 0.
  await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
  await page.waitForTimeout(400);
  const scrolled = await page.evaluate(() => {
    const r = document.querySelector(".topbar").getBoundingClientRect();
    return { scrollY: Math.round(window.scrollY), rectTop: Math.round(r.top), rectBottom: Math.round(r.bottom) };
  });
  check("A header still pinned after scroll 1500px", scrolled.scrollY >= 1400 && scrolled.rectTop === 0 && scrolled.rectBottom > 0, JSON.stringify(scrolled));
  await page.screenshot({ path: path.join(SHOTS, "header-scroll-390.png") });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => {
    const r = document.querySelector(".topbar").getBoundingClientRect();
    return { rectTop: Math.round(r.top), rectBottom: Math.round(r.bottom) };
  });
  check("A header back in view at page top", back.rectTop === 0 && back.rectBottom > 0, JSON.stringify(back));
  await page.screenshot({ path: path.join(SHOTS, "tanpa-hamburger-390.png") });
  await overflowCheck(page, "A 390 ID dark");
  noErrors(pageErrors, "A 390 ID dark");
  await ctx.close();
}

// ---- B. Grid 4x2, 8 cards (390, ID, dark, demo) ----
const GRID_ORDER = ["link", "file", "chatlog", "report", "contacts", "aid", "quiz", "how"];
const PANEL_OF = { link: "linktrack", file: "filecheck", chatlog: "chatlog", report: "crowdreport", contacts: "contacts", aid: "firstaid", quiz: "quiz", how: "how" };
async function groupB(browser) {
  const { ctx, page, pageErrors } = await newPage(browser, { width: 390 });
  await gotoLang(page, DEMO, "id");
  await page.evaluate(() => document.querySelector(".modules").scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  const grid = await page.evaluate(() => {
    const g = document.querySelector(".module-tabs");
    const cs = getComputedStyle(g);
    const cards = [...document.querySelectorAll(".module-tab-btn")].map((b) => {
      const r = b.getBoundingClientRect();
      const name = b.querySelector(".module-tab-name");
      const nr = name.getBoundingClientRect();
      return {
        id: b.id.replace("module-tab-", ""),
        left: Math.round(r.left), right: Math.round(r.right),
        nameText: name.textContent.trim(),
        nameClipped: name.scrollWidth > name.clientWidth + 1,
        descHidden: getComputedStyle(b.querySelector(".module-tab-desc")).display === "none",
      };
    });
    return { columns: cs.gridTemplateColumns.split(" ").length, display: cs.display, cards };
  });
  check("B grid is 4 columns at 390px", grid.display === "grid" && grid.columns === 4, `display=${grid.display} cols=${grid.columns}`);
  check("B grid holds 8 cards in order", JSON.stringify(grid.cards.map((c) => c.id)) === JSON.stringify(GRID_ORDER), JSON.stringify(grid.cards.map((c) => c.id)));
  const out = grid.cards.filter((c) => c.left < 0 || c.right > 390);
  check("B all 8 cards fully inside the 390px viewport", out.length === 0, JSON.stringify(out));
  const clipped = grid.cards.filter((c) => c.nameClipped);
  check("B no card title clipped", clipped.length === 0, JSON.stringify(clipped));
  check("B descriptions hidden on phones (compact)", grid.cards.every((c) => c.descHidden), JSON.stringify(grid.cards.map((c) => c.descHidden)));
  await page.screenshot({ path: path.join(SHOTS, "grid-alat-390.png") });
  // Click every tool card: the right panel opens.
  for (const name of GRID_ORDER) {
    await page.evaluate((n) => document.querySelector(`#module-tab-${n}`).scrollIntoView({ block: "center" }), name);
    await page.waitForTimeout(250);
    await page.click(`#module-tab-${name}`);
    await page.waitForTimeout(500);
    const ok = await page.evaluate((pid) => {
      const p = document.querySelector(`#${pid}`);
      return p && !p.hidden;
    }, PANEL_OF[name]);
    const sel = await page.evaluate((n) => document.querySelector(`#module-tab-${n}`).getAttribute("aria-selected"), name);
    check(`B card ${name} opens its panel`, ok === true && sel === "true", `panel=${PANEL_OF[name]} hidden=${!ok} aria-selected=${sel}`);
  }
  // Riwayat's only entry now: the bottom nav (grid card removed
  // 21 Nov 11:22).
  await page.click("#nav-history");
  await page.waitForTimeout(500);
  const navHist = await page.evaluate(() => ({ homeHidden: document.querySelector("#view-home").hidden, histHidden: document.querySelector("#view-history").hidden }));
  check("B nav Riwayat opens Dashboard 2", !navHist.histHidden && navHist.homeHidden, JSON.stringify(navHist));
  await page.click("#nav-home");
  await page.waitForTimeout(500);
  const navBack = await page.evaluate(() => ({ homeHidden: document.querySelector("#view-home").hidden, histHidden: document.querySelector("#view-history").hidden }));
  check("B nav Beranda returns to Dashboard 1", !navBack.homeHidden && navBack.histHidden, JSON.stringify(navBack));
  // Keyboard: arrows walk the visual order. The Riwayat card was
  // removed from the grid (21 Nov 11:22), so the grid is 8 tabs:
  // ArrowRight from Kuis focuses Cara kerja, ArrowLeft returns.
  await page.evaluate(() => document.querySelector("#module-tab-quiz").focus());
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  let focused = await page.evaluate(() => document.activeElement.id);
  check("B ArrowRight from Kuis focuses Cara kerja", focused === "module-tab-how", `focused=${focused}`);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  focused = await page.evaluate(() => document.activeElement.id);
  check("B ArrowLeft from Cara kerja focuses Kuis", focused === "module-tab-quiz", `focused=${focused}`);
  await page.click("#nav-home");
  await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelector("#module-tab-quiz").focus());
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  focused = await page.evaluate(() => document.activeElement.id);
  check("B Home from Kuis focuses Cek Tautan", focused === "module-tab-link", `focused=${focused}`);
  await page.keyboard.press("End");
  await page.waitForTimeout(300);
  focused = await page.evaluate(() => document.activeElement.id);
  check("B End from Cek Tautan focuses Cara kerja", focused === "module-tab-how", `focused=${focused}`);
  await overflowCheck(page, "B 390 ID dark");
  noErrors(pageErrors, "B 390 ID dark");
  await ctx.close();
}

// ---- C. Check: 4 tabs, sample, paste, verdict (390, ID, dark, demo) ----
async function groupC(browser) {
  const { ctx, page, pageErrors } = await newPage(browser, {
    width: 390, permissions: ["clipboard-read", "clipboard-write"],
  });
  await gotoLang(page, DEMO, "id");
  // 4 checker tabs switch panels.
  const tabs = ["message", "email", "call", "outbound"];
  for (const t of tabs) {
    await page.click(`#tab-btn-${t}`);
    await page.waitForTimeout(300);
    const st = await page.evaluate((n) => ({
      sel: document.querySelector(`#tab-btn-${n}`).getAttribute("aria-selected"),
      panelHidden: document.querySelector(`#tab-${n}`).hidden,
    }), t);
    check(`C checker tab ${t} activates its panel`, st.sel === "true" && st.panelHidden === false, JSON.stringify(st));
  }
  await page.click("#tab-btn-message");
  await page.waitForTimeout(300);
  // Sample fills the input; checking it gives a scam verdict.
  await page.click("#samples .sample-btn");
  await page.waitForTimeout(300);
  const filled = await page.evaluate(() => document.querySelector("#message-input").value.length);
  check("C clicking a sample fills the input", filled > 20, `len=${filled}`);
  await page.click("#check-btn");
  try {
    await page.waitForFunction(() => {
      const r = document.querySelector("#result");
      return r && !r.hidden && document.querySelector(".result-status")?.textContent.trim().length > 0;
    }, undefined, { timeout: 45000 });
    const v = await page.evaluate(() => ({
      status: document.querySelector(".result-status")?.textContent.trim().slice(0, 60),
      score: document.querySelector(".ring-value strong")?.textContent.trim(),
      badges: [...document.querySelectorAll("#result .badge")].map((b) => b.textContent.trim()),
      flags: document.querySelectorAll("#result .flags li").length,
    }));
    check("C verdict shows status Penipuan for the scam sample", /Penipuan/i.test(v.status || ""), JSON.stringify(v));
    check("C verdict shows a numeric score", /^\d+$/.test(v.score || ""), JSON.stringify(v));
    check("C verdict badge is honest (demo, code-only)", v.badges.some((b) => /demo|kode/i.test(b)), JSON.stringify(v.badges));
    check("C verdict lists red flags", v.flags >= 1, `flags=${v.flags}`);
    await page.evaluate(() => document.querySelector(".checker").scrollIntoView({ block: "start" }));
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, "dashboard-check-390.png") });
  } catch (e) {
    check("C verdict appears within 45s", false, e.message.slice(0, 160));
  }
  // Paste button: clipboard text lands in the input — and the paste
  // auto-checks it (a safe text, so this is check #2).
  await page.evaluate(() => navigator.clipboard.writeText("Pesan tes tempel: kode OTP 123456 dari bank."));
  await page.click("#paste-btn");
  await page.waitForTimeout(400);
  const pasted = await page.evaluate(() => document.querySelector("#message-input").value);
  check("C paste button fills the input from clipboard", pasted.includes("kode OTP 123456"), pasted.slice(0, 60));
  await page.waitForFunction(() => /Aman/.test(document.querySelector(".result-status")?.textContent || ""), undefined, { timeout: 45000 });
  // Stats after both checks (1 scam + 1 safe): let the 600ms count
  // animation settle before reading.
  await page.waitForTimeout(900);
  const stats = await page.evaluate(() => ({
    checked: document.querySelector("#stat-checked-num")?.textContent.trim(),
    caught: document.querySelector("#stat-caught-num")?.textContent.trim(),
    caughtSub: document.querySelector("#stat-caught-sub")?.textContent.trim(),
  }));
  check("C stats count both checks (2 checked, 1 caught)", stats.checked === "2" && stats.caught === "1" && /dari 2 pesan/.test(stats.caughtSub || ""), JSON.stringify(stats));
  await overflowCheck(page, "C 390 ID dark");
  noErrors(pageErrors, "C 390 ID dark");
  await ctx.close();
}

// ---- D. Riwayat Dashboard 2 (390, ID, dark, demo, seeded) ----
async function groupD(browser) {
  const { ctx, page, pageErrors } = await newPage(browser, { width: 390, seed: true });
  await gotoLang(page, DEMO, "id");
  // Seeded stats: 2 checked, 1 caught; chart has today's bar.
  const seedStats = await page.evaluate(() => ({
    checked: document.querySelector("#stat-checked-num")?.textContent.trim(),
    caught: document.querySelector("#stat-caught-num")?.textContent.trim(),
    caughtSub: document.querySelector("#stat-caught-sub")?.textContent.trim(),
    bars: document.querySelectorAll("#week-chart-bars > *").length,
    emptyHidden: document.querySelector("#week-chart-empty")?.hidden,
  }));
  check("D seeded stats show 2 checked, 1 caught", seedStats.checked === "2" && seedStats.caught === "1" && /dari 2 pesan/.test(seedStats.caughtSub || ""), JSON.stringify(seedStats));
  check("D 7-day chart has bars for seeded history", seedStats.bars >= 1 && seedStats.emptyHidden === true, JSON.stringify(seedStats));
  // Open Dashboard 2 via the bottom nav.
  await page.click("#nav-history");
  await page.waitForTimeout(600);
  const view = await page.evaluate(() => ({
    homeHidden: document.querySelector("#view-home").hidden,
    histHidden: document.querySelector("#view-history").hidden,
    scrollY: Math.round(window.scrollY),
  }));
  check("D nav Riwayat opens Dashboard 2 full-page", !view.histHidden && view.homeHidden && view.scrollY === 0, JSON.stringify(view));
  // Back button (the desktop way home) also works on mobile.
  await page.click("#history-back-btn");
  await page.waitForTimeout(500);
  const backMobile = await page.evaluate(() => ({ homeHidden: document.querySelector("#view-home").hidden, histHidden: document.querySelector("#view-history").hidden }));
  check("D back button returns to Dashboard 1", !backMobile.homeHidden && backMobile.histHidden, JSON.stringify(backMobile));
  await page.click("#nav-history");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, "dashboard-riwayat-390.png") });
  // List shows both seeded rows; badges present.
  const list = await page.evaluate(() => ({
    rows: document.querySelectorAll("#history-list .history-item-btn").length,
    badges: document.querySelectorAll("#history-badges-grid .badge-tile").length,
    earned: document.querySelectorAll("#history-badges-grid .badge-tile.earned").length,
    emptyHidden: document.querySelector("#history-empty")?.hidden,
  }));
  check("D history list shows 2 seeded rows + badges", list.rows === 2 && list.badges >= 1 && list.earned >= 1 && list.emptyHidden === true, JSON.stringify(list));
  // Search filters.
  await page.fill("#history-search", "Telkomsel");
  await page.waitForTimeout(400);
  const filtered = await page.evaluate(() => document.querySelectorAll("#history-list .history-item-btn").length);
  check("D search 'Telkomsel' filters to 1 row", filtered === 1, `rows=${filtered}`);
  await page.fill("#history-search", "zzzz-tidak-ada");
  await page.waitForTimeout(400);
  const nomatch = await page.evaluate(() => ({
    rows: document.querySelectorAll("#history-list .history-item-btn").length,
    noMatchHidden: document.querySelector("#history-nomatch")?.hidden,
  }));
  check("D search with no match shows the empty note", nomatch.rows === 0 && nomatch.noMatchHidden === false, JSON.stringify(nomatch));
  await page.fill("#history-search", "");
  await page.waitForTimeout(400);
  // Tap a row: back to Dashboard 1 with the verdict card re-shown.
  // (CODE verdicts are re-derived from the message on render, so the
  // re-shown score is the heuristic's real score for the sample text:
  // 100 for the Telkomsel scam sample.)
  await page.evaluate(() => document.querySelector("#history-list .history-item-btn").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.click("#history-list .history-item-btn");
  await page.waitForTimeout(700);
  const reshow = await page.evaluate(() => ({
    homeHidden: document.querySelector("#view-home").hidden,
    resultHidden: document.querySelector("#result")?.hidden,
    status: document.querySelector(".result-status")?.textContent.trim().slice(0, 40),
    score: document.querySelector(".ring-value strong")?.textContent.trim(),
  }));
  check("D tapping a history row re-shows its verdict on Dashboard 1", !reshow.homeHidden && !reshow.resultHidden && /Penipuan/i.test(reshow.status || "") && reshow.score === "100", JSON.stringify(reshow));
  await page.click("#nav-history");
  await page.waitForTimeout(600);
  // Privacy: hide message text removes snippets.
  await page.click("#history-hide-on-btn");
  await page.waitForTimeout(400);
  const hidden2 = await page.evaluate(() => ({
    snippets: document.querySelectorAll("#history-list .history-text").length,
    stored: localStorage.getItem("tipucek_hide_history_text"),
  }));
  check("D 'Sembunyikan isi pesan' hides snippets + persists", hidden2.snippets === 0 && hidden2.stored === "1", JSON.stringify(hidden2));
  await page.click("#history-hide-off-btn");
  await page.waitForTimeout(400);
  // Privacy: save OFF means a new check is not stored.
  await page.click("#history-save-off-btn");
  await page.waitForTimeout(300);
  await page.click("#nav-home");
  await page.waitForTimeout(500);
  await page.click("#samples .sample-btn");
  await page.waitForTimeout(300);
  await page.click("#check-btn");
  await page.waitForFunction(() => {
    const r = document.querySelector("#result");
    return r && !r.hidden && document.querySelector(".result-status")?.textContent.trim().length > 0;
  }, undefined, { timeout: 45000 });
  const afterSaveOff = await page.evaluate(() => JSON.parse(localStorage.getItem("pesanaman_history_v1") || "[]").length);
  check("D 'Simpan riwayat' OFF: new check is not stored", afterSaveOff === 2, `stored=${afterSaveOff}`);
  await page.click("#nav-history");
  await page.waitForTimeout(600);
  await page.click("#history-save-on-btn");
  await page.waitForTimeout(300);
  // Pengaturan: text size Large changes the root font size.
  const sizeBefore = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  await page.click("[data-text-size-pick='large']");
  await page.waitForTimeout(300);
  const sizeAfter = await page.evaluate(() => ({
    attr: document.documentElement.dataset.textSize,
    font: getComputedStyle(document.documentElement).fontSize,
    stored: localStorage.getItem("pesanaman_text_size"),
  }));
  check("D text size Large applies + persists", sizeAfter.attr === "large" && sizeAfter.stored === "large" && sizeAfter.font !== sizeBefore, JSON.stringify(sizeAfter));
  await page.click("[data-text-size-pick='medium']");
  await page.waitForTimeout(300);
  // Pengaturan: Senior Mode ON — bigger text, light forced, theme btn disabled.
  await page.click("#senior-toggle");
  await page.waitForTimeout(500);
  const seniorOn = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains("senior-mode"),
    theme: document.documentElement.dataset.theme,
    themeBtnDisabled: document.querySelector("#theme-btn").disabled,
    pressed: document.querySelector("#senior-toggle").getAttribute("aria-pressed"),
    stored: localStorage.getItem("tipucek_senior_mode"),
    bodyFont: getComputedStyle(document.body).fontSize,
  }));
  check("D Senior Mode ON: bigger text + light forced + theme btn disabled", seniorOn.bodyClass && seniorOn.theme === "light" && seniorOn.themeBtnDisabled && seniorOn.pressed === "true" && seniorOn.stored === "1" && seniorOn.bodyFont === "19px", JSON.stringify(seniorOn));
  await page.screenshot({ path: path.join(SHOTS, "senior-mode-390.png") });
  await page.click("#nav-home");
  await page.waitForTimeout(500);
  const noteVisible = await page.evaluate(() => !document.querySelector("#senior-note")?.hidden);
  check("D Senior Mode shows the senior note on Dashboard 1", noteVisible === true, `visible=${noteVisible}`);
  await page.click("#nav-history");
  await page.waitForTimeout(600);
  await page.click("#senior-toggle");
  await page.waitForTimeout(500);
  const seniorOff = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains("senior-mode"),
    themeBtnDisabled: document.querySelector("#theme-btn").disabled,
    stored: localStorage.getItem("tipucek_senior_mode"),
  }));
  check("D Senior Mode OFF: back to normal", !seniorOff.bodyClass && !seniorOff.themeBtnDisabled && seniorOff.stored === "0", JSON.stringify(seniorOff));
  // Clear history (two-tap): empty state with dash + invitation.
  await page.evaluate(() => document.querySelector("#history-clear-btn").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.click("#history-clear-btn");
  await page.waitForTimeout(300);
  await page.click("#history-clear-btn");
  await page.waitForTimeout(600);
  const cleared = await page.evaluate(() => ({
    rows: document.querySelectorAll("#history-list .history-item-btn").length,
    emptyHidden: document.querySelector("#history-empty")?.hidden,
    emptyHintHidden: document.querySelector("#history-empty-hint")?.hidden,
    stored: localStorage.getItem("pesanaman_history_v1"),
  }));
  check("D clear history empties the list + shows the empty state", cleared.rows === 0 && cleared.emptyHidden === false && cleared.emptyHintHidden === false && (cleared.stored === null || cleared.stored === "[]"), JSON.stringify(cleared));
  await page.click("#nav-home");
  await page.waitForTimeout(600);
  const emptyStats = await page.evaluate(() => ({
    checked: document.querySelector("#stat-checked-num")?.textContent.trim(),
    caught: document.querySelector("#stat-caught-num")?.textContent.trim(),
    chartEmptyHidden: document.querySelector("#week-chart-empty")?.hidden,
  }));
  check("D after clear, stats show '–' + chart empty note", emptyStats.checked === "–" && emptyStats.caught === "–" && emptyStats.chartEmptyHidden === false, JSON.stringify(emptyStats));
  await overflowCheck(page, "D 390 ID dark");
  noErrors(pageErrors, "D 390 ID dark");
  await ctx.close();
}

// ---- E. Theme + language (390, demo) ----
async function groupE(browser) {
  const { ctx, page, pageErrors } = await newPage(browser, { width: 390 });
  await gotoLang(page, DEMO, "id");
  // Theme: Terang applies + persists across reload; Gelap back; icon swaps.
  await page.click("#theme-btn");
  await page.waitForTimeout(300);
  await page.click("[data-theme-pick='light']");
  await page.waitForTimeout(400);
  let theme = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    moonHidden: document.querySelector("#theme-icon-moon").hidden,
    sunHidden: document.querySelector("#theme-icon-sun").hidden,
    stored: localStorage.getItem("pesanaman_theme"),
  }));
  check("E theme Terang applies + icon swaps to sun", theme.theme === "light" && theme.moonHidden === true && theme.sunHidden === false && theme.stored === "light", JSON.stringify(theme));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await dismissOnboarding(page);
  const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
  check("E theme Terang persists across reload", persisted === "light", `theme=${persisted}`);
  await page.click("#theme-btn");
  await page.waitForTimeout(300);
  await page.click("[data-theme-pick='dark']");
  await page.waitForTimeout(400);
  theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check("E theme Gelap applies", theme === "dark", `theme=${theme}`);
  // Language EN: whole page switches — nav, hero, grid, settings.
  await page.click("#lang-en-btn");
  await page.waitForTimeout(600);
  const en = await page.evaluate(() => ({
    nav: [...document.querySelectorAll(".nav-item span, .nav-item")].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 2),
    navLabels: [...document.querySelectorAll("#nav-home, #nav-history")].map((e) => e.textContent.trim()),
    hero: document.querySelector(".hero-title")?.textContent.trim(),
    grid: [...document.querySelectorAll(".module-tab-name")].map((e) => e.textContent.trim()),
    settings: document.querySelector("#settings-view-title")?.textContent.trim(),
    docLang: document.documentElement.lang,
  }));
  check("E EN: nav labels Home/History", JSON.stringify(en.navLabels) === JSON.stringify(["Home", "History"]), JSON.stringify(en.navLabels));
  check("E EN: hero title in English", /scam/i.test(en.hero || "") && !/penipuan/i.test(en.hero || ""), en.hero);
  check("E EN: grid titles in English", JSON.stringify(en.grid) === JSON.stringify(["Check link", "Check file", "Check chat", "Report", "Official contacts", "Emergency guide", "Quiz", "How it works"]), JSON.stringify(en.grid));
  check("E EN: settings heading + html lang", en.settings === "Settings" && en.docLang === "en", JSON.stringify(en));
  await headerCheck(page, "E header 390 EN dark");
  await page.screenshot({ path: path.join(SHOTS, "header-en-390.png") });
  await overflowCheck(page, "E 390 EN dark");
  // Back to ID.
  await page.click("#lang-id-btn");
  await page.waitForTimeout(600);
  const id = await page.evaluate(() => ({
    navLabels: [...document.querySelectorAll("#nav-home, #nav-history")].map((e) => e.textContent.trim()),
    grid: [...document.querySelectorAll(".module-tab-name")].map((e) => e.textContent.trim()),
  }));
  check("E back to ID: nav + grid in Indonesian", JSON.stringify(id.navLabels) === JSON.stringify(["Beranda", "Riwayat"]) && JSON.stringify(id.grid) === JSON.stringify(["Cek Tautan", "Cek File", "Cek Chat", "Laporkan", "Kontak Resmi", "Panduan Darurat", "Kuis", "Cara kerja"]), JSON.stringify(id));
  noErrors(pageErrors, "E 390");
  await ctx.close();
}

// ---- F. Aman chat + FAB vs footer (390, demo + real) ----
async function groupF(browser) {
  // Demo mode: Aman answers honestly that AI is not connected.
  {
    const { ctx, page, pageErrors } = await newPage(browser, { width: 390 });
    await gotoLang(page, DEMO, "id");
    await page.click("#aman-fab", { force: true });
    await page.waitForTimeout(800);
    const open = await page.evaluate(() => !document.querySelector("#assistant")?.hidden);
    check("F demo: Aman panel opens", open === true, `open=${open}`);
    await page.fill("#assistant-input", "Halo, apa itu penipuan?");
    await page.click("#assistant-send");
    try {
      await page.waitForFunction(() => /mode demo/i.test(document.querySelector("#assistant-log")?.textContent || ""), undefined, { timeout: 45000 });
      check("F demo: Aman answers honestly (demo mode, no AI)", true, "");
    } catch (e) {
      const log = await page.evaluate(() => document.querySelector("#assistant-log")?.textContent.trim().slice(0, 200));
      check("F demo: Aman answers honestly (demo mode, no AI)", false, `log=${JSON.stringify(log)}`);
    }
    await page.click("#assistant-close");
    await page.waitForTimeout(400);
    noErrors(pageErrors, "F demo 390");
    await ctx.close();
  }
  // Real env: Aman must reply (real answer, or the honest failure +
  // "Coba lagi" — cloud is App-Check-blocked in this sandbox, so the
  // live browser check is what proves the real answer).
  {
    const { ctx, page, pageErrors } = await newPage(browser, { width: 390 });
    await gotoLang(page, REAL, "id");
    await page.click("#aman-fab", { force: true });
    await page.waitForTimeout(800);
    await page.fill("#assistant-input", "Halo, apa itu penipuan?");
    await page.click("#assistant-send");
    try {
      await page.waitForFunction(() => {
        const nodes = [...document.querySelectorAll("#assistant-log > *")];
        const last = nodes[nodes.length - 1];
        // Not the "thinking…" indicator — a real reply (answer or the
        // honest failure message with "Coba lagi").
        return nodes.length >= 2 && last && last.textContent.trim().length > 20 && !/sedang berpikir/i.test(last.textContent);
      }, undefined, { timeout: 45000 });
      const reply = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll("#assistant-log > *")];
        return nodes[nodes.length - 1].textContent.trim().slice(0, 160);
      });
      check("F real: Aman replies (answer or honest failure)", true, `reply=${JSON.stringify(reply)}`);
    } catch (e) {
      const log = await page.evaluate(() => document.querySelector("#assistant-log")?.textContent.trim().slice(0, 200));
      check("F real: Aman replies (answer or honest failure)", false, `log=${JSON.stringify(log)}`);
    }
    await page.click("#assistant-close");
    await page.waitForTimeout(400);
    noErrors(pageErrors, "F real 390");
    await ctx.close();
  }
  // FAB hides at the footer, returns when the footer leaves.
  {
    const { ctx, page, pageErrors } = await newPage(browser, { width: 390 });
    await gotoLang(page, DEMO, "id");
    await page.evaluate(() => window.scrollTo({ top: 1500, behavior: "instant" }));
    await page.waitForTimeout(500);
    const mid = await page.evaluate(() => {
      const fab = document.querySelector("#aman-fab");
      const cs = getComputedStyle(fab);
      return { hidden: fab.classList.contains("aman-fab-hidden"), visibility: cs.visibility, opacity: cs.opacity };
    });
    check("F FAB visible mid-page (footer out of view)", !mid.hidden && mid.visibility === "visible" && mid.opacity === "1", JSON.stringify(mid));
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }));
    await page.waitForTimeout(500);
    const bottom = await page.evaluate(() => {
      const fab = document.querySelector("#aman-fab");
      const cs = getComputedStyle(fab);
      const foot = document.querySelector(".footer").getBoundingClientRect();
      const rows = [...document.querySelectorAll(".footer p, .footer div")].map((el) => {
        const r = el.getBoundingClientRect();
        return { inView: r.top >= 0 && r.bottom <= window.innerHeight };
      });
      const fr = fab.getBoundingClientRect();
      const overlap = !(fr.bottom <= foot.top || fr.top >= foot.bottom || fr.right <= foot.left || fr.left >= foot.right) && cs.visibility !== "hidden";
      return { hidden: fab.classList.contains("aman-fab-hidden"), visibility: cs.visibility, footerTop: Math.round(foot.top), footerBottom: Math.round(foot.bottom), rows, overlap };
    });
    check("F FAB hidden at page bottom (footer on screen)", bottom.hidden && bottom.visibility === "hidden", JSON.stringify(bottom));
    check("F footer fully readable, nothing covered", bottom.rows.length === 2 && bottom.rows.every((r) => r.inView) && !bottom.overlap, JSON.stringify(bottom));
    await page.screenshot({ path: path.join(SHOTS, "footer-aman-390.png") });
    const maxScroll = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.max(0, maxScroll - 500));
    await page.waitForTimeout(500);
    const up = await page.evaluate(() => {
      const fab = document.querySelector("#aman-fab");
      const cs = getComputedStyle(fab);
      const foot = document.querySelector(".footer").getBoundingClientRect();
      return { hidden: fab.classList.contains("aman-fab-hidden"), visibility: cs.visibility, opacity: cs.opacity, footerTop: Math.round(foot.top) };
    });
    check("F FAB back once footer leaves the viewport", !up.hidden && up.visibility === "visible" && up.opacity === "1" && up.footerTop > 844, JSON.stringify(up));
    noErrors(pageErrors, "F footer 390");
    await ctx.close();
  }
}

// ---- G. Share, install, FAQ, stats empty, demo mode (390, demo) ----
async function groupG(browser) {
  const { ctx, page, pageErrors } = await newPage(browser, { width: 390 });
  await gotoLang(page, DEMO, "id");
  // Demo mode is honest: banner + mode label.
  const demoMode = await page.evaluate(() => ({
    bannerHidden: document.querySelector("#demo-banner")?.hidden,
    modeLabel: document.querySelector("#mode-label")?.textContent,
  }));
  check("G demo mode: banner visible + 'Mode demo' label", demoMode.bannerHidden === false && /Mode demo/i.test(demoMode.modeLabel || ""), JSON.stringify(demoMode));
  // Run a check so the verdict share buttons exist.
  await page.click("#samples .sample-btn");
  await page.waitForTimeout(300);
  await page.click("#check-btn");
  await page.waitForFunction(() => {
    const r = document.querySelector("#result");
    return r && !r.hidden && document.querySelector(".result-status")?.textContent.trim().length > 0;
  }, undefined, { timeout: 45000 });
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
  });
  await page.click("#share-wa-btn");
  await page.waitForTimeout(400);
  await page.click("#share-tg-btn");
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => window.__opened || []);
  const wa = opened.find((u) => u.startsWith("https://wa.me/?text=")) || "";
  const tg = opened.find((u) => u.startsWith("https://t.me/share/url?")) || "";
  const waText = wa ? decodeURIComponent(wa.split("text=")[1] || "") : "";
  const tgText = tg ? decodeURIComponent((tg.split("text=")[1] || "")) : "";
  check("G share WA link carries label+score, no message text (PII)", wa.length > 0 && /Penipuan/i.test(waText) && /\d+\/100|100/.test(waText) && !/482916|OTP Anda/.test(waText), waText.slice(0, 120));
  check("G share TG link carries label+score + site URL, no PII", tg.length > 0 && tg.includes("url=" + encodeURIComponent("https://tipucek.web.app")) && /Penipuan/i.test(tgText) && !/482916|OTP Anda/.test(tgText), tgText.slice(0, 120));
  // Install card: honest instructions when no install prompt is offered.
  const install = await page.evaluate(() => ({
    cardHidden: document.querySelector("#install-card")?.hidden,
    hintHidden: document.querySelector("#install-hint")?.hidden,
  }));
  check("G install card visible (not installed)", install.cardHidden === false, JSON.stringify(install));
  await page.evaluate(() => document.querySelector("#install-card").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.click("#install-btn");
  await page.waitForTimeout(500);
  const hint = await page.evaluate(() => ({
    hidden: document.querySelector("#install-hint")?.hidden,
    text: document.querySelector("#install-hint")?.textContent.trim(),
  }));
  check("G install button shows honest browser-menu instructions", hint.hidden === false && /menu browser|Pasang aplikasi|layar utama/i.test(hint.text || ""), JSON.stringify(hint));
  // FAQ accordion in Cara kerja: 4 items, open/close works.
  await page.evaluate(() => document.querySelector("#module-tab-how").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.click("#module-tab-how");
  await page.waitForTimeout(500);
  const faqCount = await page.evaluate(() => document.querySelectorAll(".faq-item").length);
  check("G FAQ has 4 items", faqCount === 4, `count=${faqCount}`);
  await page.click(".faq-item summary");
  await page.waitForTimeout(300);
  let faqOpen = await page.evaluate(() => document.querySelector(".faq-item").open);
  check("G FAQ item opens on tap", faqOpen === true, `open=${faqOpen}`);
  await page.click(".faq-item summary");
  await page.waitForTimeout(300);
  faqOpen = await page.evaluate(() => document.querySelector(".faq-item").open);
  check("G FAQ item closes on second tap", faqOpen === false, `open=${faqOpen}`);
  await overflowCheck(page, "G 390 ID dark");
  noErrors(pageErrors, "G 390 ID dark");
  await ctx.close();
  // Fresh profile: stats empty state + chart empty note.
  {
    const c2 = await newPage(browser, { width: 390 });
    await gotoLang(c2.page, DEMO, "id");
    const empty = await c2.page.evaluate(() => ({
      checked: document.querySelector("#stat-checked-num")?.textContent.trim(),
      caught: document.querySelector("#stat-caught-num")?.textContent.trim(),
      checkedSub: document.querySelector(".stat .stat-sub[data-i18n='statCheckedSub']")?.textContent.trim(),
      chartEmptyHidden: document.querySelector("#week-chart-empty")?.hidden,
    }));
    check("G fresh profile: stats '–' + invitation, chart empty note", empty.checked === "–" && empty.caught === "–" && (empty.checkedSub || "").length > 3 && empty.chartEmptyHidden === false, JSON.stringify(empty));
    // One safe check on the fresh profile: the caught card must show
    // "0", not stay on the empty-state "–" (regression fixed 21 Nov:
    // animateStatNum left the dash when the target was 0).
    await c2.page.fill("#message-input", "Halo, rapat besok jam 9 di kantor ya.");
    await c2.page.click("#check-btn");
    await c2.page.waitForFunction(() => {
      const r = document.querySelector("#result");
      return r && !r.hidden && document.querySelector(".result-status")?.textContent.trim().length > 0;
    }, undefined, { timeout: 45000 });
    await c2.page.waitForTimeout(900);
    const oneSafe = await c2.page.evaluate(() => ({
      checked: document.querySelector("#stat-checked-num")?.textContent.trim(),
      caught: document.querySelector("#stat-caught-num")?.textContent.trim(),
    }));
    check("G one safe check: caught shows '0' (not '–')", oneSafe.checked === "1" && oneSafe.caught === "0", JSON.stringify(oneSafe));
    noErrors(c2.pageErrors, "G fresh 390");
    await c2.ctx.close();
  }
  // Real env: demo banner hidden, "Mode AI".
  {
    const c3 = await newPage(browser, { width: 390 });
    await gotoLang(c3.page, REAL, "id");
    const real = await c3.page.evaluate(() => ({
      bannerHidden: document.querySelector("#demo-banner")?.hidden,
      modeLabel: document.querySelector("#mode-label")?.textContent,
    }));
    check("G real env: banner hidden + 'Mode AI'", real.bannerHidden === true && real.modeLabel === "Mode AI", JSON.stringify(real));
    noErrors(c3.pageErrors, "G real 390");
    await c3.ctx.close();
  }
}

// ---- H. Desktop 1280 (ID dark + EN light) ----
async function groupH(browser) {
  const { ctx, page, pageErrors } = await newPage(browser, { width: 1280, height: 900 });
  await gotoLang(page, DEMO, "id");
  await headerCheck(page, "H header 1280 ID dark", 72);
  const grid = await page.evaluate(() => {
    const g = document.querySelector(".module-tabs");
    const cs = getComputedStyle(g);
    const descs = [...document.querySelectorAll(".module-tab-desc")].map((d) => getComputedStyle(d).display !== "none");
    const names = [...document.querySelectorAll(".module-tab-name")].map((n) => ({ text: n.textContent.trim(), clipped: n.scrollWidth > n.clientWidth + 1 }));
    return { columns: cs.gridTemplateColumns.split(" ").length, descs, names, navHidden: getComputedStyle(document.querySelector(".bottomnav")).display === "none" };
  });
  check("H desktop grid is 4 columns", grid.columns === 4, `cols=${grid.columns}`);
  check("H desktop cards show descriptions", grid.descs.every(Boolean), JSON.stringify(grid.descs));
  check("H desktop no card title clipped", grid.names.every((n) => !n.clipped), JSON.stringify(grid.names));
  check("H desktop bottom nav hidden (header + grid carry navigation)", grid.navHidden === true, `navHidden=${grid.navHidden}`);
  await page.evaluate(() => document.querySelector(".modules").scrollIntoView({ block: "start" }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, "grid-desktop.png") });
  await page.click("#module-tab-contacts");
  await page.waitForTimeout(500);
  const panel = await page.evaluate(() => !document.querySelector("#contacts")?.hidden);
  check("H desktop card opens its panel", panel === true, `open=${panel}`);
  // Desktop dead-end check (21 Nov sweep finding): the bottom nav is
  // hidden on desktop, so the back button on Dashboard 2 must be the
  // way home. Dashboard 2 has NO visible desktop entry since the
  // grid card was removed (21 Nov 11:22 — KNOWN GAP, entry decision
  // pending); open it via the hidden nav's own handler to prove the
  // view + back button still work on desktop.
  await page.evaluate(() => document.querySelector("#nav-history").click());
  await page.waitForTimeout(600);
  const dash2 = await page.evaluate(() => !document.querySelector("#view-history").hidden);
  check("H desktop Dashboard 2 view opens (via nav handler)", dash2 === true, `open=${dash2}`);
  await page.click("#history-back-btn");
  await page.waitForTimeout(500);
  const backHome = await page.evaluate(() => ({ homeHidden: document.querySelector("#view-home").hidden, histHidden: document.querySelector("#view-history").hidden }));
  check("H desktop back button returns to Dashboard 1", !backHome.homeHidden && backHome.histHidden, JSON.stringify(backHome));
  await overflowCheck(page, "H 1280 ID dark");
  // EN + light on desktop.
  await page.click("#lang-en-btn");
  await page.waitForTimeout(500);
  await page.click("#theme-btn");
  await page.waitForTimeout(300);
  await page.click("[data-theme-pick='light']");
  await page.waitForTimeout(400);
  const enLight = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    grid: [...document.querySelectorAll(".module-tab-name")].map((e) => e.textContent.trim()),
    headerH: Math.round(document.querySelector(".topbar").getBoundingClientRect().height),
  }));
  check("H desktop EN light: theme + grid in English, header one line", enLight.theme === "light" && enLight.grid[0] === "Check link" && enLight.headerH <= 72, JSON.stringify(enLight));
  await overflowCheck(page, "H 1280 EN light");
  noErrors(pageErrors, "H 1280");
  await ctx.close();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const procs = await startServers();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    await groupA(browser);
    await groupB(browser);
    await groupC(browser);
    await groupD(browser);
    await groupE(browser);
    await groupF(browser);
    await groupG(browser);
    await groupH(browser);
  } finally {
    await browser.close();
    for (const p of Object.values(procs)) p.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== full-verify: ${results.length - failed.length}/${results.length} passed, ${failed.length} failed ====`);
  if (failed.length) { failed.forEach((r) => console.log(`  FAIL ${r.name}`)); process.exit(1); }
  console.log("ALL GREEN");
  process.exit(0);
})().catch((e) => { console.error("FULL-VERIFY CRASH", e); process.exit(1); });
