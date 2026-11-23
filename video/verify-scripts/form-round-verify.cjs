// form-round-verify.cjs — STATIC checks for the 21 Nov form + verdict
// round (Myuden's phone reports 12:48-12:56 + sticky header decision
// 13:03): checker tabs 2x2 on phones, receipt without model line,
// simplified local-signal copy, prose word-wrap, sticky header, and
// the Cek File desc breathing room. No browser needed: Chromium in
// this VM is broken (SIGTRAP on launch), so the Playwright suites
// (merge/full/flows) cannot run — this script proves the static half
// instead. Run after `npm run build`:
//   node video/verify-scripts/form-round-verify.cjs
// Exit 0 = all checks pass, 1 = any fail.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const mainJs = read("src/main.js");
const stylesCss = read("src/styles.css");
const i18nJs = read("src/i18n.js");
const distJs = (() => {
  const dir = path.join(ROOT, "dist", "assets");
  const files = fs.readdirSync(dir).filter((f) => /^index-.*\.js$/.test(f));
  if (files.length !== 1) throw new Error(`expected 1 built bundle, found ${files.length}`);
  return fs.readFileSync(path.join(dir, files[0]), "utf8");
})();
const distCss = (() => {
  const dir = path.join(ROOT, "dist", "assets");
  const files = fs.readdirSync(dir).filter((f) => /^index-.*\.css$/.test(f));
  if (files.length !== 1) throw new Error(`expected 1 built css, found ${files.length}`);
  return fs.readFileSync(path.join(dir, files[0]), "utf8");
})();

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

// ---- 1. Sticky header (Myuden 21 Nov 13:03). ----
check(
  "header: .topbar is position: sticky with top: 0",
  /\.topbar\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s.test(stylesCss),
);
check(
  "header: .topbar has a z-index above page content",
  /\.topbar\s*\{[^}]*z-index:\s*50;/s.test(stylesCss),
);
check(
  "header: no position: static left on .topbar",
  !/\.topbar\s*\{[^}]*position:\s*static;/s.test(stylesCss),
);
check(
  "header: sticky decision recorded in the .topbar comment",
  stylesCss.includes("STICKY since 21 Nov 13:03"),
);

// ---- 2. Checker tabs 2x2 on phones, one row on desktop. ----
const phoneBlock = stylesCss.slice(
  stylesCss.indexOf("@media (max-width: 640px)"),
  stylesCss.indexOf("@media (max-width: 400px)"),
);
check(
  "tabs: phone block wraps the tab bar (flex-wrap: wrap)",
  /\.checker\s+\.checker-tabs\s*\{[^}]*flex-wrap:\s*wrap;/s.test(phoneBlock),
);
check(
  "tabs: phone block removes the sideways scroll (overflow-x: visible)",
  /\.checker\s+\.checker-tabs\s*\{[^}]*overflow-x:\s*visible;/s.test(phoneBlock),
);
check(
  "tabs: phone buttons are half-row (flex 1 1 calc(50% - 4px))",
  /\.checker\s+\.checker-tab-btn\s*\{[^}]*flex:\s*1\s+1\s+calc\(50%\s*-\s*4px\);/s.test(phoneBlock),
);
check(
  "tabs: phone buttons allow two-line labels (white-space: normal)",
  /\.checker\s+\.checker-tab-btn\s*\{[^}]*white-space:\s*normal;/s.test(phoneBlock),
);
check(
  "tabs: base rule still keeps one row on wide screens (nowrap)",
  /\.checker-tabs\s*\{[^}]*flex-wrap:\s*nowrap;/s.test(stylesCss),
);

// ---- 3. Receipt must NOT name the model (Myuden 21 Nov). ----
check("receipt: no receiptModelPrimary key in i18n", !i18nJs.includes("receiptModelPrimary"));
check("receipt: no receiptModelBackup key in i18n", !i18nJs.includes("receiptModelBackup"));
check("receipt: no receiptModel render in main.js", !mainJs.includes("receiptModel"));
check(
  "receipt: other receipt lines still rendered (cloud/time/stored)",
  mainJs.includes('t("receiptTime"') && mainJs.includes('t("receiptStoredLocal"') && mainJs.includes('t("receiptCloud"'),
);
check(
  "receipt: answering model still recorded in history (e.model)",
  mainJs.includes("e.model"),
);

