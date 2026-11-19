#!/usr/bin/env node
// TipuCek — regression for the 19 Nov 20:25 polish notes (items 1-4).
// Two phases against a local Vite dev server, fresh context each:
//   Phase A (real .env.local -> production config, no AI call is made):
//     per language (id, en) x viewport (desktop 1280, mobile 390):
//     - header mode label reads "Mode AI" (id) / "AI mode" (en) live
//     - history note is the honest local-only text, no "kamu" in the
//       visible Indonesian UI, no static "Demo mode"
//     - FAB visible, >= 48x48, label follows the language; clicking it
//       opens the Tanya Aman tab and focuses the question box
//     - FAB overlaps neither the Check button (top) nor the footer
//       (scrolled to the end)
//   Phase B (VITE_* forced empty -> demo mode, local heuristic):
//     - JS still overwrites the static label to the demo label
//       (the static "Mode AI" is production-only, never a lie)
//     - after a scam-sample check, the FAB does not cover the result
//       actions when they are scrolled to the middle of the viewport
//
// No deploy, no push, no live-site traffic, no video recording.
// Usage: node tests/fab-verify.cjs — exit code 0 only when all pass.
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18086", 10);
const DEV_PORT = parseInt(process.env.TIPUCEK_DEV_PORT || "5175", 10);
const DEV = `http://127.0.0.1:${DEV_PORT}/`;
const LANGS = ["id", "en"];
const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

