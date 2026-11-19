// TipuCek — "check before you send" (outbound guard).
//
// The opposite of the inbound checker: the user pastes a message they
// are ABOUT to send, and the app warns — locally, with patterns only,
// no AI, no network — if it contains information a scammer could use
// (OTP, password, card number, ID number, bank account, PIN).
//
// The result is a WARNING, never a scam verdict: this is the user's
// own message. Findings are MASKED (first 2 + last 2 digits only) —
// the raw secrets never appear in the result, and the check is never
// saved to history.

const OTP_CONTEXT_RE =
  /\b(otp|kode\s*otp|kode\s*verifikasi|verification\s*code|one[- ]?time|sekali\s*pakai)\b/i;
const PASSWORD_RE =
  /\b(password|kata\s*sandi|sandi|passwd|passw0rd)\b/i;
const PIN_CONTEXT_RE = /\b(pin)\b/i;
// 16 digits GROUPED with separators (1234 5678 9012 3456) = a card
// number. A SOLID 16-digit run (no separators) is an ID number (KTP):
// the old regex made separators optional, so it matched solid runs
// too and the KTP branch below was dead code (audit B2).
const CARD_RE = /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/;
const SOLID16_RE = /\b\d{16}\b/;
// Bank account: 10–15 digit runs (16-digit runs are card / ID).
const ACCOUNT_RE = /\b\d{10,15}\b/;
// A digit run that looks like an Indonesian phone number (08… or
// +62/628…) is NOT a bank account — accounts and phone numbers share
// the same length range, and flagging a phone number as an account
// was a false positive (audit B1).
const PHONE_LIKE_RE = /^(?:\+?62|0)8\d{7,12}$/;
const SIX_DIGIT_RE = /\b\d{6}\b/;

/** Mask a digit string: keep first 2 + last 2, hide the middle.
 * Empty input masks to "" (no digits to show) — the caller hides
 * the masked value when it is empty (audit B11). */
export function maskDigits(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 4) return "••" + d.slice(-2);
  return d.slice(0, 2) + "•".repeat(d.length - 4) + d.slice(-2);
}

/**
 * Analyze a message the user is about to send.
 * Returns [{ kind, masked }] — kind is an i18n key suffix:
 * otp | password | card | ktp | account | pin. Empty array = clean.
 */
export function analyzeOutgoing(text = "") {
  const found = [];
  const add = (kind, raw) => {
    if (!found.some((f) => f.kind === kind)) {
      found.push({ kind, masked: maskDigits(raw) });
    }
  };
  const t = String(text || "");

  // Card number first: a GROUPED 16-digit run is a card; a solid
  // 16-digit run is an ID number (KTP). The warning text covers both.
  const card = t.match(CARD_RE);
  if (card) {
    add("card", card[0]);
  } else {
    const solid16 = t.match(SOLID16_RE);
    if (solid16) {
      add("ktp", solid16[0]);
    }
  }
  // Bank account (10–15 digits, not part of a 16-digit run, and not
  // a phone number — see PHONE_LIKE_RE above).
  const account = t.match(ACCOUNT_RE);
  if (account && !PHONE_LIKE_RE.test(account[0])) add("account", account[0]);
  // Password: the word itself is the risk (a password in a chat).
  if (PASSWORD_RE.test(t)) add("password", "");
  // OTP: a 6-digit code ONLY next to an OTP word, or when the whole
  // message is basically just the code ("482916"). A bare 6-digit run
  // inside a longer message is NOT an OTP — prices ("Rp 100000") and
  // years ("tahun 2026") were false positives (audit B1).
  const six = t.match(SIX_DIGIT_RE);
  if (six) {
    const trimmed = t.trim();
    const bareCodeOnly = trimmed.length <= 12 && /^\D*\d{6}\D*$/.test(trimmed);
    if (OTP_CONTEXT_RE.test(t) || bareCodeOnly) add("otp", six[0]);
  }
  // PIN: 4–6 digits next to the word PIN.
  if (PIN_CONTEXT_RE.test(t)) {
    const short = t.match(/\b\d{4,6}\b/);
    if (short) add("pin", short[0]);
  }
  return found;
}
