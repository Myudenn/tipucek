#!/usr/bin/env node
// TipuCek — all-8-languages verification (bugs 1+2, Myuden 19 Nov 20:12:
// "Tes juga semua bahasa nya semua").
//
// Runs against a LOCAL Vite dev server (demo mode: no Firebase config,
// so the local heuristic answers — its verdict strings come from the
// same i18n tables as the production AI prompt language, which is what
// this test pins). One scenario per language (id, en, es, fr, de, pt,
// ja, zh), fresh browser context each:
//   (a) UI in that language: every [data-i18n] element + every
//       [data-i18n-placeholder] equals t(key, lang); hero stat, mode
//       label and <html lang> match; no "undefined" in visible text.
//   (b) Run the scam sample check in that language: the whole result
//       card (status, summary, "what to do", red flags, links box,
//       badge) is in that language; status/summary match the demo
//       verdict for the sample; EN/ID additionally pin scam + score.
//   (c) Switch language AFTER the result is shown: the card is
//       re-checked in the new language (status/summary/advice/badge
//       all follow); history still holds exactly ONE entry (no
//       duplicate from the re-check).
//   (d) All 6 sample cards show the message body in that language
//       (click each sample -> input holds the full per-language text).
//
// No deploy, no push, no live-site traffic, no video recording.
// Usage: node tests/all-languages-verify.cjs
// Exit code 0 only when every language passes every step.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18086", 10);
const DEV_PORT = parseInt(process.env.TIPUCEK_DEV_PORT || "5174", 10);
const DEV = `http://127.0.0.1:${DEV_PORT}/`;

const LANGS = ["en", "id", "es", "fr", "de", "pt", "ja", "zh"];
const SAMPLE_KEYS = [
  "sampleTextScam",
  "sampleTextSuspicious",
  "sampleTextSafe",
  "sampleTextApk",
  "sampleTextJob",
  "sampleTextOtp",
];
// Verdict status -> i18n label key (the page shows the LABEL, e.g.
// "Penipuan", not the "scam" status code).
const STATUS_KEY = { scam: "statusScam", suspicious: "statusSuspicious", safe: "statusSafe" };
// English-only / Indonesian-only marker phrases: must not appear in a
// result card shown in any other language (names/URLs excepted).
const EN_MARKERS = [
  "What to do",
  "Red flags",
  "Links in this message",
  "Answered in the cloud",
  "Demo check — local only",
  "This message shows",
  "This message has some warning",
  "No clear scam indicators",
  "No warning signs",
];
const ID_MARKERS = [
  "Apa yang harus dilakukan",
  "Tanda bahaya",
  "Tautan dalam pesan ini",
  "Dijawab di cloud",
  "Cek demo — lokal saja",
  "Pesan ini menunjukkan",
  "Pesan ini memiliki beberapa tanda",
  "Tidak ditemukan indikator",
  "Tidak ada tanda bahaya",
];

