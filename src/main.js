// TipuCek — UI wiring (single page).

import "./styles.css";
import { analyzeMessage, analyzeImageWithAI, transcribeAudioWithAI, isFirebaseConfigured, warmUpAI, preloadAiModules, analyzeWithHeuristic, codeOnlyVerdict, BACKUP_CLOUD_MODEL, MAX_MESSAGE_CHARS } from "./ai.js";
import { analyzeLinks, extractNumbers } from "./risks.js";
import { analyzeFiles } from "./files.js";
import { buildWarningCard, shareWarningCard } from "./sharecard.js";
import { initAssistant, refreshAssistantLanguage } from "./assistant.js";
import { saveCheck, loadHistory, clearLocalHistory, isLocalOnly, setLocalOnly } from "./history.js";
import { inspectFile } from "./filecheck.js";
import { filterContacts } from "./contacts.js";
import { AID_SCENARIOS } from "./firstaid.js";
import { scanChatLog } from "./chatlog.js";
import { analyzeOutgoing } from "./outbound.js";
import { getReportCount, submitReport, reportHash } from "./reports.js";
import {
  validateCrowdReport,
  submitCrowdReport,
  loadLocalReports,
} from "./crowdreport.js";
import { lookupDomain, resolveShortLink, registrableDomain } from "./domain.js";
import { getQuizQuestions } from "./quiz.js";
import { analyzeEmail } from "./emailcheck.js";
import { analyzeCall, mergeCallVerdict } from "./callcheck.js";
import {
  LANGUAGES,
  detectLanguage,
  saveLanguage,
  t,
} from "./i18n.js";

const $ = (id) => document.getElementById(id);

// Current UI language: ?lang= param > saved choice > browser language.
let lang = detectLanguage();
let lastHistory = [];
let lastStorageWhere = "local";
let selectedImage = null;
// Senior mode (big text + buttons) — saved per device.
let seniorMode = false;
try {
  seniorMode = localStorage.getItem("tipucek_senior_mode") === "1";
} catch {
  seniorMode = false;
}
let selectedFile = null;
let selectedChatlog = null;
let contactsCat = "all";
let quizState = null;

// Last displayed check, for the language re-check (Bug 2 fix, 19 Nov):
// { kind: "message", message } | { kind: "image", message, imageText }
// | { kind: "email", fromName, fromEmail, body }
// | { kind: "call", number, said }.
// Set when a check STARTS (input captured), so a language change during
// a running check can re-run the same input afterwards.
let lastCheck = null;
// A check or re-check is currently running (async AI call in flight).
let checkBusy = false;
// The language changed while a check was running: re-check once it ends.
let recheckAfterCheck = false;
// Monotonic run id: a newer check/re-check invalidates an older one's
// render, so a stale async result can never overwrite a newer card.
let checkRunId = 0;

// Verdict cache (speed optimization, 19 Nov): the same input in the
// same language always gets the same genuine AI verdict, so a repeated
// check — or a language round-trip (EN -> ID -> EN) — reuses the
// verdict from this session instead of re-running the full AI check.
// In-memory only, never persisted: nothing extra is stored anywhere,
// and the cache dies with the page. Only genuine verdicts are cached
// (never a demo result, never a failure) — cache writes are skipped
// entirely in demo mode (isFirebaseConfigured() false), where the
// check is a ~350ms local heuristic anyway. Each entry keeps the
// original check's elapsed time, so the "Checked in Xs" line stays
// honest. Email/call verdicts are local and near-instant already, so
// only the AI message/image verdicts are cached.
const VERDICT_CACHE_MAX = 50;
const verdictCache = new Map();
function normalizeCheckInput(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ");
}
function verdictCacheKey(kind, input, langCode) {
  return `${kind}|${langCode}|${normalizeCheckInput(input)}`;
}
function verdictCacheGet(kind, input, langCode) {
  const key = verdictCacheKey(kind, input, langCode);
  const hit = verdictCache.get(key);
  if (!hit) return null;
  // LRU touch: the oldest entry stays the eviction victim.
  verdictCache.delete(key);
  verdictCache.set(key, hit);
  return hit;
}
function verdictCacheSet(kind, input, langCode, entry) {
  const key = verdictCacheKey(kind, input, langCode);
  if (verdictCache.has(key)) verdictCache.delete(key);
  verdictCache.set(key, entry);
  while (verdictCache.size > VERDICT_CACHE_MAX) {
    verdictCache.delete(verdictCache.keys().next().value);
  }
}
// Last rendered result card (exact renderResult arguments): a language
// change re-renders this card's static strings instantly (see the
// language picker handler) while the AI text waits for the re-check.
let lastRenderArgs = null;

export const SAMPLES = [
  {
    labelKey: "sampleScam",
    noteKey: "sampleNoteScam",
    textKey: "sampleTextScam",
  },
  {
    labelKey: "sampleSuspicious",
    noteKey: "sampleNoteSuspicious",
    textKey: "sampleTextSuspicious",
  },
  {
    labelKey: "sampleSafe",
    noteKey: "sampleNoteSafe",
    textKey: "sampleTextSafe",
  },
  {
    labelKey: "sampleApk",
    noteKey: "sampleNoteApk",
    textKey: "sampleTextApk",
  },
  {
    labelKey: "sampleJob",
    noteKey: "sampleNoteJob",
    textKey: "sampleTextJob",
  },
  {
    labelKey: "sampleOtp",
    noteKey: "sampleNoteOtp",
    textKey: "sampleTextOtp",
  },
];

const STATUS_KEY = { safe: "statusSafe", suspicious: "statusSuspicious", scam: "statusScam" };
const NEXT_KEY = { scam: "nextScam", suspicious: "nextSuspicious", safe: "nextSafe" };

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sourceBadge(source) {
  // Plain-language badges (Myuden 19 Nov 17:44): the source code
  // (ON_DEVICE / IN_CLOUD / DEMO / LOCAL) is internal only and never
  // shown — the badge says in plain words where the answer came from.
  if (source === "ON_DEVICE") {
    return `<span class="badge badge-device">${escapeHtml(t("badgeDevice", lang))}</span>`;
  }
  if (source === "IN_CLOUD") {
    return `<span class="badge badge-cloud">${escapeHtml(t("badgeCloud", lang))}</span>`;
  }
  if (source === "DEMO") {
    return `<span class="badge badge-demo">${escapeHtml(t("badgeDemo", lang))}</span>`;
  }
  if (source === "LOCAL") {
    return `<span class="badge badge-local">${escapeHtml(t("badgeLocal", lang))}</span>`;
  }
  if (source === "CODE") {
    return `<span class="badge badge-code">${escapeHtml(t("badgeCode", lang))}</span>`;
  }
  return `<span class="badge badge-unknown">${escapeHtml(t("badgeUnknown", lang))}</span>`;
}

// Plain-language source label (text only, no badge markup) for the
// history list: the raw source code (IN_CLOUD / ON_DEVICE) must never
// reach the UI — audit 19 Nov caught it leaking in history items.
function sourceLabel(source) {
  if (source === "ON_DEVICE") return t("badgeDevice", lang);
  if (source === "IN_CLOUD") return t("badgeCloud", lang);
  if (source === "DEMO") return t("badgeDemo", lang);
  if (source === "LOCAL") return t("badgeLocal", lang);
  if (source === "CODE") return t("badgeCode", lang);
  return t("badgeUnknown", lang);
}

// Map a raw failure to a short, plain-language message. The raw
// technical text is never shown as the headline — it goes into a
// collapsed "technical details" block instead (see showCheckError),
// so a lay user sees a clear sentence and a judge can still see the
// exact error.
function friendlyErrorMessage(err) {
  const raw = err?.message || String(err || "");
  const lower = raw.toLowerCase();
  if (/message too long/i.test(raw)) {
    const n = (raw.match(/(\d+) chars/) || [])[1] || MAX_MESSAGE_CHARS;
    return t("errorTooLong", lang, { n, max: MAX_MESSAGE_CHARS });
  }
  if (/timed out/i.test(raw)) return t("errorTimeout", lang);
  if (/api-not-enabled|ai logic.*not enabled/i.test(raw)) {
    return t("errorAiNotEnabled", lang);
  }
  if (/app check/i.test(raw)) return t("errorAppCheck", lang);
  if (/network|failed to fetch|load failed|offline/i.test(raw)) {
    return t("errorNetwork", lang);
  }
  return t("errorGeneric", lang);
}

// Show a check failure: friendly sentence + collapsible technical
// detail + (for the AI paths) a retry button that re-runs the check.
function showCheckError(errorEl, err, onRetry) {
  const raw = err?.message || String(err || "");
  errorEl.innerHTML =
    `<span>${escapeHtml(friendlyErrorMessage(err))}</span>` +
    `${navigator.onLine ? "" : ` ${escapeHtml(t("errorOffline", lang))}`}` +
    `<details class="error-detail"><summary>${escapeHtml(t("errorDetail", lang))}</summary><code>${escapeHtml(raw.slice(0, 500))}</code></details>` +
    (onRetry
      ? `<button type="button" class="secondary retry-btn">${escapeHtml(t("retryBtn", lang))}</button>`
      : "");
  errorEl.hidden = false;
  if (onRetry) {
    errorEl.querySelector(".retry-btn").addEventListener("click", onRetry);
  }
}

// Senior mode: big text + buttons, one big check button.
// Saved per device (localStorage).
function checkBtnLabel() {
  return seniorMode ? t("seniorCheckBtn", lang) : t("checkBtn", lang);
}

function applySeniorMode() {
  document.body.classList.toggle("senior-mode", seniorMode);
  const toggle = $("senior-toggle");
  toggle.setAttribute("aria-pressed", seniorMode ? "true" : "false");
  $("senior-note").hidden = !seniorMode;
  const btn = $("check-btn");
  if (btn && !btn.disabled) btn.textContent = checkBtnLabel();
  try {
    localStorage.setItem("tipucek_senior_mode", seniorMode ? "1" : "0");
  } catch {
    /* private mode — the choice just won't persist */
  }
}

