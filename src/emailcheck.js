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
  const domain = String(fromEmail.split("@")[1] || "").trim().toLowerCase();
  const nameLower = String(fromName || "").toLowerCase();
  let base = analyzeWithHeuristic(body, lang);
  // Verified sender (22 Nov audit 8): a genuine brand email names
  // its own brand in the body ("Terima kasih telah berbelanja di
  // Tokopedia") — the message heuristic's impersonation rule fires
  // on that word alone (+10), so a legit Tokopedia email scored
  // 10/100 on one rule. When the sender domain IS that brand's real
  // domain and the rule fired on the brand's own name, the rules are
  // excused: recompute without "impersonation" and "multiLinks" (a
  // verified brand's own links — a real order email always carries
  // 2+) and note the verification as an info row (never a danger
  // sign). The brand need only be named anywhere in the body (the
  // rule's evidence is a narrow snippet around its first match —
  // see the gate below). A look-alike domain (tokopedia-promo.net,
  // gmail) is NOT the brand's domain, so it still fires — and the
  // mismatch rule below still fires too.
  let brandVerified = null;
  const senderBrand = domain
    ? BRANDS.find((b) => b.domains.some((d) => domain === d || domain.endsWith("." + d)))
    : null;
  const impRow = base.checks.find((c) => c.id === "impersonation");
  // The brand is named ANYWHERE in the body, not just in the rule's
  // evidence snippet (reviewer follow-up, audit 8): the snippet is a
  // ±28-char window around the FIRST impersonation match, so a real
  // brand email that names another brand first ("Bank BCA ... di
  // Tokopedia") would fail the evidence check and stay 10/100. The
  // domain gate above still stands — a look-alike sender never gets
  // here — so naming the sender's own brand anywhere in its own
  // email is what excuses the rule.
  if (
    senderBrand &&
    impRow &&
    impRow.found &&
    body.toLowerCase().includes(senderBrand.name)
  ) {
    base = analyzeWithHeuristic(body, lang, { skipIds: new Set(["impersonation", "multiLinks"]) });
    brandVerified = {
      id: "emailBrandVerified",
      flag: "Sender domain matches the brand named in the email",
      found: true,
      kind: "info",
      evidence: domain,
    };
  }
  let score = base.riskScore;
  const flags = [...base.redFlags];
  // The result card's checklist must show the checks that actually
  // produced THIS verdict — the 23 message rules PLUS the 4 email
  // checks below (21 Nov, audit 4: the top list showed 6 flags while
  // the checklist counted only the 3 message rules that fired).
  // Each email check is one row: found/clean, flag in English (the
  // card translates it at render), evidence where it helps.
  const emailChecks = [
    { id: "emailMismatch", flag: "Sender name does not match the sender domain", found: false, evidence: "" },
    { id: "emailFreeMail", flag: "A company or bank writing from a free mailbox (Gmail, Yahoo, …)", found: false, evidence: "" },
    { id: "emailLinkRisk", flag: "Suspicious link inside the email", found: false, evidence: "" },
    { id: "emailUrgency", flag: "Pressure or threat language (urgent, account blocked, act now)", found: false, evidence: "" },
  ];

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
      emailChecks[0].found = true;
      emailChecks[0].evidence = domain;
      break;
    }
  }
  // 2. A company/bank writing from a free mailbox.
  if (domain && FREE_MAIL.has(domain) && nameLower.trim() !== "") {
    score += 20;
    if (!flags.includes(t("emailFreeMail", lang))) {
      flags.push(t("emailFreeMail", lang));
    }
    emailChecks[1].found = true;
    emailChecks[1].evidence = domain;
  }
  // 3. Suspicious links in the body.
  const links = analyzeLinks(body);
  if (links.some((l) => l.level === "high")) {
    score += 15;
    if (!flags.includes(t("emailLinkRisk", lang))) {
      flags.push(t("emailLinkRisk", lang));
    }
    emailChecks[2].found = true;
    emailChecks[2].evidence = (links.find((l) => l.level === "high") || {}).url || "";
  }
  // 4. Pressure / threat language.
  if (URGENCY_RE.test(body)) {
    score += 10;
    if (!flags.includes(t("emailUrgency", lang))) {
      flags.push(t("emailUrgency", lang));
    }
    emailChecks[3].found = true;
  }

  score = Math.max(0, Math.min(100, score));
  const status = score >= 60 ? "scam" : score >= 30 ? "suspicious" : "safe";
  return {
    status,
    riskScore: score,
    redFlags: flags,
    checks: [...base.checks, ...emailChecks, ...(brandVerified ? [brandVerified] : [])],
    summary: demoSummary(status, lang),
    source: "LOCAL",
  };
}