const results = [];
function check(lang, step, name, ok, detail = "") {
  results.push({ lang, step, name, ok: !!ok, detail: String(detail || "").slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} [${lang}/${step}] ${name}${detail ? " — " + String(detail).slice(0, 160) : ""}`);
}

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
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`port ${host}:${port} did not open in ${timeoutMs}ms`);
}

function historyCount(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("pesanaman_history_v1");
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.length : -1;
    } catch {
      return -1;
    }
  });
}

function cardHasNoMarkers(cardText, lang) {
  const bad = [];
  if (lang !== "en") for (const m of EN_MARKERS) if (cardText.includes(m)) bad.push(`EN:${m}`);
  if (lang !== "id") for (const m of ID_MARKERS) if (cardText.includes(m)) bad.push(`ID:${m}`);
  return bad;
}

async function main() {
  // Expected strings come from the source of truth (src/i18n.js) and
  // the demo verdicts from src/ai.js — the test never hard-codes a
  // translation, so a future i18n edit is verified, not assumed.
  const { t, demoSummary } = await import("../src/i18n.js");
  const { analyzeWithHeuristic } = await import("../src/ai.js");
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;

  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  // Spawn the vite binary directly (not via npx): kill() must kill the
  // actual server process, not a wrapper that would orphan it and hold
  // the port for the next run.
  // Demo mode, forced: the repo has a real .env.local (live Firebase
  // project), which would put the dev server on the production AI
  // path — App Check has no registered localhost debug token, so live
  // AI calls fail here with 403. Empty VITE_* vars take precedence
  // over .env.local in Vite and fall back to the "YOUR_..." placeholders
  // (firebase-config.js: "" || "YOUR_API_KEY"), i.e. the demo heuristic.
  // This only affects the test server process, never the project files.
  const viteProc = spawn(process.execPath, [
    path.join(ROOT, "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1",
    "--port", String(DEV_PORT), "--strictPort",
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_AUTH_DOMAIN: "",
      VITE_FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_STORAGE_BUCKET: "",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "",
      VITE_FIREBASE_APP_ID: "",
      VITE_FIREBASE_APPCHECK_SITE_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  viteProc.stderr.on("data", (d) => console.error("vite:", String(d).trim()));
  try {
    await waitForPort("127.0.0.1", PROXY_PORT);
    await waitForPort("127.0.0.1", DEV_PORT);
  } catch (e) {
    proxyProc.kill();
    viteProc.kill();
    console.error("FAILED to start proxy/dev server:", e.message);
    process.exit(2);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });

  try {
    for (let li = 0; li < LANGS.length; li++) {
      const lang = LANGS[li];
      const nextLang = LANGS[(li + 1) % LANGS.length];
      const errors = [];
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push("PAGEERROR: " + String((e && e.message) || e)));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`CONSOLE-ERROR: ${m.text().slice(0, 200)}`);
      });
      // One language failing must not abort the other seven: record it
      // as a failed scenario check and continue with the next language.
      try {
        await page.goto(`${DEV}?lang=${lang}`, { waitUntil: "load", timeout: 60000 });
        await page.waitForSelector("#lang-select option", { state: "attached", timeout: 15000 });
        await page.waitForTimeout(800);

        // ---- (a) static strings in this language ----
        const htmlLang = await page.evaluate(() => document.documentElement.lang);
        check(lang, "a", "html lang matches", htmlLang === lang, `lang=${htmlLang}`);
        const staticRes = await page.evaluate(() => {
          const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
          const bad = [];
          document.querySelectorAll("[data-i18n]").forEach((el) => {
            bad.push({ key: el.dataset.i18n, got: norm(el.textContent) });
          });
          const ph = [];
          document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
            ph.push({ key: el.dataset.i18nPlaceholder, got: el.placeholder || "" });
          });
          return { bad, ph, bodyHasUndefined: document.body.innerText.includes("undefined") };
        });
        const staticBad = staticRes.bad.filter(
          ({ key, got }) => got !== t(key, lang).replace(/\s+/g, " ").trim(),
        );
        check(lang, "a", `all ${staticRes.bad.length} data-i18n strings equal t(key, ${lang})`,
          staticBad.length === 0,
          staticBad.slice(0, 3).map((b) => `${b.key} got=${JSON.stringify(b.got.slice(0, 60))} want=${JSON.stringify(t(b.key, lang).slice(0, 60))}`).join(" || ") || "all match");
        const phBad = staticRes.ph.filter(({ key, got }) => got !== t(key, lang));
        check(lang, "a", `all ${staticRes.ph.length} placeholders equal t(key, ${lang})`,
          phBad.length === 0, phBad.slice(0, 3).map((b) => b.key).join(",") || "all match");
        check(lang, "a", "no 'undefined' in visible text", !staticRes.bodyHasUndefined);
        const modeLabel = await page.locator("#mode-label").innerText();
        check(lang, "a", "mode label is the demo label in this language",
          modeLabel.trim() === t("modeDemo", lang), `label=${JSON.stringify(modeLabel)}`);
        const heroStat = await page.locator('[data-i18n="heroStat"]').innerText();
        check(lang, "a", "hero OJK stat in this language",
          heroStat.trim() === t("heroStat", lang).replace(/\s+/g, " ").trim(),
          heroStat.slice(0, 80));

        // ---- (d) sample bodies in this language ----
        const previews = await page.$$eval("#samples .sample-btn", (btns) =>
          btns.map((b) => ({
            label: b.querySelector(".sample-label")?.textContent || "",
            preview: b.querySelector(".sample-preview")?.textContent || "",
          })),
        );
        check(lang, "d", "6 sample cards rendered", previews.length === 6, `got ${previews.length}`);
        for (let i = 0; i < SAMPLE_KEYS.length; i++) {
          const want = t(SAMPLE_KEYS[i], lang);
          const wantPreview = want.length > 90 ? `${want.slice(0, 90)}…` : want;
          check(lang, "d", `sample ${i} preview is the ${lang} text`,
            previews[i] && previews[i].preview === wantPreview,
            previews[i] ? previews[i].preview.slice(0, 60) : "(missing)");
          await page.locator("#samples .sample-btn").nth(i).click();
          const inputVal = await page.locator("#message-input").inputValue();
          check(lang, "d", `sample ${i} click fills the ${lang} text`,
            inputVal === want, inputVal.slice(0, 60));
        }

        // ---- (b) scam-sample check in this language ----
        await page.locator("#samples .sample-btn").first().click();
        await page.click("#check-btn");
        await page.waitForSelector("#result .result-card", { timeout: 30000 });
        const statusText = await page.locator("#result .result-status").innerText();
        const scoreText = await page.locator("#result .ring-value strong").innerText();
        const summaryText = await page.locator("#result .result-summary").innerText();
        const cardText = await page.locator("#result").innerText();
        const statusKey =
          statusText.trim() === t("statusScam", lang) ? "scam"
          : statusText.trim() === t("statusSuspicious", lang) ? "suspicious"
          : statusText.trim() === t("statusSafe", lang) ? "safe" : null;
        check(lang, "b", "status label is a translated verdict", statusKey !== null, `status=${JSON.stringify(statusText)}`);
        if (statusKey) {
          check(lang, "b", "summary is the demo summary in this language",
            summaryText.trim() === demoSummary(statusKey, lang), summaryText.slice(0, 80));
        }
        // The demo heuristic is ID/EN-only by design: for es/fr/de/pt/
        // ja/zh the scam sample scores low in demo mode. The language
        // assertions below hold for every verdict; EN/ID pin scam.
        const expected = analyzeWithHeuristic(t("sampleTextScam", lang), lang);
        check(lang, "b", "demo verdict matches the local heuristic",
          statusKey === expected.status && parseInt(scoreText, 10) === expected.riskScore,
          `page=${statusKey} ${scoreText} want=${expected.status} ${expected.riskScore}`);
        if (lang === "en" || lang === "id") {
          check(lang, "b", "EN/ID scam sample verdict is Scam, score >= 60",
            statusKey === "scam" && parseInt(scoreText, 10) >= 60, `${statusKey} ${scoreText}`);
        }
        check(lang, "b", "card has 'what to do' in this language",
          cardText.includes(t("whatToDo", lang)), "");
        check(lang, "b", "card has 'red flags' heading in this language",
          cardText.includes(t("redFlags", lang)), "");
        check(lang, "b", "card has links box in this language",
          cardText.includes(t("linksTitle", lang)), "");
        check(lang, "b", "card badge is the demo badge in this language",
          cardText.includes(t("badgeDemo", lang)), "");
        const badMarkers = cardHasNoMarkers(cardText, lang);
        check(lang, "b", "card has no other-language marker phrases",
          badMarkers.length === 0, badMarkers.join(", ") || "clean");
        check(lang, "b", "history has exactly 1 entry after the check",
          (await historyCount(page)) === 1, `count=${await historyCount(page)}`);

        // ---- (c) switch language after the result is shown ----
        await page.selectOption("#lang-select", nextLang);
        const wantStatus = t(STATUS_KEY[statusKey], nextLang);
        const wantSummary = demoSummary(statusKey, nextLang);
        await page.waitForFunction(
          ({ s, sum }) => {
            const st = document.querySelector("#result .result-status");
            const sm = document.querySelector("#result .result-summary");
            return st && sm && st.textContent.trim() === s && sm.textContent.trim() === sum;
          },
          { s: wantStatus, sum: wantSummary },
          { timeout: 30000 },
        );
        const cardText2 = await page.locator("#result").innerText();
        check(lang, "c", `card follows the switch to ${nextLang}: status`,
          (await page.locator("#result .result-status").innerText()).trim() === wantStatus, "");
        check(lang, "c", `card follows the switch to ${nextLang}: summary`,
          (await page.locator("#result .result-summary").innerText()).trim() === wantSummary, "");
        check(lang, "c", `card follows the switch to ${nextLang}: advice + links + badge`,
          cardText2.includes(t("whatToDo", nextLang)) &&
          cardText2.includes(t("linksTitle", nextLang)) &&
          cardText2.includes(t("badgeDemo", nextLang)), "");
        const badMarkers2 = cardHasNoMarkers(cardText2, nextLang);
        check(lang, "c", `card has no other-language markers after switch to ${nextLang}`,
          badMarkers2.length === 0, badMarkers2.join(", ") || "clean");
        check(lang, "c", "history still exactly 1 entry after the re-check (no duplicate)",
          (await historyCount(page)) === 1, `count=${await historyCount(page)}`);
        check(lang, "c", "static strings also followed the switch",
          (await page.locator('[data-i18n="heroTitle"]').innerText()).trim() === t("heroTitle", nextLang), "");
      } catch (e) {
        check(lang, "z", "scenario completed without fatal error", false, e.message);
      } finally {
        check(lang, "z", "no page errors / console errors", errors.length === 0, errors.slice(0, 3).join(" || "));
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    proxyProc.kill();
    viteProc.kill();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("=".repeat(64));
  for (const lang of LANGS) {
    const sub = results.filter((r) => r.lang === lang);
    const bad = sub.filter((r) => !r.ok);
    console.log(`LANG ${lang}: ${bad.length === 0 ? "PASS" : "FAIL"} (${sub.length - bad.length}/${sub.length} checks)${bad.length ? " — " + bad.map((b) => `[${b.step}] ${b.name}`).join("; ") : ""}`);
  }
  console.log(`TOTAL: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("FAILURES:");
    for (const f of failed) console.log(` - [${f.lang}/${f.step}] ${f.name} — ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
