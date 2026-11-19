// TipuCek — Aman, the virtual AI assistant (avatar + chat).
//
// Aman is a simple shield-and-star robot (blue #1a56db → purple #6d28d9,
// matching the site's own gradient): a round photo in the chat card.
// He moves with CSS only — floating, nodding while he talks,
// waving on greeting. The original anime avatar is kept as a backup
// (public/aman-anime.jpg) and is not shown anywhere.
// Speech is cloud TTS first (Firebase AI Logic speaks, so Voice works
// on any device — no TTS engine needed on the phone), with the
// browser's speechSynthesis as fallback. The Voice toggle speaks
// every answer out loud, and each answer has its own "Listen" button.
// Chat answers come from the same cloud model as the checker
// (askAssistant in ai.js); in Demo mode (no Firebase config) Aman
// says so honestly instead of pretending to be AI.

import { askAssistant, isFirebaseConfigured, synthesizeSpeech } from "./ai.js";
import { t } from "./i18n.js";

let getLang = () => "en";
let onCheckText = null;
let history = []; // { role: "user" | "aman", text }
// Voice defaults to ON (first visit): the voice is the point of the
// toggle, and a first-time user should hear it. The choice is saved
// — turning it off once keeps it off. Auto-reading still only happens
// after the user does something (ask Aman / run a check); nothing
// speaks on page load, so the autoplay policy is respected.
const VOICE_STORE_KEY = "tipucek_voice_on";
let voiceOn = true;
try {
  voiceOn = localStorage.getItem(VOICE_STORE_KEY) !== "0";
} catch {
  voiceOn = true;
}

const $ = (id) => document.getElementById(id);

