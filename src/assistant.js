// TipuCek — Aman, the virtual AI assistant (avatar + chat panel).
//
// Aman's face is the F logo (Myuden 20 Nov 20:25): a white robot head
// inside a gradient circle (blue #1a56db → purple #6d28d9, the site's
// own gradient) — a round photo in the chat panel and on the launcher.
// He moves with CSS only — floating and waving on greeting. There is
// no voice output: Aman answers in text only (the voice feature was
// removed 19 Nov 2026 — it never sounded on the user's phone).
// Chat answers come from the same cloud model as the checker
// (askAssistant in ai.js, with the same primary → backup failover);
// in Demo mode (no Firebase config) Aman says so honestly instead
// of pretending to be AI.
//
// Panel (20 Nov 2026): Aman lives in a floating panel anchored to the
// bottom-right corner, opened ONLY by the round avatar launcher (the
// "Tanya Aman" module tab was removed 20 Nov 2026 — Myuden: the
// launcher is the only door). The old in-page assistant section was
// replaced by this panel so there is only one Aman UI. Answers follow
// the QUESTION's language (detected, with the site language as the
// fallback) — the site language alone is not enough when the user
// pastes a message in another language.

import { askAssistant, isFirebaseConfigured } from "./ai.js";
import { t } from "./i18n.js";

let getLang = () => "en";
let onCheckText = null;
let history = []; // { role: "user" | "aman", text }
let lastQuestion = "";
let hasWaved = false;

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setAvatarState(state) {
  // state: "" (idle) | "thinking" — on the chat-card avatar.
  // There is no "speaking" state: Aman never talks out loud.
  const el = $("aman-avatar");
  if (!el) return;
  el.classList.toggle("thinking", state === "thinking");
}

function waveEl(el) {
  if (!el) return;
  el.classList.remove("waving");
  void el.offsetWidth; // restart the animation
  el.classList.add("waving");
  el.addEventListener(
    "animationend",
    () => el.classList.remove("waving"),
    { once: true },
  );
}

function waveAvatar() {
  // One friendly wave on greeting: the whole character rocks side to
  // side, which reads as the peace-sign hand waving.
  waveEl($("aman-avatar"));
}

function scrollLogToBottom() {
  const log = $("assistant-log");
  if (!log) return;
  // Pin the newest message into view. A plain scrollTop = scrollHeight
  // is not enough on its own: the log used to sit at its 120px
  // min-height (the panel has no definite height, so flex-grow had no
  // free space to distribute), and a 3-sentence reply is taller than
  // that — bottom-pinning then hid the reply's TOP. So: when the newest
  // bubble is taller than the visible log, pin its TOP to the top of
  // the log (scrollIntoView, block start) so the reply reads from the
  // start; otherwise pin the log to its bottom. Run once now and once
  // on the next frame, so the measurement uses the laid-out bubble
  // (height, wrapping, button) rather than the pre-layout size.
  const apply = () => {
    const last = log.lastElementChild;
    if (!last) return;
    if (last.offsetHeight >= log.clientHeight) {
      last.scrollIntoView({ block: "start" });
    } else {
      log.scrollTop = log.scrollHeight;
    }
  };
  apply();
  requestAnimationFrame(apply);
}

// --- Question-language detection --------------------------------------
// Answers follow the QUESTION's language, not just the site language:
// a pasted Indonesian scam message on an English site gets an
// Indonesian answer (Myuden 20 Nov 20:14). Detection is a small
// stopword scorer (pure — unit-tested): script first (Japanese kana
// → ja, CJK ideographs without kana → zh), then distinctive function
// words for the six Latin-script locales. Returns the detected
// language code or null when nothing is confident enough — the caller
// then falls back to the site language. A single distinctive word is
// enough when nothing else scores (short questions like "Apa itu
// OTP?" or "What is OTP fraud?"); a tie is not confident.
const QUESTION_STOPWORDS = {
  id: [
    "yang", "dan", "apa", "bagaimana", "saya", "adalah", "tidak", "bisa",
    "untuk", "dengan", "apakah", "jangan", "kalau", "atau", "juga",
    "akan", "sudah", "mengapa", "kapan", "siapa", "mana", "berapa",
    "tolong", "anda", "ini", "itu",
  ],
  en: [
    "the", "is", "are", "what", "how", "why", "when", "where", "which",
    "should", "would", "could", "your", "you", "have", "has", "there",
    "their", "this", "that", "about",
  ],
  es: [
    "qué", "cómo", "este", "esta", "estos", "estas", "por", "favor",
    "porque", "cuándo", "dónde", "cuál", "tienes", "puedo", "para",
    "con",
  ],
  fr: [
    "comment", "pourquoi", "vous", "est-ce", "avec", "pour", "quand",
    "quel", "quelle", "puis-je",
  ],
  de: [
    "wie", "was", "warum", "bitte", "ich", "ein", "eine", "nicht",
    "kann", "wann", "welche", "welcher", "haben",
  ],
  pt: [
    "como", "por", "você", "não", "uma", "um", "para", "com", "está",
    "são", "quando", "qual", "posso", "porque",
  ],
};

