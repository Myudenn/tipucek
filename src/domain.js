// TipuCek — link / domain tracking (best effort, honest failures).
//
// Two public, key-free lookups, both done from the browser:
//  1. Short-link destination: follow the redirect and read the final
//     URL. Most shorteners block cross-origin fetches (CORS), so this
//     OFTEN fails — the UI then says "cannot be traced", never a guess.
//  2. Domain age via public RDAP (https://rdap.org): registration
//     date + registrar. A domain registered days ago is a red signal;
//     an old domain is not proof of safety.
//
// No API key, no paid service, no data sent to a third party except
// the domain name itself (to RDAP) and the short URL itself (to the
// shortener, only when the user asks to trace it).

const FETCH_TIMEOUT_MS = 8000;

function withTimeout() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

// Common two-level public suffixes (co.id, co.uk, com.au, …). The
// full public-suffix list is too big to ship; this set covers the
// suffixes a scam link plausibly uses, so mail.bca.co.id resolves to
// bca.co.id instead of the bare suffix co.id (audit B4).
const TWO_LEVEL_SUFFIXES = new Set([
  "co.id", "ac.id", "go.id", "or.id", "web.id", "sch.id", "mil.id",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "net.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp",
  "com.br", "com.mx", "com.ar", "com.co", "com.pe", "com.cl",
  "co.za", "co.in", "co.kr", "com.tw", "com.hk", "com.sg", "com.my",
  "com.ph", "com.vn", "com.pk", "com.ng", "com.tr", "com.pl",
  "com.ua", "co.th", "com.eg", "com.sa", "com.ae", "co.il",
]);

/** Registrable domain of a host (last two labels, or three when the
 *  last two form a known two-level suffix — not a full public-suffix
 *  list, but correct for the common cases; used for display + RDAP). */
export function registrableDomain(host) {
  const parts = String(host || "").split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (parts.length > 2 && TWO_LEVEL_SUFFIXES.has(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * Look up a domain on public RDAP.
 * Returns { registered, registrar, ageDays } or { error: "unavailable" }.
 */
export async function lookupDomain(domain) {
  const { signal, done } = withTimeout();
  try {
    const res = await fetch(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      { signal },
    );
    done();
    if (!res.ok) return { error: "unavailable" };
    const j = await res.json();
    const reg = (j.events || []).find((e) => e.eventAction === "registration");
    const registered = reg?.eventDate ? String(reg.eventDate).slice(0, 10) : null;
    const registrarEnt = (j.entities || []).find((e) =>
      (e.roles || []).includes("registrar"),
    );
    let registrar = null;
    const vcard = registrarEnt?.vcardArray?.[1] || [];
    const fn = vcard.find((p) => p[0] === "fn");
    registrar =
      (fn && fn[3]) ||
      registrarEnt?.publicIds?.[0]?.identifier ||
      null;
    const ageDays = registered
      ? Math.max(0, Math.floor((Date.now() - new Date(registered).getTime()) / 86400000))
      : null;
    return { registered, registrar, ageDays };
  } catch {
    done();
    return { error: "unavailable" };
  }
}

/**
 * Follow a short link to its final destination (best effort).
 * Returns { finalUrl, resolved: true } when the redirect chain was
 * actually followed: the fetch succeeded, so the final URL is the
 * real destination — even when it equals the input because the URL
 * did not redirect at all. Returns { error: "unresolvable",
 * resolved: false } when the follow was blocked (CORS, mixed
 * content, network failure) and the destination was never seen:
 * callers must NOT present the input URL as a "final destination"
 * in that case — it is only the link that was entered.
 */
export async function resolveShortLink(url) {
  const { signal, done } = withTimeout();
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal,
    });
    done();
    return { finalUrl: res.url || url, resolved: true };
  } catch {
    done();
    return { error: "unresolvable", resolved: false };
  }
}
