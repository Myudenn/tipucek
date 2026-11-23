// CONSOLIDATED FINAL VERIFICATION (21 Nov 2026) — closing gate for
// the whole web build: poles panel, 4 variasi, desain G + font G2,
// 4 fitur baru, mode online-only, Aman Arah 3, logo V4, ukuran teks,
// footer + OSI, titik hijau header. Re-verifies every earlier area
// (the old /tmp scripts were lost to a /tmp wipe — this script lives
// in the repo so it survives). npm test + i18n parity run separately.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/final-verify.cjs
// Exit 0 only when all checks pass.
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
        bad.push(`${el.tagName}.${String(el.className && el.className.baseVal !== undefined ? "" : el.className).slice(0, 30)} w=${Math.round(r.width)}`);
      }
    });
    return { vw, docOverflow: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 5) };
  });
}
// Seed: 10 checks (3 scam today, 2 scam yesterday, 5 safe today) + 1 crowd report.
function seedScript() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10).toISOString();
  const yday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 10).toISOString();
  const mk = (status, score, at, i) => ({ id: `seed-${i}`, message: `pesan seed ${i} ${status}`, status, riskScore: score, redFlags: status === "scam" ? ["tautan"] : [], summary: "", source: "local", createdAt: at });
  const hist = [
    mk("scam", 95, today, 1), mk("scam", 98, today, 2), mk("scam", 92, today, 3),
    mk("scam", 96, yday, 4), mk("scam", 94, yday, 5),
    mk("safe", 0, today, 6), mk("safe", 2, today, 7), mk("safe", 5, today, 8), mk("safe", 0, today, 9), mk("safe", 3, today, 10),
  ];
  const reports = [{ id: "seed-r1", type: "phone", value: "081234567890", details: "seed", status: "pending", createdAt: today, reporterUid: null }];
  return `localStorage.setItem("pesanaman_history_v1", ${JSON.stringify(JSON.stringify(hist))}); localStorage.setItem("tipucek_crowd_reports_v1", ${JSON.stringify(JSON.stringify(reports))});`;
}