function fillPrintReport(verdict, links, phones, accounts) {
  const el = $("print-report");
  const statusLabel = t(STATUS_KEY[verdict.status] || "statusSafe", lang);
  const when = new Date().toLocaleString();
  const found = [...phones, ...accounts, ...links.map((l) => l.url)];
  el.innerHTML = `
    <h1>${escapeHtml(t("printTitle", lang))}</h1>
    <p><strong>${escapeHtml(t("printDate", lang))}:</strong> ${escapeHtml(when)}</p>
    <p><strong>${escapeHtml(t("printVerdict", lang))}:</strong> ${escapeHtml(statusLabel)}</p>
    <p><strong>${escapeHtml(t("printScore", lang))}:</strong> ${verdict.riskScore}/100</p>
    ${verdict.source === "CODE" ? `<p>${escapeHtml(t("badgeCode", lang))}</p>` : ""}
    <p>${escapeHtml(verdict.summary)}</p>
    ${verdict.redFlags.length > 0 ? `<h2>${escapeHtml(t("printFlags", lang))}</h2><ul>${verdict.redFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
    ${found.length > 0 ? `<h2>${escapeHtml(t("printFound", lang))}</h2><ul>${found.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
    <p>${escapeHtml(t("printFooter", lang))}</p>`;
}

function renderResult(verdict, message, elapsedSec, imageText = "", extra = {}) {
  const el = $("result");
  // Remember the exact render arguments for the instant static
  // re-label on language change (see the language picker handler).
  lastRenderArgs = { verdict, message, elapsedSec, imageText, extra };
  const flags =
    verdict.redFlags.length > 0
      ? `<ul class="flags">${verdict.redFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
      : `<p class="no-flags">${escapeHtml(t("noFlags", lang))}</p>`;
  // Score ring: r=34, circumference ~213.6.
  const ringC = 2 * Math.PI * 34;
  const ringOffset = ringC * (1 - verdict.riskScore / 100);
  const elapsed =
    elapsedSec != null
      ? `<span class="result-meta">${escapeHtml(t("checkedIn", lang, { s: elapsedSec.toFixed(1) }))}</span>`
      : "";
  // Link risk: every URL in the message, analyzed on-device (shortener,
  // suspicious TLD, brand look-alike, IP host, punycode, http, @-trick).
  const links = analyzeLinks(message);
  const linksBox =
    links.length > 0
      ? `<div class="links-box">
          <h3>${escapeHtml(t("linksTitle", lang))}</h3>
          <ul>${links
            .map((l) => {
              const riskLabel =
                l.level === "high"
                  ? t("linkRiskHigh", lang)
                  : l.level === "low"
                    ? t("linkRiskLow", lang)
                    : t("linkRiskSafe", lang);
              const reasons =
                l.reasons.length > 0
                  ? `<ul class="link-reasons">${l.reasons.map((r) => `<li>${escapeHtml(t(r, lang))}</li>`).join("")}</ul>`
                  : "";
              return `<li class="link-item risk-${l.level}"><span class="link-risk">${escapeHtml(riskLabel)}</span> <span class="links-host">${escapeHtml(l.host)}</span> <span class="links-url">${escapeHtml(l.url)}</span>${reasons}</li>`;
            })
            .join("")}</ul>
          <p class="links-warn">${escapeHtml(t("linksWarn", lang))}</p>
          <p class="links-note">${escapeHtml(t("linksRiskNote", lang))}</p>
        </div>`
      : "";
  // Phone numbers + bank accounts found in the message, with the
  // official checker link for accounts (no scam database of our own).
  const { phones, accounts } = extractNumbers(message);
  const numbersBox =
    phones.length > 0 || accounts.length > 0
      ? `<div class="numbers-box">
          <h3>${escapeHtml(t("numbersTitle", lang))}</h3>
          ${phones
            .map(
              (p) =>
                `<p><span class="numbers-label">${escapeHtml(t("numbersPhoneLabel", lang))}:</span> <span class="numbers-value">${escapeHtml(p)}</span> <a href="https://aduannomor.id" target="_blank" rel="noopener">${escapeHtml(t("numbersReportPhone", lang))}</a></p>`,
            )
            .join("")}
          ${accounts
            .map(
              (a) =>
                `<p><span class="numbers-label">${escapeHtml(t("numbersAccountLabel", lang))}:</span> <span class="numbers-value">${escapeHtml(a)}</span> <a href="https://cekrekening.id" target="_blank" rel="noopener">${escapeHtml(t("numbersCheckAccount", lang))}</a></p>`,
            )
            .join("")}
          <p class="numbers-warn">${escapeHtml(t("numbersWarn", lang))}</p>
        </div>`
      : "";
  const imageNote =
    imageText !== ""
      ? `<p class="image-read-text"><strong>${escapeHtml(t("imageReadText", lang))}</strong> ${escapeHtml(imageText)}</p>`
      : "";
  // Fake-file detection (local, deterministic): file names and extensions
  // mentioned in the message — APK installers, Windows programs,
  // archives, and documents that push an install or a macro.
  const files = analyzeFiles(message);
  const filesBox =
    files.length > 0
      ? `<div class="files-box">
          <h3>${escapeHtml(t("filesTitle", lang))}</h3>
          <ul>${files
            .map(
              (f) =>
                `<li class="file-item file-${f.level}"><span class="file-name">${escapeHtml(f.name)}</span> — ${escapeHtml(t(f.reason, lang))}</li>`,
            )
            .join("")}</ul>
          <p class="files-warn">${escapeHtml(t("filesWarn", lang))}</p>
        </div>`
      : "";
  // Deterministic code-first signal: the local rule set scores the same
  // message without any model. A supporting signal, not a second
  // verdict — the AI verdict above is the verdict. Shown only in
  // production mode: in demo mode the verdict IS this heuristic.
  let localSignal = "";
  if (
    isFirebaseConfigured() &&
    verdict.source !== "DEMO" &&
    verdict.source !== "CODE"
  ) {
    const local = analyzeWithHeuristic(message, lang);
    const localStatus =
      local.status === "scam"
        ? t("statusScam", lang)
        : local.status === "suspicious"
          ? t("statusSuspicious", lang)
          : t("statusSafe", lang);
    localSignal = `<div class="local-signal"><h3>${escapeHtml(t("localSignalTitle", lang))}</h3><p>${escapeHtml(t("localSignalText", lang, { score: local.riskScore, status: localStatus, n: local.redFlags.length }))}</p></div>`;
  }
  // Privacy receipt: one honest paragraph per check — what was sent,
  // where it was answered, how long it took, and where the result is
  // stored. This is the evidence for the privacy claim, not just docs.
  const receiptSent =
    verdict.source === "ON_DEVICE"
      ? t("receiptDevice", lang)
      : verdict.source === "IN_CLOUD"
        ? t("receiptCloud", lang)
        : verdict.source === "DEMO"
          ? t("receiptDemo", lang)
          : verdict.source === "LOCAL"
            ? t("receiptLocal", lang)
            : verdict.source === "CODE"
              ? t("receiptCode", lang)
              : t("receiptUnknown", lang);
  const receiptStored = isLocalOnly()
    ? t("receiptStoredLocal", lang)
    : t("receiptStoredCloud", lang);
  const receiptSkipped =
    isLocalOnly() &&
    (links.length > 0 || phones.length > 0 || accounts.length > 0)
      ? `<p>${escapeHtml(t("receiptSkipped", lang))}</p>`
      : "";
  // Which cloud model answered (primary / backup): the badge stays
  // "Answered in the cloud" — the receipt records the model, so a
  // backup verdict is never silently presented as a primary one.
  const receiptModel =
    verdict.source === "IN_CLOUD" && verdict.model
      ? `<p>${escapeHtml(t(verdict.model === BACKUP_CLOUD_MODEL ? "receiptModelBackup" : "receiptModelPrimary", lang, { model: verdict.model }))}</p>`
      : "";
  // Audio verdicts (transcribed phone call): the recording was sent to
  // the cloud for transcription — say so in the receipt, next to the
  // message-to-cloud line. The recording itself is never stored.
  const receiptAudio = extra.audio
    ? `<p>${escapeHtml(t("receiptAudio", lang))}</p>`
    : "";
  const receipt = `<details class="privacy-receipt" open><summary>${escapeHtml(t("receiptTitle", lang))}</summary><p>${escapeHtml(receiptSent)}</p>${receiptModel}${receiptAudio}<p>${escapeHtml(t("receiptTime", lang, { s: elapsedSec != null ? elapsedSec.toFixed(1) : "—" }))}</p><p>${escapeHtml(receiptStored)}</p>${receiptSkipped}</details>`;
  // Report channels (official): phone numbers to Komdigi's aduannomor.id,
  // accounts to cekrekening.id. Shown for scam/suspicious verdicts even
  // when the message contains no number at all.
  const reportLine =
    verdict.status !== "safe"
      ? `<p class="report-links">${escapeHtml(t("reportLinks", lang))
          .replaceAll(
            "aduannomor.id",
            `<a href="https://aduannomor.id" target="_blank" rel="noopener">aduannomor.id</a>`,
          )
          .replaceAll(
            "cekrekening.id",
            `<a href="https://cekrekening.id" target="_blank" rel="noopener">cekrekening.id</a>`,
          )}</p>`
      : "";
  const statusLabel = t(STATUS_KEY[verdict.status] || "statusSafe", lang);
  // Code-only fallback card: say so plainly, right under the verdict
  // — the AI did not answer, this result is the code check only, and
  // the retry button below asks the AI again.
  const codeOnlyNote =
    verdict.source === "CODE"
      ? `<p class="code-only-note">${escapeHtml(t("codeOnlyNote", lang, { retry: t("retryBtn", lang) }))}</p>`
      : "";
  el.innerHTML = `
    <article class="result-card status-${verdict.status}">
      <div class="result-head">
        <div class="result-score-ring">
          <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
            <circle class="ring-track" cx="42" cy="42" r="34"></circle>
            <circle class="ring-fill" cx="42" cy="42" r="34" stroke-dasharray="${ringC.toFixed(1)}" stroke-dashoffset="${ringOffset.toFixed(1)}"></circle>
          </svg>
          <div class="ring-value"><strong>${verdict.riskScore}</strong><span>/ 100</span></div>
        </div>
        <div class="result-main">
          <p class="result-eyebrow">${escapeHtml(t("resultVerdict", lang))}</p>
          <h2 class="result-status">${escapeHtml(statusLabel)}</h2>
          <p class="result-summary">${escapeHtml(verdict.summary)}</p>
        </div>
        <div class="result-badge">${sourceBadge(verdict.source)}${elapsed}</div>
      </div>
      ${codeOnlyNote}
      <p class="result-next"><strong>${escapeHtml(t("whatToDo", lang))}</strong> ${escapeHtml(t(NEXT_KEY[verdict.status], lang))}</p>
      ${reportLine}
      ${imageNote}
      <h3>${escapeHtml(t("redFlags", lang))}</h3>
      ${flags}
      ${localSignal}
      ${linksBox}
      ${numbersBox}
      ${filesBox}
      ${receipt}
      <div id="report-counts" class="report-counts"></div>
      <div id="link-track" class="link-track"></div>
      <div class="result-actions">
        ${verdict.source === "CODE"
          ? `<button id="retry-ai-btn" type="button" class="secondary">${escapeHtml(t("retryBtn", lang))}</button>`
          : ""}
        <button id="copy-result-btn" type="button" class="secondary">${escapeHtml(t("copyResult", lang))}</button>
        <button id="share-card-btn" type="button" class="secondary">${escapeHtml(t("shareCardBtn", lang))}</button>
        <button id="download-card-btn" type="button" class="secondary">${escapeHtml(t("downloadCardBtn", lang))}</button>
        ${verdict.status !== "safe" && (phones.length > 0 || accounts.length > 0 || files.length > 0)
          ? `<button id="report-btn" type="button" class="secondary">${escapeHtml(t("reportBtn", lang))}</button>`
          : ""}
        ${verdict.status !== "safe"
          ? `<button id="warn-family-btn" type="button" class="secondary">${escapeHtml(t("warnFamilyBtn", lang))}</button>
        <button id="pdf-btn" type="button" class="secondary">${escapeHtml(t("pdfBtn", lang))}</button>`
          : ""}
      </div>
      <details class="checked-message">
        <summary>${escapeHtml(t("checkedMessage", lang))}</summary>
        <p>${escapeHtml(message)}</p>
      </details>
    </article>`;
  el.hidden = false;

  // Code-only fallback card: "Try again" re-runs the full check, so a
  // successful retry replaces this card with the real AI verdict.
  // Transcribed calls pass their own retry (re-score the same
  // recording); every other card re-runs the message check.
  const retryAiBtn = $("retry-ai-btn");
  if (retryAiBtn) {
    retryAiBtn.addEventListener("click", () => {
      if (typeof extra.onRetry === "function") extra.onRetry();
      else onCheck();
    });
  }

  $("copy-result-btn").addEventListener("click", async (ev) => {
    const lines = [
      `TipuCek — ${statusLabel} ${verdict.riskScore}/100`,
      ...(verdict.source === "CODE" ? [t("badgeCode", lang)] : []),
      verdict.summary,
      ...(verdict.redFlags.length > 0
        ? [`${t("redFlags", lang)}: ${verdict.redFlags.join("; ")}`]
        : []),
      ...(links.length > 0
        ? [`${t("linksTitle", lang)}: ${links.map((l) => l.url).join(", ")}`]
        : []),
      `${t("whatToDo", lang)} ${t(NEXT_KEY[verdict.status], lang)}`,
      `https://tipucek.web.app`,
    ];
    const btn = ev.currentTarget;
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      btn.textContent = t("copied", lang);
    } catch {
      // Clipboard API unavailable (old browser / permissions): fall back
      // to a temporary textarea + execCommand.
      try {
        const ta = document.createElement("textarea");
        ta.value = lines.join("\n");
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        btn.textContent = t("copied", lang);
      } catch {
        btn.textContent = t("copyFailed", lang);
      }
    }
    setTimeout(() => {
      btn.textContent = t("copyResult", lang);
    }, 2000);
  });

  // Shareable warning card (PNG): native share sheet when the device
  // supports it, otherwise a download.
  const cardStrings = {
    subtitle: t("tagline", lang),
    statusLabel,
    whatToDo: t("whatToDo", lang),
    next: t(NEXT_KEY[verdict.status], lang),
    flagsTitle: t("redFlags", lang),
  };
  $("share-card-btn").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    try {
      const result = await shareWarningCard(verdict, cardStrings);
      btn.textContent =
        result === "shared" ? t("cardShared", lang) : t("cardDownloaded", lang);
    } catch {
      btn.textContent = t("copyFailed", lang);
    }
    setTimeout(() => {
      btn.textContent = t("shareCardBtn", lang);
    }, 2000);
  });
  $("download-card-btn").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    try {
      const blob = await buildWarningCard({ ...verdict, strings: cardStrings });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `tipucek-warning-${verdict.status}-${verdict.riskScore}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      btn.textContent = t("cardDownloaded", lang);
    } catch {
      btn.textContent = t("copyFailed", lang);
    }
    setTimeout(() => {
      btn.textContent = t("downloadCardBtn", lang);
    }, 2000);
  });

  // Community report: one tap reports every phone / account / file
  // name found in this message (hashed, never the raw value).
  const reportBtn = $("report-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", async (ev) => {
      const b = ev.currentTarget;
      b.disabled = true;
      const targets = [
        ...phones.map((p) => ["phone", p]),
        ...accounts.map((a) => ["account", a]),
        ...files.map((f) => ["filename", f.name]),
      ];
      const results = await Promise.all(
        targets.map(([k, v]) => submitReport(k, v)),
      );
      const ok = results.some((r) => r === "ok" || r === "already");
      b.textContent = ok ? t("reportThanks", lang) : t("reportFailed", lang);
    });
  }

  // Family warning: a ready-to-send WhatsApp message with the verdict
  // + red flags, in the user's language.
  const warnBtn = $("warn-family-btn");
  if (warnBtn) {
    warnBtn.addEventListener("click", () => {
      const flagsText =
        verdict.redFlags.length > 0
          ? `${t("warnFamilyFlags", lang)} ${verdict.redFlags.join("; ")}`
          : "";
      const text = [
        t("warnFamilyIntro", lang),
        t("warnFamilyVerdict", lang, {
          status: statusLabel,
          score: verdict.riskScore,
        }),
        flagsText,
        t("warnFamilyCta", lang, { url: "https://tipucek.web.app" }),
      ]
        .filter(Boolean)
        .join("\n");
      window.open(
        `https://wa.me/?text=${encodeURIComponent(text)}`,
        "_blank",
        "noopener",
      );
    });
  }

  // PDF report: fill the print-only section, then print to PDF.
  const pdfBtn = $("pdf-btn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      fillPrintReport(verdict, links, phones, accounts);
      window.print();
    });
  }

}

