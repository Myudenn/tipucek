// TipuCek — UI wiring (single page).

import "./styles.css";
import { analyzeMessage, analyzeImageWithAI, transcribeAudioWithAI, isFirebaseConfigured, warmUpAI, preloadAiModules, analyzeWithHeuristic, codeOnlyVerdict, BACKUP_CLOUD_MODEL, MAX_MESSAGE_CHARS } from "./ai.js";
import { analyzeLink, analyzeLinks, extractNumbers } from "./risks.js";
import { analyzeFiles } from "./files.js";
import { buildWarningCard, shareWarningCard } from "./sharecard.js";
import {
  initAssistant,
  refreshAssistantLanguage,
  openAmanPanel,
  closeAmanPanel,
  isAmanPanelOpen,
} from "./assistant.js";
import { saveCheck, loadHistory, clearLocalHistory, isLocalOnly, isHistorySavingEnabled, setHistorySavingEnabled, isHistoryTextHidden, setHistoryTextHidden, maskSensitive, getStatsTotals, seedTotalsFromList, localDayKey } from "./history.js";
import { inspectFile, analyzeFileName, fileTypeDisplay } from "./filecheck.js";
import { decodeQrFromImageData, classifyQrText } from "./qrcheck.js";
import { filterContacts } from "./contacts.js";
import { AID_SCENARIOS } from "./firstaid.js";
import { scanChatLog } from "./chatlog.js";
import { analyzeOutgoing } from "./outbound.js";
import { getReportCount, submitReport, reportHash } from "./reports.js";
import { readVisitorCount, incrementVisitorCount, shouldCountToday, readCountedDate } from "./visitors.js";
import {
  validateCrowdReport,
  submitCrowdReport,
  loadLocalReports,
} from "./crowdreport.js";
import { lookupDomain, resolveShortLink, registrableDomain, normalizeLinkInput } from "./domain.js";
import { getQuizQuestions } from "./quiz.js";
import { analyzeEmail } from "./emailcheck.js";
import { analyzeCall, mergeCallVerdict, currentMismatch } from "./callcheck.js";
import {
  isSupported,
  detectLanguage,
  saveLanguage,
  t,
  demoFlag,
  formatElapsed,
} from "./i18n.js";

const $ = (id) => document.getElementById(id);