const VOICE_LANG = {
  en: "en-US",
  id: "id-ID",
  es: "es-ES",
  fr: "fr-FR",
  de: "de-DE",
  pt: "pt-BR",
  ja: "ja-JP",
  zh: "zh-CN",
};

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setAvatarState(state) {
  // state: "" (idle) | "thinking" | "speaking" — on the chat-card avatar.
  const el = $("aman-avatar");
  if (!el) return;
  el.classList.toggle("thinking", state === "thinking");
  el.classList.toggle("speaking", state === "speaking");
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

function talkBriefly() {
  // Voice off: Aman still "talks" — nod + ring for a couple of
  // seconds while the answer is fresh (CSS motion only). Voice on:
  // the speaking voice drives the state, so do nothing here.
  if (voiceOn) return;
  setAvatarState("speaking");
  setTimeout(() => {
    if (!window.speechSynthesis?.speaking && !cloudAudio) {
      setAvatarState("");
    }
  }, 2600);
}

// ---- Voice: cloud TTS first, device speechSynthesis as fallback ----
// The cloud voice (Firebase AI Logic, gemini-3.8-flash-tts)
// speaks on any device — the phone needs no TTS engine installed.
// Only when the cloud call fails do we fall back to the device voice
// (speechSynthesis, with the Android-Chrome hardening below). When
// neither works, the note says so honestly instead of pretending
// to speak.
let cloudAudio = null; // { el, url, resolve } — the audio currently playing

function stopCloudAudio() {
  if (!cloudAudio) return;
  const { el, url, resolve } = cloudAudio;
  cloudAudio = null;
  try {
    el.pause();
    el.removeAttribute("src");
    el.load();
  } catch {
    // Already stopped; nothing to do.
  }
  // The blob URL belongs to the stopped audio — revoke it, or every
  // utterance leaks one URL.
  if (url) URL.revokeObjectURL(url);
  resolve();
}

// ---- Audio unlock (mobile autoplay policy) ----
// A cloud TTS round-trip takes seconds, by which time the tap that
// started it is no longer a "user gesture" — so audio.play() can be
// refused (NotAllowedError) even though the audio itself is fine.
// Playing a short silent sound INSIDE the gesture unlocks audio for
// the page; later play() calls then succeed. Called synchronously
// from the voice-toggle click and from speakNow (Listen buttons) —
// never from async callbacks, where there is no gesture to use.
let silentWavUrl = null;
function unlockAudio() {
  try {
    if (!silentWavUrl) {
      // 0.1 s of silence, 8 kHz mono 16-bit WAV, built in code.
      const samples = 800;
      const buf = new ArrayBuffer(44 + samples * 2);
      const v = new DataView(buf);
      const writeStr = (off, s) => {
        for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
      };
      writeStr(0, "RIFF");
      v.setUint32(4, 36 + samples * 2, true);
      writeStr(8, "WAVE");
      writeStr(12, "fmt ");
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, 8000, true);
      v.setUint32(28, 16000, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      writeStr(36, "data");
      v.setUint32(40, samples * 2, true);
      silentWavUrl = URL.createObjectURL(
        new Blob([buf], { type: "audio/wav" }),
      );
    }
    const unlock = new Audio(silentWavUrl);
    unlock.volume = 0;
    const p = unlock.play();
    if (p) p.catch(() => {});
  } catch {
    // Unlock is best-effort; a failure here just means playback may
    // still be refused later, which the fallback handles.
  }
}

async function speakViaCloud(text) {
  // Returns true when the cloud audio played through. Throws on any
  // failure so the caller can fall back to the device voice.
  const { audioUrl, bytes } = await synthesizeSpeech(text, getLang());
  const audio = new Audio(audioUrl);
  let done;
  const donePromise = new Promise((r) => {
    done = r;
  });
  let playFailed = false;
  cloudAudio = { el: audio, url: audioUrl, resolve: done };
  audio.onended = () => {
    if (cloudAudio && cloudAudio.el === audio) cloudAudio = null;
    URL.revokeObjectURL(audioUrl);
    done();
  };
  audio.onerror = () => {
    // Playback failed (bad audio, decode error). NEVER throw here:
    // an exception inside an event handler is uncaught (console
    // error) and done() below would already have told the caller the
    // audio finished. Flag it; the caller throws after play().
    playFailed = true;
    if (cloudAudio && cloudAudio.el === audio) cloudAudio = null;
    URL.revokeObjectURL(audioUrl);
    done();
  };
  voiceFailed = false;
  setAvatarState("speaking");
  await audio.play();
  // Debug hook for verification: last cloud-TTS attempt (ok + bytes).
  // Set only AFTER play() started — recording ok:true before play()
  // lied about failures.
  window.__tipucekLastTts = { ok: true, bytes, at: Date.now() };
  await donePromise;
  setAvatarState("");
  if (playFailed) throw new Error("Cloud audio playback failed.");
  return true;
}

// ---- Device voice (browser speech synthesis, on-device) ----
// Voices load asynchronously: getVoices() is often empty on first
// call, so listen for voiceschanged and pick the best match for the
// UI language (exact locale first, then the language prefix, then
// en-US, then the browser default). Two Android-Chrome traps are
// handled here: (1) speak() right after cancel() in the same task
// often stays silent — wait ~100ms after cancel(); (2) getVoices()
// can stay empty for a while — wait for voiceschanged (max ~2s)
// before deciding there is no voice. When this device really has no
// usable voice, say so honestly in the note instead of pretending
// to speak.
let loadedVoices = [];
let voicesListenerAdded = false;
let voicesChangedFired = false;
let voiceFailed = false; // latched once a speak fails; cleared on onstart

function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  const read = () => {
    loadedVoices = window.speechSynthesis.getVoices() || [];
    refreshVoiceNote();
  };
  read();
  if (!voicesListenerAdded) {
    voicesListenerAdded = true;
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      voicesChangedFired = true;
      read();
    });
  }
}

function waitForVoices(timeoutMs = 2000) {
  // Resolves when the voice list is settled: non-empty already, or
  // the browser has told us the list is final (voiceschanged fired).
  if (!("speechSynthesis" in window)) return Promise.resolve(false);
  if (loadedVoices.length > 0 || voicesChangedFired)
    return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.speechSynthesis.removeEventListener("voiceschanged", onChange);
      resolve(true);
    };
    const onChange = () => {
      voicesChangedFired = true;
      loadedVoices = window.speechSynthesis.getVoices() || [];
      refreshVoiceNote();
      finish();
    };
    window.speechSynthesis.addEventListener("voiceschanged", onChange);
    setTimeout(finish, timeoutMs);
  });
}

