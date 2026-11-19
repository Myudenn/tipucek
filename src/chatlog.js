// TipuCek — WhatsApp chat-export scanner (client-side only).
//
// Parses a WhatsApp .txt export (one message per timestamped line,
// continuation lines folded in), scores every message with the same
// local heuristic the checker uses (analyzeWithHeuristic — no AI, no
// network), and lists the risky ones.
//
// Limits, stated honestly in the UI: at most 2 MB / 5,000 messages.
// The score is per message, not a verdict on the whole chat — the
// user must read each flagged message themselves.

import { analyzeWithHeuristic } from "./ai.js";

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

/** Parse the export into [{ sender, text }]. System lines are skipped. */
export function parseChatExport(rawText) {
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

/**
 * Scan a WhatsApp export. Returns:
 * { error: "tooBig" } | { total, risky: [{sender, text, score, flags}], truncated }
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
  const all = parseChatExport(rawText);
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
  return { total: messages.length, risky, truncated };
}
