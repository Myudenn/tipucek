// GRID POLISH VERIFICATION (21 Nov 2026) — grid "Fitur lainnya" 4x2
// (Myuden 12:29: "4 4 jadi 2 pas" + "Atur sebagus mungkin"):
//   8 cards in exactly 4 columns x 2 rows at EVERY width, no empty cell;
//   balanced gaps, icons + labels aligned across cards, labels never
//   clipped or colliding, equal card heights per row, neat in dark AND
//   light, ID AND EN, at 390px and desktop; every card still opens its
//   panel. Exit 0 only when ALL checks pass.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/grid-polish-verify.cjs
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/home/hatch/workspace/tools/rekam-layar/node_modules/playwright");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const SHOTS = path.join(ROOT, "video/panel-lainnya-shots");
const PROXY_PORT = 18102;
const DEV_PORT = 5184;
const DEV = `http://127.0.0.1:${DEV_PORT}/`;
const ORDER = ["link", "file", "chatlog", "report", "contacts", "aid", "quiz", "how"];

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
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
async function newPage(browser, { width, height = 844, lang = "id", theme = "light" }) {
  const ctx = await browser.newContext({
    viewport: { width, height }, locale: lang === "id" ? "id-ID" : "en-US", timezoneId: "Asia/Jakarta",
    colorScheme: theme,
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    ignoreHTTPSErrors: true,
  });
  await ctx.addInitScript((t) => { localStorage.setItem("pesanaman_theme", t); }, theme);
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(String(e)); });
  page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text()); });
  return { ctx, page, pageErrors };
}
async function dismissOnboarding(page) {
  await page.waitForTimeout(500);
  const btn = page.locator("#onboard-start");
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
}

