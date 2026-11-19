#!/usr/bin/env node
// Crowd report-back verification — LOCAL BUILD + FIREBASE EMULATORS ONLY.
//
// Starts Firestore + Auth emulators (project tipucek from
// .firebaserc, rules from firestore.rules), builds the app with
// VITE_USE_FIRESTORE_EMULATOR=1 (so the page talks to
// 127.0.0.1:8080 / :9099 instead of production), serves it on
// localhost, and drives the "Laporkan penipuan" form with
// Playwright: invalid phone rejected, one phone + one account + one
// mode report submitted, each verified to land in the EMULATOR
// crowd_reports collection (REST + Bearer owner admin read) with
// exactly the 6 fields + status pending, success message shown,
// and the reports recorded in local history. Asserts ZERO requests
// to *.googleapis.com the whole run — proof no test report touched
// production.
//
// NEVER submits anything to https://tipucek.web.app.
// At the end the production bundle is rebuilt (plain npm run build)
// so dist/ is left clean.
// Usage: node video/verify-crowd.cjs
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn, execSync } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18085", 10);
const PREVIEW_PORT = 4174;
const EMU_HOST = "127.0.0.1";
const EMU_FIRESTORE_PORT = 8080;
const EMU_AUTH_PORT = 9099;
const PROJECT = "tipucek";

// Java for the emulator: see tests/crowd-rules-emulator.mjs — a
// Temurin JRE 21 lives in ~/java/jre21 (apt's JRE vanished on a VM
// restart, Ubuntu mirror unreachable). Prepend it so firebase-tools
// can spawn `java`.
const JRE_BIN = path.join(HOME, "java/jre21/bin");
const EMU_ENV = fs.existsSync(path.join(JRE_BIN, "java"))
  ? { ...process.env, PATH: `${JRE_BIN}:${process.env.PATH}` }
  : process.env;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail || "").slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 200) : ""}`);
}
let skippedCount = 0;
function skip(name, reason) {
  skippedCount++;
  results.push({ name, ok: null, skipped: true, detail: reason });
  console.log(`SKIP ${name} — ${reason}`);
}

// REST document-path probe (same failure as tests/crowd-rules-emulator.mjs:
// the emulator starts and its hub answers, but document operations fail
// with 503 "Network closed for unknown reason" in this sandbox, or HTTP
// 500 with INTERNAL: http2 exception in firestore-debug.log). The probe
// POSTs a valid doc with the owner token (rules bypassed), so ONLY HTTP
// 200 means the document path works.
async function probeDocumentPath() {
  const url = `http://${EMU_HOST}:${EMU_FIRESTORE_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/crowd_reports`;
  const body = JSON.stringify({
    fields: {
      type: { stringValue: "phone" },
      value: { stringValue: "081234567890" },
      details: { stringValue: "Penipu mengaku dari bank dan minta kode OTP." },
      status: { stringValue: "pending" },
      createdAt: { timestampValue: "2026-11-19T00:00:00Z" },
      reporterUid: { nullValue: null },
    },
  });
  let lastStatus = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
        body,
        signal: AbortSignal.timeout(10000),
      });
      lastStatus = `HTTP ${res.status}`;
      if (res.status === 200) {
        console.log("probe: document path answers (HTTP 200) — transport OK");
        return "ok";
      }
      await res.text().catch(() => "");
      await new Promise((r) => setTimeout(r, 5000));
    } catch (e) {
      lastStatus = e?.name === "TimeoutError" ? "timeout" : String(e?.message || e).slice(0, 100);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  console.log(`SKIP: emulator document path unavailable in this sandbox (REST probe: ${lastStatus} on 3 attempts).`);
  console.log("SKIP: evidence — 503 {\"code\":503,\"message\":\"Network closed for unknown reason\",\"status\":\"UNAVAILABLE\"} /");
  console.log("SKIP: HTTP 500 with INTERNAL: http2 exception (firestore-debug.log); the bare emulator jar without");
  console.log("SKIP: --rules fails identically, so this is NOT the rules.");
  console.log("SKIP: form validation + privacy + zero-production-traffic checks below still run; only the");
  console.log("SKIP: emulator-write proofs are skipped. Rules are verified statically by tests/rules.test.mjs.");
  return "unavailable";
}

function mainBundleName() {
  // Vite hashes are base64-ish: they can contain "-" and "_" as well
  // as alphanumerics (e.g. index-CvTX_s9t.js, index-Dne9n-lV.js) —
  // the old [A-Za-z0-9]+ class matched only pure-alphanumeric hashes
  // and returned null for the rest.
  const files = fs.readdirSync(path.join(ROOT, "dist/assets")).filter((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f));
  return files[0] || null;
}

