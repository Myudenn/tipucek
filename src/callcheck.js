// TipuCek — phone-call check (local patterns + community reports).
//
// The user types the caller number + what the caller said. Checks:
//  1. Known phone-scam scripts (local patterns, Indonesian + English):
//     claims to be a bank / police / agency, asks for OTP / PIN /
//     password, threatens blocking / arrest / fines, asks for a
//     transfer to a "safe account".
//  2. The number against the community report database (hash lookup —
//     the raw number never leaves the device except as a SHA-256 hash
//     sent to Firestore for the count query), and ONLY when the caller
//     allows it (options.allowReports). The UI passes
//     allowReports: !isLocalOnly(): with the default local-only mode
//     ON, no hash is sent anywhere — the toggle promise ("checks are
//     never sent to the cloud") holds for call checks too (audit §2c).
//
// Result is a normal verdict { status, riskScore, redFlags, summary,
// source: "LOCAL" } plus reportCount (null when the lookup failed).

import { demoSummary, t } from "./i18n.js";
import { getReportCount, reportHash } from "./reports.js";
import { CONTACTS } from "./contacts.js";

/** Strip everything but digits; convert +62/62 to the 0-prefix form. */
function normalizeIdNumber(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("62") && d.length > 10) return "0" + d.slice(2);
  return d;
}

/** Does this number match an official contact (BCA 1500888, ...)? */
function findOfficialContact(num) {
  const want = normalizeIdNumber(num);
  if (!want) return null;
  for (const c of CONTACTS) {
    if (!c.phone) continue;
    for (const part of String(c.phone).split("/")) {
      if (normalizeIdNumber(part) === want) return c;
    }
  }
  return null;
}

/** Plausible Indonesian number: 0-prefix, 9-15 digits. */
function isPlausibleIdNumber(num) {
  return /^0\d{8,14}$/.test(normalizeIdNumber(num));
}

const SCRIPT_PATTERNS = [
  {
    re: /\b(bank|polisi|police|ojk|kominfo|bea\s*cukai|customs|telkomsel|indosat|xl|bri|bca|mandiri|bni|bsi|shopee|tokopedia|dhl|jne)\b/i,
    key: "callScriptBank",
    weight: 25,
  },
  {
    re: /\b(otp|kode\s*otp|kode\s*verifikasi|verification\s*code|pin|password|kata\s*sandi)\b/i,
    key: "callScriptOtp",
    weight: 35,
  },
  {
    re: /\b(diblokir|blocked|ditangkap|arrest|denda|fine|penjara|jail|ditangguhkan|suspend|tindak\s*pidana)\b/i,
    key: "callScriptThreat",
    weight: 25,
  },
  {
    re: /\b(rekening\s*aman|safe\s*account|rekening\s*penampungan|akun\s*aman|rekening\s*sementara)\b/i,
    key: "callScriptSafeAccount",
    weight: 35,
  },
];

/** Check a phone call. Returns { verdict, reportCount }.
 * options.allowReports (default false): look the number up in the
 * community report database. The caller must pass true explicitly
 * (the UI passes !isLocalOnly()). */
export async function analyzeCall({ number = "", said = "" }, lang = "en", options = {}) {
  let score = 0;
  const flags = [];
  for (const p of SCRIPT_PATTERNS) {
    if (p.re.test(said)) {
      score += p.weight;
      const label = t(p.key, lang);
      if (!flags.includes(label)) flags.push(label);
    }
  }

  // Community reports for this number (hash only) — gated: a phone
  // hash is practically enumerable, so it is only sent when the user
  // opted into cloud history.
  let reportCount = null;
  const num = String(number || "").trim();
  if (num && options.allowReports) {
    try {
      const hash = await reportHash("phone", num);
      if (hash) reportCount = await getReportCount(hash);
    } catch {
      reportCount = null;
    }
  }
  if (reportCount != null && reportCount > 0) {
    score += 30;
    flags.push(t("reportCountPhone", lang, { n: reportCount }));
  }

  // Number-only check (the caller said nothing — or the user only has
  // the number): judge the number itself. An official-contact match
  // is Safe (unless the number was also reported — a spoofed official
  // number is a classic scam, so reports win). Anything else is at
  // best "suspicious": a bare number can never be called Safe on
  // format alone, because the verdict would say "safe" about
  // something nobody actually checked.
  let numberOnlySummary = null;
  const saidEmpty = !String(said || "").trim();
  if (saidEmpty && num) {
    const official = findOfficialContact(num);
    if (official && !(reportCount != null && reportCount > 0)) {
      score = 0;
      flags.push(t("callOfficial", lang, { name: official.name }));
      numberOnlySummary = t("callOfficialSummary", lang, {
        name: official.name,
      });
    } else if (!isPlausibleIdNumber(num)) {
      score = Math.max(score, 30);
      flags.push(t("callBadFormat", lang));
      numberOnlySummary = t("callNumberOnlySummary", lang);
    } else {
      score = Math.max(score, 30);
      flags.push(t("callNumberOnly", lang));
      numberOnlySummary = t("callNumberOnlySummary", lang);
    }
  }

  score = Math.max(0, Math.min(100, score));
  const status = score >= 60 ? "scam" : score >= 30 ? "suspicious" : "safe";
  return {
    verdict: {
      status,
      riskScore: score,
      redFlags: flags,
      summary: numberOnlySummary || demoSummary(status, lang),
      source: "LOCAL",
    },
    reportCount,
  };
}

/**
 * Merge a cloud verdict for a transcribed call with the local call
 * analysis (number + script patterns run on the transcript). The worse
 * verdict wins: the score is the higher of the two, the flags are the
 * union, the summary comes from the AI verdict, and the source stays
 * the AI source (IN_CLOUD / DEMO). Pure — unit-tested.
 */
export function mergeCallVerdict(aiVerdict, localVerdict) {
  const ai = aiVerdict || {};
  const local = localVerdict || {};
  const rank = { safe: 0, suspicious: 1, scam: 2 };
  const aiRank = rank[ai.status] ?? 0;
  const localRank = rank[local.status] ?? 0;
  const status = aiRank >= localRank ? ai.status || "safe" : local.status;
  const riskScore = Math.max(
    0,
    Math.min(
      100,
      Math.max(Number(ai.riskScore) || 0, Number(local.riskScore) || 0),
    ),
  );
  const redFlags = [...(ai.redFlags || [])];
  for (const f of local.redFlags || []) {
    if (!redFlags.includes(f)) redFlags.push(f);
  }
  return {
    status,
    riskScore,
    redFlags,
    summary: String(ai.summary || local.summary || ""),
    source: ai.source || "Unknown",
  };
}
