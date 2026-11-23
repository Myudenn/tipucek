// Aman chat panel tests (20 Nov 2026).
// Serves the built dist/ over a local static server and opens it in
// Chromium (headless). No Firebase debug token is registered for this
// fresh profile, so App Check fails fast and Aman's AI call lands on
// the honest friendly error + retry button — which is exactly the
// deterministic path for asserting the error UI. (A successful AI
// answer is covered live, not in the VM.)
// The launcher floats forever (aman-float), so Playwright's
// stability-gated click never settles on it — every launcher click
// below uses { force: true }. The float pauses on real hover/focus,
// so human taps are unaffected; only the automated click needs it.
// Run: npm run build && node --test tests/aman-panel.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PLAYWRIGHT_PATH = path.join(
  process.env.HOME || "",
  "workspace/tools/rekam-layar/node_modules/playwright",
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function serveDist() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split("?")[0]);
      const file =
        urlPath === "/"
          ? path.join(DIST, "index.html")
          : path.join(DIST, urlPath);
      if (!file.startsWith(DIST) || !existsSync(file)) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
      });
      res.end(readFileSync(file));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const OTP =
  "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";

async function openPage(browser, url, viewport) {
  const ctx = await browser.newContext({ viewport, locale: "id-ID", ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(1500);
  return { ctx, page };
}

function intersects(a, b) {
  if (!a || !b) return false;
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function withBrowser(fn) {
  const require = createRequire(import.meta.url);
  let playwright;
  try {
    playwright = require(PLAYWRIGHT_PATH);
  } catch {
    console.log("Playwright not found, skipping");
    return;
  }
  const server = await serveDist();
  const port = server.address().port;
  const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    await fn(browser, port);
  } finally {
    await browser.close();
    server.close();
  }
}

describe("Aman chat panel", () => {
  it("launcher is a round avatar button; click opens the panel with greeting, chips, privacy note", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 1280, height: 800 });
      try {
        const fab = page.locator("#aman-fab");
        await fab.waitFor({ state: "visible", timeout: 15000 });
        const box = await fab.boundingBox();
        assert.ok(box, "launcher must have a box");
        // 56px by CSS; the float's -1.5deg tilt inflates the bounding
        // box to ~57px mid-swing, so allow 56-58 here and check the
        // exact CSS size separately.
        assert.ok(box.width >= 56 && box.width <= 58, `launcher width ${box.width} (56px + float tilt)`);
        assert.ok(box.height >= 56 && box.height <= 58, `launcher height ${box.height} (56px + float tilt)`);
        const cssSize = await page.evaluate(() => {
          const cs = getComputedStyle(document.querySelector("#aman-fab"));
          return { width: cs.width, height: cs.height };
        });
        assert.equal(cssSize.width, "56px", `launcher CSS width: ${cssSize.width}`);
        assert.equal(cssSize.height, "56px", `launcher CSS height: ${cssSize.height}`);
        const name = await page.evaluate(() => {
          const el = document.querySelector("#aman-fab");
          return el.getAttribute("aria-label") || el.textContent.trim();
        });
        assert.equal(name, "Tanya Aman", `launcher accessible name: ${name}`);
        // Panel starts hidden.
        assert.ok(await page.evaluate(() => document.querySelector("#assistant").hidden), "panel must start hidden");
        await fab.click({ force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        // Greeting wave (aman-wave): the avatar waves once when the
        // panel first opens — the class is added synchronously on open.
        const waving = await page.evaluate(() => document.querySelector("#aman-avatar").classList.contains("waving"));
        assert.ok(waving, "the avatar must wave when the panel first opens");
        // Panel entrance: a brief slide-up + fade on open.
        const panelAnim = await page.evaluate(() => getComputedStyle(document.querySelector("#assistant")).animationName);
        assert.ok(panelAnim.includes("aman-panel-in"), `panel enter animation: ${panelAnim}`);
        const panelBox = await page.locator("#assistant").boundingBox();
        assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 1280, "panel must fit the viewport");
        assert.ok(panelBox.y >= 0 && panelBox.y + panelBox.height <= 800, "panel must fit the viewport vertically");
        const greeting = await page.evaluate(() => document.querySelector("#assistant-greeting")?.textContent || "");
        assert.match(greeting, /Hai, saya Aman/, `greeting: ${greeting}`);
        assert.doesNotMatch(greeting, /teman|buddy/, `greeting must be professional, not casual: ${greeting}`);
        const chips = await page.evaluate(() => [...document.querySelectorAll("#assistant-chips .assistant-chip")].map((c) => c.textContent));
        assert.equal(chips.length, 4, `chips: ${chips.join(" | ")}`);
        assert.ok(chips.some((c) => c.includes("OTP")), "OTP chip present");
        assert.ok(chips.some((c) => c.includes("melaporkan")), "report chip present");
        const privacy = await page.evaluate(() => document.querySelector("#assistant-privacy")?.textContent || "");
        assert.match(privacy, /hanya tersimpan di perangkat Anda/, `privacy: ${privacy}`);
        assert.match(privacy, /hanya pertanyaan ini yang dikirim ke AI/, `privacy: ${privacy}`);
        const focused = await page.evaluate(() => document.activeElement?.id || "");
        assert.equal(focused, "assistant-input", `focus after open: ${focused}`);
        const expanded = await page.evaluate(() => document.querySelector("#aman-fab").getAttribute("aria-expanded"));
        assert.equal(expanded, "true", "launcher must report expanded while the panel is open");
        // Launcher float (Myuden 20 Nov 20:26): same slow aman-float as
        // the panel avatar — computed style, not just the stylesheet.
        const floatAnim = await page.evaluate(() => {
          const cs = getComputedStyle(document.querySelector("#aman-fab"));
          return { name: cs.animationName, duration: cs.animationDuration, timing: cs.animationTimingFunction, iteration: cs.animationIterationCount };
        });
        assert.ok(floatAnim.name.includes("aman-float"), `launcher animation: ${floatAnim.name}`);
        assert.equal(floatAnim.duration, "4.5s", `launcher float duration: ${floatAnim.duration}`);
        assert.equal(floatAnim.timing, "ease-in-out", `launcher float timing: ${floatAnim.timing}`);
        assert.equal(floatAnim.iteration, "infinite", `launcher float iteration: ${floatAnim.iteration}`);
        // The launcher must actually move: the mouse is still hovering
        // it after the click (which pauses the float), so move the
        // mouse away first, then sample Y four times over 1.8 s (more
        // than a third of the 4.5 s cycle); the range must exceed 1px —
        // two points alone could straddle the peak.
        await page.mouse.move(10, 10);
        const ys = [];
        for (let i = 0; i < 4; i++) {
          ys.push(await page.evaluate(() => document.querySelector("#aman-fab").getBoundingClientRect().y));
          await page.waitForTimeout(600);
        }
        const yRange = Math.max(...ys) - Math.min(...ys);
        assert.ok(yRange >= 1, `launcher must move while floating (y range ${yRange.toFixed(1)}px: ${ys.map((y) => y.toFixed(1)).join(", ")})`);
      } finally {
        await ctx.close();
      }
    });
  });

  it("prefers-reduced-motion: launcher and avatar do not animate", async () => {
    await withBrowser(async (browser, port) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "id-ID", ignoreHTTPSErrors: true, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      try {
        await page.goto(`http://127.0.0.1:${port}/?lang=id`, { waitUntil: "load", timeout: 60000 });
        await page.waitForTimeout(1500);
        const anim = await page.evaluate(() => ({
          fab: getComputedStyle(document.querySelector("#aman-fab")).animationName,
          avatar: getComputedStyle(document.querySelector("#aman-avatar")).animationName,
        }));
        assert.equal(anim.fab, "none", `launcher animation under reduced motion: ${anim.fab}`);
        assert.equal(anim.avatar, "none", `avatar animation under reduced motion: ${anim.avatar}`);
      } finally {
        await ctx.close();
      }
    });
  });

  it("no 'Tanya Aman' module tab: the launcher is the only door; close restores the previous tab", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 1280, height: 800 });
      try {
        // The tab is gone (Myuden 20 Nov 20:50) — 9 module tabs left.
        assert.equal(await page.evaluate(() => document.querySelector("#module-tab-assistant")), null, "the Tanya Aman module tab must not exist");
        const tabCount = await page.evaluate(() => document.querySelectorAll(".module-tab-btn").length);
        assert.equal(tabCount, 9, `module tabs: ${tabCount}`);
        // Switch to another tab first, then open the panel from the
        // launcher: closing must restore that tab, not the file tab.
        await page.click("#module-tab-quiz");
        await page.waitForFunction(() => document.querySelector("#module-tab-quiz").getAttribute("aria-selected") === "true", undefined, { timeout: 5000 });
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        await page.click("#assistant-close");
        await page.waitForFunction(() => document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        const restored = await page.evaluate(() => document.querySelector("#module-tab-quiz").getAttribute("aria-selected"));
        assert.equal(restored, "true", "closing the panel must restore the quiz tab");
        const focused = await page.evaluate(() => document.activeElement?.id || "");
        assert.equal(focused, "aman-fab", `focus returns to the launcher: ${focused}`);
      } finally {
        await ctx.close();
      }
    });
  });

  it("disclaimers stay inside the white card after replies; launcher never overlaps text (390px)", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 390, height: 844 });
      try {
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        for (let i = 0; i < 2; i++) {
          await page.locator("#assistant-input").fill(i === 0 ? "Apa itu penipuan OTP?" : "How do I spot a fake link?");
          await page.keyboard.press("Enter");
          await page.waitForFunction(
            (n) => document.querySelectorAll("#assistant-log .assistant-retry-btn").length >= n,
            i + 1,
            { timeout: 90000 },
          );
          await page.waitForTimeout(500);
        }
        const m = await page.evaluate(() => {
          const panel = document.querySelector("#assistant");
          const fab = document.querySelector("#aman-fab");
          const pr = panel.getBoundingClientRect();
          const fr = fab.getBoundingClientRect();
          const notes = ["#assistant-note", "#assistant-privacy"].map((sel) => {
            const el = document.querySelector(sel);
            const r = el.getBoundingClientRect();
            return { sel, top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: (el.textContent || "").trim().length };
          });
          const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          return {
            panelScroll: panel.scrollHeight - panel.clientHeight,
            panelBox: { top: pr.top, bottom: pr.bottom, left: pr.left, right: pr.right },
            fabBox: { top: fr.top, bottom: fr.bottom, left: fr.left, right: fr.right },
            notes,
            fabOverlapsPanel: intersects(fr, pr),
            fabOverlapsNotes: notes.some((n) => n.text > 0 && intersects(fr, n)),
          };
        });
        // The panel itself never overflows: the log absorbs the squeeze.
        assert.ok(m.panelScroll <= 2, `panel must not overflow its own height (scroll excess ${m.panelScroll}px)`);
        for (const n of m.notes) {
          assert.ok(n.text > 0, `${n.sel} must have text`);
          assert.ok(n.top >= m.panelBox.top - 1, `${n.sel} must stay inside the card (top ${n.top.toFixed(1)} vs panel ${m.panelBox.top.toFixed(1)})`);
          assert.ok(n.bottom <= m.panelBox.bottom + 1, `${n.sel} must stay inside the card (bottom ${n.bottom.toFixed(1)} vs panel ${m.panelBox.bottom.toFixed(1)})`);
        }
        assert.ok(!m.fabOverlapsPanel, "the launcher must not overlap the panel");
        assert.ok(!m.fabOverlapsNotes, "the launcher must not overlap the disclaimer notes");
      } finally {
        await ctx.close();
      }
    });
  });

  it("auto-scroll + roomy log (390px): the newest reply is fully visible, log is not cramped", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 390, height: 844 });
      try {
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        // The panel must fit the phone screen (no overflow).
        const panelBox = await page.locator("#assistant").boundingBox();
        assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, "panel must fit the 390px viewport");
        assert.ok(panelBox.y >= 0 && panelBox.y + panelBox.height <= 844, "panel must fit the viewport vertically");
        const questions = [
          "Apa itu penipuan OTP?",
          "How do I spot a fake link?",
          "Saya dapat pesan hadiah, apakah ini penipuan?",
        ];
        for (let i = 0; i < questions.length; i++) {
          await page.locator("#assistant-input").fill(questions[i]);
          await page.keyboard.press("Enter");
          // Wait for the reply to land (error + retry in this profile).
          await page.waitForFunction(
            (n) => document.querySelectorAll("#assistant-log .assistant-retry-btn").length >= n,
            i + 1,
            { timeout: 90000 },
          );
          await page.waitForTimeout(500);
          const m = await page.evaluate(() => {
            const log = document.querySelector("#assistant-log");
            const last = log?.lastElementChild;
            if (!log || !last) return null;
            const lr = log.getBoundingClientRect();
            const br = last.getBoundingClientRect();
            return {
              clientHeight: log.clientHeight,
              pinned: log.scrollTop + log.clientHeight >= log.scrollHeight - 1,
              lastTop: br.top - lr.top,
              lastBottom: br.bottom - lr.top,
            };
          });
          assert.ok(m, "log must exist");
          // Roomy log (20 Nov 20:55): the old 41px min-height squeeze is gone.
          // 180px still proves roominess (a ~100px reply fits with room
          // to spare) with slack for font/layout variance.
          assert.ok(m.clientHeight >= 180, `log must be roomy on a phone (clientHeight ${m.clientHeight}px)`);
          assert.ok(m.pinned, "log must stay pinned to the bottom after a reply");
          assert.ok(m.lastTop >= -1, `newest reply's top must be visible (lastTop ${m.lastTop.toFixed(1)}px)`);
          assert.ok(m.lastBottom <= m.clientHeight + 1, `newest reply must be fully visible (lastBottom ${m.lastBottom.toFixed(1)}px of ${m.clientHeight}px)`);
        }
      } finally {
        await ctx.close();
      }
    });
  });

  it("Escape closes the panel; launcher toggles it", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 1280, height: 800 });
      try {
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
      } finally {
        await ctx.close();
      }
    });
  });

  it("send shows the question + typing, then a friendly error with a retry button (AI unreachable in the VM)", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 1280, height: 800 });
      try {
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        await page.fill("#assistant-input", "Apa itu penipuan OTP?");
        await page.click("#assistant-send");
        await page.waitForFunction(
          () => [...document.querySelectorAll("#assistant-log .assistant-msg.user")].some((m) => m.textContent.includes("Apa itu penipuan OTP?")),
          undefined, { timeout: 5000 },
        );
        // Typing indicator appears while Aman "thinks".
        await page.waitForFunction(
          () => !!document.querySelector("#assistant-log .assistant-msg.typing"),
          undefined, { timeout: 5000 },
        );
        // AI is unreachable in the VM (no App Check debug token): the
        // friendly error + retry button must appear, never raw text.
        await page.waitForFunction(
          () => !!document.querySelector("#assistant-log .assistant-retry-btn"),
          undefined, { timeout: 60000 },
        );
        const logText = await page.evaluate(() => document.querySelector("#assistant-log")?.innerText || "");
        assert.match(logText, /Maaf, saya tidak bisa menjawab itu/, `error message: ${logText.slice(0, 200)}`);
        assert.doesNotMatch(logText, /App Check|403|token|Error:/, "error must not leak raw technical text");
        // Retry re-asks the same question without echoing it twice.
        const userCountBefore = await page.evaluate(() => document.querySelectorAll("#assistant-log .assistant-msg.user").length);
        await page.click("#assistant-log .assistant-retry-btn");
        await page.waitForFunction(
          () => !!document.querySelector("#assistant-log .assistant-msg.typing"),
          undefined, { timeout: 5000 },
        );
        const userCountAfter = await page.evaluate(() => document.querySelectorAll("#assistant-log .assistant-msg.user").length);
        assert.equal(userCountAfter, userCountBefore, "retry must not duplicate the user message");
      } finally {
        await ctx.close();
      }
    });
  });

  it("language switch re-renders the panel strings (ID → EN)", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 1280, height: 800 });
      try {
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        await page.click("#lang-en-btn");
        await page.waitForFunction(
          () => document.querySelector("#assistant-greeting")?.textContent.includes("Hi, I'm Aman"),
          undefined, { timeout: 5000 },
        );
        const greetingEn = await page.evaluate(() => document.querySelector("#assistant-greeting")?.textContent || "");
        assert.doesNotMatch(greetingEn, /buddy/, `EN greeting must be professional: ${greetingEn}`);
        const placeholder = await page.evaluate(() => document.querySelector("#assistant-input")?.placeholder || "");
        assert.match(placeholder, /Ask Aman about scams/, `placeholder: ${placeholder}`);
        const privacy = await page.evaluate(() => document.querySelector("#assistant-privacy")?.textContent || "");
        assert.match(privacy, /Chat stays on this device/, `privacy: ${privacy}`);
        const closeLabel = await page.evaluate(() => document.querySelector("#assistant-close")?.getAttribute("aria-label") || "");
        assert.equal(closeLabel, "Close chat with Aman", `close label: ${closeLabel}`);
        const chips = await page.evaluate(() => [...document.querySelectorAll("#assistant-chips .assistant-chip")].map((c) => c.textContent));
        assert.ok(chips.some((c) => c.includes("OTP fraud")), `chips: ${chips.join(" | ")}`);
      } finally {
        await ctx.close();
      }
    });
  });

  it("completion toast never hides behind the open panel", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 1280, height: 800 });
      try {
        await page.click("#aman-fab", { force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        await page.fill("#message-input", OTP);
        await page.click("#check-btn");
        await page.waitForFunction(
          () => { const t = document.querySelector("#toast"); return t && !t.hidden; },
          undefined, { timeout: 60000 },
        );
        const boxes = await page.evaluate(() => {
          const t = document.querySelector("#toast").getBoundingClientRect();
          const p = document.querySelector("#assistant").getBoundingClientRect();
          return { toast: { x: t.x, y: t.y, width: t.width, height: t.height }, panel: { x: p.x, y: p.y, width: p.width, height: p.height } };
        });
        assert.ok(!intersects(boxes.toast, boxes.panel), `toast ${JSON.stringify(boxes.toast)} must not overlap panel ${JSON.stringify(boxes.panel)}`);
      } finally {
        await ctx.close();
      }
    });
  });

  it("mobile 390px: launcher + panel fit, no horizontal overflow", async () => {
    await withBrowser(async (browser, port) => {
      const { ctx, page } = await openPage(browser, `http://127.0.0.1:${port}/?lang=id`, { width: 390, height: 844 });
      try {
        const fab = page.locator("#aman-fab");
        await fab.waitFor({ state: "visible", timeout: 15000 });
        const box = await fab.boundingBox();
        assert.ok(box && box.width >= 48 && box.height >= 48, "launcher must stay a 48px+ touch target on mobile");
        await fab.click({ force: true });
        await page.waitForFunction(() => !document.querySelector("#assistant").hidden, undefined, { timeout: 5000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `horizontal overflow ${overflow}px`);
        const panelBox = await page.locator("#assistant").boundingBox();
        assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 390, `panel box ${JSON.stringify(panelBox)}`);
        const inputFont = await page.evaluate(() => getComputedStyle(document.querySelector("#assistant-input")).fontSize);
        assert.equal(inputFont, "16px", `input font ${inputFont} (16px prevents iOS zoom)`);
      } finally {
        await ctx.close();
      }
    });
  });
});
