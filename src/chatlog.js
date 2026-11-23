// TipuCek — chat-export scanner (client-side only).
//
// Parses a chat export and scores every message with the same local
// heuristic the checker uses (analyzeWithHeuristic — no AI, no
// network), listing the risky ones.
//
// Formats (audit 13, "cek pesan apa saja"): WhatsApp .txt (Android +
// iOS), Telegram JSON + HTML exports, Messenger/Facebook JSON
// exports, and plain lines with no timestamps at all (each non-empty
// line is one message). The detected format is returned so the UI
// can say honestly what it parsed.
//
// Limits, stated honestly in the UI: at most 2 MB / 5,000 messages.
// The score is per message, not a verdict on the whole chat — the
// user must read each flagged message themselves.

import { analyzeWithHeuristic } from "./ai.js";
import { t } from "./i18n.js";

export const CHATLOG_MAX_BYTES = 2 * 1024 * 1024;
export const CHATLOG_MAX_MESSAGES = 5000;

// WhatsApp export line starts, both common shapes:
//   12/11/2026, 10:23 - Name: message          (Android)
//   [12/11/2026, 10:23:45] Name: message       (iOS — no dash after ])
// The bracket shape must NOT require a dash: the old regex did, so iOS
// exports parsed to zero messages. Fixed 19 Nov 2026 (unit-tested).
const LINE_RE =
  /^(?:\[\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]+?\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\]\s*|\d{1,2}\/\d{1,2}\/\d{2,4}[,\s]+?\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\s*[-–]\s*)(.*)$/;

// WhatsApp system lines (group events, encryption notice) look like
// messages but have no real sender. They are skipped by content:
// the rest starts with a system phrase (English + Indonesian).
// Best effort — a system line with unusual wording may still slip
// through as a "sender" (audit B8); a name ending in a title
// abbreviation ("Dr: Smith") is also mis-split by the ": " separator
// and is a known limitation of the export format itself.
const SYSTEM_LINE_RE =
  /^(messages are end-to-end encrypted|this chat is with|.*\b(changed|created|added|removed|left|joined|pinned|unpinned|muted|unmuted|archived|disappearing)\b.*\b(the group|group|chat|messages|their phone number|phone number)\b|.*\b(mengubah|membuat|menambahkan|menghapus|keluar|bergabung|menyematkan|mengarsipkan)\b.*\b(grup|chat|pesan|nomor telepon)\b)/i;

/** Parse a WhatsApp .txt export into [{ sender, text }]. */
function parseWhatsApp(rawText) {
  const messages = [];
  let current = null;
  for (const line of String(rawText || "").split(/\r?\n/)) {
    const m = line.match(LINE_RE);
    if (m) {
      if (current) messages.push(current);
      const rest = m[1] || "";
      if (SYSTEM_LINE_RE.test(rest)) {
        // System line, not a message.
        current = null;
        continue;
      }
      const sep = rest.indexOf(": ");
      if (sep <= 0) {
        // No "Name: " — a system line (group created, encryption
        // notice, ...). Skip it.
        current = null;
        continue;
      }
      current = { sender: rest.slice(0, sep), text: rest.slice(sep + 2) };
    } else if (current && line.trim() !== "") {
      // Continuation of the previous message (multi-line message).
      current.text += "\n" + line;
    }
  }
  if (current) messages.push(current);
  return messages;
}

/** Flatten a Telegram JSON "text" field (string or entity array). */
function telegramText(field) {
  if (typeof field === "string") return field;
  if (Array.isArray(field)) {
    return field
      .map((p) => (typeof p === "string" ? p : p && typeof p.text === "string" ? p.text : ""))
      .join("");
  }
  return "";
}

/**
 * Parse a JSON chat export. Returns { messages, format } or null.
 * Telegram JSON: { messages: [{ from, text, date }] } — text may be
 * a string or an entity array. Messenger/Facebook JSON:
 * { messages: [{ sender_name, content, timestamp_ms }] } — messages
 * without content (photos, stickers, calls) and unsent / taken-down
 * messages are skipped; the export lists newest first, so the result
 * is sorted oldest-first like every other format.
 */
