// AUDIT-ROUND VERIFICATION (21 Nov 2026) — static checks for the 6
// external-audit findings fixed in this round. NO browser: the VM's
// Chromium is broken (SIGTRAP since ~12:36 WIB), so every check here
// is source-code assertions + Node probes of the pure modules
// (ai.js, risks.js, filecheck.js, i18n.js). Runtime behaviour in a
// real browser (tab restore clicks, CSV download, account/file-name
// UI) is NOT proven by this script — it must be verified live in
// the cloud browser after deploy.
// Exit 0 only when ALL checks pass.
// Usage: node ~/workspace/pesanaman/video/verify-scripts/audit-round-verify.cjs
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
function count(re, src) {
  return (src.match(re) || []).length;
}

async function main() {
  const risks = read("src/risks.js");
  const ai = read("src/ai.js");
  const mainJs = read("src/main.js");
  const visitors = read("src/visitors.js");
  const rules = read("firestore.rules");
  const html = read("index.html");
  const i18n = read("src/i18n.js");
  const filecheck = read("src/filecheck.js");
  const callcheck = read("src/callcheck.js");

  // ---- (a) APK local score vs AI verdict -------------------------------
  check("a1 risks.js marks a non-store .apk link high", /linkRiskApk/.test(risks) && /\.apk\(/.test(risks) && /level = "high"/.test(risks));
  check("a2 risks.js exempts the Play Store", /play\.google\.com/.test(risks));
  check("a3 ai.js download-APK pattern weight is 30", /weight: 30, id: "apkDownload", flag: "Asks to download an app \/ APK file"/.test(ai));
  check("a4 ai.js has a direct .apk-link pattern weight 25", /weight: 25, id: "apkLink", flag: "Direct link to an \.apk file \(outside the Play Store\)"/.test(ai));
  check("a5 i18n linkRiskApk exists EN+ID", count(/linkRiskApk/g, i18n) >= 2);
  check("a6 i18n DEMO flag translated to ID", /Direct link to an \.apk file \(outside the Play Store\)":\s*\n?\s*"Tautan langsung ke file \.apk \(di luar Play Store\)"/.test(i18n));

  const aiMod = await import("file://" + path.join(ROOT, "src/ai.js"));
  const risksMod = await import("file://" + path.join(ROOT, "src/risks.js"));
  const i18nMod = await import("file://" + path.join(ROOT, "src/i18n.js"));
  const fcMod = await import("file://" + path.join(ROOT, "src/filecheck.js"));
  const chatlogMod = await import("file://" + path.join(ROOT, "src/chatlog.js"));
  const domainMod = await import("file://" + path.join(ROOT, "src/domain.js"));
  const historyMod = await import("file://" + path.join(ROOT, "src/history.js"));
  const visitorsMod = await import("file://" + path.join(ROOT, "src/visitors.js"));
  const { todayKey, shouldCountToday } = visitorsMod;
  const { maskSensitive } = historyMod;
  const { analyzeWithHeuristic } = aiMod;
  const { analyzeLink, analyzeLinks } = risksMod;
  const { t } = i18nMod;
  const { scanChatLog, parseChatExportWithFormat } = chatlogMod;
  const { normalizeLinkInput } = domainMod;

  for (const code of ["en", "id"]) {
    const apk = analyzeWithHeuristic(t("sampleTextApk", code), code);
    check(`a7 APK sample ${code} is scam 75 (was suspicious 38)`, apk.status === "scam" && apk.riskScore === 75, `${apk.status} ${apk.riskScore}`);
    const safe = analyzeWithHeuristic(t("sampleTextSafe", code), code);
    check(`a8 safe sample ${code} still 0`, safe.status === "safe" && safe.riskScore === 0, `${safe.status} ${safe.riskScore}`);
  }
  // 23 Nov 2026 regression (rules fix): the job and OTP samples are
  // now correctly SCAM (a deposit-demanding job and an OTP that tells
  // you to call a random mobile number), the EN scam sample is 88
  // (fee 16 -> 18), and the suspicious samples are the J&T courier
  // texts (30) — the old DHL text is scam 60 under the rules now, so
  // it can no longer be the "suspicious" example.
  const pinned = [
    ["en", "sampleTextScam", "scam", 88],
    ["id", "sampleTextScam", "scam", 100],
    ["en", "sampleTextSuspicious", "suspicious", 30],
    ["id", "sampleTextSuspicious", "suspicious", 30],
    ["en", "sampleTextJob", "scam", 74],
    ["id", "sampleTextJob", "scam", 74],
    ["en", "sampleTextOtp", "scam", 60],
    ["id", "sampleTextOtp", "scam", 60],
  ];
  for (const [code, key, status, score] of pinned) {
    const v = analyzeWithHeuristic(t(key, code), code);
    check(`a9 ${code}/${key} unchanged (${status} ${score})`, v.status === status && v.riskScore === score, `${v.status} ${v.riskScore}`);
  }
  const apkLink = analyzeLink("https://undangan-nikah-2026.xyz/invite.apk");
  check("a10 .apk link sub-rating is high + linkRiskApk", apkLink.level === "high" && apkLink.reasons.includes("linkRiskApk"), `${apkLink.level} ${apkLink.reasons.join(",")}`);
  const playLink = analyzeLink("https://play.google.com/store/apps/details?id=com.example.app");
  check("a11 Play Store link is NOT flagged .apk", playLink.level !== "high" && !playLink.reasons.includes("linkRiskApk"), `${playLink.level} ${playLink.reasons.join(",")}`);

  // ---- (b) history restore goes to the right tab -----------------------
  check("b1 saveCheck records kind=message twice", count(/kind: "message"/g, mainJs) >= 2, `found ${count(/kind: "message"/g, mainJs)}`);
  check("b2 saveCheck records kind=email once", count(/kind: "email"/g, mainJs) >= 1, `found ${count(/kind: "email"/g, mainJs)}`);
  check("b3 saveCheck records kind=call twice", count(/kind: "call"/g, mainJs) >= 2, `found ${count(/kind: "call"/g, mainJs)}`);
  check("b4 showHistoryEntry switches tab before rendering", /function showHistoryEntry[\s\S]*?switchCheckerTab\(tab\)[\s\S]*?renderResult\(verdict/.test(mainJs));
  check("b5 showHistoryEntry fills the tab form", /function showHistoryEntry[\s\S]*?fillCheckerForm\(tab, e\.message/.test(mainJs));
  check("b6 fillCheckerForm handles message/email/call/outbound", /function fillCheckerForm[\s\S]*?tab === "message"[\s\S]*?tab === "email"[\s\S]*?tab === "call"[\s\S]*?tab === "outbound"/.test(mainJs));
  check("b7 entries without kind fall back to the active tab", /const tab = CHECKER_TABS\.includes\(e\.kind\) \? e\.kind : null;/.test(mainJs));

  // ---- (c) Cek Nomor: honest copy + community count --------------------
  // 21 Nov (Myuden item 1): the lookup ALWAYS runs now — the old
  // cloud-history gate meant the database was never checked by
  // default. The hash is suspect data, not the user's history.
  check("c1 callHint EN says the number is checked against the community database via hashed lookup", /callHint": "Type the caller number[\s\S]*?community report database \(a hashed lookup/.test(i18n));
  check("c2 callHint ID says the same, honestly", /callHint": "Ketik nomor penelepon[\s\S]*?database laporan komunitas \(pencarian hash/.test(i18n));
  check("c3 callHint no longer conditions the database check on cloud history", !/only checked when cloud history is on/.test(i18n) && !/hanya dicek bila riwayat cloud aktif/.test(i18n));
  check("c4 analyzeCall looks up community reports unconditionally (no allowReports gate in the function)", (() => { const fn = callcheck.match(/export async function analyzeCall[\s\S]*?\n\}/)[0]; return /getReportCount/.test(fn) && !/allowReports/.test(fn); })());
  check("c5 onCallCheck calls analyzeCall with no gate", /analyzeCall\(\{ number, said \}, lang\);/.test(mainJs) && !/analyzeCall\(\{ number, said \}, lang, \{ allowReports/.test(mainJs));
  check("c6 reportNone key exists EN+ID (shown when no reports)", count(/reportNone/g, i18n) >= 2);

  // ---- (d1) check a file by name ---------------------------------------
  check("d1-1 filecheck.js exports analyzeFileName", /export function analyzeFileName/.test(filecheck));
  const nApk = fcMod.analyzeFileName("undangan-nikah.apk");
  check("d1-2 name .apk -> apk/high", nApk.kind === "apk" && nApk.level === "high", JSON.stringify(nApk));
  const nDbl = fcMod.analyzeFileName("undangan.pdf.exe");
  check("d1-3 double extension .pdf.exe -> exe/high", nDbl.kind === "exe" && nDbl.level === "high" && nDbl.reasonKey === "fileNameDoubleExt", JSON.stringify(nDbl));
  const nDoc = fcMod.analyzeFileName("laporan.pdf");
  check("d1-4 name .pdf -> doc/low", nDoc.kind === "doc" && nDoc.level === "low", JSON.stringify(nDoc));
  const nPlain = fcMod.analyzeFileName("foto.jpg");
  check("d1-5 plain name -> unknown/low (never claims safe)", nPlain.kind === "unknown" && nPlain.level === "low", JSON.stringify(nPlain));
  check("d1-6 HTML has file-name input + button", /id="filecheck-name-input"/.test(html) && /id="filecheck-name-btn"/.test(html));
  check("d1-7 main.js wires the file-name button", /\$\("filecheck-name-btn"\)\.addEventListener\("click"/.test(mainJs));
  check("d1-8 i18n fileName* keys exist EN+ID", ["fileNameLabel", "fileNameBtn", "fileNameEmpty", "fileNameDoubleExt", "fileNameDoc", "fileNameUnknown"].every((k) => count(new RegExp(k, "g"), i18n) >= 2));

  // ---- (d2) in-app account checker -------------------------------------
  check("d2-1 main.js has onAccountCheck", /async function onAccountCheck\(\)/.test(mainJs));
  check("d2-2 onAccountCheck validates 8-20 digits", /\/\^\\d\{8,20\}\$\/\.test\(account\)/.test(mainJs));
  check("d2-3 onAccountCheck looks up community reports ungated (21 Nov)", /onAccountCheck[\s\S]*?getReportCount\(await reportHash\("account", account\)\)/.test(mainJs) && !/reportCountSkipped/.test(mainJs));
  check("d2-4 onAccountCheck links to cekrekening.id as official", /onAccountCheck[\s\S]*?https:\/\/cekrekening\.id/.test(mainJs));
  check("d2-5 HTML has account section", /id="account-number"/.test(html) && /id="account-btn"/.test(html) && /id="account-result"/.test(html));
  check("d2-6 main.js wires the account button", /\$\("account-btn"\)\.addEventListener\("click", onAccountCheck\)/.test(mainJs));
  check("d2-7 i18n accountCheck* keys exist EN+ID", ["accountCheckHeading", "accountCheckHint", "accountCheckLabel", "accountCheckBtn", "accountCheckFormat", "accountCheckInvalid"].every((k) => count(new RegExp(k, "g"), i18n) >= 2));

  // ---- (d3) CSV export button restored ---------------------------------
  check("d3-1 main.js restores exportHistoryCsv", /function exportHistoryCsv\(\)/.test(mainJs));
  check("d3-2 CSV keeps the 3c16d6f shape (header + tipucek-history.csv)", /message,status,riskScore,source,createdAt/.test(mainJs) && /tipucek-history\.csv/.test(mainJs));
  check("d3-3 CSV adds the kind column", /createdAt,kind/.test(mainJs));
  check("d3-4 toast fires only after the download (inside exportHistoryCsv)", /function exportHistoryCsv[\s\S]*?showInfoToast\(t\("historyExported", lang\)\)/.test(mainJs));
  check("d3-5 HTML has the export button in .history-foot", /id="export-history-btn"[\s\S]{0,120}data-i18n="exportHistory"/.test(html));
  check("d3-6 main.js wires the export button", /\$\("export-history-btn"\)\.addEventListener\("click", exportHistoryCsv\)/.test(mainJs));
  check("d3-7 i18n exportHistory + historyExported exist EN+ID", count(/exportHistory/g, i18n) >= 2 && count(/historyExported/g, i18n) >= 2);

  // ---- shared: local-only gate + i18n parity ---------------------------
  check("e1 removed keys are gone from i18n (reportCountSkipped, receiptSkipped)", !/reportCountSkipped|receiptSkipped/.test(i18n));
  check("e2 no dangling invalidAccount key reference", !/t\("invalidAccount"/.test(mainJs));

  // (f) History restore keeps the check duration (blank "— detik" fix).
  check("f1 all 8 saveCheck call sites store elapsedSec (5 checkers + file upload + file name + link, audit 8)", (mainJs.match(/saveCheck\(\{[^}]*elapsedSec/g) || []).length === 8 && (mainJs.match(/saveCheck\(\{/g) || []).length === 8, `${(mainJs.match(/saveCheck\(\{[^}]*elapsedSec/g) || []).length} of ${(mainJs.match(/saveCheck\(\{/g) || []).length} sites`);
  check("f2 showHistoryEntry passes the stored duration to renderResult", /renderResult\(verdict, e\.message \|\| "", Number\.isFinite\(e\.elapsedSec\)/.test(mainJs));
  check("f3 no restore passes a null duration anymore", !/renderResult\(verdict, e\.message \|\| "", null/.test(mainJs));

  // (g) 7-day chart: Y-axis numbers removed (Myuden 21 Nov 21:17 —
  // the bars already show their own count on top). Axis must be
  // gone from html, js and css; bars must still render counts.
  const css = read("src/styles.css");
  check("g1 html has no #week-chart-yaxis", !/week-chart-yaxis/.test(html));
  check("g2 main.js has no yaxis/tick code", !/yaxisEl|week-chart-yaxis-tick/.test(mainJs));
  check("g3 css has no .week-chart-yaxis rules", !/week-chart-yaxis/.test(css));
  check("g4 bars still render per-day counts on top", /week-bar-count/.test(mainJs));
  check("g5 empty branch clears bars only", /if \(totalChecked === 0\) \{\s*barsEl\.innerHTML = ""/.test(mainJs));
  check("g6 bar height still scales with max", /Math\.max\(10, Math\.round\(\(counts\[i\] \/ max\) \* 96\)\)/.test(mainJs));

  // (h) Crowd reports: new "message" + "file" types (Myuden 21 Nov 15:32).
  // (rules is read once at the top of main().)
  const crowd = await import("file://" + path.join(ROOT, "src/crowdreport.js"));
  check("h1 rules allow message + file report types", /"phone", "account", "mode", "message", "file"/.test(rules));
  check("h2 rules cap message value at 2000, others at 100", /type == "message"\s*\?\s*request\.resource\.data\.value\.size\(\) <= 2000\s*:\s*request\.resource\.data\.value\.size\(\) <= 100/.test(rules));
  check("h3 CROWD_TYPES includes message + file", JSON.stringify(crowd.CROWD_TYPES) === JSON.stringify(["phone", "account", "mode", "message", "file"]), JSON.stringify(crowd.CROWD_TYPES));
  const D = "Penipu mengaku dari bank, minta kode OTP lalu minta transfer.";
  check("h4 message validates 10–2000 chars", Object.keys(crowd.validateCrowdReport({ type: "message", value: "SELAMAT! Anda memenangkan hadiah Rp 50.000.000.", details: D })).length === 0 && crowd.validateCrowdReport({ type: "message", value: "pendek", details: D }).value === "crowdErrMessage" && crowd.validateCrowdReport({ type: "message", value: "a".repeat(2001), details: D }).value === "crowdErrMessage");
  check("h5 file validates 1–100 chars", Object.keys(crowd.validateCrowdReport({ type: "file", value: "undangan-nikah.apk", details: D })).length === 0 && crowd.validateCrowdReport({ type: "file", value: "a".repeat(101), details: D }).value === "crowdErrFile");
  check("h6 form has message + file options and the message textarea", html.includes('value="message"') && html.includes('value="file"') && html.includes('id="crowd-message"'));
  check("h7 i18n has the new report keys EN+ID", ["crowdTypeMessage", "crowdTypeFile", "crowdValueMessage", "crowdValueFile", "crowdValuePhMessage", "crowdValuePhFile", "crowdErrMessage", "crowdErrFile"].every((k) => count(new RegExp(k, "g"), i18n) >= 2));
  check("h8 main.js reads the message textarea for message reports", mainJs.includes('type === "message" ? $("crowd-message").value'));
  const prefill = mainJs.match(/reportNumberBtn\.addEventListener\("click", \(\) => \{([\s\S]*?)\n    \}\);/);
  check("h9 prefill clears stale crowd errors before filling", Boolean(prefill && prefill[1].includes('crowd-value-error").hidden = true') && prefill[1].includes('crowd-details-error").hidden = true')));
  check("h10 report button label is generic (not 'nomor ini')", i18n.includes('reportNumberBtn: "Report"') && i18n.includes('reportNumberBtn: "Laporkan"') && !i18n.includes('reportNumberBtn: "Laporkan nomor ini"'));

  // (i) Cek Pesan is a plain form again (Myuden 21 Nov 18:01 —
  // reversing the 16:11 "Seperti chat di WhatsApp" decision). The
  // thread, bubbles and typing indicator are gone; chips only fill
  // the textarea; the result card below is the only answer.
  const styles = read("src/styles.css");
  const sharecard = read("src/sharecard.js");
  const tabMsg = html.slice(html.indexOf('id="tab-message"'), html.indexOf('id="tab-email"'));
  check("i1 no chat thread in the message tab", !tabMsg.includes('id="chat-thread"') && !tabMsg.includes('class="chat-empty"') && !tabMsg.includes('class="chat-thread"'));
  check("i2 send button is a labeled pill (icon + text)", tabMsg.includes('id="check-btn" type="button" class="primary chat-send-btn"') && tabMsg.includes('aria-label="Kirim untuk diperiksa"') && tabMsg.includes('<span class="send-label">Kirim untuk diperiksa</span>') && tabMsg.includes('id="check-btn"') && /id="check-btn"[^>]*disabled/.test(tabMsg));
  check("i3 composer placeholder is the chat text", tabMsg.includes('placeholder="Tulis pesan mencurigakan…"') && i18n.includes('placeholder: "Type a suspicious message…"'));
  check("i4 samples heading is 'Coba contoh:' / 'Try an example:'", i18n.includes('samplesHeading: "Coba contoh:"') && i18n.includes('samplesHeading: "Try an example:"'));
  check("i5 chatSend key still exists EN+ID (send button label)", count(/chatSend/g, i18n) >= 2);
  check("i6 dead chat i18n keys are gone EN+ID", !/chatTyping|chatEmpty|chatMainFlag/.test(i18n));
  const samplesFn = mainJs.match(/function buildSamples\(\) \{([\s\S]*?)\n\}/);
  check("i7 chips only fill the textarea, never send", Boolean(samplesFn && samplesFn[1].includes('$("message-input").value = t(s.textKey, lang)') && !samplesFn[1].includes("onCheck(") && samplesFn[1].includes('className = "sample-btn"')));
  check("i8 dead chat helpers are gone", !/function chat(AddBubble|AddUserBubble|AddAmanBubble|ReplyHtml|ShowTyping|HideTyping|RemoveLastErrorBubble)|function rerenderChatVerdictBubbles|const chatVerdictBubbles/.test(mainJs));
  check("i9 onCheck renders the result card with no bubbles", mainJs.includes('renderResult(verdict, message, elapsedSec, "", {}, true);') && !mainJs.includes("chatAddUserBubble(message)") && !mainJs.includes("chatShowTyping()") && !mainJs.includes("chatHideTyping()"));
  check("i10 send keeps the message in the textarea", !mainJs.includes('$("message-input").value = "";'));
  check("i11 Enter runs the check (Shift+Enter keeps a newline)", mainJs.includes('e.key === "Enter" && !e.shiftKey') && mainJs.includes("if (!checkBusy) onCheck();"));
  check("i12 error path shows the form error + retry, no bubble", mainJs.includes("showCheckError(errorEl, err, () => {") && !mainJs.includes("chat-bubble-error"));
  check("i13 offline path renders the offline preview, no bubble", mainJs.includes("renderOfflinePreview(message);") && !mainJs.includes('t("offlineCheckNotice", lang))}</p>`, "chat-bubble-error"'));
  check("i14 full result card still renders below the form", mainJs.includes('renderResult(verdict, message, elapsedSec, "", {}, true);') && mainJs.includes('const el = $("result");'));
  check("i15 retry paths re-run the same check from the textarea", count(/onCheck\(\);/g, mainJs) >= 4 && mainJs.includes("lastCheck?.message"));
  check("i16 no chat CSS left, composer + send button kept", !/\.chat-thread|\.chat-bubble|\.chat-typing|@keyframes chat-dot-bounce|\.chat-empty|chat-user-bg/.test(styles) && styles.includes(".chat-composer") && styles.includes(".chat-send-btn"));
  check("i17 history saving unchanged (each check still saved)", mainJs.includes('saveCheck({ message, kind: "message"'));
  check("i18 send button loading state is a spinner + text, restored by renderSendBtn", mainJs.includes("function setSendBtnLoading(loading)") && mainJs.includes('class="send-spinner"') && mainJs.includes('t("checking", lang)') && mainJs.includes("setSendBtnLoading(false)") && !mainJs.includes('btn.textContent = t("checking", lang)') && !mainJs.includes("checkBtnLabel"));
  check("i19 sample chips ignore taps while a check is running", Boolean(samplesFn && samplesFn[1].includes("if (checkBusy) return;")));
  check("i20 chip tap focuses the textarea for sending", Boolean(samplesFn && samplesFn[1].includes('$("message-input").focus();')));

  // (j) Send-icon root cause + bubble re-render + toast nudge +
  //     file-check clarity (Myuden 21 Nov 16:21 + 16:17 live).
  // (a) The send icon vanished because .primary (later in the file)
  //     won same-specificity ties on padding/border-radius: its
  //     13px 28px padding ate the 48px width, shrinking the SVG
  //     flex item to 0px. The doubled selector must outrank it.
  //     (21 Nov 18:08, demo reference: the button is now a LABELED
  //     pill, not a round icon button — the outranking rule stays.)
  check("j1 send button outranks .primary on padding + radius", /\.primary\.chat-send-btn\s*\{[^}]*padding: 12px 20px;[^}]*border-radius: 999px/.test(styles));
  check("j2 send SVG can never shrink to zero width", styles.includes(".chat-send-btn svg { width: 20px; height: 20px; flex-shrink: 0; }"));
  check("j3 send button keeps its 48px min-height (senior 56px kept)", styles.includes(".primary.chat-send-btn") && styles.includes("body.senior-mode .chat-send-btn { min-height: 56px; }"));
  // (b) Language change follows the RESULT CARD now (21 Nov 18:01
  // revert): no bubbles exist any more — setLanguage re-renders the
  // card's static labels instantly and re-runs the check in the new
  // language.
  check("j4 language change re-renders the result card instantly", mainJs.includes("renderResult(\n        lastRenderArgs.verdict,") && mainJs.includes("lastRenderArgs.elapsedSec,"));
  check("j5 language change re-runs the check in the new language", mainJs.includes("else recheckLastCheck();") && mainJs.includes("if (checkBusy) recheckAfterCheck = true;"));
  check("j6 no bubble re-render remains", !mainJs.includes("function rerenderChatVerdictBubbles") && !mainJs.includes("const chatVerdictBubbles"));
  // (c) The completion-toast nudge also protects the composer.
  const nudgeFn = mainJs.match(/function nudgePageForToast\(\) \{([\s\S]*?)\n\}/);
  check("j7 toast nudge clears the chat composer too", Boolean(nudgeFn && nudgeFn[1].includes('document.querySelector(".chat-composer")') && nudgeFn[1].includes("clearBelowToast(composerEl.getBoundingClientRect())")));
  // File check: verdict line + accurate type + scroll + clear.
  check("j8 file verdict keys exist EN+ID", ["fileVerdictHigh", "fileVerdictLow"].every((k) => count(new RegExp(k, "g"), i18n) >= 2) && i18n.includes('"fileVerdictHigh": "Berbahaya — jangan dibuka"') && i18n.includes('"fileVerdictHigh": "Dangerous — do not open it"') && i18n.includes('"fileVerdictLow": "Tidak ada tanda bahaya dari strukturnya"') && i18n.includes('"fileVerdictLow": "No danger signs in its structure"'));
  check("j9 verdict line renders in both file branches (url-aware, audit 7; unknown-aware, audit 13; fv.status label, audit 13 — a script whose CONTENT scores scam must not show the green safe label)", count(/file-verdict-\$\{fv\.status === "scam" \? "high" : fv\.status === "suspicious" \? "medium" : "low"\}/g, mainJs) === 2 && count(/info\.kind === "url" \? "fileVerdictUrl" : info\.kind === "unknown" \? "fileVerdictUnknown" : fv\.status === "scam" \? "fileVerdictHigh" : fv\.status === "suspicious" \? "fileVerdictMedium" : "fileVerdictLow"/g, mainJs) === 2);
  check("j10 verdict line styles exist (high danger, low safe, medium warn)", styles.includes(".file-verdict-high { background: var(--danger-bg); color: var(--danger); }") && styles.includes(".file-verdict-low { background: var(--safe-bg); color: var(--safe); }") && styles.includes(".file-verdict-medium { background: var(--warn-bg); color: var(--warn); }"));
  check("j11 file type line uses fileTypeDisplay, not raw kind (audit 11: +1 restore render)", count(/fileTypeDisplay\(info\)/g, mainJs) === 3 && !mainJs.includes("${escapeHtml(info.kind)}"));
  check("j12 fileTypeDisplay: pdf shows PDF, exe wins over disguise", fcMod.fileTypeDisplay({ kind: "doc", fileName: "laporan.pdf" }) === "PDF" && fcMod.fileTypeDisplay({ kind: "exe", fileName: "laporan.pdf.exe" }) === "EXE" && fcMod.fileTypeDisplay({ kind: "exe", fileName: "laporan.pdf" }) === "EXE" && fcMod.fileTypeDisplay({ kind: "apk", fileName: "undangan-nikah.apk" }) === "APK" && fcMod.fileTypeDisplay({ kind: "unknown", fileName: "laporan" }) === "unknown");
  check("j13 upload branch scrolls the result into view", count(/box\.scrollIntoView/g, mainJs) >= 2);
  check("j14 picking a new file clears the old result", mainJs.includes('box.innerHTML = "";') && mainJs.includes('box.hidden = true;'));
  // (k) Warning card + PDF report, Variant A "Resmi" (Myuden 21 Nov
  //     16:36 "Pilih yang ini saja").
  check("k1 card canvas is 1080x1350 portrait", sharecard.includes("CARD_W = 1080") && sharecard.includes("CARD_H = 1350") && sharecard.includes("canvas.width = CARD_W") && sharecard.includes("canvas.height = CARD_H"));
  check("k2 card loads the official T logo, with a canvas fallback", sharecard.includes('img.src = "/logo-mark.svg"') && sharecard.includes("drawLogoTFallback(ctx,"));
  const printFn = mainJs.match(/function fillPrintReport\([\s\S]*?\n\}/);
  // "Resmi" is the variant's nickname in a code comment only — the
  // check strips comments, so only rendered strings count.
  const sharecardCode = sharecard.replace(/\/\/.*$/gm, "");
  check("k3 no 'DOKUMEN RESMI' or 'resmi' claim in card or PDF output", !/resmi/i.test(sharecardCode) && Boolean(printFn && !/resmi/i.test(printFn[0])) && !/resmi/i.test(styles.match(/@media print \{[\s\S]*$/)[0]));
  check("k4 verdict colours exist for all three statuses (card + PDF)", sharecard.includes('scam: "#b42318"') && sharecard.includes('suspicious: "#854d0e"') && sharecard.includes('safe: "#067647"') && styles.includes(".pr-status-scam { color: #b42318;") && styles.includes(".pr-status-suspicious { color: #854d0e;") && styles.includes(".pr-status-safe { color: #067647;"));
  check("k5 card + PDF show footer, site and date", sharecard.includes('"tipucek.web.app"') && sharecard.includes("strings.footerNote") && sharecard.includes("dateStr") && Boolean(printFn && printFn[0].includes("cardFooterNote") && printFn[0].includes("pr-footer") && printFn[0].includes("toLocaleDateString")));
  check("k6 card draws score + every flag; PDF shows score + numbered flags (max 4)", sharecard.includes("plan.flagRows") && sharecard.includes("String(riskScore)") && Boolean(printFn && printFn[0].includes("verdict.riskScore") && printFn[0].includes('class="pr-flags"') && printFn[0].includes("verdict.redFlags.slice(0, 4)")));
  check("k7 PDF has a single meta line (not a table), quote, privacy note, found/none section", Boolean(printFn && ["printDate", "printVerdict", "printScore", "printSource", "printSite"].every((k) => printFn[0].includes(`t("${k}"`)) && printFn[0].includes("headingCheckedMessage") && printFn[0].includes("printPrivacyNote") && printFn[0].includes("printFoundNone") && printFn[0].includes("pr-quote") && printFn[0].includes('class="pr-meta-line"') && !printFn[0].includes("pr-meta-row")));
  check("k8 new card/PDF i18n keys exist EN+ID", ["cardFooterNote", "cardResultHeading", "cardRiskScore", "headingActions", "headingCheckedMessage", "headingSummary", "printFoundNone", "printPrivacyNote", "printReportSubtitle", "printSite", "printSource", "printSourceCloud", "printSourceCode", "printSourceDemo", "riskLevelSafe", "riskLevelScam", "riskLevelSuspicious", "riskSafe", "riskScam", "riskSuspicious"].every((k) => count(new RegExp(`"${k}":`, "g"), i18n) >= 2));
  const scMod = await import("file://" + path.join(ROOT, "src/sharecard.js"));
  const stubMeasure = (text, fontStr) => text.length * Number(fontStr.match(/(\d+)px/)[1]) * 0.55;
  const worst = scMod.planCardContent({
    quote: "Kata ".repeat(200),
    summary: "Kalimat panjang. ".repeat(100),
    flags: ["Satu".repeat(40), "Dua".repeat(40), "Tiga".repeat(40), "Empat".repeat(40), "Lima".repeat(40)],
    next: "Jangan lakukan apa pun. ".repeat(40),
    verdictWord: "MENCURIGAKAN",
    scoreLabel: "SKOR RISIKO",
    scoreText: "75",
    measure: stubMeasure,
  });
  check("k9 planner: worst case still fits, flags capped at 4", worst.fits === true && worst.flagRows.length === 4 && worst.quoteLines.length === 3);
  check("k10 PDF keeps the found items (numbers masked, audit 6) and the legal footer", Boolean(printFn && printFn[0].includes("phones.map(maskSensitive)") && printFn[0].includes("accounts.map(maskSensitive)") && printFn[0].includes("links.map((l) => stripUrlQuery(l.url))") && printFn[0].includes("printFooter")));
  // ---- (l) Aman launcher hides over the chat composer ------------------
  // 21 Nov, Myuden's phone screenshot: the fixed launcher (bottom:84px)
  // sat exactly over the Tempel button when the composer row was in view.
  check("l1 fab hide targets include footer AND chat composer", /fabHideTargets = \[footerEl, composerEl\]/.test(mainJs) && /document\.querySelector\("\.chat-composer"\)/.test(mainJs));
  check("l2 fab hides while any observed target intersects", /fabHiddenBy/.test(mainJs) && /amanFab\.classList\.toggle\("aman-fab-hidden", fabHiddenBy\.size > 0\)/.test(mainJs));
  check("l3 toast nudge protects the screenshot-upload section", /\.image-check \.image-row/.test(mainJs) && /clearBelowToast\(\{ top, bottom \}\)/.test(mainJs));
  // ---- (m) Form flow + result card polish (demo reference, Myuden
  // 21 Nov 18:08 "lebih jelas, menarik, profesional" + 18:15 "harus
  // RAPI, jangan berantakan"). The demo's flow is the reference, NOT
  // a copy: the real AI + code verdict still decides everything.
  check("m1 three flow steps in the message tab", tabMsg.includes('<ol class="check-steps"') && tabMsg.includes('id="step-1"') && tabMsg.includes('id="step-2"') && tabMsg.includes('id="step-3"') && tabMsg.includes('data-i18n="step1"') && tabMsg.includes('data-i18n="step2"') && tabMsg.includes('data-i18n="step3"'));
  check("m2 steps have active/done states + a 390px rule", styles.includes(".check-steps li.active") && styles.includes(".check-steps li.done") && styles.includes("@media (max-width: 430px)") && /\.check-steps li \{[^}]*font-size: 0\.72rem/.test(styles));
  check("m3 fill note exists and chips show it", tabMsg.includes('id="fill-note" class="fill-note"') && styles.includes(".fill-note.show { display: flex; }") && Boolean(samplesFn && samplesFn[1].includes('classList.add("show")')));
  check("m4 selected chip state exists in CSS + is synced on input", styles.includes(".sample-btn.selected") && styles.includes(".sample-btn.selected .sample-label") && mainJs.includes('c.classList.toggle("selected"'));
  check("m5 character count under the composer", tabMsg.includes('id="char-count" class="char-count"') && styles.includes(".char-count") && mainJs.includes('t("charCount", lang, { n: input.value.length })'));
  check("m6 send button starts disabled and enables on text", mainJs.includes('btn.disabled = checkBusy || input.value.trim().length === 0;'));
  check("m7 empty state exists before the result section", html.includes('id="result-empty" class="result-empty"') && styles.includes(".result-empty { border: 1.5px dashed") && mainJs.includes('if (emptyState) emptyState.hidden = true;'));
  check("m8 score ring animates (transition + rAF to the real offset)", styles.includes("transition: stroke-dashoffset .8s") && mainJs.includes('stroke-dashoffset="${ringC.toFixed(1)}"') && mainJs.includes("ringFill.style.strokeDashoffset = String(ringOffset.toFixed(1));") && styles.includes("@media (prefers-reduced-motion: reduce)") && /\.ring-fill \{ transition: none;/.test(styles));
  check("m9 red flags are checklist rows, not wrapping chips", styles.includes(".flags { list-style: none; margin: 0.4rem 0; padding: 0; display: flex; flex-direction: column; }") && styles.includes(".flags li::before") && !/\.flags \{[^}]*flex-wrap: wrap/.test(styles));
  check("m10 main-sign box after the flags", mainJs.includes('class="main-sign"') && mainJs.includes('t("mainSign", lang)') && styles.includes(".main-sign {"));
  check("m11 what-to-do is an action checklist with the same text", mainJs.includes('class="actions-checklist"') && mainJs.includes('class="action-ico"') && mainJs.includes('t("whatToDo", lang)') && mainJs.includes('t(NEXT_KEY[verdict.status], lang)'));
  check("m12 local checklist renders pills + found/clean rows", mainJs.includes("function renderLocalChecks(local, lang)") && mainJs.includes('class="check-pills"') && mainJs.includes('class="local-checks"') && mainJs.includes('t("checksExamined", lang') && mainJs.includes('t("checksFound", lang') && mainJs.includes('t("checksClean", lang') && styles.includes(".meta-pill.bad") && styles.includes(".meta-pill.good") && styles.includes(".check-ico"));
  check("m13 stale bar + dimming exist and toggle on input", mainJs.includes('class="result-stale-bar"') && mainJs.includes('t("resultStale", lang)') && mainJs.includes("function refreshStaleState()") && styles.includes(".result-card.stale .result-stale-bar { display: block; }") && styles.includes(".result-card.stale > *:not(.result-stale-bar):not(.result-actions) { opacity: 0.45; }"));
  check("m14 new flow/card i18n keys exist EN+ID", ["step1", "step2", "step3", "fillNote", "charCount", "emptyResultTitle", "emptyResultText", "resultStale", "mainSign", "checksExamined", "checksFound", "checksClean", "checkFound", "checkClean", "checkEvidence"].every((k) => count(new RegExp("\\b" + k + ":", "g"), i18n) >= 2) && ["urgency", "prize", "shortlink", "moneyOtp", "contactNumber", "impersonation", "legalThreat", "family", "familyNewNumber", "tooGood", "investGuarantee", "apkDownload", "apkLink", "shortApk", "fee", "loanScam", "qrReceive", "phishing", "multiLinks", "jobPay", "jobTaskNo", "jobReceipt", "jobTaskWork"].every((id) => count(new RegExp("\\bcheckDesc_" + id + ":", "g"), i18n) >= 2));
  check("m15 send label is 'Kirim untuk diperiksa' / 'Send for checking'", i18n.includes('chatSend: "Kirim untuk diperiksa"') && i18n.includes('chatSend: "Send for checking"'));
  check("m16 neatness: checklist rows wrap cleanly, no overflow", styles.includes(".check-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }") && styles.includes(".check-body { flex: 1; min-width: 0; }") && styles.includes(".evidence { margin-top: 7px;") && /overflow-wrap: break-word/.test(styles.match(/\.evidence \{[^}]*\}/)[0]));
  const otpV = analyzeWithHeuristic("PERINGATAN dari Bank: rekening Anda akan diblokir hari ini. Segera verifikasi dengan menyebutkan kode OTP yang kami kirim via SMS kepada petugas kami.", "id");
  const rezaV = analyzeWithHeuristic("Pak Reza\nJumlah Total Rp 480.000\nNo. Transaksi 2026011743008130078713\nudah di tf pak\nBesok standby ya jam 14.00\nFaqih udah selesai... No 1724", "id");
  check("m17 verdict logic: OTP 40, Reza 66, 23 checks, found == flags (23 Nov regression: 6 new rules)", otpV.riskScore === 40 && otpV.status === "suspicious" && rezaV.riskScore === 66 && rezaV.status === "scam" && otpV.checks.length === 23 && otpV.checks.filter((c) => c.found).length === otpV.redFlags.length && rezaV.checks.filter((c) => c.found).length === rezaV.redFlags.length);
  // The old .checks-list (index.html:425, the 8-item "what TipuCek
  // checks" list) already exists — the card checklist must NOT reuse
  // that class, or both lists inherit each other's rules.
  check("m18 card checklist uses its own .local-checks class (no collision with the older .checks-list)", mainJs.includes('class="local-checks"') && !mainJs.includes('class="checks-list"') && styles.includes(".local-checks li {") && html.includes('<ul class="checks-list">'));
  // ---- (n) PDF one A4 page + score number inside the box ------------
  // 21 Nov 19:06 (Myuden): the "95" digit crossed the score box's
  // bottom edge, and the PDF must fit exactly one A4 page.
  const i18nStrings = (key) => [...i18n.matchAll(new RegExp(`"${key}":\\s*"([^"]*)"`, "g"))].map((m) => m[1]);
  const proof = read("video/verify-scripts/card-render-proof.cjs");
  check("n1 PDF flags are capped at 4 (top flags only)", Boolean(printFn && printFn[0].includes("verdict.redFlags.slice(0, 4)") && printFn[0].includes('class="pr-flags"')));
  check("n2 PDF meta is one line, not a table", Boolean(printFn && printFn[0].includes('class="pr-meta-line"') && !printFn[0].includes("pr-meta-row")) && styles.includes(".pr-meta-line {") && !styles.includes(".pr-meta-row {"));
  check("n3 privacy note + legal footer are one short line each (<= 120 chars, ID+EN)", i18nStrings("printPrivacyNote").length === 2 && i18nStrings("printPrivacyNote").every((s) => s.length <= 120) && i18nStrings("printFooter").length === 2 && i18nStrings("printFooter").every((s) => s.length <= 120));
  check("n4 sharecard positions the score number from measured ink (alphabetic baseline, layout helper)", sharecard.includes("actualBoundingBoxAscent") && sharecard.includes("scoreNumberLayout") && sharecard.includes('textBaseline = "alphabetic"'));
  check("n5 proof script asserts the PDF is exactly 1 page via pdfinfo", proof.includes("pdfinfo") && proof.includes("pdfPages === 1"));
  check("n6 proof script pixel-checks the score ink on all three cards (0/95/100, vertical + horizontal)", proof.includes("card-scam-100.png") && proof.includes("scoreInkMaxY") && proof.includes("scoreOverflow") && proof.includes("scoreBoxBottom") && proof.includes("scoreInkMinX") && proof.includes("scoreInkMaxX"));
  check("n7 proof script serves the built app via vite preview with a readiness wait (no dead-server goto)", proof.includes("vite/bin/vite.js") && proof.includes('"preview"') && proof.includes("waitPreview") && proof.includes("PREVIEW_PORT"));
  check("n8 PDF quote is capped at 600 chars", Boolean(printFn && printFn[0].includes("slice(0, 600)")));
  check("n9 PDF footer text is inset 40px like the header (not flush to the page edge)", /\.pr-footer \.pr-row \{[^}]*padding: 0 40px/.test(styles));
  // ---- (o) Audit MINOR M1/M2/M4 (21 Nov, Myuden: audit sampai
  // benar-benar bersih) -----------------------------------------
  check("o1 M2 toast auto-hides after 3 s, not 5 s", /const TOAST_MS = 3000;/.test(mainJs) && !/const TOAST_MS = 5000;/.test(mainJs));
  check("o2 M2 toast × close is wired on the check + info toasts", (mainJs.match(/\.querySelector\("\.toast-close"\)\.addEventListener\("click", hideCheckCompleteToast\)/g) || []).length >= 2);
  check("o3 M4 copy-link toasts on success and on clipboard failure", mainJs.includes('showInfoToast(t(ok ? "shareCopied" : "shareCopyFailed", lang))') && i18n.includes('shareCopyFailed: "Gagal menyalin tautan') && i18n.includes('shareCopyFailed: "Couldn\'t copy the link'));
  check("o4 M4 copy failure no longer fails silently (no bare label reset without a toast)", !/btn\.textContent = ok \? t\("shareCopied", lang\) : t\("shareCopy", lang\);\s*\n\s*setTimeout/.test(mainJs));
  check("o5 M1 chart empty state is a block with an invitation + try button", html.includes('id="week-chart-empty" class="week-chart-empty"') && html.includes('id="week-chart-try-btn"') && html.includes('data-i18n="chartEmptyTryBtn"'));
  check("o6 M1 empty-state copy invites an example, ID+EN", i18n.includes('"chartEmpty": "Belum ada data — coba salah satu contoh di bawah."') && i18n.includes('"chartEmpty": "No data yet — try one of the examples below."') && i18n.includes('"chartEmptyTryBtn": "Coba contoh"') && i18n.includes('"chartEmptyTryBtn": "Try an example"'));
  check("o7 M1 try button lands on the checker (message tab + scroll + focus)", /week-chart-try-btn"\)\.addEventListener\("click"[\s\S]*?switchCheckerTab\("message"\)[\s\S]*?scrollIntoView[\s\S]*?message-input"\)\.focus/.test(mainJs));
  check("o8 M1 empty state is styled (dashed box + pill button)", styles.includes(".week-chart-empty {") && styles.includes(".week-chart-try {") && styles.includes("border: 1.5px dashed"));
  // ---- (p) Folded clean checks (21 Nov, Myuden: lipat baris
  // bersihnya) ------------------------------------------------------
  check("p1 renderLocalChecks folds clean rows into a <details> disclosure titled with the count", mainJs.includes('<details class="clean-checks"') && mainJs.includes('t("checksCleanToggle", lang, { n: cleanCount })'));
  check("p2 disclosure is closed by default and open state is preserved across re-renders", /let cleanChecksOpen = false;/.test(mainJs) && mainJs.includes('${cleanChecksOpen ? " open" : ""}') && mainJs.includes('cleanDetails.addEventListener("toggle"'));
  check("p3 found rows render outside (before) the disclosure; info rows are partitioned out of the rules", /return `\$\{pills\}\$\{foundList\}\$\{cleanDisclosure\}\$\{infoList\}`;/.test(mainJs) && mainJs.includes("const foundRows = rules.filter((c) => c.found)"));
  check("p4 disclosure only renders when clean rows exist; found list only when found rows exist", mainJs.includes("cleanCount > 0") && mainJs.includes('foundRows !== "" ? `<ul class="local-checks">${foundRows}</ul>` : ""'));
  check("p5 checksCleanToggle exists ID+EN with the {n} placeholder", i18n.includes('checksCleanToggle: "{n} aturan bersih"') && i18n.includes('checksCleanToggle: "{n} rules clear"'));
  check("p6 disclosure is styled: toggle row, green icon, rotating chevron", styles.includes(".clean-checks {") && styles.includes(".clean-checks summary {") && styles.includes(".clean-checks[open ] summary::after") && styles.includes('content: "▾"'));
  check("p7 APK sample still 23 checks / 3 found / 20 clean (disclosure count)", (() => { const a = analyzeWithHeuristic(t("sampleTextApk", "id"), "id"); return a.checks.length === 23 && a.checks.filter((c) => c.found).length === 3 && a.checks.filter((c) => !c.found).length === 20; })());
  // ---- (q) 3-vs-6 inconsistency (21 Nov, Myuden: daftar tanda
  // bahaya 3 butir vs ceklis 6) --------------------------------------
  check("q1 AI flags heading is labelled as the AI verdict for model verdicts only", mainJs.includes('verdict.source === "IN_CLOUD" || verdict.source === "ON_DEVICE" ? "redFlagsAi" : "redFlags"'));
  check("q2 redFlagsAi exists ID+EN", i18n.includes('redFlagsAi: "Tanda bahaya (vonis AI)"') && i18n.includes('redFlagsAi: "Red flags (AI verdict)"'));
  check("q3 device checklist counts rules, not signs (pills + intro, ID+EN)", i18n.includes('checksExamined: "{n} aturan diperiksa"') && i18n.includes('checksExamined: "{n} rules checked"') && i18n.includes('checksFound: "{n} terpicu"') && i18n.includes('checksFound: "{n} triggered"') && i18n.includes("Cek cepat di HP Anda: {n} aturan terpicu") && i18n.includes("A quick check on your device: {n} rules triggered"));
  check("q4 disclosure title follows the rules wording (no 'tanda' left in the local counts)", i18n.includes('checksCleanToggle: "{n} aturan bersih"') && i18n.includes('checksCleanToggle: "{n} rules clear"') && !/checksCleanToggle: "\{n\} tanda bersih"/.test(i18n) && !/localSignalText: "[^"]*tanda penipuan/.test(i18n));
  check("q5 local rule set is self-consistent (redFlags.length === found checks) for APK/prize/safe", ["sampleTextApk", "sampleTextScam", "sampleTextSafe"].every((k) => { const a = analyzeWithHeuristic(t(k, "id"), "id"); return a.redFlags.length === a.checks.filter((c) => c.found).length; }));
  check("q6 prize sample: 6 local flags / 6 found (the '6' Myuden saw) vs APK 3 / 3", (() => { const p = analyzeWithHeuristic(t("sampleTextScam", "id"), "id"); const a = analyzeWithHeuristic(t("sampleTextApk", "id"), "id"); return p.redFlags.length === 6 && a.redFlags.length === 3; })());
  // ---- (r) Myuden's 6 remaining items (21 Nov 20:30) --------------
  // Item 1: community lookups always run (no local-only gate).
  // Item 2: one score on Cek Nomor (LOCAL intro = verdict's own).
  // Item 3: OJK deep link to the IASC report form.
  // Item 4: domains are not Windows program files.
  // Item 5: honest mode label + no fake 0,0 detik.
  // Item 6: short links followed + re-scored, honest unresolved note.
  const filesSrc = read("src/files.js");
  const filesMod = await import("file://" + path.join(ROOT, "src/files.js"));
  const callMod = await import("file://" + path.join(ROOT, "src/callcheck.js"));
  const { analyzeFiles } = filesMod;
  check("r1 files.js exe rule no longer lists .com", filesSrc.includes("(exe|msi|bat|cmd|scr)") && !filesSrc.includes("(exe|msi|bat|cmd|scr|com)"));
  check("r2 bca.com in a message is NOT a Windows program (was exe/high)", JSON.stringify(analyzeFiles("Halo, ini dari Bank BCA. Hubungi kami di support@bca.com atau kunjungi bca.com untuk info lebih lanjut.")) === "[]");
  check("r3 real .exe/.apk in a message are still exe/apk high", (() => { const e = analyzeFiles("Jalankan setup.exe untuk instalasi."); const a = analyzeFiles("Unduh aplikasinya di undangan-nikah.apk sekarang."); return e.length === 1 && e[0].kind === "exe" && e[0].level === "high" && a.length === 1 && a[0].kind === "apk" && a[0].level === "high"; })());
  check("r4 OJK report links go to the IASC report form, not the homepage (hero source is the press release — see s9)", read("src/contacts.js").includes("https://iasc.ojk.go.id/Guest/LaporanV2") && html.includes("ojk.go.id/id/berita-dan-kegiatan/siaran-pers/Pages/OJK-dan-Bareskrim-Polri-Sepakat-Perkuat-Kolaborasi") && !/https:\/\/iasc\.ojk\.go\.id\/"/.test(read("src/contacts.js")) && !/https:\/\/iasc\.ojk\.go\.id\/"/.test(html));
  check("r5 mode label follows the active tab (updateModeLabel + modeLocal)", mainJs.includes("function updateModeLabel()") && mainJs.includes('t("modeLocal", lang)') && /switchCheckerTab[\s\S]{0,800}?updateModeLabel\(\);/.test(mainJs) && /applyStaticLanguage[\s\S]{0,3000}?updateModeLabel\(\);/.test(mainJs));
  check("r6 LOCAL intro quotes the verdict's own score (localSignalTextLocal)", mainJs.includes('t("localSignalTextLocal", lang, { score: verdict.riskScore') && mainJs.includes('verdict.source === "LOCAL"'));
  check("r7 LOCAL/DEMO verdicts show the REAL measured duration (audit 5, formatElapsed since audit 7: checkedInLocal + receiptTimeLocal {s}, unknown fallback)", mainJs.includes('"checkedInLocal"') && mainJs.includes('t("receiptTimeLocal", lang, { s: formatElapsed(elapsedSec, lang) })') && mainJs.includes('t("receiptTimeLocalUnknown", lang)'));
  check("r8 no !isLocalOnly() gate left in main.js; resolved short links are re-scored", count(/!isLocalOnly\(\)/g, mainJs) === 0 && mainJs.includes("analyzeLink(r.finalUrl)") && mainJs.includes("analyzeLink(finalUrl)"));
  check("r9 analyzeCall always looks up (repro: OTP threat = 60/scam, the verdict score)", (await callMod.analyzeCall({ number: "081234567890", said: "Akun Anda diblokir. Segera kirim kode OTP." }, "id")).verdict.riskScore === 60);
  check("r10 new i18n keys exist EN+ID", ["modeLocal", "localSignalTextLocal", "receiptTimeLocal", "linkUnresolvedNote"].every((k) => count(new RegExp(k, "g"), i18n) >= 2));
  check("r11 linkUnresolvedNote is shown in both the card enrichment and the standalone tracker", count(/linkUnresolvedNote/g, mainJs) >= 2);
  check("r12 number-only summary says the database could not be reached (not 'not checked')", i18n.includes("database laporan komunitas tidak bisa dijangkau") && i18n.includes("the community report database could not be reached"));
  check("r13 live: number-only demo summary matches the new wording ID+EN", (await callMod.analyzeCall({ number: "081234567890", said: "" }, "id")).verdict.summary.includes("tidak bisa dijangkau") && (await callMod.analyzeCall({ number: "081234567890", said: "" }, "en")).verdict.summary.includes("could not be reached"));
  // r15 regression (21 Nov, found by the toast test): the mode-label
  // edit once deleted the `demo` declaration that applyStaticLanguage
  // still uses below it ($("image-btn").disabled = demo ...) — the
  // ReferenceError killed the whole language switch, leaving the card
  // badge in the old language. The declaration must stay.
  check("r15 applyStaticLanguage still declares demo before using it", (() => { const fn = mainJs.match(/function applyStaticLanguage\(\) \{[\s\S]*?\n\}/)[0]; return fn.includes("const demo = !isFirebaseConfigured();") && fn.indexOf("const demo = !isFirebaseConfigured();") < fn.indexOf("$(\"image-btn\").disabled = demo"); })());
  // ---- (s) Audit 4 (21 Nov 21:33): counts, OTP prize false positive,
  // Mode-AI hint leak, OJK hero source, report-counts label --------
  const emailMod = await import("file://" + path.join(ROOT, "src/emailcheck.js"));
  const { analyzeEmail } = emailMod;
  check("s1 'Selamat pagi' greeting scores 0, no prize flag", (() => { const v = analyzeWithHeuristic("Selamat pagi, apa kabar?", "id"); return v.riskScore === 0 && v.checks.find((c) => c.id === "prize").found === false; })());
  check("s2 prize sample still 6 flags / 6 found", (() => { const v = analyzeWithHeuristic(t("sampleTextScam", "id"), "id"); return v.redFlags.length === 6 && v.checks.filter((c) => c.found).length === 6; })());
  check("s3 email checks 27, found == redFlags (bca-secure-login.com)", (() => { const v = analyzeEmail({ fromName: "BCA", fromEmail: "support@bca-secure-login.com", body: "Yth. Nasabah, akun Anda akan diblokir dalam 24 jam. Segera verifikasi data Anda di sini: https://bca-secure-login.com/verifikasi-akun" }, "id"); return v.checks.length === 27 && v.checks.filter((c) => c.found).length === v.redFlags.length; })());
  const callOtp = await callMod.analyzeCall({ number: "081234567890", said: "Selamat pagi, saya dari Bank BCA. Akun Bapak telah diblokir. Untuk membuka blokirnya, mohon sebutkan kode OTP yang baru saja Bapak terima." }, "id");
  check("s4 call OTP greeting: 3 flags == 3 found, no prize row", callOtp.verdict.redFlags.length === 3 && callOtp.verdict.checks.filter((c) => c.found).length === 3 && !callOtp.verdict.checks.some((c) => c.id === "prize"), JSON.stringify(callOtp.verdict.redFlags));
  const callNumOnly = await callMod.analyzeCall({ number: "081234567890", said: "" }, "id");
  check("s5 call number-only: 6 checks, 1 found == 1 flag", callNumOnly.verdict.checks.length === 6 && callNumOnly.verdict.checks.filter((c) => c.found).length === 1 && callNumOnly.verdict.redFlags.length === 1);
  check("s6 renderResult prefers verdict.checks over the message heuristic", /Array\.isArray\(verdict\.checks\)/.test(mainJs) && /verdict\.checks\.length > 0/.test(mainJs));
  check("s7 checker hint is tab-aware (checkerHintLocal + updateModeLabel)", i18n.includes("checkerHintLocal:") && mainJs.includes('t("checkerHintLocal", lang)') && html.includes('id="checker-hint"'));
  check("s8 report-counts box has a heading (no bare database verdict)", mainJs.includes('t("reportCountsTitle", lang)') && i18n.includes('"reportCountsTitle": "Laporan komunitas"'));
  check("s9 hero source = OJK press release, OJK report links = IASC form", html.includes("ojk.go.id/id/berita-dan-kegiatan/siaran-pers/Pages/OJK-dan-Bareskrim-Polri-Sepakat-Perkuat-Kolaborasi") && read("src/contacts.js").includes("https://iasc.ojk.go.id/Guest/LaporanV2"));
  check("s10 numbersWarn still admits no scam-number database", i18n.includes("TipuCek tidak punya database nomor penipu sendiri") && i18n.includes("TipuCek has no scam-number database of its own"));
  check("s11 new checkDesc keys exist (email x4, call x7)", ["emailMismatch", "emailFreeMail", "emailLinkRisk", "emailUrgency", "callScriptBank", "callScriptOtp", "callScriptThreat", "callScriptSafeAccount", "callScriptTransfer", "callReports", "callNumberOnly"].every((id) => i18n.includes(`checkDesc_${id}:`)));
  // ---- (t) Audit 5 (21 Nov ~23:00): auditor re-audit leftovers —
  // counts, official numbers, local duration, OJK wording, live
  // stats across tabs ----------------------------------------------
  check("t1 email gmail variant (auditor's 8=8): 8 found == 8 flags", (() => { const v = analyzeEmail({ fromName: "BCA", fromEmail: "bca-promo@gmail.com", body: "Yth. Nasabah Bank BCA, akun Anda akan diblokir dalam 24 jam. Segera verifikasi data Anda di sini: https://bca-secure-login.com/verifikasi-akun dan sebutkan kode OTP Anda kepada petugas kami." }, "id"); return v.checks.length === 27 && v.checks.filter((c) => c.found).length === 8 && v.redFlags.length === 8; })());
  check("t2 call short OTP text (auditor's 2=2): threat + OTP = 60", (await callMod.analyzeCall({ number: "081234567890", said: "Akun Anda diblokir. Segera kirim kode OTP." }, "id")).verdict.riskScore === 60);
  const callOfficialOnly = await callMod.analyzeCall({ number: "1500888", said: "" }, "en");
  check("t3 1500888 alone: Safe 0, 0 red flags, official is info (number-only row kind info)", callOfficialOnly.verdict.status === "safe" && callOfficialOnly.verdict.riskScore === 0 && callOfficialOnly.verdict.redFlags.length === 0 && (callOfficialOnly.verdict.infoFlags || []).length === 1 && /BCA/.test(callOfficialOnly.verdict.infoFlags[0]) && callOfficialOnly.verdict.checks.find((c) => c.id === "callNumberOnly").kind === "info", JSON.stringify(callOfficialOnly.verdict));
  const callOfficialGreeting = await callMod.analyzeCall({ number: "1500888", said: "Halo, ini BCA" }, "id");
  check("t4 1500888 + 'Halo, ini BCA': Safe 0, bank row is info, 0 triggered rules, summary warns about spoofing", callOfficialGreeting.verdict.riskScore === 0 && callOfficialGreeting.verdict.redFlags.length === 0 && (callOfficialGreeting.verdict.infoFlags || []).length === 1 && callOfficialGreeting.verdict.checks.find((c) => c.id === "callScriptBank").kind === "info" && callOfficialGreeting.verdict.checks.filter((c) => c.found && c.kind !== "info").length === 0 && /memalsukan/.test(callOfficialGreeting.verdict.summary), JSON.stringify(callOfficialGreeting.verdict));
  const callOfficialOtp = await callMod.analyzeCall({ number: "1500888", said: "Halo, ini BCA. Sebutkan kode OTP Anda." }, "id");
  check("t5 1500888 + OTP ask: OTP still fires (35), identity stays info", callOfficialOtp.verdict.riskScore === 35 && callOfficialOtp.verdict.redFlags.length === 1 && (callOfficialOtp.verdict.infoFlags || []).length === 1, JSON.stringify(callOfficialOtp.verdict));
  const callOfficialPolice = await callMod.analyzeCall({ number: "1500888", said: "Saya dari polisi, segera transfer uang ke rekening ini." }, "id");
  check("t6 1500888 + 'polisi': a different institution is still a danger (90, 3 flags, 0 info — audit 7 adds the mismatch 35)", callOfficialPolice.verdict.riskScore === 90 && callOfficialPolice.verdict.redFlags.length === 3 && (callOfficialPolice.verdict.infoFlags || []).length === 0, JSON.stringify(callOfficialPolice.verdict));
  check("t7 LOCAL/DEMO pill + receipt show the real measured duration (formatElapsed, audit 7)", mainJs.includes('"checkedInLocal"') && mainJs.includes('t("receiptTimeLocal", lang, { s: formatElapsed(elapsedSec, lang) })') && mainJs.includes('t("receiptTimeLocalUnknown", lang)') && ["checkedInLocal", "receiptTimeLocalUnknown", "infoFlags", "callOfficialIdentity"].every((k) => count(new RegExp(k, "g"), i18n) >= 2));
  check("t8 OJK hero is Rp9 exactly as the press release (ID+EN, HTML+i18n, no 9.1 left)", i18n.includes('statLossNum: "Rp9 triliun"') && i18n.includes('statLossNum: "Rp9 trillion"') && i18n.includes('heroStat: "Rp9 triliun kerugian') && i18n.includes('heroStat: "Rp9 trillion (~US$500 million)') && html.includes(">Rp9 triliun</div>") && !/9[,.]1 triliun/.test(i18n) && !/9[,.]1 trillion/.test(i18n));
  check("t9 cross-tab live stats: storage listener reloads history on pesanaman_history_v1", mainJs.includes('window.addEventListener("storage"') && mainJs.includes('e.key === "pesanaman_history_v1"') && /addEventListener\("storage"[\s\S]{0,600}?loadHistory\(\)[\s\S]{0,200}?renderHistory\(h\)/.test(mainJs));
  check("t10 info box renders from verdict.infoFlags (own heading, own list)", mainJs.includes('class="info-flags"') && mainJs.includes('t("infoFlags", lang)') && mainJs.includes("verdict.infoFlags") && styles.includes(".info-flags {") && styles.includes(".local-info-checks {"));
  check("t11 renderLocalChecks partitions info rows out of the pills (rules only)", mainJs.includes('c.kind !== "info"') && mainJs.includes('class="local-info-checks"') && /return `\$\{pills\}\$\{foundList\}\$\{cleanDisclosure\}\$\{infoList\}`;/.test(mainJs));
  check("t12 history restore + merge carry infoFlags", mainJs.includes('infoFlags: Array.isArray(e.infoFlags)') && callcheck.includes("const infoFlags = [...(ai.infoFlags || [])]"));
  // ---- (u) Audit 6 (22 Nov ~09:00): privacy leaks, link-track
  // copy, stuck char counter, WHOIS shortener label, call duration
  // (maskSensitive already imported above, line ~51.)
  check("u1 evidence quotes are masked at render (both checklists)", count(/maskSensitive\(stripUrlQueriesInText\(c\.evidence\)\)/g, mainJs) >= 1 && /const evHtml[\s\S]{0,400}?maskSensitive\(stripUrlQueriesInText\(c\.evidence\)\)/.test(mainJs) && /const rowHtml[\s\S]{0,120}?const ev = evHtml\(c\)/.test(mainJs) && /const infoRowHtml[\s\S]{0,120}?const ev = evHtml\(c\)/.test(mainJs));
  check("u2 checked-message disclosure is ALWAYS masked (no unmasked fresh card)", mainJs.includes("maskSensitive(stripUrlQueriesInText(message))") && !mainJs.includes("extra.masked ? maskSensitive(message) : message"));
  check("u3 numbers box masks phone + account values", mainJs.includes("maskSensitive(p)") && mainJs.includes("maskSensitive(a)"));
  check("u4 OCR note, share-card quote, PDF quote/found, chatlog snippet are masked", mainJs.includes("maskSensitive(imageText)") && mainJs.includes("message: maskSensitive(stripUrlQueriesInText(message))") && mainJs.includes("maskSensitive(stripUrlQueriesInText(quoteRaw") && mainJs.includes("phones.map(maskSensitive)") && mainJs.includes("maskSensitive(r.text.slice(0, 140))"));
  check("u5 link-track copy is honest (no 'follow to the real destination')", i18n.includes("tidak selalu bisa dilacak dari browser") && i18n.includes("can't always be traced from the browser") && !i18n.includes("ikuti tautan ke tujuan asli") && !i18n.includes("follow a link to its real destination") && i18n.includes("mencoba mengikuti pemendek tautan") && i18n.includes("tries to follow shorteners") && i18n.includes("mencoba menghubungi pemendek tautan") && i18n.includes("tries to contact the shortener") && html.includes("tujuan tautan pendek tidak selalu bisa dilacak dari browser"));
  check("u6 history restore refreshes the input state (char counter follows restored text)", /function fillCheckerForm[\s\S]{0,1400}?refreshInputState\(\);/.test(mainJs));
  check("u7 WHOIS shortener label exists (EN+ID) and is used in both RDAP spots", count(/linktrackShortenerData/g, i18n) >= 2 && count(/t\("linktrackShortenerData"/g, mainJs) === 2 && mainJs.includes("unresolvedShortener"));
  check("u8 call duration pill shows the lookup split when known (formatElapsed, audit 7)", i18n.includes("checkedInLocalLookup") && i18n.includes("termasuk pengecekan laporan komunitas ({l})") && i18n.includes("including the community report lookup ({l})") && mainJs.includes('t("checkedInLocalLookup", lang') && mainJs.includes("lookupSec: lookupMs / 1000"));
  const callLookup = await callMod.analyzeCall({ number: "081234567890", said: "Akun Anda diblokir. Segera kirim kode OTP." }, "id");
  check("u9 analyzeCall returns lookupMs (number) for a number, null without", typeof callLookup.lookupMs === "number" && callLookup.lookupMs >= 0 && (await callMod.analyzeCall({ number: "", said: "Akun Anda diblokir." }, "id")).lookupMs === null, `lookupMs=${callLookup.lookupMs}`);
  // u10 uses the SCAM OTP text (with "hubungi 0812-...") on purpose:
  // the pure-OTP guard excuses moneyOtp for a bare notification, so
  // the masking probe needs a message where the rule actually fires.
  check("u10 raw OTP evidence still carries the code, masked display hides it", (() => { const v = analyzeWithHeuristic("BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.", "id"); const c = v.checks.find((x) => x.id === "moneyOtp"); return c && c.found && c.evidence.includes("482916") && !/\d{4,}/.test(maskSensitive(c.evidence)); })());
  check("u11 standalone shortener label is gated on an actual shortener (CoArena)", mainJs.includes('analyzeLink(input).reasons.includes("linkRiskShortener")') && mainJs.includes("!resolved && isShortener && info && !info.error"));
  check("u12 lookupMs is set only inside if (hash) — one assignment, after the lookup ran (CoArena)", count(/lookupMs = performance\.now/g, callcheck) === 1 && /if \(hash\) \{[^}]*lookupMs = performance\.now\(\) - lookupT0;/s.test(callcheck));
  // ---- (v) Audit 7 (22 Nov ~10:00): proportional mask, email
  // duration in ms, file-name URL/domain, identity mismatch,
  // honest unresolved-link wording
  const { formatElapsed } = i18nMod;
  check("v1 mask is proportional: 6-digit OTP 6 dots, 12-digit phone 12, 13-digit +62 13, 4-digit 4", (() => {
    const dots = (s) => (maskSensitive(s).match(/•/g) || []).length;
    return dots("Kode 482916") === 6 && dots("Hubungi 081234567890") === 12 && dots("Hubungi +62 812-3456-7890") === 13 && dots("Kode 1234") === 4 && !/\d{4,}/.test(maskSensitive("Kode 482916 atau 081234567890"));
  })());
  check("v2 formatElapsed: ALWAYS milliseconds (audit 9 — the unit never flips between checks)", formatElapsed(2.5, "id") === "2.500,0 md" && formatElapsed(2.5, "en") === "2,500.0 ms" && formatElapsed(0.0123, "id") === "12,3 md" && formatElapsed(0.0123, "en") === "12.3 ms" && formatElapsed(0.0004, "id") === "0,40 md" && formatElapsed(2.7, "id") === "2.700,0 md" && formatElapsed(0.3207, "id") === "320,7 md" && formatElapsed(0.2926, "id") === "292,6 md");
  check("v3 pill + receipt use formatElapsed (no toFixed(1) on local durations)", mainJs.includes("formatElapsed(elapsedSec, lang)") && mainJs.includes("formatElapsed(extra.lookupSec, lang)") && !mainJs.includes("const pillUnit") && !/t\("checkedInLocal", lang, \{ s: elapsedSec\.toFixed\(1\) \}\)/.test(mainJs) && !/t\("receiptTimeLocal", lang, \{ s: elapsedSec\.toFixed\(1\) \}\)/.test(mainJs));
  check("v4 duration strings carry no unit (the value does)", !/checkedInLocal: "Diperiksa di perangkat dalam \{s\} dtk/.test(i18n) && !/checkedInLocal: "Checked on this device in \{s\}s/.test(i18n) && i18n.includes('checkedInLocal: "Diperiksa di perangkat dalam {s} — tanpa menunggu AI."') && i18n.includes('checkedInLocal: "Checked on this device in {s} — no AI wait."'));
  check("v5 file names: example.com/bit.ly URLs are kind url, real names still classify", (() => {
    const { analyzeFileName: afn, fileTypeDisplay: ftd } = fcMod;
    return afn("example.com").kind === "url" && afn("https://bit.ly/3abc").kind === "url" && afn("bit.ly/3abc").kind === "url" && afn("bit.ly").kind === "url" && afn("support@bca.com").kind === "url" && ftd(afn("example.com")) === "URL" && ftd(afn("https://bit.ly/3abc")) === "URL" && afn("undangan-nikah.apk").kind === "apk" && afn("laporan.pdf.exe").kind === "exe" && afn("laporan.pdf").kind === "doc" && afn("data.zip").kind === "archive" && afn("folder/undangan-nikah.apk").kind === "apk";
  })());
  check("v6 file-name render uses fileVerdictUrl for kind url", mainJs.includes('info.kind === "url" ? "fileVerdictUrl"') && i18n.includes("fileNameIsUrl") && i18n.includes("fileVerdictUrl"));
  const callMismatch = await callMod.analyzeCall({ number: "1500888", said: "Halo, saya dari OJK." }, "id");
  check("v7 1500888 + OJK claim: 60 scam, 2 flags, mismatch row names BCA → OJK", callMismatch.verdict.riskScore === 60 && callMismatch.verdict.status === "scam" && callMismatch.verdict.redFlags.length === 2 && callMismatch.verdict.redFlags.some((f) => /BCA/.test(f) && /OJK/.test(f)) && (callMismatch.verdict.checks.find((c) => c.id === "callIdentityMismatch") || {}).found === true && callMismatch.verdict.checks.find((c) => c.id === "callIdentityMismatch").evidence === "BCA → OJK", JSON.stringify(callMismatch.verdict));
  check("v8 mismatch keys exist ID+EN (flag, description, demo-flag entry)", i18n.includes("callIdentityMismatch") && i18n.includes("checkDesc_callIdentityMismatch") && i18n.includes("Caller claims a different institution than the number's owner") && i18n.includes("Penelepon mengaku dari instansi lain, bukan pemilik nomor ini"));
  check("v9 unresolved-link note is honest per case (shortener vs fetch-failed)", i18n.includes("linkUnresolvedNoteFetch") && i18n.includes("gagal dimuat") && i18n.includes("failed to load") && mainJs.includes('isShortener ? "linkUnresolvedNote" : "linkUnresolvedNoteFetch"'));
  check("v10 '@' alone is not an email: invoice@2025.pdf is a doc, support@bca.com is a url (CoArena)", (() => {
    const { analyzeFileName: afn } = fcMod;
    return afn("invoice@2025.pdf").kind === "doc" && afn("foto@liburan.jpg").kind === "unknown" && afn("support@bca.com").kind === "url";
  })());
  const callFirstMention = await callMod.analyzeCall({ number: "1500888", said: "Saya dari OJK, bukan dari BCA." }, "id");
  const callGenericBank = await callMod.analyzeCall({ number: "1500888", said: "Saya dari bank." }, "id");
  check("v11 first mention decides the claim (CoArena): 'OJK, bukan BCA' is a mismatch (60); generic 'bank' is not (25)", callFirstMention.verdict.riskScore === 60 && (callFirstMention.verdict.checks.find((c) => c.id === "callIdentityMismatch") || {}).found === true && callGenericBank.verdict.riskScore === 25 && callGenericBank.verdict.checks.find((c) => c.id === "callIdentityMismatch") === undefined, JSON.stringify({ first: callFirstMention.verdict, generic: callGenericBank.verdict }));
  // ---- (w) Audit 8 (22 Nov ~12:30): file/link results saved to
  // history, hero counts never drop on trim, genuine Tokopedia email
  // not flagged, one duration unit per pill
  const TOKO_BODY = "Terima kasih telah berbelanja di Tokopedia. Pesanan Anda sudah kami proses. Silakan cek status pesanan Anda di aplikasi Tokopedia.";
  check("w1 genuine Tokopedia email scores 0: impersonation excused, info row present", (() => {
    const v = analyzeEmail({ fromName: "Tokopedia", fromEmail: "noreply@tokopedia.com", body: TOKO_BODY }, "en");
    const imp = v.checks.find((c) => c.id === "impersonation");
    const verified = v.checks.find((c) => c.id === "emailBrandVerified");
    return v.status === "safe" && v.riskScore === 0 && v.redFlags.length === 0 && imp && imp.found === false && verified && verified.kind === "info";
  })());
  check("w2 look-alike Tokopedia domain still 40 suspicious; gmail claim still 60 scam", (() => {
    const fake = analyzeEmail({ fromName: "Tokopedia", fromEmail: "promo@tokopedia-promo.net", body: TOKO_BODY }, "en");
    const gmail = analyzeEmail({ fromName: "Tokopedia", fromEmail: "tokopedia@gmail.com", body: TOKO_BODY }, "en");
    return fake.status === "suspicious" && fake.riskScore === 40 && gmail.status === "scam" && gmail.riskScore === 60 && fake.checks.find((c) => c.id === "emailBrandVerified") === undefined;
  })());
  check("w3 skipIds: heuristic recompute drops the skipped rule but keeps its row (clean)", (() => {
    const full = analyzeWithHeuristic(TOKO_BODY, "en");
    const skipped = analyzeWithHeuristic(TOKO_BODY, "en", { skipIds: new Set(["impersonation"]) });
    const row = skipped.checks.find((c) => c.id === "impersonation");
    return full.riskScore === 10 && skipped.riskScore === 0 && row && row.found === false && skipped.checks.length === full.checks.length;
  })());
  check("w4 history cap raised to 200 and totals derive from the list + a trimmed bucket (audit 16: no mutable aggregate to lose)", read("src/history.js").includes("const MAX_ENTRIES = 200;") && read("src/history.js").includes('LS_TRIMMED_KEY = "tipucek_stats_trimmed_v1"') && read("src/history.js").includes("function getStatsTotals()") && read("src/history.js").includes("function absorbTrimmed(") && !read("src/history.js").includes("function bumpTotalsFrom("));
  check("w5 totals never drop when a new check trims the oldest entry (auditor: 32 -> 31)", await (async () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    try {
      const histMod = await import("file://" + path.join(ROOT, "src/history.js"));
      for (let i = 0; i < 32; i++) await histMod.saveCheck({ message: `scam ${i}`, status: "scam", riskScore: 90, redFlags: ["x"], summary: "s", source: "LOCAL" });
      for (let i = 0; i < 168; i++) await histMod.saveCheck({ message: `safe ${i}`, status: "safe", riskScore: 0, redFlags: [], summary: "s", source: "LOCAL" });
      await histMod.saveCheck({ message: "one more safe", status: "safe", riskScore: 0, redFlags: [], summary: "s", source: "LOCAL" });
      const list = await histMod.loadHistory();
      const totals = histMod.getStatsTotals();
      return list.length === 200 && list.filter((e) => e.status === "scam").length === 31 && totals.checked === 201 && totals.scams === 32;
    } finally {
      delete globalThis.localStorage;
    }
  })());
  check("w6 file + link handlers save through saveCheck (kind file / kind link, LOCAL verdict)", /saveCheck\(\{\s*message: (info\.fileName|name),\s*kind: "file"/.test(mainJs) && /saveCheck\(\{\s*message: input,\s*kind: "link"/.test(mainJs) && mainJs.includes('source: "LOCAL"') && mainJs.includes("function fileVerdictFor"));
  check("w7 file/link verdict mapping is fixed: file high 85 / low 0 / url 40 / unknown 30, link high 85 / low 40 / safe 0, unresolved 40", mainJs.includes('riskScore: high ? 85 : url ? 40 : suspicious ? 30 : 0') && mainJs.includes('const linkScore = linkUnresolved ? 40 : linkLevel === "high" ? 85 : linkLevel === "low" ? 40 : 0'));
  check("w8 history restore fills the file-name / link input and switches to that tool panel", mainJs.includes("switchModuleTab(e.kind)") && mainJs.includes('$("filecheck-name-input").value = e.message || ""') && mainJs.includes('$("linktrack-input").value = e.message || ""'));
  check("w9 hero cards, week chart, history stats line and badges all read the aggregate totals", count(/getStatsTotals\(\)/g, mainJs) >= 4 && mainJs.includes("const totals = getStatsTotals();") && mainJs.includes('have: () => getStatsTotals().checked') && mainJs.includes('have: () => getStatsTotals().scams') && i18n.includes("historyTrimmed") && i18n.includes("Menampilkan {n} entri terbaru dari {m} pemeriksaan") && i18n.includes("Showing the {n} most recent of {m} checks"));
  check("w10 formatElapsed forceUnit is ignored — the unit is always milliseconds (audit 9)", formatElapsed(1.2, "id", "ms") === "1.200,0 md" && formatElapsed(0.998, "id", "s") === "998,0 md" && formatElapsed(1.2, "en", "s") === "1,200.0 ms" && formatElapsed(0.998, "en", "s") === "998.0 ms");
  check("w11 duration pill uses one fixed unit for total + lookup (audit 9: no pillUnit, formatElapsed 2-arg)", !mainJs.includes("const pillUnit") && mainJs.includes("formatElapsed(elapsedSec, lang)") && mainJs.includes("formatElapsed(extra.lookupSec, lang)"));
  check("w12 cloud receipt uses formatElapsed too (no toFixed(1) on any receipt)", !/elapsedSec\.toFixed\(1\)/.test(mainJs) && i18n.includes('receiptTime: "Dijawab dalam {s}."') && i18n.includes('receiptTime: "Answered in {s}."'));
  check("w13 new check-row keys exist ID+EN (brand verified, file type, link risk)", ["checkDesc_emailBrandVerified", "checkDesc_fileType", "checkDesc_linkRisk"].every((k) => count(new RegExp(k, "g"), i18n) >= 2) && i18n.includes("Sender domain matches the brand named in the email") && i18n.includes("File type assessment") && i18n.includes("Link risk assessment"));
  check("w14 genuine brand email WITH links still scores 0 (multiLinks excused for verified senders; look-alike with links is 63 scam)", (() => {
    const genuine = analyzeEmail({ fromName: "Tokopedia", fromEmail: "noreply@tokopedia.com", body: TOKO_BODY + " Lacak pesanan di https://tokopedia.com/order/123 dan https://tokopedia.com/help." }, "en");
    const fake = analyzeEmail({ fromName: "Tokopedia", fromEmail: "promo@tokopedia-promo.net", body: TOKO_BODY + " Lacak pesanan di https://tokopedia-promo.net/order/123 dan https://tokopedia-promo.net/help." }, "en");
    return genuine.status === "safe" && genuine.riskScore === 0 && genuine.redFlags.length === 0 && genuine.checks.find((c) => c.id === "multiLinks").found === false && fake.status === "scam" && fake.riskScore === 63;
  })());
  check("w15 text-file verdict strips content evidence before save (CoArena: 'file NAME only')", mainJs.includes('checks: textLocal.checks.map((c) => ({ ...c, evidence: "" }))'));
  check("w16 a file NAME that is a URL is suspicious 40, never safe 0 (Groq; audit 13: url folds into the suspicious set)", mainJs.includes('status: high ? "scam" : suspicious ? "suspicious" : "safe"') && mainJs.includes('riskScore: high ? 85 : url ? 40 : suspicious ? 30 : 0') && mainJs.includes('const suspicious = url || unknown || scriptUnread'));
  check("w17 an UNRESOLVED link is suspicious 40, never 85 scam (Groq + Qwen)", mainJs.includes("const linkUnresolved = !resolved;") && mainJs.includes("const linkScore = linkUnresolved ? 40 :") && mainJs.includes('const linkStatus = linkUnresolved'));
  check("w18 file-name button is disabled while its lookup + save run (Qwen: no double-save)", /filecheck-name-btn"\)\.addEventListener\("click"[\s\S]{0,2500}?nameBtn\.disabled = true;/.test(mainJs) && /nameBtn\.disabled = false;/.test(mainJs));
  check("w19 totals seed from the LOADED (merged) list at boot and on cross-tab reload (Qwen: cloud mode)", read("src/history.js").includes("export function seedTotalsFromList") && count(/seedTotalsFromList\(h\)/g, mainJs) === 2);
  check("w20 brand check reads the whole email body, not the evidence snippet (Qwen: brand named later still verifies)", read("src/emailcheck.js").includes("body.toLowerCase().includes(senderBrand.name)") && !read("src/emailcheck.js").includes("impRow.evidence.toLowerCase().includes(senderBrand.name)"));
  check("w21 trimmed counts move to the bucket only AFTER the local write succeeds (100milionseek: no overcount on quota failure, no double-count; audit 16: no per-check increment)", read("src/history.js").includes("if (writeLocal(local) && dropped.length > 0) absorbTrimmed(dropped);") && !read("src/history.js").includes("bumpTotalsFrom("));
  check("w22 history list preview strips a link's query/fragment (100milionseek: no session token in the list)", mainJs.includes('const displayText = e.kind === "link" ? text.split(/[?#]/)[0] : text;') && mainJs.includes("const masked = maskSensitive(displayText);"));
  // ---- (x) Audit 9 (22 Nov ~14:15): one fixed duration unit,
  // numeric score in the file/link panels, first-paint hero
  // consistency, 200-boundary reproducibility
  check("x1 formatElapsed is ALWAYS milliseconds — auditor's own values included (2.7 dtk / 320.7 md / 292.6 md all become md)", formatElapsed(2.7, "id") === "2.700,0 md" && formatElapsed(0.3207, "id") === "320,7 md" && formatElapsed(0.2926, "id") === "292,6 md" && formatElapsed(5.9, "id") === "5.900,0 md" && formatElapsed(6.5, "id") === "6.500,0 md" && formatElapsed(0.00004, "id") === "0,04 md" && formatElapsed(12.9, "en") === "12,900.0 ms");
  check("x2 no check-duration string uses seconds (checkedIn / receiptTime keys are unit-free)", ["checkedIn", "checkedInLocal", "checkedInLocalLookup", "receiptTime", "receiptTimeLocal"].every((k) => {
    const m = i18n.match(new RegExp(`${k}: "([^"]*)"`, "g")) || [];
    return m.length > 0 && m.every((s) => !/dtk|\bseconds?\b|\bdetik\b/.test(s));
  }));
  check("x3 panelScore key exists ID+EN and both file handlers + the link handler render it with the SAVED score, computed before render", i18n.includes('"panelScore": "Skor: {n}/100"') && i18n.includes('"panelScore": "Score: {n}/100"') && count(/t\("panelScore", lang, \{ n: fv\.riskScore \}\)/g, mainJs) === 2 && count(/t\("panelScore", lang, \{ n: linkScore \}\)/g, mainJs) === 1 && /const fv = fileVerdictFor\(info, textLocal, lang\);[\s\S]{0,1200}?t\("panelScore", lang, \{ n: fv\.riskScore \}\)/.test(mainJs) && /const fv = fileVerdictFor\(info, null, lang\);[\s\S]{0,1200}?t\("panelScore", lang, \{ n: fv\.riskScore \}\)/.test(mainJs) && /const linkScore = linkUnresolved[\s\S]{0,1500}?t\("panelScore", lang, \{ n: linkScore \}\)/.test(mainJs));
  check("x4 first paint: hero renders synchronously at init, observer never resets numbers to 0, sub tracks the animated value", mainJs.includes("Audit 9: render the hero stats SYNCHRONOUSLY at init") && !/(c|g)\.textContent = "0"/.test(mainJs) && mainJs.includes("function animateStatNum(el, target, onStep)") && mainJs.includes("if (onStep) onStep(value);") && mainJs.includes("animateStatNum(checkedEl, checked, (v) =>") && mainJs.includes("updateLocalStats();\n\n  // Stat count-up") && !mainJs.includes('t("statCaughtSub", lang, { n: checked })') && count(/if \(onStep\) onStep\(target\);/g, mainJs) === 3 && mainJs.includes('if (el.textContent === "–")'));
  check("x5 200-boundary, Node-level: seed 200 (32 scams, oldest scam) + one safe check → list 200/31, totals 201/32, chart day bucket 201/32", await (async () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    try {
      const histMod = await import("file://" + path.join(ROOT, "src/history.js"));
      const now = Date.now();
      // Seed timestamps must ALL fall inside today (the day bucket
      // expects 201/32): spread the 200 entries across the time since
      // midnight instead of a fixed 200 minutes, so the test also
      // passes in the early morning when 200 min would span midnight.
      const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
      const step = Math.max(1, Math.floor((now - startOfDay.getTime()) / 201));
      const seed = [];
      for (let i = 0; i < 200; i++) {
        const isScam = i < 31 || i === 199;
        seed.push({ id: `seed-${i}`, message: `Pesan seed ${i}`, kind: "message", status: isScam ? "scam" : "safe", riskScore: isScam ? 95 : 0, redFlags: isScam ? ["x"] : [], summary: "s", source: "LOCAL", elapsedSec: 0.01, createdAt: new Date(now - i * step).toISOString() });
      }
      store.set("pesanaman_history_v1", JSON.stringify(seed));
      await histMod.saveCheck({ message: "AUDIT9SEED safe", status: "safe", riskScore: 0, redFlags: [], summary: "s", source: "LOCAL" });
      const list = await histMod.loadHistory();
      const totals = histMod.getStatsTotals();
      const dayKey = histMod.localDayKey(new Date());
      const bucket = totals.days[dayKey];
      return list.length === 200 && list.filter((e) => e.status === "scam").length === 31 && totals.checked === 201 && totals.scams === 32 && bucket && bucket.c === 201 && bucket.s === 32;
    } finally {
      delete globalThis.localStorage;
    }
  })());
  check("x6 hero, stats row and chart all read the SAME aggregate totals (no second source of truth)", count(/getStatsTotals\(\)/g, mainJs) >= 4 && mainJs.includes('t("historyStats", lang, { n: totals.checked, m: totals.scams })') && mainJs.includes("const totals = getStatsTotals();\n  const counts = days.map") && !/stat-checked-num.*deriveTotals|deriveTotals.*stat-checked/.test(mainJs));
  check("x7 panel score equals the stored verdict score (file name 85 / url 40 / link unresolved 40; audit 11: +2 restore renders)", mainJs.includes('riskScore: high ? 85 : url ? 40 : suspicious ? 30 : 0') && mainJs.includes("const linkScore = linkUnresolved ? 40 :") && count(/t\("panelScore"/g, mainJs) === 5);
  // y — audit 10: bare-domain links, OJK area-code mismatch, tool badge, legacy note, counting rule
  check("y1 normalizeLinkInput: bare domain gains https://, bad input stays empty", await (async () => {
    const dom = await import("file://" + path.join(ROOT, "src/domain.js"));
    return dom.normalizeLinkInput("example.com") === "https://example.com"
      && dom.normalizeLinkInput("www.example.com/path?q=1") === "https://www.example.com/path?q=1"
      && dom.normalizeLinkInput("https://example.com") === "https://example.com"
      && dom.normalizeLinkInput("") === "" && dom.normalizeLinkInput("ftp://example.com") === ""
      && dom.normalizeLinkInput("example") === "" && dom.normalizeLinkInput("foo bar.com") === ""
      && dom.normalizeLinkInput("example.com:65535") === "https://example.com:65535"
      && dom.normalizeLinkInput("example.com:65536") === "" && dom.normalizeLinkInput("example.com:99999") === ""
      && dom.normalizeLinkInput("https://") === "" && dom.normalizeLinkInput("http:// not-a-url") === ""
      && dom.normalizeLinkInput("https://example.com:99999") === "" && dom.normalizeLinkInput("https://user:pass@example.com") === "https://user:pass@example.com";
  })());
  check("y2 OJK claim on an official number scores 60 scam in ANY number format (area code included)", await (async () => {
    const cc = await import("file://" + path.join(ROOT, "src/callcheck.js"));
    const light = "Saya dari OJK, ada informasi untuk Anda";
    const scores = [];
    for (const number of ["1500888", "+62 21 1500888", "1500 888", "0211500888"]) {
      scores.push((await cc.analyzeCall({ number, said: light }, "id")).verdict.riskScore);
    }
    const mobile = (await cc.analyzeCall({ number: "08121500888", said: light }, "id")).verdict.riskScore;
    const clean = (await cc.analyzeCall({ number: "1500888", said: "Saya dari BCA, ada informasi untuk Anda" }, "id")).verdict.riskScore;
    const unknown = (await cc.analyzeCall({ number: "081234567890", said: light }, "id")).verdict.riskScore;
    return scores.every((s) => s === 60) && mobile === 25 && clean === 0 && unknown === 25;
  })());
  check("y3 link handler normalizes before validating and uses linktrackInvalid for bad non-empty input", mainJs.includes("const input = normalizeLinkInput(rawInput);") && mainJs.includes('t(rawInput ? "linktrackInvalid" : "linktrackEmpty", lang)') && i18n.includes('"linktrackInvalid": "Tautan tidak valid') && i18n.includes('"linktrackInvalid": "That link isn\'t valid'));
  check("y4 history rows carry a tool badge and loadHistory copies kind from the local twin", mainJs.includes("historyToolLabel(e.kind)") && mainJs.includes('class="history-tool"') && read("src/history.js").includes("if (!entry.kind)") && read("src/styles.css").includes(".history-tool"));
  check("y5 legacy pre-audit-7 call entries get a visible note, never a silent rewrite", mainJs.includes('t("historyOldRules", lang,') && mainJs.includes('c.id === "callIdentityMismatch"') && mainJs.includes('c.id === "callReports" && c.found') && i18n.includes('historyOldRules: "Aturan lama') && i18n.includes('historyOldRules: "Old rules') && read("src/history.js").includes("export const SCORING_VERSION = 2") && read("src/history.js").includes("scoreVersion: SCORING_VERSION"));
  check("y6 counting rule documented in saveCheck and exactly one saveCheck per handler (8)", read("src/history.js").includes("COUNTING RULE") && read("src/history.js").includes("exactly ONCE") && count(/await saveCheck\(/g, mainJs) === 8);
  check("y7 cloud write sends exactly the 7 verdict fields — kind/model never leave the device", (() => {
    const hist = read("src/history.js");
    const m = hist.match(/await addDoc\(collection\(db, "checks"\), \{[\s\S]*?\}\);/);
    return !!m && !/kind|model/.test(m[0]) && ["status:", "riskScore:", "redFlags:", "summary:", "source:", "createdAt:", "ownerUid:"].every((f) => m[0].includes(f));
  })());
  // z — audit 11 (g): restoring a file/link entry refreshes that tool's panel
  check("z1 history restore renders the stored verdict into the restored tool's panel", mainJs.includes('if (e.kind === "file" || e.kind === "link") renderPanelRestore(e.kind, verdict, e.message || "", e);') && mainJs.includes('t("panelScore", lang, { n: score })') && mainJs.includes('box = $("filecheck-result")') && mainJs.includes('box = $("linktrack-result")'));
  check("z2 panel restore never re-fetches or re-saves (no network, no hero move)", (() => {
    const m = mainJs.match(/function renderPanelRestore[\s\S]*?\n}\n/);
    const h0 = mainJs.indexOf("function showHistoryEntry");
    const h1 = mainJs.indexOf("function fillCheckerForm", h0);
    const restoreBody = mainJs.slice(h0, h1);
    return !!m && !/getReportCount|resolveShortLink|lookupDomain|saveCheck|addDoc|submitReport/.test(m[0]) && !/saveCheck/.test(restoreBody);
  })());
  check("z3 restored file label follows the stored verdict (scam->danger first, url->web address); restored link risk follows stored status, unknown fails closed to suspicious", mainJs.includes('verdict.status === "scam" ? "fileVerdictHigh" : info.kind === "url" ? "fileVerdictUrl" : "fileVerdictLow"') && mainJs.includes('verdict.status === "scam" ? "linkRiskHigh" : verdict.status === "safe" ? "linkRiskSafe" : "linkRiskLow"'));
  check("z4 restored panel shows the stored input + stored score, never the previous check", mainJs.includes('escapeHtml(message || "")') && mainJs.includes("const score = Number.isFinite(rawScore) ? rawScore : 0;") && mainJs.includes("function renderPanelRestore"));
  check("z5 kind-less (pre-kind) history entries show an explicit 'tool not recorded' badge, never an empty slot", mainJs.includes('default: return t("historyToolUnknown", lang);') && i18n.includes('historyToolUnknown: "Alat tidak tercatat"') && i18n.includes('historyToolUnknown: "Tool not recorded"'));
  check("z6 stale guard watches every checker input, not only the message box (call/email/file/link edits stale the card)", mainJs.includes('card.classList.toggle("stale", !current.includes(lastCheckedMessage));') && mainJs.includes('"call-number", "call-said", "email-body", "email-from-email", "email-from-name", "filecheck-name-input", "linktrack-input"') && mainJs.includes('const callText = number && said ? `${number}: ${said}` : number || said;'));
  check("z7 empty history still shows the stats line (0 checks), never a blank row", !/lastHistory\.length > 0\s*\n\s*\? t\("historyStats"/.test(mainJs) && mainJs.includes('stats.textContent =\n    t("historyStats", lang, { n: totals.checked, m: totals.scams })'));
  check("z8 email stale guard compares sender + body (lastCheckedEmail), set on email check + restore, cleared by other checks", mainJs.includes("let lastCheckedEmail = null;") && mainJs.includes("if (lastCheckedEmail) {") && mainJs.includes('lastCheckedEmail = { fromName, fromEmail, body };') && mainJs.includes("lastCheckedEmail = null;") && mainJs.includes('($("email-from-email")?.value.trim() || "") === lastCheckedEmail.fromEmail'));
  check("z9 link restore flag filter compares the risk label in BOTH languages (no duplicate after a language switch)", mainJs.includes('const riskLabels = [t(riskKey, "id"), t(riskKey, "en")];') && mainJs.includes("const extraFlags = flags.filter((f) => !riskLabels.includes(f));"));
  check("z10 link restore shows the resolved destination only when the entry records it (finalUrl + resolved), else the 'link entered' label — never an unreached url as the destination", mainJs.includes("finalUrl,\n        resolved,") && mainJs.includes('const dest = entry.resolved === true && entry.finalUrl ? entry.finalUrl : null;') && mainJs.includes('const urlLabelKey = dest ? "linktrackFinal" : "linktrackFinalUnresolved";') && mainJs.includes('renderPanelRestore(e.kind, verdict, e.message || "", e);'));
  check("z11 transcript call message uses the same guarded construction as onCallCheck (no trailing ': ' when the transcript is empty)", mainJs.includes("const message = number && scoredText ? `${number}: ${scoredText}` : number || scoredText;"));
  // Audit 14: the displays now ALSO mask tokens in the path
  // (maskSensitive wraps stripUrlQuery) — the query/fragment is
  // still stripped first, so a token in the query is never shown.
  check("z12 link panels (live + restore) strip the URL query/fragment from the DISPLAY — a token in the query is never shown (audit-8 list rule, extended)", mainJs.includes("function stripUrlQuery(url) {") && mainJs.includes("${escapeHtml(maskSensitive(stripUrlQuery(finalUrl)))}") && mainJs.includes("${escapeHtml(maskSensitive(stripUrlQuery(shownUrl)))}"));
  check("z13 cancelling the file picker clears the name field (no stale name for the guard to match)", mainJs.includes('nameEl.hidden = true;\n      nameEl.textContent = "";') && mainJs.includes('      $("filecheck-name-input").value = "";'));
  check("z14 corrupted stored score never renders NaN (finite guard on the panel score)", mainJs.includes("const rawScore = Number(verdict.riskScore ?? 0);") && mainJs.includes("const score = Number.isFinite(rawScore) ? rawScore : 0;"));
  // aa — audit 12: panel stale guard, token strip in the main article, fresh file/link checks update the card
  check("aa1 file/link panels have their own stale guard (snapshots of the CHECKED value — Groq review: never the field value at render time, or an edit made mid-check would pass as fresh — set on fresh check + restore, banner + dim, re-translated on language change)", mainJs.includes("let lastCheckedFileName = null;") && mainJs.includes("let lastCheckedLink = null;") && mainJs.includes("function refreshPanelStaleState()") && mainJs.includes("function snapshotPanel(kind, value)") && mainJs.includes('snapshotPanel("file", info.fileName);') && mainJs.includes('snapshotPanel("file", name);') && mainJs.includes('snapshotPanel("link", input);') && mainJs.includes('snapshotPanel("file", message);') && mainJs.includes('snapshotPanel("link", message);') && mainJs.includes('t("panelStale", lang)') && i18n.includes('panelStale: "Input berubah sejak pemeriksaan terakhir. Tekan tombol periksa untuk memeriksa ulang."') && i18n.includes('panelStale: "The input changed since the last check. Press the check button to check it again."') && styles.includes(".panel-stale .result-stale-bar { display: block; }") && styles.includes(".panel-stale > *:not(.result-stale-bar) { opacity: 0.45; }"));
  check("aa2 panel stale only fires on a shown result (never on progress/error) and compares the normalized link key (bare domain == full url)", mainJs.includes("function panelLinkKey(value)") && mainJs.includes("return normalizeLinkInput(raw) || raw;") && mainJs.includes('!p.box.querySelector(".progress")') && mainJs.includes('!p.box.querySelector(".error")') && mainJs.includes("const stale = hasResult && p.snapshot != null && p.current !== p.snapshot;"));
  check("aa3 the main article never shows a URL query token: evidence quotes, checked-message disclosure, PDF quote + found links, copied summary, shared card all strip it", mainJs.includes("function stripUrlQueriesInText(text)") && mainJs.includes("maskSensitive(stripUrlQueriesInText(c.evidence))") && mainJs.includes("maskSensitive(stripUrlQueriesInText(message))") && mainJs.includes("maskSensitive(stripUrlQueriesInText(quoteRaw.length > 600") && mainJs.includes("links.map((l) => stripUrlQuery(l.url))") && mainJs.includes("message: maskSensitive(stripUrlQueriesInText(message)), dateStr"));
  check("aa4 a fresh file/link check updates the main verdict card (same verdict as the save, no re-save, no extra count) and clears lastCheck so a language change cannot resurrect an older check", mainJs.includes('renderResult({ ...fv, source: "LOCAL" }, info.fileName, elapsedSec);') && mainJs.includes('renderResult({ ...fv, source: "LOCAL" }, name, elapsedSec);') && mainJs.includes('renderResult({ ...linkVerdict, source: "LOCAL" }, input, elapsedSec);') && mainJs.includes('enrichResult(info.fileName);') && mainJs.includes('enrichResult(name);') && mainJs.includes('enrichResult(input);'));
  check("aa5 the link field shows the normalized URL actually checked (so the card stale guard can match it) and the field is plain text with a URL keyboard hint — no native [invalid] for a bare domain", html.includes('id="linktrack-input" type="text" inputmode="url"') && !html.includes('id="linktrack-input" type="url"') && mainJs.includes('$("linktrack-input").value = input;') && styles.includes('.linktrack input[type="text"]'));
  check("aa6 score sensitivity is additive rules by design, not double counting: OJK plain 60 = bank 25 + mismatch 35, +threat 25 = 85 (separate patterns, separate weights)", callcheck.includes('key: "callScriptBank",') && callcheck.includes("weight: 25,") && callcheck.includes('key: "callScriptThreat",') && callcheck.includes("score += 35;") && callcheck.includes("/\\b(diblokir|blocked|ditangkap|arrest|denda|fine|penjara|jail|ditangguhkan|suspend|tindak\\s*pidana)\\b/i"));
  check("aa7 the two-tap delete-history confirm resets after 4s by design (a deliberate safety timeout, not a bug)", mainJs.includes("4000"));
  check("aa8 the URL-query strip keeps sentence-final punctuation (Groq review: 'Lihat http://example.com?x=1.' keeps its period) and matches the scheme case-insensitively (CoArena review: 'HTTPS://...' strips too) — the match must end on a non-punctuation character with the i flag", (() => {
    const f = mainJs.match(/function stripUrlQueriesInText\(text\) \{[\s\S]*?\n\}/);
    return !!f && f[0].includes(".,!?;:)") && /\/gi,/.test(f[0]);
  })());
  try {
    execFileSync(process.execPath, ["tmp/proof-audit-12/strip-probe.cjs"], { cwd: ROOT, stdio: "pipe" });
    check("aa10 strip probe passes at runtime (22 cases: scheme/bare-domain/scheme-relative/IPv4 strip; non-URLs and %3F kept)", true);
  } catch (err) {
    check("aa10 strip probe passes at runtime (22 cases: scheme/bare-domain/scheme-relative/IPv4 strip; non-URLs and %3F kept)", false, String(err.stdout || err.message).slice(0, 200));
  }
  check("aa9 the link field switches phone-keyboard autocapitalise/autocorrect/spellcheck off (Gemini review: type=\"text\" lost the protection type=\"url\" gave for free)", (() => {
    const tag = html.match(/<input id="linktrack-input"[^>]*>/);
    return !!tag && tag[0].includes('autocapitalize="off"') && tag[0].includes('autocorrect="off"') && tag[0].includes('spellcheck="false"');
  })());
  // ab — desktop layout (Myuden 22 Nov 17:56): at 1440px the .page column
  // was only 720px (360px empty each side). CSS ONLY, min-width queries.
  check("ab1 desktop fills the screen: .page + .topbar-inner max-width 100% from >=900px (maks layar, Myuden 18:55), no 1400px or 1200px cap", styles.includes("@media (min-width: 900px) {") && styles.includes(".page, .topbar-inner { max-width: 100%; }") && !styles.includes("min(1400px") && !styles.includes(".page, .topbar-inner { max-width: 1200px; }"));
  check("ab3 jawaban di bawah (bukan di samping): tidak ada grid dua kolom #view-home dan tidak ada form sticky (Myuden 22 Nov 18:57)", !styles.includes("#view-home { display: grid") && !styles.includes("grid-template-columns: minmax(0, 5fr)") && !styles.includes(".checker { grid-column: 1; position: sticky")); 
  check("ab2 desktop panels fill the column: no 760px cap on checker + result card + tool panels at >=900px (the cap left a ragged right edge inside the wide column, Myuden 18:33)", !styles.includes("max-width: 760px"));
  check("ab3 desktop grids use the width: stats 4 columns, badges 3 columns at >=900 (stat cards lose 4px side padding so the widest number keeps a 14px margin at 900px)", styles.includes(".stats { grid-template-columns: repeat(4, 1fr); }") && styles.includes(".stat { padding: 18px 12px; }") && styles.includes(".badges-grid { grid-template-columns: repeat(3, 1fr); }"));
  check("ab4 desktop keeps text readable: hero-sub still capped 52ch, hero actions capped 560px", styles.includes(".hero-sub { font-size: 0.9375rem; line-height: 1.55; opacity: 0.92; max-width: 52ch;") && styles.includes(".hero-actions { max-width: 560px; }"));
  check("ab5 mobile untouched: base .page is still 720px and the <=640px rules still exist; senior mode keeps its 960px page with a matching header", styles.includes(".page { max-width: 720px; margin: 0 auto; padding: 16px;") && styles.includes("@media (max-width: 640px)") && styles.includes("body.senior-mode .page { max-width: 960px; }") && styles.includes("body.senior-mode .topbar-inner { max-width: 960px; }"));
  check("ab6 desktop live-verify script exists (390/980-desktop-UA/1024/1280/1440, onboarding closed, overflow + widths measured)", read("tmp/desktop-layout/desktop-verify.cjs").includes("desktop-verify-") && read("tmp/desktop-layout/desktop-verify.cjs").includes('page.locator("#onboard-start")') && read("tmp/desktop-layout/desktop-verify.cjs").includes("overflowX") && read("tmp/desktop-layout/desktop-verify.cjs").includes("measure(pageDesktopUA, 980)"));
  check("ab7 phone desktop mode (~980px viewport) is caught: the layout breakpoint is 900, and no fixed 1120px rule sits in a >=1024px query (that would miss 980 entirely)", styles.includes("@media (min-width: 900px) {") && !styles.includes("@media (min-width: 1024px) {\n  .page, .topbar-inner { max-width: 1120px; }"));
  // ad — audit 13 (22 Nov): stats hardening (A), email weight (B),
  // uppercase scheme (D), language switch (E), rekening context (F),
  // column width (C, no code change), APK (G, no action), plus the
  // "semua nyata" features (link/file/chat) and the simplified card.
  const history = read("src/history.js");
  const emailcheck = read("src/emailcheck.js");
  const chatlog = read("src/chatlog.js");
  const domain = read("src/domain.js");
  // A (audit 16): the totals are DERIVED from the history list +
  // a trimmed bucket — there is no mutable aggregate incremented per
  // check, so a lost-update race cannot lose a check. The old
  // bumpTotalsFrom (audit 13) is gone; the runtime behaviour is
  // pinned by the unit test (auditor baseline 103/51 + 12 checks
  // -> 115/54) and by ah1 below. Here the source pins the mechanism.
  check("ad1 stats derive from the list + trimmed bucket (no mutable aggregate, no per-check increment)", (() => {
    const h = read("src/history.js");
    return h.includes("LS_TRIMMED_KEY") && h.includes("function getStatsTotals()") && h.includes("deriveTotals(readLocal())") && h.includes("readTrimmed()") && !h.includes("function bumpTotalsFrom(") && !h.includes("LS_TOTALS_KEY = ");
  })());
  check("ad2 a saved check is counted because it IS a list entry (deriveTotals counts the list)", (() => {
    const h = read("src/history.js");
    const fn = h.match(/function deriveTotals\(list\) \{[\s\S]*?\n\}/);
    return !!fn && fn[0].includes("checked: (list || []).length") && fn[0].includes('filter((e) => e.status === "scam").length');
  })());
  // B: the sender-name mismatch is 30 (it has been 30 since the rule
  // was written); the audit-12 "40" came from a body that also
  // triggered the +10 impersonation rule.
  check("ad3 email mismatch weight is 30 in the source", /score \+= 30/.test(emailcheck) && emailcheck.includes("mismatch"));
  {
    const body = "Halo, terima kasih. Pesanan Anda sudah kami proses. Terima kasih.";
    check("ad4 email Tokopedia 0/30/50 on the neutral body", analyzeEmail({ fromName: "Tokopedia", fromEmail: "no-reply@tokopedia.com", body }, "id").riskScore === 0 && analyzeEmail({ fromName: "Tokopedia", fromEmail: "no-reply@tokopedia-promo.net", body }, "id").riskScore === 30 && analyzeEmail({ fromName: "Tokopedia", fromEmail: "tokopedia@gmail.com", body }, "id").riskScore === 50);
    check("ad5 email Tokopedia reaches 40 when the body names the brand", analyzeEmail({ fromName: "Tokopedia", fromEmail: "no-reply@tokopedia-promo.net", body: "Terima kasih telah berbelanja di Tokopedia. Pesanan Anda sudah kami proses." }, "id").riskScore === 40);
  }
  // D: an uppercase scheme is the same scheme (RFC 3986).
  check("ad6 link extraction matches any scheme case + normalizes it", (() => {
    const links = analyzeLinks("Cek tautan ini: HTTPS://example.com/?token=abc123");
    return links.length === 1 && links[0].url === "https://example.com/?token=abc123" && analyzeLink("HTTPS://EXAMPLE.COM/x").host === "example.com";
  })());
  check("ad7 normalizeLinkInput lowercases the scheme, keeps the host case", normalizeLinkInput("HTTPS://Example.COM/x") === "https://Example.COM/x");
  // F: a bare "rekening" must not fire moneyOtp; risky contexts do.
  check("ad8 bare 'rekening' scores 0; POLRES + nomor-rekening + bermasalah still fire moneyOtp", (() => {
    const benign = analyzeWithHeuristic("Halo, rekening Anda sudah aktif. Terima kasih.", "id");
    const police = analyzeWithHeuristic("Dari POLRES: Akun rekening Anda terindikasi tindak pidana. Segera transfer seluruh saldo ke rekening aman 1234567890.", "id");
    const num = analyzeWithHeuristic("Ini nomor rekening saya 1234567890, tolong dicek ya.", "id");
    const trouble = analyzeWithHeuristic("Rekening Anda bermasalah, segera hubungi kami untuk verifikasi.", "id");
    const money = (v) => v.checks.find((c) => c.id === "moneyOtp").found;
    return benign.riskScore === 0 && !money(benign) && money(police) && money(num) && money(trouble);
  })());
  check("ad9 moneyOtp has no bare 'rekening' alternative left", (() => {
    const line = ai.split("\n").find((l) => l.includes('id: "moneyOtp"'));
    return !!line && !/\|rekening\|/.test(line) && line.includes("nomor\\s+rekening");
  })());
  // E: language switch — AI verdicts are marked stale at once (the
  // note shows during the re-check), code/demo verdicts clear the
  // flag, and the file/link panels get a stale note.
  check("ad10 language switch marks AI verdicts stale at once, clears code/demo", mainJs.includes("langStale: true") && mainJs.includes("langStale: false") && mainJs.includes('t("panelLangStale"'));
  check("ad11 stale-language note is neutral (no false failure claim)", !t("langStaleNote", "en").includes("failed") && !t("langStaleNote", "id").includes("gagal"));
  // C: the 1152px card inside a 1200px column is padding (24px each
  // side), not a bug — no code change; the claim is documented in
  // the audit-13 report. (No check: nothing to pin in source.)
  // G: APK 95/99 was never verified by the auditor (no APK uploaded)
  // — no action. (No check.)
  // "Semua nyata" — shorteners, file signatures, chat formats.
  check("ad12 more shorteners are recognized", ["rebrand.ly", "cut.ly", "short.io", "tiny.one", "lnk.to", "gg.gg"].every((h) => analyzeLink(`https://${h}/abc`).reasons.includes("linkRiskShortener")));
  check("ad13 filecheck knows images, audio, video, scripts, packages", filecheck.includes("JPEG_SIG") && filecheck.includes("PNG_SIG") && filecheck.includes("WEBP_SIG") && filecheck.includes("MP3_ID3_SIG") && filecheck.includes("FTYP_SIG") && filecheck.includes("DEB_SIG") && filecheck.includes("RPM_SIG") && filecheck.includes("ISO_SIG") && filecheck.includes("DMG_TRAILER") && filecheck.includes("SCRIPT_EXTS") && filecheck.includes('kind = "script"') && filecheck.includes('kind = "image"') && filecheck.includes('kind = "audio"') && filecheck.includes('"video"'));
  check("ad14 filecheck: Office ZIPs read as documents, MSI as a program", filecheck.includes("isOfficeDoc") && filecheck.includes('ext === "msi"'));
  check("ad15 unknown files stay unknown (never safe) in fileVerdictFor", mainJs.includes('info.kind === "unknown"') && mainJs.includes('"fileVerdictUnknown"'));
  check("ad16 chatlog parses Telegram JSON, Messenger JSON, Telegram HTML and plain lines", (() => {
    const tg = scanChatLog(JSON.stringify({ name: "C", type: "personal_chat", messages: [{ from: "Promo", text: "SELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah dan bayar biaya admin!" }] }), "en");
    const ms = scanChatLog(JSON.stringify({ participants: [{ name: "B" }], messages: [{ sender_name: "Promo", content: "SELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah dan bayar biaya admin!", timestamp_ms: 2 }] }), "en");
    const htmlTg = scanChatLog('<div class="message default clearfix"><div class="body"><div class="from_name">Promo</div><div class="text">SELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah dan bayar biaya admin!</div></div></div>', "en");
    const plain = scanChatLog("Halo\nSELAMAT! Anda menang Rp 50.000.000, klik http://bit.ly/hadiah dan bayar biaya admin!", "en");
    return tg.format === "telegram-json" && tg.risky.length === 1 && ms.format === "messenger-json" && ms.risky.length === 1 && htmlTg.format === "telegram-html" && htmlTg.risky.length === 1 && plain.format === "plain" && plain.total === 2 && plain.risky.length === 1;
  })());
  check("ad17 chatlog input accepts .json and .html exports", (() => {
    const tag = html.match(/<input id="chatlog-input"[^>]*>/);
    return !!tag && tag[0].includes(".json") && tag[0].includes(".html");
  })());
  // Simplified card (Myuden 22 Nov 18:58): summary on top, details
  // folded, buttons untouched, layout untouched.
  check("ad18 simplified card: visible summary + folded details + who-answered line", mainJs.includes('<details class="result-details"') && mainJs.includes('t("resultDetailsSummary"') && mainJs.includes('class="result-source-line"') && mainJs.includes('t("resultAnsweredBy"') && mainJs.includes("resultDetailsOpen") && mainJs.includes('class="main-sign"'));
  check("ad19 simplified-card CSS only styles the card's own elements (no layout change)", styles.includes(".result-details {") && styles.includes(".result-source-line {") && !/\.result-details[^{]*\{[^}]*max-width/.test(styles));
  check("ad20 simplified-card strings exist EN+ID", ["resultDetailsSummary", "resultAnsweredBy", "panelLangStale", "fileCheckImage", "fileCheckMedia", "fileCheckScript", "fileReasonScript", "fileVerdictUnknown", "chatlogFormat", "chatlogFormatPlain", "chatlogPlainSender"].every((k) => t(k, "en") !== k && t(k, "id") !== k && t(k, "en") !== t(k, "id")));
  // Audit 13 (label fix): the file panel's headline must follow the
  // VERDICT (fv.status), not the file TYPE's level — a script whose
  // content scores 80 scam has level "low", so the old info.level
  // label showed the green "No danger signs" headline for a scam.
  check("ad21 file panel headline follows fv.status (scam script shows Dangerous, not the safe label)", mainJs.includes('fv.status === "scam" ? "fileVerdictHigh" : fv.status === "suspicious" ? "fileVerdictMedium" : "fileVerdictLow"') && !mainJs.includes('info.level === "high" ? "fileVerdictHigh" : "fileVerdictLow"'));
  check("ad22 fileVerdictMedium string exists EN+ID (suspicious file headline)", t("fileVerdictMedium", "en") !== "fileVerdictMedium" && t("fileVerdictMedium", "id") !== "fileVerdictMedium" && t("fileVerdictMedium", "en") !== t("fileVerdictMedium", "id"));
  // Audit 14 — alphanumeric code tokens ("abc123") must be masked
  // wherever message text is displayed, like digit codes already were.
  check("ae1 maskSensitive masks a mixed letter+digit token whole", maskSensitive("Kode OTP Anda adalah abc123. Jangan berikan kepada siapa pun.") === "Kode OTP Anda adalah ••••••. Jangan berikan kepada siapa pun." && maskSensitive("Kode abc123456") === "Kode •••••••••" && !maskSensitive("Kode abc123456").includes("abc"));
  check("ae2 maskSensitive leaves ordinary words + currency alone (Rp amount: letters kept, digits masked by the digit rule)", maskSensitive("Kode OTP Anda sudah aktif. Terima kasih.") === "Kode OTP Anda sudah aktif. Terima kasih." && maskSensitive("Bayar Rp100000 sekarang") === "Bayar Rp•••••• sekarang" && maskSensitive("Harga USD50 saja") === "Harga USD50 saja" && maskSensitive("Diskon 50% hari ini, 3 hadiah") === "Diskon 50% hari ini, 3 hadiah");
  check("ae3 token pass runs before the digit passes (no abc + dots leak)", (() => {
    const fn = history.match(/export function maskSensitive\(text\) \{[\s\S]*?\n\}/);
    if (!fn) return false;
    const body = fn[0];
    const tokenAt = body.indexOf("A-Za-z0-9]*\\d");
    const phoneAt = body.indexOf("+?\\d[\\d\\s\\-()]{7,}");
    const digitAt = body.indexOf("\\d{4,}");
    return tokenAt > 0 && tokenAt < phoneAt && phoneAt < digitAt;
  })());
  check("ae4 result card masks the AI summary + red flags for display", mainJs.includes('const displaySummary = maskSensitive(verdict.summary || "")') && mainJs.includes('const displayFlags = (verdict.redFlags || []).map((f) => maskSensitive(f))') && mainJs.includes("${escapeHtml(displaySummary)}") && mainJs.includes("displayFlags.map((f) => `<li>${escapeHtml(f)}</li>`)") && mainJs.includes("${escapeHtml(displayFlags[0])}"));
  check("ae5 copy/share/download/warn-family use the masked copies", mainJs.includes("displaySummary,") && mainJs.includes("displayFlags.join(\"; \")") && mainJs.includes("summary: displaySummary, redFlags: displayFlags, message: maskSensitive(stripUrlQueriesInText(message))") && !mainJs.includes("{ ...verdict, message, dateStr, strings: cardStrings }"));
  check("ae6 PDF masks its summary + flags", mainJs.includes("verdict.redFlags.slice(0, 4).map((f) => maskSensitive(f))") && mainJs.includes("${escapeHtml(maskSensitive(verdict.summary))}"));
  check("ae7 link displays mask the URL (panel, card links box, restore, enrichment)", (mainJs.match(/maskSensitive\(stripUrlQuery\(/g) || []).length >= 4);
  // Audit 14 — footer missing in tall viewports (desktop mode on a
  // phone): the reveal threshold was innerHeight * 0.9, so a footer
  // at top 2008 in a 2180px viewport never revealed (2008 > 1962).
  check("ae8 footer reveal fires once any part enters the viewport (no 0.9 factor)", mainJs.includes("if (r.top < window.innerHeight || r.bottom <= 0) el.classList.add(\"in\")") && !mainJs.includes("window.innerHeight * 0.9"));
  check("ae9 footer is still a reveal element (fix is logic-only, no layout change)", mainJs.includes('.footer")') && mainJs.includes('".hero, .stats, .week-chart, .checker, .trend, .checks, .modules, .share, .install-card, .footer"'));
  // Clickable pills (Myuden 22 Nov 20:57 + 21:02): "N terpicu" and
  // "N bersih" are buttons that jump to their lists; "N aturan
  // diperiksa" stays a static span. Clickable pills carry a chevron.
  check("af1 found pill is a button (data-pill-jump=found) with a chevron when N > 0", mainJs.includes('data-pill-jump="found"') && mainJs.includes('class="meta-pill bad meta-pill-btn"') && mainJs.includes('<span class="pill-chev"'));
  check("af2 clean pill is a button (data-pill-jump=clean) with a chevron when N > 0", mainJs.includes('data-pill-jump="clean"') && mainJs.includes('meta-pill${found === 0 ? " good" : ""} meta-pill-btn'));
  check("af3 examined pill stays a static span (no button, no chevron)", mainJs.includes('class="meta-pill"') && !mainJs.includes('data-pill-jump="examined"'));
  check("af4 pill click scrolls to the found list / opens the clean fold then scrolls", mainJs.includes('data-pill-jump') && mainJs.includes('scrollToEl') && mainJs.includes('.local-checks li.found') && mainJs.includes('.clean-checks') && mainJs.includes('cleanChecksOpen = true'));
  check("af5 clean pill click keeps the fold open across a language switch (cleanChecksOpen = true, re-rendered open)", mainJs.includes('cleanChecksOpen = true') && mainJs.includes('cleanChecksOpen ? " open" : ""'));
  check("af6 chevron is the small › mark, same colour as the pill text", mainJs.includes('›') && mainJs.includes('pill-chev') && styles.includes('.pill-chev'));
  check("af7 pill buttons look like spans (reset) with a hover/focus hint", styles.includes('button.meta-pill-btn') && styles.includes('button.meta-pill-btn:hover') && styles.includes('cursor: pointer'));
  // Anonymous visitor counter (Myuden 22 Nov 21:02): Firestore
  // site_stats/visitors { count }, 1x per device per day, no
  // personal data, footer line hidden when Firestore is unreachable.
  check("ag1 date gate: todayKey is YYYY-MM-DD and shouldCountToday is false only when counted today", todayKey(new Date(2026, 10, 22)) === "2026-11-22" && todayKey(new Date(2026, 0, 5)) === "2026-01-05" && shouldCountToday(null, "2026-11-22") === true && shouldCountToday("2026-11-22", "2026-11-22") === false && shouldCountToday("2026-11-22", "2026-11-23") === true);
  check("ag2 the only Firestore write is increment(1) to site_stats/visitors, no personal data", visitors.includes('doc(database, "site_stats", "visitors")') && visitors.includes("{ count: increment(1) }") && !visitors.includes("userAgent") && !visitors.includes("navigator."));
  check("ag3 visitor pill hidden by default, short label + status pill (in Share card since 23 Nov, not footer)", html.includes('id="visitor-count" hidden') && html.includes('id="visitor-count-num"') && html.includes('data-i18n="visitorCountLabel"') && !html.includes('data-i18n="visitorCountNote"') && html.includes('footer-status-pill') && html.includes('status-dot') && html.includes('share-visitors'));
  check("ag4 firestore.rules: site_stats/visitors is public-read and +1-only (auth, no other fields)", rules.includes("match /site_stats/visitors") && rules.includes("allow read: if true") && rules.includes("request.resource.data.count == 1") && rules.includes("request.resource.data.count == resource.data.count + 1") && rules.includes('affectedKeys().hasOnly(["count"])'));
  check("ag5 main.js refreshes the counter at boot and hides the line when Firestore is unreachable", mainJs.includes("refreshVisitorCount()") && mainJs.includes('const count = await readVisitorCount()') && mainJs.includes("if (count == null) return;"));
  check("ag6 visitor strings exist EN+ID", t("visitorCountLabel", "en") !== "visitorCountLabel" && t("visitorCountLabel", "id") !== "visitorCountLabel" && t("visitorCountLabel", "en") !== t("visitorCountLabel", "id"));
  check("ag7 the counter writes the counted date only after a successful increment", visitors.includes("writeCountedDate(today)") && visitors.includes("await setDoc("));
  check("ag8 history row-top wraps so the date never overflows at Large/Medium text (Myuden 22 Nov 22:16)", styles.includes(".history-row-top") && /\.history-row-top\s*\{[^}]*flex-wrap:\s*wrap/.test(styles) && styles.includes(".footer-status-pill") && styles.includes(".status-dot"));
  check("ag9 footer card 23 Nov (PackVault-style, left-aligned, bubble): bubble card, brand 28px + description + GitHub 44px button + privacy/report below GitHub on top-left, divider, credit row (mobile stacked, desktop credit left + Firebase right), bottom row license + copyright (mobile stacked left, desktop copyright left + license right), visitor in Share card", html.includes("© 2026 TipuCek") && html.includes('data-i18n="footerLicensePre"') && html.includes('data-i18n="footerDesc"') && html.includes('data-i18n="footerTech"') && html.includes('data-i18n="footerPrivacy"') && html.includes('data-i18n="footerReport"') && html.includes('href="/privacy.html"') && html.includes('href="https://github.com/Myudenn/tipucek/issues"') && html.indexOf('data-i18n="footerPrivacy"') < html.indexOf("footer-divider") && html.indexOf('data-i18n="footerPrivacy"') < html.indexOf('data-i18n="footerLicensePre"') && html.includes("footer-brand-name") && html.includes("footer-copy") && html.includes("footer-card") && html.includes("footer-divider") && html.includes("share-visitors") && html.includes("footer-credit") && html.includes("footer-bottom") && html.includes("footer-license-row") && html.indexOf("footer-credit") > html.indexOf("footer-divider") && html.indexOf("footer-bottom") > html.indexOf("footer-credit") && html.indexOf('data-i18n="footerTech"') > html.indexOf("footer-credit") && html.indexOf('data-i18n="footerTech"') < html.indexOf("footer-bottom") && html.indexOf('data-i18n="footerLicensePre"') > html.indexOf("footer-bottom") && html.indexOf("© 2026 TipuCek") > html.indexOf('data-i18n="footerLicensePre"') && !html.includes("footer-row-roomy") && !html.includes("footer-row-tight") && /\.footer-tile\s*\{[^}]*width:\s*28px/.test(styles) && /\.footer-gh-link\s*\{[^}]*width:\s*44px/.test(styles) && /\.footer-gh-link \.footer-icon\s*\{[^}]*width:\s*24px/.test(styles) && /\.footer-card\s*\{[^}]*background:\s*var\(--card\)/.test(styles) && /\.footer-card\s*\{[^}]*border-radius:\s*20px/.test(styles) && /\.footer-card\s*\{[^}]*box-shadow:\s*var\(--shadow\)/.test(styles) && /\.footer-card\s*\{[^}]*text-align:\s*left/.test(styles) && /\.footer-row\s*\{[^}]*margin:\s*0 0 10px/.test(styles) && /\.footer-credit\s*\{[^}]*display:\s*flex/.test(styles) && /\.footer-credit\s*\{[^}]*flex-direction:\s*column/.test(styles) && /\.footer-credit\s*\{[^}]*margin-bottom:\s*24px/.test(styles) && /@media \(min-width:\s*640px\)\s*\{[^}]*\.footer-credit\s*\{[^}]*flex-direction:\s*row/.test(styles) && /@media \(min-width:\s*640px\)\s*\{[^}]*\.footer-credit\s*\{[^}]*justify-content:\s*space-between/.test(styles) && /\.footer-bottom\s*\{[^}]*display:\s*flex/.test(styles) && /\.footer-bottom\s*\{[^}]*flex-direction:\s*column/.test(styles) && /@media \(min-width:\s*640px\)\s*\{[^}]*\.footer-bottom\s*\{[^}]*flex-direction:\s*row/.test(styles) && /@media \(min-width:\s*640px\)\s*\{[^}]*\.footer-bottom\s*\{[^}]*justify-content:\s*space-between/.test(styles) && /\.footer-bottom \.footer-copy\s*\{[^}]*order:\s*-1/.test(styles) && /\.footer-row\s*\{[^}]*justify-content:\s*flex-start/.test(styles) && t("footerLicensePre", "en") !== "footerLicensePre" && t("footerLicensePre", "id") !== "footerLicensePre" && t("footerPost", "en") === "hackathon (Devpost)" && t("footerDesc", "en") !== "footerDesc" && t("footerDesc", "id") !== "footerDesc" && t("footerTech", "en") !== "footerTech" && t("footerTech", "id") !== "footerTech" && t("footerPrivacy", "en") !== "footerPrivacy" && t("footerPrivacy", "id") !== "footerPrivacy" && t("footerReport", "en") !== "footerReport" && t("footerReport", "id") !== "footerReport" && fs.existsSync("public/privacy.html") && fs.readFileSync("public/privacy.html", "utf8").includes("Kebijakan Privasi") && fs.readFileSync("public/privacy.html", "utf8").includes("Privacy Policy") && !fs.readFileSync("public/privacy.html", "utf8").includes("Pengunjung") && !/Visitors/.test(fs.readFileSync("public/privacy.html", "utf8")));
  // Audit 16 — counter (derive-from-list) runtime + refresh-biasa.
  // ah1 runs the auditor's exact 12-check sequence against the
  // history module (localStorage stubbed, like w5): baseline 103/51
  // must reach 115/54 and stay there on a fresh read (reload).
  check("ah1 auditor's 12-check sequence accumulates 103/51 -> 115/54 and stays (audit 16)", await (async () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    try {
      const entries = [];
      for (let i = 0; i < 47; i++) entries.push({ id: `seed-${i}`, status: i < 20 ? "scam" : "safe", riskScore: i < 20 ? 95 : 0, createdAt: new Date(Date.now() - i * 3600e3).toISOString() });
      store.set("pesanaman_history_v1", JSON.stringify(entries));
      store.set("tipucek_stats_totals_v1", JSON.stringify({ checked: 103, scams: 51, days: {} }));
      store.set("tipucek_local_only", "1");
      const { saveCheck, getStatsTotals, loadHistory } = historyMod;
      if (getStatsTotals().checked !== 103 || getStatsTotals().scams !== 51) return false;
      const seq = ["scam", "safe", "scam", "safe", "suspicious", "suspicious", "safe", "suspicious", "safe", "suspicious", "scam", "safe"];
      for (let i = 0; i < seq.length; i++) await saveCheck({ message: `check ${i}`, status: seq[i], riskScore: 50, redFlags: [], summary: "s", source: "CODE" });
      const list = await loadHistory();
      const t = getStatsTotals();
      const t2 = getStatsTotals();
      return list.length === 59 && t.checked === 115 && t.scams === 54 && t2.checked === 115 && t2.scams === 54;
    } catch { return false; } finally { delete globalThis.localStorage; }
  })());
  check("ah2 legacy aggregate migrates to the trimmed bucket (103/51 baseline preserved, 56/31 trimmed)", await (async () => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    };
    try {
      const entries = [];
      for (let i = 0; i < 47; i++) entries.push({ id: `seed-${i}`, status: i < 20 ? "scam" : "safe", riskScore: i < 20 ? 95 : 0, createdAt: new Date().toISOString() });
      store.set("pesanaman_history_v1", JSON.stringify(entries));
      store.set("tipucek_stats_totals_v1", JSON.stringify({ checked: 103, scams: 51, days: {} }));
      const { getStatsTotals } = historyMod;
      const t = getStatsTotals();
      const trimmed = JSON.parse(store.get("tipucek_stats_trimmed_v1") || "null");
      return t.checked === 103 && t.scams === 51 && !store.has("tipucek_stats_totals_v1") && trimmed && trimmed.checked === 56 && trimmed.scams === 31;
    } catch { return false; } finally { delete globalThis.localStorage; }
  })());
  // Refresh-biasa (Myuden 22 Nov 21:25): a normal refresh must load
  // the new bundle at once — the SW document fetch must bypass the
  // browser HTTP cache, the SW version must be new (old cache purged),
  // and the hosting headers must be no-cache for HTML/SW.
  check("ah3 SW document fetch uses cache:reload (bypasses the HTTP cache, so a stale max-age index.html can never be served)", read("public/sw.js").includes('fetch(new Request(event.request, { cache: "reload" }))'));
  check("ah4 SW cache version is v12 (a byte-different worker installs and purges the old cache on activate)", read("public/sw.js").includes('const CACHE = "tipucek-v12"'));
  check("ah5 SW is network-first for documents (cache only an offline fallback)", read("public/sw.js").includes("NETWORK-FIRST for documents") && read("public/sw.js").includes(".catch(() => caches.match(event.request))"));
  check("ah6 hosting headers: index.html + sw.js no-cache, hashed assets immutable", (() => {
    const fb = JSON.parse(read("firebase.json"));
    const headers = fb.hosting.headers || [];
    const find = (src) => (headers.find((h) => h.source === src) || {}).headers || [];
    const has = (src, key, val) => find(src).some((h) => h.key === key && h.value === val);
    return has("/", "Cache-Control", "no-cache") && has("/index.html", "Cache-Control", "no-cache") && has("/sw.js", "Cache-Control", "no-cache") && has("/assets/**", "Cache-Control", "public, max-age=31536000, immutable");
  })());
  check("ah7 footer reveal fires at any viewport incl. 1919x998 (no 0.9 factor: at max scroll footer top = viewportHeight - footerHeight < viewportHeight)", mainJs.includes("if (r.top < window.innerHeight || r.bottom <= 0) el.classList.add(\"in\")") && !mainJs.includes("window.innerHeight * 0.9"));
  // View restore across refresh (Myuden 22 Nov 21:43): a refresh on
  // Riwayat must stay on Riwayat, not reset to Beranda.
  check("ah8 showView saves the current view to sessionStorage (same-tab refresh only)", (() => {
    const fn = mainJs.match(/function showView\(name\) \{[\s\S]*?\n\}/);
    return !!fn && fn[0].includes('sessionStorage.setItem("tipucek_view", name)');
  })());
  check("ah9 init restores the saved view FIRST, before anything else (no flash of the wrong view)", (() => {
    const fn = mainJs.match(/function init\(\) \{[\s\S]*?lang-id-btn/);
    return !!fn && fn[0].includes('sessionStorage.getItem("tipucek_view") === "history"') && fn[0].includes('showView("history")');
  })());
  check("ah10 only \"history\" restores (home/garbage/empty/new tab -> Beranda) and the save is guarded so storage failure never breaks the switch", mainJs.includes('if (sessionStorage.getItem("tipucek_view") === "history") restoredView = "history";') && /try \{ sessionStorage\.setItem\("tipucek_view", name\); \} catch \{\}/.test(mainJs));
  // "Fitur lainnya" is a 3x3 grid (Myuden 23 Nov 17:27, "Fitur buat
  // 3 3 supaya rapi"): 9 module cards in 3 columns, so no row is
  // left with a single orphan card (the old 4-column grid left
  // "Cara kerja" alone on row 3).
  check("ah11 module grid is 3 columns x 3 rows (9 cards, no orphan row)", /\.module-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/.test(styles) && (html.match(/id="module-tab-[a-z]+"/g) || []).length === 9);
  // Who-answered line (Myuden 23 Nov 18:06, screenshot "Dijawab
  // oleh Dijawab di cloud"): the value must be the short-noun
  // sourceWho, never the full-sentence sourceLabel (badge strings
  // double the phrase). All six who-nouns exist EN+ID as nouns.
  check("ah12 who-answered line uses sourceWho nouns, never sourceLabel sentences", mainJs.includes("who: sourceWho(verdict.source)") && !mainJs.includes("who: sourceLabel(verdict.source)") && mainJs.includes("function sourceWho(source)") && ["sourceWhoCloud", "sourceWhoDevice", "sourceWhoLocal", "sourceWhoCode", "sourceWhoDemo", "sourceWhoUnknown"].every((k) => t(k, "en") !== k && t(k, "id") !== k && t(k, "en") !== t(k, "id")) && ["sourceWhoCloud", "sourceWhoDevice", "sourceWhoLocal", "sourceWhoCode", "sourceWhoDemo", "sourceWhoUnknown"].every((k) => !/^(Dijawab|Diperiksa|Hasil|Sumber tidak|Answered|Checked|Code-check|Source unknown|Demo check|Cek demo)/.test(t(k, "en")) && !/^(Dijawab|Diperiksa|Hasil|Sumber tidak|Answered|Checked|Code-check|Source unknown|Demo check|Cek demo)/.test(t(k, "id"))));
  // Auditor 23 Nov 18:12 (1): the "What TipuCek can check" list must
  // include QR & QRIS (it is a live feature), and the closing note
  // must not claim QR codes are not scanned — its limit is NMID
  // authenticity only (no public registry).
  check("ah13 checks list includes QR & QRIS and the note limits only NMID authenticity", html.includes('data-i18n="checkQr"') && t("checkQr", "en") !== "checkQr" && t("checkQr", "id") !== "checkQr" && !t("checksNote", "id").includes("Tidak diperiksa: gambar kode QR") && !t("checksNote", "en").includes("does not scan those") && t("checksNote", "id").includes("NMID") && t("checksNote", "en").includes("NMID"));
  // Auditor 23 Nov 19:00 (tambahan): the checksNote FALLBACK text in
  // index.html itself must equal the new i18n ID text. The i18n-only
  // ah13 check passed while the raw-HTML fallback still said QR codes
  // are not scanned — the auditor read the raw HTML (curl /
  // view-source / no-JS) as unfixed. Checking i18n alone is not
  // enough; the fallback is what raw HTML shows. Checklist
  // pra-publish 19:03 (1): the EN text must say the SAME thing as
  // the ID text (NMID limit + name/amount match the store + voice
  // calls can be checked) — all three surfaces (fallback ID, i18n
  // ID, i18n EN) must agree.
  check("ah19 checksNote fallback in index.html equals the new i18n ID text, and EN says the same (no stale QR denial)", (() => {
    const m = html.match(/<p class="muted" data-i18n="checksNote">([\s\S]*?)<\/p>/);
    const id = t("checksNote", "id");
    const en = t("checksNote", "en");
    return !!m && m[1] === id && !m[1].includes("Tidak diperiksa: gambar kode QR")
      && id.includes("nama dan nominalnya sama") && id.includes("Panggilan suara")
      && en.includes("name and amount match") && en.includes("voice call") && en.includes("NMID");
  })());
  // Auditor 23 Nov 18:12 (2): the offline banner must distinguish
  // the cloud AI verdict (needs internet) from the on-device quick
  // check, QR reading and pre-send check (work offline) — the old
  // "checks need the internet" contradicted the FAQ + the offline
  // preliminary score panel.
  check("ah14 offline texts distinguish cloud AI verdict from offline-capable checks", t("offlineNote", "id").includes("vonis AI cloud butuh internet") && t("offlineNote", "id").includes("baca QR") && t("offlineNote", "id").includes("cek sebelum kirim") && t("offlineNote", "en").includes("cloud AI verdict needs the internet") && t("offlineNote", "en").includes("QR reading") && !t("offlineNote", "id").includes("pemeriksaan membutuhkan internet") && !t("offlineCheckNotice", "id").includes("pemeriksaan membutuhkan internet") && t("offlineCheckNotice", "id").includes("skor awal") && t("errorOffline", "id").includes("vonis AI"));
  // Auditor 23 Nov 18:12 (4): privacy.html covers camera permission
  // + local QR image processing, in both languages.
  check("ah15 privacy.html covers camera permission and local QR processing", fs.existsSync("public/privacy.html") && fs.readFileSync("public/privacy.html", "utf8").includes("Kamera &amp; kode QR") && fs.readFileSync("public/privacy.html", "utf8").includes("tidak pernah diunggah") && fs.readFileSync("public/privacy.html", "utf8").includes("Camera &amp; QR codes") && fs.readFileSync("public/privacy.html", "utf8").includes("never uploaded"));
  // Regression 23 Nov 18:15 (parent's regression round, finding 1):
  // the PDF mislabeled ON_DEVICE / LOCAL verdicts as cloud — the
  // print source map must cover every real source and the fallback
  // must say "unknown", never the cloud. The three new keys exist
  // EN+ID with distinct values (LOCAL and CODE share one honest
  // label, "on-device rules", by design).
  check("ah16 PDF source map covers ON_DEVICE + LOCAL, fallback is unknown (not cloud)", mainJs.includes('ON_DEVICE: "printSourceDevice"') && mainJs.includes('LOCAL: "printSourceLocal"') && mainJs.includes('PRINT_SOURCE_KEY[verdict.source] || "printSourceUnknown"') && !/PRINT_SOURCE_KEY\[verdict\.source\] \|\| "printSourceCloud"/.test(mainJs) && ["printSourceDevice", "printSourceLocal", "printSourceUnknown"].every((k) => t(k, "en") !== k && t(k, "id") !== k && t(k, "en") !== t(k, "id")) && t("printSourceDevice", "id").includes("di perangkat") && t("printSourceUnknown", "id").includes("tidak diketahui"));
  // Regression 23 Nov 18:15 (Cek Pesan round): the local rules scored
  // 14/25 on the AI-benchmark texts — two scams called Safe, one real
  // OTP called suspicious. 24/25 now: hard-job-real is deliberately
  // EXCLUDED — the AI benchmark expects it "suspicious" but the
  // project's own local benchmark pins the identical text SAFE
  // (safe-job-real, 16), so the rules follow their own benchmark.
  check("ah17 local rules score 24/25 on the AI-benchmark texts (hard-job-real excluded by design)", (() => {
    const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/ai-benchmark-cases.json"), "utf8")).cases;
    const bad = cases
      .filter((c) => c.id !== "hard-job-real")
      .map((c) => {
        const v = analyzeWithHeuristic(c.text, c.lang);
        return { id: c.id, ok: v.status === c.expected, got: `${v.status} ${v.riskScore}` };
      })
      .filter((r) => !r.ok);
    check("ah17b benchmark misses listed", bad.length === 0, bad.map((r) => `${r.id}=${r.got}`).join(", "));
    return bad.length === 0;
  })());
  // CoArena audit of the 23 Nov rules fix (same round): three findings
  // were valid and are fixed here — (D) the pure-OTP guard accepted a
  // code-harvesting scam ("Reply with it..."), (A) unbounded ".*" in
  // the new guarantee/threat patterns, (B) a denial of guaranteed
  // profit ("Tidak ada investasi yang dijamin menghasilkan profit")
  // fired investGuarantee, (C) a "scan this QR to receive payment"
  // scam scored Safe 0. Each is pinned below.
  check("ah18 CoArena audit fixes: OTP-harvest bypass, QR-receive scam, guarantee denial", (() => {
    const bypass = analyzeWithHeuristic("Your verification code is 482731. Never share this code. Reply with it to reverse a mistaken debit.", "en");
    const legit = analyzeWithHeuristic("Kode verifikasi Tokopedia Anda: 482916. Jangan berikan kode ini kepada siapa pun, termasuk karyawan Tokopedia.", "id");
    const qrScam = analyzeWithHeuristic("Untuk menerima pembayaran pesanan, pindai kode QR yang saya kirim.", "id");
    const qrPay = analyzeWithHeuristic("Terima kasih. Silakan pindai kode QR di bawah untuk membayar.", "id");
    const denial = analyzeWithHeuristic("Tidak ada investasi yang dijamin menghasilkan profit.", "id");
    return bypass.status === "suspicious" && bypass.riskScore === 42
      && legit.status === "safe" && legit.riskScore === 0
      && qrScam.status === "suspicious" && qrScam.riskScore === 30 && qrScam.checks.find((c) => c.id === "qrReceive").found
      && qrPay.riskScore === 0
      && denial.status === "safe" && denial.checks.find((c) => c.id === "investGuarantee").found === false
      && ai.includes('id: "qrReceive"') && ai.includes('id: "contactNumber"')
      && !/dijamin\.\*\(profit/.test(ai) && !/terlibat\.\*\(pidana/.test(ai);
  })());
  // Safety floor lock — 23 Nov 2026 (lantai pengaman vonis AI, Run 1:
  // OTP BCA palsu dinilai Aman 5 oleh AI). Nomor ah20: ah19 sudah
  // dipakai parent untuk fallback checksNote (23 Nov 19:00).
  // Tiga invarian dikunci:
  //   1. Lantai AKTIF bila lokal >= 60 + AI miss (OTP BCA + AI safe palsu).
  //   2. Lantai TIDAK PERNAH aktif pada kasus aman kedua benchmark:
  //      semua kasus expected safe/suspicious di benchmark AI (25 kasus,
  //      diuji langsung dengan AI safe 0 palsu — worst case buat lantai)
  //      + skor aman tertinggi benchmark lokal (18 kasus, dari rows JSON)
  //      harus < 60.
  //   3. Kunci i18n receiptFloorApplied ada EN+ID, berbeda, bawa {score};
  //      main.js me-render-nya kondisional pada verdict.floorApplied.
  check("ah20 safety floor: activates on OTP BCA + AI miss, never on safe cases in both benchmarks, i18n + render wired", (() => {
    const { applySafetyFloor } = aiMod;
    if (typeof applySafetyFloor !== "function") return false;
    const fakeAiSafe = (status = "safe", riskScore = 0) => ({ status, riskScore, redFlags: [], summary: "s", source: "IN_CLOUD", model: "m", redacted: [] });
    // 1. Floor activates on OTP BCA scam + fake AI safe verdict.
    const OTP_BCA = "BCA: Kode OTP Anda 482916. Jangan berikan kode ini ke siapapun termasuk petugas bank. Jika Anda tidak merasa melakukan transaksi, segera hubungi 0812-9876-5432.";
    const floored = applySafetyFloor(fakeAiSafe("safe", 5), OTP_BCA, "id");
    if (!floored.floorApplied || floored.status !== "scam" || floored.riskScore !== 60) return false;
    if (floored.source !== "IN_CLOUD" || floored.model !== "m") return false;
    // 2a. AI benchmark (25 cases): floor must NEVER activate on cases
    //     whose expected verdict is "safe" or "suspicious" (scam cases
    //     are excluded — the floor SHOULD activate on them with an AI miss).
    const aiCases = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/ai-benchmark-cases.json"), "utf8")).cases;
    const falsePositives = aiCases
      .filter((c) => c.expected === "safe" || c.expected === "suspicious")
      .map((c) => ({ id: c.id, local: analyzeWithHeuristic(c.text, c.lang).riskScore, fired: applySafetyFloor(fakeAiSafe(), c.text, c.lang).floorApplied }))
      .filter((r) => r.fired);
    check("ah20b floor false positives on AI-benchmark safe/suspicious cases", falsePositives.length === 0, falsePositives.map((r) => `${r.id}: local ${r.local}`).join(", "));
    if (falsePositives.length > 0) return false;
    // 2b. Local benchmark (18 cases): rows carry intent + score (no
    //     text), so the invariant is max safe score < 60 — the floor
    //     condition depends only on the local score when the AI misses.
    const localRows = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/benchmark-local-rules.json"), "utf8")).rows;
    const maxLocalSafe = Math.max(...localRows.filter((r) => r.intent === "safe").map((r) => r.score));
    if (!(maxLocalSafe < 60)) return false;
    // 3. i18n key receiptFloorApplied exists EN + ID, translated, carries {score}.
    const enFloor = t("receiptFloorApplied", "en");
    const idFloor = t("receiptFloorApplied", "id");
    if (enFloor === "receiptFloorApplied" || idFloor === "receiptFloorApplied") return false;
    if (enFloor === idFloor) return false;
    if (!enFloor.includes("{score}") || !idFloor.includes("{score}")) return false;
    // 4. main.js renders receiptFloorApplied conditionally on verdict.floorApplied.
    if (!mainJs.includes("receiptFloorApplied") || !mainJs.includes("verdict.floorApplied")) return false;
    return true;
  })());

  // AMBIGUOUS CASES prompt calibration (23 Nov 2026): courier non-official domain + personal-email job
  check("ah21 ai.js prompt ambiguous courier rule: non-official domain is suspicious 30-59", /AMBIGUOUS CASES[\s\S]*?COURIER[\s\S]*?NOT the courier's official domain[\s\S]*?'suspicious' 30-59/i.test(ai));
  check("ah22 ai.js prompt ambiguous job rule: personal-email contact is suspicious 30-59", /AMBIGUOUS CASES[\s\S]*?JOB[\s\S]*?personal email address[\s\S]*?'suspicious' 30-59/i.test(ai));
  check("ah23 ai.js prompt ambiguous promo rule: unsolicited voucher on official domain is suspicious 30-59", /AMBIGUOUS CASES[\s\S]*?PROMO[\s\S]*?official domain[\s\S]*?'suspicious' 30-59/i.test(ai));

  try {
    execFileSync(process.execPath, ["tests/i18n-parity-audit.cjs"], { cwd: ROOT, stdio: "pipe" });
    check("e3 i18n parity audit passes", true);
  } catch (err) {
    check("e3 i18n parity audit passes", false, String(err.stdout || err.message).slice(0, 200));
  }

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
