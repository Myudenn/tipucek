// TipuCek — phishing email check (local, no AI, no network).
//
// The user pastes the email content + the sender. Checks:
//  1. Display-name vs sender-domain mismatch: the name claims a brand
//     (bank, courier, marketplace) but the domain is not that brand's
//     real domain.
//  2. Free mailbox: a "company" or "bank" writing from Gmail/Yahoo/...
//  3. Suspicious links inside the body (the same analyzeLinks the
//     message checker uses).
//  4. Pressure / threat language (urgent, blocked, act now).
//  5. The body's own heuristic score (same rules as the checker).
//
// Result is a normal verdict { status, riskScore, redFlags, summary,
// source: "LOCAL" } so the UI renders it exactly like a message check.

import { analyzeLinks } from "./risks.js";
import { BRANDS } from "./risks.js";
import { analyzeWithHeuristic } from "./ai.js";
import { demoSummary, t } from "./i18n.js";

const FREE_MAIL = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.co.id",
  "hotmail.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "gmx.com",
  "aol.com",
  "yandex.com",
]);

const URGENCY_RE =
  /\b(urgent|segera|sekarang|immediately|act now|bertindak sekarang|diblokir|blocked|suspend|ditangguhkan|24\s*jam|24\s*hours|verifikasi segera|verify now|peringatan terakhir|final warning)\b/i;

/** Check an email. `fromName` / `fromEmail` / `body` are user input. */
export function analyzeEmail({ fromName = "", fromEmail = "", body = "" }, lang = "en") {
  const base = analyzeWithHeuristic(body, lang);
  let score = base.riskScore;
  const flags = [...base.redFlags];
  const domain = String(fromEmail.split("@")[1] || "").trim().toLowerCase();
  const nameLower = String(fromName || "").toLowerCase();

  // 1. Brand name in the display name, but the domain is not the
  //    brand's real domain. The name is matched on whole TOKENS
  //    (split on non-alphanumerics): "Abcabc" does not contain the
  //    brand "bca" as a token, but "BCA Promo" does (audit B7).
  //    A token that STARTS with the brand also counts ("BCAPromo").
  const nameTokens = nameLower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const brand of BRANDS) {
    if (
      nameTokens.some((tok) => tok === brand.name || tok.startsWith(brand.name)) &&
      domain &&
      !brand.domains.some((d) => domain === d || domain.endsWith("." + d))
    ) {
      score += 30;
      if (!flags.includes(t("emailMismatch", lang))) {
        flags.push(t("emailMismatch", lang));
      }
      break;
    }
  }
  // 2. A company/bank writing from a free mailbox.
  if (domain && FREE_MAIL.has(domain) && nameLower.trim() !== "") {
    score += 20;
    if (!flags.includes(t("emailFreeMail", lang))) {
      flags.push(t("emailFreeMail", lang));
    }
  }
  // 3. Suspicious links in the body.
  const links = analyzeLinks(body);
  if (links.some((l) => l.level === "high")) {
    score += 15;
    if (!flags.includes(t("emailLinkRisk", lang))) {
      flags.push(t("emailLinkRisk", lang));
    }
  }
  // 4. Pressure / threat language.
  if (URGENCY_RE.test(body)) {
    score += 10;
    if (!flags.includes(t("emailUrgency", lang))) {
      flags.push(t("emailUrgency", lang));
    }
  }

  score = Math.max(0, Math.min(100, score));
  const status = score >= 60 ? "scam" : score >= 30 ? "suspicious" : "safe";
  return {
    status,
    riskScore: score,
    redFlags: flags,
    summary: demoSummary(status, lang),
    source: "LOCAL",
  };
}