// Honor reduced motion for every programmatic smooth scroll below:
// users who ask for less motion get instant jumps instead.
const REDUCED_MOTION = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const SCROLL_BEHAVIOR = REDUCED_MOTION ? "auto" : "smooth";

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
// Theme: dark/light + accent color — saved per device. Senior Mode
// always forces light, for readability. DEFAULT IS DARK (design G,
// 23 Nov 2026): a fresh visitor sees the dark G look; light is one
// tap away in the header theme menu and stays saved once chosen.
const THEME_MODES = ["light", "dark", "system"];
const ACCENTS = ["blue", "green", "purple"];
let themeMode = "dark";
let accent = "blue";
try {
  const savedTheme = localStorage.getItem("pesanaman_theme");
  if (THEME_MODES.includes(savedTheme)) themeMode = savedTheme;
  const savedAccent = localStorage.getItem("pesanaman_accent");
  if (ACCENTS.includes(savedAccent)) accent = savedAccent;
} catch {
  /* private mode — defaults stand */
}
// "System" follows the device: dark when the OS asks for dark.
function resolveThemeMode(mode) {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return mode;
}
function applyTheme() {
  const effective = seniorMode ? "light" : resolveThemeMode(themeMode);
  document.documentElement.dataset.theme = effective;
  document.documentElement.dataset.accent = accent;
  // Header theme button: the icon + label follow the EFFECTIVE mode
  // (moon = dark, sun = light); the menu checkmarks follow the SAVED
  // choice. Disabled while Senior Mode forces light.
  const themeBtn = $("theme-btn");
  if (themeBtn) {
    themeBtn.disabled = seniorMode;
    const moon = $("theme-icon-moon");
    const sun = $("theme-icon-sun");
    if (moon) moon.hidden = effective !== "dark";
    if (sun) sun.hidden = effective !== "light";
    themeBtn.setAttribute("aria-label", t("themeButtonLabel", lang, { mode: t(effective === "dark" ? "themeDark" : "themeLight", lang) }));
  }
  document.querySelectorAll("[data-theme-pick]").forEach((b) => {
    b.setAttribute("aria-checked", String(b.dataset.themePick === themeMode));
  });
  document.querySelectorAll("[data-accent-pick]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.accentPick === accent));
  });
}
function setThemeMode(mode) {
  if (!THEME_MODES.includes(mode)) return;
  themeMode = mode;
  try { localStorage.setItem("pesanaman_theme", mode); } catch { /* private mode */ }
  applyTheme();
}
// System mode follows the device LIVE: if the OS flips dark/light
// while "system" is saved, the app follows without a reload.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (themeMode === "system") applyTheme();
});
function setAccent(name) {
  if (!ACCENTS.includes(name)) return;
  accent = name;
  try { localStorage.setItem("pesanaman_accent", name); } catch { /* private mode */ }
  applyTheme();
}
// Text size: small/medium/large — a root font-size scale, saved per
// device. rem-based text follows automatically; the big display sizes
// (hero, section headings, stat numbers) are written in rem so the
// scale reaches titles too. Inputs stay 16px so iOS never zooms.
const TEXT_SIZES = ["small", "medium", "large"];
let textSize = "medium";
try {
  const savedSize = localStorage.getItem("pesanaman_text_size");
  if (TEXT_SIZES.includes(savedSize)) textSize = savedSize;
} catch {
  /* private mode — default stands */
}
function applyTextSize() {
  document.documentElement.dataset.textSize = textSize;
  document.querySelectorAll("[data-text-size-pick]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.textSizePick === textSize));
  });
}
function setTextSize(size) {
  if (!TEXT_SIZES.includes(size)) return;
  textSize = size;
  try { localStorage.setItem("pesanaman_text_size", size); } catch { /* private mode */ }
  applyTextSize();
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
// Message text of the verdict card currently on screen (21 Nov 2026,
// demo reference): while the textarea differs from it, the card is
// stale — dimmed with a "check again" bar (see refreshStaleState).
// Set by renderResult; cleared when the card is hidden.
let lastCheckedMessage = null;
// Email snapshot for the stale guard (audit 11 review): an email
// verdict also depends on the SENDER, which the stored message (body
// only) cannot capture. Set on a fresh email check; on a history
// restore it snapshots the sender fields as they stand at restore
// time (the sender is not stored); cleared by every other check.
let lastCheckedEmail = null;
// Panel stale snapshots (audit 12): the verdict a tool panel
// currently shows belongs to one input — the file name or the URL.
// Set when a panel renders (fresh check or restore); the panel goes
// stale when its input no longer matches. Null = no panel result.
let lastCheckedFileName = null;
let lastCheckedLink = null;
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
// Clean-checks disclosure state (21 Nov, Myuden: fold the clean rows):
// renderResult rebuilds the card's innerHTML on every render (fresh
// check, language change, history restore), so the open/closed state
// lives here, not on the <details> element — otherwise a language
// switch would silently close a disclosure the user had opened.
let cleanChecksOpen = false;
// Simplified card (Myuden 22 Nov 18:58): the "Rincian pemeriksaan"
// fold remembers open/closed across re-renders (language change
// rebuilds the card), like cleanChecksOpen above.
let resultDetailsOpen = false;

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
// Warning-card / PDF risk lines (Variant A "Resmi", 21 Nov 2026).
const RISK_LINE_KEY = { scam: "riskScam", suspicious: "riskSuspicious", safe: "riskSafe" };
const RISK_LEVEL_KEY = { scam: "riskLevelScam", suspicious: "riskLevelSuspicious", safe: "riskLevelSafe" };
const PRINT_SOURCE_KEY = { IN_CLOUD: "printSourceCloud", ON_DEVICE: "printSourceDevice", LOCAL: "printSourceLocal", CODE: "printSourceCode", DEMO: "printSourceDemo" };

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

// "Who" noun for the who-answered line (23 Nov 18:06, Myuden's
// screenshot "Dijawab oleh Dijawab di cloud"): sourceLabel returns
// full sentences ("Dijawab di cloud"), which double the phrase when
// plugged into "Dijawab oleh {who}". These are short nouns, so the
// line reads "Dijawab oleh AI cloud" / "Answered by cloud AI".
function sourceWho(source) {
  if (source === "ON_DEVICE") return t("sourceWhoDevice", lang);
  if (source === "IN_CLOUD") return t("sourceWhoCloud", lang);
  if (source === "DEMO") return t("sourceWhoDemo", lang);
  if (source === "LOCAL") return t("sourceWhoLocal", lang);
  if (source === "CODE") return t("sourceWhoCode", lang);
  return t("sourceWhoUnknown", lang);
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

// The message-tab send button is a LABELED pill (21 Nov 2026, demo
// reference): paper-plane icon + "Kirim untuk diperiksa" text, so the
// action is obvious at a glance. Its accessible name and visible label
// follow the UI language and senior mode. While a check runs the icon
// is swapped for a spinner and the label reads "Memeriksa…" (see
// setSendBtnLoading) — the button is rebuilt by renderSendBtn when the
// check ends, so the icon can never be lost.
const SEND_BTN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;
function sendBtnLabel() {
  return seniorMode ? t("seniorCheckBtn", lang) : t("chatSend", lang);
}
function renderSendBtn() {
  const btn = $("check-btn");
  if (!btn) return;
  btn.innerHTML = `${SEND_BTN_ICON}<span class="send-label">${escapeHtml(sendBtnLabel())}</span>`;
  btn.setAttribute("aria-label", sendBtnLabel());
}
// Loading state for the send button: spinner + "Memeriksa…" while the
// check runs, icon + label again when it ends (via renderSendBtn).
function setSendBtnLoading(loading) {
  const btn = $("check-btn");
  if (!btn) return;
  if (loading) {
    btn.innerHTML = `<span class="send-spinner" aria-hidden="true"></span><span class="send-label">${escapeHtml(t("checking", lang))}</span>`;
    btn.disabled = true;
  } else {
    renderSendBtn();
    refreshInputState();
  }
}
// Flow steps (21 Nov 2026, demo reference): 1 fill, 2 send, 3 see the
// result. Steps before the current one are done; the current one is
// active. One function owns the state so the pills can never disagree
// with the form (see refreshSteps).
function setCheckStep(n) {
  [1, 2, 3].forEach((i) => {
    const el = $(`step-${i}`);
    if (!el) return;
    el.classList.toggle("done", i < n);
    el.classList.toggle("active", i === n);
  });
}
function refreshSteps() {
  const resultShown = $("result") && !$("result").hidden;
  const hasText = $("message-input") && $("message-input").value.trim().length > 0;
  setCheckStep(resultShown ? 3 : hasText ? 2 : 1);
}
// Stale verdict (21 Nov 2026, demo reference): the card on screen was
// checked for different text than the textarea now holds. Dim the card
// and show its "check again" bar; an unchanged textarea clears it.
// Audit 11: the guard used to watch ONLY the message textarea, so
// editing a call/email/file/link form after its check left the old
// verdict standing as if current. Now the card is fresh when ANY of
// the checker inputs still holds the checked text (the tool that
// produced it), and stale when none does — switching tabs never
// stales a card, editing the producing tool's input always does.
function refreshStaleState() {
  // Audit 12 (1): the file/link panels have their own stale state
  // too (see refreshPanelStaleState) — it runs first so an early
  // return below (no card / email branch) never skips it.
  refreshPanelStaleState();
  const card = $("result")?.querySelector(".result-card");
  if (!card || lastCheckedMessage == null) return;
  // Audit 11 (review): an email verdict also depends on the sender —
  // the body alone cannot tell whether the card is stale.
  if (lastCheckedEmail) {
    const fresh =
      ($("email-body")?.value.trim() || "") === lastCheckedEmail.body &&
      ($("email-from-email")?.value.trim() || "") === lastCheckedEmail.fromEmail &&
      ($("email-from-name")?.value.trim() || "") === lastCheckedEmail.fromName;
    card.classList.toggle("stale", !fresh);
    return;
  }
  const number = $("call-number")?.value.trim() || "";
  const said = $("call-said")?.value.trim() || "";
  const callText = number && said ? `${number}: ${said}` : number || said;
  const current = [
    $("message-input")?.value.trim() || "",
    $("email-body")?.value.trim() || "",
    callText,
    $("filecheck-name-input")?.value.trim() || "",
    $("linktrack-input")?.value.trim() || "",
  ];
  card.classList.toggle("stale", !current.includes(lastCheckedMessage));
}
// Canonical key of a link input: the normalized URL the panel result
// belongs to, so "example.com" and "https://example.com" compare
// equal (audit 10 normalization) instead of wrongly going stale.
function panelLinkKey(value) {
  const raw = String(value || "").trim();
  return normalizeLinkInput(raw) || raw;
}
// Audit 12 (1): the file/link PANELS get their own stale state —
// the main card's guard already watches their inputs (audit 11),
// but the panel box kept showing the old result as if current.
// A panel is stale when it shows a result for a different input
// than the one now in its field: banner + dim, the same visual
// language as the main card (.result-stale-bar + .panel-stale).
// Only a shown RESULT can go stale — a progress or error box never
// does. The banner text is re-set on every call so a language
// change re-translates it (called from setLanguage too).
function refreshPanelStaleState() {
  const panels = [
    { box: $("filecheck-result"), current: $("filecheck-name-input")?.value.trim() || "", snapshot: lastCheckedFileName },
    { box: $("linktrack-result"), current: panelLinkKey($("linktrack-input")?.value || ""), snapshot: lastCheckedLink },
  ];
  for (const p of panels) {
    if (!p.box) continue;
    const bar = p.box.querySelector(".result-stale-bar");
    const hasResult =
      !p.box.hidden &&
      (p.box.innerText || "").trim() !== "" &&
      !p.box.querySelector(".progress") &&
      !p.box.querySelector(".error");
    const stale = hasResult && p.snapshot != null && p.current !== p.snapshot;
    p.box.classList.toggle("panel-stale", stale);
    if (stale) {
      if (bar) bar.textContent = t("panelStale", lang);
      else {
        const el = document.createElement("p");
        el.className = "result-stale-bar";
        el.textContent = t("panelStale", lang);
        p.box.prepend(el);
      }
    } else if (bar) {
      bar.remove();
    }
  }
}
// Snapshot a panel's input right after its result renders (fresh
// check or restore) — the panel is fresh for exactly this input
// until the field changes. The CHECKED value is passed in: the
// snapshot must be the value the verdict was computed from, NOT
// whatever the field holds at render time — the user may have edited
// the field while the check was running (Groq review, audit 12),
// and snapshotting the edited value would show the old verdict as
// if it belonged to the new input. The field-read fallback is only
// for call sites that have no checked value of their own.
function snapshotPanel(kind, value) {
  if (kind === "file") lastCheckedFileName = value !== undefined ? String(value) : $("filecheck-name-input")?.value.trim() || "";
  if (kind === "link") lastCheckedLink = panelLinkKey(value !== undefined ? value : $("linktrack-input")?.value || "");
  refreshPanelStaleState();
}
// Single refresh for everything the textarea drives: character count,
// send-button enabled state (disabled while empty or while a check
// runs), flow steps, stale state, and which sample chip looks selected.
// Called on every input event, after chip fill / paste, after a check
// ends, and on language change.
function refreshInputState() {
  const input = $("message-input");
  if (!input) return;
  const count = $("char-count");
  if (count) count.textContent = t("charCount", lang, { n: input.value.length });
  const btn = $("check-btn");
  if (btn) btn.disabled = checkBusy || input.value.trim().length === 0;
  const chips = document.querySelectorAll("#samples .sample-btn");
  chips.forEach((c, i) => {
    const s = SAMPLES[i];
    c.classList.toggle("selected", !!s && t(s.textKey, lang) === input.value);
  });
  refreshSteps();
  refreshStaleState();
}

function applySeniorMode() {
  document.body.classList.toggle("senior-mode", seniorMode);
  const toggle = $("senior-toggle");
  toggle.setAttribute("aria-pressed", seniorMode ? "true" : "false");
  $("senior-note").hidden = !seniorMode;
  renderSendBtn();
  try {
    localStorage.setItem("tipucek_senior_mode", seniorMode ? "1" : "0");
  } catch {
    /* private mode — the choice just won't persist */
  }
  // Senior Mode forces the light theme (applyTheme reads seniorMode).
  applyTheme();
}

// PDF report (Variant A "Resmi", 21 Nov 2026; simplified to exactly
// ONE A4 page, 21 Nov 19:06, Myuden "jadi 1 lembar jangan 2 lembar"):
// navy header + gold rule, title, ONE compact meta line (date,
// verdict, score, source, site — the old 5-row table is gone),
// checked-message quote (capped at 600 chars — the message is the
// only unbounded input), summary, red flags capped at 4 (most
// important first, same as the warning card), what-to-do, found
// items, one short privacy note + one-line legal line, footer.
// No "official document" claim anywhere — TipuCek is not an official
// institution. Nothing already shown is dropped: phones, accounts
// and links found in the message still appear.
function fillPrintReport(verdict, message, links, phones, accounts) {
  const el = $("print-report");
  const statusLabel = t(STATUS_KEY[verdict.status] || "statusSafe", lang);
  const when = new Date().toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  // 23 Nov 2026 regression: the fallback used to be printSourceCloud,
  // so a PDF from an ON_DEVICE (on-device AI) or LOCAL (on-device
  // rules) verdict claimed "Sumber vonis: AI TipuCek (cloud)" — a wrong
  // source on a document the user may share. An unknown source now
  // says so honestly instead of pretending to be the cloud.
  const sourceLabel = t(PRINT_SOURCE_KEY[verdict.source] || "printSourceUnknown", lang);
  const riskLevel = t(RISK_LEVEL_KEY[verdict.status] || "riskLevelSafe", lang);
  const quoteRaw = String(message || "").replace(/\s+/g, " ").trim();
  // Privacy (22 Nov audit 6): the printed quote is a document the
  // user may share — mask numbers/codes like every other render.
  // Audit 12: URL queries are stripped too (a token in a checked
  // link must never print).
  const quote = maskSensitive(stripUrlQueriesInText(quoteRaw.length > 600 ? `${quoteRaw.slice(0, 600)}…` : quoteRaw));
  // Found numbers are masked; links are shown without their query
  // (audit 12 — a token must never print; maskSensitive would
  // corrupt a long numeric path segment, so stripUrlQuery is used).
  const found = [...phones.map(maskSensitive), ...accounts.map(maskSensitive), ...links.map((l) => stripUrlQuery(l.url))];
  const flags = verdict.redFlags.slice(0, 4).map((f) => maskSensitive(f));
  el.innerHTML = `
    <header class="pr-header">
      <div class="pr-logo-tile"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="11" y="12" width="42" height="9.5" rx="4.75" fill="#ffffff"/><path d="M32 21.5 V39 L45 26.5" fill="none" stroke="#ffffff" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div>
        <div class="pr-brand">TipuCek</div>
        <div class="pr-tag">${escapeHtml(t("tagline", lang))}</div>
      </div>
      <div class="pr-header-right">
        <div class="pr-doc">${escapeHtml(t("printTitle", lang))}</div>
        <div class="pr-date">${escapeHtml(when)}</div>
      </div>
    </header>
    <div class="pr-gold"></div>
    <h1 class="pr-title">${escapeHtml(t("printTitle", lang))}</h1>
    <p class="pr-subtitle">${escapeHtml(t("printReportSubtitle", lang))}</p>
    <div class="pr-meta-line"><span class="pr-m"><b>${escapeHtml(t("printDate", lang))}:</b> ${escapeHtml(when)}</span><span class="pr-sep">•</span><span class="pr-m"><b>${escapeHtml(t("printVerdict", lang))}:</b> <span class="pr-status-${verdict.status}">${escapeHtml(statusLabel)}</span></span><span class="pr-sep">•</span><span class="pr-m"><b>${escapeHtml(t("printScore", lang))}:</b> <strong>${verdict.riskScore}</strong> / 100 &mdash; ${escapeHtml(riskLevel)}</span><span class="pr-sep">•</span><span class="pr-m"><b>${escapeHtml(t("printSource", lang))}:</b> ${escapeHtml(sourceLabel)}</span><span class="pr-sep">•</span><span class="pr-m"><b>${escapeHtml(t("printSite", lang))}:</b> tipucek.web.app</span></div>
    ${quote ? `<h2>${escapeHtml(t("headingCheckedMessage", lang))}</h2><div class="pr-quote">&ldquo;${escapeHtml(quote)}&rdquo;</div>` : ""}
    <h2>${escapeHtml(t("headingSummary", lang))}</h2>
    <p class="pr-text">${escapeHtml(maskSensitive(verdict.summary))}</p>
    ${flags.length > 0 ? `<h2>${escapeHtml(t("redFlags", lang))}</h2><ol class="pr-flags">${flags.map((f, i) => `<li><span class="pr-n pr-status-bg-${verdict.status}">${i + 1}</span> ${escapeHtml(f)}</li>`).join("")}</ol>` : ""}
    <h2>${escapeHtml(t("headingActions", lang))}</h2>
    <p class="pr-text">${escapeHtml(t(NEXT_KEY[verdict.status], lang))}</p>
    <h2>${escapeHtml(t("printFound", lang))}</h2>
    ${found.length > 0 ? `<ul class="pr-found">${found.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : `<p class="pr-text">${escapeHtml(t("printFoundNone", lang))}</p>`}
    <div class="pr-note">${escapeHtml(t("printPrivacyNote", lang))}<br>${escapeHtml(t("printFooter", lang))}</div>
    <footer class="pr-footer"><div class="pr-gold-thin"></div><div class="pr-row"><span class="pr-site">tipucek.web.app</span><span class="pr-note-line">${escapeHtml(t("cardFooterNote", lang))}</span></div></footer>`;
}

// Completion toast (round 6): "Pemeriksaan selesai" + verdict summary
// (translated status + score), bottom edge. Shows ONLY when a final
// result card renders — AI primary, backup, or code-only — never for an
// error with no verdict. Auto-hides after ~3 s (audit M2, 21 Nov:
// 5 s covered result content too long); the × button hides it
// at once. Hidden when a new check starts or the language changes (the
// re-check shows a fresh toast in the new language).
const TOAST_MS = 3000;
let toastTimer = null;
let toastNudgeTimer = null;
// App-update notice (21 Nov, bug tema "Sistem" di HP Myuden): a tab
// left open keeps running its old bundle, so without a signal the
// user can sit on a stale build for days while the live site moves
// on. pendingUpdate = a newer worker took control and the user has
// not reloaded or dismissed yet; updateToastShown = the shared #toast
// element currently shows the update notice; updateToastTakenOver =
// a check/info toast took over from the update notice, so it must be
// put back once that toast hides.
let pendingUpdate = false;
let updateToastShown = false;
let updateToastTakenOver = false;
// The toast is fixed at the viewport bottom: the page-end padding
// only protects the very end of the page, so without help the toast
// covers whatever content sits at the viewport bottom when the check
// finishes (live check 21 Nov 01:05: it covered the "Contoh
// mencurigakan" list). Nudge the page down just enough that the
// samples list and the verdict headline sit above the toast's top
// edge — only when the toast actually overlaps them, never otherwise,
// so a check that already clears the toast does not move the page at
// all. Re-runs on a delay (see showCheckCompleteToast): the layout
// shifts AFTER the toast shows — saving the check re-renders the
// 7-day chart above the checker, pushing the samples down ~100px —
// so a single nudge measured at toast time is not enough.
function nudgePageForToast() {
  const el = $("toast");
  if (!el || el.hidden) return;
  const toastRect = el.getBoundingClientRect();
  let nudge = 0;
  const clearBelowToast = (rect) => {
    if (!rect || rect.bottom <= rect.top) return;
    if (toastRect.top < rect.bottom && toastRect.bottom > rect.top) {
      nudge = Math.max(nudge, rect.bottom - toastRect.top + 12);
    }
  };
  const samplesEl = $("samples");
  const samplesHead = document.querySelector(".samples-heading");
  if (samplesEl && samplesHead) {
    const head = samplesHead.getBoundingClientRect();
    const list = samplesEl.getBoundingClientRect();
    if (list.bottom > list.top && head.bottom > head.top) {
      clearBelowToast({ top: head.top, bottom: list.bottom });
    }
  }
  // Chat composer (21 Nov): the completion toast is fixed at the
  // viewport bottom, right where the message input + send button sit
  // after a check — the samples + result headline were protected,
  // the composer was not, so the toast covered the input until it
  // auto-hid. A hidden tab reports a zero rect and is skipped.
  const composerEl = document.querySelector(".chat-composer");
  if (composerEl) clearBelowToast(composerEl.getBoundingClientRect());
  // Screenshot upload (21 Nov, Myuden's phone screenshot): the toast
  // covered the "Atau periksa tangkapan layar" hint — the section
  // sits right below the composer, so it lands under the fixed toast
  // even when the composer above it is already clear. Protect the
  // section's heading + hint + buttons (not the preview below them).
  const imageCheckEl = document.querySelector(".image-check");
  const imageRowEl = document.querySelector(".image-check .image-row");
  if (imageCheckEl && imageRowEl) {
    const top = imageCheckEl.getBoundingClientRect().top;
    const bottom = imageRowEl.getBoundingClientRect().bottom;
    if (bottom > top) clearBelowToast({ top, bottom });
  }
  const resultEl = $("result");
  if (resultEl && !resultEl.hidden) {
    const r = resultEl.getBoundingClientRect();
    // Headline zone: status + score + the first summary lines.
    if (r.bottom > r.top) clearBelowToast({ top: r.top, bottom: r.top + 160 });
  }
  if (nudge > 0) window.scrollTo({ top: window.scrollY + nudge, behavior: SCROLL_BEHAVIOR });
}
// Delayed nudge passes for a visible toast. The layout shifts AFTER
// the toast shows — the toast is shown inside renderResult, but the
// caller re-renders the 7-day chart when the check is saved
// (renderHistory), pushing the samples down under the toast. A
// single nudge measured at toast time is therefore not enough. The
// 200 ms pass is the important one: it re-measures right after that
// shift (the save lands within ~10 ms), so the overlap is cleared
// in a blink instead of living until the 800 ms pass (21 Nov 11:49
// live: the toast covered the samples heading for ~0.8 s on
// desktop). The later passes keep their original times as backstops
// for slower shifts. Each pass is a no-op when nothing overlaps.
function scheduleToastNudges() {
  clearTimeout(toastNudgeTimer);
  toastNudgeTimer = setTimeout(() => {
    nudgePageForToast();
    toastNudgeTimer = setTimeout(() => {
      nudgePageForToast();
      toastNudgeTimer = setTimeout(nudgePageForToast, 1200);
    }, 600);
  }, 200);
}
function showCheckCompleteToast(verdict) {
  const el = $("toast");
  if (!el) return;
  // Taking over the shared #toast element from the update notice —
  // remember to put the notice back once this toast hides.
  if (updateToastShown) {
    updateToastShown = false;
    updateToastTakenOver = true;
  }
  const statusLabel = t(STATUS_KEY[verdict.status] || "statusSafe", lang);
  el.innerHTML = `<span class="check-complete-icon" aria-hidden="true">✓</span><span class="toast-text"><strong>${escapeHtml(t("checkComplete", lang))}</strong>${escapeHtml(statusLabel)} ${verdict.riskScore}/100</span><button type="button" class="toast-close" aria-label="${escapeHtml(t("toastClose", lang))}">×</button>`;
  el.hidden = false;
  // While the toast shows, the page gets bottom padding (see
  // body.toast-visible in styles.css) so the fixed toast never covers
  // result content — audit round 7: it covered the Red flags chips.
  document.body.classList.add("toast-visible");
  nudgePageForToast();
  // Delayed re-passes (see scheduleToastNudges): the layout shifts
  // after the toast shows, so a single nudge is not enough.
  scheduleToastNudges();
  el.querySelector(".toast-close").addEventListener("click", hideCheckCompleteToast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideCheckCompleteToast, TOAST_MS);
}
function hideCheckCompleteToast() {
  const el = $("toast");
  if (!el) return;
  // The update notice owns the shared #toast element while it shows
  // — never sweep it away from under it (a new check starting, a
  // language change). It has its own dismiss (hideUpdateToast).
  if (updateToastShown) return;
  el.hidden = true;
  document.body.classList.remove("toast-visible");
  clearTimeout(toastTimer);
  toastTimer = null;
  clearTimeout(toastNudgeTimer);
  toastNudgeTimer = null;
  // A check/info toast took over from the update notice — put the
  // notice back now that the toast is free.
  if (pendingUpdate && updateToastTakenOver) {
    updateToastTakenOver = false;
    showUpdateToast();
  }
}

// App-update toast (21 Nov, bug tema "Sistem" di HP Myuden): a tab
// that stays open keeps running its old bundle — the service worker
// cannot reload the page by itself, so without a signal the user can
// sit on a stale build for days (old icons, old strings) while the
// live site has moved on. When a newer worker takes control, say so
// and offer one tap to reload. NEVER auto-reloads: a reload mid-check
// would throw away a verdict in progress. The notice stays until the
// user reloads or dismisses it (×) — unlike the 3 s check toast.
function showUpdateToast() {
  const el = $("toast");
  if (!el || !pendingUpdate || updateToastShown) return;
  if (!el.hidden) {
    // A check/info toast is showing — wait for it to clear, then announce.
    setTimeout(showUpdateToast, 6000);
    return;
  }
  el.innerHTML = `<span class="check-complete-icon" aria-hidden="true">✓</span><span class="toast-text"><strong>${escapeHtml(t("updateAvailable", lang))}</strong>${escapeHtml(t("updateAvailableText", lang))}</span><button type="button" class="toast-action">${escapeHtml(t("updateReload", lang))}</button><button type="button" class="toast-close" aria-label="${escapeHtml(t("toastClose", lang))}">×</button>`;
  el.hidden = false;
  updateToastShown = true;
  document.body.classList.add("toast-visible");
  nudgePageForToast();
  scheduleToastNudges();
  el.querySelector(".toast-close").addEventListener("click", hideUpdateToast);
  el.querySelector(".toast-action").addEventListener("click", () => window.location.reload());
}
function hideUpdateToast() {
  pendingUpdate = false;
  updateToastShown = false;
  updateToastTakenOver = false;
  const el = $("toast");
  if (!el) return;
  el.hidden = true;
  document.body.classList.remove("toast-visible");
  clearTimeout(toastTimer);
  toastTimer = null;
  clearTimeout(toastNudgeTimer);
  toastNudgeTimer = null;
}

// Plain info toast on the same #toast element (e.g. "History
// cleared") — same auto-hide + bottom padding + nudge passes as the
// check-complete toast, so it never covers content either.
function showInfoToast(text) {
  const el = $("toast");
  if (!el) return;
  // Taking over the shared #toast element from the update notice —
  // remember to put the notice back once this toast hides.
  if (updateToastShown) {
    updateToastShown = false;
    updateToastTakenOver = true;
  }
  el.innerHTML = `<span class="check-complete-icon" aria-hidden="true">✓</span><span class="toast-text">${escapeHtml(text)}</span><button type="button" class="toast-close" aria-label="${escapeHtml(t("toastClose", lang))}">×</button>`;
  el.hidden = false;
  document.body.classList.add("toast-visible");
  nudgePageForToast();
  scheduleToastNudges();
  el.querySelector(".toast-close").addEventListener("click", hideCheckCompleteToast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideCheckCompleteToast, TOAST_MS);
}

// A failed check must never leave a previous verdict card on screen
// pretending to be this check's result (audit round 7: a failed
// screenshot check left the old call verdict displayed). Hide the card
// and its toast; the error box carries the failure instead.
function hideStaleResult() {
  const el = $("result");
  if (el) el.hidden = true;
  hideCheckCompleteToast();
  // No card on screen: nothing can go stale, and the flow steps fall
  // back to the form state (text ? send : fill).
  lastCheckedMessage = null;
  refreshSteps();
}

// Local code-check checklist (21 Nov 2026, demo reference): every
// fixed rule the device ran, found (red ✕, DITEMUKAN + evidence quote)
// or clean (green ✓, TIDAK DITEMUKAN). The pills count them. Labels
// come from the rule's flag text (demoFlag, already translated);
// descriptions are the checkDesc_<id> i18n keys. Presentation only —
// the verdict score never depends on this list.
function renderLocalChecks(local, lang) {
  const checks = Array.isArray(local?.checks) ? local.checks : [];
  // Info rows (kind:"info", 21 Nov audit 5) are facts, not danger
  // signs — they live in their own list below and are NOT counted in
  // the pills, so "X aturan diperiksa · Y terpicu · Z bersih" always
  // adds up over the rules alone.
  const rules = checks.filter((c) => c.kind !== "info");
  const info = checks.filter((c) => c.kind === "info");
  const found = rules.filter((c) => c.found).length;
  const cleanCount = rules.length - found;
  // Clickable pills (Myuden 22 Nov 20:57 + 21:02): "N terpicu" and
  // "N bersih" are BUTTONS when their count is > 0 — they jump to
  // their lists (handler in renderResult, re-attached after every
  // render like the clean-checks toggle). A 0 count stays a static
  // span (no list to jump to). "N aturan diperiksa" is always a
  // static span (a total, no single target). The chevron ›
  // (aria-hidden, same colour, small) marks a pill tappable; the
  // button reset in styles.css keeps it looking like a span.
  const chev = `<span class="pill-chev" aria-hidden="true">›</span>`;
  const foundPill =
    found > 0
      ? `<button type="button" class="meta-pill bad meta-pill-btn" data-pill-jump="found">${escapeHtml(t("checksFound", lang, { n: found }))}${chev}</button>`
      : `<span class="meta-pill">${escapeHtml(t("checksFound", lang, { n: found }))}</span>`;
  const cleanPill =
    cleanCount > 0
      ? `<button type="button" class="meta-pill${found === 0 ? " good" : ""} meta-pill-btn" data-pill-jump="clean">${escapeHtml(t("checksClean", lang, { n: cleanCount }))}${chev}</button>`
      : `<span class="meta-pill${found === 0 ? " good" : ""}">${escapeHtml(t("checksClean", lang, { n: cleanCount }))}</span>`;
  const pills = `<div class="check-pills">
    <span class="meta-pill">${escapeHtml(t("checksExamined", lang, { n: rules.length }))}</span>
    ${foundPill}
    ${cleanPill}
  </div>`;
  // Privacy (22 Nov audit 6): evidence quotes are the matched words
  // around the trigger — for OTP/phone rules that window contains
  // the code or number itself in full. Mask every quote at render:
  // the stored verdict keeps the raw evidence, only the DISPLAY
  // is masked (same rule as history snippets).
  // Audit 12 (security): a URL query can carry a session/reset
  // token — strip it from the displayed quote too (the evidence of
  // a link check IS the checked URL).
  const evHtml = (c) =>
    c.evidence
      ? `<div class="evidence"><b>${escapeHtml(t("checkEvidence", lang))}</b> &ldquo;${escapeHtml(maskSensitive(stripUrlQueriesInText(c.evidence)))}&rdquo;</div>`
      : "";
  const rowHtml = (c) => {
    const ev = evHtml(c);
    return `<li class="${c.found ? "found" : "clear"}"><span class="check-ico" aria-hidden="true">${c.found ? "✕" : "✓"}</span><div class="check-body"><div class="check-head"><b>${escapeHtml(demoFlag(c.flag, lang))}</b><span class="status">${escapeHtml(t(c.found ? "checkFound" : "checkClean", lang))}</span></div><p>${escapeHtml(t(`checkDesc_${c.id}`, lang))}</p>${ev}</div></li>`;
  };
  const infoRowHtml = (c) => {
    const ev = evHtml(c);
    return `<li class="info"><span class="check-ico" aria-hidden="true">ℹ</span><div class="check-body"><div class="check-head"><b>${escapeHtml(demoFlag(c.flag, lang))}</b></div><p>${escapeHtml(t(`checkDesc_${c.id}`, lang))}</p>${ev}</div></li>`;
  };
  // Folded clean rows (21 Nov, Myuden: "lipat baris bersihnya"): the
  // FOUND rows stay fully visible — they are what matters — while the
  // clean rows live in a disclosure that is CLOSED by default, so the
  // card is ~60% shorter. The disclosure title carries the count; the
  // rows inside are identical to before (description + evidence).
  // Open state lives in cleanChecksOpen (module level) so a language
  // re-render keeps what the user had open.
  const foundRows = rules.filter((c) => c.found).map(rowHtml).join("");
  const cleanRows = rules.filter((c) => !c.found).map(rowHtml).join("");
  const foundList = foundRows !== "" ? `<ul class="local-checks">${foundRows}</ul>` : "";
  const cleanDisclosure =
    cleanCount > 0
      ? `<details class="clean-checks"${cleanChecksOpen ? " open" : ""}><summary><span class="check-ico" aria-hidden="true">✓</span><span>${escapeHtml(t("checksCleanToggle", lang, { n: cleanCount }))}</span></summary><ul class="local-checks">${cleanRows}</ul></details>`
      : "";
  const infoList =
    info.length > 0 ? `<ul class="local-info-checks">${info.map(infoRowHtml).join("")}</ul>` : "";
  return `${pills}${foundList}${cleanDisclosure}${infoList}`;
}

function renderResult(verdict, message, elapsedSec, imageText = "", extra = {}, showToast = false) {
  const el = $("result");
  // Language fix (21 Nov 01:20): a code-only/demo verdict's summary +
  // red flags are translated strings stored at check time. Re-rendering
  // the card in a new language re-used the OLD-language strings, so the
  // card came out mixed (labels new, verdict text old) whenever the
  // re-check failed. Code/demo verdicts are fully determined by the
  // message, so re-derive them in the CURRENT language on every render:
  // the card is then 100% the new language with no re-check at all.
  // AI verdicts (free text from the model) cannot be re-derived — those
  // still need the re-check, and a failed re-check marks the card stale
  // (see extra.langStale below) instead of leaving it mixed silently.
  if (verdict.source === "CODE" || verdict.source === "DEMO") {
    const fresh = analyzeWithHeuristic(message, lang);
    verdict = {
      ...fresh,
      source: verdict.source,
      model: verdict.model,
      codeOnlyReason: verdict.codeOnlyReason,
    };
  }
  // Remember the exact render arguments for the instant static
  // re-label on language change (see the language picker handler).
  lastRenderArgs = { verdict, message, elapsedSec, imageText, extra };
  // Audit 14: the AI summary + red flags are FREE TEXT from the model
  // and may quote a code/token from the checked message ("abc123") —
  // mask them for DISPLAY like every other render. The stored verdict
  // keeps the raw text (needed for re-check/reporting); only what the
  // user sees is masked. These masked copies feed the card below and
  // the copy/share/download/warn-family handlers (all closures over
  // this function) — never the raw verdict fields.
  const displaySummary = maskSensitive(verdict.summary || "");
  const displayFlags = (verdict.redFlags || []).map((f) => maskSensitive(f));
  // Red flags as a checklist (21 Nov 2026 polish): one neat row per
  // finding — warning marker + text, generous spacing — instead of the
  // old wrapping chips. These are the VERDICT's own findings; the
  // device code check's list is further below.
  const flags =
    displayFlags.length > 0
      ? `<ul class="flags">${displayFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
      : `<p class="no-flags">${escapeHtml(t("noFlags", lang))}</p>`;
  // Main sign (demo reference): the top finding, highlighted — only
  // when the verdict has any flag at all.
  const mainSign =
    displayFlags.length > 0
      ? `<div class="main-sign"><strong>${escapeHtml(t("mainSign", lang))}</strong> ${escapeHtml(displayFlags[0])}</div>`
      : "";
  // Info flags (21 Nov audit 5): facts that explain the verdict but
  // are NOT danger signs (official-contact match, verified identity
  // claim). Their own box with a blue "i" marker, so a Safe card for
  // an official number never shows them under "Tanda bahaya".
  const infoBox =
    Array.isArray(verdict.infoFlags) && verdict.infoFlags.length > 0
      ? `<div class="info-flags"><h3>${escapeHtml(t("infoFlags", lang))}</h3><ul>${verdict.infoFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul></div>`
      : "";
  // Score ring: r=34, circumference ~213.6.
  const ringC = 2 * Math.PI * 34;
  const ringOffset = ringC * (1 - verdict.riskScore / 100);
  // Elapsed pill (21 Nov audit 5 — the auditor's "no duration"
  // note; 22 Nov audit 6 — the "2.4-2.9 s looks simulated" note):
  // on-device verdicts (LOCAL/DEMO) show the REAL measured wait.
  // For a call check the total includes the community report lookup
  // (Firestore round-trip); when its own time is known it is shown
  // as a split, so the number is provably the lookup, not a delay.
  // The wording stays honest: "no AI wait". Cloud/code verdicts
  // keep the plain "checked in {s}s" line.
  const isLocalVerdict = verdict.source === "LOCAL" || verdict.source === "DEMO";
  // Audit 9: formatElapsed always prints milliseconds — ONE fixed
  // unit for every check, so the unit can never flip between
  // checks ("2.7 dtk" once, "320.7 md" the next). No pillUnit.
  const elapsed =
    elapsedSec != null
      ? `<span class="result-meta">${escapeHtml(
          isLocalVerdict && extra.lookupSec != null
            ? t("checkedInLocalLookup", lang, { s: formatElapsed(elapsedSec, lang), l: formatElapsed(extra.lookupSec, lang) })
            : t(isLocalVerdict ? "checkedInLocal" : "checkedIn", lang, { s: formatElapsed(elapsedSec, lang) }),
        )}</span>`
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
              return `<li class="link-item risk-${l.level}"><span class="link-risk">${escapeHtml(riskLabel)}</span> <span class="links-host">${escapeHtml(l.host)}</span> <span class="links-url">${escapeHtml(maskSensitive(stripUrlQuery(l.url)))}</span>${reasons}</li>`;
            })
            .join("")}</ul>
          <p class="links-warn">${escapeHtml(t("linksWarn", lang))}</p>
          <p class="links-note">${escapeHtml(t("linksRiskNote", lang))}</p>
        </div>`
      : "";
  // Phone numbers + bank accounts found in the message, with the
  // official checker link for accounts (no scam database of our own).
  const { phones, accounts } = extractNumbers(message);
  // Privacy (21 Nov 01:19): a card re-opened from history (extra.masked)
  // hides the numbers box — its values are sensitive and the box would
  // show them whole. Reporting still works: the buttons below use the
  // real values from this closure, only on a deliberate tap.
  const numbersBox =
    !extra.masked && (phones.length > 0 || accounts.length > 0)
      ? `<div class="numbers-box">
          <h3>${escapeHtml(t("numbersTitle", lang))}</h3>
          ${phones
            .map(
              (p) =>
                `<p><span class="numbers-label">${escapeHtml(t("numbersPhoneLabel", lang))}:</span> <span class="numbers-value">${escapeHtml(maskSensitive(p))}</span> <a href="https://aduannomor.id" target="_blank" rel="noopener">${escapeHtml(t("numbersReportPhone", lang))}</a></p>`,
            )
            .join("")}
          ${accounts
            .map(
              (a) =>
                `<p><span class="numbers-label">${escapeHtml(t("numbersAccountLabel", lang))}:</span> <span class="numbers-value">${escapeHtml(maskSensitive(a))}</span> <a href="https://cekrekening.id" target="_blank" rel="noopener">${escapeHtml(t("numbersCheckAccount", lang))}</a></p>`,
            )
            .join("")}
          <p class="numbers-warn">${escapeHtml(t("numbersWarn", lang))}</p>
        </div>`
      : "";
  const imageNote =
    imageText !== ""
      ? `<p class="image-read-text"><strong>${escapeHtml(t("imageReadText", lang))}</strong> ${escapeHtml(maskSensitive(imageText))}</p>`
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
  // verdict — the AI verdict above is the verdict. The checklist shows
  // every rule that ran (found/clean) with its counts as pills; the
  // intro line (production only) keeps the honest "not the final
  // verdict" wording. In demo/code mode the verdict IS this heuristic,
  // so the list is shown without that line — the code-only note above
  // already says there is no AI verdict.
  //
  // Which rule set the checklist shows (21 Nov, audit 4): a LOCAL
  // verdict (email/call) carries its OWN checks — the 17 message
  // rules are a different system, and showing them made the top list
  // say 3 while the checklist counted 4 (call), or 6 while it counted
  // 3 (email). Cloud verdicts carry no checks, so they keep the
  // heuristic as the labelled second signal, as before.
  const local =
    Array.isArray(verdict.checks) && verdict.checks.length > 0
      ? { checks: verdict.checks, redFlags: verdict.redFlags, status: verdict.status, riskScore: verdict.riskScore }
      : analyzeWithHeuristic(message, lang);
  const localStatus =
    local.status === "scam"
      ? t("statusScam", lang)
      : local.status === "suspicious"
        ? t("statusSuspicious", lang)
        : t("statusSafe", lang);
  // One score only (21 Nov, Myuden: 40 vs 60 on Cek Nomor). For a
  // LOCAL verdict the intro quotes the VERDICT's own score/status/
  // flag count — the heuristic re-computation is a different rule
  // set and must not appear as a second score. For cloud verdicts
  // the intro stays a labelled second signal (the heuristic score
  // is explicitly "not the final verdict").
  const localIntro =
    verdict.source === "LOCAL"
      ? `<p>${escapeHtml(t("localSignalTextLocal", lang, { score: verdict.riskScore, status: t(STATUS_KEY[verdict.status], lang) }))}</p>`
      : isFirebaseConfigured() &&
          verdict.source !== "DEMO" &&
          verdict.source !== "CODE"
        ? `<p>${escapeHtml(t("localSignalText", lang, { score: local.riskScore, status: localStatus, n: local.redFlags.length }))}</p>`
        : "";
  // Title: for a LOCAL verdict this box IS the verdict, not a
  // preliminary "initial check" — label it as the on-device check.
  const localSignalTitle = verdict.source === "LOCAL" ? t("modeLocal", lang) : t("localSignalTitle", lang);
  const localSignal = `<div class="local-signal"><h3>${escapeHtml(localSignalTitle)}</h3>${localIntro}${renderLocalChecks(local, lang)}</div>`;
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
              ? t(verdict.codeOnlyReason === "unavailable" ? "receiptCodeUnavailable" : "receiptCode", lang)
              : t("receiptUnknown", lang);
  const receiptStored = isLocalOnly()
    ? t("receiptStoredLocal", lang)
    : t("receiptStoredCloud", lang);
  // The answering cloud model is NOT shown in the user-facing receipt
  // (21 Nov, Myuden — users do not understand model names; the "Model:
  // gemini-3.5-flash-lite" line is gone). The model stays recorded in
  // history (e.model) and in the jury docs (DEVPOST-DESCRIPTION.md,
  // README), so a backup verdict is still traceable, just not shown
  // to the user.
  // Audio verdicts (transcribed phone call): the recording was sent to
  // the cloud for transcription — say so in the receipt, next to the
  // message-to-cloud line. The recording itself is never stored.
  const receiptAudio = extra.audio
    ? `<p>${escapeHtml(t("receiptAudio", lang))}</p>`
    : "";
  // Auto-redact note (23 Nov 2026): when the AI verdict was produced
  // from redacted text, say so in the receipt with the counts per kind
  // ("phone number (1), bank account (1)") — counts only, no values.
  // Only AI verdicts carry `redacted`; code/demo/local cards never do.
  const REDACT_KIND_KEY = {
    phone: "redactPhone",
    account: "redactAccount",
    otp: "redactOtp",
    pin: "redactPin",
    card: "redactCard",
    ktp: "redactKtp",
    email: "redactEmail",
    code: "redactCode",
  };
  const receiptRedacted =
    Array.isArray(verdict.redacted) && verdict.redacted.length > 0
      ? `<p>${escapeHtml(
          t("receiptRedacted", lang, {
            list: verdict.redacted
              .map(
                (f) =>
                  `${t(REDACT_KIND_KEY[f.kind] || "redactCode", lang)} (${f.count})`,
              )
              .join(", "),
          }),
        )}</p>`
      : "";
  // Safety floor note (23 Nov 2026): when the floor was applied, say so
  // honestly — the on-device rules overrode the AI verdict, and the user
  // deserves to know the score that triggered it. Only AI-path verdicts
  // can have floorApplied (heuristic/demo/code paths never set it).
  const receiptFloor = verdict.floorApplied
    ? `<p>${escapeHtml(t("receiptFloorApplied", lang, { score: verdict.riskScore }))}</p>`
    : "";
  // Receipt time: on-device verdicts (LOCAL/DEMO) show the real
  // measured wait with the honest "no AI wait" line (21 Nov audit 5);
  // entries saved before the duration was stored have no elapsedSec
  // and fall back to the old no-number line. Cloud/code verdicts
  // keep the real wait. The old "skipped" line is gone: community
  // counts + link tracing now run for every check (see enrichResult),
  // so there is nothing skipped left to report.
  const receiptTimeLine =
    verdict.source === "LOCAL" || verdict.source === "DEMO"
      ? `<p>${escapeHtml(elapsedSec != null ? t("receiptTimeLocal", lang, { s: formatElapsed(elapsedSec, lang) }) : t("receiptTimeLocalUnknown", lang))}</p>`
      : `<p>${escapeHtml(t("receiptTime", lang, { s: elapsedSec != null ? formatElapsed(elapsedSec, lang) : "—" }))}</p>`;
  const receipt = `<details class="privacy-receipt" open><summary>${escapeHtml(t("receiptTitle", lang))}</summary><p>${escapeHtml(receiptSent)}</p>${receiptRedacted}${receiptFloor}${receiptAudio}${receiptTimeLine}<p>${escapeHtml(receiptStored)}</p></details>`;
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
  // the retry button below asks the AI again. WHICH wording depends on
  // why the AI did not answer (verdict.codeOnlyReason): a timeout says
  // "within 30 seconds"; a fast failure says the AI could not be
  // reached — never the 30-second claim for a 1-second failure.
  const codeOnlyNote =
    verdict.source === "CODE"
      ? `<p class="code-only-note">${escapeHtml(t(verdict.codeOnlyReason === "unavailable" ? "codeOnlyNoteUnavailable" : "codeOnlyNote", lang, { retry: t("retryBtn", lang) }))}</p>`
      : "";
  // Stale-language notice (21 Nov 01:20): an AI verdict whose re-check
  // failed keeps its summary + flags in the previous language. Say so
  // on the card itself, with a retry — never leave a mixed-language
  // card without explanation. Set via extra.langStale by
  // recheckLastCheck's failure path; cleared by any fresh verdict.
  const langStaleNote = extra.langStale
    ? `<p class="lang-stale-note">${escapeHtml(t("langStaleNote", lang))} <button id="lang-retry-btn" type="button" class="secondary">${escapeHtml(t("retryBtn", lang))}</button></p>`
    : "";
  // Simplified card (Myuden 22 Nov 18:58): who answered, in one
  // short line — the plain-words source label (on-device code rules,
  // cloud AI, on-device AI, demo), no badge markup, no model name.
  // The value is sourceWho (short noun), NEVER sourceLabel: the
  // badge strings are full sentences and would double the phrase
  // ("Dijawab oleh Dijawab di cloud", Myuden 23 Nov 18:06).
  const sourceLine = `<p class="result-source-line">${escapeHtml(t("resultAnsweredBy", lang, { who: sourceWho(verdict.source) }))}</p>`;
  el.innerHTML = `
    <article class="result-card status-${verdict.status}">
      <p class="result-stale-bar">${escapeHtml(t("resultStale", lang))}</p>
      <div class="result-head">
        <div class="result-score-ring">
          <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
            <circle class="ring-track" cx="42" cy="42" r="34"></circle>
            <circle class="ring-fill" cx="42" cy="42" r="34" stroke-dasharray="${ringC.toFixed(1)}" stroke-dashoffset="${ringC.toFixed(1)}"></circle>
          </svg>
          <div class="ring-value"><strong>${verdict.riskScore}</strong><span>/ 100</span></div>
        </div>
        <div class="result-main">
          <p class="result-eyebrow">${escapeHtml(t("resultVerdict", lang))}</p>
          <h2 class="result-status">${escapeHtml(statusLabel)}</h2>
          <p class="result-summary">${escapeHtml(displaySummary)}</p>
        </div>
        <div class="result-badge">${sourceBadge(verdict.source)}${elapsed}</div>
      </div>
      ${mainSign}
      ${sourceLine}
      <p class="check-complete"><span class="check-complete-icon" aria-hidden="true">✓</span>${escapeHtml(t("checkComplete", lang))}</p>
      ${langStaleNote}
      ${codeOnlyNote}
      <div class="result-next"><ul class="actions-checklist"><li><span class="action-ico" aria-hidden="true">→</span><span><strong>${escapeHtml(t("whatToDo", lang))}</strong> ${escapeHtml(t(NEXT_KEY[verdict.status], lang))}</span></li></ul></div>
      ${linksBox}
      <details class="result-details"${resultDetailsOpen ? " open" : ""}>
        <summary>${escapeHtml(t("resultDetailsSummary", lang))}</summary>
        <h3>${escapeHtml(t(verdict.source === "IN_CLOUD" || verdict.source === "ON_DEVICE" ? "redFlagsAi" : "redFlags", lang))}</h3>
        ${flags}
        ${infoBox}
        ${reportLine}
        ${imageNote}
        ${localSignal}
        ${numbersBox}
        ${filesBox}
        ${receipt}
        <div id="report-counts" class="report-counts"></div>
        <div id="link-track" class="link-track"></div>
      </details>
      <div class="result-actions">
        ${verdict.source === "CODE"
          ? `<button id="retry-ai-btn" type="button" class="secondary">${escapeHtml(t("retryBtn", lang))}</button>`
          : ""}
        <button id="copy-result-btn" type="button" class="secondary">${escapeHtml(t("copyResult", lang))}</button>
        <button id="share-card-btn" type="button" class="secondary">${escapeHtml(t("shareCardBtn", lang))}</button>
        <button id="download-card-btn" type="button" class="secondary">${escapeHtml(t("downloadCardBtn", lang))}</button>
        <button id="share-wa-btn" type="button" class="secondary share-app-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg><span>WhatsApp</span></button>
        <button id="share-tg-btn" type="button" class="secondary share-app-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg><span>Telegram</span></button>
        ${verdict.status !== "safe" && (phones.length > 0 || accounts.length > 0 || files.length > 0)
          ? `<button id="report-btn" type="button" class="secondary">${escapeHtml(t("reportBtn", lang))}</button>`
          : ""}
        ${verdict.status === "scam"
          ? `<button id="report-number-btn" type="button" class="secondary">${escapeHtml(t("reportNumberBtn", lang))}</button>`
          : ""}
        ${verdict.status !== "safe"
          ? `<button id="warn-family-btn" type="button" class="secondary">${escapeHtml(t("warnFamilyBtn", lang))}</button>
        <button id="pdf-btn" type="button" class="secondary">${escapeHtml(t("pdfBtn", lang))}</button>`
          : ""}
      </div>
      <details class="checked-message">
        <summary>${escapeHtml(t("checkedMessage", lang))}</summary>
        <!-- Privacy (22 Nov audit 6): the checked message ALWAYS
             shows MASKED (OTP/phone/account numbers as bullets) —
             a fresh card used to show the full number + OTP here.
             The stored entry keeps the real text for re-check and
             reporting. Audit 12: URL queries are stripped too — a
             token in a checked link must never show here. -->
        <p>${escapeHtml(maskSensitive(stripUrlQueriesInText(message)))}</p>
      </details>
    </article>`;
  el.hidden = false;
  // Score ring animates from empty to the verdict score (demo
  // reference): the ring is painted empty above, then the CSS
  // transition carries it to the real offset. Reduced-motion users get
  // the final value at once (transition disabled in CSS).
  const ringFill = el.querySelector(".ring-fill");
  if (ringFill) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        ringFill.style.strokeDashoffset = String(ringOffset.toFixed(1));
      });
    });
  }
  // Clean-checks disclosure (21 Nov, Myuden: fold the clean rows):
  // remember open/closed across re-renders (language change rebuilds
  // this card), so an open disclosure does not silently close.
  const cleanDetails = el.querySelector(".clean-checks");
  if (cleanDetails) {
    cleanDetails.addEventListener("toggle", () => {
      cleanChecksOpen = cleanDetails.open;
    });
  }
  // Clickable pills (Myuden 22 Nov 20:57): "N terpicu" scrolls to the
  // first triggered rule; "N bersih" opens the clean fold (and
  // remembers it, so a language switch keeps it open) then scrolls
  // to it — if already open, it only scrolls. Re-attached after
  // every render (the card HTML is rebuilt), like the toggle above.
  // The sticky .topbar height is subtracted so the target is not
  // hidden under it.
  const scrollToEl = (target) => {
    if (!target) return;
    const topbar = document.querySelector(".topbar");
    const offset = (topbar ? topbar.getBoundingClientRect().height : 0) + 10;
    const y = target.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  };
  el.querySelectorAll("[data-pill-jump]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.pillJump === "found") {
        scrollToEl(el.querySelector(".local-checks li.found") || el.querySelector(".local-checks"));
      } else {
        const details = el.querySelector(".clean-checks");
        if (!details) return;
        if (!details.open) {
          cleanChecksOpen = true;
          details.open = true;
        }
        scrollToEl(details);
      }
    });
  });
  // Simplified card (Myuden 22 Nov 18:58): the "Rincian
  // pemeriksaan" fold remembers open/closed the same way, so a
  // language change does not silently close it.
  const resultDetails = el.querySelector(".result-details");
  if (resultDetails) {
    resultDetails.addEventListener("toggle", () => {
      resultDetailsOpen = resultDetails.open;
    });
  }
  // This card answers the text now in the form: remember it for the
  // stale check, clear any stale dimming, hide the empty state, and
  // move the flow steps to "see the result".
  lastCheckedMessage = message;
  const emptyState = $("result-empty");
  if (emptyState) emptyState.hidden = true;
  el.querySelector(".result-card")?.classList.remove("stale");
  refreshSteps();
  // The card is final (AI primary/backup or code-only): announce
  // completion with the toast — never for the interim preview, which
  // uses renderCheckingPreview and never reaches this function.
  if (showToast) showCheckCompleteToast(verdict);

  // Code-only fallback card: "Try again" re-runs the full check, so a
  // successful retry replaces this card with the real AI verdict.
  // Transcribed calls pass their own retry (re-score the same
  // recording); every other card re-runs the message check.
  const retryAiBtn = $("retry-ai-btn");
  if (retryAiBtn) {
    retryAiBtn.addEventListener("click", () => {
      if (typeof extra.onRetry === "function") extra.onRetry();
      else {
        // The message normally stays in the textarea; restore it from
        // the last check only if the user cleared it meanwhile, so
        // the retry checks the same message, not an empty field.
        if (!$("message-input").value.trim() && lastCheck?.message) {
          $("message-input").value = lastCheck.message;
        }
        onCheck();
      }
    });
  }

  // Stale-language retry (21 Nov 01:20): re-runs the language
  // re-check in the current language; a success replaces this card
  // with the fresh verdict and clears the notice.
  const langRetryBtn = $("lang-retry-btn");
  if (langRetryBtn) {
    langRetryBtn.addEventListener("click", () => recheckLastCheck());
  }

  $("copy-result-btn").addEventListener("click", async (ev) => {
    const lines = [
      `TipuCek — ${statusLabel} ${verdict.riskScore}/100`,
      ...(verdict.source === "CODE" ? [t("badgeCode", lang)] : []),
      displaySummary,
      ...(displayFlags.length > 0
        ? [`${t("redFlags", lang)}: ${displayFlags.join("; ")}`]
        : []),
      ...(links.length > 0
        ? [`${t("linksTitle", lang)}: ${links.map((l) => stripUrlQuery(l.url)).join(", ")}`]
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
  // supports it, otherwise a download. Variant A "Resmi" (21 Nov
  // 2026): the card shows the checked message as a quote, the date,
  // and the per-status risk line — all from `strings`, never
  // hardcoded, so the card follows the current language.
  const dateStr = new Date().toLocaleDateString(lang === "id" ? "id-ID" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const cardStrings = {
    subtitle: t("tagline", lang),
    statusLabel,
    resultHeading: t("cardResultHeading", lang),
    riskScoreLabel: t("cardRiskScore", lang),
    checkedMessageLabel: t("headingCheckedMessage", lang),
    summaryLabel: t("headingSummary", lang),
    actionsLabel: t("headingActions", lang),
    riskLine: t(RISK_LINE_KEY[verdict.status], lang),
    next: t(NEXT_KEY[verdict.status], lang),
    flagsTitle: t("redFlags", lang),
    footerNote: t("cardFooterNote", lang),
  };
  $("share-card-btn").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    try {
      const result = await shareWarningCard(
      // Privacy (22 Nov audit 6): the card is a PNG the user may
      // share anywhere — its quote is masked like every render.
      // Audit 12: URL queries are stripped too — a token in a
      // checked link must never be drawn into a shared image.
      // Audit 14: the summary + flags are masked too — the AI may
      // quote the token in its own words, and the card draws them.
      { ...verdict, summary: displaySummary, redFlags: displayFlags, message: maskSensitive(stripUrlQueriesInText(message)), dateStr },
      cardStrings,
    );
      btn.textContent =
        result === "shared" ? t("cardShared", lang) : t("cardDownloaded", lang);
    } catch {
      btn.textContent = t("copyFailed", lang);
    }
    setTimeout(() => {
      btn.textContent = t("shareCardBtn", lang);
    }, 2000);
  });
  // Share the verdict to WhatsApp / Telegram: the text carries the
  // verdict label + score ONLY — never the checked message (PII).
  // Native share sheet when the device offers it, otherwise the
  // wa.me / t.me link with the text prefilled.
  const shareVerdictText = t("shareVerdictText", lang, { label: statusLabel, score: verdict.riskScore });
  const siteUrl = "https://tipucek.web.app";
  async function shareVerdictApp(channel) {
    if (navigator.share) {
      try {
        await navigator.share({ text: shareVerdictText, url: siteUrl });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return; // user cancelled
      }
    }
    const url =
      channel === "wa"
        ? `https://wa.me/?text=${encodeURIComponent(shareVerdictText)}`
        : `https://t.me/share/url?url=${encodeURIComponent(siteUrl)}&text=${encodeURIComponent(shareVerdictText)}`;
    window.open(url, "_blank", "noopener");
  }
  $("share-wa-btn").addEventListener("click", () => shareVerdictApp("wa"));
  $("share-tg-btn").addEventListener("click", () => shareVerdictApp("tg"));
  $("download-card-btn").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    try {
      // Audit 14: the download card had the SAME leak as the share
      // card's quote — but here the message went in RAW (no mask at
      // all). Mask message + summary + flags, exactly like share.
      const blob = await buildWarningCard({ ...verdict, summary: displaySummary, redFlags: displayFlags, message: maskSensitive(stripUrlQueriesInText(message)), dateStr, strings: cardStrings });
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

  // "Laporkan" (22 Nov 2026): open the existing Laporkan
  // tool with the just-checked number/message pre-filled — the user
  // still reviews and presses "Kirim laporan" themselves. No new
  // report flow: the same crowd_reports form and validation apply.
  const reportNumberBtn = $("report-number-btn");
  if (reportNumberBtn) {
    reportNumberBtn.addEventListener("click", () => {
      // A stale error from an earlier submit must not survive the
      // prefill (21 Nov live check: "Pesan harus 10–2000 karakter"
      // stayed visible under a valid prefilled message).
      $("crowd-value-error").hidden = true;
      $("crowd-details-error").hidden = true;
      $("crowd-submit-error").hidden = true;
      $("crowd-success").hidden = true;
      if (phones.length > 0) {
        $("crowd-type").value = "phone";
        $("crowd-value").value = phones[0];
        $("crowd-details").value = message.slice(0, 500);
      } else if (accounts.length > 0) {
        $("crowd-type").value = "account";
        $("crowd-value").value = accounts[0];
        $("crowd-details").value = message.slice(0, 500);
      } else {
        // No number or account in the checked message: report the
        // message itself (type "message") so the evidence is saved
        // for review and development — the user still writes their
        // own description and presses send themselves.
        $("crowd-type").value = "message";
        $("crowd-message").value = message.slice(0, 2000);
        $("crowd-details").value = "";
      }
      updateCrowdLabels();
      switchModuleTab("report");
      document.querySelector(".modules").scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "start" });
      const crowdField = $("crowd-type").value === "message" ? $("crowd-message") : $("crowd-value");
      crowdField.focus({ preventScroll: true });
    });
  }

  // Family warning: a ready-to-send WhatsApp message with the verdict
  // + red flags, in the user's language.
  const warnBtn = $("warn-family-btn");
  if (warnBtn) {
    warnBtn.addEventListener("click", () => {
      const flagsText =
        displayFlags.length > 0
          ? `${t("warnFamilyFlags", lang)} ${displayFlags.join("; ")}`
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
      fillPrintReport(verdict, message, links, phones, accounts);
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
  // Community counts ALWAYS run now (21 Nov, Myuden: Cek Nomor
  // "tetap tanpa database" because this lookup was gated on cloud
  // history, which is OFF by default). The hash is suspect data,
  // not the user's: a one-way hash of the scammer's number/account/
  // file name, read against a public aggregate count — never the
  // user's message, file or history. The local-only toggle still
  // governs what it always governed: the user's own history sync
  // (saveCheck), not a public database query the user asked for by
  // tapping "Cek". A null count means "lookup failed", never "gated".
  if (countsEl && targets.length > 0) {
    const lines = [];
    for (const tg of targets) {
      try {
        const hash = await reportHash(tg.kind, tg.value);
        const n = hash ? await getReportCount(hash) : null;
        if (n != null && n > 0) {
          lines.push(`<p>${escapeHtml(t(tg.key, lang, { n }))}</p>`);
        } else if (n === 0) {
          lines.push(`<p class="muted">${escapeHtml(t("reportNone", lang))}</p>`);
        } else if (n == null) {
          // Lookup failed (not "zero reports") — say so instead of
          // staying silent, so the user knows the count is unknown.
          lines.push(`<p class="muted">${escapeHtml(t("reportCountFailed", lang))}</p>`);
        }
      } catch {
        /* lookup failed — say nothing */
      }
    }
    if (lines.length > 0) {
      // Labelled "Laporan komunitas" (21 Nov, audit 4): without a
      // heading the count line read like a verdict from a scammer
      // database — TipuCek has no such database, only user reports.
      countsEl.innerHTML =
        `<h3>${escapeHtml(t("reportCountsTitle", lang))}</h3>` + lines.join("");
    }
  }
  // Link tracking (short-link destination + public RDAP domain age)
  // ALSO always runs now, same reason as the counts above: the link
  // is suspect data the user asked us to trace, and the local
  // link-risk box (analyzeLinks, patterns only) still renders in the
  // result card regardless.
  if (trackEl) {
    const links = analyzeLinks(message).slice(0, 3);
    if (links.length > 0) {
      const items = [];
      for (const l of links) {
        const domain = registrableDomain(l.host);
        let finalLine = "";
        // Audit 6: when the shortener could not be followed, the RDAP
        // line below is the SHORTENER's domain data (bit.ly) — label
        // it, so it never reads as the destination's data.
        let unresolvedShortener = false;
        if (l.reasons.includes("linkRiskShortener")) {
          const r = await resolveShortLink(l.url);
          // Honest label: only call it the final destination when the
          // redirect was actually followed (r.resolved). When the
          // follow was blocked, the URL shown is just the link the
          // user entered — say so instead of "final destination".
          // When it WAS followed, re-score the final URL with the
          // same on-device rules (21 Nov, Myuden: bit.ly must be
          // judged by its real destination, not the short link) and
          // show that risk next to the destination.
          if (r.resolved && r.finalUrl) {
            const finalRisk = analyzeLink(r.finalUrl);
            const finalRiskLabel =
              finalRisk.level === "high"
                ? t("linkRiskHigh", lang)
                : finalRisk.level === "low"
                  ? t("linkRiskLow", lang)
                  : t("linkRiskSafe", lang);
            const finalReasons =
              finalRisk.reasons.length > 0
                ? ` — ${finalRisk.reasons.map((reason) => escapeHtml(t(reason, lang))).join("; ")}`
                : "";
            // Audit 14: a token in the URL (path or query) must never
            // show raw — strip the query and mask code-like tokens,
            // like every other URL display.
            finalLine = `<span>${escapeHtml(t("linkFinal", lang))}: ${escapeHtml(maskSensitive(stripUrlQuery(r.finalUrl)))}</span> <span class="link-risk">${escapeHtml(finalRiskLabel)}</span>${finalReasons}`;
          } else {
            // Unresolved: the shortener blocks browser tracking
            // (CORS — proven 21 Nov: no client-side trick reveals
            // the destination). Say so plainly; the link stays high
            // risk precisely because its destination is hidden.
            unresolvedShortener = true;
            finalLine = `<span>${escapeHtml(t("linkFinalUnresolved", lang))}: ${escapeHtml(maskSensitive(stripUrlQuery(l.url)))}</span><br/><span class="muted">${escapeHtml(t("linkUnresolvedNote", lang))}</span>`;
          }
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
        if (unresolvedShortener && !d.error && d.registered) {
          domainLine += `<br/><span class="muted">${escapeHtml(t("linktrackShortenerData", lang, { d: domain }))}</span>`;
        }
        items.push(
          `<li class="link-item"><span class="links-host">${escapeHtml(l.host)}</span> ${finalLine}<br/>${domainLine}</li>`,
        );
      }
      trackEl.innerHTML = `<div class="links-box"><h3>${escapeHtml(t("linkTrackHeading", lang))}</h3><ul>${items.join("")}</ul></div>`;
    }
  }
}

function renderHistory(entries) {
  lastHistory = entries || [];
  updateLocalStats();

  // History lives ONLY on the Riwayat dashboard (search + badges +
  // tap-to-reshow) — the page history section was removed 21 Nov, so
  // this renders the dashboard list, never a second copy on the page.
  renderHistoryView();
}

// Dashboard stats (mockup): the two local cards count REAL checks from
// this device's history — 0 until the user checks something. Never
// invented, never synced.
let statsInView = false;
function animateStatNum(el, target, onStep) {
  if (!el) return;
  const from = Number.parseInt(el.textContent, 10) || 0;
  if (from === target) {
    // The empty-state dash must not survive once checks exist: a 0
    // that stays "–" reads as "no data" instead of "none caught"
    // (found by the 21 Nov 0-findings sweep: 1 safe check left the
    // "caught" card on "–"). Write the number whenever it differs.
    if (el.textContent !== String(target)) el.textContent = String(target);
    if (onStep) onStep(target);
    return;
  }
  if (REDUCED_MOTION || !statsInView) {
    el.textContent = String(target);
    if (onStep) onStep(target);
    return;
  }
  // Audit 9 (100milionseek): never animate OUT OF the empty-state
  // dash. On a fresh device the first paint shows "–" (no local
  // checks yet); when loadHistory() later merges cloud entries and
  // raises the totals, animating "–" (parsed as 0) → N would replay
  // the 0 → N count-up the auditor flagged. Write the final value
  // directly instead — the sub is set via onStep, so it stays
  // consistent with the number. Later updates (real number →
  // number) still animate the small delta.
  if (el.textContent === "–") {
    el.textContent = String(target);
    if (onStep) onStep(target);
    return;
  }
  if (el._countRaf) cancelAnimationFrame(el._countRaf);
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / 600, 1);
    const eased = 1 - (1 - p) * (1 - p);
    const value = Math.round(from + (target - from) * eased);
    el.textContent = String(value);
    // Audit 9: the "caught" sub says "dari {n} pesan" — during the
    // count-up it must track the ANIMATED checked value, not the
    // final one, or the sub and the number disagree mid-animation.
    if (onStep) onStep(value);
    if (p < 1) el._countRaf = requestAnimationFrame(step);
  };
  el._countRaf = requestAnimationFrame(step);
}
function updateLocalStats() {
  // Audit 8: the hero cards count ALL checks ever performed on this
  // device (aggregate totals), never the capped history list — adding
  // a check must never lower "caught" (the auditor watched 32 → 31
  // when one new check trimmed the oldest entry).
  const totals = getStatsTotals();
  const checked = totals.checked;
  const caught = totals.scams;
  const checkedEl = $("stat-checked-num");
  const caughtEl = $("stat-caught-num");
  const checkedSub = document.querySelector(".stat .stat-sub[data-i18n='statCheckedSub']");
  const caughtSub = $("stat-caught-sub");
  if (checked === 0) {
    // Empty state (21 Nov, Myuden): a new user has made no checks —
    // show an honest dash + invitation, never a "0" that reads like
    // a result. The two public cards (loss, reports) are untouched.
    [checkedEl, caughtEl].forEach((el) => {
      if (!el) return;
      if (el._countRaf) cancelAnimationFrame(el._countRaf);
      el.textContent = "–";
    });
    if (checkedSub) checkedSub.textContent = t("statEmptyChecked", lang);
    if (caughtSub) caughtSub.textContent = t("statEmptyCaught", lang);
  } else {
    // The "caught" sub ("dari {n} pesan") tracks the checked
    // number through its animation (audit 9) — see animateStatNum.
    // CoArena (audit 9): the sub is set ONLY by the onStep callback
    // below, never to the final value here. Setting it to the final
    // total synchronously and then letting the first animation frame
    // overwrite it with the animated (starting) value left a 1-frame
    // window where the sub said the final total while the number
    // still showed the old value. Before the first frame both still
    // show the old value (consistent); from the first frame on, the
    // sub tracks the animated number. When from === target,
    // animateStatNum calls onStep synchronously, so the sub is set.
    animateStatNum(checkedEl, checked, (v) => {
      if (caughtSub) caughtSub.textContent = t("statCaughtSub", lang, { n: v });
    });
    animateStatNum(caughtEl, caught);
    if (checkedSub) checkedSub.textContent = t("statCheckedSub", lang);
  }
  renderWeekChart();
}

// 7-day chart (23 Nov 2026): scams caught per day over the last 7
// days (today included), counted from this device's local history
// only. Empty state when the device has no checks in that window —
// never a fake chart. Re-rendered with the stats (load, each check,
// language change) so it is always current.
function renderWeekChart() {
  const barsEl = $("week-chart-bars");
  const emptyEl = $("week-chart-empty");
  const noScamsEl = $("week-chart-noscams");
  if (!barsEl || !emptyEl || !noScamsEl) return;
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    days.push(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i));
  }
  // Audit 8: per-day counts come from the aggregate totals (which
  // survive trimming), not from the capped list — a day's bar must
  // not shrink because a newer check pushed its entries out. The
  // totals are seeded from the stored list on first read, so an
  // existing user's chart is unchanged by the switch.
  const totals = getStatsTotals();
  const counts = days.map((d) => {
    const b = totals.days[localDayKey(d)];
    return b ? b.s : 0;
  });
  const totalChecked = days.reduce((a, d) => {
    const b = totals.days[localDayKey(d)];
    return a + (b ? b.c : 0);
  }, 0);
  const totalScams = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...counts);
  const dayFmt = new Intl.DateTimeFormat(lang === "id" ? "id-ID" : "en-US", { weekday: "short" });
  emptyEl.hidden = totalChecked !== 0;
  noScamsEl.hidden = !(totalChecked > 0 && totalScams === 0);
  barsEl.hidden = totalChecked === 0;
  if (totalChecked === 0) {
    barsEl.innerHTML = "";
    barsEl.setAttribute("aria-label", t("chartEmpty", lang));
    return;
  }
  barsEl.innerHTML = days.map((d, i) => {
    const h = counts[i] === 0 ? 2 : Math.max(10, Math.round((counts[i] / max) * 96));
    const fill = counts[i] === 0 ? "background:var(--border);" : "";
    return `<div class="week-bar"><span class="week-bar-count">${counts[i]}</span><span class="week-bar-fill" style="height:${h}px;${fill}"></span><span class="week-bar-day">${dayFmt.format(d)}</span></div>`;
  }).join("");
  // No Y-axis numbers (21 Nov 2026, Myuden): the bars already show
  // their own count on top, so the axis labels only added clutter.
  barsEl.setAttribute("aria-label", t("chartAria", lang, { n: totalScams }));
}