async function waitForPort(host, port, timeoutMs = 60000) {
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
      await new Promise((r) => setTimeout(r, 500));
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

// Admin read of the emulator collection (rules deny client reads by
// design, so the check uses the emulator's owner token — this only
// works against the local emulator, never production).
async function listEmuReports() {
  const res = await fetch(
    `http://${EMU_HOST}:${EMU_FIRESTORE_PORT}/v1/projects/${PROJECT}/databases/(default)/documents/crowd_reports`,
    { headers: { Authorization: "Bearer owner" } },
  );
  if (res.status !== 200) throw new Error(`emulator REST list HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return (json.documents || []).map((d) => {
    const out = { id: d.name.split("/").pop() };
    for (const [k, v] of Object.entries(d.fields || {})) {
      if (v.stringValue !== undefined) out[k] = v.stringValue;
      else if (v.nullValue !== undefined) out[k] = null;
      else if (v.timestampValue !== undefined) out[k] = `timestamp:${v.timestampValue}`;
      else out[k] = JSON.stringify(v);
    }
    return out;
  });
}

async function waitForEmuDocs(n, timeoutMs = 30000) {
  const start = Date.now();
  let last = [];
  while (Date.now() - start < timeoutMs) {
    try {
      last = await listEmuReports();
      if (last.length >= n) return last;
    } catch (_) { /* emulator not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;

  // --- build the emulator-flagged bundle (.env.local STAYS: the app
  // needs the real config so isFirebaseConfigured() is true; the
  // VITE_USE_FIRESTORE_EMULATOR=1 flag redirects all Firestore/Auth
  // traffic to 127.0.0.1) ---
  console.log("crowd: building emulator bundle (VITE_USE_FIRESTORE_EMULATOR=1)…");
  execSync("npm run build", {
    cwd: ROOT,
    env: { ...process.env, VITE_USE_FIRESTORE_EMULATOR: "1" },
    stdio: "ignore",
  });
  const emuBundle = mainBundleName();
  console.log(`crowd: emulator bundle ${emuBundle}`);

  // --- start emulators + proxy + preview ---
  // A previous killed run can leave orphaned emulator processes (npx +
  // java grandchildren) holding 8080/9099 — a new emulator then fails
  // to bind and the Auth port never opens (seen 19 Nov). Clear whatever
  // holds the emulator ports first. (Bracket trick: the pkill pattern
  // must not match this shell's own command line.)
  try { execSync(`pkill -f "preview --host 127.0.0.1 --port ${PREVIEW_PORT}" || true`); } catch (_) {}
  try { execSync(`pkill -f "emulators:[s]tart" || true`); } catch (_) {}
  try { execSync(`fuser -k ${EMU_FIRESTORE_PORT}/tcp ${EMU_AUTH_PORT}/tcp 4400/tcp 4500/tcp 2>/dev/null || true`); } catch (_) {}
  await new Promise((r) => setTimeout(r, 2000));
  const emuProc = spawn("npx", ["-y", "firebase-tools", "emulators:start", "--only", "firestore,auth"],
    { cwd: ROOT, env: EMU_ENV, stdio: ["ignore", "pipe", "pipe"], detached: true });
  emuProc.stderr.on("data", (d) => console.error("emulator:", String(d).trim()));
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  const previewProc = spawn(process.execPath, [
    path.join(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort",
  ], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  previewProc.stderr.on("data", (d) => console.error("preview:", String(d).trim()));

  let failed = false;
  try {
    await waitForPort(EMU_HOST, EMU_FIRESTORE_PORT, 120000);
    await waitForPort(EMU_HOST, EMU_AUTH_PORT, 120000);
    await waitForPort(EMU_HOST, PROXY_PORT);
    await waitForHttp200(`http://127.0.0.1:${PREVIEW_PORT}/`);
  } catch (e) {
    console.error("FAILED to start servers:", e.message);
    emuProc.kill(); proxyProc.kill(); previewProc.kill();
    failed = true;
  }

  const browser = failed ? null : await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });

  // Fail-fast probe: if the emulator cannot serve documents in this
  // sandbox, skip the write proofs instead of hanging on SDK retries.
  let emuUnavailable = false;
  if (!failed) {
    emuUnavailable = (await probeDocumentPath()) === "unavailable";
  }

  const errors = [];
  const googleapisReqs = [];
  const emuReqs = [];
  function wirePage(page) {
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + String((e && e.message) || e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`CONSOLE-ERROR: ${m.text().slice(0, 200)}`);
    });
    page.on("requestfailed", (req) => errors.push(`REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
    page.on("request", (req) => {
      const url = req.url();
      if (/\.googleapis\.com/.test(url)) googleapisReqs.push(url.slice(0, 200));
      if (/127\.0\.0\.1:(8080|9099)/.test(url)) emuReqs.push(url.slice(0, 120));
    });
  }

  try {
    if (!browser) throw new Error("browser never launched (servers failed)");
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "id-ID",
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();
    wirePage(page);
    await page.goto(`http://localhost:${PREVIEW_PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(3000);

    // Not demo mode: real config is present, so the demo banner stays hidden.
    check("crowd: demo banner hidden (real config present)", await page.locator("#demo-banner").isHidden());
    // The report tab exists and opens its panel.
    await page.click("#module-tab-report");
    check("crowd: report tab opens its panel", await page.locator("#crowdreport").isVisible());
    check("crowd: form fields present", (await page.locator("#crowd-type").count()) === 1
      && (await page.locator("#crowd-value").count()) === 1
      && (await page.locator("#crowd-details").count()) === 1
      && (await page.locator("#crowd-submit-btn").count()) === 1);
    const privacyText = await page.locator(".crowd-privacy").innerText().catch(() => "");
    check("crowd: privacy note says the report is sent to the database",
      /dikirim|database/i.test(privacyText), privacyText.slice(0, 120));

    // --- invalid phone: per-field error, nothing written ---
    await page.selectOption("#crowd-type", "phone");
    await page.fill("#crowd-value", "021123");
    await page.fill("#crowd-details", "Penipu mengaku dari bank dan minta kode OTP.");
    await page.click("#crowd-submit-btn");
    await page.waitForTimeout(800);
    check("crowd: invalid phone shows a per-field error",
      await page.locator("#crowd-value-error").isVisible());
    if (emuUnavailable) {
      skip("crowd: invalid submit wrote nothing to the emulator", "emulator document path unavailable — the list endpoint cannot prove it");
    } else {
      check("crowd: invalid submit wrote nothing to the emulator",
        (await waitForEmuDocs(1, 3000)).length === 0);
    }

    if (!emuUnavailable) {
    // --- valid phone report ---
    await page.fill("#crowd-value", "081234567890");
    await page.fill("#crowd-details", "Penipu mengaku dari bank dan minta kode OTP, mengancam rekening diblokir.");
    await page.click("#crowd-submit-btn");
    await page.waitForSelector("#crowd-success:not([hidden])", { timeout: 15000 });
    const thanks = await page.locator("#crowd-success").innerText();
    check("crowd: phone report shows thanks message", /Terima kasih/i.test(thanks), thanks.slice(0, 100));
    let docs = await waitForEmuDocs(1);
    check("crowd: phone report landed in the emulator collection", docs.length === 1, `docs=${docs.length}`);
    if (docs.length >= 1) {
      const d = docs[0];
      const keys = Object.keys(d).filter((k) => k !== "id").sort();
      check("crowd: phone doc has exactly the 6 fields",
        JSON.stringify(keys) === JSON.stringify(["createdAt", "details", "reporterUid", "status", "type", "value"]),
        `keys=${keys.join(",")}`);
      check("crowd: phone doc fields are correct",
        d.type === "phone" && d.value === "081234567890" && d.status === "pending" && d.reporterUid === null
        && typeof d.createdAt === "string" && d.createdAt.startsWith("timestamp:"),
        `type=${d.type} value=${d.value} status=${d.status} reporterUid=${d.reporterUid}`);
    }

    // --- account report ---
    await page.selectOption("#crowd-type", "account");
    await page.waitForTimeout(300);
    await page.fill("#crowd-value", "1234567890");
    await page.fill("#crowd-details", "Rekening penipu modus jual beli online, minta transfer DP barang.");
    await page.click("#crowd-submit-btn");
    await page.waitForSelector("#crowd-success:not([hidden])", { timeout: 15000 });
    docs = await waitForEmuDocs(2);
    check("crowd: account report landed (2 docs total)", docs.length === 2, `docs=${docs.length}`);
    if (docs.length >= 2) {
      const acc = docs.find((x) => x.type === "account");
      check("crowd: account doc fields are correct",
        !!acc && acc.value === "1234567890" && acc.status === "pending" && acc.reporterUid === null,
        acc ? `value=${acc.value} status=${acc.status}` : "no account doc");
    }

    // --- new-mode report ---
    await page.selectOption("#crowd-type", "mode");
    await page.waitForTimeout(300);
    await page.fill("#crowd-value", "Undian berhadiah palsu");
    await page.fill("#crowd-details", "Modus undian berhadiah mengatasnamakan operator, minta biaya admin transfer.");
    await page.click("#crowd-submit-btn");
    await page.waitForSelector("#crowd-success:not([hidden])", { timeout: 15000 });
    docs = await waitForEmuDocs(3);
    check("crowd: mode report landed (3 docs total)", docs.length === 3, `docs=${docs.length}`);
    if (docs.length >= 3) {
      const mode = docs.find((x) => x.type === "mode");
      check("crowd: mode doc fields are correct",
        !!mode && mode.value === "Undian berhadiah palsu" && mode.status === "pending",
        mode ? `value=${mode.value}` : "no mode doc");
    }

    // --- local history recorded ---
    await page.click("#module-tab-history");
    await page.waitForTimeout(800);
    const histText = await page.locator("#crowd-history-list").innerText().catch(() => "");
    check("crowd: local history lists the phone report", histText.includes("081234567890"), histText.slice(0, 150));
    check("crowd: local history lists the account report", histText.includes("1234567890"), histText.slice(0, 150));
    } else {
      // Emulator document path unavailable in this sandbox: the write
      // proofs cannot run here. They are skipped, not failed — the
      // rules behind them are verified statically by tests/rules.test.mjs.
      for (const name of [
        "crowd: phone report shows thanks message",
        "crowd: phone report landed in the emulator collection",
        "crowd: phone doc has exactly the 6 fields",
        "crowd: phone doc fields are correct",
        "crowd: account report landed (2 docs total)",
        "crowd: account doc fields are correct",
        "crowd: mode report landed (3 docs total)",
        "crowd: mode doc fields are correct",
        "crowd: local history lists the phone report",
        "crowd: local history lists the account report",
      ]) skip(name, "emulator document path unavailable in this sandbox");
    }

    // --- production untouched ---
    check("crowd: zero requests to *.googleapis.com (nothing touched production)",
      googleapisReqs.length === 0, googleapisReqs.slice(0, 3).join(" | "));
    if (emuUnavailable) {
      skip("crowd: app talked to the local emulators", "no submits were attempted — the emulator document path is unavailable");
    } else {
      check("crowd: app talked to the local emulators", emuReqs.length > 0, `${emuReqs.length} emulator requests`);
    }
    check("crowd: no page errors / console errors / failed requests",
      errors.length === 0, errors.slice(0, 3).join(" | "));

    await ctx.close();
  } catch (e) {
    check("crowd: run completed without exception", false, e.message);
  } finally {
    if (browser) await browser.close().catch(() => {});
    // Kill the emulator's whole process group (see
    // tests/crowd-rules-emulator.mjs): SIGTERM to the npx wrapper
    // alone orphans the java emulator, which keeps holding 8080/9099.
    try { process.kill(-emuProc.pid, "SIGTERM"); } catch { emuProc.kill("SIGTERM"); }
    proxyProc.kill("SIGTERM");
    previewProc.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 1000));
    try { process.kill(-emuProc.pid, "SIGKILL"); } catch { try { emuProc.kill("SIGKILL"); } catch { /* already dead */ } }
    try { previewProc.kill("SIGKILL"); } catch { /* already dead */ }
  }

  // --- rebuild the PRODUCTION bundle so dist/ is left clean ---
  console.log("crowd: rebuilding production bundle…");
  try {
    execSync("npm run build", { cwd: ROOT, stdio: "ignore" });
    const prodBundle = mainBundleName();
    check("crowd: production bundle rebuilt and differs from the emulator bundle",
      !!prodBundle && prodBundle !== emuBundle, `prod=${prodBundle} emu=${emuBundle}`);
  } catch (e) {
    check("crowd: production bundle rebuilt", false, e.message);
  }

  const failedCount = results.filter((r) => r.ok === false).length;
  const passedCount = results.filter((r) => r.ok === true).length;
  console.log(`\n${passedCount}/${results.length} crowd checks passed${skippedCount ? `, ${skippedCount} skipped (emulator document path unavailable)` : ""}`);
  process.exit(failedCount > 0 ? 1 : skippedCount > 0 ? 2 : 0);
}

main();
