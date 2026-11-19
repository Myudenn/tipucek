// PesanAman — UI wiring (single page).

import "./styles.css";
import { analyzeMessage, isFirebaseConfigured } from "./ai.js";
import { saveCheck, loadHistory, clearLocalHistory } from "./history.js";

const $ = (id) => document.getElementById(id);

export const SAMPLES = [
  {
    label: "Scam example",
    text: "SELAMAT! Anda memenangkan hadiah Rp 50.000.000 dari undian Telkomsel. Segera klik link ini http://bit.ly/hadiah-telkomsel-2026 dan bayar biaya admin Rp 150.000 untuk klaim hadiah Anda sebelum 24 jam. Hubungi customer service kami segera!",
    note: "Clear scam: fake prize, shortened link, fee to claim, urgency.",
  },
  {
    label: "Suspicious example",
    text: "Hi, this is DHL courier. Your package is held at customs and needs a small clearance fee. Please verify your details here: https://dhl-track-parcel-verify.xyz/update — thanks.",
    note: "Suspicious: courier impersonation + odd tracking domain.",
  },
  {
    label: "Safe example",
    text: "Hi Budi, this is Sari from the office. The team meeting is moved to Thursday 10:00 in room 3B. Please bring the Q3 report. See you there!",
    note: "Safe: ordinary work message, no links, no demands.",
  },
];

const STATUS_LABEL = { safe: "Safe", suspicious: "Suspicious", scam: "Scam" };

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sourceBadge(source) {
  if (source === "ON_DEVICE") {
    return `<span class="badge badge-device">ON_DEVICE — answered on this device, private</span>`;
  }
  if (source === "IN_CLOUD") {
    return `<span class="badge badge-cloud">IN_CLOUD — answered in the cloud</span>`;
  }
  if (source === "DEMO") {
    return `<span class="badge badge-demo">DEMO — local heuristic, not AI</span>`;
  }
  return `<span class="badge badge-unknown">Unknown — inference source not reported</span>`;
}

function renderResult(verdict, message) {
  const el = $("result");
  const flags =
    verdict.redFlags.length > 0
      ? `<ul class="flags">${verdict.redFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
      : `<p class="no-flags">No red flags found.</p>`;
  el.innerHTML = `
    <article class="result-card status-${verdict.status}">
      <div class="result-head">
        <div>
          <p class="result-eyebrow">Verdict</p>
          <h2 class="result-status">${STATUS_LABEL[verdict.status]}</h2>
          <p class="result-score">Risk score: <strong>${verdict.riskScore} / 100</strong></p>
          <div class="score-bar"><div class="score-fill" style="width:${verdict.riskScore}%"></div></div>
        </div>
        <div class="result-badge">${sourceBadge(verdict.source)}</div>
      </div>
      <p class="result-summary">${escapeHtml(verdict.summary)}</p>
      <h3>Red flags</h3>
      ${flags}
      <details class="checked-message">
        <summary>Checked message</summary>
        <p>${escapeHtml(message)}</p>
      </details>
    </article>`;
  el.hidden = false;
}

function renderHistory(entries) {
  const list = $("history-list");
  const empty = $("history-empty");
  if (!entries || entries.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  list.innerHTML = entries
    .map((e) => {
      const when = e.createdAt ? new Date(e.createdAt).toLocaleString() : "";
      return `<li class="history-item status-${escapeHtml(e.status || "safe")}">
        <span class="history-status">${STATUS_LABEL[e.status] || e.status}</span>
        <span class="history-score">${Number(e.riskScore ?? 0)}/100</span>
        <span class="history-source">${escapeHtml(e.source || "")}</span>
        <span class="history-text">${escapeHtml((e.message || "").slice(0, 90))}${(e.message || "").length > 90 ? "…" : ""}</span>
        <time>${escapeHtml(when)}</time>
      </li>`;
    })
    .join("");
}

function setOnlineState() {
  const online = navigator.onLine;
  const pill = $("net-status");
  pill.textContent = online ? "Online" : "Offline — airplane mode";
  pill.classList.toggle("offline", !online);
  pill.classList.toggle("online", online);
  $("offline-note").hidden = online;
}

async function onCheck() {
  const message = $("message-input").value.trim();
  const errorEl = $("error");
  errorEl.hidden = true;
  errorEl.textContent = "";
  if (!message) {
    errorEl.textContent = "Please paste a message first.";
    errorEl.hidden = false;
    $("message-input").focus();
    return;
  }
  const btn = $("check-btn");
  const progressEl = $("progress");
  btn.disabled = true;
  btn.textContent = "Checking…";
  progressEl.hidden = false;
  progressEl.textContent = isFirebaseConfigured()
    ? "Preparing the on-device model…"
    : "Checking with the local demo analyzer…";
  try {
    const verdict = await analyzeMessage(message, ({ stage, progress }) => {
      if (stage === "downloading-model") {
        progressEl.textContent = `Downloading on-device model… ${Math.round((progress || 0) * 100)}%`;
      }
    });
    renderResult(verdict, message);
    const where = await saveCheck({ message, ...verdict });
    $("storage-note").textContent =
      where === "firestore"
        ? "Saved to Firestore (anonymous account)."
        : "Saved locally in this browser (Firestore not configured).";
    renderHistory(await loadHistory());
  } catch (err) {
    console.error(err);
    errorEl.textContent = `Check failed: ${err?.message || err}. ${navigator.onLine ? "Please try again." : "You are offline — on-device inference needs the model downloaded first."}`;
    errorEl.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Check message";
    progressEl.hidden = true;
  }
}

function init() {
  // Demo-mode banner: visible, honest, always in the UI while unconfigured.
  const demo = !isFirebaseConfigured();
  $("demo-banner").hidden = !demo;
  $("mode-label").textContent = demo
    ? "Demo mode — connect Firebase to enable AI"
    : "AI mode — Firebase AI Logic (hybrid inference)";

  // Sample buttons (one click fills the textarea).
  const samplesEl = $("samples");
  SAMPLES.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sample-btn";
    b.textContent = s.label;
    b.title = s.note;
    b.addEventListener("click", () => {
      $("message-input").value = s.text;
      $("message-input").focus();
    });
    samplesEl.appendChild(b);
  });

  $("check-btn").addEventListener("click", onCheck);
  $("clear-history-btn").addEventListener("click", async () => {
    clearLocalHistory();
    renderHistory(await loadHistory());
  });

  // Offline / airplane-mode indicator (live).
  setOnlineState();
  window.addEventListener("online", setOnlineState);
  window.addEventListener("offline", setOnlineState);

  // History on load (graceful: localStorage when Firestore is absent).
  loadHistory().then(renderHistory).catch(() => renderHistory([]));
}

init();
