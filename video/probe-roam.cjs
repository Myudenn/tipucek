#!/usr/bin/env node
// Probe: does #aman-roam (roaming companion) cover buttons / text / content?
// Samples the roamer's rect every 400ms and checks, via elementFromPoint
// at 5 points inside its round face, what sits underneath it.
// Also forces roamNear() by running a real check, then samples the parked spot.
// Usage: node video/probe-roam.cjs  (writes JSON + screenshots to video/raw/)
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

const HOME = process.env.HOME;
const ROOT = path.join(HOME, "workspace/pesanaman");
const PROXY_PORT = parseInt(process.env.LOCAL_PROXY_PORT || "18085", 10);
const PREVIEW_PORT = 4173;
const RAW = path.join(ROOT, "video/raw");
fs.mkdirSync(RAW, { recursive: true });

const SCAM_SAMPLE =
  "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!";

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

// In-page sampler: returns roamer rect + what is under 5 points of its face.
const SAMPLE_FN = () => {
  const el = document.getElementById("aman-roam");
  if (!el || el.hidden) return { visible: false };
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const rad = r.width * 0.35;
  const pts = [
    [cx, cy],
    [cx - rad, cy],
    [cx + rad, cy],
    [cx, cy - rad],
    [cx, cy + rad],
  ];
  const under = [];
  for (const [x, y] of pts) {
    // elementsFromPoint: topmost first. Drop the roamer itself and its
    // children — the next element is what the roamer's face actually hides.
    const stack = document.elementsFromPoint(x, y);
    const below = stack.filter((el) => !el.closest("#aman-roam"));
    const t = below[0];
    if (!t) { under.push(null); continue; }
    const tag = t.tagName.toLowerCase();
    const interactive = ["button", "a", "input", "textarea", "select", "label"].includes(tag) || t.closest("button,a,input,textarea,select,label");
    const txt = (t.textContent || "").trim().slice(0, 60);
    under.push({ tag, id: t.id || null, cls: (t.className && String(t.className).slice(0, 40)) || null, interactive: !!interactive, text: txt });
  }
  return {
    visible: true,
    rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    scrollY: Math.round(window.scrollY),
    under,
  };
};

async function sampleFor(page, ms, label, shotEvery = 5) {
  const hits = [];
  const shots = [];
  const positions = [];
  const n = Math.floor(ms / 400);
  for (let i = 0; i < n; i++) {
    const s = await page.evaluate(SAMPLE_FN);
    if (s.visible) {
      positions.push(`${s.rect.x},${s.rect.y}`);
      const covered = s.under.filter(Boolean);
      if (covered.length > 0) {
        hits.push({ t: i * 400, rect: s.rect, scrollY: s.scrollY, covered });
        if (shots.length < 3) {
          const p = path.join(RAW, `roam-${label}-${shots.length + 1}.png`);
          await page.screenshot({ path: p });
          shots.push(p);
        }
      }
    }
    await page.waitForTimeout(400);
  }
  return { samples: n, hits, shots, distinctPositions: [...new Set(positions)].length };
}

async function main() {
  const playwright = require(path.join(HOME, "workspace/tools/rekam-layar/node_modules/playwright"));
  const { chromium } = playwright;
  const proxyProc = spawn(process.execPath, [
    path.join(HOME, "workspace/custom-skills/rekam-layar-browser/scripts/local-proxy.js"),
  ], { env: { ...process.env, LOCAL_PROXY_PORT: String(PROXY_PORT) }, stdio: ["ignore", "pipe", "pipe"] });
  const previewProc = spawn(process.execPath, [
    path.join(ROOT, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort",
  ], { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await waitForPort("127.0.0.1", PROXY_PORT);
    await waitForPort("127.0.0.1", PREVIEW_PORT);
  } catch (e) {
    proxyProc.kill(); previewProc.kill();
    console.error("FAILED to start servers:", e.message); process.exit(2);
  }
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${PROXY_PORT}`, bypass: "localhost,127.0.0.1" },
  });
  const out = {};
  try {
    for (const [label, width, height, touch] of [
      ["desktop", 1280, 800, false],
      ["mobile", 390, 844, true],
    ]) {
      const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true, hasTouch: touch });
      const page = await ctx.newPage();
      await page.goto(`http://localhost:${PREVIEW_PORT}/`, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(3000);
      const roam0 = await page.evaluate(SAMPLE_FN);
      // Phase 1: idle wandering, 24s at the top of the page.
      const idle = await sampleFor(page, 24000, `${label}-idle`);
      // Phase 2: run a real check -> roamNear parks by the verdict card.
      await page.locator("#samples button").first().click();
      await page.click("#check-btn");
      await page.waitForSelector("#result .result-card", { timeout: 90000 });
      await page.waitForTimeout(2000); // let roamNear glide + park
      const near = await sampleFor(page, 12000, `${label}-near`);
      // Phase 3: scroll to the middle of the page, keep sampling.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.5));
      await page.waitForTimeout(1000);
      const scrolled = await sampleFor(page, 12000, `${label}-scroll`);
      out[label] = { roamerAtLoad: roam0, idle, near, scrolled };
      await ctx.close();
    }
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await browser.close();
    proxyProc.kill();
    previewProc.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