const results = [];
function check(tag, name, ok, detail = "") {
  results.push({ tag, name, ok: !!ok, detail: String(detail || "").slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} [${tag}] ${name}${detail ? " — " + String(detail).slice(0, 160) : ""}`);
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

function intersects(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y;
}

// Wait until a port stops answering (a killed server needs a moment to
// release it; starting the next phase before that orphans the bind).
async function waitForPortClosed(host, port, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const s = net.connect(port, host);
        s.once("connect", () => { s.end(); reject(new Error("open")); });
        s.once("error", resolve);
      });
      return;
    } catch (_) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

async function stopServers(servers) {
  servers.proxyProc.kill();
  servers.viteProc.kill();
  await waitForPortClosed("127.0.0.1", DEV_PORT);
  await waitForPortClosed("127.0.0.1", PROXY_PORT);
}

async function startServers(demo) {
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  const env = { ...process.env };
  if (demo) {
    // Empty VITE_* vars beat .env.local in Vite and fall back to the
    // "YOUR_..." placeholders -> demo mode (same trick as
    // tests/all-languages-verify.cjs).
    for (const k of ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_STORAGE_BUCKET", "VITE_FIREBASE_MESSAGING_SENDER_ID", "VITE_FIREBASE_APP_ID", "VITE_FIREBASE_APPCHECK_SITE_KEY"]) env[k] = "";
  }
  const viteProc = spawn(process.execPath, [
    path.join(ROOT, "node_modules/vite/bin/vite.js"),
    "--host", "127.0.0.1", "--port", String(DEV_PORT), "--strictPort",
  ], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
  viteProc.stderr.on("data", (d) => console.error("vite:", String(d).trim().slice(0, 200)));
  await waitForPort("127.0.0.1", PROXY_PORT);
  await waitForPort("127.0.0.1", DEV_PORT);
  return { proxyProc, viteProc };
}

async function main() {
  const { t } = await import("../src/i18n.js");
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;

  // ---- static-source checks (no browser) ----
  const INDEX_HTML = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const banner = INDEX_HTML.match(/<div id="demo-banner"[^>]*hidden[^>]*>[\s\S]*?<\/div>/);
  check("static", "hidden demo-banner block exists", !!banner);
  const visible = banner ? INDEX_HTML.replace(banner[0], "") : INDEX_HTML;
  check("static", "0 'Demo mode'/'Mode demo' in visible static HTML", !/demo mode|mode demo/i.test(visible));
  check("static", "0 'kamu' in index.html", !/kamu/i.test(INDEX_HTML));
  check("static", "static mode label is 'Mode AI'", /<span id="mode-label"[^>]*>Mode AI<\/span>/.test(INDEX_HTML));
  check("static", "static storage-note is the honest text", INDEX_HTML.includes("Riwayat hanya tersimpan di browser ini. Selama pengaturan ini aktif, tidak ada yang dikirim ke cloud."));

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });

  // Shared per-(phase, lang, viewport) FAB + layout checks.
  async function fabChecks(page, lang, vp, tag) {
    const fab = page.locator("#aman-fab");
    await fab.waitFor({ state: "visible", timeout: 15000 });
    const box = await fab.boundingBox();
    check(tag, `FAB visible, >= 48px (${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : "no box"})`,
      !!box && box.width >= 48 && box.height >= 48, box ? JSON.stringify(box) : "");
    if (box) {
      check(tag, "FAB fully inside the viewport",
        box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height,
        JSON.stringify(box));
    }
    const fabLabel = (await fab.innerText()).trim();
    check(tag, "FAB label follows the language",
      fabLabel === t("moduleTabAssistant", lang), `label=${JSON.stringify(fabLabel)}`);
    // Check button (top of page): the FAB must never cover it.
    const checkBox = await page.locator("#check-btn").boundingBox();
    check(tag, "FAB does not cover the Check button",
      !intersects(box, checkBox), `fab=${JSON.stringify(box)} check=${JSON.stringify(checkBox)}`);
    // Click: opens the assistant tab + focuses the question box.
    await fab.click();
    await page.waitForTimeout(600);
    const assistantVisible = await page.locator("#assistant").isVisible();
    const tabActive = await page.locator("#module-tab-assistant").getAttribute("aria-selected");
    const focusedId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check(tag, "FAB click opens the Tanya Aman tab", assistantVisible && tabActive === "true",
      `visible=${assistantVisible} selected=${tabActive}`);
    check(tag, "FAB click focuses the question box", focusedId === "assistant-input", `focused=${focusedId}`);
    // Footer (scrolled to the very end): the FAB must not cover it.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    const footerBox = await page.locator(".footer").boundingBox();
    const fabBox2 = await fab.boundingBox();
    check(tag, "FAB does not cover the footer at page end",
      !intersects(fabBox2, footerBox), `fab=${JSON.stringify(fabBox2)} footer=${JSON.stringify(footerBox)}`);
  }

  try {
    // ---- Phase A: production config ----
    let servers = await startServers(false);
    try {
      for (const lang of LANGS) {
        for (const vp of VIEWPORTS) {
          const tag = `A/${lang}/${vp.name}`;
          const errors = [];
          const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ignoreHTTPSErrors: true });
          const page = await ctx.newPage();
          page.on("pageerror", (e) => errors.push("PAGEERROR: " + String((e && e.message) || e)));
          try {
            await page.goto(`${DEV}?lang=${lang}`, { waitUntil: "load", timeout: 60000 });
            await page.waitForSelector("#lang-select option", { state: "attached", timeout: 15000 });
            await page.waitForTimeout(800);
            const modeLabel = (await page.locator("#mode-label").innerText()).trim();
            check(tag, "live mode label is the production value",
              modeLabel === t("modeAI", lang), `label=${JSON.stringify(modeLabel)}`);
            const storageNote = (await page.locator("#storage-note").innerText()).trim();
            check(tag, "history note is the honest text",
              storageNote === t("historyLocalNote", lang), storageNote.slice(0, 80));
            if (lang === "id") {
              const bodyText = await page.evaluate(() => document.body.innerText);
              check(tag, "no 'kamu' in visible Indonesian UI",
                !/\bkamu\b|Laporanmu|pribadimu|pesanmu|laporanmu/.test(bodyText), "");
              const tagline = (await page.locator('[data-i18n="tagline"]').innerText()).trim();
              check(tag, "tagline uses Anda", tagline === "Cek pesannya sebelum Anda percaya", tagline);
            }
            await fabChecks(page, lang, vp, tag);
          } catch (e) {
            check(tag, "scenario completed without fatal error", false, e.message);
          } finally {
            check(tag, "no page errors", errors.length === 0, errors.slice(0, 2).join(" || "));
            await ctx.close();
          }
        }
      }
    } finally {
      await stopServers(servers);
    }

    // ---- Phase B: demo mode (JS must still overwrite the label) ----
    servers = await startServers(true);
    try {
      for (const lang of LANGS) {
        for (const vp of VIEWPORTS) {
          const tag = `B/${lang}/${vp.name}`;
          const errors = [];
          const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ignoreHTTPSErrors: true });
          const page = await ctx.newPage();
          page.on("pageerror", (e) => errors.push("PAGEERROR: " + String((e && e.message) || e)));
          try {
            await page.goto(`${DEV}?lang=${lang}`, { waitUntil: "load", timeout: 60000 });
            await page.waitForSelector("#lang-select option", { state: "attached", timeout: 15000 });
            await page.waitForTimeout(800);
            const modeLabel = (await page.locator("#mode-label").innerText()).trim();
            check(tag, "demo build: JS overwrites the label to the demo label",
              modeLabel === t("modeDemo", lang), `label=${JSON.stringify(modeLabel)}`);
            await fabChecks(page, lang, vp, tag);
            // Result card: FAB must not cover the action buttons when
            // they are scrolled to the middle of the viewport.
            await page.locator("#samples .sample-btn").first().click();
            await page.click("#check-btn");
            await page.waitForSelector("#result .result-card", { timeout: 30000 });
            await page.evaluate(() => document.querySelector(".result-actions").scrollIntoView({ block: "center" }));
            await page.waitForTimeout(500);
            const fabBox = await page.locator("#aman-fab").boundingBox();
            const actBox = await page.locator(".result-actions").boundingBox();
            check(tag, "FAB does not cover the result actions (centered)",
              !intersects(fabBox, actBox), `fab=${JSON.stringify(fabBox)} actions=${JSON.stringify(actBox)}`);
          } catch (e) {
            check(tag, "scenario completed without fatal error", false, e.message);
          } finally {
            check(tag, "no page errors", errors.length === 0, errors.slice(0, 2).join(" || "));
            await ctx.close();
          }
        }
      }
    } finally {
      await stopServers(servers);
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log("=".repeat(64));
  console.log(`TOTAL: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("FAILURES:");
    for (const f of failed) console.log(` - [${f.tag}] ${f.name} — ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(2);
});
