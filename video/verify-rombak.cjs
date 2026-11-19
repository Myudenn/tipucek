#!/usr/bin/env node
// Fase D verification for the TipuCek rombak (local build, vite preview).
// Starts: local proxy (:18085) + vite preview (:4173).
// Tests desktop 1280x800 + mobile 390x844 (touch), manifest/SW/share-target.
// Output: JSON summary on stdout + screenshots in video/raw/.
// Usage: node video/verify-rombak.cjs
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn, execSync } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18085", 10);
const PREVIEW_PORT = 4173;
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });

const SCAM_SAMPLE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!";
const OTP_SAMPLE =
  "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";
// Paste fixture MUST differ from SCAM_SAMPLE: the freshness wait looks for
// a unique string, and the first scam check already renders SCAM_SAMPLE —
// reusing it made the wait return on the stale card (race, runs 13/14).
const PASTE_SAMPLE =
  "SELAMAT! Anda memenangkan hadiah Rp 25.000.000 dari undian Indosat. Klik http://bit.ly/hadiah-indosat-2026 dan bayar biaya admin Rp 100.000 sebelum 24 jam!";
// A QRIS payload (CRC 909F, merchant TOKO BERKAH, IDR 50000) — the
// QRIS feature was REMOVED 19 Nov by Myuden's order ("Qris tidak usah
// kalau tidak bisa"), so pasting it must produce NO QRIS box, NO QRIS
// text, NO QRIS verdict anywhere: it is ordinary text now.
const QRIS_GONE_SAMPLE =
  "00020101021126180014ID.CO.QRIS.WWW5204541153033605405500005802ID5911TOKO BERKAH6007JAKARTA6304909F";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail || "").slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
}

// Demo-build dance: this script MUST run against a DEMO build (no
// Firebase config). On localhost a production build calls the real AI
// through App Check's debug provider, whose per-profile debug token
// is never registered in the console — every AI check then fails
// with 403 and the run times out (seen in the independent re-audit,
// which ran the script against a production build by mistake).
// Registering one debug token does NOT fix it: every fresh Playwright
// context generates a new token. So the script moves .env.local
// aside, builds demo, and restores + rebuilds production at the end
// — even on crash. The move uses copy+unlink (not rename) because
// /tmp and the workspace can sit on different filesystems.
const ENV_LOCAL = path.join(ROOT, ".env.local");
const ENV_MOVED = "/tmp/.env.local.verify-rombak";
let envSha = null;
let demoBundle = null;
function mainBundleName() {
  const files = fs.readdirSync(path.join(ROOT, "dist/assets")).filter((f) => /^index-[A-Za-z0-9]+\.js$/.test(f));
  return files[0] || null;
}
function sha256File(p) {
  return require("crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function moveEnvAside() {
  if (!fs.existsSync(ENV_LOCAL)) {
    // A crashed earlier run may have left the backup behind: recover
    // it first instead of silently running (and rebuilding) demo.
    if (fs.existsSync(ENV_MOVED)) {
      console.log("demo build: WARNING — .env.local missing, recovering it from a leftover backup");
      fs.copyFileSync(ENV_MOVED, ENV_LOCAL);
      fs.chmodSync(ENV_LOCAL, 0o600);
      fs.unlinkSync(ENV_MOVED);
    } else {
      console.log("demo build: WARNING — no .env.local found anywhere; the final rebuild will also be a DEMO bundle");
      return null;
    }
  }
  const sha = sha256File(ENV_LOCAL);
  fs.copyFileSync(ENV_LOCAL, ENV_MOVED);
  fs.unlinkSync(ENV_LOCAL);
  console.log(`demo build: .env.local moved aside (sha256 ${sha.slice(0, 12)}…)`);
  return sha;
}
function restoreEnvAndRebuild() {
  if (!envSha) return;
  try {
    if (!fs.existsSync(ENV_MOVED)) {
      console.error("demo build: .env.local backup MISSING — production bundle NOT rebuilt");
      return;
    }
    fs.copyFileSync(ENV_MOVED, ENV_LOCAL);
    fs.chmodSync(ENV_LOCAL, 0o600);
    fs.unlinkSync(ENV_MOVED);
    const restored = sha256File(ENV_LOCAL);
    console.log(`demo build: .env.local restored (sha256 match: ${restored === envSha})`);
    console.log("demo build: rebuilding production bundle…");
    execSync("npm run build", { cwd: ROOT, stdio: "ignore" });
    console.log("demo build: production bundle rebuilt");
    // Guard: the production bundle must differ from the demo bundle
    // (Vite hashes content, and the env values change it). If the
    // names are identical, .env.local was missing at the start and
    // the rebuild is demo too — say so loudly instead of leaving a
    // demo dist behind silently. (A placeholder grep does NOT work:
    // the "YOUR_..." fallback literals stay in every bundle.)
    const prodBundle = mainBundleName();
    if (prodBundle && prodBundle === demoBundle) {
      console.error(`demo build: WARNING — rebuilt bundle ${prodBundle} is identical to the demo bundle. .env.local was probably missing — restore it and rebuild.`);
    } else {
      console.log(`demo build: production bundle ${prodBundle} differs from demo ${demoBundle} (production OK)`);
    }
  } catch (e) {
    console.error("demo build: restore/rebuild FAILED:", e.message);
  }
}

async function waitForPort(host, port, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect(port, host);
        s.once("connect", () => { s.end(); resolve(); });
        s.once("error", reject);
      });
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`port ${host}:${port} did not open in ${timeoutMs}ms`);
}