// Install as app (23 Nov 2026): one install button, in the install
// card above the footer. beforeinstallprompt is captured when the
// browser offers it; without it the button shows the honest
// browser-menu instructions instead of a false promise. Already
// installed (standalone mode) hides the whole card.
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  markInstalled();
});
function markInstalled() {
  const btn = $("install-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = t("installDone", lang);
  }
  const hint = $("install-hint");
  if (hint) hint.hidden = true;
}
function initInstallCard() {
  const card = $("install-card");
  const btn = $("install-btn");
  if (!card || !btn) return;
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
  if (standalone) {
    card.hidden = true;
    return;
  }
  btn.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (choice && choice.outcome === "accepted") markInstalled();
      return;
    }
    const hint = $("install-hint");
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    hint.textContent = t(ios ? "installHintIos" : "installHint", lang);
    hint.hidden = false;
  });
}

// Onboarding (23 Nov 2026): 3-step first-time guide, shown once.
// The flag is set on ANY close (button, ×, scrim, Escape); reopening
// from "Cara kerja" shows it again without clearing the flag.
const LS_ONBOARD_KEY = "tipucek_onboarding_seen";
function showOnboarding() {
  $("onboard").hidden = false;
  $("onboard-scrim").hidden = false;
}
function hideOnboarding() {
  $("onboard").hidden = true;
  $("onboard-scrim").hidden = true;
  try { localStorage.setItem(LS_ONBOARD_KEY, "1"); } catch { /* private mode */ }
}
function initOnboarding() {
  $("onboard-start").addEventListener("click", hideOnboarding);
  $("onboard-close").addEventListener("click", hideOnboarding);
  $("onboard-scrim").addEventListener("click", hideOnboarding);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("onboard").hidden) hideOnboarding();
  });
  $("how-onboard-btn").addEventListener("click", showOnboarding);
  let seen = false;
  try { seen = localStorage.getItem(LS_ONBOARD_KEY) === "1"; } catch { /* private mode */ }
  if (!seen) showOnboarding();
}

