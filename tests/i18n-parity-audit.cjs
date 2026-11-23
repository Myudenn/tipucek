#!/usr/bin/env node
// TipuCek — full i18n parity audit (round 6, Myuden 20 Nov 08:03 "nol-celah").
//
// Parses src/i18n.js WITHOUT importing it (t() silently falls back to
// EN, which would hide missing keys) and checks, for both locales:
//   1. key-set parity in STRINGS + DEMO (summaries/flags), no empty values
//   2. {placeholder} parity per key vs EN
//   3. values identical to EN in a non-EN locale (possible untranslated)
//   4. language leakage (ID text in EN, EN text in ID, EN/ID text in
//      ES/FR/DE/PT/JA/ZH) + "kamu"/"-mu" leftovers in ID (must be "Anda")
//   5. heroStat number/currency format per locale
//   6. prints the new/changed keys in both languages for human judgment
// Usage: node tests/i18n-parity-audit.cjs ; exit 0 only when all checks pass.
const fs = require("fs");
const path = require("path");
const SRC = path.join(__dirname, "..", "src", "i18n.js");
const text = fs.readFileSync(SRC, "utf8");
const LOCALES = ["en", "id"];

// --- minimal JS object-literal parser (double-quoted strings only) ---
// Single shared cursor `i` so nested objects advance the outer parse.
let i = 0;
function parseObject(src, startIdx) {
  // startIdx points at "{". Returns { value, endIdx }.
  i = startIdx;
  const skipWs = () => { while (i < src.length && /\s/.test(src[i])) i++; };
  const parseString = () => {
    // src[i] === '"'
    let out = "";
    i++;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
      if (c === '"') { i++; return out; }
      out += c; i++;
    }
    throw new Error("unterminated string");
  };
  const parseValue = () => {
    skipWs();
    if (src[i] === "{") return parseObject(src, i).value;
    if (src[i] === '"') return parseString();
    throw new Error(`unexpected char ${JSON.stringify(src[i])} at ${i}`);
  };
  const obj = {};
  i++; // consume {
  for (;;) {
    skipWs();
    if (src[i] === "}") { i++; return { value: obj, endIdx: i }; }
    let key;
    if (src[i] === '"') key = parseString();
    else {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i));
      if (!m) throw new Error(`bad key at ${i}: ${JSON.stringify(src.slice(i, i + 30))}`);
      key = m[0]; i += key.length;
    }
    skipWs();
    if (src[i] !== ":") throw new Error(`expected : after ${key} at ${i}`);
    i++;
    obj[key] = parseValue();
    skipWs();
    if (src[i] === ",") { i++; continue; }
    if (src[i] === "}") { i++; return { value: obj, endIdx: i }; }
    throw new Error(`expected , or } at ${i}: ${JSON.stringify(src.slice(i, i + 30))}`);
  }
}
function parseConst(name) {
  const idx = text.indexOf(`const ${name} = {`);
  if (idx < 0) throw new Error(`const ${name} not found`);
  const brace = text.indexOf("{", idx);
  return parseObject(text, brace).value;
}
const STRINGS = parseConst("STRINGS");
const DEMO = parseConst("DEMO");

const failures = [];
const warnings = [];
function fail(msg) { failures.push(msg); console.log("FAIL " + msg); }
function warn(msg) { warnings.push(msg); console.log("WARN " + msg); }
function ok(msg) { console.log("PASS " + msg); }

// 1. STRINGS key parity + empties
const allKeys = new Set();
for (const l of LOCALES) for (const k of Object.keys(STRINGS[l] || {})) allKeys.add(k);
let parityOk = true;
for (const l of LOCALES) {
  const missing = [...allKeys].filter((k) => !(k in (STRINGS[l] || {})));
  const extra = Object.keys(STRINGS[l] || {}).filter((k) => !allKeys.has(k));
  const empty = Object.keys(STRINGS[l] || {}).filter((k) => !String(STRINGS[l][k]).trim());
  if (missing.length) { parityOk = false; fail(`${l}: missing STRINGS keys: ${missing.join(", ")}`); }
  if (extra.length) { parityOk = false; fail(`${l}: extra STRINGS keys: ${extra.join(", ")}`); }
  if (empty.length) { parityOk = false; fail(`${l}: empty STRINGS values: ${empty.join(", ")}`); }
}
if (parityOk) ok(`STRINGS key parity: ${allKeys.size} keys identical in both locales, none empty`);

// 1b. DEMO parity
for (const l of LOCALES) {
  const d = DEMO[l];
  if (!d) { fail(`${l}: DEMO block missing`); continue; }
  const sumKeys = Object.keys(d.summaries || {});
  for (const s of ["scam", "suspicious", "safe"]) {
    if (!sumKeys.includes(s)) fail(`${l}: DEMO.summaries missing "${s}"`);
    else if (!String(d.summaries[s]).trim()) fail(`${l}: DEMO.summaries["${s}"] empty`);
  }
}
const flagKeys = new Set();
for (const l of LOCALES) for (const k of Object.keys((DEMO[l] || {}).flags || {})) flagKeys.add(k);
let demoOk = true;
// EN flags are {} BY DESIGN: demoFlag() returns the English flag
// text as-is for EN, so only the 1 non-EN locale carries translations.
for (const l of LOCALES) {
  if (l === "en") {
    if (Object.keys((DEMO.en || {}).flags || {}).length !== 0) { demoOk = false; fail("en: DEMO.flags must stay empty by design (demoFlag returns English as-is)"); }
    continue;
  }
  const missing = [...flagKeys].filter((k) => !((DEMO[l] || {}).flags || {})[k]);
  if (missing.length) { demoOk = false; fail(`${l}: missing DEMO.flags: ${missing.length} (${missing.slice(0, 3).join(" | ")})`); }
}
if (demoOk) ok(`DEMO parity: summaries 3/3 + flags ${flagKeys.size}/${flagKeys.size} in both locales`);