(async () => {
  // ---- S0: static checks (no browser) ----
  const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
  const sw = read("public/sw.js");
  check("S0 SW cache v11", /tipucek-v11/.test(sw) && !/tipucek-v10/.test(sw), "");
  const fav = read("public/favicon.svg");
  check("S0 favicon is V4 T (no shield path)", /#1a56db/.test(fav) && !/M32 3 L56 11/.test(fav), "");
  check("S0 logo-mark.svg exists (mono white T)", fs.existsSync(path.join(ROOT, "public/logo-mark.svg")) && /fill="#fff"|fill="white"|fill="#ffffff"/i.test(read("public/logo-mark.svg")), "");
  const manifest = read("public/manifest.webmanifest");
  check("S0 manifest says Indonesian and English", /Indonesian and English/.test(manifest) && !/8 languages/.test(manifest), "");
  check("S0 font woff2 bundled locally", fs.existsSync(path.join(ROOT, "public/fonts/plus-jakarta-sans-latin.woff2")), "");
  const css = read("src/styles.css");
  check("S0 @font-face local Plus Jakarta Sans", /@font-face[^}]*Plus Jakarta Sans[^}]*url\(["']?\/fonts\/plus-jakarta-sans-latin\.woff2["']?\)/s.test(css), "");
  let pesanAman = 0;
  for (const f of ["index.html", "src/main.js", "src/i18n.js", "src/ai.js", "src/assistant.js", "src/history.js", "src/crowdreport.js", "public/sw.js", "public/manifest.webmanifest"]) {
    if (read(f).includes("PesanAman")) pesanAman++;
  }
  check("S0 zero PesanAman in app sources", pesanAman === 0, `files=${pesanAman}`);

  const { proxyProc, viteProc } = await startServers();
  let failures = 0;
  try {
    const browser = await chromium.launch({ args: [`--proxy-server=http://127.0.0.1:${PROXY_PORT}`], ignoreHTTPSErrors: true });
    try {
      const newPage = async (ctxOpts = {}) => {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, ...ctxOpts });
        const pageErrors = [];
        const extFontReqs = [];
        const page = await ctx.newPage();
        page.on("pageerror", (e) => { if (!isSandboxNoise(String(e))) pageErrors.push(String(e).slice(0, 200)); });
        page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text().slice(0, 200)); });
        page.on("request", (r) => { if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) extFontReqs.push(r.url()); });
        return { ctx, page, pageErrors, extFontReqs };
      };
      const noErrors = (pageErrors, tag) => check(`no page errors (${tag})`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

      // ---- S1: 390 dark default (G + font G2) ----
      {
        const { ctx, page, pageErrors, extFontReqs } = await newPage();
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1300);
        await dismissOnboarding(page);
        const g = await page.evaluate(() => {
          const cs = getComputedStyle(document.documentElement);
          const hero = document.querySelector(".hero-title");
          const hcs = getComputedStyle(hero);
          return {
            theme: document.documentElement.getAttribute("data-theme"),
            heroText: hero.textContent.trim(),
            heroSize: hcs.fontSize, heroWeight: hcs.fontWeight,
            fontFamily: hcs.fontFamily,
            jakartaLoaded: document.fonts.check("700 16px 'Plus Jakarta Sans'"),
            bg: getComputedStyle(document.body).backgroundColor,
          };
        });
        check("S1 dark theme is default", g.theme === "dark", `theme=${g.theme}`);
        check("S1 hero sentence case, 40px, weight 900", g.heroText === "Apakah pesan ini penipuan?" && g.heroSize === "40px" && g.heroWeight === "900", JSON.stringify(g));
        check("S1 Plus Jakarta Sans loaded from bundle", /Plus Jakarta Sans/.test(g.fontFamily) && g.jakartaLoaded, g.fontFamily);
        check("S1 zero external font requests", extFontReqs.length === 0, extFontReqs.join(","));
        // Empty state on a clean profile (21 Nov): the two personal
        // cards show a dash (never "0"), the two public cards keep
        // their real figures. Real numbers are covered by the seeded
        // run (merge-verify M6: 10 checked / 5 caught).
        await page.evaluate(() => document.querySelector(".stats").scrollIntoView());
        await page.waitForFunction(() => {
          const nums = [...document.querySelectorAll(".stat-num")].map((el) => el.textContent.trim());
          return nums.length === 4 && nums[0].includes("9,1") && nums[1].includes("411") && nums[2] === "–" && nums[3] === "–";
        }, { timeout: 5000 });
        check("S1 empty stats show dash, public cards keep figures", true, "");
        const ov = await overflowReport(page);
        check("S1 no overflow 390 dark", ov.docOverflow <= 0 && ov.bad.length === 0, JSON.stringify(ov));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SHOTS, "final-390-dark.png") });
        noErrors(pageErrors, "S1 390 dark");
        await ctx.close();
      }

      // ---- S2: light mode via settings ----
      {
        const { ctx, page, pageErrors } = await newPage();
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1100);
        await dismissOnboarding(page);
        await page.click("#theme-btn");
        await page.waitForTimeout(300);
        await page.click("[data-theme-pick='light']");
        await page.waitForTimeout(500);
        const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
        check("S2 light mode via header theme menu", theme === "light", `theme=${theme}`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(SHOTS, "final-390-light.png") });
        const ov = await overflowReport(page);
        check("S2 no overflow 390 light", ov.docOverflow <= 0 && ov.bad.length === 0, JSON.stringify(ov));
        noErrors(pageErrors, "S2 light");
        await ctx.close();
      }

      // ---- S3: panels (Lainnya / Riwayat) + dashboard checker ----
      {
        const { ctx, page, pageErrors } = await newPage();
        await ctx.addInitScript(seedScript());
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1200);
        await dismissOnboarding(page);
        // Grid (21 Nov, drawer deleted; Riwayat card removed 11:22): 8 tools in a 4x2 grid on
        // Dashboard 1, each with a short description; the net status
        // is the green dot in the header now.
        const more = await page.evaluate(() => ({
          tools: document.querySelectorAll(".module-tab-btn").length,
          cols: getComputedStyle(document.querySelector(".module-tabs")).gridTemplateColumns.split(" ").length,
          descs: [...document.querySelectorAll(".module-tab-desc")].filter((e) => e.textContent.trim().length > 5).length,
          dotOnline: document.querySelector("#net-status")?.classList.contains("online"),
          dotLabel: document.querySelector("#net-status")?.getAttribute("aria-label"),
        }));
        check("S3 grid: 8 tools, 4 columns, 8 descs", more.tools === 8 && more.cols === 4 && more.descs === 8, JSON.stringify(more));
        check("S3 header net dot shows online", more.dotOnline === true && more.dotLabel === "Daring", JSON.stringify(more));
        // Periksa lives ONLY on the dashboard now (21 Nov): 4 tabs,
        // masked samples, run a scam check from the page itself.
        const chk = await page.evaluate(() => ({
          tabs: document.querySelectorAll(".checker .checker-tab-btn").length,
          samples: document.querySelectorAll("#samples .sample-btn").length,
          otpMasked: ![...document.querySelectorAll("#samples .sample-preview")].some((e) => /482916/.test(e.textContent)),
        }));
        check("S3 Periksa: 4 dashboard tabs + masked samples", chk.tabs === 4 && chk.samples >= 1 && chk.otpMasked, JSON.stringify(chk));
        await page.evaluate(() => document.querySelector(".checker").scrollIntoView());
        await page.fill("#message-input", "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000");
        await page.click("#check-btn");
        // NB: a `.result-card.result-checking` skeleton renders first —
        // wait for the FINAL verdict, not the skeleton.
        await page.waitForFunction(() => {
          const s = document.querySelector(".result-card:not(.result-checking) .result-status");
          return s && s.textContent.trim().length > 0;
        }, { timeout: 15000 });
        const verdict = await page.evaluate(() => document.querySelector(".result-status")?.textContent.slice(0, 60) || "");
        check("S3 Periksa: scam check shows verdict on page", /Penipuan|Scam/i.test(verdict), verdict);
        await page.waitForTimeout(400);
        // Riwayat: seeded rows, search filters, badges earned, delete two-tap.
        // Dashboard 2 now (21 Nov, drawer deleted) — a full page, not a sheet.
        await page.click("#nav-history");
        await page.waitForTimeout(600);
        const hist = await page.evaluate(() => ({
          rows: document.querySelectorAll("#history-list .history-item-btn").length,
          badges: [...document.querySelectorAll("#history-badges-grid > *")].map((e) => e.textContent.replace(/\s+/g, " ").slice(0, 40)),
        }));
        check("S3 Riwayat: seeded rows listed", hist.rows >= 10, `rows=${hist.rows}`);
        check("S3 badges: 4 badges, all earned from real data", hist.badges.length === 4 && hist.badges.every((b) => /Tercapai|Earned/i.test(b)), JSON.stringify(hist.badges));
        const search = page.locator("#history-search");
        if (await search.count()) {
          await search.first().fill("seed 1 scam");
          await page.waitForTimeout(400);
          const n = await page.evaluate(() => document.querySelectorAll("#history-list .history-item-btn").length);
          check("S3 Riwayat: search filters rows", n >= 1 && n < 10, `rows=${n}`);
          await search.first().fill("");
          await page.waitForTimeout(300);
        } else {
          check("S3 Riwayat: search box present", false, "no search input found");
        }
        noErrors(pageErrors, "S3 panels");
        await ctx.close();
      }

      // ---- S4: theme accent + text size persist; Senior forces light ----
      {
        const { ctx, page, pageErrors } = await newPage();
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1100);
        await dismissOnboarding(page);
        // Pengaturan lives on Dashboard 2 now (21 Nov, drawer deleted).
        await page.click("#nav-history");
        await page.waitForTimeout(600);
        await page.click('[data-accent-pick="green"]');
        await page.click('[data-text-size-pick="large"]');
        await page.waitForTimeout(400);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
        await dismissOnboarding(page);
        const persisted = await page.evaluate(() => ({
          accent: document.documentElement.getAttribute("data-accent"),
          textSize: document.documentElement.getAttribute("data-text-size"),
          root: getComputedStyle(document.documentElement).fontSize,
          lsAccent: localStorage.getItem("pesanaman_accent"),
          lsSize: localStorage.getItem("pesanaman_text_size"),
        }));
        check("S4 green accent + large text persist", persisted.accent === "green" && persisted.textSize === "large" && persisted.root === "18px", JSON.stringify(persisted));
        await page.click("#nav-history");
        await page.waitForTimeout(600);
        await page.click("#senior-toggle");
        await page.waitForTimeout(500);
        const senior = await page.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"), size: document.documentElement.getAttribute("data-text-size") }));
        check("S4 Senior forces light + large", senior.theme === "light" && senior.size === "large", JSON.stringify(senior));
        noErrors(pageErrors, "S4 theme/text");
        await ctx.close();
      }

      // ---- S5: share verdict (no message content) ----
      {
        const { ctx, page, pageErrors } = await newPage();
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1100);
        await dismissOnboarding(page);
        await page.fill("#message-input", "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000");
        await page.click("#check-btn");
        await page.waitForFunction(() => {
          const s = document.querySelector(".result-card:not(.result-checking) .result-status");
          return s && s.textContent.trim().length > 0;
        }, { timeout: 15000 });
        const btns = await page.evaluate(() => ({ wa: !!document.querySelector("#share-wa-btn"), tg: !!document.querySelector("#share-tg-btn") }));
        check("S5 share buttons appear on verdict", btns.wa && btns.tg, JSON.stringify(btns));
        // Popups via the sandbox proxy are slow (wa.me redirect takes
        // seconds): collect popup URLs with a listener and wait up to
        // 20s for the one matching each channel.
        const popups = [];
        page.on("popup", (p) => popups.push(p.url()));
        const waitPopup = async (re, timeoutMs = 20000) => {
          const start = Date.now();
          while (Date.now() - start < timeoutMs) {
            const hit = popups.find((u) => re.test(u));
            if (hit) return hit;
            await page.waitForTimeout(500);
          }
          return "";
        };
        await page.click("#share-wa-btn");
        const waUrl = await waitPopup(/wa\.me|api\.whatsapp\.com/);
        check("S5 WhatsApp link: label+score, no message text", /wa\.me|api\.whatsapp\.com/.test(waUrl) && /Penipuan/.test(decodeURIComponent(waUrl)) && !/hadiah-telkomsel|50\.000\.000/.test(decodeURIComponent(waUrl)), waUrl.slice(0, 160));
        await page.click("#share-tg-btn");
        const tgUrl = await waitPopup(/t\.me\/share/);
        check("S5 Telegram link: label+score, no message text", /t\.me\/share/.test(tgUrl) && !/hadiah-telkomsel|50\.000\.000/.test(decodeURIComponent(tgUrl)), tgUrl.slice(0, 160));
        noErrors(pageErrors, "S5 share");
        await ctx.close();
      }

      // ---- S6: onboarding / FAQ / install / week chart ----
      {
        const { ctx, page, pageErrors } = await newPage();
        await ctx.addInitScript(seedScript());
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1200);
        const onboardVisible = await page.evaluate(() => !document.querySelector("#onboard").hidden);
        check("S6 onboarding shows once for new visitor", onboardVisible, "");
        await dismissOnboarding(page);
        const flag = await page.evaluate(() => localStorage.getItem("tipucek_onboarding_seen"));
        check("S6 onboarding close sets flag", flag === "1", `flag=${flag}`);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForTimeout(900);
        const onboardAgain = await page.evaluate(() => !document.querySelector("#onboard").hidden);
        check("S6 onboarding does not reappear", !onboardAgain, "");
        // FAQ in How module (grid card now — drawer deleted).
        await page.click("#module-tab-how");
        await page.waitForTimeout(600);
        const faq = await page.evaluate(() => ({
          details: document.querySelectorAll("#how details").length,
          onboardBtn: !!document.querySelector("#how-onboard-btn"),
        }));
        check("S6 FAQ: 4 questions in How", faq.details === 4 && faq.onboardBtn, JSON.stringify(faq));
        await page.evaluate(() => document.querySelector("#how details summary")?.click());
        await page.waitForTimeout(300);
        const faqOpen = await page.evaluate(() => document.querySelector("#how details")?.open === true);
        check("S6 FAQ answer opens", faqOpen, "");
        await page.click("#how-onboard-btn");
        await page.waitForTimeout(400);
        const reopened = await page.evaluate(() => !document.querySelector("#onboard").hidden);
        check("S6 onboarding reopens from How", reopened, "");
        await dismissOnboarding(page);
        // Install card: one button, hint on click.
        const install = await page.evaluate(() => ({ btns: document.querySelectorAll("#install-btn").length }));
        check("S6 install: exactly one install button", install.btns === 1, `btns=${install.btns}`);
        await page.evaluate(() => document.querySelector("#install-card").scrollIntoView());
        await page.click("#install-btn", { force: true });
        await page.waitForTimeout(500);
        const hint = await page.evaluate(() => ({ hidden: document.querySelector("#install-hint")?.hidden, text: (document.querySelector("#install-hint")?.textContent || "").length }));
        check("S6 install: browser-menu hint shown", hint.hidden === false && hint.text > 10, JSON.stringify(hint));
        // Week chart from seeded history: fills [2,2,2,2,2,64,96]px
        // for counts [0,0,0,0,0,2,3] (the .week-bar wrapper is fixed
        // height — the proportional height lives on .week-bar-fill).
        const chart = await page.evaluate(() => {
          const fills = [...document.querySelectorAll("#week-chart-bars .week-bar-fill")];
          return { n: fills.length, aria: document.querySelector("#week-chart-bars")?.getAttribute("aria-label") || "", heights: fills.map((b) => Math.round(parseFloat(b.style.height) || 0)) };
        });
        check("S6 chart: 7 bars from real local history", chart.n === 7 && /5/.test(chart.aria) && JSON.stringify(chart.heights) === JSON.stringify([2, 2, 2, 2, 2, 64, 96]), JSON.stringify(chart));
        noErrors(pageErrors, "S6 features2");
        await ctx.close();
      }

      // ---- S7: online-only mode ----
      {
        const { ctx, page, pageErrors } = await newPage();
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1100);
        await dismissOnboarding(page);
        await ctx.setOffline(true);
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
        await page.waitForTimeout(400);
        await page.fill("#message-input", "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Klik http://bit.ly/hadiah-telkomsel-2026");
        await page.click("#check-btn");
        await page.waitForTimeout(1200);
        const off = await page.evaluate(() => ({
          notice: !document.querySelector("#offline-note").hidden,
          prelim: !!document.querySelector(".offline-check-note, [data-offline-panel], #offline-retry-btn"),
          retryDisabled: document.querySelector("#offline-retry-btn")?.disabled === true,
          // NB: a `.result-card.result-checking` skeleton renders
          // first — only a finished verdict counts.
          verdict: !!document.querySelector(".result-card:not(.result-checking) .result-status"),
          hist: (JSON.parse(localStorage.getItem("pesanaman_history_v1") || "[]")).length,
        }));
        check("S7 offline: notice + prelim, no final verdict, no history", off.notice && off.prelim && off.retryDisabled && !off.verdict && off.hist === 0, JSON.stringify(off));
        await ctx.setOffline(false);
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
        await page.waitForFunction(() => {
          const s = document.querySelector(".result-card:not(.result-checking) .result-status");
          return s && s.textContent.trim().length > 0;
        }, { timeout: 20000 });
        const back = await page.evaluate(() => ({ verdict: document.querySelector(".result-status")?.textContent || "", hist: (JSON.parse(localStorage.getItem("pesanaman_history_v1") || "[]")).length }));
        check("S7 back online: auto-retry gives verdict + history", back.verdict.length > 0 && back.hist === 1, JSON.stringify(back));
        noErrors(pageErrors, "S7 online-only");
        await ctx.close();
      }

      // ---- S8: Aman Arah 3 + robot ----
      {
        const { ctx, page, pageErrors } = await newPage();
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1100);
        await dismissOnboarding(page);
        await page.click("#aman-fab", { force: true });
        await page.waitForTimeout(800);
        const aman = await page.evaluate(() => ({
          avatarImg: document.querySelector("#assistant .assistant-head img, .aman-panel img")?.getAttribute("src"),
          greeting: document.querySelector("#assistant-greeting")?.textContent || "",
          chips: [...document.querySelectorAll("#assistant-chips .assistant-chip, #assistant-chips button")].map((e) => e.textContent.trim()),
          sendRound: !!document.querySelector("#assistant-send.assistant-send-round"),
          monogram: !!document.querySelector(".assistant-monogram, [data-monogram]"),
        }));
        check("S8 Aman: robot avatar in header", aman.avatarImg === "/aman.png", aman.avatarImg);
        check("S8 Aman: Arah 3 greeting", /Hai, saya Aman/.test(aman.greeting), aman.greeting);
        check("S8 Aman: 4 wrap chips incl. OTP + melaporkan", aman.chips.length === 4 && aman.chips.some((c) => /OTP/.test(c)) && aman.chips.some((c) => /melaporkan/.test(c)), JSON.stringify(aman.chips));
        check("S8 Aman: round send button, no monogram A", aman.sendRound && !aman.monogram, JSON.stringify({ sendRound: aman.sendRound, monogram: aman.monogram }));
        await page.fill("#assistant-input", "Apa itu penipuan OTP?");
        await page.click("#assistant-send");
        await page.waitForFunction(() => document.querySelectorAll("#assistant-log .assistant-msg.aman").length >= 1, { timeout: 15000 });
        const ans = await page.evaluate(() => document.querySelector("#assistant-log .assistant-msg.aman:last-child")?.textContent || "");
        check("S8 Aman: answers in demo mode", ans.length > 10, ans.slice(0, 90));
        noErrors(pageErrors, "S8 aman");
        await ctx.close();
      }

      // ---- S9: overflow matrix ----
      for (const width of [360, 390, 768, 1280]) {
        for (const mode of ["dark", "light"]) {
          const { ctx, page, pageErrors } = await newPage({ viewport: { width, height: 844 } });
          await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(1100);
          await dismissOnboarding(page);
          if (mode === "light") {
            await page.evaluate(() => localStorage.setItem("pesanaman_theme", "light"));
            await page.reload({ waitUntil: "domcontentloaded" });
            await page.waitForTimeout(900);
            await dismissOnboarding(page);
          }
          const ov = await overflowReport(page);
          check(`S9 no overflow ${width}px ${mode}`, ov.docOverflow <= 0 && ov.bad.length === 0, JSON.stringify(ov));
          noErrors(pageErrors, `S9 ${width} ${mode}`);
          await ctx.close();
        }
      }

      // ---- S10: footer + header dot quick re-check ----
      {
        const { ctx, page, pageErrors } = await newPage();
        await page.goto(DEV + "?lang=id", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1100);
        await dismissOnboarding(page);
        const f = await page.evaluate(() => {
          const dot = document.querySelector("#net-status");
          const dr = dot.getBoundingClientRect();
          const rows = document.querySelectorAll(".footer-row");
          return {
            dotW: Math.round(dr.width), dotBg: getComputedStyle(dot).backgroundColor, dotText: dot.textContent,
            seniorInHeader: !!document.querySelector(".topbar #senior-toggle"),
            footerRows: rows.length,
            row1: rows[0]?.textContent.replace(/\s+/g, " ").trim() || "",
            row2: rows[1]?.textContent.replace(/\s+/g, " ").trim() || "",
            osi: !!document.querySelector('a[href="https://opensource.org"] svg'),
            installBtns: document.querySelectorAll("#install-btn").length,
          };
        });
        check("S10 header dot 10px green, no text", f.dotW === 10 && f.dotBg === "rgb(34, 197, 94)" && f.dotText === "", JSON.stringify(f));
        check("S10 Senior Mode not in header (moved to Dashboard 2)", f.seniorInHeader === false, "");
        // Senior toggle whole on Dashboard 2.
        await page.click("#nav-history");
        await page.waitForTimeout(600);
        const seniorBox = await page.evaluate(() => {
          const el = document.querySelector("#senior-toggle");
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right), vw: document.documentElement.clientWidth, visible: r.width > 0 };
        });
        check("S10 senior toggle whole at 390 (Dashboard 2)", seniorBox.visible && seniorBox.left >= 0 && seniorBox.right <= seniorBox.vw, JSON.stringify(seniorBox));
        check("S10 footer 2 rows + OSI + one install btn", f.footerRows === 2 && f.osi && f.installBtns === 1 && /lisensi MIT/.test(f.row2), JSON.stringify(f));
        noErrors(pageErrors, "S10 footer/dot");
        await ctx.close();
      }
    } finally { await browser.close(); }
  } finally { proxyProc.kill(); viteProc.kill(); }
  failures = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failures}/${results.length} checks passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
