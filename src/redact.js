// TipuCek — redaction before AI (auto-redact PII).
//
// A message the user checks may contain sensitive values (phone number,
// bank account, OTP, PIN, card, NIK, email, code). The raw text is what
// the LOCAL rules need (they run on-device and never leave it), but the
// AI verdict goes to the cloud — so before ANY text reaches the model,
// sensitive values are replaced with TYPED placeholders ([NOMOR_HP],
// [REKENING], [KODE_OTP], ...). The placeholder keeps the SIGNAL ("a
// phone number is here", "an account is the destination") while the
// VALUE never leaves the device.
//
// Context-aware, not blind: a tracking number ("resi JNE 1234567890")
// is NOT a bank account, money amounts (Rp 2.000.000) and years (tahun
// 2026) are NOT personal data and are left alone. Names and street
// addresses cannot be detected by patterns — the UI and the privacy
// policy say so honestly instead of claiming full redaction.
//
// Pure function: no imports, no side effects, no network. Idempotent:
// redacting already-redacted text changes nothing.

/** Map from kind key -> placeholder string. */
const PLACEHOLDERS = {
  phone: "[NOMOR_HP]",
  account: "[REKENING]",
  otp: "[KODE_OTP]",
  pin: "[PIN]",
  card: "[KARTU]",
  ktp: "[NIK]",
  email: "[EMAIL]",
  code: "[KODE]",
};

/**
 * Collect all matches of `re` (must have the /g flag) in `text`.
 * Returns array of { start, end, kind, placeholder }.
 */
function collectMatches(re, text, kind) {
  const spans = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    spans.push({
      start: m.index,
      end: m.index + m[0].length,
      kind,
      placeholder: PLACEHOLDERS[kind],
    });
  }
  return spans;
}

/** True when the character at `pos` in `text` is a digit (false out of bounds). */
function isDigitAt(text, pos) {
  if (pos < 0 || pos >= text.length) return false;
  return /\d/.test(text[pos]);
}

/** Substring of `text` preceding `start` (up to `window` chars), lower-cased. */
function preceding(text, start, window) {
  return text.slice(Math.max(0, start - window), start).toLowerCase();
}

/** True when `span` overlaps any span in `accepted`. */
function overlapsAny(span, accepted) {
  for (const a of accepted) {
    if (span.start < a.end && span.end > a.start) return true;
  }
  return false;
}

// OTP context words (same list as src/outbound.js — a bare 6-digit run
// is only an OTP when the message talks about one, or when the whole
// message is basically just the code).
const OTP_WORDS_RE =
  /\b(otp|kode\s+otp|kode\s*verifikasi|verification\s*code|one[\s-]?time|sekali\s*pakai)\b/i;

function hasOtpContext(text) {
  return OTP_WORDS_RE.test(text);
}

function isShortCodeOnly(text) {
  // The message is basically JUST the code: the 6 digits alone, or
  // with only a short "kode/otp/code" label (and optional colon /
  // punctuation) around it. A word like "Harga" (price) or "Rp"
  // disqualifies it — "Harga 100000" is a price, not an OTP, even
  // though it is short. (The looser length-only rule in outbound.js
  // would swallow "Harga 100000"; redaction must not.)
  const t = text.trim();
  return /^(?:(?:kode|otp|code)\s*:?\s*)?\d{6}\s*[.!?]?\s*$/i.test(t);
}

// Resi/tracking guard: a resi keyword ("resi", "tracking", "awb",
// "airwaybill") followed by up to 14 non-digit chars (courier name,
// colon, spaces — e.g. "resi JNE ") right before the number means the
// number is a TRACKING number, not a bank account. The courier name
// between the keyword and the number is why a plain "ends with resi"
// check is not enough ("resi JNE 1234567890" must stay intact).
const RESI_GUARD_RE =
  /(?:resi|no\.?\s*resi|tracking|awb|airwaybill)\b[^0-9]{0,14}$/i;