// 2. placeholder parity vs EN
const ph = (s) => [...String(s).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort().join(",");
let phBad = 0;
for (const k of allKeys) {
  const enPh = ph(STRINGS.en[k] ?? "");
  for (const l of LOCALES) {
    if (l === "en") continue;
    if (!(k in STRINGS[l])) continue;
    const got = ph(STRINGS[l][k]);
    if (got !== enPh) { phBad++; fail(`${l}/${k}: placeholders differ from EN — EN {${enPh}} vs ${l} {${got}}`); }
  }
}
if (!phBad) ok("placeholder parity: every key's {vars} match EN in both locales");

// 3. values identical to EN in non-EN locales (review list)
const legitIdentical = /^(TipuCek|https?:\/\/|www\.|#|\+?\d[\d\s\-()+]*$|[\d\s.,%°:;()\-–—/]+$|OK|QRIS|APK|OTP|PIN|SMS|AI|URL|PDF|BCA$)/;
for (const l of LOCALES) {
  if (l === "en") continue;
  const same = [...allKeys].filter((k) => STRINGS[l][k] === STRINGS.en[k] && !legitIdentical.test(String(STRINGS.en[k]).trim()));
  if (same.length) warn(`${l}: ${same.length} values identical to EN (review: untranslated?) — ${same.slice(0, 8).join(", ")}`);
}

// 4a. ID markers in EN (skip heroStat's Rp; skip sampleTextOtp's BCA — ordered exception)
const idMarkers = /SELAMAT|hadiah|Telkomsel|undian|Kode OTP|kurir|kantor|pernikahan|LOWONGAN|Mencurigakan|Penipuan|Jangan berikan|segera hubungi|Anda\b/;
for (const k of allKeys) {
  const v = String(STRINGS.en[k] || "");
  if (k === "heroStat") continue; // "Rp" is correct in EN
  if (k === "sampleTextOtp") continue; // BCA case identity kept by order
  if (idMarkers.test(v)) fail(`en/${k}: Indonesian text in EN locale: ${v.slice(0, 100)}`);
  if (/\bRp /.test(v) && k !== "heroStat") warn(`en/${k}: "Rp " in EN text: ${v.slice(0, 100)}`);
}
// 4b. EN markers + kamu/-mu in ID
const enInId = /\b(Your|The|This message|Please|Thank you|Never share|Check the|Warning|Safe\.|Scam\.|Suspicious\.)\b/;
const kamuRe = /\bkamu\b|\bmu\b|[-–—]mu\b|milikmu|punyamu|laporanmu|pesanmu|akunmu|nomormu|riwayatmu|hasilmu|perangkatmu|ponselmu|untukmu|denganmu|darimu|kepadamu|bagimu|olehmu|\bkau\b/i;
for (const k of Object.keys(STRINGS.id)) {
  const v = String(STRINGS.id[k] || "");
  if (enInId.test(v)) fail(`id/${k}: English text in ID locale: ${v.slice(0, 120)}`);
  if (kamuRe.test(v)) fail(`id/${k}: "kamu"/"-mu" leftover (must be Anda): ${v.slice(0, 120)}`);
}
// 4c. (retired 20 Nov 2026: only ID + EN remain, so there is no
// third locale for EN/ID text to leak into — 4a/4b cover both.)
// 4d. kamu/-mu anywhere in the ID blocks of i18n.js (belt & braces)
const idBlocks = text.slice(text.indexOf("  id: {", text.indexOf("const STRINGS")), text.indexOf("const DEMO"));
if (kamuRe.test(idBlocks)) {
  const m = idBlocks.match(new RegExp(`.{0,60}(${kamuRe.source}).{0,60}`, "i"));
  fail(`raw ID STRINGS block contains kamu/-mu: ...${(m && m[0]) || ""}...`);
} else ok("ID locale: zero kamu/-mu in STRINGS block");

// 5. heroStat format per locale — exactly as the OJK press release
// writes it (audit 5): "Rp9 triliun", never the rounded "9,1/9.1".
const heroExpect = {
  en: /Rp9 trillion \(~US\$500 million\)/,
  id: /Rp9 triliun/,
};
for (const l of LOCALES) {
  const v = String(STRINGS[l].heroStat || "");
  if (!/411[.,]000\+/.test(v)) fail(`${l}/heroStat: missing 411,000+`);
  if (!/OJK \(IASC\)/.test(v)) fail(`${l}/heroStat: missing OJK (IASC)`);
  if (!/2024/.test(v) || !/2025/.test(v)) fail(`${l}/heroStat: missing Nov 2024–Dec 2025`);
  if (heroExpect[l] && !heroExpect[l].test(v)) fail(`${l}/heroStat: number format wrong: ${v.slice(0, 120)}`);
}
if (!failures.some((f) => f.includes("heroStat"))) ok("heroStat: Rp9 + 411,000+ + OJK (IASC) + 2024–2025 in both locales; EN carries (~US$500 million)");

// 6. print new/changed keys in both languages for human judgment
console.log("\n--- NEW/CHANGED KEYS (read both, judge the translation) ---");
for (const k of ["checkingPreviewNote", "badgeCode", "codeOnlyNote", "tryingBackupModel", "receiptCode", "heroStat", "sampleTextOtp"]) {
  console.log(`\n## ${k}`);
  for (const l of LOCALES) console.log(`  [${l}] ${STRINGS[l][k]}`);
}
console.log(`\n=== ${failures.length} failures, ${warnings.length} warnings, ${allKeys.size} STRINGS keys, ${flagKeys.size} DEMO flags ===`);
process.exit(failures.length ? 1 : 0);