export function detectQuestionLanguage(text) {
  const s = String(text || "");
  if (!s.trim()) return null;
  // Script first: kana is unmistakably Japanese; CJK ideographs
  // without kana read as Chinese here (the site has no other CJK
  // locale). Korean hangul is not a supported locale — fall through
  // to the stopword scorer, which will not match, so null.
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(s)) return "ja";
  if (/[\u4E00-\u9FFF]/.test(s)) return "zh";
  const lower = ` ${s.toLowerCase()} `;
  let best = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const [lang, words] of Object.entries(QUESTION_STOPWORDS)) {
    let score = 0;
    for (const w of words) {
      // Word-boundary match, case-insensitive (already lowercased).
      // Escape the word for RegExp; "est-ce" keeps its hyphen.
      const re = new RegExp(`[^\\p{L}]${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\p{L}]`, "u");
      if (re.test(lower)) score += 1;
    }
    if (score > bestScore) {
      secondScore = bestScore;
      bestScore = score;
      best = lang;
    } else if (score > secondScore) {
      secondScore = score;
    }
  }
  // Confident only when something matched and it beats every other
  // language outright; a tie falls back to the site language.
  return bestScore >= 1 && bestScore > secondScore ? best : null;
}

// --- Panel open / close ------------------------------------------------
// The panel is the #assistant section, restyled as a fixed overlay.
// Open: show it, mark the launcher expanded, focus the question box,
// wave once as the greeting. Close: hide it, clear the body class
// (which also moves the completion toast out of the panel's way).
// Focus is NOT moved here — the caller (× button / Escape) returns
// focus to the launcher, while a module-tab switch keeps focus where
// the user already is.
export function isAmanPanelOpen() {
  const panel = $("assistant");
  return !!panel && !panel.hidden;
}

export function openAmanPanel() {
  const panel = $("assistant");
  if (!panel) return;
  panel.hidden = false;
  document.body.classList.add("aman-panel-open");
  const fab = $("aman-fab");
  if (fab) fab.setAttribute("aria-expanded", "true");
  const input = $("assistant-input");
  if (input) input.focus({ preventScroll: true });
  if (!hasWaved) {
    hasWaved = true;
    waveAvatar();
  }
}

export function closeAmanPanel() {
  const panel = $("assistant");
  if (!panel) return;
  panel.hidden = true;
  document.body.classList.remove("aman-panel-open");
  const fab = $("aman-fab");
  if (fab) fab.setAttribute("aria-expanded", "false");
}

function addMessage(role, text, { checkText = null } = {}) {
  const log = $("assistant-log");
  if (!log) return null;
  const bubble = document.createElement("div");
  bubble.className = `assistant-msg ${role}`;
  bubble.textContent = text;
  if (role === "aman" && checkText && onCheckText) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "assistant-check-btn";
    btn.textContent = t("assistantCheckThis", getLang());
    btn.addEventListener("click", () => onCheckText(checkText));
    bubble.appendChild(document.createElement("br"));
    bubble.appendChild(btn);
  }
  log.appendChild(bubble);
  // First message in: the center greeting hides (see
  // .aman-panel.has-messages in styles.css) so the log gets its room
  // back — a reply must never stick out below the log's visible edge
  // behind the quick-question chips (live check 21 Nov 01:05).
  document.getElementById("assistant")?.classList.add("has-messages");
  scrollLogToBottom();
  return bubble;
}