// Transaction-reference guard (CoArena audit, 23 Nov 2026): a number
// that directly follows a transaction/reference label ("No. transaksi
// 123456789012") is a reference, not a bank account. The label must
// be the LAST word before the number — "transaksi ke rekening
// 1234567890" still redacts, because "rekening" (not "transaksi")
// is the word right before the number.
const TXN_LABEL_RE = /(?:transaksi|transaction|referensi|reference|ref\.?)\s*:?\s*$/i;
// Year guard (CoArena audit, 23 Nov 2026): a 4-digit number in the
// 1900-2099 range that follows a year/validity word ("tahun 2026",
// "berlaku sampai 2026") is a year, not a PIN.
const YEAR_CONTEXT_RE = /(?:tahun|year|berlaku|valid|sampai|until)\b[^0-9]{0,14}$/i;
const COURIER_PREFIX_RE =
  /^(?:jne|jnt|j&t|sicepat|anteraja|tiki|wahana|ninja|dhl|fedex|awb)/i;

// Money guard: a number right after Rp/USD/IDR/... is an amount, not
// an account number ("transfer Rp1000000000" must stay intact).
const MONEY_PREFIX_RE = /(?:rp\.?\s*|usd\s*|idr\s*|eur\s*|sgd\s*|gbp\s*)$/i;

/**
 * Redact sensitive values from a message for safe AI transmission.
 * Returns { text, found } — `found` is [{ kind, count }] in
 * first-appearance order. Empty/null input -> { text: "", found: [] }.
 */