// After a verdict renders, fill the two async boxes: community report
// counts for the numbers / files in the message, and link tracking
// (short-link destination + RDAP domain age). Lookups run in the
// background and failures stay silent — no count and no domain line
// is better than a guessed one.
async function enrichResult(message) {
  const countsEl = $("report-counts");
  const trackEl = $("link-track");
  if (!countsEl && !trackEl) return;
  const { phones, accounts } = extractNumbers(message);
  const files = analyzeFiles(message);
  const targets = [
    ...phones.map((p) => ({ kind: "phone", value: p, key: "reportCountPhone" })),
    ...accounts.map((a) => ({ kind: "account", value: a, key: "reportCountAccount" })),
    ...files.map((f) => ({ kind: "filename", value: f.name, key: "reportCountFile" })),
  ];
  // Community counts are looked up ONLY when the user opted into
  // cloud history (local-only OFF). A phone/account hash is
  // practically enumerable (small number space), so silently sending
  // it on every check would break the local-only promise that "checks
  // are never sent to the cloud". The explicit "Laporkan" button is
  // always available — tapping it IS the consent.
  if (countsEl && targets.length > 0 && !isLocalOnly()) {
    const lines = [];
    for (const tg of targets) {
      try {
        const hash = await reportHash(tg.kind, tg.value);
        const n = hash ? await getReportCount(hash) : null;
        if (n != null && n > 0) {
          lines.push(`<p>${escapeHtml(t(tg.key, lang, { n }))}</p>`);
        } else if (n === 0) {
          lines.push(`<p class="muted">${escapeHtml(t("reportNone", lang))}</p>`);
        }
      } catch {
        /* lookup failed — say nothing */
      }
    }
    if (lines.length > 0) countsEl.innerHTML = lines.join("");
  } else if (countsEl && targets.length > 0 && isLocalOnly()) {
    // Honest note instead of silence: the counts exist, but looking
    // them up would send a hash to the cloud while local-only is on.
    countsEl.innerHTML = `<p class="muted">${escapeHtml(t("receiptSkipped", lang))}</p>`;
  }
  // Link tracking (short-link destination + public RDAP domain age)
  // ALSO only runs when the user opted into cloud history (local-only
  // OFF). Resolving a short link fetches the shortener and RDAP sends
  // the domain to rdap.org — both are network sends of data from the
  // user's message, so they must respect the same toggle as the
  // report-count lookups above (audit §2c). The local link-risk box
  // (analyzeLinks, patterns only) still renders in the result card.
  if (trackEl && !isLocalOnly()) {
    const links = analyzeLinks(message).slice(0, 3);
    if (links.length > 0) {
      const items = [];
      for (const l of links) {
        const domain = registrableDomain(l.host);
        let finalLine = "";
        if (l.reasons.includes("linkRiskShortener")) {
          const r = await resolveShortLink(l.url);
          // Honest label: only call it the final destination when the
          // redirect was actually followed (r.resolved). When the
          // follow was blocked, the URL shown is just the link the
          // user entered — say so instead of "final destination".
          finalLine = r.finalUrl
            ? `<span>${escapeHtml(t("linkFinal", lang))}: ${escapeHtml(r.finalUrl)}</span>`
            : `<span>${escapeHtml(t("linkFinalUnresolved", lang))}: ${escapeHtml(l.url)}</span>`;
        }
        const d = domain ? await lookupDomain(domain) : { error: "unavailable" };
        let domainLine = "";
        if (!d.error && d.registered) {
          const age = d.ageDays != null ? t("domainAge", lang, { n: d.ageDays }) : "";
          const fresh =
            d.ageDays != null && d.ageDays < 90
              ? t("domainNew", lang)
              : t("domainOld", lang);
          domainLine = `<span>${escapeHtml(t("domainRegistered", lang))} ${escapeHtml(d.registered)}${d.registrar ? ` (${escapeHtml(d.registrar)})` : ""} — ${escapeHtml(age)} — ${escapeHtml(fresh)}</span>`;
        } else {
          domainLine = `<span>${escapeHtml(t("domainUnknown", lang))}</span>`;
        }
        items.push(
          `<li class="link-item"><span class="links-host">${escapeHtml(l.host)}</span> ${finalLine}<br/>${domainLine}</li>`,
        );
      }
      trackEl.innerHTML = `<div class="links-box"><h3>${escapeHtml(t("linkTrackHeading", lang))}</h3><ul>${items.join("")}</ul></div>`;
    }
  } else if (trackEl && isLocalOnly() && analyzeLinks(message).length > 0) {
    trackEl.innerHTML = `<p class="muted">${escapeHtml(t("receiptSkipped", lang))}</p>`;
  }
}

