// TipuCek — Aman, the virtual AI assistant (avatar + chat).
//
// Aman is a simple shield-and-star robot (blue #1a56db → purple #6d28d9,
// matching the site's own gradient): a round photo in the chat card.
// He moves with CSS only — floating and waving on greeting. There is
// no voice output: Aman answers in text only (the voice feature was
// removed 19 Nov 2026 — it never sounded on the user's phone).
// Chat answers come from the same cloud model as the checker
// (askAssistant in ai.js); in Demo mode (no Firebase config) Aman
// says so honestly instead of pretending to be AI.

import { askAssistant, isFirebaseConfigured } from "./ai.js";
import { t } from "./i18n.js";

let getLang = () => "en";
let onCheckText = null;
let history = []; // { role: "user" | "aman", text }

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
  if (log) log.scrollTop = log.scrollHeight;
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
  scrollLogToBottom();
  return bubble;
}

async function send(question) {
  const lang = getLang();
  const text = (question || "").trim();
  if (!text) return;
  addMessage("user", text);
  history.push({ role: "user", text });
  const input = $("assistant-input");
  if (input) input.value = "";

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
      const res = await askAssistant(text, lang, history);
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
    addMessage("aman", msg);
    history.push({ role: "aman", text: msg });
  }
}

function buildChips() {
  const chipsEl = $("assistant-chips");
  if (!chipsEl) return;
  chipsEl.innerHTML = "";
  ["chipOtp", "chipLink", "chipPrize"].forEach((key) => {
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
  const input = $("assistant-input");
  if (input) input.placeholder = t("assistantPlaceholder", lang);
  const sendBtn = $("assistant-send");
  if (sendBtn) sendBtn.textContent = t("assistantSend", lang);
  const note = $("assistant-note");
  if (note) note.textContent = t("assistantNote", lang);
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

  // Lifelike motion starts with the greeting: one wave, then the
  // float animation takes over.
  setTimeout(waveAvatar, 700);
}