async function waitForHttp200(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`GET ${url} never returned 200 in ${timeoutMs}ms`);
}

async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;

  // --- start proxy + preview ---
  // Clear a stale preview from a previous crashed run on OUR port only
  // (the cmdline carries the port, so other agents' previews are safe).
  // The proxy is left alone: a stale one on 18085 forwards identically,
  // and its port is not in the cmdline so it cannot be scoped safely.
  try { execSync(`pkill -f "preview --host 127.0.0.1 --port ${PREVIEW_PORT}" || true`); } catch (_) {}
  await new Promise((r) => setTimeout(r, 1000));
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  const previewProc = spawn(process.execPath, [
    path.join(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort",
  ], { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  previewProc.stderr.on("data", (d) => console.error("preview:", String(d).trim()));
  try {
    await waitForPort("127.0.0.1", PROXY_PORT);
    await waitForHttp200(`http://127.0.0.1:${PREVIEW_PORT}/`);
  } catch (e) {
    proxyProc.kill(); previewProc.kill();
    console.error("FAILED to start servers:", e.message);
    restoreEnvAndRebuild();
    process.exit(2);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });

  const errors = [];
  const firestoreReqs = [];
  const trackSends = []; // rdap.org / shorteners: must be 0 while local-only is ON
  function wirePage(page) {
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + String((e && e.message) || e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`CONSOLE-ERROR: ${m.text().slice(0, 200)}`);
    });
    page.on("requestfailed", (req) => errors.push(`REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
    page.on("request", (req) => {
      if (/firestore\.googleapis\.com/.test(req.url())) {
        firestoreReqs.push({ url: req.url().slice(0, 200), method: req.method(), body: (req.postData() || "").slice(0, 600) });
      }
      if (/rdap\.org|bit\.ly|tinyurl\.com|t\.co\//.test(req.url())) {
        trackSends.push(req.url().slice(0, 200));
      }
    });
  }

  try {
    // ================= DESKTOP =================
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await ctx.newPage();
    wirePage(page);
    // Stub window.print so the PDF test never opens a dialog.
    await page.addInitScript(() => {
      window.__printCalled = false;
      window.print = () => { window.__printCalled = true; };
    });
    await page.goto(`http://localhost:${PREVIEW_PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(5000);

    const title = await page.title();
    check("desktop: title contains TipuCek", /TipuCek/.test(title), title);
    const bodyText = await page.evaluate(() => document.body.innerText);
    check("desktop: 0 PesanAman in UI text", !bodyText.includes("PesanAman"), bodyText.includes("PesanAman") ? "FOUND" : "clean");
    check("roam removed: #aman-roam absent (Myuden 19 Nov: roaming obstructed content)", (await page.locator("#aman-roam").count()) === 0);
    // Avatar: robot-perisai-bintan (Myuden 19 Nov ~12:50, final). Served
    // file must be the robot PNG, not the anime backup; the panel img
    // must load. Retry the fetch: the preview can be briefly unready
    // under parallel load (crash in run 16).
    let avatarServed = null;
    for (let attempt = 0; attempt < 3 && !avatarServed; attempt++) {
      try {
        avatarServed = await page.evaluate(async () => {
          const buf = await (await fetch("/aman.png")).arrayBuffer();
          const hash = await crypto.subtle.digest("SHA-256", buf);
          const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
          const img = document.querySelector("#aman-avatar img");
          return { hex: hex.slice(0, 16), imgOk: !!img && img.complete && img.naturalWidth > 0 };
        });
      } catch (e) {
        if (attempt < 2) await page.waitForTimeout(1500);
      }
    }
    if (avatarServed) {
      check("avatar: served /aman.png is the robot file", avatarServed.hex === "1e575bc271e30f38", `sha=${avatarServed.hex}`);
      check("avatar: #aman-avatar img loads", avatarServed.imgOk);
    } else {
      check("avatar: served /aman.png is the robot file", false, "fetch failed after 3 attempts");
      check("avatar: #aman-avatar img loads", false, "fetch failed after 3 attempts");
    }
    // "How it works" (original section): 3 step cards, one heading id,
    // heading text is translated (not a raw i18n key).
    check("how: 3 step cards present", (await page.locator(".how-card").count()) === 3);
    check("how: single #how-heading id", (await page.locator("#how-heading").count()) === 1);
    check("how: heading is not a raw i18n key", (await page.locator("#how-heading").innerText()).trim() !== "howHeading");
    check("desktop: hero shows TipuCek", await page.locator(".brand h1").innerText().then((t) => t.trim() === "TipuCek"), await page.locator(".brand h1").innerText());
    check("desktop: 4 checker tabs", (await page.locator(".checker-tab-btn").count()) === 4);
    // Voice defaults to ON on first visit (19 Nov fix) — the toggle
    // is saved, so a fresh context shows "Voice: on".
    check("voice: toggle defaults to on (first visit)", (await page.locator("#voice-toggle").innerText()).trim() === "Voice: on", await page.locator("#voice-toggle").innerText());
    for (const id of ["checks-heading", "filecheck-heading", "linktrack-heading", "contacts-heading", "aid-heading", "chatlog-heading", "quiz-heading"]) {
      check(`desktop: section #${id} present`, await page.locator(`#${id}`).count() === 1);
    }
    check("desktop: checks list has 8 items", (await page.locator(".checks-list li").count()) === 8);
    // Meta description: short enough for search results (~155 chars),
    // naming the product and the job — it no longer lists every
    // detection (that made it 383 chars; SERPs show ~155-160).
    check("desktop: meta description is short and on-topic", await page.evaluate(() => {
      const m = document.querySelector('meta[name="description"]');
      return m && m.content.length <= 160 && /TipuCek/i.test(m.content) && /scam/i.test(m.content);
    }));
    check("desktop: apple-touch-icon linked", await page.locator('link[rel="apple-touch-icon"]').count() === 1);
    check("desktop: no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await page.evaluate(() => `scrollWidth=${document.documentElement.scrollWidth} innerWidth=${window.innerWidth}`));
    await page.screenshot({ path: path.join(RAW, "rombak-desktop-hero.png") });

    // --- (1) scam sample check (AI path) ---
    const fsBefore = firestoreReqs.length;
    await page.locator("#samples button").first().click();
    await page.click("#check-btn");
    await page.waitForSelector("#result .result-card", { timeout: 90000 });
    const verdictText = await page.locator("#result .result-status").innerText();
    const scoreText = await page.locator("#result .ring-value strong").innerText();
    const badgeText = await page.locator("#result .result-badge").innerText();
    check("check: scam sample verdict is Scam", /Scam|Penipuan/.test(verdictText), `${verdictText} ${scoreText}/100`);
    check("check: scam sample score >= 60", parseInt(scoreText, 10) >= 60, scoreText);
    check("check: badge shown", /ON_DEVICE|IN_CLOUD|DEMO|LOCAL/.test(badgeText), badgeText.replace(/\n/g, " "));
    // "Dengar" (Listen) button on the result card (19 Nov fix) — it
    // used to exist only under Aman's answers.
    check("result: Listen button exists on the result card", (await page.locator("#listen-result-btn").count()) === 1);
    const errBeforeListen = errors.length;
    await page.click("#listen-result-btn");
    await page.waitForTimeout(3000);
    check("result: Listen click causes no page errors", errors.length === errBeforeListen, errors.slice(errBeforeListen).join(" | ").slice(0, 200));
    check("check: result has family + PDF buttons", (await page.locator("#warn-family-btn").count()) === 1 && (await page.locator("#pdf-btn").count()) === 1);
    check("check: no report button when no identifiers (scam sample has none)", (await page.locator("#report-btn").count()) === 0);
    check("privacy: 0 Firestore requests during first check (local-only ON)", firestoreReqs.length === fsBefore, `${firestoreReqs.length - fsBefore} requests`);
    // Privacy gate (audit §2c fix): with local-only ON (default),
    // link tracking must NOT run — resolving a short link fetches the
    // shortener and RDAP sends the domain to rdap.org, both network
    // sends of data from the user's message. The box now shows an
    // honest "skipped" note instead of staying silently empty, and
    // zero requests to rdap.org/shorteners may leave the browser.
    await page.waitForTimeout(3000);
    const trackNote = await page.evaluate(() => {
      const el = document.querySelector("#link-track");
      return el ? el.innerText : "";
    });
    check("privacy: link-track shows the skipped note while local-only is ON", /skipped|dilewati/i.test(trackNote), trackNote.slice(0, 150));
    check("privacy: 0 rdap.org/shortener requests while local-only is ON", trackSends.length === 0, `${trackSends.length} sends: ${trackSends.slice(0, 3).join(" | ")}`);
    await page.screenshot({ path: path.join(RAW, "rombak-desktop-result.png") });

    // --- (2) outbound guard ---
    await page.click("#tab-btn-outbound");
    await page.fill("#outbound-input", "Kode OTP saya 482916, password: rahasia123. Kirim ke rekening 1234567890 ya.");
    await page.click("#outbound-btn");
    await page.waitForSelector("#outbound-result:not([hidden])", { timeout: 5000 });
    const outHtml = await page.locator("#outbound-result").innerHTML();
    check("outbound: warns OTP + password + account", /OTP/.test(outHtml) && /Password|Kata sandi/.test(outHtml) && /rekening|account/i.test(outHtml), outHtml.replace(/<[^>]+>/g, " ").slice(0, 200));
    check("outbound: raw secrets never shown (masked)", !outHtml.includes("482916") && !outHtml.includes("rahasia123") && !outHtml.includes("1234567890"), "masked values only");
    check("outbound: not a scam verdict", !/Scam|Penipuan/.test(await page.locator("#outbound-result").innerText()) || /Stop|Berhenti/.test(await page.locator("#outbound-result").innerText()), "warning, not verdict");

    // --- (3) one-tap paste ---
    await page.click("#tab-btn-message");
    await page.evaluate((text) => navigator.clipboard.writeText(text), PASTE_SAMPLE);
    await page.click("#paste-btn");
    // Wait for THIS check's render: the paste auto-check is slow (~2s:
    // clipboard read + analyze), and the marker must be unique to the
    // paste text — SCAM_SAMPLE is already rendered by step (1), so
    // waiting for it returns on the stale card (race, runs 13/14).
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("hadiah-indosat-2026");
    }, { timeout: 90000 });
    const pasted = await page.inputValue("#message-input");
    check("paste: clipboard text filled + auto-check ran", pasted === PASTE_SAMPLE, `len=${pasted.length}`);

    // --- (4) email phishing check (LOCAL) ---
    await page.click("#tab-btn-email");
    await page.fill("#email-from-name", "BCA");
    await page.fill("#email-from-email", "bca-promo@gmail.com");
    await page.fill("#email-body", "URGENT: Your BCA account will be blocked in 24 hours! Verify now at https://bca-secure-verify.xyz/login or you lose access.");
    await page.click("#email-btn");
    // Wait for THIS check's render, not the stale card from the previous
    // check: the checked message must contain this email's link.
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("bca-secure-verify.xyz");
    }, { timeout: 15000 });
    const emailBadge = await page.locator("#result .result-badge").innerText();
    const emailStatus = await page.locator("#result .result-status").innerText();
    check("email: LOCAL badge", /LOCAL/.test(emailBadge), emailBadge.replace(/\n/g, " "));
    check("email: mismatch + freemail verdict scam/suspicious", /Scam|Penipuan|Suspicious|Mencurigakan/.test(emailStatus), emailStatus);

    // --- (5) phone call check (LOCAL) ---
    await page.click("#tab-btn-call");
    await page.fill("#call-number", "081234567890");
    await page.fill("#call-said", "Saya dari bank BCA, akun Anda akan diblokir, kirim kode OTP sekarang.");
    await page.click("#call-btn");
    // Wait for THIS check's render: the checked message must contain the
    // caller number of this check.
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("081234567890");
    }, { timeout: 15000 });
    const callBadge = await page.locator("#result .result-badge").innerText();
    const callStatus = await page.locator("#result .result-status").innerText();
    const callRing = await page.locator("#result .ring-value strong").innerText();
    check("call: LOCAL badge", /LOCAL/.test(callBadge), callBadge.replace(/\n/g, " "));
    // Ring 85 = this call's own score (bank 25 + OTP 35 + threat 25).
    // If a late render overwrote it, the ring reads 100 (scam sample) —
    // that distinguishes an app bug (ring 85 + wrong badge) from a stale
    // render (ring 100).
    check("call: ring is this check's own score (85)", callRing.trim() === "85", `ring=${callRing}`);
    check("call: script patterns flagged (bank+OTP+threat)", /Scam|Penipuan|Suspicious|Mencurigakan/.test(callStatus), callStatus);
    await page.screenshot({ path: path.join(RAW, "rombak-desktop-call.png") });

    // --- (5b) phone call check, number only (gap 2) ---
    // No "paste a message first" error: the number alone is checked
    // (official match / format / reports) and judged Suspicious 30.
    await page.fill("#call-said", "");
    await page.click("#call-btn");
    await page.waitForFunction(() => document.querySelector("#result .ring-value strong")?.textContent.trim() === "30", { timeout: 15000 });
    const callOnlyStatus = await page.locator("#result .result-status").innerText();
    check("call: number-only check gives Suspicious 30 (no 'paste first' error)", /Suspicious|Mencurigakan/.test(callOnlyStatus), callOnlyStatus);
    check("call: number-only error stays hidden", await page.locator("#call-error").isHidden());

    // --- (5c) QRIS is GONE (removed 19 Nov, Myuden's order) ---
    // A pasted QRIS payload is ordinary text now: no QRIS box, no
    // QRIS wording, no QRIS verdict anywhere in the result.
    await page.click("#tab-btn-message");
    await page.fill("#message-input", QRIS_GONE_SAMPLE);
    await page.click("#check-btn");
    await page.waitForSelector("#result .result-card", { timeout: 90000 });
    const goneResultText = await page.locator("#result").innerText();
    check("qris-gone: no .qris-box in the result", (await page.locator("#result .qris-box").count()) === 0);
    check("qris-gone: no QRIS wording in the result", !/QRIS/i.test(goneResultText), goneResultText.replace(/\n/g, " | ").slice(0, 200));
    const pageTextNoQris = await page.evaluate(() => document.body.innerText);
    check("qris-gone: no QRIS wording anywhere on the page", !/QRIS/i.test(pageTextNoQris));

    // --- (5d) call voice UI (gap 5, demo mode) ---
    // Controls exist, the honest limit is stated (no direct tapping),
    // and an uploaded recording in demo mode is honestly refused —
    // no fake transcript, no verdict from audio.
    await page.click("#tab-btn-call");
    check("call-voice: record + upload controls present", (await page.locator("#call-record-btn").count()) === 1 && (await page.locator("#call-upload-btn").count()) === 1);
    const callLimitText = await page.locator(".call-audio").innerText();
    check("call-voice: honest limit stated (cannot tap a call directly)", /cannot listen to a phone call directly/i.test(callLimitText), callLimitText.replace(/\n/g, " | ").slice(0, 200));
    check("call-voice: privacy note (sent to cloud only to transcribe)", /sent to the cloud.*only to transcribe/i.test(callLimitText), callLimitText.replace(/\n/g, " | ").slice(0, 300));
    const ringBeforeAudio = await page.locator("#result .ring-value strong").innerText().then((s) => s.trim());
    await page.setInputFiles("#call-audio-input", path.join(ROOT, "test-samples/call-scam-id.mp3"));
    await page.waitForSelector("#call-audio-error:not([hidden])", { timeout: 30000 });
    const audioErrText = await page.locator("#call-audio-error").innerText();
    check("call-voice: demo mode honestly refuses transcription", /demo mode cannot transcribe|needs the cloud AI/i.test(audioErrText), audioErrText);
    check("call-voice: no fake transcript shown", await page.locator("#call-transcript-box").isHidden());
    const ringAfterAudio = await page.locator("#result .ring-value strong").innerText();
    check("call-voice: no verdict rendered from the refused audio", ringAfterAudio.trim() === ringBeforeAudio, `before=${ringBeforeAudio} after=${ringAfterAudio}`);

    // --- (6) file check: fake APK (magic bytes) + real EXE + plain txt ---
    const crypto = require("crypto");
    const apkBytes = fs.readFileSync(path.join(ROOT, "video/fixtures/fake-invite.apk"));
    const apkSha16 = crypto.createHash("sha256").update(apkBytes).digest("hex").slice(0, 16);
    await page.setInputFiles("#filecheck-input", path.join(ROOT, "video/fixtures/fake-invite.apk"));
    await page.click("#filecheck-btn");
    // Wait for the result, not just the visible box: the box shows
    // "Checking the file…" first, and reading it then is a race.
    await page.waitForFunction(() => {
      const el = document.querySelector("#filecheck-result");
      return el && !el.hidden && !/Checking the file|Memeriksa file/.test(el.innerText);
    }, { timeout: 30000 });
    const fcHtml = await page.locator("#filecheck-result").innerHTML();
    check("filecheck: APK detected by magic bytes (high)", /Android|APK/i.test(fcHtml), fcHtml.replace(/<[^>]+>/g, " ").slice(0, 200));
    check("filecheck: SHA-256 shown matches node hash", fcHtml.includes(apkSha16), `expected prefix ${apkSha16}`);
    await page.setInputFiles("#filecheck-input", path.join(ROOT, "video/fixtures/program.exe"));
    await page.click("#filecheck-btn");
    await page.waitForTimeout(3000);
    const fcExe = await page.locator("#filecheck-result").innerText();
    check("filecheck: EXE detected by MZ signature", /Windows|program/i.test(fcExe), fcExe.slice(0, 150));
    await page.setInputFiles("#filecheck-input", path.join(ROOT, "video/fixtures/note.txt"));
    await page.click("#filecheck-btn");
    await page.waitForTimeout(3000);
    const fcTxt = await page.locator("#filecheck-result").innerText();
    check("filecheck: plain .txt not flagged as dangerous", !/APK|Windows program/i.test(fcTxt), fcTxt.slice(0, 150));
    // Scam .txt (gap 1): content is read + scored, never "unknown type".
    await page.setInputFiles("#filecheck-input", path.join(ROOT, "video/fixtures/scam-note.txt"));
    await page.click("#filecheck-btn");
    await page.waitForTimeout(3000);
    const fcScam = await page.locator("#filecheck-result").innerText();
    check("filecheck: scam .txt is scored (not 'unknown type')", /Scam|Penipuan/.test(fcScam), fcScam.slice(0, 200));
    check("filecheck: scam .txt offers the AI check button", (await page.locator("#filecheck-ai-btn").count()) === 1);
    await page.screenshot({ path: path.join(RAW, "rombak-desktop-filecheck.png") });

    // --- (6b) standalone link tracker (gap 4) ---
    await page.fill("#linktrack-input", "https://bit.ly/hadiah-telkomsel-2026");
    await page.click("#linktrack-btn");
    await page.waitForFunction(() => {
      const el = document.querySelector("#linktrack-result");
      return el && !el.hidden && /bit\.ly/.test(el.innerText) && /Registrar|Terdaftar|Registered|No registry/i.test(el.innerText);
    }, { timeout: 30000 });
    const ltText = await page.locator("#linktrack-result").innerText();
    check("linktrack: standalone module traces a short link", /bit\.ly/.test(ltText) && /Registrar|Terdaftar|Registered|No registry/i.test(ltText), ltText.replace(/\n/g, " | ").slice(0, 200));

    // --- (7) official contacts ---
    await page.fill("#contacts-search", "bca");
    await page.waitForTimeout(500);
    const contactsText = await page.locator("#contacts-list").innerText();
    check("contacts: search BCA finds 1500888", /BCA/.test(contactsText) && /1500888/.test(contactsText), contactsText.slice(0, 150));
    await page.fill("#contacts-search", "");
    await page.locator(".contacts-cat-btn", { hasText: "Banks" }).click();
    await page.waitForTimeout(500);
    const bankText = await page.locator("#contacts-list").innerText();
    check("contacts: bank filter shows only banks", /BCA/.test(bankText) && /BRI/.test(bankText) && !/OVO/.test(bankText), bankText.replace(/\n/g, " | ").slice(0, 200));
    await page.locator(".contacts-cat-btn", { hasText: /^All$/ }).click();

    // --- (8) first aid ---
    await page.locator(".aid-opt", { hasText: "I sent money" }).click();
    await page.waitForSelector("#aid-steps:not([hidden])", { timeout: 5000 });
    check("firstaid: money scenario shows 3 steps", (await page.locator("#aid-steps li").count()) === 3, await page.locator("#aid-steps").innerText().then((t) => t.slice(0, 150)));

    // --- (9) chat-log scanner ---
    await page.setInputFiles("#chatlog-input", path.join(ROOT, "video/fixtures/chat-export.txt"));
    await page.click("#chatlog-btn");
    await page.waitForSelector("#chatlog-result:not([hidden])", { timeout: 15000 });
    const clText = await page.locator("#chatlog-result").innerText();
    check("chatlog: 3 messages scanned, 1 risky", /3/.test(clText) && /1/.test(clText) && /Sari/.test(clText), clText.slice(0, 200));

    // --- (10) quiz ---
    await page.click("#quiz-start-btn");
    await page.waitForSelector("#quiz-area:not([hidden])", { timeout: 5000 });
    const q1 = await page.locator("#quiz-question").innerText();
    await page.click("#quiz-scam-btn");
    await page.waitForSelector("#quiz-feedback:not([hidden])", { timeout: 5000 });
    const fb1 = await page.locator("#quiz-feedback").innerText();
    check("quiz: Q1 (scam) answered correctly with explanation", /Correct/.test(fb1) && /prize|fee|short/i.test(fb1), fb1.slice(0, 200));
    await page.click("#quiz-next-btn");
    await page.waitForTimeout(500);
    const q2 = await page.locator("#quiz-question").innerText();
    check("quiz: Q2 differs from Q1", q2 !== q1, q2.slice(0, 80));
    await page.click("#quiz-safe-btn");
    await page.waitForSelector("#quiz-feedback:not([hidden])", { timeout: 5000 });
    const fb2 = await page.locator("#quiz-feedback").innerText();
    check("quiz: Q2 (safe) answered correctly", /Correct/.test(fb2), fb2.slice(0, 150));
    const quizScore = await page.locator("#quiz-score").innerText();
    check("quiz: score 2/2 after two correct answers", /2 \/ 2/.test(quizScore), quizScore);
    await page.screenshot({ path: path.join(RAW, "rombak-desktop-quiz.png") });

    // --- (11) PDF report + family warning (from the OTP verdict) ---
    // Samples live inside the message tab, hidden while email/call tab is active.
    await page.click("#tab-btn-message");
    await page.waitForTimeout(300);
    await page.locator("#samples button").nth(5).click(); // sampleOtp
    await page.click("#check-btn");
    // Wait for THIS check's render (350ms demo delay): the checked message
    // must contain the OTP code unique to this sample. A plain
    // waitForSelector(".result-card") returns the stale card from the
    // previous check and every read after it is wrong.
    await page.waitForFunction(() => {
      const el = document.querySelector("#result .checked-message p");
      return el && el.textContent.includes("482916");
    }, { timeout: 90000 });
    const otpStatus = await page.locator("#result .result-status").innerText();
    // True DEMO-heuristic verdict for this sample (verified in Node):
    // Suspicious 40/100 — urgency + OTP ask, no link. Not "Scam": the
    // heuristic cannot know BCA's real number. Assert the real value.
    check("report: OTP sample verdict is Suspicious (not safe)", /Suspicious|Mencurigakan/.test(otpStatus), otpStatus);
    check("report: report button appears (identifiers present)", (await page.locator("#report-btn").count()) === 1);
    // PDF: stubbed window.print must be called + print section filled.
    await page.click("#pdf-btn");
    await page.waitForTimeout(1000);
    const printCalled = await page.evaluate(() => window.__printCalled === true);
    const printText = await page.locator("#print-report").innerText();
    check("pdf: window.print() called", printCalled);
    check("pdf: print section holds verdict + flags + number", /Verdict|Penipuan|Scam|Suspicious/i.test(printText) && /0812/.test(printText), printText.slice(0, 200));
    // Family warning: wa.me link with prefilled text.
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 10000 }).catch(() => null),
      page.click("#warn-family-btn"),
    ]);
    check("family: wa.me popup opens", !!popup, popup ? popup.url().slice(0, 120) : "no popup");
    if (popup) {
      check("family: wa.me text mentions TipuCek + verdict", /(wa\.me|api\.whatsapp\.com)\/.*text=/.test(popup.url()) && /TipuCek/.test(decodeURIComponent(popup.url())), decodeURIComponent(popup.url()).slice(0, 200));
      await popup.close();
    }
    // Report button: tap -> thanks or honest failure (record which).
    const fsBeforeReport = firestoreReqs.length;
    await page.click("#report-btn");
    await page.waitForTimeout(8000);
    const reportBtnText = await page.locator("#report-btn").innerText();
    const reportOk = /Thank you|Terima kasih/.test(reportBtnText);
    const reportFail = /could not be sent|tidak bisa dikirim/i.test(reportBtnText);
    check("report: tap gives thanks OR honest failure (never silent)", reportOk || reportFail, reportBtnText.slice(0, 150));
    const newFsReqs = firestoreReqs.slice(fsBeforeReport);
    const rawLeak = newFsReqs.some((r) => /0812|9876-5432|98765432/.test(r.body) || /0812|9876/.test(r.url));
    check("report: no raw phone number in any Firestore request", !rawLeak, `${newFsReqs.length} firestore reqs during report`);
    await page.screenshot({ path: path.join(RAW, "rombak-desktop-otp-result.png") });

    // --- (12) senior mode ---
    await page.click("#senior-toggle");
    await page.waitForTimeout(500);
    check("senior: body.senior-mode on", await page.evaluate(() => document.body.classList.contains("senior-mode")));
    check("senior: check button becomes 'Check this message'", (await page.locator("#check-btn").innerText()).trim() === "Check this message", await page.locator("#check-btn").innerText());
    check("senior: choice saved in localStorage", await page.evaluate(() => localStorage.getItem("tipucek_senior_mode") === "1"));
    check("senior: note shown", await page.locator("#senior-note").isVisible());
    // A LOCAL check while senior mode is on must not throw (voice readout runs).
    const errBefore = errors.length;
    await page.click("#tab-btn-email");
    await page.fill("#email-from-name", "BCA");
    await page.fill("#email-from-email", "bca@bca.co.id");
    await page.fill("#email-body", "Hello, your monthly statement is ready. Visit the official app to view it.");
    await page.click("#email-btn");
    await page.waitForSelector("#result .result-card", { timeout: 15000 });
    await page.waitForTimeout(3000);
    check("senior: verdict read-aloud causes no page errors", errors.length === errBefore, errors.slice(errBefore).join(" | ").slice(0, 200));
    await page.click("#senior-toggle"); // restore off

    // --- (13) voice toggle (headless: no voices -> falls back off, honestly) ---
    await page.click("#voice-toggle");
    await page.waitForTimeout(2500);
    const voiceText = await page.locator("#voice-toggle").innerText();
    check("voice: toggle handled without page error", /Voice/.test(voiceText), voiceText);

    // --- (14) share target: ?text= fills checker + auto-checks ---
    const sharePage = await ctx.newPage();
    wirePage(sharePage);
    await sharePage.goto(`http://localhost:${PREVIEW_PORT}/?text=${encodeURIComponent(SCAM_SAMPLE)}`, { waitUntil: "load", timeout: 60000 });
    await sharePage.waitForSelector("#result .result-card", { timeout: 90000 });
    const shareFilled = await sharePage.inputValue("#message-input");
    check("share-target: ?text= fills checker + auto-checks", shareFilled === SCAM_SAMPLE, `len=${shareFilled.length}`);

    // --- (15) judge flow: history complete, survives reload ---
    const hist1 = await sharePage.locator("#history-list").innerText();
    check("judge: history shows full message after check", /Telkomsel/.test(hist1), hist1.slice(0, 150));
    await sharePage.reload({ waitUntil: "load", timeout: 60000 });
    await sharePage.waitForTimeout(4000);
    const hist2 = await sharePage.locator("#history-list").innerText();
    check("judge: history still complete after reload", /Telkomsel/.test(hist2), hist2.slice(0, 150));
    await sharePage.close();

    // --- (16) manifest + service worker + standalone criteria ---
    const manifest = await page.evaluate(async () => {
      const r = await fetch("/manifest.webmanifest");
      return r.json();
    });
    check("pwa: manifest name/short_name TipuCek", manifest.name && manifest.name.includes("TipuCek") && manifest.short_name === "TipuCek", manifest.name);
    check("pwa: display standalone", manifest.display === "standalone", manifest.display);
    const iconSizes = (manifest.icons || []).map((i) => i.sizes);
    check("pwa: icons 192 + 512 + maskable", iconSizes.includes("192x192") && iconSizes.includes("512x512") && (manifest.icons || []).some((i) => i.purpose === "maskable"), JSON.stringify(iconSizes));
    check("pwa: share_target accepts text+url", !!(manifest.share_target && manifest.share_target.params && manifest.share_target.params.text === "text" && manifest.share_target.params.url === "url"), JSON.stringify(manifest.share_target));
    const swReg = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg ? { scope: reg.scope, active: !!reg.active } : null;
    });
    check("pwa: service worker registered", !!swReg, JSON.stringify(swReg));
    // Privacy gate, second half: with local-only OFF (user opted into
    // cloud history), link tracking DOES run — the box fills with the
    // RDAP domain info (short-link itself is CORS-blocked, honestly
    // reported as "cannot be traced").
    await page.uncheck("#local-only-toggle");
    await page.click("#tab-btn-message");
    await page.locator("#samples button").first().click();
    await page.click("#check-btn");
    try {
      await page.waitForFunction(() => {
        const el = document.querySelector("#link-track");
        return el && el.innerHTML.trim().length > 0;
      }, { timeout: 20000 });
      const trackText = await page.locator("#link-track").innerText();
      check("track: link-track box fills when local-only is OFF", true, trackText.replace(/\n/g, " | ").slice(0, 200));
    } catch {
      check("track: link-track box fills when local-only is OFF", false, "still empty after 20s (RDAP/short-link unreachable?)");
    }
    await ctx.close();

    // ================= MOBILE =================
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      ignoreHTTPSErrors: true,
    });
    const mpage = await mctx.newPage();
    wirePage(mpage);
    await mpage.goto(`http://localhost:${PREVIEW_PORT}/`, { waitUntil: "load", timeout: 60000 });
    await mpage.waitForTimeout(4000);
    check("mobile: no horizontal overflow", await mpage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      await mpage.evaluate(() => `scrollWidth=${document.documentElement.scrollWidth} innerWidth=${window.innerWidth}`));
    const checkBtnH = await mpage.locator("#check-btn").evaluate((el) => el.getBoundingClientRect().height);
    check("mobile: check button touch target >= 44px", checkBtnH >= 44, `height=${checkBtnH}`);
    const tabBtnH = await mpage.locator("#tab-btn-email").evaluate((el) => el.getBoundingClientRect().height);
    check("mobile: tab button touch target >= 44px", tabBtnH >= 44, `height=${tabBtnH}`);
    await mpage.locator("#samples button").first().click();
    await mpage.click("#check-btn");
    await mpage.waitForSelector("#result .result-card", { timeout: 90000 });
    check("mobile: sample check works", true, await mpage.locator("#result .result-status").innerText());
    await mpage.screenshot({ path: path.join(RAW, "rombak-mobile-hero.png") });
    await mpage.screenshot({ path: path.join(RAW, "rombak-mobile-result.png"), fullPage: false });
    await mctx.close();
  } finally {
    await browser.close().catch(() => {});
    proxyProc.kill();
    previewProc.kill();
  }

  // --- summary ---
  const pageErrors = errors.filter((e) => e.startsWith("PAGEERROR"));
  const reqFails = errors.filter((e) => e.startsWith("REQFAIL"));
  const consoleErrors = errors.filter((e) => e.startsWith("CONSOLE-ERROR"));
  check("0 uncaught page errors (pageerror events)", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n===== SUMMARY =====");
  console.log(`passed ${passed}/${results.length}`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(` - ${f.name} — ${f.detail}`);
  }
  console.log(`pageerrors: ${pageErrors.length} | request failures: ${reqFails.length} | console errors: ${consoleErrors.length}`);
  if (reqFails.length > 0) console.log("REQFAIL:", reqFails.slice(0, 5).join(" | "));
  if (consoleErrors.length > 0) console.log("CONSOLE-ERROR:", consoleErrors.slice(0, 5).join(" | "));
  console.log(`firestore requests total: ${firestoreReqs.length}`);
  restoreEnvAndRebuild();
  process.exit(failed.length > 0 ? 1 : 0);
}

envSha = moveEnvAside();
try {
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
  demoBundle = mainBundleName();
  console.log(`demo build: demo bundle built (${demoBundle})`);
} catch (e) {
  console.error("demo build failed:", e.message);
  restoreEnvAndRebuild();
  process.exit(2);
}
main().catch((e) => { console.error("VERIFY CRASH:", e); restoreEnvAndRebuild(); process.exit(2); });
