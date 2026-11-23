// QUIZ SIMPLIFICATION VERIFICATION (21 Nov 2026, Myuden: "supaya lebih
// gampang dipahami pengguna") — the 8 quiz questions + "why" texts in
// src/quiz.js and the quizHint in src/i18n.js were simplified (short
// simple words, one idea per question). Ground truth, order, count and
// scoring are unchanged. This script proves it in the UI: play the
// quiz to the end in 4 contexts (390-ID, 390-EN, 1280-ID, 1280-EN),
// checking every question text matches the simplified bank exactly,
// every "why" shows, correct answers score and wrong answers do not,
// the result screen shows the final score, and no question is clipped.
// Runs on the DEMO server (deterministic, no network). Exit 0 only
// when ALL checks pass.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/quiz-verify.cjs
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { chromium } = require("/home/hatch/workspace/tools/rekam-layar/node_modules/playwright");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const SHOTS = path.join(ROOT, "video/panel-lainnya-shots");
const PROXY_PORT = 18099;
const DEMO_PORT = 5185;
const DEMO = `http://127.0.0.1:${DEMO_PORT}/`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 300) : ""}`);
}
const KNOWN_SANDBOX_NOISE = [
  /ERR_TUNNEL_CONNECTION_FAILED/, /status of 403/,
  /App Check could not obtain a token/, /appCheck\/fetch-status-error/,
  /Failed to load resource: the server responded with a status of 403/,
  /blocked by CORS policy/, /Failed to load resource: net::ERR_FAILED/,
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
  await waitForPort("127.0.0.1", PROXY_PORT);
  await waitForPort("127.0.0.1", DEMO_PORT);
  return { proxyProc, demoProc };
}
async function newPage(browser, { width, height = 844 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, locale: "id-ID", timezoneId: "Asia/Jakarta",
    colorScheme: "dark",
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "127.0.0.1,localhost" },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !isSandboxNoise(m.text())) pageErrors.push(m.text()); });
  return { ctx, page, pageErrors };
}
async function dismissOnboarding(page) {
  await page.waitForTimeout(500);
  const btn = page.locator("#onboard-start");
  if (await btn.count()) { await btn.click({ force: true }).catch(() => {}); await page.waitForTimeout(400); }
}

// Simplified bank (21 Nov 2026) — must match src/quiz.js exactly.
const BANK = {
  id: [
    { scam: true, text: "SELAMAT! Anda menang Rp 50.000.000 dari undian Telkomsel. Klik http://bit.ly/hadiah-2026, lalu bayar biaya admin Rp 150.000. Klaim hadiah sebelum 24 jam!", why: "Anda tidak pernah ikut undian ini. Tautannya pendek, ada biaya klaim, dan batas waktu 24 jam. Empat tanda penipuan dalam satu pesan." },
    { scam: false, text: "Halo Budi, ini Sari dari kantor. Rapat tim pindah ke Kamis pukul 10.00 di ruang 3B. Tolong bawa laporan Q3. Sampai jumpa!", why: "Ini pesan kerja biasa. Pengirimnya dikenal, tidak ada tautan, tidak ada uang, tidak ada desakan. Tidak ada yang bisa dipakai penipu." },
    { scam: true, text: "Halo, ini undangan pernikahan kami! Silakan unduh aplikasinya di sini: https://undangan-nikah-2026.xyz/invite.apk — mohon kehadirannya ya, terima kasih!", why: "Undangan yang meminta Anda memasang file .apk adalah penipuan APK yang paling sering terjadi di Indonesia. Undangan asli tidak pernah meminta Anda memasang aplikasi." },
    { scam: true, text: "Halo, ini customer service BCA di WhatsApp. Untuk verifikasi, kirim kode OTP Anda 482916 sekarang. Kalau tidak, akun Anda akan diblokir.", why: "Bank asli TIDAK PERNAH meminta OTP Anda — tidak di WhatsApp, tidak di mana pun. Minta OTP ditambah ancaman blokir selalu penipuan." },
    { scam: false, text: "Selamat pagi, ini Ibu Ratna dari sekolah. Rapat orang tua murid pindah ke hari Sabtu pukul 09.00. Terima kasih.", why: "Ini pemberitahuan sekolah biasa. Pengirimnya dikenal, tidak ada tautan, tidak ada pembayaran, tidak ada ancaman. Pesan aman memang terlihat biasa saja." },
    { scam: true, text: "LOWONGAN KERJA PARUH WAKTU! Gaji Rp 500.000/hari, kerja dari rumah, hanya like dan subscribe video YouTube. Daftar sekarang, bayar deposit Rp 100.000 untuk mengaktifkan akun. Hubungi WA 0812-3456-7890.", why: "Gaji besar untuk kerja mudah, ditambah deposit untuk 'aktivasi' — deposit itu SENDIRI penipuannya. Perusahaan asli tidak pernah meminta Anda membayar untuk mulai bekerja." },
    { scam: false, text: "BCA: Transaksi kartu debit Anda Rp 250.000 di TOKOPEDIA berhasil. Hubungi Halo BCA 1500888 kalau Anda tidak merasa melakukan transaksi ini.", why: "Notifikasi bank ini TANPA tautan dan memakai nomor resmi bank (1500888). Notifikasi aman memberi tahu Anda harus menelepon ke mana — tidak pernah meminta Anda mengklik apa pun." },
    { scam: true, text: "Akun Anda akan DIBLOKIR dalam 24 jam karena aktivitas mencurigakan. Verifikasi sekarang di https://bca-secure-verify.xyz/login, atau Anda akan kehilangan akses.", why: "Ancaman blokir, batas 24 jam, dan alamat web tiruan (bca-secure-verify.xyz, bukan bca.co.id). Desakan ditambah halaman login palsu = phishing." },
  ],
  en: [
    { scam: true, text: "CONGRATULATIONS! You won Rp 50,000,000 in the Telkomsel lottery. Click http://bit.ly/prize-2026 and pay a Rp 150,000 admin fee. Claim your prize within 24 hours!", why: "You never entered this lottery. The link is short, there is a fee to claim, and a 24-hour deadline. Four scam signs in one message." },
    { scam: false, text: "Hi Budi, this is Sari from the office. The team meeting moves to Thursday 10:00 in room 3B. Please bring the Q3 report. See you there!", why: "An ordinary work message. The sender is known, no link, no money, no rush. A scammer cannot use anything here." },
    { scam: true, text: "Hello, this is our wedding invitation! Please download the app here: https://wedding-invite-2026.xyz/invite.apk — we hope you can come. Thank you!", why: "A wedding invitation that asks you to install an .apk file is the most common APK scam in Indonesia. A real invitation never asks you to install an app." },
    { scam: true, text: "Hello, this is BCA customer service on WhatsApp. Please send your OTP code 482916 now to verify your account. If not, your account will be blocked.", why: "A real bank NEVER asks for your OTP — not on WhatsApp, not anywhere. Asking for an OTP plus a blocking threat is always a scam." },
    { scam: false, text: "Good morning, this is Mrs. Ratna from the school. The parents meeting moves to Saturday 09:00. Thank you.", why: "An ordinary school notice. The sender is known, no link, no payment, no threat. Safe messages look plain — that is normal." },
    { scam: true, text: "PART-TIME JOB! Earn Rp 500,000/day working from home, just like and subscribe to YouTube videos. Register now, pay a Rp 100,000 deposit to activate your account. Contact WA 0812-3456-7890.", why: "Huge pay for easy work, plus a deposit to 'activate' — the deposit IS the scam. Real employers never ask you to pay to start working." },
    { scam: false, text: "BCA: Your debit card payment of Rp 250,000 at TOKOPEDIA was successful. Call Halo BCA 1500888 if you did not make this payment.", why: "A bank message with NO link and the bank's real official number (1500888). Safe messages tell you where to call — they never ask you to click." },
    { scam: true, text: "Your account will be BLOCKED within 24 hours because of suspicious activity. Verify now at https://bca-secure-verify.xyz/login or you will lose access.", why: "A blocking threat, a 24-hour deadline, and a look-alike web address (bca-secure-verify.xyz is not bca.co.id). Urgency plus a fake login page = phishing." },
  ],
};
const CORRECT_WORD = { id: "Benar!", en: "Correct!" };
const WRONG_WORD = { id: "Belum tepat", en: "Not quite" };

async function noClip(page, selector, label) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { ok: false, detail: "missing" };
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const clipped = el.scrollWidth > el.clientWidth + 1 || r.left < -1 || r.right > vw + 1;
    return { ok: !clipped, detail: `left=${Math.round(r.left)} right=${Math.round(r.right)} vw=${vw} scrollW=${el.scrollWidth} clientW=${el.clientWidth}` };
  }, selector).then((res) => check(label, res.ok, res.detail));
}

async function playQuiz(browser, { width, lang, wrongFirst, shotPrefix }) {
  const tag = `${width}-${lang}${wrongFirst ? "-wrong1" : ""}`;
  const { ctx, page, pageErrors } = await newPage(browser, { width });
  try {
    await page.goto(DEMO, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(1200);
    await dismissOnboarding(page);
    if (lang === "en") {
      await page.click("#lang-en-btn");
      await page.waitForTimeout(400);
    }
    // Open the quiz panel.
    await page.click("#module-tab-quiz");
    await page.waitForTimeout(400);
    check(`${tag} quiz panel opens`, await page.locator("#quiz-start-btn").isVisible());
    const hintWant = {
      id: "Baca tiap pesan, lalu tebak: penipuan atau aman? TipuCek menjelaskan kenapa jawabannya begitu. Supaya Anda bisa mengenali tandanya sendiri.",
      en: "Read each message and guess: scam or safe? TipuCek explains why the answer is what it is. So you can spot the signs yourself.",
    }[lang];
    const hintShown = ((await page.locator("[data-i18n='quizHint']").textContent()) || "").trim();
    check(`${tag} hint = simplified`, hintShown === hintWant, hintShown.slice(0, 80));
    // Start.
    await page.click("#quiz-start-btn");
    await page.waitForTimeout(300);
    const expected = BANK[lang];
    let score = 0;
    for (let i = 0; i < 8; i++) {
      const q = expected[i];
      const shown = (await page.locator("#quiz-question").textContent() || "").trim();
      check(`${tag} q${i + 1} text = simplified bank`, shown === q.text, shown.slice(0, 80));
      await noClip(page, "#quiz-question", `${tag} q${i + 1} not clipped`);
      if (i === 0 && shotPrefix) {
        await page.locator("#quiz-question").scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `${shotPrefix}-q1.png`) });
      }
      // Answer: wrong on q1 only when wrongFirst, otherwise correct.
      const answerScam = wrongFirst && i === 0 ? !q.scam : q.scam;
      await page.click(answerScam ? "#quiz-scam-btn" : "#quiz-safe-btn");
      await page.waitForTimeout(300);
      const fb = (await page.locator("#quiz-feedback").textContent() || "").trim();
      const wantWord = (wrongFirst && i === 0) ? WRONG_WORD[lang] : CORRECT_WORD[lang];
      check(`${tag} q${i + 1} feedback word`, fb.includes(wantWord), fb.slice(0, 60));
      check(`${tag} q${i + 1} why shown`, fb.includes(q.why), fb.slice(0, 80));
      await noClip(page, "#quiz-feedback", `${tag} q${i + 1} feedback not clipped`);
      const scoreTxt = (await page.locator("#quiz-score").textContent() || "").trim();
      if (!(wrongFirst && i === 0) && q.scam === answerScam) score += 1;
      const wantScore = lang === "id" ? `Skor: ${score} / ${i + 1}` : `Score: ${score} / ${i + 1}`;
      check(`${tag} q${i + 1} score`, scoreTxt === wantScore, scoreTxt);
      // Next (last question: the button finishes the quiz).
      await page.click("#quiz-next-btn");
      await page.waitForTimeout(300);
    }
    const finalBtn = (await page.locator("#quiz-start-btn").textContent() || "").trim();
    const wantFinal = lang === "id" ? `Skor: ${wrongFirst ? 7 : 8} / 8` : `Score: ${wrongFirst ? 7 : 8} / 8`;
    check(`${tag} result screen score`, finalBtn.includes(wantFinal), finalBtn);
    if (shotPrefix) {
      await page.locator("#quiz-start-btn").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, `${shotPrefix}-done.png`) });
    }
    check(`${tag} no page errors`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
  } finally {
    await ctx.close();
  }
}

(async () => {
  const { proxyProc, demoProc } = await startServers();
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  try {
    await playQuiz(browser, { width: 390, lang: "id", wrongFirst: false, shotPrefix: "quiz-390-id" });
    await playQuiz(browser, { width: 390, lang: "en", wrongFirst: true, shotPrefix: null });
    await playQuiz(browser, { width: 1280, lang: "id", wrongFirst: false, shotPrefix: null });
    await playQuiz(browser, { width: 1280, lang: "en", wrongFirst: false, shotPrefix: "quiz-1280-en" });
  } finally {
    await browser.close();
    proxyProc.kill(); demoProc.kill();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${failed.length} failed.`);
  if (failed.length) { console.log("FAILURES:"); failed.forEach((f) => console.log(" - " + f.name)); }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