// ---- 4. Simplified local-signal copy (ID + EN). ----
const BANNED = ["deterministic", "deterministik", "pattern score", "pattern matches", "Local rules", "Aturan lokal", "skor pola", "pola yang cocok", "pola cocok"];
for (const key of ["localSignalTitle", "localSignalText", "checkingPreviewNote", "offlinePrelimNote"]) {
  const re = new RegExp(`${key}:\\s*(?:"([^"]*)"|\\n\\s*"([^"]*)")`, "g");
  const hits = [...i18nJs.matchAll(re)].map((m) => m[1] || m[2]);
  check(
    `copy: ${key} exists in both locales`,
    hits.length === 2,
    `found ${hits.length}`,
  );
  for (const [i, text] of hits.entries()) {
    const bad = BANNED.find((w) => text.includes(w));
    check(`copy: ${key}[${i}] has no technical jargon`, !bad, bad ? `found "${bad}"` : "");
  }
}
check(
  "copy: ID localSignalTitle is 'Cek awal di perangkat'",
  i18nJs.includes('localSignalTitle: "Cek awal di perangkat"'),
);
check(
  "copy: ID localSignalText keeps {score}/{status}/{n} placeholders",
  /localSignalText: "Cek cepat di HP Anda: \{n\} aturan terpicu, skor awal \{score\}\/100 \(\{status\}\)/.test(i18nJs),
);
check(
  "copy: EN localSignalTitle is 'Quick check on your device'",
  i18nJs.includes('localSignalTitle: "Quick check on your device"'),
);
check(
  "copy: ID text still says it is not the final verdict (AI above counts)",
  i18nJs.includes("Ini bukan vonis akhir — vonis AI di atas yang berlaku."),
);
check(
  "copy: EN text still says it is not the final verdict (AI above counts)",
  i18nJs.includes("This is not the final verdict — the AI verdict above is what counts."),
);

// ---- 5. Prose word-wrap: no mid-word splits; URLs still break. ----
check(
  "wrap: .links-box li no longer uses break-all",
  !/\.links-box li\s*\{[^}]*word-break:\s*break-all;/s.test(stylesCss),
);
check(
  "wrap: .links-box li wraps on word boundaries (break-word)",
  /\.links-box li\s*\{[^}]*overflow-wrap:\s*break-word;/s.test(stylesCss),
);
check(
  "wrap: history text no longer uses overflow-wrap: anywhere",
  !/\.history-item-btn \.history-text\s*\{[^}]*overflow-wrap:\s*anywhere;/s.test(stylesCss),
);
check(
  "wrap: checked message no longer uses overflow-wrap: anywhere",
  !/\.checked-message p\s*\{[^}]*overflow-wrap:\s*anywhere;/s.test(stylesCss),
);
check(
  "wrap: .links-url still breaks long URLs (anywhere kept)",
  /\.links-url\s*\{[^}]*overflow-wrap:\s*anywhere;/s.test(stylesCss),
);
check(
  "wrap: code/numbers/file-name still break long tokens (anywhere kept)",
  /code, \.numbers-value, \.file-name\s*\{[^}]*overflow-wrap:\s*anywhere;/s.test(stylesCss),
);

// ---- 6. Cek File desc breathing room (desktop). ----
check(
  "desc: .module-tab-desc has right padding on desktop",
  /\.module-tab-desc\s*\{[^}]*padding-right:\s*6px;/s.test(stylesCss),
);

// ---- 7. Built bundle carries the new code. ----
check(
  "bundle: sticky header in the built CSS",
  /\.topbar\{[^}]*position:sticky;[^}]*top:0;/.test(distCss.replace(/\s+/g, "")) ||
    distCss.includes("position:sticky"),
);
check(
  "bundle: simplified ID title in the built bundle",
  distJs.includes("Cek awal di perangkat"),
);
check(
  "bundle: no model line in the built bundle",
  !distJs.includes("receiptModelPrimary") && !distJs.includes("receiptModelBackup"),
);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
