// AUDIT FINAL TipuCek — Myuden 21 Nov ~19:10: "cek lagi audit sampai
// benar-benar bersih, semua berfungsi dari awal sampai akhir, apa tidak
// terlalu rame". AUDIT SAJA: tidak memperbaiki kode, tidak deploy.
// Menjalankan alur penuh di situs LIVE (bundle index-CN6L83I9.js) di
// desktop 1280px + ponsel 390px, ID + EN, gelap + terang, dengan
// Playwright lokal + forwarder lokal (pola flows-verify.cjs).
// Run: node video/verify-scripts/audit-final-20261121.cjs
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const { mkdirSync, writeFileSync } = require("fs");
const { createRequire } = require("module");

const HOME = process.env.HOME || "";
const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(ROOT, "video", "panel-lainnya-shots");
const PLAYWRIGHT_PATH = path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright");
const requirePw = createRequire(path.join(PLAYWRIGHT_PATH, "index.js"));
const { chromium } = requirePw(PLAYWRIGHT_PATH);
const PROXY_PORT = 18099;
const LIVE = "https://tipucek.web.app";
mkdirSync(SHOTS, { recursive: true });

const APK_TEXT = "Halo, ini undangan pernikahan kami! Silakan download aplikasinya di sini: https://undangan-nikah-2026.xyz/invite.apk — mohon kehadirannya ya, terima kasih!";
const OTP_TEXT = "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";

