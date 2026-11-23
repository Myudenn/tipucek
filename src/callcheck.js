// TipuCek — phone-call check (local patterns + community reports).
//
// The user types the caller number + what the caller said. Checks:
//  1. Known phone-scam scripts (local patterns, Indonesian + English):
//     claims to be a bank / police / agency, asks for OTP / PIN /
//     password, threatens blocking / arrest / fines, asks for a
//     transfer to a "safe account".
//  2. The number against the community report database (hash lookup —
//     the raw number never leaves the device except as a SHA-256 hash
//     sent to Firestore for the count query). The lookup ALWAYS runs
//     when a number is given (21 Nov, Myuden: Cek Nomor "tetap tanpa
//     database" while the lookup was gated on cloud history). The
//     hash is suspect data, not the user's private data: it is a
//     one-way hash of the SCAMMER's number, read against a public
//     aggregate count (firestore.rules: /reports/{hash} allow read:
//     if true) — never the user's message, never their history. The
//     local-only toggle still governs what it always governed: the
//     user's own check HISTORY sync (saveCheck), not a public
//     database query the user explicitly asked for by tapping
//     "Cek panggilan".
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

/**
 * Candidate digit forms of a number for official-contact matching.
 * Besides the number as typed, also the number with a geographic
 * area code stripped ("0211500888" is BCA's "1500888" dialled with
 * Jakarta's code — audit 10: the same number + the same OJK claim
 * scored 25 Safe as "+62 21 1500888" but 60 Scam as "1500888").
 * Only "0" + 2-3 digits are stripped, and never a mobile 08xx
 * prefix — "08121500888" must NOT match BCA's number.
 */
function officialContactCandidates(num) {
  const want = normalizeIdNumber(num);
  if (!want) return [];
  const out = [want];
  if (/^0[^8]/.test(want)) {
    for (const cut of [3, 4]) {
      const rest = want.slice(cut);
      if (rest.length >= 3) out.push(rest);
    }
  }
  return out;
}