async function send(question, { echo = true } = {}) {
  const lang = getLang();
  const text = (question || "").trim();
  if (!text) return;
  lastQuestion = text;
  if (echo) {
    addMessage("user", text);
    history.push({ role: "user", text });
  }
  const input = $("assistant-input");
  if (input && echo) input.value = "";

  // A long user message is usually a pasted suspicious message — Aman
  // answers, and offers a one-tap full check with the real checker.
  const maybePastedMessage = text.length > 60;

  const typing = document.createElement("div");
  typing.className = "assistant-msg aman typing";
  typing.textContent = t("assistantThinking", lang);
  const log = $("assistant-log");
  log.appendChild(typing);
  scrollLogToBottom();
  setAvatarState("thinking");

  try {
    let answer;
    if (!isFirebaseConfigured()) {
      answer = t("assistantDemo", lang);
    } else {
      // Answer in the QUESTION's language when it can be detected;
      // otherwise the site language. A pasted message in another
      // language gets an answer in that language, not the site's.
      // Tell the model whether the text looks like a pasted message
      // to judge (long text) or a general question — the prompt must
      // not force a verdict onto a question with no message in it.
      const answerLang = detectQuestionLanguage(text) || lang;
      const res = await askAssistant(text, answerLang, history, undefined, {
        pastedMessage: maybePastedMessage,
      });
      answer = res.answer;
    }
    typing.remove();
    setAvatarState("");
    addMessage("aman", answer, {
      checkText: maybePastedMessage ? text : null,
    });
    history.push({ role: "aman", text: answer });
  } catch (err) {
    console.error(err);
    typing.remove();
    setAvatarState("");
    const msg = t("assistantError", lang);
    const bubble = addMessage("aman", msg);
    history.push({ role: "aman", text: msg });
    // Retry: re-ask the same question without echoing it again —
    // the user's message is already in the log. Friendly message +
    // a real retry button, never a bare error.
    if (bubble) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "assistant-retry-btn";
      retry.textContent = t("retryBtn", lang);
      retry.addEventListener("click", () => {
        retry.remove();
        send(lastQuestion, { echo: false });
      });
      bubble.appendChild(document.createElement("br"));
      bubble.appendChild(retry);
      scrollLogToBottom();
    }
  }
}

function buildChips() {
  const chipsEl = $("assistant-chips");
  if (!chipsEl) return;
  chipsEl.innerHTML = "";
  ["chipOtp", "chipLink", "chipPrize", "chipReport"].forEach((key) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "assistant-chip";
    b.textContent = t(key, getLang());
    b.addEventListener("click", () => send(b.textContent));
    chipsEl.appendChild(b);
  });
}

/** Re-render everything language-dependent (called on language change). */
export function refreshAssistantLanguage() {
  const lang = getLang();
  const greeting = $("assistant-greeting");
  if (greeting) greeting.textContent = t("assistantGreeting", lang);
  const greetingSub = $("assistant-greeting-sub");
  if (greetingSub) greetingSub.textContent = t("assistantGreetingSub", lang);
  const input = $("assistant-input");
  if (input) input.placeholder = t("assistantPlaceholder", lang);
  const sendBtn = $("assistant-send");
  // Round ↑ button (Arah 3): no visible text, the label lives in
  // aria-label so screen readers still hear "Kirim"/"Send".
  if (sendBtn) sendBtn.setAttribute("aria-label", t("assistantSend", lang));
  const note = $("assistant-note");
  if (note) note.textContent = t("assistantNote", lang);
  const privacy = $("assistant-privacy");
  if (privacy) privacy.textContent = t("assistantPrivacy", lang);
  const closeBtn = $("assistant-close");
  if (closeBtn) closeBtn.setAttribute("aria-label", t("assistantPanelClose", lang));
  buildChips();
}

export function initAssistant({ getLang: langGetter, onCheckText: checkCb }) {
  getLang = langGetter;
  onCheckText = checkCb;

  $("assistant-send").addEventListener("click", () =>
    send($("assistant-input").value),
  );
  $("assistant-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      send($("assistant-input").value);
    }
  });

  refreshAssistantLanguage();
}