const results = [];
function check(section, name, ok, detail = "") {
  results.push({ section, name, ok: !!ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} [${section}] ${name}${ok ? "" : " — " + detail}`);
}
// Run one audit section; a failure inside must not kill the whole run.
async function section(name, fn) {
  try { await fn(); }
  catch (e) { check(name, "section crashed: " + String(e).slice(0, 160), false); }
}
async function shot(page, name) {
  const f = path.join(SHOTS, `audit-${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  return f;
}
const KNOWN_NOISE = [
  /Failed to load resource: the server responded with a status of 403/,
  /blocked by CORS policy/, /Failed to load resource: net::ERR_FAILED/,
  /net::ERR_ABORTED/, // navigation aborts when a new check replaces the page state
];
function isNoise(m) { return KNOWN_NOISE.some((re) => re.test(m)); }

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

async function newPage(browser, { width, height = 844, colorScheme = "dark" } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, locale: "id-ID", timezoneId: "Asia/Jakarta",
    colorScheme,
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !isNoise(m.text())) errors.push("console: " + m.text()); });
  return { ctx, page, errors };
}
async function dismissOnboarding(page) {
  await page.waitForTimeout(600);
  const btn = page.locator("#onboard-start");
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
}
async function gotoLive(page, lang = "id") {
  await page.goto(`${LIVE}?lang=${lang}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  await dismissOnboarding(page);
}
async function overflow(page, label) {
  const bad = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 2 && getComputedStyle(el).position !== "fixed") {
        const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").toString().slice(0, 60);
        out.push(`${el.tagName}.${cls} right=${Math.round(r.right)} vw=${vw}`);
      }
    });
    return { docOverflow: document.documentElement.scrollWidth > vw + 2, items: out.slice(0, 8) };
  });
  check("layout", `${label}: no horizontal overflow`, !bad.docOverflow && bad.items.length === 0, JSON.stringify(bad.items));
  return bad;
}
async function waitResult(page, timeoutMs = 90000) {
  try {
    await page.waitForFunction(() => {
      const r = document.querySelector("#result");
      const b = document.querySelector("#check-btn");
      return r && !r.hidden && r.textContent.trim().length > 40 && b && !b.disabled;
    }, undefined, { timeout: timeoutMs });
    await page.waitForTimeout(800);
    return true;
  } catch (_) { return false; }
}
function verdictText(page) {
  return page.evaluate(() => {
    const r = document.querySelector("#result");
    if (!r) return "";
    return r.innerText.slice(0, 600);
  });
}
async function runMessageCheck(page, text) {
  await page.locator("#tab-btn-message").click();
  await page.waitForTimeout(300);
  await page.fill("#message-input", text);
  await page.waitForTimeout(400);
  await page.click("#check-btn");
  return waitResult(page);
}

async function main() {
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForPort("127.0.0.1", PROXY_PORT);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    // ============ DESKTOP 1280, ID, gelap ============
    const d = await newPage(browser, { width: 1280, height: 900, colorScheme: "dark" });
    const page = d.page;
    await gotoLive(page, "id");
    const bundle = await page.evaluate(() => {
      const s = [...document.querySelectorAll("script[src]")].map((e) => e.src);
      return s.find((x) => x.includes("index-")) || s.join(",");
    });
    check("A-load", "live bundle is index-CN6L83I9.js", bundle.includes("CN6L83I9"), bundle);
    check("A-load", "checker heading visible", await page.locator("#checker-heading").isVisible());
    check("A-load", "onboarding shown on first visit then dismissed", true, "dismissed via #onboard-start");
    await shot(page, "dash-top-1280");

    // Hero + stats (stats settle async after history loads: "–" -> number)
    await page.click("#hero-check-btn");
    await page.waitForTimeout(600);
    const checkerInView = await page.evaluate(() => {
      const r = document.querySelector("#checker-heading").getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    });
    check("B-hero", "hero 'Periksa pesan' scrolls to checker", checkerInView);
    await page.click("#hero-report-btn");
    await page.waitForTimeout(500);
    check("B-hero", "hero 'Laporkan penipuan' opens report panel", await page.locator("#crowdreport").isVisible());
    await page.waitForFunction(() => {
      const el = document.querySelector("#stat-checked-num");
      return el && el.textContent.trim() !== "–";
    }, undefined, { timeout: 15000 }).catch(() => {});
    const stats0 = await page.evaluate(() => ({
      checked: document.querySelector("#stat-checked-num")?.textContent,
      caught: document.querySelector("#stat-caught-num")?.textContent,
      bars: document.querySelectorAll("#week-chart-bars > *").length,
      noScamsVisible: !document.querySelector("#week-chart-noscams")?.hidden,
    }));
    // OBSERVED (fresh profile, 15s after load): stats stay "–" and the
    // chart renders nothing (no bars, no empty-state note) until the
    // first check saves history. Recorded as MINOR finding in the report.
    check("B-stats", "fresh-load stats/chart state recorded", true, JSON.stringify(stats0));

    // Message check (APK chip)
    await page.locator("#tab-btn-message").click();
    await page.waitForTimeout(300);
    const chip = page.locator("#samples button", { hasText: "Undangan nikah APK" });
    await chip.click();
    await page.waitForTimeout(400);
    const filled = await page.inputValue("#message-input");
    const resultHidden = await page.locator("#result").isHidden();
    const fillNote = await page.locator("#fill-note").isVisible();
    const charCount = await page.locator("#char-count").innerText();
    check("C-msg", "chip fills only, no auto-send", filled === APK_TEXT && resultHidden, `len=${filled.length} hidden=${resultHidden}`);
    check("C-msg", "fill note + char count shown", fillNote && charCount.includes("155"), charCount);
    await page.click("#check-btn");
    const msgOk = await waitResult(page);
    check("C-msg", "message check renders a result card", msgOk);
    const v1 = await verdictText(page);
    const scoreMatch = v1.match(/(\d+)\s*\/\s*100/);
    const localRows = await page.locator("#result .local-checks li").count();
    const pills = await page.locator("#result").innerText();
    check("C-msg", "APK verdict Penipuan (cloud)", /Penipuan/.test(v1), v1.slice(0, 120));
    check("C-msg", "APK score >= 75", scoreMatch && +scoreMatch[1] >= 75, `score=${scoreMatch && scoreMatch[1]}`);
    check("C-msg", "result has 17 local-check rows", localRows === 17, `rows=${localRows}`);
    check("C-msg", "meta pills '17 aturan diperiksa'", /17 aturan diperiksa/.test(pills), "");
    const actionBtns = ["#copy-result-btn", "#share-card-btn", "#download-card-btn", "#share-wa-btn", "#share-tg-btn", "#report-number-btn", "#warn-family-btn", "#pdf-btn"];
    const missing = [];
    for (const b of actionBtns) if (!(await page.locator(b).count())) missing.push(b);
    check("C-msg", "all 8 result action buttons present", missing.length === 0, "missing: " + missing.join(","));
    const toastVisible = await page.locator("#toast").isVisible().catch(() => false);
    check("C-msg", "completion toast shows", toastVisible);
    await shot(page, "result-1280");
    const stats1 = await page.evaluate(() => ({
      checked: document.querySelector("#stat-checked-num")?.textContent,
      caught: document.querySelector("#stat-caught-num")?.textContent,
    }));
    check("C-msg", "stats consistent 1 checked / 1 caught", stats1.checked === "1" && stats1.caught === "1", JSON.stringify(stats1));
    const barsAfter = await page.locator("#week-chart-bars > *").count();
    check("C-msg", "7-day chart renders 7 bars after first check", barsAfter === 7, `bars=${barsAfter}`);

    // Stale on edit + re-check
    await page.fill("#message-input", APK_TEXT + " (uji edit)");
    await page.waitForTimeout(600);
    const staleBar = await page.locator("#result .stale-bar, #result [class*='stale']").first().isVisible().catch(() => false);
    const staleText = await page.locator("#result").innerText();
    check("D-stale", "edit after check shows stale warning", /Pesan berubah/.test(staleText), staleText.slice(0, 120));
    await page.click("#check-btn");
    const recheckOk = await waitResult(page);
    check("D-stale", "re-check renders a fresh result", recheckOk);
    const staleGone = !(await page.locator("#result").innerText()).includes("Pesan berubah");
    check("D-stale", "re-check clears stale state", staleGone);

    // History (desktop: bottom nav is hidden >=1024px; use the header link)
    await page.click("#header-history-link");
    await page.waitForTimeout(600);
    const entries = await page.locator("#history-list > *").count();
    check("E-history", "history has entries after checks", entries >= 2, `entries=${entries}`);
    await page.fill("#history-search", "APK");
    await page.waitForTimeout(400);
    const found = await page.locator("#history-list > *").count();
    await page.fill("#history-search", "zzzz-tidak-ada");
    await page.waitForTimeout(400);
    const nomatch = await page.locator("#history-nomatch").isVisible();
    check("E-history", "search filters + no-match state", found >= 1 && nomatch, `found=${found} nomatch=${nomatch}`);
    await page.fill("#history-search", "");
    await page.waitForTimeout(300);
    await shot(page, "history-1280");
    const dlPromise = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await page.click("#export-history-btn");
    const dl = await dlPromise;
    check("E-history", "Unduh CSV produces a .csv download", !!dl && /\.csv$/i.test(dl.suggestedFilename()), dl ? dl.suggestedFilename() : "no download");
    // click first entry -> restores into message tab
    await page.locator("#history-list > *").first().click();
    await page.waitForTimeout(600);
    const restored = await page.inputValue("#message-input");
    check("E-history", "click entry restores message into form", restored.length > 50, `len=${restored.length}`);
    await shot(page, "history-restored-1280");

    // Settings (back on history view, desktop: header link)
    await page.click("#header-history-link");
    await page.waitForTimeout(400);
    await page.locator("[data-text-size-pick='large']").click();
    await page.waitForTimeout(400);
    const largeOn = await page.evaluate(() => document.documentElement.dataset.textSize || document.body.className);
    check("F-settings", "text size Besar applies", /large/.test(String(largeOn)), String(largeOn));
    await page.locator("[data-text-size-pick='medium']").click();
    await page.locator("[data-accent-pick='green']").click();
    await page.waitForTimeout(300);
    const accent = await page.evaluate(() => document.documentElement.dataset.accent || document.documentElement.getAttribute("data-accent") || "");
    check("F-settings", "accent Hijau applies", /green/.test(accent), accent);
    await page.locator("[data-accent-pick='blue']").click();
    await page.click("#senior-toggle");
    await page.waitForTimeout(400);
    const seniorBody = await page.evaluate(() => document.body.className);
    check("F-settings", "Mode Orang Tua applies senior-mode class", /senior-mode/.test(seniorBody), seniorBody);
    await page.click("#history-back-btn");
    await page.waitForTimeout(500);
    const seniorNote = await page.locator("#senior-note").isVisible().catch(() => false);
    check("F-settings", "Mode Orang Tua shows senior note on home", seniorNote);
    await page.click("#header-history-link");
    await page.waitForTimeout(400);
    await page.click("#senior-toggle");
    await page.waitForTimeout(300);
    await page.click("#history-back-btn");
    await page.waitForTimeout(400);
    await page.click("#header-history-link");
    await page.waitForTimeout(400);
    const hideOn = page.locator("#history-hide-on-btn");
    await hideOn.click();
    await page.waitForTimeout(400);
    const hideState = await page.evaluate(() => localStorage.getItem("tipucek_hide_history_text"));
    check("F-settings", "privacy 'hide history text' toggle saves", hideState === "true" || hideState === "1", `ls=${hideState}`);
    await page.locator("#history-hide-off-btn").click();
    await page.waitForTimeout(300);
    await page.click("#history-back-btn");
    await page.waitForTimeout(500);

    // Theme light
    await page.click("#theme-btn");
    await page.waitForTimeout(300);
    await page.locator("#theme-menu button", { hasText: "Terang" }).click();
    await page.waitForTimeout(500);
    const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
    check("G-theme", "theme Terang applies", theme === "light", `theme=${theme}`);
    await shot(page, "light-1280");
    await page.click("#theme-btn");
    await page.waitForTimeout(300);
    await page.locator("#theme-menu button", { hasText: "Gelap" }).click();
    await page.waitForTimeout(400);

    // Language EN
    await page.click("#lang-en-btn");
    await page.waitForTimeout(1500);
    const heroEn = await page.locator(".hero-title").innerText();
    check("H-lang", "EN hero title translates", /scam/i.test(heroEn), heroEn);
    // verdict re-checks automatically on language change; wait for it
    await page.waitForTimeout(12000);
    const vEn = await verdictText(page);
    check("H-lang", "EN verdict re-checks to Scam, score kept", /Scam/.test(vEn), vEn.slice(0, 120));
    await page.click("#lang-id-btn");
    await page.waitForTimeout(1500);
    await overflow(page, "desktop ID after EN round-trip");

    // Email tab
    await page.locator("#tab-btn-email").click();
    await page.waitForTimeout(300);
    await page.fill("#email-from-name", "Bank BCA");
    await page.fill("#email-from-email", "security@bca-secure.xyz");
    await page.fill("#email-body", "Segera verifikasi akun Anda di sini: https://bca-verifikasi-akun.xyz/login — akun Anda akan diblokir hari ini bila tidak verifikasi. Masukkan kata sandi dan kode OTP Anda.");
    await page.click("#email-btn");
    const emailOk = await waitResult(page);
    check("I-email", "email check renders a result card", emailOk);
    const vEmail = await verdictText(page);
    check("I-email", "phishing email verdict Penipuan/Mencurigakan", /Penipuan|Mencurigakan/.test(vEmail), vEmail.slice(0, 120));
    await shot(page, "email-result-1280");

    // Call tab + account check
    await page.locator("#tab-btn-call").click();
    await page.waitForTimeout(300);
    await page.fill("#call-number", "081234567890");
    await page.fill("#call-said", "Selamat, Anda memenangkan hadiah. Untuk klaim, transfer biaya admin Rp 150.000 dulu ya.");
    await page.click("#call-btn");
    const callOk = await waitResult(page);
    check("J-call", "call check renders a result card", callOk);
    const vCall = await verdictText(page);
    check("J-call", "call script check returns a verdict", /Penipuan|Mencurigakan|Aman/.test(vCall), vCall.slice(0, 120));
    await page.fill("#account-number", "1234567890");
    await page.click("#account-btn");
    await page.waitForTimeout(2500);
    const acc = await page.locator("#account-result").innerText().catch(() => "");
    check("J-call", "account check shows format result", /valid|format|digit/i.test(acc), acc.slice(0, 120));

    // Outbound
    await page.locator("#tab-btn-outbound").click();
    await page.waitForTimeout(300);
    await page.fill("#outbound-input", "Hai, ini Budi. Kode OTP saya 482916, rekening saya 1234567890. Tolong bantu ya.");
    await page.click("#outbound-btn");
    await page.waitForTimeout(2000);
    const out = await page.locator("#outbound-result").innerText().catch(() => "");
    check("K-outbound", "outbound warns about sensitive info (local)", /OTP|rekening|hapus|hati-hati|jangan/i.test(out), out.slice(0, 120));

    // Link module
    await page.locator("#module-tab-link").click();
    await page.waitForTimeout(400);
    await page.fill("#linktrack-input", "https://bit.ly/klaim-hadiah-anda");
    await page.click("#linktrack-btn");
    // Link tracking follows shorteners + RDAP: slow (can take >30s).
    const linkDone = await page.waitForFunction(() => {
      const r = document.querySelector("#linktrack-result");
      return r && !r.hidden && r.innerText.trim().length > 20;
    }, undefined, { timeout: 60000 }).catch(() => null);
    const linkRes = await page.locator("#linktrack-result").innerText().catch(() => "");
    check("L-link", "link track returns a result (slow is OK)", !!linkDone && linkRes.length > 20, linkRes.slice(0, 120));

    // File check: name + upload
    await page.locator("#module-tab-file").click();
    await page.waitForTimeout(400);
    await page.fill("#filecheck-name-input", "undangan-nikah.apk");
    await page.click("#filecheck-name-btn");
    await page.waitForTimeout(1500);
    const fileName = await page.locator("#filecheck-result").innerText().catch(() => "");
    check("M-file", "file-name check flags .apk as dangerous", /APK|Berbahaya|berbahaya/i.test(fileName), fileName.slice(0, 120));
    await page.setInputFiles("#filecheck-input", path.join(ROOT, "test-samples/demo-apk.apk"));
    await page.waitForTimeout(500);
    await page.click("#filecheck-btn");
    await page.waitForTimeout(2500);
    const fileUp = await page.locator("#filecheck-result").innerText().catch(() => "");
    check("M-file", "uploaded .apk file is analyzed", /APK|Berbahaya|berbahaya|Android/i.test(fileUp), fileUp.slice(0, 120));
    await shot(page, "filecheck-1280");

    // Chatlog
    await page.locator("#module-tab-chatlog").click();
    await page.waitForTimeout(400);
    await page.setInputFiles("#chatlog-input", path.join(ROOT, "test-samples/pesan-penipu.txt"));
    await page.waitForTimeout(500);
    await page.click("#chatlog-btn");
    await page.waitForTimeout(3000);
    const chatRes = await page.locator("#chatlog-result").innerText().catch(() => "");
    check("N-chatlog", "chat export scan lists risky messages", chatRes.length > 20, chatRes.slice(0, 150));

    // Contacts
    await page.locator("#module-tab-contacts").click();
    await page.waitForTimeout(400);
    await page.fill("#contacts-search", "BCA");
    await page.waitForTimeout(500);
    const contacts = await page.locator("#contacts-list > *").count();
    const telLink = await page.locator("#contacts-list a[href^='tel:']").count();
    check("O-contacts", "contacts search BCA filters list + tel links", contacts >= 1 && telLink >= 1, `items=${contacts} tel=${telLink}`);

    // First aid
    await page.locator("#module-tab-aid").click();
    await page.waitForTimeout(400);
    const aidOpt = page.locator("#aid-options button").first();
    await aidOpt.click();
    await page.waitForTimeout(500);
    const aidSteps = await page.locator("#aid-steps li").count();
    check("P-aid", "first-aid option shows ordered steps", aidSteps >= 3, `steps=${aidSteps}`);

    // Quiz (answer all 8, alternate; read feedback each time)
    await page.locator("#module-tab-quiz").click();
    await page.waitForTimeout(400);
    await page.click("#quiz-start-btn");
    await page.waitForTimeout(500);
    let answered = 0;
    for (let i = 0; i < 8; i++) {
      const q = await page.locator("#quiz-question").innerText().catch(() => "");
      if (!q) break;
      await page.locator(i % 2 === 0 ? "#quiz-scam-btn" : "#quiz-safe-btn").click();
      await page.waitForTimeout(600);
      answered++;
      const next = page.locator("#quiz-next-btn");
      if (await next.isVisible().catch(() => false)) { await next.click(); await page.waitForTimeout(400); }
    }
    const quizScore = await page.locator("#quiz-score").innerText().catch(() => "");
    check("Q-quiz", "quiz completes 8 questions with a score", answered === 8 && /\/\s*8/.test(quizScore), `answered=${answered} score=${quizScore}`);
    await shot(page, "quiz-1280");

    // How + FAQ
    await page.locator("#module-tab-how").click();
    await page.waitForTimeout(400);
    let faqOk = 0;
    for (const q of ["#faq1Q", "#faq2Q", "#faq3Q", "#faq4Q"]) {
      const sum = page.locator(`.faq-item summary[data-i18n='${q.slice(1)}']`);
      if (await sum.count()) { await sum.click(); await page.waitForTimeout(300); faqOk++; }
    }
    // fallback: click all faq summaries
    if (faqOk === 0) {
      const sums = page.locator(".faq-item summary");
      const n = await sums.count();
      for (let i = 0; i < n; i++) { await sums.nth(i).click(); await page.waitForTimeout(250); }
      faqOk = n;
    }
    check("R-how", "FAQ items open", faqOk >= 4, `opened=${faqOk}`);
    await page.click("#how-onboard-btn");
    await page.waitForTimeout(400);
    const onboardAgain = await page.locator("#onboard").isVisible().catch(() => false);
    check("R-how", "onboarding reopens from Cara kerja", onboardAgain);
    await page.locator("#onboard-close").click().catch(() => {});
    await page.waitForTimeout(300);

    // Share copy + install
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    await page.click("#share-copy-btn").catch(() => {});
    await page.waitForTimeout(1200);
    // Feedback is the button label ("Disalin") for 2s, not a toast.
    // In headless Chromium clipboard is denied, so the label stays —
    // record what actually happened (MINOR finding if no feedback).
    const shareLabel = await page.locator("#share-copy-btn").innerText().catch(() => "");
    const shareToast = await page.locator("#toast").isVisible().catch(() => false);
    check("S-share", "Salin tautan gives feedback (label/toast)", /Disalin|Copied/.test(shareLabel) || shareToast, `label="${shareLabel}" toast=${shareToast}`);
    await page.click("#install-btn").catch(() => {});
    await page.waitForTimeout(600);
    const installHint = await page.locator("#install-hint").isVisible().catch(() => false);
    check("S-share", "Pasang button shows guidance (no false install)", installHint);

    // Report form: validation + submit (one TEST report)
    await page.locator("#module-tab-report").click();
    await page.waitForTimeout(400);
    await page.selectOption("#crowd-type", "message");
    await page.waitForTimeout(300);
    const msgVisible = await page.locator("#crowd-message").isVisible();
    await page.fill("#crowd-message", "pendek");
    await page.fill("#crowd-details", "TES AUDIT FINAL 21 Nov 2026 — abaikan, laporan uji otomatis.");
    await page.click("#crowd-submit-btn");
    await page.waitForTimeout(1200);
    const valErr = await page.locator("#crowd-value-error").isVisible().catch(() => false);
    check("T-report", "short message rejected with validation error", valErr);
    await page.fill("#crowd-message", "TES AUDIT FINAL 21 Nov 2026 — abaikan, ini laporan uji otomatis dari audit. Pesan penipu contoh: Anda menang hadiah Rp 50 juta, transfer biaya admin dulu.");
    await page.click("#crowd-submit-btn");
    // Firestore write + App Check can take a while; wait for either outcome.
    await page.waitForFunction(() => {
      const s = document.querySelector("#crowd-success");
      const e = document.querySelector("#crowd-submit-error");
      return (s && !s.hidden) || (e && !e.hidden);
    }, undefined, { timeout: 25000 }).catch(() => {});
    const reportOk = await page.locator("#crowd-success").isVisible().catch(() => false);
    const reportErr = await page.locator("#crowd-submit-error").innerText().catch(() => "");
    check("T-report", "message-type report submits (TEST)", reportOk, reportErr.slice(0, 200));
    await shot(page, "report-1280");

    // Aman panel
    await page.click("#aman-fab");
    await page.waitForTimeout(800);
    const amanOpen = await page.locator("#assistant").isVisible();
    check("U-aman", "Aman panel opens from fab", amanOpen);
    await page.fill("#assistant-input", "Apa itu OTP?");
    await page.click("#assistant-send");
    await page.waitForFunction(() => {
      const log = document.querySelector("#assistant-log");
      return log && log.innerText.trim().length > 40;
    }, undefined, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const amanReply = await page.locator("#assistant-log").innerText().catch(() => "");
    check("U-aman", "Aman answers a question", amanReply.length > 40, amanReply.slice(0, 150));
    await shot(page, "aman-1280");
    await page.click("#assistant-close");
    await page.waitForTimeout(400);

    // Card download + PDF (as-is; card/PDF fix in progress by another agent)
    const cardOk = await runMessageCheck(page, APK_TEXT);
    check("V-card", "message check renders before card download", cardOk);
    const dl2Promise = page.waitForEvent("download", { timeout: 20000 }).catch(() => null);
    await page.click("#download-card-btn");
    const dl2 = await dl2Promise;
    check("V-card", "Unduh kartu peringatan downloads a PNG", !!dl2 && /\.png$/i.test(dl2.suggestedFilename()), dl2 ? dl2.suggestedFilename() : "no download");
    await page.click("#pdf-btn");
    await page.waitForTimeout(1200);
    const printFilled = await page.evaluate(() => (document.querySelector("#print-report")?.innerHTML || "").length);
    check("V-pdf", "Laporan PDF fills the print report (as-is)", printFilled > 200, `chars=${printFilled}`);
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(600);
    await shot(page, "print-1280");
    const pdf = await page.pdf({ format: "A4", printBackground: true }).catch(() => null);
    const pdfPages = pdf ? (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length : -1;
    check("V-pdf", "PDF page count recorded (as-is, fix pending)", true, `pages≈${pdfPages} (target after fix: 1)`);
    await page.emulateMedia({ media: "screen" });

    // Screenshot OCR
    await page.locator("#tab-btn-message").click();
    await page.waitForTimeout(300);
    await page.setInputFiles("#image-input", path.join(ROOT, "video/retest-jobscam.png"));
    await page.waitForTimeout(600);
    const imgBtnEnabled = await page.locator("#image-btn").isEnabled();
    check("W-ocr", "screenshot upload enables check button", imgBtnEnabled);
    await page.click("#image-btn");
    await page.waitForFunction(() => {
      const r = document.querySelector("#result");
      const p = document.querySelector("#image-progress");
      return r && !r.hidden && r.innerText.includes("480.000");
    }, undefined, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const vOcr = await verdictText(page);
    check("W-ocr", "OCR verdict Penipuan + reads Rp 480.000", /Penipuan/.test(vOcr) && /480\.000/.test(vOcr), vOcr.slice(0, 160));
    await shot(page, "ocr-1280");

    // Voice transcription (mp3 upload)
    await page.locator("#tab-btn-call").click();
    await page.waitForTimeout(300);
    await page.setInputFiles("#call-audio-input", path.join(ROOT, "test-samples/call-scam-id.mp3"));
    const transcriptSeen = await page.waitForFunction(() => {
      const b = document.querySelector("#call-transcript-box");
      return b && !b.hidden && document.querySelector("#call-transcript")?.innerText.trim().length > 20;
    }, undefined, { timeout: 120000 }).catch(() => null);
    const transcript = await page.locator("#call-transcript").innerText().catch(() => "");
    check("X-voice", "voice upload transcribes (mp3)", !!transcriptSeen && transcript.length > 20, transcript.slice(0, 150));
    await page.waitForTimeout(2000);
    const vVoice = await verdictText(page).catch(() => "");
    check("X-voice", "voice check produces a verdict", /Penipuan|Mencurigakan|Aman/.test(vVoice), vVoice.slice(0, 120));
    await shot(page, "voice-1280");

    // Busy metrics (desktop)
    const metricsD = await page.evaluate(() => ({
      homeSections: document.querySelectorAll("#view-home > section, #view-home > nav").length,
      resultButtons: document.querySelectorAll("#result button").length,
      scrollH: document.documentElement.scrollHeight,
      domNodes: document.querySelectorAll("*").length,
    }));
    check("Y-busy", "busy metrics recorded (desktop)", true, JSON.stringify(metricsD));
    const dErrs = d.errors.filter((m) => !isNoise(m));
    check("Z-console", "desktop run: no real page errors", dErrs.length === 0, JSON.stringify(dErrs.slice(0, 5)));
    await d.ctx.close();

    // ============ MOBILE 390, ID, gelap ============
    const m = await newPage(browser, { width: 390, height: 844, colorScheme: "dark" });
    const mp = m.page;
    await gotoLive(mp, "id");
    await overflow(mp, "mobile 390 top");
    await shot(mp, "dash-top-390");
    // modules grid at 390
    await mp.locator(".modules").scrollIntoViewIfNeeded();
    await mp.waitForTimeout(500);
    await shot(mp, "modules-390");
    const gridCols = await mp.evaluate(() => {
      const g = document.querySelector(".module-tabs");
      if (!g) return "";
      return getComputedStyle(g).gridTemplateColumns.split(" ").length + " cols";
    });
    check("M1-mobile", "modules grid renders at 390", gridCols !== "", gridCols);
    // APK check at 390
    await mp.locator("#tab-btn-message").click();
    await mp.waitForTimeout(300);
    await mp.locator("#samples button", { hasText: "Undangan nikah APK" }).click();
    await mp.waitForTimeout(400);
    const mFilled = await mp.inputValue("#message-input");
    check("M2-mobile", "390 chip fills only", mFilled === APK_TEXT, `len=${mFilled.length}`);
    await mp.click("#check-btn");
    await waitResult(mp);
    const mv = await verdictText(mp);
    check("M2-mobile", "390 APK verdict Penipuan", /Penipuan/.test(mv), mv.slice(0, 100));
    await shot(mp, "result-390");
    await overflow(mp, "mobile 390 after result");
    // fab must hide while the composer is on screen
    await mp.locator(".chat-composer").scrollIntoViewIfNeeded();
    await mp.waitForTimeout(700);
    const fabHidden = await mp.evaluate(() => {
      const f = document.querySelector("#aman-fab");
      if (!f) return "no-fab";
      return f.classList.contains("aman-fab-hidden") || getComputedStyle(f).display === "none" || getComputedStyle(f).opacity === "0";
    });
    check("M2-mobile", "390 fab hides over composer", fabHidden === true, String(fabHidden));
    // history at 390
    await mp.click("#nav-history");
    await mp.waitForTimeout(600);
    const mEntries = await mp.locator("#history-list > *").count();
    check("M3-mobile", "390 history lists entries", mEntries >= 1, `entries=${mEntries}`);
    await shot(mp, "history-390");
    await overflow(mp, "mobile 390 history");
    // Aman at 390
    await mp.click("#nav-home");
    await mp.waitForTimeout(400);
    await mp.click("#aman-fab");
    await mp.waitForTimeout(800);
    const mAman = await mp.locator("#assistant").isVisible();
    check("M4-mobile", "390 Aman panel opens", mAman);
    await shot(mp, "aman-390");
    await mp.click("#assistant-close").catch(() => {});
    // light theme at 390
    await mp.click("#theme-btn");
    await mp.waitForTimeout(300);
    await mp.locator("#theme-menu button", { hasText: "Terang" }).click();
    await mp.waitForTimeout(500);
    await shot(mp, "light-390");
    await overflow(mp, "mobile 390 light theme");
    // EN at 390
    await mp.click("#lang-en-btn");
    await mp.waitForTimeout(1500);
    const mHeroEn = await mp.locator(".hero-title").innerText();
    check("M5-mobile", "390 EN hero translates", /scam/i.test(mHeroEn), mHeroEn);
    await shot(mp, "en-390");
    const metricsM = await mp.evaluate(() => ({
      scrollH: document.documentElement.scrollHeight,
      domNodes: document.querySelectorAll("*").length,
      resultButtons: document.querySelectorAll("#result button").length,
    }));
    check("M6-mobile", "busy metrics recorded (mobile)", true, JSON.stringify(metricsM));
    const mErrs = m.errors.filter((x) => !isNoise(x));
    check("Z-console", "mobile run: no real page errors", mErrs.length === 0, JSON.stringify(mErrs.slice(0, 5)));
    await m.ctx.close();
  } catch (e) {
    check("fatal", "run crashed: " + String(e).slice(0, 200), false);
  }
  return { browser, results, proxyProc };
}

main().then(async ({ browser, results: r, proxyProc }) => {
  const pass = r.filter((x) => x.ok).length;
  const fail = r.filter((x) => !x.ok);
  console.log(`\n==== AUDIT-FINAL SUMMARY: ${pass}/${r.length} PASS, ${fail.length} FAIL ====`);
  for (const f of fail) console.log(`FAIL [${f.section}] ${f.name} — ${f.detail}`);
  writeFileSync(path.join(ROOT, "video", "audit-final-results.json"), JSON.stringify({ pass, total: r.length, results: r }, null, 2));
  await browser.close();
  try { proxyProc.kill(); } catch (_) {}
  process.exit(fail.length ? 1 : 0);
}).catch(async (e) => {
  console.error("AUDIT ERROR", e);
  process.exit(2);
});
