#!/usr/bin/env node
// TipuCek stale-cache simulation + real-browser verification.
// READ-ONLY vs the product: no deploy, no push, no links sent, no video,
// no form submits anywhere (pages are only loaded and read).
//
// Steps:
//  1. Fresh profile: live site shows the NEW shell (tabs, OJK hero stat,
//     Bahasa Indonesia, mode label set by JS to the real mode, no console
//     errors of substance).
//  2. JS disabled: mode label stays static "…" (neutral), hero Indonesian,
//     NO visible "Demo mode"/"Mode demo" anywhere (the only "Mode demo"
//     string lives inside the hidden demo banner).
//  3. STALE-CACHE SIMULATION (core): persistent profile. First load serves
//     the OLD shell verbatim from git (0bbff67:index.html, lang="en",
//     static "Demo mode" label) + the OLD sw.js verbatim (tipucek-v6) via
//     Playwright route interception, so the browser registers v6 and the
//     old shell ends up in its cache. The old app JS (/src/main.js) is
//     deliberately NOT executed (it needs Vite bundling and would do
//     Firebase anonymous auth); a stub `export {};` is served instead and
//     the SW is registered by the harness — the cached-shell mechanism
//     under test is the SW + cached document, which this reproduces
//     exactly. The v6 install caches the live shell for "/" (SW-issued
//     fetches bypass page routes), so after v6 activates the harness
//     overwrites the "/" + "/index.html" entries of tipucek-v6 with the
//     old HTML verbatim via the Cache API, then verifies the overwrite
//     by reading the cache back. Interception is then removed and
//     reloads prove: v6 serves the stale shell once -> v7 installs,
//     takes over (skipWaiting + clients.claim) -> v6 cache deleted ->
//     new shell displayed, v7 controlling.
//  4. Slow JS: bundle delayed 4s; the mode label must stay "…" until
//     the JS arrives and sets the real status (no demo-mode flash).
//
// Output: JSON summary on stdout + screenshots in video/raw/ +
// video/raw/stale-cache-results.json
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn, execSync } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18080", 10);
const LIVE = "https://tipucek.web.app/";
const OLD_INDEX = execSync("git -C " + ROOT + " show 0bbff67:index.html", { encoding: "utf8" });
const OLD_SW = execSync("git -C " + ROOT + " show 0bbff67:public/sw.js", { encoding: "utf8" });
const OLD_CSS = fs.readFileSync("/tmp/old-styles.css", "utf8");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok, detail: String(detail || "").slice(0, 500) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 220) : ""}`);
}
function note(name, detail = "") {
  results.push({ name, ok: null, detail: String(detail || "").slice(0, 500) });
  console.log(`NOTE ${name}${detail ? " — " + String(detail).slice(0, 220) : ""}`);
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
    } catch (_) { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error(`port ${host}:${port} did not open in ${timeoutMs}ms`);
}

// Full observable snapshot of the loaded page.
async function snapshot(page, tag) {
  const s = await page.evaluate(async () => {
    const $ = (id) => document.getElementById(id);
    const txt = (el) => (el ? el.innerText.trim() : null);
    const bodyText = document.body ? document.body.innerText : "";
    const sw = { controller: null, regs: [], cacheKeys: [] };
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        sw.controller = navigator.serviceWorker.controller.scriptURL;
      }
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) {
        sw.regs.push({
          scope: r.scope,
          active: r.active ? r.active.scriptURL + " state=" + r.active.state : null,
          installing: r.installing ? r.installing.scriptURL + " state=" + r.installing.state : null,
          waiting: r.waiting ? r.waiting.scriptURL + " state=" + r.waiting.state : null,
        });
      }
      sw.cacheKeys = await caches.keys();
    } catch (e) { sw.error = String(e && e.message || e); }
    return {
      url: location.href,
      lang: document.documentElement.lang,
      title: document.title,
      heroTitle: txt($("hero-title")) || (document.querySelector(".hero-title") || {}).innerText || null,
      heroStat: txt(document.querySelector(".hero-stat")),
      modeLabel: txt($("mode-label")),
      bannerHiddenAttr: $("demo-banner") ? $("demo-banner").hasAttribute("hidden") : null,
      bannerVisible: $("demo-banner") ? !!( $("demo-banner").offsetParent !== null || getComputedStyle($("demo-banner")).display !== "none" && !$("demo-banner").hidden ) : null,
      bannerText: txt($("demo-banner")),
      tabs: Array.from(document.querySelectorAll(".checker-tab-btn")).map((b) => b.innerText.trim()),
      bodyHasDemoMode: /Demo mode/i.test(bodyText),
      bodyHasModeDemo: /Mode demo/i.test(bodyText),
      demoLines: bodyText.split("\n").filter((l) => /demo/i.test(l)).slice(0, 5),
      sw,
    };
  });
  s.tag = tag;
  return s;
}

async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;

  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  try { await waitForPort("127.0.0.1", PROXY_PORT); }
  catch (e) { proxyProc.kill(); console.error("FAILED to start proxy:", e.message); process.exit(2); }
  console.log(`proxy up on 127.0.0.1:${PROXY_PORT}`);

  const browser = await chromium.launch({
    headless: true,
    // NOTE: --ignore-certificate-errors is REQUIRED for SW registration:
    // Playwright's ignoreHTTPSErrors covers page fetches but NOT the SW
    // script fetch (probed 19 Nov: fetch /sw.js = 200, register() = SSL
    // error without this flag, OK with it). The sandbox egress proxy
    // MITMs Google-hosted hosts incl. *.web.app; the site cert itself
    // is valid. Same class of workaround as the skill documents.
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--ignore-certificate-errors"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });

  const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
  try {
    // ============ STEP 1: fresh profile, live site ============
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, locale: "id-ID" });
      const page = await ctx.newPage();
      const errors = [];
      const bundles = [];
      page.on("pageerror", (e) => errors.push("PAGEERROR: " + String((e && e.message) || e)));
      page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE-ERROR: " + m.text().slice(0, 200)); });
      page.on("requestfailed", (r) => errors.push(`REQFAIL ${r.url()} :: ${r.failure() && r.failure().errorText}`));
      page.on("request", (r) => { if (/\/assets\/index-[^/]+\.js/.test(r.url())) bundles.push(r.url().split("/").pop()); });
      await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(5000);
      const s = await snapshot(page, "step1-fresh-live");
      await page.screenshot({ path: path.join(RAW, "stale-step1-fresh.png") });
      check("1 bundle: live serves index-Bu2kVI-9.js", bundles.includes("index-Bu2kVI-9.js"), `bundles=${bundles.join(",") || "(none)"}`);
      check("1 lang=id", s.lang === "id", `lang=${s.lang}`);
      check("1 hero: Indonesian title", /Apakah pesan ini penipuan\?/.test(s.heroTitle || ""), `heroTitle=${JSON.stringify(s.heroTitle)}`);
      check("1 hero: OJK stat present", /OJK/.test(s.heroStat || "") && /Rp 9,1 triliun/.test(s.heroStat || ""), `heroStat=${JSON.stringify(s.heroStat)}`);
      check("1 tabs present", s.tabs.length >= 3, `tabs=${JSON.stringify(s.tabs)}`);
      check("1 mode-label: NOT demo", !/demo/i.test(s.modeLabel || ""), `label=${JSON.stringify(s.modeLabel)}`);
      note("1 mode-label value with JS running", `label=${JSON.stringify(s.modeLabel)}`);
      check("1 demo-banner hidden", s.bannerHiddenAttr === true, `hiddenAttr=${s.bannerHiddenAttr} visible=${s.bannerVisible}`);
      check("1 visible text: no 'demo' anywhere", !s.bodyHasDemoMode && !s.bodyHasModeDemo, `demoLines=${JSON.stringify(s.demoLines)}`);
      check("1 no significant console/page/request errors", errors.length === 0, errors.length ? errors.slice(0, 4).join(" || ") : "clean");
      note("1 SW state fresh profile", JSON.stringify(s.sw));
      await ctx.close();
    }

    // ============ STEP 2: JS disabled ============
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(2000);
      // JS is off: no page.evaluate — read the DOM via locators only.
      const lang = await page.locator("html").getAttribute("lang");
      const heroTitle = await page.locator(".hero-title").innerText().catch(() => null);
      const heroStat = await page.locator(".hero-stat").innerText().catch(() => null);
      const modeLabel = await page.locator("#mode-label").innerText().catch(() => null);
      const bannerHiddenAttr = await page.locator("#demo-banner").getAttribute("hidden").catch(() => null);
      const bannerVisible = await page.locator("#demo-banner").isVisible().catch(() => null);
      const bannerText = await page.locator("#demo-banner").innerText().catch(() => null);
      const bodyText = await page.locator("body").innerText();
      const demoLines = bodyText.split("\n").filter((l) => /demo/i.test(l)).slice(0, 5);
      const s = { lang, heroTitle, heroStat, modeLabel, bannerHiddenAttr, bannerVisible, bannerText, bodyHasDemoMode: /Demo mode/i.test(bodyText), bodyHasModeDemo: /Mode demo/i.test(bodyText), demoLines };
      await page.screenshot({ path: path.join(RAW, "stale-step2-nojs.png") });
      check("2 no-JS mode-label is neutral '…'", s.modeLabel === "…", `label=${JSON.stringify(s.modeLabel)}`);
      check("2 no-JS hero Indonesian", /Apakah pesan ini penipuan\?/.test(s.heroTitle || ""), `heroTitle=${JSON.stringify(s.heroTitle)}`);
      check("2 no-JS hero OJK stat present", /OJK/.test(s.heroStat || ""), `heroStat=${JSON.stringify(s.heroStat)}`);
      check("2 no-JS: no visible 'Demo mode'/'Mode demo'", !s.bodyHasDemoMode && !s.bodyHasModeDemo, `demoLines=${JSON.stringify(s.demoLines)}`);
      check("2 no-JS demo-banner has hidden attr", s.bannerHiddenAttr !== null, `hiddenAttr=${JSON.stringify(s.bannerHiddenAttr)}`);
      note("2 no-JS banner visibility check", `isVisible=${s.bannerVisible}; banner text (DOM, not visible)=${JSON.stringify(s.bannerText)}`);
      await ctx.close();
    }

    // ============ STEP 4: slow JS (bundle delayed 4s) ============
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, locale: "id-ID" });
      const page = await ctx.newPage();
      await page.route("**/assets/index-*.js", async (route) => {
        await new Promise((r) => setTimeout(r, 4000));
        await route.continue();
      });
      const t0 = Date.now();
      await page.goto(LIVE, { waitUntil: "commit", timeout: 60000 });
      await page.waitForSelector("#mode-label", { timeout: 30000 });
      const samples = [];
      for (const at of [1200, 2500, 3800]) {
        const wait = at - (Date.now() - t0);
        if (wait > 0) await page.waitForTimeout(wait);
        const label = await page.evaluate(() => { const el = document.getElementById("mode-label"); return el ? el.innerText : null; });
        samples.push({ atMs: Date.now() - t0, label });
      }
      await page.waitForTimeout(5000); // bundle arrives ~4s, then JS runs
      const labelAfter = await page.evaluate(() => { const el = document.getElementById("mode-label"); return el ? el.innerText : null; });
      samples.push({ atMs: Date.now() - t0, label: labelAfter, afterBundle: true });
      await page.screenshot({ path: path.join(RAW, "stale-step4-slowjs.png") });
      const preBundle = samples.filter((x) => !x.afterBundle);
      check("4 slow-JS: label stays '…' while bundle delayed", preBundle.every((x) => x.label === "…"), JSON.stringify(samples));
      note("4 slow-JS label after bundle loads", `label=${JSON.stringify(labelAfter)}`);
      await ctx.close();
    }

    // ============ STEP 3: stale-cache simulation (core) ============
    // Mechanism that works: BROWSER-level CDP Fetch interception.
    // (Probed 19 Nov: page.route + page-target CDP Fetch both MISS the SW
    // script fetch — sw.js is fetched by the browser process, not the
    // renderer. Browser-target Fetch.enable DOES see it: register()
    // then installs the intercepted old v6 script, keys=["tipucek-v6"].)
    // Step 3 therefore runs in a normal context of the SAME browser so
    // the browser-level session can intercept it.
    const bcdp = await browser.newBrowserCDPSession();
    let intercepted = { index: 0, sw: 0, stub: 0 };
    await bcdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    bcdp.on("Fetch.requestPaused", async (ev) => {
      try {
        const u = new URL(ev.request.url);
        if (u.hostname === "tipucek.web.app" && (u.pathname === "/" || u.pathname === "/index.html")) {
          intercepted.index++;
          return bcdp.send("Fetch.fulfillRequest", { requestId: ev.requestId, responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
            body: Buffer.from(OLD_INDEX).toString("base64") });
        }
        if (u.hostname === "tipucek.web.app" && u.pathname === "/sw.js") {
          intercepted.sw++;
          return bcdp.send("Fetch.fulfillRequest", { requestId: ev.requestId, responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "application/javascript" }],
            body: Buffer.from(OLD_SW).toString("base64") });
        }
        if (u.hostname === "tipucek.web.app" && u.pathname === "/src/main.js") {
          intercepted.stub++;
          // Harness stub: old app JS NOT executed (needs Vite bundling).
          return bcdp.send("Fetch.fulfillRequest", { requestId: ev.requestId, responseCode: 200,
            responseHeaders: [{ name: "Content-Type", value: "text/javascript" }],
            body: Buffer.from("export {};\n").toString("base64") });
        }
        return bcdp.send("Fetch.continueRequest", { requestId: ev.requestId });
      } catch (e) { try { await bcdp.send("Fetch.continueRequest", { requestId: ev.requestId }); } catch (_) {} }
    });
    const pctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true, locale: "id-ID" });
    const page = await pctx.newPage();
    const perrors = [];
    page.on("pageerror", (e) => perrors.push("PAGEERROR: " + String((e && e.message) || e)));
    page.on("console", (m) => { if (m.type() === "error") perrors.push("CONSOLE-ERROR: " + m.text().slice(0, 200)); });

    // --- Phase A: plant old shell + old SW via browser-level interception ---
    await page.goto(LIVE, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(1500);
    // Style the planted old shell for readability (harness-side only;
    // served bytes stay verbatim old HTML).
    try { await page.addStyleTag({ content: OLD_CSS }); } catch (e) { note("3 plant: addStyleTag failed (cosmetic only)", String(e.message).slice(0, 120)); }

    // Register the (intercepted) old SW from the page.
    const regResult = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return { supported: false };
      const reg = await navigator.serviceWorker.register("/sw.js");
      return { supported: true, scope: reg.scope };
    });
    note("3 plant: SW register() result", JSON.stringify(regResult));
    // Wait for a controller to appear (v6 install + skipWaiting + claim).
    let controller = null;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      controller = await page.evaluate(() => (navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null));
      if (controller) break;
    }
    // Which SW script did the browser actually install? Fetch it via the
    // page (goes through the controlling worker's fetch handler).
    const swText = await page.evaluate(async () => {
      try { const r = await fetch("/sw.js", { cache: "no-store" }); return await r.text(); } catch (e) { return "FETCH-FAILED: " + String(e.message); }
    });
    const plantedV6 = /tipucek-v6/.test(swText) && !/tipucek-v7/.test(swText);
    check("3 plant: installed SW script is OLD v6 (not v7)", plantedV6, `controller=${controller} swTextHasV6=${/tipucek-v6/.test(swText)} swTextHasV7=${/tipucek-v7/.test(swText)}`);
    check("3 plant: browser-level interception served old files", intercepted.index >= 1 && intercepted.sw >= 1, JSON.stringify(intercepted));

    // What did v6's install cache for "/"? Its install fetches are issued
    // by the worker itself and may bypass interception (live = new shell).
    // Read the SPECIFIC v6 cache (global caches.match would return the
    // first match across caches) and, if it holds the new shell, overwrite
    // "/" + "/index.html" with the verbatim OLD html, then verify.
    const cacheBefore = await page.evaluate(async () => {
      const c = await caches.open("tipucek-v6");
      const m = await c.match("/");
      const t = m ? await m.text() : "";
      return { hasDemoMode: t.includes("Demo mode"), langEn: t.includes('<html lang="en">'), hasOJK: t.includes("OJK") };
    });
    note("3 plant: v6 cache '/' content right after install", JSON.stringify(cacheBefore));
    if (!cacheBefore.hasDemoMode) {
      await page.evaluate(async (oldHtml) => {
        const cache = await caches.open("tipucek-v6");
        const headers = { "Content-Type": "text/html; charset=utf-8" };
        await cache.put(new Request("/"), new Response(oldHtml, { headers }));
        await cache.put(new Request("/index.html"), new Response(oldHtml, { headers }));
      }, OLD_INDEX);
      note("3 plant: overwrote v6 cache '/' + '/index.html' with verbatim old HTML", "install had cached the live shell (worker-issued fetch bypassed interception)");
    }
    const overwrite = await page.evaluate(async () => {
      const c = await caches.open("tipucek-v6");
      const back = await c.match("/");
      const backText = back ? await back.text() : "";
      return {
        keys: await caches.keys(),
        cachedRootHasDemoMode: backText.includes("Demo mode"),
        cachedRootLangEn: backText.includes('<html lang="en">'),
        cachedRootHasOJK: backText.includes("OJK"),
      };
    });
    check("3 plant: tipucek-v6 cache holds OLD shell for '/'", overwrite.cachedRootHasDemoMode && overwrite.cachedRootLangEn && !overwrite.cachedRootHasOJK, JSON.stringify(overwrite));
    const sPlant = await snapshot(page, "step3-planted");
    await page.screenshot({ path: path.join(RAW, "stale-step3-planted-old.png") });
    check("3 plant: page DISPLAYS old shell (Demo mode, English hero)", /Demo mode/.test(sPlant.modeLabel || "") && /Is this message a scam\?/.test(sPlant.heroTitle || ""), `label=${JSON.stringify(sPlant.modeLabel)} hero=${JSON.stringify(sPlant.heroTitle)} lang=${sPlant.lang}`);
    check("3 plant: old shell has NO OJK stat", !/OJK/.test(sPlant.heroStat || ""), `heroStat=${JSON.stringify(sPlant.heroStat)}`);
    note("3 plant: SW + cache state", JSON.stringify(sPlant.sw));

    // --- Phase B: remove interception, reload, watch the update ---
    await bcdp.send("Fetch.disable");
    const reloadSnaps = [];
    let finalSnap = null;
    let usedUpdateCall = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      await page.reload({ waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(2500);
      const s = await snapshot(page, `step3-reload${attempt}`);
      reloadSnaps.push(s);
      await page.screenshot({ path: path.join(RAW, `stale-step3-reload${attempt}.png`) });
      // Determine version by fetching the SW script text fresh.
      const ver = await page.evaluate(async () => {
        try { const r = await fetch("/sw.js", { cache: "no-store" }); const t = await r.text(); return /tipucek-v7/.test(t) ? "v7" : /tipucek-v6/.test(t) ? "v6" : "unknown"; }
        catch (e) { return "fetch-failed"; }
      });
      const keys = s.sw.cacheKeys;
      const isNewShell = s.lang === "id" && /Apakah pesan ini penipuan\?/.test(s.heroTitle || "") && /OJK/.test(s.heroStat || "");
      note(`3 reload#${attempt}`, `controller=${s.sw.controller} swScript=${ver} cacheKeys=${JSON.stringify(keys)} lang=${s.lang} label=${JSON.stringify(s.modeLabel)} newShell=${isNewShell}`);
      const v7Controlling = s.sw.regs.some((r) => r.active && /state=activated/.test(r.active)) && ver === "v7" && !keys.includes("tipucek-v6") && isNewShell;
      if (v7Controlling) { finalSnap = s; break; }
      if (attempt === 2 && !usedUpdateCall) {
        // Navigation alone did not surface v7 yet: force an update check
        // (same browser mechanism, explicit trigger) and continue.
        const upd = await page.evaluate(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          if (!regs.length) return "no-registration";
          try { await regs[0].update(); return "update()-called"; } catch (e) { return "update-failed: " + String(e.message); }
        });
        usedUpdateCall = true;
        note("3 reload: forced registration.update()", upd);
        await page.waitForTimeout(3000);
      }
    }
    if (!finalSnap) finalSnap = reloadSnaps[reloadSnaps.length - 1];
    const finalVer = await page.evaluate(async () => {
      try { const r = await fetch("/sw.js", { cache: "no-store" }); const t = await r.text(); return /tipucek-v7/.test(t) ? "v7" : /tipucek-v6/.test(t) ? "v6" : "unknown"; }
      catch (e) { return "fetch-failed"; }
    });
    check("3 update: SW script now v7", finalVer === "v7", `swScript=${finalVer}`);
    check("3 update: old cache tipucek-v6 deleted", !finalSnap.sw.cacheKeys.includes("tipucek-v6") && !finalSnap.sw.cacheKeys.includes("tipucek-v5"), `cacheKeys=${JSON.stringify(finalSnap.sw.cacheKeys)}`);
    check("3 update: v7 cache present", finalSnap.sw.cacheKeys.includes("tipucek-v7"), `cacheKeys=${JSON.stringify(finalSnap.sw.cacheKeys)}`);
    check("3 update: final display is NEW shell", finalSnap.lang === "id" && /Apakah pesan ini penipuan\?/.test(finalSnap.heroTitle || "") && /OJK/.test(finalSnap.heroStat || ""), `lang=${finalSnap.lang} hero=${JSON.stringify(finalSnap.heroTitle)} heroStat=${JSON.stringify(finalSnap.heroStat)}`);
    check("3 update: final mode-label not demo", !/demo/i.test(finalSnap.modeLabel || ""), `label=${JSON.stringify(finalSnap.modeLabel)}`);
    note("3 update: final mode-label value", `label=${JSON.stringify(finalSnap.modeLabel)}`);
    note("3 update: forced registration.update() used?", String(usedUpdateCall));
    note("3 update: final SW state", JSON.stringify(finalSnap.sw));
    note("3 plant-phase console errors", perrors.length ? perrors.slice(0, 4).join(" || ") : "none");
    await page.screenshot({ path: path.join(RAW, "stale-step3-final-new.png") });
    await pctx.close();
  } finally {
    await browser.close().catch(() => {});
    proxyProc.kill();
  }

  const failed = results.filter((r) => r.ok === false);
  const summary = { passed: results.filter((r) => r.ok === true).length, failed: failed.length, notes: results.filter((r) => r.ok === null).length, results };
  fs.writeFileSync(path.join(RAW, "stale-cache-results.json"), JSON.stringify(summary, null, 2));
  console.log(`\n== SUMMARY: ${summary.passed} passed, ${summary.failed} failed, ${summary.notes} notes ==`);
  if (failed.length) { console.log("FAILED CHECKS:"); failed.forEach((f) => console.log(" - " + f.name + " :: " + f.detail)); process.exitCode = 1; }
}

main().catch((e) => { console.error("FATAL:", e); process.exit(2); });