function renderHistory(entries) {
  lastHistory = entries || [];
  const list = $("history-list");
  const empty = $("history-empty");
  const stats = $("history-stats");
  const scams = lastHistory.filter((e) => e.status === "scam").length;
  stats.textContent =
    lastHistory.length > 0
      ? t("historyStats", lang, { n: lastHistory.length, m: scams })
      : "";
  if (lastHistory.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = lastHistory
    .map((e) => {
      const when = e.createdAt ? new Date(e.createdAt).toLocaleString() : "";
      const statusLabel = t(STATUS_KEY[e.status] || "statusSafe", lang);
      // Cloud records carry no message text (privacy) — show the
      // verdict summary for those; local records show the message.
      const text = e.message || e.summary || "";
      // Which cloud model answered (primary / backup): the model name
      // is an identifier, shown as-is. Code-only and on-device entries
      // already say so in their source label and need no tag; entries
      // recorded before this change have no model and show none.
      const modelTag =
        e.source === "IN_CLOUD" && e.model ? ` · ${escapeHtml(e.model)}` : "";
      return `<li class="history-item status-${escapeHtml(e.status || "safe")}">
        <span class="history-status">${escapeHtml(statusLabel)}</span>
        <span class="history-score">${Number(e.riskScore ?? 0)}/100</span>
        <span class="history-source">${escapeHtml(sourceLabel(e.source))}${modelTag}</span>
        <span class="history-text">${escapeHtml(text.slice(0, 90))}${text.length > 90 ? "…" : ""}</span>
        <time>${escapeHtml(when)}</time>
      </li>`;
    })
    .join("");
}

function setOnlineState() {
  const online = navigator.onLine;
  const pill = $("net-status");
  pill.textContent = online ? t("netOnline", lang) : t("netOffline", lang);
  pill.classList.toggle("offline", !online);
  pill.classList.toggle("online", online);
  $("offline-note").hidden = online;
}

// Crowd reports ("Laporkan penipuan"): the value label + placeholder
// follow the selected type (phone / account / mode) and the UI
// language. Kept in JS (not data-i18n) because one input serves
// three labels.
const CROWD_LABEL_KEY = {
  phone: "crowdValuePhone",
  account: "crowdValueAccount",
  mode: "crowdValueMode",
};
const CROWD_PLACEHOLDER_KEY = {
  phone: "crowdValuePhPhone",
  account: "crowdValuePhAccount",
  mode: "crowdValuePhMode",
};
function updateCrowdLabels() {
  const type = $("crowd-type").value;
  $("crowd-value-label").textContent = t(CROWD_LABEL_KEY[type] || "crowdValuePhone", lang);
  $("crowd-value").placeholder = t(CROWD_PLACEHOLDER_KEY[type] || "crowdValuePhPhone", lang);
}

// Local-only list of the user's own sent crowd reports (in the
// history panel). The reports themselves live in Firestore for team
// review; this list is just the user's own copy on this device.
function renderCrowdHistory() {
  const reports = loadLocalReports();
  const list = $("crowd-history-list");
  const empty = $("crowd-history-empty");
  if (reports.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = reports
    .map((r) => {
      const when = r.createdAt ? new Date(r.createdAt).toLocaleString() : "";
      const typeLabel = t(CROWD_LABEL_KEY[r.type] || "crowdValuePhone", lang);
      const text = `${r.value} — ${r.details || ""}`;
      return `<li class="history-item">
        <span class="history-status">${escapeHtml(typeLabel)}</span>
        <span class="history-score">${escapeHtml(t("crowdHistoryPending", lang))}</span>
        <span class="history-text">${escapeHtml(text.slice(0, 90))}${text.length > 90 ? "…" : ""}</span>
        <time>${escapeHtml(when)}</time>
      </li>`;
    })
    .join("");
}

async function onCrowdSubmit() {
  const btn = $("crowd-submit-btn");
  const type = $("crowd-type").value;
  const value = $("crowd-value").value;
  const details = $("crowd-details").value;
  const valueErr = $("crowd-value-error");
  const detailsErr = $("crowd-details-error");
  const submitErr = $("crowd-submit-error");
  const success = $("crowd-success");
  valueErr.hidden = true;
  detailsErr.hidden = true;
  submitErr.hidden = true;
  success.hidden = true;
  const errors = validateCrowdReport({ type, value, details });
  if (errors.value) {
    valueErr.textContent = t(errors.value, lang);
    valueErr.hidden = false;
  }
  if (errors.details) {
    detailsErr.textContent = t(errors.details, lang);
    detailsErr.hidden = false;
  }
  if (Object.keys(errors).length > 0) return;
  btn.disabled = true;
  btn.textContent = t("crowdSubmitting", lang);
  try {
    const res = await submitCrowdReport({ type, value, details });
    if (res.ok) {
      $("crowd-value").value = "";
      $("crowd-details").value = "";
      success.hidden = false;
      renderCrowdHistory();
    } else if (res.errors) {
      if (res.errors.value) {
        valueErr.textContent = t(res.errors.value, lang);
        valueErr.hidden = false;
      }
      if (res.errors.details) {
        detailsErr.textContent = t(res.errors.details, lang);
        detailsErr.hidden = false;
      }
    } else {
      submitErr.textContent = t("crowdErrSubmit", lang);
      submitErr.hidden = false;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = t("crowdSubmit", lang);
  }
}

// Warm the AI (App Check token + on-device model) in the background after
// the user's first gesture, so the actual check is fast. Runs once,
// never blocks, never shows errors.
let warmedUp = false;
function warmUpOnce() {
  if (warmedUp) return;
  warmedUp = true;
  warmUpAI().catch(() => {});
}

// Interim panel shown while the AI verdict is still loading (speed
// optimization, 19 Nov): the deterministic code check is instant, so
// show it right away instead of a blank "Checking…" wait. It is a
// supporting signal only — clearly labeled, never a verdict (no score
// ring, no status heading, no verdict color). Replaced by the full
// result card when the AI verdict arrives; kept (with the error) if
// the AI check fails, so the user still has a real signal. Production
// only: in demo mode the verdict IS this heuristic and arrives in
// ~350ms anyway.
function renderCheckingPreview(message) {
  if (!isFirebaseConfigured()) return;
  const el = $("result");
  const local = analyzeWithHeuristic(message, lang);
  const localStatus =
    local.status === "scam"
      ? t("statusScam", lang)
      : local.status === "suspicious"
        ? t("statusSuspicious", lang)
        : t("statusSafe", lang);
  el.innerHTML = `
    <article class="result-card result-checking">
      <div class="local-signal"><h3>${escapeHtml(t("localSignalTitle", lang))}</h3><p>${escapeHtml(t("checkingPreviewNote", lang, { score: local.riskScore, status: localStatus, n: local.redFlags.length }))}</p></div>
    </article>`;
  el.hidden = false;
}

async function onCheck() {
  const message = $("message-input").value.trim();
  const errorEl = $("error");
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (!message) {
    errorEl.textContent = t("errorEmpty", lang);
    errorEl.hidden = false;
    $("message-input").focus();
    return;
  }
  lastCheck = { kind: "message", message };
  const runId = ++checkRunId;
  checkBusy = true;
  const btn = $("check-btn");
  const progressEl = $("progress");
  btn.disabled = true;
  btn.textContent = t("checking", lang);
  progressEl.hidden = false;
  progressEl.textContent = isFirebaseConfigured()
    ? t("checking", lang)
    : t("checkingDemo", lang);
  const t0 = performance.now();
  try {
    // Speed: a repeated check of the same message in the same language
    // reuses the genuine AI verdict from the session cache (instant);
    // otherwise show the deterministic code check right away while the
    // AI verdict loads.
    const cached = verdictCacheGet("message", message, lang);
    let verdict;
    let elapsedSec = null;
    if (cached) {
      verdict = cached.verdict;
      elapsedSec = cached.elapsedSec;
    } else {
      renderCheckingPreview(message);
      let codeOnly = false;
      try {
        verdict = await analyzeMessage(
          message,
          ({ stage, progress }) => {
            if (stage === "downloading-model") {
              progressEl.textContent = t("preparingModel", lang, {
                p: Math.round((progress || 0) * 100),
              });
            } else if (stage === "cloud") {
              progressEl.textContent = t("cloudFallback", lang);
            } else if (stage === "backup") {
              // Failover: the primary cloud model failed or timed out
              // and the backup model is being tried — say so, honestly.
              progressEl.textContent = t("tryingBackupModel", lang);
            }
          },
          lang,
        );
      } catch (err) {
        // AI failed or timed out (30 s): fall back to the deterministic
        // code check — a real verdict from this message, honestly
        // labeled code-only — instead of a dead error box. Input
        // errors (message too long) are rejected by policy, not by the
        // model, and demo mode has no AI to fail: rethrow those for
        // the normal error path. Never cache the fallback: a retry
        // must ask the AI again, not return this card from cache.
        if (
          !isFirebaseConfigured() ||
          /message too long/i.test(err?.message || "")
        ) {
          throw err;
        }
        verdict = codeOnlyVerdict(message, lang);
        codeOnly = true;
      }
      if (!codeOnly) {
        elapsedSec = (performance.now() - t0) / 1000;
        if (isFirebaseConfigured()) {
          verdictCacheSet("message", message, lang, {
            verdict,
            elapsedSec,
            imageText: "",
            extra: {},
          });
        }
      }
    }
    // A newer check/re-check superseded this one: never render or save
    // a stale result over the newer card.
    if (runId !== checkRunId) return;
    renderResult(verdict, message, elapsedSec, "");
    enrichResult(message);
    const where = await saveCheck({ message, ...verdict });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    if (runId !== checkRunId) return;
    // The interim panel ("AI verdict still loading") must not survive
    // a failed check: nothing is loading anymore, and the panel would
    // lie under the error box. (The re-check path keeps its own card
    // and never reaches this catch.)
    $("result").hidden = true;
    showCheckError(errorEl, err, () => onCheck());
  } finally {
    if (runId !== checkRunId) return;
    checkBusy = false;
    btn.disabled = false;
    btn.textContent = checkBtnLabel();
    progressEl.hidden = true;
    if (recheckAfterCheck) {
      recheckAfterCheck = false;
      recheckLastCheck();
    }
  }
}

// Language re-check (Bug 2 fix, 19 Nov): when the user changes the UI
// language while a result card is displayed, the card must follow —
// the verdict (summary + red flags) is produced IN the new language,
// not merely re-labeled. The check is re-run with the same input and
// the new language (the AI prompt asks for the answer in the UI
// language; the demo heuristic translates its fixed strings), the
// card is replaced only when the new verdict arrives, and the old card
// stays untouched if the re-check fails (honest error + retry, never
// a half-translated card).
// History: deliberately NOT re-recorded. The original check already
// saved one entry; a language re-check is a re-display of the same
// check, not a new check — re-saving would double-count it in the
// history list and stats.
async function recheckLastCheck() {
  if (!lastCheck || checkBusy) return;
  const runId = ++checkRunId;
  checkBusy = true;
  const kind = lastCheck.kind;
  const progressEl = $("progress");
  const errorEl =
    kind === "email"
      ? $("email-error")
      : kind === "call"
        ? $("call-error")
        : $("error");
  errorEl.hidden = true;
  errorEl.textContent = "";
  // The message/image paths are async (AI) — show a short status while
  // they re-run. Email/call verdicts are local and near-instant, so
  // they re-render without a progress line.
  const showProgress = kind === "message" || kind === "image";
  if (showProgress) {
    progressEl.hidden = false;
    progressEl.textContent = t("rechecking", lang);
  }
  const t0 = performance.now();
  try {
    let verdict;
    let message;
    let imageText = "";
    let elapsedSec = null;
    let freshVerdict = false;
    if (kind === "email") {
      message = lastCheck.body;
      verdict = analyzeEmail(
        {
          fromName: lastCheck.fromName,
          fromEmail: lastCheck.fromEmail,
          body: lastCheck.body,
        },
        lang,
      );
    } else if (kind === "call") {
      const { verdict: v } = await analyzeCall(
        { number: lastCheck.number, said: lastCheck.said },
        lang,
        { allowReports: !isLocalOnly() },
      );
      verdict = v;
      message =
        lastCheck.number && lastCheck.said
          ? `${lastCheck.number}: ${lastCheck.said}`
          : lastCheck.number || lastCheck.said;
    } else {
      // message | image: same input, new language. For an image check
      // the verdict is re-derived from the extracted text — no re-OCR:
      // the text is unchanged, only the verdict language changes.
      message = lastCheck.message;
      imageText = lastCheck.imageText || "";
      // Speed: a language already checked for this input reuses its
      // genuine verdict from the session cache (instant round-trip).
      const cached = verdictCacheGet(kind, message, lang);
      if (cached) {
        verdict = cached.verdict;
        imageText = cached.imageText || "";
        elapsedSec = cached.elapsedSec;
      } else {
        verdict = await analyzeMessage(
          message,
          ({ stage, progress }) => {
            if (stage === "downloading-model") {
              progressEl.textContent = t("preparingModel", lang, {
                p: Math.round((progress || 0) * 100),
              });
            } else if (stage === "cloud") {
              progressEl.textContent = t("cloudFallback", lang);
            } else if (stage === "backup") {
              // Failover: the primary cloud model failed or timed out
              // and the backup model is being tried — say so, honestly.
              progressEl.textContent = t("tryingBackupModel", lang);
            }
          },
          lang,
        );
        elapsedSec = (performance.now() - t0) / 1000;
        freshVerdict = true;
      }
    }
    // A newer check/re-check started meanwhile, or the language changed
    // again: do not render — the newer run (or its follow-up re-check)
    // owns the card now.
    if (runId !== checkRunId || recheckAfterCheck) return;
    if (elapsedSec == null) elapsedSec = (performance.now() - t0) / 1000;
    if (freshVerdict && isFirebaseConfigured()) {
      verdictCacheSet(kind, message, lang, {
        verdict,
        elapsedSec,
        imageText,
        extra: {},
      });
    }
    renderResult(verdict, message, elapsedSec, imageText);
    enrichResult(message);
  } catch (err) {
    console.error(err);
    if (runId !== checkRunId) return;
    // The old card stays exactly as it was (one language, intact) and
    // the error offers a retry that re-runs this same re-check.
    // Exception: when the card on screen is already a code-only
    // fallback, it was just re-rendered in the new language by the
    // instant re-label and already explains (with its own retry) that
    // the AI did not answer — a second error box saying the same
    // thing would only duplicate it.
    if (lastRenderArgs?.verdict?.source !== "CODE") {
      showCheckError(errorEl, err, () => recheckLastCheck());
    }
  } finally {
    if (runId !== checkRunId) return;
    checkBusy = false;
    if (showProgress) progressEl.hidden = true;
    if (recheckAfterCheck) {
      recheckAfterCheck = false;
      recheckLastCheck();
    }
  }
}

// Screenshot check: the cloud model's vision reads the text in the image
// (OCR) and judges it like a pasted message. Cloud-only — the on-device
// model cannot read images, and demo mode has no AI at all.
async function onImageCheck() {
  if (!selectedImage) return;
  const progressEl = $("image-progress");
  const errorEl = $("image-error");
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (!isFirebaseConfigured()) {
    errorEl.textContent = t("assistantDemo", lang);
    errorEl.hidden = false;
    return;
  }
  const btn = $("image-btn");
  btn.disabled = true;
  const runId = ++checkRunId;
  checkBusy = true;
  progressEl.hidden = false;
  progressEl.textContent = t("imageAnalyzing", lang);
  const t0 = performance.now();
  try {
    const verdict = await analyzeImageWithAI(selectedImage, lang, ({ stage }) => {
      // Failover honesty: when the primary model fails and the backup
      // is tried, say so in the progress line (same text as the
      // message check).
      if (stage === "backup") progressEl.textContent = t("tryingBackupModel", lang);
    });
    if (runId !== checkRunId) return;
    const elapsedSec = (performance.now() - t0) / 1000;
    const message = verdict.extractedText || "";
    if (!message) {
      errorEl.textContent = t("imageNoText", lang);
      errorEl.hidden = false;
      return;
    }
    lastCheck = { kind: "image", message, imageText: message };
    // Speed: the OCR verdict is a genuine verdict for this exact
    // extracted text in this language — cache it so a later language
    // re-check reuses it instead of re-running the AI on the same text.
    // Production only (see the cache comment above).
    if (isFirebaseConfigured()) {
      verdictCacheSet("image", message, lang, {
        verdict,
        elapsedSec,
        imageText: message,
        extra: {},
      });
    }
    renderResult(verdict, message, elapsedSec, message);
    enrichResult(message);
    const where = await saveCheck({ message, ...verdict });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    if (runId !== checkRunId) return;
    showCheckError(errorEl, err, () => onImageCheck());
  } finally {
    if (runId !== checkRunId) return;
    checkBusy = false;
    btn.disabled = false;
    progressEl.hidden = true;
    if (recheckAfterCheck) {
      recheckAfterCheck = false;
      recheckLastCheck();
    }
  }
}

// Aman (the assistant) can send a pasted message to the real checker.
function runCheckWithText(text) {
  $("message-input").value = text;
  document.querySelector(".checker").scrollIntoView({ behavior: "smooth", block: "start" });
  onCheck();
}

// Checker tabs: message | email | call | outbound (before sending).
function switchCheckerTab(name) {
  const tabs = ["message", "email", "call", "outbound"];
  tabs.forEach((n) => {
    $(`tab-${n}`).hidden = n !== name;
    const b = $(`tab-btn-${n}`);
    b.classList.toggle("active", n === name);
    b.setAttribute("aria-selected", n === name ? "true" : "false");
  });
}

// Module tabs (below the quick checker): file | link | contacts | aid
// | chatlog | quiz | assistant | history | how. Same WAI-ARIA tabs
// pattern as the checker tabs — one panel visible at a time, all
// modules keep working exactly as before, nothing is removed.
// Tab order follows the most common needs (Myuden 19 Nov 17:44):
// check tools first (file, link), then official contacts + emergency
// guide + report, then chat export, quiz and Aman; history and how it
// works last so they never disturb the main flow.
const MODULE_TABS = ["file", "link", "contacts", "aid", "report", "chatlog", "quiz", "assistant", "history", "how"];
const MODULE_PANELS = {
  file: "filecheck",
  link: "linktrack",
  contacts: "contacts",
  aid: "firstaid",
  chatlog: "chatlog",
  quiz: "quiz",
  assistant: "assistant",
  history: "history",
  report: "crowdreport",
  how: "how",
};
function switchModuleTab(name) {
  MODULE_TABS.forEach((n) => {
    $(MODULE_PANELS[n]).hidden = n !== name;
    const b = $(`module-tab-${n}`);
    b.classList.toggle("active", n === name);
    b.setAttribute("aria-selected", n === name ? "true" : "false");
  });
}

// Outbound guard: the user pastes a message they are ABOUT to send.
// Checked locally with patterns only — never AI, never saved anywhere.
function onOutboundCheck() {
  const text = $("outbound-input").value;
  const box = $("outbound-result");
  const found = analyzeOutgoing(text);
  if (found.length === 0) {
    box.innerHTML = `<p class="outbound-clean">${escapeHtml(t("outboundClean", lang))}</p>`;
  } else {
    box.innerHTML = `<p class="outbound-warn-title">${escapeHtml(t("outboundWarnTitle", lang))}</p><ul class="flags">${found
      .map(
        (f) =>
          `<li><strong>${escapeHtml(t("outbound" + f.kind[0].toUpperCase() + f.kind.slice(1), lang))}</strong>${f.masked ? ` — <code>${escapeHtml(f.masked)}</code>` : ""}</li>`,
      )
      .join("")}</ul>`;
  }
  box.hidden = false;
}

// Email phishing check: sender name vs domain, free mailbox, links,
// pressure language — rendered as a normal verdict (LOCAL badge).
async function onEmailCheck() {
  const body = $("email-body").value.trim();
  const fromEmail = $("email-from-email").value.trim();
  const fromName = $("email-from-name").value.trim();
  const errorEl = $("email-error");
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (!body) {
    errorEl.textContent = t("errorEmpty", lang);
    errorEl.hidden = false;
    return;
  }
  if (!fromEmail) {
    errorEl.textContent = t("emailNoSender", lang);
    errorEl.hidden = false;
    return;
  }
  const btn = $("email-btn");
  btn.disabled = true;
  try {
    lastCheck = { kind: "email", fromName, fromEmail, body };
    const verdict = analyzeEmail({ fromName, fromEmail, body }, lang);
    renderResult(verdict, body, null);
    enrichResult(body);
    const where = await saveCheck({ message: body, ...verdict });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    errorEl.textContent = `${t("errorFailed", lang, { msg: err?.message || err })}`;
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

// Phone-call check: caller number + what was said, against the
// community reports (hash lookup) + known phone-scam scripts.
async function onCallCheck() {
  const number = $("call-number").value.trim();
  const said = $("call-said").value.trim();
  const errorEl = $("call-error");
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (!said && !number) {
    errorEl.textContent = t("callEmpty", lang);
    errorEl.hidden = false;
    return;
  }
  const btn = $("call-btn");
  btn.disabled = true;
  const runId = ++checkRunId;
  checkBusy = true;
  try {
    lastCheck = { kind: "call", number, said };
    const { verdict } = await analyzeCall({ number, said }, lang, { allowReports: !isLocalOnly() });
    if (runId !== checkRunId) return;
    const message = number && said ? `${number}: ${said}` : number || said;
    renderResult(verdict, message, null);
    enrichResult(message);
    const where = await saveCheck({ message, ...verdict });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    if (runId !== checkRunId) return;
    errorEl.textContent = `${t("errorFailed", lang, { msg: err?.message || err })}`;
    errorEl.hidden = false;
  } finally {
    if (runId !== checkRunId) return;
    checkBusy = false;
    btn.disabled = false;
    if (recheckAfterCheck) {
      recheckAfterCheck = false;
      recheckLastCheck();
    }
  }
}

// Phone-call voice: record the caller (loudspeaker + microphone) or
// upload a recording file. The audio is transcribed in the cloud and
// the transcript is scored like a message; the audio itself is never
// stored. A web page cannot tap a phone call directly — the UI says so
// (callAudioLimit) and the user records it themselves.
let callRecorder = null;
let callRecordChunks = [];
// Last recorded call audio, so a code-only fallback card's "Try again"
// can re-score the same recording (the message check's retry would
// check the wrong input).
let lastCallAudioBlob = null;
let callRecordTimer = null;
let callRecordStartedAt = 0;
const CALL_RECORD_MAX_SEC = 120;

function showCallAudioError(text) {
  const errorEl = $("call-audio-error");
  errorEl.textContent = text;
  errorEl.hidden = false;
}

function hideCallAudioError() {
  const errorEl = $("call-audio-error");
  errorEl.textContent = "";
  errorEl.hidden = true;
}

function setCallAudioProgress(text) {
  const progressEl = $("call-audio-progress");
  if (text) {
    progressEl.textContent = text;
    progressEl.hidden = false;
  } else {
    progressEl.textContent = "";
    progressEl.hidden = true;
  }
}

/** Map a transcription/scoring failure to the honest UI message. */
function callAudioErrorText(err) {
  const code = err?.message || String(err || "");
  if (code === "DEMO_NO_TRANSCRIBE") return t("callDemoNoTranscribe", lang);
  if (code === "NO_SPEECH") return t("callNoSpeech", lang);
  if (code === "AUDIO_TOO_BIG") return t("callAudioTooBig", lang);
  if (code === "AUDIO_TYPE") return t("callAudioType", lang);
  return `${t("errorFailed", lang, { msg: code })}`;
}

/**
 * Score a transcribed call: AI verdict for the transcript + local
 * call analysis (number + script patterns on the transcript), merged
 * with the worse verdict winning. Renders the result with the audio
 * privacy receipt line and shows the transcript.
 */
async function scoreTranscribedCall(audioBlob) {
  const number = $("call-number").value.trim();
  lastCallAudioBlob = audioBlob;
  hideCallAudioError();
  setCallAudioProgress(t("callTranscribing", lang));
  const t0 = performance.now();
  try {
    const { transcript } = await transcribeAudioWithAI(audioBlob, lang);
    const scoredText = transcript.slice(0, MAX_MESSAGE_CHARS);
    // Show the transcript where the user can read it — and fill the
    // "what was said" field so the typed flow stays consistent.
    $("call-transcript").textContent = transcript;
    $("call-transcript-box").hidden = false;
    $("call-said").value = transcript;
    // The AI verdict for the transcript can time out like any message
    // check (same 30 s budget): fall back to the code check on the
    // transcript, merged with the local call analysis, instead of a
    // dead error. A transcription failure has no transcript to score,
    // so it still errors honestly below.
    let aiVerdict;
    try {
      aiVerdict = await analyzeMessage(scoredText, undefined, lang);
    } catch (err) {
      if (
        !isFirebaseConfigured() ||
        /message too long/i.test(err?.message || "")
      ) {
        throw err;
      }
      aiVerdict = codeOnlyVerdict(scoredText, lang);
    }
    const { verdict: localVerdict } = await analyzeCall(
      { number, said: scoredText },
      lang,
      { allowReports: !isLocalOnly() },
    );
    const verdict = mergeCallVerdict(aiVerdict, localVerdict);
    const message = number ? `${number}: ${scoredText}` : scoredText;
    // No "checked in Xs" claim for a code-only card: the code verdict
    // was instant, the seconds were waiting for the AI.
    const elapsedSec =
      verdict.source === "CODE" ? null : (performance.now() - t0) / 1000;
    renderResult(verdict, message, elapsedSec, "", {
      audio: true,
      onRetry: () => scoreTranscribedCall(lastCallAudioBlob),
    });
    enrichResult(message);
    const where = await saveCheck({ message, ...verdict });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    showCallAudioError(callAudioErrorText(err));
  } finally {
    setCallAudioProgress("");
  }
}

function pickRecorderMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const mt of ["audio/webm", "audio/mp4", "audio/ogg"]) {
    try {
      if (MediaRecorder.isTypeSupported(mt)) return mt;
    } catch {
      // ignore — try the next one
    }
  }
  return "";
}

async function startCallRecording() {
  hideCallAudioError();
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    showCallAudioError(t("callMicUnsupported", lang));
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showCallAudioError(t("callMicDenied", lang));
    return;
  }
  callRecordChunks = [];
  const mimeType = pickRecorderMimeType();
  try {
    callRecorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
  } catch {
    stream.getTracks().forEach((tr) => tr.stop());
    showCallAudioError(t("callMicUnsupported", lang));
    return;
  }
  callRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) callRecordChunks.push(e.data);
  };
  callRecorder.onstop = () => {
    stream.getTracks().forEach((tr) => tr.stop());
    const blob = new Blob(callRecordChunks, {
      type: callRecorder.mimeType || "audio/webm",
    });
    callRecorder = null;
    if (blob.size > 0) scoreTranscribedCall(blob);
  };
  callRecorder.start(500);
  callRecordStartedAt = Date.now();
  const btn = $("call-record-btn");
  btn.textContent = t("callStopBtn", lang);
  btn.classList.add("recording");
  $("call-upload-btn").disabled = true;
  const recEl = $("call-recording");
  recEl.hidden = false;
  const tick = () => {
    const s = Math.floor((Date.now() - callRecordStartedAt) / 1000);
    recEl.textContent = t("callRecording", lang, { s });
    if (s >= CALL_RECORD_MAX_SEC) stopCallRecording();
  };
  tick();
  callRecordTimer = setInterval(tick, 1000);
}