function gridProbe() {
  const g = document.querySelector(".module-tabs");
  const cs = getComputedStyle(g);
  const cards = [...document.querySelectorAll(".module-tab-btn")].map((b) => {
    const r = b.getBoundingClientRect();
    const name = b.querySelector(".module-tab-name");
    const nr = name.getBoundingClientRect();
    const icon = b.querySelector(".module-tab-icon");
    const ir = icon.getBoundingClientRect();
    return {
      id: b.id.replace("module-tab-", ""),
      left: r.left, top: r.top, width: r.width, height: r.height,
      nameText: name.textContent.trim(),
      nameClipped: name.scrollWidth > name.clientWidth + 1,
      nameRect: { left: nr.left, top: nr.top, width: nr.width, height: nr.height },
      iconTop: ir.top, iconCenterX: ir.left + ir.width / 2, cardCenterX: r.left + r.width / 2,
    };
  });
  return {
    cols: cs.gridTemplateColumns.split(" ").length,
    gap: cs.columnGap,
    rowGap: cs.rowGap,
    viewportWidth: window.innerWidth,
    cards,
    hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
}

async function gridContext(browser, { label, width, lang, theme, shot }) {
  const { ctx, page, pageErrors } = await newPage(browser, { width, lang, theme });
  await page.goto(`${DEV}?lang=${lang}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1300);
  await dismissOnboarding(page);
  await page.evaluate(() => document.querySelector(".module-tabs").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
  const grid = await page.evaluate(gridProbe);
  const rows = [...new Set(grid.cards.map((c) => Math.round(c.top)))].sort((a, b) => a - b);
  check(`${label}: grid is 4 columns x 2 rows, 8 cards in order`,
    grid.cols === 4 && rows.length === 2 && grid.cards.length === 8 &&
    JSON.stringify(grid.cards.map((c) => c.id)) === JSON.stringify(ORDER),
    `cols=${grid.cols} rows=${rows.length} cards=${grid.cards.map((c) => c.id).join(",")}`);
  check(`${label}: no horizontal scroll`, !grid.hScroll, `hScroll=${grid.hScroll}`);
  check(`${label}: no label clipped`,
    grid.cards.every((c) => !c.nameClipped),
    grid.cards.filter((c) => c.nameClipped).map((c) => c.id).join(",") || "all clean");
  const names = grid.cards.map((c) => c.nameRect);
  let overlap = null;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j];
    if (a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height) overlap = `${grid.cards[i].id} x ${grid.cards[j].id}`;
  }
  check(`${label}: labels do not overlap`, !overlap, overlap || "none");
  const rowHeightsOk = rows.every((t) => {
    const hs = grid.cards.filter((c) => Math.round(c.top) === t).map((c) => c.height);
    return Math.max(...hs) - Math.min(...hs) <= 1;
  });
  check(`${label}: equal card heights per row`, rowHeightsOk,
    rows.map((t) => grid.cards.filter((c) => Math.round(c.top) === t).map((c) => c.height).join("/")).join(" | "));
  // Desktop (≥1024px) cards are a row layout: icon left, text left —
  // the icon is NOT centred by design; only its top must align per row.
  // On phones the card is a column layout, so the icon must be centred too.
  const isDesktop = grid.viewportWidth >= 1024;
  const iconsOk = rows.every((t) => {
    const row = grid.cards.filter((c) => Math.round(c.top) === t);
    const tops = row.map((c) => c.iconTop);
    const centered = isDesktop ? true : row.every((c) => Math.abs(c.iconCenterX - c.cardCenterX) <= 2);
    return Math.max(...tops) - Math.min(...tops) <= 1 && centered;
  });
  check(`${label}: icons aligned + centred per row`, iconsOk, "");
  const row1 = grid.cards.filter((c) => Math.round(c.top) === rows[0]);
  const gaps = [];
  for (let i = 1; i < row1.length; i++) gaps.push(Math.round((row1[i].left - (row1[i - 1].left + row1[i - 1].width)) * 10) / 10);
  check(`${label}: column gaps balanced`, gaps.length === 3 && Math.max(...gaps) - Math.min(...gaps) <= 1, `gaps=${gaps.join(",")} css=${grid.gap}`);
  check(`${label}: 0 page errors`, pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  if (shot) {
    await page.locator(".module-tabs").screenshot({ path: path.join(SHOTS, shot) });
    console.log(`  shot: ${shot}`);
  }
  await ctx.close();
  return { page, grid };
}

(async () => {
  const { proxyProc, viteProc } = await startServers();
  const browser = await chromium.launch();
  try {
    // Canonical screenshots: 390 light + dark (ID), 390 EN light, 1280 light + dark (ID).
    await gridContext(browser, { label: "390 ID light", width: 390, lang: "id", theme: "light", shot: "grid-alat-390.png" });
    await gridContext(browser, { label: "390 ID dark", width: 390, lang: "id", theme: "dark", shot: "grid-alat-390-dark.png" });
    await gridContext(browser, { label: "390 EN light", width: 390, lang: "en", theme: "light", shot: "grid-alat-390-en.png" });
    await gridContext(browser, { label: "1280 ID light", width: 1280, lang: "id", theme: "light", shot: "grid-alat-1280.png" });
    await gridContext(browser, { label: "1280 ID dark", width: 1280, lang: "id", theme: "dark", shot: "grid-alat-1280-dark.png" });
    await gridContext(browser, { label: "1024 ID light", width: 1024, lang: "id", theme: "light" });
    await gridContext(browser, { label: "1919 EN light", width: 1919, lang: "en", theme: "light" });

    // Click test: every card opens its panel (390, ID, light).
    const { ctx, page, pageErrors } = await newPage(browser, { width: 390, lang: "id", theme: "light" });
    await page.goto(`${DEV}?lang=id`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1300);
    await dismissOnboarding(page);
    for (const id of ORDER) {
      await page.evaluate((n) => document.querySelector(`#module-tab-${n}`).scrollIntoView({ block: "center" }), id);
      await page.click(`#module-tab-${id}`);
      await page.waitForTimeout(250);
      const ok = await page.evaluate((n) => {
        const btn = document.querySelector(`#module-tab-${n}`);
        const panel = document.getElementById(btn.getAttribute("aria-controls"));
        return btn.getAttribute("aria-selected") === "true" && panel && getComputedStyle(panel).display !== "none";
      }, id);
      check(`click ${id} opens its panel`, ok, "");
    }
    check("click test: 0 page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
    await ctx.close();
  } finally {
    await browser.close();
    proxyProc.kill(); viteProc.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
