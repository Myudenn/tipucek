#!/usr/bin/env node
/**
 * rekam-layar-browser — record a browser session as video.
 *
 * Usage:
 *   node record.js --url <url> --scenario <file.json> --out <dir>
 *                  [--width 1280] [--height 720] [--fps 60|25]
 *
 * The scenario JSON is { "name": "...", "steps": [ ... ] }.
 * Supported step actions: goto, click, fill, move, wait, waitFor,
 * screenshot, scroll, scrollTo, upload. See SKILL.md for the format.
 *
 * Capture modes (see SKILL.md "Gerakan kursor halus 60fps"):
 * - --fps 60 (DEFAULT): Xvfb + headed Chromium + ffmpeg x11grab @60fps.
 *   The mouse cursor is VISIBLE and moves smoothly (straight line +
 *   ease-in-out, ~60 steps/s) via scripts/smooth-cursor.js (CDP + XWarpPointer).
 * - --fps 25: headless Chromium + Playwright recordVideo @25fps.
 *   Fallback only: the cursor is NOT visible in headless recordings and
 *   the frame rate is fixed 25fps — do not use for demo videos.
 *
 * Output: one video per run in --out
 *   (<scenario-name>-<YYYYMMDD-HHmmss>.mp4 for 60fps, .webm for 25fps),
 * plus <name>-cursor-trace.json (mouse steps + clicks, for verification)
 * and any requested screenshots. Exits non-zero with a clear message
 * on the first failed step — never produce a partial video silently.
 */
const fs = require("fs");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");
const { SmoothCursor, waitForSettled } = require("/home/hatch/workspace/custom-skills/rekam-layar-browser/scripts/smooth-cursor");
const SKILL_SCRIPTS = "/home/hatch/workspace/custom-skills/rekam-layar-browser/scripts";