function stopCallRecording() {
  if (callRecordTimer) {
    clearInterval(callRecordTimer);
    callRecordTimer = null;
  }
  $("call-recording").hidden = true;
  const btn = $("call-record-btn");
  btn.textContent = t("callRecordBtn", lang);
  btn.classList.remove("recording");
  $("call-upload-btn").disabled = false;
  if (callRecorder && callRecorder.state !== "inactive") {
    callRecorder.stop();
  }
}

function onCallRecordToggle() {
  if (callRecorder && callRecorder.state === "recording") {
    stopCallRecording();
  } else {
    startCallRecording();
  }
}

async function onCallAudioFile(file) {
  if (!file) return;
  hideCallAudioError();
  await scoreTranscribedCall(file);
}

// Official contacts directory (search + category filter).
function buildContactsCats() {
  const wrap = $("contacts-cats");
  wrap.innerHTML = "";
  const cats = [
    ["all", "contactsAll"],
    ["bank", "contactsBank"],
    ["ewallet", "contactsEwallet"],
    ["marketplace", "contactsMarketplace"],
    ["telecom", "contactsTelecom"],
    ["official", "contactsOfficial"],
  ];
  cats.forEach(([id, key]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secondary contacts-cat-btn" + (id === contactsCat ? " active" : "");
    b.textContent = t(key, lang);
    b.addEventListener("click", () => {
      contactsCat = id;
      wrap.querySelectorAll(".contacts-cat-btn").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      renderContacts();
    });
    wrap.appendChild(b);
  });
}