function pickVoice(lang) {
  const want = VOICE_LANG[lang] || "en-US";
  const prefix = want.split("-")[0].toLowerCase();
  return (
    loadedVoices.find((v) => v.lang === want) ||
    loadedVoices.find(
      (v) => v.lang && v.lang.toLowerCase().startsWith(prefix),
    ) ||
    loadedVoices.find((v) => v.lang === "en-US") ||
    loadedVoices.find((v) => v.default) ||
    loadedVoices[0] ||
    null
  );
}

/**
 * Split spoken text into short chunks (<= maxLen chars) at sentence
 * boundaries. Chrome's speechSynthesis silently stops long utterances
 * (~15 s in, only the first sentence or two is heard) — short queued
 * chunks are heard to the end. Split only on ". " / "? " / "! " before
 * a capital or digit, so "Rp 50.000.000" and "dr. Budi" are not torn
 * apart; over-long sentences are hard-split on word boundaries.
 */
export function splitSpeechChunks(text, maxLen = 200) {
  const parts = String(text).split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/);
  const chunks = [];
  let cur = "";
  const push = (s) => {
    if (s.trim()) chunks.push(s.trim());
  };
  for (const part of parts) {
    const piece = part.trim();
    if (!piece) continue;
    if (piece.length > maxLen) {
      for (const w of piece.split(/\s+/)) {
        if (cur && cur.length + 1 + w.length > maxLen) {
          push(cur);
          cur = w;
        } else {
          cur = cur ? `${cur} ${w}` : w;
        }
      }
      continue;
    }
    if (cur && cur.length + 1 + piece.length > maxLen) {
      push(cur);
      cur = piece;
    } else {
      cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  push(cur);
  return chunks.length ? chunks : [String(text)];
}

async function speakUtterance(text) {
  // Spoken text is capped: a long assistant answer would make the
  // TTS call slow and the audio minutes long. The full text stays
  // visible on screen; only the spoken part is cut.
  const speakText = String(text || "").slice(0, 1200);
  if (!speakText.trim()) return false;
  // A new utterance stops whatever was speaking (cloud audio and/or
  // the device voice) so two voices never overlap.
  stopCloudAudio();
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  // 1. Cloud TTS first — works on any device, no local TTS engine
  // needed. In Demo mode (no Firebase config) this is skipped.
  if (isFirebaseConfigured()) {
    try {
      await speakViaCloud(speakText);
      return true;
    } catch (e) {
      console.warn(
        "[TipuCek] Cloud voice failed, falling back to device voice:",
        e?.message || e,
      );
      window.__tipucekLastTts = {
        ok: false,
        error: String(e?.message || e),
        at: Date.now(),
      };
      stopCloudAudio();
      setAvatarState("");
    }
  }
  // 2. Device speechSynthesis fallback (hardened, see above).
  if (!("speechSynthesis" in window)) {
    voiceFailed = true;
    refreshVoiceNote();
    return false;
  }
  try {
    window.speechSynthesis.cancel();
    // Chrome Android bug: speak() right after cancel() in the same
    // task often produces no sound — give the engine a beat to reset.
    await new Promise((r) => setTimeout(r, 100));
    await waitForVoices(2000);
    const voice = pickVoice(getLang());
    if (!voice) {
      // No usable voice on this device: say so honestly instead of
      // pretending to speak.
      voiceFailed = true;
      setAvatarState("");
      refreshVoiceNote();
      return false;
    }
    // Speak in short sentence chunks (see splitSpeechChunks): one
    // long utterance is cut off by Chrome after ~15 s, so only the
    // first sentence would ever be heard.
    const chunks = splitSpeechChunks(speakText);
    let finishedOk = false;
    await new Promise((resolve) => {
      let i = 0;
      let done = false;
      let stallTimer = null;
      const clearStall = () => {
        if (stallTimer) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
      };
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearStall();
        setAvatarState("");
        if (!ok) {
          voiceFailed = true;
          refreshVoiceNote();
        }
        finishedOk = ok;
        resolve();
      };
      const armStall = (ms) => {
        clearStall();
        stallTimer = setTimeout(() => finish(false), ms);
      };
      const speakNext = () => {
        if (done) return;
        if (i >= chunks.length) {
          finish(true);
          return;
        }
        const u = new SpeechSynthesisUtterance(chunks[i++]);
        u.lang = VOICE_LANG[getLang()] || "en-US";
        u.voice = voice;
        // First chunk must start within 5 s or the engine is stuck;
        // later chunks get 25 s each (a 200-char chunk takes ~12 s).
        armStall(i === 1 ? 5000 : 25000);
        u.onstart = () => {
          voiceFailed = false;
          setAvatarState("speaking");
          armStall(25000);
        };
        u.onend = () => speakNext();
        u.onerror = () => finish(false);
        window.speechSynthesis.speak(u);
      };
      speakNext();
    });
    return finishedOk;
  } catch {
    voiceFailed = true;
    setAvatarState("");
    refreshVoiceNote();
    return false;
  }
}

