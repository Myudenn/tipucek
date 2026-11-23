#!/usr/bin/env node
// AUDIT-4 LIVE VERIFY (21 Nov 2026) — proves the audit-4 fixes on the
// LIVE site (bundle index-B5uk4SjM.js): Mode-AI label + hint per tab,
// call OTP card counts (3=3, no prize flag, "Laporan komunitas"
// heading), email bca-secure-login.com counts (5=5), bit.ly honest
// note, hero OJK href = OJK press release, week chart still without
// Y-axis numbers (regression).
// Run: node video/verify-scripts/audit4-live-verify.cjs
const path = require("path");
const { spawn } = require("child_process");
const { createRequire } = require("module");

const HOME = process.env.HOME || "";
const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(ROOT, "tmp", "proof-audit-baru");
const LIVE = "https://tipucek.web.app";
const PROXY_PORT = 18098;
const PROXY_SCRIPT = path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js");
const PLAYWRIGHT_PATH = path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright");
const requirePw = createRequire(path.join(PLAYWRIGHT_PATH, "index.js"));
const { chromium } = requirePw(PLAYWRIGHT_PATH);

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : " — " + extra}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OTP_SCRIPT =
  "Selamat pagi, saya dari Bank BCA. Akun Bapak telah diblokir. Untuk membuka blokirnya, mohon sebutkan kode OTP yang baru saja Bapak terima.";
const EMAIL_BODY =
  "Yth. Nasabah, akun Anda akan diblokir dalam 24 jam. Segera verifikasi data Anda di sini: https://bca-secure-login.com/verifikasi-akun";
const PRIZE_MSG =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!";
const APK_MSG =
  "Halo, ini undangan pernikahan kami! Silakan download aplikasinya di sini: https://undangan-nikah-2026.xyz/invite.apk — mohon kehadirannya ya, terima kasih!";

async function readCard(page) {
  // A new check first renders the "checking" placeholder, then the
  // final card (async: community lookups / cloud attempt). Wait for
  // the placeholder to appear, then vanish — that brackets the new
  // render and avoids reading the previous card.
  try {
    await page.waitForSelector("#result .result-checking", { timeout: 8000 });
    await page.waitForSelector("#result .result-checking", { state: "detached", timeout: 60000 });
  } catch (e) {
    // No placeholder seen (instant local render): fall through.
  }
  await page.waitForSelector("#result .result-card:not(.result-checking)", { timeout: 60000 });
  await page.waitForFunction(
    () => {
      const ring = document.querySelector("#result .result-score-ring");
      return ring && ring.innerText.includes("/");
    },
    { timeout: 60000 },
  );
  return page.evaluate(() => {
    const card = document.querySelector("#result .result-card");
    const txt = card ? card.innerText : "";
    const topFlags = [...document.querySelectorAll("#result .result-card ul.flags li")].map((li) => li.innerText.trim());
    const foundRows = [...document.querySelectorAll("#result .local-checks li.found")].map((li) => li.innerText.trim().slice(0, 80));
    const totalRows = document.querySelectorAll("#result .local-checks li").length;
    const pills = [...document.querySelectorAll("#result .check-pills .meta-pill")].map((p) => p.innerText.trim());
    const scoreEl = document.querySelector("#result .result-score-ring");
    const statusEl = document.querySelector("#result .result-status");
    const badgeEl = document.querySelector("#result .result-badge");
    return {
      text: txt,
      top: topFlags.length,
      topFlags,
      found: foundRows.length,
      foundRows,
      total: totalRows,
      pills,
      score: scoreEl ? scoreEl.innerText.trim().replace(/\s+/g, " ") : "",
      status: statusEl ? statusEl.innerText.trim() : "",
      badge: badgeEl ? badgeEl.innerText.trim().replace(/\s+/g, " ") : "",
    };
  });
}

async function readCardText(page) {
  return page.evaluate(() => {
    const card = document.querySelector("#result .result-card");
    return card ? card.innerText : "";
  });
}

