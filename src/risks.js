// TipuCek — local link-risk + number analysis (no network, no API key).
//
// The evaluation asked for a "link scanner" (redirects, domain age,
// Safe Browsing / PhishTank). Those need a server and paid API keys, so
// the site cannot do them from the browser. What it CAN do honestly, on
// the device, is a local risk analysis of every URL in the message:
// shorteners, suspicious TLDs, brand look-alikes (typosquats),
// IP-literal hosts, punycode, http-only login pages, and @-tricks.
// Each link gets a level ("safe" | "low" | "high") plus reason keys the
// UI translates. Likewise, phone numbers and bank-account-like digit
// runs are extracted so the user can see them at a glance — TipuCek
// has no scam-number database of its own, so the UI points to the
// official checker (cekrekening.id) instead of pretending otherwise.

const SHORTENERS = new Set([
  "bit.ly", "tinyurl.com", "t.co", "s.id", "goo.gl", "shorturl.at",
  "cutt.ly", "is.gd", "rb.gy", "shorte.st", "ow.ly", "buff.ly", "adf.ly",
  "bit.do", "mcaf.ee", "soo.gd", "tiny.cc", "v.gd", "qr.ae", "t.ly",
]);

const SUSPICIOUS_TLDS = new Set([
  "xyz", "top", "click", "link", "tk", "ml", "ga", "cf", "gq", "buzz",
  "online", "site", "fun", "icu", "sbs", "cyou", "quest", "zip", "mov",
]);

// Brands scammers impersonate in Indonesia (+ global couriers). A host
// is a look-alike when it CONTAINS a brand string but is not the brand's
// real domain (e.g. bca-klik-aman.xyz, telkomsel-hadiah.com).
export const BRANDS = [
  { name: "bca", domains: ["bca.co.id", "klikbca.com"] },
  { name: "bri", domains: ["bri.co.id", "ib.bri.co.id"] },
  { name: "mandiri", domains: ["bankmandiri.co.id", "livinmandiri.co.id"] },
  { name: "bni", domains: ["bni.co.id"] },
  { name: "bsi", domains: ["bankbsi.co.id"] },
  { name: "telkomsel", domains: ["telkomsel.com"] },
  { name: "indosat", domains: ["indosat.com", "myim3.com"] },
  { name: "xl", domains: ["xl.co.id", "myxl.co.id"] },
  { name: "dhl", domains: ["dhl.com", "dhl.co.id"] },
  { name: "jne", domains: ["jne.co.id"] },
  { name: "j&t", domains: ["jet.co.id", "jtexpress.id"] },
  { name: "sicepat", domains: ["sicepat.com"] },
  { name: "gojek", domains: ["gojek.com"] },
  { name: "grab", domains: ["grab.com"] },
  { name: "shopee", domains: ["shopee.co.id"] },
  { name: "tokopedia", domains: ["tokopedia.com"] },
  { name: "dana", domains: ["dana.id"] },
  { name: "ovo", domains: ["ovo.id"] },
  { name: "gopay", domains: ["gojek.com"] },
  { name: "whatsapp", domains: ["whatsapp.com"] },
  { name: "telegram", domains: ["telegram.org"] },
  { name: "google", domains: ["google.com", "google.co.id"] },
  { name: "facebook", domains: ["facebook.com"] },
  { name: "instagram", domains: ["instagram.com"] },
  { name: "ojk", domains: ["ojk.go.id"] },
  { name: "polri", domains: ["polri.go.id"] },
];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function tldOf(host) {
  const parts = host.split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

/** Analyze one URL. Returns { url, host, level, reasons[] (i18n keys) }. */
export function analyzeLink(url) {
  const host = hostOf(url);
  const reasons = [];
  let level = "safe";
  if (!host) return { url, host, level: "low", reasons: ["linkRiskUnparseable"] };

  if (SHORTENERS.has(host) || SHORTENERS.has(host.replace(/^www\./, ""))) {
    level = "high";
    reasons.push("linkRiskShortener");
  }
  const tld = tldOf(host);
  if (SUSPICIOUS_TLDS.has(tld)) {
    if (level !== "high") level = "low";
    reasons.push("linkRiskTld");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    level = "high";
    reasons.push("linkRiskIp");
  }
  if (host.includes("xn--")) {
    if (level !== "high") level = "low";
    reasons.push("linkRiskPunycode");
  }
  if (url.includes("@") && !url.startsWith("mailto:")) {
    if (level !== "high") level = "low";
    reasons.push("linkRiskAt");
  }
  if (url.startsWith("http://")) {
    if (level === "safe") level = "low";
    reasons.push("linkRiskHttp");
  }
  const subdomains = host.split(".").length - 2;
  if (subdomains >= 3) {
    if (level === "safe") level = "low";
    reasons.push("linkRiskSubdomains");
  }
  // Brand look-alike: host mentions a brand but is not its real domain.
  // Matched on host LABELS (split on "." and "-"): "abcabc.com" does
  // not mention "bca", but "bca-klik-aman.xyz" does (audit B7).
  // A label that STARTS with the brand also counts ("bcabank.com").
  const hostLabels = host.toLowerCase().split(/[.-]/).filter(Boolean);
  for (const b of BRANDS) {
    if (
      hostLabels.some((lbl) => lbl === b.name || lbl.startsWith(b.name)) &&
      !b.domains.some((d) => host === d || host.endsWith(`.${d}`))
    ) {
      level = "high";
      reasons.push("linkRiskBrand");
      break;
    }
  }
  return { url, host, level, reasons };
}

/** Analyze every URL in a message (deduplicated, order preserved). */
export function analyzeLinks(message) {
  const urls = (message.match(/https?:\/\/[^\s<>"')]+/g) || []).map((u) =>
    u.replace(/[.,;:!?]+$/, ""),
  );
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(analyzeLink(u));
  }
  return out;
}

// Indonesian phone numbers (08xx / +62 8xx, 9-14 digits, separators
// allowed: 0812-3456-7890) and bank account-like digit runs (10-16
// digits, often grouped with spaces/dashes).
const PHONE_RE = /(?:\+62|62|0)8[0-9][0-9\s-]{6,13}[0-9]\b/g;
const ACCOUNT_RE = /\b\d{4}[- ]?\d{4}[- ]?\d{2,8}\b/g;

/** Extract phone numbers + account-like numbers from a message. */
export function extractNumbers(message) {
  const text = message || "";
  const phones = [...new Set(text.match(PHONE_RE) || [])];
  const accounts = [...new Set(text.match(ACCOUNT_RE) || [])].filter(
    (a) => !phones.includes(a),
  );
  return { phones, accounts };
}