function setOnlineState() {
  const online = navigator.onLine;
  const label = online ? t("netOnline", lang) : t("netOffline", lang);
  // Header: a 10px dot only (Myuden 23:50 — the text pill crowded the
  // header and clipped "Senior mode" on narrow phones). The dot keeps
  // an accessible label + title.
  const dot = $("net-status");
  dot.classList.toggle("offline", !online);
  dot.classList.toggle("online", online);
  dot.setAttribute("aria-label", label);
  dot.setAttribute("title", label);
  $("offline-note").hidden = online;
}

// Crowd reports ("Laporkan penipuan"): the value label + placeholder
// follow the selected type (phone / account / mode / message / file)
// and the UI language. Kept in JS (not data-i18n) because one input
// serves five labels — plus a textarea that only the message type
// uses (a scam message is multi-line, up to 2000 chars).
const CROWD_LABEL_KEY = {
  phone: "crowdValuePhone",
  account: "crowdValueAccount",
  mode: "crowdValueMode",
  message: "crowdValueMessage",
  file: "crowdValueFile",
};
const CROWD_PLACEHOLDER_KEY = {
  phone: "crowdValuePhPhone",
  account: "crowdValuePhAccount",
  mode: "crowdValuePhMode",
  message: "crowdValuePhMessage",
  file: "crowdValuePhFile",
};
function updateCrowdLabels() {
  const type = $("crowd-type").value;
  $("crowd-value-label").textContent = t(CROWD_LABEL_KEY[type] || "crowdValuePhone", lang);
  const isMessage = type === "message";
  $("crowd-value").hidden = isMessage;
  $("crowd-message").hidden = !isMessage;
  const field = isMessage ? $("crowd-message") : $("crowd-value");
  field.placeholder = t(CROWD_PLACEHOLDER_KEY[type] || "crowdValuePhPhone", lang);
  // A type switch makes the old field's error stale — clear it.
  $("crowd-value-error").hidden = true;
}

async function onCrowdSubmit() {
  const btn = $("crowd-submit-btn");
  const type = $("crowd-type").value;
  const value = type === "message" ? $("crowd-message").value : $("crowd-value").value;
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
      $("crowd-message").value = "";
      $("crowd-details").value = "";
      success.hidden = false;
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
  const emptyState = $("result-empty");
  if (emptyState) emptyState.hidden = true;
}