/** Does this number match an official contact (BCA 1500888, ...)? */
function findOfficialContact(num) {
  const cands = officialContactCandidates(num);
  if (!cands.length) return null;
  for (const c of CONTACTS) {
    if (!c.phone) continue;
    for (const part of String(c.phone).split("/")) {
      if (cands.includes(normalizeIdNumber(part))) return c;
    }
  }
  return null;
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Institutions a caller may claim to be — the official contacts plus
// generic institution words the bank pattern already recognises.
// Used by the identity-mismatch check (22 Nov audit 7): a caller on
// BCA's official number who claims to be OJK is verifiably lying
// about who they are.
const INSTITUTION_KEYWORDS = [
  ...CONTACTS.filter((c) => c.name).map((c) => ({
    re: new RegExp(`\\b${escapeRegExp(c.name.toLowerCase())}\\b`, "i"),
    name: c.name,
  })),
  // Generic institution words the bank pattern already recognises,
  // minus "bank" and "police" (CoArena review, audit 7): "bank" is
  // too generic to be a distinct institution (it could BE the owner),
  // and "Polisi" is already in CONTACTS. Kominfo / Bea Cukai are
  // specific institutions, so they stay.
  { re: /\bkominfo\b/i, name: "Kominfo" },
  { re: /\bbea\s*cukai\b/i, name: "Bea Cukai" },
  { re: /\bcustoms\b/i, name: "Bea Cukai" },
];

/** First institution named in a script (or null). The caller claims
 *  to be whoever they name FIRST — see analyzeCall. Pure. */
function firstInstitutionMention(saidText) {
  const text = String(saidText || "");
  if (!text.trim()) return null;
  let firstMention = null;
  let firstAt = Infinity;
  for (const cand of INSTITUTION_KEYWORDS) {
    const at = text.search(cand.re);
    if (at >= 0 && at < firstAt) {
      firstAt = at;
      firstMention = cand.name;
    }
  }
  return firstMention;
}

/**
 * Identity-mismatch check, shared by analyzeCall and by the history
 * annotation for pre-audit-7 entries (audit 10). Pure, synchronous,
 * no network: does this number belong to institution X while the
 * caller claims to be a DIFFERENT institution Y? Returns
 * { official, claimed } or null. NOTE: analyzeCall additionally
 * requires the number to be unreported (officialClean) before the
 * mismatch counts — this helper answers only the identity fact,
 * and callers apply the report guard themselves.
 */
export function currentMismatch(number, said) {
  const official = findOfficialContact(number);
  if (!official) return null;
  const claimed = firstInstitutionMention(said);
  if (!claimed) return null;
  if (claimed.toLowerCase() === official.name.toLowerCase()) return null;
  return { official: official.name, claimed };
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
  {
    // Plain transfer ask with no bank/OTP/threat words: "Tolong
    // transfer Rp 500.000 ke rekening ini ya" scored 0 (Safe) before
    // — a money request from an unknown caller is never Safe on its
    // own. Weight 30 = the number-only floor: suspicious alone, and
    // it combines (bank+transfer 55, OTP+transfer 65). Narrow on
    // purpose: "kirim kode OTP" must NOT match — only kirim+uang/dana/
    // saldo or kirim/bayar+ke rekening count (the pinned 85 case
    // "kirim kode OTP" stays 85).
    re: /\b(transfer|kirim\s+(uang|dana|saldo)|kirim\s+ke\s+rekening|bayar\s+ke\s+rekening|send\s+money|wire\s+transfer|transfer\s+money)\b/i,
    key: "callScriptTransfer",
    weight: 30,
  },
];

/** Check a phone call. Returns { verdict, reportCount }.
 * The community lookup always runs when a number is given (see the
 * header comment): the hash is a public-aggregate read of suspect
 * data, not a history upload. `options.allowReports` is kept for
 * backward compatibility and ignored — passing false no longer
 * disables the lookup (the old gate is gone). */

// The number-only summary must never claim "no reports" when the
// community lookup never ran (local-only default, reportCount null)
// or when reports actually exist (reportCount > 0) — the old static
// text said "no reports were found" in both cases.
function callNumberOnlySummaryFor(reportCount, lang) {
  if (reportCount != null && reportCount > 0) {
    return t("callNumberOnlyReported", lang, { n: reportCount });
  }
  if (reportCount === 0) return t("callNumberOnlySummary", lang);
  return t("callNumberOnlyUnchecked", lang);
}

export async function analyzeCall({ number = "", said = "" }, lang = "en", options = {}) {
  let score = 0;
  const flags = [];
  // Info flags (21 Nov audit 5): facts that explain the verdict but
  // are NOT danger signs — an official-contact match, and a caller
  // who claims to be the institution whose official number this is.
  // They render in a separate info box on the card and are never
  // counted as triggered rules, so a Safe 0/100 card for Halo BCA
  // 1500888 no longer shows a "red flag" at all.
  const infoFlags = [];
  const saidText = String(said || "");
  const num = String(number || "").trim();

  // Community reports for this number (hash only) — always looked
  // up when a number is given. A phone hash is practically
  // enumerable, but the database itself is public (anyone may read
  // the counts) and the hash reveals nothing about the USER: it is
  // the suspect's number, one-way hashed, never the raw value, never
  // the user's message or history. A null count now means only "the
  // lookup failed" (no network / no Firebase), never "gated off".
  // The lookup runs BEFORE the script patterns: whether the
  // bank-identity pattern is a danger or an info depends on the
  // number being a clean official contact.
  // Audit 6: time the community lookup itself — the local duration
  // pill (2.4-2.9 s for Cek Nomor vs 0.0 s for Cek Email) is the
  // REAL measured wait, dominated by this Firestore round-trip
  // (anonymous auth + getDoc). There is no artificial delay anywhere
  // on this path (no setTimeout in callcheck.js or reports.js).
  // lookupMs is null when no number was given (no lookup ran).
  let reportCount = null;
  let lookupMs = null;
  if (num) {
    const lookupT0 = performance.now();
    try {
      const hash = await reportHash("phone", num);
      if (hash) {
        reportCount = await getReportCount(hash);
        // Audit 6 (CoArena review): only call the time a "community
        // report lookup" when the lookup actually ran (hash obtained).
        // A failed hash (no crypto.subtle) never queried anything,
        // so the pill must not claim a lookup happened.
        lookupMs = performance.now() - lookupT0;
      }
    } catch {
      reportCount = null;
    }
  }
  const reported = reportCount != null && reportCount > 0;
  const official = num ? findOfficialContact(num) : null;
  const officialClean = official && !reported;

  // First institution mentioned in the script decides the claim
  // (22 Nov audit 7, CoArena review): the caller claims to be
  // whoever they name FIRST. "Saya dari OJK, bukan dari BCA" names
  // OJK first and must NOT be treated as a verified BCA identity
  // just because BCA appears later; "Saya dari BCA, OJK mengatur
  // kami" names BCA first and stays verified. A generic "bank" is
  // not a distinct institution, so it never counts as a mention.
  const firstMention = firstInstitutionMention(saidText);
  const claimsOfficial =
    officialClean &&
    firstMention != null &&
    firstMention.toLowerCase() === official.name.toLowerCase();
  // Identity mismatch (22 Nov audit 7): the number belongs to
  // institution X but the caller claims to be a DIFFERENT institution
  // Y. A real BCA caller never claims to be OJK — the claim is
  // verifiably false, so it is a danger sign (+35: bank pattern 25 +
  // mismatch 35 = 60, scam), not an info note. The mismatch fact
  // itself comes from currentMismatch (shared with the history
  // annotation for pre-audit-7 entries); the unreported guard
  // (officialClean) is applied here.
  const mm = currentMismatch(num, saidText);
  const mismatchClaim = officialClean && mm ? mm.claimed : null;

  // The result card's checklist must show the checks that actually
  // produced THIS verdict — the 5 call-script patterns (not the 17
  // message rules: a different rule set made the top list say 3
  // while the checklist counted 4, 21 Nov audit 4). One row per
  // pattern, flag in English (the card translates it at render),
  // evidence = the words that fired it. A demoted bank-identity
  // row carries kind:"info" — it renders in the info list, not in
  // the triggered count.
  const scriptChecks = [];
  for (const p of SCRIPT_PATTERNS) {
    const m = saidText ? saidText.match(p.re) : null;
    if (m && p.key === "callScriptBank" && claimsOfficial) {
      // The caller claims to be {official.name} and the number IS
      // that institution's official contact: a verified identity
      // claim, not a danger sign. No score, no red flag. The OTP /
      // threat / transfer / safe-account patterns still count: a
      // real bank never asks for those on a call.
      scriptChecks.push({
        id: p.key,
        flag: t(p.key, "en"),
        found: true,
        kind: "info",
        evidence: String(m[0]).slice(0, 120),
      });
      infoFlags.push(t("callOfficialIdentity", lang, { name: official.name }));
      continue;
    }
    scriptChecks.push({
      id: p.key,
      flag: t(p.key, "en"),
      found: !!m,
      evidence: m ? String(m[0]).slice(0, 120) : "",
    });
    if (m) {
      score += p.weight;
      const label = t(p.key, lang);
      if (!flags.includes(label)) flags.push(label);
    }
  }

  // Identity mismatch (audit 7): the number's owner and the claimed
  // institution differ — the checklist row carries the static English
  // flag (translated at render via demoFlag); the names travel in the
  // evidence, and the top red-flag list carries the full translated
  // sentence with both names.
  if (mismatchClaim) {
    score += 35;
    const label = t("callIdentityMismatch", lang, {
      official: official.name,
      claimed: mismatchClaim,
    });
    if (!flags.includes(label)) flags.push(label);
    scriptChecks.push({
      id: "callIdentityMismatch",
      flag: "Caller claims a different institution than the number's owner",
      found: true,
      evidence: `${official.name} → ${mismatchClaim}`,
    });
  }

  if (reported) {
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
  const saidEmpty = !saidText.trim();
  if (saidEmpty && num) {
    if (officialClean) {
      score = 0;
      infoFlags.push(t("callOfficial", lang, { name: official.name }));
      numberOnlySummary = t("callOfficialSummary", lang, {
        name: official.name,
      });
    } else if (!isPlausibleIdNumber(num)) {
      score = Math.max(score, 30);
      flags.push(t("callBadFormat", lang));
      numberOnlySummary = callNumberOnlySummaryFor(reportCount, lang);
    } else {
      score = Math.max(score, 30);
      flags.push(t("callNumberOnly", lang));
      numberOnlySummary = callNumberOnlySummaryFor(reportCount, lang);
    }
  }

  score = Math.max(0, Math.min(100, score));
  const status = score >= 60 ? "scam" : score >= 30 ? "suspicious" : "safe";
  // A clean call that named the institution from its official
  // number: the identity is verified, so the summary says so too —
  // with the spoofing warning (a real number can be faked). Only
  // when an info flag was actually produced and nothing fired: any
  // red flag keeps the status summary, and a script that never
  // mentions the institution keeps the generic one.
  const officialSummary =
    officialClean && !saidEmpty && flags.length === 0 && infoFlags.length > 0
      ? t("callOfficialSummary", lang, { name: official.name })
      : null;
  // Checklist rows for the verdict's own rule set (see above): the
  // community-reports row only when the lookup actually succeeded
  // (null = failed, and then the top list has no report flag either),
  // and the number-only row only when no conversation was given
  // (that assessment always adds exactly one flag, so the counts
  // match by construction). For an official number the number-only
  // row is kind:"info" — it renders in the info list and is not
  // counted as a triggered rule.
  const checks = [...scriptChecks];
  if (reportCount != null) {
    checks.push({
      id: "callReports",
      flag: "Community reports for this number",
      found: reportCount > 0,
      evidence:
        reportCount > 0
          ? t("reportCountPhone", lang, { n: reportCount })
          : t("reportNone", lang),
    });
  }
  if (saidEmpty && num) {
    const row = {
      id: "callNumberOnly",
      flag: "Number-only check: judged by the number itself",
      found: true,
      evidence: "",
    };
    if (officialClean) row.kind = "info";
    checks.push(row);
  }
  return {
    verdict: {
      status,
      riskScore: score,
      redFlags: flags,
      infoFlags,
      checks,
      summary: numberOnlySummary || officialSummary || demoSummary(status, lang),
      source: "LOCAL",
    },
    reportCount,
    lookupMs,
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
  // Info flags travel with the verdict too: a transcribed call from
  // an official number keeps its "verified identity" note even when
  // the AI verdict wins on score (audit 5). Never a danger sign.
  const infoFlags = [...(ai.infoFlags || [])];
  for (const f of local.infoFlags || []) {
    if (!infoFlags.includes(f)) infoFlags.push(f);
  }
  return {
    status,
    riskScore,
    redFlags,
    infoFlags,
    summary: String(ai.summary || local.summary || ""),
    source: ai.source || "Unknown",
    // Which AI model produced the AI part (primary / backup / code /
    // on-device): the local call analysis never supplies one.
    model: ai.model,
  };
}