function renderContacts() {
  const q = $("contacts-search").value;
  const list = filterContacts(q, contactsCat);
  const ul = $("contacts-list");
  $("contacts-empty").hidden = list.length > 0;
  ul.innerHTML = list
    .map((c) => {
      let contact;
      if (!c.phone) {
        contact = `${escapeHtml(t("contactsViaApp", lang))} ${escapeHtml(c.via || "")}`;
      } else if (c.phone.includes("/")) {
        // Several numbers — show as text, no broken tel: link.
        contact = escapeHtml(c.phone);
      } else {
        const digits = c.phone.replace(/[^0-9]/g, "");
        contact = `<a href="tel:${digits}">${escapeHtml(c.phone)}</a>`;
      }
      const catKey =
        "contacts" + c.cat[0].toUpperCase() + c.cat.slice(1);
      return `<li><strong>${escapeHtml(c.name)}</strong> <span class="contacts-cat">${escapeHtml(t(catKey, lang))}</span><br/>${contact}${c.note ? ` <span class="muted">${escapeHtml(c.note)}</span>` : ""}</li>`;
    })
    .join("");
}

// First aid: pick a scenario, get the steps in order.
function renderAidOptions() {
  const wrap = $("aid-options");
  wrap.innerHTML = "";
  AID_SCENARIOS.forEach((sc) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secondary aid-opt";
    b.textContent = t(sc.optKey, lang);
    b.addEventListener("click", () => {
      wrap.querySelectorAll(".aid-opt").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const title = $("aid-steps-title");
      title.textContent = t("aidStepsTitle", lang);
      title.hidden = false;
      const ol = $("aid-steps");
      ol.innerHTML = sc.steps
        .map((s) => `<li>${escapeHtml(t(s, lang))}</li>`)
        .join("");
      ol.hidden = false;
    });
    wrap.appendChild(b);
  });
}

// Quiz: "Scam or safe?" — one question at a time, explained with the
// local heuristic's red flags on the same text.
function startQuiz() {
  quizState = {
    questions: getQuizQuestions(lang),
    index: 0,
    score: 0,
    answered: false,
  };
  $("quiz-start-btn").textContent = t("quizStart", lang);
  $("quiz-start-btn").hidden = true;
  $("quiz-area").hidden = false;
  showQuizQuestion();
}

function showQuizQuestion() {
  const q = quizState.questions[quizState.index];
  quizState.answered = false;
  $("quiz-progress").textContent = `${quizState.index + 1} / ${quizState.questions.length}`;
  $("quiz-question").textContent = q.text;
  const fb = $("quiz-feedback");
  fb.hidden = true;
  fb.innerHTML = "";
  $("quiz-next-btn").hidden = true;
  $("quiz-scam-btn").disabled = false;
  $("quiz-safe-btn").disabled = false;
  $("quiz-score").textContent = t("quizScore", lang, {
    n: quizState.score,
    m: quizState.index,
  });
}