// Online-only mode (23 Nov 2026): without the internet there is no
// final verdict — the cloud is the only source of a final card. The
// device code check still shows as a preliminary score, the panel says
// so plainly, and Retry re-runs the check. The button stays disabled
// while offline and becomes active the moment the internet is back;
// the `online` event also auto-retries (see initOnlineWatch). The
// panel is never saved to history and never fires the completion
// toast — it is not a verdict.
let offlinePanelShown = false;
function renderOfflinePreview(message) {
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
      <div class="local-signal"><h3>${escapeHtml(t("localSignalTitle", lang))}</h3><p>${escapeHtml(t("offlinePrelimNote", lang, { score: local.riskScore, status: localStatus, n: local.redFlags.length }))}</p></div>
      <p class="offline-check-note">${escapeHtml(t("offlineCheckNotice", lang))}</p>
      <button type="button" class="secondary retry-btn" id="offline-retry-btn" disabled>${escapeHtml(t("retryBtn", lang))}</button>
    </article>`;
  el.hidden = false;
  const emptyState = $("result-empty");
  if (emptyState) emptyState.hidden = true;
  offlinePanelShown = true;
  $("offline-retry-btn").addEventListener("click", () => {
    if (navigator.onLine) {
      // The message normally stays in the textarea — restore it from
      // the last check only if the user cleared it meanwhile.
      const hasNew = $("message-input").value.trim().length > 0;
      if (!hasNew && lastCheck?.message) $("message-input").value = lastCheck.message;
      onCheck();
    }
  });
}
function onBackOnline() {
  const btn = $("offline-retry-btn");
  if (btn) btn.disabled = false;
  // Auto-retry the failed message check — but only when the input is
  // still empty: if the user typed a new message meanwhile, never
  // send it for them; the retry button stays available instead.
  if (offlinePanelShown && !checkBusy && !$("message-input").value.trim() && lastCheck?.message) {
    offlinePanelShown = false;
    $("message-input").value = lastCheck.message;
    onCheck();
  }
}
function initOnlineWatch() {
  window.addEventListener("online", () => {
    setOnlineState();
    onBackOnline();
  });
  window.addEventListener("offline", () => {
    setOnlineState();
  });
}

// Cek Pesan is a plain form again (21 Nov 2026, Myuden 18:01 —
// reversing the 16:11 "Seperti chat di WhatsApp" decision). The
// WhatsApp-style thread, verdict bubbles and typing indicator were
// removed: the example chips only fill the textarea, the user
// presses send, and the full result card below is the only answer.
// The deleted helpers were chatAddBubble / chatAddUserBubble /
// chatAddAmanBubble / chatReplyHtml / rerenderChatVerdictBubbles /
// chatShowTyping / chatHideTyping / chatRemoveLastErrorBubble.

async function onCheck() {
  hideCheckCompleteToast();
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
  lastCheckedEmail = null;
  offlinePanelShown = false;
  const runId = ++checkRunId;
  checkBusy = true;
  const progressEl = $("progress");
  // The filled-example note is done once the user presses send.
  $("fill-note")?.classList.remove("show");
  setSendBtnLoading(true);
  // Plain form (21 Nov 18:01 revert): the message stays in the
  // textarea while the check runs — on error the user just presses
  // send again, and a retry re-checks the same text.
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
      // Online-only mode (23 Nov 2026): without the internet there is
      // no final verdict — the cloud is the only source of a final
      // card. A cached verdict above is still shown (it is a real AI
      // verdict from earlier); only the fresh path is gated.
      if (!navigator.onLine) {
        renderOfflinePreview(message);
        return;
      }
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
        // Record WHY the AI failed: only a real "timed out" error is
        // a timeout — anything else (App Check 403, network) is a
        // fast failure, and the card must say the AI could not be
        // reached, never "did not answer within 30 seconds".
        if (
          !isFirebaseConfigured() ||
          /message too long/i.test(err?.message || "")
        ) {
          throw err;
        }
        verdict = codeOnlyVerdict(
          message,
          lang,
          /timed out/i.test(err?.message || "") ? "timeout" : "unavailable",
        );
        codeOnly = true;
      }
      // The receipt shows the real total wait for an answer, including
      // a code-only fallback after the AI timed out — the receipt's
      // code-only line still says the AI did not answer, so the number
      // reads as total wait, never as the code check's own duration.
      // Never cache the fallback: a retry must ask the AI again.
      elapsedSec = (performance.now() - t0) / 1000;
      if (!codeOnly && isFirebaseConfigured()) {
        verdictCacheSet("message", message, lang, {
          verdict,
          elapsedSec,
          imageText: "",
          extra: {},
        });
      }
    }
    // A newer check/re-check superseded this one: never render or save
    // a stale result over the newer card.
    if (runId !== checkRunId) return;
    renderResult(verdict, message, elapsedSec, "", {}, true);
    enrichResult(message);
    const where = await saveCheck({ message, kind: "message", ...verdict, elapsedSec });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : where === "off"
          ? t("storageOff", lang)
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
    // The message stays in the textarea on error, so the retry just
    // re-runs the same check; the error box below keeps the details
    // + retry button.
    showCheckError(errorEl, err, () => {
      onCheck();
    });
  } finally {
    if (runId !== checkRunId) return;
    checkBusy = false;
    setSendBtnLoading(false);
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
  hideCheckCompleteToast();
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
        // Online-only (23 Nov 2026): no fresh AI verdict without the
        // internet — the catch below keeps the old card and offers a
        // retry instead of rendering a code-only card as the verdict.
        if (!navigator.onLine) throw new Error("offline");
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
    renderResult(verdict, message, elapsedSec, imageText, {}, true);
    enrichResult(message);
  } catch (err) {
    console.error(err);
    if (runId !== checkRunId) return;
    // The old card stays exactly as it was (one language, intact) and
    // the error offers a retry that re-runs this same re-check.
    // Exception: when the card on screen is a code-only/demo fallback,
    // it was just re-rendered in the new language by renderResult's
    // re-derive (21 Nov 01:20) and already explains (with its own
    // retry) that the AI did not answer — a second error box saying
    // the same thing would only duplicate it.
    // AI verdicts are different: their summary + flags are free text
    // from the model, so the failed re-check leaves the card MIXED
    // (labels new, verdict text old). Say so ON the card, with its
    // own retry — never leave a mixed card without explanation.
    const failedSource = lastRenderArgs?.verdict?.source;
    if (failedSource !== "CODE" && failedSource !== "DEMO") {
      showCheckError(errorEl, err, () => recheckLastCheck());
      if (lastRenderArgs && !$("result").hidden) {
        renderResult(
          lastRenderArgs.verdict,
          lastRenderArgs.message,
          lastRenderArgs.elapsedSec,
          lastRenderArgs.imageText,
          { ...lastRenderArgs.extra, langStale: true },
        );
        enrichResult(lastRenderArgs.message);
      }
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
  hideCheckCompleteToast();
  const progressEl = $("image-progress");
  const errorEl = $("image-error");
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (!isFirebaseConfigured()) {
    errorEl.textContent = t("assistantDemo", lang);
    errorEl.hidden = false;
    return;
  }
  if (!navigator.onLine) {
    // Online-only (23 Nov 2026): the image check is cloud-only (OCR +
    // verdict), so there is nothing to show offline — error + retry
    // immediately, without waiting for the AI call to time out.
    showCheckError(errorEl, new Error("offline"), () => onImageCheck());
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
    lastCheckedEmail = null;
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
    renderResult(verdict, message, elapsedSec, message, {}, true);
    enrichResult(message);
    const where = await saveCheck({ message, kind: "message", ...verdict, elapsedSec });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : where === "off"
          ? t("storageOff", lang)
          : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    if (runId !== checkRunId) return;
    hideStaleResult();
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
  document.querySelector(".checker").scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "start" });
  onCheck();
}

// Header mode label (21 Nov, Myuden: the header said "Mode AI" even
// on tabs that never touch AI). Only Cek Pesan uses the AI — the
// email, call and outbound tabs run the on-device code check, so the
// label says so. Demo mode (no Firebase) keeps its own label.
// The checker hint above the tabs ("Dalam mode AI...") sits OUTSIDE
// the tab panels, so it showed on the email/call tabs too (21 Nov,
// audit 4) — it follows the active tab exactly like the label.
function updateModeLabel() {
  const el = $("mode-label");
  const hintEl = $("checker-hint");
  const activeTab = ["message", "email", "call", "outbound"].find((n) => !$(`tab-${n}`).hidden);
  const isMessage = activeTab === "message";
  if (hintEl) {
    hintEl.textContent =
      isMessage && isFirebaseConfigured() ? t("checkerHint", lang) : t("checkerHintLocal", lang);
  }
  if (!el) return;
  if (!isFirebaseConfigured()) {
    el.textContent = t("modeDemo", lang);
    return;
  }
  el.textContent = isMessage ? t("modeAI", lang) : t("modeLocal", lang);
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
  // A verdict belongs to the tab that produced it: hide the stale card
  // (and its toast) when switching tabs, so an old verdict is never
  // read as the new tab's answer. The next check re-renders it.
  $("result").hidden = true;
  hideCheckCompleteToast();
  updateModeLabel();
}

// Module tabs (below the quick checker): file | link | contacts | aid
// | chatlog | quiz | history | how. Same WAI-ARIA tabs pattern as the
// checker tabs — one panel visible at a time, all modules keep working
// exactly as before, nothing is removed. Aman is NOT a module tab
// (Myuden 20 Nov 20:50): the only door to Aman is the round floating
// launcher. The panel is an overlay — it remembers the tab the user
// was on and restores it on close, so the tools area never ends up
// with no panel at all.
// Tab order follows the most common needs (Myuden 19 Nov 17:44):
// check tools first (file, link), then official contacts + emergency
// guide + report, then chat export and quiz; how it works last so it
// never disturbs the main flow. (History left the tab row 21 Nov:
// its tab now opens the history panel instead.)
const MODULE_TABS = ["link", "file", "qr", "chatlog", "report", "contacts", "aid", "quiz", "how"];
const MODULE_PANELS = {
  file: "filecheck",
  qr: "qrcheck",
  link: "linktrack",
  contacts: "contacts",
  aid: "firstaid",
  chatlog: "chatlog",
  quiz: "quiz",
  report: "crowdreport",
  how: "how",
};
// The tab the user was on before opening Aman — closing the panel
// restores it, so the tools area never ends up with no panel at all.
let moduleTabBeforeAman = "link";
// Open the Aman panel, remembering the current module tab first.
function openAman() {
  const current = MODULE_TABS.find((n) => !$(MODULE_PANELS[n]).hidden);
  if (current) moduleTabBeforeAman = current;
  openAmanPanel();
}
// Close the panel (× button / launcher toggle / Escape): hide it, go
// back to the module tab the user was on, return focus to the launcher.
function closeAman() {
  closeAmanPanel();
  switchModuleTab(moduleTabBeforeAman);
  $("aman-fab").focus({ preventScroll: true });
}
function switchModuleTab(name) {
  // Switching tools closes the overlay panel first (it is not a
  // module panel); the chosen tool then shows as usual.
  if (isAmanPanelOpen()) {
    closeAmanPanel();
  }
  // Leaving the QR tool stops its camera — a camera stream must
  // never keep running while another tool is on screen.
  stopQrCamera();
  MODULE_TABS.forEach((n) => {
    $(MODULE_PANELS[n]).hidden = n !== name;
    const b = $(`module-tab-${n}`);
    b.classList.toggle("active", n === name);
    b.setAttribute("aria-selected", n === name ? "true" : "false");
  });
}

// --- QR check (23 Nov 2026) ---------------------------------------------
// Camera state lives at module level so switchModuleTab can stop the
// stream when the user leaves the QR tool.
let qrCameraStream = null;
let qrCameraTimer = null;

/** Stop the QR camera stream and its scan loop (no-op when not running). */
function stopQrCamera() {
  if (qrCameraTimer != null) {
    clearInterval(qrCameraTimer);
    qrCameraTimer = null;
  }
  if (qrCameraStream) {
    for (const track of qrCameraStream.getTracks()) track.stop();
    qrCameraStream = null;
  }
  const camBox = $("qrcheck-camera");
  if (camBox) camBox.hidden = true;
  const video = $("qrcheck-video");
  if (video) video.srcObject = null;
}

/** Load an image from a File (ImageBitmap when available, else an
 *  <img> over an object URL). */
async function loadImageFromFile(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path below.
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image-load-failed"));
    };
    img.src = url;
  });
}

/** Decode a QR code from an image (Image or ImageBitmap): draw it
 *  (downscaled to at most 1000px on the long side — jsQR is faster
 *  on smaller frames) to a canvas and read the pixels. Returns the
 *  decoded string or null. */
async function decodeQrFromImage(image) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const maxSide = 1000;
  const scale = Math.min(1, maxSide / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return decodeQrFromImageData(imageData);
}

/** Format a QRIS amount ("50000") as "Rp 50.000"; a non-numeric
 *  amount is shown raw. */
function formatQrAmount(raw) {
  if (/^\d+$/.test(raw)) {
    return `Rp ${Number(raw).toLocaleString("id-ID")}`;
  }
  return raw;
}

/** Render a decoded QR payload into the QR panel. */
function renderQrResult(decoded) {
  const box = $("qrcheck-result");
  const c = classifyQrText(decoded);
  if (c.kind === "qris") {
    const q = c.qris;
    const f = q.fields;
    const crcLine = q.crcValid
      ? t("qrQrisCrcOk", lang)
      : q.crcExpected == null
        ? t("qrQrisNoCrc", lang)
        : t("qrQrisCrcBad", lang);
    const typeLine = f.initiation === "12" ? t("qrQrisDynamic", lang) : t("qrQrisStatic", lang);
    const rows = [
      [t("qrQrisName", lang), f.merchantName || "—"],
      [t("qrQrisCity", lang), f.merchantCity || "—"],
      [t("qrQrisNmid", lang), f.nmid || "—"],
    ];
    if (f.amount) rows.push([t("qrQrisAmount", lang), formatQrAmount(f.amount)]);
    rows.push([t("qrQrisType", lang), typeLine]);
    box.innerHTML = `<div class="qr-result">
      <h3>${escapeHtml(t("qrQrisTitle", lang))}</h3>
      ${rows.map(([k, v]) => `<p><span class="numbers-label">${escapeHtml(k)}:</span> ${escapeHtml(v)}</p>`).join("")}
      <p class="${q.crcValid ? "" : "error"}">${escapeHtml(crcLine)}</p>
      <p class="links-warn">${escapeHtml(t("qrQrisWarning", lang))}</p>
    </div>`;
  } else if (c.kind === "url") {
    const url = normalizeLinkInput(c.value) || c.value;
    const judged = analyzeLink(url);
    const levelLabel =
      judged.level === "high"
        ? t("linkRiskHigh", lang)
        : judged.level === "low"
          ? t("linkRiskLow", lang)
          : t("linkRiskSafe", lang);
    const reasons =
      judged.reasons.length > 0
        ? `<ul class="link-reasons">${judged.reasons.map((r) => `<li>${escapeHtml(t(r, lang))}</li>`).join("")}</ul>`
        : "";
    box.innerHTML = `<div class="qr-result">
      <h3>${escapeHtml(t("qrUrlTitle", lang))}</h3>
      <p><span class="links-url">${escapeHtml(maskSensitive(stripUrlQuery(url)))}</span></p>
      <p><span class="link-risk">${escapeHtml(levelLabel)}</span></p>${reasons}
      <div class="actions"><button id="qrcheck-ai-btn" type="button" class="secondary">${escapeHtml(t("qrAiBtn", lang))}</button></div>
    </div>`;
    $("qrcheck-ai-btn").addEventListener("click", () => runCheckWithText(url));
  } else {
    // Plain text: show it and offer the full AI check.
    box.innerHTML = `<div class="qr-result">
      <p><span class="numbers-label">${escapeHtml(t("qrDecoded", lang))}</span></p>
      <p>${escapeHtml(c.value)}</p>
      <div class="actions"><button id="qrcheck-ai-btn" type="button" class="secondary">${escapeHtml(t("qrAiBtn", lang))}</button></div>
    </div>`;
    $("qrcheck-ai-btn").addEventListener("click", () => runCheckWithText(c.value));
  }
  box.hidden = false;
}


// Achievement badges (23 Nov 2026): computed ONLY from this device's
// real local data — checks in pesanaman_history_v1 and sent reports in
// tipucek_crowd_reports_v1. Never invented. Locked badges show their
// requirement (with live progress) so the goal is clear.
const BADGE_ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
  layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>',
};
const BADGES = [
  { id: "first-check", icon: "check", nameKey: "badgeFirstCheck", reqKey: "badgeFirstCheckReq", need: 1, have: () => getStatsTotals().checked },
  { id: "ten-checks", icon: "layers", nameKey: "badgeTenChecks", reqKey: "badgeTenChecksReq", need: 10, have: () => getStatsTotals().checked },
  { id: "five-scams", icon: "shield", nameKey: "badgeFiveScams", reqKey: "badgeFiveScamsReq", need: 5, have: () => getStatsTotals().scams },
  { id: "first-report", icon: "flag", nameKey: "badgeFirstReport", reqKey: "badgeFirstReportReq", need: 1, have: () => loadLocalReports().length },
];
function renderBadges() {
  const grid = $("history-badges-grid");
  if (!grid) return;
  grid.innerHTML = BADGES.map((b) => {
    const have = b.have();
    const earned = have >= b.need;
    const sub = earned
      ? t("badgeEarned", lang)
      : `${Math.min(have, b.need)}/${b.need} · ${t(b.reqKey, lang)}`;
    return `<div class="badge-tile${earned ? " earned" : ""}">
      <span class="badge-tile-icon" aria-hidden="true">${BADGE_ICONS[b.icon]}</span>
      <span class="badge-tile-name">${escapeHtml(t(b.nameKey, lang))}</span>
      <span class="badge-tile-sub">${escapeHtml(sub)}</span>
    </div>`;
  }).join("");
}

// Riwayat dashboard: the same local history as the page list, rendered
// as tappable rows. Search filters by message text and verdict label.
/** Tool label for a history entry's kind (audit 10) — "Alat tidak tercatat" when unknown (audit 11). */
function historyToolLabel(kind) {
  switch (kind) {
    case "message": return t("messageTab", lang);
    case "email": return t("emailTab", lang);
    case "call": return t("callTab", lang);
    case "file": return t("moduleTabFile", lang);
    case "link": return t("moduleTabLink", lang);
    // Audit 11: entries saved before `kind` existed have no tool —
    // say so explicitly instead of leaving the badge slot empty.
    default: return t("historyToolUnknown", lang);
  }
}

/** Split a stored call message ("number: said" / number / said) back
 *  into its parts — the same shape fillCheckerForm parses. */
function parseCallMessage(text) {
  const m = String(text || "").match(/^(\+?[\d\s\-()]{7,20}): ([\s\S]*)$/);
  if (m) return { number: m[1].trim(), said: m[2] };
  if (/^\+?[\d\s\-()]{7,20}$/.test(String(text || "").trim())) {
    return { number: String(text).trim(), said: "" };
  }
  return { number: "", said: String(text || "") };
}

/**
 * Legacy-score annotation for a history entry (audit 10): a call
 * entry saved before the audit-7 identity-mismatch rule shows the
 * OLD score next to a NEW one computed as "the same facts under the
 * current rules" — the stored verdict is NEVER rewritten, the note
 * only explains why it stands next to a newer, different score for
 * the same claim. Returns the note text, or null when no annotation
 * applies. Applies only when the mismatch was never counted (no
 * callIdentityMismatch row in the stored checks) and the number was
 * not reported (a reported official number gets no mismatch bonus
 * under the current rules either).
 */
function legacyOjkNote(e) {
  if (!e || e.kind !== "call") return null;
  // parseCallMessage always returns an object (never null) — no
  // null-guard here (Groq review, audit 10: the old guard was dead).
  const parsed = parseCallMessage(e.message || "");
  const mm = currentMismatch(parsed.number, parsed.said);
  if (!mm) return null;
  const checks = Array.isArray(e.checks) ? e.checks : [];
  if (checks.some((c) => c.id === "callIdentityMismatch")) return null;
  if (checks.some((c) => c.id === "callReports" && c.found)) return null;
  const newScore = Math.min(100, (Number(e.riskScore) || 0) + 35);
  const status = newScore >= 60 ? "scam" : newScore >= 30 ? "suspicious" : "safe";
  return t("historyOldRules", lang, { n: newScore, label: t(STATUS_KEY[status], lang) });
}

function historyRowHtml(e) {
  const when = e.createdAt ? new Date(e.createdAt).toLocaleString() : "";
  const statusLabel = t(STATUS_KEY[e.status] || "statusSafe", lang);
  const text = e.message || e.summary || "";
  const modelTag =
    e.source === "IN_CLOUD" && e.model ? ` · ${escapeHtml(e.model)}` : "";
  // Privacy (21 Nov 01:19): the snippet is MASKED (OTP/phone/account
  // numbers become bullets), and the "hide message text" setting
  // removes the snippet entirely — label + score + time only.
  // Audit 8 (100milionseek): a LINK entry's message IS the URL, and
  // its query string can carry a session/reset token. The stored
  // message stays whole (restore needs it), but the LIST preview
  // shows the URL without query/fragment — the host + path still
  // identify the entry.
  const displayText = e.kind === "link" ? text.split(/[?#]/)[0] : text;
  const masked = maskSensitive(displayText);
  const textHtml = isHistoryTextHidden()
    ? ""
    : `<span class="history-text">${escapeHtml(masked.slice(0, 90))}${masked.length > 90 ? "…" : ""}</span>`;
  // Audit 10 (e): the tool that produced the check, so a File-URL
  // entry and a Link entry with the same input no longer look
  // identical; and the legacy-rules note for pre-audit-7 call
  // entries scored under the old rules (the stored verdict is kept,
  // the note explains the different number next to it).
  const toolLabel = historyToolLabel(e.kind);
  const legacyNote = legacyOjkNote(e);
  return `<li><button type="button" class="history-item-btn status-${escapeHtml(e.status || "safe")}" data-history-id="${escapeHtml(e.id || "")}">
    <span class="history-row-top">
      <span class="history-status">${escapeHtml(statusLabel)}</span>
      ${toolLabel ? `<span class="history-tool">${escapeHtml(toolLabel)}</span>` : ""}
      <span class="history-score">${Number(e.riskScore ?? 0)}/100</span>
      <time>${escapeHtml(when)}</time>
    </span>
    ${textHtml}
    ${legacyNote ? `<span class="history-legacy">${escapeHtml(legacyNote)}</span>` : ""}
    <span class="history-source">${escapeHtml(sourceLabel(e.source))}${modelTag}</span>
  </button></li>`;
}
// Download the local history as CSV (restored from commit 3c16d6f
// after the Dashboard-2 restructure dropped the button). Local
// entries only, including the new `kind` column so an export still
// tells which tab produced each check. Shows a toast only AFTER the
// file is actually downloaded — the audit found a toast claiming an
// export the user could not find.
function exportHistoryCsv() {
  const header = "message,status,riskScore,source,createdAt,kind";
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const rows = lastHistory.map((e) =>
    [e.message, e.status, e.riskScore, e.source, e.createdAt, e.kind || ""]
      .map(esc)
      .join(","),
  );
  // UTF-8 BOM first: without it, Excel (Indonesian locale) misreads
  // non-ASCII characters in the CSV.
  const blob = new Blob(["\uFEFF" + [header, ...rows].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "tipucek-history.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showInfoToast(t("historyExported", lang));
}

function renderHistoryView() {
  renderBadges();
  const list = $("history-list");
  if (!list) return;
  const empty = $("history-empty");
  const emptyHint = $("history-empty-hint");
  const nomatch = $("history-nomatch");
  const stats = $("history-stats");
  const q = ($("history-search").value || "").trim().toLowerCase();
  // Audit 8: the stats line counts ALL checks on this device
  // (aggregate totals), and says so when the list itself was
  // trimmed — the old line silently dropped with the cap.
  // Audit 11: the line is always shown, even at 0/0 — an empty
  // history left it blank instead of "0 checks".
  const totals = getStatsTotals();
  stats.textContent =
    t("historyStats", lang, { n: totals.checked, m: totals.scams }) +
    (totals.checked > lastHistory.length
      ? " — " + t("historyTrimmed", lang, { n: lastHistory.length, m: totals.checked })
      : "");
  if (lastHistory.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    emptyHint.hidden = false;
    nomatch.hidden = true;
    return;
  }
  empty.hidden = true;
  emptyHint.hidden = true;
  const filtered = lastHistory.filter((e) => {
    if (!q) return true;
    const label = t(STATUS_KEY[e.status] || "statusSafe", lang).toLowerCase();
    return (
      (e.message || e.summary || "").toLowerCase().includes(q) ||
      label.includes(q) ||
      historyToolLabel(e.kind).toLowerCase().includes(q)
    );
  });
  nomatch.hidden = filtered.length > 0;
  list.innerHTML = filtered.map(historyRowHtml).join("");
}
// Audit 11 (g): restoring a file/link entry must also refresh THAT
// tool's own panel with the stored verdict — before this the panel
// kept the previous check's result (e.g. foto-liburan.jpg 0/100, or
// example.org) while the main card showed the restored one. The
// restored panel shows the stored score (the same number as the card)
// and the stored input; nothing is re-fetched (no RDAP/hash/count
// lookup) and nothing is re-saved, so the hero never moves. The OTHER
// tool's panel is untouched — each panel shows its own tool's last
// result. Flags that merely repeat the label/summary are left out so
// the restored panel never shows the same line twice.
// Audit 11 (review): a link's query string can carry a session/reset
// token — the history list preview already strips it (audit 8), and
// the panels do the same. Only the DISPLAY is stripped; the stored
// message and the input keep the full URL, and the verdict is computed
// from the full URL.
function stripUrlQuery(url) {
  return String(url || "").split(/[?#]/)[0];
}

// Audit 12 (security): a URL query can carry a session/reset token.
// stripUrlQuery handles ONE whole URL; this one strips the query /
// fragment from every http(s) URL embedded in free text (evidence
// quotes, the checked-message disclosure, the PDF quote) — the token
// never reaches a display, a printout, a copied summary, or a shared
// card. Display-only: the stored message keeps the full URL.
// Groq review: the match must end on a non-punctuation character,
// so a sentence-final "." / "," / "!" / ")" after the URL is kept —
// the old pattern ate it ("Lihat http://example.com?x=1." lost its
// period). A bare trailing "?" with no token is left as-is (harmless).
// Audit 12 (security): a URL query can carry a session/reset token.
// stripUrlQuery handles ONE whole URL; this one strips the query /
// fragment from every http(s) URL embedded in free text (evidence
// quotes, the checked-message disclosure, the PDF quote) — the token
// never reaches a display, a printout, a copied summary, or a shared
// card. Display-only: the stored message keeps the full URL.
// Groq review: the match must end on a non-punctuation character,
// so a sentence-final "." / "," / "!" / ")" after the URL is kept —
// the old pattern ate it ("Lihat http://example.com?x=1." lost its
// period). A bare trailing "?" with no token is left as-is (harmless).
// CoArena review: the scheme match MUST be case-insensitive (flag
// `i`) — URL schemes are case-insensitive per RFC, and a pasted
// "HTTPS://example.com/?token=abc123" sailed through unstripped.
// HCNSEC review: a token can also hide in a URL WITHOUT a scheme —
// scam messages often write a bare domain ("www.bank.example/reset
// ?token=...") or a scheme-relative link ("//bank.example/r?token=
// ..."), and an IPv4 host ("192.168.1.1/x?token=..."). So besides
// http(s):// the pattern also matches scheme-relative URLs, IPv4
// hosts, and bare domains (labels + letter TLD, optional port/path).
// A bare "file.txt?x=1" also matches — it looks exactly like a URL
// with a query, and hiding its query is the safe side. What does NOT
// match on purpose: "v1.2?x=1" (numeric TLD), "Apakah ini benar?"
// (no dot before ?), localhost (no dot, not a real leak vector),
// and "%3F" in a path — that is NOT a query separator per RFC/WHATWG
// URL, so stripping it would corrupt a legitimate path.
function stripUrlQueriesInText(text) {
  return String(text || "").replace(/(?:https?:\/\/[^\s"'<>?#]+|\/\/[^\s"'<>?#]+|\b(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?:\/[^\s"'<>?#]*)?|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{1,5})?(?:\/[^\s"'<>?#]*)?)[?#][^\s"'<>]*[^\s"'<>.,!?;:)]/gi, (m) => m.split(/[?#]/)[0]);
}

function renderPanelRestore(kind, verdict, message, entry = {}) {
  // A corrupted stored score must never render as "NaN/100".
  const rawScore = Number(verdict.riskScore ?? 0);
  const score = Number.isFinite(rawScore) ? rawScore : 0;
  const flags = Array.isArray(verdict.redFlags) ? verdict.redFlags : [];
  if (kind === "file") {
    // The verdict line mirrors the live name-check render: the label
    // follows the stored verdict (a text file's CONTENT verdict can
    // differ from its name — the score shown is always the stored
    // one); a URL-like name keeps the "web address, not a file" label.
    // Audit 11 (review): a scam verdict takes the danger label first —
    // a URL-shaped name must not hide "Berbahaya" behind the neutral
    // web-address label.
    const info = analyzeFileName(message || "");
    const level = verdict.status === "scam" ? "high" : "low";
    const labelKey = verdict.status === "scam" ? "fileVerdictHigh" : info.kind === "url" ? "fileVerdictUrl" : "fileVerdictLow";
    const extraFlags = flags.filter((f) => f !== (verdict.summary || ""));
    const box = $("filecheck-result");
    box.innerHTML = `<p class="file-verdict file-verdict-${level}"><strong>${escapeHtml(t(labelKey, lang))}</strong></p>
      <p class="panel-score">${escapeHtml(t("panelScore", lang, { n: score }))}</p>
      <div class="file-item file-${level}"><span class="file-name">${escapeHtml(message || "")}</span> — ${escapeHtml(verdict.summary || "")}</div>
      <p class="muted">${escapeHtml(t("fileCheckType", lang))}: ${escapeHtml(fileTypeDisplay(info))}</p>
      ${extraFlags.length ? `<ul class="flags">${extraFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}`;
    box.hidden = false;
    // Audit 12 (1): the restored panel is fresh for exactly this input.
    snapshotPanel("file", message);
    return;
  }
  if (kind === "link") {
    // Audit 11 (review): an unknown/missing status must never default
    // to "safe" — fail closed to "suspicious" instead.
    const riskKey = verdict.status === "scam" ? "linkRiskHigh" : verdict.status === "safe" ? "linkRiskSafe" : "linkRiskLow";
    // Audit 11 (review): the stored message is the ENTERED url, but
    // the score can belong to the RESOLVED destination instead. Only
    // call it the final destination when the entry says it resolved
    // (and records where); otherwise say plainly it is the link that
    // was entered — never claim an unreached url as the destination.
    const dest = entry.resolved === true && entry.finalUrl ? entry.finalUrl : null;
    const urlLabelKey = dest ? "linktrackFinal" : "linktrackFinalUnresolved";
    const shownUrl = dest || message || "";
    // A stored flag is the risk label in the CHECK-time language;
    // the label above is in the CURRENT language — filter against
    // both, or a language switch shows the same warning twice
    // (Groq review, audit 11).
    const riskLabels = [t(riskKey, "id"), t(riskKey, "en")];
    const extraFlags = flags.filter((f) => !riskLabels.includes(f));
    const box = $("linktrack-result");
    box.innerHTML = `<div class="links-box">
      <p><span class="numbers-label">${escapeHtml(t(urlLabelKey, lang))}:</span> <span class="links-url">${escapeHtml(maskSensitive(stripUrlQuery(shownUrl)))}</span></p>
      <p><span class="link-risk">${escapeHtml(t(riskKey, lang))}</span></p>
      <p class="panel-score">${escapeHtml(t("panelScore", lang, { n: score }))}</p>
      ${extraFlags.length ? `<ul class="flags">${extraFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : ""}
    </div>`;
    box.hidden = false;
    // Audit 12 (1): the restored panel is fresh for exactly this input.
    snapshotPanel("link", message);
  }
}

// Tap a history row: show that stored verdict again on the page
// (same card as a fresh check). lastCheck is cleared so a later
// language change re-labels this card instead of re-running some
// other, older check over it.
// The verdict is restored to the tab that produced it (recorded as
// `kind` when the check was saved), and that tab's form is filled
// with the stored message — so the card never appears under the
// wrong tab. Entries saved before `kind` existed restore to the
// tab that is currently active (no switch).
const CHECKER_TABS = ["message", "email", "call", "outbound"];
function showHistoryEntry(e) {
  // The verdict card lives on the Beranda dashboard — switch back
  // first, otherwise the card would render into a hidden view.
  showView("home");
  lastCheck = null;
  const tab = CHECKER_TABS.includes(e.kind) ? e.kind : null;
  if (tab) {
    switchCheckerTab(tab);
    fillCheckerForm(tab, e.message || "");
  }
  // Audit 11 (review): an email verdict also depends on the sender,
  // which is not stored — snapshot the sender fields as they stand
  // at restore time so later sender edits still stale the card.
  lastCheckedEmail =
    tab === "email"
      ? {
          fromName: $("email-from-name")?.value.trim() || "",
          fromEmail: $("email-from-email")?.value.trim() || "",
          body: e.message || "",
        }
      : null;
  // Audit 8: file/link entries restore into their own tool panel
  // (the file name / URL is filled back in, so the check can be
  // re-run) — the verdict card still renders on Beranda as usual.
  if (e.kind === "file" || e.kind === "link") {
    switchModuleTab(e.kind);
    if (e.kind === "file") $("filecheck-name-input").value = e.message || "";
    else $("linktrack-input").value = e.message || "";
  }
  const verdict = {
    status: e.status || "safe",
    riskScore: Number(e.riskScore ?? 0),
    redFlags: Array.isArray(e.redFlags) ? e.redFlags : [],
    infoFlags: Array.isArray(e.infoFlags) ? e.infoFlags : [],
    checks: Array.isArray(e.checks) ? e.checks : undefined,
    summary: e.summary || "",
    source: e.source || "CODE",
    model: e.model || "",
    codeOnlyReason: e.codeOnlyReason || "",
    // Auto-redact (23 Nov 2026): the stored entry keeps the redaction
    // counts, so the restored card shows the same receipt note as
    // the original check (counts only, no values).
    redacted: Array.isArray(e.redacted) ? e.redacted : undefined,
    // Safety floor (23 Nov 2026): preserve the flag so the restored
    // receipt shows the floor note when the original check triggered it.
    floorApplied: e.floorApplied === true,
  };
  // Audit 10: an old call entry scored under pre-audit-7 rules keeps
  // its stored verdict, but the restored card carries the same
  // "current rules would say" note the history row shows — otherwise
  // the card would repeat the unexplained old score.
  const legacyNote = legacyOjkNote(e);
  if (legacyNote) verdict.infoFlags = [...verdict.infoFlags, legacyNote];
  // Audit 11 (g): the panel follows the restore too (see
  // renderPanelRestore) — otherwise it keeps the previous check.
  if (e.kind === "file" || e.kind === "link") renderPanelRestore(e.kind, verdict, e.message || "", e);
  // Privacy (21 Nov 01:19): the re-opened card is a masked view —
  // the message text and the numbers box never show sensitive numbers
  // whole (extra.masked in renderResult). The stored entry keeps the
  // real text, so re-check and "report this number" still work.
  // History entries saved before the duration was stored have no
  // elapsedSec — the receipt then honestly shows "—" as before.
  renderResult(verdict, e.message || "", Number.isFinite(e.elapsedSec) ? e.elapsedSec : null, "", { masked: true });
  // File/link restores scroll to the tool panel; the other kinds
  // scroll to the checker form.
  const scrollTarget =
    e.kind === "file"
      ? $("filecheck")
      : e.kind === "link"
        ? $("linktrack")
        : document.querySelector(".checker");
  if (scrollTarget) scrollTarget.scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "start" });
}

/** Fill a checker tab's form with a stored message (history restore). */
function fillCheckerForm(tab, message) {
  const text = String(message || "");
  if (tab === "message") {
    $("message-input").value = text;
  } else if (tab === "email") {
    // Only the body is stored (the sender fields are not) — the body
    // is what the verdict was about.
    $("email-body").value = text;
  } else if (tab === "call") {
    // Call checks store "number: said" (or just the number, or just
    // what was said). Split the number back out when it leads.
    const m = text.match(/^(\+?[\d\s\-()]{7,20}): ([\s\S]*)$/);
    if (m) {
      $("call-number").value = m[1].trim();
      $("call-said").value = m[2];
    } else if (/^\+?[\d\s\-()]{7,20}$/.test(text.trim())) {
      $("call-number").value = text.trim();
      $("call-said").value = "";
    } else {
      $("call-number").value = "";
      $("call-said").value = text;
    }
  } else if (tab === "outbound") {
    $("outbound-input").value = text;
  }
  // Audit 6: restoring a form must refresh everything the textarea
  // drives — the character counter stayed at the pre-restore count
  // ("3 karakter" while the restored text was 139 chars).
  refreshInputState();
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
  hideCheckCompleteToast();
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
  const t0 = performance.now();
  const btn = $("email-btn");
  btn.disabled = true;
  try {
    lastCheck = { kind: "email", fromName, fromEmail, body };
    lastCheckedEmail = { fromName, fromEmail, body };
    const verdict = analyzeEmail({ fromName, fromEmail, body }, lang);
    const elapsedSec = (performance.now() - t0) / 1000;
    renderResult(verdict, body, elapsedSec, "", {}, true);
    enrichResult(body);
    const where = await saveCheck({ message: body, kind: "email", ...verdict, elapsedSec });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : where === "off"
          ? t("storageOff", lang)
          : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    hideStaleResult();
    showCheckError(errorEl, err, () => onEmailCheck());
  } finally {
    btn.disabled = false;
  }
}

// Phone-call check: caller number + what was said, against the
// community reports (hash lookup) + known phone-scam scripts.
async function onCallCheck() {
  hideCheckCompleteToast();
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
  const t0 = performance.now();
  try {
    lastCheck = { kind: "call", number, said };
    lastCheckedEmail = null;
    // The community lookup always runs (see callcheck.js) — no gate.
    const { verdict, lookupMs } = await analyzeCall({ number, said }, lang);
    if (runId !== checkRunId) return;
    const message = number && said ? `${number}: ${said}` : number || said;
    const elapsedSec = (performance.now() - t0) / 1000;
    renderResult(
      verdict,
      message,
      elapsedSec,
      "",
      lookupMs != null ? { lookupSec: lookupMs / 1000 } : {},
      true,
    );
    enrichResult(message);
    const where = await saveCheck({ message, kind: "call", ...verdict, elapsedSec });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : where === "off"
          ? t("storageOff", lang)
          : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    if (runId !== checkRunId) return;
    hideStaleResult();
    showCheckError(errorEl, err, () => onCallCheck());
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

// Check a bank account number in-app (audit §2b): format validation
// + community report count for its hash (gated on cloud history,
// like every other lookup). The raw number is never sent anywhere.
// cekrekening.id stays the official checker — the result links to it.
async function onAccountCheck() {
  const input = $("account-number");
  const errEl = $("account-error");
  const box = $("account-result");
  errEl.hidden = true;
  box.hidden = true;
  const account = input.value.replace(/[\s.-]/g, "");
  if (!/^\d{8,20}$/.test(account)) {
    errEl.textContent = t("accountCheckInvalid", lang);
    errEl.hidden = false;
    input.focus();
    return;
  }
  let line = `<p>${escapeHtml(t("accountCheckFormat", lang, { n: account.length }))}</p>`;
  // Community lookup always runs (21 Nov, Myuden): the hash is
  // suspect data, not the user's — see callcheck.js header.
  const n = await getReportCount(await reportHash("account", account));
  if (n != null && n > 0) {
    line += `<p>${escapeHtml(t("reportCount", lang, { n }))}</p>`;
  } else if (n === 0) {
    line += `<p class="muted">${escapeHtml(t("reportNone", lang))}</p>`;
  } else if (n == null) {
    line += `<p class="muted">${escapeHtml(t("reportCountFailed", lang))}</p>`;
  }
  box.innerHTML = `${line}<p class="hint"><a href="https://cekrekening.id" target="_blank" rel="noopener">${escapeHtml(t("numbersCheckAccount", lang))}</a></p>`;
  box.hidden = false;
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
  // Anything else: map through the friendly error table (translated,
  // no raw English in the headline) — the raw text stays in the
  // console via the caller's console.error.
  return friendlyErrorMessage(err);
}

/**
 * Score a transcribed call: AI verdict for the transcript + local
 * call analysis (number + script patterns on the transcript), merged
 * with the worse verdict winning. Renders the result with the audio
 * privacy receipt line and shows the transcript.
 */
async function scoreTranscribedCall(audioBlob) {
  hideCheckCompleteToast();
  const number = $("call-number").value.trim();
  lastCallAudioBlob = audioBlob;
  hideCallAudioError();
  setCallAudioProgress(t("callTranscribing", lang));
  const t0 = performance.now();
  try {
    const { transcript } = await transcribeAudioWithAI(audioBlob, lang, () =>
      setCallAudioProgress(t("tryingBackupModel", lang)),
    );
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
      aiVerdict = codeOnlyVerdict(
        scoredText,
        lang,
        /timed out/i.test(err?.message || "") ? "timeout" : "unavailable",
      );
    }
    const { verdict: localVerdict, lookupMs } = await analyzeCall(
      { number, said: scoredText },
      lang,
    );
    const verdict = mergeCallVerdict(aiVerdict, localVerdict);
    const message = number && scoredText ? `${number}: ${scoredText}` : number || scoredText;
    // The receipt shows the real total wait for an answer, even for a
    // code-only card: the receipt's code-only line still says the AI
    // did not answer, so the number reads as total wait, never as the
    // code check's own duration.
    const elapsedSec = (performance.now() - t0) / 1000;
    lastCheckedEmail = null;
    renderResult(verdict, message, elapsedSec, "", {
      audio: true,
      ...(lookupMs != null ? { lookupSec: lookupMs / 1000 } : {}),
      onRetry: () => scoreTranscribedCall(lastCallAudioBlob),
    }, true);
    enrichResult(message);
    const where = await saveCheck({ message, kind: "call", ...verdict, elapsedSec });
    lastStorageWhere = where;
    $("storage-note").textContent =
      where === "firestore"
        ? t("storageFirestore", lang)
        : where === "off"
          ? t("storageOff", lang)
          : t("storageLocal", lang);
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    hideStaleResult();
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
    // A totally empty recording (no audio data at all) must not end
    // in silence: tell the user nothing was heard instead of going
    // back to idle with no message.
    if (blob.size > 0) scoreTranscribedCall(blob);
    else showCallAudioError(t("callNoSpeech", lang));
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
      return `<li><strong>${escapeHtml(c.name)}</strong> <span class="contacts-cat">${escapeHtml(t(catKey, lang))}</span><br/>${contact}${c.note ? ` <span class="muted">${escapeHtml(c.note)}</span>` : ""}${c.url ? ` <a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.url.replace(/^https?:\/\//, ""))}</a>` : ""}</li>`;
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
    // Chips show only the label — the sample MESSAGE BODY is never
    // displayed in the list (the OTP sample's code stays hidden until
    // the chip is tapped). Tapping a chip only FILLS the form
    // (21 Nov 2026, Myuden 18:01): it never sends — the user reads
    // the text in the textarea and presses send (or Enter) themself.
    b.append(label);
    b.addEventListener("click", () => {
      if (checkBusy) return;
      warmUpOnce();
      $("message-input").value = t(s.textKey, lang);
      // The example only FILLS the form (21 Nov 2026, Myuden 18:01):
      // it never sends. Say so under the chips and mark this chip
      // selected, so the user sees the text is filled but unsent.
      $("fill-note")?.classList.add("show");
      refreshInputState();
      $("message-input").focus();
    });
    samplesEl.appendChild(b);
  });
}

// Apply the current language to every static string in the page.
function applyStaticLanguage() {
  document.documentElement.lang = lang;
  document.title = t("pageTitle", lang);
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n, lang);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", t(el.dataset.i18nAriaLabel, lang));
  });
  // Hero title: highlight the keyword ("penipuan?" / "a scam?") — the
  // generic loop above would wipe the inner span, so set it by hand.
  const heroTitle = document.querySelector(".hero-title");
  if (heroTitle) {
    const full = t("heroTitle", lang);
    const kw = lang === "id" ? "penipuan?" : "a scam?";
    heroTitle.innerHTML =
      escapeHtml(full.replace(kw, "")) +
      `<span class="hero-keyword">${escapeHtml(kw)}</span>`;
  }
  // Language toggle state follows the active language.
  const idBtn = $("lang-id-btn");
  const enBtn = $("lang-en-btn");
  if (idBtn) idBtn.setAttribute("aria-pressed", lang === "id" ? "true" : "false");
  if (enBtn) enBtn.setAttribute("aria-pressed", lang === "en" ? "true" : "false");
  // Onboarding close button: its label follows the active language.
  const onboardClose = $("onboard-close");
  if (onboardClose) onboardClose.setAttribute("aria-label", t("dialogClose", lang));
  updateLocalStats();
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder, lang);
  });
  const demo = !isFirebaseConfigured();
  updateModeLabel();
  renderSendBtn();
  $("storage-note").textContent =
    lastStorageWhere === "firestore"
      ? t("storageFirestore", lang)
      : lastStorageWhere === "off"
        ? t("storageOff", lang)
        : t("historyLocalNote", lang);
  setOnlineState();
  buildSamples();
  renderHistory(lastHistory);
  buildContactsCats();
  renderContacts();
  renderAidOptions();
  updateCrowdLabels();
  if (!quizState) $("quiz-start-btn").textContent = t("quizStart", lang);
  $("image-btn").disabled = demo || !selectedImage;
  refreshAssistantLanguage();
  renderHistoryView();
  // Character count + send-button state + steps follow the new
  // language too (the count unit word changes; chip selection re-syncs
  // against the new-language sample texts).
  refreshInputState();
}

// Switch UI language (ID/EN toggle in the top bar). Old saved codes
// (es/fr/de/pt/ja/zh) are not supported any more — isSupported guards.
function setLanguage(code) {
  if (!isSupported(code)) return;
  if (code === lang) {
    applyStaticLanguage();
    return;
  }
  lang = code;
  saveLanguage(lang);
    applyStaticLanguage();
    hideCheckCompleteToast();
    // Audit 12 (1): a stale panel banner is UI chrome, not verdict
    // content — re-translate it with the rest of the interface.
    refreshPanelStaleState();
    // Audit 13 (E): the file/link panels keep their old-language
    // result after a language switch (their data is not retained in
    // a re-renderable form). Show the stale-language note on them so
    // the user knows the result is still in the previous language —
    // never leave a mixed-language panel without an explanation.
    // Added once (a second switch does not duplicate it); it
    // vanishes when the panel is re-run.
    for (const boxId of ["filecheck-result", "linktrack-result"]) {
      const box = $(boxId);
      if (!box || !box.innerHTML.trim()) continue;
      const existing = box.querySelector(".lang-stale-note");
      if (existing) {
        // A note from an earlier switch is itself in the old
        // language now — re-word it instead of adding a second one.
        existing.textContent = t("panelLangStale", lang);
      } else {
        const note = document.createElement("p");
        note.className = "lang-stale-note";
        note.textContent = t("panelLangStale", lang);
        box.prepend(note);
      }
    }
    // Speed: re-render the current result card's static strings in
    // the new language right away (labels, headings, badge, code
    // check) — the AI-written summary + red flags stay in the old
    // language until the re-check below returns the new-language
    // verdict. Never a translation of the verdict itself. Skipped
    // while a check is running: the card on screen is then the
    // interim panel, not a verdict, and the running check's own
    // completion + follow-up re-check own the card.
    if (lastRenderArgs && !checkBusy && !$("result").hidden) {
      // Audit 13 (E): an AI verdict cannot be re-derived in the new
      // language, so mark it stale NOW — the note is visible during
      // the re-check, never a silent mixed-language card. Code/demo
      // verdicts re-derive fully, so their stale flag is cleared.
      const isAiVerdict =
        lastRenderArgs.verdict.source === "IN_CLOUD" ||
        lastRenderArgs.verdict.source === "ON_DEVICE";
      renderResult(
        lastRenderArgs.verdict,
        lastRenderArgs.message,
        lastRenderArgs.elapsedSec,
        lastRenderArgs.imageText,
        isAiVerdict
          ? { ...lastRenderArgs.extra, langStale: true }
          : { ...lastRenderArgs.extra, langStale: false },
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
}

// Dashboard views (21 Nov, Myuden — "Hapus hamburger, semua di
// dashboard"): Beranda (#view-home) and Riwayat (#view-history) are
// two full-page views inside <main>; only one is visible at a time.
// Switching jumps to the top and, for Riwayat, re-renders the list.
function setNavActive(id) {
  ["nav-home", "nav-history"].forEach((n) => {
    const b = $(n);
    b.classList.toggle("active", n === id);
    if (n === id) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
}
function showView(name) {
  // Remember the current view across a refresh (Myuden 22 Nov 21:43):
  // a refresh on Riwayat must stay on Riwayat, not reset to Beranda.
  // sessionStorage survives a same-tab refresh but NOT a new tab, so
  // a new tab still starts on Beranda, as expected. Guarded: private
  // mode can throw on storage access, and the view switch itself
  // must never fail because of it.
  try { sessionStorage.setItem("tipucek_view", name); } catch {}
  $("view-home").hidden = name !== "home";
  $("view-history").hidden = name !== "history";
  setNavActive(name === "history" ? "nav-history" : "nav-home");
  if (name === "history") renderHistoryView();
  window.scrollTo(0, 0);
}

// Anonymous visitor counter (Myuden 22 Nov 2026): read the live
// total from Firestore and show it in the footer; count this
// device once today. Offline (read fails) the footer line stays
// hidden — never a made-up number. Fire-and-forget at boot.
async function refreshVisitorCount() {
  const row = $("visitor-count");
  const num = $("visitor-count-num");
  if (!row || !num) return;
  const count = await readVisitorCount();
  if (count == null) return; // offline: keep hidden
  let shown = count;
  if (shouldCountToday(readCountedDate())) {
    if (await incrementVisitorCount()) shown = count + 1;
  }
  num.textContent = Number(shown).toLocaleString(lang === "id" ? "id-ID" : "en-US");
  row.hidden = false;
}

function init() {
  // Restore the view from before a refresh (Myuden 22 Nov 21:43):
  // a refresh on Riwayat must stay on Riwayat. This runs FIRST in
  // init — synchronously, before the first paint — so there is no
  // flash of Beranda before Riwayat appears. Only "history" restores;
  // any other/missing value starts on Beranda (incl. a new tab, where
  // sessionStorage is empty by design). showView("history") also
  // renders the list from the (still empty) lastHistory; loadHistory
  // re-renders it with the real entries once it resolves below.
  let restoredView = "home";
  try {
    if (sessionStorage.getItem("tipucek_view") === "history") restoredView = "history";
  } catch {}
  if (restoredView === "history") showView("history");

  // Language toggle (top bar): auto-detected by default, saved on tap.
  // Two languages only (ID + EN, Myuden 21:32) — no dropdown.
  $("lang-id-btn").addEventListener("click", () => setLanguage("id"));
  $("lang-en-btn").addEventListener("click", () => setLanguage("en"));

  // Demo-mode banner: visible, honest, always in the UI while unconfigured.
  const demo = !isFirebaseConfigured();
  $("demo-banner").hidden = !demo;

  // Install card + first-time onboarding (23 Nov 2026).
  initInstallCard();
  initOnboarding();
  // Online-only watch (23 Nov 2026): honest online/offline pill +
  // auto-retry of a pending offline check when the internet returns.
  initOnlineWatch();

  buildSamples();

  // Audit 9: render the hero stats SYNCHRONOUSLY at init from the
  // aggregate totals (a plain localStorage read) — the first paint
  // already shows the final numbers, never "–" and never a 0 →
  // target count-up. This call MUST come before the observer setup
  // below: statsInView is still false here, so animateStatNum writes
  // the final values directly. CoArena (audit 9): the old order ran
  // the no-IntersectionObserver fallback (statsInView = true)
  // BEFORE this call, so those browsers animated 0 → target on
  // first paint instead of writing the final numbers. The later
  // loadHistory() render only changes them if the merged (cloud)
  // list seeds higher totals, and then only by the small delta.
  updateLocalStats();

  // Stat count-up (23 Nov 2026): later updates animate the small
  // delta while the stats are in view. Reduced motion or no
  // IntersectionObserver: set the final value directly, never
  // animate. Audit 9: the observer used to RESET both numbers to
  // "0" and re-animate them the first time the stats scrolled into
  // view — on first load that replayed 0 → target while the sub
  // already said the final total, which is exactly the "numbers
  // briefly inconsistent on first load" the auditor saw. The
  // numbers are now rendered synchronously at init (above), so the
  // observer only arms the animation gate and never rewrites them.
  const statsEl = document.querySelector(".stats");
  if (statsEl && "IntersectionObserver" in window) {
    const statsIo = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      statsInView = true;
      statsIo.disconnect();
    }, { threshold: 0.1 });
    statsIo.observe(statsEl);
  } else {
    statsInView = true;
  }

  // Anonymous visitor counter (Myuden 22 Nov 2026): fire-and-forget;
  // the footer line stays hidden when Firestore is unreachable.
  refreshVisitorCount().catch(() => {});

  // Scroll reveal (23 Nov 2026): sections fade + rise when scrolled
  // into view. IntersectionObserver alone is not enough — a jump
  // scroll (End key, anchor jump) passes middle sections without ever
  // intersecting them, so positions are also checked on every scroll:
  // anything already above the viewport counts as seen. Skipped
  // entirely under reduced motion.
  if (!REDUCED_MOTION) {
    const revealEls = [...document.querySelectorAll(".hero, .stats, .week-chart, .checker, .trend, .checks, .modules, .share, .install-card, .footer")];
    revealEls.forEach((el) => el.classList.add("reveal"));
    let revealTicking = false;
    const revealCheck = () => {
      revealTicking = false;
      for (const el of revealEls) {
        if (el.classList.contains("in")) continue;
        const r = el.getBoundingClientRect();
        // Audit 14 (footer hilang di mode desktop HP, Myuden 22 Nov
        // 20:34): the old threshold was innerHeight * 0.9 — on a TALL
        // viewport (desktop mode on a phone, innerHeight ~2180) the
        // footer at max scroll sits at top 2008, above the 1962
        // threshold, and it can never be scrolled past (its bottom
        // never reaches <= 0), so it NEVER got ".in" and stayed
        // invisible (opacity 0). Reveal as soon as any part enters
        // the viewport (top < innerHeight); the "already passed"
        // branch stays for jump scrolls.
        if (r.top < window.innerHeight || r.bottom <= 0) el.classList.add("in");
      }
      if (revealEls.every((el) => el.classList.contains("in"))) {
        window.removeEventListener("scroll", onRevealScroll);
      }
    };
    const onRevealScroll = () => {
      if (!revealTicking) {
        revealTicking = true;
        requestAnimationFrame(revealCheck);
      }
    };
    window.addEventListener("scroll", onRevealScroll, { passive: true });
    revealCheck();
  }

  $("message-input").addEventListener("focus", () => {
    warmUpOnce();
  });
  // Typing edits the text, so the "example filled, not sent yet" note
  // no longer applies — hide it and refresh count / send state /
  // steps / stale state.
  $("message-input").addEventListener("input", () => {
    $("fill-note")?.classList.remove("show");
    refreshInputState();
  });
  // Audit 11: the stale guard must also fire when the OTHER checker
  // forms change — before this only the message textarea could stale
  // a card (see refreshStaleState). Sender fields are included: an
  // email verdict depends on the sender as well as the body.
  for (const id of ["call-number", "call-said", "email-body", "email-from-email", "email-from-name", "filecheck-name-input", "linktrack-input"]) {
    $(id)?.addEventListener("input", refreshStaleState);
  }
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
  // Enter runs the check (Shift+Enter keeps a newline).
  $("message-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!checkBusy) onCheck();
    }
  });
  // Hero "Cek pesan" (22 Nov 2026 fix): the hero has NO textarea any
  // more — there is exactly one paste box, in the checker below. Two
  // visible paste boxes confused users (paste in the hero never showed
  // in the checker). The hero button scrolls to the checker and
  // focuses its input; if another checker tab is open, it switches
  // to the message tab first so the input is visible.
  // runCheckWithText stays: Aman still uses it.
  $("hero-check-btn").addEventListener("click", () => {
    if ($("tab-message").hidden) switchCheckerTab("message");
    document.querySelector(".checker").scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "start" });
    $("message-input").focus({ preventScroll: true });
  });
  // Chart empty state (21 Nov, audit M1): a first visit shows no
  // data — invite trying an example instead of an empty chart. Same
  // landing as the hero button: message tab + checker in view + input
  // focused, so one tap reaches the examples below.
  $("week-chart-try-btn").addEventListener("click", () => {
    if ($("tab-message").hidden) switchCheckerTab("message");
    document.querySelector(".checker").scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "start" });
    $("message-input").focus({ preventScroll: true });
  });
  // Hero second button (IASC-style): open the Report tool.
  $("hero-report-btn").addEventListener("click", () => {
    switchModuleTab("report");
    document.querySelector(".modules").scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "start" });
  });
  // Share card: copy the site link (clipboard, with a fallback).
  $("share-copy-btn").addEventListener("click", async (ev) => {
    const btn = ev.currentTarget;
    const url = "https://tipucek.web.app";
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    btn.textContent = ok ? t("shareCopied", lang) : t("shareCopy", lang);
    // Audit M4: the label alone is easy to miss, and a denied
    // clipboard used to fail silently — say it in a toast either way.
    showInfoToast(t(ok ? "shareCopied" : "shareCopyFailed", lang));
    setTimeout(() => {
      btn.textContent = t("shareCopy", lang);
    }, 2000);
  });
  // Bottom nav (21 Nov, Myuden — "Hapus hamburger, semua di
  // dashboard"): Beranda ↔ Riwayat switch two full-page dashboards;
  // nothing is a dead link. showView lives at top level so a history
  // row can jump back to the dashboard too.
  $("nav-home").addEventListener("click", () => showView("home"));
  $("nav-history").addEventListener("click", () => showView("history"));
  // Desktop-only header Riwayat link (21 Nov, Myuden — opsi b): the
  // entry to Dashboard 2 on desktop, where the bottom nav is hidden.
  // Hidden on mobile; the element still exists there, so the listener
  // is harmless at every width.
  $("header-history-link").addEventListener("click", () => showView("history"));
  // Back button at the top of Dashboard 2: the way home on desktop,
  // where the bottom nav is hidden (21 Nov 0-findings sweep).
  $("history-back-btn").addEventListener("click", () => showView("home"));
  // Header theme button (21 Nov): icon follows the effective mode;
  // tap opens a small menu (Dark / Light / System). Closes on pick,
  // outside tap, or Escape. No notification bell — TipuCek has no
  // notification source (no account/server).
  const themeBtn = $("theme-btn");
  const themeMenu = $("theme-menu");
  function closeThemeMenu(refocus) {
    if (!themeMenu || themeMenu.hidden) return;
    themeMenu.hidden = true;
    themeBtn.setAttribute("aria-expanded", "false");
    if (refocus) themeBtn.focus({ preventScroll: true });
  }
  themeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (themeBtn.disabled) return;
    const willOpen = themeMenu.hidden;
    themeMenu.hidden = !willOpen;
    themeBtn.setAttribute("aria-expanded", String(willOpen));
  });
  document.querySelectorAll("[data-theme-pick]").forEach((b) =>
    b.addEventListener("click", () => {
      setThemeMode(b.dataset.themePick);
      closeThemeMenu(true);
    }),
  );
  document.addEventListener("click", (e) => {
    if (themeMenu && !themeMenu.hidden && !e.target.closest(".theme-menu-wrap")) closeThemeMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && themeMenu && !themeMenu.hidden) {
      e.preventDefault();
      closeThemeMenu(true);
    }
  });
  // Aman launcher: one tap toggles the chat panel from anywhere on
  // the page (the panel is an overlay — no scrolling to the tools
  // area). It is the ONLY door to Aman: there is no module tab.
  $("aman-fab").addEventListener("click", () => {
    if (isAmanPanelOpen()) closeAman();
    else openAman();
  });
  // Aman launcher hides while the footer is on screen (21 Nov, Myuden):
  // the floating button must never cover the footer text. Any part of
  // the footer entering the viewport hides it; once the footer leaves
  // the viewport entirely it fades back in. The same hide applies to
  // the Cek Pesan composer (21 Nov, Myuden's phone screenshot): the
  // fixed launcher at bottom:84px sits exactly over the Tempel button
  // when the composer row is scrolled into view on a narrow screen,
  // so the composer being visible hides the launcher too. No
  // IntersectionObserver (very old browsers) => the button simply
  // stays visible, as before.
  const amanFab = $("aman-fab");
  const footerEl = document.querySelector(".footer");
  const composerEl = document.querySelector(".chat-composer");
  const fabHideTargets = [footerEl, composerEl].filter(Boolean);
  if (amanFab && fabHideTargets.length && "IntersectionObserver" in window) {
    const fabHiddenBy = new Set();
    const fabObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) fabHiddenBy.add(entry.target);
        else fabHiddenBy.delete(entry.target);
      }
      amanFab.classList.toggle("aman-fab-hidden", fabHiddenBy.size > 0);
    }, { threshold: 0 });
    fabHideTargets.forEach((el) => fabObserver.observe(el));
  }
  $("assistant-close").addEventListener("click", closeAman);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isAmanPanelOpen()) {
      e.preventDefault();
      closeAman();
    }
  });
  document.querySelectorAll("[data-text-size-pick]").forEach((b) =>
    b.addEventListener("click", () => setTextSize(b.dataset.textSizePick)),
  );
  document.querySelectorAll("[data-accent-pick]").forEach((b) =>
    b.addEventListener("click", () => setAccent(b.dataset.accentPick)),
  );
  // Privacy toggles (21 Nov 01:19) on the Riwayat dashboard: "save history"
  // gates saveCheck entirely (new checks are not stored at all);
  // "hide message text" re-renders the history list without
  // snippets. Both persist in localStorage.
  const syncPrivacyToggles = () => {
    const saveOn = isHistorySavingEnabled();
    $("history-save-on-btn").setAttribute("aria-pressed", saveOn ? "true" : "false");
    $("history-save-off-btn").setAttribute("aria-pressed", saveOn ? "false" : "true");
    const hideOn = isHistoryTextHidden();
    $("history-hide-on-btn").setAttribute("aria-pressed", hideOn ? "true" : "false");
    $("history-hide-off-btn").setAttribute("aria-pressed", hideOn ? "false" : "true");
  };
  $("history-save-on-btn").addEventListener("click", () => {
    setHistorySavingEnabled(true);
    syncPrivacyToggles();
  });
  $("history-save-off-btn").addEventListener("click", () => {
    setHistorySavingEnabled(false);
    syncPrivacyToggles();
    showInfoToast(t("historySaveOffNote", lang));
  });
  $("history-hide-on-btn").addEventListener("click", () => {
    setHistoryTextHidden(true);
    syncPrivacyToggles();
    renderHistoryView();
  });
  $("history-hide-off-btn").addEventListener("click", () => {
    setHistoryTextHidden(false);
    syncPrivacyToggles();
    renderHistoryView();
  });
  syncPrivacyToggles();
  $("history-search").addEventListener("input", renderHistoryView);
  $("history-list").addEventListener("click", (ev) => {
    const row = ev.target.closest("[data-history-id]");
    if (!row) return;
    const entry = lastHistory.find((e) => e.id === row.dataset.historyId);
    if (!entry) return;
    showHistoryEntry(entry);
  });
  let clearArmed = false;
  let clearTimer = null;
  $("export-history-btn").addEventListener("click", exportHistoryCsv);
  $("history-clear-btn").addEventListener("click", async () => {
    const btn = $("history-clear-btn");
    // Two-tap confirm: an accidental tap must never wipe history.
    if (!clearArmed) {
      clearArmed = true;
      btn.textContent = t("clearHistoryConfirm", lang);
      clearTimer = setTimeout(() => {
        clearArmed = false;
        btn.textContent = t("clearHistory", lang);
      }, 4000);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    btn.textContent = t("clearHistory", lang);
    clearLocalHistory();
    renderHistory(await loadHistory());
    showInfoToast(t("historyCleared", lang));
  });
  // Senior mode toggle (top bar). Turning Senior ON also switches
  // text size to Large (its default); a manual size picked afterwards
  // is kept — the force happens here, on toggle, not on every load,
  // so a saved manual choice survives a reload.
  $("senior-toggle").addEventListener("click", () => {
    seniorMode = !seniorMode;
    if (seniorMode) setTextSize("large");
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
  // Module tabs: click + arrow keys (WAI-ARIA tabs pattern). Arrows
  // move through the grid in VISUAL order — all 8 cards are tabs
  // (the Riwayat card was removed 21 Nov 11:22; Riwayat lives in
  // Dashboard 2, opened from the bottom nav only), so no card is
  // skipped: quiz → how.
  const MODULE_NAV = ["link", "file", "qr", "chatlog", "report", "contacts", "aid", "quiz", "how"];
  const navToModule = (name) => switchModuleTab(name);
  const attachModuleKeys = (name) => {
    $(`module-tab-${name}`).addEventListener("keydown", (e) => {
      const pos = MODULE_NAV.indexOf(name);
      let next = -1;
      if (e.key === "ArrowRight") next = (pos + 1) % MODULE_NAV.length;
      else if (e.key === "ArrowLeft")
        next = (pos - 1 + MODULE_NAV.length) % MODULE_NAV.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = MODULE_NAV.length - 1;
      if (next >= 0) {
        e.preventDefault();
        navToModule(MODULE_NAV[next]);
        $(`module-tab-${MODULE_NAV[next]}`).focus();
      }
    });
  };
  MODULE_TABS.forEach((n) => {
    $(`module-tab-${n}`).addEventListener("click", () => switchModuleTab(n));
    attachModuleKeys(n);
  });
  // (21 Nov 11:22, Myuden — kartu Riwayat dihapus dari grid: Riwayat
  // hanya dibuka dari nav bawah + tautan "Riwayat" di header khusus
  // desktop (21 Nov 12:12, opsi b). Tidak ada lagi handler kartu
  // Riwayat di sini; showView("history") tetap dipakai nav bawah dan
  // tautan header desktop.)
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
      $("fill-note")?.classList.remove("show");
      refreshInputState();
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
  $("account-btn").addEventListener("click", onAccountCheck);
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
  // File/link verdicts for history (22 Nov audit 8): these tools are
  // categorical (high/low), while the history card needs a 0-100
  // verdict — the mapping is fixed here, never invented per case:
  // high = 85 (scam band), link "low" = 40 (suspicious band),
  // low = 0 (safe). Exactly one checklist row per tool, so the top
  // flag count always matches the checklist count (audit 4
  // invariant). For text files the CONTENT was scored by the local
  // rule engine, so that verdict is used wholesale instead.
  function fileVerdictFor(info, textLocal, lang) {
    // Text AND script files: the verdict comes from the CONTENT,
    // scored like a pasted message (see the file handler). The rules
    // that fired are still listed; only their quotes are cut before
    // the verdict is saved (see the comment inside).
    if ((info.kind === "text" || info.kind === "script") && textLocal) {
      // CoArena (audit 8): the content verdict's checklist evidence
      // holds FRAGMENTS of the uploaded file's text (matchSnippet) —
      // storing them would break the "file NAME only" promise. The
      // rules that fired are still listed; only their quotes are cut
      // before the verdict is saved.
      return {
        status: textLocal.status,
        riskScore: textLocal.riskScore,
        redFlags: [...textLocal.redFlags],
        checks: textLocal.checks.map((c) => ({ ...c, evidence: "" })),
        summary: textLocal.summary,
      };
    }
    // Groq (audit 8): a NAME that is a URL is not a file at all —
    // "Aman 0" would claim a verdict the name check cannot give
    // (the panel itself says "check it with Cek Tautan"). It is
    // suspicious (40); the summary points at the link checker.
    // Audit 13: an UNRECOGNIZED file is likewise never "safe" 0 —
    // its type could not be determined, so it is suspicious (30,
    // the bottom of the suspicious band) with the honest "unknown"
    // reason. A clean result never proves a file safe, and an
    // unknown type proves even less.
    const high = info.level === "high";
    const url = info.kind === "url";
    const unknown = info.kind === "unknown";
    // A script whose content could not be read is still a program —
    // it must not fall through to "safe 0" just because its level is
    // "low" (the level only describes the content score, which is
    // missing here). The name-only script check is unaffected: its
    // level is "high", so it still lands on "scam" 85 below.
    const scriptUnread = info.kind === "script" && !textLocal;
    const suspicious = url || unknown || scriptUnread;
    return {
      status: high ? "scam" : suspicious ? "suspicious" : "safe",
      riskScore: high ? 85 : url ? 40 : suspicious ? 30 : 0,
      redFlags: high || suspicious ? [t(info.reasonKey, lang)] : [],
      checks: [
        {
          id: "fileType",
          flag: "File type assessment",
          found: high || suspicious,
          evidence: info.fileName,
        },
      ],
      summary: t(info.reasonKey, lang),
    };
  }
  $("filecheck-input").addEventListener("change", (e) => {
    selectedFile = (e.target.files && e.target.files[0]) || null;
    $("filecheck-btn").disabled = !selectedFile;
    const nameEl = $("filecheck-name");
    if (selectedFile) {
      nameEl.textContent = `${selectedFile.name} — ${formatSize(selectedFile.size)}`;
      nameEl.hidden = false;
      // Audit 11: the picked name also fills the name-check field
      // (same as a history restore) — so the stale guard can tell
      // the upload's verdict still matches its input.
      $("filecheck-name-input").value = selectedFile.name;
    } else {
      nameEl.hidden = true;
      nameEl.textContent = "";
      // Audit 11 (review): no file picked — clear the name field too,
      // or it keeps the previous file's name and the stale guard
      // thinks the old verdict still matches.
      $("filecheck-name-input").value = "";
    }
    // A new pick clears the previous result — the old verdict must
    // not linger as if it belonged to the new file (21 Nov live).
    const box = $("filecheck-result");
    box.innerHTML = "";
    box.hidden = true;
    // Audit 11: a new pick also stales the main card (its verdict was
    // about the previous file) — the name field above now holds the
    // new name, so the guard can tell the difference.
    refreshStaleState();
  });
  $("filecheck-btn").addEventListener("click", async () => {
    if (!selectedFile) return;
    const t0 = performance.now();
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
      // The file-content hash is high-entropy (not reversible) and
      // the lookup always runs (21 Nov, Myuden): a hash of the
      // suspect file, read against a public aggregate count — never
      // the file itself. A null count means "lookup failed".
      if (info.sha256) {
        const n = await getReportCount(info.sha256);
        if (n != null && n > 0) {
          countLine = `<p>${escapeHtml(t("fileHashReported", lang, { n }))}</p>`;
        } else if (n === 0) {
          countLine = `<p class="muted">${escapeHtml(t("fileHashNew", lang))}</p>`;
        } else if (n == null) {
          countLine = `<p class="muted">${escapeHtml(t("reportCountFailed", lang))}</p>`;
        }
      }
      // Text AND script files (.txt/.md/.csv/... and .js/.ps1/.sh/
      // .bat/...): the content was read on the device — score it
      // like a pasted message with the local rule engine. The button
      // below sends the same text to the full AI checker.
      let textScoreLine = "";
      let textLocal = null;
      if ((info.kind === "text" || info.kind === "script") && info.textContent) {
        textLocal = analyzeWithHeuristic(info.textContent, lang);
        const local = textLocal;
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
      // Audit 8: file results are saved to history like every other
      // check (file NAME only — never the file content). The stored
      // verdict is the tool's own verdict (see fileVerdictFor).
      // Audit 9: computed BEFORE the render so the panel score and
      // the stored score are the same number by construction. Text
      // files already show their score in the content box below, so
      // the extra line is only added for non-text files.
      const fv = fileVerdictFor(info, textLocal, lang);
      const scoreLine = textLocal
        ? ""
        : `<p class="panel-score">${escapeHtml(t("panelScore", lang, { n: fv.riskScore }))}</p>`;
      box.innerHTML = `<p class="file-verdict file-verdict-${fv.status === "scam" ? "high" : fv.status === "suspicious" ? "medium" : "low"}"><strong>${escapeHtml(t(info.kind === "url" ? "fileVerdictUrl" : info.kind === "unknown" ? "fileVerdictUnknown" : fv.status === "scam" ? "fileVerdictHigh" : fv.status === "suspicious" ? "fileVerdictMedium" : "fileVerdictLow", lang))}</strong></p>
        ${scoreLine}
        <div class="file-item file-${info.level}"><span class="file-name">${escapeHtml(info.fileName)}</span> — ${escapeHtml(t(info.reasonKey, lang))}</div>
        <p class="muted">${escapeHtml(t("fileCheckType", lang))}: ${escapeHtml(fileTypeDisplay(info))}${info.sha256 ? ` · ${escapeHtml(t("fileFingerprintLabel", lang))} <code>${escapeHtml(info.sha256.slice(0, 16))}…</code>` : ""}</p>
        ${countLine}
        ${textScoreLine}
        <div class="actions"><button id="filecheck-report-btn" type="button" class="secondary">${escapeHtml(t("reportBtn", lang))}</button></div>
        <p class="hint">${escapeHtml(t("fileCheckNote", lang))}</p>`;
      box.hidden = false;
      box.scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "nearest" });
      const aiBtn = $("filecheck-ai-btn");
      if (aiBtn && info.textContent) {
        aiBtn.addEventListener("click", () => {
          $("message-input").value = info.textContent;
          document.querySelector(".checker").scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "start" });
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
      // Audit 8: file results are saved to history like every other
      // check (file NAME only — never the file content). fv was
      // computed before the render (audit 9), so the saved score is
      // the same number the panel shows.
      const elapsedSec = (performance.now() - t0) / 1000;
      await saveCheck({
        message: info.fileName,
        kind: "file",
        ...fv,
        source: "LOCAL",
        elapsedSec,
      });
      renderHistory(await loadHistory());
      // Audit 12 (5): a fresh file/link check also updates the main
      // verdict card, like every other tool and like a history
      // restore — before this the card kept the previous check's
      // verdict while the panel showed the new one. Same verdict
      // object as the save (no re-save, no extra count). lastCheck
      // is cleared like a restore, so a later language change only
      // re-labels this card instead of re-running an older check.
      lastCheck = null;
      lastCheckedEmail = null;
      snapshotPanel("file", info.fileName);
      renderResult({ ...fv, source: "LOCAL" }, info.fileName, elapsedSec);
      enrichResult(info.fileName);
    } catch (err) {
      console.error(err);
      showCheckError(box, err);
    } finally {
      btn.disabled = false;
    }
  });
  // Check by file NAME only (no upload): extension + naming patterns
  // (double extension, .apk). A name alone never proves a file safe
  // — the result says so. The name hash is looked up in community
  // reports when cloud history is on (same gate as the file upload).
  $("filecheck-name-btn").addEventListener("click", async () => {
    const name = $("filecheck-name-input").value.trim();
    const errEl = $("filecheck-name-error");
    const box = $("filecheck-result");
    errEl.hidden = true;
    if (!name) {
      errEl.textContent = t("fileNameEmpty", lang);
      errEl.hidden = false;
      $("filecheck-name-input").focus();
      return;
    }
    const info = analyzeFileName(name);
    const t0 = performance.now();
    // Qwen (audit 8): disable while the community lookup + save run
    // — the upload and link handlers already do this; without it a
    // double-click saves the check twice AND bumps the totals twice,
    // and the totals ratchet can never correct itself.
    const nameBtn = $("filecheck-name-btn");
    nameBtn.disabled = true;
    try {
    let countLine = "";
    // Community lookup always runs (21 Nov, Myuden): the hash is
    // suspect data, not the user's — see callcheck.js header.
    const n = await getReportCount(await reportHash("filename", name));
    if (n != null && n > 0) {
      countLine = `<p>${escapeHtml(t("reportCount", lang, { n }))}</p>`;
    } else if (n === 0) {
      countLine = `<p class="muted">${escapeHtml(t("reportNone", lang))}</p>`;
    } else if (n == null) {
      countLine = `<p class="muted">${escapeHtml(t("reportCountFailed", lang))}</p>`;
    }
    // Audit 9: the panel shows the SAME numeric score that is
    // saved to history — the auditor found the file/link panels
    // had no numeric score of their own. Computed before the
    // render so the panel and the stored verdict can never differ.
    const fv = fileVerdictFor(info, null, lang);
    box.innerHTML = `<p class="file-verdict file-verdict-${fv.status === "scam" ? "high" : fv.status === "suspicious" ? "medium" : "low"}"><strong>${escapeHtml(t(info.kind === "url" ? "fileVerdictUrl" : info.kind === "unknown" ? "fileVerdictUnknown" : fv.status === "scam" ? "fileVerdictHigh" : fv.status === "suspicious" ? "fileVerdictMedium" : "fileVerdictLow", lang))}</strong></p>
      <p class="panel-score">${escapeHtml(t("panelScore", lang, { n: fv.riskScore }))}</p>
      <div class="file-item file-${info.level}"><span class="file-name">${escapeHtml(info.fileName)}</span> — ${escapeHtml(t(info.reasonKey, lang))}</div>
      <p class="muted">${escapeHtml(t("fileCheckType", lang))}: ${escapeHtml(fileTypeDisplay(info))}</p>
      ${countLine}
      <p class="hint">${escapeHtml(t("fileCheckNote", lang))}</p>`;
    box.hidden = false;
    box.scrollIntoView({ behavior: SCROLL_BEHAVIOR, block: "nearest" });
    // Audit 8: a file-name check is saved to history like the upload.
    const elapsedSec = (performance.now() - t0) / 1000;
    await saveCheck({
      message: name,
      kind: "file",
      ...fv,
      source: "LOCAL",
      elapsedSec,
    });
    renderHistory(await loadHistory());
    // Audit 12 (5): fresh file/link checks also update the main
    // verdict card (see the upload handler above for why).
    lastCheck = null;
    lastCheckedEmail = null;
    snapshotPanel("file", name);
    renderResult({ ...fv, source: "LOCAL" }, name, elapsedSec);
    enrichResult(name);
    } finally {
      nameBtn.disabled = false;
    }
  });
  // --- QR check (23 Nov 2026) ---
  // Upload: the image is read on the device and the QR is decoded
  // locally (the image never leaves the device); the payload is
  // classified (QRIS / URL / plain text) and rendered.
  $("qrcheck-input").addEventListener("change", async (e) => {
    const file = (e.target.files && e.target.files[0]) || null;
    const box = $("qrcheck-result");
    const err = $("qrcheck-error");
    const nameEl = $("qrcheck-name");
    err.hidden = true;
    err.textContent = "";
    box.innerHTML = "";
    box.hidden = true;
    if (!file) {
      nameEl.hidden = true;
      nameEl.textContent = "";
      return;
    }
    nameEl.textContent = `${file.name} — ${formatSize(file.size)}`;
    nameEl.hidden = false;
    box.innerHTML = `<p class="progress">${escapeHtml(t("qrWorking", lang))}</p>`;
    box.hidden = false;
    try {
      const image = await loadImageFromFile(file);
      const decoded = await decodeQrFromImage(image);
      if (!decoded) {
        box.innerHTML = "";
        box.hidden = true;
        err.textContent = t("qrNoQr", lang);
        err.hidden = false;
        return;
      }
      renderQrResult(decoded);
    } catch {
      box.innerHTML = "";
      box.hidden = true;
      err.textContent = t("qrNoQr", lang);
      err.hidden = false;
    }
  });
  // Camera: getUserMedia + a ~4fps scan loop on a downscaled canvas
  // frame. The stream stops when a code is found, the Stop button is
  // pressed, or the tab is switched (see stopQrCamera in
  // switchModuleTab) — it must never keep running in the background.
  $("qrcheck-camera-btn").addEventListener("click", async () => {
    const err = $("qrcheck-error");
    const camBox = $("qrcheck-camera");
    const video = $("qrcheck-video");
    err.hidden = true;
    err.textContent = "";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      err.textContent = t("qrCameraDenied", lang);
      err.hidden = false;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      qrCameraStream = stream;
      video.srcObject = stream;
      await video.play();
      camBox.hidden = false;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      let scanning = false;
      qrCameraTimer = setInterval(async () => {
        if (scanning || !video.videoWidth || !video.videoHeight) return;
        scanning = true;
        try {
          // Downscale to at most 640px on the long side: jsQR is
          // far faster on small frames and still decodes well.
          const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = await decodeQrFromImageData(imageData);
          if (decoded) {
            stopQrCamera();
            renderQrResult(decoded);
          }
        } catch {
          // A single bad frame must not kill the loop.
        } finally {
          scanning = false;
        }
      }, 250);
    } catch {
      err.textContent = t("qrCameraDenied", lang);
      err.hidden = false;
    }
  });
  $("qrcheck-camera-stop").addEventListener("click", stopQrCamera);
  // Standalone link tracker: follow shorteners + RDAP lookup for ONE
  // link the user pastes. Explicit per-link consent: clicking the
  // button IS the consent to contact the shortener + rdap.org for
  // that link, so this runs even in local-only mode — and so does the
  // automatic enrichment inside result cards now (21 Nov: suspect
  // data is always looked up; see enrichResult).
  $("linktrack-btn").addEventListener("click", async () => {
    const rawInput = $("linktrack-input").value.trim();
    const box = $("linktrack-result");
    const err = $("linktrack-error");
    err.hidden = true;
    err.textContent = "";
    // Audit 10: a bare domain ("example.com") is a link too — it is
    // normalized to https:// instead of being rejected. The stored
    // message is the NORMALIZED url, so restoring the entry re-runs
    // cleanly instead of hitting the same rejection.
    const input = normalizeLinkInput(rawInput);
    if (!input) {
      err.textContent = t(rawInput ? "linktrackInvalid" : "linktrackEmpty", lang);
      err.hidden = false;
      return;
    }
    // Audit 12 (5): the field now shows the normalized URL that was
    // actually checked — the same value the card answers and history
    // stores (like a restore fills the field), so the main card's
    // stale guard can tell the verdict still matches its input.
    $("linktrack-input").value = input;
    const t0 = performance.now();
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
      // Audit 6 (CoArena review): the "shortener's domain" label below
      // must only appear for an ACTUAL shortener — an ordinary link
      // that merely fails to fetch (CORS, site down) is not a
      // shortener, and its RDAP data is its own, not a shortener's.
      const isShortener = analyzeLink(input).reasons.includes("linkRiskShortener");
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
      // Re-score the real destination with the same on-device rules
      // (21 Nov, Myuden: bit.ly must be judged by where it lands).
      // When the redirect could not be followed, say plainly why —
      // the shortener blocks browser tracking (CORS), so the
      // destination stays hidden and the link stays high risk.
      // The verdict is about the DESTINATION when it was reached,
      // else about the entered URL itself.
      const judged = resolved && finalUrl !== input ? analyzeLink(finalUrl) : analyzeLink(input);
      let finalRiskLine = "";
      if (resolved && finalUrl !== input) {
        const finalRisk = judged;
        const finalRiskLabel =
          finalRisk.level === "high"
            ? t("linkRiskHigh", lang)
            : finalRisk.level === "low"
              ? t("linkRiskLow", lang)
              : t("linkRiskSafe", lang);
        const finalReasons =
          finalRisk.reasons.length > 0
            ? `<ul class="link-reasons">${finalRisk.reasons.map((r) => `<li>${escapeHtml(t(r, lang))}</li>`).join("")}</ul>`
            : "";
        finalRiskLine = `<p><span class="link-risk">${escapeHtml(finalRiskLabel)}</span></p>${finalReasons}`;
      } else if (!resolved) {
        // Audit 7: the "shortener blocks tracking" note is only true
        // for an actual shortener — an ordinary link that merely
        // fails to load gets the honest fetch-failed wording instead.
        finalRiskLine = `<p class="muted">${escapeHtml(t(isShortener ? "linkUnresolvedNote" : "linkUnresolvedNoteFetch", lang))}</p>`;
      }
      // Audit 9: the panel shows the SAME numeric score that is
      // saved to history — the auditor found the link panel had no
      // numeric score of its own. Computed before the render so the
      // panel and the stored verdict can never differ.
      const linkLevel = judged.level;
      const linkUnresolved = !resolved;
      const linkScore = linkUnresolved ? 40 : linkLevel === "high" ? 85 : linkLevel === "low" ? 40 : 0;
      box.innerHTML = `<div class="links-box">
        <p><span class="numbers-label">${escapeHtml(t(resolved ? "linktrackFinal" : "linktrackFinalUnresolved", lang))}:</span> <span class="links-url">${escapeHtml(maskSensitive(stripUrlQuery(finalUrl)))}</span></p>
        ${finalRiskLine}
        <p class="panel-score">${escapeHtml(t("panelScore", lang, { n: linkScore }))}</p>
        ${rdap}
        ${!resolved && isShortener && info && !info.error ? `<p class="muted">${escapeHtml(t("linktrackShortenerData", lang, { d: host }))}</p>` : ""}
        <p class="links-warn">${escapeHtml(t("linksWarn", lang))}</p>
      </div>`;
      // Audit 8: link results are saved to history like every other
      // check. When the destination could not be confirmed the
      // summary says so honestly instead of claiming a verdict
      // about a page never seen.
      // Groq + Qwen (audit 8): an UNRESOLVED link must never be
      // stored as 85 Scam — the destination was never seen. Whatever
      // the entered URL looks like, "could not confirm" is
      // suspicious (40) with the honest note as its flag; the
      // resolved case is unchanged. linkLevel / linkUnresolved /
      // linkScore were computed before the render (audit 9).
      const linkStatus = linkUnresolved
        ? "suspicious"
        : linkLevel === "high"
          ? "scam"
          : linkLevel === "low"
            ? "suspicious"
            : "safe";
      const linkVerdict = {
        status: linkStatus,
        riskScore: linkScore,
        redFlags: linkUnresolved
          ? [t(isShortener ? "linkUnresolvedNote" : "linkUnresolvedNoteFetch", lang)]
          : linkLevel === "safe"
            ? []
            : [t(linkLevel === "high" ? "linkRiskHigh" : "linkRiskLow", lang)],
        checks: [
          {
            id: "linkRisk",
            flag: "Link risk assessment",
            found: linkStatus !== "safe",
            evidence: input,
          },
        ],
        summary: linkUnresolved
          ? t(isShortener ? "linkUnresolvedNote" : "linkUnresolvedNoteFetch", lang)
          : judged.reasons.length > 0
            ? judged.reasons.map((r) => t(r, lang)).join("; ")
            : t(linkLevel === "high" ? "linkRiskHigh" : linkLevel === "low" ? "linkRiskLow" : "linkRiskSafe", lang),
      };
      const elapsedSec = (performance.now() - t0) / 1000;
      await saveCheck({
        message: input,
        kind: "link",
        // Audit 11 (review): the restore panel must know WHICH url
        // the score belongs to — the entered url, or the resolved
        // destination. Stored locally only (the cloud doc keeps its
        // fixed 7 fields); entries without these fields fall back to
        // the "link entered" label on restore.
        finalUrl,
        resolved,
        ...linkVerdict,
        source: "LOCAL",
        elapsedSec,
      });
      renderHistory(await loadHistory());
      // Audit 12 (5): a fresh link check also updates the main
      // verdict card (see the file upload handler for why).
      lastCheck = null;
      lastCheckedEmail = null;
      snapshotPanel("link", input);
      renderResult({ ...linkVerdict, source: "LOCAL" }, input, elapsedSec);
      enrichResult(input);
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
        // Audit 13: say honestly which format was detected, so the
        // user knows what was actually parsed (WhatsApp / Telegram /
        // Messenger / plain lines) — and that a "plain lines" scan
        // has no sender names attached.
        const formatNames = {
          whatsapp: "WhatsApp",
          "telegram-json": "Telegram (JSON)",
          "messenger-json": "Messenger (JSON)",
          "telegram-html": "Telegram (HTML)",
          plain: t("chatlogFormatPlain", lang),
        };
        const formatName = formatNames[res.format] || "";
        const head = `<p><strong>${res.total} ${escapeHtml(t("chatlogResult", lang))}</strong> — ${res.risky.length} ${escapeHtml(t("chatlogRisky", lang))}${res.truncated ? " (…)" : ""}</p>${formatName ? `<p class="muted">${escapeHtml(t("chatlogFormat", lang, { name: formatName }))}</p>` : ""}`;
        const list =
          res.risky.length > 0
            ? `<ul>${res.risky
                .slice(0, 50)
                .map(
                  (r) =>
                    `<li><strong>${escapeHtml(r.sender)}</strong> (${r.score}/100): ${escapeHtml(maskSensitive(r.text.slice(0, 140)))}${r.text.length > 140 ? "…" : ""}<br/><span class="muted">${r.flags.map(escapeHtml).join("; ")}</span></li>`,
                )
                .join("")}</ul>`
            : `<p class="muted">${escapeHtml(t("chatlogNone", lang))}</p>`;
        box.innerHTML = head + list;
      }
      box.hidden = false;
    } catch (err) {
      console.error(err);
      showCheckError(box, err);
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
  // Update watch (21 Nov, bug tema "Sistem"): a tab left open keeps
  // running its old bundle — the worker cannot reload the page, and
  // returning to the tab is not a navigation, so the browser may not
  // check for an update on its own. When a newer worker takes control,
  // announce it (showUpdateToast); also check when the tab becomes
  // visible again (throttled to once a minute). First install never
  // announces: the page already runs the current bundle then
  // (hadController is false).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => {
          const hadController = !!navigator.serviceWorker.controller;
          navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (hadController) {
              pendingUpdate = true;
              showUpdateToast();
            }
          });
          let lastUpdateCheck = 0;
          document.addEventListener("visibilitychange", () => {
            if (document.hidden) return;
            const now = Date.now();
            if (now - lastUpdateCheck < 60000) return;
            lastUpdateCheck = now;
            registration.update().catch(() => {});
          });
        })
        .catch(() => {});
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
  applyTextSize();

  // Offline / airplane-mode indicator (live).
  setOnlineState();
  window.addEventListener("online", setOnlineState);
  window.addEventListener("offline", setOnlineState);

  // History on load (graceful: localStorage when Firestore is absent).
  // Audit 8: seed the aggregate totals from the LOADED (merged) list
  // first — in cloud mode the list includes cloud entries the local
  // seed would miss, so the hero must not claim 0 while the list
  // shows them.
  loadHistory()
    .then((h) => {
      seedTotalsFromList(h);
      renderHistory(h);
    })
    .catch(() => renderHistory([]));

  // Cross-tab live stats (21 Nov audit 5): a check in ANOTHER tab
  // writes the same localStorage key — without this listener the
  // stats + 7-day chart in this tab stay frozen at their old values
  // until a reload, which is exactly what "the counter looks static"
  // looked like. The storage event only fires in tabs OTHER than the
  // one that wrote, so there is no self-trigger loop; a re-render
  // here only refreshes the stats/history view, never a check in
  // flight in this tab (that flow re-renders after its own save).
  window.addEventListener("storage", (e) => {
    if (e.key === "pesanaman_history_v1") {
      loadHistory()
        .then((h) => {
          seedTotalsFromList(h);
          renderHistory(h);
        })
        .catch(() => {});
    }
  });
}

init();