function parseJsonExport(rawText) {
  let data = null;
  try {
    data = JSON.parse(rawText);
  } catch {
    return null;
  }
  if (!data || !Array.isArray(data.messages)) return null;
  const list = data.messages;
  if (list.length === 0) {
    // Empty export — tell the formats apart by the top level:
    // Messenger has "participants", Telegram has "type"/"name".
    const isMessenger = Array.isArray(data.participants);
    return { messages: [], format: isMessenger ? "messenger-json" : "telegram-json" };
  }
  const first = list.find((m) => m && typeof m === "object") || {};
  if ("sender_name" in first || "content" in first) {
    // Messenger / Facebook export.
    const messages = list
      .filter((m) => m && typeof m.content === "string" && m.content.trim() !== "")
      .filter((m) => !m.is_unsent && !m.is_taken_down)
      .map((m) => ({
        sender: m.sender_name || "",
        text: m.content,
        ts: Number(m.timestamp_ms) || 0,
      }))
      .sort((a, b) => a.ts - b.ts)
      .map(({ sender, text }) => ({ sender, text }));
    return { messages, format: "messenger-json" };
  }
  if ("from" in first || "text" in first) {
    // Telegram JSON export.
    const messages = list
      .filter((m) => m && m.type !== "service")
      .map((m) => ({ sender: m.from || "", text: telegramText(m.text) }))
      .filter((m) => m.text.trim() !== "");
    return { messages, format: "telegram-json" };
  }
  return null;
}

/** Strip HTML tags and decode the common entities (Node-safe: no DOMParser). */
function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/**
 * Parse a Telegram HTML export. Each message block carries
 * <div class="from_name">Name</div> and <div class="text">…</div>;
 * service messages (joins, renames) have neither and are skipped.
 * Regex-based (the export format is fixed) so it works in Node
 * tests as well as in the browser.
 */
function parseTelegramHtml(rawText) {
  if (!rawText.includes('<div class="message') || !rawText.includes('<div class="from_name">')) {
    return null;
  }
  const messages = [];
  for (const block of String(rawText).split('<div class="message')) {
    const nameM = block.match(/<div class="from_name">([\s\S]*?)<\/div>/);
    const textM = block.match(/<div class="text">([\s\S]*?)<\/div>/);
    if (!nameM || !textM) continue;
    const text = stripHtml(textM[1]);
    if (!text) continue;
    messages.push({ sender: stripHtml(nameM[1]), text });
  }
  return messages.length > 0 ? { messages, format: "telegram-html" } : null;
}

/**
 * Fallback: no timestamps, no JSON, no Telegram HTML — treat every
 * non-empty line as one message (raw pasted chat, plain-line logs).
 * The sender is unknown, so it is labelled as such.
 */
function parsePlainLines(rawText, lang) {
  const sender = t("chatlogPlainSender", lang);
  const messages = [];
  for (const line of String(rawText || "").split(/\r?\n/)) {
    if (line.trim() !== "") messages.push({ sender, text: line.trim() });
  }
  return messages;
}

/**
 * Parse any supported export. Returns { messages, format } where
 * format is "whatsapp" | "telegram-json" | "messenger-json" |
 * "telegram-html" | "plain" | "none".
 */
export function parseChatExportWithFormat(rawText, lang = "id") {
  const text = String(rawText || "");
  const json = parseJsonExport(text);
  if (json) return json;
  const html = parseTelegramHtml(text);
  if (html) return html;
  const wa = parseWhatsApp(text);
  if (wa.length > 0) return { messages: wa, format: "whatsapp" };
  const plain = parsePlainLines(text, lang);
  if (plain.length > 0) return { messages: plain, format: "plain" };
  return { messages: [], format: "none" };
}

/** Parse the export into [{ sender, text }] (kept for compatibility). */
export function parseChatExport(rawText) {
  return parseChatExportWithFormat(rawText).messages;
}

/**
 * Scan a chat export. Returns:
 * { error: "tooBig" } |
 * { total, risky: [{sender, text, score, flags}], truncated, format }
 * A message is "risky" when the local heuristic scores it >= 30
 * (the same suspicious threshold the checker uses).
 */
export function scanChatLog(rawText, lang = "en") {
  // Byte-accurate limit: String.length counts UTF-16 units, so a CJK
  // export could pass ~2x the intended 2 MB (audit B8).
  const text = String(rawText || "");
  const byteLen =
    typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(text).length
      : text.length;
  if (byteLen > CHATLOG_MAX_BYTES) {
    return { error: "tooBig" };
  }
  const { messages: all, format } = parseChatExportWithFormat(rawText, lang);
  const truncated = all.length > CHATLOG_MAX_MESSAGES;
  const messages = truncated ? all.slice(0, CHATLOG_MAX_MESSAGES) : all;
  const risky = [];
  for (const msg of messages) {
    const verdict = analyzeWithHeuristic(msg.text, lang);
    if (verdict.riskScore >= 30) {
      risky.push({
        sender: msg.sender,
        text: msg.text,
        score: verdict.riskScore,
        flags: verdict.redFlags,
      });
    }
  }
  return { total: messages.length, risky, truncated, format };
}