async function waitEnrichment(page, timeoutMs = 20000) {
  // Enrichment fills #report-counts / #link-track asynchronously
  // AFTER the final card renders (Firestore count, short-link +
  // RDAP lookups). Wait until at least one box is non-empty, then
  // settle — a box that never fills is itself data for the caller.
  try {
    await page.waitForFunction(
      () => {
        const rc = document.querySelector("#report-counts");
        const lt = document.querySelector("#link-track");
        return (rc && rc.innerHTML.trim() !== "") || (lt && lt.innerHTML.trim() !== "");
      },
      { timeout: timeoutMs },
    );
  } catch (e) {
    /* enrichment never landed — assertions below will show it */
  }
  await page.waitForTimeout(800);
}

async function modeState(page) {
  return page.evaluate(() => {
    const label = document.querySelector("#mode-label");
    const hint = document.querySelector("#checker-hint");
    const bodyTxt = document.body.innerText || "";
    return {
      label: label ? label.innerText.trim() : "",
      hint: hint ? hint.innerText.trim().slice(0, 120) : "",
      modeAiCount: (bodyTxt.match(/Mode AI/g) || []).length,
    };
  });
}

(async () => {
  const proxy = spawn(process.execPath, [PROXY_SCRIPT], {
    env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) },
    stdio: "ignore",
  });
  await sleep(1500);
  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", `--proxy-server=http://127.0.0.1:${PROXY_PORT}`],
    });
    // ---- Desktop 1280, ID, dark, history seeded (10 scams today) ----
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "id-ID",
      colorScheme: "dark",
      ignoreHTTPSErrors: true,
      proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    });
    await ctx.addInitScript(() => {
      const now = new Date().toISOString();
      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `seed-${i}`,
        createdAt: now,
        status: "scam",
        riskScore: 95,
        message: "pesan penipuan tes",
        source: "message",
      }));
      localStorage.setItem("pesanaman_history_v1", JSON.stringify(entries));
      localStorage.setItem("pesanaman_theme", "dark");
      localStorage.setItem("pesanaman_lang", "id");
    });
    const page = await ctx.newPage();
    await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(2500);
    const onboard = page.locator("#onboard-start");
    if (await onboard.isVisible().catch(() => false)) await onboard.click();
    await page.waitForTimeout(800);

    const bundle = await page.evaluate(() =>
      [...document.querySelectorAll("script[src]")].map((s) => s.src).join(" "),
    );
    check("live serves bundle index-B5uk4SjM.js", /index-B5uk4SjM\.js/.test(bundle), bundle.slice(0, 160));

    const heroHref = await page.evaluate(() => {
      const a = document.querySelector(".hero-source a");
      return a ? a.href : "";
    });
    check(
      "hero OJK link = OJK press release",
      heroHref === "https://ojk.go.id/id/berita-dan-kegiatan/siaran-pers/Pages/OJK-dan-Bareskrim-Polri-Sepakat-Perkuat-Kolaborasi-Penanganan-Pengaduan-Pada-Indonesia-Anti-Scam-Centre.aspx",
      heroHref,
    );

    // ---- Week chart regression (desktop) — FIRST, before this
    // session's own checks add to history (seeded 10 only) ----
    check("week chart: no #week-chart-yaxis", (await page.locator("#week-chart-yaxis").count()) === 0);
    check("week chart: 7 bars", (await page.locator(".week-bar").count()) === 7);
    const counts0 = await page.locator(".week-bar-count").allTextContents();
    check("week chart: Saturday bar shows 10", counts0[counts0.length - 1] === "10", counts0.join(","));

    // ---- Mode label + hint per tab ----
    const tabs = [
      ["message", "#tab-btn-message", "Mode AI", "Dalam mode AI"],
      ["email", "#tab-btn-email", "Cek di perangkat", "di perangkat"],
      ["call", "#tab-btn-call", "Cek di perangkat", "di perangkat"],
      ["outbound", "#tab-btn-outbound", "Cek di perangkat", "di perangkat"],
    ];
    for (const [name, btn, wantLabel, wantHint] of tabs) {
      await page.click(btn);
      await page.waitForTimeout(500);
      const st = await modeState(page);
      check(`tab ${name}: label "${wantLabel}"`, st.label === wantLabel, `got "${st.label}"`);
      check(`tab ${name}: hint contains "${wantHint}"`, st.hint.includes(wantHint), st.hint.slice(0, 90));
      if (name === "message") {
        check(`tab ${name}: "Mode AI" visible (expected)`, st.modeAiCount > 0, `count=${st.modeAiCount}`);
      } else {
        check(`tab ${name}: no "Mode AI" visible`, st.modeAiCount === 0, `count=${st.modeAiCount}`);
      }
    }

    // ---- Call OTP ----
    await page.click("#tab-btn-call");
    await page.waitForTimeout(400);
    await page.fill("#call-number", "081234567890");
    await page.fill("#call-said", OTP_SCRIPT);
    await page.click("#call-btn");
    const call = await readCard(page);
    console.log("CALL card:", JSON.stringify({ score: call.score, status: call.status, badge: call.badge, top: call.top, found: call.found, total: call.total, pills: call.pills }, null, 1));
    console.log("CALL top flags:", JSON.stringify(call.topFlags, null, 1));
    console.log("CALL found rows:", JSON.stringify(call.foundRows, null, 1));
    check("call OTP: top == checklist found (3=3)", call.top === 3 && call.found === 3, `top=${call.top} found=${call.found}`);
    await waitEnrichment(page);
    const callText = await readCardText(page);
    check("call OTP: no 'Janji hadiah' anywhere on card", !/Janji hadiah/i.test(callText), "");
    check("call OTP: heading 'Laporan komunitas'", /Laporan komunitas/.test(callText), "");
    check("call OTP: 'Belum ada laporan pengguna lain untuk ini.'", /Belum ada laporan pengguna lain untuk ini/.test(callText), "");
    check("call OTP: numbersWarn kept ('tidak punya database nomor penipu sendiri')", /tidak punya database nomor penipu sendiri/.test(callText), "");
    await page.locator("#result").screenshot({ path: path.join(SHOTS, "call-otp-1280.png") });

    // ---- Email bca-secure-login.com ----
    await page.click("#tab-btn-email");
    await page.waitForTimeout(400);
    await page.fill("#email-from-name", "BCA");
    await page.fill("#email-from-email", "support@bca-secure-login.com");
    await page.fill("#email-body", EMAIL_BODY);
    await page.click("#email-btn");
    const email = await readCard(page);
    console.log("EMAIL card:", JSON.stringify({ score: email.score, status: email.status, badge: email.badge, top: email.top, found: email.found, total: email.total, pills: email.pills }, null, 1));
    console.log("EMAIL top flags:", JSON.stringify(email.topFlags, null, 1));
    console.log("EMAIL found rows:", JSON.stringify(email.foundRows, null, 1));
    check("email: top == checklist found (5=5)", email.top === 5 && email.found === 5, `top=${email.top} found=${email.found}`);
    check("email: 21 checks examined", email.total === 21, `total=${email.total}`);
    check("email: high-risk link flag present", email.topFlags.some((f) => /tautan/i.test(f)), email.topFlags.join(" | "));
    await page.locator("#result").screenshot({ path: path.join(SHOTS, "email-bca-1280.png") });

    // ---- Message: prize sample (bit.ly note) ----
    await page.click("#tab-btn-message");
    await page.waitForTimeout(400);
    await page.fill("#message-input", PRIZE_MSG);
    await page.click("#check-btn");
    const prize = await readCard(page);
    console.log("PRIZE card:", JSON.stringify({ score: prize.score, status: prize.status, badge: prize.badge, top: prize.top, found: prize.found, total: prize.total, pills: prize.pills }, null, 1));
    await waitEnrichment(page);
    const prizeText = await readCardText(page);
    if (/cloud/i.test(prize.badge)) {
      // IN_CLOUD verdict: top = the AI's own flags, checklist = the
      // 17-rule heuristic second signal — different systems by design
      // (labelled "Tanda bahaya (vonis AI)" vs "Cek di perangkat"),
      // so no equality is expected here. Equality is guaranteed for
      // LOCAL/CODE/DEMO verdicts, where the checklist IS the verdict.
      console.log("NOTE prize: IN_CLOUD verdict — top (AI) vs checklist (heuristic) differ by design, no equality asserted");
      check("prize cloud: checklist is the 17-rule heuristic (6 found)", prize.total === 17 && prize.found === 6, `total=${prize.total} found=${prize.found}`);
    } else {
      check("prize: top == checklist found", prize.top === prize.found && prize.top > 0, `top=${prize.top} found=${prize.found}`);
    }
    check("prize: bit.ly honest note ('tidak bisa dilacak')", /tidak bisa dilacak/i.test(prizeText), "");
    await page.locator("#result").screenshot({ path: path.join(SHOTS, "message-prize-1280.png") });

    // ---- Message: APK sample ----
    await page.fill("#message-input", APK_MSG);
    await page.click("#check-btn");
    const apk = await readCard(page);
    console.log("APK card:", JSON.stringify({ score: apk.score, status: apk.status, badge: apk.badge, top: apk.top, found: apk.found, total: apk.total, pills: apk.pills }, null, 1));
    await waitEnrichment(page);
    if (/cloud/i.test(apk.badge)) {
      console.log("NOTE apk: IN_CLOUD verdict — top (AI) vs checklist (heuristic) differ by design, no equality asserted");
      check("apk cloud: checklist is the 17-rule heuristic (3 found)", apk.total === 17 && apk.found === 3, `total=${apk.total} found=${apk.found}`);
    } else {
      check("apk: top == checklist found (3=3)", apk.top === 3 && apk.found === 3, `top=${apk.top} found=${apk.found}`);
    }
    await page.locator("#result").screenshot({ path: path.join(SHOTS, "message-apk-1280.png") });

    // ---- Week chart already verified above (before session checks) ----
    await ctx.close();

    // ---- Mobile 390 regression shot ----
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "id-ID",
      colorScheme: "dark",
      ignoreHTTPSErrors: true,
      proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    });
    await mctx.addInitScript(() => {
      const now = new Date().toISOString();
      const entries = Array.from({ length: 10 }, (_, i) => ({
        id: `seed-${i}`,
        createdAt: now,
        status: "scam",
        riskScore: 95,
        message: "pesan penipuan tes",
        source: "message",
      }));
      localStorage.setItem("pesanaman_history_v1", JSON.stringify(entries));
      localStorage.setItem("pesanaman_theme", "dark");
      localStorage.setItem("pesanaman_lang", "id");
    });
    const mpage = await mctx.newPage();
    await mpage.goto(LIVE, { waitUntil: "load", timeout: 60000 });
    await mpage.waitForTimeout(2500);
    const mobOnboard = mpage.locator("#onboard-start");
    if (await mobOnboard.isVisible().catch(() => false)) await mobOnboard.click();
    await mpage.waitForTimeout(800);
    check("mobile 390: no #week-chart-yaxis", (await mpage.locator("#week-chart-yaxis").count()) === 0);
    const mcounts = await mpage.locator(".week-bar-count").allTextContents();
    check("mobile 390: Saturday bar shows 10", mcounts[mcounts.length - 1] === "10", mcounts.join(","));
    const mchart = mpage.locator("#week-chart");
    await mchart.scrollIntoViewIfNeeded();
    await mpage.waitForTimeout(400);
    await mchart.screenshot({ path: path.join(SHOTS, "week-chart-390.png") });
    await mctx.close();
  } finally {
    if (browser) await browser.close();
    proxy.kill("SIGKILL");
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("ERROR", e);
  process.exit(1);
});