async function waitForPort(host, port, timeoutMs = 10000) {
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
  throw new Error(`local proxy did not start on ${host}:${port}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    args[key] = argv[i + 1];
  }
  return args;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForSocket(sockPath, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(sockPath)) return;
    await sleep(200);
  }
  throw new Error(`X socket ${sockPath} did not appear`);
}

/** Pick a free X display (:99..:90) and start Xvfb on it. */
async function startXvfb() {
  for (let n = 99; n >= 90; n--) {
    const display = `:${n}`;
    if (fs.existsSync(`/tmp/.X11-unix/X${n}`)) continue;
    const xvfb = spawn("Xvfb", [display, "-screen", "0", "1400x900x24", "-nolisten", "tcp"],
      { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await waitForSocket(`/tmp/.X11-unix/X${n}`);
      console.log(`Xvfb up on ${display} (1400x900)`);
      return { display, proc: xvfb };
    } catch (e) {
      xvfb.kill();
      // socket muncul tapi server mati / display rebutan — coba berikutnya
    }
  }
  throw new Error("no free X display found (:99..:90 busy)");
}

async function main() {
  const args = parseArgs(process.argv);
  const url = args.url;
  const scenarioFile = args.scenario;
  const outDir = args.out || path.join(process.cwd(), "out");
  const width = parseInt(args.width || "1280", 10);
  const height = parseInt(args.height || "720", 10);
  const fps = parseInt(args.fps || "60", 10);
  const mode60 = fps === 60;

  if (!url || !scenarioFile) {
    console.error("Usage: node record.js --url <url> --scenario <file.json> --out <dir> [--fps 60|25]");
    process.exit(2);
  }
  const scenario = JSON.parse(fs.readFileSync(scenarioFile, "utf-8"));
  if (!Array.isArray(scenario.steps)) {
    console.error(`Scenario ${scenarioFile} has no "steps" array.`);
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const runStamp = stamp();
  const baseName = `${scenario.name || "recording"}-${runStamp}`;
  const videoPath = path.join(outDir, mode60 ? `${baseName}.mp4` : `${baseName}.webm`);
  const tracePath = path.join(outDir, `${baseName}-cursor-trace.json`);

  // Playwright lives in the tools dir; fall back to a local install.
  let playwright;
  const candidates = [
    path.join(process.env.HOME, "workspace/tools/rekam-layar/node_modules/playwright"),
    path.join(__dirname, "..", "node_modules", "playwright"),
    "playwright",
  ];
  let lastErr = null;
  for (const c of candidates) {
    try {
      playwright = require(c);
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!playwright) {
    console.error("Playwright not found. Install it first:");
    console.error("  cd ~/workspace/tools/rekam-layar && npm install playwright && npx playwright install chromium");
    console.error(String(lastErr && lastErr.message || lastErr));
    process.exit(2);
  }

  const { chromium } = playwright;
  // Chromium cannot tunnel through the VM egress proxy directly
  // (ERR_TUNNEL_CONNECTION_FAILED in every configuration, verified
  // 19 Nov 2026), so start the localhost CONNECT forwarder
  // (scripts/local-proxy.js) and point Chromium at it. The forwarder
  // reads the upstream proxy from the environment; no credentials are
  // involved (the upstream accepts unauthenticated CONNECT).
  const localProxyPort = parseInt(process.env.LOCAL_PROXY_PORT || "18080", 10);
  const proxyProc = spawn(process.execPath, [path.join(SKILL_SCRIPTS, "local-proxy.js")], {
    env: { ...process.env, LOCAL_PROXY_PORT: String(localProxyPort) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proxyProc.stdout.on("data", (d) => console.log(String(d).trim()));
  proxyProc.stderr.on("data", (d) => console.error("local-proxy:", String(d).trim()));
  try {
    await waitForPort("127.0.0.1", localProxyPort);
  } catch (e) {
    proxyProc.kill();
    console.error("FAILED to start local proxy:", e.message);
    process.exit(2);
  }

  // ---- 60fps mode: Xvfb + headed Chromium (kursor terlihat) ----
  let xvfb = null;
  let display = null;
  if (mode60) {
    try {
      xvfb = await startXvfb();
      display = xvfb.display;
    } catch (e) {
      proxyProc.kill();
      console.error("FAILED to start Xvfb:", e.message);
      process.exit(2);
    }
  }

  const launchOpts = {
    headless: !mode60,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    proxy: { server: `http://127.0.0.1:${localProxyPort}` },
  };
  if (mode60) {
    launchOpts.env = { ...process.env, DISPLAY: display };
    launchOpts.args.push(
      "--disable-dev-shm-usage",
      `--window-size=${width},${height}`,
      "--window-position=0,0",
      "--hide-scrollbars",
      "--force-device-scale-factor=1"
    );
  }
  const browser = await chromium.launch(launchOpts);
  const contextOpts = {
    viewport: { width, height },
    // ignoreHTTPSErrors is REQUIRED in this VM, not a shortcut: the
    // egress proxy re-signs Google hosts (googleapis.com, google.com)
    // with the "Hatch Sandbox Egress CA", which Chromium's trust store
    // does not contain — so anonymous auth and the reCAPTCHA script
    // (both needed for the app's AI check) fail cert validation. The
    // site itself serves a real, valid cert. The video content
    // (verdict card, scores) is still verified frame by frame; the
    // padlock is not the evidence here.
    ignoreHTTPSErrors: true,
  };
  if (!mode60) contextOpts.recordVideo = { dir: outDir, size: { width, height } };
  const context = await browser.newContext(contextOpts);
  // v12: App Check debug token (env DEBUG_TOKEN, nilai tidak pernah dicetak)
  // supaya vonis cloud AI jalan dari VM; token sementara, dihapus sesudah sesi.
  const debugToken = process.env.DEBUG_TOKEN || "";
  if (debugToken) {
    await context.addInitScript((t) => { self.FIREBASE_APPCHECK_DEBUG_TOKEN = t; }, debugToken);
    console.log("debug token injected (value not shown)");
  } else {
    console.log("no debug token — running without App Check debug");
  }
  const page = await context.newPage();
  // Log failed requests — a cert or network failure on a subresource
  // (Firebase SDK, fonts) must be visible, not silent.
  page.on("requestfailed", (req) => console.log(`REQFAIL ${req.url()} :: ${req.failure() && req.failure().errorText}`));
  page.on("response", (res) => { if (res.status() >= 400) console.log(`HTTP ${res.status()} ${res.url()}`); });

  const cursor = new SmoothCursor(page, { display, offsetX: 0, offsetY: 0 });
  const traceMeta = {
    scenario: scenario.name || "recording",
    fps,
    mode: mode60 ? "xvfb-headed-x11grab" : "headless-recordVideo",
    display,
    offsetX: 0,
    offsetY: 0,
    videoStartAt: null,
    scenarioStartAt: Date.now(),
    videoFile: path.basename(videoPath),
    // PERBAIKAN 20 Nov 21:51 (temuan #4): penanda waktu bernama di
    // dalam take, supaya cut-plan bisa mengaitkan jendela potong ke
    // SAAT vonis muncul (bukan offset tetap dari klik — latensi cloud
    // bervariasi, jendela s4d lama menampilkan "Checking..." sampai
    // ~16,5 dtk). Dipakai skenario v12-safe ("verdict").
    marks: [],
  };
  let ffProc = null;
  let ffLog = null;
  let recordingStarted = false;

  function writeTrace(error) {
    const data = { ...traceMeta, error: error || null, steps: cursor.trace, clicks: cursor.clicks, marks: traceMeta.marks };
    try { fs.writeFileSync(tracePath, JSON.stringify(data, null, 2)); } catch (_) { /* abaikan */ }
  }

  async function startRecording() {
    if (recordingStarted) return;
    recordingStarted = true;
    if (!mode60) return; // headless: recordVideo sudah jalan sejak newContext
    // Ukur offset viewport->layar (chrome browser: tab strip + toolbar).
    // Jendela di (0,0) tanpa window manager; ukur, jangan hardcode.
    const geo = await page.evaluate(() => ({
      outerW: window.outerWidth, innerW: window.innerWidth,
      outerH: window.outerHeight, innerH: window.innerHeight,
      screenX: window.screenX, screenY: window.screenY,
    }));
    const offsetX = geo.screenX + Math.round((geo.outerW - geo.innerW) / 2);
    const offsetY = geo.screenY + (geo.outerH - geo.innerH);
    cursor.offsetX = offsetX;
    cursor.offsetY = offsetY;
    traceMeta.offsetX = offsetX;
    traceMeta.offsetY = offsetY;
    console.log(`viewport offset on screen: +${offsetX},+${offsetY} (outer ${geo.outerW}x${geo.outerH})`);
    // Sembunyikan scrollbar klasik (headed) — hanya untuk rekaman.
    await page.addStyleTag({ content: "::-webkit-scrollbar{display:none!important} html{scrollbar-width:none!important}" });
    await cursor.start();
    // Tempatkan kursor di tengah SEBELUM kamera jalan (tanpa trace).
    await cursor.init(Math.round(width / 2), Math.round(height / 2));
    // ffmpeg x11grab @60fps, tangkap tepat area viewport.
    const ffLogPath = path.join(outDir, `${baseName}-ffmpeg.log`);
    ffLog = fs.createWriteStream(ffLogPath);
    traceMeta.videoStartAt = Date.now();
    ffProc = spawn("ffmpeg", [
      "-y", "-f", "x11grab", "-r", "60", "-video_size", `${width}x${height}`,
      "-i", `${display}+${offsetX},${offsetY}`,
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      videoPath,
    ], { env: { ...process.env, DISPLAY: display }, stdio: ["ignore", "pipe", "pipe"] });
    ffProc.stderr.pipe(ffLog);
    ffProc.stderr.on("data", (d) => { const s = String(d); if (/frame=/.test(s)) process.stdout.write(`\r${s.trim().slice(-100)}`); });
    // Warmup: pastikan ffmpeg benar-benar merekam sebelum skenario jalan.
    await sleep(1500);
    console.log(`\nrecording @60fps -> ${videoPath}`);
  }

  async function stopRecording() {
    if (mode60 && ffProc) {
      ffProc.kill("SIGINT");
      await Promise.race([
        new Promise((res) => ffProc.on("close", res)),
        sleep(10000).then(() => { try { ffProc.kill("SIGKILL"); } catch (_) {} }),
      ]);
      if (ffLog) ffLog.end();
    }
    await cursor.stop();
  }

  async function cleanup() {
    await stopRecording().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (xvfb) xvfb.proc.kill();
    proxyProc.kill();
  }

  try {
    // Bila skenario tidak diawali goto, buka --url dulu supaya
    // langkah click/fill punya halaman (dan offset kursor terukur
    // pada halaman yang benar, bukan about:blank).
    if (!scenario.steps.length || scenario.steps[0].action !== "goto") {
      await page.goto(url, { waitUntil: "load", timeout: 60000 });
      await waitForSettled(page);
      await startRecording();
    }
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      const label = `step ${i + 1}/${scenario.steps.length} (${step.action})`;
      switch (step.action) {
        case "goto":
          // waitUntil "load", not "networkidle": apps with long-lived
          // connections (Firestore listen) never go idle.
          await page.goto(step.url || url, { waitUntil: "load", timeout: 60000 });
          await waitForSettled(page);
          await startRecording();
          break;
        case "click":
          await startRecording();
          await cursor.clickSelector(step.selector, { timeout: step.timeout || 15000 });
          break;
        case "move":
          // Gerak halus tanpa klik (menunjuk/mengarahkan perhatian).
          // Pakai "selector" (tengah elemen) atau "x"+"y" (viewport px).
          await startRecording();
          if (step.selector) {
            const loc = page.locator(step.selector).first();
            await loc.scrollIntoViewIfNeeded({ timeout: step.timeout || 15000 });
            const box = await loc.boundingBox({ timeout: step.timeout || 15000 });
            if (!box) throw new Error(`No bounding box for move target ${step.selector}`);
            await cursor.moveTo(box.x + box.width / 2, box.y + box.height / 2);
          } else {
            await cursor.moveTo(step.x, step.y);
          }
          break;
        case "fill":
          await startRecording();
          await cursor.fillSelector(step.selector, step.value, { timeout: step.timeout || 15000 });
          break;
        case "wait":
          await page.waitForTimeout(step.ms || 1000);
          break;
        case "waitFor":
          await page.waitForSelector(step.selector, { timeout: step.timeout || 30000 });
          break;
        case "screenshot":
          await page.screenshot({ path: path.join(outDir, `${step.name || "shot"}-${stamp()}.png`) });
          break;
        case "scroll":
          await page.mouse.wheel(0, step.y || 500);
          break;
        case "scrollTo":
          await page.locator(step.selector).scrollIntoViewIfNeeded({ timeout: step.timeout || 15000 });
          break;
        case "key":
          // Tekan tombol keyboard (mis. "Alt+F" untuk menu Chrome).
          await page.keyboard.press(step.key);
          break;
        case "eval":
          // Jalankan ekspresi JS di halaman (string). Hasilnya dicetak
          // sebagai JSON bila bisa diserialisasi; dipakai untuk ukur
          // posisi elemen / tutup toast / baca state.
          // Skenario v12 memakai string FUNGSI "() => {...}": page.evaluate
          // dengan string fungsi TIDAK memanggilnya (hasilnya fungsi,
          // tak terserialisasi -> undefined). Bungkus + panggil langsung;
          // bila bukan fungsi, evaluasi apa adanya.
          {
            let r;
            try {
              r = await page.evaluate(`(${step.js})()`);
            } catch (e) {
              r = await page.evaluate(step.js);
            }
            console.log(`EVAL ${JSON.stringify(r)}`);
          }
          break;
        case "waitForHidden":
          await page.waitForSelector(step.selector, { state: "hidden", timeout: step.timeout || 30000 });
          break;
        case "mark":
          // Penanda waktu bernama (lihat traceMeta.marks): tidak
          // menggerakkan apa pun, hanya mencatat Date.now() ke trace.
          traceMeta.marks.push({ name: step.name || "mark", at: Date.now() });
          console.log(`MARK ${step.name || "mark"} @${Date.now()}`);
          break;
        case "upload":
          await page.setInputFiles(step.selector, step.file, { timeout: step.timeout || 15000 });
          break;
        default:
          throw new Error(`Unknown action "${step.action}" at ${label}`);
      }
      console.log(`OK ${label}`);
    }
  } catch (e) {
    console.error(`FAILED at ${e.message}`);
    writeTrace(e.message);
    await cleanup();
    process.exit(1);
  }

  // Skenario kosong (tanpa langkah): tetap rekam halaman --url sebentar.
  if (!recordingStarted) {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await waitForSettled(page);
    await startRecording();
  }

  await stopRecording();
  await context.close();
  await browser.close();
  if (xvfb) xvfb.proc.kill();
  proxyProc.kill();

  if (!mode60) {
    // Closing the context finalizes the Playwright video; rename it
    // to the deterministic name for downstream ffmpeg steps.
    const video = page.video();
    const tmpPath = video ? await video.path() : null;
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.renameSync(tmpPath, videoPath);
    } else {
      console.error("No video file was produced by Playwright.");
      process.exit(1);
    }
  }
  if (!fs.existsSync(videoPath)) {
    console.error(`No video file was produced (${videoPath}).`);
    process.exit(1);
  }
  writeTrace(null);
  console.log(`VIDEO ${videoPath}`);
  console.log(`TRACE ${tracePath}`);
}

main().catch((e) => {
  console.error(`FATAL ${e && e.stack || e}`);
  process.exit(1);
});
