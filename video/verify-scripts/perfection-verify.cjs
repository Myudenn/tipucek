// PERFECTION-ROUND VERIFICATION (21 Nov 2026) — static checks for the
// "nol kesalahan, nol bug" round ordered by Myuden. NO browser: every
// check here is source-code assertions + Node probes of the pure
// modules (ai.js, callcheck.js, i18n.js). Runtime behaviour in a real
// browser (voice recording, OCR, RDAP live, CSV download) is NOT
// proven by this script — it must be verified live in the cloud
// browser after deploy.
// Exit 0 only when ALL checks pass.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/perfection-verify.cjs
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(process.env.HOME, "workspace/pesanaman");
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + String(detail).slice(0, 240) : ""}`);
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

async function main() {
  const ai = read("src/ai.js");
  const callcheck = read("src/callcheck.js");
  const mainJs = read("src/main.js");
  const html = read("index.html");
  const i18n = read("src/i18n.js");
  const flows = read("video/verify-scripts/flows-verify.cjs");
  const full = read("video/verify-scripts/full-verify.cjs");
  const rapi = read("video/verify-scripts/rapi-verify.cjs");

  // (p1-p5) Shortened link hiding an .apk — local score 50 -> 65 scam.
  check("p1 ai.js has shortener+APK pattern weight 15", /Shortened link hides its destination/.test(ai) && /weight: 15, flag: "Shortened link hides its destination/.test(ai));
  check("p2 i18n translates the shortener+APK flag to ID", /Tautan pendek menyembunyikan tujuannya dan pesan menyebut file APK/.test(i18n));
  const aiMod = await import("file://" + path.join(ROOT, "src/ai.js"));
  const apkShort = aiMod.analyzeWithHeuristic("Download aplikasi undangan pernikahan kami di sini: http://bit.ly/undangan-apk — install APK-nya ya!", "id");
  check("p3 bit.ly APK case is now 65 scam (was 50 suspicious)", apkShort.status === "scam" && apkShort.riskScore === 65, `${apkShort.status} ${apkShort.riskScore}`);
  const apkDirect = aiMod.analyzeWithHeuristic("Halo, ini undangan pernikahan kami! Silakan download aplikasinya di sini: https://undangan-nikah-2026.xyz/invite.apk — mohon kehadirannya ya, terima kasih!", "id");
  check("p4 direct .apk case still 75 scam", apkDirect.status === "scam" && apkDirect.riskScore === 75, `${apkDirect.status} ${apkDirect.riskScore}`);
  const bankShort = aiMod.analyzeWithHeuristic("Download aplikasi resmi Bank Jago di sini: https://bit.ly/bankjago-app", "id");
  check("p4b legit bank short-link invite untouched (50 suspicious, not scam)", bankShort.status === "suspicious" && bankShort.riskScore === 50, `${bankShort.status} ${bankShort.riskScore}`);
  const bench = JSON.parse(read("tests/benchmark-local-rules.json"));
  const apkRow = bench.rows.find((r) => r.id === "scam-apk");
  check("p5 benchmark scam-apk row is 65 scam", apkRow && apkRow.status === "scam" && apkRow.score === 65, apkRow ? `${apkRow.status} ${apkRow.score}` : "row missing");
  check("p5b benchmark still 18/18, FP 0/9, FN 0/9", bench.flaggedAccuracy === "18/18" && bench.falsePositives === "0/9" && bench.falseNegatives === "0/9", `${bench.flaggedAccuracy} FP ${bench.falsePositives} FN ${bench.falseNegatives}`);

  // (p6-p7) Plain transfer ask in a call is no longer Safe 0.
  check("p6 callcheck.js has callScriptTransfer pattern weight 30", /key: "callScriptTransfer"/.test(callcheck) && /weight: 30,\n  },\n];/.test(callcheck));
  check("p6b i18n has callScriptTransfer EN+ID", /"callScriptTransfer": "Asks for a money transfer to an account"/.test(i18n) && /"callScriptTransfer": "Meminta transfer uang ke rekening"/.test(i18n));
  const ccMod = await import("file://" + path.join(ROOT, "src/callcheck.js"));
  const plain = await ccMod.analyzeCall({ number: "081234567890", said: "Tolong transfer Rp 500.000 ke rekening ini ya" }, "id");
  check("p7 plain transfer ask is 30 suspicious (was Safe 0)", plain.verdict.status === "suspicious" && plain.verdict.riskScore === 30, `${plain.verdict.status} ${plain.verdict.riskScore}`);
  const pinned = await ccMod.analyzeCall({ number: "081234567890", said: "Saya dari bank BCA, akun Anda akan diblokir, kirim kode OTP sekarang." }, "en");
  check("p7b kirim kode OTP case still pinned 85 (transfer pattern does not match it)", pinned.verdict.riskScore === 85, `${pinned.verdict.riskScore}`);

  // (p8) Empty voice recording shows an error instead of silence.
  check("p8 onstop shows callNoSpeech when the recorded blob is empty", /if \(blob\.size > 0\) scoreTranscribedCall\(blob\);\s*\n\s*else showCallAudioError\(t\("callNoSpeech", lang\)\)/.test(mainJs));

  // (p9-p10) Stale Playwright expectations fixed to current decisions.
  check("p9 flows-verify expects APK local 75 scam (not 38 suspicious)", /apk: \{ status: "scam", score: 75 \}/g.test(flows) && (flows.match(/apk: \{ status: "scam", score: 75 \}/g) || []).length === 2);
  check("p10 full-verify + rapi-verify assert sticky header, not static", /header position sticky/.test(full) && /header computed position is sticky/.test(rapi) && !/position === "static"/.test(full) && !/position === "static"/.test(rapi));

  // (p11) 7-day chart honesty (read-only check; chart code is the parent's).
  check("p11 chart counts come from local history (lastHistory), no hardcoded counts", /lastHistory\.filter\(\(e\) => \{/.test(mainJs) && !/0,0,0,0,0,0,2/.test(mainJs) && !/0,0,0,0,0,0,2/.test(ai) && !/0,0,0,0,0,0,2/.test(callcheck));
  check("p11b young-domain warning label exists (domainNew)", /"domainNew": "New domain — be careful"/.test(i18n) && /"domainNew": "Domain baru — hati-hati"/.test(i18n));

  // (p12) i18n parity still holds with the new keys.
  try {
    execFileSync(process.execPath, ["tests/i18n-parity-audit.cjs"], { cwd: ROOT, stdio: "pipe" });
    check("p12 i18n parity audit passes", true);
  } catch (err) {
    check("p12 i18n parity audit passes", false, String(err.stdout || err.message).slice(0, 200));
  }

  // (q1) Missing "reportCount" key (shown raw to users when cloud is
  // on and reports exist) — now exists in both languages.
  const i18nMod = await import("file://" + path.join(ROOT, "src/i18n.js"));
  check("q1 reportCount key exists EN+ID", i18nMod.t("reportCount", "en", { n: 3 }) !== "reportCount" && i18nMod.t("reportCount", "id", { n: 3 }) !== "reportCount", i18nMod.t("reportCount", "id", { n: 3 }));
  check("q1b reportCountFailed key exists EN+ID", i18nMod.t("reportCountFailed", "en") !== "reportCountFailed" && i18nMod.t("reportCountFailed", "id") !== "reportCountFailed");

  // (q2) File-name check: the word "apk" in a name is not an APK file.
  const fcMod = await import("file://" + path.join(ROOT, "src/filecheck.js"));
  const txtApk = fcMod.analyzeFileName("catatan apk rapat.txt");
  check("q2 'catatan apk rapat.txt' is NOT apk/high", txtApk.kind !== "apk" && txtApk.level !== "high", `${txtApk.kind}/${txtApk.level}`);
  const realApk = fcMod.analyzeFileName("undangan-nikah.apk");
  check("q2b 'undangan-nikah.apk' is still apk/high", realApk.kind === "apk" && realApk.level === "high", `${realApk.kind}/${realApk.level}`);
  check("q2c no bare \\bapk\\b word-match left in filecheck.js", !/\\bapk\\b/.test(read("src/filecheck.js")));

  // (q3) Number-only call summary no longer claims "no reports" when
  // the lookup FAILED (21 Nov: the lookup always runs now, so the
  // only honest "unknown" is a failed lookup, not a skipped one).
  // (ccMod already imported in the p-section.)
  const numOnlyId = await ccMod.analyzeCall({ number: "081234567890", said: "" }, "id");
  check("q3 number-only summary says the database could not be reached (ID)", /tidak bisa dijangkau/.test(numOnlyId.verdict.summary || ""), (numOnlyId.verdict.summary || "").slice(0, 120));
  const numOnlyEn = await ccMod.analyzeCall({ number: "081234567890", said: "" }, "en");
  check("q3b same in EN", /could not be reached/.test(numOnlyEn.verdict.summary || ""), (numOnlyEn.verdict.summary || "").slice(0, 120));
  check("q3c callcheck has all three summary branches", /callNumberOnlyReported/.test(callcheck) && /callNumberOnlyUnchecked/.test(callcheck) && /callNumberOnlySummary/.test(callcheck));

  // (q4-q7) Copy honesty: account hint says hashed lookup (21 Nov:
  // the lookup always runs), how-it-works says code rules first
  // (not on-device AI), faq2A qualified, hardcoded callHint in
  // index.html matches the ungated i18n text.
  check("q4 accountCheckHint says hashed lookup, not gated (21 Nov)", /pencarian hash/.test(i18n) && /hashed lookup/.test(i18n) && !/hanya dicek bila riwayat cloud aktif/.test(i18n) && !/only checked when cloud history is on/.test(i18n));
  check("q5 how2Text + checkerHint say code rules first, not on-device AI", /aturan kode di perangkat Anda/.test(i18n) && /code rules on your device/.test(i18n) && !/AI di perangkat Anda menjawab dulu/.test(i18n) && !/AI on your device answers first/.test(i18n));
  check("q6 faq2A starts 'By default' / 'Secara default'", /"faq2A": "By default,/.test(i18n) && /"faq2A": "Secara default,/.test(i18n));
  check("q7 hardcoded callHint in index.html matches the ungated i18n text", /pencarian hash/.test(html) && !/hanya dicek bila riwayat cloud aktif/.test(html));

  // (q8-q9) Failed report lookups say so; upload-file check looks
  // the hash count up ungated now (21 Nov: no reportCountSkipped
  // anywhere any more).
  check("q8 reportCountFailed shown in all 4 lookup spots", (mainJs.match(/reportCountFailed/g) || []).length >= 4, `${(mainJs.match(/reportCountFailed/g) || []).length} spots`);
  check("q9 upload-file branch looks up the hash count ungated (21 Nov)", /if \(info\.sha256\) \{\s*\n\s*const n = await getReportCount\(info\.sha256\);/.test(mainJs) && !/reportCountSkipped/.test(mainJs));

  // (q10-q12) Senior-mode hero title, CSV BOM, OJK link.
  const css = read("src/styles.css");
  check("q10 senior-mode hero title is 2.6rem (not smaller than default)", /body\.senior-mode \.hero-title \{ font-size: 2\.6rem; \}/.test(css));
  check("q11 CSV export starts with a UTF-8 BOM", /new Blob\(\["\\uFEFF" \+ \[header/.test(mainJs));
  const contacts = read("src/contacts.js");
  check("q12 OJK contact links to the IASC report form + renderContacts renders it", /url: "https:\/\/iasc\.ojk\.go\.id\/Guest\/LaporanV2"/.test(contacts) && /c\.url \? ` <a href=/.test(mainJs));

  // (q13) Every static t("...") literal + data-i18n value used in code
  // must resolve (t() returns the raw key when missing — that is how
  // the "reportCount" bug shipped). Dynamic keys are skipped by
  // construction: only pure string literals are collected.
  const usedKeys = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".js"))) {
    const src = read("src/" + f);
    // NB: the lookbehind excludes identifiers ending in "t" (import(,
    // charAt(, test() ...) — only the bare t() translator counts.
    for (const m of src.matchAll(/(?<![A-Za-z0-9_$])t\(\s*"([^"]+)"\s*[,)]/g)) usedKeys.add(m[1]);
    for (const m of src.matchAll(/(?<![A-Za-z0-9_$])t\(\s*'([^']+)'\s*[,)]/g)) usedKeys.add(m[1]);
  }
  for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) usedKeys.add(m[1]);
  const missingKeys = [...usedKeys].filter((k) => i18nMod.t(k, "en") === k && i18nMod.t(k, "id") === k);
  check("q13 all used i18n keys resolve (no raw key shown to users)", missingKeys.length === 0, missingKeys.slice(0, 5).join(", ") || `${usedKeys.size} keys checked`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) {
    console.log("FAILED: " + failed.map((r) => r.name).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("VERIFY SCRIPT ERROR:", err);
  process.exit(1);
});