function speak(text) {
  // Automatic voice: only when the user turned Voice on.
  if (!voiceOn) return;
  speakUtterance(text);
}

export function speakNow(text) {
  // On-demand voice: the "Listen" button on an answer — works even
  // when the Voice toggle is off. Also used by Senior mode to read a
  // verdict out loud. Unlock audio inside this gesture first, so the
  // cloud audio can actually play when the TTS call returns.
  unlockAudio();
  speakUtterance(text);
}

function refreshVoiceNote() {
  const note = $("assistant-note");
  if (!note) return;
  // Unavailable ONLY when a real speak attempt failed (voiceFailed is
  // latched by speakUtterance and cleared on success). A device with
  // no local voices is NOT unavailable — cloud TTS is the primary
  // voice and works on a phone with no TTS engine at all. (The old
  // code showed "unavailable" whenever the device voice list was
  // empty, which wrongly condemned the cloud voice too.)
  if (voiceFailed) {
    note.textContent = t("voiceUnavailable", getLang());
  } else {
    note.textContent = t("assistantNote", getLang());
  }
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
  if (role === "aman") {
    // "Listen" button: hear this answer out loud, even when the
    // Voice toggle is off.
    const listen = document.createElement("button");
    listen.type = "button";
    listen.className = "assistant-speak-btn";
    listen.textContent = t("speakAnswer", getLang());
    listen.addEventListener("click", () => speakNow(text));
    bubble.appendChild(document.createElement("br"));
    bubble.appendChild(listen);
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
    speak(answer);
    talkBriefly();
  } catch (err) {
    console.error(err);
    typing.remove();
    setAvatarState("");
    const msg = t("assistantError", lang);
    addMessage("aman", msg);
    history.push({ role: "aman", text: msg });
    talkBriefly();
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

function refreshVoiceButton() {
  const btn = $("voice-toggle");
  if (!btn) return;
  btn.textContent = voiceOn
    ? t("voiceOn", getLang())
    : t("voiceOff", getLang());
  btn.setAttribute("aria-pressed", voiceOn ? "true" : "false");
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
  refreshVoiceButton();
  refreshVoiceNote();
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
  $("voice-toggle").addEventListener("click", async () => {
    // Unlock audio inside this tap: the TTS call takes seconds, by
    // which time the gesture is gone and play() can be refused.
    unlockAudio();
    voiceOn = !voiceOn;
    try {
      localStorage.setItem(VOICE_STORE_KEY, voiceOn ? "1" : "0");
    } catch {
      // Private mode / no storage: the toggle still works this session.
    }
    if (!voiceOn) {
      // Turning Voice off: stop both voices (cloud audio + device).
      stopCloudAudio();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      setAvatarState("");
    } else {
      // Turning Voice on: load the device voices (fallback list) and
      // say the greeting out loud right away — cloud TTS first, so
      // the user hears the voice exists even on a phone with no TTS
      // engine. When neither voice can speak, fall back to off and
      // say so honestly instead of a silent "Voice: on".
      loadVoices();
      const ok = await speakUtterance(t("assistantGreeting", getLang()));
      if (!ok) {
        voiceOn = false;
        voiceFailed = true;
      }
    }
    refreshVoiceButton();
    refreshVoiceNote();
  });

  refreshAssistantLanguage();
  loadVoices();

  // Lifelike motion starts with the greeting: one wave, then the
  // float animation takes over.
  setTimeout(waveAvatar, 700);
}
