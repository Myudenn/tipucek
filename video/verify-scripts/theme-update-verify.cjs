// theme-update-verify.cjs — STATIC checks for the theme + app-update
// fix (21 Nov, bug tema "Sistem" di HP Myuden). No browser needed:
// Chromium in this VM is broken (SIGTRAP on launch), so the
// Playwright suites (merge/full/flows) cannot run — this script
// proves the static half instead: the icon logic polarity, the
// update-toast wiring, the i18n keys, the SW update hooks, and that
// the built bundle carries the new code. Run after `npm run build`:
//   node video/verify-scripts/theme-update-verify.cjs
// Exit 0 = all checks pass, 1 = any fail.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const mainJs = read("src/main.js");
const stylesCss = read("src/styles.css");
const i18nJs = read("src/i18n.js");
const swJs = read("public/sw.js");

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`[PASS] ${name}`);
  } else {
    fail += 1;
    console.log(`[FAIL] ${name} ${detail}`);
  }
}

// ---- 1. Theme icon logic: polarity must be exactly this. ----
check(
  "icon: moon hidden unless effective dark",
  mainJs.includes('moon.hidden = effective !== "dark"'),
);
check(
  "icon: sun hidden unless effective light",
  mainJs.includes('sun.hidden = effective !== "light"'),
);
check(
  "icon: CSS derives icon from applied theme (dark hides sun)",
  stylesCss.includes(':root[data-theme="dark"] #theme-icon-sun { display: none; }'),
);
check(
  "icon: CSS derives icon from applied theme (light hides moon)",
  stylesCss.includes(':root[data-theme="light"] #theme-icon-moon { display: none; }'),
);
check(
  "icon: [hidden] still wins (display none !important)",
  stylesCss.includes("[hidden] { display: none !important; }"),
);

// ---- 2. "System" still follows the device via matchMedia. ----
check(
  "system: resolveThemeMode uses prefers-color-scheme dark",
  mainJs.includes('matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"'),
);
check(
  "system: live re-apply on device theme change",
  mainJs.includes('window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change"'),
);
check(
  "theme: default stays dark, manual Gelap/Terang untouched",
  mainJs.includes('let themeMode = "dark"') &&
    mainJs.includes('const THEME_MODES = ["light", "dark", "system"]'),
);

// ---- 3. App-update notice: wiring. ----
check("update: showUpdateToast exists", mainJs.includes("function showUpdateToast()"));
check("update: hideUpdateToast exists", mainJs.includes("function hideUpdateToast()"));
check(
  "update: controllerchange listener announces only when a worker already controlled the page",
  mainJs.includes('navigator.serviceWorker.addEventListener("controllerchange"') &&
    mainJs.includes("const hadController = !!navigator.serviceWorker.controller") &&
    mainJs.includes("if (hadController)"),
);
check(
  "update: visibilitychange triggers a throttled registration.update()",
  mainJs.includes('document.addEventListener("visibilitychange"') &&
    mainJs.includes("registration.update()"),
);
check(
  "update: no auto-reload anywhere (reload only behind the toast action button)",
  (mainJs.match(/location\.reload\(\)/g) || []).length === 1 &&
    mainJs.includes('el.querySelector(".toast-action").addEventListener("click", () => window.location.reload())'),
);
check(
  "update: notice is persistent (no TOAST_MS auto-hide in showUpdateToast)",
  (() => {
    const start = mainJs.indexOf("function showUpdateToast()");
    const end = mainJs.indexOf("function hideUpdateToast()");
    const body = mainJs.slice(start, end);
    return !body.includes("setTimeout(hideUpdateToast") && !body.includes("TOAST_MS");
  })(),
);
check(
  "update: check/info toasts hand the shared element back (takeover flag)",
  mainJs.includes("updateToastTakenOver = true") &&
    mainJs.includes("if (pendingUpdate && updateToastTakenOver)"),
);
check(
  "update: toast action button styled",
  stylesCss.includes(".toast-action {") && stylesCss.includes("background: var(--accent); color: #fff;"),
);

// ---- 4. i18n keys exist in BOTH locales, non-empty, ID != EN. ----
for (const key of ["updateAvailable", "updateAvailableText", "updateReload"]) {
  const hits = [...i18nJs.matchAll(new RegExp(`${key}:\\s*"([^"]+)"`, "g"))].map((m) => m[1]);
  check(
    `i18n: ${key} present in both locales, non-empty, ID != EN`,
    hits.length === 2 && hits.every((v) => v.length > 0) && hits[0] !== hits[1],
    `found: ${JSON.stringify(hits)}`,
  );
}
check(
  "i18n: ID strings are Indonesian",
  i18nJs.includes('updateAvailable: "Versi baru tersedia"') &&
    i18nJs.includes('updateReload: "Muat ulang"'),
);

// ---- 5. Service worker: update can actually arrive. ----
check("sw: skipWaiting on install", swJs.includes("self.skipWaiting()"));
check("sw: clients.claim on activate", swJs.includes("self.clients.claim()"));
check(
  "sw: documents are network-first (fresh HTML wins)",
  swJs.includes("isDocumentRequest") && swJs.includes("fetch(event.request)"),
);
check("sw: cache name is tipucek-v11", swJs.includes('const CACHE = "tipucek-v11"'));

// ---- 6. Built bundle carries the new code (run after npm run build). ----
const distDir = path.join(ROOT, "dist", "assets");
let bundleText = "";
try {
  for (const f of fs.readdirSync(distDir)) {
    if (f.endsWith(".js")) bundleText += fs.readFileSync(path.join(distDir, f), "utf8");
  }
} catch {
  bundleText = "";
}
check("build: dist bundle exists", bundleText.length > 0);
check(
  "build: bundle contains the theme icon logic",
  bundleText.includes("theme-icon-moon") && bundleText.includes("prefers-color-scheme"),
);
check(
  "build: bundle contains the update notice strings",
  bundleText.includes("Versi baru tersedia") && bundleText.includes("Muat ulang"),
);

console.log(`\ntheme-update-verify: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