export function redactForAI(text) {
  if (text == null || text === "") return { text: "", found: [] };
  if (typeof text !== "string") {
    try {
      text = String(text);
    } catch {
      return { text: "", found: [] };
    }
  }

  // Candidates are collected in priority order (email > card > ktp >
  // phone > account > otp > pin > code); a lower-priority candidate
  // that overlaps an accepted span is dropped.
  const candidates = [];

  // Rule 1 — Email.
  {
    const re = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    for (const s of collectMatches(re, text, "email")) {
      candidates.push({ ...s, priority: 1 });
    }
  }

  // Rule 2 — Card: 16 digits GROUPED with separators.
  {
    const re = /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g;
    for (const s of collectMatches(re, text, "card")) {
      candidates.push({ ...s, priority: 2 });
    }
  }

  // Rule 3 — NIK: solid 16 digits (no separators).
  {
    const re = /\b\d{16}\b/g;
    for (const s of collectMatches(re, text, "ktp")) {
      candidates.push({ ...s, priority: 3 });
    }
  }

  // Rule 4 — Phone: Indonesian mobile. Separators (space/hyphen) are
  // allowed after the country code and between digit groups
  // ("+62 812-3456-7890", "0812 3456 7890") — the digit count is
  // validated in the callback (10-13 digits), and the match must not
  // be part of a longer digit run (same guard as src/risks.js
  // extractNumbers: a phantom phone inside a transaction number).
  {
    const re = /(?:\+62|62|0)[\s-]*8(?:[\s-]?[0-9]){7,11}/g;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      if (start > 0 && /\d/.test(text[start - 1])) continue;
      if (isDigitAt(text, start + m[0].length)) continue;
      const digits = m[0].replace(/\D/g, "").length;
      if (digits < 10 || digits > 13) continue;
      candidates.push({
        start,
        end: start + m[0].length,
        kind: "phone",
        placeholder: PLACEHOLDERS.phone,
        priority: 4,
      });
    }
  }

  // Rule 5 — Account: 4 + 4 + 2-8 digits, separators optional.
  // Skip when it is part of a longer digit run, when it is a tracking
  // number (resi guard), when it is a transaction reference (txn
  // guard), or when it is a money amount (Rp guard).
  {
    const re = /\b\d{4}[- ]?\d{4}[- ]?\d{2,8}\b/g;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (isDigitAt(text, start - 1) || isDigitAt(text, end)) continue;
      const pre = preceding(text, start, 24);
      if (RESI_GUARD_RE.test(pre)) continue;
      if (TXN_LABEL_RE.test(pre)) continue;
      if (MONEY_PREFIX_RE.test(pre)) continue;
      candidates.push({
        start,
        end,
        kind: "account",
        placeholder: PLACEHOLDERS.account,
        priority: 5,
      });
    }
  }

  // Rule 6 — OTP: a 6-digit run, ONLY with OTP context (or when the
  // whole message is basically just the code). A bare 6-digit run in
  // a longer message is not an OTP — it could be a price. And even
  // with OTP context, a 6-digit run right after a currency marker
  // ("OTP 123456, harga Rp 100000") is an amount, not a code
  // (CoArena audit, 23 Nov 2026).
  if (hasOtpContext(text) || isShortCodeOnly(text)) {
    const re = /\b\d{6}\b/g;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      if (MONEY_PREFIX_RE.test(preceding(text, m.index, 24))) continue;
      candidates.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "otp",
        placeholder: PLACEHOLDERS.otp,
        priority: 6,
      });
    }
  }

  // Rule 7 — PIN: a 4-6 digit run, ONLY when the word "pin" appears.
  // A run right after a currency marker is an amount, and a 4-digit
  // run in the 1900-2099 range after a year/validity word ("tahun
  // 2026") is a year — neither is a PIN (CoArena audit, 23 Nov 2026).
  if (/\bpin\b/i.test(text)) {
    const re = /\b\d{4,6}\b/g;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const pre = preceding(text, m.index, 24);
      if (MONEY_PREFIX_RE.test(pre)) continue;
      if (
        m[0].length === 4 &&
        /^(?:19|20)\d{2}$/.test(m[0]) &&
        YEAR_CONTEXT_RE.test(pre)
      ) {
        continue;
      }
      candidates.push({
        start: m.index,
        end: m.index + m[0].length,
        kind: "pin",
        placeholder: PLACEHOLDERS.pin,
        priority: 7,
      });
    }
  }

  // Rule 8 — Alphanumeric code tokens (letters AND digits, 4+ chars).
  // Skip currency amounts ("Rp100000"), courier-prefixed tokens
  // ("JNE1234567890" — a tracking number), and tokens right after a
  // resi keyword ("resi ABC123").
  {
    const re =
      /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{4,}\b/g;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
      const token = m[0];
      const start = m.index;
      if (/^(?:rp|usd|idr|eur|sgd|gbp)\d/i.test(token)) continue;
      if (COURIER_PREFIX_RE.test(token)) continue;
      if (RESI_GUARD_RE.test(preceding(text, start, 24))) continue;
      candidates.push({
        start,
        end: start + token.length,
        kind: "code",
        placeholder: PLACEHOLDERS.code,
        priority: 8,
      });
    }
  }

  // Resolve overlaps: priority first, then start position.
  candidates.sort((a, b) => a.priority - b.priority || a.start - b.start);
  const accepted = [];
  for (const c of candidates) {
    if (!overlapsAny(c, accepted)) accepted.push(c);
  }

  // Apply accepted spans left-to-right; count per kind in
  // first-appearance order.
  accepted.sort((a, b) => a.start - b.start);
  const kindOrder = [];
  const kindCounts = new Map();
  let result = "";
  let cursor = 0;
  for (const span of accepted) {
    result += text.slice(cursor, span.start) + span.placeholder;
    cursor = span.end;
    if (!kindCounts.has(span.kind)) {
      kindOrder.push(span.kind);
      kindCounts.set(span.kind, 0);
    }
    kindCounts.set(span.kind, kindCounts.get(span.kind) + 1);
  }
  result += text.slice(cursor);
  const found = kindOrder.map((kind) => ({
    kind,
    count: kindCounts.get(kind),
  }));
  return { text: result, found };
}