function answerQuiz(guessScam) {
  if (!quizState || quizState.answered) return;
  quizState.answered = true;
  const q = quizState.questions[quizState.index];
  const correct = guessScam === q.scam;
  if (correct) quizState.score += 1;
  // The explanation is the curated "why" written for this question —
  // it always matches the ground truth. The live heuristic flags are
  // deliberately NOT shown here: the heuristic often disagrees with
  // the bank (e.g. a scam question the heuristic scores safe/0, or a
  // safe question it scores suspicious), and showing its flags next to
  // the correct answer contradicted the lesson (audit B6).
  const fb = $("quiz-feedback");
  fb.innerHTML = `<p><strong>${escapeHtml(correct ? t("quizCorrect", lang) : t("quizWrong", lang))}</strong></p><p><strong>${escapeHtml(t("quizWhy", lang))}</strong> ${escapeHtml(q.why)}</p>`;
  fb.hidden = false;
  $("quiz-scam-btn").disabled = true;
  $("quiz-safe-btn").disabled = true;
  $("quiz-score").textContent = t("quizScore", lang, {
    n: quizState.score,
    m: quizState.index + 1,
  });
  const last = quizState.index === quizState.questions.length - 1;
  const next = $("quiz-next-btn");
  next.hidden = false;
  next.textContent = last ? t("quizDone", lang) : t("quizNext", lang);
  next.onclick = () => {
    if (last) {
      $("quiz-area").hidden = true;
      const start = $("quiz-start-btn");
      start.hidden = false;
      start.textContent = `${t("quizDone", lang)} ${t("quizScore", lang, { n: quizState.score, m: quizState.questions.length })} — ${t("quizRestart", lang)}`;
      quizState = null;
    } else {
      quizState.index += 1;
      showQuizQuestion();
    }
  };
}

function buildSamples() {
  const samplesEl = $("samples");
  samplesEl.innerHTML = "";
  SAMPLES.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sample-btn";
    b.title = t(s.noteKey, lang);
    const label = document.createElement("span");
    label.className = "sample-label";
    label.textContent = t(s.labelKey, lang);
    const preview = document.createElement("span");
    preview.className = "sample-preview";
    // Bug 1 fix: the sample MESSAGE BODY follows the active language
    // (sampleText* keys in src/i18n.js, one natural text per language),
    // not a single hard-coded text — an English UI never shows an
    // Indonesian sample body, and vice versa.
    const text = t(s.textKey, lang);
    preview.textContent =
      text.length > 90 ? `${text.slice(0, 90)}…` : text;
    b.append(label, preview);
    b.addEventListener("click", () => {
      warmUpOnce();
      $("message-input").value = text;
      $("message-input").focus();
    });
    samplesEl.appendChild(b);
  });
}

// Apply the current language to every static string in the page.
function applyStaticLanguage() {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n, lang);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder, lang);
  });
  const demo = !isFirebaseConfigured();
  $("mode-label").textContent = demo ? t("modeDemo", lang) : t("modeAI", lang);
  const btn = $("check-btn");
  if (!btn.disabled) btn.textContent = checkBtnLabel();
  $("storage-note").textContent =
    lastStorageWhere === "firestore"
      ? t("storageFirestore", lang)
      : t("historyLocalNote", lang);
  setOnlineState();
  buildSamples();
  renderHistory(lastHistory);
  buildContactsCats();
  renderContacts();
  renderAidOptions();
  updateCrowdLabels();
  renderCrowdHistory();
  if (!quizState) $("quiz-start-btn").textContent = t("quizStart", lang);
  $("image-btn").disabled = demo || !selectedImage;
  refreshAssistantLanguage();
}

function exportHistoryCsv() {
  const header = "message,status,riskScore,source,createdAt";
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = lastHistory.map((e) =>
    [e.message, e.status, e.riskScore, e.source, e.createdAt]
      .map(esc)
      .join(","),
  );
  const blob = new Blob([[header, ...rows].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "tipucek-history.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function init() {
  // Language picker (top bar): auto-detected by default, saved on change.
  const select = $("lang-select");
  LANGUAGES.forEach((l) => {
    const opt = document.createElement("option");
    opt.value = l.code;
    opt.textContent = l.name;
    select.appendChild(opt);
  });
  select.value = lang;
  select.addEventListener("change", () => {
    lang = select.value;
    saveLanguage(lang);
    applyStaticLanguage();
    // Speed: re-render the current result card's static strings in
    // the new language right away (labels, headings, badge, code
    // check) — the AI-written summary + red flags stay in the old
    // language until the re-check below returns the new-language
    // verdict. Never a translation of the verdict itself. Skipped
    // while a check is running: the card on screen is then the
    // interim panel, not a verdict, and the running check's own
    // completion + follow-up re-check own the card.
    if (lastRenderArgs && !checkBusy && !$("result").hidden) {
      renderResult(
        lastRenderArgs.verdict,
        lastRenderArgs.message,
        lastRenderArgs.elapsedSec,
        lastRenderArgs.imageText,
        lastRenderArgs.extra,
      );
      enrichResult(lastRenderArgs.message);
    }
    // Bug 2 fix: when a result card is displayed, the language change
    // re-runs the same check in the new language (see
    // recheckLastCheck). With no result on screen, static strings are
    // enough. While a check is running, the re-check waits for it.
    if (!lastCheck) return;
    if (checkBusy) recheckAfterCheck = true;
    else recheckLastCheck();
  });

  // Demo-mode banner: visible, honest, always in the UI while unconfigured.
  const demo = !isFirebaseConfigured();
  $("demo-banner").hidden = !demo;

  buildSamples();

  $("message-input").addEventListener("focus", () => {
    warmUpOnce();
  });
  // Speed: warm the AI on ANY first tap/click on the page (not only
  // the input or a sample) so the warm-up has the longest possible
  // head start before the user presses Check.
  document.addEventListener("pointerdown", warmUpOnce, { once: true });
  // Speed: download the Firebase SDK chunks while the page is idle
  // (same-origin JavaScript only — no token, no model, no verdict),
  // so the first check does not pay for them inside ensureAIReady.
  if ("requestIdleCallback" in window) {
    requestIdleCallback(() => preloadAiModules().catch(() => {}), { timeout: 5000 });
  } else {
    setTimeout(() => preloadAiModules().catch(() => {}), 1500);
  }
  // Ctrl+Enter (or Cmd+Enter) checks without reaching for the button.
  $("message-input").addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      onCheck();
    }
  });
  $("check-btn").addEventListener("click", onCheck);
  // Floating "Tanya Aman" shortcut: same destination as the assistant
  // tab in "Alat lainnya" — open the tab, scroll it into view, and put
  // the cursor in the question box so the user can type at once.
  $("aman-fab").addEventListener("click", () => {
    switchModuleTab("assistant");
    $("assistant").scrollIntoView({ behavior: "smooth", block: "start" });
    $("assistant-input").focus({ preventScroll: true });
  });
  // Senior mode toggle (top bar).
  $("senior-toggle").addEventListener("click", () => {
    seniorMode = !seniorMode;
    applySeniorMode();
  });
  // Checker tabs: click + arrow keys (WAI-ARIA tabs pattern).
  const tabNames = ["message", "email", "call", "outbound"];
  tabNames.forEach((n, i) => {
    $(`tab-btn-${n}`).addEventListener("click", () => switchCheckerTab(n));
    $(`tab-btn-${n}`).addEventListener("keydown", (e) => {
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % tabNames.length;
      else if (e.key === "ArrowLeft")
        next = (i - 1 + tabNames.length) % tabNames.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabNames.length - 1;
      if (next >= 0) {
        e.preventDefault();
        switchCheckerTab(tabNames[next]);
        $(`tab-btn-${tabNames[next]}`).focus();
      }
    });
  });
  // Module tabs: click + arrow keys (WAI-ARIA tabs pattern).
  MODULE_TABS.forEach((n, i) => {
    $(`module-tab-${n}`).addEventListener("click", () => switchModuleTab(n));
    $(`module-tab-${n}`).addEventListener("keydown", (e) => {
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % MODULE_TABS.length;
      else if (e.key === "ArrowLeft")
        next = (i - 1 + MODULE_TABS.length) % MODULE_TABS.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = MODULE_TABS.length - 1;
      if (next >= 0) {
        e.preventDefault();
        switchModuleTab(MODULE_TABS[next]);
        $(`module-tab-${MODULE_TABS[next]}`).focus();
      }
    });
  });
  // One-tap paste: read the clipboard on the user's gesture, fill the
  // checker, and check immediately. Denied permission falls back to
  // focusing the box with an honest note.
  $("paste-btn").addEventListener("click", async () => {
    const note = $("paste-note");
    note.hidden = true;
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        note.textContent = t("pasteEmpty", lang);
        note.hidden = false;
        $("message-input").focus();
        return;
      }
      $("message-input").value = text;
      onCheck();
    } catch {
      note.textContent = t("pasteDenied", lang);
      note.hidden = false;
      $("message-input").focus();
    }
  });
  $("outbound-btn").addEventListener("click", onOutboundCheck);
  $("email-btn").addEventListener("click", onEmailCheck);
  $("call-btn").addEventListener("click", onCallCheck);
  // Call voice: record via microphone, or upload a recording file.
  $("call-record-btn").addEventListener("click", onCallRecordToggle);
  $("call-upload-btn").addEventListener("click", () => {
    hideCallAudioError();
    $("call-audio-input").click();
  });
  $("call-audio-input").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (file) onCallAudioFile(file);
  });
  // File check (magic bytes + local SHA-256 + community reports).
  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  $("filecheck-input").addEventListener("change", (e) => {
    selectedFile = (e.target.files && e.target.files[0]) || null;
    $("filecheck-btn").disabled = !selectedFile;
    const nameEl = $("filecheck-name");
    if (selectedFile) {
      nameEl.textContent = `${selectedFile.name} — ${formatSize(selectedFile.size)}`;
      nameEl.hidden = false;
    } else {
      nameEl.hidden = true;
    }
  });
  $("filecheck-btn").addEventListener("click", async () => {
    if (!selectedFile) return;
    const btn = $("filecheck-btn");
    const box = $("filecheck-result");
    btn.disabled = true;
    // Hashing a large file takes a moment — show progress instead of
    // a dead button while inspectFile runs.
    box.innerHTML = `<p class="progress">${escapeHtml(t("fileCheckWorking", lang))}</p>`;
    box.hidden = false;
    try {
      const info = await inspectFile(selectedFile);
      let countLine = "";
      // The file-content hash is high-entropy (not reversible), but the
      // lookup still talks to Firestore — so it is gated on cloud
      // history like every other lookup (audit §2c). With local-only
      // ON, no count is shown and no request is made.
      if (info.sha256 && !isLocalOnly()) {
        const n = await getReportCount(info.sha256);
        if (n != null && n > 0) {
          countLine = `<p>${escapeHtml(t("fileHashReported", lang, { n }))}</p>`;
        } else if (n === 0) {
          countLine = `<p class="muted">${escapeHtml(t("fileHashNew", lang))}</p>`;
        }
      }
      // Text files (.txt/.md/.csv/...): the content was read on the
      // device — score it like a pasted message with the local rule
      // engine. The button below sends the same text to the full
      // AI checker.
      let textScoreLine = "";
      if (info.kind === "text" && info.textContent) {
        const local = analyzeWithHeuristic(info.textContent, lang);
        const st =
          local.status === "scam"
            ? t("statusScam", lang)
            : local.status === "suspicious"
              ? t("statusSuspicious", lang)
              : t("statusSafe", lang);
        textScoreLine = `<div class="local-signal"><h3>${escapeHtml(t("localSignalTitle", lang))}</h3><p>${escapeHtml(t("localSignalText", lang, { score: local.riskScore, status: st, n: local.redFlags.length }))}</p>${local.redFlags.length > 0 ? `<ul class="flags">${local.redFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}</div>
        <p class="muted">${escapeHtml(info.textPreview || "")}</p>
        <div class="actions"><button id="filecheck-ai-btn" type="button" class="secondary">${escapeHtml(t("fileCheckAiBtn", lang))}</button></div>`;
      }
      box.innerHTML = `<div class="file-item file-${info.level}"><span class="file-name">${escapeHtml(info.fileName)}</span> — ${escapeHtml(t(info.reasonKey, lang))}</div>
        <p class="muted">${escapeHtml(t("fileCheckType", lang))}: ${escapeHtml(info.kind)}${info.sha256 ? ` · ${escapeHtml(t("fileFingerprintLabel", lang))} <code>${escapeHtml(info.sha256.slice(0, 16))}…</code>` : ""}</p>
        ${countLine}
        ${textScoreLine}
        <div class="actions"><button id="filecheck-report-btn" type="button" class="secondary">${escapeHtml(t("reportBtn", lang))}</button></div>
        <p class="hint">${escapeHtml(t("fileCheckNote", lang))}</p>`;
      box.hidden = false;
      const aiBtn = $("filecheck-ai-btn");
      if (aiBtn && info.textContent) {
        aiBtn.addEventListener("click", () => {
          $("message-input").value = info.textContent;
          document.querySelector(".checker").scrollIntoView({ behavior: "smooth", block: "start" });
          onCheck();
        });
      }
      $("filecheck-report-btn").addEventListener("click", async (ev) => {
        const b = ev.currentTarget;
        b.disabled = true;
        const r1 = info.sha256
          ? await submitReport("filehash", info.sha256)
          : "failed";
        const r2 = await submitReport("filename", info.fileName);
        const ok =
          r1 === "ok" || r1 === "already" || r2 === "ok" || r2 === "already";
        b.textContent = ok ? t("reportThanks", lang) : t("reportFailed", lang);
      });
    } catch (err) {
      console.error(err);
      box.innerHTML = `<p class="error">${escapeHtml(t("errorFailed", lang, { msg: err?.message || err }))}</p>`;
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  // Standalone link tracker: follow shorteners + RDAP lookup for ONE
  // link the user pastes. Explicit per-link consent: clicking the
  // button IS the consent to contact the shortener + rdap.org for
  // that link, so this runs even in local-only mode — unlike the
  // automatic enrichment inside result cards (audit §2c), which
  // stays gated on cloud history because the user never asked for it.
  $("linktrack-btn").addEventListener("click", async () => {
    const input = $("linktrack-input").value.trim();
    const box = $("linktrack-result");
    const err = $("linktrack-error");
    err.hidden = true;
    err.textContent = "";
    if (!/^https?:\/\//i.test(input)) {
      err.textContent = t("linktrackEmpty", lang);
      err.hidden = false;
      return;
    }
    const btn = $("linktrack-btn");
    btn.disabled = true;
    box.innerHTML = `<p class="progress">${escapeHtml(t("checking", lang))}</p>`;
    box.hidden = false;
    try {
      const short = await resolveShortLink(input);
      // Honest label: only call it the final destination when the
      // redirect was actually followed. When the follow was blocked
      // (CORS / mixed content / network), finalUrl below is just the
      // input URL — label it as the link that was entered, never as
      // a destination that was never reached.
      const resolved = short.resolved === true;
      const finalUrl = short.finalUrl || input;
      let host = "";
      try {
        host = new URL(finalUrl).hostname;
      } catch {
        host = "";
      }
      const info = host ? await lookupDomain(registrableDomain(host)) : { error: "unavailable" };
      const rdap =
        info && !info.error
          ? `<p><span class="numbers-label">${escapeHtml(t("linktrackRegistrar", lang))}:</span> ${escapeHtml(info.registrar || "—")}</p>
        ${info.registered ? `<p><span class="numbers-label">${escapeHtml(t("linktrackRegistered", lang))}:</span> ${escapeHtml(info.registered)}</p>` : ""}
        ${info.ageDays != null ? `<p><span class="numbers-label">${escapeHtml(t("linktrackAge", lang, { n: info.ageDays }))}</span></p>` : ""}`
          : `<p class="muted">${escapeHtml(t("linktrackNoInfo", lang))}</p>`;
      box.innerHTML = `<div class="links-box">
        <p><span class="numbers-label">${escapeHtml(t(resolved ? "linktrackFinal" : "linktrackFinalUnresolved", lang))}:</span> <span class="links-url">${escapeHtml(finalUrl)}</span></p>
        ${rdap}
        <p class="links-warn">${escapeHtml(t("linksWarn", lang))}</p>
      </div>`;
    } catch (e) {
      console.error(e);
      box.innerHTML = `<p class="error">${escapeHtml(t("linktrackFailed", lang))}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
  // Official contacts: live search.
  $("contacts-search").addEventListener("input", renderContacts);
  // Chat-log scanner (.txt export).
  $("chatlog-input").addEventListener("change", (e) => {
    selectedChatlog = (e.target.files && e.target.files[0]) || null;
    $("chatlog-btn").disabled = !selectedChatlog;
  });
  $("chatlog-btn").addEventListener("click", async () => {
    if (!selectedChatlog) return;
    const box = $("chatlog-result");
    const btn = $("chatlog-btn");
    btn.disabled = true;
    try {
      const text = await selectedChatlog.text();
      const res = scanChatLog(text, lang);
      if (res.error === "tooBig") {
        box.innerHTML = `<p class="error">${escapeHtml(t("chatlogTooBig", lang))}</p>`;
      } else if (res.total === 0) {
        box.innerHTML = `<p class="muted">${escapeHtml(t("chatlogEmpty", lang))}</p>`;
      } else {
        const head = `<p><strong>${res.total} ${escapeHtml(t("chatlogResult", lang))}</strong> — ${res.risky.length} ${escapeHtml(t("chatlogRisky", lang))}${res.truncated ? " (…)" : ""}</p>`;
        const list =
          res.risky.length > 0
            ? `<ul>${res.risky
                .slice(0, 50)
                .map(
                  (r) =>
                    `<li><strong>${escapeHtml(r.sender)}</strong> (${r.score}/100): ${escapeHtml(r.text.slice(0, 140))}${r.text.length > 140 ? "…" : ""}<br/><span class="muted">${r.flags.map(escapeHtml).join("; ")}</span></li>`,
                )
                .join("")}</ul>`
            : `<p class="muted">${escapeHtml(t("chatlogNone", lang))}</p>`;
        box.innerHTML = head + list;
      }
      box.hidden = false;
    } catch (err) {
      console.error(err);
      box.innerHTML = `<p class="error">${escapeHtml(t("errorFailed", lang, { msg: err?.message || err }))}</p>`;
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  // Quiz.
  $("quiz-start-btn").addEventListener("click", startQuiz);
  $("quiz-scam-btn").addEventListener("click", () => answerQuiz(true));
  $("quiz-safe-btn").addEventListener("click", () => answerQuiz(false));
  // Crowd reports ("Laporkan penipuan").
  $("crowd-type").addEventListener("change", updateCrowdLabels);
  $("crowd-submit-btn").addEventListener("click", onCrowdSubmit);
  updateCrowdLabels();
  renderCrowdHistory();
  $("clear-history-btn").addEventListener("click", async () => {
    clearLocalHistory();
    renderHistory(await loadHistory());
  });
  // Privacy: "save history only on this device" (default ON — nothing
  // leaves the device unless the user opts into cloud history).
  const localOnlyToggle = $("local-only-toggle");
  localOnlyToggle.checked = isLocalOnly();
  localOnlyToggle.addEventListener("change", async () => {
    setLocalOnly(localOnlyToggle.checked);
    renderHistory(await loadHistory());
  });
  $("export-history-btn").addEventListener("click", exportHistoryCsv);

  // Aman — the virtual assistant (avatar + chat).
  initAssistant({ getLang: () => lang, onCheckText: runCheckWithText });

  // Screenshot upload: preview + enable the check button.
  $("image-input").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    selectedImage = file || null;
    const preview = $("image-preview");
    if (selectedImage) {
      preview.src = URL.createObjectURL(selectedImage);
      preview.hidden = false;
      $("image-remove-btn").hidden = false;
    } else {
      preview.hidden = true;
      preview.removeAttribute("src");
      $("image-remove-btn").hidden = true;
    }
    $("image-btn").disabled = !isFirebaseConfigured() || !selectedImage;
  });
  $("image-btn").addEventListener("click", onImageCheck);
  $("image-remove-btn").addEventListener("click", () => {
    selectedImage = null;
    $("image-input").value = "";
    const preview = $("image-preview");
    preview.hidden = true;
    preview.removeAttribute("src");
    $("image-remove-btn").hidden = true;
    $("image-btn").disabled = true;
  });

  // PWA: register the service worker (installable app, offline shell).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }

  // Share Target: a message shared from another app (e.g. WhatsApp)
  // lands as ?text= (plus ?url=) — fill the checker and run the check.
  // The declared ?title= param is used only when ?text= is absent.
  const sharedParams = new URLSearchParams(window.location.search);
  const sharedText = sharedParams.get("text") || sharedParams.get("title");
  if (sharedText) {
    const sharedUrl = sharedParams.get("url");
    $("message-input").value = sharedUrl
      ? `${sharedText}\n${sharedUrl}`
      : sharedText;
    onCheck();
  }

  applyStaticLanguage();
  applySeniorMode();

  // Offline / airplane-mode indicator (live).
  setOnlineState();
  window.addEventListener("online", setOnlineState);
  window.addEventListener("offline", setOnlineState);

  // History on load (graceful: localStorage when Firestore is absent).
  loadHistory().then(renderHistory).catch(() => renderHistory([]));
}

init();
